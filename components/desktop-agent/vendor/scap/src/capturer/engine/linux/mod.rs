use std::{
    mem::size_of,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        mpsc::{self, sync_channel, SyncSender},
        Arc,
    },
    thread::JoinHandle,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use pipewire as pw;
use pw::{
    context::Context,
    main_loop::MainLoop,
    properties::properties,
    spa::{
        self,
        param::{
            format::{FormatProperties, MediaSubtype, MediaType},
            video::VideoFormat,
            ParamType,
        },
        pod::{Pod, Property},
        sys::{
            spa_buffer, spa_meta_header, SPA_META_Header, SPA_PARAM_META_size, SPA_PARAM_META_type,
        },
        utils::{Direction, SpaTypes},
    },
    stream::{StreamRef, StreamState},
};

use crate::{
    capturer::Options,
    frame::{BGRxFrame, Frame, RGBFrame, RGBxFrame, VideoFrame, XBGRFrame},
};

use self::{error::LinCapError, portal::ScreenCastPortal};

mod error;
mod portal;

const STATE_IDLE: u8 = 0;
const STATE_RUNNING: u8 = 1;
const STATE_STOPPING: u8 = 2;

struct CapturerControl {
    state: AtomicU8,
    stream_error: AtomicBool,
}

impl CapturerControl {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            state: AtomicU8::new(STATE_IDLE),
            stream_error: AtomicBool::new(false),
        })
    }
}

#[derive(Clone)]
struct ListenerUserData {
    pub tx: mpsc::SyncSender<Frame>,
    pub format: spa::param::video::VideoInfoRaw,
    pub control: Arc<CapturerControl>,
}

fn param_changed_callback(
    _stream: &StreamRef,
    user_data: &mut ListenerUserData,
    id: u32,
    param: Option<&Pod>,
) {
    let Some(param) = param else {
        return;
    };
    if id != pw::spa::param::ParamType::Format.as_raw() {
        return;
    }
    let (media_type, media_subtype) = match pw::spa::param::format_utils::parse_format(param) {
        Ok(v) => v,
        Err(_) => return,
    };

    if media_type != MediaType::Video || media_subtype != MediaSubtype::Raw {
        return;
    }

    if let Err(err) = user_data.format.parse(param) {
        eprintln!("pipewire: failed to parse format parameter: {err}");
    } else {
        let size = user_data.format.size();
        eprintln!(
            "pipewire: negotiated format={:?} size={}x{}",
            user_data.format.format(),
            size.width,
            size.height
        );
    }
}

fn state_changed_callback(
    _stream: &StreamRef,
    user_data: &mut ListenerUserData,
    old: StreamState,
    new: StreamState,
) {
    eprintln!("pipewire: state {old:?} -> {new:?}");
    if let StreamState::Error(e) = new {
        eprintln!("pipewire: State changed to error({e})");
        user_data
            .control
            .stream_error
            .store(true, Ordering::Relaxed);
    }
}

unsafe fn get_timestamp(buffer: *mut spa_buffer) -> i64 {
    let n_metas = (*buffer).n_metas;
    if n_metas > 0 {
        let mut meta_ptr = (*buffer).metas;
        let metas_end = (*buffer).metas.wrapping_add(n_metas as usize);
        while meta_ptr != metas_end {
            if (*meta_ptr).type_ == SPA_META_Header {
                let meta_header: &mut spa_meta_header =
                    &mut *((*meta_ptr).data as *mut spa_meta_header);
                return meta_header.pts;
            }
            meta_ptr = meta_ptr.wrapping_add(1);
        }
        0
    } else {
        0
    }
}

fn process_callback(stream: &StreamRef, user_data: &mut ListenerUserData) {
    let pw_buffer = unsafe { stream.dequeue_raw_buffer() };
    if pw_buffer.is_null() {
        return;
    }

    let result = 'process: {
        let buffer = unsafe { (*pw_buffer).buffer };
        if buffer.is_null() {
            break 'process;
        }

        let n_datas = unsafe { (*buffer).n_datas };
        if n_datas < 1 {
            break 'process;
        }

        let data_ptr = unsafe { (*(*buffer).datas).data };
        let maxsize = unsafe { (*(*buffer).datas).maxsize as usize };
        if data_ptr.is_null() || maxsize == 0 {
            break 'process;
        }

        let frame_size = user_data.format.size();
        if frame_size.width == 0 || frame_size.height == 0 {
            break 'process;
        }

        let (offset, size) = unsafe {
            let chunk = (*(*buffer).datas).chunk;
            if chunk.is_null() {
                (0usize, maxsize)
            } else {
                ((*chunk).offset as usize, (*chunk).size as usize)
            }
        };
        if offset >= maxsize {
            break 'process;
        }
        let copy_len = size.min(maxsize - offset);
        if copy_len == 0 {
            break 'process;
        }

        let frame_data = unsafe {
            std::slice::from_raw_parts((data_ptr as *const u8).add(offset), copy_len).to_vec()
        };
        let timestamp = unsafe { get_timestamp(buffer) };
        let display_time = if timestamp > 0 {
            UNIX_EPOCH + Duration::from_nanos(timestamp as u64)
        } else {
            SystemTime::now()
        };

        let frame = match user_data.format.format() {
            VideoFormat::NV12 => {
                let w = frame_size.width as i32;
                let h = frame_size.height as i32;
                let y_size = (frame_size.width * frame_size.height) as usize;
                let uv_size = y_size / 2;
                if frame_data.len() < y_size + uv_size {
                    eprintln!(
                        "pipewire: NV12 buffer too small ({} < {})",
                        frame_data.len(),
                        y_size + uv_size
                    );
                    break 'process;
                }
                Frame::Video(VideoFrame::YUVFrame(crate::frame::YUVFrame {
                    display_time,
                    width: w,
                    height: h,
                    luminance_bytes: frame_data[..y_size].to_vec(),
                    luminance_stride: w,
                    chrominance_bytes: frame_data[y_size..y_size + uv_size].to_vec(),
                    chrominance_stride: w,
                }))
            }
            VideoFormat::BGRA => Frame::Video(VideoFrame::BGRA(crate::frame::BGRAFrame {
                display_time,
                width: frame_size.width as i32,
                height: frame_size.height as i32,
                data: frame_data,
            })),
            VideoFormat::RGBx => Frame::Video(VideoFrame::RGBx(RGBxFrame {
                display_time,
                width: frame_size.width as i32,
                height: frame_size.height as i32,
                data: frame_data,
            })),
            VideoFormat::RGBA => {
                let mut bgra = Vec::with_capacity((frame_data.len() / 4) * 4);
                for px in frame_data.chunks_exact(4) {
                    bgra.extend_from_slice(&[px[2], px[1], px[0], px[3]]);
                }
                Frame::Video(VideoFrame::BGRA(crate::frame::BGRAFrame {
                    display_time,
                    width: frame_size.width as i32,
                    height: frame_size.height as i32,
                    data: bgra,
                }))
            }
            VideoFormat::RGB => Frame::Video(VideoFrame::RGB(RGBFrame {
                display_time,
                width: frame_size.width as i32,
                height: frame_size.height as i32,
                data: frame_data,
            })),
            VideoFormat::xBGR => Frame::Video(VideoFrame::XBGR(XBGRFrame {
                display_time,
                width: frame_size.width as i32,
                height: frame_size.height as i32,
                data: frame_data,
            })),
            VideoFormat::BGRx => Frame::Video(VideoFrame::BGRx(BGRxFrame {
                display_time,
                width: frame_size.width as i32,
                height: frame_size.height as i32,
                data: frame_data,
            })),
            other => {
                eprintln!("Unsupported frame format received: {other:?}");
                break 'process;
            }
        };

        match user_data.tx.try_send(frame) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(_)) => {}
            Err(mpsc::TrySendError::Disconnected(_)) => {
                eprintln!("pipewire: frame channel closed");
                user_data
                    .control
                    .state
                    .store(STATE_STOPPING, Ordering::Relaxed);
            }
        }
    };

    let _ = result;
    unsafe { stream.queue_raw_buffer(pw_buffer) };
}

fn pipewire_capturer(
    options: Options,
    tx: mpsc::SyncSender<Frame>,
    ready_sender: &SyncSender<bool>,
    stream_id: u32,
    control: Arc<CapturerControl>,
) -> Result<(), LinCapError> {
    control.stream_error.store(false, Ordering::Relaxed);
    control.state.store(STATE_IDLE, Ordering::Relaxed);

    pw::init();

    let mainloop = MainLoop::new(None)?;
    let context = Context::new(&mainloop)?;
    let core = context.connect(None)?;

    let user_data = ListenerUserData {
        tx,
        format: Default::default(),
        control: Arc::clone(&control),
    };

    let stream = pw::stream::Stream::new(
        &core,
        "scap",
        properties! {
            *pw::keys::MEDIA_TYPE => "Video",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
        },
    )?;

    let _listener = stream
        .add_local_listener_with_user_data(user_data)
        .state_changed(state_changed_callback)
        .param_changed(param_changed_callback)
        .process(process_callback)
        .register()?;

    let fps = options.fps.max(1);
    let obj = pw::spa::pod::object!(
        pw::spa::utils::SpaTypes::ObjectParamFormat,
        pw::spa::param::ParamType::EnumFormat,
        pw::spa::pod::property!(FormatProperties::MediaType, Id, MediaType::Video),
        pw::spa::pod::property!(FormatProperties::MediaSubtype, Id, MediaSubtype::Raw),
        pw::spa::pod::property!(
            FormatProperties::VideoFormat,
            Choice,
            Enum,
            Id,
            pw::spa::param::video::VideoFormat::NV12,
            pw::spa::param::video::VideoFormat::BGRx,
            pw::spa::param::video::VideoFormat::BGRA,
            pw::spa::param::video::VideoFormat::RGBA,
            pw::spa::param::video::VideoFormat::RGBx,
            pw::spa::param::video::VideoFormat::RGB,
            pw::spa::param::video::VideoFormat::xBGR,
        ),
        pw::spa::pod::property!(
            FormatProperties::VideoSize,
            Choice,
            Range,
            Rectangle,
            pw::spa::utils::Rectangle {
                width: 1920,
                height: 1080,
            },
            pw::spa::utils::Rectangle {
                width: 1,
                height: 1,
            },
            pw::spa::utils::Rectangle {
                width: 16384,
                height: 16384,
            }
        ),
        pw::spa::pod::property!(
            FormatProperties::VideoFramerate,
            Choice,
            Range,
            Fraction,
            pw::spa::utils::Fraction { num: fps, denom: 1 },
            pw::spa::utils::Fraction { num: 0, denom: 1 },
            pw::spa::utils::Fraction { num: fps, denom: 1 }
        ),
    );

    let metas_obj = pw::spa::pod::object!(
        SpaTypes::ObjectParamMeta,
        ParamType::Meta,
        Property::new(
            SPA_PARAM_META_type,
            pw::spa::pod::Value::Id(pw::spa::utils::Id(SPA_META_Header))
        ),
        Property::new(
            SPA_PARAM_META_size,
            pw::spa::pod::Value::Int(size_of::<pw::spa::sys::spa_meta_header>() as i32)
        ),
    );

    let values: Vec<u8> = pw::spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &pw::spa::pod::Value::Object(obj),
    )?
    .0
    .into_inner();
    let metas_values: Vec<u8> = pw::spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &pw::spa::pod::Value::Object(metas_obj),
    )?
    .0
    .into_inner();

    let mut params = [
        pw::spa::pod::Pod::from_bytes(&values).unwrap(),
        pw::spa::pod::Pod::from_bytes(&metas_values).unwrap(),
    ];

    eprintln!("pipewire: connecting to node {stream_id}");
    stream.connect(
        Direction::Input,
        Some(stream_id),
        pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
        &mut params,
    )?;

    ready_sender.send(true)?;

    let pw_loop = mainloop.loop_();

    while control.state.load(Ordering::Relaxed) == STATE_IDLE
        && !control.stream_error.load(Ordering::Relaxed)
    {
        pw_loop.iterate(Duration::from_millis(50));
    }

    while control.state.load(Ordering::Relaxed) == STATE_RUNNING
        && !control.stream_error.load(Ordering::Relaxed)
    {
        pw_loop.iterate(Duration::from_millis(50));
    }

    let final_state = control.state.load(Ordering::Relaxed);
    let errored = control.stream_error.load(Ordering::Relaxed);
    eprintln!("pipewire: capturer loop exit state={final_state} error={errored}");

    Ok(())
}

pub struct LinuxCapturer {
    capturer_join_handle: Option<JoinHandle<Result<(), LinCapError>>>,
    control: Arc<CapturerControl>,
    _connection: dbus::blocking::Connection,
}

impl LinuxCapturer {
    pub fn new(options: &Options, tx: mpsc::SyncSender<Frame>) -> Self {
        let connection =
            dbus::blocking::Connection::new_session().expect("Failed to create dbus connection");
        let stream_id = ScreenCastPortal::new(&connection)
            .show_cursor(options.show_cursor)
            .expect("Unsupported cursor mode")
            .create_stream()
            .expect("Failed to get screencast stream")
            .pw_node_id();

        let options = options.clone();
        let control = CapturerControl::new();
        let control_for_thread = Arc::clone(&control);
        let (ready_sender, ready_recv) = sync_channel(1);
        let capturer_join_handle = std::thread::spawn(move || {
            let res = pipewire_capturer(
                options,
                tx,
                &ready_sender,
                stream_id,
                control_for_thread,
            );
            if res.is_err() {
                let _ = ready_sender.send(false);
            }
            res
        });

        if !ready_recv.recv().expect("Failed to receive") {
            panic!("Failed to setup capturer");
        }

        Self {
            capturer_join_handle: Some(capturer_join_handle),
            control,
            _connection: connection,
        }
    }

    pub fn start_capture(&self) {
        self.control.stream_error.store(false, Ordering::Relaxed);
        self.control.state.store(STATE_RUNNING, Ordering::Relaxed);
    }

    pub fn stop_capture(&mut self) {
        self.control.state.store(STATE_STOPPING, Ordering::Relaxed);
        if let Some(handle) = self.capturer_join_handle.take() {
            match handle.join() {
                Ok(Err(e)) => eprintln!("Error occured capturing: {e}"),
                Err(_) => eprintln!("Capturer thread panicked"),
                Ok(Ok(())) => {}
            }
        }
        self.control.state.store(STATE_IDLE, Ordering::Relaxed);
        self.control.stream_error.store(false, Ordering::Relaxed);
    }
}

impl Drop for LinuxCapturer {
    fn drop(&mut self) {
        if self.capturer_join_handle.is_some() {
            self.stop_capture();
        }
    }
}

pub fn create_capturer(options: &Options, tx: mpsc::SyncSender<Frame>) -> LinuxCapturer {
    LinuxCapturer::new(options, tx)
}
