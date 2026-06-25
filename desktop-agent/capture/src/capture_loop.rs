use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info};
use webrtc::media::Sample;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

use crate::encoder::{EncoderParams, H264Encoder};
use crate::rtp::H264Packetizer;
use crate::Capturable;

#[derive(Debug, Clone)]
pub struct CaptureConfig {
    pub encoder: String,
    pub max_fps: u32,
    pub hide_cursor: bool,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            encoder: "auto".into(),
            max_fps: 60,
            hide_cursor: true,
        }
    }
}

pub async fn run_capture_loop(
    source: Box<dyn Capturable>,
    track: Arc<TrackLocalStaticSample>,
    shutdown: CancellationToken,
    config: &CaptureConfig,
) -> anyhow::Result<()> {
    let source = Arc::new(Mutex::new(source));
    {
        let mut guard = source.lock().map_err(|_| anyhow::anyhow!("capture lock poisoned"))?;
        guard.start()?;
    }

    let (width, height, source_id) = {
        let guard = source.lock().map_err(|_| anyhow::anyhow!("capture lock poisoned"))?;
        (guard.width(), guard.height(), guard.id().to_string())
    };

    let params = EncoderParams::from_source(width, height, config.max_fps);
    let mut encoder = H264Encoder::new(&params, &config.encoder)?;
    let frame_duration = Duration::from_micros(1_000_000 / config.max_fps.max(1) as u64);
    let mut packetizer = H264Packetizer::new(config.max_fps);
    info!(
        source_id = %source_id,
        backend = ?encoder.backend(),
        width,
        height,
        "capture loop started"
    );

    loop {
        tokio::select! {
            _ = shutdown.cancelled() => {
                debug!(source_id = %source_id, "capture loop shutdown");
                break;
            }
            frame_result = {
                let source = Arc::clone(&source);
                tokio::task::spawn_blocking(move || {
                    let mut guard = source.lock().map_err(|_| anyhow::anyhow!("capture lock poisoned"))?;
                    guard.next_frame()
                })
            } => {
                let frame = match frame_result {
                    Ok(Ok(frame)) => frame,
                    Ok(Err(err)) => {
                        error!(source_id = %source_id, error = %err, "frame capture failed");
                        tokio::time::sleep(frame_duration).await;
                        continue;
                    }
                    Err(err) => {
                        error!(source_id = %source_id, error = %err, "spawn_blocking join failed");
                        break;
                    }
                };

                let encoded = match encoder.encode(&frame) {
                    Ok(nals) => nals,
                    Err(err) => {
                        error!(source_id = %source_id, error = %err, "encode failed");
                        continue;
                    }
                };

                for nal in encoded {
                    let _rtp_packets = packetizer.packetize_annex_b(&nal, true);
                    let sample = Sample {
                        data: nal.into(),
                        duration: frame_duration,
                        ..Default::default()
                    };
                    if let Err(err) = track.write_sample(&sample).await {
                        error!(source_id = %source_id, error = %err, "write_sample failed");
                        break;
                    }
                }
            }
        }
    }

    if let Ok(mut guard) = source.lock() {
        guard.stop();
    }
    Ok(())
}
