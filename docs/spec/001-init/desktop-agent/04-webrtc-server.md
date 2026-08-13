# Desktop Agent — WebRTC Server SDD

## Scope

Defines how the desktop agent manages WebRTC peer connections: signaling message handling, PeerConnection lifecycle, SDP negotiation (agent-as-offerer), ICE configuration, stream registry, and source subscription locking.

---

## Role: Agent as Offerer

The desktop agent always generates the SDP Offer. The browser always generates the SDP Answer. This is the reverse of a typical browser-to-browser call, and is intentional:

- The agent knows the exact codec capabilities and hardware encoder in use.
- The agent's SDP offer pre-negotiates H.264 Baseline profile, eliminating codec mismatch failures.

---

## `StreamRegistry`

Tracks all active capture loops and their subscribers. Prevents duplicate encoder instances.

```rust
pub struct StreamRegistry {
    streams: HashMap<String, ActiveStream>,
}

struct ActiveStream {
    track: Arc<TrackLocalStaticSample>,
    capture_shutdown: CancellationToken,
    subscriber_count: usize,
}

impl StreamRegistry {
    pub fn get_or_create_track(&mut self, source_id: &str, source: Box<dyn Capturable>) -> Arc<TrackLocalStaticSample>;
    pub fn add_subscriber(&mut self, source_id: &str);
    pub fn remove_subscriber(&mut self, source_id: &str);
    pub fn subscriber_count(&self, source_id: &str) -> usize;
}
```

When `remove_subscriber` drops the count to 0:
1. Fire `CancellationToken::cancel()` to stop the capture loop task.
2. Remove the `ActiveStream` entry from the registry.

---

## Peer Connection Lifecycle

### On `NOTIFY_SUBSCRIBER` (from signaling server)

Triggered when a browser tab selects a source.

```rust
async fn handle_notify_subscriber(
    source_id: String,
    browser_connection_id: String,
    tab_id: String,
    registry: Arc<Mutex<StreamRegistry>>,
    signaling: Arc<SignalingClient>,
    config: &AgentConfig,
) {
    let track = {
        let mut reg = registry.lock().await;
        let source = enumerate_source(&source_id).unwrap();
        reg.get_or_create_track(&source_id, source)
    };

    let pc = create_peer_connection(config).await;
    pc.add_track(track).await.unwrap();

    let data_channel = pc.create_data_channel("input_stream", DataChannelConfig {
        ordered: Some(false),
        max_retransmits: Some(0),
        ..Default::default()
    }).await.unwrap();

    setup_input_handler(data_channel, &source_id).await;

    let offer = pc.create_offer(None).await.unwrap();
    pc.set_local_description(offer.clone()).await.unwrap();

    signaling.send(SignalMessage::SdpOffer {
        source_id: source_id.clone(),
        sdp: offer,
        target_connection_id: browser_connection_id,
    }).await;

    pc.on_ice_candidate(Box::new(move |candidate| {
        let signaling = signaling.clone();
        let source_id = source_id.clone();
        let browser_connection_id = browser_connection_id.clone();
        Box::pin(async move {
            if let Some(c) = candidate {
                signaling.send(SignalMessage::IceCandidate {
                    source_id,
                    candidate: c.to_json().unwrap(),
                    target_connection_id: browser_connection_id,
                }).await;
            }
        })
    }));

    PEER_CONNECTIONS.insert(tab_id, pc);
}
```

### On `SDP_ANSWER` (from browser via signaling server)

```rust
async fn handle_sdp_answer(tab_id: &str, sdp: RTCSessionDescription) {
    let pc = PEER_CONNECTIONS.get(tab_id).unwrap();
    pc.set_remote_description(sdp).await.unwrap();
}
```

### On `ICE_CANDIDATE` (from browser via signaling server)

```rust
async fn handle_ice_candidate(tab_id: &str, candidate: RTCIceCandidateInit) {
    let pc = PEER_CONNECTIONS.get(tab_id).unwrap();
    pc.add_ice_candidate(candidate).await.unwrap();
}
```

### On `NOTIFY_UNSUBSCRIBE` (from signaling server)

```rust
async fn handle_unsubscribe(tab_id: &str, source_id: &str) {
    if let Some(pc) = PEER_CONNECTIONS.remove(tab_id) {
        pc.close().await.unwrap();
    }
    let mut reg = registry.lock().await;
    reg.remove_subscriber(source_id);
}
```

---

## RTCPeerConnection Configuration

```rust
let rtc_config = RTCConfiguration {
    ice_servers: vec![
        RTCIceServer {
            urls: vec!["stun:stun.l.google.com:19302".to_string()],
            ..Default::default()
        },
        RTCIceServer {
            urls: vec![format!("turn:{}", config.turn_url)],
            username: turn_creds.username,
            credential: turn_creds.credential,
            credential_type: RTCIceCredentialType::Password,
        },
    ],
    bundle_policy: RTCBundlePolicy::MaxBundle,
    rtcp_mux_policy: RTCRtcpMuxPolicy::Require,
    ..Default::default()
};
```

---

## SDP H.264 Negotiation

The agent constrains the SDP offer to H.264 Baseline profile only:

```rust
fn build_sdp_offer(track: &TrackLocalStaticSample) -> RTCSessionDescription {
    // webrtc-rs generates SDP automatically from added tracks.
    // Codec preference is set via RTCRtpCodecCapability:
    let codec = RTCRtpCodecCapability {
        mime_type: MIME_TYPE_H264.to_owned(),
        clock_rate: 90000,
        sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f".to_owned(),
        ..Default::default()
    };
    // Register codec with the media engine before creating PeerConnection
    media_engine.register_codec(codec, RTPCodecType::Video).unwrap();
}
```

`profile-level-id=42001f` = H.264 Baseline Profile, Level 3.1 (universally supported by all browsers).

---

## ICE Connectivity Monitoring

After connection establishment, monitor ICE state:

```rust
pc.on_ice_connection_state_change(Box::new(move |state: RTCIceConnectionState| {
    Box::pin(async move {
        match state {
            RTCIceConnectionState::Failed | RTCIceConnectionState::Disconnected => {
                tracing::warn!("ICE connection failed for tab {}", tab_id);
                // Trigger cleanup via drop of PeerConnection
            }
            RTCIceConnectionState::Connected => {
                tracing::info!("ICE connected for tab {}", tab_id);
            }
            _ => {}
        }
    })
}));
```

---

## Signaling Client (`SignalingClient`)

```rust
pub struct SignalingClient {
    sender: mpsc::Sender<SignalMessage>,
}

impl SignalingClient {
    pub async fn connect(url: &str, agent_jwt: &str) -> anyhow::Result<Self>;
    pub async fn send(&self, msg: SignalMessage) -> anyhow::Result<()>;
}
```

- Maintains a persistent WebSocket connection to AWS API Gateway.
- Reconnects automatically with exponential backoff (2 s, 4 s, 8 s, 16 s, max 60 s) on disconnection.
- All outbound messages are queued in an `mpsc` channel and drained by a dedicated send task.
- On reconnect, re-sends `AGENT_REGISTER` to restore server-side state.

---

## Non-Functional Requirements

- P2P connection establishment (ICE + DTLS) must complete within 5 s on LAN.
- Signaling reconnect must not drop active peer connections — existing WebRTC sessions survive a signaling WebSocket drop.
- `StreamRegistry` must be safe for concurrent access from multiple `PeerManager` tasks.
- Memory usage per active stream (1080p60): < 20 MB (encoder buffers + RTP packetizer).
