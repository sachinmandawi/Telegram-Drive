import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { QueueItem } from '../types';
import { useFileDrop } from './useFileDrop';
import { AppStore, invokeCommand, isSavedMessagesDefaultStorage, isTauriRuntime, listenEvent, openTauriFileDialog, uploadBrowserFile } from '../platform';

interface ProgressPayload {
    id: string;
    percent: number;
}

interface BrowserUploadEntry {
    file: File;
    folderId: number | null;
}

export function useFileUpload(activeFolderId: number | null, store: AppStore | null) {
    const queryClient = useQueryClient();
    const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);
    const [processing, setProcessing] = useState(false);
    const [initialized, setInitialized] = useState(false);
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
                const pending = saved.filter(i => i.status === 'pending' || i.status === 'error' || i.status === 'cancelled')
                    .map((item) => item.status === 'pending' ? item : { ...item, status: 'pending' as const, error: undefined, progress: 0 });
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
        const pending = uploadQueue.filter(i => i.status === 'pending' || i.status === 'error' || i.status === 'cancelled');
        store.set('uploadQueue', pending).then(() => store.save());
    }, [store, uploadQueue, initialized, useDesktopFileDialog]);

    useEffect(() => {
        if (processing) return;
        const nextItem = uploadQueue.find(i => i.status === 'pending');
        if (nextItem) {
            processItem(nextItem);
        }
    }, [uploadQueue, processing]);

    useEffect(() => {
        if (!savedMessagesDefault || uploadQueue.length === 0) return;
        const hasActiveUpload = uploadQueue.some((item) => item.status === 'pending' || item.status === 'uploading');
        if (hasActiveUpload) return;

        const signature = uploadQueue.map((item) => `${item.id}:${item.status}`).join('|');
        if (signature === lastManifestFlushRef.current) return;
        lastManifestFlushRef.current = signature;
        invokeCommand('cmd_flush_manifest').catch(() => undefined);
    }, [savedMessagesDefault, uploadQueue]);

    const processItem = async (item: QueueItem) => {
        setProcessing(true);
        setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'uploading', progress: 0, attempts: (i.attempts || 0) + 1 } : i));
        try {
            if (useDesktopFileDialog) {
                await invokeCommand('cmd_upload_file', { path: item.path, folderId: item.folderId, transferId: item.id });
            } else if (item.file) {
                await uploadBrowserFile(item.file, item.folderId, (percent) => {
                    setUploadQueue(q => q.map(i =>
                        i.id === item.id ? { ...i, progress: percent } : i
                    ));
                });
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
                setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'error', error: String(e) } : i));
                toast.error(`Upload failed for ${item.path.split('/').pop()}: ${e}`);
            } else {
                cancelledRef.current.delete(item.id);
            }
        } finally {
            setProcessing(false);
        }
    };

    const queueFileEntries = (entries: BrowserUploadEntry[]) => {
        if (entries.length === 0) return;

        const newItems: QueueItem[] = entries.map(({ file, folderId }) => ({
            id: Math.random().toString(36).substr(2, 9),
            path: getBrowserFileDisplayPath(file),
            file,
            folderId,
            status: 'pending'
        }));
        setUploadQueue(prev => [...prev, ...newItems]);
        toast.info(`Queued ${entries.length} file${entries.length === 1 ? '' : 's'} for upload`);
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
                        status: 'pending'
                    }));
                    setUploadQueue(prev => [...prev, ...newItems]);
                    toast.info(`Queued ${paths.length} files for upload`);
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
        setUploadQueue(q => {
            const uploading = q.find(i => i.status === 'uploading');
            if (uploading) cancelledRef.current.add(uploading.id);
            return q
                .filter(i => i.status !== 'pending')
                .map(i => i.status === 'uploading' ? { ...i, status: 'cancelled' as const } : i);
        });
        toast.info('All uploads cancelled');
    };

    const retryFailed = () => {
        setUploadQueue(q => q.map(i => (
            i.status === 'error' || i.status === 'cancelled'
                ? { ...i, status: 'pending' as const, error: undefined, progress: 0 }
                : i
        )));
        toast.info('Failed uploads queued again');
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
        retryFailed,
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
