use std::collections::HashMap;
use std::sync::Arc;

use capture::{run_capture_loop, CaptureConfig, Capturable};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

use crate::config::h264_track_codec;

struct ActiveStream {
    track: Arc<TrackLocalStaticSample>,
    capture_shutdown: CancellationToken,
    subscriber_count: usize,
}

pub struct StreamRegistry {
    streams: HashMap<String, ActiveStream>,
    capture_config: CaptureConfig,
}

impl StreamRegistry {
    pub fn new(capture_config: CaptureConfig) -> Self {
        Self {
            streams: HashMap::new(),
            capture_config,
        }
    }

    pub fn has_stream(&self, source_id: &str) -> bool {
        self.streams.contains_key(source_id)
    }

    pub fn get_track(&self, source_id: &str) -> Option<Arc<TrackLocalStaticSample>> {
        self.streams.get(source_id).map(|s| s.track.clone())
    }

    pub fn capture_config(&self) -> &CaptureConfig {
        &self.capture_config
    }

    pub fn get_or_create_track(
        &mut self,
        source_id: &str,
        source: Box<dyn Capturable>,
    ) -> anyhow::Result<Arc<TrackLocalStaticSample>> {
        if let Some(stream) = self.streams.get(source_id) {
            return Ok(stream.track.clone());
        }

        let track = Arc::new(TrackLocalStaticSample::new(
            h264_track_codec(),
            format!("video-{source_id}"),
            source_id.to_string(),
        ));

        let shutdown = CancellationToken::new();
        let track_for_loop = track.clone();
        let shutdown_for_loop = shutdown.clone();
        let config = self.capture_config.clone();
        let source_id_owned = source_id.to_string();

        tokio::spawn(async move {
            if let Err(err) =
                run_capture_loop(source, track_for_loop, shutdown_for_loop, &config).await
            {
                error!(source_id = %source_id_owned, %err, "capture loop ended");
            }
        });

        info!(source_id, "started capture stream");
        self.streams.insert(
            source_id.to_string(),
            ActiveStream {
                track: track.clone(),
                capture_shutdown: shutdown,
                subscriber_count: 0,
            },
        );

        Ok(track)
    }

    pub fn add_subscriber(&mut self, source_id: &str) {
        if let Some(stream) = self.streams.get_mut(source_id) {
            stream.subscriber_count += 1;
        }
    }

    pub fn remove_subscriber(&mut self, source_id: &str) {
        let should_remove = self
            .streams
            .get_mut(source_id)
            .map(|stream| {
                if stream.subscriber_count > 0 {
                    stream.subscriber_count -= 1;
                }
                stream.subscriber_count == 0
            })
            .unwrap_or(false);

        if should_remove {
            if let Some(stream) = self.streams.remove(source_id) {
                stream.capture_shutdown.cancel();
                info!(source_id, "capture stream stopped");
            }
        }
    }

    pub fn subscriber_count(&self, source_id: &str) -> usize {
        self.streams
            .get(source_id)
            .map(|s| s.subscriber_count)
            .unwrap_or(0)
    }

    pub fn total_subscribers(&self) -> usize {
        self.streams.values().map(|s| s.subscriber_count).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remove_subscriber_without_stream_is_noop() {
        let mut registry = StreamRegistry::new(CaptureConfig::default());
        registry.remove_subscriber("missing");
        assert_eq!(registry.subscriber_count("missing"), 0);
    }
}
