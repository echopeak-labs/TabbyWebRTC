use anyhow::Context;
use base64::{engine::general_purpose::STANDARD, Engine};
use crypto_box::{aead::Aead, PublicKey, SalsaBox, SecretKey};
use sha2::{Digest, Sha512};

fn ed25519_sk_to_x25519(seed: &[u8; 32]) -> [u8; 32] {
    let hash = Sha512::digest(seed);
    let mut out = [0u8; 32];
    out.copy_from_slice(&hash[..32]);
    out[0] &= 248;
    out[31] &= 127;
    out[31] |= 64;
    out
}

pub fn decrypt_session_salt(encrypted_salt_b64: &str, private_key_b64: &str) -> anyhow::Result<Vec<u8>> {
    let combined = STANDARD
        .decode(encrypted_salt_b64)
        .context("encryptedSalt base64 decode failed")?;
    if combined.len() < 32 + 24 + 16 {
        anyhow::bail!("encryptedSalt too short");
    }

    let ephemeral_pk_bytes: [u8; 32] = combined[..32]
        .try_into()
        .context("ephemeral public key length")?;
    let nonce_bytes: [u8; 24] = combined[32..56]
        .try_into()
        .context("nonce length")?;
    let ciphertext = &combined[56..];

    let ed_seed = STANDARD
        .decode(private_key_b64)
        .context("pairing private key base64 decode failed")?;
    let ed_seed: [u8; 32] = ed_seed
        .as_slice()
        .try_into()
        .context("pairing private key must be 32 bytes")?;
    let x_sk = ed25519_sk_to_x25519(&ed_seed);

    let secret = SecretKey::from(x_sk);
    let ephemeral = PublicKey::from(ephemeral_pk_bytes);
    let box_ = SalsaBox::new(&ephemeral, &secret);
    box_
        .decrypt((&nonce_bytes).into(), ciphertext)
        .map_err(|_| anyhow::anyhow!("session salt decrypt failed"))
}

pub fn verify_encrypted_salt(
    encrypted_salt: Option<&str>,
    private_key_b64: Option<&str>,
    required: bool,
) -> anyhow::Result<()> {
    match (encrypted_salt, private_key_b64, required) {
        (Some(salt), Some(sk), _) => {
            let plain = decrypt_session_salt(salt, sk)?;
            if plain.len() < 16 {
                anyhow::bail!("session salt too short");
            }
            Ok(())
        }
        (_, _, true) => anyhow::bail!("session crypto required but salt/key missing"),
        _ => Ok(()),
    }
}
