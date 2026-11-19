use crate::library_paths as paths;
use serde::{Deserialize, Serialize};
use shandong_poc_001b::db::{Database, DATABASE_FILENAME};
use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Precheck,
    Staging,
    Verified,
    Pending,
    Switched,
    Complete,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Journal {
    version: u8,
    active: PathBuf,
    previous: Option<PathBuf>,
    candidate: Option<PathBuf>,
    phase: Phase,
    error: Option<String>,
    // Extra fields are optional so DEV-010 journals remain readable.
    #[serde(default)]
    candidate_parent: Option<PathBuf>,
    #[serde(default)]
    retained: Vec<PathBuf>,
    #[serde(default)]
    managed: Vec<PathBuf>,
}

pub struct LibraryRoot {
    profile: PathBuf,
    control: PathBuf,
    journal: Journal,
    _profile_lock: File,
}

impl LibraryRoot {
    pub fn lock(default: &Path) -> Result<Self, String> {
        fs::create_dir_all(default).map_err(io_error)?;
        // The OS-provided profile can be redirected. Pin its final location before
        // constructing control and managed paths and never follow links below it.
        let profile = default.canonicalize().map_err(io_error)?;
        let control = profile.join("data-protection");
        paths::check_components(&control).map_err(io_error)?;
        fs::create_dir_all(&control).map_err(io_error)?;
        let control = paths::directory(&control).map_err(io_error)?;
        let lock_path = control.join("profile.lock");
        paths::regular_if_present(&lock_path).map_err(io_error)?;
        let lock = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)
            .map_err(io_error)?;
        fs2::FileExt::try_lock_exclusive(&lock)
            .map_err(|_| "此知卷配置已在另一个进程中打开。".to_owned())?;
        let journal_path = control.join("root.json");
        paths::regular_if_present(&journal_path).map_err(io_error)?;
        let journal = match fs::read(journal_path) {
            Ok(bytes) => serde_json::from_slice::<Journal>(&bytes)
                .map_err(|_| "资源库切换记录无法读取，请保留数据目录并执行检查。".to_owned())?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Journal {
                version: 1,
                active: profile.clone(),
                previous: None,
                candidate: None,
                phase: Phase::Complete,
                error: None,
                candidate_parent: None,
                retained: Vec::new(),
                managed: Vec::new(),
            },
            Err(error) => return Err(io_error(error)),
        };
        let root = Self {
            profile,
            control,
            journal,
            _profile_lock: lock,
        };
        if root.journal.version != 1
            || root.recorded_paths().any(|path| !path.is_absolute())
            || root
                .journal
                .candidate
                .iter()
                .chain(root.journal.candidate_parent.iter())
                .chain(root.journal.managed.iter())
                .any(|path| !path.is_absolute())
        {
            return Err("资源库切换记录无效。".into());
        }
        Ok(root)
    }

    pub fn open_database(
        &mut self,
        verify: impl FnOnce(&Database) -> Result<(), String>,
        checkpoint: impl Fn(&str),
    ) -> Result<Database, String> {
        if self.phase() == Phase::Pending {
            checkpoint("before-open");
            let switch = (|| {
                let candidate = self.checked_pending()?;
                let identity = same_file::Handle::from_path(&candidate).map_err(io_error)?;
                let db = open_existing(&candidate)?;
                checkpoint("first-open");
                verify(&db)?;
                checkpoint("startup-verified");
                // Recheck after hashing: the same verified directory must still be eligible.
                let rechecked = self.checked_pending()?;
                if identity != same_file::Handle::from_path(rechecked).map_err(io_error)? {
                    return Err("候选目录在校验期间被更换。".into());
                }
                checkpoint("before-pointer");
                let mut next = self.journal.clone();
                if let Some(previous) = next.previous.take() {
                    if previous != candidate && !next.retained.contains(&previous) {
                        next.retained.push(previous);
                    }
                }
                next.retained.retain(|path| path != &candidate);
                next.previous = Some(next.active.clone());
                next.active = candidate.clone();
                if next.candidate_parent.is_some() && !next.managed.contains(&candidate) {
                    next.managed.push(candidate);
                }
                next.candidate = None;
                next.candidate_parent = None;
                next.phase = Phase::Switched;
                next.error = None;
                self.persist(next)?;
                Ok::<_, String>(db)
            })();
            match switch {
                Ok(db) => {
                    checkpoint("after-pointer");
                    self.finalize(Phase::Complete, None);
                    return Ok(db);
                }
                Err(error) => self.finalize(
                    Phase::Failed,
                    Some(format!("切换失败，继续打开原资源库。{error}")),
                ),
            }
        }
        let database = if self.control.join("root.json").exists() {
            open_existing(self.active())?
        } else {
            check_database_paths(self.active())?;
            Database::open(&self.active().join(DATABASE_FILENAME))
                .map_err(|error| error.to_string())?
        };
        match self.phase() {
            Phase::Precheck | Phase::Staging | Phase::Verified => self.finalize(
                Phase::Failed,
                Some("数据操作在切换前中断。已打开原资源库。".into()),
            ),
            Phase::Switched => self.finalize(Phase::Complete, None),
            _ => (),
        }
        Ok(database)
    }

    fn finalize(&mut self, phase: Phase, error: Option<String>) {
        if let Err(write_error) = self.update(phase, error.clone()) {
            // A failed journal write must not prevent reading the last committed library.
            self.journal.error = Some(format!(
                "{}切换日志未能写入，请检查权限或空间后重试。{write_error}",
                error.as_deref().unwrap_or_default()
            ));
        }
    }

    pub fn active(&self) -> &Path {
        &self.journal.active
    }
    pub fn control(&self) -> &Path {
        &self.control
    }
    pub fn previous(&self) -> Option<&Path> {
        self.journal.previous.as_deref()
    }
    pub fn phase(&self) -> Phase {
        self.journal.phase
    }
    pub fn error(&self) -> Option<&str> {
        self.journal.error.as_deref()
    }

    pub fn needs_layout_repair(&self) -> Result<bool, String> {
        if paths::contains(&self.control, self.active()).map_err(io_error)?
            || (paths::contains(self.active(), &self.control).map_err(io_error)?
                && !paths::same(self.active(), &self.profile).map_err(io_error)?)
        {
            return Ok(true);
        }
        self.previous()
            .map(|path| paths::overlaps(path, self.active()).map_err(io_error))
            .transpose()
            .map(|overlap| overlap.unwrap_or(false))
    }

    fn recorded_paths(&self) -> impl Iterator<Item = &Path> {
        std::iter::once(self.active())
            .chain(self.previous())
            .chain(self.journal.retained.iter().map(PathBuf::as_path))
    }

    pub fn managed_parent(&self) -> Result<PathBuf, String> {
        let name = self.profile.file_name().ok_or("应用配置目录缺少名称。")?;
        let mut sibling = name.to_os_string();
        sibling.push(".knowpaper-libraries");
        let parent = self.profile.with_file_name(sibling);
        paths::check_components(&parent).map_err(io_error)?;
        for root in self.recorded_paths().chain([self.control()]) {
            if paths::contains(root, &parent).map_err(io_error)? {
                return Err("受控目录位于已登记的资源库或配置目录内。请保留原库。".into());
            }
        }
        create_directory(&parent)
    }

    pub fn migration_parent(&self, requested: &Path) -> Result<PathBuf, String> {
        let parent = paths::directory(requested).map_err(io_error)?;
        for root in self
            .recorded_paths()
            .chain([self.control(), self.profile.as_path()])
        {
            if paths::overlaps(root, &parent).map_err(io_error)? {
                return Err("请选择与现有资源库和控制目录完全独立的目标文件夹。".into());
            }
        }
        if parent
            .join(DATABASE_FILENAME)
            .try_exists()
            .map_err(io_error)?
        {
            return Err("所选目录已经包含一份知卷资源库。".into());
        }
        Ok(parent)
    }

    pub fn create_stage(&mut self, parent: &Path) -> Result<PathBuf, String> {
        self.allow_begin()?;
        let parent = paths::directory(parent).map_err(io_error)?;
        for root in self
            .recorded_paths()
            .chain([self.control(), self.profile.as_path()])
            .chain(self.journal.candidate.as_deref())
        {
            if paths::contains(root, &parent).map_err(io_error)? {
                return Err("不能在已登记的库、候选库或控制目录内创建候选库。".into());
            }
        }
        let stage = tempfile::Builder::new()
            .prefix("KnowPaper-library-")
            .tempdir_in(&parent)
            .map_err(io_error)?;
        // Keep owned candidates without recursive automatic cleanup. A damaged,
        // abandoned or externally replaced path must never become a deletion target.
        let stage = stage.keep();
        let candidate = self.check_new_candidate(&stage, Some(&parent))?;
        if fs::read_dir(&candidate).map_err(io_error)?.next().is_some() {
            return Err("候选目录已有内容。".into());
        }
        let mut marker = File::options()
            .write(true)
            .create_new(true)
            .open(candidate.join(paths::OWNER_MARKER))
            .map_err(io_error)?;
        marker
            .write_all(self.owner_marker(&candidate)?.as_bytes())
            .map_err(io_error)?;
        marker.sync_all().map_err(io_error)?;
        let mut next = self.journal.clone();
        next.candidate = Some(candidate.clone());
        next.candidate_parent = Some(parent);
        next.phase = Phase::Precheck;
        next.error = None;
        self.persist(next)?;
        Ok(candidate)
    }

    fn owner_marker(&self, candidate: &Path) -> Result<String, String> {
        let name = candidate
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| name.starts_with("KnowPaper-library-"))
            .ok_or("未识别的知卷受控库名称。")?;
        Ok(format!(
            "KnowPaper library root 1\n{}\n{name}",
            self.profile.display()
        ))
    }

    fn check_owner(&self, candidate: &Path) -> Result<(), String> {
        let marker = candidate.join(paths::OWNER_MARKER);
        paths::regular_if_present(&marker).map_err(io_error)?;
        let expected = self.owner_marker(candidate)?;
        if fs::metadata(&marker).map_err(io_error)?.len() != expected.len() as u64
            || fs::read_to_string(marker).map_err(io_error)? != expected
        {
            return Err("候选库或旧库的知卷归属标记不匹配。".into());
        }
        Ok(())
    }

    fn check_new_candidate(
        &self,
        candidate: &Path,
        parent: Option<&Path>,
    ) -> Result<PathBuf, String> {
        let candidate = paths::directory(candidate).map_err(io_error)?;
        if let Some(parent) = parent {
            let parent = paths::directory(parent).map_err(io_error)?;
            if candidate.parent().is_none_or(|current| current != parent) {
                return Err("候选库逃逸了登记的管理目录。".into());
            }
        }
        for root in self
            .recorded_paths()
            .chain([self.control(), self.profile.as_path()])
        {
            if paths::overlaps(root, &candidate).map_err(io_error)? {
                return Err("候选库与现有资源库或控制目录相同、包含或嵌套。".into());
            }
        }
        Ok(candidate)
    }

    fn checked_pending(&self) -> Result<PathBuf, String> {
        let candidate = self
            .journal
            .candidate
            .as_deref()
            .ok_or("缺少待切换资源库。")?;
        if self.journal.candidate_parent.is_none()
            && self.previous().is_some_and(|old| old == candidate)
        {
            return self.check_rollback();
        }
        let checked =
            self.check_new_candidate(candidate, self.journal.candidate_parent.as_deref())?;
        if self.journal.candidate_parent.is_some() {
            self.check_owner(&checked)?;
        }
        Ok(checked)
    }

    fn check_rollback(&self) -> Result<PathBuf, String> {
        let previous = self.previous().ok_or("当前没有可回退的资源库。")?;
        let previous = paths::directory(previous).map_err(io_error)?;
        if paths::overlaps(self.active(), &previous).map_err(io_error)? {
            return Err("旧库与活动库存在嵌套。请先在数据管理执行安全布局修复。".into());
        }
        // A recorded historical library can be the profile itself or the old
        // DEV-010 child under control. Keep all such paths protected from deletion.
        let historical = paths::same(&previous, &self.profile).map_err(io_error)?
            || (previous.parent() == Some(self.control())
                && previous
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("restored-library-")));
        if !historical && paths::overlaps(&previous, self.control()).map_err(io_error)? {
            return Err("回退目录与控制目录冲突。".into());
        }
        if self.journal.managed.contains(&previous) {
            self.check_owner(&previous)?;
        }
        Ok(previous)
    }

    pub fn prepare_rollback(&mut self) -> Result<(), String> {
        self.allow_begin()?;
        self.check_rollback()?;
        let mut next = self.journal.clone();
        next.candidate = next.previous.clone();
        next.candidate_parent = None;
        next.phase = Phase::Precheck;
        next.error = None;
        self.persist(next)
    }

    pub fn queue_switch(&mut self) -> Result<(), String> {
        self.checked_pending()?;
        self.update(Phase::Pending, None)
    }

    pub fn check_cleanup(&self, requested: &Path) -> Result<(), String> {
        let directory = paths::directory(requested).map_err(io_error)?;
        if paths::overlaps(&directory, &self.profile).map_err(io_error)?
            || paths::overlaps(&directory, &self.control).map_err(io_error)?
        {
            return Err("此目录与配置或控制日志重叠，必须保留。".into());
        }
        for protected in std::iter::once(self.active())
            .chain(self.previous())
            .chain(self.journal.candidate.as_deref())
        {
            if paths::overlaps(&directory, protected).map_err(io_error)? {
                return Err("此目录与活动库、回退库或恢复候选库重叠，必须保留。".into());
            }
        }
        for other in self
            .recorded_paths()
            .chain(self.journal.managed.iter().map(PathBuf::as_path))
        {
            if !paths::same(&directory, other).map_err(io_error)?
                && paths::overlaps(&directory, other).map_err(io_error)?
            {
                return Err("此目录包含其他登记库或位于其中，必须保留。".into());
            }
        }
        if !self.journal.managed.iter().any(|root| root == &directory) {
            return Err("此目录不在知卷的受控资源库登记中，必须保留。".into());
        }
        self.check_owner(&directory)?;
        paths::check_tree(&directory).map_err(io_error)
    }

    fn allow_begin(&self) -> Result<(), String> {
        if self.phase() == Phase::Pending {
            return Err("已有待生效的资源库切换，请重启后继续。".into());
        }
        Ok(())
    }

    pub fn update(&mut self, phase: Phase, error: Option<String>) -> Result<(), String> {
        let mut next = self.journal.clone();
        next.phase = phase;
        next.error = error;
        if phase == Phase::Complete {
            next.candidate = None;
            next.candidate_parent = None;
        }
        self.persist(next)
    }

    fn persist(&mut self, next: Journal) -> Result<(), String> {
        paths::directory(&self.control).map_err(io_error)?;
        let journal = self.control.join("root.json");
        paths::regular_if_present(&journal).map_err(io_error)?;
        let bytes = serde_json::to_vec(&next).map_err(|error| error.to_string())?;
        crate::storage::save_atomic(&journal, &bytes).map_err(io_error)?;
        self.journal = next;
        Ok(())
    }
}

fn create_directory(path: &Path) -> Result<PathBuf, String> {
    match fs::create_dir(path) {
        Ok(()) => (),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(io_error(error)),
    }
    paths::directory(path).map_err(io_error)
}

fn check_database_paths(root: &Path) -> Result<(), String> {
    paths::directory(root).map_err(io_error)?;
    for file in [
        DATABASE_FILENAME,
        "study.sqlite3-wal",
        "study.sqlite3-shm",
        "study.sqlite3-journal",
    ] {
        paths::regular_if_present(&root.join(file)).map_err(io_error)?;
    }
    Ok(())
}

fn open_existing(root: &Path) -> Result<Database, String> {
    check_database_paths(root)?;
    let path = root.join(DATABASE_FILENAME);
    {
        let existing = rusqlite::Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|error| format!("无法读取已登记的数据库。{error}"))?;
        let schema: i32 = existing
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if schema < 1 {
            return Err("已登记的资源库数据库为空或缺少迁移版本。".into());
        }
    }
    Database::open(&path).map_err(|error| error.to_string())
}

fn io_error(error: io::Error) -> String {
    format!("资源库路径或文件访问失败。{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::{Command, Stdio},
        time::{Duration, Instant},
    };

    const CHILD: &str = "library_root::tests::dev010_switch_child";

    impl LibraryRoot {
        fn register_test_candidate(&mut self, path: &Path) -> Result<(), String> {
            let mut next = self.journal.clone();
            next.candidate = Some(path.canonicalize().map_err(io_error)?);
            next.phase = Phase::Precheck;
            self.persist(next)
        }
    }

    #[test]
    fn dev010_switch_child() {
        let Some(path) = std::env::var_os("KNOWPAPER_SWITCH_TEST_ROOT") else {
            return;
        };
        let path = PathBuf::from(path);
        let point = std::env::var("KNOWPAPER_SWITCH_TEST_POINT").unwrap();
        let mut root = LibraryRoot::lock(&path).unwrap();
        root.open_database(
            |db| db.integrity_check().map_err(|e| e.to_string()),
            |phase| {
                if phase == point {
                    fs::write(path.join("child-ready"), phase).unwrap();
                    loop {
                        std::thread::park()
                    }
                }
            },
        )
        .unwrap();
    }

    #[test]
    fn dev010_t13_kill_process_before_and_after_atomic_root_switch() {
        for point in ["before-open", "before-pointer", "after-pointer"] {
            let old = tempfile::tempdir().unwrap();
            let new = tempfile::tempdir().unwrap();
            {
                let mut root = LibraryRoot::lock(old.path()).unwrap();
                let db = root.open_database(|_| Ok(()), |_| {}).unwrap();
                db.create_question("old", "math").unwrap();
                let next = Database::open(&new.path().join(DATABASE_FILENAME)).unwrap();
                next.create_question("new", "math").unwrap();
                root.register_test_candidate(new.path()).unwrap();
                root.update(Phase::Pending, None).unwrap();
            }
            let mut child = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", CHILD, "--nocapture"])
                .env("KNOWPAPER_SWITCH_TEST_ROOT", old.path())
                .env("KNOWPAPER_SWITCH_TEST_POINT", point)
                .stdin(Stdio::null())
                .spawn()
                .unwrap();
            let start = Instant::now();
            while !old.path().join("child-ready").exists()
                && start.elapsed() < Duration::from_secs(10)
            {
                if child.try_wait().unwrap().is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            let ready = fs::read_to_string(old.path().join("child-ready"));
            let _ = child.kill();
            child.wait().unwrap();
            assert_eq!(ready.unwrap(), point);
            let mut root = LibraryRoot::lock(old.path()).unwrap();
            let database = root
                .open_database(|db| db.integrity_check().map_err(|e| e.to_string()), |_| {})
                .unwrap();
            database.integrity_check().unwrap();
            assert_eq!(root.active(), new.path().canonicalize().unwrap());
            assert_eq!(root.previous().unwrap(), old.path().canonicalize().unwrap());
            assert_eq!(root.phase(), Phase::Complete);
            Database::open(&old.path().join(DATABASE_FILENAME))
                .unwrap()
                .integrity_check()
                .unwrap();
            println!("终止 {point} 后重启成功，旧库仍可打开。");
        }
    }

    #[test]
    fn dev010_t11_failed_candidate_keeps_current_database() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        let mut root = LibraryRoot::lock(old.path()).unwrap();
        drop(root.open_database(|_| Ok(()), |_| {}).unwrap());
        root.register_test_candidate(new.path()).unwrap();
        root.update(Phase::Pending, None).unwrap();
        let db = root.open_database(|_| Ok(()), |_| {}).unwrap();
        assert_eq!(root.phase(), Phase::Failed);
        assert_eq!(root.active(), old.path().canonicalize().unwrap());
        db.integrity_check().unwrap();
        assert!(!new.path().join(DATABASE_FILENAME).exists());
    }
}

#[cfg(test)]
mod safety_tests {
    use super::*;

    fn populate(path: &Path, question: &str) {
        let database = Database::open(&path.join(DATABASE_FILENAME)).unwrap();
        database.create_question(question, "math").unwrap();
    }

    fn activate(root: &mut LibraryRoot, parent: &Path, label: &str) -> PathBuf {
        let stage = root.create_stage(parent).unwrap();
        populate(&stage, label);
        root.queue_switch().unwrap();
        root.open_database(|db| db.verify_library().map_err(|e| e.to_string()), |_| {})
            .unwrap();
        assert_eq!(root.active(), stage);
        stage
    }

    #[test]
    fn dev0101_t01_t02_t03_t09_t10_root_relations_and_cleanup() {
        let lab = tempfile::tempdir().unwrap();
        let profile = lab.path().join("Profile");
        let mut root = LibraryRoot::lock(&profile).unwrap();
        drop(root.open_database(|_| Ok(()), |_| {}).unwrap());
        assert!(root.migration_parent(lab.path()).is_err());
        assert!(root.migration_parent(&profile).is_err());
        assert!(root
            .create_stage(root.control().to_owned().as_path())
            .is_err());
        let parent = root.managed_parent().unwrap();
        let first = activate(&mut root, &parent, "first");
        assert!(!paths::overlaps(&first, &profile).unwrap());
        assert!(root.check_cleanup(&profile).is_err());
        assert!(root.check_cleanup(&parent).is_err());
        assert!(root.check_cleanup(&first).is_err());

        let second = activate(&mut root, &parent, "second");
        assert!(root.check_cleanup(&first).is_err());
        let third = activate(&mut root, &parent, "third");
        assert!(root.check_cleanup(&second).is_err());
        assert!(root.check_cleanup(&third).is_err());
        assert!(root.check_cleanup(&parent).is_err());

        let external = lab.path().join("Unmanaged");
        fs::create_dir(&external).unwrap();
        populate(&external, "unmanaged");
        assert!(root.migration_parent(&external).is_err());
        assert!(root.check_cleanup(&external).is_err());

        let staged = root.create_stage(&parent).unwrap();
        assert!(root.check_cleanup(&staged).is_err());
        root.check_cleanup(&first).unwrap();
        let journal = root.control().join("root.json");
        let previous = fs::read(&journal).unwrap();
        assert!(paths::contains(lab.path(), &first).unwrap());
        assert!(first.parent() == Some(parent.as_path()));
        fs::remove_dir_all(&first).unwrap(); // exclusively owned test fixture
        assert_eq!(fs::read(journal).unwrap(), previous);
        open_existing(&third).unwrap().integrity_check().unwrap();
        open_existing(&second).unwrap().integrity_check().unwrap();
        println!("Retired managed fixture removed after approval; active, rollback and control verified.");
    }

    #[cfg(windows)]
    #[test]
    fn dev0101_t04_case_and_real_ntfs_junction() {
        let lab = tempfile::tempdir().unwrap();
        let profile = lab.path().join("RealProfile");
        let mut root = LibraryRoot::lock(&profile).unwrap();
        drop(root.open_database(|_| Ok(()), |_| {}).unwrap());
        let uppercase = profile.with_file_name("REALPROFILE");
        assert!(paths::same(&profile, &uppercase).unwrap());
        assert!(root.migration_parent(&uppercase).is_err());

        let alias = lab.path().join("junction");
        let created = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&alias)
            .arg(&profile)
            .output()
            .unwrap();
        assert!(
            created.status.success(),
            "NTFS junction creation failed: {:?}",
            created.stderr
        );
        assert!(paths::same(&alias, &profile).unwrap());
        assert!(root.migration_parent(&alias).is_err());
        assert!(root.check_cleanup(&alias).is_err());
        let child = alias.join("data-protection");
        assert!(paths::directory(&child).is_err());
        fs::remove_dir(&alias).unwrap();
        assert!(root.control().is_dir());

        let symbolic = lab.path().join("symlink");
        match std::os::windows::fs::symlink_dir(&profile, &symbolic) {
            Ok(()) => {
                assert!(paths::same(&profile, &symbolic).unwrap());
                assert!(root.migration_parent(&symbolic).is_err());
                assert!(root.check_cleanup(&symbolic).is_err());
                fs::remove_dir(&symbolic).unwrap();
                println!("Actual directory symlink tested.");
            }
            Err(error) if error.raw_os_error() == Some(1314) => {
                println!("Directory symlink NOT TESTED: Windows privilege not held (1314).")
            }
            Err(error) => panic!("Could not make directory symlink: {error}"),
        }
        let managed = root.managed_parent().unwrap();
        let candidate = root.create_stage(&managed).unwrap();
        populate(&candidate, "staged");
        root.queue_switch().unwrap();
        let saved_candidate = candidate.with_extension("kept-fixture");
        fs::rename(&candidate, &saved_candidate).unwrap();
        let swapped = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(candidate.to_string_lossy().trim_start_matches(r"\\?\"))
            .arg(&profile)
            .output()
            .unwrap();
        assert!(swapped.status.success());
        root.open_database(|db| db.verify_library().map_err(|e| e.to_string()), |_| {})
            .unwrap();
        assert_eq!(root.active(), profile.canonicalize().unwrap());
        assert_eq!(root.phase(), Phase::Failed);
        fs::remove_dir(&candidate).unwrap();
        open_existing(&saved_candidate)
            .unwrap()
            .integrity_check()
            .unwrap();
        assert!(root.control().is_dir());
        println!("Real junction and case aliases rejected, including a pending candidate replaced by a junction.");
    }

    #[cfg(windows)]
    #[test]
    fn dev0101_control_write_failure_preserves_committed_root() {
        use std::os::windows::fs::OpenOptionsExt;
        let lab = tempfile::tempdir().unwrap();
        let profile = lab.path().join("profile");
        let mut root = LibraryRoot::lock(&profile).unwrap();
        drop(root.open_database(|_| Ok(()), |_| {}).unwrap());
        let parent = root.managed_parent().unwrap();
        let candidate = root.create_stage(&parent).unwrap();
        populate(&candidate, "candidate");
        root.queue_switch().unwrap();
        let journal = root.control().join("root.json");
        let old_bytes = fs::read(&journal).unwrap();
        let deny_replace = File::options()
            .read(true)
            .share_mode(1)
            .open(&journal)
            .unwrap();
        root.open_database(|db| db.verify_library().map_err(|e| e.to_string()), |_| {})
            .unwrap();
        assert_eq!(root.active(), profile.canonicalize().unwrap());
        assert_eq!(fs::read(&journal).unwrap(), old_bytes);
        assert!(root.error().unwrap().contains("切换日志未能写入"));
        drop(deny_replace);
        root.open_database(|db| db.verify_library().map_err(|e| e.to_string()), |_| {})
            .unwrap();
        assert_eq!(root.active(), candidate);
        println!("Win32 sharing denied pointer replacement. Original opened, then retry switched after releasing the lock.");
    }

    #[cfg(windows)]
    #[test]
    fn dev0101_candidate_creation_denied_by_ntfs_acl() {
        let lab = tempfile::tempdir().unwrap();
        let profile = lab.path().join("profile");
        let mut root = LibraryRoot::lock(&profile).unwrap();
        drop(root.open_database(|_| Ok(()), |_| {}).unwrap());
        let managed = root.managed_parent().unwrap();
        let user = std::env::var("USERNAME").unwrap();
        let deny = format!("{user}:(OI)(CI)(W)");
        assert!(std::process::Command::new("icacls.exe")
            .arg(&managed)
            .args(["/deny", &deny])
            .output()
            .unwrap()
            .status
            .success());
        let result = root.create_stage(&managed);
        assert!(std::process::Command::new("icacls.exe")
            .arg(&managed)
            .args(["/remove:d", &user])
            .output()
            .unwrap()
            .status
            .success());
        assert!(result.is_err());
        assert!(root.journal.candidate.is_none());
        open_existing(root.active())
            .unwrap()
            .integrity_check()
            .unwrap();
        println!("NTFS denied candidate creation. Original database validated.");
    }
}
