#[cfg(target_os = "macos")]
use std::{borrow::Cow, fs, os::unix::fs::MetadataExt};
use std::{io, path::Path};

pub fn same(a: &Path, b: &Path) -> io::Result<bool> {
    if a == b {
        return Ok(true);
    }
    match same_file::is_same_file(a, b) {
        Ok(value) => Ok(value),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

pub fn contains(parent: &Path, child: &Path) -> io::Result<bool> {
    for ancestor in child.ancestors() {
        if same(parent, ancestor)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Rewrite known root-owned system aliases before no-follow path traversal.
/// The caller must still validate the rewritten components.
#[cfg(target_os = "macos")]
pub fn macos_system_alias(path: &Path) -> io::Result<Cow<'_, Path>> {
    for (alias, target) in [("/var", "private/var"), ("/tmp", "private/tmp")] {
        if let Ok(tail) = path.strip_prefix(alias) {
            let metadata = fs::symlink_metadata(alias)?;
            if metadata.file_type().is_symlink()
                && metadata.uid() == 0
                && fs::read_link(alias)? == Path::new(target)
            {
                return Ok(Cow::Owned(Path::new("/").join(target).join(tail)));
            }
        }
    }
    Ok(Cow::Borrowed(path))
}
