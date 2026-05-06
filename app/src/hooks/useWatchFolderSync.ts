import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { AppStore } from '../platform';

type UploadEntry = { file: File; folderId: number | null };

type FileSystemFileHandleLike = {
    kind: 'file';
    name: string;
    getFile: () => Promise<File>;
};

type FileSystemDirectoryHandleLike = {
    kind: 'directory';
    name: string;
    values: () => AsyncIterable<FileSystemDirectoryHandleLike | FileSystemFileHandleLike>;
};

type WindowWithDirectoryPicker = Window & {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
};

interface WatchFolderState {
    active: boolean;
    folderName: string | null;
    lastScanAt: string | null;
    knownFiles: number;
    queuedLastScan: number;
    supported: boolean;
}

const WATCH_SIGNATURES_KEY = 'watchFolderSignatures';
const WATCH_INTERVAL_MS = 60_000;

export function useWatchFolderSync(
    activeFolderId: number | null,
    store: AppStore | null,
    queueFileEntries: (entries: UploadEntry[]) => void
) {
    const [state, setState] = useState<WatchFolderState>({
        active: false,
        folderName: null,
        lastScanAt: null,
        knownFiles: 0,
        queuedLastScan: 0,
        supported: typeof window !== 'undefined' && typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === 'function',
    });
    const handleRef = useRef<FileSystemDirectoryHandleLike | null>(null);
    const knownSignaturesRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!store) return;
        store.get<string[]>(WATCH_SIGNATURES_KEY)
            .then((saved) => {
                knownSignaturesRef.current = new Set(saved || []);
                setState((current) => ({ ...current, knownFiles: knownSignaturesRef.current.size }));
            })
            .catch(() => undefined);
    }, [store]);

    const persistSignatures = useCallback(async () => {
        if (!store) return;
        await store.set(WATCH_SIGNATURES_KEY, Array.from(knownSignaturesRef.current));
        await store.save();
    }, [store]);

    const scan = useCallback(async () => {
        const handle = handleRef.current;
        if (!handle) return;

        const files = await collectFiles(handle);
        const entries: UploadEntry[] = [];
        for (const item of files) {
            const signature = `${item.relativePath}:${item.file.size}:${item.file.lastModified}`;
            if (knownSignaturesRef.current.has(signature)) continue;
            knownSignaturesRef.current.add(signature);
            entries.push({ file: withRelativePath(item.file, item.relativePath), folderId: activeFolderId });
        }

        if (entries.length > 0) {
            queueFileEntries(entries);
            toast.success(`Watch sync queued ${entries.length} new file(s).`);
        }

        await persistSignatures();
        setState((current) => ({
            ...current,
            active: true,
            folderName: handle.name,
            lastScanAt: new Date().toLocaleString(),
            knownFiles: knownSignaturesRef.current.size,
            queuedLastScan: entries.length,
        }));
    }, [activeFolderId, persistSignatures, queueFileEntries]);

    const selectFolder = useCallback(async () => {
        const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
        if (!picker) {
            toast.error('Watch folder requires a browser/WebView with folder picker support.');
            return;
        }

        try {
            handleRef.current = await picker();
            setState((current) => ({ ...current, active: true, folderName: handleRef.current?.name || null }));
            await scan();
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            toast.error(`Watch folder failed: ${error}`);
        }
    }, [scan]);

    const stop = useCallback(() => {
        handleRef.current = null;
        setState((current) => ({ ...current, active: false, folderName: null, queuedLastScan: 0 }));
    }, []);

    useEffect(() => {
        if (!state.active) return;
        const timer = window.setInterval(() => {
            void scan();
        }, WATCH_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [scan, state.active]);

    return useMemo(() => ({
        ...state,
        selectFolder,
        scan,
        stop,
    }), [scan, selectFolder, state, stop]);
}

async function collectFiles(
    directory: FileSystemDirectoryHandleLike,
    parentPath = directory.name
): Promise<Array<{ file: File; relativePath: string }>> {
    const files: Array<{ file: File; relativePath: string }> = [];
    for await (const entry of directory.values()) {
        if (entry.kind === 'file') {
            const file = await entry.getFile();
            files.push({ file, relativePath: `${parentPath}/${entry.name}` });
        } else {
            files.push(...await collectFiles(entry, `${parentPath}/${entry.name}`));
        }
    }
    return files;
}

function withRelativePath(file: File, relativePath: string): File {
    try {
        Object.defineProperty(file, 'webkitRelativePath', {
            value: relativePath,
            configurable: true,
        });
    } catch {
        // Some runtimes expose File metadata as non-configurable. Upload still works without the relative path.
    }
    return file;
}
