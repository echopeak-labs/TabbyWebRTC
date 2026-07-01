use anyhow::Context;
use keyring::Entry;

const SERVICE: &str = "tabbywebrtc-agent";
const JWT_ACCOUNT: &str = "agent-jwt";
const PAIRING_KEY_ACCOUNT: &str = "pairing-private-key";
const PAIRING_PUBKEY_ACCOUNT: &str = "pairing-public-key";

fn entry(account: &str) -> anyhow::Result<Entry> {
    Entry::new(SERVICE, account).context("failed to open keychain entry")
}

pub fn get_agent_jwt() -> anyhow::Result<Option<String>> {
    match entry(JWT_ACCOUNT)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

pub fn set_agent_jwt(token: &str) -> anyhow::Result<()> {
    entry(JWT_ACCOUNT)?
        .set_password(token)
        .context("failed to store agent JWT in keychain")
}

pub fn delete_agent_jwt() -> anyhow::Result<()> {
    match entry(JWT_ACCOUNT)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

pub fn get_pairing_private_key() -> anyhow::Result<Option<String>> {
    match entry(PAIRING_KEY_ACCOUNT)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

pub fn set_pairing_keys(private_key_b64: &str, public_key_b64: &str) -> anyhow::Result<()> {
    entry(PAIRING_KEY_ACCOUNT)?
        .set_password(private_key_b64)
        .context("failed to store pairing private key")?;
    entry(PAIRING_PUBKEY_ACCOUNT)?
        .set_password(public_key_b64)
        .context("failed to store pairing public key")?;
    Ok(())
}

pub fn get_pairing_public_key() -> anyhow::Result<Option<String>> {
    match entry(PAIRING_PUBKEY_ACCOUNT)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}
