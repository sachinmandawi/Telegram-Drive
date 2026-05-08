import { useState } from 'react';
import { HardDrive, Folder, Plus, RefreshCw, LogOut, Trash2, X } from 'lucide-react';
import { SidebarItem } from './SidebarItem';
import { BandwidthWidget } from './BandwidthWidget';
import { getPublicAssetPath } from '../../platform';
import { TelegramFolder, BandwidthStats, DriveView } from '../../types';

interface SidebarProps {
    folders: TelegramFolder[];
    activeFolderId: number | null;
    setActiveFolderId: (id: number | null) => void;
    onDrop: (e: React.DragEvent, folderId: number | null) => void;
    onDelete: (id: number, name: string) => void;
    onCreate: (name: string, parentId?: number | null, silent?: boolean) => Promise<unknown>;
    isSyncing: boolean;
    isConnected: boolean;
    onSync: () => void;
    onLogout: () => void;
    bandwidth: BandwidthStats | null;
    connectionLabel?: string;
    savedMessagesOnly?: boolean;
    activeDriveView?: DriveView;
    onDriveViewChange?: (view: DriveView) => void;
    mobileOpen?: boolean;
    onMobileClose?: () => void;
}

export function Sidebar({
    folders, activeFolderId, setActiveFolderId, onDrop, onDelete, onCreate,
    isSyncing, isConnected, onSync, onLogout, bandwidth, connectionLabel, savedMessagesOnly = false,
    activeDriveView = 'files', onDriveViewChange, mobileOpen = false, onMobileClose
}: SidebarProps) {
    const logoSrc = getPublicAssetPath('logo.svg');
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");

    const submitCreate = async () => {
        if (!newFolderName.trim()) return;
        try {
            await onCreate(newFolderName, activeDriveView === 'files' ? activeFolderId : null);
            setNewFolderName("");
            setShowNewFolderInput(false);
        } catch {
            // handled by parent
        }
    }

    const rootFolders = folders.filter((folder) => (folder.parent_id ?? null) === null);

    return (
        <aside
            className={`fixed inset-y-0 left-0 z-40 flex w-[84vw] max-w-72 flex-col border-r border-telegram-border bg-telegram-surface shadow-2xl transition-transform duration-200 md:static md:z-auto md:w-64 md:max-w-none md:translate-x-0 md:shadow-none ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
            onClick={e => e.stopPropagation()}
        >
            <div className="flex items-center gap-2 px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] md:pt-4">
                <img src={logoSrc} className="h-8 w-8 shrink-0 drop-shadow-lg" alt="Logo" />
                <span className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight text-telegram-text">Telegram Drive</span>
                <button
                    type="button"
                    className="rounded-md p-2 text-telegram-subtext transition hover:bg-telegram-hover hover:text-telegram-text md:hidden"
                    onClick={onMobileClose}
                    aria-label="Close navigation"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>

            {/* Scrollable folder list */}
            <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto min-h-0">
                <SidebarItem
                    icon={HardDrive}
                    label="Saved Messages"
                    active={activeDriveView === 'files' && activeFolderId === null}
                    onClick={() => {
                        onDriveViewChange?.('files');
                        setActiveFolderId(null);
                        onMobileClose?.();
                    }}
                    onDrop={(e: React.DragEvent) => onDrop(e, null)}
                    folderId={null}
                />
                <SidebarItem
                    icon={Trash2}
                    label="Trash"
                    active={activeDriveView === 'trash'}
                    onClick={() => {
                        onDriveViewChange?.('trash');
                        onMobileClose?.();
                    }}
                    onDrop={() => undefined}
                    folderId={null}
                />
                {!savedMessagesOnly && rootFolders.map(folder => (
                    <SidebarItem
                        key={folder.id}
                        icon={Folder}
                        label={folder.name}
                        active={activeDriveView === 'files' && activeFolderId === folder.id}
                        onClick={() => {
                            onDriveViewChange?.('files');
                            setActiveFolderId(folder.id);
                            onMobileClose?.();
                        }}
                        onDrop={(e: React.DragEvent) => onDrop(e, folder.id)}
                        onDelete={() => onDelete(folder.id, folder.name)}
                        folderId={folder.id}
                    />
                ))}
            </nav>

            {/* Sticky Create Folder section, always visible above the footer. */}
            {!savedMessagesOnly && <div className="px-2 pb-2 border-b border-telegram-border">
                {showNewFolderInput ? (
                    <div className="px-3 py-2">
                        <input
                            autoFocus
                            type="text"
                            className="w-full bg-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-telegram-primary"
                            placeholder="Folder Name"
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submitCreate()}
                            onBlur={() => !newFolderName && setShowNewFolderInput(false)}
                        />
                    </div>
                ) : (
                    <button
                        onClick={() => setShowNewFolderInput(true)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text transition-colors border border-dashed border-telegram-border"
                    >
                        <Plus className="w-4 h-4" />
                        Create Folder
                    </button>
                )}
            </div>}

            <div className="border-t border-telegram-border px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 md:pb-4">
                <div className="flex items-center gap-2 text-telegram-subtext text-xs">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                    <span>{connectionLabel || (isConnected ? 'Connected to Telegram' : 'Disconnected from Telegram')}</span>
                </div>

                <div className="flex gap-2 mt-4">
                    {!savedMessagesOnly && <button
                        onClick={onSync}
                        disabled={isSyncing}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-blue-500 hover:text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="Scan for existing folders"
                    >
                        <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Syncing...' : 'Sync'}
                    </button>}
                    <button
                        onClick={onLogout}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-red-500 hover:text-red-600 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                        title="Sign Out"
                    >
                        <LogOut className="w-3 h-3" />
                        Logout
                    </button>
                </div>

                {bandwidth && <BandwidthWidget bandwidth={bandwidth} />}
            </div>

        </aside>
    )
}
