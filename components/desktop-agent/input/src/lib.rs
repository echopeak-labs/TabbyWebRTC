mod handler;
mod keys;
mod payload;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

use serde::{Deserialize, Serialize};

pub use handler::{run_input_handler, InputPolicy};
pub use payload::InputPayload;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModifierState {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "u8", into = "u8")]
pub enum MouseButton {
    Left,
    Middle,
    Right,
}

impl From<u8> for MouseButton {
    fn from(value: u8) -> Self {
        match value {
            1 => MouseButton::Middle,
            2 => MouseButton::Right,
            _ => MouseButton::Left,
        }
    }
}

impl From<MouseButton> for u8 {
    fn from(value: MouseButton) -> Self {
        match value {
            MouseButton::Left => 0,
            MouseButton::Middle => 1,
            MouseButton::Right => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentCommand {
    CtrlAltDel,
    Sleep,
    Restart,
    Shutdown,
    #[serde(rename = "LOCK")]
    LockScreen,
}

pub trait InputInjector: Send {
    fn key_down(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()>;
    fn key_up(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()>;
    fn mouse_move_abs(&mut self, x: i32, y: i32) -> anyhow::Result<()>;
    fn mouse_move_rel(&mut self, dx: i32, dy: i32) -> anyhow::Result<()>;
    fn mouse_down(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()>;
    fn mouse_up(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()>;
    fn mouse_scroll(&mut self, delta_x: i32, delta_y: i32) -> anyhow::Result<()>;
    fn clipboard_paste(&mut self, text: &str) -> anyhow::Result<()>;
    fn execute_command(&mut self, cmd: &AgentCommand) -> anyhow::Result<()>;
}

pub fn create_injector() -> anyhow::Result<Box<dyn InputInjector>> {
    #[cfg(target_os = "linux")]
    return Ok(Box::new(linux::LinuxInjector::new()?));
    #[cfg(target_os = "windows")]
    return Ok(Box::new(windows::WindowsInjector::new()?));
    #[cfg(target_os = "macos")]
    return Ok(Box::new(macos::MacOsInjector::new()?));
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    anyhow::bail!("unsupported platform")
}

pub fn platform_name() -> &'static str {
    #[cfg(target_os = "linux")]
    return "linux";
    #[cfg(target_os = "windows")]
    return "windows";
    #[cfg(target_os = "macos")]
    return "macos";
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    return "unknown";
}
