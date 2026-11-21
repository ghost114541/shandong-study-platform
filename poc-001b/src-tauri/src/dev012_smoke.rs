use serde_json::Value;
use std::{fs, path::PathBuf, time::Duration};
use tauri::{webview::PageLoadEvent, Manager, Wry};
use tokio::sync::oneshot;

pub fn attach(builder: tauri::Builder<Wry>, identifier: &str) -> tauri::Builder<Wry> {
    if identifier != "org.shandong-study.dev012-74d09001" {
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
        if let Err(error) = view.eval(include_str!("../../tests/macos-app-smoke.js")) {
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
                    view.eval_with_callback(
                        "window.__knowpaperSmokeResult ?? null",
                        move |value| {
                            if let Some(sender) = sender.lock().unwrap().take() {
                                let _ = sender.send(value);
                            }
                        },
                    )
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
