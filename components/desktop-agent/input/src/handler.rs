use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};
use tracing::warn;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;

use crate::payload::InputPayload;
use crate::{AgentCommand, InputInjector};

const KEYBOARD_QUEUE_DEPTH: usize = 16;

#[derive(Debug, Clone, Copy)]
pub struct InputPolicy {
    pub enabled: bool,
    pub allow_remote_power: bool,
}

impl Default for InputPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            allow_remote_power: false,
        }
    }
}

pub async fn run_input_handler(
    data_channel: Arc<RTCDataChannel>,
    injector: Arc<Mutex<Box<dyn InputInjector>>>,
    policy: InputPolicy,
) {
    let (keyboard_tx, mut keyboard_rx) = mpsc::channel(KEYBOARD_QUEUE_DEPTH);

    let keyboard_injector = injector.clone();
    tokio::spawn(async move {
        while let Some(payload) = keyboard_rx.recv().await {
            let mut inj = keyboard_injector.lock().await;
            if let Err(err) = dispatch_payload(inj.as_mut(), payload, policy) {
                warn!(?err, "keyboard input injection failed");
            }
        }
    });

    let keyboard_tx = Arc::new(Mutex::new(keyboard_tx));
    data_channel.on_message(Box::new(move |msg: DataChannelMessage| {
        let keyboard_tx = keyboard_tx.clone();
        let injector = injector.clone();
        Box::pin(async move {
            if !policy.enabled {
                warn!("input disabled by agent policy");
                return;
            }

            let payload: InputPayload = match serde_json::from_slice(&msg.data) {
                Ok(p) => p,
                Err(err) => {
                    warn!(?err, "invalid input payload");
                    return;
                }
            };

            match payload {
                InputPayload::KeyDown { .. } | InputPayload::KeyUp { .. } => {
                    let tx = keyboard_tx.lock().await;
                    if tx.try_send(payload).is_err() {
                        warn!("keyboard input queue full, dropping event");
                    }
                }
                other => {
                    let mut inj = injector.lock().await;
                    if let Err(err) = dispatch_payload(inj.as_mut(), other, policy) {
                        warn!(?err, "input injection failed");
                    }
                }
            }
        })
    }));
}

fn dispatch_payload(
    inj: &mut dyn InputInjector,
    payload: InputPayload,
    policy: InputPolicy,
) -> anyhow::Result<()> {
    match payload {
        InputPayload::KeyDown { code, modifiers } => inj.key_down(&code, &modifiers),
        InputPayload::KeyUp { code, modifiers } => inj.key_up(&code, &modifiers),
        InputPayload::MouseMoveAbs { x, y } => inj.mouse_move_abs(x, y),
        InputPayload::MouseMoveRel { dx, dy } => inj.mouse_move_rel(dx, dy),
        InputPayload::MouseDown { button, x, y } => inj.mouse_down(button, x, y),
        InputPayload::MouseUp { button, x, y } => inj.mouse_up(button, x, y),
        InputPayload::MouseScroll { delta_x, delta_y } => inj.mouse_scroll(delta_x, delta_y),
        InputPayload::ClipboardPaste { text } => inj.clipboard_paste(&text),
        InputPayload::Command { name } => {
            if matches!(name, AgentCommand::Shutdown | AgentCommand::Restart)
                && !policy.allow_remote_power
            {
                warn!(?name, "remote power command blocked by agent policy");
                return Ok(());
            }
            inj.execute_command(&name)
        }
    }
}
