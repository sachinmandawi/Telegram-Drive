# Changelog

## [1.1.5] - 2026-05-07

### Google Drive-Style Folder Trash

- Reworked Saved Messages folder delete so folders move to Trash as restorable folder items with their nested folders and files kept together.
- Restoring a trashed folder now restores the whole folder tree and its files to the original structure.
- Delete Forever and Trash Cleanup now permanently remove trashed folder trees and their Telegram messages together.
- Added a visible Select All / Clear selection action when items are selected, and folder cards can now be selected directly.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.5.

## [1.1.4] - 2026-05-07

### Folder Trash Sync Fix

- Fixed folder delete in Saved Messages mode so deleting a folder moves its files into Trash instead of moving them back to the root view.
- Added folder lifecycle tombstones and `folder_deleted` manifest replay so deleted folders stay hidden after Sync/Repair and app restart.
- Sync now trusts the refreshed Saved Messages manifest folder list instead of merging stale locally cached folders back into the sidebar.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.4.

## [1.1.3] - 2026-05-07

### Trash Sync Fix

- Added a local file lifecycle tombstone layer so deleted files stay hidden from active lists even if Sync/Repair reloads an older Telegram manifest.
- Trash now shows soft-deleted files even when Telegram metadata is temporarily missing, so users can restore or delete forever reliably.
- Desktop/channel storage now uses the same soft-delete Trash behavior instead of hard-deleting on the first Delete click.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.3.

## [1.1.2] - 2026-05-06

### Release Pipeline Recovery

- Restored unsigned desktop release builds while the updater signing private key is not configured in GitHub Secrets.
- Fixed Saved Messages delete flow so files move into Telegram Drive Trash, appear in the Trash view, and stay trashed after Sync/Repair.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.2.

## [1.1.1] - 2026-05-06

### Updater Release Metadata

- Attempted signed updater artifact publishing for `latest.json`.
- This release was not published because the updater signing private key secret is not configured.

## [1.1.0] - 2026-05-06

### Major Feature Update

- Added Drive Tools with storage analytics, type breakdowns, manifest export/import, offline cache controls, trash cleanup, account switching, and release/update shortcuts.
- Added Gallery and Media views for image, audio, and video-focused browsing.
- Added file tags, bulk tag editing, bulk starring, card/list tag badges, and context-menu tag editing.
- Added smart Saved Messages search across names, metadata, checksums, tags, indexed text, and OCR text.
- Added upload checksums, download verification, integrity badges, and manual checksum verification.
- Added OCR indexing for image previews and quick search inside text, DOCX, spreadsheet, and OCR preview content.
- Added watch folder sync using the File System Access API where the browser/runtime supports it.
- Added offline download cache with cache statistics and clear-cache controls.
- Added retry support for failed or cancelled upload and download queue items.
- Added multi-account session scoping so separate Telegram accounts keep separate manifests, folders, bandwidth counters, and sessions.
- Added configurable trash retention cleanup and one-click empty trash.
- Updated dependencies and added Tesseract.js for local OCR.

## [1.0.3] - 2026-05-06

### Upload Fix

- Fixed browser-only uploads failing on some files with `Either one of \`buffer\` or \`filePath\` should be specified`.
- Switched browser Telegram uploads and manifest snapshots to native browser `File` payloads for safer large-file handling.
- Rebuilt website and desktop installers from the corrected upload path.

## [1.0.2] - 2026-05-06

### Preview Update

- Fixed desktop EXE PDF preview in Saved Messages mode by loading local blob-backed documents as bytes instead of direct blob URLs.
- Added broader inline previews for text, code, config, subtitle, JSON, CSV, TSV, and DOCX files.
- Unified MIME and extension-aware preview routing across website and desktop builds.
- Rebuilt website and desktop installers from the updated preview-safe codebase.

## [1.0.1] - 2026-05-06

### Fix Release

- Fixed Telegram 2FA password verification for browser-only Saved Messages mode.
- Fixed missing logo and favicon paths on the GitHub Pages website.
- Rebuilt and republished the website and desktop installers from the corrected codebase.

## [1.0.0] - 2026-05-06

### First Public Release

- Browser-only Telegram Saved Messages storage mode.
- Persistent cloud manifest for folders, starred files, trash state, and metadata across reinstalls.
- Stabilized Telegram uploads with throttling, retry handling, and background manifest sync.
- Folder creation, folder upload, drag and drop, thumbnails, PDF viewing, and media streaming.
- Browser website, desktop app, and GitHub release aligned to the same initial public version.
