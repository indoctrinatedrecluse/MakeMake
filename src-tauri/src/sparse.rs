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
use std::path::{Component, Path, PathBuf};

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

/// How much of a torrent's payload already sits in its output folder.
///
/// This is the cheap, metadata-only half of "resume instead of restart": each declared file
/// is `stat`ed and compared with its expected length. Nothing is hashed here — librqbit does
/// the real verification (SHA-1 per piece) when the torrent is added, and only downloads the
/// pieces it cannot find.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PayloadPresence {
    /// Payload files in the current selection.
    pub files_total: usize,
    /// Files that exist on disk.
    pub files_present: usize,
    /// Files that already have their full declared length.
    pub files_complete: usize,
    /// Declared bytes of the whole selection.
    pub bytes_total: u64,
    /// Bytes that exist on disk, capped at each file's declared length.
    pub bytes_present: u64,
}

impl PayloadPresence {
    /// Every selected byte is already on disk (a verify still has to confirm the content).
    #[cfg(test)]
    pub fn is_complete(&self) -> bool {
        self.bytes_total > 0 && self.bytes_present >= self.bytes_total
    }
}

/// Stat every payload file of `files` (relative path + declared length) under `output_dir`.
///
/// Blocking: one metadata query per payload file, so callers on the async runtime should run
/// it inside [`tokio::task::spawn_blocking`] — a 20 000-file pack would otherwise stall the
/// UI polls for the duration.
pub fn measure_presence(output_dir: &Path, files: &[(PathBuf, u64)]) -> PayloadPresence {
    let mut presence = PayloadPresence::default();

    for (relative, declared) in files {
        presence.files_total += 1;
        presence.bytes_total += *declared;

        let Ok(meta) = fs::metadata(output_dir.join(relative)) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }

        presence.files_present += 1;
        if meta.len() >= *declared {
            presence.files_complete += 1;
        }
        presence.bytes_present += meta.len().min(*declared);
    }

    presence
}

/// Count the entries inside `output_dir` that are **not** part of `payload`.
///
/// A folder that already exists may hold an unrelated previous download, the user's own
/// files, or leftovers from a different release of the same torrent. The add dialog reports
/// this so "resume" is never a blind decision; resuming never touches those files. The walk
/// stops after `limit` hits so a folder with a million entries cannot stall the dialog.
pub fn count_foreign_entries(output_dir: &Path, payload: &[(PathBuf, u64)], limit: usize) -> usize {
    let known: HashSet<&Path> = payload.iter().map(|(path, _)| path.as_path()).collect();
    let mut foreign = 0usize;
    let mut pending: Vec<PathBuf> = vec![PathBuf::new()];

    while let Some(relative_dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(output_dir.join(&relative_dir)) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let relative = relative_dir.join(entry.file_name());
            if file_type.is_dir() {
                pending.push(relative);
                continue;
            }
            if !known.contains(relative.as_path()) {
                foreign += 1;
                if foreign >= limit {
                    return foreign;
                }
            }
        }
    }

    foreign
}

/// Delete this torrent's payload files so the download can start from zero.
///
/// "Start over" is the only destructive option of the existing-folder prompt, so it is kept
/// as narrow as possible:
///
/// * only the paths declared by the torrent metadata are considered — never the whole
///   folder, never a wildcard;
/// * only regular files inside `output_dir` are removed (directories, symlinks and reparse
///   points are left alone, so a hostile torrent cannot be used to delete something else);
/// * directories that end up empty are pruned, but `output_dir` itself always stays.
///
/// Returns how many files were actually removed.
pub fn wipe_payload(output_dir: &Path, files: &[(PathBuf, u64)]) -> io::Result<usize> {
    if !output_dir.is_dir() {
        return Ok(0);
    }

    let mut removed = 0usize;
    let mut touched_dirs: Vec<PathBuf> = Vec::new();

    for (relative, _length) in files {
        let target = output_dir.join(relative);
        if !is_safe_child(output_dir, &target) {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(&target) else {
            continue;
        };
        let file_type = meta.file_type();
        if !file_type.is_file() || file_type.is_symlink() {
            // A directory (or a link) on a payload path is not ours to delete.
            continue;
        }

        match fs::remove_file(&target) {
            Ok(()) => {
                removed += 1;
                if let Some(parent) = target.parent() {
                    touched_dirs.push(parent.to_path_buf());
                }
            }
            // Already gone: nothing to do.
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => return Err(err),
        }
    }

    // Deepest first, so `pack/disc1` can be pruned once its files are gone.
    touched_dirs.sort_by_key(|dir| std::cmp::Reverse(dir.components().count()));
    touched_dirs.dedup();
    for dir in touched_dirs {
        prune_empty_dirs(output_dir, dir);
    }

    Ok(removed)
}

/// Remove `dir` and its now-empty ancestors, stopping at (and never deleting) `root`.
fn prune_empty_dirs(root: &Path, dir: PathBuf) {
    let mut current = dir;
    while current != root && current.starts_with(root) {
        if fs::remove_dir(&current).is_err() {
            // Not empty (or not removable): its parents are not empty either.
            break;
        }
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => break,
        }
    }
}

/// Is `candidate` a path strictly inside `root`, with no `..` escape?
///
/// Metadata that comes from a torrent file is validated by librqbit, but this is the one
/// place where a malformed path would translate into `remove_file`, so it is checked again.
fn is_safe_child(root: &Path, candidate: &Path) -> bool {
    let Ok(relative) = candidate.strip_prefix(root) else {
        return false;
    };

    let mut depth = 0usize;
    for component in relative.components() {
        match component {
            Component::Normal(_) => depth += 1,
            // `..`, a root, a drive prefix or `.` is never a legitimate payload component.
            _ => return false,
        }
    }
    depth > 0
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

    /// The pre-flight that decides whether the add dialog has to ask about an existing
    /// folder: missing, partial and complete files must be told apart.
    #[test]
    fn presence_separates_missing_partial_and_complete_files() {
        let root = std::env::temp_dir().join(format!("makemake-presence-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&root).unwrap();

        fs::write(root.join("done.bin"), vec![1u8; 10]).unwrap();
        fs::write(root.join("half.bin"), vec![1u8; 4]).unwrap();

        let files = vec![
            (PathBuf::from("done.bin"), 10u64),
            (PathBuf::from("half.bin"), 10u64),
            (PathBuf::from("missing.bin"), 10u64),
        ];

        let presence = measure_presence(&root, &files);
        assert_eq!(presence.files_total, 3);
        assert_eq!(presence.files_present, 2);
        assert_eq!(presence.files_complete, 1);
        assert_eq!(presence.bytes_total, 30);
        // 10 from the complete file, 4 from the truncated one — never more than declared.
        assert_eq!(presence.bytes_present, 14);
        assert!(!presence.is_complete());

        // Nothing exists yet: the common case gets a zeroed answer, not an error.
        let absent = measure_presence(&root.join("nope"), &files);
        assert_eq!(absent.files_present, 0);
        assert_eq!(absent.bytes_present, 0);
        assert_eq!(absent.files_total, 3);

        fs::remove_dir_all(&root).ok();
    }

    /// A folder that already exists may hold unrelated data; that number is what the add
    /// dialog shows so "resume" is an informed decision.
    #[test]
    fn foreign_entries_exclude_the_payload() {
        let root = std::env::temp_dir().join(format!("makemake-foreign-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(root.join("pack")).unwrap();

        fs::write(root.join("pack/a.bin"), b"a").unwrap();
        fs::write(root.join("pack/readme.txt"), b"not part of the torrent").unwrap();
        fs::write(root.join("stray.bin"), b"?!" as &[u8]).unwrap();

        let payload = vec![(PathBuf::from("pack/a.bin"), 1u64)];
        assert_eq!(count_foreign_entries(&root, &payload, 100), 2);
        // The cap is honoured instead of walking everything.
        assert_eq!(count_foreign_entries(&root, &payload, 1), 1);

        fs::remove_dir_all(&root).ok();
    }

    /// "Start over" may only erase the torrent's own payload, never the rest of the folder.
    #[test]
    fn wipe_removes_only_the_torrents_own_files() {
        let root = std::env::temp_dir().join(format!("makemake-wipe-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(root.join("pack/empty")).unwrap();

        fs::write(root.join("pack/movie.mkv"), vec![7u8; 32]).unwrap();
        fs::write(root.join("pack/notes.txt"), b"keep me").unwrap();
        fs::write(root.join("stray.bin"), b"keep me too").unwrap();

        let files = vec![
            (PathBuf::from("pack/movie.mkv"), 32u64),
            (PathBuf::from("pack/empty"), 0u64),
        ];

        assert_eq!(wipe_payload(&root, &files).unwrap(), 1);
        assert!(!root.join("pack/movie.mkv").exists(), "payload must be gone");
        assert!(root.join("pack/notes.txt").is_file(), "foreign files must survive");
        assert!(root.join("stray.bin").is_file());
        assert!(root.join("pack/empty").is_dir(), "a directory is never deleted");
        assert!(root.is_dir(), "the payload folder itself always stays");

        // Idempotent: a second pass finds nothing to delete.
        assert_eq!(wipe_payload(&root, &files).unwrap(), 0);

        fs::remove_dir_all(&root).ok();
    }

    /// A hostile payload path must never turn into a delete outside the torrent's folder.
    #[test]
    fn wipe_refuses_paths_outside_the_output_folder() {
        let root = std::env::temp_dir().join(format!("makemake-wipe-escape-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        let output = root.join("torrent");
        fs::create_dir_all(&output).unwrap();

        let victim = root.join("victim.txt");
        fs::write(&victim, b"do not delete").unwrap();

        let files = vec![
            (PathBuf::from("../victim.txt"), 12u64),
            (PathBuf::from("nested/../../victim.txt"), 12u64),
        ];

        assert_eq!(wipe_payload(&output, &files).unwrap(), 0);
        assert!(victim.is_file(), "the escape attempt must be ignored");

        fs::remove_dir_all(&root).ok();
    }
}
