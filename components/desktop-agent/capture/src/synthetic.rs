use std::time::{SystemTime, UNIX_EPOCH};

use crate::{Frame, PixelFormat};

pub struct SyntheticCapturable {
    id: String,
    name: String,
    width: u32,
    height: u32,
    running: bool,
    frame_index: u64,
}

impl SyntheticCapturable {
    pub fn display(id: impl Into<String>, name: impl Into<String>, width: u32, height: u32) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            width,
            height,
            running: false,
            frame_index: 0,
        }
    }
}

impl crate::Capturable for SyntheticCapturable {
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
        self.running = true;
        Ok(())
    }

    fn stop(&mut self) {
        self.running = false;
    }

    fn next_frame(&mut self) -> anyhow::Result<Frame> {
        if !self.running {
            anyhow::bail!("capture not started");
        }
        let mut data = vec![0u8; (self.width * self.height * 4) as usize];
        let phase = (self.frame_index % 256) as u8;
        for (i, px) in data.chunks_exact_mut(4).enumerate() {
            px[0] = ((i as u32 % self.width) % 256) as u8;
            px[1] = phase;
            px[2] = 180;
            px[3] = 255;
        }
        self.frame_index += 1;
        let timestamp_us = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros() as u64;
        Ok(Frame {
            data,
            format: PixelFormat::BGRA,
            width: self.width,
            height: self.height,
            timestamp_us,
        })
    }

    fn capture_thumbnail(&mut self) -> anyhow::Result<Vec<u8>> {
        let frame = self.next_frame()?;
        crate::thumbnail::frame_to_jpeg(&frame)
    }
}
