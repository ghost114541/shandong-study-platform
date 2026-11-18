use super::{
    attachments::{hash, AttachmentStore},
    pack_format::{invalid, valid_sha, Manifest, PackTimings, Rights, ValidatedPack},
    pack_resources::{conflict, json, PackDiff, Plan},
    pack_zip::file_error,
    Database, DbError, ErrorKind, Result,
};
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, File, OpenOptions};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use semver::Version;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    io::{self, Read, Write},
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

const STAGING: &str = "pack-staging";
const RESERVE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Serialize)]
pub struct PackPreview {
    #[serde(skip)]
    pub base_version_id: Option<i64>,
    pub manifest: Manifest,
    pub rights: Rights,
    pub archive_sha: String,
    pub archive_bytes: u64,
    pub unpacked_bytes: u64,
    pub required_bytes: u64,
    pub free_bytes: u64,
    pub already_installed: bool,
    pub conflicts: Vec<String>,
    pub diff: PackDiff,
    pub timings: PackTimings,
}

#[derive(Clone, Serialize)]
pub struct PackProgress {
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
    pub cancellable: bool,
}

#[derive(Serialize)]
pub struct InstalledPack {
    pack_id: String,
    version: String,
    display_name: String,
    source: String,
    installed_at: String,
    integrity_error: Option<String>,
    is_current: bool,
}

#[derive(Serialize)]
pub struct PackOperation {
    id: String,
    pack_id: String,
    version: String,
    state: String,
    started_at: String,
    finished_at: Option<String>,
    error: Option<String>,
    pending_cleanup: bool,
}

#[derive(Serialize)]
pub struct PackHistory {
    versions: Vec<InstalledPack>,
    operations: Vec<PackOperation>,
}

#[derive(Serialize)]
pub struct PackInstallResult {
    pub already_installed: bool,
    pub operation_id: Option<String>,
    pub timings: PackTimings,
}

struct BlobRef {
    sha: String,
    folder: String,
    bytes: u64,
}

impl Database {
    pub fn preview_pack(&self, pack: &ValidatedPack) -> Result<PackPreview> {
        let started = Instant::now();
        let base_version_id = current_pack_version(&self.connection, &pack.manifest.pack_id)?;
        let mut conflicts = Vec::new();
        let mut already_installed = false;
        let diff = match installed(&self.connection, pack) {
            Ok(true) => match verify_duplicate(&self.attachment_store, pack) {
                Ok(()) => {
                    already_installed = true;
                    PackDiff::duplicate(&pack.manifest.counts)
                }
                Err(error) => {
                    conflicts.push(error.message);
                    PackDiff {
                        conflicts: 1,
                        ..PackDiff::default()
                    }
                }
            },
            Ok(false) => match Plan::build(&self.connection, pack) {
                Ok(plan) => plan.diff,
                Err(e) if e.kind == ErrorKind::Conflict => {
                    conflicts.push(e.message);
                    PackDiff {
                        conflicts: 1,
                        ..PackDiff::default()
                    }
                }
                Err(e) => return Err(e),
            },
            Err(e) if matches!(e.kind, ErrorKind::Conflict | ErrorKind::Integrity) => {
                conflicts.push(e.message);
                PackDiff {
                    conflicts: 1,
                    ..PackDiff::default()
                }
            }
            Err(e) => return Err(e),
        };
        let required_bytes = if already_installed {
            0
        } else {
            required_space(pack)
        };
        let free_bytes =
            fs2::available_space(self.attachment_store.base_path()).map_err(file_error)?;
        Ok(PackPreview {
            base_version_id,
            manifest: pack.manifest.clone(),
            rights: pack.rights.clone(),
            archive_sha: pack.archive_sha.clone(),
            archive_bytes: pack.archive_bytes,
            unpacked_bytes: pack.unpacked_bytes,
            required_bytes,
            free_bytes,
            already_installed,
            conflicts,
            diff,
            timings: PackTimings {
                preview_ms: started.elapsed().as_millis(),
                ..pack.timings
            },
        })
    }

    pub fn install_pack(
        &mut self,
        pack: &mut ValidatedPack,
        cancelled: &AtomicBool,
        progress: impl FnMut(PackProgress),
    ) -> Result<PackInstallResult> {
        self.install_pack_confirmed(pack, None, cancelled, progress)
    }

    pub fn install_pack_confirmed(
        &mut self,
        pack: &mut ValidatedPack,
        expected_base_version: Option<Option<i64>>,
        cancelled: &AtomicBool,
        mut progress: impl FnMut(PackProgress),
    ) -> Result<PackInstallResult> {
        let _lock = lock(&self.attachment_store)?;
        let preflight = Instant::now();
        if let Some(expected) = expected_base_version {
            if current_pack_version(&self.connection, &pack.manifest.pack_id)? != expected {
                return Err(conflict("已安装版本在预览后发生变化，请重新选择并检查。"));
            }
        }
        if installed(&self.connection, pack)? {
            verify_duplicate(&self.attachment_store, pack)?;
            return Ok(PackInstallResult {
                already_installed: true,
                operation_id: None,
                timings: pack.timings,
            });
        }
        Plan::build(&self.connection, pack)?;
        if fs2::available_space(self.attachment_store.base_path()).map_err(file_error)?
            < required_space(pack)
        {
            return Err(DbError::new(
                ErrorKind::FileAccess,
                "存储空间不足，无法暂存及安装资源包。",
            ));
        }
        let mut timings = PackTimings {
            preview_ms: preflight.elapsed().as_millis(),
            ..pack.timings
        };
        let blobs: Vec<_> = pack
            .blobs
            .iter()
            .map(|(sha, blob)| BlobRef {
                sha: sha.clone(),
                folder: blob.role.folder().unwrap().into(),
                bytes: blob.bytes,
            })
            .collect();
        let op: String =
            self.connection
                .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
        {
            let tx = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            tx.execute(
                "INSERT INTO pack_operation(id,pack_id,version,archive_sha,state) VALUES (?1,?2,?3,?4,'validated')",
                params![op,pack.manifest.pack_id,pack.manifest.pack_version.to_string(),pack.archive_sha],
            )?;
            for item in &blobs {
                tx.execute(
                    "INSERT INTO pack_operation_blob VALUES (?1,?2,?3,?4)",
                    params![op, item.sha, item.folder, item.bytes as i64],
                )?;
            }
            tx.commit()?;
        }
        let store = &self.attachment_store;
        let total = blobs.len();
        let report = |callback: &mut dyn FnMut(PackProgress), phase, done, cancellable| {
            callback(PackProgress {
                phase,
                done,
                total,
                cancellable,
            });
        };
        let started = Instant::now();
        let outcome = (|| -> Result<()> {
            report(&mut progress, "staging", 0, true);
            check_cancel(cancelled)?;
            for (index, item) in blobs.iter().enumerate() {
                stage(store, &op, item, &pack.blob_bytes(&item.sha)?, || {
                    report(&mut progress, "writing", index, true);
                    check_cancel(cancelled)
                })?;
                report(&mut progress, "staging", index + 1, true);
                check_cancel(cancelled)?;
            }
            self.connection.execute(
                "UPDATE pack_operation SET state='staged' WHERE id=?1",
                [&op],
            )?;
            report(&mut progress, "staged", total, true);
            timings.stage_ms = started.elapsed().as_millis();
            // After reporting the transition, a cancellation accepted before it is
            // observed. The UI disables cancellation as soon as this phase starts.
            report(&mut progress, "committing", 0, false);
            check_cancel(cancelled)?;
            let started = Instant::now();
            self.connection.execute(
                "UPDATE pack_operation SET state='committing' WHERE id=?1",
                [&op],
            )?;
            let tx = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            if installed(&tx, pack)? {
                return Err(conflict("该资源包在确认后已安装，请重新检查。"));
            }
            let plan = Plan::build(&tx, pack)?;
            for (index, item) in blobs.iter().enumerate() {
                publish(store, &op, item)?;
                report(&mut progress, "publishing", index + 1, false);
            }
            tx.execute(
                "INSERT INTO pack_identity(id) VALUES (?1) ON CONFLICT DO NOTHING",
                [&pack.manifest.pack_id],
            )?;
            tx.execute(
                "INSERT INTO pack_version(pack_id,version,operation_id,manifest_sha,archive_sha,manifest_json,rights_json,unpacked_bytes)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![pack.manifest.pack_id,pack.manifest.pack_version.to_string(),op,pack.manifest_sha,pack.archive_sha,
                        json(&pack.manifest)?,json(&pack.rights)?,pack.unpacked_bytes as i64],
            )?;
            let version = tx.last_insert_rowid();
            for member in &pack.manifest.files {
                tx.execute(
                    "INSERT INTO pack_file VALUES (?1,?2,?3,?4,?5)",
                    params![
                        version,
                        member.path,
                        member.sha256,
                        member.bytes as i64,
                        role_name(member.role)
                    ],
                )?;
            }
            plan.apply(&tx, store, pack, version)?;
            let affected = tx.execute(
                "UPDATE pack_operation SET state='installed',finished_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='committing'", [&op])?;
            if affected != 1 {
                return Err(conflict("资源包安装操作记录已改变。"));
            }
            report(&mut progress, "before_commit", total, false);
            tx.commit()?;
            timings.commit_ms = started.elapsed().as_millis();
            report(&mut progress, "committed", total, false);
            Ok(())
        })();

        if let Err(error) = &outcome {
            // A failed commit can be ambiguous after I/O failure. Consult the
            // authoritative version row in cleanup before touching any files.
            let _ = self.connection.execute(
                "UPDATE pack_operation SET state='failed',error=?2,finished_at=CURRENT_TIMESTAMP
                 WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM pack_version WHERE operation_id=?1)",
                params![op, error.message],
            );
        }
        clean_operation(&mut self.connection, store, &op)?;
        outcome?;
        Ok(PackInstallResult {
            already_installed: false,
            operation_id: Some(op),
            timings,
        })
    }

    pub fn recover_resource_packs(&mut self) -> Result<()> {
        let _lock = lock(&self.attachment_store)?;
        let operations = {
            let mut stmt = self.connection.prepare(
                "SELECT id FROM pack_operation WHERE pending_cleanup=1 ORDER BY started_at,id",
            )?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut error = None;
        for op in operations {
            if let Err(failure) = clean_operation(&mut self.connection, &self.attachment_store, &op)
            {
                error = Some(failure);
            }
        }
        verify_installed(&mut self.connection, &self.attachment_store)?;
        error.map_or(Ok(()), Err)
    }

    pub fn resource_pack_history(&self) -> Result<PackHistory> {
        let mut stmt = self.connection.prepare(
            "SELECT v.pack_id,v.version,v.manifest_json ->> '$.display_name',v.manifest_json ->> '$.source',
                v.installed_at,v.integrity_error,v.id=(SELECT max(id) FROM pack_version WHERE pack_id=v.pack_id)
             FROM pack_version v ORDER BY v.id DESC",
        )?;
        let versions = stmt
            .query_map([], |r| {
                Ok(InstalledPack {
                    pack_id: r.get(0)?,
                    version: r.get(1)?,
                    display_name: r.get(2)?,
                    source: r.get(3)?,
                    installed_at: r.get(4)?,
                    integrity_error: r.get(5)?,
                    is_current: r.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut stmt = self.connection.prepare(
            "SELECT id,pack_id,version,state,started_at,finished_at,error,pending_cleanup
             FROM pack_operation ORDER BY started_at DESC,rowid DESC LIMIT 200",
        )?;
        let operations = stmt
            .query_map([], |r| {
                Ok(PackOperation {
                    id: r.get(0)?,
                    pack_id: r.get(1)?,
                    version: r.get(2)?,
                    state: r.get(3)?,
                    started_at: r.get(4)?,
                    finished_at: r.get(5)?,
                    error: r.get(6)?,
                    pending_cleanup: r.get(7)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(PackHistory {
            versions,
            operations,
        })
    }
}

fn installed(db: &Connection, pack: &ValidatedPack) -> Result<bool> {
    let manifest = &pack.manifest;
    let latest = db.query_row(
        "SELECT version,archive_sha,integrity_error FROM pack_version WHERE pack_id=?1 ORDER BY id DESC LIMIT 1",
        [&manifest.pack_id], |r| Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?,r.get::<_, Option<String>>(2)?)),
    ).optional()?;
    let Some((version, sha, damage)) = latest else {
        return Ok(false);
    };
    let version = Version::parse(&version)
        .map_err(|_| DbError::new(ErrorKind::Integrity, "已安装版本号无效。"))?;
    use std::cmp::Ordering::*;
    match manifest.pack_version.cmp(&version) {
        Less => Err(conflict("所选资源包版本低于当前已安装版本，无法降级。")),
        Greater => Ok(false),
        Equal if pack.archive_sha != sha => {
            Err(conflict("同一资源包版本已经安装，但所选归档的字节不同。"))
        }
        Equal if damage.is_some() => Err(DbError::new(
            ErrorKind::Integrity,
            "该版本已登记，但已安装的文件缺失或损坏。",
        )),
        Equal => Ok(true),
    }
}

fn current_pack_version(db: &Connection, pack_id: &str) -> Result<Option<i64>> {
    Ok(db.query_row(
        "SELECT max(id) FROM pack_version WHERE pack_id=?1",
        [pack_id],
        |row| row.get(0),
    )?)
}

fn verify_duplicate(store: &AttachmentStore, pack: &ValidatedPack) -> Result<()> {
    for (sha, blob) in &pack.blobs {
        let item = BlobRef {
            sha: sha.clone(),
            folder: blob.role.folder().unwrap().into(),
            bytes: blob.bytes,
        };
        verify_target(store, &item).map_err(|_| {
            DbError::new(
                ErrorKind::Integrity,
                format!("已安装的资源文件 {sha} 缺失、无法读取或校验失败。"),
            )
        })?;
    }
    Ok(())
}

fn verify_target(store: &AttachmentStore, item: &BlobRef) -> Result<()> {
    let dir = store
        .resource_shard(&item.folder, &item.sha, false)
        .map_err(file_error)?;
    verify(&mut regular(&dir, &item.sha).map_err(file_error)?, item)
}

fn required_space(pack: &ValidatedPack) -> u64 {
    // Blob publication uses hard links, so the durable stage needs one copy.
    // Reserve room for SQLite rows, search text, indices and WAL.
    pack.blobs.values().map(|b| b.bytes).sum::<u64>()
        + (pack.unpacked_bytes - pack.blobs.values().map(|b| b.bytes).sum::<u64>()) * 4
        + RESERVE_BYTES
}

fn check_cancel(cancelled: &AtomicBool) -> Result<()> {
    if cancelled.load(Ordering::Acquire) {
        return Err(invalid("安装已取消。"));
    }
    Ok(())
}

fn role_name(role: super::pack_format::Role) -> &'static str {
    use super::pack_format::Role::*;
    match role {
        Knowledge => "knowledge",
        Questions => "questions",
        Papers => "papers",
        Rights => "rights",
        Image => "image",
        Pdf => "pdf",
    }
}

fn lock(store: &AttachmentStore) -> Result<std::fs::File> {
    let dir = store.data_dir().map_err(file_error)?;
    let file = dir
        .open_with(
            "pack-install.lock",
            OpenOptions::new()
                .create(true)
                .read(true)
                .write(true)
                .follow(FollowSymlinks::No),
        )
        .map_err(file_error)?;
    if !file.metadata().map_err(file_error)?.is_file() {
        return Err(invalid("资源包写入锁文件无效。"));
    }
    let file = file.into_std();
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(std::fs::TryLockError::WouldBlock) => {
            Err(DbError::new(ErrorKind::Busy, "另一个资源包操作正在运行。"))
        }
        Err(std::fs::TryLockError::Error(error)) => Err(file_error(error)),
    }
}

fn checked_key(op: &str, sha: &str) -> Result<String> {
    if op.len() != 32
        || !op
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || !valid_sha(sha)
    {
        return Err(DbError::new(
            ErrorKind::Integrity,
            "资源包文件日志含无效标识。",
        ));
    }
    Ok(format!("{op}.{sha}"))
}

fn regular(dir: &Dir, name: &str) -> io::Result<File> {
    let file = dir.open_with(
        name,
        OpenOptions::new().read(true).follow(FollowSymlinks::No),
    )?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::other("resource is not a regular file"));
    }
    Ok(file)
}

fn verify(file: &mut File, item: &BlobRef) -> Result<()> {
    if file.metadata().map_err(file_error)?.len() != item.bytes {
        return Err(DbError::new(
            ErrorKind::Integrity,
            format!("资源文件 {} 字节数异常。", item.sha),
        ));
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0; 32 * 1024];
    let mut left = item.bytes + 1;
    while left > 0 {
        let max = left.min(buffer.len() as u64) as usize;
        let read = file.read(&mut buffer[..max]).map_err(file_error)?;
        if read == 0 {
            break;
        }
        left -= read as u64;
        hasher.update(&buffer[..read]);
    }
    let actual: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if left != 1 || actual != item.sha {
        return Err(DbError::new(
            ErrorKind::Integrity,
            format!("资源文件 {} SHA-256 不匹配。", item.sha),
        ));
    }
    Ok(())
}

fn stage(
    store: &AttachmentStore,
    op: &str,
    item: &BlobRef,
    bytes: &[u8],
    halfway: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let key = checked_key(op, &item.sha)?;
    let dir = store
        .resource_shard(STAGING, op, true)
        .map_err(file_error)?;
    if hash(bytes) != item.sha {
        return Err(invalid("待暂存文件校验失败。"));
    }
    let mut file = dir
        .open_with(
            &key,
            OpenOptions::new()
                .create_new(true)
                .write(true)
                .follow(FollowSymlinks::No),
        )
        .map_err(file_error)?;
    let (first, second) = bytes.split_at(bytes.len() / 2);
    file.write_all(first).map_err(file_error)?;
    halfway()?;
    file.write_all(second).map_err(file_error)?;
    file.sync_all().map_err(file_error)?;
    #[cfg(unix)]
    super::attachments::sync_directory(&dir).map_err(file_error)?;
    Ok(())
}

fn publish(store: &AttachmentStore, op: &str, item: &BlobRef) -> Result<()> {
    let key = checked_key(op, &item.sha)?;
    let staging = store
        .resource_shard(STAGING, op, false)
        .map_err(file_error)?;
    verify(&mut regular(&staging, &key).map_err(file_error)?, item)?;
    let target = store
        .resource_shard(&item.folder, &item.sha, true)
        .map_err(file_error)?;
    match staging.hard_link(&key, &target, &item.sha) {
        Ok(()) => {
            #[cfg(unix)]
            super::attachments::sync_directory(&target).map_err(file_error)?;
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(file_error(error)),
    }
    verify(&mut regular(&target, &item.sha).map_err(file_error)?, item)?;
    Ok(())
}

fn clean_operation(db: &mut Connection, store: &AttachmentStore, op: &str) -> Result<()> {
    let outcome = (|| -> Result<()> {
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let committed: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM pack_version WHERE operation_id=?1)",
            [op],
            |r| r.get(0),
        )?;
        let items = {
            let mut stmt = tx.prepare(
                "SELECT sha256,folder,byte_size FROM pack_operation_blob WHERE operation_id=?1",
            )?;
            let rows = stmt.query_map([op], |r| {
                Ok(BlobRef {
                    sha: r.get(0)?,
                    folder: r.get(1)?,
                    bytes: r.get::<_, u32>(2)?.into(),
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for item in items {
            clean_blob(&tx, store, op, &item, committed)?;
        }
        if committed {
            tx.execute(
                "UPDATE pack_operation SET pending_cleanup=0,state='installed',finished_at=coalesce(finished_at,CURRENT_TIMESTAMP),error=NULL WHERE id=?1",
                [op],
            )?;
        } else {
            tx.execute(
                "UPDATE pack_operation SET pending_cleanup=0,state=CASE state WHEN 'failed' THEN 'failed' ELSE 'interrupted' END,
                    finished_at=coalesce(finished_at,CURRENT_TIMESTAMP),error=coalesce(error,'安装在提交前中断，已恢复。可重新选择资源包。')
                 WHERE id=?1", [op],
            )?;
        }
        tx.commit()?;
        Ok(())
    })();
    if let Err(failure) = &outcome {
        let _ = db.execute(
            "UPDATE pack_operation SET error=?2 WHERE id=?1 AND pending_cleanup=1",
            params![op, format!("安装清理待重试。{}", failure.message)],
        );
    }
    outcome
}

fn clean_blob(
    db: &Connection,
    store: &AttachmentStore,
    op: &str,
    item: &BlobRef,
    committed: bool,
) -> Result<()> {
    let key = checked_key(op, &item.sha)?;
    let stage = match store.resource_shard(STAGING, op, false) {
        Ok(dir) => dir,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(file_error(e)),
    };
    let staged = match regular(&stage, &key) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(file_error(e)),
    };
    if committed {
        drop(staged);
        if verify_target(store, item).is_err() {
            // A valid stage file can restore a missing link. Publication never
            // replaces an existing target, even if its bytes are corrupt.
            publish(store, op, item)?;
        }
    } else {
        let query = match item.folder.as_str() {
            "attachments" => "SELECT EXISTS(SELECT 1 FROM attachment WHERE sha256=?1)",
            "paper-pdfs" => "SELECT EXISTS(SELECT 1 FROM paper_file WHERE sha256=?1)",
            _ => return Err(invalid("资源包文件日志类型无效。")),
        };
        let referenced: bool = db.query_row(query, [&item.sha], |r| r.get(0))?;
        if !referenced {
            let find = || -> io::Result<_> {
                let dir = store.resource_shard(&item.folder, &item.sha, false)?;
                let file = regular(&dir, &item.sha)?;
                Ok((dir, file))
            };
            match find() {
                Ok((target, file)) => {
                    let mine =
                        same_file::Handle::from_file(staged.into_std()).map_err(file_error)?;
                    let theirs =
                        same_file::Handle::from_file(file.into_std()).map_err(file_error)?;
                    let same = mine == theirs;
                    drop((mine, theirs));
                    if same {
                        target.remove_file(&item.sha).map_err(file_error)?;
                        #[cfg(unix)]
                        super::attachments::sync_directory(&target).map_err(file_error)?;
                    }
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => (),
                Err(e) if e.kind() == io::ErrorKind::Other => (), // Foreign non-regular target is left in place.
                Err(e) => return Err(file_error(e)),
            }
        }
    }
    stage.remove_file(&key).map_err(file_error)?;
    #[cfg(unix)]
    super::attachments::sync_directory(&stage).map_err(file_error)?;
    Ok(())
}

fn verify_installed(db: &mut Connection, store: &AttachmentStore) -> Result<()> {
    let files = {
        let mut stmt = db.prepare(
            "SELECT DISTINCT f.role,f.sha256,f.byte_size FROM pack_file f WHERE f.role IN ('image','pdf')",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(BlobRef {
                folder: if r.get::<_, String>(0)? == "image" {
                    "attachments".into()
                } else {
                    "paper-pdfs".into()
                },
                sha: r.get(1)?,
                bytes: r.get::<_, u32>(2)?.into(),
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute(
        "UPDATE pack_version SET integrity_error=NULL WHERE integrity_error IS NOT NULL",
        [],
    )?;
    for item in &files {
        if !valid_sha(&item.sha) {
            return Err(invalid("资源包文件日志含无效 SHA-256。"));
        }
        let matches = verify_target(store, item);
        if matches.is_err() {
            tx.execute(
                "UPDATE pack_version SET integrity_error=?3
                 WHERE id IN (SELECT version_id FROM pack_file WHERE role=?1 AND sha256=?2)",
                params![
                    if item.folder == "attachments" {
                        "image"
                    } else {
                        "pdf"
                    },
                    item.sha,
                    format!("资源文件 {} 缺失、无法读取或校验失败。", item.sha)
                ],
            )?;
        }
    }
    tx.commit()?;
    Ok(())
}
