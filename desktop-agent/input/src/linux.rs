use std::mem::{size_of, zeroed};
use std::process::Command as StdCommand;

use arboard::Clipboard;
use nix::ioctl_write_int;
use nix::libc::{self, c_int, input_event, input_id, uinput_setup, INPUT_PROP_DIRECT};
use tracing::warn;

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

const UI_DEV_SETUP: libc::c_ulong = 0xC0105503;
const UI_ABS_SETUP: libc::c_ulong = 0xC010550B;
const UI_SET_PROPBIT: libc::c_ulong = 0x4004556E;

ioctl_write_int!(ui_set_evbit, b'U', 100);
ioctl_write_int!(ui_set_keybit, b'U', 101);
ioctl_write_int!(ui_set_relbit, b'U', 102);
ioctl_write_int!(ui_set_absbit, b'U', 103);
ioctl_write_int!(ui_dev_create, b'U', 1);

#[repr(C)]
struct UinputAbsSetup {
    code: u16,
    absinfo: InputAbsInfo,
}

#[repr(C)]
struct InputAbsInfo {
    value: i32,
    minimum: i32,
    maximum: i32,
    fuzz: i32,
    flat: i32,
    resolution: i32,
}

pub struct LinuxInjector {
    keyboard: UInputDevice,
    mouse: UInputDevice,
    screen_width: i32,
    screen_height: i32,
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
            if libc::ioctl(fd, UI_DEV_SETUP, &usetup as *const uinput_setup) == -1 {
                return Err(anyhow::anyhow!("UI_DEV_SETUP failed"));
            }
            ui_dev_create(fd, 0u64)?;
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
    unsafe {
        std::slice::from_raw_parts((value as *const T) as *const u8, size_of::<T>())
    }
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

fn setup_mouse(fd: c_int, width: i32, height: i32) -> anyhow::Result<()> {
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
        ui_set_absbit(fd, ABS_X as u64)?;
        ui_set_absbit(fd, ABS_Y as u64)?;
        for code in [ABS_X, ABS_Y] {
            let max = if code == ABS_X {
                width.saturating_sub(1)
            } else {
                height.saturating_sub(1)
            };
            let setup = UinputAbsSetup {
                code,
                absinfo: InputAbsInfo {
                    value: 0,
                    minimum: 0,
                    maximum: max,
                    fuzz: 0,
                    flat: 0,
                    resolution: 0,
                },
            };
            if libc::ioctl(fd, UI_ABS_SETUP, &setup as *const UinputAbsSetup) == -1 {
                return Err(anyhow::anyhow!("UI_ABS_SETUP failed for code {code}"));
            }
        }
        let prop = INPUT_PROP_DIRECT as c_int;
        let _ = libc::ioctl(fd, UI_SET_PROPBIT, &prop as *const c_int);
    }
    Ok(())
}

fn screen_size() -> (i32, i32) {
    std::fs::read_to_string("/sys/class/graphics/fb0/virtual_size")
        .ok()
        .and_then(|s| {
            let mut parts = s.trim().split(',');
            Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
        })
        .unwrap_or((1920, 1080))
}

impl LinuxInjector {
    pub fn new() -> anyhow::Result<Self> {
        let (screen_width, screen_height) = screen_size();
        let keyboard = UInputDevice::open("tabbyrdp-keyboard", setup_keyboard)?;
        let mouse = UInputDevice::open("tabbyrdp-mouse", |fd| {
            setup_mouse(fd, screen_width, screen_height)
        })?;
        Ok(Self {
            keyboard,
            mouse,
            screen_width,
            screen_height,
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
    fn key_down(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()> {
        self.apply_modifiers(modifiers, true)?;
        self.key_event(code, true)
    }

    fn key_up(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()> {
        self.key_event(code, false)?;
        self.apply_modifiers(modifiers, false)
    }

    fn mouse_move_abs(&mut self, x: i32, y: i32) -> anyhow::Result<()> {
        let x = x.clamp(0, self.screen_width.saturating_sub(1));
        let y = y.clamp(0, self.screen_height.saturating_sub(1));
        self.mouse.emit(EV_ABS, ABS_X, x)?;
        self.mouse.emit(EV_ABS, ABS_Y, y)?;
        self.mouse.sync()
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
    fn screen_size_has_sane_defaults() {
        let (w, h) = screen_size();
        assert!(w > 0);
        assert!(h > 0);
    }

    #[test]
    fn keyboard_injection_types_text() {
        if !std::path::Path::new("/dev/uinput").exists() {
            return;
        }
        let Ok(mut injector) = LinuxInjector::new() else {
            eprintln!("uinput unavailable (need input group membership)");
            return;
        };
        for code in ["KeyH", "KeyE", "KeyL", "KeyL", "KeyO"] {
            injector
                .key_down(code, &ModifierState::default())
                .expect("key down");
            injector
                .key_up(code, &ModifierState::default())
                .expect("key up");
        }
    }

    #[test]
    fn mouse_injection_moves_and_clicks() {
        if !std::path::Path::new("/dev/uinput").exists() {
            return;
        }
        let Ok(mut injector) = LinuxInjector::new() else {
            eprintln!("uinput unavailable (need input group membership)");
            return;
        };
        injector.mouse_move_abs(100, 100).expect("move");
        injector
            .mouse_down(MouseButton::Left, 100, 100)
            .expect("down");
        injector
            .mouse_up(MouseButton::Left, 100, 100)
            .expect("up");
    }
}
