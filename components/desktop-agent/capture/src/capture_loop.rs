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

    let source_id = {
        let guard = source.lock().map_err(|_| anyhow::anyhow!("capture lock poisoned"))?;
        guard.id().to_string()
    };

    let frame_duration = Duration::from_micros(1_000_000 / config.max_fps.max(1) as u64);
    let mut packetizer = H264Packetizer::new(config.max_fps);
    let mut encoder: Option<H264Encoder> = None;
    let mut encoder_dims: Option<(u32, u32)> = None;

    info!(source_id = %source_id, "capture loop started; waiting for first frame");

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

                if frame.width == 0 || frame.height == 0 || frame.data.is_empty() {
                    debug!(source_id = %source_id, "skipping empty capture frame");
                    continue;
                }

                let dims = (frame.width & !1, frame.height & !1);
                if dims.0 == 0 || dims.1 == 0 {
                    continue;
                }

                if encoder_dims != Some(dims) {
                    let params = EncoderParams::from_source(dims.0, dims.1, config.max_fps);
                    match H264Encoder::new(&params, &config.encoder) {
                        Ok(enc) => {
                            info!(
                                source_id = %source_id,
                                backend = ?enc.backend(),
                                width = dims.0,
                                height = dims.1,
                                "encoder ready"
                            );
                            encoder = Some(enc);
                            encoder_dims = Some(dims);
                        }
                        Err(err) => {
                            error!(source_id = %source_id, error = %err, "encoder init failed");
                            continue;
                        }
                    }
                }

                let Some(enc) = encoder.as_mut() else {
                    continue;
                };

                let frame = if frame.width != dims.0 || frame.height != dims.1 {
                    crop_even_frame(frame, dims.0, dims.1)?
                } else {
                    frame
                };

                let encoded = match enc.encode(&frame) {
                    Ok(nals) => nals,
                    Err(err) => {
                        error!(source_id = %source_id, error = %err, "encode failed");
                        continue;
                    }
                };

                if encoded.is_empty() {
                    continue;
                }

                let mut annex_b = Vec::new();
                for nal in &encoded {
                    let _ = packetizer.packetize_annex_b(nal, true);
                    annex_b.extend_from_slice(nal);
                }
                let sample = Sample {
                    data: annex_b.into(),
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

    if let Ok(mut guard) = source.lock() {
        guard.stop();
    }
    Ok(())
}

fn crop_even_frame(
    frame: crate::Frame,
    width: u32,
    height: u32,
) -> anyhow::Result<crate::Frame> {
    use crate::PixelFormat;
    match frame.format {
        PixelFormat::BGRA => {
            let src_w = frame.width as usize;
            let dst_w = width as usize;
            let dst_h = height as usize;
            let mut data = Vec::with_capacity(dst_w * dst_h * 4);
            for y in 0..dst_h {
                let start = (y * src_w) * 4;
                let end = start + dst_w * 4;
                data.extend_from_slice(&frame.data[start..end]);
            }
            Ok(crate::Frame {
                data,
                format: PixelFormat::BGRA,
                width,
                height,
                timestamp_us: frame.timestamp_us,
            })
        }
        PixelFormat::NV12 => Ok(crate::Frame {
            data: frame.data,
            format: PixelFormat::NV12,
            width,
            height,
            timestamp_us: frame.timestamp_us,
        }),
    }
}
