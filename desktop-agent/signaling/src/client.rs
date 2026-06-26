use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use capture::SourceDescriptor;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
use tracing::{debug, error, info, warn};

use crate::messages::{partition_sources, InboundMessage, OutboundMessage};

const BACKOFF_SECONDS: [u64; 5] = [2, 4, 8, 16, 60];

#[derive(Debug, Clone)]
pub struct AgentRegistration {
    pub agent_id: String,
    pub public_key: String,
    pub platform: String,
    pub sources: Arc<RwLock<Vec<SourceDescriptor>>>,
    pub local_endpoint: String,
}

type WsWrite = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    Message,
>;

pub struct SignalingClient {
    outbound: mpsc::Sender<String>,
}

impl SignalingClient {
    pub async fn connect(
        url: &str,
        jwt: &str,
        mut relay_rx: mpsc::Receiver<String>,
    ) -> anyhow::Result<Self> {
        let (client, _inbound_rx) = Self::connect_with_reconnect(
            url,
            jwt,
            AgentRegistration {
                agent_id: String::new(),
                public_key: String::new(),
                platform: String::new(),
                sources: Arc::new(RwLock::new(Vec::new())),
                local_endpoint: String::new(),
            },
        )
        .await?;

        let outbound = client.outbound.clone();
        tokio::spawn(async move {
            while let Some(msg) = relay_rx.recv().await {
                if outbound.send(msg).await.is_err() {
                    break;
                }
            }
        });

        Ok(client)
    }

    pub async fn connect_with_reconnect(
        url: &str,
        jwt: &str,
        registration: AgentRegistration,
    ) -> anyhow::Result<(Self, mpsc::Receiver<InboundMessage>)> {
        let (outbound_tx, mut outbound_rx) = mpsc::channel::<String>(64);
        let (inbound_tx, inbound_rx) = mpsc::channel::<InboundMessage>(64);
        let ws_write: Arc<Mutex<Option<WsWrite>>> = Arc::new(Mutex::new(None));

        let ws_write_for_outbound = ws_write.clone();
        tokio::spawn(async move {
            while let Some(msg) = outbound_rx.recv().await {
                let mut guard = ws_write_for_outbound.lock().await;
                if let Some(sink) = guard.as_mut() {
                    if let Err(err) = sink.send(Message::Text(msg)).await {
                        error!(%err, "signaling send failed");
                    }
                }
            }
        });

        let url = url.to_string();
        let jwt = jwt.to_string();

        tokio::spawn(async move {
            Self::run_reconnect_loop(url, jwt, registration, ws_write, inbound_tx).await;
        });

        Ok((Self { outbound: outbound_tx }, inbound_rx))
    }

    async fn run_reconnect_loop(
        url: String,
        jwt: String,
        registration: AgentRegistration,
        ws_write: Arc<Mutex<Option<WsWrite>>>,
        inbound_tx: mpsc::Sender<InboundMessage>,
    ) {
        let mut backoff_idx = 0usize;

        loop {
            match Self::connect_once(&url, &jwt, &registration, &ws_write, &inbound_tx).await {
                Ok(()) => {
                    backoff_idx = 0;
                    warn!("signaling websocket closed, reconnecting");
                }
                Err(err) => {
                    error!(%err, "signaling connection error");
                }
            }

            {
                let mut guard = ws_write.lock().await;
                *guard = None;
            }

            let delay = BACKOFF_SECONDS[backoff_idx.min(BACKOFF_SECONDS.len() - 1)];
            tokio::time::sleep(Duration::from_secs(delay)).await;
            backoff_idx = (backoff_idx + 1).min(BACKOFF_SECONDS.len() - 1);
        }
    }

    async fn connect_once(
        url: &str,
        jwt: &str,
        registration: &AgentRegistration,
        ws_write: &Arc<Mutex<Option<WsWrite>>>,
        inbound_tx: &mpsc::Sender<InboundMessage>,
    ) -> anyhow::Result<()> {
        let mut request = url.into_client_request()?;
        request
            .headers_mut()
            .insert("Authorization", format!("Bearer {jwt}").parse()?);

        let (ws_stream, _) = connect_async(request)
            .await
            .with_context(|| format!("failed to connect to signaling server at {url}"))?;

        info!(url, "signaling connected");

        let (write, mut read) = ws_stream.split();
        {
            let mut guard = ws_write.lock().await;
            *guard = Some(write);
        }

        let sources = registration.sources.read().await.clone();
        let (displays, apps) = partition_sources(&sources);
        let register = OutboundMessage::AgentRegister {
            agent_id: registration.agent_id.clone(),
            public_key: registration.public_key.clone(),
            platform: registration.platform.clone(),
            displays,
            apps,
            local_endpoint: registration.local_endpoint.clone(),
        };
        Self::send_raw(ws_write, &serde_json::to_string(&register)?).await?;

        while let Some(result) = read.next().await {
            match result {
                Ok(Message::Text(text)) => {
                    debug!(payload = %text, "signaling inbound");
                    match serde_json::from_str::<InboundMessage>(&text) {
                        Ok(message) => {
                            if inbound_tx.send(message).await.is_err() {
                                break;
                            }
                        }
                        Err(err) => {
                            warn!(%err, payload = %text, "ignored unrecognized signaling message");
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    warn!("signaling connection closed by server");
                    break;
                }
                Ok(_) => {}
                Err(err) => {
                    error!(%err, "signaling read failed");
                    break;
                }
            }
        }

        Ok(())
    }

    async fn send_raw(ws_write: &Arc<Mutex<Option<WsWrite>>>, payload: &str) -> anyhow::Result<()> {
        let mut guard = ws_write.lock().await;
        let sink = guard
            .as_mut()
            .context("signaling websocket not connected")?;
        sink.send(Message::Text(payload.to_string())).await?;
        Ok(())
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
