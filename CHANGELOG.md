# Changelog

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
