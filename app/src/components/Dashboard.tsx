import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { TelegramFile, BandwidthStats, TelegramFolder, DriveView } from '../types';
import { formatBytes, isImageFile, isMediaFile, isPdfFile } from '../utils';

// Components
import { Sidebar } from './dashboard/Sidebar';
import { TopBar } from './dashboard/TopBar';
import { FileExplorer } from './dashboard/FileExplorer';
import { UploadQueue } from './dashboard/UploadQueue';
import { DownloadQueue } from './dashboard/DownloadQueue';
import { MoveToFolderModal } from './dashboard/MoveToFolderModal';
import { PreviewModal } from './dashboard/PreviewModal';
import { MediaPlayer } from './dashboard/MediaPlayer';
import { DragDropOverlay } from './dashboard/DragDropOverlay';
import { ExternalDropBlocker } from './dashboard/ExternalDropBlocker';
import { PdfViewer } from './dashboard/PdfViewer';
import { DriveToolsModal } from './dashboard/DriveToolsModal';
import { TagEditorModal } from './dashboard/TagEditorModal';

// Hooks
import { useTelegramConnection } from '../hooks/useTelegramConnection';
import { useFileOperations } from '../hooks/useFileOperations';
import { useFileUpload } from '../hooks/useFileUpload';
import { useFileDownload } from '../hooks/useFileDownload';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useWatchFolderSync } from '../hooks/useWatchFolderSync';
import { invokeCommand, isSavedMessagesDefaultStorage, isTauriRuntime } from '../platform';
import { useConfirm } from '../context/ConfirmContext';

type MoveConflictStrategy = 'keep_both' | 'replace' | 'skip' | 'merge';

export function Dashboard({ onLogout }: { onLogout: () => void }) {
    const queryClient = useQueryClient();
    const { confirm } = useConfirm();
    const isDesktopRuntime = isTauriRuntime();
    const savedMessagesDefault = isSavedMessagesDefaultStorage();


    const {
        store, folders, activeFolderId, setActiveFolderId, isSyncing, isConnected,
        handleLogout, handleSyncFolders, handleCreateFolder, handleFolderDelete
    } = useTelegramConnection(onLogout);


    const [previewFile, setPreviewFile] = useState<TelegramFile | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [driveView, setDriveView] = useState<DriveView>('files');
    const [activeTrashFolderId, setActiveTrashFolderId] = useState<number | null>(null);
    const [trashBreadcrumbs, setTrashBreadcrumbs] = useState<{ id: number; name: string }[]>([]);
    const [searchScope, setSearchScope] = useState<'current' | 'drive'>('current');
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [moveConflictStrategy, setMoveConflictStrategy] = useState<MoveConflictStrategy>('keep_both');
    const [unlockedProtectedIds, setUnlockedProtectedIds] = useState<Set<string>>(() => new Set());
    const [searchTerm, setSearchTerm] = useState("");
    const [searchResults, setSearchResults] = useState<TelegramFile[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [internalDragFileId, _setInternalDragFileId] = useState<number | null>(null);
    const internalDragRef = useRef<number | null>(null);

    const setInternalDragFileId = (id: number | null) => {
        internalDragRef.current = id;
        _setInternalDragFileId(id);
    };
    const [playingFile, setPlayingFile] = useState<TelegramFile | null>(null);
    const [pdfFile, setPdfFile] = useState<TelegramFile | null>(null);
    const [previewContextFiles, setPreviewContextFiles] = useState<TelegramFile[]>([]);
    const [previewContextIndex, setPreviewContextIndex] = useState(-1);
    const [isRepairingDrive, setIsRepairingDrive] = useState(false);
    const [showTools, setShowTools] = useState(false);
    const [tagTarget, setTagTarget] = useState<TelegramFile | 'bulk' | null>(null);

    useEffect(() => {
        if (store) {
            store.get<'grid' | 'list'>('viewMode').then((saved) => {
                if (saved) setViewMode(saved);
            });
        }
    }, [store]);

    useEffect(() => {
        if (store) {
            store.set('viewMode', viewMode).then(() => store.save());
        }
    }, [store, viewMode]);


    const { data: allFiles = [], isLoading, error } = useQuery({
        queryKey: ['files', driveView, activeFolderId, activeTrashFolderId],
        queryFn: () => {
            const command = driveView === 'trash'
                ? 'cmd_get_trash_files'
                : driveView === 'recent'
                    ? 'cmd_get_recent_items'
                    : 'cmd_get_files';
            const args = driveView === 'files'
                ? { folderId: activeFolderId }
                : driveView === 'trash'
                    ? { folderId: activeTrashFolderId }
                    : {};
            return invokeCommand<any[]>(command, args).then(res => res.map(f => ({
            ...f,
            sizeStr: f.sizeStr || formatBytes(f.size),
            type: f.icon_type || f.type || (f.name.endsWith('/') ? 'folder' : 'file')
            }))).then((files) => {
                if (driveView === 'gallery') return files.filter(isImageFile);
                if (driveView === 'media') return files.filter(isMediaFile);
                return files;
            });
        },
        enabled: !!store,
    });

    const childFolderItems = useMemo(() => {
        if (driveView !== 'files') return [];
        return folders
            .filter((folder) => getFolderParentId(folder) === activeFolderId)
            .map(folderToExplorerItem);
    }, [folders, activeFolderId, driveView]);

    const currentFolderItems = useMemo(() => {
        return [...childFolderItems, ...allFiles];
    }, [childFolderItems, allFiles]);

    const baseDisplayedFiles = searchTerm.length > 2
        ? searchResults
        : currentFolderItems.filter((f: TelegramFile) => f.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const displayedFiles = baseDisplayedFiles.filter((file) => {
        if (driveView === 'gallery') return isImageFile(file);
        if (driveView === 'media') return isMediaFile(file);
        return true;
    });

    const displayedFileItems = useMemo(() => {
        return displayedFiles.filter((f) => f.type !== 'folder');
    }, [displayedFiles]);
    const selectableIds = useMemo(() => displayedFiles.map((file) => file.id), [displayedFiles]);
    const allDisplayedSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));
    const selectedFileCount = useMemo(() => {
        return displayedFileItems.filter((file) => selectedIds.includes(file.id)).length;
    }, [displayedFileItems, selectedIds]);
    const { data: bandwidth } = useQuery({
        queryKey: ['bandwidth'],
        queryFn: () => invokeCommand<BandwidthStats>('cmd_get_bandwidth'),
        refetchInterval: 5000,
        enabled: !!store
    });


    const {
        handleDelete, handleBulkDelete, handleBulkDownload,
        handleDownloadFolder, handleGlobalSearch

    } = useFileOperations(activeFolderId, selectedIds, setSelectedIds, displayedFileItems);

    const { uploadQueue, setUploadQueue, handleManualUpload, handleDroppedFiles, queueFileEntries, cancelAll: cancelUploads, retryFailed: retryFailedUploads, isDragging } = useFileUpload(activeFolderId, store);
    const { downloadQueue, queueDownload, clearFinished: clearDownloads, cancelAll: cancelDownloads, retryFailed: retryFailedDownloads } = useFileDownload(store);
    const watchFolder = useWatchFolderSync(activeFolderId, store, queueFileEntries);

    const handleClearSelection = useCallback(() => {
        setSelectedIds([]);
    }, []);

    const handleSelectAll = useCallback(() => {
        setSelectedIds(selectableIds);
    }, [selectableIds]);

    const ensureProtectedAccess = useCallback(async (item: TelegramFile, action: string) => {
        if (!item.protected) return true;
        const key = protectedItemKey(item);
        if (unlockedProtectedIds.has(key)) return true;
        const hint = item.protectionHint ? `\nHint: ${item.protectionHint}` : '';
        const pin = window.prompt(`Enter PIN to ${action} "${item.name}".${hint}`);
        if (!pin) return false;
        try {
            await invokeCommand('cmd_unlock_item', { messageId: item.id, itemType: item.type || 'file', pin });
            setUnlockedProtectedIds((current) => {
                const next = new Set(current);
                next.add(key);
                return next;
            });
            return true;
        } catch (e) {
            if (String(e).includes('Protection PIN metadata missing') && action.startsWith('remove protection')) {
                toast.info('PIN metadata is missing. Removing protection so the item can be recovered.');
                return true;
            }
            toast.error(`Unlock failed: ${e}`);
            return false;
        }
    }, [unlockedProtectedIds]);

    const restoreItems = useCallback(async (items: TelegramFile[]) => {
        let restored = 0;
        let failed = 0;
        for (const item of items) {
            try {
                await invokeCommand('cmd_restore_file', { messageId: item.id, itemType: item.type || 'file' });
                restored++;
            } catch {
                failed++;
            }
        }
        queryClient.invalidateQueries({ queryKey: ['files'] });
        await handleSyncFolders();
        if (restored > 0) toast.success(`Restored ${restored} item(s).`);
        if (failed > 0) toast.error(`Failed to restore ${failed} item(s).`);
    }, [handleSyncFolders, queryClient]);

    const handleSelectedDelete = useCallback(async () => {
        if (selectedIds.length === 0) return;

        const selectedItems = displayedFiles.filter((item) => selectedIds.includes(item.id));
        if (selectedItems.length === 0) return;
        for (const item of selectedItems) {
            if (!await ensureProtectedAccess(item, driveView === 'trash' ? 'delete forever' : 'delete')) return;
        }

        if (driveView === 'trash') {
            const ok = await confirm({
                title: "Delete Forever",
                message: `Permanently delete ${selectedItems.length} item(s)? Folder contents will also be deleted forever.`,
                confirmText: "Delete Forever",
                variant: 'danger'
            });
            if (!ok) return;

            let success = 0;
            let fail = 0;
            for (const item of selectedItems) {
                try {
                    await invokeCommand('cmd_permanent_delete_file', { messageId: item.id, itemType: item.type || 'file' });
                    success++;
                } catch {
                    fail++;
                }
            }
            setSelectedIds([]);
            queryClient.invalidateQueries({ queryKey: ['files'] });
            await handleSyncFolders();
            if (success > 0) toast.success(`Permanently deleted ${success} item(s).`);
            if (fail > 0) toast.error(`Failed to delete ${fail} item(s).`);
            return;
        }

        const foldersToDelete = selectedItems.filter((item) => item.type === 'folder');
        if (foldersToDelete.length === 0) {
            handleBulkDelete();
            return;
        }

        const filesToDelete = selectedItems.filter((item) => item.type !== 'folder');
        const ok = await confirm({
            title: "Move to Trash",
            message: `Move ${selectedItems.length} item(s) to Trash? Selected folders will stay restorable with their contents.`,
            confirmText: "Move to Trash",
            variant: 'danger'
        });
        if (!ok) return;

        let success = 0;
        let fail = 0;
        for (const folder of foldersToDelete) {
            try {
                await invokeCommand('cmd_delete_folder', { folderId: folder.id });
                success++;
            } catch {
                fail++;
            }
        }
        for (const file of filesToDelete) {
            try {
                await invokeCommand('cmd_delete_file', { messageId: file.id, folderId: activeFolderId });
                success++;
            } catch {
                fail++;
            }
        }

        if (savedMessagesDefault && success > 0) {
            await invokeCommand('cmd_flush_manifest').catch(() => undefined);
        }
            setSelectedIds([]);
            queryClient.invalidateQueries({ queryKey: ['files'] });
            await handleSyncFolders();
            if (success > 0) {
                toast.success(`Moved ${success} item(s) to Trash.`, {
                    action: {
                        label: 'Undo',
                        onClick: () => {
                            void restoreItems(selectedItems);
                        },
                    },
                });
            }
            if (fail > 0) toast.error(`Failed to move ${fail} item(s).`);
    }, [activeFolderId, confirm, displayedFiles, driveView, ensureProtectedAccess, handleBulkDelete, handleSyncFolders, queryClient, restoreItems, savedMessagesDefault, selectedIds]);

    const handleMoveSelection = useCallback(async (targetFolderId: number | null) => {
        const selectedItems = displayedFiles.filter((item) => selectedIds.includes(item.id));
        if (selectedItems.length === 0) return;
        for (const item of selectedItems) {
            if (!await ensureProtectedAccess(item, 'move')) return;
        }
        const files = selectedItems.filter((item) => item.type !== 'folder').map((item) => item.id);
        const folderIds = selectedItems.filter((item) => item.type === 'folder').map((item) => item.id);
        const conflictStrategy = resolveMoveConflictStrategy(selectedItems, folders, targetFolderId, moveConflictStrategy);
        if (!conflictStrategy) return;
        try {
            if (files.length > 0) {
                await invokeCommand('cmd_move_files', { messageIds: files, targetFolderId, conflictStrategy });
            }
            if (folderIds.length > 0) {
                await invokeCommand('cmd_move_folders', { folderIds, targetParentId: targetFolderId, conflictStrategy });
            }
            if (savedMessagesDefault) await invokeCommand('cmd_flush_manifest').catch(() => undefined);
            setShowMoveModal(false);
            setMoveConflictStrategy('keep_both');
            setSelectedIds([]);
            queryClient.invalidateQueries({ queryKey: ['files'] });
            await handleSyncFolders();
            toast.success(`Moved ${selectedItems.length} item(s).`);
        } catch (e) {
            toast.error(`Move failed: ${e}`);
        }
    }, [displayedFiles, ensureProtectedAccess, folders, handleSyncFolders, moveConflictStrategy, queryClient, savedMessagesDefault, selectedIds]);

    const handleKeyboardDelete = useCallback(() => {
        if (selectedIds.length > 0) {
            void handleSelectedDelete();
        }
    }, [selectedIds, handleSelectedDelete]);

    const handleEscape = useCallback(() => {
        setSelectedIds([]);
        setSearchTerm("");
        setPreviewFile(null);
        setPlayingFile(null);
        setPdfFile(null);
    }, []);

    const handleFocusSearch = useCallback(() => {
        const searchInput = document.querySelector('input[placeholder="Search files..."]') as HTMLInputElement;
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }, []);

    const handleEnter = useCallback(() => {
        void (async () => {
            if (selectedIds.length !== 1) return;
            const selected = displayedFiles.find(f => f.id === selectedIds[0]);
            if (selected) {
                if (selected.type === 'folder') {
                    if (driveView === 'trash' || selected.trashed) {
                        setActiveTrashFolderId(selected.id);
                        setTrashBreadcrumbs((items) => [...items, { id: selected.id, name: selected.name }]);
                        return;
                    }
                    if (!await ensureProtectedAccess(selected, 'open')) return;
                    setActiveFolderId(selected.id);
                } else {
                    handlePreview(selected, displayedFiles);
                }
            }
        })();
    }, [driveView, ensureProtectedAccess, selectedIds, displayedFiles, setActiveFolderId]);

    useKeyboardShortcuts({
        onSelectAll: handleSelectAll,
        onDelete: handleKeyboardDelete,
        onEscape: handleEscape,
        onSearch: handleFocusSearch,
        onEnter: handleEnter,
        enabled: !previewFile && !playingFile && !pdfFile && !showMoveModal && !showTools && !tagTarget // Disable when modals are open
    });


    useEffect(() => {
        setSelectedIds([]);
        setShowMoveModal(false);
        setMoveConflictStrategy('keep_both');
        setSearchTerm("");
        setSearchResults([]);
        setPreviewFile(null);
        setPlayingFile(null);
        setPdfFile(null);
        setPreviewContextFiles([]);
        setPreviewContextIndex(-1);
        if (driveView !== 'trash') {
            setActiveTrashFolderId(null);
            setTrashBreadcrumbs([]);
        }
    }, [activeFolderId, driveView]);


    useEffect(() => {
        if (searchTerm.length <= 2) {
            setSearchResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearching(true);
            if (searchScope === 'current') {
                setSearchResults(currentFolderItems.filter((file) => file.name.toLowerCase().includes(searchTerm.toLowerCase())));
            } else if (driveView === 'trash' || driveView === 'recent') {
                const command = driveView === 'trash'
                    ? 'cmd_get_trash_files'
                    : 'cmd_get_recent_items';
                const results = await invokeCommand<any[]>(command, { query: searchTerm, folderId: driveView === 'trash' ? activeTrashFolderId : undefined });
                setSearchResults(results.map((file) => ({
                    ...file,
                    sizeStr: file.sizeStr || formatBytes(file.size || 0),
                    type: file.icon_type || file.type || 'file',
                })) as TelegramFile[]);
            } else {
                const results = await handleGlobalSearch(searchTerm);
                setSearchResults(results);
            }
            setIsSearching(false);
        }, 500);

        return () => clearTimeout(timer);
    }, [activeTrashFolderId, currentFolderItems, driveView, handleGlobalSearch, searchScope, searchTerm]);




    const handleFileClick = async (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        const clicked = displayedFiles.find(f => f.id === id);
        if (e.metaKey || e.ctrlKey) {
            setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
            return;
        }
        if (clicked?.type === 'folder') {
            if (driveView === 'trash' || clicked.trashed) {
                setActiveTrashFolderId(id);
                setTrashBreadcrumbs((items) => [...items, { id, name: clicked.name }]);
                setSelectedIds([]);
                return;
            }
            if (!await ensureProtectedAccess(clicked, 'open')) return;
            setActiveFolderId(id);
        } else {
            setSelectedIds([id]);
        }
    }

    const handleToggleSelection = useCallback((id: number) => {
        setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
    }, []);

    const handlePreview = async (file: TelegramFile, orderedFiles?: TelegramFile[]) => {
        if (file.type === 'folder') {
            if (driveView === 'trash' || file.trashed) {
                setActiveTrashFolderId(file.id);
                setTrashBreadcrumbs((items) => [...items, { id: file.id, name: file.name }]);
                setSelectedIds([]);
                return;
            }
            if (!await ensureProtectedAccess(file, 'open')) return;
            setActiveFolderId(file.id);
            return;
        }

        const contextFiles = (orderedFiles || displayedFiles).filter((f) => f.type !== 'folder');
        const contextIndex = contextFiles.findIndex((f) => f.id === file.id);

        setPreviewContextFiles(contextFiles);
        setPreviewContextIndex(contextIndex);

        const isMedia = isMediaFile(file);
        const isPdf = isPdfFile(file);

        if (isMedia) {
            setPlayingFile(file);
            setPreviewFile(null);
            setPdfFile(null);
        } else if (isPdf) {
            setPdfFile(file);
            setPreviewFile(null);
            setPlayingFile(null);
        } else {
            setPreviewFile(file);
            setPlayingFile(null);
            setPdfFile(null);
        }
    };

    const navigatePreview = useCallback((step: 1 | -1) => {
        if (previewContextFiles.length === 0) return;

        const currentFileId = previewFile?.id ?? playingFile?.id ?? pdfFile?.id;
        if (!currentFileId) return;

        const currentIndex = previewContextFiles.findIndex((f) => f.id === currentFileId);
        if (currentIndex === -1) return;

        const nextIndex = (currentIndex + step + previewContextFiles.length) % previewContextFiles.length;
        const nextFile = previewContextFiles[nextIndex];
        if (!nextFile) return;

        setPreviewContextIndex(nextIndex);

        const isMedia = isMediaFile(nextFile);
        const isPdf = isPdfFile(nextFile);

        if (isMedia) {
            setPlayingFile(nextFile);
            setPreviewFile(null);
            setPdfFile(null);
        } else if (isPdf) {
            setPdfFile(nextFile);
            setPreviewFile(null);
            setPlayingFile(null);
        } else {
            setPreviewFile(nextFile);
            setPlayingFile(null);
            setPdfFile(null);
        }
    }, [previewContextFiles, previewFile, playingFile, pdfFile]);

    const handleNextPreview = useCallback(() => {
        navigatePreview(1);
    }, [navigatePreview]);

    const handlePrevPreview = useCallback(() => {
        navigatePreview(-1);
    }, [navigatePreview]);

    const previewNeighborFiles = useCallback(() => {
        if (previewContextFiles.length === 0) {
            return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        }

        const currentFileId = previewFile?.id ?? playingFile?.id ?? pdfFile?.id;
        if (!currentFileId) {
            return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        }

        const currentIdx = previewContextFiles.findIndex((f) => f.id === currentFileId);
        if (currentIdx === -1) {
            return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        }

        const nextIdx = (currentIdx + 1) % previewContextFiles.length;
        const prevIdx = (currentIdx - 1 + previewContextFiles.length) % previewContextFiles.length;

        return {
            nextFile: previewContextFiles[nextIdx] || null,
            prevFile: previewContextFiles[prevIdx] || null,
        };
    }, [previewContextFiles, previewFile, playingFile, pdfFile]);

    const handleDropOnFolder = async (e: React.DragEvent, targetFolderId: number | null) => {
        e.preventDefault();
        e.stopPropagation();

        const dataTransferFileId = e.dataTransfer.getData("application/x-telegram-file-id");

        const fileId = internalDragRef.current || (dataTransferFileId ? parseInt(dataTransferFileId) : null);

        if (fileId) {
            try {
                const idsToMove = selectedIds.includes(fileId) ? selectedIds : [fileId];
                const selectedItems = displayedFiles
                    .filter((item) => idsToMove.includes(item.id))
                    .filter((item) => (item.folderId ?? null) !== targetFolderId);
                if (selectedItems.length === 0) {
                    setInternalDragFileId(null);
                    return;
                }
                for (const item of selectedItems) {
                    if (!await ensureProtectedAccess(item, 'move')) return;
                }
                const folderIds = selectedItems.filter((item) => item.type === 'folder').map((item) => item.id);
                const filesBySourceFolder = new Map<number | null, number[]>();
                for (const item of selectedItems.filter((item) => item.type !== 'folder')) {
                    const sourceFolderId = item.folderId ?? null;
                    filesBySourceFolder.set(sourceFolderId, [...(filesBySourceFolder.get(sourceFolderId) || []), item.id]);
                }

                if (folderIds.length > 0) {
                    await invokeCommand('cmd_move_folders', { folderIds, targetParentId: targetFolderId, conflictStrategy: 'keep_both' });
                }
                for (const [sourceFolderId, messageIds] of filesBySourceFolder) {
                    await invokeCommand('cmd_move_files', {
                        messageIds,
                        sourceFolderId,
                        targetFolderId: targetFolderId,
                        conflictStrategy: 'keep_both'
                    });
                }

                queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
                if (savedMessagesDefault) await invokeCommand('cmd_flush_manifest').catch(() => undefined);
                await handleSyncFolders();

                if (selectedIds.includes(fileId)) setSelectedIds([]);

                toast.success(`Moved ${selectedItems.length} item(s).`);

                setInternalDragFileId(null);
            } catch {
                toast.error(`Failed to move item(s).`);
            }
        }
    }

    const currentFolderName = driveView === 'recent'
            ? "Recent"
        : driveView === 'gallery'
            ? "Gallery"
            : driveView === 'media'
                ? "Media"
        : driveView === 'trash'
            ? trashBreadcrumbs.length > 0 ? `Trash / ${trashBreadcrumbs.map((item) => item.name).join(' / ')}` : "Trash"
            : activeFolderId === null
                ? "Saved Messages"
                : getFolderPath(activeFolderId, folders) || "Folder";

    const handleOpenFolderId = useCallback(async (id: number | null) => {
        if (id === null) {
            await setActiveFolderId(null);
            return;
        }
        const folder = folders.find((item) => item.id === id);
        if (folder && !await ensureProtectedAccess(folderToExplorerItem(folder), 'open')) return;
        await setActiveFolderId(id);
    }, [ensureProtectedAccess, folders, setActiveFolderId]);

    const breadcrumbs = useMemo(() => {
        const start = { label: 'Start', onClick: () => { setDriveView('files'); void handleOpenFolderId(null); } };
        if (driveView === 'trash') {
            return [
                start,
                { label: 'Trash', onClick: () => { setActiveTrashFolderId(null); setTrashBreadcrumbs([]); } },
                ...trashBreadcrumbs.map((item, index) => ({
                    label: item.name,
                    onClick: () => {
                        setActiveTrashFolderId(item.id);
                        setTrashBreadcrumbs((items) => items.slice(0, index + 1));
                    },
                })),
            ];
        }
        if (driveView !== 'files') return [start, { label: currentFolderName }];
        return [
            start,
            ...getFolderBreadcrumbs(activeFolderId, folders).map((item) => ({
                label: item.name,
                onClick: () => { void handleOpenFolderId(item.id); },
            })),
        ];
    }, [activeFolderId, currentFolderName, driveView, folders, handleOpenFolderId, trashBreadcrumbs]);


    const handleRootDragOver = (e: React.DragEvent) => {
        if (internalDragRef.current) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
        }
    };

    const handleRootDragEnter = (e: React.DragEvent) => {
        if (internalDragRef.current) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
        }
    };

    const previewNeighbors = previewNeighborFiles();

    const handleManualFolderUpload = useCallback(async () => {
        if (isDesktopRuntime && !savedMessagesDefault) {
            toast.info("Folder upload is available in browser Telegram mode.");
            return;
        }

        const files = await pickBrowserDirectoryFiles();
        if (files.length === 0) return;

        const folderName = getSelectedDirectoryName(files) || "Uploaded Folder";
        let knownFolders = [...folders];
        const findKnownFolder = (name: string, parentId: number | null) => {
            return knownFolders.find((folder) => folder.name === name && getFolderParentId(folder) === parentId);
        };
        const getOrCreateFolder = async (name: string, parentId: number | null) => {
            let folder = findKnownFolder(name, parentId);
            if (folder) return folder;

            folder = await handleCreateFolder(name, parentId, true);
            knownFolders = mergeFolders([...knownFolders, folder]);
            return folder;
        };

        const uploadParentId = activeFolderId;
        const rootFolder = await getOrCreateFolder(folderName, uploadParentId);
        const uploadEntries: { file: File; folderId: number | null }[] = [];

        for (const file of files) {
            const relativePath = getBrowserRelativePath(file);
            const pathParts = relativePath.split('/').filter(Boolean);
            const directoryParts = pathParts.length > 1 ? pathParts.slice(0, -1) : [folderName];
            let targetFolder = rootFolder;

            for (const directoryName of directoryParts.slice(1)) {
                targetFolder = await getOrCreateFolder(directoryName, targetFolder.id);
            }

            uploadEntries.push({ file, folderId: targetFolder.id });
        }

        await setActiveFolderId(rootFolder.id);
        setDriveView('files');
        queueFileEntries(uploadEntries);
        toast.success(`Folder structure ready: ${uploadEntries.length} file(s), ${knownFolders.length - folders.length} new folder(s).`);
    }, [activeFolderId, folders, handleCreateFolder, isDesktopRuntime, queueFileEntries, savedMessagesDefault, setActiveFolderId]);

    const handleExplorerDelete = useCallback(async (id: number) => {
        const folder = folders.find(f => f.id === id);
        if (folder) {
            if (!await ensureProtectedAccess(folderToExplorerItem(folder), 'delete')) return;
            handleFolderDelete(folder.id, folder.name);
            return;
        }
        if (driveView === 'trash') {
            const file = displayedFiles.find(f => f.id === id);
            if (!file) return;
            if (!await ensureProtectedAccess(file, 'delete forever')) return;
            const ok = await confirm({
                title: "Delete Forever",
                message: `Permanently delete "${file.name}"? This cannot be restored by Telegram Drive.`,
                confirmText: "Delete Forever",
                variant: 'danger'
            });
            if (!ok) return;
            try {
                await invokeCommand('cmd_permanent_delete_file', { messageId: id, itemType: file.type || 'file' });
                queryClient.invalidateQueries({ queryKey: ['files'] });
                await handleSyncFolders();
                toast.success(file.type === 'folder' ? "Folder permanently deleted" : "File permanently deleted");
            } catch (e) {
                toast.error(`Permanent delete failed: ${e}`);
            }
            return;
        }
        const file = displayedFiles.find(f => f.id === id);
        if (file && !await ensureProtectedAccess(file, 'delete')) return;
        handleDelete(id);
    }, [confirm, displayedFiles, driveView, ensureProtectedAccess, folders, handleDelete, handleFolderDelete, handleSyncFolders, queryClient]);

    const handleExplorerDownload = useCallback((id: number, name: string) => {
        const item = displayedFiles.find(f => f.id === id);
        if (item?.type === 'folder') {
            if (driveView === 'trash' || item.trashed) {
                toast.info("Restore the folder before downloading its contents.");
                return;
            }
            void ensureProtectedAccess(item, 'open').then((ok) => {
                if (!ok) return;
                void setActiveFolderId(id);
                toast.info("Opened folder. Use Download All Files for its contents.");
            });
            return;
        }
        queueDownload(id, name, activeFolderId);
    }, [activeFolderId, displayedFiles, driveView, ensureProtectedAccess, queueDownload, setActiveFolderId]);

    const handleRepairDrive = useCallback(async () => {
        if (!savedMessagesDefault) {
            toast.info("Repair is available for Telegram Saved Messages storage.");
            return;
        }

        setIsRepairingDrive(true);
        try {
            const result = await invokeCommand<{
                indexed: number;
                refreshed: number;
                missing: number;
                folders: number;
                files: number;
                snapshotsKept: number;
            }>('cmd_repair_manifest');
            await handleSyncFolders();
            queryClient.invalidateQueries({ queryKey: ['files'] });
            toast.success(`Index repaired: ${result.files} file record(s), ${result.folders} folder(s), ${result.snapshotsKept} snapshots kept.`);
        } catch (e) {
            toast.error(`Repair failed: ${e}`);
        } finally {
            setIsRepairingDrive(false);
        }
    }, [handleSyncFolders, queryClient, savedMessagesDefault]);

    const handleSelectedBulkDownload = useCallback(() => {
        if (selectedFileCount === 0) {
            toast.info("Select at least one file to download.");
            return;
        }
        void handleBulkDownload();
    }, [handleBulkDownload, selectedFileCount]);

    const handleSelectedBulkTag = useCallback(() => {
        if (selectedFileCount === 0) {
            toast.info("Select at least one file to tag.");
            return;
        }
        setTagTarget('bulk');
    }, [selectedFileCount]);

    const handleSaveTags = useCallback(async (tags: string[]) => {
        const target = tagTarget;
        if (!target) return;

        const targets = target === 'bulk'
            ? displayedFileItems.filter((file) => selectedIds.includes(file.id))
            : [target];

        try {
            await Promise.all(targets.map((file) => invokeCommand('cmd_set_tags', { messageId: file.id, tags })));
            queryClient.invalidateQueries({ queryKey: ['files'] });
            toast.success(`Updated tags for ${targets.length} file(s).`);
            setTagTarget(null);
            if (target === 'bulk') setSelectedIds([]);
        } catch (e) {
            toast.error(`Tag update failed: ${e}`);
        }
    }, [displayedFileItems, queryClient, selectedIds, tagTarget]);

    const handleVerifyFile = useCallback(async (file: TelegramFile) => {
        try {
            const result = await invokeCommand<{ valid: boolean }>('cmd_verify_file', { messageId: file.id });
            queryClient.invalidateQueries({ queryKey: ['files'] });
            toast.success(result.valid ? 'Checksum verified' : 'Checksum mismatch detected');
        } catch (e) {
            toast.error(`Verify failed: ${e}`);
        }
    }, [queryClient]);

    const handleRenameItem = useCallback(async (file: TelegramFile) => {
        if (!await ensureProtectedAccess(file, 'rename')) return;
        const nextName = window.prompt('Rename', file.name)?.trim();
        if (!nextName || nextName === file.name) return;
        try {
            await invokeCommand('cmd_rename_item', { messageId: file.id, itemType: file.type || 'file', name: nextName });
            queryClient.invalidateQueries({ queryKey: ['files'] });
            await handleSyncFolders();
            toast.success(`Renamed to "${nextName}"`);
        } catch (e) {
            toast.error(`Rename failed: ${e}`);
        }
    }, [ensureProtectedAccess, handleSyncFolders, queryClient]);

    const handleCreateFolderHere = useCallback(async () => {
        if (driveView !== 'files') {
            toast.info("Open Saved Messages or a folder to create a folder.");
            return;
        }
        const name = window.prompt('New folder name', 'New Folder')?.trim();
        if (!name) return;
        try {
            await handleCreateFolder(name, activeFolderId);
            queryClient.invalidateQueries({ queryKey: ['files'] });
            await handleSyncFolders();
        } catch {
            // hook already shows the error
        }
    }, [activeFolderId, driveView, handleCreateFolder, handleSyncFolders, queryClient]);

    const handleCopyItem = useCallback(async (file: TelegramFile) => {
        if (!await ensureProtectedAccess(file, 'copy')) return;
        const toastId = toast.loading(`Copying "${file.name}"...`);
        try {
            await invokeCommand('cmd_copy_item', {
                messageId: file.id,
                itemType: file.type || 'file',
                targetFolderId: file.folderId === undefined ? activeFolderId : file.folderId,
            });
            queryClient.invalidateQueries({ queryKey: ['files'] });
            await handleSyncFolders();
            toast.success(`Copied "${file.name}".`, { id: toastId });
        } catch (e) {
            toast.error(`Copy failed: ${e}`, { id: toastId });
        }
    }, [activeFolderId, ensureProtectedAccess, handleSyncFolders, queryClient]);

    const handleMergeFolder = useCallback(async (file: TelegramFile) => {
        if (file.type !== 'folder') return;
        if (!await ensureProtectedAccess(file, 'merge')) return;
        setSelectedIds([file.id]);
        setMoveConflictStrategy('merge');
        setShowMoveModal(true);
        toast.info('Choose a destination. Same-name folders will be merged.');
    }, [ensureProtectedAccess]);

    const handleToggleLock = useCallback(async (file: TelegramFile) => {
        if (!await ensureProtectedAccess(file, file.locked ? 'unlock' : 'lock')) return;
        try {
            await invokeCommand('cmd_toggle_lock', { messageId: file.id, itemType: file.type || 'file', locked: !file.locked });
            queryClient.invalidateQueries({ queryKey: ['files'] });
            await handleSyncFolders();
            toast.success(file.locked ? 'Unlocked item.' : 'Locked item.');
        } catch (e) {
            toast.error(`Lock update failed: ${e}`);
        }
    }, [ensureProtectedAccess, handleSyncFolders, queryClient]);

    const handleToggleProtection = useCallback(async (file: TelegramFile) => {
        if (file.protected) {
            if (!await ensureProtectedAccess(file, 'remove protection from')) return;
            try {
                await invokeCommand('cmd_set_protection', { messageId: file.id, itemType: file.type || 'file', protected: false });
                setUnlockedProtectedIds((current) => {
                    const next = new Set(current);
                    next.delete(protectedItemKey(file));
                    return next;
                });
                queryClient.invalidateQueries({ queryKey: ['files'] });
                await handleSyncFolders();
                toast.success('Protection removed.');
            } catch (e) {
                toast.error(`Protection update failed: ${e}`);
            }
            return;
        }

        const pin = window.prompt(`Set a PIN for "${file.name}"`);
        if (!pin) return;
        if (pin.trim().length < 4) {
            toast.error('Use at least 4 characters for the PIN.');
            return;
        }
        const protectionHint = window.prompt('Optional PIN hint') || undefined;
        try {
            await invokeCommand('cmd_set_protection', {
                messageId: file.id,
                itemType: file.type || 'file',
                pin,
                protectionHint,
                protected: true,
            });
            setUnlockedProtectedIds((current) => {
                const next = new Set(current);
                next.delete(protectedItemKey(file));
                return next;
            });
            queryClient.invalidateQueries({ queryKey: ['files'] });
            await handleSyncFolders();
            toast.success('Protection enabled.');
        } catch (e) {
            toast.error(`Protection update failed: ${e}`);
        }
    }, [ensureProtectedAccess, handleSyncFolders, queryClient]);

    const handleFolderColor = useCallback(async (file: TelegramFile, color: string) => {
        if (file.type !== 'folder') return;
        try {
            await invokeCommand('cmd_set_folder_color', { folderId: file.id, color });
            queryClient.invalidateQueries({ queryKey: ['files'] });
            await handleSyncFolders();
            toast.success('Folder color updated.');
        } catch (e) {
            toast.error(`Color update failed: ${e}`);
        }
    }, [handleSyncFolders, queryClient]);

    const handleShowVersions = useCallback(async (file: TelegramFile) => {
        if (file.type === 'folder') return;
        try {
            const versions = await invokeCommand<TelegramFile[]>('cmd_get_file_versions', { messageId: file.id });
            const lines = versions.map((item) => `v${item.version || 1} - ${item.created_at || item.name}`).join('\n');
            window.alert(lines || 'No version history yet.');
        } catch (e) {
            toast.error(`Version history failed: ${e}`);
        }
    }, []);

    const handleDataChanged = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['files'] });
        queryClient.invalidateQueries({ queryKey: ['bandwidth'] });
        handleSyncFolders();
    }, [handleSyncFolders, queryClient]);

    const handleAddAccount = useCallback(async () => {
        await invokeCommand('cmd_prepare_add_account').catch(() => undefined);
        if (store) {
            await store.set('auth_complete', false);
            await store.set('activeFolderId', null);
            await store.save();
        }
        onLogout();
    }, [onLogout, store]);

    const handleRestoreFile = useCallback(async (file: TelegramFile) => {
        try {
            await restoreItems([file]);
        } catch (e) {
            toast.error(`Restore failed: ${e}`);
        }
    }, [restoreItems]);

    const handleSelectedRestore = useCallback(async () => {
        const selectedItems = displayedFiles.filter((item) => selectedIds.includes(item.id));
        if (selectedItems.length === 0) return;
        await restoreItems(selectedItems);
        setSelectedIds([]);
    }, [displayedFiles, restoreItems, selectedIds]);

    return (
        <div
            className="flex h-screen w-full overflow-hidden bg-telegram-bg relative"
            onClick={() => setSelectedIds([])}
            onDragOver={handleRootDragOver}
            onDragEnter={handleRootDragEnter}
        >

            <ExternalDropBlocker
                onUploadClick={driveView === 'files' ? handleManualUpload : () => toast.info("Open Saved Messages or a folder to upload.")}
                onFilesDropped={driveView === 'files' && !(isDesktopRuntime && !savedMessagesDefault) ? handleDroppedFiles : undefined}
            />

            <AnimatePresence>
                {showMoveModal && (
                    <MoveToFolderModal
                        folders={folders}
                        onClose={() => { setShowMoveModal(false); setMoveConflictStrategy('keep_both'); }}
                        onSelect={handleMoveSelection}
                        activeFolderId={activeFolderId}
                        excludedFolderIds={displayedFiles.filter((item) => item.type === 'folder' && selectedIds.includes(item.id)).map((item) => item.id)}
                        key="move-modal"
                    />
                )}
                {playingFile && (
                    <MediaPlayer
                        file={playingFile}
                        onClose={() => setPlayingFile(null)}
                        onNext={handleNextPreview}
                        onPrev={handlePrevPreview}
                        currentIndex={previewContextIndex}
                        totalItems={previewContextFiles.length}
                        activeFolderId={activeFolderId}
                        key="media-player"
                    />
                )}
                {pdfFile && (
                    <PdfViewer
                        file={pdfFile}
                        onClose={() => setPdfFile(null)}
                        onNext={handleNextPreview}
                        onPrev={handlePrevPreview}
                        currentIndex={previewContextIndex}
                        totalItems={previewContextFiles.length}
                        activeFolderId={activeFolderId}
                        key="pdf-viewer"
                    />
                )}
                {isDragging && internalDragFileId === null && <DragDropOverlay key="drag-drop-overlay" />}
                {showTools && (
                    <DriveToolsModal
                        key="drive-tools"
                        watchFolder={watchFolder}
                        selectedCount={selectedIds.length}
                        onClose={() => setShowTools(false)}
                        onDataChanged={handleDataChanged}
                        onAddAccount={handleAddAccount}
                    />
                )}
                {tagTarget && (
                    <TagEditorModal
                        key="tag-editor"
                        title={tagTarget === 'bulk' ? `Tag ${selectedFileCount} Selected File(s)` : `Tags for ${tagTarget.name}`}
                        initialTags={tagTarget === 'bulk' ? [] : tagTarget.tags || []}
                        onSave={handleSaveTags}
                        onClose={() => setTagTarget(null)}
                    />
                )}
            </AnimatePresence>

            <Sidebar
                folders={folders}
                activeFolderId={activeFolderId}
                setActiveFolderId={(id) => { void handleOpenFolderId(id); }}
                activeDriveView={driveView}
                onDriveViewChange={setDriveView}
                onDrop={handleDropOnFolder}
                onDelete={(id, name) => {
                    const folder = folders.find((item) => item.id === id);
                    void (async () => {
                        if (folder && !await ensureProtectedAccess(folderToExplorerItem(folder), 'delete')) return;
                        await handleFolderDelete(id, name);
                    })();
                }}
                onCreate={handleCreateFolder}
                isSyncing={isSyncing}
                isConnected={isConnected}
                onSync={handleSyncFolders}
                onLogout={handleLogout}
                bandwidth={bandwidth || null}
                connectionLabel={isDesktopRuntime ? undefined : savedMessagesDefault ? 'Telegram Saved Messages' : 'Browser storage ready'}
            />

            <main className="flex-1 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) setSelectedIds([]); }}>
                <TopBar
                    currentFolderName={currentFolderName}
                    breadcrumbs={breadcrumbs}
                    selectedIds={selectedIds}
                    onSelectAll={handleSelectAll}
                    onClearSelection={handleClearSelection}
                    allSelected={allDisplayedSelected}
                    selectableCount={selectableIds.length}
                    onShowMoveModal={() => { setMoveConflictStrategy('keep_both'); setShowMoveModal(true); }}
                    onCreateFolder={driveView === 'files' ? handleCreateFolderHere : undefined}
                    onBulkDownload={handleSelectedBulkDownload}
                    onBulkDelete={handleSelectedDelete}
                    onBulkRestore={driveView === 'trash' ? handleSelectedRestore : undefined}
                    onDownloadFolder={handleDownloadFolder}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    searchScope={searchScope}
                    onSearchScopeChange={setSearchScope}
                    savedMessagesOnly={driveView !== 'files'}
                    onBulkTag={handleSelectedBulkTag}
                    onOpenTools={() => setShowTools(true)}
                    onRepairDrive={savedMessagesDefault ? handleRepairDrive : undefined}
                    isRepairing={isRepairingDrive}
                />
                {searchTerm.length > 2 && (
                    <div className="px-6 pt-4 pb-0">
                        <h2 className="text-sm font-medium text-telegram-subtext">
                            Search Results for <span className="text-telegram-primary">"{searchTerm}"</span>
                        </h2>
                    </div>
                )}
                <FileExplorer

                    files={displayedFiles}
                    loading={isLoading || isSearching}
                    error={error}
                    viewMode={viewMode}
                    selectedIds={selectedIds}
                    activeFolderId={activeFolderId}
                    onFileClick={handleFileClick}
                    onDelete={handleExplorerDelete}
                    onDownload={handleExplorerDownload}
                    onPreview={handlePreview}
                    onManualUpload={handleManualUpload}
                    onManualFolderUpload={handleManualFolderUpload}
                    onCreateFolder={handleCreateFolderHere}
                    allowUpload={driveView === 'files'}
                    onSelectionClear={() => setSelectedIds([])}
                    onToggleSelection={handleToggleSelection}
                    onDrop={handleDropOnFolder}
                    onDragStart={(fileId) => setInternalDragFileId(fileId)}
                    onDragEnd={() => setTimeout(() => setInternalDragFileId(null), 50)}
                    onRestore={handleRestoreFile}
                    onEditTags={(file) => setTagTarget(file)}
                    onVerify={handleVerifyFile}
                    onRename={handleRenameItem}
                    onSetFolderColor={handleFolderColor}
                    onShowVersions={handleShowVersions}
                    onCopy={handleCopyItem}
                    onMergeFolder={handleMergeFolder}
                    onToggleLock={handleToggleLock}
                    onToggleProtection={handleToggleProtection}
                />
            </main>

            {previewFile && (
                <PreviewModal
                    file={previewFile}
                    activeFolderId={activeFolderId}
                    onClose={() => setPreviewFile(null)}
                    onNext={handleNextPreview}
                    onPrev={handlePrevPreview}
                    currentIndex={previewContextIndex}
                    totalItems={previewContextFiles.length}
                    nextFile={previewNeighbors.nextFile}
                    prevFile={previewNeighbors.prevFile}
                />
            )}


            <UploadQueue
                items={uploadQueue}
                onClearFinished={() => setUploadQueue(q => q.filter(i => i.status !== 'success' && i.status !== 'error' && i.status !== 'cancelled'))}
                onCancelAll={cancelUploads}
                onRetryFailed={retryFailedUploads}
            />
            <DownloadQueue
                items={downloadQueue}
                onClearFinished={clearDownloads}
                onCancelAll={cancelDownloads}
                onRetryFailed={retryFailedDownloads}
            />
        </div>
    );
}

function pickBrowserDirectoryFiles(): Promise<File[]> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.style.display = 'none';
        input.setAttribute('webkitdirectory', 'true');
        input.onchange = () => {
            const files = input.files ? Array.from(input.files) : [];
            input.remove();
            resolve(files);
        };
        document.body.appendChild(input);
        input.click();
    });
}

function getSelectedDirectoryName(files: File[]): string | null {
    const first = files[0] as File & { webkitRelativePath?: string };
    const relativePath = first?.webkitRelativePath;
    if (!relativePath) return null;
    return relativePath.split('/')[0] || null;
}

function getBrowserRelativePath(file: File): string {
    return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function getFolderParentId(folder: TelegramFolder): number | null {
    return folder.parent_id ?? null;
}

function folderToExplorerItem(folder: TelegramFolder): TelegramFile {
    return {
        id: folder.id,
        name: folder.name,
        size: folder.size || 0,
        sizeStr: folder.itemCount ? `${folder.itemCount} item${folder.itemCount === 1 ? '' : 's'}` : (folder.sizeStr || 'Folder'),
        created_at: folder.deletedAt ? new Date(folder.deletedAt).toLocaleString() : '',
        type: 'folder',
        folderId: folder.parent_id ?? null,
        color: folder.color,
        locked: folder.locked || false,
        protected: folder.protected || false,
        protectionHint: folder.protectionHint,
        trashed: folder.trashed || false,
        deletedAt: folder.deletedAt,
    };
}

function getFolderBreadcrumbs(folderId: number | null, folders: TelegramFolder[]): { id: number | null; name: string }[] {
    if (folderId === null) return [{ id: null, name: 'Saved Messages' }];
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const crumbs: { id: number | null; name: string }[] = [{ id: null, name: 'Saved Messages' }];
    const stack: TelegramFolder[] = [];
    let current = byId.get(folderId);
    const seen = new Set<number>();
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        stack.unshift(current);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return [...crumbs, ...stack.map((folder) => ({ id: folder.id, name: folder.name }))];
}

function getFolderPath(folderId: number, folders: TelegramFolder[]): string {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const names: string[] = [];
    let current = byId.get(folderId);
    const seen = new Set<number>();

    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        names.unshift(current.name);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }

    return names.join(' / ');
}

function mergeFolders(folders: TelegramFolder[]): TelegramFolder[] {
    const byId = new Map<number, TelegramFolder>();
    for (const folder of folders) {
        byId.set(folder.id, folder);
    }
    return Array.from(byId.values());
}

function protectedItemKey(item: TelegramFile): string {
    return `${item.type === 'folder' ? 'folder' : 'file'}:${item.id}`;
}

function resolveMoveConflictStrategy(
    selectedItems: TelegramFile[],
    folders: TelegramFolder[],
    targetFolderId: number | null,
    preferred: MoveConflictStrategy
): MoveConflictStrategy | null {
    if (preferred === 'merge') return 'merge';
    const selectedFolders = selectedItems.filter((item) => item.type === 'folder');
    const hasFolderConflict = selectedFolders.some((item) => folders.some((folder) => (
        folder.id !== item.id
        && !folder.trashed
        && (folder.parent_id ?? null) === targetFolderId
        && folder.name.toLowerCase() === item.name.toLowerCase()
    )));
    if (!hasFolderConflict) return preferred;

    const choice = window.prompt(
        'A folder with the same name already exists there. Type one option: keep, merge, replace, skip',
        preferred === 'replace' ? 'replace' : 'keep'
    )?.trim().toLowerCase();
    if (!choice) return null;
    if (choice === 'merge') return 'merge';
    if (choice === 'replace') return 'replace';
    if (choice === 'skip') return 'skip';
    return 'keep_both';
}
