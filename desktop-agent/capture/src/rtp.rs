const RTP_MAX_PAYLOAD: usize = 1200;
const H264_PAYLOAD_TYPE: u8 = 96;
const FU_A_INDICATOR: u8 = 28;

#[derive(Debug, Clone)]
pub struct RtpPacket {
    pub payload_type: u8,
    pub sequence: u16,
    pub timestamp: u32,
    pub marker: bool,
    pub payload: Vec<u8>,
}

pub struct H264Packetizer {
    sequence: u16,
    timestamp: u32,
    timestamp_step: u32,
}

impl H264Packetizer {
    pub fn new(fps: u32) -> Self {
        Self {
            sequence: 0,
            timestamp: 0,
            timestamp_step: 90_000 / fps.max(1),
        }
    }

    pub fn packetize_annex_b(&mut self, annex_b: &[u8], marker: bool) -> Vec<RtpPacket> {
        let nals = split_annex_b_nals(annex_b);
        let mut packets = Vec::new();
        for (idx, nal) in nals.iter().enumerate() {
            let is_last = idx == nals.len() - 1;
            packets.extend(self.packetize_nal(nal, marker && is_last));
        }
        if marker {
            self.timestamp = self.timestamp.wrapping_add(self.timestamp_step);
        }
        packets
    }

    fn packetize_nal(&mut self, nal: &[u8], marker: bool) -> Vec<RtpPacket> {
        if nal.is_empty() {
            return Vec::new();
        }

        let nal_type = nal[0] & 0x1f;
        let max_fragment = RTP_MAX_PAYLOAD - 2;

        if nal.len() <= RTP_MAX_PAYLOAD {
            let mut payload = Vec::with_capacity(nal.len());
            payload.extend_from_slice(nal);
            let packet = self.emit(payload, marker);
            return vec![packet];
        }

        let mut packets = Vec::new();
        let mut offset = 1;
        let mut first = true;
        while offset < nal.len() {
            let chunk_end = (offset + max_fragment).min(nal.len());
            let chunk = &nal[offset..chunk_end];
            let is_last = chunk_end == nal.len();

            let fu_indicator = (nal[0] & 0xe0) | FU_A_INDICATOR;
            let mut fu_header = nal_type;
            if first {
                fu_header |= 0x80;
                first = false;
            }
            if is_last {
                fu_header |= 0x40;
            }

            let mut payload = Vec::with_capacity(2 + chunk.len());
            payload.push(fu_indicator);
            payload.push(fu_header);
            payload.extend_from_slice(chunk);

            packets.push(self.emit(payload, marker && is_last));
            offset = chunk_end;
        }

        packets
    }

    fn emit(&mut self, payload: Vec<u8>, marker: bool) -> RtpPacket {
        let packet = RtpPacket {
            payload_type: H264_PAYLOAD_TYPE,
            sequence: self.sequence,
            timestamp: self.timestamp,
            marker,
            payload,
        };
        self.sequence = self.sequence.wrapping_add(1);
        packet
    }
}

fn split_annex_b_nals(data: &[u8]) -> Vec<&[u8]> {
    let mut nals = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let start = find_start_code(data, i);
        if start.is_none() {
            break;
        }
        let nal_start = start.unwrap();
        let mut next = nal_start + 3;
        if data[nal_start..].starts_with(&[0, 0, 0, 1]) {
            next = nal_start + 4;
        }
        let mut nal_end = data.len();
        if let Some(next_start) = find_start_code(data, next) {
            nal_end = next_start;
        }
        if next < nal_end {
            nals.push(&data[next..nal_end]);
        }
        i = nal_end;
    }
    nals
}

fn find_start_code(data: &[u8], from: usize) -> Option<usize> {
    let mut i = from;
    while i + 3 <= data.len() {
        if data[i..].starts_with(&[0, 0, 0, 1]) {
            return Some(i);
        }
        if data[i..].starts_with(&[0, 0, 1]) {
            return Some(i);
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_annex_b_nals() {
        let data = [0, 0, 0, 1, 0x67, 0x42, 0, 0, 1, 0x68, 0xce];
        let nals = split_annex_b_nals(&data);
        assert_eq!(nals.len(), 2);
        assert_eq!(nals[0], &[0x67, 0x42]);
        assert_eq!(nals[1], &[0x68, 0xce]);
    }

    #[test]
    fn fragments_large_nal() {
        let mut nal = vec![0x65];
        nal.extend(vec![0xAB; 2000]);
        let mut packetizer = H264Packetizer::new(60);
        let packets = packetizer.packetize_nal(&nal, true);
        assert!(packets.len() > 1);
        assert!(packets.last().unwrap().marker);
        assert!(packets[0].payload[1] & 0x80 != 0);
        assert!(packets.last().unwrap().payload[1] & 0x40 != 0);
    }
}
