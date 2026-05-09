import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Plus, ArrowUpDown, ArrowUp, ArrowDown, FolderPlus } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileCard } from './FileCard';
import { EmptyState } from './EmptyState';
import { TelegramFile } from '../../types';
import { ContextMenu } from './ContextMenu';
import { FileListItem } from './FileListItem';

type SortField = 'name' | 'size' | 'date';
type SortDirection = 'asc' | 'desc';

interface FileExplorerProps {
    files: TelegramFile[];
    loading: boolean;
    error: Error | null;
    viewMode: 'grid' | 'list';
    selectedIds: number[];
    activeFolderId: number | null;
    onFileClick: (e: React.MouseEvent, id: number) => void;
    onDelete: (id: number) => void;
    onDownload: (id: number, name: string) => void;
    onPreview: (file: TelegramFile, orderedFiles?: TelegramFile[]) => void;
    onManualUpload: () => void;
    onManualFolderUpload?: () => void;
    onCreateFolder?: () => void;
    allowUpload?: boolean;
    onSelectionClear: () => void;
    onToggleSelection: (id: number) => void;
    onDrop?: (e: React.DragEvent, folderId: number) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
    onRestore?: (file: TelegramFile) => void;
    onEditTags?: (file: TelegramFile) => void;
    onRename?: (file: TelegramFile) => void;
    onSetFolderColor?: (file: TelegramFile, color: string) => void;
    onShowVersions?: (file: TelegramFile) => void;
    onCopy?: (file: TelegramFile) => void;
    onMove?: (file: TelegramFile) => void;
    onMergeFolder?: (file: TelegramFile) => void;
    onToggleLock?: (file: TelegramFile) => void;
    onToggleProtection?: (file: TelegramFile) => void;
    getItemPath?: (file: TelegramFile) => string | undefined;
    highlightedId?: number | null;
}

type NavigatorWithUserAgentData = Navigator & {
    userAgentData?: {
        mobile?: boolean;
    };
};

const MOBILE_GRID_MAX_TOUCH_VIEWPORT_WIDTH = 900;
const MOBILE_GRID_MAX_TOUCH_SCREEN_SIDE = 1024;
const MOBILE_GRID_MAX_CONTAINER_WIDTH = 900;

function shouldUseMobileGrid() {
    if (typeof window === 'undefined') return false;

    const userAgentDataMobile = Boolean((navigator as NavigatorWithUserAgentData).userAgentData?.mobile);
    const userAgent = navigator.userAgent.toLowerCase();
    const mobileUserAgent = /android|iphone|ipad|ipod|iemobile|mobile/.test(userAgent);
    const touchCapable = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    const viewportWidth = Math.min(
        window.innerWidth || Number.POSITIVE_INFINITY,
        document.documentElement?.clientWidth || Number.POSITIVE_INFINITY
    );
    const screenWidth = window.screen?.width || Number.POSITIVE_INFINITY;
    const screenHeight = window.screen?.height || Number.POSITIVE_INFINITY;
    const smallestScreenSide = Math.min(screenWidth, screenHeight);

    return userAgentDataMobile
        || mobileUserAgent
        || (touchCapable && viewportWidth <= MOBILE_GRID_MAX_TOUCH_VIEWPORT_WIDTH)
        || (touchCapable && smallestScreenSide <= MOBILE_GRID_MAX_TOUCH_SCREEN_SIDE);
}


function useGridColumns(containerRef: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
    const [columns, setColumns] = useState(() => shouldUseMobileGrid() ? 2 : 4);
    const [containerWidth, setContainerWidth] = useState(800);

    useEffect(() => {
        if (!enabled || !containerRef.current) return;

        const updateColumns = () => {
            const width = containerRef.current?.clientWidth || 800;
            setContainerWidth(width);
            setColumns(width <= MOBILE_GRID_MAX_CONTAINER_WIDTH || shouldUseMobileGrid() ? 2 : 4);
        };

        updateColumns();
        const observer = new ResizeObserver(updateColumns);
        observer.observe(containerRef.current);
        const mobileGridQuery = window.matchMedia('(hover: none), (pointer: coarse), (max-width: 900px)');
        const legacyMobileGridQuery = mobileGridQuery as MediaQueryList & {
            addListener?: (listener: () => void) => void;
            removeListener?: (listener: () => void) => void;
        };
        window.addEventListener('resize', updateColumns);
        window.addEventListener('orientationchange', updateColumns);

        if (typeof mobileGridQuery.addEventListener === 'function') {
            mobileGridQuery.addEventListener('change', updateColumns);
        } else if (typeof legacyMobileGridQuery.addListener === 'function') {
            legacyMobileGridQuery.addListener(updateColumns);
        }

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', updateColumns);
            window.removeEventListener('orientationchange', updateColumns);
            if (typeof mobileGridQuery.removeEventListener === 'function') {
                mobileGridQuery.removeEventListener('change', updateColumns);
            } else if (typeof legacyMobileGridQuery.removeListener === 'function') {
                legacyMobileGridQuery.removeListener(updateColumns);
            }
        };
    }, [containerRef, enabled]);

    return { columns, containerWidth };
}

export function FileExplorer({
    files, loading, error, viewMode, selectedIds, activeFolderId,
    onFileClick, onDelete, onDownload, onPreview, onManualUpload, onManualFolderUpload, onCreateFolder, allowUpload = true, onSelectionClear, onToggleSelection, onDrop, onDragStart, onDragEnd, onRestore, onEditTags, onRename, onSetFolderColor, onShowVersions, onCopy, onMove, onMergeFolder, onToggleLock, onToggleProtection, getItemPath, highlightedId
}: FileExplorerProps) {
    const [sortField, setSortField] = useState<SortField>('name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: TelegramFile } | null>(null);

    const parentRef = useRef<HTMLDivElement>(null);
    const gridReady = !loading && !error && files.length > 0;
    const { columns, containerWidth } = useGridColumns(parentRef, gridReady);
    const selectionMode = selectedIds.length > 0;

    const GAP = containerWidth < 640 ? 12 : 6;
    const cardWidth = (containerWidth - (GAP * (columns - 1))) / columns;
    const cardHeight = cardWidth;
    const rowHeight = Math.max(cardHeight + GAP, 150);

    const handleContextMenu = useCallback((e: React.MouseEvent, file: TelegramFile) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, file });
    }, []);

    const sortedFiles = useMemo(() => {
        return [...files].sort((a, b) => {
            let comparison = 0;
            switch (sortField) {
                case 'name':
                    comparison = a.name.localeCompare(b.name);
                    break;
                case 'size':
                    comparison = (a.size || 0) - (b.size || 0);
                    break;
                case 'date':
                    comparison = (a.created_at || '').localeCompare(b.created_at || '');
                    break;
            }
            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }, [files, sortField, sortDirection]);

    const handlePreviewRequest = useCallback((file: TelegramFile) => {
        onPreview(file, sortedFiles);
    }, [onPreview, sortedFiles]);


    const gridRows = useMemo(() => {
        const rows: (TelegramFile | 'upload')[][] = [];
        const itemsWithUpload: (TelegramFile | 'upload')[] = [...sortedFiles];
        for (let i = 0; i < itemsWithUpload.length; i += columns) {
            rows.push(itemsWithUpload.slice(i, i + columns));
        }
        return rows;
    }, [sortedFiles, columns]);


    const listItems = useMemo<(TelegramFile | 'upload')[]>(() => [...sortedFiles], [sortedFiles]);


    const gridVirtualizer = useVirtualizer({
        count: gridRows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: useCallback(() => rowHeight, [rowHeight]),
        overscan: 2,
        gap: GAP,
    });


    useEffect(() => {
        gridVirtualizer.measure();
    }, [rowHeight, gridVirtualizer]);

    const listVirtualizer = useVirtualizer({
        count: listItems.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 48,
        overscan: 5,
    });

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
        return sortDirection === 'asc'
            ? <ArrowUp className="w-3 h-3 text-telegram-primary" />
            : <ArrowDown className="w-3 h-3 text-telegram-primary" />;
    };

    if (loading) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-3 text-telegram-subtext sm:p-4 md:p-6">
                <div className="w-8 h-8 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin"></div>
                Loading your files...
            </div>
        )
    }

    if (error) {
        return <div className="flex flex-1 items-center justify-center p-3 text-red-400 sm:p-4 md:p-6">Error loading files</div>
    }

    if (files.length === 0) {
        if (!allowUpload) {
            return (
                <div className="flex flex-1 items-center justify-center p-3 text-telegram-subtext sm:p-4 md:p-6">
                    No files here yet.
                </div>
            );
        }
        return (
            <div className="flex-1 overflow-auto p-3 sm:p-4 md:p-6">
                <EmptyState onUpload={onManualUpload} onUploadFolder={onManualFolderUpload} onCreateFolder={onCreateFolder} />
            </div>
        );
    }

    return (
        <div
            ref={parentRef}
            className="custom-scrollbar flex-1 overflow-auto p-3 sm:p-4 md:p-6"
            onClick={(e) => {
                if (e.target === e.currentTarget) onSelectionClear();
            }}
        >
            {viewMode === 'grid' ? (
                <>

                    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-telegram-subtext md:mb-4 md:gap-2">
                        <span>Sort by:</span>
                        <button
                            onClick={() => handleSort('name')}
                            className={`px-2 py-1 rounded flex items-center gap-1 hover:bg-white/5 ${sortField === 'name' ? 'text-telegram-primary' : ''}`}
                        >
                            Name <SortIcon field="name" />
                        </button>
                        <button
                            onClick={() => handleSort('size')}
                            className={`px-2 py-1 rounded flex items-center gap-1 hover:bg-white/5 ${sortField === 'size' ? 'text-telegram-primary' : ''}`}
                        >
                            Size <SortIcon field="size" />
                        </button>
                        <button
                            onClick={() => handleSort('date')}
                            className={`px-2 py-1 rounded flex items-center gap-1 hover:bg-white/5 ${sortField === 'date' ? 'text-telegram-primary' : ''}`}
                        >
                            Date <SortIcon field="date" />
                        </button>
                    </div>


                    <div
                        className="relative w-full"
                        style={{ height: `${gridVirtualizer.getTotalSize()}px` }}
                    >
                        {gridVirtualizer.getVirtualItems().map((virtualRow) => {
                            const row = gridRows[virtualRow.index];
                            return (
                                <div
                                    key={virtualRow.key}
                                    className="absolute top-0 left-0 w-full grid"
                                    style={{
                                        height: `${cardHeight}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                                        gap: `${GAP}px`,
                                    }}
                                >
                                    {row.map((item) => {
                                        if (item === 'upload') {
                                            return (
                                                <div
                                                    key="upload"
                                                    className="group flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-dashed border-telegram-border bg-telegram-hover/25 p-2 text-center text-telegram-subtext transition-all hover:border-telegram-primary sm:p-3"
                                                    style={{ height: `${cardHeight}px` }}
                                                >
                                                    <Plus className="w-6 h-6 mb-1 shrink-0 group-hover:scale-110 transition-transform" />
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onManualUpload(); }}
                                                        className="text-xs font-medium leading-tight hover:text-telegram-primary sm:text-sm"
                                                    >
                                                        Upload Files
                                                    </button>
                                                    {onManualFolderUpload && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onManualFolderUpload(); }}
                                                            className="text-xs font-medium leading-tight text-telegram-subtext hover:text-telegram-primary"
                                                        >
                                                            Upload Folder
                                                        </button>
                                                    )}
                                                    {onCreateFolder && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onCreateFolder(); }}
                                                            className="text-xs font-medium leading-tight text-telegram-subtext hover:text-telegram-primary"
                                                        >
                                                            Create Folder
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        }
                                        const file = item;
                                        return (
                                            <FileCard
                                                key={file.id}
                                                file={file}
                                                isSelected={selectedIds.includes(file.id)}
                                                onClick={(e) => onFileClick(e, file.id)}
                                                onContextMenu={(e) => handleContextMenu(e, file)}
                                                onOpenContextMenu={(x, y) => setContextMenu({ x, y, file })}
                                                onDelete={() => onDelete(file.id)}
                                                onDownload={() => onDownload(file.id, file.name)}
                                                onPreview={() => handlePreviewRequest(file)}
                                                onDrop={onDrop}
                                                onDragStart={onDragStart}
                                                onDragEnd={onDragEnd}
                                                activeFolderId={activeFolderId}
                                                height={cardHeight}
                                                onToggleSelection={() => onToggleSelection(file.id)}
                                                showSelectionControl={selectionMode}
                                                pathLabel={getItemPath?.(file)}
                                                highlighted={highlightedId === file.id}
                                            />
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : (
                <div className="flex w-full flex-col">
                    {/* List Header */}
                    <div className="mb-2 grid grid-cols-[2rem_minmax(0,1fr)_5rem] items-center gap-2 border-b border-telegram-border px-3 py-2 text-xs font-semibold text-telegram-subtext select-none md:grid-cols-[2rem_2fr_6rem_8rem] md:gap-4 md:px-4">
                        <div className="text-center">#</div>
                        <button onClick={() => handleSort('name')} className="flex items-center gap-1 hover:text-telegram-text transition-colors">
                            Name <SortIcon field="name" />
                        </button>
                        <button onClick={() => handleSort('size')} className="flex items-center gap-1 justify-end hover:text-telegram-text transition-colors">
                            Size <SortIcon field="size" />
                        </button>
                        <button onClick={() => handleSort('date')} className="hidden items-center justify-end gap-1 transition-colors hover:text-telegram-text md:flex">
                            Date <SortIcon field="date" />
                        </button>
                    </div>


                    <div
                        className="relative w-full"
                        style={{ height: `${listVirtualizer.getTotalSize()}px` }}
                    >
                        {listVirtualizer.getVirtualItems().map((virtualItem) => {
                            const item = listItems[virtualItem.index];
                            if (item === 'upload') {
                                return (
                                    <div
                                        key="upload"
                                        className="absolute top-0 left-0 w-full"
                                        style={{ transform: `translateY(${virtualItem.start}px)` }}
                                    >
                                        <div className={`grid gap-2 ${onManualFolderUpload || onCreateFolder ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1'}`}>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onManualUpload(); }}
                                                className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer border border-dashed border-telegram-border text-telegram-subtext hover:text-telegram-text hover:bg-telegram-hover w-full"
                                            >
                                                <div className="w-5 h-5 flex items-center justify-center"><Plus className="w-4 h-4" /></div>
                                                <span className="text-sm font-medium">Upload Files...</span>
                                            </button>
                                            {onManualFolderUpload && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onManualFolderUpload(); }}
                                                    className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer border border-dashed border-telegram-border text-telegram-subtext hover:text-telegram-text hover:bg-telegram-hover w-full"
                                                >
                                                    <div className="w-5 h-5 flex items-center justify-center"><Plus className="w-4 h-4" /></div>
                                                    <span className="text-sm font-medium">Upload Folder...</span>
                                                </button>
                                            )}
                                            {onCreateFolder && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onCreateFolder(); }}
                                                    className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer border border-dashed border-telegram-border text-telegram-subtext hover:text-telegram-text hover:bg-telegram-hover w-full"
                                                >
                                                    <div className="w-5 h-5 flex items-center justify-center"><FolderPlus className="w-4 h-4" /></div>
                                                    <span className="text-sm font-medium">Create Folder...</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            }
                            const file = item;
                            return (
                                <div
                                    key={file.id}
                                    className="absolute top-0 left-0 w-full"
                                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                                >
                                    <FileListItem
                                        file={file}
                                        selectedIds={selectedIds}
                                        onFileClick={onFileClick}
                                        handleContextMenu={handleContextMenu}
                                        onDragStart={onDragStart}
                                        onDragEnd={onDragEnd}
                                        onDrop={onDrop}
                                        onPreview={handlePreviewRequest}
                                        onDownload={onDownload}
                                        onDelete={onDelete}
                                        pathLabel={getItemPath?.(file)}
                                        highlighted={highlightedId === file.id}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    file={contextMenu.file}
                    onClose={() => setContextMenu(null)}
                    onSelect={() => {
                        if (!selectedIds.includes(contextMenu.file.id)) {
                            onToggleSelection(contextMenu.file.id);
                        }
                        setContextMenu(null);
                    }}
                    onDownload={() => {
                        onDownload(contextMenu.file.id, contextMenu.file.name);
                        setContextMenu(null);
                    }}
                    onDelete={() => {
                        onDelete(contextMenu.file.id);
                        setContextMenu(null);
                    }}
                    onPreview={() => {
                        handlePreviewRequest(contextMenu.file);
                        setContextMenu(null);
                    }}
                    onRestore={onRestore && contextMenu.file.trashed ? () => {
                        onRestore(contextMenu.file);
                        setContextMenu(null);
                    } : undefined}
                    onEditTags={onEditTags ? () => {
                        onEditTags(contextMenu.file);
                        setContextMenu(null);
                    } : undefined}
                    onRename={onRename ? () => {
                        onRename(contextMenu.file);
                        setContextMenu(null);
                    } : undefined}
                    onSetFolderColor={onSetFolderColor ? (color) => {
                        onSetFolderColor(contextMenu.file, color);
                        setContextMenu(null);
                    } : undefined}
                    onShowVersions={onShowVersions ? () => {
                        onShowVersions(contextMenu.file);
                        setContextMenu(null);
                    } : undefined}
                    onCopy={onCopy ? () => {
                        onCopy(contextMenu.file);
                        setContextMenu(null);
                    } : undefined}
                    onMove={onMove && !contextMenu.file.trashed ? () => {
                        onMove(contextMenu.file);
                        setContextMenu(null);
                    } : undefined}
                    onMergeFolder={onMergeFolder ? () => {
                        onMergeFolder(contextMenu.file);
                        setContextMenu(null);
                    } : undefined}
                    onToggleLock={onToggleLock ? () => {
                        onToggleLock(contextMenu.file);
                        setContextMenu(null);
                    } : undefined}
                    onToggleProtection={onToggleProtection ? () => {
                        onToggleProtection(contextMenu.file);
                        setContextMenu(null);
                    } : undefined}
                />
            )}
        </div>
    )
}
