#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = update(app_handle).await {
                    eprintln!("update check failed: {error}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

async fn update(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    use tauri_plugin_updater::UpdaterExt;

    if let Some(update) = app.updater()?.check().await? {
        update
            .download_and_install(
                |_chunk_length, _content_length| {},
                || {
                    println!("update downloaded");
                },
            )
            .await?;
        app.restart();
    }

    Ok(())
}
