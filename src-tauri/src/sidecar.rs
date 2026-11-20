//! The bundled Node server: picking its port, starting it, proving it is OURS
//! that answers, and stopping it.

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread::sleep,
    time::{Duration, Instant},
};

use tauri::Manager;

use crate::{datadir, secrets};

/// Holds the Node server. Its stdin pipe stays open as long as this lives;
/// desktop-run.cjs exits when that pipe closes, so a force-quit or crash of
/// this app never leaves the server running.
pub struct Sidecar(pub Mutex<Option<Child>>);

pub struct Started {
    pub child: Child,
    pub port: u16,
    /// The per-run secret that proves a request comes from this app's own
    /// window - see lib/desktop/gate.ts on the server side.
    pub launch_token: String,
}

const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);

/// A shell can leak these into the server: ones that change how Node runs,
/// and the web build's own secrets (desktop uses none of them).
const SCRUBBED_ENV: [&str; 10] = [
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
];

fn free_port() -> Result<u16, String> {
    // Released before the server binds it. Another process could grab it in
    // between; healthy() makes sure we'd notice (it must echo our nonce).
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Can't pick a local port: {e}"))?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
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

/// Starts the server and waits until it answers.
pub fn start(app: &tauri::AppHandle) -> Result<Started, String> {
    // The default folder holds only the launcher's own files (log, location.json) and,
    // until the user moves it, the data. See datadir.rs.
    let default_dir: PathBuf = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&default_dir).map_err(|e| format!("Can't create {}: {e}", default_dir.display()))?;
    let data_dir = datadir::resolve(&default_dir)?;
    let log_path = default_dir.join("server.log");

    let secret = secrets::auth_secret(&data_dir, &default_dir)?;
    let port = free_port()?;
    let launch_token = secrets::random_hex()?;
    let health_nonce = secrets::random_hex()?;

    let resources = app.path().resource_dir().map_err(|e| e.to_string())?.join("resources");
    let node = resources.join("node").join(if cfg!(windows) { "node.exe" } else { "node" });
    let script = resources.join("app").join("desktop-run.cjs");
    if !node.exists() || !script.exists() {
        return Err(format!("The app is incomplete: missing {} or {}.", node.display(), script.display()));
    }

    let log = OpenOptions::new().create(true).append(true).open(&log_path).map_err(|e| format!("Can't open the server log: {e}"))?;
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
    for var in SCRUBBED_ENV {
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
            return Ok(Started { child, port, launch_token });
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("The server stopped during startup ({status}). See {}.", log_path.display()));
        }
        if started.elapsed() > STARTUP_TIMEOUT {
            let _ = child.kill();
            return Err(format!("The server didn't start within {}s. See {}.", STARTUP_TIMEOUT.as_secs(), log_path.display()));
        }
        sleep(Duration::from_millis(250));
    }
}

pub fn stop(app: &tauri::AppHandle) {
    if let Some(sidecar) = app.try_state::<Sidecar>() {
        if let Some(mut child) = sidecar.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
