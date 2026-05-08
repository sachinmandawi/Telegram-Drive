import { useEffect, useRef, useState } from 'react';
import { Copy, Eye, HardDrive, Trash2, FolderOpen, Pencil, Play, FileText, RotateCcw, Tag, Shield, ShieldCheck, ShieldOff, History, Lock, UnlockKeyhole, Combine, FolderInput } from 'lucide-react';
import { TelegramFile } from '../../types';
import { isMediaFile, isPdfFile } from '../../utils';

interface ContextMenuProps {
    x: number;
    y: number;
    file: TelegramFile;
    onClose: () => void;
    onDownload: () => void;
    onDelete: () => void;
    onPreview: () => void;
    onRestore?: () => void;
    onEditTags?: () => void;
    onVerify?: () => void;
    onRename?: () => void;
    onSetFolderColor?: (color: string) => void;
    onShowVersions?: () => void;
    onCopy?: () => void;
    onMove?: () => void;
    onMergeFolder?: () => void;
    onToggleLock?: () => void;
    onToggleProtection?: () => void;
}

export function ContextMenu({ x, y, file, onClose, onDownload, onDelete, onPreview, onRestore, onEditTags, onVerify, onRename, onSetFolderColor, onShowVersions, onCopy, onMove, onMergeFolder, onToggleLock, onToggleProtection }: ContextMenuProps) {
    const [adjustedPos, setAdjustedPos] = useState({ x, y });
    const menuRef = useRef<HTMLDivElement>(null);

    // Adjust position to stay in bounds
    useEffect(() => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            let newX = x;
            let newY = y;

            if (x + rect.width > window.innerWidth) {
                newX = x - rect.width;
            }
            if (y + rect.height > window.innerHeight) {
                newY = y - rect.height;
            }
            setAdjustedPos({ x: newX, y: newY });
        }
    }, [x, y]);

    // Close on outside click
    useEffect(() => {
        const handleClick = () => onClose();
        const handleResize = () => onClose();

        window.addEventListener('click', handleClick);
        window.addEventListener('resize', handleResize);
        window.addEventListener('contextmenu', handleClick); // Close if right click elsewhere

        return () => {
            window.removeEventListener('click', handleClick);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('contextmenu', handleClick);
        };
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[200px] bg-telegram-surface/95 backdrop-blur-xl border border-telegram-border rounded-lg shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-0.5"
            style={{ left: adjustedPos.x, top: adjustedPos.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div className="px-2 py-1.5 text-xs text-telegram-subtext font-medium truncate max-w-[180px] border-b border-telegram-border mb-1">
                {file.name}
            </div>

            {file.trashed && onRestore && (
                <button onClick={onRestore} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <RotateCcw className="w-4 h-4 text-green-400" />
                    Restore
                </button>
            )}

            {file.type !== 'folder' && (
                <button onClick={onPreview} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    {isMediaFile(file) ? (
                        <>
                            <Play className="w-4 h-4 text-telegram-primary" />
                            Play
                        </>
                    ) : isPdfFile(file) ? (
                        <>
                            <FileText className="w-4 h-4 text-red-400" />
                            View PDF
                        </>
                    ) : (
                        <>
                            <Eye className="w-4 h-4 text-blue-500" />
                            Preview
                        </>
                    )}
                </button>
            )}

            {file.type === 'folder' && (
                <button onClick={onPreview} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <FolderOpen className="w-4 h-4 text-yellow-500" />
                    Open
                </button>
            )}

            {file.type !== 'folder' && (
                <button onClick={onDownload} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <HardDrive className="w-4 h-4 text-green-500" />
                    Download
                </button>
            )}

            <button onClick={onRename} disabled={!onRename || file.trashed} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full disabled:cursor-not-allowed disabled:opacity-50">
                <Pencil className="w-4 h-4" />
                Rename
            </button>

            {onMove && !file.trashed && (
                <button onClick={onMove} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <FolderInput className="w-4 h-4 text-telegram-primary" />
                    Move to...
                </button>
            )}

            {onCopy && !file.trashed && (
                <button onClick={onCopy} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <Copy className="w-4 h-4 text-telegram-primary" />
                    Make a Copy
                </button>
            )}

            {file.type === 'folder' && onMergeFolder && !file.trashed && (
                <button onClick={onMergeFolder} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <Combine className="w-4 h-4 text-telegram-primary" />
                    Merge into...
                </button>
            )}

            {onToggleLock && !file.trashed && (
                <button onClick={onToggleLock} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    {file.locked ? <UnlockKeyhole className="w-4 h-4 text-green-400" /> : <Lock className="w-4 h-4 text-amber-400" />}
                    {file.locked ? 'Unlock Edits' : 'Lock Edits'}
                </button>
            )}

            {onToggleProtection && !file.trashed && (
                <button onClick={onToggleProtection} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    {file.protected ? <ShieldOff className="w-4 h-4 text-green-400" /> : <Shield className="w-4 h-4 text-telegram-primary" />}
                    {file.protected ? 'Remove Protection' : 'Protect with PIN'}
                </button>
            )}

            {file.type !== 'folder' && onEditTags && (
                <button onClick={onEditTags} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <Tag className="w-4 h-4 text-telegram-primary" />
                    Tags
                </button>
            )}

            {file.type !== 'folder' && onVerify && (
                <button onClick={onVerify} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <ShieldCheck className="w-4 h-4 text-green-400" />
                    Verify Checksum
                </button>
            )}

            {file.type !== 'folder' && onShowVersions && (
                <button onClick={onShowVersions} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <History className="w-4 h-4 text-telegram-primary" />
                    Versions
                </button>
            )}

            {file.type === 'folder' && onSetFolderColor && !file.trashed && (
                <div className="flex items-center gap-1 px-2 py-1">
                    {['#facc15', '#38bdf8', '#4ade80', '#f472b6', '#a78bfa', '#fb7185'].map((color) => (
                        <button
                            key={color}
                            onClick={() => onSetFolderColor(color)}
                            className="h-5 w-5 rounded-full border border-white/20"
                            style={{ backgroundColor: color }}
                            title={color}
                        />
                    ))}
                </div>
            )}

            <div className="h-px bg-telegram-border my-1" />

            <button onClick={onDelete} className="flex items-center gap-2 px-2 py-1.5 text-sm text-red-500 hover:bg-red-500/10 rounded transition-colors text-left w-full">
                <Trash2 className="w-4 h-4" />
                {file.trashed ? 'Delete Forever' : 'Delete'}
            </button>
        </div>
    );
}
