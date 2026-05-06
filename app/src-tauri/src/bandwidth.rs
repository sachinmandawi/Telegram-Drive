use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BandwidthStats {
    pub date: String,
    pub up_bytes: u64,
    pub down_bytes: u64,
}

impl Default for BandwidthStats {
    fn default() -> Self {
        Self {
            date: Local::now().format("%Y-%m-%d").to_string(),
            up_bytes: 0,
            down_bytes: 0,
        }
    }
}

pub struct BandwidthManager {
    pub file_path: PathBuf,
    pub stats: Mutex<BandwidthStats>,
}

impl BandwidthManager {
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        // Resolve app data directory
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("data"));

        if !app_data_dir.exists() {
            let _ = std::fs::create_dir_all(&app_data_dir);
        }
        let file_path = app_data_dir.join("bandwidth.json");

        let stats = if file_path.exists() {
            let content = fs::read_to_string(&file_path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            BandwidthStats::default()
        };

        Self {
            file_path,
            stats: Mutex::new(stats),
        }
    }

    pub fn check_and_reset(&self) {
        let today = Local::now().format("%Y-%m-%d").to_string();
        let Ok(mut stats) = self.stats.lock() else {
            log::warn!("Bandwidth stats lock is poisoned; skipping daily reset");
            return;
        };

        if stats.date != today {
            log::info!(
                "New bandwidth day detected. Resetting stats. Old date: {}, New date: {}",
                stats.date,
                today
            );
            stats.date = today;
            stats.up_bytes = 0;
            stats.down_bytes = 0;
            self.save_locked(&stats);
        }
    }

    pub fn can_transfer(&self, _bytes: u64) -> Result<(), String> {
        self.check_and_reset();
        Ok(())
    }

    pub fn add_up(&self, bytes: u64) {
        self.check_and_reset();
        if let Ok(mut stats) = self.stats.lock() {
            stats.up_bytes = stats.up_bytes.saturating_add(bytes);
            self.save_locked(&stats);
        } else {
            log::warn!("Bandwidth stats lock is poisoned; upload bytes not recorded");
        }
    }

    pub fn add_down(&self, bytes: u64) {
        self.check_and_reset();
        if let Ok(mut stats) = self.stats.lock() {
            stats.down_bytes = stats.down_bytes.saturating_add(bytes);
            self.save_locked(&stats);
        } else {
            log::warn!("Bandwidth stats lock is poisoned; download bytes not recorded");
        }
    }

    fn save_locked(&self, stats: &BandwidthStats) {
        if let Ok(json) = serde_json::to_string(stats) {
            let _ = fs::write(&self.file_path, json);
        }
    }

    pub fn get_stats(&self) -> BandwidthStats {
        self.check_and_reset();
        self.stats
            .lock()
            .map(|stats| stats.clone())
            .unwrap_or_default()
    }
}
