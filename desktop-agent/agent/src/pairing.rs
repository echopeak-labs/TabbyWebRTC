use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, RwLock};
use tracing::info;

use crate::config::AgentConfig;
use crate::keychain;

#[derive(Clone)]
pub struct PairingState {
    pub agent_id: String,
    pub public_key_b64: String,
    pub jwt_tx: Arc<RwLock<Option<oneshot::Sender<String>>>>,
}

#[derive(Deserialize)]
pub struct PairCompleteRequest {
    pub token: String,
}

pub async fn run_pairing_flow(config: &AgentConfig) -> anyhow::Result<()> {
    let public_key_b64 = if let Some(existing) = keychain::get_pairing_public_key()? {
        existing
    } else {
        let signing_key = SigningKey::generate(&mut OsRng);
        let private_bytes = signing_key.to_bytes();
        let public_bytes = signing_key.verifying_key().to_bytes();
        let private_b64 = STANDARD.encode(private_bytes);
        let public_b64 = STANDARD.encode(public_bytes);
        keychain::set_pairing_keys(&private_b64, &public_b64)?;
        public_b64
    };

    let pairing_url = format!(
        "https://app.tabbyrdp.com/pair?agentId={}&pubkey={}",
        config.agent.id, public_key_b64
    );

    info!("No agent JWT found in OS keychain");
    println!();
    println!("TabbyRDP agent is not paired.");
    println!("Open this URL on a signed-in device to pair:");
    println!("  {pairing_url}");
    println!();
    println!("Waiting for pairing (local callback on port {})...", config.http.thumbnail_port);

    let (jwt_tx, jwt_rx) = oneshot::channel();
    let state = PairingState {
        agent_id: config.agent.id.clone(),
        public_key_b64,
        jwt_tx: Arc::new(RwLock::new(Some(jwt_tx))),
    };

    let bind = format!("{}:{}", config.http.bind, config.http.thumbnail_port);
    let app = Router::new()
        .route("/pair", post(complete_pairing))
        .route("/pair/status", get(pairing_status))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .with_context(|| format!("failed to bind pairing server on {bind}"))?;

    let server = tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, app).await {
            tracing::error!(%err, "pairing server failed");
        }
    });

    let token = tokio::time::timeout(Duration::from_secs(600), jwt_rx)
        .await
        .context("pairing timed out after 10 minutes")?
        .context("pairing channel closed")?;

    server.abort();

    keychain::set_agent_jwt(&token)?;
    println!("Pairing complete. Restart the agent to connect.");
    Ok(())
}

async fn complete_pairing(
    State(state): State<PairingState>,
    Json(body): Json<PairCompleteRequest>,
) -> Json<PairingStatus> {
    if body.token.is_empty() {
        return Json(PairingStatus {
            ok: false,
            message: "token required".into(),
        });
    }

    let mut slot = state.jwt_tx.write().await;
    if let Some(tx) = slot.take() {
        let _ = tx.send(body.token);
        Json(PairingStatus {
            ok: true,
            message: "paired".into(),
        })
    } else {
        Json(PairingStatus {
            ok: false,
            message: "pairing already completed".into(),
        })
    }
}

#[derive(Serialize)]
pub struct PairingStatus {
    pub ok: bool,
    pub message: String,
}

async fn pairing_status(State(state): State<PairingState>) -> Json<PairingStatusResponse> {
    Json(PairingStatusResponse {
        agent_id: state.agent_id,
        public_key: state.public_key_b64,
        paired: false,
    })
}

#[derive(Serialize)]
pub struct PairingStatusResponse {
    pub agent_id: String,
    pub public_key: String,
    pub paired: bool,
}
