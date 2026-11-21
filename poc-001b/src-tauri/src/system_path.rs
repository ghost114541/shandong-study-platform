use std::{
    borrow::Cow,
    fs, io,
    os::unix::fs::MetadataExt,
    path::Path,
};

/// Rewrite known root-owned system aliases before no-follow path traversal.
/// The caller must still validate the rewritten components.
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
