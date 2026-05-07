import type {
    DriveStats,
    IntegrityResult,
    OfflineCacheStats,
    TelegramAccountInfo,
    TelegramFile,
    TelegramFolder,
} from './types';
import { formatBytes, isAudioFile, isImageFile, isMediaFile, isPdfFile, isTextPreviewFile, isVideoFile } from './utils';

type TelegramClientInstance = import('telegram').TelegramClient;
type TelegramMessage = import('telegram/tl').Api.Message;

type PendingAuth = {
    phone: string;
    phoneCodeHash: string;
    apiId: number;
    apiHash: string;
};

const SESSION_KEY = 'telegram-drive-gramjs-session';
const PENDING_AUTH_KEY = 'telegram-drive-gramjs-pending-auth';
const BANDWIDTH_KEY = 'telegram-drive-web-bandwidth';
const STORE_PREFIX = 'telegram-drive-store:';
const FOLDER_MAP_KEY = 'telegram-drive-telegram-folder-map';
const NEXT_FOLDER_ID_KEY = 'telegram-drive-next-virtual-folder-id';
const MANIFEST_CACHE_KEY = 'telegram-drive-telegram-manifest-cache';
const FILE_LIFECYCLE_KEY = 'telegram-drive-local-file-lifecycle';
const DRIVE_ID_KEY = 'telegram-drive-persistent-drive-id';
const ACTIVE_ACCOUNT_KEY = 'telegram-drive-active-account';
const ACCOUNT_REGISTRY_KEY = 'telegram-drive-account-registry';
const OFFLINE_CACHE_DB_NAME = 'telegram-drive-offline-cache';
const OFFLINE_CACHE_DB_VERSION = 1;
const OFFLINE_CACHE_STORE = 'blobs';
const OFFLINE_CACHE_INDEX_KEY = 'telegram-drive-offline-cache-index';
const OFFLINE_CACHE_MAX_ITEMS = 80;
const OFFLINE_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const MANIFEST_MARKER = '[telegram-drive-manifest-v1]';
const MANIFEST_FILENAME = '.telegram-drive-manifest.json';
const MANIFEST_BACKUP_COUNT = 5;
const MANIFEST_EVENT_LIMIT = 2000;
const TELEGRAM_UPLOAD_MIN_INTERVAL_MS = 1200;
const TELEGRAM_UPLOAD_MAX_ATTEMPTS = 4;

type DriveEventType =
    | 'folder_created'
    | 'folder_deleted'
    | 'file_uploaded'
    | 'file_moved'
    | 'file_trashed'
    | 'file_deleted'
    | 'file_restored'
    | 'file_starred'
    | 'file_tagged'
    | 'file_verified'
    | 'text_indexed'
    | 'duplicate_detected'
    | 'manifest_repaired'
    | 'manifest_imported'
    | 'trash_cleaned'
    | 'account_switched'
    | 'cache_cleared';

type DriveFileRecord = {
    messageId: number;
    folderId: number | null;
    name: string;
    size: number;
    createdAt?: string;
    updatedAt?: string;
    mimeType?: string;
    tags?: string[];
    starred?: boolean;
    trashed?: boolean;
    deletedAt?: string;
    missing?: boolean;
    checksum?: string;
    originalPath?: string;
    versionGroup?: string;
    version?: number;
    duplicateOf?: number;
    textIndex?: string;
    textIndexedAt?: string;
    ocrText?: string;
    ocrIndexedAt?: string;
    checksumVerifiedAt?: string;
    integrityStatus?: 'unknown' | 'valid' | 'mismatch';
};

type DriveEvent = {
    id: string;
    type: DriveEventType;
    at: string;
    payload: Record<string, unknown>;
};

type DriveManifestSettings = {
    trashRetentionDays: number;
    duplicateStrategy: 'version';
};

type DriveManifestBackup = {
    at: string;
    messageId?: number;
    size?: number;
};

type StoredAccount = {
    id: string;
    label: string;
    apiId?: number;
    lastUsedAt: string;
};

type OfflineCacheIndexEntry = {
    messageId: number;
    name: string;
    bytes: number;
    mimeType?: string;
    checksum?: string;
    updatedAt: string;
    lastAccessedAt: string;
};

type DriveManifest = {
    version: 2;
    schemaVersion: 2;
    driveId: string;
    updatedAt: string;
    snapshotSeq: number;
    folders: TelegramFolder[];
    fileFolders: Record<string, number | null>;
    files: Record<string, DriveFileRecord>;
    events: DriveEvent[];
    backups: DriveManifestBackup[];
    settings: DriveManifestSettings;
};

type LocalFileLifecycle = {
    messageId: number;
    state: 'trashed' | 'deleted';
    updatedAt: string;
    deletedAt?: string;
    record?: DriveFileRecord;
};

let clientPromise: Promise<TelegramClientInstance> | null = null;
let clientCredentials: { apiId: number; apiHash: string } | null = null;
let manifestCache: DriveManifest | null = null;
let pendingRemoteManifest: DriveManifest | null = null;
let remoteManifestTimer: ReturnType<typeof setTimeout> | null = null;
let remoteManifestWrite: Promise<void> = Promise.resolve();
let nextTelegramUploadAt = 0;

function getActiveAccountId(): string {
    return localStorage.getItem(ACTIVE_ACCOUNT_KEY) || 'default';
}

function scopedKey(key: string, accountId = getActiveAccountId()): string {
    return `${key}:${accountId}`;
}

function getCurrentSessionKey(): string {
    return scopedKey(SESSION_KEY);
}

export async function telegramConnect(apiId?: number): Promise<boolean> {
    const client = await getTelegramClient(apiId);
    const authorized = await client.checkAuthorization();
    if (!authorized) throw new Error('Telegram login required');
    await client.getMe();
    return true;
}

export async function telegramRequestCode(phone: string, apiId: number, apiHash: string): Promise<string> {
    const client = await getTelegramClient(apiId, apiHash, true);
    const sent = await client.sendCode({ apiId, apiHash }, phone);

    writePendingAuth({
        phone,
        phoneCodeHash: sent.phoneCodeHash,
        apiId,
        apiHash,
    });
    writeConfig({ apiId: String(apiId), apiHash });

    return 'code_sent';
}

export async function telegramSignIn(code: string): Promise<{ success: boolean; next_step?: string }> {
    const pending = readPendingAuth();
    if (!pending) throw new Error('No pending Telegram login. Request a code again.');

    const client = await getTelegramClient(pending.apiId, pending.apiHash);
    const { Api } = await import('telegram');

    try {
        const result = await client.invoke(new Api.auth.SignIn({
            phoneNumber: pending.phone,
            phoneCodeHash: pending.phoneCodeHash,
            phoneCode: code.replace(/\s+/g, ''),
        }));

        if (result instanceof Api.auth.AuthorizationSignUpRequired) {
            throw new Error('This phone number is not registered on Telegram.');
        }

        saveTelegramSession(client, pending);
        clearPendingAuth();
        markAuthComplete();
        return { success: true, next_step: 'dashboard' };
    } catch (err) {
        if (getTelegramErrorMessage(err).includes('SESSION_PASSWORD_NEEDED')) {
            return { success: false, next_step: 'password' };
        }
        throw err;
    }
}

export async function telegramCheckPassword(password: string): Promise<{ success: boolean; next_step?: string }> {
    const pending = readPendingAuth();
    if (!pending) throw new Error('No pending Telegram login. Request a code again.');

    const client = await getTelegramClient(pending.apiId, pending.apiHash);
    const { Api } = await import('telegram');
    const { computeCheck } = await import('telegram/Password');
    const passwordState = await client.invoke(new Api.account.GetPassword());
    const passwordCheck = await computeCheck(passwordState, password);
    const normalizedPasswordCheck = new Api.InputCheckPasswordSRP({
        srpId: passwordCheck.srpId,
        A: await normalizeTelegramBytes(passwordCheck.A),
        M1: await normalizeTelegramBytes(passwordCheck.M1),
    });

    await client.invoke(new Api.auth.CheckPassword({
        password: normalizedPasswordCheck,
    }));

    saveTelegramSession(client, pending);
    clearPendingAuth();
    markAuthComplete();
    return { success: true, next_step: 'dashboard' };
}

export async function telegramLogout(): Promise<boolean> {
    if (clientPromise) {
        try {
            const client = await clientPromise;
            const { Api } = await import('telegram');
            await client.invoke(new Api.auth.LogOut());
            await client.disconnect();
        } catch {
            // Best effort logout; local session is cleared below.
        }
    }

    clientPromise = null;
    clientCredentials = null;
    localStorage.removeItem(getCurrentSessionKey());
    if (getActiveAccountId() === 'default') {
        localStorage.removeItem(SESSION_KEY);
    }
    manifestCache = null;
    clearPendingAuth();
    writeConfig({ apiId: undefined, apiHash: undefined, authComplete: false });
    return true;
}

export async function telegramGetFolders(forceRemote = false): Promise<TelegramFolder[]> {
    const manifest = await getDriveManifest(forceRemote);
    return manifest.folders;
}

export async function telegramFlushManifest(): Promise<boolean> {
    await flushRemoteManifest();
    return true;
}

export async function telegramCreateFolder(name: string, parentId: number | null = null): Promise<TelegramFolder> {
    const manifest = await getDriveManifest();
    const folder: TelegramFolder = {
        id: createVirtualFolderId(),
        name,
    };

    if (parentId !== null) folder.parent_id = parentId;
    manifest.folders.push(folder);
    appendManifestEvent(manifest, 'folder_created', { folderId: folder.id, name, parentId });
    await saveDriveManifest(manifest, 'debounced');
    return folder;
}

export async function telegramDeleteFolder(folderId: number): Promise<boolean> {
    const manifest = await getDriveManifest();
    manifest.folders = manifest.folders.filter((folder) => folder.id !== folderId);
    for (const messageId of Object.keys(manifest.fileFolders)) {
        if (manifest.fileFolders[messageId] === folderId) {
            manifest.fileFolders[messageId] = null;
        }
        if (manifest.files[messageId]?.folderId === folderId) {
            manifest.files[messageId] = {
                ...manifest.files[messageId],
                folderId: null,
                updatedAt: new Date().toISOString(),
            };
        }
    }
    appendManifestEvent(manifest, 'folder_deleted', { folderId });
    await saveDriveManifest(manifest, 'debounced');
    return true;
}

export async function telegramMoveFiles(messageIds: number[], targetFolderId: number | null): Promise<boolean> {
    const manifest = await getDriveManifest();
    const updatedAt = new Date().toISOString();
    for (const messageId of messageIds) {
        manifest.fileFolders[String(messageId)] = targetFolderId;
        if (manifest.files[String(messageId)]) {
            manifest.files[String(messageId)] = {
                ...manifest.files[String(messageId)],
                folderId: targetFolderId,
                updatedAt,
            };
        }
    }
    appendManifestEvent(manifest, 'file_moved', { messageIds, targetFolderId });
    await saveDriveManifest(manifest, 'debounced');
    return true;
}

export async function telegramGetFiles(folderId: number | null | undefined = null, query?: string): Promise<TelegramFile[]> {
    const client = await authorizedTelegramClient();
    const messages = await getSavedMessages(client, query);
    const manifest = await getDriveManifest();
    let indexed = 0;
    const files: TelegramFile[] = [];

    for (const message of messages) {
        if (!message?.media || !message.file || isDriveManifestMessage(message)) continue;
        const wasIndexed = Boolean(manifest.files[String(message.id)]);
        const record = ensureManifestFileRecord(manifest, message);
        if (!wasIndexed) indexed++;
        if (record.missing) {
            record.missing = false;
            record.updatedAt = new Date().toISOString();
            indexed++;
        }
        if (record.trashed) continue;
        if (folderId !== undefined && (record.folderId ?? null) !== folderId) continue;
        files.push(toTelegramFile(message, manifest));
    }

    if (indexed > 0) {
        appendManifestEvent(manifest, 'manifest_repaired', { source: 'lazy_index', indexed });
        await saveDriveManifest(manifest, 'debounced');
    }

    return files;
}

export async function telegramSearchFiles(query: string): Promise<TelegramFile[]> {
    const client = await authorizedTelegramClient();
    const manifest = await getDriveManifest();
    const messages = await getSavedMessages(client);
    const byMessageId = new Map<number, TelegramMessage>();
    let indexed = 0;

    for (const message of messages) {
        if (!message?.media || !message.file || isDriveManifestMessage(message)) continue;
        byMessageId.set(message.id, message);
        const wasIndexed = Boolean(manifest.files[String(message.id)]);
        ensureManifestFileRecord(manifest, message);
        if (!wasIndexed) indexed++;
    }

    if (indexed > 0) {
        appendManifestEvent(manifest, 'manifest_repaired', { source: 'smart_search_index', indexed });
        await saveDriveManifest(manifest, 'debounced');
    }

    const filters = parseSmartSearchQuery(query);
    return Object.values(manifest.files)
        .filter((record) => {
            if (filters.trashed === undefined && record.trashed) return false;
            if (record.missing && !record.trashed) return false;
            return matchesSmartSearch(record, filters);
        })
        .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
        .map((record) => {
            const message = byMessageId.get(record.messageId);
            return message ? toTelegramFile(message, manifest) : recordToTelegramFile(record);
        });
}

export async function telegramGetStarredFiles(query?: string): Promise<TelegramFile[]> {
    return await telegramGetFilesByRecord((record) => Boolean(record.starred) && !record.trashed && !record.missing, query);
}

export async function telegramGetTrashFiles(query?: string): Promise<TelegramFile[]> {
    return await telegramGetFilesByRecord((record) => Boolean(record.trashed), query);
}

export async function telegramDeleteFile(messageId: number): Promise<boolean> {
    const manifest = await getDriveManifest();
    const key = String(messageId);
    const message = await getTelegramMessage(messageId).catch(() => null);
    if (message?.media && message.file) {
        ensureManifestFileRecord(manifest, message);
    }
    const existing = manifest.files[key];
    const deletedAt = new Date().toISOString();
    const record = {
        ...(existing || {
            messageId,
            folderId: manifest.fileFolders[key] ?? null,
            name: `Telegram-file-${messageId}`,
            size: 0,
        }),
        trashed: true,
        deletedAt,
        missing: false,
        updatedAt: deletedAt,
    };
    manifest.files[key] = record;
    manifest.fileFolders[key] = manifest.files[key].folderId ?? null;
    rememberLocalFileLifecycle(record, 'trashed');
    appendManifestEvent(manifest, 'file_trashed', createFileLifecyclePayload(record));
    await saveDriveManifest(manifest, 'debounced');
    return true;
}

export async function telegramRestoreFile(messageId: number): Promise<boolean> {
    const manifest = await getDriveManifest();
    const key = String(messageId);
    const existing = manifest.files[key];
    if (!existing) throw new Error('File metadata not found');

    manifest.files[key] = {
        ...existing,
        trashed: false,
        deletedAt: undefined,
        missing: false,
        updatedAt: new Date().toISOString(),
    };
    manifest.fileFolders[key] = manifest.files[key].folderId ?? null;
    forgetLocalFileLifecycle(messageId);
    appendManifestEvent(manifest, 'file_restored', { messageId });
    await saveDriveManifest(manifest, 'debounced');
    return true;
}

export async function telegramPermanentlyDeleteFile(messageId: number): Promise<boolean> {
    const client = await authorizedTelegramClient();
    await client.deleteMessages('me', [messageId], { revoke: true });
    const manifest = await getDriveManifest();
    const key = String(messageId);
    const record = manifest.files[key] || readLocalFileLifecycle()[key]?.record;
    if (record) {
        rememberLocalFileLifecycle(record, 'deleted');
    }
    delete manifest.fileFolders[key];
    delete manifest.files[key];
    appendManifestEvent(manifest, 'file_deleted', { messageId });
    await saveDriveManifest(manifest, 'debounced');
    return true;
}

export async function telegramToggleStarFile(messageId: number, starred?: boolean): Promise<boolean> {
    const manifest = await getDriveManifest();
    const key = String(messageId);
    const record = manifest.files[key];
    if (!record) throw new Error('File metadata not found');

    manifest.files[key] = {
        ...record,
        starred: starred ?? !record.starred,
        updatedAt: new Date().toISOString(),
    };
    appendManifestEvent(manifest, 'file_starred', { messageId, starred: manifest.files[key].starred });
    await saveDriveManifest(manifest, 'debounced');
    return true;
}

export async function telegramSetFileTags(messageId: number, tags: string[]): Promise<boolean> {
    const manifest = await getDriveManifest();
    const key = String(messageId);
    const record = manifest.files[key];
    if (!record) throw new Error('File metadata not found');

    manifest.files[key] = {
        ...record,
        tags: normalizeTags(tags),
        updatedAt: new Date().toISOString(),
    };
    appendManifestEvent(manifest, 'file_tagged', { messageId, tags: manifest.files[key].tags || [] });
    await saveDriveManifest(manifest, 'debounced');
    return true;
}

export async function telegramUploadFile(
    file: File,
    folderId: number | null,
    onProgress?: (percent: number) => void
): Promise<TelegramFile> {
    const client = await authorizedTelegramClient();
    const manifest = await getDriveManifest();
    const duplicates = findActiveDuplicates(manifest, file.name, file.size, folderId);
    const versionGroup = duplicates[0]?.versionGroup || createVersionGroup(file.name);
    const nextVersion = duplicates.length > 0
        ? Math.max(...duplicates.map((record) => record.version || 1)) + 1
        : 1;
    const updatedAt = new Date().toISOString();
    const checksum = await sha256Blob(file);
    const originalPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

    for (const duplicate of duplicates) {
        if (!duplicate.versionGroup) duplicate.versionGroup = versionGroup;
        if (!duplicate.version) duplicate.version = 1;
        duplicate.updatedAt = updatedAt;
    }

    const uploadFile = file;

    const message = await sendTelegramFileWithRetry(client, 'me', {
        file: uploadFile,
        fileSize: file.size,
        forceDocument: true,
        workers: 1,
        progressCallback: (progress) => {
            const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
            onProgress?.(percent);
        },
    });

    addBandwidth('up_bytes', file.size);
    manifest.fileFolders[String(message.id)] = folderId;
    manifest.files[String(message.id)] = {
        messageId: message.id,
        folderId,
        name: file.name,
        size: file.size,
        createdAt: updatedAt,
        updatedAt,
        mimeType: file.type || message.file?.mimeType || undefined,
        checksum,
        originalPath,
        integrityStatus: 'unknown',
        versionGroup: duplicates.length > 0 ? versionGroup : undefined,
        version: duplicates.length > 0 ? nextVersion : undefined,
        duplicateOf: duplicates[0]?.messageId,
    };
    appendManifestEvent(manifest, 'file_uploaded', {
        messageId: message.id,
        folderId,
        name: file.name,
        size: file.size,
        checksum,
        version: duplicates.length > 0 ? nextVersion : undefined,
    });
    if (duplicates.length > 0) {
        appendManifestEvent(manifest, 'duplicate_detected', {
            messageId: message.id,
            duplicateOf: duplicates[0].messageId,
            count: duplicates.length,
        });
    }
    await saveDriveManifest(manifest, 'debounced');
    onProgress?.(100);
    return toTelegramFile(message, manifest);
}

export async function telegramDownloadFile(messageId: number, filename?: string): Promise<void> {
    const { blob, name } = await telegramDownloadBlob(messageId);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function telegramGetObjectUrl(messageId: number): Promise<string> {
    const { blob } = await telegramDownloadBlob(messageId);
    return URL.createObjectURL(blob);
}

export async function telegramVerifyFile(messageId: number): Promise<IntegrityResult> {
    const manifest = await getDriveManifest();
    const record = manifest.files[String(messageId)];
    if (!record?.checksum) {
        throw new Error('No checksum is stored for this file yet.');
    }

    const message = await getTelegramMessage(messageId);
    const client = await authorizedTelegramClient();
    const bytes = await downloadMessageBytes(client, message);
    const blob = new Blob([bytes], { type: message.file?.mimeType || 'application/octet-stream' });
    const checksum = await sha256Blob(blob);
    const valid = checksum === record.checksum;

    manifest.files[String(messageId)] = {
        ...record,
        checksumVerifiedAt: new Date().toISOString(),
        integrityStatus: valid ? 'valid' : 'mismatch',
        updatedAt: new Date().toISOString(),
    };
    appendManifestEvent(manifest, 'file_verified', { messageId, valid, checksum });
    await saveDriveManifest(manifest, 'debounced');

    return {
        messageId,
        checksum,
        expectedChecksum: record.checksum,
        valid,
    };
}

export async function telegramIndexFileText(messageId: number, text: string, source: 'preview' | 'ocr' = 'preview'): Promise<boolean> {
    const manifest = await getDriveManifest();
    const key = String(messageId);
    const record = manifest.files[key];
    if (!record) throw new Error('File metadata not found');

    const normalized = normalizeSearchText(text).slice(0, 120_000);
    manifest.files[key] = {
        ...record,
        ...(source === 'ocr'
            ? { ocrText: normalized, ocrIndexedAt: new Date().toISOString() }
            : { textIndex: normalized, textIndexedAt: new Date().toISOString() }),
        updatedAt: new Date().toISOString(),
    };
    appendManifestEvent(manifest, 'text_indexed', { messageId, source, bytes: normalized.length });
    await saveDriveManifest(manifest, 'debounced');
    return true;
}

export async function telegramGetDriveStats(): Promise<DriveStats> {
    const manifest = await getDriveManifest();
    return buildDriveStats(manifest);
}

export async function telegramExportManifest(): Promise<{ filename: string; payload: string }> {
    const manifest = await getDriveManifest();
    return {
        filename: `telegram-drive-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        payload: JSON.stringify(manifest, null, 2),
    };
}

export async function telegramImportManifest(payload: string): Promise<DriveStats> {
    const imported = parseManifestJson(payload);
    if (!imported) throw new Error('Invalid Telegram Drive manifest backup.');

    const current = await getDriveManifest();
    const merged = mergeManifests(imported, current);
    appendManifestEvent(merged, 'manifest_imported', {
        importedFiles: Object.keys(imported.files || {}).length,
        importedFolders: imported.folders.length,
    });
    await saveDriveManifest(merged, 'immediate');
    return buildDriveStats(merged);
}

export async function telegramCleanupTrash(days?: number, deleteAll = false): Promise<{ deleted: number; failed: number }> {
    const client = await authorizedTelegramClient();
    const manifest = await getDriveManifest();
    const retentionDays = Number.isFinite(days) ? Number(days) : manifest.settings.trashRetentionDays;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const candidates = Object.values(manifest.files).filter((record) => {
        if (!record.trashed) return false;
        if (deleteAll) return true;
        return new Date(record.deletedAt || record.updatedAt || 0).getTime() <= cutoff;
    });

    let deleted = 0;
    let failed = 0;
    for (const record of candidates) {
        try {
            await client.deleteMessages('me', [record.messageId], { revoke: true });
            rememberLocalFileLifecycle(record, 'deleted');
            delete manifest.fileFolders[String(record.messageId)];
            delete manifest.files[String(record.messageId)];
            await deleteOfflineCachedBlob(record.messageId).catch(() => undefined);
            deleted++;
        } catch {
            failed++;
        }
    }

    appendManifestEvent(manifest, 'trash_cleaned', { deleted, failed, retentionDays, deleteAll });
    await saveDriveManifest(manifest, 'debounced');
    return { deleted, failed };
}

export async function telegramSetTrashRetention(days: number): Promise<boolean> {
    const manifest = await getDriveManifest();
    manifest.settings.trashRetentionDays = Math.max(1, Math.min(365, Math.round(days)));
    await saveDriveManifest(manifest, 'debounced');
    return true;
}

export async function telegramGetOfflineCacheStats(): Promise<OfflineCacheStats> {
    const index = readOfflineCacheIndex();
    const bytes = Object.values(index).reduce((sum, entry) => sum + entry.bytes, 0);
    return {
        items: Object.keys(index).length,
        bytes,
        maxItems: OFFLINE_CACHE_MAX_ITEMS,
        maxBytes: OFFLINE_CACHE_MAX_BYTES,
    };
}

export async function telegramClearOfflineCache(): Promise<OfflineCacheStats> {
    const index = readOfflineCacheIndex();
    for (const key of Object.keys(index)) {
        await deleteOfflineCachedBlob(Number(key)).catch(() => undefined);
    }
    const manifest = await getDriveManifest();
    appendManifestEvent(manifest, 'cache_cleared', { items: Object.keys(index).length });
    await saveDriveManifest(manifest, 'debounced');
    return telegramGetOfflineCacheStats();
}

export async function telegramListAccounts(): Promise<TelegramAccountInfo[]> {
    const activeId = getActiveAccountId();
    return readAccountRegistry().map((account) => ({
        ...account,
        active: account.id === activeId,
    }));
}

export async function telegramSwitchAccount(accountId: string): Promise<boolean> {
    const accounts = readAccountRegistry();
    const account = accounts.find((item) => item.id === accountId);
    if (!account) throw new Error('Account not found');

    localStorage.setItem(ACTIVE_ACCOUNT_KEY, account.id);
    writeAccountRegistry(accounts.map((item) => item.id === account.id
        ? { ...item, lastUsedAt: new Date().toISOString() }
        : item));
    clientPromise = null;
    clientCredentials = null;
    manifestCache = null;
    writeConfig({ apiId: account.apiId ? String(account.apiId) : undefined, authComplete: true, activeFolderId: null });
    return true;
}

export async function telegramPrepareAddAccount(): Promise<boolean> {
    clientPromise = null;
    clientCredentials = null;
    manifestCache = null;
    writeConfig({ authComplete: false, activeFolderId: null });
    return true;
}

export async function telegramRepairManifest(): Promise<{
    indexed: number;
    refreshed: number;
    missing: number;
    folders: number;
    files: number;
    snapshotsKept: number;
}> {
    const client = await authorizedTelegramClient();
    const messages = await getSavedMessages(client);
    const manifest = await getDriveManifest(true);
    const localLifecycle = readLocalFileLifecycle();
    const seen = new Set<string>();
    let indexed = 0;
    let refreshed = 0;
    let missing = 0;

    for (const message of messages) {
        if (!message?.media || !message.file || isDriveManifestMessage(message)) continue;
        const key = String(message.id);
        if (localLifecycle[key]?.state === 'deleted') continue;
        seen.add(key);
        const before = manifest.files[key];
        const record = createFileRecordFromMessage(message, manifest);
        manifest.files[key] = {
            ...before,
            ...record,
            folderId: before?.folderId ?? manifest.fileFolders[key] ?? null,
            tags: before?.tags,
            starred: before?.starred,
            trashed: before?.trashed,
            deletedAt: before?.deletedAt,
            checksum: before?.checksum,
            originalPath: before?.originalPath,
            versionGroup: before?.versionGroup,
            version: before?.version,
            duplicateOf: before?.duplicateOf,
            textIndex: before?.textIndex,
            textIndexedAt: before?.textIndexedAt,
            ocrText: before?.ocrText,
            ocrIndexedAt: before?.ocrIndexedAt,
            checksumVerifiedAt: before?.checksumVerifiedAt,
            integrityStatus: before?.integrityStatus,
            missing: false,
            updatedAt: new Date().toISOString(),
        };
        manifest.fileFolders[key] = manifest.files[key].folderId ?? null;
        if (before) refreshed++;
        else indexed++;
    }

    for (const [key, record] of Object.entries(manifest.files)) {
        if (!seen.has(key) && !record.missing) {
            manifest.files[key] = {
                ...record,
                missing: true,
                updatedAt: new Date().toISOString(),
            };
            missing++;
        }
    }

    appendManifestEvent(manifest, 'manifest_repaired', { indexed, refreshed, missing });
    await saveDriveManifest(manifest, 'debounced');

    return {
        indexed,
        refreshed,
        missing,
        folders: manifest.folders.length,
        files: Object.keys(manifest.files).length,
        snapshotsKept: MANIFEST_BACKUP_COUNT,
    };
}

async function telegramGetFilesByRecord(
    predicate: (record: DriveFileRecord) => boolean,
    query?: string
): Promise<TelegramFile[]> {
    const manifest = await getDriveManifest();
    const filters = parseSmartSearchQuery(query || '');

    return Object.values(manifest.files)
        .filter(predicate)
        .filter((record) => !query || matchesSmartSearch(record, filters))
        .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
        .map(recordToTelegramFile);
}

async function getSavedMessages(client: TelegramClientInstance, query?: string): Promise<TelegramMessage[]> {
    const messages: TelegramMessage[] = [];
    const iterator = client.iterMessages('me', {
        limit: query ? 500 : undefined,
        search: query || undefined,
    });

    for await (const message of iterator) {
        if (message) messages.push(message as TelegramMessage);
    }

    return messages;
}

async function telegramDownloadBlob(messageId: number): Promise<{ blob: Blob; name: string }> {
    const client = await authorizedTelegramClient();
    const message = await getTelegramMessage(messageId);
    const manifest = await getDriveManifest();
    const record = manifest.files[String(messageId)];
    const cached = await getOfflineCachedBlob(messageId);
    if (cached) {
        if (record?.checksum) {
            const cachedChecksum = await sha256Blob(cached.blob);
            const cachedValid = cachedChecksum === record.checksum;
            manifest.files[String(messageId)] = {
                ...record,
                checksumVerifiedAt: new Date().toISOString(),
                integrityStatus: cachedValid ? 'valid' : 'mismatch',
                updatedAt: new Date().toISOString(),
            };
            appendManifestEvent(manifest, 'file_verified', { messageId, valid: cachedValid, checksum: cachedChecksum, source: 'cache' });
            await saveDriveManifest(manifest, 'debounced');
            if (cachedValid) {
                addBandwidth('down_bytes', 0);
                return {
                    blob: cached.blob,
                    name: cached.name || record.name || getMessageFilename(message),
                };
            }
            await deleteOfflineCachedBlob(messageId).catch(() => undefined);
        } else {
            addBandwidth('down_bytes', 0);
            return {
                blob: cached.blob,
                name: cached.name || record?.name || getMessageFilename(message),
            };
        }
    }

    const bytes = await downloadMessageBytes(client, message, {
        progressCallback: (downloaded, total) => {
            const totalNumber = sizeToNumber(total);
            if (totalNumber > 0) {
                sizeToNumber(downloaded);
            }
        },
    });

    const file = message.file;
    const blob = new Blob([bytes], { type: file?.mimeType || 'application/octet-stream' });
    addBandwidth('down_bytes', blob.size);

    if (record?.checksum) {
        const actual = await sha256Blob(blob);
        const valid = actual === record.checksum;
        manifest.files[String(messageId)] = {
            ...record,
            checksumVerifiedAt: new Date().toISOString(),
            integrityStatus: valid ? 'valid' : 'mismatch',
            updatedAt: new Date().toISOString(),
        };
        appendManifestEvent(manifest, 'file_verified', { messageId, valid, checksum: actual });
        await saveDriveManifest(manifest, 'debounced');
        if (!valid) {
            throw new Error(`Checksum mismatch for ${record.name}`);
        }
    }

    await putOfflineCachedBlob({
        messageId,
        name: record?.name || getMessageFilename(message),
        blob,
        mimeType: file?.mimeType || undefined,
        checksum: record?.checksum,
    }).catch(() => undefined);

    return {
        blob,
        name: record?.name || getMessageFilename(message),
    };
}

async function downloadMessageBytes(
    client: TelegramClientInstance,
    message: TelegramMessage,
    options: { progressCallback?: (downloaded: unknown, total: unknown) => void } = {}
): Promise<Uint8Array> {
    const result = await client.downloadMedia(message, options);
    if (!result || typeof result === 'string') throw new Error('Download failed');
    if (result instanceof Uint8Array) return result;
    return new Uint8Array(result);
}

async function getTelegramMessage(messageId: number): Promise<TelegramMessage> {
    const client = await authorizedTelegramClient();
    const messages = await client.getMessages('me', { ids: messageId });
    const message = Array.from(messages)[0];

    if (!message) throw new Error('Telegram message not found');
    return message;
}

async function getDriveManifest(forceRemote = false): Promise<DriveManifest> {
    if (manifestCache && !forceRemote) return cloneManifest(manifestCache);

    if (forceRemote) {
        await flushRemoteManifest().catch(() => undefined);
    }

    const remote = await loadRemoteManifest();
    const local = loadLocalManifest();
    const manifest = remote ? mergeManifests(remote, local) : local;
    const shouldWriteRemote = !remote
        ? hasManifestData(local)
        : JSON.stringify(normalizeManifest(remote)) !== JSON.stringify(normalizeManifest(manifest));

    manifestCache = applyLocalFileLifecycleToManifest(normalizeManifest(manifest));
    persistManifestLocally(manifestCache);

    if (shouldWriteRemote) {
        queueRemoteManifestWrite(manifestCache, remote ? 800 : 1500);
    }

    return cloneManifest(manifestCache);
}

async function saveDriveManifest(manifest: DriveManifest, mode: 'immediate' | 'debounced' = 'immediate'): Promise<void> {
    const normalized = applyLocalFileLifecycleToManifest(normalizeManifest({
        ...manifest,
        updatedAt: new Date().toISOString(),
        snapshotSeq: (manifest.snapshotSeq || 0) + 1,
        backups: [
            { at: manifest.updatedAt || new Date().toISOString(), size: Object.keys(manifest.files || {}).length },
            ...(manifest.backups || []),
        ].slice(0, MANIFEST_BACKUP_COUNT),
    }));
    manifestCache = normalized;
    persistManifestLocally(normalized);

    if (mode === 'debounced') {
        queueRemoteManifestWrite(normalized);
        return;
    }

    pendingRemoteManifest = null;
    if (remoteManifestTimer) {
        clearTimeout(remoteManifestTimer);
        remoteManifestTimer = null;
    }
    await writeRemoteManifest(normalized);
}

function queueRemoteManifestWrite(manifest: DriveManifest, delayMs = 2500) {
    pendingRemoteManifest = cloneManifest(manifest);
    if (remoteManifestTimer) {
        clearTimeout(remoteManifestTimer);
    }
    remoteManifestTimer = setTimeout(() => {
        void flushRemoteManifest();
    }, delayMs);
}

async function flushRemoteManifest(): Promise<void> {
    if (remoteManifestTimer) {
        clearTimeout(remoteManifestTimer);
        remoteManifestTimer = null;
    }

    const manifest = pendingRemoteManifest;
    if (!manifest) return remoteManifestWrite;

    pendingRemoteManifest = null;
    const writeTask = remoteManifestWrite
        .catch(() => undefined)
        .then(() => writeRemoteManifest(manifest))
        .catch((err) => {
            queueRemoteManifestWrite(manifest, getTelegramRetryDelayMs(err, 0));
            throw err;
        });

    remoteManifestWrite = writeTask.catch(() => undefined);
    await writeTask;
}

async function loadRemoteManifest(): Promise<DriveManifest | null> {
    const client = await authorizedTelegramClient();
    const messages = Array.from(await client.getMessages('me', {
        limit: 50,
        search: MANIFEST_MARKER,
    })) as TelegramMessage[];
    const manifests: DriveManifest[] = [];

    for (const message of messages) {
        const parsed = await parseManifestMessage(client, message);
        if (parsed) manifests.push(parsed);
    }

    if (manifests.length === 0) return null;

    return manifests.sort((a, b) => {
        const bySeq = (b.snapshotSeq || 0) - (a.snapshotSeq || 0);
        if (bySeq !== 0) return bySeq;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })[0];
}

async function parseManifestMessage(client: TelegramClientInstance, message: TelegramMessage): Promise<DriveManifest | null> {
    const text = getMessageText(message);
    const textPayload = text.includes(MANIFEST_MARKER)
        ? text.slice(text.indexOf(MANIFEST_MARKER) + MANIFEST_MARKER.length).trim()
        : '';

    if (textPayload.startsWith('{')) {
        return parseManifestJson(textPayload);
    }

    if (!message.media || !message.file) return null;

    try {
        const bytes = await downloadMessageBytes(client, message);
        return parseManifestJson(new TextDecoder().decode(bytes));
    } catch {
        return null;
    }
}

async function writeRemoteManifest(manifest: DriveManifest): Promise<void> {
    const client = await authorizedTelegramClient();
    const normalized = normalizeManifest(manifest);
    const payload = JSON.stringify(normalized);
    const manifestBlob = new Blob([payload], { type: 'application/json' });
    const manifestFile = new File([manifestBlob], MANIFEST_FILENAME, {
        type: 'application/json',
        lastModified: Date.now(),
    });
    const existing = Array.from(await client.getMessages('me', {
        limit: 50,
        search: MANIFEST_MARKER,
    })) as TelegramMessage[];

    const newMessage = await sendTelegramFileWithRetry(client, 'me', {
        file: manifestFile,
        fileSize: manifestFile.size,
        forceDocument: true,
        caption: MANIFEST_MARKER,
        workers: 1,
    });

    const snapshotMessages = [newMessage as TelegramMessage, ...existing]
        .filter(isDriveManifestMessage)
        .sort((a, b) => b.id - a.id);
    const oldIds = snapshotMessages
        .slice(MANIFEST_BACKUP_COUNT)
        .map((message) => message.id)
        .filter((id) => id !== newMessage.id);

    if (oldIds.length > 0) {
        await client.deleteMessages('me', oldIds, { revoke: true }).catch(() => undefined);
    }
}

function loadLocalManifest(): DriveManifest {
    const cached = readCachedManifest();
    const localFolders = readStoredFolders();
    const localMap = readFolderMap();

    return normalizeManifest({
        ...cached,
        updatedAt: cached?.updatedAt || new Date().toISOString(),
        folders: mergeFolders([...(cached?.folders || []), ...localFolders]),
        fileFolders: {
            ...(cached?.fileFolders || {}),
            ...localMap,
        },
        files: cached?.files || {},
        events: cached?.events || [],
        backups: cached?.backups || [],
        settings: cached?.settings,
    });
}

function persistManifestLocally(manifest: DriveManifest) {
    localStorage.setItem(scopedKey(MANIFEST_CACHE_KEY), JSON.stringify(manifest));
    writeFolderMap(manifest.fileFolders);

    const config = readConfig();
    config.folders = manifest.folders;
    localStorage.setItem(`${STORE_PREFIX}config.json`, JSON.stringify(config));
}

function readCachedManifest(): DriveManifest | null {
    try {
        const raw = localStorage.getItem(scopedKey(MANIFEST_CACHE_KEY)) || localStorage.getItem(MANIFEST_CACHE_KEY);
        return raw ? normalizeManifest(JSON.parse(raw) as DriveManifest) : null;
    } catch {
        return null;
    }
}

function readStoredFolders(): TelegramFolder[] {
    const config = readConfig();
    return Array.isArray(config.folders) ? normalizeFolders(config.folders as TelegramFolder[]) : [];
}

function parseManifestJson(payload: string): DriveManifest | null {
    try {
        return normalizeManifest(JSON.parse(payload) as DriveManifest);
    } catch {
        return null;
    }
}

function readLocalFileLifecycle(): Record<string, LocalFileLifecycle> {
    try {
        const parsed = JSON.parse(localStorage.getItem(scopedKey(FILE_LIFECYCLE_KEY)) || '{}') as Record<string, LocalFileLifecycle>;
        const normalized: Record<string, LocalFileLifecycle> = {};
        for (const [key, entry] of Object.entries(parsed || {})) {
            const messageId = Number(entry?.messageId || key);
            if (!Number.isFinite(messageId) || (entry.state !== 'trashed' && entry.state !== 'deleted')) continue;
            const record = entry.record ? normalizeLifecycleRecord(messageId, entry.record) : undefined;
            normalized[String(messageId)] = {
                messageId,
                state: entry.state,
                updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
                deletedAt: typeof entry.deletedAt === 'string' ? entry.deletedAt : undefined,
                record,
            };
        }
        return normalized;
    } catch {
        return {};
    }
}

function writeLocalFileLifecycle(entries: Record<string, LocalFileLifecycle>) {
    localStorage.setItem(scopedKey(FILE_LIFECYCLE_KEY), JSON.stringify(entries));
}

function rememberLocalFileLifecycle(record: DriveFileRecord, state: LocalFileLifecycle['state']) {
    const entries = readLocalFileLifecycle();
    const updatedAt = new Date().toISOString();
    const key = String(record.messageId);
    entries[key] = {
        messageId: record.messageId,
        state,
        updatedAt,
        deletedAt: state === 'trashed' ? (record.deletedAt || updatedAt) : updatedAt,
        record: cloneFileRecord({
            ...record,
            trashed: state === 'trashed',
            deletedAt: state === 'trashed' ? (record.deletedAt || updatedAt) : record.deletedAt,
            updatedAt,
        }),
    };
    writeLocalFileLifecycle(entries);
}

function forgetLocalFileLifecycle(messageId: number) {
    const entries = readLocalFileLifecycle();
    delete entries[String(messageId)];
    writeLocalFileLifecycle(entries);
}

function applyLocalFileLifecycleToManifest(manifest: DriveManifest): DriveManifest {
    const normalized = cloneManifest(manifest);
    const entries = readLocalFileLifecycle();

    for (const [key, entry] of Object.entries(entries)) {
        if (entry.state === 'deleted') {
            delete normalized.files[key];
            delete normalized.fileFolders[key];
            continue;
        }

        const baseRecord = normalized.files[key] || entry.record;
        if (!baseRecord) continue;
        const deletedAt = entry.deletedAt || baseRecord.deletedAt || entry.updatedAt;
        normalized.files[key] = {
            ...baseRecord,
            messageId: entry.messageId,
            trashed: true,
            missing: false,
            deletedAt,
            updatedAt: laterTimestamp(baseRecord.updatedAt, entry.updatedAt),
        };
        normalized.fileFolders[key] = normalized.files[key].folderId ?? normalized.fileFolders[key] ?? null;
    }

    return normalized;
}

function normalizeLifecycleRecord(messageId: number, record: Partial<DriveFileRecord>): DriveFileRecord {
    const folderId = record.folderId === undefined || record.folderId === null
        ? null
        : Number(record.folderId);
    return {
        messageId,
        folderId: Number.isFinite(folderId as number) ? folderId : null,
        name: String(record.name || `Telegram-file-${messageId}`),
        size: Number(record.size) || 0,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
        mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
        tags: normalizeTags(record.tags || []),
        starred: Boolean(record.starred),
        trashed: Boolean(record.trashed),
        deletedAt: typeof record.deletedAt === 'string' ? record.deletedAt : undefined,
        missing: Boolean(record.missing),
        checksum: typeof record.checksum === 'string' ? record.checksum : undefined,
        originalPath: typeof record.originalPath === 'string' ? record.originalPath : undefined,
        versionGroup: typeof record.versionGroup === 'string' ? record.versionGroup : undefined,
        version: record.version === undefined ? undefined : Number(record.version) || undefined,
        duplicateOf: record.duplicateOf === undefined ? undefined : Number(record.duplicateOf) || undefined,
        textIndex: typeof record.textIndex === 'string' ? record.textIndex : undefined,
        textIndexedAt: typeof record.textIndexedAt === 'string' ? record.textIndexedAt : undefined,
        ocrText: typeof record.ocrText === 'string' ? record.ocrText : undefined,
        ocrIndexedAt: typeof record.ocrIndexedAt === 'string' ? record.ocrIndexedAt : undefined,
        checksumVerifiedAt: typeof record.checksumVerifiedAt === 'string' ? record.checksumVerifiedAt : undefined,
        integrityStatus: record.integrityStatus === 'valid' || record.integrityStatus === 'mismatch'
            ? record.integrityStatus
            : 'unknown',
    };
}

function normalizeManifest(manifest: Partial<DriveManifest>): DriveManifest {
    const fileFolders = normalizeFileFolders(manifest.fileFolders || {});
    const events = normalizeEvents(manifest.events || []);
    const files = applyFileLifecycleEvents(
        normalizeFileRecords(manifest.files || {}, fileFolders),
        fileFolders,
        events
    );
    for (const [messageId, record] of Object.entries(files)) {
        fileFolders[messageId] = record.folderId ?? fileFolders[messageId] ?? null;
    }

    return {
        version: 2,
        schemaVersion: 2,
        driveId: typeof manifest.driveId === 'string' && manifest.driveId
            ? manifest.driveId
            : getPersistentDriveId(),
        updatedAt: manifest.updatedAt || new Date().toISOString(),
        snapshotSeq: Number(manifest.snapshotSeq) || 0,
        folders: normalizeFolders(manifest.folders || []),
        fileFolders,
        files,
        events,
        backups: normalizeBackups(manifest.backups || []),
        settings: {
            trashRetentionDays: Number(manifest.settings?.trashRetentionDays) || 30,
            duplicateStrategy: 'version',
        },
    };
}

function normalizeFolders(folders: TelegramFolder[]): TelegramFolder[] {
    return mergeFolders(folders.map((folder) => ({
        id: Number(folder.id),
        name: String(folder.name || 'Folder'),
        parent_id: folder.parent_id === undefined || folder.parent_id === null
            ? undefined
            : Number(folder.parent_id),
    }))).filter((folder) => Number.isFinite(folder.id));
}

function normalizeFileFolders(map: Record<string, number | null>): Record<string, number | null> {
    const normalized: Record<string, number | null> = {};
    for (const [messageId, folderId] of Object.entries(map)) {
        normalized[String(messageId)] = folderId === null || folderId === undefined ? null : Number(folderId);
    }
    return normalized;
}

function mergeManifests(remote: DriveManifest, local: DriveManifest): DriveManifest {
    const files = mergeFileRecords(local.files, remote.files);
    const fileFolders = {
        ...local.fileFolders,
        ...remote.fileFolders,
    };
    for (const [messageId, record] of Object.entries(files)) {
        fileFolders[messageId] = record.folderId ?? fileFolders[messageId] ?? null;
    }

    return normalizeManifest({
        version: 2,
        schemaVersion: 2,
        driveId: remote.driveId || local.driveId,
        updatedAt: laterTimestamp(remote.updatedAt, local.updatedAt),
        snapshotSeq: Math.max(remote.snapshotSeq || 0, local.snapshotSeq || 0),
        folders: mergeFolders([...remote.folders, ...local.folders]),
        fileFolders,
        files,
        events: mergeEvents(local.events, remote.events),
        backups: [...local.backups, ...remote.backups],
        settings: { ...local.settings, ...remote.settings },
    });
}

function mergeFolders(folders: TelegramFolder[]): TelegramFolder[] {
    const byId = new Map<number, TelegramFolder>();
    for (const folder of folders) {
        byId.set(folder.id, folder);
    }
    return Array.from(byId.values());
}

function cloneManifest(manifest: DriveManifest): DriveManifest {
    return {
        version: 2,
        schemaVersion: 2,
        driveId: manifest.driveId,
        updatedAt: manifest.updatedAt,
        snapshotSeq: manifest.snapshotSeq,
        folders: manifest.folders.map((folder) => ({ ...folder })),
        fileFolders: { ...manifest.fileFolders },
        files: Object.fromEntries(Object.entries(manifest.files).map(([key, record]) => [key, cloneFileRecord(record)])),
        events: manifest.events.map((event) => ({ ...event, payload: { ...event.payload } })),
        backups: manifest.backups.map((backup) => ({ ...backup })),
        settings: { ...manifest.settings },
    };
}

function hasManifestData(manifest: DriveManifest): boolean {
    return manifest.folders.length > 0
        || Object.keys(manifest.fileFolders).length > 0
        || Object.keys(manifest.files).length > 0
        || manifest.events.length > 0;
}

function normalizeFileRecords(
    records: Record<string, DriveFileRecord>,
    fileFolders: Record<string, number | null>
): Record<string, DriveFileRecord> {
    const normalized: Record<string, DriveFileRecord> = {};

    for (const [key, record] of Object.entries(records || {})) {
        const messageId = Number(record.messageId || key);
        if (!Number.isFinite(messageId)) continue;
        const folderId = record.folderId === undefined
            ? fileFolders[String(messageId)] ?? null
            : record.folderId === null
                ? null
                : Number(record.folderId);

        normalized[String(messageId)] = {
            messageId,
            folderId: Number.isFinite(folderId as number) ? folderId : null,
            name: String(record.name || `Telegram-file-${messageId}`),
            size: Number(record.size) || 0,
            createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
            updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
            mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
            tags: normalizeTags(record.tags || []),
            starred: Boolean(record.starred),
            trashed: Boolean(record.trashed),
            deletedAt: typeof record.deletedAt === 'string' ? record.deletedAt : undefined,
            missing: Boolean(record.missing),
            checksum: typeof record.checksum === 'string' ? record.checksum : undefined,
            originalPath: typeof record.originalPath === 'string' ? record.originalPath : undefined,
            versionGroup: typeof record.versionGroup === 'string' ? record.versionGroup : undefined,
            version: record.version === undefined ? undefined : Number(record.version) || undefined,
            duplicateOf: record.duplicateOf === undefined ? undefined : Number(record.duplicateOf) || undefined,
            textIndex: typeof record.textIndex === 'string' ? record.textIndex : undefined,
            textIndexedAt: typeof record.textIndexedAt === 'string' ? record.textIndexedAt : undefined,
            ocrText: typeof record.ocrText === 'string' ? record.ocrText : undefined,
            ocrIndexedAt: typeof record.ocrIndexedAt === 'string' ? record.ocrIndexedAt : undefined,
            checksumVerifiedAt: typeof record.checksumVerifiedAt === 'string' ? record.checksumVerifiedAt : undefined,
            integrityStatus: record.integrityStatus === 'valid' || record.integrityStatus === 'mismatch'
                ? record.integrityStatus
                : 'unknown',
        };
    }

    return normalized;
}

function normalizeEvents(events: DriveEvent[]): DriveEvent[] {
    const byId = new Map<string, DriveEvent>();

    for (const event of events || []) {
        if (!event?.type || !event.id) continue;
        byId.set(String(event.id), {
            id: String(event.id),
            type: event.type,
            at: typeof event.at === 'string' ? event.at : new Date().toISOString(),
            payload: typeof event.payload === 'object' && event.payload ? event.payload : {},
        });
    }

    return Array.from(byId.values())
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
        .slice(-MANIFEST_EVENT_LIMIT);
}

function applyFileLifecycleEvents(
    files: Record<string, DriveFileRecord>,
    fileFolders: Record<string, number | null>,
    events: DriveEvent[]
): Record<string, DriveFileRecord> {
    const normalized = Object.fromEntries(
        Object.entries(files).map(([key, record]) => [key, cloneFileRecord(record)])
    );

    for (const event of events) {
        if (
            event.type !== 'file_trashed'
            && event.type !== 'file_restored'
            && event.type !== 'file_deleted'
        ) {
            continue;
        }

        const messageId = Number(event.payload?.messageId);
        if (!Number.isFinite(messageId)) continue;
        const key = String(messageId);

        if (event.type === 'file_deleted') {
            delete normalized[key];
            delete fileFolders[key];
            continue;
        }

        const record = normalized[key] || createRecordFromLifecycleEvent(event, messageId, fileFolders);
        if (!record) continue;

        if (event.type === 'file_trashed') {
            normalized[key] = {
                ...record,
                trashed: true,
                missing: false,
                deletedAt: record.deletedAt || event.at,
                updatedAt: laterTimestamp(record.updatedAt, event.at),
            };
            fileFolders[key] = normalized[key].folderId ?? fileFolders[key] ?? null;
        } else if (event.type === 'file_restored') {
            normalized[key] = {
                ...record,
                trashed: false,
                deletedAt: undefined,
                missing: false,
                updatedAt: laterTimestamp(record.updatedAt, event.at),
            };
            fileFolders[key] = normalized[key].folderId ?? fileFolders[key] ?? null;
        }
    }

    return normalized;
}

function createRecordFromLifecycleEvent(
    event: DriveEvent,
    messageId: number,
    fileFolders: Record<string, number | null>
): DriveFileRecord | null {
    if (event.type !== 'file_trashed') return null;
    const payload = event.payload || {};
    const recordPayload = typeof payload.record === 'object' && payload.record
        ? payload.record as Partial<DriveFileRecord>
        : payload as Partial<DriveFileRecord>;
    return normalizeLifecycleRecord(messageId, {
        ...recordPayload,
        messageId,
        folderId: recordPayload.folderId ?? fileFolders[String(messageId)] ?? null,
        name: recordPayload.name || `Telegram-file-${messageId}`,
        size: recordPayload.size || 0,
        trashed: true,
        deletedAt: typeof payload.deletedAt === 'string' ? payload.deletedAt : event.at,
        updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : event.at,
    });
}

function normalizeBackups(backups: DriveManifestBackup[]): DriveManifestBackup[] {
    return (backups || [])
        .filter((backup) => backup && typeof backup.at === 'string')
        .map((backup) => ({
            at: backup.at,
            messageId: backup.messageId === undefined ? undefined : Number(backup.messageId) || undefined,
            size: backup.size === undefined ? undefined : Number(backup.size) || undefined,
        }))
        .slice(0, MANIFEST_BACKUP_COUNT);
}

function mergeFileRecords(
    local: Record<string, DriveFileRecord>,
    remote: Record<string, DriveFileRecord>
): Record<string, DriveFileRecord> {
    const merged: Record<string, DriveFileRecord> = {};
    const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);

    for (const key of keys) {
        const localRecord = local[key];
        const remoteRecord = remote[key];
        if (!localRecord) {
            merged[key] = cloneFileRecord(remoteRecord);
            continue;
        }
        if (!remoteRecord) {
            merged[key] = cloneFileRecord(localRecord);
            continue;
        }

        merged[key] = isRecordNewer(localRecord, remoteRecord)
            ? cloneFileRecord(localRecord)
            : cloneFileRecord(remoteRecord);
    }

    return merged;
}

function mergeEvents(local: DriveEvent[], remote: DriveEvent[]): DriveEvent[] {
    return normalizeEvents([...(local || []), ...(remote || [])]);
}

function cloneFileRecord(record: DriveFileRecord): DriveFileRecord {
    return {
        ...record,
        tags: record.tags ? [...record.tags] : [],
    };
}

function isRecordNewer(a: DriveFileRecord, b: DriveFileRecord): boolean {
    return new Date(a.updatedAt || a.createdAt || 0).getTime()
        >= new Date(b.updatedAt || b.createdAt || 0).getTime();
}

function laterTimestamp(a?: string, b?: string): string {
    const aTime = new Date(a || 0).getTime();
    const bTime = new Date(b || 0).getTime();
    return aTime >= bTime
        ? (a || b || new Date().toISOString())
        : (b || a || new Date().toISOString());
}

function ensureManifestFileRecord(manifest: DriveManifest, message: TelegramMessage): DriveFileRecord {
    const key = String(message.id);
    const existing = manifest.files[key];
    if (existing) {
        manifest.fileFolders[key] = existing.folderId ?? manifest.fileFolders[key] ?? null;
        return existing;
    }

    const record = createFileRecordFromMessage(message, manifest);
    manifest.files[key] = record;
    manifest.fileFolders[key] = record.folderId;
    return record;
}

function createFileRecordFromMessage(message: TelegramMessage, manifest: DriveManifest): DriveFileRecord {
    const key = String(message.id);
    const createdAt = message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString();
    const size = sizeToNumber(message.file?.size);

    return {
        messageId: message.id,
        folderId: manifest.fileFolders[key] ?? null,
        name: getMessageFilename(message),
        size,
        createdAt,
        updatedAt: createdAt,
        mimeType: message.file?.mimeType || undefined,
        tags: [],
        starred: false,
        trashed: false,
        missing: false,
    };
}

function createFileLifecyclePayload(record: DriveFileRecord): Record<string, unknown> {
    return {
        messageId: record.messageId,
        folderId: record.folderId,
        name: record.name,
        size: record.size,
        mimeType: record.mimeType,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        deletedAt: record.deletedAt,
        record: cloneFileRecord(record),
    };
}

function appendManifestEvent(manifest: DriveManifest, type: DriveEventType, payload: Record<string, unknown>) {
    manifest.events = normalizeEvents([
        ...(manifest.events || []),
        {
            id: createEventId(type),
            type,
            at: new Date().toISOString(),
            payload,
        },
    ]);
}

function createEventId(type: DriveEventType): string {
    if (crypto.randomUUID) return `${type}:${crypto.randomUUID()}`;
    return `${type}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function normalizeTags(tags: string[]): string[] {
    return Array.from(new Set((tags || [])
        .map((tag) => String(tag).trim().toLowerCase())
        .filter(Boolean)))
        .slice(0, 20);
}

function findActiveDuplicates(
    manifest: DriveManifest,
    name: string,
    size: number,
    folderId: number | null
): DriveFileRecord[] {
    return Object.values(manifest.files)
        .filter((record) => !record.trashed && !record.missing)
        .filter((record) => (record.folderId ?? null) === folderId)
        .filter((record) => record.name === name && record.size === size);
}

function createVersionGroup(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'file';
    return `${base}-${Date.now().toString(36)}`;
}

function getPersistentDriveId(): string {
    const key = scopedKey(DRIVE_ID_KEY);
    const existing = localStorage.getItem(key) || localStorage.getItem(DRIVE_ID_KEY);
    if (existing) return existing;

    const next = crypto.randomUUID ? crypto.randomUUID() : `drive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, next);
    return next;
}

function isDriveManifestMessage(message: TelegramMessage): boolean {
    return getMessageFilename(message) === MANIFEST_FILENAME || getMessageText(message).includes(MANIFEST_MARKER);
}

function getMessageText(message: TelegramMessage): string {
    const maybeText = (message as TelegramMessage & { message?: unknown }).message;
    return typeof maybeText === 'string' ? maybeText : '';
}

async function authorizedTelegramClient(): Promise<TelegramClientInstance> {
    const client = await getTelegramClient();
    const authorized = await client.checkAuthorization();
    if (!authorized) throw new Error('Telegram login required');
    return client;
}

async function getTelegramClient(
    apiIdArg?: number,
    apiHashArg?: string,
    forceNew = false
): Promise<TelegramClientInstance> {
    const credentials = resolveCredentials(apiIdArg, apiHashArg);
    const credentialsChanged = !clientCredentials
        || clientCredentials.apiId !== credentials.apiId
        || clientCredentials.apiHash !== credentials.apiHash;

    if (forceNew || credentialsChanged) {
        if (clientPromise) {
            try {
                const existing = await clientPromise;
                await existing.disconnect();
            } catch {
                // ignore stale disconnect failures
            }
        }
        clientPromise = null;
    }

    if (!clientPromise) {
        clientCredentials = credentials;
        clientPromise = createTelegramClient(credentials.apiId, credentials.apiHash);
    }

    return await clientPromise;
}

async function createTelegramClient(apiId: number, apiHash: string): Promise<TelegramClientInstance> {
    const { Buffer } = await import('buffer');
    const globalWithBuffer = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
    globalWithBuffer.Buffer = globalWithBuffer.Buffer || Buffer;

    const { TelegramClient } = await import('telegram');
    const { StringSession } = await import('telegram/sessions');
    const session = new StringSession(localStorage.getItem(getCurrentSessionKey()) || localStorage.getItem(SESSION_KEY) || '');
    const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
        requestRetries: 3,
        useWSS: true,
        deviceModel: 'Telegram Drive Web',
        systemVersion: navigator.userAgent,
        appVersion: '1.1.3-web',
    });

    await client.connect();
    return client;
}

function resolveCredentials(apiIdArg?: number, apiHashArg?: string): { apiId: number; apiHash: string } {
    const config = readConfig();
    const defaults = {
        apiId: import.meta.env.VITE_TELEGRAM_API_ID || '',
        apiHash: import.meta.env.VITE_TELEGRAM_API_HASH || '',
    };
    const apiId = apiIdArg || Number(config.api_id) || Number(defaults.apiId);
    const apiHash = String(apiHashArg || config.api_hash || defaults.apiHash);

    if (!apiId || !apiHash) {
        throw new Error('Telegram API ID and Hash are required.');
    }

    return { apiId, apiHash };
}

function toTelegramFile(message: TelegramMessage, manifest?: DriveManifest): TelegramFile {
    const record = manifest?.files[String(message.id)];
    const size = record?.size ?? sizeToNumber(message.file?.size);
    return {
        id: message.id,
        name: record?.name || getMessageFilename(message),
        size,
        sizeStr: formatBytes(size),
        created_at: record?.createdAt ? new Date(record.createdAt).toLocaleString() : formatTelegramDate(message.date),
        type: 'file',
        folderId: record?.folderId ?? null,
        mime_type: record?.mimeType || message.file?.mimeType || undefined,
        file_ext: getFilenameExtension(record?.name || getMessageFilename(message)),
        tags: record?.tags || [],
        starred: record?.starred || false,
        trashed: record?.trashed || false,
        missing: record?.missing || false,
        checksum: record?.checksum,
        originalPath: record?.originalPath,
        version: record?.version,
        versionGroup: record?.versionGroup,
        duplicateOf: record?.duplicateOf,
        textIndexedAt: record?.textIndexedAt,
        ocrIndexedAt: record?.ocrIndexedAt,
        checksumVerifiedAt: record?.checksumVerifiedAt,
        integrityStatus: record?.integrityStatus || 'unknown',
    };
}

function recordToTelegramFile(record: DriveFileRecord): TelegramFile {
    const size = record.size || 0;
    return {
        id: record.messageId,
        name: record.name,
        size,
        sizeStr: formatBytes(size),
        created_at: record.createdAt ? new Date(record.createdAt).toLocaleString() : '',
        type: 'file',
        folderId: record.folderId ?? null,
        mime_type: record.mimeType,
        file_ext: getFilenameExtension(record.name),
        tags: record.tags || [],
        starred: record.starred || false,
        trashed: record.trashed || false,
        missing: record.missing || false,
        checksum: record.checksum,
        originalPath: record.originalPath,
        version: record.version,
        versionGroup: record.versionGroup,
        duplicateOf: record.duplicateOf,
        textIndexedAt: record.textIndexedAt,
        ocrIndexedAt: record.ocrIndexedAt,
        checksumVerifiedAt: record.checksumVerifiedAt,
        integrityStatus: record.integrityStatus || 'unknown',
    };
}

type SmartSearchFilters = {
    terms: string[];
    tags: string[];
    types: string[];
    extensions: string[];
    starred?: boolean;
    trashed?: boolean;
    duplicate?: boolean;
    verified?: boolean;
    minSize?: number;
    maxSize?: number;
};

function parseSmartSearchQuery(query: string): SmartSearchFilters {
    const filters: SmartSearchFilters = {
        terms: [],
        tags: [],
        types: [],
        extensions: [],
    };

    const tokens = query.match(/"[^"]+"|\S+/g) || [];
    for (const rawToken of tokens) {
        const token = rawToken.replace(/^"|"$/g, '').trim();
        if (!token) continue;
        const lower = token.toLowerCase();

        if (lower.startsWith('tag:')) {
            filters.tags.push(lower.slice(4));
        } else if (lower.startsWith('type:')) {
            filters.types.push(lower.slice(5));
        } else if (lower.startsWith('ext:')) {
            filters.extensions.push(lower.slice(4).replace(/^\./, ''));
        } else if (lower === 'starred' || lower === 'starred:true') {
            filters.starred = true;
        } else if (lower === 'trash' || lower === 'trashed:true') {
            filters.trashed = true;
        } else if (lower === '-trash' || lower === 'trashed:false') {
            filters.trashed = false;
        } else if (lower === 'duplicate' || lower === 'duplicate:true') {
            filters.duplicate = true;
        } else if (lower === 'verified' || lower === 'verified:true') {
            filters.verified = true;
        } else if (lower.startsWith('size>')) {
            filters.minSize = parseSizeFilter(lower.slice(5));
        } else if (lower.startsWith('size<')) {
            filters.maxSize = parseSizeFilter(lower.slice(5));
        } else {
            filters.terms.push(lower);
        }
    }

    return filters;
}

function matchesSmartSearch(record: DriveFileRecord, filters: SmartSearchFilters): boolean {
    if (filters.starred !== undefined && Boolean(record.starred) !== filters.starred) return false;
    if (filters.trashed !== undefined && Boolean(record.trashed) !== filters.trashed) return false;
    if (filters.duplicate !== undefined && Boolean(record.duplicateOf || record.versionGroup) !== filters.duplicate) return false;
    if (filters.verified !== undefined && (record.integrityStatus === 'valid') !== filters.verified) return false;
    if (filters.minSize !== undefined && record.size < filters.minSize) return false;
    if (filters.maxSize !== undefined && record.size > filters.maxSize) return false;

    const file = recordToTelegramFile(record);
    if (filters.types.length > 0 && !filters.types.some((type) => matchesFileType(file, type))) return false;
    if (filters.extensions.length > 0 && !filters.extensions.includes((file.file_ext || '').toLowerCase())) return false;
    if (filters.tags.length > 0 && !filters.tags.every((tag) => (record.tags || []).includes(tag))) return false;

    const haystack = normalizeSearchText([
        record.name,
        record.mimeType,
        record.originalPath,
        record.checksum,
        ...(record.tags || []),
        record.textIndex,
        record.ocrText,
    ].filter(Boolean).join(' '));

    return filters.terms.every((term) => haystack.includes(term));
}

function matchesFileType(file: TelegramFile, type: string): boolean {
    if (type === 'image' || type === 'photo') return isImageFile(file);
    if (type === 'video') return isVideoFile(file);
    if (type === 'audio' || type === 'music') return isAudioFile(file);
    if (type === 'media') return isMediaFile(file);
    if (type === 'pdf') return isPdfFile(file);
    if (type === 'text' || type === 'document') return isTextPreviewFile(file) || isPdfFile(file);
    return (file.file_ext || '').toLowerCase() === type;
}

function parseSizeFilter(input: string): number {
    const match = input.trim().match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb|tb)?$/i);
    if (!match) return Number(input) || 0;
    const value = Number(match[1]);
    const unit = (match[2] || 'b').toLowerCase();
    const multipliers: Record<string, number> = {
        b: 1,
        kb: 1024,
        mb: 1024 ** 2,
        gb: 1024 ** 3,
        tb: 1024 ** 4,
    };
    return value * (multipliers[unit] || 1);
}

function buildDriveStats(manifest: DriveManifest): DriveStats {
    const records = Object.values(manifest.files);
    const active = records.filter((record) => !record.trashed && !record.missing);
    const trashed = records.filter((record) => record.trashed);
    const typeMap = new Map<string, { count: number; bytes: number }>();

    for (const record of active) {
        const label = classifyRecordType(record);
        const current = typeMap.get(label) || { count: 0, bytes: 0 };
        current.count += 1;
        current.bytes += record.size || 0;
        typeMap.set(label, current);
    }

    return {
        totalFiles: records.length,
        activeFiles: active.length,
        trashedFiles: trashed.length,
        starredFiles: records.filter((record) => record.starred && !record.trashed).length,
        duplicateFiles: records.filter((record) => record.duplicateOf || record.versionGroup).length,
        missingFiles: records.filter((record) => record.missing).length,
        totalBytes: records.reduce((sum, record) => sum + (record.size || 0), 0),
        activeBytes: active.reduce((sum, record) => sum + (record.size || 0), 0),
        trashedBytes: trashed.reduce((sum, record) => sum + (record.size || 0), 0),
        indexedTextFiles: records.filter((record) => record.textIndex || record.ocrText).length,
        verifiedFiles: records.filter((record) => record.integrityStatus === 'valid').length,
        checksumMismatches: records.filter((record) => record.integrityStatus === 'mismatch').length,
        folders: manifest.folders.length,
        backups: manifest.backups.length,
        trashRetentionDays: manifest.settings.trashRetentionDays,
        largestFiles: active
            .slice()
            .sort((a, b) => (b.size || 0) - (a.size || 0))
            .slice(0, 8)
            .map(recordToTelegramFile),
        types: Array.from(typeMap.entries())
            .map(([label, value]) => ({ label, ...value }))
            .sort((a, b) => b.bytes - a.bytes),
        updatedAt: manifest.updatedAt,
    };
}

function classifyRecordType(record: DriveFileRecord): string {
    const file = recordToTelegramFile(record);
    if (isImageFile(file)) return 'Images';
    if (isVideoFile(file)) return 'Videos';
    if (isAudioFile(file)) return 'Audio';
    if (isPdfFile(file)) return 'PDFs';
    if (isTextPreviewFile(file)) return 'Text';
    return 'Other';
}

function getMessageFilename(message: TelegramMessage): string {
    const file = message.file;
    if (file?.name) return String(file.name);

    const mime = file?.mimeType || '';
    if (mime.startsWith('image/')) return `Photo-${message.id}.${mime.split('/')[1] || 'jpg'}`;
    if (mime.startsWith('video/')) return `Video-${message.id}.${mime.split('/')[1] || 'mp4'}`;
    if (mime.startsWith('audio/')) return `Audio-${message.id}.${mime.split('/')[1] || 'mp3'}`;
    return `Telegram-file-${message.id}`;
}

function getFilenameExtension(name: string): string | undefined {
    const ext = name.split('.').pop();
    return ext && ext !== name ? ext.toLowerCase() : undefined;
}

function formatTelegramDate(date?: number): string {
    if (!date) return '';
    return new Date(date * 1000).toLocaleString();
}

function sizeToNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (value && typeof value === 'object' && 'toJSNumber' in value) {
        return Number((value as { toJSNumber: () => number }).toJSNumber());
    }
    if (value && typeof value === 'object' && 'toString' in value) {
        const parsed = Number((value as { toString: () => string }).toString());
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function getTelegramErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object' && 'errorMessage' in err) {
        return String((err as { errorMessage: unknown }).errorMessage);
    }
    return String(err);
}

function saveTelegramSession(client: TelegramClientInstance, pending?: PendingAuth) {
    const account = pending ? accountFromPendingAuth(pending) : readAccountRegistry().find((item) => item.id === getActiveAccountId());
    if (account) {
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, account.id);
        upsertAccount(account);
    }
    const saved = client.session.save();
    localStorage.setItem(getCurrentSessionKey(), String(saved));
    if (getActiveAccountId() === 'default') {
        localStorage.setItem(SESSION_KEY, String(saved));
    }
}

async function normalizeTelegramBytes(value: unknown): Promise<Uint8Array> {
    const { Buffer } = await import('buffer');

    if (Buffer.isBuffer(value)) return value;
    if (typeof value === 'string') return Buffer.from(value);
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value)) return Buffer.from(value);

    if (value && typeof value === 'object') {
        const record = value as {
            buffer?: unknown;
            byteLength?: unknown;
            byteOffset?: unknown;
            data?: unknown;
            type?: unknown;
            length?: unknown;
            toArray?: (() => unknown) | unknown;
            toBuffer?: (() => unknown) | unknown;
            toByteArray?: (() => unknown) | unknown;
        };

        if (record.type === 'Buffer' && Array.isArray(record.data)) {
            return Buffer.from(record.data);
        }

        if (typeof record.toBuffer === 'function') {
            return await normalizeTelegramBytes(record.toBuffer());
        }

        if (typeof record.toByteArray === 'function') {
            return await normalizeTelegramBytes(record.toByteArray());
        }

        if (typeof record.toArray === 'function') {
            const next = record.toArray();
            if (Array.isArray(next)) return Buffer.from(next);
            if (next && typeof next === 'object' && 'value' in next) {
                return await normalizeTelegramBytes((next as { value: unknown }).value);
            }
        }

        if (record.buffer instanceof ArrayBuffer
            && typeof record.byteOffset === 'number'
            && typeof record.byteLength === 'number') {
            return Buffer.from(record.buffer, record.byteOffset, record.byteLength);
        }

        if (typeof record.length === 'number') {
            return Buffer.from(Array.from(value as ArrayLike<number>));
        }
    }

    throw new Error(`Unsupported Telegram byte payload (${getObjectTypeName(value)})`);
}

function getObjectTypeName(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value !== 'object') return typeof value;
    return value.constructor?.name || 'object';
}

function readPendingAuth(): PendingAuth | null {
    try {
        const raw = localStorage.getItem(PENDING_AUTH_KEY);
        return raw ? JSON.parse(raw) as PendingAuth : null;
    } catch {
        return null;
    }
}

function writePendingAuth(auth: PendingAuth) {
    localStorage.setItem(PENDING_AUTH_KEY, JSON.stringify(auth));
}

function clearPendingAuth() {
    localStorage.removeItem(PENDING_AUTH_KEY);
}

function markAuthComplete() {
    writeConfig({ authComplete: true, activeFolderId: null });
}

function readConfig(): Record<string, unknown> {
    try {
        const raw = localStorage.getItem(`${STORE_PREFIX}config.json`);
        return raw ? JSON.parse(raw) as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function writeConfig(update: {
    apiId?: string;
    apiHash?: string;
    authComplete?: boolean;
    activeFolderId?: number | null;
}) {
    const config = readConfig();

    if (update.apiId !== undefined) config.api_id = update.apiId;
    if (update.apiHash !== undefined) config.api_hash = update.apiHash;
    if (update.authComplete !== undefined) config.auth_complete = update.authComplete;
    if ('activeFolderId' in update) config.activeFolderId = update.activeFolderId;

    localStorage.setItem(`${STORE_PREFIX}config.json`, JSON.stringify(config));
}

function readBandwidth() {
    try {
        const raw = localStorage.getItem(scopedKey(BANDWIDTH_KEY)) || localStorage.getItem(BANDWIDTH_KEY);
        if (raw) return JSON.parse(raw) as { up_bytes: number; down_bytes: number };
    } catch {
        // fall through to zeroed stats
    }
    return { up_bytes: 0, down_bytes: 0 };
}

function addBandwidth(key: 'up_bytes' | 'down_bytes', bytes: number) {
    const current = readBandwidth();
    current[key] += bytes;
    localStorage.setItem(scopedKey(BANDWIDTH_KEY), JSON.stringify(current));
}

function readFolderMap(): Record<string, number | null> {
    try {
        const raw = localStorage.getItem(scopedKey(FOLDER_MAP_KEY)) || localStorage.getItem(FOLDER_MAP_KEY);
        return raw ? JSON.parse(raw) as Record<string, number | null> : {};
    } catch {
        return {};
    }
}

function writeFolderMap(map: Record<string, number | null>) {
    localStorage.setItem(scopedKey(FOLDER_MAP_KEY), JSON.stringify(map));
}

function createVirtualFolderId(): number {
    const key = scopedKey(NEXT_FOLDER_ID_KEY);
    const current = Number(localStorage.getItem(key)) || Date.now();
    const randomOffset = Math.floor(Math.random() * 1000);
    const next = Math.max(current + 1, Date.now() + randomOffset);
    localStorage.setItem(key, String(next));
    return next;
}

async function sha256Blob(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function normalizeSearchText(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function readAccountRegistry(): StoredAccount[] {
    try {
        const raw = localStorage.getItem(ACCOUNT_REGISTRY_KEY);
        const accounts = raw ? JSON.parse(raw) as StoredAccount[] : [];
        const normalized = accounts
            .filter((account) => account?.id && account.label)
            .map((account) => ({
                id: String(account.id),
                label: String(account.label),
                apiId: account.apiId === undefined ? undefined : Number(account.apiId),
                lastUsedAt: typeof account.lastUsedAt === 'string' ? account.lastUsedAt : new Date().toISOString(),
            }));
        if (normalized.length > 0) return normalized;
    } catch {
        // fall through to default account
    }

    const legacySession = localStorage.getItem(SESSION_KEY);
    return legacySession ? [{
        id: 'default',
        label: 'Default Telegram',
        lastUsedAt: new Date().toISOString(),
    }] : [];
}

function writeAccountRegistry(accounts: StoredAccount[]) {
    localStorage.setItem(ACCOUNT_REGISTRY_KEY, JSON.stringify(accounts));
}

function accountFromPendingAuth(pending: PendingAuth): StoredAccount {
    const normalizedPhone = pending.phone.replace(/[^\d+]/g, '') || `account-${Date.now()}`;
    return {
        id: normalizedPhone,
        label: normalizedPhone,
        apiId: pending.apiId,
        lastUsedAt: new Date().toISOString(),
    };
}

function upsertAccount(account: StoredAccount) {
    const accounts = readAccountRegistry();
    const next = [
        { ...account, lastUsedAt: new Date().toISOString() },
        ...accounts.filter((item) => item.id !== account.id),
    ];
    writeAccountRegistry(next);
}

type OfflineCacheRecord = {
    messageId: number;
    name: string;
    blob: Blob;
    mimeType?: string;
    checksum?: string;
};

function readOfflineCacheIndex(): Record<string, OfflineCacheIndexEntry> {
    try {
        const raw = localStorage.getItem(scopedKey(OFFLINE_CACHE_INDEX_KEY));
        return raw ? JSON.parse(raw) as Record<string, OfflineCacheIndexEntry> : {};
    } catch {
        return {};
    }
}

function writeOfflineCacheIndex(index: Record<string, OfflineCacheIndexEntry>) {
    localStorage.setItem(scopedKey(OFFLINE_CACHE_INDEX_KEY), JSON.stringify(index));
}

function openOfflineCacheDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(scopedKey(OFFLINE_CACHE_DB_NAME), OFFLINE_CACHE_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(OFFLINE_CACHE_STORE)) {
                db.createObjectStore(OFFLINE_CACHE_STORE, { keyPath: 'messageId' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Failed to open offline cache'));
    });
}

async function withOfflineCacheStore<T>(
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
    const db = await openOfflineCacheDb();
    return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(OFFLINE_CACHE_STORE, mode);
        const store = tx.objectStore(OFFLINE_CACHE_STORE);
        const request = callback(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Offline cache request failed'));
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('Offline cache transaction failed'));
        };
    });
}

async function getOfflineCachedBlob(messageId: number): Promise<OfflineCacheRecord | null> {
    const record = await withOfflineCacheStore<OfflineCacheRecord | undefined>('readonly', (store) => store.get(messageId)).catch(() => undefined);
    if (!record) return null;

    const index = readOfflineCacheIndex();
    if (index[String(messageId)]) {
        index[String(messageId)].lastAccessedAt = new Date().toISOString();
        writeOfflineCacheIndex(index);
    }
    return record;
}

async function putOfflineCachedBlob(record: OfflineCacheRecord): Promise<void> {
    if (record.blob.size > OFFLINE_CACHE_MAX_BYTES / 2) return;

    await withOfflineCacheStore('readwrite', (store) => store.put(record));
    const index = readOfflineCacheIndex();
    index[String(record.messageId)] = {
        messageId: record.messageId,
        name: record.name,
        bytes: record.blob.size,
        mimeType: record.mimeType,
        checksum: record.checksum,
        updatedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
    };
    writeOfflineCacheIndex(index);
    await pruneOfflineCache();
}

async function deleteOfflineCachedBlob(messageId: number): Promise<void> {
    await withOfflineCacheStore('readwrite', (store) => store.delete(messageId));
    const index = readOfflineCacheIndex();
    delete index[String(messageId)];
    writeOfflineCacheIndex(index);
}

async function pruneOfflineCache(): Promise<void> {
    const index = readOfflineCacheIndex();
    let entries = Object.values(index);
    let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    entries = entries.sort((a, b) => new Date(a.lastAccessedAt).getTime() - new Date(b.lastAccessedAt).getTime());

    while (entries.length > OFFLINE_CACHE_MAX_ITEMS || bytes > OFFLINE_CACHE_MAX_BYTES) {
        const oldest = entries.shift();
        if (!oldest) break;
        bytes -= oldest.bytes;
        await deleteOfflineCachedBlob(oldest.messageId).catch(() => undefined);
    }
}

type SendFileOptions = Parameters<TelegramClientInstance['sendFile']>[1];

async function sendTelegramFileWithRetry(
    client: TelegramClientInstance,
    entity: string,
    options: SendFileOptions
): Promise<TelegramMessage> {
    let lastError: unknown;

    for (let attempt = 0; attempt < TELEGRAM_UPLOAD_MAX_ATTEMPTS; attempt++) {
        try {
            await waitForTelegramUploadSlot();
            const message = await client.sendFile(entity, options);
            nextTelegramUploadAt = Date.now() + TELEGRAM_UPLOAD_MIN_INTERVAL_MS;
            return message as TelegramMessage;
        } catch (err) {
            lastError = err;
            if (attempt >= TELEGRAM_UPLOAD_MAX_ATTEMPTS - 1 || !isRetryableTelegramError(err)) {
                break;
            }
            await sleep(getTelegramRetryDelayMs(err, attempt));
        }
    }

    throw new Error(formatTelegramUploadError(lastError));
}

async function waitForTelegramUploadSlot(): Promise<void> {
    const delay = nextTelegramUploadAt - Date.now();
    if (delay > 0) await sleep(delay);
}

function getTelegramRetryDelayMs(err: unknown, attempt: number): number {
    const message = getTelegramErrorMessage(err);
    const floodSeconds = parseTelegramFloodWaitSeconds(message);
    if (floodSeconds !== null) {
        return Math.min((floodSeconds + 1) * 1000, 60_000);
    }
    return Math.min(1500 * 2 ** attempt, 12_000);
}

function parseTelegramFloodWaitSeconds(message: string): number | null {
    const patterns = [
        /FLOOD_WAIT_?(\d+)/i,
        /wait of (\d+) seconds?/i,
        /flood wait.*?(\d+)/i,
    ];

    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match?.[1]) return Number(match[1]);
    }

    return null;
}

function isRetryableTelegramError(err: unknown): boolean {
    const message = getTelegramErrorMessage(err).toLowerCase();
    return parseTelegramFloodWaitSeconds(message) !== null
        || message.includes('timeout')
        || message.includes('network')
        || message.includes('connection')
        || message.includes('socket')
        || message.includes('server')
        || message.includes('500')
        || message.includes('rpc_call_fail');
}

function formatTelegramUploadError(err: unknown): string {
    const message = getTelegramErrorMessage(err);
    const floodSeconds = parseTelegramFloodWaitSeconds(message);
    if (floodSeconds !== null) {
        return `Telegram rate limit. Wait ${floodSeconds}s and try again.`;
    }
    return message || 'Telegram upload failed';
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}
