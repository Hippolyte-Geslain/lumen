//! Thin shell: starts the lumen-core sidecar, waits for its handshake line, then opens the window with the
//! port and one-time token injected as `window.__LUMEN_CORE__` (read by src/live/local.js).
//! The page never spawns processes; the sidecar is killed when the app exits.
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

#[derive(Deserialize)]
struct Ready {
    port: u16,
    token: String,
}

struct Core(Mutex<Option<CommandChild>>);

const READY: &str = "LUMEN_CORE_READY ";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Core(Mutex::new(None)))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let (mut rx, child) = app
                .shell()
                .sidecar("lumen-core")?
                .env("LUMEN_DATA_DIR", dir.to_string_lossy().to_string())
                .spawn()?;
            *app.state::<Core>().0.lock().unwrap() = Some(child);

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(ev) = rx.recv().await {
                    if let CommandEvent::Stdout(line) = ev {
                        let text = String::from_utf8_lossy(&line);
                        if let Some(json) = text.trim().strip_prefix(READY) {
                            if let Ok(r) = serde_json::from_str::<Ready>(json) {
                                let script = format!(
                                    "window.__LUMEN_CORE__ = {{ port: {}, token: {} }};",
                                    r.port,
                                    serde_json::to_string(&r.token).unwrap()
                                );
                                let _ = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::default())
                                    .title("Lumen")
                                    .inner_size(1280.0, 860.0)
                                    .initialization_script(&script)
                                    .build();
                            }
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Lumen")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(child) = app.state::<Core>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
