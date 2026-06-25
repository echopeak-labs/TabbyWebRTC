use std::time::Duration;

use capture::SourceDescriptor;
use tokio::sync::broadcast;
use tracing::{debug, info};

#[derive(Debug, Clone)]
pub enum SourceDelta {
    Added(SourceDescriptor),
    Removed(String),
    Updated(SourceDescriptor),
}

pub struct SourceEnumerator;

impl SourceEnumerator {
    pub fn spawn(initial: Vec<SourceDescriptor>) -> broadcast::Sender<Vec<SourceDescriptor>> {
        let (tx, _) = broadcast::channel(16);
        let update_tx = tx.clone();

        tokio::spawn(async move {
            let mut known = initial;
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            interval.tick().await;

            loop {
                interval.tick().await;
                match capture::enumerate_sources() {
                    Ok(current) => {
                        let deltas = compute_deltas(&known, &current);
                        if !deltas.is_empty() {
                            info!(count = deltas.len(), "source list changed");
                            for delta in &deltas {
                                debug!(?delta, "source delta");
                            }
                            known = current;
                            let _ = update_tx.send(known.clone());
                        }
                    }
                    Err(err) => {
                        tracing::warn!(%err, "source enumeration failed");
                    }
                }
            }
        });

        tx
    }
}

fn compute_deltas(
    previous: &[SourceDescriptor],
    current: &[SourceDescriptor],
) -> Vec<SourceDelta> {
    let mut deltas = Vec::new();

    for source in current {
        match previous.iter().find(|p| p.id == source.id) {
            None => deltas.push(SourceDelta::Added(source.clone())),
            Some(old) if old != source => deltas.push(SourceDelta::Updated(source.clone())),
            _ => {}
        }
    }

    for old in previous {
        if !current.iter().any(|s| s.id == old.id) {
            deltas.push(SourceDelta::Removed(old.id.clone()));
        }
    }

    deltas
}
