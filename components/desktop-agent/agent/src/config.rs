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
    #[serde(default)]
    pub input: InputSection,
    #[serde(default)]
    pub updates: UpdatesSection,
    #[serde(default)]
    pub session_crypto: SessionCryptoSection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSection {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalingSection {
    pub url: String,
    #[serde(default)]
    pub api_url: String,
}

impl AgentConfig {
    pub fn api_base_url(&self) -> String {
        let configured = self.signaling.api_url.trim();
        if !configured.is_empty() {
            return configured.trim_end_matches('/').to_string();
        }
        let ws = self.signaling.url.trim();
        if let Some(rest) = ws.strip_prefix("ws://") {
            return format!("http://{}", rest.trim_end_matches('/'));
        }
        if let Some(rest) = ws.strip_prefix("wss://") {
            return format!("https://{}", rest.trim_end_matches('/'));
        }
        String::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureSection {
    pub encoder: String,
    pub max_fps: u32,
    pub hide_cursor: bool,
    #[serde(default = "default_max_width")]
    pub max_width: u32,
}

fn default_max_width() -> u32 {
    0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpSection {
    pub thumbnail_port: u16,
    pub bind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputSection {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub allow_remote_power: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatesSection {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_update_base_url")]
    pub base_url: String,
    #[serde(default = "default_update_channel")]
    pub channel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionCryptoSection {
    #[serde(default)]
    pub required: bool,
}

fn default_true() -> bool {
    true
}

fn default_update_base_url() -> String {
    option_env!("TABBYWEBRTC_UPDATE_BASE_URL")
        .unwrap_or("https://REPLACE_DEV_REST_URL/")
        .to_string()
}

fn default_update_channel() -> String {
    "dev".into()
}

impl Default for InputSection {
    fn default() -> Self {
        Self {
            enabled: true,
            allow_remote_power: false,
        }
    }
}

impl Default for UpdatesSection {
    fn default() -> Self {
        Self {
            enabled: true,
            base_url: default_update_base_url(),
            channel: default_update_channel(),
        }
    }
}

impl Default for SessionCryptoSection {
    fn default() -> Self {
        Self { required: false }
    }
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
                api_url: "https://api.tabbywebrtc.com/prod".into(),
            },
            capture: CaptureSection {
                encoder: "auto".into(),
                max_fps: 30,
                hide_cursor: true,
                max_width: 0,
            },
            http: HttpSection {
                thumbnail_port: 7700,
                bind: "0.0.0.0".into(),
            },
            input: InputSection::default(),
            updates: UpdatesSection::default(),
            session_crypto: SessionCryptoSection::default(),
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
