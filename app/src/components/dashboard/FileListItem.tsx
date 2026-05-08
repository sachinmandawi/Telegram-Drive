import { useState } from 'react';
import { Folder, Eye, HardDrive, Lock, Plus, Shield } from 'lucide-react';
import { TelegramFile } from '../../types';
import { FileTypeIcon } from '../FileTypeIcon';

interface FileListItemProps {
    file: TelegramFile;
    selectedIds: number[];
    onFileClick: (e: React.MouseEvent, id: number) => void;
    handleContextMenu: (e: React.MouseEvent, file: TelegramFile) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
    onDrop?: (e: React.DragEvent, folderId: number) => void;
    onPreview: (file: TelegramFile) => void;
    onDownload: (id: number, name: string) => void;
    onDelete: (id: number) => void;
    pathLabel?: string;
    highlighted?: boolean;
}

export function FileListItem({
    file, selectedIds, onFileClick, handleContextMenu,
    onDragStart, onDragEnd, onDrop,
    onPreview, onDownload, onDelete, pathLabel, highlighted
}: FileListItemProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const isFolder = file.type === 'folder';

    return (
        <div
            onClick={(e) => onFileClick(e, file.id)}
            onContextMenu={(e) => handleContextMenu(e, file)}
            draggable
            onDragStart={(e) => {
                if (onDragStart) onDragStart(file.id);
                e.dataTransfer.setData("application/x-telegram-file-id", file.id.toString());
                e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
                if (onDragEnd) onDragEnd();
            }}
            onDragOver={(e) => {
                if (isFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isDragOver) setIsDragOver(true);
                }
            }}
            onDragLeave={(e) => {
                if (isFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragOver(false);
                }
            }}
            onDrop={(e) => {
                if (isFolder && onDrop) {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragOver(false);
                    onDrop(e, file.id);
                }
            }}
            className={`group grid grid-cols-[2rem_minmax(0,1fr)_5rem] items-center gap-2 rounded-lg border border-transparent px-3 py-3 cursor-pointer transition-all hover:bg-telegram-hover md:grid-cols-[2rem_2fr_6rem_8rem] md:gap-4 md:px-4 
                ${selectedIds.includes(file.id) || highlighted ? 'bg-telegram-primary/10 border-telegram-primary/20' : ''}
                ${isDragOver ? 'ring-2 ring-telegram-primary bg-telegram-primary/20' : ''}
            `}
        >
            <div className="flex justify-center">
                {isFolder ? <Folder className="w-5 h-5" style={{ color: file.color || undefined }} /> : <FileTypeIcon filename={file.name} className="w-5 h-5" />}
            </div>
            <div className="truncate text-sm text-telegram-text font-medium relative pr-8">
                {file.locked && <Lock className="inline w-3 h-3 mr-1 text-amber-400 align-[-1px]" />}
                {file.protected && <Shield className="inline w-3 h-3 mr-1 text-telegram-primary align-[-1px]" />}
                {file.name}
                {pathLabel && (
                    <span className="ml-2 text-xs font-normal text-telegram-subtext">
                        {pathLabel}
                    </span>
                )}
                {!isFolder && file.tags && file.tags.length > 0 && (
                    <span className="ml-2 inline-flex max-w-[14rem] gap-1 align-middle">
                        {file.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded bg-telegram-primary/15 px-1.5 py-0.5 text-[10px] text-telegram-primary">
                                {tag}
                            </span>
                        ))}
                    </span>
                )}
                {/* List Actions */}
                <div className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center rounded border border-telegram-border bg-telegram-surface px-1 opacity-100 shadow-lg sm:opacity-0 sm:group-hover:opacity-100">
                    <button onClick={(e) => { e.stopPropagation(); onPreview(file) }} className="p-1 hover:text-telegram-text text-telegram-subtext" title="Preview"><Eye className="w-4 h-4" /></button>
                    {!isFolder && (
                        <button onClick={(e) => { e.stopPropagation(); onDownload(file.id, file.name) }} className="p-1 hover:text-telegram-text text-telegram-subtext" title="Download"><HardDrive className="w-4 h-4" /></button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); onDelete(file.id) }} className="p-1 hover:text-red-400 text-telegram-subtext" title="Delete"><Plus className="w-4 h-4 rotate-45" /></button>
                </div>
            </div>
            <div className="text-right text-xs text-telegram-subtext truncate">{file.sizeStr}</div>
            <div className="hidden truncate text-right font-mono text-xs text-telegram-subtext opacity-50 md:block">{file.created_at || '-'}</div>
        </div>
    );
}
