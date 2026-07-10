use std::fs;
use std::path::PathBuf;

use anyhow::Context;
use keyring::Entry;

const SERVICE: &str = "tabbywebrtc-agent";
const JWT_ACCOUNT: &str = "agent-jwt";
const PAIRING_KEY_ACCOUNT: &str = "pairing-private-key";
const PAIRING_PUBKEY_ACCOUNT: &str = "pairing-public-key";

fn entry(account: &str) -> anyhow::Result<Entry> {
    Entry::new(SERVICE, account).context("failed to open keychain entry")
}

fn file_store_dir() -> anyhow::Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME not set")?;
    let dir = PathBuf::from(home).join(".config").join("tabbywebrtc").join("credentials");
    fs::create_dir_all(&dir).with_context(|| format!("failed to create {}", dir.display()))?;
    Ok(dir)
}

fn file_path(account: &str) -> anyhow::Result<PathBuf> {
    Ok(file_store_dir()?.join(account))
}

fn read_file(account: &str) -> anyhow::Result<Option<String>> {
    let path = file_path(account)?;
    match fs::read_to_string(&path) {
        Ok(value) => Ok(Some(value.trim().to_string())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err).with_context(|| format!("failed to read {}", path.display())),
    }
}

fn write_file(account: &str, value: &str) -> anyhow::Result<()> {
    let path = file_path(account)?;
    fs::write(&path, value).with_context(|| format!("failed to write {}", path.display()))
}

fn delete_file(account: &str) -> anyhow::Result<()> {
    let path = file_path(account)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err).with_context(|| format!("failed to delete {}", path.display())),
    }
}

fn get_secret(account: &str) -> anyhow::Result<Option<String>> {
    match entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => read_file(account),
        Err(err) => {
            tracing::warn!(%err, account, "keyring get failed, trying file store");
            read_file(account)
        }
    }
}

fn set_secret(account: &str, value: &str) -> anyhow::Result<()> {
    write_file(account, value)?;
    if let Err(err) = entry(account)?.set_password(value) {
        tracing::warn!(%err, account, "keyring set failed; credential kept in file store");
    }
    Ok(())
}

fn delete_secret(account: &str) -> anyhow::Result<()> {
    delete_file(account)?;
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => {
            tracing::warn!(%err, account, "keyring delete failed");
            Ok(())
        }
    }
}

pub fn get_agent_jwt() -> anyhow::Result<Option<String>> {
    get_secret(JWT_ACCOUNT)
}

pub fn set_agent_jwt(token: &str) -> anyhow::Result<()> {
    set_secret(JWT_ACCOUNT, token)
}

pub fn delete_agent_jwt() -> anyhow::Result<()> {
    delete_secret(JWT_ACCOUNT)
}

pub fn get_pairing_private_key() -> anyhow::Result<Option<String>> {
    get_secret(PAIRING_KEY_ACCOUNT)
}

pub fn set_pairing_keys(private_key_b64: &str, public_key_b64: &str) -> anyhow::Result<()> {
    set_secret(PAIRING_KEY_ACCOUNT, private_key_b64)?;
    set_secret(PAIRING_PUBKEY_ACCOUNT, public_key_b64)?;
    Ok(())
}

pub fn get_pairing_public_key() -> anyhow::Result<Option<String>> {
    get_secret(PAIRING_PUBKEY_ACCOUNT)
}
