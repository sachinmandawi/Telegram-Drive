import type { ReactNode } from 'react';
import { Activity, FileText, Folder, Lock, Shield, ShieldCheck, Wrench, X } from 'lucide-react';
import { TelegramFile } from '../../types';
import { formatBytes } from '../../utils';

interface DetailsPanelProps {
    item: TelegramFile | null;
    selectedCount: number;
    currentPath: string;
    activity: TelegramFile[];
    unlockedCount: number;
    onClose: () => void;
    onRepair?: () => void;
    onLockProtected?: () => void;
}

export function DetailsPanel({
    item,
    selectedCount,
    currentPath,
    activity,
    unlockedCount,
    onClose,
    onRepair,
    onLockProtected,
}: DetailsPanelProps) {
    const itemActivity = item
        ? activity.filter((entry) => entry.name.toLowerCase().includes(item.name.toLowerCase()) || entry.name.includes(String(item.id))).slice(0, 8)
        : activity.slice(0, 8);
    const title = item ? item.name : selectedCount > 1 ? `${selectedCount} selected` : 'Location details';

    return (
        <aside className="w-80 shrink-0 border-l border-telegram-border bg-telegram-surface/95 backdrop-blur-md">
            <div className="flex h-14 items-center justify-between border-b border-telegram-border px-4">
                <h2 className="truncate text-sm font-semibold text-telegram-text">{title}</h2>
                <button onClick={onClose} className="rounded-md p-1 text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text" title="Close details">
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="custom-scrollbar h-[calc(100vh-3.5rem)] overflow-y-auto p-4">
                <div className="flex flex-col items-center border-b border-telegram-border pb-5 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-telegram-hover text-telegram-text">
                        {item?.type === 'folder' ? (
                            <Folder className="h-8 w-8" style={{ color: item.color || undefined }} />
                        ) : (
                            <FileText className="h-8 w-8 text-telegram-primary" />
                        )}
                    </div>
                    <div className="mt-3 max-w-full truncate text-sm font-medium text-telegram-text">{title}</div>
                    <div className="mt-1 text-xs text-telegram-subtext">{item?.type === 'folder' ? 'Folder' : item ? formatBytes(item.size || 0) : currentPath}</div>
                </div>

                <section className="border-b border-telegram-border py-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-telegram-subtext">Info</h3>
                    <DetailRow label="Path" value={item ? currentPath : currentPath} />
                    {item && <DetailRow label="Size" value={item.sizeStr || formatBytes(item.size || 0)} />}
                    {item?.created_at && <DetailRow label="Date" value={item.created_at} />}
                    {item?.originalPath && <DetailRow label="Original" value={item.originalPath} />}
                    {item?.checksum && <DetailRow label="Checksum" value={item.checksum.slice(0, 18) + '...'} />}
                    {item?.integrityStatus && <DetailRow label="Integrity" value={item.integrityStatus} />}
                    {item?.tags && item.tags.length > 0 && <DetailRow label="Tags" value={item.tags.join(', ')} />}
                </section>

                {(item?.locked || item?.protected || unlockedCount > 0) && (
                    <section className="border-b border-telegram-border py-4">
                        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-telegram-subtext">Security</h3>
                        <div className="space-y-2 text-sm text-telegram-subtext">
                            {item?.locked && <StatusLine icon={<Lock className="h-4 w-4 text-amber-400" />} text="Edits locked" />}
                            {item?.protected && <StatusLine icon={<Shield className="h-4 w-4 text-telegram-primary" />} text="PIN protected" />}
                            {item?.integrityStatus === 'valid' && <StatusLine icon={<ShieldCheck className="h-4 w-4 text-green-400" />} text="Checksum verified" />}
                            {unlockedCount > 0 && onLockProtected && (
                                <button onClick={onLockProtected} className="mt-2 w-full rounded-md border border-telegram-border px-3 py-2 text-sm text-telegram-text hover:bg-telegram-hover">
                                    Lock protected items now
                                </button>
                            )}
                        </div>
                    </section>
                )}

                <section className="py-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-telegram-subtext">Activity</h3>
                        <Activity className="h-4 w-4 text-telegram-subtext" />
                    </div>
                    <div className="space-y-2">
                        {itemActivity.map((entry) => (
                            <div key={entry.id} className="rounded-md bg-telegram-hover px-3 py-2 text-xs">
                                <div className="truncate text-telegram-text">{entry.name}</div>
                                <div className="mt-0.5 text-telegram-subtext">{entry.created_at || entry.sizeStr}</div>
                            </div>
                        ))}
                        {itemActivity.length === 0 && <p className="text-sm text-telegram-subtext">No activity yet.</p>}
                    </div>
                </section>

                {onRepair && (
                    <button onClick={onRepair} className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-telegram-border px-3 py-2 text-sm text-telegram-text hover:bg-telegram-hover">
                        <Wrench className="h-4 w-4" />
                        Repair Index
                    </button>
                )}
            </div>
        </aside>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="mb-2 grid grid-cols-[5rem_1fr] gap-3 text-xs">
            <div className="text-telegram-subtext">{label}</div>
            <div className="break-words text-telegram-text">{value}</div>
        </div>
    );
}

function StatusLine({ icon, text }: { icon: ReactNode; text: string }) {
    return (
        <div className="flex items-center gap-2">
            {icon}
            <span>{text}</span>
        </div>
    );
}
