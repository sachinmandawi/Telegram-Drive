import type {
    BandwidthStats,
    DriveStats,
    OfflineCacheStats,
    TelegramFile,
    TelegramFolder,
    UploadConflictInfo,
    UploadConflictStrategy,
} from './types';
import { formatBytes } from './utils';
import {
    telegramCheckPassword,
    telegramConnect,
    telegramCopyItem,
    telegramCreateFolder,
    telegramDeleteFolder,
    telegramDeleteFile,
    telegramDownloadBlob,
    telegramDownloadFile,
    telegramFlushManifest,
    telegramGetFiles,
    telegramGetFolders,
    telegramGetUploadConflicts,
    telegramGetDriveStats,
    telegramGetActivityItems,
    telegramGetCleanupSuggestions,
    telegramGetFileVersions,
    telegramGetRecoveryItems,
    telegramGetOfflineCacheStats,
    telegramGetObjectUrl,
    telegramGetStorageHealth,
    telegramGetTrashFiles,
    telegramExportManifest,
    telegramImportManifest,
    telegramIndexFileText,
    telegramListAccounts,
    telegramLogout,
    telegramMoveFiles,
    telegramMoveFolders,
    telegramPrepareAddAccount,
    telegramPermanentlyDeleteFolder,
    telegramPermanentlyDeleteFile,
    telegramCleanupTrash,
    telegramClearOfflineCache,
    telegramRepairManifest,
    telegramRenameItem,
    telegramRequestCode,
    telegramRestoreFolder,
    telegramRestoreFile,
    telegramSearchFiles,
    telegramSetFolderColor,
    telegramSetItemProtection,
    telegramSetTrashRetention,
    telegramSignIn,
    telegramSetFileTags,
    telegramSwitchAccount,
    telegramToggleLockItem,
    telegramUnlockProtectedItem,
    telegramUploadFile,
} from './telegramBrowser';

export interface AppStore {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void | boolean>;
    save(): Promise<void>;
}

type CommandArgs = Record<string, unknown>;
type EventHandler<T> = (event: { payload: T }) => void;
export interface StreamInfo {
    token: string;
    base_url: string;
}

type WebFileRecord = {
    id: number;
    folderId: number | null;
    name: string;
    size: number;
    created_at: string;
    icon_type: 'file';
    mime_type?: string;
    file_ext?: string;
    blob: Blob;
    tags?: string[];
    color?: string;
    locked?: boolean;
    protected?: boolean;
    protectionHash?: string;
    protectionHint?: string;
    trashed?: boolean;
    deletedAt?: string;
    checksum?: string;
    textIndex?: string;
    integrityStatus?: 'unknown' | 'valid' | 'mismatch';
    versionGroup?: string;
    version?: number;
    duplicateOf?: number;
};

const DB_NAME = 'telegram-drive-web';
const DB_VERSION = 1;
const FILE_STORE = 'files';
const STORE_PREFIX = 'telegram-drive-store:';
const NEXT_ID_KEY = 'telegram-drive-web-next-id';
const BANDWIDTH_KEY = 'telegram-drive-web-bandwidth';
const LEGACY_TRASH_KEY = 'telegram-drive-legacy-trash';
const unlockedWebProtectedItems = new Set<number>();

type TauriInvokeFn = <T>(command: string, args?: CommandArgs) => Promise<T>;

type LegacyTelegramFile = TelegramFile & {
    folder_id?: number | null;
    icon_type?: string;
    created_at?: string;
    deletedAt?: string;
};

export const isTauriRuntime = () =>
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const isSavedMessagesDefaultStorage = () =>
    (import.meta.env.VITE_DEFAULT_STORAGE || 'saved_messages') === 'saved_messages';

export const getPublicAssetPath = (assetPath: string) =>
    `${import.meta.env.BASE_URL || '/'}${assetPath.replace(/^\/+/, '')}`;

export const telegramApiDefaults = () => ({
    apiId: import.meta.env.VITE_TELEGRAM_API_ID || '',
    apiHash: import.meta.env.VITE_TELEGRAM_API_HASH || '',
});

let mobileDownloadPermissionGranted = false;

class BrowserStore implements AppStore {
    private data: Record<string, unknown>;

    constructor(private readonly name: string) {
        this.data = readBrowserStore(name);
    }

    async get<T>(key: string): Promise<T | undefined> {
        return this.data[key] as T | undefined;
    }

    async set<T>(key: string, value: T): Promise<void> {
        this.data[key] = value;
        await this.save();
    }

    async delete(key: string): Promise<void> {
        delete this.data[key];
        await this.save();
    }

    async save(): Promise<void> {
        localStorage.setItem(`${STORE_PREFIX}${this.name}`, JSON.stringify(this.data));
    }
}

function readBrowserStore(name: string): Record<string, unknown> {
    try {
        const raw = localStorage.getItem(`${STORE_PREFIX}${name}`);
        return raw ? JSON.parse(raw) as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

export async function loadAppStore(name: string): Promise<AppStore> {
    if (!isTauriRuntime()) return new BrowserStore(name);

    const storeModule = await import('@tauri-apps/plugin-store');
    if ('load' in storeModule && typeof storeModule.load === 'function') {
        return await storeModule.load(name);
    }
    return await storeModule.Store.load(name);
}

export async function invokeCommand<T>(command: string, args: CommandArgs = {}): Promise<T> {
    if (isSavedMessagesDefaultStorage()) {
        return await invokeBrowserTelegramCommand<T>(command, args);
    }

    if (isTauriRuntime()) {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invokeTauriCommand<T>(invoke, command, args);
    }

    return await invokeBrowserCommand<T>(command, args);
}

async function invokeTauriCommand<T>(invoke: TauriInvokeFn, command: string, args: CommandArgs): Promise<T> {
    switch (command) {
        case 'cmd_get_files': {
            const files = await invoke<LegacyTelegramFile[]>(command, args);
            return filterLegacyActiveFiles(files) as T;
        }
        case 'cmd_search_global': {
            const files = await invoke<LegacyTelegramFile[]>(command, args);
            return filterLegacyActiveFiles(files) as T;
        }
        case 'cmd_delete_file': {
            const messageId = Number(args.messageId);
            const folderId = normalizeFolderId(args.folderId);
            const file = await findLegacyFile(invoke, messageId, folderId);
            rememberLegacyTrash(file || createLegacyTrashPlaceholder(messageId, folderId));
            return true as T;
        }
        case 'cmd_get_trash_files':
            return getLegacyTrashFiles(String(args.query || '')) as T;
        case 'cmd_get_activity_items':
        case 'cmd_get_cleanup_suggestions':
        case 'cmd_get_file_versions':
        case 'cmd_get_storage_health':
        case 'cmd_get_recovery_items':
            return [] as T;
        case 'cmd_restore_file':
            forgetLegacyTrash(Number(args.messageId));
            return true as T;
        case 'cmd_permanent_delete_file': {
            const messageId = Number(args.messageId);
            const trashed = readLegacyTrash()[String(messageId)];
            const folderId = normalizeFolderId(args.folderId ?? trashed?.folderId ?? trashed?.folder_id);
            await invoke<boolean>('cmd_delete_file', { messageId, folderId });
            forgetLegacyTrash(messageId);
            return true as T;
        }
        case 'cmd_cleanup_trash': {
            const trash = readLegacyTrash();
            let deleted = 0;
            let failed = 0;
            for (const record of Object.values(trash)) {
                try {
                    await invoke<boolean>('cmd_delete_file', {
                        messageId: record.id,
                        folderId: normalizeFolderId(record.folderId ?? record.folder_id),
                    });
                    forgetLegacyTrash(record.id);
                    deleted++;
                } catch {
                    failed++;
                }
            }
            return { deleted, failed } as T;
        }
        case 'cmd_set_trash_retention':
        case 'cmd_flush_manifest':
        case 'cmd_toggle_lock':
            return true as T;
        case 'cmd_move_folders':
        case 'cmd_rename_item':
        case 'cmd_copy_item':
        case 'cmd_set_folder_color':
            throw new Error(`${command} requires Saved Messages storage`);
        case 'cmd_set_protection':
        case 'cmd_unlock_item':
            throw new Error('PIN protection requires Saved Messages storage');
        default:
            return await invoke<T>(command, args);
    }
}

function readLegacyTrash(): Record<string, LegacyTelegramFile> {
    try {
        const parsed = JSON.parse(localStorage.getItem(LEGACY_TRASH_KEY) || '{}') as Record<string, LegacyTelegramFile>;
        return Object.fromEntries(Object.entries(parsed || {}).filter(([key, record]) => {
            const id = Number(record?.id || key);
            return Number.isFinite(id);
        }));
    } catch {
        return {};
    }
}

function writeLegacyTrash(records: Record<string, LegacyTelegramFile>) {
    localStorage.setItem(LEGACY_TRASH_KEY, JSON.stringify(records));
}

function rememberLegacyTrash(file: LegacyTelegramFile) {
    const records = readLegacyTrash();
    const folderId = normalizeFolderId(file.folderId ?? file.folder_id);
    records[String(file.id)] = {
        ...file,
        folderId,
        folder_id: folderId,
        type: 'file',
        icon_type: file.icon_type || 'file',
        trashed: true,
        deletedAt: new Date().toISOString(),
        sizeStr: file.sizeStr || formatBytes(file.size || 0),
    };
    writeLegacyTrash(records);
}

function forgetLegacyTrash(messageId: number) {
    const records = readLegacyTrash();
    delete records[String(messageId)];
    writeLegacyTrash(records);
}

function getLegacyTrashFiles(query: string): LegacyTelegramFile[] {
    const normalized = query.trim().toLowerCase();
    return Object.values(readLegacyTrash())
        .filter((record) => !normalized || [
            record.name,
            record.mime_type,
            record.file_ext,
        ].filter(Boolean).join(' ').toLowerCase().includes(normalized))
        .sort((a, b) => new Date(b.deletedAt || b.created_at || 0).getTime() - new Date(a.deletedAt || a.created_at || 0).getTime());
}

function filterLegacyActiveFiles(files: LegacyTelegramFile[]): LegacyTelegramFile[] {
    const trash = readLegacyTrash();
    return files.filter((file) => !trash[String(file.id)]);
}

async function findLegacyFile(
    invoke: TauriInvokeFn,
    messageId: number,
    folderId: number | null
): Promise<LegacyTelegramFile | null> {
    try {
        const files = await invoke<LegacyTelegramFile[]>('cmd_get_files', { folderId });
        return files.find((file) => Number(file.id) === messageId) || null;
    } catch {
        return null;
    }
}

function createLegacyTrashPlaceholder(messageId: number, folderId: number | null): LegacyTelegramFile {
    return {
        id: messageId,
        name: `Telegram-file-${messageId}`,
        size: 0,
        sizeStr: formatBytes(0),
        created_at: '',
        type: 'file',
        icon_type: 'file',
        folderId,
        folder_id: folderId,
        trashed: true,
    };
}

function normalizeFolderId(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    const folderId = Number(value);
    return Number.isFinite(folderId) ? folderId : null;
}

export async function listenEvent<T>(eventName: string, handler: EventHandler<T>): Promise<() => void> {
    if (!isTauriRuntime()) return () => undefined;

    const { listen } = await import('@tauri-apps/api/event');
    return await listen<T>(eventName, handler);
}

export async function openExternal(url: string): Promise<void> {
    if (isTauriRuntime()) {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(url);
        return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openTauriFileDialog(): Promise<string[]> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ multiple: true, directory: false });
    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
}

export async function saveTauriFileDialog(defaultPath: string): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    return await save({ defaultPath });
}

export async function openTauriDirectoryDialog(title: string): Promise<string | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false, title });
    return typeof selected === 'string' ? selected : null;
}

export async function toAssetUrl(path: string): Promise<string> {
    if (path.startsWith('blob:') || path.startsWith('data:') || path.startsWith('http')) return path;
    if (!isTauriRuntime()) return path;

    const { convertFileSrc } = await import('@tauri-apps/api/core');
    return convertFileSrc(path);
}

export async function uploadBrowserFile(
    file: File,
    folderId: number | null,
    onProgress?: (percent: number) => void,
    conflictStrategy: UploadConflictStrategy = 'version'
): Promise<TelegramFile> {
    if (isSavedMessagesDefaultStorage()) {
        return await telegramUploadFile(file, folderId, onProgress, conflictStrategy);
    }
    ensureBrowserMode();

    const id = nextWebId();
    onProgress?.(15);
    const checksum = await sha256Blob(file);
    const conflicts = await getWebUploadConflicts(file.name, file.size, folderId);
    const strategy = normalizeUploadConflictStrategy(conflictStrategy);

    if (strategy === 'skip' && conflicts.count > 0) {
        const existing = conflicts.items[0];
        if (!existing) throw new Error('Duplicate file skipped');
        onProgress?.(100);
        return existing;
    }

    if (strategy === 'replace' && conflicts.count > 0) {
        for (const item of conflicts.items) {
            await trashWebFile(item.id);
        }
    }

    const uploadName = strategy === 'keep_both'
        ? await createUniqueWebFileName(file.name, folderId)
        : file.name;

    const record: WebFileRecord = {
        id,
        folderId,
        name: uploadName,
        size: file.size,
        created_at: new Date(file.lastModified || Date.now()).toLocaleString(),
        icon_type: 'file',
        mime_type: file.type || undefined,
        file_ext: getExtension(file.name),
        blob: file,
        tags: [],
        locked: false,
        protected: false,
        trashed: false,
        checksum,
        integrityStatus: 'unknown',
        duplicateOf: strategy === 'version' && conflicts.count > 0 ? conflicts.items[0]?.id : undefined,
        versionGroup: strategy === 'version' && conflicts.count > 0 ? `web-${file.name.toLowerCase()}-${folderId ?? 'root'}` : undefined,
        version: strategy === 'version' && conflicts.count > 0 ? conflicts.count + 1 : undefined,
    };

    await putWebFile(record);
    addBandwidth('up_bytes', file.size);
    onProgress?.(100);
    return toTelegramFile(record);
}

export async function downloadBrowserFile(messageId: number, filename?: string): Promise<void> {
    if (isSavedMessagesDefaultStorage()) {
        if (isTauriRuntime()) {
            await downloadSavedMessagesFileToNativeDownloads(messageId, filename);
            return;
        }
        if (!await requestMobileDownloadPermission(sanitizeDownloadName(filename || `Telegram-file-${messageId}`))) {
            throw new Error('Download cancelled.');
        }
        await telegramDownloadFile(messageId, filename);
        return;
    }
    ensureBrowserMode();

    const record = await getWebFile(messageId);
    if (!record) throw new Error('File not found');

    const url = URL.createObjectURL(record.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || record.name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    addBandwidth('down_bytes', record.size);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function downloadSavedMessagesFileToNativeDownloads(messageId: number, filename?: string): Promise<void> {
    const requestedName = sanitizeDownloadName(filename || `Telegram-file-${messageId}`);
    if (!await requestMobileDownloadPermission(requestedName)) {
        throw new Error('Download cancelled.');
    }

    const { blob, name } = await telegramDownloadBlob(messageId);
    const targetName = sanitizeDownloadName(filename || name || requestedName);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('cmd_save_download_bytes', {
        filename: targetName,
        bytesBase64: uint8ArrayToBase64(bytes),
    });
}

async function requestMobileDownloadPermission(filename: string): Promise<boolean> {
    if (!isLikelyMobileDevice()) return true;
    if (mobileDownloadPermissionGranted) return true;

    const allowed = window.confirm(
        `Allow Telegram Drive to save downloads on this device?\n\n"${filename}" will be saved to Downloads when Android allows it.`
    );
    mobileDownloadPermissionGranted = allowed;
    return allowed;
}

function isLikelyMobileDevice(): boolean {
    if (typeof window === 'undefined') return false;
    const navigatorWithData = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    return Boolean(navigatorWithData.userAgentData?.mobile)
        || /android|iphone|ipad|ipod|iemobile|mobile/i.test(navigator.userAgent)
        || ((navigator.maxTouchPoints || 0) > 0 && Math.min(window.innerWidth, window.innerHeight) <= 900);
}

function sanitizeDownloadName(name: string): string {
    return String(name || 'download')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        || 'download';
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return window.btoa(binary);
}

export async function getBrowserFileObjectUrl(messageId: number): Promise<string> {
    if (isSavedMessagesDefaultStorage()) {
        return await telegramGetObjectUrl(messageId);
    }
    ensureBrowserMode();

    const record = await getWebFile(messageId);
    if (!record) throw new Error('File not found');
    return URL.createObjectURL(record.blob);
}

async function invokeBrowserCommand<T>(command: string, args: CommandArgs): Promise<T> {
    if (isSavedMessagesDefaultStorage()) {
        return await invokeBrowserTelegramCommand<T>(command, args);
    }

    switch (command) {
        case 'cmd_auth_request_code':
        case 'cmd_connect':
        case 'cmd_clean_cache':
        case 'cmd_logout':
            return true as T;
        case 'cmd_delete_folder':
            await deleteWebFolder(Number(args.folderId));
            return true as T;
        case 'cmd_auth_sign_in':
        case 'cmd_auth_check_password':
            return { success: true } as T;
        case 'cmd_is_network_available':
            return navigator.onLine as T;
        case 'cmd_get_bandwidth':
            return readBandwidth() as T;
        case 'cmd_get_drive_stats':
            return await getWebDriveStats() as T;
        case 'cmd_get_upload_conflicts':
            return await getWebUploadConflicts(
                String(args.name || ''),
                Number(args.size) || 0,
                (args.folderId as number | null | undefined) ?? null
            ) as T;
        case 'cmd_export_manifest':
            return {
                filename: `telegram-drive-browser-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
                payload: JSON.stringify(await getAllWebFiles(), null, 2),
            } as T;
        case 'cmd_import_manifest':
            await importWebManifest(String(args.payload || ''));
            return await getWebDriveStats() as T;
        case 'cmd_cleanup_trash':
            return await cleanupWebTrash(Boolean(args.deleteAll)) as T;
        case 'cmd_get_offline_cache_stats':
            return ({ items: 0, bytes: 0, maxItems: 0, maxBytes: 0 } satisfies OfflineCacheStats) as T;
        case 'cmd_clear_offline_cache':
            return ({ items: 0, bytes: 0, maxItems: 0, maxBytes: 0 } satisfies OfflineCacheStats) as T;
        case 'cmd_create_folder':
            return {
                id: nextWebId(),
                name: String(args.name || 'New Folder'),
                parent_id: typeof args.parentId === 'number' ? args.parentId : undefined,
            } satisfies TelegramFolder as T;
        case 'cmd_scan_folders':
            return [] as T;
        case 'cmd_get_files':
            return await getWebFiles((args.folderId as number | null | undefined) ?? null) as T;
        case 'cmd_delete_file':
            await trashWebFile(Number(args.messageId));
            return true as T;
        case 'cmd_restore_file':
            await updateWebFile(Number(args.messageId), (record) => ({ ...record, trashed: false, deletedAt: undefined }));
            return true as T;
        case 'cmd_permanent_delete_file':
            await deleteWebFile(Number(args.messageId));
            return true as T;
        case 'cmd_set_tags':
            await updateWebFile(Number(args.messageId), (record) => ({
                ...record,
                tags: Array.isArray(args.tags) ? args.tags.map(String).map((tag) => tag.trim().toLowerCase()).filter(Boolean) : [],
            }));
            return true as T;
        case 'cmd_index_file_text':
            await updateWebFile(Number(args.messageId), (record) => ({
                ...record,
                textIndex: String(args.text || '').toLowerCase(),
            }));
            return true as T;
        case 'cmd_move_files':
            await moveWebFiles(
                (args.messageIds as number[] | undefined) || [],
                (args.targetFolderId as number | null | undefined) ?? null
            );
            return true as T;
        case 'cmd_toggle_lock':
            await updateWebFile(Number(args.messageId), (record) => ({
                ...record,
                locked: typeof args.locked === 'boolean' ? args.locked : !record.locked,
            }));
            return true as T;
        case 'cmd_set_protection':
            await setWebFileProtection(
                Number(args.messageId),
                String(args.pin || ''),
                typeof args.protectionHint === 'string' ? args.protectionHint : undefined,
                args.protected === false ? false : true
            );
            return true as T;
        case 'cmd_unlock_item':
            return await unlockWebProtectedFile(Number(args.messageId), String(args.pin || '')) as T;
        case 'cmd_move_folders':
        case 'cmd_rename_item':
        case 'cmd_copy_item':
        case 'cmd_set_folder_color':
            throw new Error(`${command} requires Saved Messages storage`);
        case 'cmd_search_global':
            return await searchWebFiles(String(args.query || '')) as T;
        case 'cmd_get_trash_files':
            return await getWebTrashFiles(String(args.query || '')) as T;
        case 'cmd_get_activity_items':
        case 'cmd_get_cleanup_suggestions':
        case 'cmd_get_file_versions':
        case 'cmd_get_storage_health':
        case 'cmd_get_recovery_items':
            return [] as T;
        case 'cmd_set_trash_retention':
            return true as T;
        case 'cmd_list_accounts':
            return [] as T;
        case 'cmd_switch_account':
        case 'cmd_prepare_add_account':
            return true as T;
        case 'cmd_get_preview':
        case 'cmd_get_thumbnail':
            return await getBrowserFileObjectUrl(Number(args.messageId)) as T;
        case 'cmd_download_file':
            await downloadBrowserFile(Number(args.messageId));
            return 'Download started' as T;
        case 'cmd_get_stream_info':
            return ({ token: 'browser', base_url: '' } satisfies StreamInfo) as T;
        default:
            throw new Error(`Browser mode does not support ${command}`);
    }
}

async function invokeBrowserTelegramCommand<T>(command: string, args: CommandArgs): Promise<T> {
    switch (command) {
        case 'cmd_auth_request_code':
            return await telegramRequestCode(
                String(args.phone || ''),
                Number(args.apiId),
                String(args.apiHash || '')
            ) as T;
        case 'cmd_auth_sign_in':
            return await telegramSignIn(String(args.code || '')) as T;
        case 'cmd_auth_check_password':
            return await telegramCheckPassword(String(args.password || '')) as T;
        case 'cmd_connect':
            return await telegramConnect(Number(args.apiId) || undefined) as T;
        case 'cmd_logout':
            return await telegramLogout() as T;
        case 'cmd_clean_cache':
            return true as T;
        case 'cmd_is_network_available':
            return navigator.onLine as T;
        case 'cmd_get_bandwidth':
            return readBandwidth() as T;
        case 'cmd_get_files':
            return await telegramGetFiles((args.folderId as number | null | undefined) ?? null) as T;
        case 'cmd_get_trash_files':
            return await telegramGetTrashFiles(String(args.query || ''), typeof args.folderId === 'number' ? args.folderId : null) as T;
        case 'cmd_search_global':
            return await telegramSearchFiles(String(args.query || '')) as T;
        case 'cmd_get_drive_stats':
            return await telegramGetDriveStats() as T;
        case 'cmd_get_activity_items':
            return await telegramGetActivityItems(Number(args.limit) || 80) as T;
        case 'cmd_get_cleanup_suggestions':
            return await telegramGetCleanupSuggestions() as T;
        case 'cmd_get_storage_health':
            return await telegramGetStorageHealth() as T;
        case 'cmd_get_recovery_items':
            return await telegramGetRecoveryItems() as T;
        case 'cmd_get_file_versions':
            return await telegramGetFileVersions(Number(args.messageId)) as T;
        case 'cmd_export_manifest':
            return await telegramExportManifest() as T;
        case 'cmd_import_manifest':
            return await telegramImportManifest(String(args.payload || '')) as T;
        case 'cmd_cleanup_trash':
            return await telegramCleanupTrash(
                typeof args.days === 'number' ? args.days : undefined,
                Boolean(args.deleteAll)
            ) as T;
        case 'cmd_set_trash_retention':
            return await telegramSetTrashRetention(Number(args.days) || 30) as T;
        case 'cmd_get_offline_cache_stats':
            return await telegramGetOfflineCacheStats() as T;
        case 'cmd_clear_offline_cache':
            return await telegramClearOfflineCache() as T;
        case 'cmd_index_file_text':
            return await telegramIndexFileText(
                Number(args.messageId),
                String(args.text || '')
            ) as T;
        case 'cmd_list_accounts':
            return await telegramListAccounts() as T;
        case 'cmd_switch_account':
            return await telegramSwitchAccount(String(args.accountId || '')) as T;
        case 'cmd_prepare_add_account':
            return await telegramPrepareAddAccount() as T;
        case 'cmd_delete_file':
            return await telegramDeleteFile(Number(args.messageId)) as T;
        case 'cmd_restore_file':
            if (args.itemType === 'folder') {
                return await telegramRestoreFolder(Number(args.messageId)) as T;
            }
            return await telegramRestoreFile(Number(args.messageId)) as T;
        case 'cmd_permanent_delete_file':
            if (args.itemType === 'folder') {
                return await telegramPermanentlyDeleteFolder(Number(args.messageId)) as T;
            }
            return await telegramPermanentlyDeleteFile(Number(args.messageId)) as T;
        case 'cmd_toggle_lock':
            return await telegramToggleLockItem(
                Number(args.messageId),
                args.itemType === 'folder' ? 'folder' : 'file',
                typeof args.locked === 'boolean' ? args.locked : undefined
            ) as T;
        case 'cmd_set_protection':
            return await telegramSetItemProtection(
                Number(args.messageId),
                args.itemType === 'folder' ? 'folder' : 'file',
                String(args.pin || ''),
                typeof args.protectionHint === 'string' ? args.protectionHint : undefined,
                args.protected === false ? false : true
            ) as T;
        case 'cmd_unlock_item':
            return await telegramUnlockProtectedItem(
                Number(args.messageId),
                args.itemType === 'folder' ? 'folder' : 'file',
                String(args.pin || '')
            ) as T;
        case 'cmd_copy_item':
            return await telegramCopyItem(
                Number(args.messageId),
                args.itemType === 'folder' ? 'folder' : 'file',
                args.targetFolderId === undefined ? undefined : ((args.targetFolderId as number | null | undefined) ?? null)
            ) as T;
        case 'cmd_set_folder_color':
            return await telegramSetFolderColor(Number(args.folderId), String(args.color || '')) as T;
        case 'cmd_rename_item':
            return await telegramRenameItem(
                Number(args.messageId),
                args.itemType === 'folder' ? 'folder' : 'file',
                String(args.name || '')
            ) as T;
        case 'cmd_set_tags':
            return await telegramSetFileTags(
                Number(args.messageId),
                Array.isArray(args.tags) ? args.tags.map(String) : []
            ) as T;
        case 'cmd_download_file':
            await telegramDownloadFile(Number(args.messageId));
            return 'Download started' as T;
        case 'cmd_get_preview':
        case 'cmd_get_thumbnail':
            return await telegramGetObjectUrl(Number(args.messageId)) as T;
        case 'cmd_get_upload_conflicts':
            return await telegramGetUploadConflicts(
                String(args.name || ''),
                Number(args.size) || 0,
                (args.folderId as number | null | undefined) ?? null
            ) as T;
        case 'cmd_scan_folders':
            return await telegramGetFolders(true) as T;
        case 'cmd_repair_manifest':
            return await telegramRepairManifest() as T;
        case 'cmd_flush_manifest':
            return await telegramFlushManifest() as T;
        case 'cmd_create_folder':
            return await telegramCreateFolder(
                String(args.name || 'New Folder'),
                typeof args.parentId === 'number' ? args.parentId : null,
                typeof args.parentName === 'string' ? args.parentName : undefined
            ) as T;
        case 'cmd_delete_folder':
            return await telegramDeleteFolder(Number(args.folderId)) as T;
        case 'cmd_move_files':
            return await telegramMoveFiles(
                (args.messageIds as number[] | undefined) || [],
                (args.targetFolderId as number | null | undefined) ?? null,
                args.conflictStrategy as 'keep_both' | 'replace' | 'skip' | 'merge' | undefined,
                typeof args.targetFolderName === 'string' ? args.targetFolderName : undefined,
                typeof args.targetParentIdHint === 'number' ? args.targetParentIdHint : null
            ) as T;
        case 'cmd_move_folders':
            return await telegramMoveFolders(
                (args.folderIds as number[] | undefined) || [],
                (args.targetParentId as number | null | undefined) ?? null,
                args.conflictStrategy as 'keep_both' | 'replace' | 'skip' | 'merge' | undefined,
                typeof args.targetFolderName === 'string' ? args.targetFolderName : undefined,
                typeof args.targetParentIdHint === 'number' ? args.targetParentIdHint : null
            ) as T;
        case 'cmd_get_stream_info':
            return ({ token: 'browser-telegram', base_url: '' } satisfies StreamInfo) as T;
        default:
            throw new Error(`Browser Telegram mode does not support ${command}`);
    }
}

function ensureBrowserMode() {
    if (isTauriRuntime()) {
        throw new Error('This browser fallback is not available inside Tauri.');
    }
}

function nextWebId(): number {
    const current = Number(localStorage.getItem(NEXT_ID_KEY)) || Date.now();
    const next = current + 1;
    localStorage.setItem(NEXT_ID_KEY, String(next));
    return next;
}

function readBandwidth(): BandwidthStats {
    try {
        const raw = localStorage.getItem(BANDWIDTH_KEY);
        if (raw) return JSON.parse(raw) as BandwidthStats;
    } catch {
        // fall through to zeroed stats
    }
    return { up_bytes: 0, down_bytes: 0 };
}

function addBandwidth(key: keyof BandwidthStats, bytes: number) {
    const current = readBandwidth();
    current[key] += bytes;
    localStorage.setItem(BANDWIDTH_KEY, JSON.stringify(current));
}

function getExtension(name: string) {
    const ext = name.split('.').pop();
    return ext && ext !== name ? ext.toLowerCase() : undefined;
}

function toTelegramFile(record: WebFileRecord): TelegramFile {
    return {
        id: record.id,
        name: record.name,
        size: record.size,
        sizeStr: formatBytes(record.size),
        created_at: record.created_at,
        type: 'file',
        mime_type: record.mime_type,
        file_ext: record.file_ext,
        tags: record.tags || [],
        color: record.color,
        locked: record.locked || false,
        protected: record.protected || false,
        protectionHint: record.protectionHint,
        trashed: record.trashed || false,
        deletedAt: record.deletedAt,
        checksum: record.checksum,
        integrityStatus: record.integrityStatus || 'unknown',
        version: record.version,
        versionGroup: record.versionGroup,
        duplicateOf: record.duplicateOf,
    };
}

function openWebDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(FILE_STORE)) {
                db.createObjectStore(FILE_STORE, { keyPath: 'id' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Failed to open browser database'));
    });
}

async function withFileStore<T>(
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
    const db = await openWebDb();
    return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(FILE_STORE, mode);
        const store = tx.objectStore(FILE_STORE);
        const request = callback(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Browser storage operation failed'));
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('Browser storage transaction failed'));
        };
    });
}

async function putWebFile(record: WebFileRecord): Promise<void> {
    await withFileStore('readwrite', (store) => store.put(record));
}

async function getWebFile(id: number): Promise<WebFileRecord | undefined> {
    return await withFileStore<WebFileRecord | undefined>('readonly', (store) => store.get(id));
}

async function deleteWebFile(id: number): Promise<void> {
    await withFileStore('readwrite', (store) => store.delete(id));
}

async function updateWebFile(id: number, updater: (record: WebFileRecord) => WebFileRecord): Promise<void> {
    const record = await getWebFile(id);
    if (!record) throw new Error('File not found');
    await putWebFile(updater(record));
}

async function trashWebFile(id: number): Promise<void> {
    await updateWebFile(id, (record) => ({ ...record, trashed: true, deletedAt: new Date().toISOString() }));
}

async function getAllWebFiles(): Promise<WebFileRecord[]> {
    return await withFileStore<WebFileRecord[]>('readonly', (store) => store.getAll());
}

async function getWebFiles(folderId: number | null): Promise<TelegramFile[]> {
    const records = await getAllWebFiles();
    return records
        .filter((record) => !record.trashed && (record.folderId ?? null) === folderId)
        .map(toTelegramFile);
}

async function searchWebFiles(query: string): Promise<TelegramFile[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const records = await getAllWebFiles();
    return records
        .filter((record) => !record.trashed)
        .filter((record) => {
            const haystack = [
                record.name,
                record.mime_type,
                record.file_ext,
                record.checksum,
                record.textIndex,
                ...(record.tags || []),
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(normalized);
        })
        .map(toTelegramFile);
}

async function getWebTrashFiles(query: string): Promise<TelegramFile[]> {
    const normalized = query.trim().toLowerCase();
    const records = await getAllWebFiles();
    return records
        .filter((record) => record.trashed)
        .filter((record) => !normalized || record.name.toLowerCase().includes(normalized))
        .sort((a, b) => new Date(b.deletedAt || b.created_at || 0).getTime() - new Date(a.deletedAt || a.created_at || 0).getTime())
        .map(toTelegramFile);
}

async function getWebUploadConflicts(
    name: string,
    size: number,
    folderId: number | null
): Promise<UploadConflictInfo> {
    const normalizedName = name.toLowerCase();
    const records = await getAllWebFiles();
    const conflicts = records
        .filter((record) => !record.trashed)
        .filter((record) => (record.folderId ?? null) === folderId)
        .filter((record) => record.name.toLowerCase() === normalizedName)
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    return {
        count: conflicts.length,
        exactCount: conflicts.filter((record) => record.size === size).length,
        name,
        size,
        folderId,
        items: conflicts.map(toTelegramFile),
    };
}

async function createUniqueWebFileName(preferredName: string, folderId: number | null): Promise<string> {
    const records = await getAllWebFiles();
    const taken = new Set(records
        .filter((record) => !record.trashed)
        .filter((record) => (record.folderId ?? null) === folderId)
        .map((record) => record.name.toLowerCase()));

    if (!taken.has(preferredName.toLowerCase())) return preferredName;

    const dotIndex = preferredName.lastIndexOf('.');
    const hasExtension = dotIndex > 0 && dotIndex < preferredName.length - 1;
    const base = hasExtension ? preferredName.slice(0, dotIndex) : preferredName;
    const ext = hasExtension ? preferredName.slice(dotIndex) : '';
    let index = 1;
    let candidate = `${base} (${index})${ext}`;
    while (taken.has(candidate.toLowerCase())) {
        index++;
        candidate = `${base} (${index})${ext}`;
    }
    return candidate;
}

function normalizeUploadConflictStrategy(strategy?: unknown): UploadConflictStrategy {
    if (strategy === 'skip' || strategy === 'replace' || strategy === 'keep_both') return strategy;
    return 'version';
}

async function moveWebFiles(messageIds: number[], targetFolderId: number | null): Promise<void> {
    for (const id of messageIds) {
        const record = await getWebFile(Number(id));
        if (record) {
            await putWebFile({ ...record, folderId: targetFolderId });
        }
    }
}

async function setWebFileProtection(
    id: number,
    pin: string,
    protectionHint: string | undefined,
    protectedEnabled: boolean
): Promise<void> {
    if (protectedEnabled && !pin.trim()) throw new Error('Protection PIN is required');
    const protectionHash = protectedEnabled ? await sha256Text(pin) : undefined;
    await updateWebFile(id, (record) => {
        if (!protectedEnabled && record.protected && !unlockedWebProtectedItems.has(id)) {
            throw new Error(`File "${record.name}" is protected. Unlock it before removing protection.`);
        }
        return {
            ...record,
            protected: protectedEnabled,
            protectionHash,
            protectionHint: protectedEnabled ? protectionHint?.trim() || undefined : undefined,
        };
    });
    unlockedWebProtectedItems.delete(id);
}

async function unlockWebProtectedFile(id: number, pin: string): Promise<boolean> {
    const record = await getWebFile(id);
    if (!record) throw new Error('File not found');
    if (!record.protected) return true;
    if (!record.protectionHash) throw new Error('Protection PIN metadata missing');
    const enteredHash = await sha256Text(pin);
    if (enteredHash !== record.protectionHash) throw new Error('Invalid protection PIN');
    unlockedWebProtectedItems.add(id);
    return true;
}

async function deleteWebFolder(folderId: number): Promise<void> {
    const records = await getAllWebFiles();
    const recordsToDelete = records.filter((record) => record.folderId === folderId);
    for (const record of recordsToDelete) {
        await trashWebFile(record.id);
    }
}

async function getWebDriveStats(): Promise<DriveStats> {
    const records = await getAllWebFiles();
    const active = records.filter((record) => !record.trashed);
    const trashed = records.filter((record) => record.trashed);
    return {
        totalFiles: records.length,
        activeFiles: active.length,
        trashedFiles: trashed.length,
        duplicateFiles: 0,
        missingFiles: 0,
        totalBytes: records.reduce((sum, record) => sum + record.size, 0),
        activeBytes: active.reduce((sum, record) => sum + record.size, 0),
        trashedBytes: trashed.reduce((sum, record) => sum + record.size, 0),
        indexedTextFiles: records.filter((record) => record.textIndex).length,
        verifiedFiles: records.filter((record) => record.integrityStatus === 'valid').length,
        checksumMismatches: records.filter((record) => record.integrityStatus === 'mismatch').length,
        folders: 0,
        backups: 0,
        trashRetentionDays: 30,
        largestFiles: active.slice().sort((a, b) => b.size - a.size).slice(0, 8).map(toTelegramFile),
        types: [],
        updatedAt: new Date().toISOString(),
    };
}

async function importWebManifest(payload: string): Promise<void> {
    const parsed = JSON.parse(payload) as WebFileRecord[];
    if (!Array.isArray(parsed)) throw new Error('Invalid browser backup');
    for (const record of parsed) {
        if (record?.id && record.blob) await putWebFile(record);
    }
}

async function cleanupWebTrash(deleteAll: boolean): Promise<{ deleted: number; failed: number }> {
    const records = await getAllWebFiles();
    const candidates = records.filter((record) => record.trashed || deleteAll);
    let deleted = 0;
    for (const record of candidates) {
        await deleteWebFile(record.id);
        deleted++;
    }
    return { deleted, failed: 0 };
}

async function sha256Blob(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function sha256Text(text: string): Promise<string> {
    return sha256Blob(new Blob([text], { type: 'text/plain' }));
}
