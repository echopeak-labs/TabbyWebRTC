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
        if size[0] > 0 && size[1] > 0 {
            self.width = size[0];
            self.height = size[1];
        }
        capturer.start_capture();
        self.capturer = Some(capturer);
        tracing::info!(
            source_id = %self.id,
            width = self.width,
            height = self.height,
            "scap capturer started"
        );
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
        use scap::frame::Frame as ScapFrame;
        use std::time::{SystemTime, UNIX_EPOCH};

        let capturer = self
            .capturer
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("capture not started"))?;
        let scap_frame = capturer
            .get_latest_frame()
            .map_err(|e| anyhow::anyhow!("frame receive failed: {e}"))?;
        let timestamp_us = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros() as u64;

        match scap_frame {
            ScapFrame::Video(video) => Ok(video_frame_to_frame(video, timestamp_us)?),
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
fn video_frame_to_frame(
    video: scap::frame::VideoFrame,
    timestamp_us: u64,
) -> anyhow::Result<Frame> {
    use scap::frame::VideoFrame;
    match video {
        VideoFrame::BGRA(bgra) => Ok(Frame {
            data: pack_bgra_rows(bgra.data, bgra.width as u32, bgra.height as u32, 4)?,
            format: PixelFormat::BGRA,
            width: bgra.width as u32,
            height: bgra.height as u32,
            timestamp_us,
        }),
        VideoFrame::BGR0(bgr) => Ok(Frame {
            data: pack_bgra_rows(bgr.data, bgr.width as u32, bgr.height as u32, 4)?,
            format: PixelFormat::BGRA,
            width: bgr.width as u32,
            height: bgr.height as u32,
            timestamp_us,
        }),
        VideoFrame::BGRx(bgrx) => Ok(Frame {
            data: pack_bgra_rows(bgrx.data, bgrx.width as u32, bgrx.height as u32, 4)?,
            format: PixelFormat::BGRA,
            width: bgrx.width as u32,
            height: bgrx.height as u32,
            timestamp_us,
        }),
        VideoFrame::RGBx(rgbx) => {
            let packed = pack_bgra_rows(rgbx.data, rgbx.width as u32, rgbx.height as u32, 4)?;
            let mut data = Vec::with_capacity(packed.len());
            for px in packed.chunks_exact(4) {
                data.extend_from_slice(&[px[2], px[1], px[0], 255]);
            }
            Ok(Frame {
                data,
                format: PixelFormat::BGRA,
                width: rgbx.width as u32,
                height: rgbx.height as u32,
                timestamp_us,
            })
        }
        VideoFrame::RGB(rgb) => {
            let w = rgb.width as u32;
            let h = rgb.height as u32;
            let packed = pack_rgb_rows(rgb.data, w, h)?;
            let mut data = Vec::with_capacity((w * h * 4) as usize);
            for px in packed.chunks_exact(3) {
                data.extend_from_slice(&[px[2], px[1], px[0], 255]);
            }
            Ok(Frame {
                data,
                format: PixelFormat::BGRA,
                width: w,
                height: h,
                timestamp_us,
            })
        }
        VideoFrame::XBGR(xbgr) => {
            let packed = pack_bgra_rows(xbgr.data, xbgr.width as u32, xbgr.height as u32, 4)?;
            let mut data = Vec::with_capacity(packed.len());
            for px in packed.chunks_exact(4) {
                data.extend_from_slice(&[px[1], px[2], px[3], 255]);
            }
            Ok(Frame {
                data,
                format: PixelFormat::BGRA,
                width: xbgr.width as u32,
                height: xbgr.height as u32,
                timestamp_us,
            })
        }
        VideoFrame::YUVFrame(yuv) => {
            let mut nv12 =
                Vec::with_capacity(yuv.luminance_bytes.len() + yuv.chrominance_bytes.len());
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
    }
}

#[cfg(feature = "scap-capture")]
fn pack_bgra_rows(data: Vec<u8>, width: u32, height: u32, bpp: u32) -> anyhow::Result<Vec<u8>> {
    let row_bytes = (width * bpp) as usize;
    let expected = row_bytes * height as usize;
    if data.len() == expected {
        return Ok(data);
    }
    if height == 0 || data.len() % height as usize != 0 {
        anyhow::bail!(
            "unexpected frame buffer size {} for {}x{} bpp={}",
            data.len(),
            width,
            height,
            bpp
        );
    }
    let stride = data.len() / height as usize;
    if stride < row_bytes {
        anyhow::bail!("frame stride {stride} smaller than row bytes {row_bytes}");
    }
    let mut packed = Vec::with_capacity(expected);
    for y in 0..height as usize {
        let start = y * stride;
        packed.extend_from_slice(&data[start..start + row_bytes]);
    }
    Ok(packed)
}

#[cfg(feature = "scap-capture")]
fn pack_rgb_rows(data: Vec<u8>, width: u32, height: u32) -> anyhow::Result<Vec<u8>> {
    pack_bgra_rows(data, width, height, 3)
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
