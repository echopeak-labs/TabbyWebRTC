use std::ffi::CString;
use std::ptr;
use std::slice;

use anyhow::{anyhow, Context};
use ffmpeg_next as ffmpeg;
use ffmpeg::codec::encoder::video::Encoder as VideoEncoder;
use ffmpeg::codec::Context as CodecContext;
use ffmpeg::format::Pixel;
use ffmpeg::frame::Video as VideoFrame;
use ffmpeg::Dictionary;
use ffmpeg::ffi as sys;
use tracing::{debug, info};

use crate::encoder::EncoderParams;
use crate::{Frame, PixelFormat};

pub struct VaapiH264Encoder {
    _hw_device: HwBuffer,
    _hw_frames: HwBuffer,
    encoder: VideoEncoder,
    sw_frame: VideoFrame,
    hw_frame: VideoFrame,
    nv12_scratch: Vec<u8>,
    packet: ffmpeg::Packet,
    width: u32,
    height: u32,
    frame_count: u64,
    keyframe_interval: u32,
    extradata_annex_b: Vec<u8>,
    sent_extradata: bool,
}

struct HwBuffer {
    ptr: *mut sys::AVBufferRef,
}

unsafe impl Send for HwBuffer {}

impl Drop for HwBuffer {
    fn drop(&mut self) {
        unsafe {
            if !self.ptr.is_null() {
                sys::av_buffer_unref(&mut self.ptr);
            }
        }
    }
}

impl VaapiH264Encoder {
    pub fn new(params: &EncoderParams) -> anyhow::Result<Self> {
        ffmpeg::init().context("ffmpeg init failed")?;

        let device = std::env::var("TABBY_VAAPI_DEVICE")
            .unwrap_or_else(|_| "/dev/dri/renderD128".into());
        let hw_device = create_vaapi_device(&device)?;
        let hw_frames = create_hw_frames(hw_device.ptr, params.width, params.height)?;

        let codec = ffmpeg::encoder::find_by_name("h264_vaapi")
            .ok_or_else(|| anyhow!("h264_vaapi encoder not available"))?;

        let mut encoder_ctx = CodecContext::new().encoder().video()?;
        encoder_ctx.set_width(params.width);
        encoder_ctx.set_height(params.height);
        encoder_ctx.set_format(Pixel::VAAPI);
        encoder_ctx.set_time_base((1, params.fps as i32));
        encoder_ctx.set_frame_rate(Some((params.fps as i32, 1)));
        encoder_ctx.set_bit_rate((params.bitrate_kbps as usize) * 1000);
        encoder_ctx.set_max_bit_rate((params.bitrate_kbps as usize) * 1000);

        unsafe {
            let raw = encoder_ctx.as_mut_ptr();
            (*raw).gop_size = params.keyframe_interval as i32;
            (*raw).max_b_frames = 0;
            (*raw).hw_frames_ctx = sys::av_buffer_ref(hw_frames.ptr);
            if (*raw).hw_frames_ctx.is_null() {
                anyhow::bail!("failed to ref hw_frames_ctx");
            }
        }

        let mut opts = Dictionary::new();
        opts.set("rc_mode", "CBR");
        opts.set("bf", "0");
        opts.set("async_depth", "1");
        opts.set("profile", "constrained_baseline");

        let encoder = encoder_ctx
            .open_as_with(codec, opts)
            .context("failed to open h264_vaapi")?;

        let extradata_annex_b = unsafe {
            let raw = encoder.as_ptr();
            if (*raw).extradata.is_null() || (*raw).extradata_size <= 0 {
                Vec::new()
            } else {
                avcc_extradata_to_annex_b(slice::from_raw_parts(
                    (*raw).extradata,
                    (*raw).extradata_size as usize,
                ))
            }
        };

        let sw_frame = VideoFrame::new(Pixel::NV12, params.width, params.height);

        let mut hw_frame = VideoFrame::empty();
        unsafe {
            let p = hw_frame.as_mut_ptr();
            if sys::av_hwframe_get_buffer(hw_frames.ptr, p, 0) < 0 {
                anyhow::bail!("av_hwframe_get_buffer failed");
            }
        }

        info!(
            width = params.width,
            height = params.height,
            bitrate_kbps = params.bitrate_kbps,
            device = %device,
            "VAAPI H.264 encoder ready"
        );

        Ok(Self {
            _hw_device: hw_device,
            _hw_frames: hw_frames,
            encoder,
            sw_frame,
            hw_frame,
            nv12_scratch: vec![0u8; (params.width as usize * params.height as usize * 3) / 2],
            packet: ffmpeg::Packet::empty(),
            width: params.width,
            height: params.height,
            frame_count: 0,
            keyframe_interval: params.keyframe_interval.max(1),
            extradata_annex_b,
            sent_extradata: false,
        })
    }

    pub fn encode(&mut self, frame: &Frame) -> anyhow::Result<Vec<Vec<u8>>> {
        self.fill_sw_frame(frame)?;

        unsafe {
            let sw = self.sw_frame.as_mut_ptr();
            if self.frame_count % self.keyframe_interval as u64 == 0 {
                (*sw).pict_type = sys::AVPictureType::AV_PICTURE_TYPE_I;
            } else {
                (*sw).pict_type = sys::AVPictureType::AV_PICTURE_TYPE_NONE;
            }
            (*sw).pts = self.frame_count as i64;
        }

        unsafe {
            let err = sys::av_hwframe_transfer_data(
                self.hw_frame.as_mut_ptr(),
                self.sw_frame.as_ptr(),
                0,
            );
            if err < 0 {
                anyhow::bail!("av_hwframe_transfer_data failed: {err}");
            }
            (*self.hw_frame.as_mut_ptr()).pts = (*self.sw_frame.as_ptr()).pts;
            (*self.hw_frame.as_mut_ptr()).pict_type = (*self.sw_frame.as_ptr()).pict_type;
        }

        self.encoder
            .send_frame(&self.hw_frame)
            .context("vaapi send_frame failed")?;

        let mut nals = Vec::new();
        if !self.sent_extradata && !self.extradata_annex_b.is_empty() {
            for nal in split_annex_b(&self.extradata_annex_b) {
                nals.push(nal);
            }
            self.sent_extradata = true;
        }

        loop {
            match self.encoder.receive_packet(&mut self.packet) {
                Ok(()) => {
                    if let Some(data) = self.packet.data() {
                        nals.append(&mut avcc_payload_to_annex_b(data));
                    }
                    self.packet = ffmpeg::Packet::empty();
                }
                Err(ffmpeg::Error::Other { errno }) if errno == sys::EAGAIN => break,
                Err(ffmpeg::Error::Eof) => break,
                Err(err) => return Err(err.into()),
            }
        }

        self.frame_count += 1;
        Ok(nals)
    }

    fn fill_sw_frame(&mut self, frame: &Frame) -> anyhow::Result<()> {
        if frame.width != self.width || frame.height != self.height {
            anyhow::bail!(
                "frame size {}x{} does not match encoder {}x{}",
                frame.width,
                frame.height,
                self.width,
                self.height
            );
        }

        match frame.format {
            PixelFormat::NV12 => {
                let y_size = (self.width * self.height) as usize;
                let uv_size = y_size / 2;
                if frame.data.len() < y_size + uv_size {
                    anyhow::bail!("NV12 frame too small");
                }
                self.upload_nv12(&frame.data[..y_size + uv_size])?;
            }
            PixelFormat::BGRA => {
                let needed = (self.width as usize * self.height as usize * 3) / 2;
                if self.nv12_scratch.len() != needed {
                    self.nv12_scratch.resize(needed, 0);
                }
                bgra_to_nv12_packed(
                    &frame.data,
                    self.width as usize,
                    self.height as usize,
                    &mut self.nv12_scratch,
                )?;
                let scratch = std::mem::take(&mut self.nv12_scratch);
                let result = self.upload_nv12(&scratch);
                self.nv12_scratch = scratch;
                result?;
            }
        }
        Ok(())
    }

    fn upload_nv12(&mut self, nv12: &[u8]) -> anyhow::Result<()> {
        let y_size = (self.width * self.height) as usize;
        let uv_size = y_size / 2;
        if nv12.len() < y_size + uv_size {
            anyhow::bail!("NV12 frame too small");
        }
        let y_stride = self.sw_frame.stride(0);
        let uv_stride = self.sw_frame.stride(1);
        copy_plane(
            &nv12[..y_size],
            self.width as usize,
            self.sw_frame.data_mut(0),
            y_stride,
            self.height as usize,
        );
        copy_plane(
            &nv12[y_size..y_size + uv_size],
            self.width as usize,
            self.sw_frame.data_mut(1),
            uv_stride,
            (self.height / 2) as usize,
        );
        Ok(())
    }
}

pub fn probe_vaapi() -> anyhow::Result<()> {
    ffmpeg::init().ok();
    ffmpeg::encoder::find_by_name("h264_vaapi")
        .ok_or_else(|| anyhow!("h264_vaapi not found"))?;
    let device = std::env::var("TABBY_VAAPI_DEVICE")
        .unwrap_or_else(|_| "/dev/dri/renderD128".into());
    let _ = create_vaapi_device(&device)?;
    debug!(%device, "VAAPI device probe ok");
    Ok(())
}

fn create_vaapi_device(node: &str) -> anyhow::Result<HwBuffer> {
    let c_node = CString::new(node)?;
    let mut ctx: *mut sys::AVBufferRef = ptr::null_mut();
    let err = unsafe {
        sys::av_hwdevice_ctx_create(
            &mut ctx,
            sys::AVHWDeviceType::AV_HWDEVICE_TYPE_VAAPI,
            c_node.as_ptr(),
            ptr::null_mut(),
            0,
        )
    };
    if err < 0 || ctx.is_null() {
        anyhow::bail!("av_hwdevice_ctx_create({node}) failed: {err}");
    }
    Ok(HwBuffer { ptr: ctx })
}

fn create_hw_frames(
    hw_device: *mut sys::AVBufferRef,
    width: u32,
    height: u32,
) -> anyhow::Result<HwBuffer> {
    unsafe {
        let frames = sys::av_hwframe_ctx_alloc(hw_device);
        if frames.is_null() {
            anyhow::bail!("av_hwframe_ctx_alloc failed");
        }
        let frames_ctx = (*frames).data as *mut sys::AVHWFramesContext;
        (*frames_ctx).format = sys::AVPixelFormat::AV_PIX_FMT_VAAPI;
        (*frames_ctx).sw_format = sys::AVPixelFormat::AV_PIX_FMT_NV12;
        (*frames_ctx).width = width as i32;
        (*frames_ctx).height = height as i32;
        (*frames_ctx).initial_pool_size = 8;
        let err = sys::av_hwframe_ctx_init(frames);
        if err < 0 {
            let mut frames_mut = frames;
            sys::av_buffer_unref(&mut frames_mut);
            anyhow::bail!("av_hwframe_ctx_init failed: {err}");
        }
        Ok(HwBuffer { ptr: frames })
    }
}

fn copy_plane(src: &[u8], src_stride: usize, dst: &mut [u8], dst_stride: usize, rows: usize) {
    for row in 0..rows {
        let src_off = row * src_stride;
        let dst_off = row * dst_stride;
        let len = src_stride
            .min(dst_stride)
            .min(src.len().saturating_sub(src_off));
        if len == 0 || dst_off + len > dst.len() {
            break;
        }
        dst[dst_off..dst_off + len].copy_from_slice(&src[src_off..src_off + len]);
    }
}

fn bgra_to_nv12_packed(
    bgra: &[u8],
    width: usize,
    height: usize,
    nv12: &mut [u8],
) -> anyhow::Result<()> {
    let y_size = width * height;
    let needed = y_size + y_size / 2;
    if bgra.len() < width * height * 4 || nv12.len() < needed {
        anyhow::bail!("BGRA/NV12 buffer too small");
    }
    let (y_plane, uv_plane) = nv12.split_at_mut(y_size);
    for y in 0..height {
        let row = y * width * 4;
        let y_row = y * width;
        for x in 0..width {
            let i = row + x * 4;
            let b = bgra[i] as i32;
            let g = bgra[i + 1] as i32;
            let r = bgra[i + 2] as i32;
            y_plane[y_row + x] = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(16, 235) as u8;
        }
    }
    for y in (0..height).step_by(2) {
        let uv_row = (y / 2) * width;
        for x in (0..width).step_by(2) {
            let mut b = 0i32;
            let mut g = 0i32;
            let mut r = 0i32;
            for dy in 0..2 {
                for dx in 0..2 {
                    let i = ((y + dy) * width + (x + dx)) * 4;
                    b += bgra[i] as i32;
                    g += bgra[i + 1] as i32;
                    r += bgra[i + 2] as i32;
                }
            }
            b >>= 2;
            g >>= 2;
            r >>= 2;
            let u = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128).clamp(16, 240) as u8;
            let v = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128).clamp(16, 240) as u8;
            uv_plane[uv_row + x] = u;
            uv_plane[uv_row + x + 1] = v;
        }
    }
    Ok(())
}

fn split_annex_b(data: &[u8]) -> Vec<Vec<u8>> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 < data.len() {
        if data[i] == 0 && data[i + 1] == 0 {
            if data[i + 2] == 1 {
                starts.push(i);
                i += 3;
                continue;
            }
            if i + 3 < data.len() && data[i + 2] == 0 && data[i + 3] == 1 {
                starts.push(i);
                i += 4;
                continue;
            }
        }
        i += 1;
    }
    if starts.is_empty() {
        return if data.is_empty() {
            Vec::new()
        } else {
            vec![data.to_vec()]
        };
    }
    let mut out = Vec::new();
    for (idx, &start) in starts.iter().enumerate() {
        let end = starts.get(idx + 1).copied().unwrap_or(data.len());
        out.push(data[start..end].to_vec());
    }
    out
}

fn avcc_extradata_to_annex_b(extradata: &[u8]) -> Vec<u8> {
    if extradata.len() < 7 || extradata[0] != 1 {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut i = 5;
    let sps_count = extradata.get(i).copied().unwrap_or(0) as usize & 0x1f;
    i += 1;
    for _ in 0..sps_count {
        if i + 2 > extradata.len() {
            break;
        }
        let len = u16::from_be_bytes([extradata[i], extradata[i + 1]]) as usize;
        i += 2;
        if i + len > extradata.len() {
            break;
        }
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&extradata[i..i + len]);
        i += len;
    }
    if i >= extradata.len() {
        return out;
    }
    let pps_count = extradata[i] as usize;
    i += 1;
    for _ in 0..pps_count {
        if i + 2 > extradata.len() {
            break;
        }
        let len = u16::from_be_bytes([extradata[i], extradata[i + 1]]) as usize;
        i += 2;
        if i + len > extradata.len() {
            break;
        }
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&extradata[i..i + len]);
        i += len;
    }
    out
}

fn avcc_payload_to_annex_b(data: &[u8]) -> Vec<Vec<u8>> {
    if data.starts_with(&[0, 0, 0, 1]) || data.starts_with(&[0, 0, 1]) {
        return split_annex_b(data);
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i + 4 <= data.len() {
        let n = u32::from_be_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]) as usize;
        i += 4;
        if n == 0 || i + n > data.len() {
            break;
        }
        let mut nal = Vec::with_capacity(n + 4);
        nal.extend_from_slice(&[0, 0, 0, 1]);
        nal.extend_from_slice(&data[i..i + n]);
        out.push(nal);
        i += n;
    }
    if out.is_empty() && !data.is_empty() {
        let mut nal = Vec::with_capacity(data.len() + 4);
        nal.extend_from_slice(&[0, 0, 0, 1]);
        nal.extend_from_slice(data);
        out.push(nal);
    }
    out
}
