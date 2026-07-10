use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use rand::Rng;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tracing::{debug, error, info, warn};

use crate::config::UpdatesSection;

#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    artifacts: std::collections::HashMap<String, Artifact>,
}

#[derive(Debug, Deserialize)]
struct Artifact {
    filename: String,
    sha256: String,
}

pub fn platform_key() -> &'static str {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return "linux-x86_64";
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return "linux-aarch64";
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return "macos-x86_64";
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return "macos-aarch64";
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return "windows-x86_64";
    }
    #[cfg(not(any(
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64"),
    )))]
    compile_error!("unsupported platform for auto-update");
}

pub async fn run_update_loop(
    config: UpdatesSection,
    idle_check: Arc<dyn Fn() -> bool + Send + Sync>,
) {
    if !config.enabled {
        info!("auto-update disabled");
        return;
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            error!(%err, "failed to build update HTTP client");
            return;
        }
    };

    loop {
        let secs = rand::thread_rng().gen_range(7200..=14400);
        tokio::time::sleep(Duration::from_secs(secs)).await;

        if !config.enabled {
            continue;
        }

        if let Err(err) = check_and_apply(&client, &config, idle_check.clone()).await {
            warn!(%err, "auto-update check failed");
        }
    }
}

async fn check_and_apply(
    client: &reqwest::Client,
    config: &UpdatesSection,
    idle_check: Arc<dyn Fn() -> bool + Send + Sync>,
) -> anyhow::Result<()> {
    let base = config.base_url.trim_end_matches('/');
    let manifest_url = format!("{base}/updates/manifest.json");
    let response = client
        .get(&manifest_url)
        .send()
        .await
        .context("manifest request failed")?;
    if !response.status().is_success() {
        anyhow::bail!("manifest HTTP {}", response.status());
    }

    let manifest: Manifest = response.json().await.context("manifest parse failed")?;
    let remote = semver::Version::parse(&manifest.version).context("invalid remote version")?;
    let local = semver::Version::parse(env!("CARGO_PKG_VERSION")).context("invalid local version")?;
    if remote <= local {
        debug!(%remote, %local, "agent is up to date");
        return Ok(());
    }

    if !idle_check() {
        info!(%remote, "update deferred, streams active");
        return Ok(());
    }

    let key = platform_key();
    let artifact = manifest
        .artifacts
        .get(key)
        .with_context(|| format!("manifest missing artifact for {key}"))?;

    let download_url = format!("{base}/downloads/{key}");
    let bytes = client
        .get(&download_url)
        .send()
        .await
        .context("download request failed")?
        .bytes()
        .await
        .context("download body failed")?;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = format!("{:x}", hasher.finalize());
    if digest != artifact.sha256.to_lowercase() {
        anyhow::bail!("sha256 mismatch: expected {} got {digest}", artifact.sha256);
    }

    let dir = std::env::temp_dir().join("tabbywebrtc-update");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(&artifact.filename);
    std::fs::write(&path, &bytes)?;

    info!(%remote, path = %path.display(), "installing update");
    silent_install(&path).await?;
    restart_agent().await?;
    Ok(())
}

async fn silent_install(path: &PathBuf) -> anyhow::Result<()> {
    #[cfg(target_os = "linux")]
    {
        let status = tokio::process::Command::new("dpkg")
            .arg("-i")
            .arg(path)
            .status()
            .await
            .context("dpkg failed to start")?;
        if !status.success() {
            anyhow::bail!("dpkg exited with {status}");
        }
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let status = tokio::process::Command::new("msiexec")
            .args(["/i", &path.to_string_lossy(), "/quiet", "/norestart"])
            .status()
            .await
            .context("msiexec failed to start")?;
        if !status.success() {
            anyhow::bail!("msiexec exited with {status}");
        }
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let status = tokio::process::Command::new("installer")
            .args(["-pkg", &path.to_string_lossy(), "-target", "/"])
            .status()
            .await
            .context("installer failed to start")?;
        if !status.success() {
            anyhow::bail!("installer exited with {status}");
        }
        return Ok(());
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        let _ = path;
        anyhow::bail!("unsupported platform for install");
    }
}

async fn restart_agent() -> anyhow::Result<()> {
    info!("update applied, restarting");
    #[cfg(target_os = "linux")]
    {
        let _ = tokio::process::Command::new("systemctl")
            .args(["restart", "tabbywebrtc-agent"])
            .status()
            .await;
        std::process::exit(0);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = tokio::process::Command::new("launchctl")
            .args(["kickstart", "-k", "system/com.tabbywebrtc.agent"])
            .status()
            .await;
        std::process::exit(0);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = tokio::process::Command::new("cmd")
            .args(["/C", "timeout /t 2 && net start TabbyWebRTCAgent"])
            .spawn();
        std::process::exit(0);
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        Ok(())
    }
}
