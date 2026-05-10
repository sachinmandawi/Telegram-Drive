import { CheckSquare, Copy, Menu, Scissors, Tag, X } from 'lucide-react';

interface TopBarProps {
    currentFolderName: string;
    breadcrumbs?: { label: string; onClick?: () => void }[];
    selectedIds: number[];
    onSelectAll: () => void;
    onClearSelection: () => void;
    allSelected: boolean;
    selectableCount: number;
    onShowMoveModal: () => void;
    onBulkCut?: () => void;
    onBulkCopy?: () => void;
    onBulkDownload: () => void;
    onBulkDelete: () => void;
    onBulkRestore?: () => void;
    onBulkTag: () => void;
    searchTerm: string;
    onSearchChange: (term: string) => void;
    savedMessagesOnly?: boolean;
    syncStatusText?: string;
    onOpenSidebar?: () => void;
}

export function TopBar({
    currentFolderName, selectedIds, onShowMoveModal, onBulkCut, onBulkCopy, onBulkDownload, onBulkDelete,
    onBulkTag, searchTerm, onSearchChange, savedMessagesOnly = false,
    onSelectAll, onClearSelection, allSelected, selectableCount, breadcrumbs, onBulkRestore,
    syncStatusText, onOpenSidebar
}: TopBarProps) {
    const visibleBreadcrumbs = breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs : [{ label: 'Start' }, { label: currentFolderName }];

    return (
        <header
            className="sticky top-0 z-20 border-b border-telegram-border bg-telegram-surface/95 px-4 pb-3 pt-[calc(0.65rem+env(safe-area-inset-top))] backdrop-blur-md md:h-14 md:px-4 md:py-0"
            onClick={e => e.stopPropagation()}
        >
            <div className="flex h-full min-h-12 w-full flex-col gap-3 md:min-h-0 md:flex-row md:items-center md:justify-between md:gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={onOpenSidebar}
                        className="shrink-0 rounded-md p-2 text-telegram-subtext transition hover:bg-telegram-hover hover:text-telegram-text md:hidden"
                        aria-label="Open navigation"
                    >
                        <Menu className="h-5 w-5" />
                    </button>

                    <div className="breadcrumbs flex min-w-0 items-center overflow-hidden text-sm text-telegram-subtext select-none">
                        {visibleBreadcrumbs.map((crumb, index, items) => (
                            <span key={`${crumb.label}-${index}`} className="flex min-w-0 shrink items-center">
                                <button
                                    onClick={crumb.onClick}
                                    disabled={!crumb.onClick}
                                    className={`max-w-[7rem] truncate transition-colors sm:max-w-[12rem] md:max-w-[16rem] ${crumb.onClick ? 'cursor-pointer hover:text-telegram-text' : 'cursor-default'} ${index === items.length - 1 ? 'font-medium text-telegram-text' : ''}`}
                                    title={crumb.label}
                                >
                                    {crumb.label}
                                </button>
                                {index < items.length - 1 && <span className="mx-1.5 shrink-0 md:mx-2">/</span>}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:flex md:max-w-3xl md:px-4">
                    <div className="min-w-0 flex-1">
                        <input
                            type="text"
                            placeholder="Search files..."
                            className="h-9 w-full rounded-lg border border-telegram-border bg-telegram-hover px-3 text-sm text-telegram-text transition-colors placeholder:text-telegram-subtext focus:border-telegram-primary/50 focus:outline-none"
                            value={searchTerm}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                    </div>
                    {syncStatusText && (
                        <div
                            className="hidden h-8 shrink-0 items-center rounded-lg border border-telegram-border/80 px-2 text-[11px] leading-none text-telegram-subtext xl:flex"
                            title={syncStatusText}
                        >
                            {syncStatusText}
                        </div>
                    )}
                    {['type:pdf', 'type:image', 'trash', 'size>10mb'].map((chip) => (
                        <button
                            key={chip}
                            onClick={() => onSearchChange(chip)}
                            className="hidden rounded border border-telegram-border px-2 py-1 text-[11px] text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text xl:inline-flex"
                        >
                            {chip}
                        </button>
                    ))}
                </div>

                {selectedIds.length > 0 && (
                    <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto animate-in fade-in slide-in-from-top-2 md:mr-3 md:gap-2 md:overflow-visible">
                        <span className="mr-1 shrink-0 text-xs text-telegram-subtext">{selectedIds.length} selected</span>
                        <button onClick={onClearSelection} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-telegram-hover px-2 py-1.5 text-xs text-telegram-text transition hover:bg-telegram-border md:px-3"><X className="h-3 w-3" /><span className="hidden sm:inline">Clear</span></button>
                        {!allSelected && selectableCount > selectedIds.length && (
                            <button onClick={onSelectAll} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-telegram-hover px-2 py-1.5 text-xs text-telegram-text transition hover:bg-telegram-border md:px-3"><CheckSquare className="h-3 w-3" /> Select All</button>
                        )}
                        {!savedMessagesOnly && <button onClick={onShowMoveModal} className="whitespace-nowrap rounded-md bg-telegram-primary/20 px-2 py-1.5 text-xs font-medium text-telegram-primary transition hover:bg-telegram-primary/30 md:px-3">Move</button>}
                        {!savedMessagesOnly && onBulkCut && <button onClick={onBulkCut} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-telegram-hover px-2 py-1.5 text-xs text-telegram-text transition hover:bg-telegram-border md:px-3"><Scissors className="h-3 w-3" /><span className="hidden sm:inline">Cut</span></button>}
                        {!savedMessagesOnly && onBulkCopy && <button onClick={onBulkCopy} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-telegram-hover px-2 py-1.5 text-xs text-telegram-text transition hover:bg-telegram-border md:px-3"><Copy className="h-3 w-3" /><span className="hidden sm:inline">Copy</span></button>}
                        {onBulkRestore && <button onClick={onBulkRestore} className="whitespace-nowrap rounded-md bg-green-500/10 px-2 py-1.5 text-xs text-green-400 transition hover:bg-green-500/20 md:px-3">Restore</button>}
                        <button onClick={onBulkTag} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-telegram-hover px-2 py-1.5 text-xs text-telegram-text transition hover:bg-telegram-border md:px-3"><Tag className="h-3 w-3" /><span className="hidden sm:inline">Tags</span></button>
                        <button onClick={onBulkDownload} className="whitespace-nowrap rounded-md bg-telegram-hover px-2 py-1.5 text-xs text-telegram-text transition hover:bg-telegram-border md:px-3">Download</button>
                        <button onClick={onBulkDelete} className="whitespace-nowrap rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-400 transition hover:bg-red-500/20 md:px-3">Delete</button>
                    </div>
                )}
            </div>
        </header>
    )
}
