use std::mem::{size_of, zeroed};
use std::process::Command as StdCommand;

use arboard::Clipboard;
use nix::ioctl_none;
use nix::ioctl_write_int;
use nix::ioctl_write_ptr;
use nix::libc::{c_int, input_event, input_id, uinput_setup};
use tracing::{info, warn};

use crate::keys::code_to_vk;
use crate::{AgentCommand, InputInjector, ModifierState, MouseButton};

const EV_SYN: u16 = 0;
const EV_KEY: u16 = 1;
const EV_REL: u16 = 2;
const EV_ABS: u16 = 3;
const SYN_REPORT: u16 = 0;
const REL_X: u16 = 0;
const REL_Y: u16 = 1;
const REL_WHEEL: u16 = 8;
const REL_HWHEEL: u16 = 6;
const ABS_X: u16 = 0;
const ABS_Y: u16 = 1;
const BTN_LEFT: u16 = 0x110;
const BTN_RIGHT: u16 = 0x111;
const BTN_MIDDLE: u16 = 0x112;
const KEY_LEFTCTRL: u16 = 29;
const KEY_LEFTALT: u16 = 56;
const KEY_LEFTSHIFT: u16 = 42;
const KEY_LEFTMETA: u16 = 125;
const KEY_DELETE: u16 = 111;
const KEY_V: u16 = 47;

#[repr(C)]
struct InputAbsInfo {
    value: i32,
    minimum: i32,
    maximum: i32,
    fuzz: i32,
    flat: i32,
    resolution: i32,
}

#[repr(C)]
struct UInputAbsSetup {
    code: u16,
    absinfo: InputAbsInfo,
}

ioctl_write_int!(ui_set_evbit, b'U', 100);
ioctl_write_int!(ui_set_keybit, b'U', 101);
ioctl_write_int!(ui_set_relbit, b'U', 102);
ioctl_write_int!(ui_set_absbit, b'U', 103);
ioctl_none!(ui_dev_create, b'U', 1);
ioctl_write_ptr!(ui_dev_setup, b'U', 3, uinput_setup);
ioctl_write_ptr!(ui_abs_setup, b'U', 4, UInputAbsSetup);

#[derive(Debug, Clone, Copy)]
struct MonitorGeom {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    primary: bool,
}

pub struct LinuxInjector {
    keyboard: UInputDevice,
    mouse: UInputDevice,
    desk_width: i32,
    desk_height: i32,
    origin_x: i32,
    origin_y: i32,
    viewport_w: i32,
    viewport_h: i32,
    viewport_ready: bool,
}

struct UInputDevice {
    file: std::fs::File,
}

impl UInputDevice {
    fn open(name: &str, setup: impl FnOnce(c_int) -> anyhow::Result<()>) -> anyhow::Result<Self> {
        use std::fs::OpenOptions;
        use std::os::unix::io::AsRawFd;

        let file = OpenOptions::new()
            .write(true)
            .open("/dev/uinput")
            .map_err(|err| anyhow::anyhow!("failed to open /dev/uinput: {err}"))?;
        let fd = file.as_raw_fd();
        setup(fd)?;
        let mut usetup: uinput_setup = unsafe { zeroed() };
        let name_bytes = name.as_bytes();
        let len = name_bytes.len().min(usetup.name.len() - 1);
        let name_slice = &mut usetup.name[..len];
        for (i, &byte) in name_bytes[..len].iter().enumerate() {
            name_slice[i] = byte as i8;
        }
        usetup.id = input_id {
            bustype: 0x03,
            vendor: 0x1234,
            product: 0x5678,
            version: 1,
        };
        unsafe {
            ui_dev_setup(fd, &usetup)
                .map_err(|err| anyhow::anyhow!("UI_DEV_SETUP failed: {err}"))?;
            ui_dev_create(fd).map_err(|err| anyhow::anyhow!("UI_DEV_CREATE failed: {err}"))?;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
        Ok(Self { file })
    }

    fn emit(&mut self, kind: u16, code: u16, value: i32) -> anyhow::Result<()> {
        use std::io::Write;

        let event = input_event {
            time: unsafe { zeroed() },
            type_: kind,
            code,
            value,
        };
        self.file.write_all(as_bytes(&event))?;
        Ok(())
    }

    fn sync(&mut self) -> anyhow::Result<()> {
        self.emit(EV_SYN, SYN_REPORT, 0)
    }
}

fn as_bytes<T>(value: &T) -> &[u8] {
    unsafe { std::slice::from_raw_parts((value as *const T) as *const u8, size_of::<T>()) }
}

fn setup_keyboard(fd: c_int) -> anyhow::Result<()> {
    unsafe {
        ui_set_evbit(fd, EV_KEY as u64)?;
        for code in 1..=255u16 {
            ui_set_keybit(fd, code as u64)?;
        }
    }
    Ok(())
}

fn setup_abs_axis(fd: c_int, code: u16, max: i32) -> anyhow::Result<()> {
    let setup = UInputAbsSetup {
        code,
        absinfo: InputAbsInfo {
            value: 0,
            minimum: 0,
            maximum: max.max(1),
            fuzz: 0,
            flat: 0,
            resolution: 0,
        },
    };
    unsafe {
        ui_set_absbit(fd, code as u64)?;
        ui_abs_setup(fd, &setup).map_err(|err| anyhow::anyhow!("UI_ABS_SETUP failed: {err}"))?;
    }
    Ok(())
}

fn setup_mouse(fd: c_int, desk_w: i32, desk_h: i32) -> anyhow::Result<()> {
    unsafe {
        ui_set_evbit(fd, EV_KEY as u64)?;
        ui_set_evbit(fd, EV_REL as u64)?;
        ui_set_evbit(fd, EV_ABS as u64)?;
        ui_set_keybit(fd, BTN_LEFT as u64)?;
        ui_set_keybit(fd, BTN_RIGHT as u64)?;
        ui_set_keybit(fd, BTN_MIDDLE as u64)?;
        ui_set_relbit(fd, REL_X as u64)?;
        ui_set_relbit(fd, REL_Y as u64)?;
        ui_set_relbit(fd, REL_WHEEL as u64)?;
        ui_set_relbit(fd, REL_HWHEEL as u64)?;
    }
    setup_abs_axis(fd, ABS_X, desk_w.saturating_sub(1))?;
    setup_abs_axis(fd, ABS_Y, desk_h.saturating_sub(1))?;
    Ok(())
}

fn parse_xrandr_monitors(output: &str) -> Vec<MonitorGeom> {
    let mut monitors = Vec::new();
    for line in output.lines() {
        if !line.contains(" connected") {
            continue;
        }
        let primary = line.contains(" primary ");
        let Some(geom) = line.split_whitespace().find(|tok| {
            tok.chars().next().is_some_and(|c| c.is_ascii_digit()) && tok.contains('x') && tok.contains('+')
        }) else {
            continue;
        };
        let mut parts = geom.split('+');
        let Some(res) = parts.next() else {
            continue;
        };
        let mut wh = res.split('x');
        let (Some(w), Some(h), Some(x), Some(y)) = (
            wh.next().and_then(|v| v.parse().ok()),
            wh.next().and_then(|v| v.parse().ok()),
            parts.next().and_then(|v| v.parse().ok()),
            parts.next().and_then(|v| v.parse().ok()),
        ) else {
            continue;
        };
        monitors.push(MonitorGeom {
            x,
            y,
            width: w,
            height: h,
            primary,
        });
    }
    monitors
}

fn query_monitors() -> Vec<MonitorGeom> {
    let output = StdCommand::new("xrandr")
        .arg("--current")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned());
    match output {
        Some(text) => parse_xrandr_monitors(&text),
        None => Vec::new(),
    }
}

fn desktop_bounds(monitors: &[MonitorGeom]) -> (i32, i32) {
    if monitors.is_empty() {
        return screen_size_fallback();
    }
    let right = monitors
        .iter()
        .map(|m| m.x + m.width)
        .max()
        .unwrap_or(1920);
    let bottom = monitors
        .iter()
        .map(|m| m.y + m.height)
        .max()
        .unwrap_or(1080);
    (right.max(1), bottom.max(1))
}

fn screen_size_fallback() -> (i32, i32) {
    std::fs::read_to_string("/sys/class/graphics/fb0/virtual_size")
        .ok()
        .and_then(|s| {
            let mut parts = s.trim().split(',');
            Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
        })
        .unwrap_or((1920, 1080))
}

fn select_monitor(monitors: &[MonitorGeom], width: i32, height: i32) -> MonitorGeom {
    let matches: Vec<_> = monitors
        .iter()
        .copied()
        .filter(|m| m.width == width && m.height == height)
        .collect();
    if let Some(primary) = matches.iter().find(|m| m.primary) {
        return *primary;
    }
    if let Some(first) = matches.first() {
        return *first;
    }
    if let Some(primary) = monitors.iter().find(|m| m.primary) {
        return MonitorGeom {
            x: primary.x,
            y: primary.y,
            width,
            height,
            primary: true,
        };
    }
    MonitorGeom {
        x: 0,
        y: 0,
        width,
        height,
        primary: false,
    }
}

impl LinuxInjector {
    pub fn new() -> anyhow::Result<Self> {
        let monitors = query_monitors();
        let (desk_width, desk_height) = desktop_bounds(&monitors);
        let keyboard = UInputDevice::open("tabbywebrtc-keyboard", setup_keyboard)?;
        let mouse = UInputDevice::open("tabbywebrtc-mouse", |fd| {
            setup_mouse(fd, desk_width, desk_height)
        })?;
        Ok(Self {
            keyboard,
            mouse,
            desk_width,
            desk_height,
            origin_x: 0,
            origin_y: 0,
            viewport_w: desk_width,
            viewport_h: desk_height,
            viewport_ready: false,
        })
    }

    fn apply_modifiers(&mut self, modifiers: &ModifierState, down: bool) -> anyhow::Result<()> {
        let value = if down { 1 } else { 0 };
        if modifiers.ctrl {
            self.keyboard.emit(EV_KEY, KEY_LEFTCTRL, value)?;
        }
        if modifiers.alt {
            self.keyboard.emit(EV_KEY, KEY_LEFTALT, value)?;
        }
        if modifiers.shift {
            self.keyboard.emit(EV_KEY, KEY_LEFTSHIFT, value)?;
        }
        if modifiers.meta {
            self.keyboard.emit(EV_KEY, KEY_LEFTMETA, value)?;
        }
        self.keyboard.sync()
    }

    fn key_event(&mut self, code: &str, down: bool) -> anyhow::Result<()> {
        let Some(scancode) = code_to_vk(code) else {
            warn!(code, "unknown key code");
            return Ok(());
        };
        let value = if down { 1 } else { 0 };
        self.keyboard.emit(EV_KEY, scancode, value)?;
        self.keyboard.sync()
    }

    fn mouse_button_code(button: MouseButton) -> u16 {
        match button {
            MouseButton::Left => BTN_LEFT,
            MouseButton::Middle => BTN_MIDDLE,
            MouseButton::Right => BTN_RIGHT,
        }
    }

    fn warp_global(&mut self, x: i32, y: i32) -> anyhow::Result<()> {
        let x = x.clamp(0, self.desk_width.saturating_sub(1));
        let y = y.clamp(0, self.desk_height.saturating_sub(1));
        self.mouse.emit(EV_ABS, ABS_X, x)?;
        self.mouse.emit(EV_ABS, ABS_Y, y)?;
        self.mouse.sync()
    }

    fn local_to_global(&self, x: i32, y: i32) -> (i32, i32) {
        let x = x.clamp(0, self.viewport_w.saturating_sub(1));
        let y = y.clamp(0, self.viewport_h.saturating_sub(1));
        (self.origin_x + x, self.origin_y + y)
    }

    fn send_ctrl_alt_del(&mut self) -> anyhow::Result<()> {
        for key in [KEY_LEFTCTRL, KEY_LEFTALT, KEY_DELETE] {
            self.keyboard.emit(EV_KEY, key, 1)?;
        }
        self.keyboard.sync()?;
        for key in [KEY_DELETE, KEY_LEFTALT, KEY_LEFTCTRL] {
            self.keyboard.emit(EV_KEY, key, 0)?;
        }
        self.keyboard.sync()
    }

    fn paste_shortcut(&mut self) -> anyhow::Result<()> {
        for key in [KEY_LEFTCTRL, KEY_V] {
            self.keyboard.emit(EV_KEY, key, 1)?;
        }
        self.keyboard.sync()?;
        for key in [KEY_V, KEY_LEFTCTRL] {
            self.keyboard.emit(EV_KEY, key, 0)?;
        }
        self.keyboard.sync()
    }
}

impl InputInjector for LinuxInjector {
    fn prepare_viewport(&mut self, width: u32, height: u32) -> anyhow::Result<()> {
        let width = width.max(1) as i32;
        let height = height.max(1) as i32;
        let monitors = query_monitors();
        let monitor = select_monitor(&monitors, width, height);
        self.origin_x = monitor.x;
        self.origin_y = monitor.y;
        self.viewport_w = width;
        self.viewport_h = height;
        let center_x = self.origin_x + self.viewport_w / 2;
        let center_y = self.origin_y + self.viewport_h / 2;
        self.warp_global(center_x, center_y)?;
        self.viewport_ready = true;
        info!(
            origin_x = self.origin_x,
            origin_y = self.origin_y,
            viewport_w = self.viewport_w,
            viewport_h = self.viewport_h,
            center_x,
            center_y,
            "snapped host cursor to streamed display center"
        );
        Ok(())
    }

    fn key_down(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()> {
        self.apply_modifiers(modifiers, true)?;
        self.key_event(code, true)
    }

    fn key_up(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()> {
        self.key_event(code, false)?;
        self.apply_modifiers(modifiers, false)
    }

    fn mouse_move_abs(&mut self, x: i32, y: i32) -> anyhow::Result<()> {
        if !self.viewport_ready {
            let _ = self.prepare_viewport(self.viewport_w as u32, self.viewport_h as u32);
        }
        let (gx, gy) = self.local_to_global(x, y);
        self.warp_global(gx, gy)
    }

    fn mouse_move_rel(&mut self, dx: i32, dy: i32) -> anyhow::Result<()> {
        if dx != 0 {
            self.mouse.emit(EV_REL, REL_X, dx)?;
        }
        if dy != 0 {
            self.mouse.emit(EV_REL, REL_Y, dy)?;
        }
        self.mouse.sync()
    }

    fn mouse_down(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()> {
        self.mouse_move_abs(x, y)?;
        self.mouse
            .emit(EV_KEY, Self::mouse_button_code(button), 1)?;
        self.mouse.sync()
    }

    fn mouse_up(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()> {
        self.mouse_move_abs(x, y)?;
        self.mouse
            .emit(EV_KEY, Self::mouse_button_code(button), 0)?;
        self.mouse.sync()
    }

    fn mouse_scroll(&mut self, delta_x: i32, delta_y: i32) -> anyhow::Result<()> {
        if delta_y != 0 {
            let steps = delta_y / 120;
            let steps = if steps == 0 { delta_y.signum() } else { steps };
            self.mouse.emit(EV_REL, REL_WHEEL, -steps)?;
        }
        if delta_x != 0 {
            let steps = delta_x / 120;
            let steps = if steps == 0 { delta_x.signum() } else { steps };
            self.mouse.emit(EV_REL, REL_HWHEEL, steps)?;
        }
        self.mouse.sync()
    }

    fn clipboard_paste(&mut self, text: &str) -> anyhow::Result<()> {
        Clipboard::new()?.set_text(text)?;
        self.paste_shortcut()
    }

    fn execute_command(&mut self, cmd: &AgentCommand) -> anyhow::Result<()> {
        match cmd {
            AgentCommand::CtrlAltDel => self.send_ctrl_alt_del(),
            AgentCommand::Sleep => spawn_command("systemctl", &["suspend"]),
            AgentCommand::Restart => spawn_command("systemctl", &["reboot"]),
            AgentCommand::Shutdown => spawn_command("systemctl", &["poweroff"]),
            AgentCommand::LockScreen => {
                if spawn_command("loginctl", &["lock-session"]).is_err() {
                    spawn_command("xdg-screensaver", &["lock"])?;
                }
                Ok(())
            }
        }
    }
}

fn spawn_command(program: &str, args: &[&str]) -> anyhow::Result<()> {
    StdCommand::new(program)
        .args(args)
        .spawn()
        .map_err(|err| anyhow::anyhow!("failed to spawn {program}: {err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_xrandr_geometry() {
        let sample = "\
HDMI-2 connected primary 2560x1080+1920+0 (normal left inverted right x axis y axis)
DVI-I-2-2 connected 1920x1080+0+0 (normal left inverted right x axis y axis)
DVI-I-1-1 connected 1920x1080+4480+0 (normal left inverted right x axis y axis)
";
        let monitors = parse_xrandr_monitors(sample);
        assert_eq!(monitors.len(), 3);
        let selected = select_monitor(&monitors, 2560, 1080);
        assert_eq!(selected.x, 1920);
        assert_eq!(selected.y, 0);
        assert!(selected.primary);
        let left = select_monitor(&monitors, 1920, 1080);
        assert!(left.x == 0 || left.x == 4480);
    }

    #[test]
    fn desktop_bounds_from_monitors() {
        let monitors = parse_xrandr_monitors(
            "HDMI-2 connected primary 2560x1080+1920+0\nDVI-I-2-2 connected 1920x1080+0+0\n",
        );
        let (w, h) = desktop_bounds(&monitors);
        assert_eq!(w, 4480);
        assert_eq!(h, 1080);
    }
}
