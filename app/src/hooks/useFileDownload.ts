import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { DownloadItem, TelegramFile } from '../types';
import { AppStore, downloadBrowserFile, invokeCommand, isSavedMessagesDefaultStorage, isTauriRuntime, listenEvent, openTauriDirectoryDialog, saveTauriFileDialog } from '../platform';

interface ProgressPayload {
    id: string;
    percent: number;
}

export function useFileDownload(store: AppStore | null) {
    const [downloadQueue, setDownloadQueue] = useState<DownloadItem[]>([]);
    const [processing, setProcessing] = useState(false);
    const [initialized, setInitialized] = useState(false);
    const cancelledRef = useRef<Set<string>>(new Set());
    const isDesktopRuntime = isTauriRuntime();
    const useDesktopFileDialog = isDesktopRuntime && !isSavedMessagesDefaultStorage();

    // Listen for progress events from Rust
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        listenEvent<ProgressPayload>('download-progress', (event) => {
            setDownloadQueue(q => q.map(i =>
                i.id === event.payload.id ? { ...i, progress: event.payload.percent } : i
            ));
        }).then(fn => { unlisten = fn; });
        return () => { unlisten?.(); };
    }, []);

    // Load saved queue on mount
    useEffect(() => {
        if (!store || initialized || !useDesktopFileDialog) {
            if (!initialized && !useDesktopFileDialog) setInitialized(true);
            return;
        }
        store.get<DownloadItem[]>('downloadQueue').then((saved) => {
            if (saved && saved.length > 0) {
                const pending = saved.filter(i => i.status === 'pending' || i.status === 'error' || i.status === 'cancelled')
                    .map((item) => item.status === 'pending' ? item : { ...item, status: 'pending' as const, error: undefined, progress: 0 });
                if (pending.length > 0) {
                    setDownloadQueue(pending);
                    toast.info(`Restored ${pending.length} pending downloads`);
                }
            }
            setInitialized(true);
        });
    }, [store, initialized, useDesktopFileDialog]);

    // Save queue when it changes (only pending items)
    useEffect(() => {
        if (!store || !initialized || !useDesktopFileDialog) return;
        const pending = downloadQueue.filter(i => i.status === 'pending' || i.status === 'error' || i.status === 'cancelled');
        store.set('downloadQueue', pending).then(() => store.save());
    }, [store, downloadQueue, initialized, useDesktopFileDialog]);

    // Queue Processor
    useEffect(() => {
        if (processing) return;
        const nextItem = downloadQueue.find(i => i.status === 'pending');
        if (nextItem) {
            processItem(nextItem);
        }
    }, [downloadQueue, processing]);

    const processItem = async (item: DownloadItem) => {
        setProcessing(true);
        setDownloadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'downloading', progress: 0, attempts: (i.attempts || 0) + 1 } : i));

        try {
            if (useDesktopFileDialog) {
                const savePath = item.destinationPath || await saveTauriFileDialog(item.filename);
                if (!savePath) {
                    setDownloadQueue(q => q.filter(i => i.id !== item.id));
                    setProcessing(false);
                    return;
                }

                await invokeCommand('cmd_download_file', {
                    messageId: item.messageId,
                    savePath,
                    folderId: item.folderId,
                    transferId: item.id
                });
            } else {
                setDownloadQueue(q => q.map(i => i.id === item.id ? { ...i, progress: 60 } : i));
                await downloadBrowserFile(item.messageId, item.filename);
            }

            if (cancelledRef.current.has(item.id)) {
                cancelledRef.current.delete(item.id);
            } else {
                setDownloadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'success', progress: 100 } : i));
                toast.success(`Downloaded: ${item.filename}`);
            }
        } catch (e) {
            if (!cancelledRef.current.has(item.id)) {
                setDownloadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'error', error: String(e) } : i));
                toast.error(`Download failed: ${item.filename}`);
            } else {
                cancelledRef.current.delete(item.id);
            }
        } finally {
            setProcessing(false);
        }
    };

    const queueDownload = (messageId: number, filename: string, folderId: number | null) => {
        const newItem: DownloadItem = {
            id: Math.random().toString(36).substr(2, 9),
            messageId,
            filename,
            folderId,
            status: 'pending'
        };
        setDownloadQueue(prev => [...prev, newItem]);
    };

    const queueBulkDownload = async (files: TelegramFile[], folderId: number | null) => {
        if (useDesktopFileDialog) {
            const dirPath = await openTauriDirectoryDialog("Select Download Destination");
            if (!dirPath) return;
        }

        for (const file of files) {
            const newItem: DownloadItem = {
                id: Math.random().toString(36).substr(2, 9),
                messageId: file.id,
                filename: file.name,
                folderId,
                status: 'pending'
            };
            setDownloadQueue(prev => [...prev, newItem]);
        }

        toast.info(`Queued ${files.length} files for download`);
    };

    const clearFinished = () => {
        setDownloadQueue(q => q.filter(i => i.status !== 'success'));
    };

    const cancelAll = () => {
        setDownloadQueue(q => {
            const downloading = q.find(i => i.status === 'downloading');
            if (downloading) cancelledRef.current.add(downloading.id);
            return q
                .filter(i => i.status !== 'pending')
                .map(i => i.status === 'downloading' ? { ...i, status: 'cancelled' as const } : i);
        });
        toast.info('All downloads cancelled');
    };

    const retryFailed = () => {
        setDownloadQueue(q => q.map(i => (
            i.status === 'error' || i.status === 'cancelled'
                ? { ...i, status: 'pending' as const, error: undefined, progress: 0 }
                : i
        )));
        toast.info('Failed downloads queued again');
    };

    return {
        downloadQueue,
        queueDownload,
        queueBulkDownload,
        clearFinished,
        cancelAll,
        retryFailed
    };
}
