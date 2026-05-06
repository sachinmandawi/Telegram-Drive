export interface TelegramFile {
    id: number;
    name: string;
    size: number;
    sizeStr: string; // Formatted size
    created_at?: string;
    type?: 'folder' | 'file'; // implied icon_type
    folderId?: number | null;
    mime_type?: string;
    file_ext?: string;
    tags?: string[];
    starred?: boolean;
    trashed?: boolean;
    missing?: boolean;
    checksum?: string;
    originalPath?: string;
    version?: number;
    versionGroup?: string;
    duplicateOf?: number;
    textIndexedAt?: string;
    ocrIndexedAt?: string;
    checksumVerifiedAt?: string;
    integrityStatus?: 'unknown' | 'valid' | 'mismatch';
}

export type DriveView = 'files' | 'starred' | 'trash' | 'gallery' | 'media';

export interface TelegramFolder {
    id: number;
    name: string;
    parent_id?: number;
}

export interface QueueItem {
    id: string;
    path: string;
    file?: File;
    folderId: number | null;
    status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';
    error?: string;
    progress?: number; // 0-100
    attempts?: number;
}

export interface BandwidthStats {
    up_bytes: number;
    down_bytes: number;
}

export interface DownloadItem {
    id: string;
    messageId: number;
    filename: string;
    folderId: number | null;
    status: 'pending' | 'downloading' | 'success' | 'error' | 'cancelled';
    error?: string;
    progress?: number; // 0-100
    destinationPath?: string;
    attempts?: number;
}

export interface DriveTypeBreakdown {
    label: string;
    count: number;
    bytes: number;
}

export interface DriveStats {
    totalFiles: number;
    activeFiles: number;
    trashedFiles: number;
    starredFiles: number;
    duplicateFiles: number;
    missingFiles: number;
    totalBytes: number;
    activeBytes: number;
    trashedBytes: number;
    indexedTextFiles: number;
    verifiedFiles: number;
    checksumMismatches: number;
    folders: number;
    backups: number;
    trashRetentionDays: number;
    largestFiles: TelegramFile[];
    types: DriveTypeBreakdown[];
    updatedAt: string;
}

export interface ManifestBackupInfo {
    at: string;
    messageId?: number;
    size?: number;
}

export interface OfflineCacheStats {
    items: number;
    bytes: number;
    maxItems: number;
    maxBytes: number;
}

export interface IntegrityResult {
    messageId: number;
    checksum?: string;
    expectedChecksum?: string;
    valid: boolean;
}

export interface TelegramAccountInfo {
    id: string;
    label: string;
    apiId?: number;
    lastUsedAt: string;
    active: boolean;
}
