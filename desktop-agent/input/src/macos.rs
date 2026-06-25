use std::process::Command as StdCommand;

use arboard::Clipboard;
use core_graphics::display::CGDisplay;
use core_graphics::event::{
    CGEvent, CGEventTapLocation, CGEventType, CGKeyCode, CGMouseButton, EventField,
    ScrollEventUnit,
};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::CGPoint;

use crate::keys::code_to_cg_keycode;
use crate::{AgentCommand, InputInjector, ModifierState, MouseButton};

const KCG_EVENT_FLAG_MASK_CONTROL: u64 = 1 << 18;
const KCG_EVENT_FLAG_MASK_SHIFT: u64 = 1 << 17;
const KCG_EVENT_FLAG_MASK_ALTERNATE: u64 = 1 << 19;
const KCG_EVENT_FLAG_MASK_COMMAND: u64 = 1 << 20;

pub struct MacOsInjector {
    screen_width: i32,
    screen_height: i32,
}

impl MacOsInjector {
    pub fn new() -> anyhow::Result<Self> {
        let bounds = CGDisplay::main().bounds();
        Ok(Self {
            screen_width: bounds.size.width as i32,
            screen_height: bounds.size.height as i32,
        })
    }

    fn event_source() -> anyhow::Result<CGEventSource> {
        CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| anyhow::anyhow!("failed to create event source"))
    }

    fn modifier_flags(modifiers: &ModifierState) -> u64 {
        let mut flags = 0u64;
        if modifiers.ctrl {
            flags |= KCG_EVENT_FLAG_MASK_CONTROL;
        }
        if modifiers.alt {
            flags |= KCG_EVENT_FLAG_MASK_ALTERNATE;
        }
        if modifiers.shift {
            flags |= KCG_EVENT_FLAG_MASK_SHIFT;
        }
        if modifiers.meta {
            flags |= KCG_EVENT_FLAG_MASK_COMMAND;
        }
        flags
    }

    fn cg_mouse_button(button: MouseButton) -> CGMouseButton {
        match button {
            MouseButton::Left => CGMouseButton::Left,
            MouseButton::Middle => CGMouseButton::Center,
            MouseButton::Right => CGMouseButton::Right,
        }
    }

    fn mouse_event_type(button: MouseButton, down: bool) -> CGEventType {
        match (button, down) {
            (MouseButton::Left, true) => CGEventType::LeftMouseDown,
            (MouseButton::Left, false) => CGEventType::LeftMouseUp,
            (MouseButton::Middle, true) => CGEventType::OtherMouseDown,
            (MouseButton::Middle, false) => CGEventType::OtherMouseUp,
            (MouseButton::Right, true) => CGEventType::RightMouseDown,
            (MouseButton::Right, false) => CGEventType::RightMouseUp,
        }
    }

    fn post_key(
        &self,
        code: CGKeyCode,
        down: bool,
        modifiers: &ModifierState,
    ) -> anyhow::Result<()> {
        let source = Self::event_source()?;
        let event_type = if down {
            CGEventType::KeyDown
        } else {
            CGEventType::KeyUp
        };
        let event = CGEvent::new_keyboard_event(source, code, down)
            .map_err(|_| anyhow::anyhow!("failed to create key event"))?;
        event.set_flags(Self::modifier_flags(modifiers));
        event.post(CGEventTapLocation::HID);
        let _ = event_type;
        Ok(())
    }

    fn paste_shortcut(&self) -> anyhow::Result<()> {
        let source = Self::event_source()?;
        let v_code = code_to_cg_keycode("KeyV").unwrap_or(0x09);
        let down = CGEvent::new_keyboard_event(source.clone(), v_code, true)
            .map_err(|_| anyhow::anyhow!("failed to create paste key down"))?;
        down.set_flags(KCG_EVENT_FLAG_MASK_COMMAND);
        down.post(CGEventTapLocation::HID);
        let up = CGEvent::new_keyboard_event(source, v_code, false)
            .map_err(|_| anyhow::anyhow!("failed to create paste key up"))?;
        up.set_flags(KCG_EVENT_FLAG_MASK_COMMAND);
        up.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn lock_screen(&self) -> anyhow::Result<()> {
        if spawn_command("pmset", &["displaysleepnow"]).is_ok() {
            return Ok(());
        }
        spawn_command(
            "osascript",
            &[
                "-e",
                "tell application \"System Events\" to keystroke \"q\" using {command down, control down}",
            ],
        )
    }
}

impl InputInjector for MacOsInjector {
    fn key_down(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()> {
        let Some(keycode) = code_to_cg_keycode(code) else {
            return Ok(());
        };
        self.post_key(keycode, true, modifiers)
    }

    fn key_up(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()> {
        let Some(keycode) = code_to_cg_keycode(code) else {
            return Ok(());
        };
        self.post_key(keycode, false, modifiers)
    }

    fn mouse_move_abs(&mut self, x: i32, y: i32) -> anyhow::Result<()> {
        let source = Self::event_source()?;
        let y = self.screen_height - y;
        let point = CGPoint::new(x as f64, y as f64);
        let event = CGEvent::new_mouse_event(
            source,
            CGEventType::MouseMoved,
            point,
            CGMouseButton::Left,
        )
        .map_err(|_| anyhow::anyhow!("failed to create mouse move event"))?;
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn mouse_move_rel(&mut self, dx: i32, dy: i32) -> anyhow::Result<()> {
        let source = Self::event_source()?;
        let event = CGEvent::new(source)
            .map_err(|_| anyhow::anyhow!("failed to create relative mouse event"))?;
        event.set_integer_value_field(EventField::MOUSE_EVENT_DELTA_X, dx as i64);
        event.set_integer_value_field(EventField::MOUSE_EVENT_DELTA_Y, dy as i64);
        event.set_type(CGEventType::MouseMoved);
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn mouse_down(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()> {
        self.mouse_move_abs(x, y)?;
        let source = Self::event_source()?;
        let y = self.screen_height - y;
        let point = CGPoint::new(x as f64, y as f64);
        let event = CGEvent::new_mouse_event(
            source,
            Self::mouse_event_type(button, true),
            point,
            Self::cg_mouse_button(button),
        )
        .map_err(|_| anyhow::anyhow!("failed to create mouse down event"))?;
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn mouse_up(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()> {
        self.mouse_move_abs(x, y)?;
        let source = Self::event_source()?;
        let y = self.screen_height - y;
        let point = CGPoint::new(x as f64, y as f64);
        let event = CGEvent::new_mouse_event(
            source,
            Self::mouse_event_type(button, false),
            point,
            Self::cg_mouse_button(button),
        )
        .map_err(|_| anyhow::anyhow!("failed to create mouse up event"))?;
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn mouse_scroll(&mut self, delta_x: i32, delta_y: i32) -> anyhow::Result<()> {
        let source = Self::event_source()?;
        let event = CGEvent::new_scroll_event(
            source,
            ScrollEventUnit::PIXEL,
            2,
            delta_y,
            delta_x,
            0,
        )
        .map_err(|_| anyhow::anyhow!("failed to create scroll event"))?;
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn clipboard_paste(&mut self, text: &str) -> anyhow::Result<()> {
        Clipboard::new()?.set_text(text)?;
        self.paste_shortcut()
    }

    fn execute_command(&mut self, cmd: &AgentCommand) -> anyhow::Result<()> {
        match cmd {
            AgentCommand::CtrlAltDel => {
                let source = Self::event_source()?;
                let q_code = code_to_cg_keycode("KeyQ").unwrap_or(0x0C);
                for down in [true, false] {
                    let event = CGEvent::new_keyboard_event(source.clone(), q_code, down)
                        .map_err(|_| anyhow::anyhow!("failed to create lock shortcut"))?;
                    event.set_flags(KCG_EVENT_FLAG_MASK_CONTROL | KCG_EVENT_FLAG_MASK_COMMAND);
                    event.post(CGEventTapLocation::HID);
                }
                Ok(())
            }
            AgentCommand::Sleep => spawn_command("pmset", &["sleepnow"]),
            AgentCommand::Restart => spawn_command("osascript", &["-e", "tell app \"System Events\" to restart"]),
            AgentCommand::Shutdown => {
                spawn_command("osascript", &["-e", "tell app \"System Events\" to shut down"])
            }
            AgentCommand::LockScreen => self.lock_screen(),
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
