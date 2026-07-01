use std::path::{Path, PathBuf};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub agent: AgentSection,
    pub signaling: SignalingSection,
    pub capture: CaptureSection,
    pub http: HttpSection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSection {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalingSection {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureSection {
    pub encoder: String,
    pub max_fps: u32,
    pub hide_cursor: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpSection {
    pub thumbnail_port: u16,
    pub bind: String,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            agent: AgentSection {
                id: Uuid::new_v4().to_string(),
                name: "TabbyWebRTC Agent".into(),
            },
            signaling: SignalingSection {
                url: "wss://signal.tabbywebrtc.com/prod".into(),
            },
            capture: CaptureSection {
                encoder: "auto".into(),
                max_fps: 60,
                hide_cursor: true,
            },
            http: HttpSection {
                thumbnail_port: 7700,
                bind: "0.0.0.0".into(),
            },
        }
    }
}

pub fn default_config_path() -> anyhow::Result<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let app_data = std::env::var("APPDATA").context("APPDATA not set")?;
        Ok(Path::new(&app_data).join("TabbyWebRTC").join("agent.toml"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").context("HOME not set")?;
        Ok(Path::new(&home).join(".config").join("tabbywebrtc").join("agent.toml"))
    }
}

pub fn load_or_create(path: &Path) -> anyhow::Result<AgentConfig> {
    if path.exists() {
        let contents = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read config at {}", path.display()))?;
        let config: AgentConfig = toml::from_str(&contents).context("invalid config TOML")?;
        return Ok(config);
    }

    let config = AgentConfig::default();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create config dir {}", parent.display()))?;
    }
    let contents = toml::to_string_pretty(&config)?;
    std::fs::write(path, contents)
        .with_context(|| format!("failed to write default config to {}", path.display()))?;
    Ok(config)
}

pub fn save(path: &Path, config: &AgentConfig) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let contents = toml::to_string_pretty(config)?;
    std::fs::write(path, contents)?;
    Ok(())
}
