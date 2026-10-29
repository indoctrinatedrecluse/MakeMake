//! Payload pre-creation.
//!
//! librqbit extends every payload file to its final size with `File::set_len` while a
//! torrent initializes. On Windows that call *reserves* the whole torrent (NTFS allocates
//! the clusters up front), unless the file is marked sparse first. librqbit 9.0.1 does try
//! to mark it sparse, but its `DeviceIoControl(FSCTL_SET_SPARSE)` call passes a NULL
//! `lpBytesReturned` together with a NULL `OVERLAPPED`; Windows rejects that combination, so
//! the sparse flag is never applied and the whole payload is allocated densely.
//!
//! Measured on a real 133 GiB / 34 073-piece torrent: adding a single 66.76 GiB file
//! consumed 66.76 GiB of free space within two seconds and left the volume nearly full
//! before a single byte was downloaded.
//!
//! MakeMake therefore pre-creates the exact payload paths itself, *empty* and marked
//! sparse, before handing the torrent to librqbit:
//!
//! * `init` sees zero-length files, so the initial hash check finishes immediately instead
//!   of reading (and hashing) gigabytes of freshly created zeros;
//! * librqbit's later `set_len` then punches a hole instead of allocating, so adding a
//!   torrent stays a metadata operation no matter how large it is;
//! * bytes are allocated only as they are actually written.
//!
//! Existing files are never truncated: only paths that are missing (or empty) are created.

use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use fs4::FileExt as _;

use crate::models::TorrentDiskUsage;

/// Summary of what pre-creation touched, for logging.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Preallocated {
    /// Files created (or re-marked) by this call.
    pub files: usize,
    /// Files that already existed and were left untouched.
    pub existing: usize,
    /// Payload paths occupied by something that is not a regular file (a directory, a
    /// reparse point…). Left alone so one odd path cannot abort the whole torrent.
    pub skipped: usize,
}

/// Create `files` (path relative to `output_dir`, plus length) as empty sparse files.
///
/// Paths that already exist are left exactly as they are, so resuming, re-checking and
/// seeding over real data never loses a byte.
///
/// This performs blocking filesystem calls — one `open`/`ioctl` per payload file, which is
/// tens of thousands of syscalls for a large pack — so callers on the async runtime should
/// run it inside [`tokio::task::spawn_blocking`].
pub fn prepare_payload(output_dir: &Path, files: &[(PathBuf, u64)]) -> io::Result<Preallocated> {
    let mut summary = Preallocated::default();
    // Files of one torrent usually share a handful of directories; creating each one once
    // keeps a 20 000-file pack from issuing 20 000 redundant `create_dir_all` calls.
    let mut prepared_dirs: HashSet<PathBuf> = HashSet::new();

    for (relative, _length) in files {
        let target = output_dir.join(relative);

        if let Ok(meta) = fs::metadata(&target) {
            if meta.is_file() {
                summary.existing += 1;
                // An empty file is a placeholder (a previous add that never started):
                // make sure it carries the sparse flag so librqbit's extension is free.
                if meta.len() == 0 {
                    let _ = mark_sparse_path(&target);
                }
                continue;
            }
            // Something that is not a regular file already occupies this path. Skip it
            // rather than failing the add: librqbit reports the affected file itself.
            summary.skipped += 1;
            continue;
        }

        if let Some(parent) = target.parent() {
            if prepared_dirs.insert(parent.to_path_buf()) {
                fs::create_dir_all(parent)?;
            }
        }

        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&target)?;
        mark_sparse(&file)?;
        summary.files += 1;
    }

    Ok(summary)
}

#[cfg(windows)]
fn mark_sparse_path(path: &Path) -> io::Result<()> {
    let file = OpenOptions::new().read(true).write(true).open(path)?;
    mark_sparse(&file)
}

#[cfg(not(windows))]
fn mark_sparse_path(_path: &Path) -> io::Result<()> {
    // ftruncate-based filesystems (ext4/xfs/btrfs/apfs) allocate holes by default.
    Ok(())
}

#[cfg(windows)]
fn mark_sparse(file: &fs::File) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;

    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::IO::DeviceIoControl;
    use windows::Win32::System::Ioctl::FSCTL_SET_SPARSE;

    // Unlike librqbit's call, `lpBytesReturned` is a real pointer: Windows requires it
    // whenever `lpOverlapped` is NULL.
    let mut returned = 0u32;
    unsafe {
        DeviceIoControl(
            HANDLE(file.as_raw_handle()),
            FSCTL_SET_SPARSE,
            None,
            0,
            None,
            0,
            Some(&mut returned),
            None,
        )
    }
    .map_err(|err| io::Error::other(format!("cannot mark file sparse: {err}")))
}

#[cfg(not(windows))]
fn mark_sparse(_file: &fs::File) -> io::Result<()> {
    Ok(())
}

/// Sum the logical and the *allocated* size of payload files that already exist on disk.
///
/// Sparse files have a logical length equal to the finished download and an allocated size
/// equal to what has actually been written, which is exactly the distinction a user wants
/// after a torrent is added: "21 GB total, 0 bytes on disk yet".
///
/// Only metadata is queried (`GetFileInformationByHandleEx` / `SEEK_HOLE`); no payload bytes
/// are read. Blocking — run it on a blocking thread when thousands of files are involved.
pub fn measure_usage(output_dir: &Path, files: &[PathBuf]) -> TorrentDiskUsage {
    let mut usage = TorrentDiskUsage::default();

    for relative in files {
        let target = output_dir.join(relative);
        // A file that does not exist yet contributes nothing.
        let Ok(meta) = fs::metadata(&target) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        usage.files += 1;
        usage.logical_bytes += meta.len();
        usage.allocated_bytes += allocated_size(&target).unwrap_or(meta.len());
    }

    usage
}

fn allocated_size(path: &Path) -> io::Result<u64> {
    let file = fs::File::open(path)?;
    file.allocated_size()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_missing_files_and_keeps_existing_data() {
        let root = std::env::temp_dir().join(format!("makemake-sparse-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&root).unwrap();

        // A file that already holds real bytes must never be touched.
        let existing = root.join("season/keep.bin");
        fs::create_dir_all(existing.parent().unwrap()).unwrap();
        fs::write(&existing, b"payload").unwrap();

        let files = vec![
            (PathBuf::from("movie.mkv"), 8u64 * 1024 * 1024 * 1024),
            (PathBuf::from("season/keep.bin"), 7u64),
            (PathBuf::from("season/new.bin"), 1024u64),
        ];

        let summary = prepare_payload(&root, &files).unwrap();
        assert_eq!(summary.files, 2, "two files should be created");
        assert_eq!(summary.existing, 1, "the existing file is left alone");

        assert!(root.join("movie.mkv").is_file());
        assert_eq!(fs::metadata(root.join("movie.mkv")).unwrap().len(), 0);
        assert_eq!(fs::metadata(root.join("season/new.bin")).unwrap().len(), 0);
        assert_eq!(fs::read(&existing).unwrap(), b"payload");

        // Idempotent: a second pass only reports the files as existing.
        let again = prepare_payload(&root, &files).unwrap();
        assert_eq!(again.files, 0);
        assert_eq!(again.existing, 3);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_directory_on_a_payload_path_is_skipped_not_fatal() {
        let root = std::env::temp_dir().join(format!("makemake-sparse-skip-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&root).unwrap();

        // A directory squatting on a payload path must not abort the whole payload: the
        // remaining files still have to be pre-created, otherwise they get allocated densely.
        fs::create_dir_all(root.join("taken")).unwrap();

        let files = vec![
            (PathBuf::from("taken"), 5u64),
            (PathBuf::from("free.bin"), 9u64),
        ];

        let summary = prepare_payload(&root, &files).unwrap();
        assert_eq!(summary.skipped, 1);
        assert_eq!(summary.files, 1);
        assert_eq!(summary.existing, 0);
        assert!(root.join("free.bin").is_file());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn measure_usage_separates_logical_from_allocated_bytes() {
        let root = std::env::temp_dir().join(format!("makemake-usage-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&root).unwrap();

        // 4 KiB of real data…
        fs::write(root.join("real.bin"), vec![7u8; 4096]).unwrap();
        // …and a 64 MiB payload placeholder that holds nothing.
        let placeholder = root.join("sparse.bin");
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .open(&placeholder)
            .unwrap();
        mark_sparse(&file).unwrap();
        file.set_len(64 * 1024 * 1024).unwrap();
        drop(file);

        let usage = measure_usage(
            &root,
            &[
                PathBuf::from("real.bin"),
                PathBuf::from("sparse.bin"),
                // Never created: contributes nothing.
                PathBuf::from("missing.bin"),
            ],
        );

        assert_eq!(usage.files, 2);
        assert_eq!(usage.logical_bytes, 4096 + 64 * 1024 * 1024);
        assert!(usage.allocated_bytes >= 4096, "real data must be counted");
        assert!(
            usage.allocated_bytes < 8 * 1024 * 1024,
            "the sparse placeholder must stay unallocated, got {}",
            usage.allocated_bytes
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn nested_directories_are_created_once_per_directory() {
        let root = std::env::temp_dir().join(format!("makemake-sparse-nested-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&root).unwrap();

        let files = vec![
            (PathBuf::from("pack/disc1/a.bin"), 1u64),
            (PathBuf::from("pack/disc1/b.bin"), 1u64),
            (PathBuf::from("pack/disc2/c.bin"), 1u64),
        ];

        let summary = prepare_payload(&root, &files).unwrap();
        assert_eq!(summary.files, 3);
        assert!(root.join("pack/disc1/a.bin").is_file());
        assert!(root.join("pack/disc2/c.bin").is_file());

        fs::remove_dir_all(&root).ok();
    }
}
