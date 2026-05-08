import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useConfirm } from '../context/ConfirmContext';
import { TelegramFile } from '../types';
import { downloadBrowserFile, invokeCommand, isSavedMessagesDefaultStorage, isTauriRuntime, openTauriDirectoryDialog, saveTauriFileDialog } from '../platform';
import { formatBytes, friendlyDriveError } from '../utils';

export function useFileOperations(
    activeFolderId: number | null,
    selectedIds: number[],
    setSelectedIds: (ids: number[]) => void,
    displayedFiles: TelegramFile[]
) {
    const queryClient = useQueryClient();
    const { confirm } = useConfirm();
    const isDesktopRuntime = isTauriRuntime();
    const savedMessagesMode = isSavedMessagesDefaultStorage();
    const useDesktopFileDialog = isDesktopRuntime && !isSavedMessagesDefaultStorage();

    const handleDelete = async (id: number) => {
        if (!await confirm({
            title: "Move File to Trash",
            message: "Move this file to Telegram Drive trash? You can restore it later or delete it forever from Trash.",
            confirmText: "Move to Trash",
            variant: 'danger'
        })) return false;
        try {
            await invokeCommand('cmd_delete_file', { messageId: id, folderId: activeFolderId });
            if (savedMessagesMode) {
                await invokeCommand('cmd_flush_manifest').catch(() => undefined);
            }
            queryClient.invalidateQueries({ queryKey: ['files'] });
            toast.success("File moved to Trash", {
                action: {
                    label: 'Undo',
                    onClick: () => {
                        void invokeCommand('cmd_restore_file', { messageId: id, itemType: 'file' })
                            .then(() => queryClient.invalidateQueries({ queryKey: ['files'] }))
                            .catch((err) => toast.error(`Undo failed: ${err}`));
                    },
                },
            });
            return true;
        } catch (e) {
            toast.error(`Delete failed: ${friendlyDriveError(e)}`);
            return false;
        }
    }

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) return false;
        if (!await confirm({
            title: "Move Files to Trash",
            message: `Move ${selectedIds.length} files to Telegram Drive trash? You can restore them later or delete them forever from Trash.`,
            confirmText: "Move All",
            variant: 'danger'
        })) return false;

        let success = 0;
        let fail = 0;
        for (const id of selectedIds) {
            try {
                await invokeCommand('cmd_delete_file', { messageId: id, folderId: activeFolderId });
                success++;
            } catch {
                fail++;
            }
        }
        if (savedMessagesMode && success > 0) {
            await invokeCommand('cmd_flush_manifest').catch(() => undefined);
        }
        setSelectedIds([]);
        queryClient.invalidateQueries({ queryKey: ['files'] });
        if (success > 0) toast.success(`Moved ${success} files to Trash.`);
        if (fail > 0) toast.error(`Failed to delete ${fail} files.`);
        return success > 0;
    }

    const handleDownload = async (id: number, name: string) => {
        try {
            if (useDesktopFileDialog) {
                const savePath = await saveTauriFileDialog(name);
                if (!savePath) return;
                toast.info(`Download started: ${name}`);
                await invokeCommand('cmd_download_file', { messageId: id, savePath, folderId: activeFolderId });
            } else {
                toast.info(`Download started: ${name}`);
                await downloadBrowserFile(id, name);
            }
            toast.success(`Download complete: ${name}`);
        } catch (e) {
            toast.error(`Download failed: ${friendlyDriveError(e)}`);
        }
    }

    const handleBulkDownload = async () => {
        if (selectedIds.length === 0) return;
        try {
            const dirPath = useDesktopFileDialog
                ? await openTauriDirectoryDialog("Select Download Destination")
                : null;
            if (useDesktopFileDialog && !dirPath) return;
            let successCount = 0;
            const targetFiles = displayedFiles.filter((f) => selectedIds.includes(f.id));
            toast.info(`Starting batch download of ${targetFiles.length} files...`);

            for (const file of targetFiles) {
                try {
                    if (useDesktopFileDialog) {
                        const filePath = `${dirPath}/${file.name}`;
                        await invokeCommand('cmd_download_file', { messageId: file.id, savePath: filePath, folderId: activeFolderId });
                    } else {
                        await downloadBrowserFile(file.id, file.name);
                    }
                    successCount++;
                } catch { }
            }
            toast.success(`Downloaded ${successCount} files.`);
            setSelectedIds([]);
        } catch (e) {
            toast.error(`Bulk download failed: ${friendlyDriveError(e)}`);
        }
    }

    const handleBulkMove = async (targetFolderId: number | null, onSuccess?: () => void) => {
        if (selectedIds.length === 0) return;
        try {
            await invokeCommand('cmd_move_files', {
                messageIds: selectedIds,
                sourceFolderId: activeFolderId,
                targetFolderId: targetFolderId
            });
            toast.success(`Moved ${selectedIds.length} files.`);
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
            setSelectedIds([]);
            if (onSuccess) onSuccess();
        } catch (e) {
            toast.error(`Move failed: ${friendlyDriveError(e)}`);
        }
    };

    const handleDownloadFolder = async () => {
        if (displayedFiles.length === 0) {
            toast.info("Folder is empty.");
            return;
        }
        try {
            const dirPath = useDesktopFileDialog
                ? await openTauriDirectoryDialog("Download Folder To...")
                : null;
            if (useDesktopFileDialog && !dirPath) return;
            let successCount = 0;
            toast.info(`Downloading folder contents (${displayedFiles.length} files)...`);
            for (const file of displayedFiles) {
                try {
                    if (useDesktopFileDialog) {
                        const filePath = `${dirPath}/${file.name}`;
                        await invokeCommand('cmd_download_file', { messageId: file.id, savePath: filePath, folderId: activeFolderId });
                    } else {
                        await downloadBrowserFile(file.id, file.name);
                    }
                    successCount++;
                } catch { }
            }
            toast.success(`Folder Download Complete: ${successCount} files.`);
        } catch (e) {
            toast.error(`Download folder failed: ${friendlyDriveError(e)}`);
        }
    }

    return {
        handleDelete,
        handleBulkDelete,
        handleDownload,
        handleBulkDownload,
        handleBulkMove,
        handleDownloadFolder,
        handleGlobalSearch: async (query: string) => {
            try {
                const results = await invokeCommand<any[]>('cmd_search_global', { query });
                return results.map((file) => ({
                    ...file,
                    sizeStr: file.sizeStr || formatBytes(file.size || 0),
                    type: file.icon_type || file.type || 'file',
                })) as TelegramFile[];
            } catch {
                return [];
            }
        }
    };
}
