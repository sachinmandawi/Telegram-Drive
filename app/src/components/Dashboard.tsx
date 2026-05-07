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
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [showMoveModal, setShowMoveModal] = useState(false);
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
        queryKey: ['files', driveView, activeFolderId],
        queryFn: () => {
            const command = driveView === 'starred'
                ? 'cmd_get_starred_files'
                : driveView === 'trash'
                    ? 'cmd_get_trash_files'
                    : 'cmd_get_files';
            const args = driveView === 'files' ? { folderId: activeFolderId } : {};
            return invokeCommand<any[]>(command, args).then(res => res.map(f => ({
            ...f,
            sizeStr: formatBytes(f.size),
            type: f.icon_type || (f.name.endsWith('/') ? 'folder' : 'file')
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

    const { data: bandwidth } = useQuery({
        queryKey: ['bandwidth'],
        queryFn: () => invokeCommand<BandwidthStats>('cmd_get_bandwidth'),
        refetchInterval: 5000,
        enabled: !!store
    });


    const {
        handleDelete, handleBulkDelete, handleBulkDownload,
        handleBulkMove, handleDownloadFolder, handleGlobalSearch

    } = useFileOperations(activeFolderId, selectedIds, setSelectedIds, displayedFileItems);

    const { uploadQueue, setUploadQueue, handleManualUpload, handleDroppedFiles, queueFileEntries, cancelAll: cancelUploads, retryFailed: retryFailedUploads, isDragging } = useFileUpload(activeFolderId, store);
    const { downloadQueue, queueDownload, clearFinished: clearDownloads, cancelAll: cancelDownloads, retryFailed: retryFailedDownloads } = useFileDownload(store);
    const watchFolder = useWatchFolderSync(activeFolderId, store, queueFileEntries);


    const handleSelectAll = useCallback(() => {
        setSelectedIds(displayedFiles.filter(f => f.type !== 'folder').map(f => f.id));
    }, [displayedFiles]);

    const handleKeyboardDelete = useCallback(() => {
        if (selectedIds.length > 0) {
            handleBulkDelete();
        }
    }, [selectedIds, handleBulkDelete]);

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
        if (selectedIds.length === 1) {
            const selected = displayedFiles.find(f => f.id === selectedIds[0]);
            if (selected) {
                if (selected.type === 'folder') {
                    setActiveFolderId(selected.id);
                } else {
                    handlePreview(selected, displayedFiles);
                }
            }
        }
    }, [selectedIds, displayedFiles, setActiveFolderId]);

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
        setSearchTerm("");
        setSearchResults([]);
        setPreviewFile(null);
        setPlayingFile(null);
        setPdfFile(null);
        setPreviewContextFiles([]);
        setPreviewContextIndex(-1);
    }, [activeFolderId, driveView]);


    useEffect(() => {
        if (searchTerm.length <= 2) {
            setSearchResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearching(true);
            if (driveView === 'trash' || driveView === 'starred') {
                const command = driveView === 'trash' ? 'cmd_get_trash_files' : 'cmd_get_starred_files';
                const results = await invokeCommand<any[]>(command, { query: searchTerm });
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
    }, [driveView, handleGlobalSearch, searchTerm]);




    const handleFileClick = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        const clicked = displayedFiles.find(f => f.id === id);
        if (clicked?.type === 'folder') {
            setActiveFolderId(id);
            return;
        }
        if (e.metaKey || e.ctrlKey) {
            setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
        } else {
            setSelectedIds([id]);
        }
    }

    const handleToggleSelection = useCallback((id: number) => {
        const item = displayedFiles.find(f => f.id === id);
        if (item?.type === 'folder') return;
        setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
    }, [displayedFiles]);

    const handlePreview = (file: TelegramFile, orderedFiles?: TelegramFile[]) => {
        if (file.type === 'folder') {
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

        if (activeFolderId === targetFolderId) return;

        const fileId = internalDragRef.current || (dataTransferFileId ? parseInt(dataTransferFileId) : null);

        if (fileId) {
            try {
                const idsToMove = selectedIds.includes(fileId) ? selectedIds : [fileId];

                await invokeCommand('cmd_move_files', {
                    messageIds: idsToMove,
                    sourceFolderId: activeFolderId,
                    targetFolderId: targetFolderId
                });

                queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });

                if (selectedIds.includes(fileId)) setSelectedIds([]);

                toast.success(`Moved ${idsToMove.length} file(s).`);

                setInternalDragFileId(null);
            } catch {
                toast.error(`Failed to move file(s).`);
            }
        }
    }

    const currentFolderName = driveView === 'starred'
        ? "Starred"
        : driveView === 'gallery'
            ? "Gallery"
            : driveView === 'media'
                ? "Media"
        : driveView === 'trash'
            ? "Trash"
            : activeFolderId === null
                ? "Saved Messages"
                : getFolderPath(activeFolderId, folders) || "Folder";


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

        const rootFolder = await getOrCreateFolder(folderName, null);
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
    }, [folders, handleCreateFolder, isDesktopRuntime, queueFileEntries, savedMessagesDefault, setActiveFolderId]);

    const handleExplorerDelete = useCallback(async (id: number) => {
        const folder = folders.find(f => f.id === id);
        if (folder) {
            handleFolderDelete(folder.id, folder.name);
            return;
        }
        if (driveView === 'trash') {
            const file = displayedFiles.find(f => f.id === id);
            if (!file) return;
            const ok = await confirm({
                title: "Delete Forever",
                message: `Permanently delete "${file.name}"? This cannot be restored by Telegram Drive.`,
                confirmText: "Delete Forever",
                variant: 'danger'
            });
            if (!ok) return;
            try {
                await invokeCommand('cmd_permanent_delete_file', { messageId: id });
                queryClient.invalidateQueries({ queryKey: ['files'] });
                toast.success("File permanently deleted");
            } catch (e) {
                toast.error(`Permanent delete failed: ${e}`);
            }
            return;
        }
        handleDelete(id);
    }, [confirm, displayedFiles, driveView, folders, handleDelete, handleFolderDelete, queryClient]);

    const handleExplorerDownload = useCallback((id: number, name: string) => {
        const item = displayedFiles.find(f => f.id === id);
        if (item?.type === 'folder') {
            setActiveFolderId(id);
            toast.info("Opened folder. Use Download All Files for its contents.");
            return;
        }
        queueDownload(id, name, activeFolderId);
    }, [activeFolderId, displayedFiles, queueDownload, setActiveFolderId]);

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

    const handleToggleStar = useCallback(async (file: TelegramFile) => {
        if (!savedMessagesDefault || file.type === 'folder') return;

        try {
            await invokeCommand('cmd_toggle_star', { messageId: file.id, starred: !file.starred });
            queryClient.invalidateQueries({ queryKey: ['files'] });
            toast.success(file.starred ? "Removed from starred" : "Added to starred");
        } catch (e) {
            toast.error(`Star update failed: ${e}`);
        }
    }, [queryClient, savedMessagesDefault]);

    const handleBulkStar = useCallback(async () => {
        const files = displayedFileItems.filter((file) => selectedIds.includes(file.id));
        if (files.length === 0) return;
        try {
            await Promise.all(files.map((file) => invokeCommand('cmd_toggle_star', { messageId: file.id, starred: true })));
            queryClient.invalidateQueries({ queryKey: ['files'] });
            toast.success(`Starred ${files.length} file(s).`);
        } catch (e) {
            toast.error(`Bulk star failed: ${e}`);
        }
    }, [displayedFileItems, queryClient, selectedIds]);

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

    const handleVisibleBulkDelete = useCallback(async () => {
        if (driveView !== 'trash') {
            handleBulkDelete();
            return;
        }
        if (selectedIds.length === 0) return;

        const ok = await confirm({
            title: "Delete Forever",
            message: `Permanently delete ${selectedIds.length} file(s)?`,
            confirmText: "Delete Forever",
            variant: 'danger'
        });
        if (!ok) return;

        let success = 0;
        let fail = 0;
        for (const id of selectedIds) {
            try {
                await invokeCommand('cmd_permanent_delete_file', { messageId: id });
                success++;
            } catch {
                fail++;
            }
        }
        setSelectedIds([]);
        queryClient.invalidateQueries({ queryKey: ['files'] });
        if (success > 0) toast.success(`Permanently deleted ${success} file(s).`);
        if (fail > 0) toast.error(`Failed to delete ${fail} file(s).`);
    }, [confirm, driveView, handleBulkDelete, queryClient, selectedIds]);

    const handleRestoreFile = useCallback(async (file: TelegramFile) => {
        if (file.type === 'folder') return;

        try {
            await invokeCommand('cmd_restore_file', { messageId: file.id });
            queryClient.invalidateQueries({ queryKey: ['files'] });
            toast.success(`Restored "${file.name}"`);
        } catch (e) {
            toast.error(`Restore failed: ${e}`);
        }
    }, [queryClient, savedMessagesDefault]);

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
                        onClose={() => setShowMoveModal(false)}
                        onSelect={handleBulkMove}
                        activeFolderId={activeFolderId}
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
                        title={tagTarget === 'bulk' ? `Tag ${selectedIds.length} Selected File(s)` : `Tags for ${tagTarget.name}`}
                        initialTags={tagTarget === 'bulk' ? [] : tagTarget.tags || []}
                        onSave={handleSaveTags}
                        onClose={() => setTagTarget(null)}
                    />
                )}
            </AnimatePresence>

            <Sidebar
                folders={folders}
                activeFolderId={activeFolderId}
                setActiveFolderId={setActiveFolderId}
                activeDriveView={driveView}
                onDriveViewChange={setDriveView}
                onDrop={handleDropOnFolder}
                onDelete={handleFolderDelete}
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
                    selectedIds={selectedIds}
                    onShowMoveModal={() => setShowMoveModal(true)}
                    onBulkDownload={handleBulkDownload}
                    onBulkDelete={handleVisibleBulkDelete}
                    onDownloadFolder={handleDownloadFolder}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    savedMessagesOnly={driveView !== 'files'}
                    onBulkTag={() => setTagTarget('bulk')}
                    onBulkStar={handleBulkStar}
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
                    allowUpload={driveView === 'files'}
                    onSelectionClear={() => setSelectedIds([])}
                    onToggleSelection={handleToggleSelection}
                    onDrop={handleDropOnFolder}
                    onDragStart={(fileId) => setInternalDragFileId(fileId)}
                    onDragEnd={() => setTimeout(() => setInternalDragFileId(null), 50)}
                    onToggleStar={handleToggleStar}
                    onRestore={handleRestoreFile}
                    onEditTags={(file) => setTagTarget(file)}
                    onVerify={handleVerifyFile}
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
        size: 0,
        sizeStr: 'Folder',
        created_at: '',
        type: 'folder',
    };
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
