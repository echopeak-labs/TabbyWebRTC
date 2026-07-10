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
    fn prepare_viewport(&mut self, width: u32, height: u32) -> anyhow::Result<()> {
        let _ = (width, height);
        Ok(())
    }
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

struct NullInjector;

impl InputInjector for NullInjector {
    fn key_down(&mut self, _code: &str, _modifiers: &ModifierState) -> anyhow::Result<()> {
        Ok(())
    }
    fn key_up(&mut self, _code: &str, _modifiers: &ModifierState) -> anyhow::Result<()> {
        Ok(())
    }
    fn mouse_move_abs(&mut self, _x: i32, _y: i32) -> anyhow::Result<()> {
        Ok(())
    }
    fn mouse_move_rel(&mut self, _dx: i32, _dy: i32) -> anyhow::Result<()> {
        Ok(())
    }
    fn mouse_down(&mut self, _button: MouseButton, _x: i32, _y: i32) -> anyhow::Result<()> {
        Ok(())
    }
    fn mouse_up(&mut self, _button: MouseButton, _x: i32, _y: i32) -> anyhow::Result<()> {
        Ok(())
    }
    fn mouse_scroll(&mut self, _delta_x: i32, _delta_y: i32) -> anyhow::Result<()> {
        Ok(())
    }
    fn clipboard_paste(&mut self, _text: &str) -> anyhow::Result<()> {
        Ok(())
    }
    fn execute_command(&mut self, _cmd: &AgentCommand) -> anyhow::Result<()> {
        Ok(())
    }
}

pub fn create_injector() -> anyhow::Result<Box<dyn InputInjector>> {
    Ok(Box::new(LazyInjector::default()))
}

struct LazyInjector {
    inner: Option<Box<dyn InputInjector>>,
    init_failed: bool,
    pending_viewport: Option<(u32, u32)>,
}

impl Default for LazyInjector {
    fn default() -> Self {
        Self {
            inner: None,
            init_failed: false,
            pending_viewport: None,
        }
    }
}

impl LazyInjector {
    fn ensure(&mut self) -> &mut dyn InputInjector {
        if self.inner.is_none() && !self.init_failed {
            match create_platform_injector() {
                Ok(injector) => self.inner = Some(injector),
                Err(err) => {
                    self.init_failed = true;
                    tracing::error!(
                        %err,
                        "remote input disabled: cannot open /dev/uinput. \
                         Fix: sudo usermod -aG input \"$USER\", then fully log out/in \
                         (do not use sg input — it breaks PipeWire portal)"
                    );
                    self.inner = Some(Box::new(NullInjector));
                }
            }
            if let (Some(inj), Some((w, h))) = (self.inner.as_mut(), self.pending_viewport) {
                if let Err(err) = inj.prepare_viewport(w, h) {
                    tracing::warn!(%err, "prepare_viewport failed after injector init");
                }
            }
        }
        self.inner
            .as_mut()
            .expect("injector slot always set after ensure")
            .as_mut()
    }
}

impl InputInjector for LazyInjector {
    fn prepare_viewport(&mut self, width: u32, height: u32) -> anyhow::Result<()> {
        self.pending_viewport = Some((width, height));
        if self.inner.is_some() || !self.init_failed {
            self.ensure().prepare_viewport(width, height)?;
        }
        Ok(())
    }
    fn key_down(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()> {
        self.ensure().key_down(code, modifiers)
    }
    fn key_up(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()> {
        self.ensure().key_up(code, modifiers)
    }
    fn mouse_move_abs(&mut self, x: i32, y: i32) -> anyhow::Result<()> {
        self.ensure().mouse_move_abs(x, y)
    }
    fn mouse_move_rel(&mut self, dx: i32, dy: i32) -> anyhow::Result<()> {
        self.ensure().mouse_move_rel(dx, dy)
    }
    fn mouse_down(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()> {
        self.ensure().mouse_down(button, x, y)
    }
    fn mouse_up(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()> {
        self.ensure().mouse_up(button, x, y)
    }
    fn mouse_scroll(&mut self, delta_x: i32, delta_y: i32) -> anyhow::Result<()> {
        self.ensure().mouse_scroll(delta_x, delta_y)
    }
    fn clipboard_paste(&mut self, text: &str) -> anyhow::Result<()> {
        self.ensure().clipboard_paste(text)
    }
    fn execute_command(&mut self, cmd: &AgentCommand) -> anyhow::Result<()> {
        self.ensure().execute_command(cmd)
    }
}

fn create_platform_injector() -> anyhow::Result<Box<dyn InputInjector>> {
    #[cfg(target_os = "linux")]
    {
        let injector = linux::LinuxInjector::new()?;
        tracing::info!("remote input ready (uinput)");
        Ok(Box::new(injector))
    }
    #[cfg(target_os = "windows")]
    {
        Ok(Box::new(windows::WindowsInjector::new()?))
    }
    #[cfg(target_os = "macos")]
    {
        Ok(Box::new(macos::MacOsInjector::new()?))
    }
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
