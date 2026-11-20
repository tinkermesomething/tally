// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread::sleep,
    time::{Duration, Instant},
};

mod datadir;

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
#[cfg(not(debug_assertions))]
use tauri_plugin_updater::UpdaterExt;

// Holds the Node server. Its stdin pipe stays open as long as this lives;
// desktop-run.cjs exits when that pipe closes, so a force-quit or crash of
// this app never leaves the server running.
struct Sidecar(Mutex<Option<Child>>);

const KEYRING_SERVICE: &str = "com.tally.desktop";
const KEYRING_USER: &str = "auth-secret";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);

/// The key that seals the database's own key (AUTH_SECRET in the web build).
/// Created once, then read silently from the OS keychain on every launch.
///
/// A keychain READ failure must never fall through to creating a new one: a
/// fresh secret can't open the existing database, and the app would quietly
/// start empty. Only a genuinely absent entry on a genuinely fresh install
/// may create one.
fn auth_secret(data_dir: &Path, default_dir: &Path) -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Can't open the system keychain: {e}"))?;
    match entry.get_password() {
        Ok(secret) => Ok(secret),
        Err(keyring::Error::NoEntry) => {
            // A first-run key is only ever minted for the default folder. A custom
            // folder means the user already has data somewhere this key must open.
            if data_dir != default_dir {
                return Err("Your data is in a custom folder, but its key is missing from the system keychain. Tally will not create a new key, because that would make your data unreadable. Restore the keychain entry (service com.tally.desktop, account auth-secret) or restore from a backup.".into());
            }
            if has_existing_data(data_dir) {
                return Err("Your data exists but its key is missing from the system keychain. Tally will not create a new key, because that would make your data unreadable. Restore the keychain entry (service com.tally.desktop, account auth-secret) or restore from a backup.".into());
            }
            let secret = random_hex()?;
            entry.set_password(&secret).map_err(|e| format!("Can't save the key to the system keychain: {e}"))?;
            Ok(secret)
        }
        Err(e) => Err(format!("Can't read the key from the system keychain: {e}")),
    }
}

fn has_existing_data(data_dir: &Path) -> bool {
    data_dir.join("system.db").exists() || data_dir.join("tally.db").exists() || data_dir.join("users").read_dir().map(|mut d| d.next().is_some()).unwrap_or(false)
}

fn free_port() -> Result<u16, String> {
    // Released before the server binds it. Another process could grab it in
    // between; healthy() makes sure we'd notice (it must echo our nonce).
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Can't pick a local port: {e}"))?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

fn random_hex() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("Can't generate a key: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Is OUR server answering on `port`? Another program could grab the port in
/// the moment between picking it and the server binding it; its answer would
/// look healthy, and the window would then send it the launch token. So a
/// healthy answer must also echo `nonce`, which only our own server was told.
fn healthy(port: u16, nonce: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    if stream.write_all(format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").as_bytes()).is_err() {
        return false;
    }
    let mut raw = Vec::new();
    let _ = stream.take(4096).read_to_end(&mut raw);
    let body = String::from_utf8_lossy(&raw);
    body.starts_with("HTTP/1.1 200") && body.contains(nonce)
}

/// The one-time-per-run secret that proves a request comes from this app's
/// own window - see lib/desktop/gate.ts on the server side.
fn start_server(app: &tauri::AppHandle) -> Result<(Child, u16, String), String> {
    // The default folder holds only the launcher's own files (log, location.json) and,
    // until the user moves it, the data. See datadir.rs.
    let default_dir: PathBuf = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&default_dir).map_err(|e| format!("Can't create {}: {e}", default_dir.display()))?;
    let data_dir = datadir::resolve(&default_dir)?;

    let secret = auth_secret(&data_dir, &default_dir)?;
    let port = free_port()?;
    let launch_token = random_hex()?;
    let health_nonce = random_hex()?;

    let resources = app.path().resource_dir().map_err(|e| e.to_string())?.join("resources");
    let node = resources.join("node").join(if cfg!(windows) { "node.exe" } else { "node" });
    let script = resources.join("app").join("desktop-run.cjs");
    if !node.exists() || !script.exists() {
        return Err(format!("The app is incomplete: missing {} or {}.", node.display(), script.display()));
    }

    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(default_dir.join("server.log"))
        .map_err(|e| format!("Can't open the server log: {e}"))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(node);
    cmd.arg(script)
        .env("TALLY_MODE", "desktop")
        .env("AUTH_SECRET", secret)
        .env("PORT", port.to_string())
        .env("LAUNCH_TOKEN", &launch_token)
        .env("HEALTH_NONCE", &health_nonce)
        // Loopback only - never 0.0.0.0, which would expose the app to the LAN.
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .env("DATABASE_PATH", data_dir.join("tally.db"))
        .env("USERS_DB_DIR", data_dir.join("users"))
        .env("SYSTEM_DB_PATH", data_dir.join("system.db"))
        .env("BACKUP_DIR", data_dir.join("backups"))
        .stdin(Stdio::piped())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    // Started from a terminal, the server would inherit the shell's environment. Drop what
    // could change how Node runs, and the web build's own secrets (desktop uses none).
    for var in [
        "NODE_OPTIONS",
        "NODE_PATH",
        "TALLY_API_TOKEN",
        "ALLOWED_EMAIL",
        "OIDC_ISSUER",
        "OIDC_CLIENT_ID",
        "OIDC_CLIENT_SECRET",
        "GOCARDLESS_SECRET_ID",
        "GOCARDLESS_SECRET_KEY",
        "GOCARDLESS_REDIRECT_URL",
    ] {
        cmd.env_remove(var);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Can't start the server: {e}"))?;

    let started = Instant::now();
    loop {
        if healthy(port, &health_nonce) {
            return Ok((child, port, launch_token));
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("The server stopped during startup ({status}). See {}.", default_dir.join("server.log").display()));
        }
        if started.elapsed() > STARTUP_TIMEOUT {
            let _ = child.kill();
            return Err(format!("The server didn't start within {}s. See {}.", STARTUP_TIMEOUT.as_secs(), default_dir.join("server.log").display()));
        }
        sleep(Duration::from_millis(250));
    }
}

fn stop_sidecar(app: &tauri::AppHandle) {
    if let Some(sidecar) = app.try_state::<Sidecar>() {
        if let Some(mut child) = sidecar.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Opens a web link in the user's own browser. Only http(s): this is fed by
/// navigations out of the window, which must never run a file: or app URL.
fn open_in_browser(url: &tauri::Url) {
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    let opener = if cfg!(target_os = "macos") { "open" } else if cfg!(windows) { "explorer" } else { "xdg-open" };
    let _ = Command::new(opener).arg(url.as_str()).spawn();
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

        stop_sidecar(&app);
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
            let opener = if cfg!(target_os = "macos") { "open" } else if cfg!(windows) { "explorer" } else { "xdg-open" };
            if let Err(e) = Command::new(opener).arg(&dir).spawn() {
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
        stop_sidecar(&app);
        if let Err(e) = update.install(bytes) {
            app.dialog().message(format!("The update couldn't be installed: {e}\n\nTally will reopen.")).kind(MessageDialogKind::Error).blocking_show();
            // The server was stopped for the install; reopen so the window isn't left on a dead one.
            app.restart();
        }
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

            match start_server(app.handle()) {
                Ok((child, port, launch_token)) => {
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
            stop_sidecar(handle);
        }
    });
}
