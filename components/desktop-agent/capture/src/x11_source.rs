use std::os::fd::AsRawFd;
use std::ptr;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use tracing::info;
use x11rb::connection::{Connection, RequestConnection};
use x11rb::protocol::randr::{self, ConnectionExt as _};
use x11rb::protocol::shm::{self, ConnectionExt as _};
use x11rb::protocol::xproto::{self, ConnectionExt as _, ImageFormat};
use x11rb::rust_connection::RustConnection;

use crate::{Capturable, Frame, PixelFormat, SourceDescriptor, SourceKind};

#[derive(Debug, Clone)]
pub struct X11Display {
    pub index: u32,
    pub name: String,
    pub x: i16,
    pub y: i16,
    pub width: u16,
    pub height: u16,
    pub primary: bool,
}

pub fn is_x11_session() -> bool {
    if std::env::var_os("DISPLAY").is_none() {
        return false;
    }
    if let Ok(session) = std::env::var("XDG_SESSION_TYPE") {
        if session.eq_ignore_ascii_case("wayland") {
            return false;
        }
    }
    std::env::var_os("WAYLAND_DISPLAY").is_none()
}

pub fn enumerate_displays() -> anyhow::Result<Vec<SourceDescriptor>> {
    let displays = list_displays()?;
    Ok(displays
        .into_iter()
        .map(|d| SourceDescriptor {
            id: format!("display-{}", d.index),
            name: format!(
                "Display {} · {}×{}",
                d.index + 1,
                d.width,
                d.height
            ),
            kind: SourceKind::Display,
            width: d.width as u32,
            height: d.height as u32,
        })
        .collect())
}

pub fn enumerate_windows() -> anyhow::Result<Vec<SourceDescriptor>> {
    let (conn, screen_num) = x11rb::connect(None).context("failed to connect to X11 display")?;
    let screen = &conn.setup().roots[screen_num];
    let root = screen.root;
    let client_list = intern_atom(&conn, "_NET_CLIENT_LIST")?;
    let wm_state = intern_atom(&conn, "_NET_WM_STATE")?;
    let hidden = intern_atom(&conn, "_NET_WM_STATE_HIDDEN")?;
    let window_type = intern_atom(&conn, "_NET_WM_WINDOW_TYPE")?;
    let type_normal = intern_atom(&conn, "_NET_WM_WINDOW_TYPE_NORMAL")?;
    let type_dialog = intern_atom(&conn, "_NET_WM_WINDOW_TYPE_DIALOG")?;
    let net_wm_name = intern_atom(&conn, "_NET_WM_NAME")?;
    let utf8 = intern_atom(&conn, "UTF8_STRING")?;
    let wm_class = intern_atom(&conn, "WM_CLASS")?;

    let reply = conn
        .get_property(false, root, client_list, xproto::AtomEnum::WINDOW, 0, 1024)?
        .reply()
        .context("_NET_CLIENT_LIST")?;
    let windows = reply.value32().into_iter().flatten().collect::<Vec<_>>();
    let mut sources = Vec::new();

    for xid in windows {
        let attrs = match conn.get_window_attributes(xid)?.reply() {
            Ok(a) => a,
            Err(_) => continue,
        };
        if attrs.map_state != xproto::MapState::VIEWABLE {
            continue;
        }
        if attrs.override_redirect {
            continue;
        }

        let geom = match conn.get_geometry(xid)?.reply() {
            Ok(g) => g,
            Err(_) => continue,
        };
        if geom.width < 100 || geom.height < 100 {
            continue;
        }

        if let Ok(state) = conn
            .get_property(false, xid, wm_state, xproto::AtomEnum::ATOM, 0, 64)?
            .reply()
        {
            if state
                .value32()
                .into_iter()
                .flatten()
                .any(|atom| atom == hidden)
            {
                continue;
            }
        }

        if let Ok(types) = conn
            .get_property(false, xid, window_type, xproto::AtomEnum::ATOM, 0, 16)?
            .reply()
        {
            let atoms: Vec<_> = types.value32().into_iter().flatten().collect();
            if !atoms.is_empty()
                && !atoms.iter().any(|a| *a == type_normal || *a == type_dialog)
            {
                continue;
            }
        }

        let class = window_string_prop(&conn, xid, wm_class, xproto::AtomEnum::STRING.into())
            .and_then(|raw| {
                raw.split('\0')
                    .filter(|s| !s.is_empty())
                    .last()
                    .map(|s| s.to_string())
            });
        let title = window_string_prop(&conn, xid, net_wm_name, utf8)
            .or_else(|| {
                window_string_prop(&conn, xid, xproto::AtomEnum::WM_NAME.into(), xproto::AtomEnum::STRING.into())
            })
            .filter(|s| !s.is_empty());

        let name = match (title, class) {
            (Some(t), Some(c)) if !t.to_lowercase().contains(&c.to_lowercase()) => {
                format!("{t} ({c})")
            }
            (Some(t), _) => t,
            (None, Some(c)) => c,
            (None, None) => format!("Window {xid}"),
        };

        sources.push(SourceDescriptor {
            id: format!("app-{xid}"),
            name,
            kind: SourceKind::App,
            width: geom.width as u32,
            height: geom.height as u32,
        });
    }

    Ok(sources)
}

pub fn enumerate_common_gui_processes() -> Vec<SourceDescriptor> {
    const KNOWN: &[(&str, &str)] = &[
        ("chrome", "Google Chrome"),
        ("chromium", "Chromium"),
        ("chromium-browser", "Chromium"),
        ("google-chrome", "Google Chrome"),
        ("firefox", "Firefox"),
        ("code", "Visual Studio Code"),
        ("cursor", "Cursor"),
        ("slack", "Slack"),
        ("discord", "Discord"),
        ("spotify", "Spotify"),
        ("nautilus", "Files"),
        ("dolphin", "Dolphin"),
        ("thunar", "Thunar"),
        ("gnome-terminal", "Terminal"),
        ("kitty", "Kitty"),
        ("alacritty", "Alacritty"),
        ("obs", "OBS Studio"),
        ("vlc", "VLC"),
    ];
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let pid: u32 = match name.parse() {
            Ok(pid) => pid,
            Err(_) => continue,
        };
        let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).unwrap_or_default();
        let comm = comm.trim();
        if comm.is_empty() || !seen.insert(comm.to_string()) {
            continue;
        }
        if let Some((_, label)) = KNOWN.iter().find(|(proc_name, _)| {
            comm.eq_ignore_ascii_case(proc_name)
        }) {
            found.push(SourceDescriptor {
                id: format!("app-proc-{pid}"),
                name: (*label).into(),
                kind: SourceKind::App,
                width: 1280,
                height: 720,
            });
        }
    }
    found
}

pub fn create_from_id(
    source_id: &str,
    config: &crate::CaptureConfig,
) -> anyhow::Result<Box<dyn crate::Capturable>> {
    if let Some(index) = source_id.strip_prefix("display-") {
        let index = index.parse::<u32>().context("invalid display index")?;
        let displays = list_displays()?;
        let display = displays
            .into_iter()
            .find(|d| d.index == index)
            .ok_or_else(|| anyhow::anyhow!("display {index} not found"))?;
        return Ok(Box::new(X11Capturable::new(display, config.max_fps)));
    }
    if let Some(xid) = source_id.strip_prefix("app-") {
        let xid = xid.parse::<u32>().context("invalid window id")?;
        return Ok(Box::new(X11WindowCapturable::new(xid, config.max_fps)?));
    }
    anyhow::bail!("unsupported x11 source id {source_id}")
}

fn intern_atom(conn: &RustConnection, name: &str) -> anyhow::Result<xproto::Atom> {
    Ok(conn.intern_atom(false, name.as_bytes())?.reply()?.atom)
}

fn window_string_prop(
    conn: &RustConnection,
    window: xproto::Window,
    property: xproto::Atom,
    type_: xproto::Atom,
) -> Option<String> {
    let reply = conn
        .get_property(false, window, property, type_, 0, 4096)
        .ok()?
        .reply()
        .ok()?;
    if reply.value.is_empty() {
        return None;
    }
    let value = String::from_utf8_lossy(&reply.value);
    let trimmed = value.trim_end_matches('\0').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn list_displays() -> anyhow::Result<Vec<X11Display>> {
    let (conn, screen_num) = x11rb::connect(None).context("failed to connect to X11 display")?;
    let screen = &conn.setup().roots[screen_num];
    let root = screen.root;

    if conn
        .extension_information(randr::X11_EXTENSION_NAME)?
        .is_some()
    {
        let version = conn.randr_query_version(1, 5)?.reply()?;
        if version.major_version > 1 || (version.major_version == 1 && version.minor_version >= 5)
        {
            let reply = conn.randr_get_monitors(root, true)?.reply()?;
            let mut displays = Vec::new();
            for (index, monitor) in reply.monitors.into_iter().enumerate() {
                if monitor.width == 0 || monitor.height == 0 {
                    continue;
                }
                let name = atom_name(&conn, monitor.name)
                    .unwrap_or_else(|| format!("Display {}", index));
                displays.push(X11Display {
                    index: index as u32,
                    name,
                    x: monitor.x,
                    y: monitor.y,
                    width: monitor.width,
                    height: monitor.height,
                    primary: monitor.primary,
                });
            }
            if !displays.is_empty() {
                displays.sort_by_key(|d| (d.y, d.x));
                for (index, display) in displays.iter_mut().enumerate() {
                    display.index = index as u32;
                }
                return Ok(displays);
            }
        }
    }

    Ok(vec![X11Display {
        index: 0,
        name: "Primary Display".into(),
        x: 0,
        y: 0,
        width: screen.width_in_pixels,
        height: screen.height_in_pixels,
        primary: true,
    }])
}

fn atom_name(conn: &RustConnection, atom: xproto::Atom) -> Option<String> {
    let reply = conn.get_atom_name(atom).ok()?.reply().ok()?;
    String::from_utf8(reply.name).ok()
}

struct ShmBuffer {
    seg: shm::Seg,
    ptr: *mut u8,
    len: usize,
}

unsafe impl Send for ShmBuffer {}

impl Drop for ShmBuffer {
    fn drop(&mut self) {
        if !self.ptr.is_null() && self.len > 0 {
            unsafe {
                libc::munmap(self.ptr as *mut _, self.len);
            }
        }
    }
}

pub struct X11Capturable {
    id: String,
    name: String,
    display: X11Display,
    max_fps: u32,
    conn: Option<RustConnection>,
    root: xproto::Window,
    shm: Option<ShmBuffer>,
    last_frame_at: Instant,
}

impl X11Capturable {
    fn new(display: X11Display, max_fps: u32) -> Self {
        let name = format!(
            "Display {} · {}×{}",
            display.index + 1,
            display.width,
            display.height
        );
        Self {
            id: format!("display-{}", display.index),
            name,
            display,
            max_fps: max_fps.max(1),
            conn: None,
            root: 0,
            shm: None,
            last_frame_at: Instant::now()
                .checked_sub(Duration::from_secs(1))
                .unwrap_or_else(Instant::now),
        }
    }

    fn ensure_started(&mut self) -> anyhow::Result<()> {
        if self.conn.is_some() {
            return Ok(());
        }
        let (conn, screen_num) = x11rb::connect(None).context("failed to connect to X11 display")?;
        let screen = &conn.setup().roots[screen_num];
        let root = screen.root;
        let bytes = (self.display.width as usize)
            .saturating_mul(self.display.height as usize)
            .saturating_mul(4);
        let shm = setup_shm(&conn, bytes)?;
        info!(
            source_id = %self.id,
            name = %self.name,
            x = self.display.x,
            y = self.display.y,
            width = self.display.width,
            height = self.display.height,
            "x11 capturer ready (no portal)"
        );
        self.root = root;
        self.shm = Some(shm);
        self.conn = Some(conn);
        Ok(())
    }

    fn capture_bgra(&mut self) -> anyhow::Result<Vec<u8>> {
        let conn = self
            .conn
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("x11 capture not started"))?;
        let shm = self
            .shm
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("x11 shm buffer missing"))?;
        let width = self.display.width;
        let height = self.display.height;
        let reply = conn
            .shm_get_image(
                self.root,
                self.display.x,
                self.display.y,
                width,
                height,
                !0,
                ImageFormat::Z_PIXMAP.into(),
                shm.seg,
                0,
            )
            .context("shm_get_image request failed")?
            .reply()
            .context("shm_get_image reply failed")?;
        if reply.depth != 24 && reply.depth != 32 {
            anyhow::bail!("unsupported x11 depth {}", reply.depth);
        }
        let expected = width as usize * height as usize * 4;
        let mut data = vec![0u8; expected];
        unsafe {
            ptr::copy_nonoverlapping(shm.ptr, data.as_mut_ptr(), expected.min(shm.len));
        }
        for px in data.chunks_exact_mut(4) {
            px[3] = 255;
        }
        Ok(data)
    }
}

fn setup_shm(conn: &RustConnection, size: usize) -> anyhow::Result<ShmBuffer> {
    if conn
        .extension_information(shm::X11_EXTENSION_NAME)?
        .is_none()
    {
        anyhow::bail!("X11 MIT-SHM extension unavailable");
    }
    let seg = conn.generate_id()?;
    let reply = conn
        .shm_create_segment(seg, size as u32, false)?
        .reply()
        .context("shm_create_segment failed")?;
    let fd = reply.shm_fd;
    let addr = unsafe {
        libc::mmap(
            ptr::null_mut(),
            size,
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_SHARED,
            fd.as_raw_fd(),
            0,
        )
    };
    if addr == libc::MAP_FAILED {
        let _ = conn.shm_detach(seg);
        anyhow::bail!("mmap of x11 shm segment failed");
    }
    Ok(ShmBuffer {
        seg,
        ptr: addr as *mut u8,
        len: size,
    })
}

impl Drop for X11Capturable {
    fn drop(&mut self) {
        self.stop_capture();
    }
}

impl X11Capturable {
    fn stop_capture(&mut self) {
        if let (Some(conn), Some(shm)) = (self.conn.as_ref(), self.shm.as_ref()) {
            let _ = conn.shm_detach(shm.seg);
        }
        self.shm = None;
        self.conn = None;
    }
}

impl Capturable for X11Capturable {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn width(&self) -> u32 {
        self.display.width as u32
    }

    fn height(&self) -> u32 {
        self.display.height as u32
    }

    fn start(&mut self) -> anyhow::Result<()> {
        self.ensure_started()
    }

    fn stop(&mut self) {
        self.stop_capture();
    }

    fn next_frame(&mut self) -> anyhow::Result<Frame> {
        self.ensure_started()?;
        let min_gap = Duration::from_micros(1_000_000 / self.max_fps as u64);
        let elapsed = self.last_frame_at.elapsed();
        if elapsed < min_gap {
            std::thread::sleep(min_gap - elapsed);
        }
        let data = self.capture_bgra()?;
        self.last_frame_at = Instant::now();
        let timestamp_us = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros() as u64;
        Ok(Frame {
            data,
            format: PixelFormat::BGRA,
            width: self.display.width as u32,
            height: self.display.height as u32,
            timestamp_us,
        })
    }

    fn capture_thumbnail(&mut self) -> anyhow::Result<Vec<u8>> {
        let was_running = self.conn.is_some();
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

pub struct X11WindowCapturable {
    id: String,
    name: String,
    window: xproto::Window,
    width: u16,
    height: u16,
    max_fps: u32,
    conn: Option<RustConnection>,
    shm: Option<ShmBuffer>,
    last_frame_at: Instant,
}

impl X11WindowCapturable {
    fn new(window: xproto::Window, max_fps: u32) -> anyhow::Result<Self> {
        let (conn, _) = x11rb::connect(None).context("failed to connect to X11 display")?;
        let geom = conn.get_geometry(window)?.reply()?;
        let name = format!("Window {window}");
        drop(conn);
        Ok(Self {
            id: format!("app-{window}"),
            name,
            window,
            width: geom.width.max(1),
            height: geom.height.max(1),
            max_fps: max_fps.max(1),
            conn: None,
            shm: None,
            last_frame_at: Instant::now()
                .checked_sub(Duration::from_secs(1))
                .unwrap_or_else(Instant::now),
        })
    }

    fn ensure_started(&mut self) -> anyhow::Result<()> {
        if self.conn.is_some() {
            return Ok(());
        }
        let (conn, _) = x11rb::connect(None).context("failed to connect to X11 display")?;
        let geom = conn.get_geometry(self.window)?.reply()?;
        self.width = geom.width.max(1);
        self.height = geom.height.max(1);
        let bytes = (self.width as usize)
            .saturating_mul(self.height as usize)
            .saturating_mul(4);
        let shm = setup_shm(&conn, bytes)?;
        self.shm = Some(shm);
        self.conn = Some(conn);
        Ok(())
    }

    fn stop_capture(&mut self) {
        if let (Some(conn), Some(shm)) = (self.conn.as_ref(), self.shm.as_ref()) {
            let _ = conn.shm_detach(shm.seg);
        }
        self.shm = None;
        self.conn = None;
    }

    fn capture_bgra(&mut self) -> anyhow::Result<Vec<u8>> {
        let conn = self
            .conn
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("x11 window capture not started"))?;
        let geom = conn.get_geometry(self.window)?.reply()?;
        let width = geom.width.max(1);
        let height = geom.height.max(1);
        if width != self.width || height != self.height || self.shm.is_none() {
            anyhow::bail!("window size changed");
        }
        let shm = self
            .shm
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("x11 shm buffer missing"))?;
        let reply = conn
            .shm_get_image(
                self.window,
                0,
                0,
                width,
                height,
                !0,
                ImageFormat::Z_PIXMAP.into(),
                shm.seg,
                0,
            )
            .context("shm_get_image window request failed")?
            .reply()
            .context("shm_get_image window reply failed")?;
        if reply.depth != 24 && reply.depth != 32 {
            anyhow::bail!("unsupported x11 depth {}", reply.depth);
        }
        let expected = width as usize * height as usize * 4;
        let mut data = vec![0u8; expected];
        unsafe {
            ptr::copy_nonoverlapping(shm.ptr, data.as_mut_ptr(), expected.min(shm.len));
        }
        for px in data.chunks_exact_mut(4) {
            px[3] = 255;
        }
        self.width = width;
        self.height = height;
        Ok(data)
    }
}

impl Drop for X11WindowCapturable {
    fn drop(&mut self) {
        self.stop_capture();
    }
}

impl Capturable for X11WindowCapturable {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn width(&self) -> u32 {
        self.width as u32
    }

    fn height(&self) -> u32 {
        self.height as u32
    }

    fn start(&mut self) -> anyhow::Result<()> {
        self.ensure_started()
    }

    fn stop(&mut self) {
        self.stop_capture();
    }

    fn next_frame(&mut self) -> anyhow::Result<Frame> {
        if let Err(err) = self.ensure_started() {
            self.stop_capture();
            self.ensure_started().map_err(|_| err)?;
        }
        let min_gap = Duration::from_micros(1_000_000 / self.max_fps as u64);
        let elapsed = self.last_frame_at.elapsed();
        if elapsed < min_gap {
            std::thread::sleep(min_gap - elapsed);
        }
        let data = match self.capture_bgra() {
            Ok(data) => data,
            Err(_) => {
                self.stop_capture();
                self.ensure_started()?;
                self.capture_bgra()?
            }
        };
        self.last_frame_at = Instant::now();
        let timestamp_us = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros() as u64;
        Ok(Frame {
            data,
            format: PixelFormat::BGRA,
            width: self.width as u32,
            height: self.height as u32,
            timestamp_us,
        })
    }

    fn capture_thumbnail(&mut self) -> anyhow::Result<Vec<u8>> {
        let was_running = self.conn.is_some();
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
