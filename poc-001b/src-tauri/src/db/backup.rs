use super::{
    attachments::AttachmentStore, check_integrity, migrations, paper_files::open_regular,
    protection::file_error, Database, DbError, ErrorKind, Result, DATABASE_FILENAME,
};
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{self, BufReader, Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const FORMAT: &str = "knowpaper-backup";
const VERSION: u32 = 1;
const MANIFEST: &str = "manifest.json";
const LEGACY: &str = "questions.json";
const MAX_MANIFEST: u64 = 64 * 1024 * 1024;
const MAX_FILES: usize = 250_000;
const MAX_LEGACY: u64 = 32 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BackupMember {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BackupManifest {
    pub format: String,
    pub version: u32,
    pub schema_version: i32,
    pub app_version: String,
    pub created_at: String,
    pub platform: String,
    pub database_sha256: String,
    pub file_count: usize,
    pub total_bytes: u64,
    pub files: Vec<BackupMember>,
}

#[derive(Debug, Serialize)]
pub struct BackupPreview {
    pub manifest: BackupManifest,
    pub questions: u64,
    pub papers: u64,
    pub knowledge: u64,
    pub favorites: u64,
}

#[derive(Debug, Serialize)]
pub struct BackupRecord {
    pub id: String,
    pub created_at: String,
    pub archive_sha256: Option<String>,
    pub file_count: u64,
    pub verified: bool,
    pub error: Option<String>,
    pub location_label: String,
}

#[derive(Debug, Serialize)]
pub struct LibraryDiagnostics {
    pub schema_version: i32,
    pub file_count: usize,
    pub issues: Vec<String>,
    pub trashed: u64,
    pub drafts: u64,
    pub latest_backup: Option<BackupRecord>,
}

pub type ProtectionProgress<'a> = dyn FnMut(&str, u64, u64) -> Result<()> + 'a;

impl Database {
    pub fn backup_history(&self) -> Result<Vec<BackupRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id,created_at,archive_sha256,file_count,verified,error,location_label
             FROM backup_record ORDER BY rowid DESC LIMIT 100",
        )?;
        let rows = statement.query_map([], |r| {
            Ok(BackupRecord {
                id: r.get(0)?,
                created_at: r.get(1)?,
                archive_sha256: r.get(2)?,
                file_count: r.get::<_, i64>(3)? as u64,
                verified: r.get(4)?,
                error: r.get(5)?,
                location_label: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn reject_interrupted_backups(&self) -> Result<()> {
        self.connection.execute(
            "UPDATE backup_record SET error='备份中断，未完成验证。'
             WHERE verified=0 AND error='备份尚未发布。'",
            [],
        )?;
        Ok(())
    }

    pub fn create_backup(
        &self,
        destination: &Path,
        id: &str,
        progress: &mut ProtectionProgress<'_>,
    ) -> Result<BackupManifest> {
        let root = self.attachment_store.base_path();
        let parent = destination
            .parent()
            .ok_or_else(|| invalid("请选择备份目录。"))?
            .canonicalize()
            .map_err(file_error)?;
        let name = destination
            .file_name()
            .ok_or_else(|| invalid("请选择备份文件名。"))?;
        let destination = parent.join(name);
        if crate::system_path::contains(root, &parent).map_err(file_error)?
            || destination.exists()
            || destination.extension().and_then(|ext| ext.to_str()) != Some("knowbackup")
        {
            return Err(invalid(
                "请选择资源库外的目录和未使用的 .knowbackup 文件名。",
            ));
        }
        let label = name.to_string_lossy();
        let schema = self.schema_version()?;
        self.connection.execute(
            "INSERT INTO backup_record(id,format_version,backup_type,schema_version,location_label,error)
             VALUES (?1,?2,'full',?3,?4,'备份尚未发布。')",
            params![id, VERSION, schema, label],
        )?;
        let result = self.write_backup(&destination, progress);
        match result {
            Ok((manifest, digest)) => {
                self.connection.execute(
                    "UPDATE backup_record SET archive_sha256=?2,file_count=?3,verified=1,error=NULL
                     WHERE id=?1",
                    params![id, digest, manifest.file_count as i64],
                )?;
                Ok(manifest)
            }
            Err(error) => {
                self.connection.execute(
                    "UPDATE backup_record SET error=?2 WHERE id=?1",
                    params![id, error.message],
                )?;
                Err(error)
            }
        }
    }

    fn write_backup(
        &self,
        destination: &Path,
        progress: &mut ProtectionProgress<'_>,
    ) -> Result<(BackupManifest, String)> {
        let parent = destination.parent().unwrap();
        let estimate = self.estimated_library_bytes()?;
        ensure_space(parent, estimate.saturating_mul(2))?;
        let work = tempfile::Builder::new()
            .prefix(".knowpaper-snapshot-")
            .tempdir_in(parent)
            .map_err(file_error)?;
        let manifest = self.stage_library(work.path(), progress)?;
        let temp = tempfile::Builder::new()
            .prefix(".knowpaper-backup-")
            .suffix(".partial")
            .tempfile_in(parent)
            .map_err(file_error)?;
        {
            let mut zip = ZipWriter::new(temp.reopen().map_err(file_error)?);
            let mut completed = 0;
            for member in &manifest.files {
                zip.start_file(
                    &member.path,
                    SimpleFileOptions::default()
                        .compression_method(CompressionMethod::Stored)
                        .large_file(member.bytes >= u32::MAX as u64),
                )
                .map_err(zip_error)?;
                let mut file = open_root_file(work.path(), &member.path).map_err(file_error)?;
                check_stream(&mut file, &mut zip, member, |count| {
                    progress("archive", completed + count, manifest.total_bytes)
                })?;
                completed += member.bytes;
            }
            zip.start_file(MANIFEST, SimpleFileOptions::default())
                .map_err(zip_error)?;
            let data = serde_json::to_vec_pretty(&manifest).map_err(json_error)?;
            if data.len() as u64 > MAX_MANIFEST {
                return Err(invalid("备份清单超过格式上限。"));
            }
            zip.write_all(&data).map_err(file_error)?;
            zip.finish()
                .map_err(zip_error)?
                .sync_all()
                .map_err(file_error)?;
        }
        let mut zip = open_archive(temp.reopen().map_err(file_error)?)?;
        let verified = read_manifest(&mut zip)?;
        read_members(&mut zip, &verified, None, progress)?;
        let (_, digest) = stream(
            &mut temp.reopen().map_err(file_error)?,
            &mut io::sink(),
            u64::MAX,
            |bytes| progress("digest", bytes, 0),
        )?;
        progress("publish", 0, 0)?;
        temp.persist_noclobber(destination)
            .map_err(|error| file_error(error.error))?;
        Ok((manifest, digest))
    }

    pub fn estimated_library_bytes(&self) -> Result<u64> {
        let mut bytes = scalar(
            &self.connection,
            "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
        )?;
        for member in inventory(&self.connection, self.schema_version()?)?.values() {
            bytes = bytes.saturating_add(member.bytes);
        }
        if let Some(file) = legacy_file(self.attachment_store.base_path())? {
            bytes = bytes.saturating_add(file.metadata().map_err(file_error)?.len());
        }
        Ok(bytes)
    }

    pub fn stage_library(
        &self,
        directory: &Path,
        progress: &mut ProtectionProgress<'_>,
    ) -> Result<BackupManifest> {
        let schema = self.schema_version()?;
        let source = self.attachment_store.base_path();
        self.online_snapshot(&directory.join(DATABASE_FILENAME), |n, total| {
            progress("snapshot", n, total)
        })?;
        let mut files = vec![describe_file(
            directory,
            DATABASE_FILENAME,
            "database",
            progress,
        )?];
        // The immutable snapshot defines what belongs to this backup, even if another
        // SQLite connection wrote rows while the online backup was running.
        let snapshot = Connection::open_with_flags(
            directory.join(DATABASE_FILENAME),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        verify_registrations(&snapshot, schema)?;
        let resources = inventory(&snapshot, schema)?;
        let total = resources.values().map(|member| member.bytes).sum();
        let mut finished = 0;
        for member in resources.into_values() {
            let mut input = open_root_file(source, &member.path)
                .map_err(|err| member_error(&member.path, err))?;
            let mut output = create_member(directory, &member.path)?;
            check_stream(&mut input, &mut output, &member, |count| {
                progress("resources", finished + count, total)
            })?;
            output.sync_all().map_err(file_error)?;
            finished += member.bytes;
            files.push(member);
        }
        if let Some(mut legacy) = legacy_file(source)? {
            let mut output = create_member(directory, LEGACY)?;
            let (bytes, sha256) = stream(&mut legacy, &mut output, MAX_LEGACY, |count| {
                progress("legacy", count, 0)
            })?;
            output.sync_all().map_err(file_error)?;
            files.push(BackupMember {
                path: LEGACY.into(),
                kind: "legacy".into(),
                bytes,
                sha256,
            });
        }
        let manifest = BackupManifest {
            format: FORMAT.into(),
            version: VERSION,
            schema_version: schema,
            app_version: env!("CARGO_PKG_VERSION").into(),
            created_at: self.connection.query_row(
                "SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')",
                [],
                |r| r.get(0),
            )?,
            platform: std::env::consts::OS.into(),
            database_sha256: files[0].sha256.clone(),
            file_count: files.len(),
            total_bytes: files.iter().map(|member| member.bytes).sum(),
            files,
        };
        validate_manifest(&manifest)?;
        Ok(manifest)
    }

    pub fn diagnostics(&self, progress: &mut ProtectionProgress<'_>) -> Result<LibraryDiagnostics> {
        let schema_version = self.schema_version()?;
        let mut issues = Vec::new();
        if let Err(error) = self.integrity_check() {
            issues.push(error.message);
        }
        let files = inventory(&self.connection, schema_version)?;
        for (index, member) in files.values().enumerate() {
            progress("verify", index as u64, files.len() as u64)?;
            if let Err(error) = check_resource(self.attachment_store.base_path(), member) {
                issues.push(error.message);
            }
        }
        let packs = scalar(
            &self.connection,
            "SELECT count(*) FROM pack_version WHERE integrity_error IS NOT NULL",
        )?;
        let operations = scalar(
            &self.connection,
            "SELECT count(*) FROM pack_operation WHERE pending_cleanup=1",
        )?;
        if packs > 0 || operations > 0 {
            issues.push(format!(
                "资源包异常版本 {packs} 个，待清理操作 {operations} 个。请在资源管理中检查。"
            ));
        }
        issues.extend(self.relationship_issues()?);
        Ok(LibraryDiagnostics {
            schema_version,
            issues,
            file_count: files.len(),
            trashed: scalar(
                &self.connection,
                "SELECT count(*) FROM trash_item WHERE restored_at IS NULL",
            )?,
            drafts: scalar(
                &self.connection,
                "SELECT count(*) FROM edit_draft WHERE state='active'",
            )?,
            latest_backup: self.backup_history()?.into_iter().next(),
        })
    }

    fn relationship_issues(&self) -> Result<Vec<String>> {
        let mut issues = Vec::new();
        let invalid_trash = scalar(&self.connection, "
            SELECT count(*) FROM trash_item t WHERE NOT (
               (t.resource_type='question' AND EXISTS(SELECT 1 FROM question WHERE id=t.target_id))
            OR (t.resource_type='knowledge' AND EXISTS(SELECT 1 FROM knowledge_point WHERE id=t.target_id))
            OR (t.resource_type='paper' AND EXISTS(SELECT 1 FROM paper WHERE id=t.target_id)))")?;
        if invalid_trash > 0 {
            issues.push(format!("有 {invalid_trash} 条回收站记录缺少原资源。"));
        }
        let drafts = self.drafts()?;
        let conflicts = drafts.iter().filter(|draft| draft.conflict).count();
        if conflicts > 0 {
            issues.push(format!("有 {conflicts} 份试题草稿需要核对基准修订。"));
        }
        let bad_packs = scalar(&self.connection, "
            SELECT count(*) FROM pack_version v JOIN pack_operation o ON o.id=v.operation_id
             WHERE o.pack_id<>v.pack_id OR o.version<>v.version OR o.archive_sha<>v.archive_sha OR o.state<>'installed'")?;
        if bad_packs > 0 {
            issues.push(format!("有 {bad_packs} 个资源包版本的安装历史不一致。"));
        }
        let stale_pins = scalar(&self.connection, "
            SELECT count(*) FROM edit_draft d, json_each(d.payload_json,'$.items') i
             WHERE d.state='active' AND d.object_type='composition'
               AND NOT EXISTS(SELECT 1 FROM question_revision r WHERE r.id=json_extract(i.value,'$.revision_id'))")?;
        if stale_pins > 0 {
            issues.push(format!("组卷草稿有 {stale_pins} 项缺少固定修订。"));
        }
        Ok(issues)
    }

    pub fn verify_library(&self) -> Result<()> {
        self.integrity_check()?;
        verify_registrations(&self.connection, self.schema_version()?)?;
        for member in inventory(&self.connection, self.schema_version()?)?.values() {
            check_resource(self.attachment_store.base_path(), member)?;
        }
        Ok(())
    }
}

fn backup_input(source: &Path) -> Result<(ZipArchive<BufReader<File>>, BackupManifest)> {
    let source = File::open(source).map_err(file_error)?;
    if !source.metadata().map_err(file_error)?.is_file() {
        return Err(invalid("请选择普通备份文件。"));
    }
    let mut zip = open_archive(source)?;
    let manifest = read_manifest(&mut zip)?;
    Ok((zip, manifest))
}

pub fn preflight_backup_space(source: &Path, directory: &Path) -> Result<()> {
    let (_, manifest) = backup_input(source)?;
    ensure_space(directory, manifest.total_bytes.saturating_add(16 * 1024 * 1024))
}

pub fn unpack_backup(
    source: &Path,
    directory: &Path,
    progress: &mut ProtectionProgress<'_>,
) -> Result<BackupPreview> {
    let (mut zip, manifest) = backup_input(source)?;
    ensure_space(
        directory,
        manifest.total_bytes.saturating_add(16 * 1024 * 1024),
    )?;
    read_members(&mut zip, &manifest, Some(directory), progress)?;
    progress("unpacked", manifest.total_bytes, manifest.total_bytes)?;
    validate_staged_library(directory, manifest, progress)
}

pub fn validate_staged_library(
    directory: &Path,
    manifest: BackupManifest,
    progress: &mut ProtectionProgress<'_>,
) -> Result<BackupPreview> {
    let path = directory.join(DATABASE_FILENAME);
    let schema = manifest.schema_version;
    let connection = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    connection.pragma_update(None, "trusted_schema", false)?;
    let mode: String = connection.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
    if mode != "delete" {
        return Err(invalid("数据库快照必须以独立回滚日志模式保存。"));
    }
    migrations::verify_snapshot_schema(&connection, schema)?;
    check_integrity(&connection, true)?;
    let registered = inventory(&connection, schema)?;
    let contained: BTreeMap<_, _> = manifest
        .files
        .iter()
        .filter(|member| matches!(member.kind.as_str(), "image" | "pdf"))
        .map(|member| (member.path.clone(), member.clone()))
        .collect();
    if contained != registered {
        return Err(invalid("备份文件清单与数据库登记的图片或 PDF 不一致。"));
    }
    drop(connection);

    // Migrate only the isolated copy, after validating schema identity and files.
    let db = Database::open(&path)?;
    db.integrity_check()?;
    verify_registrations(&db.connection, db.schema_version()?)?;
    progress("validated", manifest.total_bytes, manifest.total_bytes)?;
    Ok(BackupPreview {
        manifest,
        questions: scalar(&db.connection, "SELECT count(*) FROM logical_question")?,
        papers: scalar(&db.connection, "SELECT count(*) FROM paper")?,
        knowledge: scalar(&db.connection, "SELECT count(*) FROM knowledge_point")?,
        favorites: scalar(&db.connection, "SELECT count(*) FROM favorite_target")?,
    })
}

fn verify_registrations(connection: &Connection, schema: i32) -> Result<()> {
    if schema >= 8 && scalar(connection, "
        SELECT count(*) FROM pack_version v JOIN pack_operation o ON o.id=v.operation_id
        WHERE v.pack_id<>o.pack_id OR v.version<>o.version OR v.archive_sha<>o.archive_sha OR o.state<>'installed'
    ")? > 0 {
        return Err(invalid("资源包版本与安装操作的登记不一致。"));
    }
    if schema >= 9 && scalar(connection, "
        SELECT count(*) FROM trash_item t WHERE NOT (
            (t.resource_type='question' AND EXISTS(SELECT 1 FROM question q WHERE q.id=t.target_id))
         OR (t.resource_type='knowledge' AND EXISTS(SELECT 1 FROM knowledge_point k WHERE k.id=t.target_id))
         OR (t.resource_type='paper' AND EXISTS(SELECT 1 FROM paper p WHERE p.id=t.target_id)))
    ")? > 0 {
        return Err(invalid("回收站记录缺少原资源，请先检查资源库。"));
    }
    Ok(())
}

fn inventory(connection: &Connection, schema: i32) -> Result<BTreeMap<String, BackupMember>> {
    let queries = [
        (4, "image", "SELECT sha256,byte_size FROM attachment"),
        (6, "pdf", "SELECT sha256,byte_size FROM paper_file"),
        (
            8,
            "image",
            "SELECT sha256,byte_size FROM pack_file WHERE role='image'",
        ),
        (
            8,
            "pdf",
            "SELECT sha256,byte_size FROM pack_file WHERE role='pdf'",
        ),
    ];
    let mut result = BTreeMap::<String, BackupMember>::new();
    for (introduced, kind, sql) in queries {
        if schema < introduced {
            continue;
        }
        let mut statement = connection.prepare(sql)?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let sha256: String = row.get(0)?;
            let bytes =
                u64::try_from(row.get::<_, i64>(1)?).map_err(|_| invalid("资源大小登记无效。"))?;
            let path = blob_path(kind, &sha256).ok_or_else(|| invalid("资源登记哈希无效。"))?;
            let member = BackupMember {
                path: path.clone(),
                sha256,
                bytes,
                kind: kind.into(),
            };
            if let Some(existing) = result.insert(path, member.clone()) {
                if existing != member {
                    return Err(invalid("同一资源的大小登记不一致。"));
                }
            }
            if result.len() >= MAX_FILES {
                return Err(invalid("资源文件数量超过备份格式上限。"));
            }
        }
    }
    Ok(result)
}

pub(super) fn check_related_files(
    connection: &Connection,
    root: &Path,
    id: &str,
    paper: bool,
) -> Result<()> {
    let (kind, sql) = if paper {
        (
            "pdf",
            "SELECT DISTINCT sha256,byte_size FROM paper_file WHERE paper_id=?1",
        )
    } else {
        ("image", "SELECT DISTINCT a.sha256,a.byte_size FROM attachment a
            JOIN revision_attachment ar USING(attachment_id) JOIN question_revision r ON r.id=ar.revision_id
            JOIN question_members m ON m.original_id=r.question_id WHERE m.logical_id=?1")
    };
    let mut statement = connection.prepare(sql)?;
    let mut rows = statement.query([id])?;
    while let Some(row) = rows.next()? {
        let sha256: String = row.get(0)?;
        let bytes = row.get::<_, i64>(1)? as u64;
        let path = blob_path(kind, &sha256).ok_or_else(|| invalid("登记的资源哈希无效。"))?;
        check_resource(
            root,
            &BackupMember {
                path,
                sha256,
                bytes,
                kind: kind.into(),
            },
        )?;
    }
    Ok(())
}

fn check_resource(root: &Path, member: &BackupMember) -> Result<()> {
    let mut input =
        open_root_file(root, &member.path).map_err(|e| member_error(&member.path, e))?;
    check_stream(&mut input, &mut io::sink(), member, |_| Ok(()))
}

fn open_root_file(root: &Path, path: &str) -> io::Result<cap_std::fs::File> {
    let store = AttachmentStore::for_database(&root.join(DATABASE_FILENAME));
    let mut segments = path.split('/');
    let first = segments.next().unwrap_or_default();
    if let Some(shard) = segments.next() {
        let hash = segments.next().unwrap_or_default();
        debug_assert_eq!(shard, &hash[..2]);
        open_regular(&store.resource_shard(first, hash, false)?, Path::new(hash))
    } else {
        open_regular(&store.data_dir()?, Path::new(first))
    }
}

fn legacy_file(root: &Path) -> Result<Option<cap_std::fs::File>> {
    match open_root_file(root, LEGACY) {
        Ok(file) => Ok(Some(file)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(member_error(LEGACY, error)),
    }
}

fn create_member(directory: &Path, name: &str) -> Result<File> {
    let path = directory.join(name);
    fs::create_dir_all(path.parent().unwrap()).map_err(file_error)?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(file_error)
}

fn describe_file(
    root: &Path,
    name: &str,
    kind: &str,
    progress: &mut ProtectionProgress<'_>,
) -> Result<BackupMember> {
    let mut file = open_root_file(root, name).map_err(file_error)?;
    let (bytes, sha256) = stream(&mut file, &mut io::sink(), u64::MAX, |count| {
        progress("hash", count, 0)
    })?;
    Ok(BackupMember {
        path: name.into(),
        kind: kind.into(),
        bytes,
        sha256,
    })
}

fn open_archive(file: File) -> Result<ZipArchive<BufReader<File>>> {
    let archive = ZipArchive::new(BufReader::new(file)).map_err(zip_error)?;
    if archive.len() > MAX_FILES + 1 || archive.offset() != 0 || archive.has_duplicate_names() {
        return Err(invalid("备份 ZIP 清单过大、含重复文件或容器偏移无效。"));
    }
    Ok(archive)
}

fn read_manifest(zip: &mut ZipArchive<BufReader<File>>) -> Result<BackupManifest> {
    let member = zip.by_name(MANIFEST).map_err(zip_error)?;
    if member.size() > MAX_MANIFEST || member.is_symlink() || member.is_dir() {
        return Err(invalid("备份清单类型或大小无效。"));
    }
    let mut bytes = Vec::new();
    member
        .take(MAX_MANIFEST + 1)
        .read_to_end(&mut bytes)
        .map_err(file_error)?;
    if bytes.len() as u64 > MAX_MANIFEST {
        return Err(invalid("备份清单过大。"));
    }
    let manifest = serde_json::from_slice(&bytes).map_err(json_error)?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &BackupManifest) -> Result<()> {
    if manifest.format != FORMAT
        || manifest.version != VERSION
        || !(1..=migrations::MIGRATIONS.len() as i32).contains(&manifest.schema_version)
    {
        return Err(invalid(
            "不支持此备份格式或 Schema 版本。请使用兼容的知卷版本。",
        ));
    }
    let mut total = 0u64;
    let mut paths = BTreeSet::new();
    for member in &manifest.files {
        let valid = match member.kind.as_str() {
            "database" => {
                member.path == DATABASE_FILENAME
                    && member.sha256 == manifest.database_sha256
                    && member.bytes > 0
            }
            "legacy" => member.path == LEGACY && member.bytes <= MAX_LEGACY,
            kind => {
                blob_path(kind, &member.sha256).as_deref() == Some(member.path.as_str())
                    && member.bytes > 0
            }
        };
        if !valid || !valid_hash(&member.sha256) || !paths.insert(member.path.as_str()) {
            return Err(invalid("备份清单含非法、重复或不一致的文件路径。"));
        }
        total = total
            .checked_add(member.bytes)
            .ok_or_else(|| invalid("备份体积溢出。"))?;
    }
    if !paths.contains(DATABASE_FILENAME)
        || manifest.file_count != paths.len()
        || manifest.file_count > MAX_FILES
        || manifest.total_bytes != total
    {
        return Err(invalid("备份清单的数量、总体积或数据库成员不一致。"));
    }
    Ok(())
}

fn read_members(
    zip: &mut ZipArchive<BufReader<File>>,
    manifest: &BackupManifest,
    target: Option<&Path>,
    progress: &mut ProtectionProgress<'_>,
) -> Result<()> {
    if zip.len() != manifest.file_count + 1 {
        return Err(invalid("ZIP 中存在遗漏或额外文件。"));
    }
    let mut completed = 0;
    for member in &manifest.files {
        let mut entry = zip.by_name(&member.path).map_err(zip_error)?;
        if entry.name_raw() != member.path.as_bytes()
            || entry.is_symlink()
            || entry.is_dir()
            || entry.external_attributes() & 0x410 != 0
            || entry.size() != member.bytes
            || entry
                .unix_mode()
                .is_some_and(|mode| !matches!(mode & 0o170000, 0 | 0o100000))
        {
            return Err(invalid("ZIP 文件类型、名称或大小与清单不一致。"));
        }
        let phase = if target.is_some() { "unpack" } else { "verify" };
        let callback = |count| progress(phase, completed + count, manifest.total_bytes);
        if let Some(target) = target {
            let mut file = create_member(target, &member.path)?;
            check_stream(&mut entry, &mut file, member, callback)?;
            file.sync_all().map_err(file_error)?;
        } else {
            check_stream(&mut entry, &mut io::sink(), member, callback)?;
        }
        completed += member.bytes;
    }
    Ok(())
}

fn check_stream(
    input: &mut impl Read,
    output: &mut impl Write,
    member: &BackupMember,
    progress: impl FnMut(u64) -> Result<()>,
) -> Result<()> {
    let (len, sha256) = stream(input, output, member.bytes, progress)?;
    if len != member.bytes || sha256 != member.sha256 {
        return Err(DbError::new(
            ErrorKind::Integrity,
            format!(
                "{} 大小或 SHA-256 不一致，请修复资源或更换备份。",
                member.path
            ),
        ));
    }
    Ok(())
}

fn stream(
    input: &mut impl Read,
    output: &mut impl Write,
    limit: u64,
    mut progress: impl FnMut(u64) -> Result<()>,
) -> Result<(u64, String)> {
    let mut hash = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = vec![0; 256 * 1024];
    loop {
        progress(bytes)?;
        let count = input.read(&mut buffer).map_err(file_error)?;
        if count == 0 {
            break;
        }
        bytes = bytes
            .checked_add(count as u64)
            .filter(|bytes| *bytes <= limit)
            .ok_or_else(|| invalid("文件体积超过登记大小。"))?;
        output.write_all(&buffer[..count]).map_err(file_error)?;
        hash.update(&buffer[..count]);
    }
    Ok((
        bytes,
        hash.finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    ))
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn blob_path(kind: &str, hash: &str) -> Option<String> {
    let folder = match kind {
        "image" => "attachments",
        "pdf" => "paper-pdfs",
        _ => return None,
    };
    valid_hash(hash).then(|| format!("{folder}/{}/{hash}", &hash[..2]))
}

pub fn ensure_space(path: &Path, required: u64) -> Result<()> {
    let available = fs2::available_space(path).map_err(file_error)?;
    if available < required {
        return Err(DbError::new(
            ErrorKind::FileAccess,
            format!("可用磁盘空间不足。需要约 {required} 字节，剩余 {available} 字节。"),
        ));
    }
    Ok(())
}

fn scalar(connection: &Connection, sql: &str) -> Result<u64> {
    Ok(connection.query_row(sql, [], |row| row.get::<_, i64>(0))? as u64)
}

fn member_error(path: &str, error: io::Error) -> DbError {
    DbError::new(
        ErrorKind::FileAccess,
        format!(
            "无法读取已登记文件 {path}。请检查文件是否缺失或受限。{}",
            error.kind()
        ),
    )
}

fn invalid(message: &str) -> DbError {
    DbError::new(ErrorKind::InvalidContent, message)
}

fn json_error(error: serde_json::Error) -> DbError {
    DbError::new(
        ErrorKind::InvalidContent,
        format!("无法读取或写入备份清单。{error}"),
    )
}

fn zip_error(error: zip::result::ZipError) -> DbError {
    DbError::new(
        ErrorKind::InvalidContent,
        format!("备份 ZIP 读取或写入失败。{error}"),
    )
}
