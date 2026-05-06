import type { TelegramFile, TelegramFolder } from './types';
import { formatBytes } from './utils';

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
const DRIVE_ID_KEY = 'telegram-drive-persistent-drive-id';
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
    | 'duplicate_detected'
    | 'manifest_repaired';

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

let clientPromise: Promise<TelegramClientInstance> | null = null;
let clientCredentials: { apiId: number; apiHash: string } | null = null;
let manifestCache: DriveManifest | null = null;
let pendingRemoteManifest: DriveManifest | null = null;
let remoteManifestTimer: ReturnType<typeof setTimeout> | null = null;
let remoteManifestWrite: Promise<void> = Promise.resolve();
let nextTelegramUploadAt = 0;

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

        saveTelegramSession(client);
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

    saveTelegramSession(client);
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
    localStorage.removeItem(SESSION_KEY);
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

export async function telegramGetStarredFiles(query?: string): Promise<TelegramFile[]> {
    return await telegramGetFilesByRecord((record) => Boolean(record.starred) && !record.trashed && !record.missing, query);
}

export async function telegramGetTrashFiles(query?: string): Promise<TelegramFile[]> {
    return await telegramGetFilesByRecord((record) => Boolean(record.trashed) && !record.missing, query);
}

export async function telegramDeleteFile(messageId: number): Promise<boolean> {
    const manifest = await getDriveManifest();
    const key = String(messageId);
    const existing = manifest.files[key];
    manifest.files[key] = {
        ...(existing || {
            messageId,
            folderId: manifest.fileFolders[key] ?? null,
            name: `Telegram-file-${messageId}`,
            size: 0,
        }),
        trashed: true,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    manifest.fileFolders[key] = manifest.files[key].folderId ?? null;
    appendManifestEvent(manifest, 'file_trashed', { messageId });
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
        updatedAt: new Date().toISOString(),
    };
    manifest.fileFolders[key] = manifest.files[key].folderId ?? null;
    appendManifestEvent(manifest, 'file_restored', { messageId });
    await saveDriveManifest(manifest, 'debounced');
    return true;
}

export async function telegramPermanentlyDeleteFile(messageId: number): Promise<boolean> {
    const client = await authorizedTelegramClient();
    await client.deleteMessages('me', [messageId], { revoke: true });
    const manifest = await getDriveManifest();
    delete manifest.fileFolders[String(messageId)];
    delete manifest.files[String(messageId)];
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

    for (const duplicate of duplicates) {
        if (!duplicate.versionGroup) duplicate.versionGroup = versionGroup;
        if (!duplicate.version) duplicate.version = 1;
        duplicate.updatedAt = updatedAt;
    }

    const { Buffer } = await import('buffer');
    const { CustomFile } = await import('telegram/client/uploads');
    const uploadFile = new CustomFile(
        file.name,
        file.size,
        '',
        Buffer.from(await file.arrayBuffer())
    );

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
        versionGroup: duplicates.length > 0 ? versionGroup : undefined,
        version: duplicates.length > 0 ? nextVersion : undefined,
        duplicateOf: duplicates[0]?.messageId,
    };
    appendManifestEvent(manifest, 'file_uploaded', {
        messageId: message.id,
        folderId,
        name: file.name,
        size: file.size,
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
    const seen = new Set<string>();
    let indexed = 0;
    let refreshed = 0;
    let missing = 0;

    for (const message of messages) {
        if (!message?.media || !message.file || isDriveManifestMessage(message)) continue;
        const key = String(message.id);
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
    const client = await authorizedTelegramClient();
    const messages = await getSavedMessages(client, query);
    const manifest = await getDriveManifest();
    const files: TelegramFile[] = [];

    for (const message of messages) {
        if (!message?.media || !message.file || isDriveManifestMessage(message)) continue;
        const record = ensureManifestFileRecord(manifest, message);
        if (!predicate(record)) continue;
        files.push(toTelegramFile(message, manifest));
    }

    return files;
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

    return {
        blob,
        name: getMessageFilename(message),
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

    const remote = await loadRemoteManifest();
    const local = loadLocalManifest();
    const manifest = remote ? mergeManifests(remote, local) : local;
    const shouldWriteRemote = !remote
        ? hasManifestData(local)
        : JSON.stringify(normalizeManifest(remote)) !== JSON.stringify(normalizeManifest(manifest));

    manifestCache = normalizeManifest(manifest);
    persistManifestLocally(manifestCache);

    if (shouldWriteRemote) {
        queueRemoteManifestWrite(manifestCache, remote ? 800 : 1500);
    }

    return cloneManifest(manifestCache);
}

async function saveDriveManifest(manifest: DriveManifest, mode: 'immediate' | 'debounced' = 'immediate'): Promise<void> {
    const normalized = normalizeManifest({
        ...manifest,
        updatedAt: new Date().toISOString(),
        snapshotSeq: (manifest.snapshotSeq || 0) + 1,
        backups: [
            { at: manifest.updatedAt || new Date().toISOString(), size: Object.keys(manifest.files || {}).length },
            ...(manifest.backups || []),
        ].slice(0, MANIFEST_BACKUP_COUNT),
    });
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
    const { Buffer } = await import('buffer');
    const { CustomFile } = await import('telegram/client/uploads');
    const normalized = normalizeManifest(manifest);
    const payload = JSON.stringify(normalized);
    const bytes = Buffer.from(payload, 'utf8');
    const manifestFile = new CustomFile(MANIFEST_FILENAME, bytes.length, '', bytes);
    const existing = Array.from(await client.getMessages('me', {
        limit: 50,
        search: MANIFEST_MARKER,
    })) as TelegramMessage[];

    const newMessage = await sendTelegramFileWithRetry(client, 'me', {
        file: manifestFile,
        fileSize: bytes.length,
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
    localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(manifest));
    writeFolderMap(manifest.fileFolders);

    const config = readConfig();
    config.folders = manifest.folders;
    localStorage.setItem(`${STORE_PREFIX}config.json`, JSON.stringify(config));
}

function readCachedManifest(): DriveManifest | null {
    try {
        const raw = localStorage.getItem(MANIFEST_CACHE_KEY);
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

function normalizeManifest(manifest: Partial<DriveManifest>): DriveManifest {
    const fileFolders = normalizeFileFolders(manifest.fileFolders || {});
    const files = normalizeFileRecords(manifest.files || {}, fileFolders);
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
        events: normalizeEvents(manifest.events || []),
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
    const existing = localStorage.getItem(DRIVE_ID_KEY);
    if (existing) return existing;

    const next = crypto.randomUUID ? crypto.randomUUID() : `drive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DRIVE_ID_KEY, next);
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
    const session = new StringSession(localStorage.getItem(SESSION_KEY) || '');
    const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
        requestRetries: 3,
        useWSS: true,
        deviceModel: 'Telegram Drive Web',
        systemVersion: navigator.userAgent,
        appVersion: '1.0.1-web',
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
        tags: record?.tags || [],
        starred: record?.starred || false,
        trashed: record?.trashed || false,
        missing: record?.missing || false,
        checksum: record?.checksum,
        originalPath: record?.originalPath,
        version: record?.version,
        versionGroup: record?.versionGroup,
        duplicateOf: record?.duplicateOf,
    };
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

function saveTelegramSession(client: TelegramClientInstance) {
    const saved = client.session.save();
    localStorage.setItem(SESSION_KEY, String(saved));
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
        const raw = localStorage.getItem(BANDWIDTH_KEY);
        if (raw) return JSON.parse(raw) as { up_bytes: number; down_bytes: number };
    } catch {
        // fall through to zeroed stats
    }
    return { up_bytes: 0, down_bytes: 0 };
}

function addBandwidth(key: 'up_bytes' | 'down_bytes', bytes: number) {
    const current = readBandwidth();
    current[key] += bytes;
    localStorage.setItem(BANDWIDTH_KEY, JSON.stringify(current));
}

function readFolderMap(): Record<string, number | null> {
    try {
        const raw = localStorage.getItem(FOLDER_MAP_KEY);
        return raw ? JSON.parse(raw) as Record<string, number | null> : {};
    } catch {
        return {};
    }
}

function writeFolderMap(map: Record<string, number | null>) {
    localStorage.setItem(FOLDER_MAP_KEY, JSON.stringify(map));
}

function createVirtualFolderId(): number {
    const current = Number(localStorage.getItem(NEXT_FOLDER_ID_KEY)) || Date.now();
    const randomOffset = Math.floor(Math.random() * 1000);
    const next = Math.max(current + 1, Date.now() + randomOffset);
    localStorage.setItem(NEXT_FOLDER_ID_KEY, String(next));
    return next;
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
