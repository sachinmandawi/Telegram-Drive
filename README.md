# Telegram Drive 

**Telegram Drive** is an open-source, cross-platform desktop application that turns your Telegram account into an unlimited, secure cloud storage drive. Built with **Tauri**, **Rust**, and **React**.

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20MacOS%20%7C%20Linux-blue)


![Auth Screen](screenshots/AuthScreen.png)

##  What is Telegram Drive?

Telegram Drive leverages the Telegram API to allow you to upload, organize, and manage files directly on Telegram's servers. It treats your "Saved Messages" and created Channels as folders, giving you a familiar file explorer interface for your Telegram cloud.

###  Key Features

*   **Unlimited Cloud Storage**: Utilizing Telegram's generous cloud infrastructure.
*   **Browser-Only Saved Messages Mode**: Run the drive from the local website or desktop app while storing files in Telegram Saved Messages.
*   **Persistent Cloud Manifest**: Folder structure, starred files, trash state, and metadata are saved back to Telegram so reinstalling the exe does not erase your drive index.
*   **Repair & Recovery**: Rebuild the local index from Telegram Saved Messages and keep recent manifest snapshots for recovery.
*   **Drive Tools Dashboard**: View storage analytics, type breakdowns, cache status, backup controls, trash cleanup, account switching, and update checks in one place.
*   **Smart Search & Tags**: Search names, extensions, MIME types, tags, checksums, and indexed text with richer filters.
*   **Gallery & Media Views**: Jump straight into image, audio, and video collections without digging through folders.
*   **Watch Folder Sync**: Select a local folder in supported browsers and queue changed files automatically.
*   **Offline Cache**: Recently downloaded Telegram files are cached locally for faster repeat opens.
*   **Integrity Checks**: Upload checksums are stored, downloads can be verified, and mismatches are flagged in the UI.
*   **OCR & Preview Search**: Images can be OCR indexed, and text-like previews support quick in-file search.
*   **Sync-Safe Trash & Restore**: Delete files or folders safely with recoverable trash; Sync/Repair keeps trashed items out of active lists until you restore or delete forever.
*   **Retryable Queues**: Failed or cancelled uploads/downloads can be retried without rebuilding the queue.
*   **Multi-Account Sessions**: Keep separate Telegram account manifests and switch accounts from Drive Tools.
*   **High Performance Grid**: Virtual scrolling handles folders with thousands of files instantly.
*   **Auto-Updates**: Seamless updates for Windows, macOS, and Linux.
*   **Media Streaming**: Stream video and audio files directly without downloading.
*   **PDF Viewer:** Built-in PDF support with infinite scrolling for seamless document reading.
*   **Drag & Drop**: Intuitive drag-and-drop upload and file management.
*   **Thumbnail Previews**: Inline thumbnails for images and media files.
*   **Folder Management**: Create "Folders" (private Telegram Channels) to organize content.
*   **Privacy Focused**: API keys and data stay local. No third-party servers.
*   **Cross-Platform**: Native apps for macOS (Intel/ARM), Windows, and Linux.

##  Screenshots

| Dashboard | File Preview |
|-----------|--------------|
| ![Dashboard](screenshots/DashboardWithFiles.png) | ![Preview](screenshots/ImagePreview.png) |

| Grid View | Authentication |
|-----------|----------------|
| ![Dark Mode](screenshots/DarkModeGrid.png) | ![Login](screenshots/LoginScreen.png) |

| Audio Playback | Video Playback |
|----------------|----------------|
| ![Audio Playback](screenshots/AudioPlayback.png) | ![Video Playback](screenshots/VideoPlayback.png) |

| Auth Code Screen | Upload Example |
|------------------|-------------|
| ![Auth Code Screen](screenshots/AuthCodeScreen.png) | ![Upload Example](screenshots/UploadExample.png) |

| Folder Creation | Folder List View |
|-----------------|------------------|
| ![Folder Creation](screenshots/FolderCreation.png) | ![Folder List View](screenshots/FolderListView.png) |

##  Tech Stack

*   **Frontend**: React, TypeScript, TailwindCSS, Framer Motion, Tesseract.js
*   **Backend**: Rust (Tauri), Grammers (Telegram Client)
*   **Build Tool**: Vite


##  Getting Started

### Prerequisites

*   **Node.js (v18+)**: [Download here](https://nodejs.org/)
*   **Rust (latest stable)**: Required to compile the Tauri backend. Install via [rustup](https://rustup.rs/):
    *   **macOS/Linux:** `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
    *   **Windows:** Download and run `rustup-init.exe` from [rustup.rs](https://rustup.rs/)
    *   *Verify installation:* run `rustc --version` and `cargo --version` in your terminal.
*   **OS-Specific Build Tools for Tauri**: 
    *   **macOS:** Xcode Command Line Tools (`xcode-select --install`).
    *   **Linux (Ubuntu/Debian):** `sudo apt update && sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
    *   **Windows (CRITICAL):** You **must** install the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/). During installation, select the **"Desktop development with C++"** workload. Without this, you will get a `linker 'link.exe' not found` error.
    *   **Windows (WebView2):** Windows 10/11 users usually have this pre-installed. If not, download the [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section).
    *   *Reference:* See the official [Tauri v2 Prerequisites Guide](https://v2.tauri.app/start/prerequisites/) for detailed instructions.
*   **Telegram API Credentials**: You need your own API ID and API Hash to communicate with Telegram's servers.
    1. Log into [my.telegram.org](https://my.telegram.org).
    2. Go to "API development tools" and create a new application to get your `api_id` and `api_hash`.

> [!NOTE]  
> **First-run Compile Time:** The initial build (`npm run tauri dev` or `npm run tauri build`) will download and compile over 300 Rust crates. This process can take **5 to 15 minutes** depending on your hardware. Subsequent builds will be much faster.

> [!TIP]
> **NPM Vulnerabilities:** You may see vulnerability warnings during `npm install`. These are usually related to build tools and dev dependencies. You can optionally run `npm audit fix`, but it is not strictly required to run the app.

> [!NOTE]
> **Updater signing:** Tauri in-app update metadata (`latest.json`) requires `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to be configured in GitHub Secrets. Release installers are published even when updater signing secrets are not available.

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/sachinmandawi/Telegram-Drive.git
    cd Telegram-Drive
    ```

2.  **Install Dependencies**
    ```bash
    cd app
    npm install
    ```

3.  **Configure Telegram Credentials**
    ```bash
    cp .env.example .env.local
    ```
    Add your own `VITE_TELEGRAM_API_ID` and `VITE_TELEGRAM_API_HASH` in `.env.local`.

4.  **Run in Development Mode**
    ```bash
    npm run tauri dev
    ```

5.  **Build/Compile**
    ```bash
    npm run tauri build
    ```

##  Open Source & License

This repository is owned and maintained by **Sachin Mandavi** ([@sachinmandawi](https://github.com/sachinmandawi)).

Copyright (c) 2026 **Sachin Mandavi**.

Licensed under the **MIT License**. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md).

---
*Disclaimer: This application is not affiliated with Telegram FZ-LLC. Use responsibly and in accordance with Telegram's Terms of Service.*

<div align="center">
  <strong>Maintainer:</strong>
  <a href="https://github.com/sachinmandawi">Sachin Mandavi (@sachinmandawi)</a>
</div>
