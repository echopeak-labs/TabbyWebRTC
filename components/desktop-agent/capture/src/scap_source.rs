#[cfg(feature = "scap-capture")]
use scap::targets::Target;

#[cfg(feature = "scap-capture")]
use crate::minimize::MinimizeGuard;

#[cfg(feature = "scap-capture")]
use crate::{Frame, PixelFormat};

#[cfg(feature = "scap-capture")]
pub struct ScapCapturable {
    id: String,
    name: String,
    width: u32,
    height: u32,
    target: Option<Target>,
    capturer: Option<scap::capturer::Capturer>,
    hide_cursor: bool,
    max_fps: u32,
    minimize_guard: Option<MinimizeGuard>,
}

#[cfg(feature = "scap-capture")]
impl ScapCapturable {
    pub fn from_target(
        id: String,
        name: String,
        target: Option<Target>,
        width: u32,
        height: u32,
        hide_cursor: bool,
        max_fps: u32,
    ) -> Self {
        let minimize_guard = target.as_ref().and_then(|t| MinimizeGuard::install(t));
        Self {
            id,
            name,
            width,
            height,
            target,
            capturer: None,
            hide_cursor,
            max_fps,
            minimize_guard,
        }
    }

    fn build_options(&self) -> scap::capturer::Options {
        use scap::capturer::{Options, Resolution};
        use scap::frame::FrameType;
        Options {
            fps: self.max_fps,
            show_cursor: !self.hide_cursor,
            show_highlight: false,
            target: self.target.clone(),
            crop_area: None,
            output_type: FrameType::BGRAFrame,
            output_resolution: Resolution::Captured,
            excluded_targets: None,
            captures_audio: false,
            exclude_current_process_audio: true,
        }
    }
}

#[cfg(feature = "scap-capture")]
impl crate::Capturable for ScapCapturable {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn width(&self) -> u32 {
        self.width
    }

    fn height(&self) -> u32 {
        self.height
    }

    fn start(&mut self) -> anyhow::Result<()> {
        if !scap::is_supported() {
            anyhow::bail!("screen capture not supported on this platform");
        }
        if !scap::has_permission() && !scap::request_permission() {
            anyhow::bail!("screen capture permission denied");
        }
        let options = self.build_options();
        let mut capturer = scap::capturer::Capturer::build(options)
            .map_err(|e| anyhow::anyhow!("failed to build capturer: {e}"))?;
        let size = capturer.get_output_frame_size();
        self.width = size[0];
        self.height = size[1];
        capturer.start_capture();
        self.capturer = Some(capturer);
        Ok(())
    }

    fn stop(&mut self) {
        if let Some(mut capturer) = self.capturer.take() {
            capturer.stop_capture();
        }
        if let Some(guard) = self.minimize_guard.take() {
            guard.restore();
        }
    }

    fn next_frame(&mut self) -> anyhow::Result<Frame> {
        use scap::frame::{Frame as ScapFrame, VideoFrame};
        use std::time::{SystemTime, UNIX_EPOCH};

        let capturer = self
            .capturer
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("capture not started"))?;
        let scap_frame = capturer
            .get_next_frame()
            .map_err(|e| anyhow::anyhow!("frame receive failed: {e}"))?;
        let timestamp_us = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros() as u64;

        match scap_frame {
            ScapFrame::Video(video) => match video {
                VideoFrame::BGRA(bgra) => Ok(Frame {
                    data: bgra.data,
                    format: PixelFormat::BGRA,
                    width: bgra.width as u32,
                    height: bgra.height as u32,
                    timestamp_us,
                }),
                VideoFrame::YUVFrame(yuv) => {
                    let mut nv12 = Vec::with_capacity(
                        yuv.luminance_bytes.len() + yuv.chrominance_bytes.len(),
                    );
                    nv12.extend_from_slice(&yuv.luminance_bytes);
                    nv12.extend_from_slice(&yuv.chrominance_bytes);
                    Ok(Frame {
                        data: nv12,
                        format: PixelFormat::NV12,
                        width: yuv.width as u32,
                        height: yuv.height as u32,
                        timestamp_us,
                    })
                }
                other => {
                    tracing::warn!(?other, "unsupported scap frame type");
                    anyhow::bail!("unsupported video frame format")
                }
            },
            ScapFrame::Audio(_) => anyhow::bail!("unexpected audio frame"),
        }
    }

    fn capture_thumbnail(&mut self) -> anyhow::Result<Vec<u8>> {
        let was_running = self.capturer.is_some();
        if !was_running {
            self.start()?;
        }
        let frame = match self.next_frame() {
            Ok(frame) => frame,
            Err(err) => {
                if !was_running {
                    self.stop();
                }
                return Err(err);
            }
        };
        let jpeg = crate::thumbnail::frame_to_jpeg(&frame)?;
        if !was_running {
            self.stop();
        }
        Ok(jpeg)
    }
}

#[cfg(feature = "scap-capture")]
pub fn scap_targets() -> Vec<Target> {
    if scap::is_supported() {
        scap::targets::get_all_targets()
    } else {
        Vec::new()
    }
}

#[cfg(feature = "scap-capture")]
pub fn target_from_id(source_id: &str) -> anyhow::Result<Option<Target>> {
    if let Some(id_str) = source_id.strip_prefix("display-") {
        let id: u32 = id_str.parse()?;
        for target in scap_targets() {
            if let Target::Display(display) = target {
                if display.id == id {
                    return Ok(Some(Target::Display(display)));
                }
            }
        }
        anyhow::bail!("display {id} not found");
    }
    if let Some(id_str) = source_id.strip_prefix("app-") {
        let id: u32 = id_str.parse()?;
        for target in scap_targets() {
            if let Target::Window(window) = target {
                if window.id == id {
                    return Ok(Some(Target::Window(window)));
                }
            }
        }
        anyhow::bail!("window {id} not found");
    }
    Ok(None)
}

#[cfg(feature = "scap-capture")]
pub fn target_dimensions(target: &Target) -> (u32, u32) {
    let (w, h) = scap::targets::get_target_dimensions(target);
    (w as u32, h as u32)
}
