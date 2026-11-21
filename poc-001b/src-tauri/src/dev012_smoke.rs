use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    time::Duration,
};
use tauri::{webview::PageLoadEvent, Manager, WebviewWindow, Wry};
use tokio::sync::oneshot;

const IDENTIFIER: &str = "org.shandong-study.dev012-74d09001";

pub fn print_fault(window: &WebviewWindow) -> i32 {
    if window.app_handle().config().identifier != IDENTIFIER
        || std::env::var_os("KNOWPAPER_DEV012_SMOKE_REPORT").is_none()
    {
        return 0;
    }
    static SINGLE: AtomicUsize = AtomicUsize::new(0);
    static CLOSE_ANSWERS: AtomicBool = AtomicBool::new(true);
    let label = window.label();
    if label == "main" {
        return match SINGLE.fetch_add(1, Ordering::Relaxed) {
            1 => 1, // Reject before handing the operation to AppKit.
            2 => 2, // Delay completion past the Rust deadline.
            _ => 0,
        };
    }
    if label.starts_with("composition-print-")
        && label.ends_with("-answers")
        && CLOSE_ANSWERS.swap(false, Ordering::Relaxed)
    {
        return 3; // Close the first answer window before delivering completion.
    }
    0
}

pub fn attach(builder: tauri::Builder<Wry>, identifier: &str) -> tauri::Builder<Wry> {
    if identifier != IDENTIFIER {
        return builder;
    }
    let Some(output) = std::env::var_os("KNOWPAPER_DEV012_SMOKE_REPORT").map(PathBuf::from) else {
        return builder;
    };
    builder.on_page_load(move |view, event| {
        if view.label() != "main" || event.event() != PageLoadEvent::Finished {
            return;
        }
        let app = view.app_handle().clone();
        let Some(window) = app.get_webview_window("main") else {
            app.exit(2);
            return;
        };
        if let Err(error) = window.eval(concat!(
            "window.__knowpaperPrintFaults = true;\n",
            include_str!("../../tests/macos-app-smoke.js")
        )) {
            eprintln!("Cannot start application smoke test: {error}");
            app.exit(2);
            return;
        }
        let output = output.clone();
        tauri::async_runtime::spawn(async move {
            let result = tokio::time::timeout(Duration::from_secs(240), async {
                loop {
                    let (sender, receiver) = oneshot::channel();
                    let sender = std::sync::Mutex::new(Some(sender));
                    window
                        .eval_with_callback("window.__knowpaperSmokeResult ?? null", move |value| {
                            if let Some(sender) = sender.lock().unwrap().take() {
                                let _ = sender.send(value);
                            }
                        })
                        .ok()?;
                    let value = serde_json::from_str::<Value>(&receiver.await.ok()?).ok()?;
                    if !value.is_null() {
                        return Some(value);
                    }
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            })
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| {
                serde_json::json!({
                    "ok": false, "error": "Application smoke test aborted or timed out"
                })
            });
            let saved = fs::write(output, serde_json::to_vec_pretty(&result).unwrap());
            app.exit(if saved.is_ok() && result["ok"] == true {
                0
            } else {
                1
            });
        });
    })
}
