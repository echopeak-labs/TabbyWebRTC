use std::mem::size_of;
use std::process::Command as StdCommand;

use arboard::Clipboard;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{GetLastError, HMODULE, FreeLibrary, GetProcAddress, LoadLibraryW};
use windows::Win32::System::Shutdown::{
    ExitWindowsEx, EWX_FORCE, EWX_REBOOT, EWX_SHUTDOWN,
};
use windows::Win32::System::SystemServices::SHTDN_REASON_MAJOR_OTHER;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
    MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN,
    MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
    VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_RCONTROL, VK_V,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, LockWorkStation, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
};

use crate::keys::code_to_vk_windows;
use crate::{AgentCommand, InputInjector, ModifierState, MouseButton};

pub struct WindowsInjector {
    screen_width: i32,
    screen_height: i32,
}

impl WindowsInjector {
    pub fn new() -> anyhow::Result<Self> {
        let screen_width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
        let screen_height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
        Ok(Self {
            screen_width: screen_width.max(1),
            screen_height: screen_height.max(1),
        })
    }

    fn send_inputs(inputs: &[INPUT]) -> anyhow::Result<()> {
        let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
        if sent as usize != inputs.len() {
            let err = unsafe { GetLastError() };
            return Err(anyhow::anyhow!("SendInput failed: {err:?}"));
        }
        Ok(())
    }

    fn mouse_input(flags: MOUSE_EVENT_FLAGS, dx: i32, dy: i32, data: u32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx,
                    dy,
                    mouseData: data,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn key_input(vk: VIRTUAL_KEY, down: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if down {
                        Default::default()
                    } else {
                        KEYEVENTF_KEYUP
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn apply_modifiers(&self, modifiers: &ModifierState, down: bool) -> anyhow::Result<()> {
        let mut inputs = Vec::new();
        if modifiers.ctrl {
            inputs.push(Self::key_input(VK_LCONTROL, down));
        }
        if modifiers.alt {
            inputs.push(Self::key_input(VK_LMENU, down));
        }
        if modifiers.shift {
            inputs.push(Self::key_input(VK_LSHIFT, down));
        }
        if modifiers.meta {
            inputs.push(Self::key_input(VK_RCONTROL, down));
        }
        if !inputs.is_empty() {
            Self::send_inputs(&inputs)?;
        }
        Ok(())
    }

    fn key_event(&self, code: &str, down: bool) -> anyhow::Result<()> {
        let Some(vk) = code_to_vk_windows(code) else {
            return Ok(());
        };
        Self::send_inputs(&[Self::key_input(VIRTUAL_KEY(vk), down)])
    }

    fn mouse_button_flags(button: MouseButton, down: bool) -> MOUSE_EVENT_FLAGS {
        match (button, down) {
            (MouseButton::Left, true) => MOUSEEVENTF_LEFTDOWN,
            (MouseButton::Left, false) => MOUSEEVENTF_LEFTUP,
            (MouseButton::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
            (MouseButton::Middle, false) => MOUSEEVENTF_MIDDLEUP,
            (MouseButton::Right, true) => MOUSEEVENTF_RIGHTDOWN,
            (MouseButton::Right, false) => MOUSEEVENTF_RIGHTUP,
        }
    }

    fn paste_shortcut(&self) -> anyhow::Result<()> {
        Self::send_inputs(&[
            Self::key_input(VK_LCONTROL, true),
            Self::key_input(VK_V, true),
            Self::key_input(VK_V, false),
            Self::key_input(VK_LCONTROL, false),
        ])
    }

    fn send_ctrl_alt_del(&self) -> anyhow::Result<()> {
        type SendSasFn = unsafe extern "system" fn(bool) -> i32;
        unsafe {
            let library = LoadLibraryW(PCWSTR(w!("sas.dll").as_ptr()))?;
            let proc = GetProcAddress(library, windows::core::s!("SendSAS"));
            if let Some(func) = proc {
                let send_sas: SendSasFn = std::mem::transmute(func);
                send_sas(false);
                let _ = FreeLibrary(library);
                return Ok(());
            }
            let _ = FreeLibrary(library);
        }
        Err(anyhow::anyhow!("SendSAS unavailable"))
    }
}

impl InputInjector for WindowsInjector {
    fn key_down(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()> {
        self.apply_modifiers(modifiers, true)?;
        self.key_event(code, true)
    }

    fn key_up(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()> {
        self.key_event(code, false)?;
        self.apply_modifiers(modifiers, false)
    }

    fn mouse_move_abs(&mut self, x: i32, y: i32) -> anyhow::Result<()> {
        let screen_x = (x as f64 / self.screen_width as f64 * 65535.0).round() as i32;
        let screen_y = (y as f64 / self.screen_height as f64 * 65535.0).round() as i32;
        Self::send_inputs(&[Self::mouse_input(
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
            screen_x,
            screen_y,
            0,
        )])
    }

    fn mouse_move_rel(&mut self, dx: i32, dy: i32) -> anyhow::Result<()> {
        Self::send_inputs(&[Self::mouse_input(MOUSEEVENTF_MOVE, dx, dy, 0)])
    }

    fn mouse_down(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()> {
        self.mouse_move_abs(x, y)?;
        Self::send_inputs(&[Self::mouse_input(
            Self::mouse_button_flags(button, true),
            0,
            0,
            0,
        )])
    }

    fn mouse_up(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()> {
        self.mouse_move_abs(x, y)?;
        Self::send_inputs(&[Self::mouse_input(
            Self::mouse_button_flags(button, false),
            0,
            0,
            0,
        )])
    }

    fn mouse_scroll(&mut self, delta_x: i32, delta_y: i32) -> anyhow::Result<()> {
        let mut inputs = Vec::new();
        if delta_y != 0 {
            inputs.push(Self::mouse_input(
                MOUSEEVENTF_WHEEL,
                0,
                0,
                delta_y as u32,
            ));
        }
        if delta_x != 0 {
            inputs.push(Self::mouse_input(
                MOUSEEVENTF_WHEEL,
                0,
                0,
                delta_x as u32,
            ));
        }
        if !inputs.is_empty() {
            Self::send_inputs(&inputs)?;
        }
        Ok(())
    }

    fn clipboard_paste(&mut self, text: &str) -> anyhow::Result<()> {
        Clipboard::new()?.set_text(text)?;
        self.paste_shortcut()
    }

    fn execute_command(&mut self, cmd: &AgentCommand) -> anyhow::Result<()> {
        match cmd {
            AgentCommand::CtrlAltDel => self.send_ctrl_alt_del(),
            AgentCommand::Sleep => spawn_command(
                "rundll32.exe",
                &["powrprof.dll,SetSuspendState", "0,1,0"],
            ),
            AgentCommand::Restart => {
                unsafe {
                    ExitWindowsEx(EWX_REBOOT | EWX_FORCE, SHTDN_REASON_MAJOR_OTHER)?;
                }
                Ok(())
            }
            AgentCommand::Shutdown => {
                unsafe {
                    ExitWindowsEx(EWX_SHUTDOWN | EWX_FORCE, SHTDN_REASON_MAJOR_OTHER)?;
                }
                Ok(())
            }
            AgentCommand::LockScreen => {
                unsafe {
                    LockWorkStation()?;
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
