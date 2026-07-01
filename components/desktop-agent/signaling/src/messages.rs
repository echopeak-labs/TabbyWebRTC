use capture::{SourceDescriptor, SourceKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InboundMessage {
    NotifySubscriber {
        source_id: String,
        browser_connection_id: String,
        tab_id: String,
    },
    SdpAnswer {
        tab_id: String,
        sdp: String,
    },
    IceCandidate {
        tab_id: String,
        candidate: serde_json::Value,
    },
    NotifyUnsubscribe {
        tab_id: String,
        source_id: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OutboundMessage {
    AgentRegister {
        agent_id: String,
        public_key: String,
        platform: String,
        displays: Vec<SourcePayload>,
        apps: Vec<SourcePayload>,
        local_endpoint: String,
    },
    AgentHeartbeat {
        agent_id: String,
    },
    SdpOffer {
        source_id: String,
        sdp: String,
        target_connection_id: String,
    },
    IceCandidate {
        source_id: String,
        candidate: serde_json::Value,
        target_connection_id: String,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct SourcePayload {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
}

impl From<&SourceDescriptor> for SourcePayload {
    fn from(source: &SourceDescriptor) -> Self {
        Self {
            id: source.id.clone(),
            name: source.name.clone(),
            width: source.width,
            height: source.height,
        }
    }
}

pub fn partition_sources(sources: &[SourceDescriptor]) -> (Vec<SourcePayload>, Vec<SourcePayload>) {
    let mut displays = Vec::new();
    let mut apps = Vec::new();
    for source in sources {
        let payload = SourcePayload::from(source);
        match source.kind {
            SourceKind::Display => displays.push(payload),
            SourceKind::App => apps.push(payload),
        }
    }
    (displays, apps)
}
