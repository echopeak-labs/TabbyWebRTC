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
use input::InputPolicy;
use signaling::{AgentRegistration, SignalingClient};
use tokio::sync::Mutex;

pub struct PeerStack {
    pub signaling: Arc<SignalingClient>,
    pub registry: Arc<Mutex<StreamRegistry>>,
}

pub async fn start_peer_stack(
    signaling_url: &str,
    jwt: &str,
    registration: AgentRegistration,
    capture_config: CaptureConfig,
    turn: Option<TurnConfig>,
    input_policy: InputPolicy,
) -> anyhow::Result<PeerStack> {
    let coordinator = PeerCoordinator::new(PeerCoordinatorConfig {
        capture: capture_config,
        turn,
        input_policy,
    })?;
    let registry = coordinator.registry();
    let (signaling, inbound_rx) =
        SignalingClient::connect_with_reconnect(signaling_url, jwt, registration).await?;
    let signaling = Arc::new(signaling);

    tokio::spawn(coordinator.run_inbound_loop(inbound_rx, signaling.clone()));

    Ok(PeerStack {
        signaling,
        registry,
    })
}
