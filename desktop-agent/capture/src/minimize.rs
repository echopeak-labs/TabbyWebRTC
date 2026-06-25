#[cfg(feature = "scap-capture")]
use scap::targets::Target;

pub struct MinimizeGuard {
    #[cfg(all(target_os = "windows", feature = "scap-capture"))]
    hwnd: windows::Win32::Foundation::HWND,
    #[cfg(all(target_os = "windows", feature = "scap-capture"))]
    saved: WindowRect,
    #[cfg(not(all(target_os = "windows", feature = "scap-capture")))]
    _marker: (),
}

#[derive(Debug, Clone, Copy)]
struct WindowRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

impl MinimizeGuard {
    #[cfg(feature = "scap-capture")]
    pub fn install(target: &Target) -> Option<Self> {
        match target {
            Target::Window(window) => install_for_window(window),
            Target::Display(_) => None,
        }
    }

    #[cfg(not(feature = "scap-capture"))]
    pub fn install(_target: &()) -> Option<Self> {
        None
    }

    pub fn restore(self) {
        restore_window(self);
    }
}

#[cfg(all(target_os = "windows", feature = "scap-capture"))]
fn install_for_window(window: &scap::targets::Window) -> Option<MinimizeGuard> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let hwnd = window.raw_handle;
    if hwnd == HWND::default() {
        return None;
    }
    let mut rect = windows::Win32::Foundation::RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut rect).ok()?;
    }
    let saved = WindowRect {
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
    };
    Some(MinimizeGuard { hwnd, saved })
}

#[cfg(all(feature = "scap-capture", not(target_os = "windows")))]
fn install_for_window(_window: &scap::targets::Window) -> Option<MinimizeGuard> {
    None
}

#[cfg(all(target_os = "windows", feature = "scap-capture"))]
fn restore_window(guard: MinimizeGuard) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER, HWND_TOP,
    };
    unsafe {
        let _ = SetWindowPos(
            guard.hwnd,
            HWND_TOP,
            guard.saved.x,
            guard.saved.y,
            guard.saved.width,
            guard.saved.height,
            SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

#[cfg(all(target_os = "windows", feature = "scap-capture"))]
pub fn move_window_offscreen(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SWP_NOZORDER, HWND_TOP,
    };
    const OFF_SCREEN: i32 = -32_000;
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(
            hwnd,
            HWND_TOP,
            OFF_SCREEN,
            OFF_SCREEN,
            0,
            0,
            SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

#[cfg(not(all(target_os = "windows", feature = "scap-capture")))]
fn restore_window(_guard: MinimizeGuard) {}
