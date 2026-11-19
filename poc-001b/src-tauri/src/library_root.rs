use serde::{Deserialize, Serialize};
use shandong_poc_001b::db::{Database, DATABASE_FILENAME};
use std::{
    fs::{self, File},
    io,
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

#[derive(Debug, Serialize, Deserialize)]
struct Journal {
    version: u8,
    active: PathBuf,
    previous: Option<PathBuf>,
    candidate: Option<PathBuf>,
    phase: Phase,
    error: Option<String>,
}

pub struct LibraryRoot {
    control: PathBuf,
    journal: Journal,
    _profile_lock: File,
}

impl LibraryRoot {
    pub fn lock(default: &Path) -> Result<Self, String> {
        fs::create_dir_all(default).map_err(io_error)?;
        let default = default.canonicalize().map_err(io_error)?;
        let control = default.join("data-protection");
        fs::create_dir_all(&control).map_err(io_error)?;
        let lock = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(control.join("profile.lock"))
            .map_err(io_error)?;
        fs2::FileExt::try_lock_exclusive(&lock)
            .map_err(|_| "此知卷配置已在另一个进程中打开。".to_owned())?;
        let journal = match fs::read(control.join("root.json")) {
            Ok(bytes) => serde_json::from_slice::<Journal>(&bytes)
                .map_err(|_| "资源库切换记录无法读取，请保留数据目录并执行检查。".to_owned())?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Journal {
                version: 1,
                active: default,
                previous: None,
                candidate: None,
                phase: Phase::Complete,
                error: None,
            },
            Err(error) => return Err(io_error(error)),
        };
        if journal.version != 1
            || !journal.active.is_absolute()
            || journal
                .previous
                .iter()
                .chain(journal.candidate.iter())
                .any(|path| !path.is_absolute())
        {
            return Err("资源库切换记录无效。".into());
        }
        Ok(Self {
            control,
            journal,
            _profile_lock: lock,
        })
    }

    pub fn open_database(
        &mut self,
        verify: impl FnOnce(&Database) -> Result<(), String>,
        checkpoint: impl Fn(&str),
    ) -> Result<Database, String> {
        if self.journal.phase == Phase::Pending {
            checkpoint("before-open");
            let candidate = self.journal.candidate.clone().ok_or("缺少待切换资源库。")?;
            let checked = open_existing(&candidate).and_then(|db| {
                checkpoint("first-open");
                verify(&db)?;
                Ok(db)
            });
            match checked {
                Ok(db) => {
                    checkpoint("before-pointer");
                    let previous = self.journal.active.clone();
                    self.journal.active = candidate;
                    self.journal.previous = Some(previous);
                    self.journal.candidate = None;
                    self.update(Phase::Switched, None)?;
                    checkpoint("after-pointer");
                    self.update(Phase::Complete, None)?;
                    return Ok(db);
                }
                Err(error) => self.update(
                    Phase::Failed,
                    Some(format!("恢复验证失败，继续打开原资源库。{error}")),
                )?,
            }
        }
        let database = if self.control.join("root.json").exists() {
            open_existing(self.active())?
        } else {
            Database::open(&self.active().join(DATABASE_FILENAME))
                .map_err(|error| error.to_string())?
        };
        match self.journal.phase {
            Phase::Precheck | Phase::Staging | Phase::Verified => {
                self.update(
                    Phase::Failed,
                    Some("数据操作在切换前中断。已打开原资源库。".into()),
                )?;
            }
            Phase::Switched => self.update(Phase::Complete, None)?,
            _ => (),
        }
        Ok(database)
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

    pub fn begin(&mut self, candidate: Option<PathBuf>) -> Result<(), String> {
        if self.phase() == Phase::Pending {
            return Err("已有待生效的资源库切换，请重启后继续。".into());
        }
        self.journal.candidate = candidate;
        self.update(Phase::Precheck, None)
    }

    pub fn update(&mut self, phase: Phase, error: Option<String>) -> Result<(), String> {
        let before = (self.journal.phase, self.journal.error.take());
        self.journal.phase = phase;
        self.journal.error = error;
        let result = serde_json::to_vec(&self.journal)
            .map_err(|error| error.to_string())
            .and_then(|bytes| {
                crate::storage::save_atomic(&self.control.join("root.json"), &bytes)
                    .map_err(io_error)
            });
        if result.is_err() {
            (self.journal.phase, self.journal.error) = before;
        }
        result
    }
}

fn open_existing(root: &Path) -> Result<Database, String> {
    let path = root.join(DATABASE_FILENAME);
    if !fs::symlink_metadata(&path).map_err(io_error)?.is_file() {
        return Err("资源库数据库缺失或路径无效。".into());
    }
    Database::open(&path).map_err(|error| error.to_string())
}

fn io_error(error: io::Error) -> String {
    format!("资源库文件访问失败。{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::{Command, Stdio},
        time::{Duration, Instant},
    };

    const CHILD: &str = "library_root::tests::dev010_switch_child";

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
                root.begin(Some(new.path().canonicalize().unwrap()))
                    .unwrap();
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
        root.begin(Some(new.path().canonicalize().unwrap()))
            .unwrap();
        root.update(Phase::Pending, None).unwrap();
        let db = root.open_database(|_| Ok(()), |_| {}).unwrap();
        assert_eq!(root.phase(), Phase::Failed);
        assert_eq!(root.active(), old.path().canonicalize().unwrap());
        db.integrity_check().unwrap();
        assert!(!new.path().join(DATABASE_FILENAME).exists());
    }
}
