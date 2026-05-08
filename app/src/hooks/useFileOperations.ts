import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useConfirm } from '../context/ConfirmContext';
import { TelegramFile } from '../types';
import { downloadBrowserFile, getBrowserFileObjectUrl, invokeCommand, isSavedMessagesDefaultStorage, isTauriRuntime, openTauriDirectoryDialog, saveTauriFileDialog } from '../platform';
import { formatBytes, friendlyDriveError } from '../utils';

export function useFileOperations(
    activeFolderId: number | null,
    selectedIds: number[],
    setSelectedIds: (ids: number[]) => void,
    displayedFiles: TelegramFile[],
    folderLabel = 'Telegram Drive'
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
        })) return;
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
        } catch (e) {
            toast.error(`Delete failed: ${friendlyDriveError(e)}`);
        }
    }

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) return;
        if (!await confirm({
            title: "Move Files to Trash",
            message: `Move ${selectedIds.length} files to Telegram Drive trash? You can restore them later or delete them forever from Trash.`,
            confirmText: "Move All",
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
        if (savedMessagesMode && success > 0) {
            await invokeCommand('cmd_flush_manifest').catch(() => undefined);
        }
        setSelectedIds([]);
        queryClient.invalidateQueries({ queryKey: ['files'] });
        if (success > 0) toast.success(`Moved ${success} files to Trash.`);
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
            if (!useDesktopFileDialog) {
                const filesOnly = displayedFiles.filter((file) => file.type !== 'folder');
                if (filesOnly.length === 0) {
                    toast.info("Select a folder's files before downloading as ZIP.");
                    return;
                }
                await downloadFilesAsZip(filesOnly, folderLabel, activeFolderId);
                toast.success(`ZIP ready: ${filesOnly.length} file(s).`);
                return;
            }

            const dirPath = useDesktopFileDialog
                ? await openTauriDirectoryDialog("Download Folder To...")
                : null;
            if (useDesktopFileDialog && !dirPath) return;
            let successCount = 0;
            toast.info(`Downloading folder contents (${displayedFiles.length} files)...`);
            for (const file of displayedFiles) {
                if (file.type === 'folder') continue;
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

async function downloadFilesAsZip(files: TelegramFile[], folderLabel: string, activeFolderId: number | null) {
    const entries: ZipEntry[] = [];
    for (const file of files) {
        const url = await getBrowserFileObjectUrl(file.id);
        try {
            const response = await fetch(url);
            const data = new Uint8Array(await response.arrayBuffer());
            entries.push({
                name: safeZipEntryName(file.originalPath || file.name),
                data,
            });
        } finally {
            if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        }
    }

    const archive = createZipArchive(entries);
    const blob = new Blob([archive], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeArchiveName(folderLabel || (activeFolderId === null ? 'Saved Messages' : `Folder ${activeFolderId}`))}.zip`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

interface ZipEntry {
    name: string;
    data: Uint8Array;
}

function createZipArchive(entries: ZipEntry[]): Uint8Array {
    const encoder = new TextEncoder();
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;

    for (const entry of entries) {
        const name = encoder.encode(entry.name);
        const crc = crc32(entry.data);
        const localHeader = new Uint8Array(30 + name.length);
        const localView = new DataView(localHeader.buffer);
        localView.setUint32(0, 0x04034b50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, 0, true);
        localView.setUint16(8, 0, true);
        localView.setUint16(10, 0, true);
        localView.setUint16(12, 0, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, entry.data.length, true);
        localView.setUint32(22, entry.data.length, true);
        localView.setUint16(26, name.length, true);
        localHeader.set(name, 30);

        const centralHeader = new Uint8Array(46 + name.length);
        const centralView = new DataView(centralHeader.buffer);
        centralView.setUint32(0, 0x02014b50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, 0, true);
        centralView.setUint16(10, 0, true);
        centralView.setUint16(12, 0, true);
        centralView.setUint16(14, 0, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, entry.data.length, true);
        centralView.setUint32(24, entry.data.length, true);
        centralView.setUint16(28, name.length, true);
        centralView.setUint32(42, offset, true);
        centralHeader.set(name, 46);

        localParts.push(localHeader, entry.data);
        centralParts.push(centralHeader);
        offset += localHeader.length + entry.data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);

    const totalSize = offset + centralSize + end.length;
    const result = new Uint8Array(totalSize);
    let cursor = 0;
    for (const part of [...localParts, ...centralParts, end]) {
        result.set(part, cursor);
        cursor += part.length;
    }
    return result;
}

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function safeZipEntryName(name: string) {
    return (name || 'file')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .map((part) => part.replace(/[<>:"|?*\x00-\x1f]/g, '_'))
        .join('/') || 'file';
}

function safeArchiveName(name: string) {
    return name
        .replace(/^Start\s*\/\s*/i, '')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'telegram-drive';
}
