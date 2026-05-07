import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useConfirm } from '../context/ConfirmContext';
import { TelegramFolder } from '../types';
import { useNetworkStatus } from './useNetworkStatus';
import { AppStore, invokeCommand, isSavedMessagesDefaultStorage, isTauriRuntime, loadAppStore } from '../platform';

export function useTelegramConnection(onLogoutParent: () => void) {
    const queryClient = useQueryClient();
    const { confirm } = useConfirm();

    const [folders, setFolders] = useState<TelegramFolder[]>([]);
    const foldersRef = useRef<TelegramFolder[]>([]);
    const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
    const [store, setStore] = useState<AppStore | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isConnected, setIsConnected] = useState(true);


    const networkIsOnline = useNetworkStatus();
    const isDesktopRuntime = isTauriRuntime();
    const savedMessagesDefault = isSavedMessagesDefaultStorage();

    useEffect(() => {
        foldersRef.current = folders;
    }, [folders]);


    useEffect(() => {
        const initStore = async () => {
            try {
                let _store = await loadAppStore('config.json');
                const checkId = await _store.get<string>('api_id');
                if (!checkId && isDesktopRuntime) {
                    _store = await loadAppStore('settings.json');
                }
                setStore(_store);

                const savedFolders = await _store.get<TelegramFolder[]>('folders');
                if (savedFolders) {
                    foldersRef.current = savedFolders;
                    setFolders(savedFolders);
                }


                const savedActiveFolderId = await _store.get<number | null>('activeFolderId');
                if (savedActiveFolderId !== undefined) {
                    setActiveFolderId(savedActiveFolderId);
                }

                const apiIdStr = await _store.get<string>('api_id');
                if (apiIdStr) {
                    try {
                        if (isDesktopRuntime) {
                            const apiId = parseInt(apiIdStr as string);
                            await invokeCommand('cmd_connect', { apiId });
                        }
                        setIsConnected(true);
                        if (savedMessagesDefault) {
                            const syncedFolders = await invokeCommand<TelegramFolder[]>('cmd_scan_folders');
                            const merged = mergeFolders(syncedFolders);
                            foldersRef.current = merged;
                            setFolders(merged);
                            await _store.set('folders', merged);
                            await _store.save();
                        }
                        queryClient.invalidateQueries({ queryKey: ['files'] });
                    } catch {
                        const shouldRetry = window.confirm("Failed to connect to Telegram. Retry?");
                        if (shouldRetry) {
                            window.location.reload();
                        } else {
                            if (_store) {
                                await _store.delete('api_id');
                                await _store.save();
                            }
                            onLogoutParent();
                        }
                    }
                } else {
                    onLogoutParent();
                }

            } catch {
                // store not available
            }
        };
        initStore();
    }, [queryClient, onLogoutParent, isDesktopRuntime]);


    useEffect(() => {
        setIsConnected(networkIsOnline);
    }, [networkIsOnline]);


    const isNetworkError = (error: string): boolean => {
        const keywords = ['timeout', 'connection', 'network', 'socket', 'disconnected', 'EOF', 'ECONNREFUSED', 'overflow'];
        return keywords.some(k => error.toLowerCase().includes(k.toLowerCase()));
    };

    const forceLogout = async () => {
        setIsConnected(false);
        try {
            await invokeCommand('cmd_clean_cache').catch(() => { });
            if (store) {
                await store.delete('api_id');
                await store.delete('api_hash');
                await store.delete('auth_complete');
                await store.delete('folders');
                await store.save();
            }
        } catch {
            // best effort cleanup
        }
        toast.error("Connection lost. Please log in again.");
        onLogoutParent();
    };


    const handleLogout = async () => {
        if (!await confirm({ title: "Sign Out", message: "Are you sure you want to sign out? This will disconnect your active session.", confirmText: "Sign Out", variant: 'danger' })) return;

        try {
            await invokeCommand('cmd_logout');
            await invokeCommand('cmd_clean_cache');
            if (store) {
                await store.delete('api_id');
                await store.delete('api_hash');
                await store.delete('auth_complete');
                await store.delete('folders');
                await store.save();
            }
            onLogoutParent();
        } catch {
            toast.error("Error signing out");
            onLogoutParent();
        }
    };

    const handleSyncFolders = async () => {
        if (!store) return;
        setIsSyncing(true);
        try {
            const foundFolders = await invokeCommand<TelegramFolder[]>('cmd_scan_folders');
            if (savedMessagesDefault) {
                const synced = mergeFolders(foundFolders);
                foldersRef.current = synced;
                setFolders(synced);
                await store.set('folders', synced);
                await store.save();
                toast.success(`Sync complete. Loaded ${synced.length} saved folder(s).`);
                queryClient.invalidateQueries({ queryKey: ['files'] });
                return;
            }

            const merged = [...foldersRef.current];
            let added = 0;
            for (const f of foundFolders) {
                if (!merged.find(existing => existing.id === f.id)) {
                    merged.push(f);
                    added++;
                }
            }
            if (added > 0) {
                setFolders(merged);
                await store.set('folders', merged);
                await store.save();
                toast.success(`Scan complete. Found ${added} new folders.`);
            } else {
                toast.info(isDesktopRuntime ? "Scan complete. No new folders found." : "Browser folders are already synced.");
            }
        } catch {
            toast.error("Sync failed");
        } finally {
            setIsSyncing(false);
        }
    };

    const handleCreateFolder = async (name: string, parentId: number | null = null, silent = false) => {
        if (!store) throw new Error('Settings store is not ready');
        try {
            const newFolder = await invokeCommand<TelegramFolder>('cmd_create_folder', { name, parentId });
            const updated = mergeFolders([...foldersRef.current, newFolder]);
            foldersRef.current = updated;
            setFolders(updated);
            await store.set('folders', updated);
            await store.save();
            if (!silent) toast.success(`Folder "${name}" created.`);
            return newFolder;
        } catch (e) {
            toast.error("Failed to create folder: " + e);
            throw e;
        }
    };

    const handleFolderDelete = async (folderId: number, folderName: string) => {
        const folderIdsToDelete = collectFolderTreeIds(folderId, foldersRef.current);
        const nestedCount = folderIdsToDelete.size - 1;
        const deleteMessage = savedMessagesDefault
            ? `Move "${folderName}"${nestedCount > 0 ? ` and ${nestedCount} nested folder(s)` : ''} to Trash?\nIt will appear as one restorable folder in Trash with its contents.`
            : `Are you sure you want to delete "${folderName}"?\nThis will delete the channel on Telegram.`;

        if (!await confirm({
            title: "Delete Folder",
            message: deleteMessage,
            confirmText: "Delete",
            variant: 'danger'
        })) return;

        try {
            if (savedMessagesDefault) {
                await invokeCommand('cmd_delete_folder', { folderId });
            } else {
                for (const id of folderIdsToDelete) {
                    await invokeCommand('cmd_delete_folder', { folderId: id });
                }
            }
            if (savedMessagesDefault) {
                await invokeCommand('cmd_flush_manifest').catch(() => undefined);
            }
            const updated = foldersRef.current.filter(f => !folderIdsToDelete.has(f.id));
            foldersRef.current = updated;
            setFolders(updated);
            if (store) {
                await store.set('folders', updated);
                await store.save();
            }
            if (activeFolderId !== null && folderIdsToDelete.has(activeFolderId)) setActiveFolderId(null);
            toast.success(savedMessagesDefault ? `Folder "${folderName}" moved to Trash.` : `Folder "${folderName}" deleted.`);
        } catch (e: unknown) {
            const errStr = String(e);
            if (errStr.includes("not found")) {
                if (await confirm({
                    title: "Folder Not Found",
                    message: `Folder "${folderName}" not found on Telegram (it may have been deleted externally).\nRemove from this app?`,
                    confirmText: "Remove",
                    variant: 'info'
                })) {
                    const updated = foldersRef.current.filter(f => !folderIdsToDelete.has(f.id));
                    foldersRef.current = updated;
                    setFolders(updated);
                    if (store) {
                        await store.set('folders', updated);
                        await store.save();
                    }
                    if (activeFolderId !== null && folderIdsToDelete.has(activeFolderId)) setActiveFolderId(null);
                }
            } else {
                toast.error(`Failed to delete folder: ${e}`);
            }
        }
    };


    const handleSetActiveFolderId = async (id: number | null) => {
        setActiveFolderId(id);
        if (store) {
            await store.set('activeFolderId', id);
            await store.save();
        }
    };

    return {
        store,
        folders,
        activeFolderId,
        setActiveFolderId: handleSetActiveFolderId,
        isSyncing,
        isConnected,
        handleLogout,
        handleSyncFolders,
        handleCreateFolder,
        handleFolderDelete,
        isNetworkError,
        forceLogout
    };
}

function getFolderParentId(folder: TelegramFolder): number | null {
    return folder.parent_id ?? null;
}

function mergeFolders(folders: TelegramFolder[]): TelegramFolder[] {
    const byId = new Map<number, TelegramFolder>();
    for (const folder of folders) {
        byId.set(folder.id, folder);
    }
    return Array.from(byId.values());
}

function collectFolderTreeIds(folderId: number, folders: TelegramFolder[]): Set<number> {
    const ids = new Set<number>([folderId]);
    let changed = true;

    while (changed) {
        changed = false;
        for (const folder of folders) {
            if (!ids.has(folder.id) && ids.has(getFolderParentId(folder) ?? -1)) {
                ids.add(folder.id);
                changed = true;
            }
        }
    }

    return ids;
}
