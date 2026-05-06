import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useConfirm } from '../context/ConfirmContext';
import { TelegramFile } from '../types';
import { downloadBrowserFile, invokeCommand, isSavedMessagesDefaultStorage, isTauriRuntime, openTauriDirectoryDialog, saveTauriFileDialog } from '../platform';
import { formatBytes } from '../utils';

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
            title: savedMessagesMode ? "Move File to Trash" : "Delete File",
            message: savedMessagesMode
                ? "Move this file to Telegram Drive trash? The original Telegram Saved Messages file stays recoverable."
                : "Are you sure you want to delete this file?",
            confirmText: savedMessagesMode ? "Move to Trash" : "Delete",
            variant: 'danger'
        })) return;
        try {
            await invokeCommand('cmd_delete_file', { messageId: id, folderId: activeFolderId });
            queryClient.invalidateQueries({ queryKey: ['files'] });
            toast.success(savedMessagesMode ? "File moved to Trash" : "File deleted");
        } catch (e) {
            toast.error(`Delete failed: ${e}`);
        }
    }

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) return;
        if (!await confirm({
            title: savedMessagesMode ? "Move Files to Trash" : "Delete Files",
            message: savedMessagesMode
                ? `Move ${selectedIds.length} files to Telegram Drive trash? They stay recoverable from Saved Messages.`
                : `Are you sure you want to delete ${selectedIds.length} files?`,
            confirmText: savedMessagesMode ? "Move All" : "Delete All",
            variant: 'danger'
        })) return;

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
        setSelectedIds([]);
        queryClient.invalidateQueries({ queryKey: ['files'] });
        if (success > 0) toast.success(savedMessagesMode ? `Moved ${success} files to Trash.` : `Deleted ${success} files.`);
        if (fail > 0) toast.error(`Failed to delete ${fail} files.`);
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
            toast.error(`Download failed: ${e}`);
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
            toast.error(`Bulk download failed: ${e}`);
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
        } catch {
            toast.error('Failed to move files');
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
            toast.error("Error: " + e);
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
