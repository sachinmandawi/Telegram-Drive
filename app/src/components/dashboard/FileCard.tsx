import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { Check, Folder, Lock, MoreVertical, Shield } from 'lucide-react';
import { TelegramFile } from '../../types';
import { FileTypeIcon } from '../FileTypeIcon';
import { invokeCommand } from '../../platform';
import { isImageFile } from '../../utils';

interface FileCardProps {
    file: TelegramFile;
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

export function FileCard({
    file,
    onPreview,
    isSelected,
    onClick,
    onContextMenu,
    onOpenContextMenu,
    onDrop,
    onDragStart,
    onDragEnd,
    activeFolderId,
    height,
    onToggleSelection,
    showSelectionControl = false,
    pathLabel,
    highlighted,
}: FileCardProps) {
    const isFolder = file.type === 'folder';
    const folderColor = file.color || '#ffae00';
    const [isDragOver, setIsDragOver] = useState(false);
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [thumbnailLoading, setThumbnailLoading] = useState(false);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
    const longPressTriggeredRef = useRef(false);
    const cardStyle = height ? { height: `${height}px` } : undefined;

    const clearLongPressTimer = () => {
        if (longPressTimerRef.current !== null) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

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
            folderId: activeFolderId,
        }).then((result) => {
            if (!result) return;
            if (cancelled) {
                if (result.startsWith('blob:')) URL.revokeObjectURL(result);
                return;
            }
            thumbnailUrl = result;
            setThumbnail(result);
        }).catch(() => {
            // Thumbnail failures should not block browsing.
        }).finally(() => {
            if (!cancelled) setThumbnailLoading(false);
        });

        return () => {
            cancelled = true;
            if (thumbnailUrl?.startsWith('blob:')) URL.revokeObjectURL(thumbnailUrl);
        };
    }, [file.id, file.name, activeFolderId, isFolder]);

    useEffect(() => clearLongPressTimer, []);

    const openMenuFromButton = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenContextMenu?.(event.clientX, event.clientY);
    };

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
            onDragOver={(event) => {
                if (isFolder) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!isDragOver) setIsDragOver(true);
                }
            }}
            onDragLeave={(event) => {
                if (isFolder) {
                    event.preventDefault();
                    event.stopPropagation();
                    setIsDragOver(false);
                }
            }}
            onDrop={(event) => {
                if (isFolder && onDrop) {
                    event.preventDefault();
                    event.stopPropagation();
                    setIsDragOver(false);
                    onDrop(event, file.id);
                }
            }}
        >
            <motion.div
                layout
                draggable
                onDragStartCapture={(event: React.DragEvent<HTMLDivElement>) => {
                    onDragStart?.(file.id);
                    event.dataTransfer.setData('application/x-telegram-file-id', file.id.toString());
                    event.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={onDragEnd}
                whileHover={{ y: -2 }}
                className={`group flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-telegram-surface transition-all hover:bg-telegram-hover/70
                ${isSelected || highlighted ? 'border-telegram-primary bg-telegram-primary/10 ring-1 ring-telegram-primary' : 'border-transparent hover:border-telegram-border'}
                ${isDragOver ? 'scale-[1.02] bg-telegram-primary/20 ring-2 ring-telegram-primary' : ''}`}
                style={cardStyle}
            >
                <div className="relative mx-2 mt-2 aspect-[1.78] overflow-hidden rounded-md border border-telegram-border bg-telegram-hover/45">
                    {(showSelectionControl || isSelected) && (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onToggleSelection?.();
                            }}
                            className={`absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full border transition ${isSelected ? 'border-telegram-primary bg-telegram-primary text-black' : 'border-white/60 bg-black/25 text-transparent hover:text-white'}`}
                            aria-label={isSelected ? 'Unselect item' : 'Select item'}
                        >
                            <Check className="h-3.5 w-3.5" />
                        </button>
                    )}
                    {thumbnail ? (
                        <img src={thumbnail} alt={file.name} className="h-full w-full object-cover" />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center">
                            {isFolder ? (
                                <Folder className="h-14 w-14" style={{ color: folderColor }} />
                            ) : thumbnailLoading && isImageFile(file) ? (
                                <div className="h-7 w-7 animate-spin rounded-full border-2 border-telegram-primary/30 border-t-telegram-primary" />
                            ) : (
                                <FileTypeIcon filename={file.name} size="lg" />
                            )}
                        </div>
                    )}
                    {file.locked && (
                        <div className="absolute right-9 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/40">
                            <Lock className="h-3 w-3 text-amber-400" />
                        </div>
                    )}
                    {file.protected && (
                        <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/40">
                            <Shield className="h-3 w-3 text-telegram-primary" />
                        </div>
                    )}
                </div>

                <div className="grid min-h-12 flex-1 grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-1 px-1 pb-1">
                    <div className="flex h-9 w-9 items-center justify-center">
                        {isFolder ? <Folder className="h-5 w-5" style={{ color: folderColor }} /> : <FileTypeIcon filename={file.name} className="h-5 w-5" />}
                    </div>
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onPreview?.();
                        }}
                        className="min-w-0 text-center"
                        title={file.name}
                    >
                        <div className="line-clamp-2 text-xs font-medium leading-snug text-telegram-text">{file.name}</div>
                        <div className="truncate text-[11px] leading-tight text-telegram-subtext">{pathLabel || file.sizeStr}</div>
                    </button>
                    <button
                        type="button"
                        onClick={openMenuFromButton}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-telegram-subtext transition hover:bg-telegram-hover hover:text-telegram-text"
                        aria-label={`Open menu for ${file.name}`}
                        title="More"
                    >
                        <MoreVertical className="h-4 w-4" />
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
