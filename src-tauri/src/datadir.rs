// Where Tally's data lives, and moving it.
//
// The data folder holds the encrypted databases, backups and the app lock.
// By default it is the OS app-data folder. The user can move it (menu: Data >
// Change data folder...). The choice is remembered in location.json, which
// ALWAYS stays in the default folder - the one place that can never move,
// so it can always be found.
//
// Moving live databases is the riskiest thing this app does, so the rules are
// deliberately boring: copy, verify byte for byte, and only THEN switch;
// never delete the original; on any failure undo the copy and change nothing.

use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};

pub const LOCATION_FILE: &str = "location.json";

/// Top-level names that belong to the launcher, not the data: never copied,
/// never compared. (They live in the default folder only.)
const LAUNCHER_FILES: [&str; 2] = [LOCATION_FILE, "server.log"];

/// The folder named in location.json, else `default_dir`.
///
/// An override that can't be read or doesn't exist is an ERROR, never a quiet
/// fallback to the default: the default folder would be empty, the app would
/// start with a blank budget, and the user would think their data was gone.
pub fn resolve(default_dir: &Path) -> Result<PathBuf, String> {
    let file = default_dir.join(LOCATION_FILE);
    let raw = match fs::read_to_string(&file) {
        Ok(raw) => raw,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(default_dir.to_path_buf()),
        Err(e) => return Err(format!("Can't read {}: {e}", file.display())),
    };
    let dir = serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| v.get("dataDir").and_then(|d| d.as_str()).map(PathBuf::from))
        .ok_or_else(|| format!("{} is damaged. Delete it to use the default folder ({}); your data in the other folder is not touched.", file.display(), default_dir.display()))?;
    if !dir.is_absolute() {
        return Err(format!("{} names a folder that isn't a full path: {}", file.display(), dir.display()));
    }
    if !dir.is_dir() {
        return Err(format!(
            "Your data folder can't be found: {}\n\nReconnect the drive if it's on one. Or delete {} to use the default folder instead (your data stays where it is).",
            dir.display(),
            file.display()
        ));
    }
    Ok(dir)
}

/// Written to a temp file and renamed, so a crash never leaves a half-written
/// location.json (which would be read as "damaged" on the next start).
pub fn write_location(default_dir: &Path, data_dir: &Path) -> Result<(), String> {
    let file = default_dir.join(LOCATION_FILE);
    let tmp = default_dir.join(format!("{LOCATION_FILE}.tmp"));
    let body = serde_json::json!({ "dataDir": data_dir.to_string_lossy() }).to_string();
    fs::write(&tmp, body).and_then(|_| fs::rename(&tmp, &file)).map_err(|e| format!("Can't save the new location: {e}"))
}

/// Is `dst` a safe place to move `src` to? Must be an existing, EMPTY, writable
/// folder that isn't `src` and isn't inside it (or containing it).
pub fn validate_target(src: &Path, dst: &Path) -> Result<(), String> {
    if !dst.is_dir() {
        return Err("That isn't a folder.".into());
    }
    let (s, d) = (src.canonicalize().map_err(|e| e.to_string())?, dst.canonicalize().map_err(|e| e.to_string())?);
    if s == d {
        return Err("That is already where your data is.".into());
    }
    if d.starts_with(&s) || s.starts_with(&d) {
        return Err("Choose a folder that isn't inside your current data folder, and doesn't contain it.".into());
    }
    let empty = fs::read_dir(&d).map_err(|e| format!("Can't read that folder: {e}"))?.next().is_none();
    if !empty {
        return Err("Choose an empty folder - Tally won't mix your data into one that already has files.".into());
    }
    let probe = d.join(".tally-write-test");
    fs::write(&probe, b"x").map_err(|e| format!("Tally can't write to that folder: {e}"))?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

fn is_launcher_file(root: &Path, path: &Path) -> bool {
    path.parent() == Some(root) && path.file_name().and_then(|n| n.to_str()).is_some_and(|n| LAUNCHER_FILES.contains(&n))
}

/// Every entry under `root` (relative path, is_dir), sorted, minus launcher files.
fn list(root: &Path) -> io::Result<Vec<(PathBuf, bool)>> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, bool)>) -> io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            if is_launcher_file(root, &path) {
                continue;
            }
            let is_dir = path.is_dir();
            out.push((path.strip_prefix(root).unwrap().to_path_buf(), is_dir));
            if is_dir {
                walk(root, &path, out)?;
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(root, root, &mut out)?;
    out.sort();
    Ok(out)
}

fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    for (rel, is_dir) in list(src)? {
        if is_dir {
            fs::create_dir_all(dst.join(&rel))?;
        } else {
            // fs::copy keeps permissions (app-lock.json stays private).
            fs::copy(src.join(&rel), dst.join(&rel))?;
        }
    }
    Ok(())
}

fn read_full(r: &mut impl Read, buf: &mut [u8]) -> io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match r.read(&mut buf[n..])? {
            0 => break,
            k => n += k,
        }
    }
    Ok(n)
}

fn same_bytes(a: &Path, b: &Path) -> io::Result<bool> {
    let (mut fa, mut fb) = (fs::File::open(a)?, fs::File::open(b)?);
    if fa.metadata()?.len() != fb.metadata()?.len() {
        return Ok(false);
    }
    let (mut ba, mut bb) = (vec![0u8; 1 << 20], vec![0u8; 1 << 20]);
    loop {
        let (na, nb) = (read_full(&mut fa, &mut ba)?, read_full(&mut fb, &mut bb)?);
        if na != nb || ba[..na] != bb[..nb] {
            return Ok(false);
        }
        if na == 0 {
            return Ok(true);
        }
    }
}

/// True only if `dst` has exactly the entries `src` has, with identical bytes.
fn identical(src: &Path, dst: &Path) -> io::Result<bool> {
    let (a, b) = (list(src)?, list(dst)?);
    if a != b {
        return Ok(false);
    }
    for (rel, is_dir) in a {
        if !is_dir && !same_bytes(&src.join(&rel), &dst.join(&rel))? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Empties `dir` (not `dir` itself). Only ever called on a folder this module
/// itself just verified was empty, to undo its own partial copy.
fn clear_dir(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            let _ = if p.is_dir() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
        }
    }
}

/// Copies `src` into the empty folder `dst` and proves the copy is identical.
/// On ANY failure `dst` is emptied again and the error says nothing changed.
/// Never touches `src`, never writes location.json - the caller switches only
/// after this returns Ok, and only then.
///
/// The caller must have stopped everything writing to `src` first.
pub fn copy_and_verify(src: &Path, dst: &Path) -> Result<(), String> {
    validate_target(src, dst)?;
    match copy_tree(src, dst).and_then(|_| identical(src, dst)) {
        Ok(true) => Ok(()),
        Ok(false) => {
            clear_dir(dst);
            Err("The copy didn't match the original, so nothing was changed.".into())
        }
        Err(e) => {
            clear_dir(dst);
            Err(format!("Couldn't copy your data: {e}. Nothing was changed."))
        }
    }
}

/// The whole move: copy, verify, THEN switch. If saving the new location
/// fails after a good copy, the copy is removed again, so a failed move never
/// leaves a second full copy of the data lying around that the app doesn't use.
pub fn move_to(default_dir: &Path, current: &Path, target: &Path) -> Result<(), String> {
    copy_and_verify(current, target)?;
    write_location(default_dir, target).map_err(|e| {
        clear_dir(target);
        format!("{e}. Nothing was changed.")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    /// A data folder shaped like the real one: databases (+ WAL), a nested
    /// users folder with a large-ish binary, an empty backups folder, a private
    /// lock file, and the launcher files that must NOT travel.
    fn sample(dir: &Path) {
        fs::write(dir.join("system.db"), b"system\x00\x01\x02").unwrap();
        fs::write(dir.join("system.db-wal"), vec![7u8; 4096]).unwrap();
        fs::create_dir_all(dir.join("users")).unwrap();
        fs::write(dir.join("users/1.db"), (0..3_000_000u32).map(|i| (i % 251) as u8).collect::<Vec<_>>()).unwrap();
        fs::create_dir_all(dir.join("backups")).unwrap();
        fs::write(dir.join("app-lock.json"), b"{}").unwrap();
        fs::write(dir.join("server.log"), b"log").unwrap();
        fs::write(dir.join("location.json"), b"{}").unwrap();
    }

    // --- resolve / write_location ------------------------------------

    #[test]
    fn no_location_file_means_the_default_folder() {
        let d = tmp();
        assert_eq!(resolve(d.path()).unwrap(), d.path());
    }

    #[test]
    fn location_file_points_at_the_chosen_folder() {
        let (d, custom) = (tmp(), tmp());
        write_location(d.path(), custom.path()).unwrap();
        assert_eq!(resolve(d.path()).unwrap(), custom.path());
        assert!(!d.path().join("location.json.tmp").exists());
    }

    #[test]
    fn a_missing_custom_folder_is_an_error_never_a_quiet_fallback_to_the_default() {
        let d = tmp();
        let gone = d.path().join("unplugged-drive");
        write_location(d.path(), &gone).unwrap();
        let err = resolve(d.path()).unwrap_err();
        assert!(err.contains("can't be found") && err.contains("unplugged-drive"), "{err}");
    }

    #[test]
    fn a_damaged_or_relative_location_file_is_an_error() {
        let d = tmp();
        fs::write(d.path().join(LOCATION_FILE), "{nope").unwrap();
        assert!(resolve(d.path()).unwrap_err().contains("damaged"));
        fs::write(d.path().join(LOCATION_FILE), r#"{"dataDir":"relative/dir"}"#).unwrap();
        assert!(resolve(d.path()).unwrap_err().contains("full path"));
        fs::write(d.path().join(LOCATION_FILE), r#"{"other":1}"#).unwrap();
        assert!(resolve(d.path()).unwrap_err().contains("damaged"));
    }

    // --- validate_target ---------------------------------------------

    #[test]
    fn accepts_an_empty_separate_folder() {
        let (src, dst) = (tmp(), tmp());
        validate_target(src.path(), dst.path()).unwrap();
        assert!(!dst.path().join(".tally-write-test").exists(), "probe file must be cleaned up");
    }

    #[test]
    fn rejects_a_folder_with_files_in_it() {
        let (src, dst) = (tmp(), tmp());
        fs::write(dst.path().join("photo.jpg"), b"x").unwrap();
        assert!(validate_target(src.path(), dst.path()).unwrap_err().contains("empty"));
    }

    #[test]
    fn rejects_the_same_folder_and_nesting_either_way_round() {
        let src = tmp();
        sample(src.path());
        assert!(validate_target(src.path(), src.path()).unwrap_err().contains("already"));
        assert!(validate_target(src.path(), &src.path().join("backups")).unwrap_err().contains("inside"));
        let inner = src.path().join("inner");
        fs::create_dir(&inner).unwrap();
        assert!(validate_target(&inner, src.path()).is_err(), "a target that contains the source");
    }

    #[test]
    fn rejects_something_that_is_not_a_folder() {
        let (src, d) = (tmp(), tmp());
        let file = d.path().join("f");
        fs::write(&file, b"x").unwrap();
        assert!(validate_target(src.path(), &file).is_err());
        assert!(validate_target(src.path(), &d.path().join("nope")).is_err());
    }

    // --- copy_and_verify ---------------------------------------------

    #[test]
    fn copies_everything_byte_for_byte_and_leaves_the_original_alone() {
        let (src, dst) = (tmp(), tmp());
        sample(src.path());
        copy_and_verify(src.path(), dst.path()).unwrap();

        assert_eq!(fs::read(dst.path().join("system.db")).unwrap(), fs::read(src.path().join("system.db")).unwrap());
        assert_eq!(fs::read(dst.path().join("users/1.db")).unwrap().len(), 3_000_000);
        assert!(dst.path().join("backups").is_dir(), "an empty folder is part of the data's shape");
        assert!(dst.path().join("system.db-wal").exists(), "the WAL must travel with its database");
        // The original is untouched: nothing deleted, nothing changed.
        assert!(src.path().join("users/1.db").exists() && src.path().join("server.log").exists());
    }

    #[test]
    fn launcher_files_do_not_travel() {
        let (src, dst) = (tmp(), tmp());
        sample(src.path());
        copy_and_verify(src.path(), dst.path()).unwrap();
        assert!(!dst.path().join("server.log").exists());
        assert!(!dst.path().join("location.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn keeps_the_app_lock_file_private() {
        use std::os::unix::fs::PermissionsExt;
        let (src, dst) = (tmp(), tmp());
        sample(src.path());
        fs::set_permissions(src.path().join("app-lock.json"), fs::Permissions::from_mode(0o600)).unwrap();
        copy_and_verify(src.path(), dst.path()).unwrap();
        assert_eq!(fs::metadata(dst.path().join("app-lock.json")).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn verification_catches_a_single_flipped_byte() {
        let (src, dst) = (tmp(), tmp());
        sample(src.path());
        copy_tree(src.path(), dst.path()).unwrap();
        assert!(identical(src.path(), dst.path()).unwrap());
        let mut bytes = fs::read(dst.path().join("users/1.db")).unwrap();
        bytes[2_999_999] ^= 1;
        fs::write(dst.path().join("users/1.db"), bytes).unwrap();
        assert!(!identical(src.path(), dst.path()).unwrap());
    }

    #[test]
    fn verification_catches_a_missing_file_and_an_extra_one() {
        let (src, dst) = (tmp(), tmp());
        sample(src.path());
        copy_tree(src.path(), dst.path()).unwrap();
        fs::write(dst.path().join("stray.txt"), b"x").unwrap();
        assert!(!identical(src.path(), dst.path()).unwrap());
        fs::remove_file(dst.path().join("stray.txt")).unwrap();
        fs::remove_file(dst.path().join("system.db")).unwrap();
        assert!(!identical(src.path(), dst.path()).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_copy_is_undone_completely_and_says_nothing_changed() {
        use std::os::unix::fs::PermissionsExt;
        let (src, dst) = (tmp(), tmp());
        sample(src.path());
        // A file that can't be read part-way through the copy.
        let locked = src.path().join("users/2.db");
        fs::write(&locked, b"secret").unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::File::open(&locked).is_ok() {
            return; // running as root: permissions don't apply, nothing to test
        }

        let err = copy_and_verify(src.path(), dst.path()).unwrap_err();
        assert!(err.contains("Nothing was changed"), "{err}");
        assert_eq!(fs::read_dir(dst.path()).unwrap().count(), 0, "the partial copy must be removed");
        assert!(src.path().join("users/1.db").exists(), "the original must be untouched");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o600)).unwrap();
    }

    #[test]
    fn refuses_to_run_into_a_folder_that_has_files() {
        let (src, dst) = (tmp(), tmp());
        sample(src.path());
        fs::write(dst.path().join("precious.txt"), b"mine").unwrap();
        assert!(copy_and_verify(src.path(), dst.path()).is_err());
        assert_eq!(fs::read(dst.path().join("precious.txt")).unwrap(), b"mine", "a refused move must never delete the target's files");
    }

    // --- move_to -----------------------------------------------------

    #[test]
    fn a_full_move_switches_the_location_only_after_a_verified_copy() {
        let (default_dir, dst) = (tmp(), tmp());
        let src = default_dir.path().to_path_buf();
        sample(&src);
        move_to(default_dir.path(), &src, dst.path()).unwrap();
        assert_eq!(resolve(default_dir.path()).unwrap(), dst.path());
        assert!(src.join("users/1.db").exists(), "the original is never deleted");
        assert!(dst.path().join("users/1.db").exists());
    }

    #[test]
    fn a_refused_move_leaves_the_location_alone() {
        let (default_dir, other) = (tmp(), tmp());
        sample(default_dir.path());
        fs::remove_file(default_dir.path().join(LOCATION_FILE)).unwrap(); // sample()'s is a placeholder, not a real one
        fs::write(other.path().join("x"), b"x").unwrap(); // not empty -> refused
        assert!(move_to(default_dir.path(), default_dir.path(), other.path()).is_err());
        assert_eq!(resolve(default_dir.path()).unwrap(), default_dir.path());
    }

    #[cfg(unix)]
    #[test]
    fn if_saving_the_location_fails_the_good_copy_is_removed_again() {
        use std::os::unix::fs::PermissionsExt;
        let (default_dir, src, dst) = (tmp(), tmp(), tmp());
        sample(src.path());
        fs::set_permissions(default_dir.path(), fs::Permissions::from_mode(0o500)).unwrap(); // can't write location.json
        let probe = default_dir.path().join("probe");
        if fs::write(&probe, b"x").is_ok() {
            fs::set_permissions(default_dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
            return; // running as root: nothing to test
        }

        let err = move_to(default_dir.path(), src.path(), dst.path()).unwrap_err();
        fs::set_permissions(default_dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
        assert!(err.contains("Nothing was changed"), "{err}");
        assert_eq!(fs::read_dir(dst.path()).unwrap().count(), 0, "no stray second copy");
        assert!(src.path().join("system.db").exists());
        assert_eq!(resolve(default_dir.path()).unwrap(), default_dir.path(), "location unchanged");
    }
}
