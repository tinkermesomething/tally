// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{ffi::OsStr, io, process::Command, sync::Mutex};

mod datadir;
mod secrets;
mod sidecar;

use sidecar::Sidecar;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
#[cfg(not(debug_assertions))]
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

/// Checks GitHub Releases for a newer signed build, once per launch. The
/// update's signature is verified against the public key in tauri.conf.json
/// before anything is installed. Failures (offline, no release yet) are
/// silent: an update check must never get in the way of opening the app.
#[cfg(not(debug_assertions))]
fn check_for_update(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let Ok(updater) = app.updater() else { return };
        let update = match tauri::async_runtime::block_on(updater.check()) {
            Ok(Some(update)) => update,
            Ok(None) => return,
            Err(e) => {
                eprintln!("update check failed: {e}");
                return;
            }
        };
        let wanted = app
            .dialog()
            .message(format!("Tally {} is available (you have {}). Install it now? Tally will restart.", update.version, update.current_version))
            .title("Update available")
            .buttons(MessageDialogButtons::OkCancelCustom("Update".into(), "Later".into()))
            .blocking_show();
        if !wanted {
            return;
        }
        let bytes = match tauri::async_runtime::block_on(update.download(|_, _| {}, || {})) {
            Ok(bytes) => bytes,
            Err(e) => {
                app.dialog().message(format!("The update couldn't be downloaded: {e}")).kind(MessageDialogKind::Error).blocking_show();
                return;
            }
        };
        // Stop the server first: on Windows its files can't be replaced while it runs.
        sidecar::stop(&app);
        if let Err(e) = update.install(bytes) {
            app.dialog().message(format!("The update couldn't be installed: {e}\n\nTally will reopen.")).kind(MessageDialogKind::Error).blocking_show();
        }
        // Restart either way: the server was stopped, so a failed install must not leave a window on a dead one.
        app.restart();
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
            app.set_menu(menu)?;

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
                    check_for_update(app.handle().clone());
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
