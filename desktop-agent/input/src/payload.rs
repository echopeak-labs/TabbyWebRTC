use serde::Deserialize;

use crate::{AgentCommand, ModifierState, MouseButton};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InputPayload {
    KeyDown {
        code: String,
        modifiers: ModifierState,
    },
    KeyUp {
        code: String,
        modifiers: ModifierState,
    },
    MouseMoveAbs {
        x: i32,
        y: i32,
    },
    MouseMoveRel {
        dx: i32,
        dy: i32,
    },
    MouseDown {
        button: MouseButton,
        x: i32,
        y: i32,
    },
    MouseUp {
        button: MouseButton,
        x: i32,
        y: i32,
    },
    MouseScroll {
        delta_x: i32,
        delta_y: i32,
    },
    ClipboardPaste {
        text: String,
    },
    Command {
        name: AgentCommand,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_key_down() {
        let payload: InputPayload = serde_json::from_str(
            r#"{"type":"KEY_DOWN","code":"KeyA","modifiers":{"ctrl":false,"alt":false,"shift":false,"meta":false}}"#,
        )
        .unwrap();
        match payload {
            InputPayload::KeyDown { code, .. } => assert_eq!(code, "KeyA"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn deserializes_mouse_button() {
        let payload: InputPayload = serde_json::from_str(
            r#"{"type":"MOUSE_DOWN","button":2,"x":100,"y":200}"#,
        )
        .unwrap();
        match payload {
            InputPayload::MouseDown { button, x, y } => {
                assert_eq!(button, MouseButton::Right);
                assert_eq!(x, 100);
                assert_eq!(y, 200);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn deserializes_command() {
        let payload: InputPayload =
            serde_json::from_str(r#"{"type":"COMMAND","name":"LOCK"}"#).unwrap();
        match payload {
            InputPayload::Command { name } => assert_eq!(name, AgentCommand::LockScreen),
            _ => panic!("wrong variant"),
        }
    }
}
