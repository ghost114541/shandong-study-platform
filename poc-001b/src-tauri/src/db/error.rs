use rusqlite::{Error, ErrorCode};
use serde::Serialize;
use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    Busy,
    FileAccess,
    Corrupt,
    IncompatibleDatabase,
    Migration,
    Integrity,
    Constraint,
    InvalidContent,
    UnsupportedContent,
    Missing,
    Sqlite,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DbError {
    pub kind: ErrorKind,
    pub message: String,
}

pub type Result<T> = std::result::Result<T, DbError>;

impl DbError {
    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl fmt::Display for DbError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for DbError {}

impl From<Error> for DbError {
    fn from(error: Error) -> Self {
        use ErrorCode::*;
        let kind = match error.sqlite_error_code() {
            Some(DatabaseBusy | DatabaseLocked) => ErrorKind::Busy,
            Some(ReadOnly | PermissionDenied | CannotOpen | SystemIoFailure | DiskFull) => {
                ErrorKind::FileAccess
            }
            Some(DatabaseCorrupt | NotADatabase) => ErrorKind::Corrupt,
            Some(ConstraintViolation) => ErrorKind::Constraint,
            _ if matches!(error, Error::QueryReturnedNoRows) => ErrorKind::Missing,
            _ => ErrorKind::Sqlite,
        };
        Self::new(kind, error.to_string())
    }
}
