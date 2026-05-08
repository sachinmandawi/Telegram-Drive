import { CheckSquare, FolderPlus, HardDrive, LayoutGrid, Sun, Moon, Wrench, SlidersHorizontal, Tag, X } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface TopBarProps {
    currentFolderName: string;
    breadcrumbs?: { label: string; onClick?: () => void }[];
    selectedIds: number[];
    onSelectAll: () => void;
    onClearSelection: () => void;
    allSelected: boolean;
    selectableCount: number;
    onShowMoveModal: () => void;
    onCreateFolder?: () => void;
    onBulkDownload: () => void;
    onBulkDelete: () => void;
    onBulkRestore?: () => void;
    onDownloadFolder: () => void;
    onBulkTag: () => void;
    onOpenTools: () => void;
    viewMode: 'grid' | 'list';
    setViewMode: (mode: 'grid' | 'list') => void;
    searchTerm: string;
    onSearchChange: (term: string) => void;
    searchScope: 'current' | 'drive';
    onSearchScopeChange: (scope: 'current' | 'drive') => void;
    savedMessagesOnly?: boolean;
    onRepairDrive?: () => void;
    isRepairing?: boolean;
}

export function TopBar({
    currentFolderName, selectedIds, onShowMoveModal, onBulkDownload, onBulkDelete,
    onDownloadFolder, onBulkTag, onOpenTools, viewMode, setViewMode, searchTerm, onSearchChange, savedMessagesOnly = false,
    onRepairDrive, isRepairing = false, onSelectAll, onClearSelection, allSelected, selectableCount, breadcrumbs, onBulkRestore,
    searchScope, onSearchScopeChange, onCreateFolder
}: TopBarProps) {
    const { theme, toggleTheme } = useTheme();

    return (
        <header className="h-14 border-b border-telegram-border flex items-center px-4 justify-between bg-telegram-surface/80 backdrop-blur-md sticky top-0 z-10" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-4">
                <div className="flex items-center text-sm breadcrumbs text-telegram-subtext select-none">
                    {(breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs : [{ label: 'Start' }, { label: currentFolderName }]).map((crumb, index, items) => (
                        <span key={`${crumb.label}-${index}`} className="flex items-center">
                            <button
                                onClick={crumb.onClick}
                                disabled={!crumb.onClick}
                                className={`transition-colors ${crumb.onClick ? 'hover:text-telegram-text cursor-pointer' : 'cursor-default'} ${index === items.length - 1 ? 'text-telegram-text font-medium' : ''}`}
                            >
                                {crumb.label}
                            </button>
                            {index < items.length - 1 && <span className="mx-2">/</span>}
                        </span>
                    ))}
                </div>
            </div>

            <div className="flex-1 max-w-xl mx-4 flex items-center gap-2">
                <div className="flex-1">
                    <input
                        type="text"
                        placeholder="Search files..."
                        className="w-full bg-telegram-hover border border-telegram-border rounded-lg px-3 py-1.5 text-sm text-telegram-text placeholder:text-telegram-subtext focus:outline-none focus:border-telegram-primary/50 transition-colors"
                        value={searchTerm}
                        onChange={(e) => onSearchChange(e.target.value)}
                    />
                </div>
                <div className="flex rounded-md border border-telegram-border bg-telegram-hover p-0.5 text-[11px]">
                    <button onClick={() => onSearchScopeChange('current')} className={`rounded px-2 py-1 ${searchScope === 'current' ? 'bg-telegram-primary text-black' : 'text-telegram-subtext'}`}>Here</button>
                    <button onClick={() => onSearchScopeChange('drive')} className={`rounded px-2 py-1 ${searchScope === 'drive' ? 'bg-telegram-primary text-black' : 'text-telegram-subtext'}`}>Drive</button>
                </div>
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

            <div className="flex items-center gap-2">
                {selectedIds.length > 0 && (
                    <div className="flex items-center gap-2 mr-4 animate-in fade-in slide-in-from-top-2">
                        <span className="text-xs text-telegram-subtext mr-2">{selectedIds.length} Selected</span>
                        {allSelected ? (
                            <button onClick={onClearSelection} className="px-3 py-1.5 bg-telegram-hover hover:bg-telegram-border rounded-md text-xs text-telegram-text transition inline-flex items-center gap-1"><X className="w-3 h-3" /> Clear</button>
                        ) : selectableCount > selectedIds.length && (
                            <button onClick={onSelectAll} className="px-3 py-1.5 bg-telegram-hover hover:bg-telegram-border rounded-md text-xs text-telegram-text transition inline-flex items-center gap-1"><CheckSquare className="w-3 h-3" /> Select All</button>
                        )}
                        {!savedMessagesOnly && <button onClick={onShowMoveModal} className="px-3 py-1.5 bg-telegram-primary/20 hover:bg-telegram-primary/30 text-telegram-primary rounded-md text-xs transition font-medium">Move to...</button>}
                        {onBulkRestore && <button onClick={onBulkRestore} className="px-3 py-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded-md text-xs transition">Restore</button>}
                        <button onClick={onBulkTag} className="px-3 py-1.5 bg-telegram-hover hover:bg-telegram-border rounded-md text-xs text-telegram-text transition inline-flex items-center gap-1"><Tag className="w-3 h-3" /> Tags</button>
                        <button onClick={onBulkDownload} className="px-3 py-1.5 bg-telegram-hover hover:bg-telegram-border rounded-md text-xs text-telegram-text transition">Download Selected</button>
                        <button onClick={onBulkDelete} className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-md text-xs transition">Delete</button>
                    </div>
                )}

                <button onClick={onDownloadFolder} className="p-2 hover:bg-telegram-hover rounded-md text-telegram-subtext hover:text-telegram-text transition group relative" title="Download Folder">
                    <HardDrive className="w-5 h-5" />
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] bg-telegram-surface border border-telegram-border px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
                        Download All Files
                    </span>
                </button>

                {onCreateFolder && (
                    <button onClick={onCreateFolder} className="p-2 hover:bg-telegram-hover rounded-md text-telegram-subtext hover:text-telegram-text transition group relative" title="Create Folder">
                        <FolderPlus className="w-5 h-5" />
                        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] bg-telegram-surface border border-telegram-border px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
                            Create Folder
                        </span>
                    </button>
                )}

                {onRepairDrive && (
                    <button
                        onClick={onRepairDrive}
                        disabled={isRepairing}
                        className={`p-2 hover:bg-telegram-hover rounded-md text-telegram-subtext hover:text-telegram-text transition group relative ${isRepairing ? 'opacity-60 cursor-wait' : ''}`}
                        title="Repair Telegram Index"
                    >
                        <Wrench className={`w-5 h-5 ${isRepairing ? 'animate-pulse text-telegram-primary' : ''}`} />
                        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] bg-telegram-surface border border-telegram-border px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
                            Repair Index
                        </span>
                    </button>
                )}

                <button
                    onClick={onOpenTools}
                    className="p-2 hover:bg-telegram-hover rounded-md text-telegram-subtext hover:text-telegram-text transition group relative"
                    title="Drive Tools"
                >
                    <SlidersHorizontal className="w-5 h-5" />
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] bg-telegram-surface border border-telegram-border px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
                        Drive Tools
                    </span>
                </button>

                <button
                    onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                    className="p-2 hover:bg-telegram-hover rounded-md text-telegram-subtext hover:text-telegram-text transition relative group"
                    title="Toggle Layout"
                >
                    <LayoutGrid className="w-5 h-5" />
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] bg-telegram-surface border border-telegram-border px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
                        {viewMode === 'grid' ? 'Switch to List' : 'Switch to Grid'}
                    </span>
                </button>

                <div className="w-px h-6 bg-telegram-border mx-1"></div>

                <button
                    onClick={toggleTheme}
                    className="p-2 hover:bg-telegram-hover rounded-md text-telegram-subtext hover:text-telegram-text transition relative group"
                    title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                    {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] bg-telegram-surface border border-telegram-border px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
                        {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                    </span>
                </button>
            </div>
        </header>
    )
}
