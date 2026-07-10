use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Context;
use axum::{
    extract::{Path, State, WebSocketUpgrade},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use base64::Engine;
use capture::{SourceDescriptor, SourceKind};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::Serialize;
use sha2::Sha256;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::info;

use crate::config::AgentConfig;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
pub struct LocalServerState {
    pub config: AgentConfig,
    pub sources: Arc<RwLock<Vec<SourceDescriptor>>>,
    pub hmac_secret: Arc<[u8; 32]>,
}

#[derive(Serialize)]
pub struct InfoResponse {
    pub agent_id: String,
    pub name: String,
    pub platform: String,
    pub version: String,
    pub local_token: String,
}

#[derive(Serialize)]
pub struct SourcesResponse {
    pub displays: Vec<SourceView>,
    pub apps: Vec<SourceView>,
}

#[derive(Serialize, Clone)]
pub struct SourceView {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
}

pub fn spawn(
    config: AgentConfig,
    sources: Vec<SourceDescriptor>,
) -> anyhow::Result<(Arc<LocalServerState>, SocketAddr)> {
    let mut secret = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut secret);

    let state = Arc::new(LocalServerState {
        config: config.clone(),
        sources: Arc::new(RwLock::new(sources)),
        hmac_secret: Arc::new(secret),
    });

    let bind: SocketAddr = format!("{}:{}", config.http.bind, config.http.thumbnail_port)
        .parse()
        .context("invalid http bind address")?;

    let app = Router::new()
        .route("/info", get(info_handler))
        .route("/sources", get(sources_handler))
        .route("/thumbnail/:source_id", get(thumbnail_handler))
        .route("/signal", get(signal_ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

    let listener = std::net::TcpListener::bind(bind).context("failed to bind local server")?;
    let addr = listener.local_addr()?;
    listener.set_nonblocking(true)?;

    tokio::spawn(async move {
        if let Err(err) = axum::serve(tokio::net::TcpListener::from_std(listener).unwrap(), app).await
        {
            tracing::error!(%err, "local server failed");
        }
    });

    info!(%addr, "local server listening");
    Ok((state, addr))
}

fn token_for_window(secret: &[u8; 32], agent_id: &str, window: u64) -> String {
    let payload = format!("{agent_id}:{window}");
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac key");
    mac.update(payload.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

fn current_local_token(secret: &[u8; 32], agent_id: &str) -> String {
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    token_for_window(secret, agent_id, epoch / 60)
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ").or_else(|| value.strip_prefix("bearer "))?;
    Some(token.to_string())
}

fn validate_local_token(state: &LocalServerState, headers: &HeaderMap) -> Result<(), StatusCode> {
    let provided = extract_bearer(headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let window = epoch / 60;
    let agent_id = &state.config.agent.id;
    let current = token_for_window(&state.hmac_secret, agent_id, window);
    let previous = token_for_window(&state.hmac_secret, agent_id, window.saturating_sub(1));
    if provided == current || provided == previous {
        Ok(())
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn info_handler(State(state): State<Arc<LocalServerState>>) -> Json<InfoResponse> {
    Json(InfoResponse {
        agent_id: state.config.agent.id.clone(),
        name: state.config.agent.name.clone(),
        platform: input::platform_name().into(),
        version: webrtc_peer::version().into(),
        local_token: current_local_token(&state.hmac_secret, &state.config.agent.id),
    })
}

async fn sources_handler(
    State(state): State<Arc<LocalServerState>>,
    headers: HeaderMap,
) -> Result<Json<SourcesResponse>, StatusCode> {
    validate_local_token(&state, &headers)?;
    let sources = state.sources.read().await;
    let mut displays = Vec::new();
    let mut apps = Vec::new();
    for source in sources.iter() {
        let view = SourceView {
            id: source.id.clone(),
            name: source.name.clone(),
            width: source.width,
            height: source.height,
        };
        match source.kind {
            SourceKind::Display => displays.push(view),
            SourceKind::App => apps.push(view),
        }
    }
    Ok(Json(SourcesResponse { displays, apps }))
}

async fn thumbnail_handler(
    State(state): State<Arc<LocalServerState>>,
    headers: HeaderMap,
    Path(source_id): Path<String>,
) -> Result<Response, StatusCode> {
    validate_local_token(&state, &headers)?;
    let jpeg = capture::capture_thumbnail(&source_id).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok((
        [(header::CONTENT_TYPE, "image/jpeg")],
        jpeg,
    )
        .into_response())
}

async fn signal_ws_handler(
    State(state): State<Arc<LocalServerState>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, StatusCode> {
    validate_local_token(&state, &headers)?;
    Ok(ws.on_upgrade(|socket| async move {
        use axum::extract::ws::Message;
        use futures_util::{SinkExt, StreamExt};
        let mut socket = socket;
        while let Some(Ok(msg)) = socket.next().await {
            if let Message::Text(text) = msg {
                let _ = socket.send(Message::Text(text)).await;
            }
        }
    }))
}

pub async fn advertise_mdns(port: u16, agent_name: &str) -> anyhow::Result<()> {
    let service_type = "_tabbywebrtc._tcp.local.";
    let instance = format!("{}.{}", agent_name.replace(' ', "-"), service_type);
    let mdns = mdns_sd::ServiceDaemon::new().context("failed to start mDNS daemon")?;
    let host = "tabbywebrtc-agent.local";

    let properties = [("version", webrtc_peer::version())];
    mdns.register(mdns_sd::ServiceInfo::new(
        service_type,
        &instance,
        &host,
        "",
        port,
        &properties[..],
    )?)
    .context("failed to register mDNS service")?;

    info!(port, "mDNS service registered");
    Ok(())
}
