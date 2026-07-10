use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Context;
use capture::{create_capturable, CaptureConfig};
use input::{create_injector, run_input_handler, InputPolicy};
use signaling::{InboundMessage, OutboundMessage, SignalingClient};
use tokio::sync::Mutex;
use tracing::{error, info, warn};
use webrtc::api::API;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::track::track_local::TrackLocal;

use crate::config::{rtc_configuration, TurnConfig};
use crate::stream_registry::StreamRegistry;

pub struct PeerCoordinatorConfig {
    pub capture: CaptureConfig,
    pub turn: Option<TurnConfig>,
    pub input_policy: InputPolicy,
}

pub struct PeerCoordinator {
    api: API,
    rtc_turn: Option<TurnConfig>,
    input_policy: InputPolicy,
    registry: Arc<Mutex<StreamRegistry>>,
    peer_connections: Arc<Mutex<HashMap<String, Arc<RTCPeerConnection>>>>,
    tab_sources: Arc<Mutex<HashMap<String, String>>>,
}

impl PeerCoordinator {
    pub fn new(config: PeerCoordinatorConfig) -> anyhow::Result<Arc<Self>> {
        let api = crate::config::build_webrtc_api()?;
        Ok(Arc::new(Self {
            api,
            rtc_turn: config.turn,
            input_policy: config.input_policy,
            registry: Arc::new(Mutex::new(StreamRegistry::new(config.capture))),
            peer_connections: Arc::new(Mutex::new(HashMap::new())),
            tab_sources: Arc::new(Mutex::new(HashMap::new())),
        }))
    }

    pub fn registry(&self) -> Arc<Mutex<StreamRegistry>> {
        self.registry.clone()
    }

    pub async fn run_inbound_loop(
        self: Arc<Self>,
        mut inbound_rx: tokio::sync::mpsc::Receiver<InboundMessage>,
        signaling: Arc<SignalingClient>,
    ) {
        while let Some(message) = inbound_rx.recv().await {
            if let Err(err) = self.clone().handle_inbound(message, signaling.clone()).await {
                error!(%err, "inbound signaling handler failed");
            }
        }
    }

    async fn handle_inbound(
        self: Arc<Self>,
        message: InboundMessage,
        signaling: Arc<SignalingClient>,
    ) -> anyhow::Result<()> {
        match message {
            InboundMessage::NotifySubscriber {
                source_id,
                browser_connection_id,
                tab_id,
            } => {
                self.handle_notify_subscriber(source_id, browser_connection_id, tab_id, signaling)
                    .await
            }
            InboundMessage::SdpAnswer { tab_id, sdp } => self.handle_sdp_answer(&tab_id, &sdp).await,
            InboundMessage::IceCandidate { tab_id, candidate } => {
                self.handle_ice_candidate(&tab_id, candidate).await
            }
            InboundMessage::NotifyUnsubscribe { tab_id, source_id } => {
                self.handle_unsubscribe(&tab_id, &source_id).await
            }
        }
    }

    async fn handle_notify_subscriber(
        self: &Arc<Self>,
        source_id: String,
        browser_connection_id: String,
        tab_id: String,
        signaling: Arc<SignalingClient>,
    ) -> anyhow::Result<()> {
        let track = {
            let mut registry = self.registry.lock().await;
            if registry.has_stream(&source_id) {
                let track = registry
                    .get_track(&source_id)
                    .context("stream missing after has_stream")?;
                registry.add_subscriber(&source_id);
                track
            } else {
                let capture_config = registry.capture_config().clone();
                let source = create_capturable(&source_id, &capture_config)
                    .with_context(|| format!("failed to open capture source {source_id}"))?;
                let track = registry.get_or_create_track(&source_id, source)?;
                registry.add_subscriber(&source_id);
                track
            }
        };

        let pc = self.create_peer_connection().await?;
        let rtp_sender = pc
            .add_track(track as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .context("add_track failed")?;

        let mut rtcp_buf = vec![0u8; 1500];
        tokio::spawn(async move {
            while rtp_sender.read(&mut rtcp_buf).await.is_ok() {}
        });

        let data_channel = pc
            .create_data_channel(
                "input_stream",
                Some(RTCDataChannelInit {
                    ordered: Some(false),
                    max_retransmits: Some(0),
                    ..Default::default()
                }),
            )
            .await
            .context("create_data_channel failed")?;

        let injector = Arc::new(Mutex::new(create_injector()?));
        run_input_handler(data_channel, injector, self.input_policy).await;

        let offer = pc.create_offer(None).await.context("create_offer failed")?;
        let offer_sdp = offer.sdp.clone();
        pc.set_local_description(offer)
            .await
            .context("set_local_description failed")?;

        signaling
            .send(&OutboundMessage::SdpOffer {
                source_id: source_id.clone(),
                sdp: offer_sdp,
                target_connection_id: browser_connection_id.clone(),
            })
            .await?;

        let signaling_for_ice = signaling.clone();
        let source_id_for_ice = source_id.clone();
        let browser_id_for_ice = browser_connection_id.clone();
        pc.on_ice_candidate(Box::new(move |candidate| {
            let signaling = signaling_for_ice.clone();
            let source_id = source_id_for_ice.clone();
            let browser_connection_id = browser_id_for_ice.clone();
            Box::pin(async move {
                if let Some(candidate) = candidate {
                    if let Ok(init) = candidate.to_json() {
                        if let Ok(json) = serde_json::to_value(init) {
                            if let Err(err) = signaling
                                .send(&OutboundMessage::IceCandidate {
                                    source_id,
                                    candidate: json,
                                    target_connection_id: browser_connection_id,
                                })
                                .await
                            {
                                warn!(%err, "failed to send ICE candidate");
                            }
                        }
                    }
                }
            })
        }));

        let coordinator = self.clone();
        let tab_id_for_ice = tab_id.clone();
        let source_id_for_ice = source_id.clone();
        pc.on_ice_connection_state_change(Box::new(move |state| {
            let coordinator = coordinator.clone();
            let tab_id = tab_id_for_ice.clone();
            let source_id = source_id_for_ice.clone();
            Box::pin(async move {
                match state {
                    webrtc::ice_transport::ice_connection_state::RTCIceConnectionState::Failed
                    | webrtc::ice_transport::ice_connection_state::RTCIceConnectionState::Disconnected => {
                        warn!(tab_id = %tab_id, ?state, "ICE connection degraded");
                        if let Err(err) = coordinator.handle_unsubscribe(&tab_id, &source_id).await {
                            error!(%err, tab_id = %tab_id, "ICE cleanup failed");
                        }
                    }
                    webrtc::ice_transport::ice_connection_state::RTCIceConnectionState::Connected => {
                        info!(tab_id = %tab_id, "ICE connected");
                    }
                    _ => {}
                }
            })
        }));

        let tab_id_for_pc = tab_id.clone();
        pc.on_peer_connection_state_change(Box::new(move |state: RTCPeerConnectionState| {
            let tab_id = tab_id_for_pc.clone();
            Box::pin(async move {
                if matches!(
                    state,
                    RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed
                ) {
                    warn!(tab_id = %tab_id, ?state, "peer connection closed");
                }
            })
        }));

        self.peer_connections
            .lock()
            .await
            .insert(tab_id.clone(), pc);
        self.tab_sources
            .lock()
            .await
            .insert(tab_id, source_id);

        Ok(())
    }

    async fn handle_sdp_answer(self: &Arc<Self>, tab_id: &str, sdp: &str) -> anyhow::Result<()> {
        let pc = self
            .peer_connections
            .lock()
            .await
            .get(tab_id)
            .cloned()
            .with_context(|| format!("no peer connection for tab {tab_id}"))?;

        let answer = RTCSessionDescription::answer(sdp.to_owned())?;
        pc.set_remote_description(answer)
            .await
            .context("set_remote_description failed")?;
        Ok(())
    }

    async fn handle_ice_candidate(
        self: &Arc<Self>,
        tab_id: &str,
        candidate: serde_json::Value,
    ) -> anyhow::Result<()> {
        let pc = self
            .peer_connections
            .lock()
            .await
            .get(tab_id)
            .cloned()
            .with_context(|| format!("no peer connection for tab {tab_id}"))?;

        let init: RTCIceCandidateInit = serde_json::from_value(candidate)?;
        pc.add_ice_candidate(init)
            .await
            .context("add_ice_candidate failed")?;
        Ok(())
    }

    async fn handle_unsubscribe(self: &Arc<Self>, tab_id: &str, source_id: &str) -> anyhow::Result<()> {
        if let Some(pc) = self.peer_connections.lock().await.remove(tab_id) {
            let _ = pc.close().await;
        }
        self.tab_sources.lock().await.remove(tab_id);

        let mut registry = self.registry.lock().await;
        registry.remove_subscriber(source_id);
        Ok(())
    }

    async fn create_peer_connection(self: &Arc<Self>) -> anyhow::Result<Arc<RTCPeerConnection>> {
        let config = rtc_configuration(self.rtc_turn.as_ref());
        Ok(Arc::new(
            self.api
                .new_peer_connection(config)
                .await
                .context("new_peer_connection failed")?,
        ))
    }
}
