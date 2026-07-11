use jpeg_encoder::{ColorType, Encoder};

use crate::{Frame, PixelFormat};

pub const THUMBNAIL_WIDTH: u32 = 960;
pub const THUMBNAIL_HEIGHT: u32 = 540;
pub const THUMBNAIL_QUALITY: u8 = 80;

pub fn frame_to_jpeg(frame: &Frame) -> anyhow::Result<Vec<u8>> {
    let rgba = frame_to_rgba(frame)?;
    let scaled = scale_bilinear(&rgba, frame.width, frame.height, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    let rgb = rgba_to_rgb(&scaled);
    let mut out = Vec::new();
    let encoder = Encoder::new(&mut out, THUMBNAIL_QUALITY);
    encoder.encode(
        &rgb,
        THUMBNAIL_WIDTH as u16,
        THUMBNAIL_HEIGHT as u16,
        ColorType::Rgb,
    )?;
    Ok(out)
}

fn frame_to_rgba(frame: &Frame) -> anyhow::Result<Vec<u8>> {
    match frame.format {
        PixelFormat::BGRA => {
            let mut rgba = Vec::with_capacity(frame.data.len());
            for px in frame.data.chunks_exact(4) {
                rgba.push(px[2]);
                rgba.push(px[1]);
                rgba.push(px[0]);
                rgba.push(255);
            }
            Ok(rgba)
        }
        PixelFormat::NV12 => nv12_to_rgba(&frame.data, frame.width, frame.height),
    }
}

fn nv12_to_rgba(nv12: &[u8], width: u32, height: u32) -> anyhow::Result<Vec<u8>> {
    let w = width as usize;
    let h = height as usize;
    let y_plane = w * h;
    if nv12.len() < y_plane + w * h / 2 {
        anyhow::bail!("NV12 buffer too small");
    }
    let mut rgba = vec![0u8; w * h * 4];
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
            rgba[out] = r;
            rgba[out + 1] = g;
            rgba[out + 2] = b;
            rgba[out + 3] = 255;
        }
    }
    Ok(rgba)
}

fn scale_bilinear(
    src: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
) -> Vec<u8> {
    let mut dst = vec![0u8; (dst_w * dst_h * 4) as usize];
    for y in 0..dst_h {
        let sy = (y as f32 + 0.5) * src_h as f32 / dst_h as f32 - 0.5;
        let y0 = sy.floor().max(0.0) as u32;
        let y1 = (y0 + 1).min(src_h - 1);
        let fy = sy - y0 as f32;
        for x in 0..dst_w {
            let sx = (x as f32 + 0.5) * src_w as f32 / dst_w as f32 - 0.5;
            let x0 = sx.floor().max(0.0) as u32;
            let x1 = (x0 + 1).min(src_w - 1);
            let fx = sx - x0 as f32;
            let dst_idx = ((y * dst_w + x) * 4) as usize;
            for c in 0..4 {
                let p00 = src[((y0 * src_w + x0) * 4 + c as u32) as usize] as f32;
                let p10 = src[((y0 * src_w + x1) * 4 + c as u32) as usize] as f32;
                let p01 = src[((y1 * src_w + x0) * 4 + c as u32) as usize] as f32;
                let p11 = src[((y1 * src_w + x1) * 4 + c as u32) as usize] as f32;
                let top = p00 + (p10 - p00) * fx;
                let bottom = p01 + (p11 - p01) * fx;
                dst[dst_idx + c] = (top + (bottom - top) * fy).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    dst
}

fn rgba_to_rgb(rgba: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for px in rgba.chunks_exact(4) {
        rgb.push(px[0]);
        rgb.push(px[1]);
        rgb.push(px[2]);
    }
    rgb
}
