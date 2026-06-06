#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![device_fingerprint, device_name])
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = update(app_handle).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

async fn update(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    use tauri_plugin_updater::UpdaterExt;

    if let Some(update) = app.updater()?.check().await? {
        let should_update = app
            .dialog()
            .message(format!(
                "يوجد تحديث جديد للإصدار {}. هل تريد التحديث الآن؟",
                update.version
            ))
            .title("تحديث متاح")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "تحديث الآن".into(),
                "لاحقا".into(),
            ))
            .blocking_show();

        if !should_update {
            return Ok(());
        }

        update
            .download_and_install(
                |_chunk_length, _content_length| {},
                || {},
            )
            .await?;
        app.restart();
    }

    Ok(())
}

#[tauri::command]
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Unknown device".to_string())
}

#[tauri::command]
fn device_fingerprint() -> String {
    use sha2::{Digest, Sha256};

    let mut parts = Vec::new();
    parts.push(run_command("wmic", &["csproduct", "get", "uuid"]));
    parts.push(run_command("wmic", &["baseboard", "get", "serialnumber"]));
    parts.push(run_command("wmic", &["cpu", "get", "processorid"]));
    parts.push(device_name());

    let raw = parts
        .into_iter()
        .map(|part| {
            part.lines()
                .map(str::trim)
                .filter(|line| {
                    !line.is_empty()
                        && !line.eq_ignore_ascii_case("uuid")
                        && !line.eq_ignore_ascii_case("serialnumber")
                        && !line.eq_ignore_ascii_case("processorid")
                })
                .collect::<Vec<_>>()
                .join("|")
        })
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("|");

    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

fn run_command(program: &str, args: &[&str]) -> String {
    std::process::Command::new(program)
        .args(args)
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .unwrap_or_default()
}
