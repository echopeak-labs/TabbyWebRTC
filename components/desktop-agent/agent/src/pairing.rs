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
use qrcode::render::unicode::Dense1x2;
use qrcode::QrCode;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, RwLock};
use tower_http::cors::CorsLayer;
use tracing::info;
use uuid::Uuid;

use crate::config::AgentConfig;
use crate::keychain;
use input::platform_name;

#[derive(Clone)]
pub struct PairingState {
    pub agent_id: String,
    pub public_key_b64: String,
    pub pairing_nonce: String,
    pub jwt_tx: Arc<RwLock<Option<oneshot::Sender<String>>>>,
}

#[derive(Deserialize)]
pub struct PairCompleteRequest {
    pub token: String,
    pub nonce: String,
}

#[derive(Serialize)]
struct PairQrPayload {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(rename = "agentId")]
    agent_id: String,
    #[serde(rename = "publicKey")]
    public_key: String,
    platform: String,
    name: String,
    #[serde(rename = "localEndpoint")]
    local_endpoint: String,
    #[serde(rename = "pairingNonce")]
    pairing_nonce: String,
}

fn detect_lan_ip() -> String {
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".into()
}

fn render_qr_body(data: &str) -> anyhow::Result<String> {
    let code = QrCode::new(data.as_bytes()).context("failed to encode pairing QR")?;
    Ok(code.render::<Dense1x2>().quiet_zone(true).build())
}

fn pad_qr_lines(qr: &str, pad: usize) -> Vec<String> {
    let side = " ".repeat(pad);
    let lines: Vec<&str> = qr.lines().collect();
    let width = lines.iter().map(|line| line.chars().count()).max().unwrap_or(0) + pad * 2;
    let blank = " ".repeat(width);
    let mut out = Vec::with_capacity(lines.len() + pad * 2);
    for _ in 0..pad {
        out.push(blank.clone());
    }
    for line in lines {
        out.push(format!("{side}{line}{side}"));
    }
    for _ in 0..pad {
        out.push(blank.clone());
    }
    out
}

fn style_qr_lines(lines: &[String]) -> String {
    const WHITE_BG_BLACK_FG: &str = "\x1b[48;5;231m\x1b[38;5;16m";
    const RESET: &str = "\x1b[0m";
    lines
        .iter()
        .map(|line| format!("{WHITE_BG_BLACK_FG}{line}{RESET}"))
        .collect::<Vec<_>>()
        .join("\n")
}

pub async fn run_pairing_flow(config: &AgentConfig) -> anyhow::Result<String> {
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

    let pairing_nonce = Uuid::new_v4().to_string();
    let lan_ip = detect_lan_ip();
    let local_endpoint = format!("http://{}:{}", lan_ip, config.http.thumbnail_port);
    let qr_payload = PairQrPayload {
        kind: "PAIR",
        agent_id: config.agent.id.clone(),
        public_key: public_key_b64.clone(),
        platform: platform_name().to_string(),
        name: config.agent.name.clone(),
        local_endpoint: local_endpoint.clone(),
        pairing_nonce: pairing_nonce.clone(),
    };
    let qr_json = serde_json::to_string(&qr_payload).context("failed to serialize pairing QR")?;
    let qr_terminal = style_qr_lines(&pad_qr_lines(&render_qr_body(&qr_json)?, 4));

    info!("No agent JWT found in OS keychain");
    println!();
    println!("TabbyWebRTC agent is not paired.");
    println!("Scan this QR with the TabbyWebRTC mobile app (Pair a new machine):");
    println!();
    println!("{qr_terminal}");
    println!();
    println!("QR payload (paste fallback):");
    println!("{qr_json}");
    println!();
    println!("Local pairing endpoint: {local_endpoint}/pair");
    println!("Waiting for pairing (local callback on port {})...", config.http.thumbnail_port);

    let (jwt_tx, jwt_rx) = oneshot::channel();
    let state = PairingState {
        agent_id: config.agent.id.clone(),
        public_key_b64,
        pairing_nonce: pairing_nonce.clone(),
        jwt_tx: Arc::new(RwLock::new(Some(jwt_tx))),
    };

    let bind_host = match config.http.bind.as_str() {
        "127.0.0.1" | "localhost" => "0.0.0.0",
        other => other,
    };
    let bind = format!("{}:{}", bind_host, config.http.thumbnail_port);
    let app = Router::new()
        .route("/pair", post(complete_pairing))
        .route("/pair/status", get(pairing_status))
        .layer(CorsLayer::permissive().allow_private_network(true))
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .with_context(|| format!("failed to bind pairing server on {bind}"))?;

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        let serve = axum::serve(listener, app).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        if let Err(err) = serve.await {
            tracing::error!(%err, "pairing server failed");
        }
    });

    let poll_state = state.clone();
    let api_url = config.api_base_url();
    let agent_id = config.agent.id.clone();
    let poll_task = tokio::spawn(async move {
        if api_url.is_empty() {
            tracing::warn!("pairing claim poll disabled: signaling.api_url is empty");
            return;
        }
        info!(%api_url, "polling pair-claim fallback");
        let claim_url = format!(
            "{}/agents/pair-claim?agentId={}&nonce={}",
            api_url,
            agent_id,
            pairing_nonce
        );
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            match reqwest::get(&claim_url).await {
                Ok(response) if response.status().is_success() => {
                    if let Ok(body) = response.json::<PairClaimResponse>().await {
                        if !body.agent_jwt.is_empty() {
                            let mut slot = poll_state.jwt_tx.write().await;
                            if let Some(tx) = slot.take() {
                                let _ = tx.send(body.agent_jwt);
                            }
                            return;
                        }
                    }
                }
                _ => {}
            }
        }
    });

    let token = tokio::time::timeout(Duration::from_secs(600), jwt_rx)
        .await
        .context("pairing timed out after 10 minutes")?
        .context("pairing channel closed")?;

    poll_task.abort();
    let _ = shutdown_tx.send(());
    let _ = server.await;

    keychain::set_agent_jwt(&token)?;
    println!("Pairing complete. Connecting…");
    Ok(token)
}

#[derive(Deserialize)]
struct PairClaimResponse {
    #[serde(rename = "agentJwt")]
    agent_jwt: String,
}

async fn complete_pairing(
    State(state): State<PairingState>,
    Json(body): Json<PairCompleteRequest>,
) -> (axum::http::StatusCode, Json<PairingStatus>) {
    if body.token.is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(PairingStatus {
                ok: false,
                message: "token required".into(),
            }),
        );
    }
    if body.nonce.is_empty() || body.nonce != state.pairing_nonce {
        return (
            axum::http::StatusCode::UNAUTHORIZED,
            Json(PairingStatus {
                ok: false,
                message: "invalid pairing nonce".into(),
            }),
        );
    }

    let mut slot = state.jwt_tx.write().await;
    if let Some(tx) = slot.take() {
        let _ = tx.send(body.token);
        (
            axum::http::StatusCode::OK,
            Json(PairingStatus {
                ok: true,
                message: "paired".into(),
            }),
        )
    } else {
        (
            axum::http::StatusCode::CONFLICT,
            Json(PairingStatus {
                ok: false,
                message: "pairing already completed".into(),
            }),
        )
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
