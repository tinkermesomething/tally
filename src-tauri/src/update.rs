//! The "update available" window: the release notes (scrollable), and the
//! choice to install now, decide later, or skip this version.
//!
//! The window shows a page that ships inside the app (frontend/update.html).
//! It gets NO access to native APIs. The buttons are plain links to a reserved
//! address; `on_navigation` catches them and turns them into a `Choice`. So the
//! page can't do anything except ask, whatever the notes contain.

use std::{
    fs, io,
    path::Path,
    sync::mpsc,
};

use tauri::{Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

/// Remembers the one version the person chose to skip. A launcher file (it
/// lives next to location.json, never travels with the data folder).
pub const SKIPPED_FILE: &str = "skipped-update";

/// Notes longer than this are cut. They come from a web download, and a
/// window is not the place for a megabyte.
const NOTES_LIMIT: usize = 64 * 1024;

/// A reserved name (.invalid never resolves). The page links here; nothing is ever fetched.
const CHOICE_HOST: &str = "tally-update.invalid";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Choice {
    Install,
    Later,
    Skip,
}

pub fn skipped_version(dir: &Path) -> Option<String> {
    let raw = fs::read_to_string(dir.join(SKIPPED_FILE)).ok()?;
    let v = raw.trim();
    (!v.is_empty()).then(|| v.to_string())
}

pub fn skip_version(dir: &Path, version: &str) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    fs::write(dir.join(SKIPPED_FILE), version)
}

/// A launch check stays quiet about the exact version that was skipped. A
/// newer version is a different string, so it is offered again. A manual
/// check always offers: skipping must never lock someone out of updating.
pub fn should_offer(version: &str, skipped: Option<&str>, manual: bool) -> bool {
    manual || skipped != Some(version)
}

/// The release page for a version, or None if the version text isn't a plain
/// version (it comes from a download, and ends up in a link).
pub fn release_url(version: &str) -> Option<String> {
    let plain = !version.is_empty() && version.len() <= 64 && version.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'));
    plain.then(|| format!("https://github.com/tinkermesomething/tally/releases/tag/v{}", version.trim_start_matches('v')))
}

/// At most NOTES_LIMIT bytes, cut on a character boundary.
pub fn clip_notes(notes: &str) -> String {
    if notes.len() <= NOTES_LIMIT {
        return notes.to_string();
    }
    let mut end = NOTES_LIMIT;
    while !notes.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n\n…", &notes[..end])
}

/// Which button a navigation is, if it is one.
pub fn choice_for(url: &Url) -> Option<Choice> {
    if url.host_str() != Some(CHOICE_HOST) {
        return None;
    }
    match url.path() {
        "/install" => Some(Choice::Install),
        "/later" => Some(Choice::Later),
        "/skip" => Some(Choice::Skip),
        _ => None,
    }
}

/// Only the page's own address may load in the window; every other link
/// opens in the browser instead.
fn allow_navigation(url: &Url, send: &mpsc::Sender<Choice>) -> bool {
    if let Some(choice) = choice_for(url) {
        let _ = send.send(choice);
        return false;
    }
    if matches!(url.scheme(), "http" | "https") && url.host_str() != Some("tauri.localhost") {
        crate::open_in_browser(url);
        return false;
    }
    true
}

/// Shows the window and waits for the person to choose. Closing the window
/// counts as "Later". The window stays open so the caller can show progress.
pub fn ask(app: &tauri::AppHandle, version: &str, current: &str, notes: Option<&str>) -> Result<(Choice, WebviewWindow), String> {
    let offer = serde_json::json!({
        "version": version,
        "current": current,
        "notes": clip_notes(notes.unwrap_or("")),
        "releaseUrl": release_url(version),
    });
    let (tx, rx) = mpsc::channel::<Choice>();
    let on_nav = tx.clone();
    let window = WebviewWindowBuilder::new(app, "update", WebviewUrl::App("update.html".into()))
        .title("Tally update")
        .inner_size(560.0, 660.0)
        .min_inner_size(420.0, 440.0)
        .center()
        .initialization_script(format!("window.__UPDATE__ = {offer};"))
        .on_navigation(move |url| allow_navigation(url, &on_nav))
        .build()
        .map_err(|e| format!("Can't open the update window: {e}"))?;
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { .. } = event {
            let _ = tx.send(Choice::Later);
        }
    });
    let choice = rx.recv().unwrap_or(Choice::Later);
    Ok((choice, window))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn a_skipped_version_stays_quiet_but_a_newer_one_is_offered() {
        assert!(!should_offer("5.2.3", Some("5.2.3"), false));
        assert!(should_offer("5.2.4", Some("5.2.3"), false));
        assert!(should_offer("5.2.3", None, false));
    }

    #[test]
    fn a_manual_check_always_offers() {
        assert!(should_offer("5.2.3", Some("5.2.3"), true));
    }

    #[test]
    fn the_skipped_version_is_remembered_in_a_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(skipped_version(dir.path()), None);
        skip_version(dir.path(), "5.2.3").unwrap();
        assert_eq!(skipped_version(dir.path()).as_deref(), Some("5.2.3"));
        skip_version(dir.path(), "5.2.4").unwrap();
        assert_eq!(skipped_version(dir.path()).as_deref(), Some("5.2.4"));
    }

    #[test]
    fn an_empty_or_missing_skip_file_means_nothing_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(SKIPPED_FILE), "  \n").unwrap();
        assert_eq!(skipped_version(dir.path()), None);
        assert_eq!(skipped_version(&dir.path().join("nope")), None);
    }

    #[test]
    fn the_release_link_is_built_only_from_a_plain_version() {
        assert_eq!(release_url("5.2.3").as_deref(), Some("https://github.com/tinkermesomething/tally/releases/tag/v5.2.3"));
        assert_eq!(release_url("v5.2.3").as_deref(), Some("https://github.com/tinkermesomething/tally/releases/tag/v5.2.3"));
        assert_eq!(release_url("5.3.0-rc.1").is_some(), true);
        for bad in ["", "5.2.3/../../evil", "5.2.3?x=1", "5 2", "5.2.3\"><script>", &"9".repeat(65)] {
            assert_eq!(release_url(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn long_notes_are_cut_on_a_character_boundary() {
        assert_eq!(clip_notes("short"), "short");
        let long = "é".repeat(NOTES_LIMIT);
        let cut = clip_notes(&long);
        assert!(cut.len() <= NOTES_LIMIT + 8);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn only_the_three_reserved_links_are_choices() {
        assert_eq!(choice_for(&url("https://tally-update.invalid/install")), Some(Choice::Install));
        assert_eq!(choice_for(&url("https://tally-update.invalid/later")), Some(Choice::Later));
        assert_eq!(choice_for(&url("https://tally-update.invalid/skip")), Some(Choice::Skip));
        assert_eq!(choice_for(&url("https://tally-update.invalid/other")), None);
        assert_eq!(choice_for(&url("https://example.com/install")), None);
        assert_eq!(choice_for(&url("https://tally-update.invalid.evil.com/skip")), None);
    }

    #[test]
    fn the_page_may_load_but_outside_links_may_not() {
        let (tx, rx) = mpsc::channel();
        assert!(allow_navigation(&url("tauri://localhost/update.html"), &tx));
        assert!(allow_navigation(&url("http://tauri.localhost/update.html"), &tx));
        assert!(!allow_navigation(&url("https://tally-update.invalid/skip"), &tx));
        assert_eq!(rx.try_recv(), Ok(Choice::Skip));
    }
}
