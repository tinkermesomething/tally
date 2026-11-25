// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    ffi::OsStr,
    io,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

mod datadir;
mod secrets;
mod sidecar;
mod update;

use sidecar::Sidecar;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

/// Opens a file, folder or link with the system's own handler.
fn open_path(target: impl AsRef<OsStr>) -> io::Result<()> {
    let opener = if cfg!(target_os = "macos") { "open" } else if cfg!(windows) { "explorer" } else { "xdg-open" };
    Command::new(opener).arg(target).spawn().map(|_| ())
}

/// Opens a web link in the user's own browser. Only http(s): this is fed by
/// navigations out of the window, which must never run a file: or app URL.
fn open_in_browser(url: &tauri::Url) {
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    let _ = open_path(url.as_str());
}

fn tell(app: &tauri::AppHandle, kind: MessageDialogKind, title: &str, message: impl Into<String>) {
    app.dialog().message(message.into()).title(title).kind(kind).blocking_show();
}

/// Data > Change data folder... Runs off the main thread (it shows blocking
/// dialogs). The server is stopped only AFTER the user confirms, and the app
/// always restarts afterwards - on the new folder if the move worked, on the
/// old one if it didn't. Nothing is deleted either way.
fn change_data_folder(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let title = "Change data folder";
        let Ok(default_dir) = app.path().app_data_dir() else { return };
        let current = match datadir::resolve(&default_dir) {
            Ok(dir) => dir,
            Err(e) => return tell(&app, MessageDialogKind::Error, title, e),
        };
        let Some(picked) = app.dialog().file().set_title("Choose an empty folder for your Tally data").blocking_pick_folder() else { return };
        let Ok(target) = picked.into_path() else { return tell(&app, MessageDialogKind::Error, title, "Tally can't use that location.") };
        if let Err(e) = datadir::validate_target(&current, &target) {
            return tell(&app, MessageDialogKind::Error, title, e);
        }
        let confirmed = app
            .dialog()
            .message(format!(
                "Move your data?\n\nFrom: {}\nTo: {}\n\nTally will close, copy everything, check the copy is identical, then reopen using the new folder. Your original stays where it is until you delete it.",
                current.display(),
                target.display()
            ))
            .title(title)
            .buttons(MessageDialogButtons::OkCancelCustom("Move".into(), "Cancel".into()))
            .blocking_show();
        if !confirmed {
            return;
        }

        sidecar::stop(&app);
        match datadir::move_to(&default_dir, &current, &target) {
            Ok(()) => tell(
                &app,
                MessageDialogKind::Info,
                title,
                format!("Done. Tally will reopen using {}.\n\nYour original data is still in {} - delete it once you've checked everything looks right.", target.display(), current.display()),
            ),
            Err(e) => tell(&app, MessageDialogKind::Error, title, format!("{e}\n\nYour data is where it was. Tally will reopen.")),
        }
        app.restart();
    });
}

/// Data > Show data folder: opens it in Finder / Explorer / the file manager.
fn show_data_folder(app: &tauri::AppHandle) {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string()).and_then(|d| datadir::resolve(&d));
    match dir {
        Ok(dir) => {
            if let Err(e) = open_path(&dir) {
                tell(app, MessageDialogKind::Error, "Show data folder", format!("Can't open {}: {e}", dir.display()));
            }
        }
        Err(e) => tell(app, MessageDialogKind::Error, "Show data folder", e),
    }
}

/// Looks on GitHub Releases for a newer signed build and, if there is one, asks
/// in the update window (release notes; Update now, Later, Skip this version).
/// The signature is verified against the public key in tauri.conf.json before
/// anything is installed.
///
/// `manual` is the Updates menu: it ignores a skipped version, and says so
/// when there is nothing new or the check fails. The launch check is silent
/// about both: an update check must never get in the way of opening the app.
fn check_for_update(app: tauri::AppHandle, manual: bool) {
    // One check at a time: a second click on the menu item just brings the window forward.
    static BUSY: AtomicBool = AtomicBool::new(false);
    if BUSY.swap(true, Ordering::SeqCst) {
        if let Some(window) = app.get_webview_window("update") {
            let _ = window.set_focus();
        }
        return;
    }
    std::thread::spawn(move || {
        run_update_check(&app, manual);
        BUSY.store(false, Ordering::SeqCst);
    });
}

fn run_update_check(app: &tauri::AppHandle, manual: bool) {
    let title = "Check for updates";
    let Ok(updater) = app.updater() else { return };
    let update = match tauri::async_runtime::block_on(updater.check()) {
        Ok(Some(update)) => update,
        Ok(None) => {
            if manual {
                tell(app, MessageDialogKind::Info, title, format!("Tally {} is the newest version.", app.package_info().version));
            }
            return;
        }
        Err(e) => {
            eprintln!("update check failed: {e}");
            if manual {
                tell(app, MessageDialogKind::Error, title, format!("Tally couldn't check for updates: {e}"));
            }
            return;
        }
    };
    let launcher_dir = app.path().app_data_dir().ok();
    let skipped = launcher_dir.as_deref().and_then(update::skipped_version);
    if !update::should_offer(&update.version, skipped.as_deref(), manual) {
        return;
    }
    let (choice, window) = match update::ask(app, &update.version, &update.current_version, update.body.as_deref()) {
        Ok(asked) => asked,
        Err(e) => return tell(app, MessageDialogKind::Error, title, e),
    };
    match choice {
        update::Choice::Later => {
            let _ = window.destroy();
            return;
        }
        update::Choice::Skip => {
            if let Some(dir) = &launcher_dir {
                if let Err(e) = update::skip_version(dir, &update.version) {
                    eprintln!("can't remember the skipped version: {e}");
                }
            }
            let _ = window.destroy();
            return;
        }
        update::Choice::Install => {
            let _ = window.eval("window.__busy && window.__busy()");
        }
    }
    let bytes = match tauri::async_runtime::block_on(update.download(|_, _| {}, || {})) {
        Ok(bytes) => bytes,
        Err(e) => {
            let _ = window.destroy();
            tell(app, MessageDialogKind::Error, title, format!("The update couldn't be downloaded: {e}"));
            return;
        }
    };
    // Stop the server first: on Windows its files can't be replaced while it runs.
    sidecar::stop(app);
    if let Err(e) = update.install(bytes) {
        let _ = window.destroy();
        tell(app, MessageDialogKind::Error, title, format!("The update couldn't be installed: {e}\n\nTally will reopen."));
    }
    // Restart either way: the server was stopped, so a failed install must not leave a window on a dead one.
    app.restart();
}

/// Debug builds only (compiled out of releases): shows the update window with
/// the offer in a JSON file ({version, current, notes}) and prints the choice,
/// without starting the server or touching any data. TALLY_PREVIEW_PICK=
/// install|later|skip clicks that link by itself after a moment.
#[cfg(debug_assertions)]
fn preview_update(app: tauri::AppHandle, file: String) {
    std::thread::spawn(move || {
        let offer: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file).expect("preview file")).expect("preview json");
        let text = |key: &str| offer[key].as_str().unwrap_or("").to_string();
        if let Ok(pick) = std::env::var("TALLY_PREVIEW_PICK") {
            let handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if let Some(window) = handle.get_webview_window("update") {
                    let _ = window.eval(&format!("location.href = 'https://tally-update.invalid/{pick}'"));
                }
            });
        }
        let (choice, window) = update::ask(&app, &text("version"), &text("current"), offer["notes"].as_str()).expect("update window");
        if choice == update::Choice::Skip {
            let dir = app.path().app_data_dir().expect("app data dir");
            update::skip_version(&dir, &text("version")).expect("skip file");
        }
        println!("CHOICE: {choice:?}");
        let _ = window.destroy();
        app.exit(0);
    });
}

fn main() {
    let app = tauri::Builder::default()
        // Two copies would run two servers on one database (and a data-folder move
        // in one would race the other's writes). A second launch just focuses the first.
        // Must be the first plugin registered.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_menu_event(|app, event| match event.id().as_ref() {
            "change-data-folder" => change_data_folder(app.clone()),
            "show-data-folder" => show_data_folder(app),
            "check-for-updates" => check_for_update(app.clone(), true),
            _ => {}
        })
        .setup(|app| {
            // The platform's standard menu (keeps copy/paste working) plus a Data menu.
            let menu = Menu::default(app.handle())?;
            let data = Submenu::with_items(
                app,
                "Data",
                true,
                &[
                    &MenuItem::with_id(app, "change-data-folder", "Change data folder…", true, None::<&str>)?,
                    &MenuItem::with_id(app, "show-data-folder", "Show data folder", true, None::<&str>)?,
                ],
            )?;
            menu.append(&data)?;
            let updates = Submenu::with_items(app, "Updates", true, &[&MenuItem::with_id(app, "check-for-updates", "Check for updates…", true, None::<&str>)?])?;
            menu.append(&updates)?;
            app.set_menu(menu)?;

            #[cfg(debug_assertions)]
            if let Ok(file) = std::env::var("TALLY_PREVIEW_UPDATE") {
                preview_update(app.handle().clone(), file);
                return Ok(());
            }

            match sidecar::start(app.handle()) {
                Ok(sidecar::Started { child, port, launch_token }) => {
                    app.manage(Sidecar(Mutex::new(Some(child))));
                    let url = format!("http://127.0.0.1:{port}/api/desktop/enter?t={launch_token}").parse().map_err(|e| format!("{e}"))?;
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                        // This window shows ONLY Tally's own local server. A link out (e.g. the footer's
                        // GitHub link) opens in the browser instead, so no outside page ever runs in here.
                        .on_navigation(move |url| {
                            let local = url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(port);
                            if !local {
                                open_in_browser(url);
                            }
                            local
                        })
                        .title("Tally")
                        .inner_size(1280.0, 860.0)
                        .min_inner_size(420.0, 600.0)
                        .build()?;
                    #[cfg(not(debug_assertions))]
                    check_for_update(app.handle().clone(), false);
                    Ok(())
                }
                Err(message) => {
                    app.dialog().message(&message).title("Tally can't start").kind(MessageDialogKind::Error).blocking_show();
                    Err(message.into())
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Tally");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            sidecar::stop(handle);
        }
    });
}
