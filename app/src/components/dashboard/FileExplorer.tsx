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
    onVerify?: (file: TelegramFile) => void;
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
    uploadTargetLabel?: string;
}


function useGridColumns(containerRef: React.RefObject<HTMLDivElement | null>) {
    const [columns, setColumns] = useState(4);
    const [containerWidth, setContainerWidth] = useState(800);

    useEffect(() => {
        if (!containerRef.current) return;

        const updateColumns = () => {
            const width = containerRef.current?.clientWidth || 800;
            setContainerWidth(width);
            if (width < 640) setColumns(2);
            else if (width < 768) setColumns(3);
            else if (width < 1024) setColumns(4);
            else if (width < 1280) setColumns(5);
            else setColumns(6);
        };

        updateColumns();
        const observer = new ResizeObserver(updateColumns);
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [containerRef]);

    return { columns, containerWidth };
}

export function FileExplorer({
    files, loading, error, viewMode, selectedIds, activeFolderId,
    onFileClick, onDelete, onDownload, onPreview, onManualUpload, onManualFolderUpload, onCreateFolder, allowUpload = true, onSelectionClear, onToggleSelection, onDrop, onDragStart, onDragEnd, onRestore, onEditTags, onVerify, onRename, onSetFolderColor, onShowVersions, onCopy, onMove, onMergeFolder, onToggleLock, onToggleProtection, getItemPath, highlightedId, uploadTargetLabel
}: FileExplorerProps) {
    const [sortField, setSortField] = useState<SortField>('name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: TelegramFile } | null>(null);
    const shortUploadTargetLabel = useMemo(() => shortenTargetLabel(uploadTargetLabel), [uploadTargetLabel]);

    const parentRef = useRef<HTMLDivElement>(null);
    const { columns, containerWidth } = useGridColumns(parentRef);

    const GAP = 6;
    const cardWidth = (containerWidth - (GAP * (columns - 1))) / columns;
    const cardHeight = cardWidth * 0.75; // aspect-[4/3]
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
        const itemsWithUpload: (TelegramFile | 'upload')[] = allowUpload ? [...sortedFiles, 'upload'] : [...sortedFiles];
        for (let i = 0; i < itemsWithUpload.length; i += columns) {
            rows.push(itemsWithUpload.slice(i, i + columns));
        }
        return rows;
    }, [sortedFiles, columns, allowUpload]);


    const listItems = useMemo(() => {
        return allowUpload ? [...sortedFiles, 'upload' as const] : sortedFiles;
    }, [sortedFiles, allowUpload]);


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
            <div className="flex-1 p-6 flex justify-center items-center text-telegram-subtext flex-col gap-4">
                <div className="w-8 h-8 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin"></div>
                Loading your files...
            </div>
        )
    }

    if (error) {
        return <div className="flex-1 p-6 flex justify-center items-center text-red-400">Error loading files</div>
    }

    if (files.length === 0) {
        if (!allowUpload) {
            return (
                <div className="flex-1 p-6 flex justify-center items-center text-telegram-subtext">
                    No files here yet.
                </div>
            );
        }
        return (
            <div className="flex-1 p-6 overflow-auto">
                <EmptyState onUpload={onManualUpload} onUploadFolder={onManualFolderUpload} onCreateFolder={onCreateFolder} targetLabel={uploadTargetLabel} />
            </div>
        );
    }

    return (
        <div
            ref={parentRef}
            className="flex-1 p-6 overflow-auto custom-scrollbar"
            onClick={(e) => {
                if (e.target === e.currentTarget) onSelectionClear();
            }}
        >
            {viewMode === 'grid' ? (
                <>

                    <div className="flex items-center gap-2 mb-4 text-xs text-telegram-subtext">
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
                                                    className="border-2 border-dashed border-telegram-border rounded-xl flex flex-col items-center justify-center overflow-hidden text-telegram-subtext hover:border-telegram-primary transition-all group p-3 gap-1.5"
                                                    style={{ height: `${cardHeight}px` }}
                                                >
                                                    <Plus className="w-6 h-6 mb-1 shrink-0 group-hover:scale-110 transition-transform" />
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onManualUpload(); }}
                                                        className="text-sm font-medium hover:text-telegram-primary"
                                                    >
                                                        Upload Files
                                                    </button>
                                                    {onManualFolderUpload && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onManualFolderUpload(); }}
                                                            className="text-xs font-medium text-telegram-subtext hover:text-telegram-primary"
                                                        >
                                                            Upload Folder
                                                        </button>
                                                    )}
                                                    {onCreateFolder && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onCreateFolder(); }}
                                                            className="text-xs font-medium text-telegram-subtext hover:text-telegram-primary"
                                                        >
                                                            Create Folder
                                                        </button>
                                                    )}
                                                    {uploadTargetLabel && (
                                                        <div
                                                            className="mt-1 flex h-5 w-[90%] items-center justify-center overflow-hidden rounded border border-telegram-border bg-telegram-hover/80 px-2 text-[10px] leading-none text-telegram-subtext"
                                                            title={`To: ${uploadTargetLabel}`}
                                                        >
                                                            <span className="block min-w-0 truncate">To: {shortUploadTargetLabel}</span>
                                                        </div>
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
                                                onDelete={() => onDelete(file.id)}
                                                onDownload={() => onDownload(file.id, file.name)}
                                                onPreview={() => handlePreviewRequest(file)}
                                                onDrop={onDrop}
                                                onDragStart={onDragStart}
                                                onDragEnd={onDragEnd}
                                                activeFolderId={activeFolderId}
                                                height={cardHeight}
                                                onToggleSelection={() => onToggleSelection(file.id)}
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
                <div className="flex flex-col w-full">
                    {/* List Header */}
                    <div className="grid grid-cols-[2rem_2fr_6rem_8rem] gap-4 px-4 py-2 text-xs font-semibold text-telegram-subtext border-b border-telegram-border mb-2 select-none items-center">
                        <div className="text-center">#</div>
                        <button onClick={() => handleSort('name')} className="flex items-center gap-1 hover:text-telegram-text transition-colors">
                            Name <SortIcon field="name" />
                        </button>
                        <button onClick={() => handleSort('size')} className="flex items-center gap-1 justify-end hover:text-telegram-text transition-colors">
                            Size <SortIcon field="size" />
                        </button>
                        <button onClick={() => handleSort('date')} className="flex items-center gap-1 justify-end hover:text-telegram-text transition-colors">
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
                                        <div className={`grid gap-2 ${onManualFolderUpload || onCreateFolder ? 'grid-cols-3' : 'grid-cols-1'}`}>
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
                    onVerify={onVerify ? () => {
                        onVerify(contextMenu.file);
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

function shortenTargetLabel(label?: string) {
    if (!label) return '';
    const parts = label.split('/').map((part) => part.trim()).filter(Boolean);
    return parts[parts.length - 1] || label;
}
