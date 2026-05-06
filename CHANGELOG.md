# Changelog

## [1.1.11] - 2026-05-06

### Fixes

- Stabilized Telegram Saved Messages uploads by throttling Telegram file sends and retrying transient failures.
- Moved manifest/index sync to debounced background writes so successful file uploads are not marked as failed.
- Added detailed upload error text in the queue to make failed files easier to diagnose.
- Refreshed website, desktop app, and release artifacts for the upload fix.

---

## [1.1.10] - 2026-05-06

### Fixes

- Defaulted public browser/desktop builds to Telegram Saved Messages storage when no local env override is present.
- Fixed desktop media and PDF streaming by using the backend-provided stream URL instead of a hardcoded port.
- Aligned frontend package version with the Tauri app version.
- Changed the main GitHub Actions workflow from release publishing on every main push to validation-only CI.
- Hardened backend bandwidth, logout, network check, and global search paths against avoidable panics.

---

## [1.1.7] - 2026-05-01

### Feature

- Updated login-screen support UI and release notes.

---

## [1.1.6] - 2026-04-28

### Fix

- Fixed process shutdown when launched from a terminal. The Actix streaming server and grammers network runner now receive shutdown signals when the app exits.

---

## [1.1.5] - 2026-04-27

### Hotfix

- Fixed the AppImage patch step by replacing a fragile grep lookup with an awk-based desktop-file lookup and enabling `APPIMAGE_EXTRACT_AND_RUN=1` for GitHub Actions.

---

## [1.1.4] - 2026-04-27

### Hotfix

- Added a deeper AppImage EGL compatibility patch for Arch and rolling-release Linux distributions.

---

## [1.1.3] - 2026-04-27

### Hotfix

- Fixed Arch Linux AppImage startup crashes caused by bundled Mesa/EGL libraries conflicting with host GPU drivers.

---

## [1.0.4] - 2026-02-13

### Fixes

- Fixed grid card overlap by making virtualizer row heights and CSS card sizing agree.

### Cleanup

- Removed leftover frontend debug logging except the intentional ErrorBoundary report.
- Removed loose frontend `any` casts.
- Ran Clippy and fixed warnings.
- Removed unused frontend packages.

---

## [1.0.3] - 2026-02-09

### Bug Fixes

- Fixed grid spacing, dynamic row height, and virtualizer re-measurement behavior.

---

## [1.0.2] - 2026-02-07

### Automated Release Pipeline

- Added tag-triggered GitHub Actions builds for Windows, Linux, and macOS.

---

## [1.0.1] - 2026-02-07

### Auto-Update System

- Added automatic update checks, update banner UI, Tauri updater integration, and platform-specific update support.

---

## [1.0.0] - 2026-02-06

### First Stable Release

- Added virtual scrolling, inline thumbnails, thumbnail caching, and API setup help.
- Improved grid/list rendering performance and responsive layout behavior.
- Refined light mode and file-grid UI.

---

## [0.6.0] - 2026-02-05

### Reliability Update

- Added session persistence, network resilience, queue persistence, and light mode fixes.

---

## [0.5.0] - 2026-02-04

### Drag And Drop Update

- Added stable hybrid drag-and-drop, external drop blocking, and workflow fixes.

---

## [0.4.0] - 2026-02-01

### Media And Performance

- Added audio/video streaming player, global search, and internal folder drag-and-drop.
