use std::path::Path;

const KEYRING_SERVICE: &str = "com.tally.desktop";
const KEYRING_USER: &str = "auth-secret";

/// The key that seals the database's own key (AUTH_SECRET in the web build).
/// Created once, then read silently from the OS keychain on every launch.
///
/// A keychain READ failure must never fall through to creating a new one: a
/// fresh secret can't open the existing database, and the app would quietly
/// start empty. Only a genuinely absent entry on a genuinely fresh install
/// may create one - and a first-run key is only ever minted for the default
/// folder, because a custom folder means the data already exists somewhere.
pub fn auth_secret(data_dir: &Path, default_dir: &Path) -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Can't open the system keychain: {e}"))?;
    match entry.get_password() {
        Ok(secret) => Ok(secret),
        Err(keyring::Error::NoEntry) => {
            if data_dir != default_dir || has_existing_data(data_dir) {
                return Err(format!("Your data exists but its key is missing from the system keychain. Tally will not create a new key, because that would make your data unreadable. Restore the keychain entry (service {KEYRING_SERVICE}, account {KEYRING_USER}) or restore from a backup."));
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

/// 32 random bytes as hex: the keychain secret, the launch token, the health nonce.
pub fn random_hex() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("Can't generate a key: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
