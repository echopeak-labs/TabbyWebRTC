use openh264::encoder::{Encoder, EncoderConfig, RateControlMode};
use openh264::formats::{BgraSliceU8, YUVBuffer};
use openh264::OpenH264API;
use tracing::{info, warn};

use crate::{Frame, PixelFormat};

#[cfg(feature = "hardware-encode")]
use crate::vaapi_encoder::{probe_vaapi, VaapiH264Encoder};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum H264Profile {
    Baseline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum H264Level {
    Level4_1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateControl {
    CBR,
}

#[derive(Debug, Clone)]
pub struct EncoderParams {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub keyframe_interval: u32,
    pub profile: H264Profile,
    pub level: H264Level,
    pub rate_control: RateControl,
}

impl EncoderParams {
    pub fn from_source(width: u32, height: u32, max_fps: u32) -> Self {
        let pixels = (width as u64) * (height as u64);
        let bitrate_kbps = ((pixels * max_fps.max(1) as u64) / 900)
            .clamp(4_000, 25_000) as u32;
        Self {
            width,
            height,
            fps: max_fps.max(1),
            bitrate_kbps,
            keyframe_interval: max_fps.max(1) * 2,
            profile: H264Profile::Baseline,
            level: H264Level::Level4_1,
            rate_control: RateControl::CBR,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderBackend {
    Nvenc,
    Vaapi,
    VideoToolbox,
    Software,
}

enum EncoderImpl {
    Software {
        encoder: Encoder,
        yuv_scratch: YUVBuffer,
    },
    #[cfg(feature = "hardware-encode")]
    Vaapi(VaapiH264Encoder),
}

pub struct H264Encoder {
    backend: EncoderBackend,
    impl_: EncoderImpl,
    frame_count: u64,
    keyframe_interval: u32,
}

impl H264Encoder {
    pub fn new(params: &EncoderParams, encoder_pref: &str) -> anyhow::Result<Self> {
        let backend = select_backend(encoder_pref);
        info!(?backend, width = params.width, height = params.height, "selected H.264 encoder backend");

        let impl_ = match backend {
            #[cfg(feature = "hardware-encode")]
            EncoderBackend::Vaapi => match VaapiH264Encoder::new(params) {
                Ok(enc) => EncoderImpl::Vaapi(enc),
                Err(err) => {
                    warn!(%err, "VAAPI encoder init failed; falling back to software");
                    EncoderImpl::Software {
                        encoder: build_software_encoder(params)?,
                        yuv_scratch: YUVBuffer::new(params.width as usize, params.height as usize),
                    }
                }
            },
            #[cfg(not(feature = "hardware-encode"))]
            EncoderBackend::Vaapi => EncoderImpl::Software {
                encoder: build_software_encoder(params)?,
                yuv_scratch: YUVBuffer::new(params.width as usize, params.height as usize),
            },
            EncoderBackend::Software
            | EncoderBackend::Nvenc
            | EncoderBackend::VideoToolbox => EncoderImpl::Software {
                encoder: build_software_encoder(params)?,
                yuv_scratch: YUVBuffer::new(params.width as usize, params.height as usize),
            },
        };

        let backend = match &impl_ {
            EncoderImpl::Software { .. } => EncoderBackend::Software,
            #[cfg(feature = "hardware-encode")]
            EncoderImpl::Vaapi(_) => EncoderBackend::Vaapi,
        };

        Ok(Self {
            backend,
            impl_,
            frame_count: 0,
            keyframe_interval: params.keyframe_interval.max(1),
        })
    }

    pub fn backend(&self) -> EncoderBackend {
        self.backend
    }

    pub fn encode(&mut self, frame: &Frame) -> anyhow::Result<Vec<Vec<u8>>> {
        match &mut self.impl_ {
            EncoderImpl::Software {
                encoder,
                yuv_scratch,
            } => {
                prepare_yuv(yuv_scratch, frame)?;
                if self.frame_count % self.keyframe_interval as u64 == 0 {
                    encoder.force_intra_frame();
                }
                let bitstream = encoder.encode(yuv_scratch)?;
                self.frame_count += 1;
                let mut nals = Vec::new();
                for i in 0..bitstream.num_layers() {
                    let Some(layer) = bitstream.layer(i) else {
                        continue;
                    };
                    for j in 0..layer.nal_count() {
                        let Some(nal) = layer.nal_unit(j) else {
                            continue;
                        };
                        let mut annex_b = Vec::with_capacity(nal.len() + 4);
                        annex_b.extend_from_slice(&[0, 0, 0, 1]);
                        annex_b.extend_from_slice(nal);
                        nals.push(annex_b);
                    }
                }
                Ok(nals)
            }
            #[cfg(feature = "hardware-encode")]
            EncoderImpl::Vaapi(enc) => {
                let nals = enc.encode(frame)?;
                self.frame_count += 1;
                Ok(nals)
            }
        }
    }
}

fn select_backend(encoder_pref: &str) -> EncoderBackend {
    let candidates = match encoder_pref {
        "nvenc" => vec![EncoderBackend::Nvenc, EncoderBackend::Software],
        "vaapi" => vec![EncoderBackend::Vaapi, EncoderBackend::Software],
        "videotoolbox" => vec![EncoderBackend::VideoToolbox, EncoderBackend::Software],
        "software" => vec![EncoderBackend::Software],
        _ => {
            #[cfg(target_os = "linux")]
            {
                vec![
                    EncoderBackend::Vaapi,
                    EncoderBackend::Nvenc,
                    EncoderBackend::Software,
                ]
            }
            #[cfg(target_os = "macos")]
            {
                vec![EncoderBackend::VideoToolbox, EncoderBackend::Software]
            }
            #[cfg(target_os = "windows")]
            {
                vec![EncoderBackend::Nvenc, EncoderBackend::Software]
            }
            #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
            {
                vec![EncoderBackend::Software]
            }
        }
    };

    for backend in candidates {
        if try_init_hardware(backend).is_ok() {
            return backend;
        }
    }
    EncoderBackend::Software
}

fn try_init_hardware(backend: EncoderBackend) -> anyhow::Result<()> {
    match backend {
        EncoderBackend::Software => Ok(()),
        #[cfg(feature = "hardware-encode")]
        EncoderBackend::Vaapi => probe_vaapi(),
        #[cfg(feature = "hardware-encode")]
        EncoderBackend::Nvenc => anyhow::bail!("nvenc encoder not implemented yet"),
        #[cfg(feature = "hardware-encode")]
        EncoderBackend::VideoToolbox => anyhow::bail!("videotoolbox encoder not implemented yet"),
        #[cfg(not(feature = "hardware-encode"))]
        _ => anyhow::bail!("hardware encode feature disabled"),
    }
}

fn build_software_encoder(params: &EncoderParams) -> anyhow::Result<Encoder> {
    let bitrate_bps = params.bitrate_kbps * 1000;
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(4) as u16)
        .unwrap_or(2)
        .max(1);
    let config = EncoderConfig::new()
        .set_bitrate_bps(bitrate_bps)
        .max_frame_rate(params.fps as f32)
        .rate_control_mode(RateControlMode::Bitrate)
        .usage_type(openh264::encoder::UsageType::CameraVideoRealTime)
        .enable_skip_frame(true)
        .set_multiple_thread_idc(threads);
    let _ = (params.profile, params.level, params.rate_control);
    Encoder::with_api_config(OpenH264API::from_source(), config)
        .map_err(|e| anyhow::anyhow!("openh264 init failed: {e}"))
}

fn prepare_yuv(yuv_scratch: &mut YUVBuffer, frame: &Frame) -> anyhow::Result<()> {
    match frame.format {
        PixelFormat::BGRA => {
            let bgra = BgraSliceU8::new(
                &frame.data,
                (frame.width as usize, frame.height as usize),
            );
            yuv_scratch.read_rgb(bgra);
        }
        PixelFormat::NV12 => {
            let bgra = nv12_to_bgra(&frame.data, frame.width, frame.height)?;
            let slice = BgraSliceU8::new(&bgra, (frame.width as usize, frame.height as usize));
            yuv_scratch.read_rgb(slice);
        }
    }
    Ok(())
}

fn nv12_to_bgra(nv12: &[u8], width: u32, height: u32) -> anyhow::Result<Vec<u8>> {
    let w = width as usize;
    let h = height as usize;
    let y_plane = w * h;
    if nv12.len() < y_plane + w * h / 2 {
        anyhow::bail!("NV12 buffer too small");
    }
    let mut bgra = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let y_idx = y * w + x;
            let uv_idx = y_plane + (y / 2) * w + (x & !1);
            let y_val = nv12[y_idx] as i32;
            let u_val = nv12[uv_idx] as i32 - 128;
            let v_val = nv12[uv_idx + 1] as i32 - 128;
            let r = (y_val + ((1436 * v_val) >> 10)).clamp(0, 255) as u8;
            let g = (y_val - ((352 * u_val + 731 * v_val) >> 10)).clamp(0, 255) as u8;
            let b = (y_val + ((1814 * u_val) >> 10)).clamp(0, 255) as u8;
            let out = (y * w + x) * 4;
            bgra[out] = b;
            bgra[out + 1] = g;
            bgra[out + 2] = r;
            bgra[out + 3] = 255;
        }
    }
    Ok(bgra)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_solid_bgra_frame() {
        let width = 64u32;
        let height = 64u32;
        let mut data = vec![0u8; (width * height * 4) as usize];
        for px in data.chunks_exact_mut(4) {
            px[0] = 40;
            px[1] = 120;
            px[2] = 200;
            px[3] = 255;
        }
        let frame = Frame {
            data,
            format: PixelFormat::BGRA,
            width,
            height,
            timestamp_us: 0,
        };
        let params = EncoderParams::from_source(width, height, 30);
        let mut encoder = H264Encoder::new(&params, "software").unwrap();
        let nals = encoder.encode(&frame).unwrap();
        assert!(!nals.is_empty());
        assert!(nals[0].starts_with(&[0, 0, 0, 1]));
        let total_bytes: usize = nals.iter().map(|n| n.len()).sum();
        assert!(total_bytes > 20);
    }
}
