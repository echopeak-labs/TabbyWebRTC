use std::sync::Arc;

use anyhow::Context;
use capture::SourceDescriptor;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
use tracing::{debug, error, info, warn};

use crate::messages::{partition_sources, OutboundMessage};

pub struct SignalingClient {
    outbound: mpsc::Sender<String>,
}

impl SignalingClient {
    pub async fn connect(
        url: &str,
        jwt: &str,
        mut inbound_rx: mpsc::Receiver<String>,
    ) -> anyhow::Result<Self> {
        let mut request = url.into_client_request()?;
        request
            .headers_mut()
            .insert("Authorization", format!("Bearer {jwt}").parse()?);

        let (ws_stream, _) = connect_async(request)
            .await
            .with_context(|| format!("failed to connect to signaling server at {url}"))?;

        let (write, mut read) = ws_stream.split();
        let write = Arc::new(Mutex::new(write));
        let (outbound_tx, mut outbound_rx) = mpsc::channel::<String>(64);

        let write_clone = write.clone();
        tokio::spawn(async move {
            while let Some(msg) = outbound_rx.recv().await {
                let mut sink = write_clone.lock().await;
                if let Err(err) = sink.send(Message::Text(msg)).await {
                    error!(%err, "signaling send failed");
                    break;
                }
            }
        });

        tokio::spawn(async move {
            while let Some(result) = read.next().await {
                match result {
                    Ok(Message::Text(text)) => {
                        debug!(payload = %text, "signaling inbound");
                    }
                    Ok(Message::Close(_)) => {
                        warn!("signaling connection closed");
                        break;
                    }
                    Ok(_) => {}
                    Err(err) => {
                        error!(%err, "signaling read failed");
                        break;
                    }
                }
            }
        });

        tokio::spawn(async move {
            while let Some(msg) = inbound_rx.recv().await {
                let mut sink = write.lock().await;
                if let Err(err) = sink.send(Message::Text(msg)).await {
                    error!(%err, "signaling relay send failed");
                    break;
                }
            }
        });

        Ok(Self {
            outbound: outbound_tx,
        })
    }

    pub async fn send(&self, message: &OutboundMessage) -> anyhow::Result<()> {
        let payload = serde_json::to_string(message)?;
        self.outbound
            .send(payload)
            .await
            .context("signaling outbound channel closed")
    }

    pub async fn send_agent_register(
        &self,
        agent_id: &str,
        public_key: &str,
        platform: &str,
        sources: &[SourceDescriptor],
        local_endpoint: &str,
    ) -> anyhow::Result<()> {
        let (displays, apps) = partition_sources(sources);
        self.send(&OutboundMessage::AgentRegister {
            agent_id: agent_id.to_string(),
            public_key: public_key.to_string(),
            platform: platform.to_string(),
            displays,
            apps,
            local_endpoint: local_endpoint.to_string(),
        })
        .await
    }

    pub async fn send_heartbeat(&self, agent_id: &str) -> anyhow::Result<()> {
        self.send(&OutboundMessage::AgentHeartbeat {
            agent_id: agent_id.to_string(),
        })
        .await
    }
}

pub async fn run_heartbeat_loop(client: Arc<SignalingClient>, agent_id: String) {
    let interval = tokio::time::Duration::from_secs(9 * 60);
    loop {
        tokio::time::sleep(interval).await;
        if let Err(err) = client.send_heartbeat(&agent_id).await {
            error!(%err, "heartbeat failed");
        } else {
            info!(agent_id = %agent_id, "heartbeat sent");
        }
    }
}
