use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::time::{sleep_until, Instant as TokioInstant};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info};
use webrtc::media::Sample;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

use crate::encoder::{EncoderParams, H264Encoder};
use crate::rtp::H264Packetizer;
use crate::{Capturable, Frame, PixelFormat};

pub type VideoSizeCallback = Arc<dyn Fn(u32, u32) + Send + Sync>;

#[derive(Clone)]
pub struct CaptureConfig {
    pub encoder: String,
    pub max_fps: u32,
    pub hide_cursor: bool,
    pub max_width: u32,
    pub on_video_size: Option<VideoSizeCallback>,
}

impl std::fmt::Debug for CaptureConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CaptureConfig")
            .field("encoder", &self.encoder)
            .field("max_fps", &self.max_fps)
            .field("hide_cursor", &self.hide_cursor)
            .field("max_width", &self.max_width)
            .field("on_video_size", &self.on_video_size.is_some())
            .finish()
    }
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            encoder: "auto".into(),
            max_fps: 30,
            hide_cursor: true,
            max_width: 0,
            on_video_size: None,
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

    let max_fps = config.max_fps.clamp(1, 60);
    let max_width = if config.max_width == 0 {
        u32::MAX
    } else {
        config.max_width.max(320)
    };
    let frame_duration = Duration::from_micros(1_000_000 / max_fps as u64);
    let mut packetizer = H264Packetizer::new(max_fps);
    let mut encoder: Option<H264Encoder> = None;
    let mut encoder_dims: Option<(u32, u32)> = None;
    let mut next_frame_at = Instant::now();
    let encoder_pref = config.encoder.clone();
    let on_video_size = config.on_video_size.clone();
    let mut reported_video_size = false;

    info!(
        source_id = %source_id,
        max_fps,
        max_width,
        "capture loop started; waiting for first frame"
    );

    loop {
        if shutdown.is_cancelled() {
            debug!(source_id = %source_id, "capture loop shutdown");
            break;
        }

        let now = Instant::now();
        if now < next_frame_at {
            let wake = TokioInstant::now() + (next_frame_at - now);
            tokio::select! {
                _ = shutdown.cancelled() => break,
                _ = sleep_until(wake) => {}
            }
        }

        let now = Instant::now();
        while next_frame_at <= now {
            next_frame_at += frame_duration;
        }

        let source_for_frame = Arc::clone(&source);
        let frame_result = tokio::task::spawn_blocking(move || {
            let mut guard = source_for_frame
                .lock()
                .map_err(|_| anyhow::anyhow!("capture lock poisoned"))?;
            guard.next_frame()
        })
        .await;

        let frame = match frame_result {
            Ok(Ok(frame)) => frame,
            Ok(Err(err)) => {
                error!(source_id = %source_id, error = %err, "frame capture failed");
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

        let frame = match prepare_frame_for_encode(frame, max_width) {
            Ok(frame) => frame,
            Err(err) => {
                error!(source_id = %source_id, error = %err, "frame prepare failed");
                continue;
            }
        };

        let dims = (frame.width, frame.height);
        if dims.0 == 0 || dims.1 == 0 {
            continue;
        }

        if !reported_video_size {
            reported_video_size = true;
            if let Some(cb) = on_video_size.as_ref() {
                cb(dims.0, dims.1);
            }
        }

        if encoder_dims != Some(dims) {
            let params = EncoderParams::from_source(dims.0, dims.1, max_fps);
            match H264Encoder::new(&params, &encoder_pref) {
                Ok(enc) => {
                    info!(
                        source_id = %source_id,
                        backend = ?enc.backend(),
                        width = dims.0,
                        height = dims.1,
                        bitrate_kbps = params.bitrate_kbps,
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

        let Some(mut enc) = encoder.take() else {
            continue;
        };
        let encode_result = tokio::task::spawn_blocking(move || {
            let nals = enc.encode(&frame)?;
            Ok::<_, anyhow::Error>((enc, nals))
        })
        .await;

        let (enc, encoded) = match encode_result {
            Ok(Ok((enc, nals))) => (enc, nals),
            Ok(Err(err)) => {
                error!(source_id = %source_id, error = %err, "encode failed");
                encoder_dims = None;
                continue;
            }
            Err(err) => {
                error!(source_id = %source_id, error = %err, "encode join failed");
                break;
            }
        };
        encoder = Some(enc);

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

    if let Ok(mut guard) = source.lock() {
        guard.stop();
    }
    Ok(())
}

fn prepare_frame_for_encode(frame: Frame, max_width: u32) -> anyhow::Result<Frame> {
    let even_w = frame.width & !1;
    let even_h = frame.height & !1;
    if even_w == 0 || even_h == 0 {
        anyhow::bail!("invalid frame size");
    }

    let frame = if frame.width != even_w || frame.height != even_h {
        crop_even_frame(frame, even_w, even_h)?
    } else {
        frame
    };

    if frame.width <= max_width {
        return Ok(frame);
    }

    let dst_w = (max_width & !1).max(2);
    let dst_h = (((frame.height as u64 * dst_w as u64) / frame.width as u64) as u32 & !1).max(2);
    scale_bgra_nearest(frame, dst_w, dst_h)
}

fn scale_bgra_nearest(frame: Frame, dst_w: u32, dst_h: u32) -> anyhow::Result<Frame> {
    match frame.format {
        PixelFormat::BGRA => {
            let src_w = frame.width as usize;
            let src_h = frame.height as usize;
            let dst_w_usize = dst_w as usize;
            let dst_h_usize = dst_h as usize;
            let mut data = vec![0u8; dst_w_usize * dst_h_usize * 4];
            for y in 0..dst_h_usize {
                let src_y = y * src_h / dst_h_usize;
                let src_row = src_y * src_w * 4;
                let dst_row = y * dst_w_usize * 4;
                for x in 0..dst_w_usize {
                    let src_x = x * src_w / dst_w_usize;
                    let src = src_row + src_x * 4;
                    let dst = dst_row + x * 4;
                    data[dst..dst + 4].copy_from_slice(&frame.data[src..src + 4]);
                }
            }
            Ok(Frame {
                data,
                format: PixelFormat::BGRA,
                width: dst_w,
                height: dst_h,
                timestamp_us: frame.timestamp_us,
            })
        }
        PixelFormat::NV12 => Ok(frame),
    }
}

fn crop_even_frame(frame: Frame, width: u32, height: u32) -> anyhow::Result<Frame> {
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
            Ok(Frame {
                data,
                format: PixelFormat::BGRA,
                width,
                height,
                timestamp_us: frame.timestamp_us,
            })
        }
        PixelFormat::NV12 => Ok(Frame {
            data: frame.data,
            format: PixelFormat::NV12,
            width,
            height,
            timestamp_us: frame.timestamp_us,
        }),
    }
}
