import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { QueueItem, UploadConflictInfo, UploadConflictStrategy } from '../types';
import { useFileDrop } from './useFileDrop';
import { AppStore, invokeCommand, isSavedMessagesDefaultStorage, isTauriRuntime, listenEvent, openTauriFileDialog, uploadBrowserFile } from '../platform';
import { friendlyDriveError } from '../utils';

interface ProgressPayload {
    id: string;
    percent: number;
}

interface BrowserUploadEntry {
    file: File;
    folderId: number | null;
    targetLabel?: string;
}

const MAX_AUTO_UPLOAD_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 2500;

export function useFileUpload(activeFolderId: number | null, store: AppStore | null, targetLabel = 'Saved Messages') {
    const queryClient = useQueryClient();
    const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);
    const [processing, setProcessing] = useState(false);
    const [initialized, setInitialized] = useState(false);
    const [retryTick, setRetryTick] = useState(0);
    const cancelledRef = useRef<Set<string>>(new Set());
    const lastManifestFlushRef = useRef('');
    const isDesktopRuntime = isTauriRuntime();
    const savedMessagesDefault = isSavedMessagesDefaultStorage();
    const useDesktopFileDialog = isDesktopRuntime && !savedMessagesDefault;

    // Listen for progress events from Rust
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        listenEvent<ProgressPayload>('upload-progress', (event) => {
            setUploadQueue(q => q.map(i =>
                i.id === event.payload.id ? { ...i, progress: event.payload.percent } : i
            ));
        }).then(fn => { unlisten = fn; });
        return () => { unlisten?.(); };
    }, []);

    useEffect(() => {
        if (!store || initialized || !useDesktopFileDialog) {
            if (!initialized && !useDesktopFileDialog) setInitialized(true);
            return;
        }
        store.get<QueueItem[]>('uploadQueue').then((saved) => {
            if (saved && saved.length > 0) {
                const pending = saved.filter(i => i.status === 'pending' || i.status === 'paused' || i.status === 'error' || i.status === 'cancelled')
                    .map((item) => (
                        item.status === 'pending' || item.status === 'paused'
                            ? item
                            : { ...item, status: 'pending' as const, error: undefined, progress: 0, retryAt: undefined }
                    ));
                if (pending.length > 0) {
                    setUploadQueue(pending);
                    toast.info(`Restored ${pending.length} pending uploads`);
                }
            }
            setInitialized(true);
        });
    }, [store, initialized, useDesktopFileDialog]);

    useEffect(() => {
        if (!store || !initialized || !useDesktopFileDialog) return;
        const pending = uploadQueue.filter(i => i.status === 'pending' || i.status === 'paused' || i.status === 'error' || i.status === 'cancelled');
        store.set('uploadQueue', pending).then(() => store.save());
    }, [store, uploadQueue, initialized, useDesktopFileDialog]);

    useEffect(() => {
        if (processing) return;
        const now = Date.now();
        const nextItem = uploadQueue.find(i => i.status === 'pending' && (!i.retryAt || i.retryAt <= now));
        if (nextItem) {
            processItem(nextItem);
        }
    }, [uploadQueue, processing, retryTick]);

    useEffect(() => {
        const retryTimes = uploadQueue
            .filter((item) => item.status === 'pending' && item.retryAt && item.retryAt > Date.now())
            .map((item) => item.retryAt as number);
        if (retryTimes.length === 0) return;

        const delay = Math.max(250, Math.min(...retryTimes) - Date.now());
        const timer = window.setTimeout(() => setRetryTick((tick) => tick + 1), delay);
        return () => window.clearTimeout(timer);
    }, [uploadQueue]);

    useEffect(() => {
        if (!savedMessagesDefault || uploadQueue.length === 0) return;
        const hasActiveUpload = uploadQueue.some((item) => item.status === 'pending' || item.status === 'uploading');
        if (hasActiveUpload) return;

        const signature = uploadQueue.map((item) => `${item.id}:${item.status}`).join('|');
        if (signature === lastManifestFlushRef.current) return;
        lastManifestFlushRef.current = signature;
        invokeCommand('cmd_flush_manifest').catch(() => undefined);
    }, [savedMessagesDefault, uploadQueue]);

    const resolveUploadConflictStrategy = async (item: QueueItem): Promise<UploadConflictStrategy | null> => {
        const preset = normalizeQueueConflictStrategy(item.conflictStrategy);
        if (!item.file || preset !== 'ask') return preset === 'ask' ? 'version' : preset;

        let conflicts: UploadConflictInfo;
        try {
            conflicts = await invokeCommand<UploadConflictInfo>('cmd_get_upload_conflicts', {
                name: item.file.name,
                size: item.file.size,
                folderId: item.folderId,
            });
        } catch {
            return 'version';
        }

        if (conflicts.count === 0) return 'version';

        const location = item.targetLabel || targetLabel;
        const sizeNote = conflicts.exactCount > 0
            ? `${conflicts.exactCount} same-size match${conflicts.exactCount === 1 ? '' : 'es'} found.`
            : `${conflicts.count} name match${conflicts.count === 1 ? '' : 'es'} found.`;
        const answer = window.prompt(
            `"${item.file.name}" already exists in ${location}.\n${sizeNote}\nType one option: version, keep, replace, skip`,
            'version'
        );
        const strategy = normalizePromptConflictStrategy(answer);
        if (!strategy) return null;

        setUploadQueue(q => q.map(i => i.id === item.id ? {
            ...i,
            conflictStrategy: strategy,
            conflictNote: getConflictNote(strategy, conflicts),
        } : i));
        return strategy;
    };

    const processItem = async (item: QueueItem) => {
        const attemptNumber = (item.attempts || 0) + 1;
        setProcessing(true);
        cancelledRef.current.delete(item.id);
        setUploadQueue(q => q.map(i => i.id === item.id ? {
            ...i,
            status: 'uploading',
            progress: 0,
            retryAt: undefined,
            attempts: attemptNumber,
        } : i));
        try {
            const conflictStrategy = await resolveUploadConflictStrategy(item);
            if (!conflictStrategy) {
                setUploadQueue(q => q.map(i => i.id === item.id ? {
                    ...i,
                    status: 'cancelled',
                    progress: 0,
                    retryAt: undefined,
                } : i));
                return;
            }

            if (conflictStrategy === 'skip') {
                setUploadQueue(q => q.map(i => i.id === item.id ? {
                    ...i,
                    status: 'skipped',
                    progress: 100,
                    retryAt: undefined,
                    conflictStrategy,
                    conflictNote: i.conflictNote || 'Skipped because a file with this name already exists.',
                } : i));
                toast.info(`Skipped duplicate ${getUploadDisplayName(item)}`);
                return;
            }

            if (useDesktopFileDialog) {
                await invokeCommand('cmd_upload_file', { path: item.path, folderId: item.folderId, transferId: item.id });
            } else if (item.file) {
                await uploadBrowserFile(item.file, item.folderId, (percent) => {
                    setUploadQueue(q => q.map(i =>
                        i.id === item.id ? { ...i, progress: percent } : i
                    ));
                }, conflictStrategy);
            } else {
                throw new Error('Missing browser file payload');
            }
            // Check if cancelled during upload
            if (cancelledRef.current.has(item.id)) {
                cancelledRef.current.delete(item.id);
            } else {
                setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'success', progress: 100 } : i));
                queryClient.invalidateQueries({ queryKey: ['files', item.folderId] });
            }
        } catch (e) {
            if (!cancelledRef.current.has(item.id)) {
                const message = friendlyDriveError(e);
                const shouldRetry = attemptNumber < MAX_AUTO_UPLOAD_ATTEMPTS;
                const retryDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attemptNumber - 1);
                const retryAt = Date.now() + retryDelay;
                setUploadQueue(q => q.map(i => i.id === item.id ? {
                    ...i,
                    status: shouldRetry ? 'pending' as const : 'error' as const,
                    error: message,
                    retryAt: shouldRetry ? retryAt : undefined,
                    progress: 0,
                } : i));
                if (shouldRetry) {
                    toast.info(`Upload failed for ${getUploadDisplayName(item)}. Retrying in ${Math.ceil(retryDelay / 1000)}s`);
                } else {
                    toast.error(`Upload failed for ${getUploadDisplayName(item)}: ${message}`);
                }
            } else {
                cancelledRef.current.delete(item.id);
            }
        } finally {
            setProcessing(false);
        }
    };

    const queueFileEntries = (entries: BrowserUploadEntry[]) => {
        if (entries.length === 0) return;

        const newItems: QueueItem[] = entries.map(({ file, folderId, targetLabel: entryTargetLabel }) => ({
            id: Math.random().toString(36).substr(2, 9),
            path: getBrowserFileDisplayPath(file),
            file,
            folderId,
            targetLabel: entryTargetLabel || targetLabel,
            status: 'pending'
        }));
        setUploadQueue(prev => [...prev, ...newItems]);
        const labels = Array.from(new Set(newItems.map((item) => item.targetLabel).filter(Boolean)));
        toast.info(`Queued ${entries.length} file${entries.length === 1 ? '' : 's'} to ${labels.length === 1 ? labels[0] : 'selected folders'}`);
    };

    const queueFiles = (files: File[], folderIdOverride: number | null = activeFolderId) => {
        queueFileEntries(files.map((file) => ({ file, folderId: folderIdOverride })));
    };

    const handleManualUpload = async () => {
        try {
            if (useDesktopFileDialog) {
                const paths = await openTauriFileDialog();
                if (paths.length > 0) {
                    const newItems: QueueItem[] = paths.map((path: string) => ({
                        id: Math.random().toString(36).substr(2, 9),
                        path,
                        folderId: activeFolderId,
                        targetLabel,
                        status: 'pending'
                    }));
                    setUploadQueue(prev => [...prev, ...newItems]);
                    toast.info(`Queued ${paths.length} files to ${targetLabel}`);
                }
                return;
            }

            const files = await pickBrowserFiles();
            queueFiles(files);
        } catch {
            toast.error("Failed to open file dialog");
        }
    };

    const handleDroppedFiles = (files: File[]) => {
        if (useDesktopFileDialog) return;
        queueFiles(files);
    };

    const cancelAll = () => {
        const uploading = uploadQueue.some(i => i.status === 'uploading');
        setUploadQueue(q => {
            const uploading = q.find(i => i.status === 'uploading');
            if (uploading) cancelledRef.current.add(uploading.id);
            return q
                .filter(i => i.status !== 'pending' && i.status !== 'paused')
                .map(i => i.status === 'uploading' ? { ...i, status: 'cancelled' as const } : i);
        });
        toast.info(uploading ? 'Queued uploads cancelled. Current transfer may finish in Telegram.' : 'All uploads cancelled');
    };

    const pauseAll = () => {
        const pendingCount = uploadQueue.filter(i => i.status === 'pending').length;
        const uploading = uploadQueue.some(i => i.status === 'uploading');
        if (pendingCount === 0) {
            toast.info(uploading ? 'Current upload will finish; no queued uploads to pause' : 'No queued uploads to pause');
            return;
        }
        setUploadQueue(q => q.map(i => (
            i.status === 'pending'
                ? { ...i, status: 'paused' as const, retryAt: undefined }
                : i
        )));
        toast.info(`Paused ${pendingCount} queued upload${pendingCount === 1 ? '' : 's'}${uploading ? '; current upload will finish' : ''}`);
    };

    const resumeAll = () => {
        const pausedCount = uploadQueue.filter(i => i.status === 'paused').length;
        if (pausedCount === 0) {
            toast.info('No paused uploads to resume');
            return;
        }
        setUploadQueue(q => q.map(i => (
            i.status === 'paused'
                ? { ...i, status: 'pending' as const, error: undefined, progress: 0, retryAt: undefined }
                : i
        )));
        toast.info(`Resumed ${pausedCount} upload${pausedCount === 1 ? '' : 's'}`);
    };

    const retryFailed = () => {
        setUploadQueue(q => q.map(i => (
            i.status === 'error' || i.status === 'cancelled' || i.status === 'skipped'
                ? {
                    ...i,
                    status: 'pending' as const,
                    error: undefined,
                    progress: 0,
                    retryAt: undefined,
                    conflictStrategy: i.status === 'skipped' ? undefined : i.conflictStrategy,
                    conflictNote: i.status === 'skipped' ? undefined : i.conflictNote,
                }
                : i
        )));
        toast.info('Retryable uploads queued again');
    };

    const retryItem = (id: string) => {
        setUploadQueue(q => q.map(i => (
            i.id === id && (i.status === 'error' || i.status === 'cancelled' || i.status === 'skipped')
                ? {
                    ...i,
                    status: 'pending' as const,
                    error: undefined,
                    progress: 0,
                    retryAt: undefined,
                    conflictStrategy: i.status === 'skipped' ? undefined : i.conflictStrategy,
                    conflictNote: i.status === 'skipped' ? undefined : i.conflictNote,
                }
                : i
        )));
    };

    const removeItem = (id: string) => {
        setUploadQueue(q => {
            const item = q.find(i => i.id === id);
            if (item?.status === 'uploading') cancelledRef.current.add(id);
            return q.filter(i => i.id !== id);
        });
    };

    const { isDragging } = useFileDrop();

    return {
        uploadQueue,
        setUploadQueue,
        handleManualUpload,
        handleDroppedFiles,
        queueFiles,
        queueFileEntries,
        cancelAll,
        pauseAll,
        resumeAll,
        retryFailed,
        retryItem,
        removeItem,
        isDragging
    };
}

function pickBrowserFiles(): Promise<File[]> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.style.display = 'none';
        input.onchange = () => {
            const files = input.files ? Array.from(input.files) : [];
            input.remove();
            resolve(files);
        };
        document.body.appendChild(input);
        input.click();
    });
}

function getBrowserFileDisplayPath(file: File): string {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    return relativePath || file.name;
}

function normalizeQueueConflictStrategy(strategy?: UploadConflictStrategy): UploadConflictStrategy {
    if (strategy === 'skip' || strategy === 'replace' || strategy === 'keep_both' || strategy === 'version') {
        return strategy;
    }
    return 'ask';
}

function normalizePromptConflictStrategy(answer: string | null): UploadConflictStrategy | null {
    if (answer === null) return null;
    const normalized = answer.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!normalized || normalized === 'version' || normalized === 'new_version') return 'version';
    if (normalized === 'keep' || normalized === 'keep_both' || normalized === 'copy') return 'keep_both';
    if (normalized === 'replace' || normalized === 'overwrite') return 'replace';
    if (normalized === 'skip') return 'skip';
    return 'version';
}

function getConflictNote(strategy: UploadConflictStrategy, conflicts: UploadConflictInfo): string {
    const count = conflicts.count;
    if (strategy === 'skip') return `Skipped because ${count} duplicate${count === 1 ? '' : 's'} already exist.`;
    if (strategy === 'replace') return `Replaced ${count} existing duplicate${count === 1 ? '' : 's'} by moving them to Trash.`;
    if (strategy === 'keep_both') return 'Uploaded with a unique copy name.';
    return `Uploaded as a new version after ${count} duplicate${count === 1 ? '' : 's'} were found.`;
}

function getUploadDisplayName(item: QueueItem): string {
    const normalizedPath = item.path.replace(/\\/g, '/');
    return normalizedPath.split('/').pop() || item.path;
}
