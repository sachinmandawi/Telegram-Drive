import type { BandwidthStats, TelegramFile, TelegramFolder } from './types';
import { formatBytes } from './utils';
import {
    telegramCheckPassword,
    telegramConnect,
    telegramCreateFolder,
    telegramDeleteFolder,
    telegramDeleteFile,
    telegramDownloadFile,
    telegramFlushManifest,
    telegramGetFiles,
    telegramGetFolders,
    telegramGetObjectUrl,
    telegramGetStarredFiles,
    telegramGetTrashFiles,
    telegramLogout,
    telegramMoveFiles,
    telegramPermanentlyDeleteFile,
    telegramRepairManifest,
    telegramRequestCode,
    telegramRestoreFile,
    telegramSignIn,
    telegramSetFileTags,
    telegramToggleStarFile,
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
};

const DB_NAME = 'telegram-drive-web';
const DB_VERSION = 1;
const FILE_STORE = 'files';
const STORE_PREFIX = 'telegram-drive-store:';
const NEXT_ID_KEY = 'telegram-drive-web-next-id';
const BANDWIDTH_KEY = 'telegram-drive-web-bandwidth';

export const isTauriRuntime = () =>
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const isSavedMessagesDefaultStorage = () =>
    import.meta.env.VITE_DEFAULT_STORAGE === 'saved_messages';

export const telegramApiDefaults = () => ({
    apiId: import.meta.env.VITE_TELEGRAM_API_ID || '',
    apiHash: import.meta.env.VITE_TELEGRAM_API_HASH || '',
});

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
        return await invoke<T>(command, args);
    }

    return await invokeBrowserCommand<T>(command, args);
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
    onProgress?: (percent: number) => void
): Promise<TelegramFile> {
    if (isSavedMessagesDefaultStorage()) {
        return await telegramUploadFile(file, folderId, onProgress);
    }
    ensureBrowserMode();

    const id = nextWebId();
    onProgress?.(15);

    const record: WebFileRecord = {
        id,
        folderId,
        name: file.name,
        size: file.size,
        created_at: new Date(file.lastModified || Date.now()).toLocaleString(),
        icon_type: 'file',
        mime_type: file.type || undefined,
        file_ext: getExtension(file.name),
        blob: file,
    };

    await putWebFile(record);
    addBandwidth('up_bytes', file.size);
    onProgress?.(100);
    return toTelegramFile(record);
}

export async function downloadBrowserFile(messageId: number, filename?: string): Promise<void> {
    if (isSavedMessagesDefaultStorage()) {
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
            await deleteWebFile(Number(args.messageId));
            return true as T;
        case 'cmd_move_files':
            await moveWebFiles(
                (args.messageIds as number[] | undefined) || [],
                (args.targetFolderId as number | null | undefined) ?? null
            );
            return true as T;
        case 'cmd_search_global':
            return await searchWebFiles(String(args.query || '')) as T;
        case 'cmd_get_preview':
        case 'cmd_get_thumbnail':
            return await getBrowserFileObjectUrl(Number(args.messageId)) as T;
        case 'cmd_download_file':
            await downloadBrowserFile(Number(args.messageId));
            return 'Download started' as T;
        case 'cmd_get_stream_token':
            return 'browser' as T;
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
        case 'cmd_get_starred_files':
            return await telegramGetStarredFiles(String(args.query || '')) as T;
        case 'cmd_get_trash_files':
            return await telegramGetTrashFiles(String(args.query || '')) as T;
        case 'cmd_search_global':
            return await telegramGetFiles(undefined, String(args.query || '')) as T;
        case 'cmd_delete_file':
            return await telegramDeleteFile(Number(args.messageId)) as T;
        case 'cmd_restore_file':
            return await telegramRestoreFile(Number(args.messageId)) as T;
        case 'cmd_permanent_delete_file':
            return await telegramPermanentlyDeleteFile(Number(args.messageId)) as T;
        case 'cmd_toggle_star':
            return await telegramToggleStarFile(
                Number(args.messageId),
                typeof args.starred === 'boolean' ? args.starred : undefined
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
        case 'cmd_scan_folders':
            return await telegramGetFolders(true) as T;
        case 'cmd_repair_manifest':
            return await telegramRepairManifest() as T;
        case 'cmd_flush_manifest':
            return await telegramFlushManifest() as T;
        case 'cmd_create_folder':
            return await telegramCreateFolder(
                String(args.name || 'New Folder'),
                typeof args.parentId === 'number' ? args.parentId : null
            ) as T;
        case 'cmd_delete_folder':
            return await telegramDeleteFolder(Number(args.folderId)) as T;
        case 'cmd_move_files':
            return await telegramMoveFiles(
                (args.messageIds as number[] | undefined) || [],
                (args.targetFolderId as number | null | undefined) ?? null
            ) as T;
        case 'cmd_get_stream_token':
            return 'browser-telegram' as T;
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

async function getAllWebFiles(): Promise<WebFileRecord[]> {
    return await withFileStore<WebFileRecord[]>('readonly', (store) => store.getAll());
}

async function getWebFiles(folderId: number | null): Promise<TelegramFile[]> {
    const records = await getAllWebFiles();
    return records
        .filter((record) => (record.folderId ?? null) === folderId)
        .map(toTelegramFile);
}

async function searchWebFiles(query: string): Promise<TelegramFile[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const records = await getAllWebFiles();
    return records
        .filter((record) => record.name.toLowerCase().includes(normalized))
        .map(toTelegramFile);
}

async function moveWebFiles(messageIds: number[], targetFolderId: number | null): Promise<void> {
    for (const id of messageIds) {
        const record = await getWebFile(Number(id));
        if (record) {
            await putWebFile({ ...record, folderId: targetFolderId });
        }
    }
}

async function deleteWebFolder(folderId: number): Promise<void> {
    const records = await getAllWebFiles();
    const recordsToDelete = records.filter((record) => record.folderId === folderId);
    for (const record of recordsToDelete) {
        await deleteWebFile(record.id);
    }
}
