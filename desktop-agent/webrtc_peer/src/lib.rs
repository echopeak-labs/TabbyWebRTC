mod config;
mod peer;
mod stream_registry;

pub use config::{build_webrtc_api, rtc_configuration, TurnConfig};
pub use peer::{PeerCoordinator, PeerCoordinatorConfig};
pub use stream_registry::StreamRegistry;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

use std::sync::Arc;

use capture::CaptureConfig;
use signaling::{AgentRegistration, SignalingClient};

pub async fn start_peer_stack(
    signaling_url: &str,
    jwt: &str,
    registration: AgentRegistration,
    capture_config: CaptureConfig,
    turn: Option<TurnConfig>,
) -> anyhow::Result<Arc<SignalingClient>> {
    let coordinator =
        PeerCoordinator::new(PeerCoordinatorConfig { capture: capture_config, turn })?;
    let (signaling, inbound_rx) =
        SignalingClient::connect_with_reconnect(signaling_url, jwt, registration).await?;
    let signaling = Arc::new(signaling);

    tokio::spawn(coordinator.run_inbound_loop(inbound_rx, signaling.clone()));

    Ok(signaling)
}
