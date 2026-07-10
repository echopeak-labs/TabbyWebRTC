mod agent;
mod config;
mod keychain;
mod local_server;
mod pairing;
mod source_enumerator;
mod turn;
mod updater;

use std::path::PathBuf;

use anyhow::Context;
use clap::Parser;
use tracing_subscriber::EnvFilter;

use agent::Agent;
use config::{default_config_path, load_or_create};

#[derive(Parser, Debug)]
#[command(name = "tabbywebrtc-agent", about = "TabbyWebRTC desktop agent")]
struct Args {
    #[arg(long, value_name = "PATH")]
    config: Option<PathBuf>,

    #[arg(long, value_name = "LEVEL", default_value = "info")]
    log_level: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new(&args.log_level)),
        )
        .init();

    let config_path = args
        .config
        .unwrap_or_else(|| default_config_path().expect("failed to resolve default config path"));

    let config = load_or_create(&config_path).context("failed to load config")?;
    let agent = Agent::new(config_path, config);
    agent.run().await
}
