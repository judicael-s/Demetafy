mod archive;
mod avatars;
mod db;
mod downloader;
mod downloads;
mod media;

use std::sync::Mutex;
use tauri::Manager;

/// Dev-only: the WebView forwards `console`/errors here so frontend failures
/// show up in the terminal log without opening devtools. Gated by import.meta.env.DEV
/// on the JS side; harmless in release (just never called).
#[tauri::command]
fn dev_log(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!("[ui] {message}"),
        "warn" => log::warn!("[ui] {message}"),
        _ => log::info!("[ui] {message}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("vmedia", |ctx, request| media::handle(ctx, request))
        .register_uri_scheme_protocol("dmedia", |ctx, request| downloads::handle(ctx, request))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Open the index in the per-user app data dir and apply migrations.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("index.sqlite");
            let conn = db::open(
                db_path
                    .to_str()
                    .ok_or("app data dir path is not valid UTF-8")?,
            )?;
            log::info!("demetafy index: {}", db_path.display());
            app.manage(db::Db(Mutex::new(conn)));
            app.manage(archive::Archives::default());
            app.manage(media::MediaArchive::default());
            app.manage(downloader::DownloadEngine::default());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            archive::archive_open,
            archive::archive_list_entries,
            archive::archive_read_text,
            archive::archive_has_entry,
            archive::archive_close,
            db::ingest_write,
            db::query_overview,
            db::query_profile,
            db::query_saved_items,
            db::query_collections,
            db::query_archives,
            db::delete_archive,
            db::query_threads,
            db::query_thread_detail,
            db::query_self_sender,
            db::query_profile_changes,
            db::query_stories,
            db::query_reposts,
            db::query_own_posts,
            db::query_posts,
            db::query_albums,
            db::query_connections,
            db::query_share_rows,
            db::query_saved_download_stats,
            db::query_search,
            db::query_avatars,
            avatars::fetch_ig_avatar,
            avatars::fetch_ig_avatars,
            downloads::download_dir,
            downloader::ytdlp_status,
            downloader::enqueue_downloads,
            downloader::download_queue_snapshot,
            downloader::clear_finished_downloads,
            downloader::cancel_downloads,
            downloader::retry_failed_downloads,
            dev_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
