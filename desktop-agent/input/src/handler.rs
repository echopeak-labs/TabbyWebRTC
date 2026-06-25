use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};
use tracing::warn;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;

use crate::payload::InputPayload;
use crate::InputInjector;

const KEYBOARD_QUEUE_DEPTH: usize = 16;

enum MouseMovePayload {
    Abs { x: i32, y: i32 },
    Rel { dx: i32, dy: i32 },
}

pub async fn run_input_handler(
    data_channel: Arc<RTCDataChannel>,
    injector: Arc<Mutex<Box<dyn InputInjector>>>,
) {
    let (keyboard_tx, mut keyboard_rx) = mpsc::channel(KEYBOARD_QUEUE_DEPTH);
    let mouse_slot = Arc::new(Mutex::new(None::<MouseMovePayload>));
    let mouse_notify = Arc::new(tokio::sync::Notify::new());

    let mouse_injector = injector.clone();
    let mouse_slot_worker = mouse_slot.clone();
    let mouse_notify_worker = mouse_notify.clone();
    tokio::spawn(async move {
        loop {
            mouse_notify_worker.notified().await;
            let payload = {
                let mut slot = mouse_slot_worker.lock().await;
                slot.take()
            };
            let Some(payload) = payload else {
                continue;
            };
            let mut inj = mouse_injector.lock().await;
            let result = match payload {
                MouseMovePayload::Abs { x, y } => inj.mouse_move_abs(x, y),
                MouseMovePayload::Rel { dx, dy } => inj.mouse_move_rel(dx, dy),
            };
            if let Err(err) = result {
                warn!(?err, "mouse injection failed");
            }
        }
    });

    let keyboard_injector = injector.clone();
    tokio::spawn(async move {
        while let Some(payload) = keyboard_rx.recv().await {
            let mut inj = keyboard_injector.lock().await;
            if let Err(err) = dispatch_payload(inj.as_mut(), payload) {
                warn!(?err, "keyboard input injection failed");
            }
        }
    });

    let keyboard_tx = Arc::new(Mutex::new(keyboard_tx));
    data_channel.on_message(Box::new(move |msg: DataChannelMessage| {
        let keyboard_tx = keyboard_tx.clone();
        let mouse_slot = mouse_slot.clone();
        let mouse_notify = mouse_notify.clone();
        let injector = injector.clone();
        Box::pin(async move {
            let payload: InputPayload = match serde_json::from_slice(&msg.data) {
                Ok(p) => p,
                Err(err) => {
                    warn!(?err, "invalid input payload");
                    return;
                }
            };

            match payload {
                InputPayload::MouseMoveAbs { x, y } => {
                    let mut slot = mouse_slot.lock().await;
                    *slot = Some(MouseMovePayload::Abs { x, y });
                    mouse_notify.notify_one();
                }
                InputPayload::MouseMoveRel { dx, dy } => {
                    let mut slot = mouse_slot.lock().await;
                    *slot = Some(MouseMovePayload::Rel { dx, dy });
                    mouse_notify.notify_one();
                }
                InputPayload::KeyDown { .. } | InputPayload::KeyUp { .. } => {
                    let tx = keyboard_tx.lock().await;
                    if tx.try_send(payload).is_err() {
                        warn!("keyboard input queue full, dropping event");
                    }
                }
                other => {
                    let mut inj = injector.lock().await;
                    if let Err(err) = dispatch_payload(inj.as_mut(), other) {
                        warn!(?err, "input injection failed");
                    }
                }
            }
        })
    }));
}

fn dispatch_payload(inj: &mut dyn InputInjector, payload: InputPayload) -> anyhow::Result<()> {
    match payload {
        InputPayload::KeyDown { code, modifiers } => inj.key_down(&code, &modifiers),
        InputPayload::KeyUp { code, modifiers } => inj.key_up(&code, &modifiers),
        InputPayload::MouseMoveAbs { x, y } => inj.mouse_move_abs(x, y),
        InputPayload::MouseMoveRel { dx, dy } => inj.mouse_move_rel(dx, dy),
        InputPayload::MouseDown { button, x, y } => inj.mouse_down(button, x, y),
        InputPayload::MouseUp { button, x, y } => inj.mouse_up(button, x, y),
        InputPayload::MouseScroll { delta_x, delta_y } => inj.mouse_scroll(delta_x, delta_y),
        InputPayload::ClipboardPaste { text } => inj.clipboard_paste(&text),
        InputPayload::Command { name } => inj.execute_command(&name),
    }
}
