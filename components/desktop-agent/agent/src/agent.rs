use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use anyhow::Context;
use capture::CaptureConfig;
use input::InputPolicy;
use signaling::{run_heartbeat_loop, AgentRegistration, SignalingClient};
use tracing::info;
use webrtc_peer::{start_peer_stack, PeerStackOptions};

use crate::config::AgentConfig;
use crate::keychain;
use crate::local_server;
use crate::pairing;
use crate::source_enumerator::SourceEnumerator;
use crate::turn;
use crate::updater;

pub struct Agent {
    config_path: PathBuf,
    config: AgentConfig,
}

impl Agent {
    pub fn new(config_path: PathBuf, config: AgentConfig) -> Self {
        Self {
            config_path,
            config,
        }
    }

    pub async fn run(self) -> anyhow::Result<()> {
        let jwt = match keychain::get_agent_jwt()? {
            Some(existing) => {
                println!(
                    "Already paired (agent_id={}). Starting…\nTo show the PAIR QR again, remove ~/.config/tabbywebrtc/credentials/ and restart.",
                    self.config.agent.id
                );
                existing
            }
            None => pairing::run_pairing_flow(&self.config).await?,
        };
        let public_key = keychain::get_pairing_public_key()?.unwrap_or_default();
        let pairing_private_key = keychain::get_pairing_private_key()?;

        let sources = capture::enumerate_sources().context("initial source enumeration failed")?;
        info!(count = sources.len(), "enumerated capture sources");

        let (server_state, local_addr) =
            local_server::spawn(self.config.clone(), sources.clone()).context("local server failed")?;

        if let Err(err) = local_server::advertise_mdns(
            self.config.http.thumbnail_port,
            &self.config.agent.name,
        )
        .await
        {
            tracing::warn!(%err, "mDNS registration failed; continuing without LAN discovery");
        }

        let source_updates = SourceEnumerator::spawn(sources.clone());
        let server_state_clone = server_state.clone();
        let signaling_agent_id = self.config.agent.id.clone();
        let signaling_public_key = public_key.clone();
        let local_endpoint = local_server::advertiseable_base_url(
            local_addr,
            self.config.http.thumbnail_port,
        );
        let local_endpoint_for_updates = local_endpoint.clone();
        let shared_sources = server_state.sources.clone();

        info!(%local_endpoint, "advertising local endpoint");

        let registration = AgentRegistration {
            agent_id: self.config.agent.id.clone(),
            public_key: public_key.clone(),
            platform: input::platform_name().to_string(),
            sources: shared_sources.clone(),
            local_endpoint: local_endpoint.clone(),
        };

        let capture_config = CaptureConfig {
            encoder: self.config.capture.encoder.clone(),
            max_fps: self.config.capture.max_fps,
            hide_cursor: self.config.capture.hide_cursor,
        };

        let input_policy = InputPolicy {
            enabled: self.config.input.enabled,
            allow_remote_power: self.config.input.allow_remote_power,
        };

        let api_base = self.config.api_base_url();
        let turn = match turn::fetch_turn_config(&api_base, &jwt).await {
            Ok(turn) => turn,
            Err(err) => {
                tracing::warn!(%err, "TURN credentials unavailable, continuing with STUN only");
                None
            }
        };

        let peer_stack = start_peer_stack(
            &self.config.signaling.url,
            &jwt,
            registration,
            capture_config,
            PeerStackOptions {
                turn,
                input_policy,
                session_crypto_required: self.config.session_crypto.required,
                pairing_private_key_b64: pairing_private_key,
            },
        )
        .await
        .context("peer stack failed")?;
        let signaling = peer_stack.signaling.clone();
        let _ = SIGNALING_CLIENT.set(signaling.clone());

        let registry = peer_stack.registry.clone();
        let idle_check: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(move || {
            registry
                .try_lock()
                .map(|guard| guard.total_subscribers() == 0)
                .unwrap_or(false)
        });

        tokio::spawn(async move {
            let mut rx = source_updates.subscribe();
            loop {
                match rx.recv().await {
                    Ok(updated) => {
                        {
                            let mut guard = server_state_clone.sources.write().await;
                            *guard = updated.clone();
                        }
                        if let Some(signaling) = SIGNALING_CLIENT.get() {
                            if let Err(err) = signaling
                                .send_agent_register(
                                    &signaling_agent_id,
                                    &signaling_public_key,
                                    input::platform_name(),
                                    &updated,
                                    &local_endpoint_for_updates,
                                )
                                .await
                            {
                                tracing::warn!(%err, "failed to re-register after source change");
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        let heartbeat_client = signaling.clone();
        let agent_id = self.config.agent.id.clone();
        tokio::spawn(async move {
            run_heartbeat_loop(heartbeat_client, agent_id).await;
        });

        let updates = self.config.updates.clone();
        tokio::spawn(async move {
            updater::run_update_loop(updates, idle_check).await;
        });

        info!(
            agent_id = %self.config.agent.id,
            config = %self.config_path.display(),
            input_enabled = self.config.input.enabled,
            allow_remote_power = self.config.input.allow_remote_power,
            session_crypto_required = self.config.session_crypto.required,
            "agent running"
        );

        tokio::signal::ctrl_c().await?;
        info!("shutdown signal received");
        Ok(())
    }
}

static SIGNALING_CLIENT: OnceLock<Arc<SignalingClient>> = OnceLock::new();
