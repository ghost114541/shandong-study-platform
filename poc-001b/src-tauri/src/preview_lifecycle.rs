use std::ffi::c_void;
use std::io;

pub const IDENTIFIER: &str = "org.shandong-study.knowpaper-preview";
const MUTEX_NAME: &str = r"Local\org.shandong-study.knowpaper-preview.lifecycle";
const ERROR_ALREADY_EXISTS: i32 = 183;

#[link(name = "kernel32")]
extern "system" {
    fn CreateMutexW(attributes: *const c_void, initial_owner: i32, name: *const u16) -> *mut c_void;
    fn CloseHandle(handle: *mut c_void) -> i32;
}

#[link(name = "user32")]
extern "system" {
    fn MessageBoxW(window: *const c_void, message: *const u16, title: *const u16, style: u32) -> i32;
}

pub struct LifecycleGuard(*mut c_void);

impl LifecycleGuard {
    pub fn acquire() -> io::Result<Self> {
        let name = wide(MUTEX_NAME);
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        let result = io::Error::last_os_error();
        if handle.is_null() {
            return Err(result);
        }

        let guard = Self(handle);
        if result.raw_os_error() == Some(ERROR_ALREADY_EXISTS) {
            return Err(result);
        }
        Ok(guard)
    }
}

impl Drop for LifecycleGuard {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

pub fn show_busy(error: &io::Error) {
    let title = wide("知卷 KnowPaper（测试版）");
    let message = wide(&format!("知卷或安装程序正在运行，或者无法取得独占访问权限。请关闭相关窗口后重试。\n{error}"));
    unsafe { MessageBoxW(std::ptr::null(), message.as_ptr(), title.as_ptr(), 0x10) };
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

