#[cfg(target_os = "windows")]
pub fn code_to_vk(code: &str) -> Option<u16> {
    code_to_vk_windows(code)
}

#[cfg(target_os = "linux")]
pub fn code_to_vk(code: &str) -> Option<u16> {
    code_to_evdev(code)
}

#[cfg(target_os = "macos")]
pub fn code_to_vk(code: &str) -> Option<u16> {
    code_to_cg_keycode(code)
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
pub fn code_to_vk(_code: &str) -> Option<u16> {
    None
}

#[cfg_attr(
    not(target_os = "windows"),
    allow(dead_code)
)]
pub fn code_to_vk_windows(code: &str) -> Option<u16> {
    match code {
        "KeyA" => Some(0x41),
        "KeyB" => Some(0x42),
        "KeyC" => Some(0x43),
        "KeyD" => Some(0x44),
        "KeyE" => Some(0x45),
        "KeyF" => Some(0x46),
        "KeyG" => Some(0x47),
        "KeyH" => Some(0x48),
        "KeyI" => Some(0x49),
        "KeyJ" => Some(0x4A),
        "KeyK" => Some(0x4B),
        "KeyL" => Some(0x4C),
        "KeyM" => Some(0x4D),
        "KeyN" => Some(0x4E),
        "KeyO" => Some(0x4F),
        "KeyP" => Some(0x50),
        "KeyQ" => Some(0x51),
        "KeyR" => Some(0x52),
        "KeyS" => Some(0x53),
        "KeyT" => Some(0x54),
        "KeyU" => Some(0x55),
        "KeyV" => Some(0x56),
        "KeyW" => Some(0x57),
        "KeyX" => Some(0x58),
        "KeyY" => Some(0x59),
        "KeyZ" => Some(0x5A),
        "Digit0" => Some(0x30),
        "Digit1" => Some(0x31),
        "Digit2" => Some(0x32),
        "Digit3" => Some(0x33),
        "Digit4" => Some(0x34),
        "Digit5" => Some(0x35),
        "Digit6" => Some(0x36),
        "Digit7" => Some(0x37),
        "Digit8" => Some(0x38),
        "Digit9" => Some(0x39),
        "Enter" => Some(0x0D),
        "Escape" => Some(0x1B),
        "Backspace" => Some(0x08),
        "Tab" => Some(0x09),
        "Space" => Some(0x20),
        "ArrowLeft" => Some(0x25),
        "ArrowRight" => Some(0x27),
        "ArrowUp" => Some(0x26),
        "ArrowDown" => Some(0x28),
        "Home" => Some(0x24),
        "End" => Some(0x23),
        "PageUp" => Some(0x21),
        "PageDown" => Some(0x22),
        "Insert" => Some(0x2D),
        "Delete" => Some(0x2E),
        "F1" => Some(0x70),
        "F2" => Some(0x71),
        "F3" => Some(0x72),
        "F4" => Some(0x73),
        "F5" => Some(0x74),
        "F6" => Some(0x75),
        "F7" => Some(0x76),
        "F8" => Some(0x77),
        "F9" => Some(0x78),
        "F10" => Some(0x79),
        "F11" => Some(0x7A),
        "F12" => Some(0x7B),
        "ControlLeft" | "ControlRight" => Some(0x11),
        "AltLeft" | "AltRight" => Some(0x12),
        "ShiftLeft" | "ShiftRight" => Some(0x10),
        "MetaLeft" | "MetaRight" => Some(0x5B),
        "CapsLock" => Some(0x14),
        "Minus" => Some(0xBD),
        "Equal" => Some(0xBB),
        "BracketLeft" => Some(0xDB),
        "BracketRight" => Some(0xDD),
        "Backslash" => Some(0xDC),
        "Semicolon" => Some(0xBA),
        "Quote" => Some(0xDE),
        "Backquote" => Some(0xC0),
        "Comma" => Some(0xBC),
        "Period" => Some(0xBE),
        "Slash" => Some(0xBF),
        _ => None,
    }
}

pub fn code_to_evdev(code: &str) -> Option<u16> {
    match code {
        "KeyA" => Some(30),
        "KeyB" => Some(48),
        "KeyC" => Some(46),
        "KeyD" => Some(32),
        "KeyE" => Some(18),
        "KeyF" => Some(33),
        "KeyG" => Some(34),
        "KeyH" => Some(35),
        "KeyI" => Some(23),
        "KeyJ" => Some(36),
        "KeyK" => Some(37),
        "KeyL" => Some(38),
        "KeyM" => Some(50),
        "KeyN" => Some(49),
        "KeyO" => Some(24),
        "KeyP" => Some(25),
        "KeyQ" => Some(16),
        "KeyR" => Some(19),
        "KeyS" => Some(31),
        "KeyT" => Some(20),
        "KeyU" => Some(22),
        "KeyV" => Some(47),
        "KeyW" => Some(17),
        "KeyX" => Some(45),
        "KeyY" => Some(21),
        "KeyZ" => Some(44),
        "Digit0" => Some(11),
        "Digit1" => Some(2),
        "Digit2" => Some(3),
        "Digit3" => Some(4),
        "Digit4" => Some(5),
        "Digit5" => Some(6),
        "Digit6" => Some(7),
        "Digit7" => Some(8),
        "Digit8" => Some(9),
        "Digit9" => Some(10),
        "Enter" => Some(28),
        "Escape" => Some(1),
        "Backspace" => Some(14),
        "Tab" => Some(15),
        "Space" => Some(57),
        "ArrowLeft" => Some(105),
        "ArrowRight" => Some(106),
        "ArrowUp" => Some(103),
        "ArrowDown" => Some(108),
        "Home" => Some(102),
        "End" => Some(107),
        "PageUp" => Some(104),
        "PageDown" => Some(109),
        "Insert" => Some(110),
        "Delete" => Some(111),
        "F1" => Some(59),
        "F2" => Some(60),
        "F3" => Some(61),
        "F4" => Some(62),
        "F5" => Some(63),
        "F6" => Some(64),
        "F7" => Some(65),
        "F8" => Some(66),
        "F9" => Some(67),
        "F10" => Some(68),
        "F11" => Some(87),
        "F12" => Some(88),
        "ControlLeft" => Some(29),
        "ControlRight" => Some(97),
        "AltLeft" => Some(56),
        "AltRight" => Some(100),
        "ShiftLeft" => Some(42),
        "ShiftRight" => Some(54),
        "MetaLeft" => Some(125),
        "MetaRight" => Some(126),
        "CapsLock" => Some(58),
        "Minus" => Some(12),
        "Equal" => Some(13),
        "BracketLeft" => Some(26),
        "BracketRight" => Some(27),
        "Backslash" => Some(43),
        "Semicolon" => Some(39),
        "Quote" => Some(40),
        "Backquote" => Some(41),
        "Comma" => Some(51),
        "Period" => Some(52),
        "Slash" => Some(53),
        _ => None,
    }
}

#[cfg_attr(
    not(target_os = "macos"),
    allow(dead_code)
)]
pub fn code_to_cg_keycode(code: &str) -> Option<u16> {
    match code {
        "KeyA" => Some(0x00),
        "KeyB" => Some(0x0B),
        "KeyC" => Some(0x08),
        "KeyD" => Some(0x02),
        "KeyE" => Some(0x0E),
        "KeyF" => Some(0x03),
        "KeyG" => Some(0x05),
        "KeyH" => Some(0x04),
        "KeyI" => Some(0x22),
        "KeyJ" => Some(0x26),
        "KeyK" => Some(0x28),
        "KeyL" => Some(0x25),
        "KeyM" => Some(0x2E),
        "KeyN" => Some(0x2D),
        "KeyO" => Some(0x1F),
        "KeyP" => Some(0x23),
        "KeyQ" => Some(0x0C),
        "KeyR" => Some(0x0F),
        "KeyS" => Some(0x01),
        "KeyT" => Some(0x11),
        "KeyU" => Some(0x20),
        "KeyV" => Some(0x09),
        "KeyW" => Some(0x0D),
        "KeyX" => Some(0x07),
        "KeyY" => Some(0x10),
        "KeyZ" => Some(0x06),
        "Digit0" => Some(0x1D),
        "Digit1" => Some(0x12),
        "Digit2" => Some(0x13),
        "Digit3" => Some(0x14),
        "Digit4" => Some(0x15),
        "Digit5" => Some(0x17),
        "Digit6" => Some(0x16),
        "Digit7" => Some(0x1A),
        "Digit8" => Some(0x1C),
        "Digit9" => Some(0x19),
        "Enter" => Some(0x24),
        "Escape" => Some(0x35),
        "Backspace" => Some(0x33),
        "Tab" => Some(0x30),
        "Space" => Some(0x31),
        "ArrowLeft" => Some(0x7B),
        "ArrowRight" => Some(0x7C),
        "ArrowUp" => Some(0x7E),
        "ArrowDown" => Some(0x7D),
        "Home" => Some(0x73),
        "End" => Some(0x77),
        "PageUp" => Some(0x74),
        "PageDown" => Some(0x79),
        "F1" => Some(0x7A),
        "F2" => Some(0x78),
        "F3" => Some(0x63),
        "F4" => Some(0x76),
        "F5" => Some(0x60),
        "F6" => Some(0x61),
        "F7" => Some(0x62),
        "F8" => Some(0x64),
        "F9" => Some(0x65),
        "F10" => Some(0x6D),
        "F11" => Some(0x67),
        "F12" => Some(0x6F),
        "ControlLeft" | "ControlRight" => Some(0x3B),
        "AltLeft" | "AltRight" => Some(0x3A),
        "ShiftLeft" | "ShiftRight" => Some(0x38),
        "MetaLeft" | "MetaRight" => Some(0x37),
        "Delete" => Some(0x75),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_maps_common_keys() {
        assert_eq!(code_to_vk_windows("KeyA"), Some(0x41));
        assert_eq!(code_to_vk_windows("Enter"), Some(0x0D));
        assert_eq!(code_to_vk_windows("ControlLeft"), Some(0x11));
    }

    #[test]
    fn linux_maps_common_keys() {
        assert_eq!(code_to_evdev("KeyA"), Some(30));
        assert_eq!(code_to_evdev("Enter"), Some(28));
        assert_eq!(code_to_evdev("Delete"), Some(111));
    }

    #[test]
    fn macos_maps_common_keys() {
        assert_eq!(code_to_cg_keycode("KeyA"), Some(0x00));
        assert_eq!(code_to_cg_keycode("Space"), Some(0x31));
    }
}
