# Changelog

## [1.1.30] - 2026-05-09

### Folder Move, Settings, And Preview Polish

- Fixed nested folder moves so selected child folders stay inside their selected parent instead of being flattened into the destination.
- Removed OCR text extraction and the Tesseract dependency.
- Added a separate Settings page with saved grid column options: 2, 3, 4, 5, and 6 columns, defaulting to 4.
- Kept the floating plus menu action boxes the same size and blurred the plus button behind the open menu.
- Made preview screens full-screen, removed visible left/right arrow buttons, and kept keyboard/swipe/horizontal-scroll navigation.
- Expanded common Telegram media/file type detection for image, video, audio, subtitle, and text previews.
- Bumped app, Tauri, and release versions to 1.1.30.

## [1.1.23] - 2026-05-08

### Android Mobile Compile Fix

- Fixed Android compilation by skipping the desktop-only window-state plugin on mobile builds.
- Desktop builds still keep window-state restore behavior.

## [1.1.22] - 2026-05-08

### Android Release Workflow Fix

- Fixed the Android release job to build the APK with the Tauri CLI directly instead of using an unsupported mobile action input.
- The Android job now uploads generated APK files to the GitHub Release with stable Telegram Drive asset names.

## [1.1.21] - 2026-05-08

### Android APK Release Pipeline

- Added an Android build job to the release workflow.
- The release workflow now initializes the Tauri Android project in CI, installs Android SDK/NDK packages, builds an Android debug APK, and uploads it to the same GitHub Release.
- Updated release notes to clarify that Android APK assets are debug-signed for direct phone testing and need a release keystore before Google Play publishing.

## [1.1.20] - 2026-05-08

### Removed Upload Target Labels

- Removed the visible `To: ...` upload target label from the top toolbar.
- Removed the visible upload target label from grid upload tiles and the upload queue.
- Simplified the empty-folder upload message so folder paths no longer appear in the main upload UI.

## [1.1.19] - 2026-05-08

### Target Label Visibility Fix

- Fixed the toolbar upload target label being clipped under the search box.
- Fixed the grid upload tile target label being cut off at the bottom by showing a compact current-folder pill with the full path in the tooltip.
- Tightened target-label truncation so long folder paths stay one-line and do not overlap nearby controls.

## [1.1.18] - 2026-05-08

### Move Target Metadata Fix

- Fixed Move to Folder failing with `Target folder metadata not found` when the UI still had a valid local folder record but the Saved Messages manifest was missing that folder metadata.
- Move now passes the target folder name/parent hint and restores the missing virtual folder record before applying file or folder moves.

## [1.1.17] - 2026-05-08

### Stable Drive Flow Pack

- Strengthened delete/trash refresh so file and folder deletes sync immediately and do not reappear after manual sync.
- Added visible upload target labels in the toolbar, empty folder state, upload tile, and upload queue.
- Improved Create Folder from the current folder with clearer target feedback.
- Replaced the flat Move dialog with a searchable folder tree that blocks selected folder descendants.
- Added Drive-wide search folder matches, result paths, and open-location behavior for file results.
- Added clearer sync status text, a safer restore flow with Repair Index action, per-file upload retry/remove controls, and a more consistent context-menu order.

## [1.1.16] - 2026-05-08

### Rollback To 1.1.14 Flow

- Rolled back the `v1.1.15` Google Drive flow upgrade pack.
- Restored the simpler `v1.1.14` sidebar and dashboard behavior after Gallery, Recent, and Media were removed.
- Removed the added `+ New` menu, Details panel, searchable move tree, per-item upload queue controls, browser ZIP flow, and related flow changes from `v1.1.15`.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.16 for a clean rollback release.

## [1.1.14] - 2026-05-08

### Removed Gallery Recent Media Views

- Removed Gallery, Recent, and Media from the sidebar.
- Removed Gallery, Recent, and Media drive-view routing and filtering from the dashboard.
- Removed the active Recent command helper now that the Recent view is gone.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.14.

## [1.1.13] - 2026-05-08

### Removed Pin And Star

- Removed Starred and Quick Access from the sidebar and drive views.
- Removed Star and Pin actions from the context menu and bulk toolbar.
- Removed starred badges, search chip, analytics metric, and command handlers from the active app flow.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.13.

## [1.1.12] - 2026-05-08

### Quick Access Tree Fix

- Made Quick Access inherit pinned folder trees, so pinning a folder also shows its child folders and files.
- Made Starred inherit starred folder trees, so starring a folder also shows its child folders and files.
- Kept trashed and missing children hidden from inherited Quick Access and Starred results.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.12.

## [1.1.11] - 2026-05-08

### Deep Bug Fix Pack

- Preserved existing PIN protection hashes when replaying older protection events, with a recovery path for removing protection if hash metadata is missing.
- Fixed drag/drop moves from Starred, Recent, Quick Access, and other non-folder views so stale active folder state cannot cancel valid moves.
- Fixed folder trash logic to also trash files that only exist in the folder map and have not been fully indexed yet.
- Hid active files from search, Recent, Quick Access, and folder listings when their parent folder is trashed.
- Replaced false-success fallback command responses with explicit unsupported errors for folder move, rename, copy, and color operations outside Saved Messages storage.
- Fixed restore callbacks so Trash restore refreshes with the current sync handler instead of stale initial state.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.11.

## [1.1.10] - 2026-05-07

### Folder Root Logic & PIN Protection Fix

- Fixed Upload Folder so folders uploaded from inside another folder stay inside that folder instead of appearing at Saved Messages root/sidebar.
- Fixed sidebar Create Folder so Starred, Gallery, Recent, Quick Access, Media, and Trash do not reuse a stale folder parent.
- Fixed Make a Copy so root items stay in root instead of copying into the last active folder.
- Fixed PIN protection so wrong PINs no longer unlock protected files or folders, protection hashes are preserved during manifest sync, and newly protected items require the PIN before protected actions.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.10.

## [1.1.9] - 2026-05-07

### Nested Folder Create Fix

- Fixed Create Folder failing with `Target folder metadata not found` when the selected parent folder was stale or missing from the refreshed manifest.
- Create Folder now works from inside folders and preserves the intended parent folder when the folder exists locally.
- Stale parent selections safely fall back to Saved Messages instead of blocking folder creation.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.9.

## [1.1.8] - 2026-05-07

### Drive-Style Safety & Recovery Pack

- Added Make a Copy for files and folders, including folder-tree copy with copied files uploaded into the new structure.
- Added conflict strategies for moving items: keep both, replace, skip, and merge folders.
- Added folder merge flow from the context menu and Google Drive-style create-folder actions in the toolbar, empty state, grid upload tile, and list upload row.
- Added locked items and PIN-protected items with visible badges and unlock prompts before open, move, rename, copy, or delete actions.
- Added a local sync operation queue, Storage Health warnings, and Recovery Center actions in Drive Tools.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.8.

## [1.1.7] - 2026-05-07

### Browser Upload Hotfix

- Fixed GitHub Pages/Saved Messages upload failing with `Cannot use [object File] as file`.
- Browser files are now uploaded through Telegram's upload handle flow before sending, with the original filename preserved.
- Fixed the same browser File path for remote manifest saves so uploads and sync metadata can persist reliably.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.7.

## [1.1.6] - 2026-05-07

### Google Drive Logic Pack

- Fixed Trash folder restore from the website by preserving backend folder item types in the frontend list mapper.
- Added Undo after delete, bulk restore, Trash folder drill-down, and missing-parent restore fallback to root.
- Added folder move, drag-and-drop folder move, rename, folder sizes, clickable breadcrumbs, and duplicate-name conflict handling.
- Added Recent and Quick Access views with pin support, folder starring, folder colors, advanced search chips, and current-folder/all-drive search scope.
- Added version history lookup, activity log, and cleanup suggestions in Drive Tools.
- Bumped app, Tauri, and Saved Messages manifest versions to 1.1.6.

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
