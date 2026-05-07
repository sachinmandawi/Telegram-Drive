import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
    ArchiveRestore,
    BarChart3,
    CheckCircle2,
    Database,
    Download,
    HardDriveDownload,
    RefreshCw,
    ShieldCheck,
    Trash2,
    Upload,
    UserPlus,
    Users,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { DriveStats, OfflineCacheStats, TelegramAccountInfo } from '../../types';
import { formatBytes } from '../../utils';
import { invokeCommand, openExternal } from '../../platform';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';

interface WatchFolderControls {
    active: boolean;
    folderName: string | null;
    lastScanAt: string | null;
    knownFiles: number;
    queuedLastScan: number;
    supported: boolean;
    selectFolder: () => Promise<void>;
    scan: () => Promise<void>;
    stop: () => void;
}

interface DriveToolsModalProps {
    watchFolder: WatchFolderControls;
    selectedCount: number;
    onClose: () => void;
    onDataChanged: () => void;
    onAddAccount: () => void;
}

export function DriveToolsModal({
    watchFolder,
    selectedCount,
    onClose,
    onDataChanged,
    onAddAccount,
}: DriveToolsModalProps) {
    const [stats, setStats] = useState<DriveStats | null>(null);
    const [cacheStats, setCacheStats] = useState<OfflineCacheStats | null>(null);
    const [accounts, setAccounts] = useState<TelegramAccountInfo[]>([]);
    const [retentionDays, setRetentionDays] = useState(30);
    const [busy, setBusy] = useState<string | null>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const update = useUpdateCheck();

    const refresh = async () => {
        const [nextStats, nextCache, nextAccounts] = await Promise.all([
            invokeCommand<DriveStats>('cmd_get_drive_stats'),
            invokeCommand<OfflineCacheStats>('cmd_get_offline_cache_stats'),
            invokeCommand<TelegramAccountInfo[]>('cmd_list_accounts').catch(() => []),
        ]);
        setStats(nextStats);
        setCacheStats(nextCache);
        setAccounts(nextAccounts);
        setRetentionDays(nextStats.trashRetentionDays || 30);
    };

    useEffect(() => {
        refresh().catch(() => undefined);
    }, []);

    const runBusy = async (key: string, action: () => Promise<void>) => {
        setBusy(key);
        try {
            await action();
            await refresh();
            onDataChanged();
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            toast.error(message || 'Action failed.');
        } finally {
            setBusy(null);
        }
    };

    const exportManifest = () => runBusy('export', async () => {
        const backup = await invokeCommand<{ filename: string; payload: string }>('cmd_export_manifest');
        downloadTextFile(backup.filename, backup.payload, 'application/json');
        toast.success('Manifest backup exported.');
    });

    const importManifest = async (file: File | undefined) => {
        if (!file) return;
        await runBusy('import', async () => {
            await invokeCommand('cmd_import_manifest', { payload: await file.text() });
            toast.success('Manifest backup imported and merged.');
        });
    };

    const cleanupTrash = (deleteAll: boolean) => runBusy('trash', async () => {
        await invokeCommand('cmd_set_trash_retention', { days: retentionDays });
        const result = await invokeCommand<{ deleted: number; failed: number }>('cmd_cleanup_trash', {
            days: retentionDays,
            deleteAll,
        });
        toast.success(`Trash cleanup deleted ${result.deleted} item(s).`);
        if (result.failed > 0) toast.error(`${result.failed} item(s) could not be deleted.`);
    });

    const clearCache = () => runBusy('cache', async () => {
        await invokeCommand('cmd_clear_offline_cache');
        toast.success('Offline cache cleared.');
    });

    const switchAccount = (accountId: string) => runBusy(`account:${accountId}`, async () => {
        await invokeCommand('cmd_switch_account', { accountId });
        toast.success('Account switched.');
        window.location.reload();
    });

    return (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
            <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-telegram-border bg-telegram-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-telegram-border px-4 py-3">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-telegram-primary" />
                        <h2 className="text-sm font-semibold text-telegram-text">Drive Tools</h2>
                    </div>
                    <button onClick={onClose} className="rounded-md p-1 text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="custom-scrollbar grid gap-4 overflow-auto p-4 lg:grid-cols-2">
                    <section className="rounded-lg border border-telegram-border p-4">
                        <Header icon={<BarChart3 className="h-4 w-4" />} title="Analytics" action={<button onClick={() => refresh()} className="text-telegram-subtext hover:text-telegram-text"><RefreshCw className="h-4 w-4" /></button>} />
                        {stats ? (
                            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                <Metric label="Active Files" value={String(stats.activeFiles)} />
                                <Metric label="Used" value={formatBytes(stats.activeBytes)} />
                                <Metric label="Starred" value={String(stats.starredFiles)} />
                                <Metric label="Trash" value={String(stats.trashedFiles)} />
                                <Metric label="Duplicates" value={String(stats.duplicateFiles)} />
                                <Metric label="Text Indexed" value={String(stats.indexedTextFiles)} />
                                <Metric label="Verified" value={String(stats.verifiedFiles)} />
                                <Metric label="Mismatches" value={String(stats.checksumMismatches)} danger={stats.checksumMismatches > 0} />
                            </div>
                        ) : (
                            <Loading />
                        )}
                        {stats && stats.types.length > 0 && (
                            <div className="mt-4 space-y-2">
                                {stats.types.slice(0, 6).map((type) => (
                                    <div key={type.label} className="flex items-center justify-between text-xs text-telegram-subtext">
                                        <span>{type.label} - {type.count}</span>
                                        <span>{formatBytes(type.bytes)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="rounded-lg border border-telegram-border p-4">
                        <Header icon={<HardDriveDownload className="h-4 w-4" />} title="Watch Folder Sync" />
                        <div className="mt-3 space-y-3 text-sm text-telegram-subtext">
                            <p>{watchFolder.folderName || 'No folder selected'}</p>
                            <p>{watchFolder.lastScanAt ? `Last scan: ${watchFolder.lastScanAt}` : 'Waiting for first scan'}</p>
                            <p>{watchFolder.knownFiles} known file(s), {watchFolder.queuedLastScan} queued last scan</p>
                            <div className="flex flex-wrap gap-2">
                                <button onClick={() => watchFolder.selectFolder()} disabled={!watchFolder.supported} className="tool-btn">
                                    <Upload className="h-4 w-4" />
                                    Select Folder
                                </button>
                                <button onClick={() => watchFolder.scan()} disabled={!watchFolder.active} className="tool-btn">
                                    <RefreshCw className="h-4 w-4" />
                                    Rescan
                                </button>
                                <button onClick={watchFolder.stop} disabled={!watchFolder.active} className="tool-btn-danger">
                                    Stop
                                </button>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-lg border border-telegram-border p-4">
                        <Header icon={<ArchiveRestore className="h-4 w-4" />} title="Backup & Recovery" />
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button onClick={exportManifest} disabled={busy === 'export'} className="tool-btn">
                                <Download className="h-4 w-4" />
                                Export Manifest
                            </button>
                            <button onClick={() => importInputRef.current?.click()} disabled={busy === 'import'} className="tool-btn">
                                <Upload className="h-4 w-4" />
                                Import Manifest
                            </button>
                            <input
                                ref={importInputRef}
                                type="file"
                                accept="application/json,.json"
                                className="hidden"
                                onChange={(event) => {
                                    void importManifest(event.target.files?.[0]);
                                    event.currentTarget.value = '';
                                }}
                            />
                        </div>
                        <p className="mt-3 text-xs text-telegram-subtext">Cloud manifest merges keep newer file metadata, folders, and event history.</p>
                    </section>

                    <section className="rounded-lg border border-telegram-border p-4">
                        <Header icon={<Database className="h-4 w-4" />} title="Offline Cache" />
                        <div className="mt-3 space-y-3 text-sm text-telegram-subtext">
                            <p>{cacheStats ? `${cacheStats.items} item(s), ${formatBytes(cacheStats.bytes)} cached` : 'Loading cache...'}</p>
                            <button onClick={clearCache} disabled={busy === 'cache'} className="tool-btn-danger">
                                Clear Cache
                            </button>
                        </div>
                    </section>

                    <section className="rounded-lg border border-telegram-border p-4">
                        <Header icon={<Trash2 className="h-4 w-4" />} title="Trash Cleanup" />
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                            <input
                                type="number"
                                min={1}
                                max={365}
                                value={retentionDays}
                                onChange={(event) => setRetentionDays(Number(event.target.value) || 30)}
                                className="w-20 rounded-md border border-telegram-border bg-telegram-hover px-2 py-1 text-telegram-text outline-none"
                            />
                            <span className="text-telegram-subtext">day retention</span>
                            <button onClick={() => cleanupTrash(false)} disabled={busy === 'trash'} className="tool-btn">
                                Cleanup Old
                            </button>
                            <button onClick={() => cleanupTrash(true)} disabled={busy === 'trash'} className="tool-btn-danger">
                                Empty Trash
                            </button>
                        </div>
                    </section>

                    <section className="rounded-lg border border-telegram-border p-4">
                        <Header icon={<Users className="h-4 w-4" />} title="Accounts" />
                        <div className="mt-3 space-y-2">
                            {accounts.length === 0 && <p className="text-sm text-telegram-subtext">Current login is the only account.</p>}
                            {accounts.map((account) => (
                                <button
                                    key={account.id}
                                    onClick={() => switchAccount(account.id)}
                                    disabled={account.active || busy === `account:${account.id}`}
                                    className="flex w-full items-center justify-between rounded-md border border-telegram-border px-3 py-2 text-sm text-telegram-text hover:bg-telegram-hover disabled:cursor-default disabled:opacity-60"
                                >
                                    <span>{account.label}</span>
                                    {account.active && <CheckCircle2 className="h-4 w-4 text-green-400" />}
                                </button>
                            ))}
                            <button onClick={onAddAccount} className="tool-btn">
                                <UserPlus className="h-4 w-4" />
                                Add Account
                            </button>
                        </div>
                    </section>

                    <section className="rounded-lg border border-telegram-border p-4 lg:col-span-2">
                        <Header icon={<RefreshCw className="h-4 w-4" />} title="Updates & Release" />
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-telegram-subtext">
                            <button onClick={update.checkForUpdates} disabled={update.checking} className="tool-btn">
                                <RefreshCw className={`h-4 w-4 ${update.checking ? 'animate-spin' : ''}`} />
                                Check Updates
                            </button>
                            {update.available && (
                                <button onClick={update.downloadAndInstall} disabled={update.downloading} className="tool-btn">
                                    <Download className="h-4 w-4" />
                                    Install {update.version}
                                </button>
                            )}
                            <button onClick={() => openExternal('https://github.com/sachinmandawi/Telegram-Drive/releases')} className="tool-btn">
                                Releases
                            </button>
                            <span>{update.error || (update.available ? `Version ${update.version} available` : 'Updater ready')}</span>
                        </div>
                    </section>
                </div>

                <div className="border-t border-telegram-border px-4 py-3 text-xs text-telegram-subtext">
                    {selectedCount > 0 ? `${selectedCount} selected file(s) can be tagged, starred, moved, downloaded, or deleted from the toolbar.` : 'Select files to use bulk actions from the toolbar.'}
                </div>
            </div>
        </div>
    );
}

function Header({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-telegram-text">
                {icon}
                {title}
            </h3>
            {action}
        </div>
    );
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
    return (
        <div className="rounded-md bg-telegram-hover px-3 py-2">
            <p className="text-xs text-telegram-subtext">{label}</p>
            <p className={`mt-1 truncate text-base font-semibold ${danger ? 'text-red-400' : 'text-telegram-text'}`}>{value}</p>
        </div>
    );
}

function Loading() {
    return <div className="mt-3 text-sm text-telegram-subtext">Loading...</div>;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
