import { Copy, FileText, Folder, Info, X } from 'lucide-react';
import { toast } from 'sonner';
import { TelegramFile } from '../../types';
import { formatBytes, getFileExtension } from '../../utils';

interface PropertiesModalProps {
    item: TelegramFile;
    location: string;
    onClose: () => void;
}

export function PropertiesModal({ item, location, onClose }: PropertiesModalProps) {
    const isFolder = item.type === 'folder';
    const typeLabel = isFolder ? 'Folder' : describeFileType(item);
    const rows = [
        ['Name', item.name],
        ['Type', typeLabel],
        [isFolder ? 'Contents' : 'Size', isFolder ? item.sizeStr || 'Folder' : formatSize(item)],
        ['Location', location],
        ['Created', item.created_at || '-'],
        ['Status', item.trashed ? 'Trash' : item.missing ? 'Missing' : 'Available'],
        ['Protection', item.protected ? 'PIN protected' : item.locked ? 'Locked' : 'None'],
        ['Tags', item.tags?.length ? item.tags.join(', ') : '-'],
        ['Checksum', item.checksum || '-'],
        ['ID', String(item.id)],
    ].filter(([, value]) => value !== undefined && value !== null);

    const copySummary = () => {
        const summary = rows.map(([label, value]) => `${label}: ${value}`).join('\n');
        void navigator.clipboard?.writeText(summary);
        toast.success('Properties copied.');
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="flex max-h-[82dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-telegram-border bg-telegram-surface shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center gap-3 border-b border-telegram-border px-4 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-telegram-hover text-telegram-primary">
                        {isFolder ? <Folder className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-telegram-text">Properties</h3>
                        <p className="truncate text-xs text-telegram-subtext">{item.name}</p>
                    </div>
                    <button
                        type="button"
                        onClick={copySummary}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-telegram-subtext transition hover:bg-telegram-hover hover:text-telegram-text"
                        aria-label="Copy properties"
                        title="Copy properties"
                    >
                        <Copy className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-telegram-subtext transition hover:bg-telegram-hover hover:text-telegram-text"
                        aria-label="Close"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="overflow-y-auto px-4 py-3">
                    <div className="mb-3 flex items-start gap-2 rounded-md border border-telegram-border bg-telegram-hover/60 px-3 py-2 text-xs text-telegram-subtext">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-telegram-primary" />
                        <span>Basic Telegram Drive metadata for this item.</span>
                    </div>
                    <dl className="divide-y divide-telegram-border">
                        {rows.map(([label, value]) => (
                            <div key={label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5 text-sm">
                                <dt className="text-telegram-subtext">{label}</dt>
                                <dd className="min-w-0 break-words text-telegram-text">{value}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>
        </div>
    );
}

function describeFileType(item: TelegramFile) {
    const ext = getFileExtension(item);
    if (item.mime_type && ext) return `${ext.toUpperCase()} file (${item.mime_type})`;
    if (item.mime_type) return item.mime_type;
    if (ext) return `${ext.toUpperCase()} file`;
    return 'File';
}

function formatSize(item: TelegramFile) {
    const bytes = Number(item.size || 0);
    const human = item.sizeStr || formatBytes(bytes);
    return `${human} (${bytes.toLocaleString()} bytes)`;
}
