import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
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
    onOpenContextMenu?: (x: number, y: number) => void;
    onDrop?: (e: React.DragEvent, folderId: number) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
    activeFolderId?: number | null;
    height?: number;
    onToggleSelection?: () => void;
    showSelectionControl?: boolean;
    pathLabel?: string;
    highlighted?: boolean;
}

export function FileCard({ file, onDelete, onDownload, onPreview, isSelected, onClick, onContextMenu, onOpenContextMenu, onDrop, onDragStart, onDragEnd, activeFolderId, height, onToggleSelection, showSelectionControl = false, pathLabel, highlighted }: FileCardProps) {
    const isFolder = file.type === 'folder';
    const folderColor = file.color || '#ffae00';
    const [isDragOver, setIsDragOver] = useState(false);
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [thumbnailLoading, setThumbnailLoading] = useState(false);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
    const longPressTriggeredRef = useRef(false);
    const cardStyle = {
        ...(height ? { height: `${height}px` } : { aspectRatio: '1 / 1' }),
    } as React.CSSProperties;

    const clearLongPressTimer = () => {
        if (longPressTimerRef.current !== null) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

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

    useEffect(() => clearLongPressTimer, []);

    return (
        <div
            className="relative"
            onContextMenu={onContextMenu}
            onClick={(event) => {
                if (longPressTriggeredRef.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    longPressTriggeredRef.current = false;
                    return;
                }
                onClick?.(event);
            }}
            onTouchStart={(event) => {
                if (!onOpenContextMenu) return;
                const touch = event.touches[0];
                if (!touch) return;
                longPressStartRef.current = { x: touch.clientX, y: touch.clientY };
                longPressTriggeredRef.current = false;
                clearLongPressTimer();
                longPressTimerRef.current = window.setTimeout(() => {
                    const point = longPressStartRef.current;
                    if (!point) return;
                    longPressTriggeredRef.current = true;
                    onOpenContextMenu(point.x, point.y);
                    navigator.vibrate?.(15);
                }, 450);
            }}
            onTouchMove={(event) => {
                const start = longPressStartRef.current;
                const touch = event.touches[0];
                if (!start || !touch) return;
                if (Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10) {
                    clearLongPressTimer();
                }
            }}
            onTouchEnd={clearLongPressTimer}
            onTouchCancel={clearLongPressTimer}
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
                className={`group relative cursor-pointer overflow-hidden rounded-xl border transition-all hover:shadow-[0_4px_20px_rgba(0,0,0,0.2)]
                ${isFolder ? 'bg-telegram-primary/5' : 'bg-telegram-surface'}
                ${isSelected || highlighted ? 'border-telegram-primary bg-telegram-primary/5 ring-1 ring-telegram-primary' : 'border-telegram-border hover:border-telegram-primary/50'}
                ${isDragOver ? 'ring-2 ring-telegram-primary bg-telegram-primary/20 scale-105' : ''}`}
                style={cardStyle}
            >
                {isFolder && (
                    <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: folderColor }} />
                )}

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
                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-telegram-border bg-telegram-hover/80 shadow-inner sm:h-20 sm:w-20">
                                <Folder className="h-11 w-11 sm:h-14 sm:w-14" style={{ color: folderColor }} />
                            </div>
                        ) : thumbnailLoading && isImageFile(file) ? (
                            <div className="w-8 h-8 border-2 border-telegram-primary/30 border-t-telegram-primary rounded-full animate-spin" />
                        ) : (
                            <FileTypeIcon filename={file.name} size="lg" />
                        )}
                    </div>
                )}

                {/* Selection Checkmark */}
                {(showSelectionControl || isSelected) && (
                    <div
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onToggleSelection) onToggleSelection();
                        }}
                        className={`absolute top-2 left-2 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border transition-all ${isSelected ? 'bg-telegram-primary border-telegram-primary' : 'border-white/60 bg-black/30'}`}
                    >
                        {isSelected && <div className="w-1.5 h-1.5 bg-black rounded-full" />}
                    </div>
                )}

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
                    <h3 className={`w-full truncate font-medium ${isFolder ? 'text-sm' : 'text-xs sm:text-sm'}`} title={file.name}>{file.name}</h3>
                    <p className={`mt-0.5 text-xs ${thumbnail ? 'text-white/70' : 'text-telegram-subtext'}`}>{file.sizeStr}</p>
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
                <div className="absolute top-2 right-2 z-10 hidden gap-1 transition-opacity sm:flex sm:opacity-0 sm:group-hover:opacity-100">
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
