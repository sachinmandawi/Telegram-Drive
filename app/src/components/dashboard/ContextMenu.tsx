import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, Eye, HardDrive, Trash2, FolderOpen, Pencil, Play, FileText, RotateCcw, Tag, Shield, ShieldOff, History, Lock, UnlockKeyhole, Info, Scissors, FolderInput } from 'lucide-react';
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
    onSelect?: () => void;
    onEditTags?: () => void;
    onRename?: () => void;
    onSetFolderColor?: (color: string) => void;
    onShowVersions?: () => void;
    onMove?: () => void;
    onCut?: () => void;
    onCopy?: () => void;
    onProperties?: () => void;
    onToggleLock?: () => void;
    onToggleProtection?: () => void;
}

const folderColorOptions = [
    { label: 'Default', value: '', preview: '#ffae00' },
    { label: 'Yellow', value: '#facc15', preview: '#facc15' },
    { label: 'Blue', value: '#38bdf8', preview: '#38bdf8' },
    { label: 'Green', value: '#4ade80', preview: '#4ade80' },
    { label: 'Pink', value: '#f472b6', preview: '#f472b6' },
    { label: 'Purple', value: '#a78bfa', preview: '#a78bfa' },
    { label: 'Rose', value: '#fb7185', preview: '#fb7185' },
];

export function ContextMenu({ x, y, file, onClose, onDownload, onDelete, onPreview, onRestore, onSelect, onEditTags, onRename, onSetFolderColor, onShowVersions, onMove, onCut, onCopy, onProperties, onToggleLock, onToggleProtection }: ContextMenuProps) {
    const [adjustedPos, setAdjustedPos] = useState({ x, y });
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const update = () => setIsMobile(window.innerWidth < 640);
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    // Clamp the menu inside the viewport without flipping it far away from the pointer.
    useLayoutEffect(() => {
        if (isMobile) return;
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            const padding = 8;
            const maxX = Math.max(padding, window.innerWidth - rect.width - padding);
            const maxY = Math.max(padding, window.innerHeight - rect.height - padding);
            const newX = Math.min(Math.max(padding, x), maxX);
            const newY = Math.min(Math.max(padding, y), maxY);
            setAdjustedPos({ x: newX, y: newY });
        }
    }, [isMobile, x, y]);

    // Close on outside pointer/back without letting the app navigate underneath.
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && menuRef.current?.contains(target)) return;
            onClose();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        const handlePopState = (event: PopStateEvent) => {
            event.stopImmediatePropagation();
            onClose();
            window.history.pushState(window.history.state ?? { telegramDrive: true }, document.title);
        };
        const handleContextMenu = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && menuRef.current?.contains(target)) return;
            onClose();
        };
        const handleResize = () => onClose();

        window.addEventListener('pointerdown', handlePointerDown, true);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('popstate', handlePopState, true);
        window.addEventListener('resize', handleResize);
        window.addEventListener('contextmenu', handleContextMenu, true);

        return () => {
            window.removeEventListener('pointerdown', handlePointerDown, true);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('popstate', handlePopState, true);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('contextmenu', handleContextMenu, true);
        };
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            className={`${isMobile ? 'fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 max-h-[75dvh] overflow-y-auto rounded-2xl' : 'fixed z-50 min-w-[220px] rounded-lg'} flex flex-col gap-0.5 border border-telegram-border bg-telegram-surface/95 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100`}
            style={isMobile ? undefined : { left: adjustedPos.x, top: adjustedPos.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div className="px-2 py-1.5 text-xs text-telegram-subtext font-medium truncate max-w-[180px] border-b border-telegram-border mb-1">
                {file.name}
            </div>

            {onSelect && (
                <button onClick={onSelect} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <CheckCircle2 className="w-4 h-4 text-telegram-primary" />
                    Select
                </button>
            )}

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

            {onCut && !file.trashed && (
                <button onClick={onCut} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <Scissors className="w-4 h-4 text-telegram-primary" />
                    Cut
                </button>
            )}

            {onCopy && !file.trashed && (
                <button onClick={onCopy} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <Copy className="w-4 h-4 text-telegram-primary" />
                    Copy
                </button>
            )}

            {onMove && !file.trashed && (
                <button onClick={onMove} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <FolderInput className="w-4 h-4 text-telegram-primary" />
                    Move
                </button>
            )}

            <button onClick={onRename} disabled={!onRename || file.trashed} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full disabled:cursor-not-allowed disabled:opacity-50">
                <Pencil className="w-4 h-4" />
                Rename
            </button>

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

            {file.type !== 'folder' && onShowVersions && (
                <button onClick={onShowVersions} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <History className="w-4 h-4 text-telegram-primary" />
                    Versions
                </button>
            )}

            {onProperties && (
                <button onClick={onProperties} className="flex items-center gap-2 px-2 py-1.5 text-sm text-telegram-text hover:bg-telegram-hover rounded transition-colors text-left w-full">
                    <Info className="w-4 h-4 text-telegram-primary" />
                    Properties
                </button>
            )}

            {file.type === 'folder' && onSetFolderColor && !file.trashed && (
                <div className="px-2 py-2">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-telegram-subtext">Folder color</div>
                    <div className="grid grid-cols-2 gap-1.5">
                    {folderColorOptions.map((option) => (
                        <button
                            key={option.label}
                            onClick={() => onSetFolderColor(option.value)}
                            className="flex items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left text-xs text-telegram-text transition hover:border-telegram-border hover:bg-telegram-hover"
                            title={option.label}
                        >
                            <span
                                className="h-4 w-4 shrink-0 rounded-full border border-white/20"
                                style={{ backgroundColor: option.preview }}
                            />
                            <span className="truncate">{option.label}</span>
                        </button>
                    ))}
                    </div>
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
