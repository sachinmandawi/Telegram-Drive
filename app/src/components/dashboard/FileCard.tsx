import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Folder, Eye, Trash2, Shield, ShieldAlert, ShieldCheck, Lock } from 'lucide-react';
import { TelegramFile } from '../../types';
import { FileTypeIcon } from '../FileTypeIcon';
import { invokeCommand } from '../../platform';
import { isImageFile } from '../../utils';

interface FileCardProps {
    file: TelegramFile;
    onDelete: () => void;
    onDownload: () => void;
    onPreview?: () => void;
    isSelected: boolean;
    onClick?: (e: React.MouseEvent) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onDrop?: (e: React.DragEvent, folderId: number) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
    activeFolderId?: number | null;
    height?: number;
    onToggleSelection?: () => void;
    pathLabel?: string;
    highlighted?: boolean;
}

export function FileCard({ file, onDelete, onDownload, onPreview, isSelected, onClick, onContextMenu, onDrop, onDragStart, onDragEnd, activeFolderId, height, onToggleSelection, pathLabel, highlighted }: FileCardProps) {
    const isFolder = file.type === 'folder';
    const [isDragOver, setIsDragOver] = useState(false);
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [thumbnailLoading, setThumbnailLoading] = useState(false);

    // Lazy load thumbnail for image files
    useEffect(() => {
        if (isFolder || !isImageFile(file)) {
            setThumbnail(null);
            setThumbnailLoading(false);
            return;
        }

        let cancelled = false;
        let thumbnailUrl: string | null = null;
        setThumbnailLoading(true);
        setThumbnail(null);

        invokeCommand<string>('cmd_get_thumbnail', {
            messageId: file.id,
            folderId: activeFolderId
        }).then((result) => {
            if (!result) return;
            if (cancelled) {
                if (result.startsWith('blob:')) URL.revokeObjectURL(result);
                return;
            }
            thumbnailUrl = result;
            setThumbnail(result);
        }).catch(() => {
            // Silently fail - will show icon instead
        }).finally(() => {
            if (!cancelled) setThumbnailLoading(false);
        });

        return () => {
            cancelled = true;
            if (thumbnailUrl?.startsWith('blob:')) URL.revokeObjectURL(thumbnailUrl);
        };
    }, [file.id, file.name, activeFolderId, isFolder]);

    return (
        <div
            className="relative"
            onContextMenu={onContextMenu}
            onClick={onClick}
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
        >
            <motion.div
                layout
                draggable
                onDragStartCapture={(e: React.DragEvent<HTMLDivElement>) => {
                    if (onDragStart) onDragStart(file.id);
                    e.dataTransfer.setData("application/x-telegram-file-id", file.id.toString());
                    e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                    if (onDragEnd) onDragEnd();
                }}
                whileHover={{ y: -4 }}
                className={`group cursor-pointer bg-telegram-surface rounded-xl overflow-hidden border hover:shadow-[0_4px_20px_rgba(0,0,0,0.2)] transition-all relative
                ${isSelected || highlighted ? 'border-telegram-primary bg-telegram-primary/5 ring-1 ring-telegram-primary' : 'border-telegram-border hover:border-telegram-primary/50'}
                ${isDragOver ? 'ring-2 ring-telegram-primary bg-telegram-primary/20 scale-105' : ''}`}
                style={height ? { height: `${height}px` } : { aspectRatio: '4/3' }}
            >
                {/* Thumbnail or Icon */}
                {thumbnail ? (
                    <div className="absolute inset-0">
                        <img
                            src={thumbnail}
                            alt={file.name}
                            className="w-full h-full object-cover"
                        />
                        {/* Gradient overlay for text readability */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    </div>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4">
                        {isFolder ? (
                            <Folder className="h-10 w-10 sm:h-12 sm:w-12" style={{ color: file.color || undefined }} />
                        ) : thumbnailLoading && isImageFile(file) ? (
                            <div className="w-8 h-8 border-2 border-telegram-primary/30 border-t-telegram-primary rounded-full animate-spin" />
                        ) : (
                            <FileTypeIcon filename={file.name} size="lg" />
                        )}
                    </div>
                )}

                {/* Selection Checkmark */}
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        if (onToggleSelection) onToggleSelection();
                    }}
                    className={`absolute top-2 left-2 w-5 h-5 rounded-full border flex items-center justify-center transition-all z-10 cursor-pointer ${isSelected ? 'bg-telegram-primary border-telegram-primary' : 'border-white/50 bg-black/30 opacity-0 group-hover:opacity-100'}`}
                >
                    {isSelected && <div className="w-1.5 h-1.5 bg-black rounded-full" />}
                </div>

                {file.locked && (
                    <div className="absolute top-2 left-9 w-5 h-5 rounded-full bg-black/40 flex items-center justify-center z-10">
                        <Lock className="w-3 h-3 text-amber-400" />
                    </div>
                )}

                {file.protected && (
                    <div className="absolute top-2 left-16 w-5 h-5 rounded-full bg-black/40 flex items-center justify-center z-10">
                        <Shield className="w-3 h-3 text-telegram-primary" />
                    </div>
                )}

                {!isFolder && file.integrityStatus === 'valid' && (
                    <div className="absolute top-2 left-[5.75rem] w-5 h-5 rounded-full bg-black/40 flex items-center justify-center z-10">
                        <ShieldCheck className="w-3 h-3 text-green-400" />
                    </div>
                )}

                {!isFolder && file.integrityStatus === 'mismatch' && (
                    <div className="absolute top-2 left-[5.75rem] w-5 h-5 rounded-full bg-black/40 flex items-center justify-center z-10">
                        <ShieldAlert className="w-3 h-3 text-red-400" />
                    </div>
                )}

                {/* File info overlay at bottom */}
                <div className={`absolute bottom-0 left-0 right-0 p-2.5 sm:p-3 ${thumbnail ? 'text-white' : 'text-telegram-text'}`}>
                    <h3 className="w-full truncate text-xs font-medium sm:text-sm" title={file.name}>{file.name}</h3>
                    <p className={`text-xs mt-0.5 ${thumbnail ? 'text-white/70' : 'text-telegram-subtext'}`}>{file.sizeStr}</p>
                    {pathLabel && (
                        <p className={`text-[11px] mt-0.5 truncate ${thumbnail ? 'text-white/70' : 'text-telegram-subtext/80'}`} title={pathLabel}>
                            {pathLabel}
                        </p>
                    )}
                    {!isFolder && file.tags && file.tags.length > 0 && (
                        <div className="mt-1 flex max-h-5 gap-1 overflow-hidden">
                            {file.tags.slice(0, 3).map((tag) => (
                                <span key={tag} className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-white/80">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Quick actions on hover */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10">
                    <button onClick={(e) => { e.stopPropagation(); if (onPreview) onPreview() }} className="file-action-btn p-1 bg-black/50 rounded-full hover:bg-telegram-primary hover:text-white text-white/70" title="Preview">
                        <Eye className="w-3 h-3" />
                    </button>
                    {!isFolder && (
                        <button onClick={(e) => { e.stopPropagation(); onDownload() }} className="file-action-btn p-1 bg-black/50 rounded-full hover:bg-green-500 hover:text-white text-white/70" title="Download">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="file-action-btn p-1 bg-black/50 rounded-full hover:bg-red-500 hover:text-white text-white/70" title="Delete">
                        <Trash2 className="w-3 h-3" />
                    </button>
                </div>
            </motion.div>
        </div>
    )
}
