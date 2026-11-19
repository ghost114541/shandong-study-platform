use std::{
    fs::{self, Metadata},
    io,
    path::{Component, Path, PathBuf},
};

pub const OWNER_MARKER: &str = ".knowpaper-library-owner";

pub fn is_alias(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Includes junctions and other reparse points even when is_symlink is false.
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub fn check_components(path: &Path) -> io::Result<()> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "需要无相对片段的绝对路径。",
        ));
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if is_alias(&meta) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "资源库路径含符号链接、挂接点或其他重解析点。",
                ));
            }
            Ok(_) => (),
            Err(error) if error.kind() == io::ErrorKind::NotFound => (),
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

pub fn directory(path: &Path) -> io::Result<PathBuf> {
    check_components(path)?;
    if !fs::metadata(path)?.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "资源库位置必须是目录。",
        ));
    }
    let resolved = path.canonicalize()?;
    check_components(&resolved)?;
    Ok(resolved)
}

pub fn check_tree(root: &Path) -> io::Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let meta = fs::symlink_metadata(entry.path())?;
        if is_alias(&meta) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "旧库内含符号链接或挂接点，必须保留。",
            ));
        }
        if meta.is_dir() {
            check_tree(&entry.path())?;
        }
    }
    Ok(())
}

pub fn regular_if_present(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if !is_alias(&meta) && meta.is_file() => Ok(()),
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "资源库控制文件或数据库路径不是普通文件。",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

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

pub fn overlaps(a: &Path, b: &Path) -> io::Result<bool> {
    Ok(contains(a, b)? || contains(b, a)?)
}
