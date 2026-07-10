use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_H264};
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::policy::bundle_policy::RTCBundlePolicy;
use webrtc::peer_connection::policy::rtcp_mux_policy::RTCRtcpMuxPolicy;
use webrtc::rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTCRtpCodecParameters, RTPCodecType};

#[derive(Debug, Clone)]
pub struct TurnConfig {
    pub urls: Vec<String>,
    pub username: String,
    pub credential: String,
}

pub fn build_webrtc_api() -> anyhow::Result<webrtc::api::API> {
    let mut media_engine = MediaEngine::default();
    media_engine.register_codec(
        RTCRtpCodecParameters {
            capability: RTCRtpCodecCapability {
                mime_type: MIME_TYPE_H264.to_owned(),
                clock_rate: 90000,
                sdp_fmtp_line:
                    "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f"
                        .to_owned(),
                ..Default::default()
            },
            payload_type: 96,
            ..Default::default()
        },
        RTPCodecType::Video,
    )?;

    let registry = register_default_interceptors(Default::default(), &mut media_engine)?;
    Ok(APIBuilder::new()
        .with_media_engine(media_engine)
        .with_interceptor_registry(registry)
        .build())
}

pub fn rtc_configuration(turn: Option<&TurnConfig>) -> RTCConfiguration {
    let mut ice_servers = vec![RTCIceServer {
        urls: vec!["stun:stun.l.google.com:19302".to_string()],
        ..Default::default()
    }];

    if let Some(turn) = turn {
        ice_servers.push(RTCIceServer {
            urls: turn.urls.clone(),
            username: turn.username.clone(),
            credential: turn.credential.clone(),
            ..Default::default()
        });
    }

    RTCConfiguration {
        ice_servers,
        bundle_policy: RTCBundlePolicy::MaxBundle,
        rtcp_mux_policy: RTCRtcpMuxPolicy::Require,
        ..Default::default()
    }
}

pub fn h264_track_codec() -> RTCRtpCodecCapability {
    RTCRtpCodecCapability {
        mime_type: MIME_TYPE_H264.to_owned(),
        clock_rate: 90000,
        sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f"
            .to_owned(),
        ..Default::default()
    }
}
