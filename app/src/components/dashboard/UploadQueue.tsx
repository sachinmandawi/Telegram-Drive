import { QueueItem } from "../../types";

interface UploadQueueProps {
    items: QueueItem[];
    onClearFinished: () => void;
    onCancelAll: () => void;
    onPauseAll: () => void;
    onResumeAll: () => void;
    onRetryFailed: () => void;
    onRetryItem?: (id: string) => void;
    onRemoveItem?: (id: string) => void;
}

export function UploadQueue({ items, onClearFinished, onCancelAll, onPauseAll, onResumeAll, onRetryFailed, onRetryItem, onRemoveItem }: UploadQueueProps) {
    if (items.length === 0) return null;

    const hasPendingOrActive = items.some(i => i.status === 'pending' || i.status === 'uploading');
    const hasPending = items.some(i => i.status === 'pending');
    const hasPaused = items.some(i => i.status === 'paused');
    const hasRetryable = items.some(i => i.status === 'error' || i.status === 'cancelled' || i.status === 'skipped');

    return (
        <div className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[100] overflow-hidden rounded-xl border border-telegram-border bg-telegram-surface shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-80">
            <div className="flex items-center justify-between gap-3 border-b border-telegram-border bg-telegram-hover p-3">
                <h4 className="text-sm font-medium text-telegram-text">Uploads</h4>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {hasRetryable && (
                        <button onClick={onRetryFailed} className="text-xs text-telegram-primary hover:text-telegram-text transition-colors">Retry</button>
                    )}
                    {hasPaused && (
                        <button onClick={onResumeAll} className="text-xs text-telegram-primary hover:text-telegram-text transition-colors">Resume</button>
                    )}
                    {hasPending && (
                        <button onClick={onPauseAll} className="text-xs text-telegram-subtext hover:text-telegram-text transition-colors">Pause</button>
                    )}
                    {hasPendingOrActive && (
                        <button onClick={onCancelAll} className="text-xs text-red-400 hover:text-red-300 transition-colors">Cancel</button>
                    )}
                    <button onClick={onClearFinished} className="text-xs text-telegram-primary hover:text-telegram-text transition-colors">Clear</button>
                </div>
            </div>
            <div className="max-h-60 overflow-y-auto p-2 space-y-2">
                {items.map(item => (
                    <div key={item.id} className="flex flex-col gap-1 p-2 bg-telegram-hover rounded">
                        <div className="flex items-center gap-3 text-sm">
                            <div className={`w-2 h-2 rounded-full ${getUploadStatusDot(item)}`} />
                            <div className="flex-1 truncate text-telegram-subtext" title={item.path}>
                                {getUploadDisplayName(item.path)}
                            </div>
                            {item.status === 'uploading' && item.progress !== undefined && (
                                <div className="text-xs text-blue-400 font-mono">{item.progress}%</div>
                            )}
                            <div className={getUploadStatusTextClass(item)}>
                                {getUploadStatusLabel(item)}
                            </div>
                        </div>
                        {(item.status === 'uploading' || item.status === 'pending') && (
                            <div className="w-full bg-telegram-border h-1 mt-1 rounded-full overflow-hidden">
                                {item.progress !== undefined ? (
                                    <div
                                        className="bg-blue-500 h-full rounded-full transition-all duration-300"
                                        style={{ width: `${item.progress}%` }}
                                    />
                                ) : (
                                    <div className="bg-blue-500 h-full w-full animate-progress-indeterminate" />
                                )}
                            </div>
                        )}
                        {(item.error || item.conflictNote) && (
                            <div className={`pl-5 text-[11px] leading-snug break-words ${item.error ? 'text-red-300' : 'text-telegram-subtext'}`} title={item.error || item.conflictNote}>
                                {item.error || item.conflictNote}
                            </div>
                        )}
                        <div className="pl-5 flex items-center gap-3 text-[11px]">
                            {(item.status === 'error' || item.status === 'cancelled' || item.status === 'skipped') && onRetryItem && (
                                <button onClick={() => onRetryItem(item.id)} className="text-telegram-primary hover:text-telegram-text">
                                    Retry
                                </button>
                            )}
                            {(item.status === 'error' || item.status === 'cancelled' || item.status === 'success' || item.status === 'skipped' || item.status === 'paused') && onRemoveItem && (
                                <button onClick={() => onRemoveItem(item.id)} className="text-telegram-subtext hover:text-telegram-text">
                                    Remove
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

function getUploadStatusDot(item: QueueItem): string {
    if (item.status === 'pending') return item.retryAt && item.retryAt > Date.now() ? 'bg-amber-500' : 'bg-yellow-500';
    if (item.status === 'uploading') return 'bg-blue-500 animate-pulse';
    if (item.status === 'cancelled') return 'bg-gray-500';
    if (item.status === 'paused') return 'bg-purple-400';
    if (item.status === 'skipped') return 'bg-slate-400';
    if (item.status === 'error') return 'bg-red-500';
    return 'bg-green-500';
}

function getUploadStatusLabel(item: QueueItem): string {
    if (item.status === 'pending' && item.retryAt && item.retryAt > Date.now()) {
        return `Retry ${Math.ceil((item.retryAt - Date.now()) / 1000)}s`;
    }
    if (item.status === 'pending') return 'Queued';
    if (item.status === 'uploading') return '';
    if (item.status === 'success') return 'Done';
    if (item.status === 'error') return 'Error';
    if (item.status === 'cancelled') return 'Cancelled';
    if (item.status === 'paused') return 'Paused';
    if (item.status === 'skipped') return 'Skipped';
    return '';
}

function getUploadStatusTextClass(item: QueueItem): string {
    if (item.status === 'error') return 'text-xs text-red-400';
    if (item.status === 'cancelled' || item.status === 'skipped') return 'text-xs text-gray-400';
    if (item.status === 'paused') return 'text-xs text-purple-300';
    if (item.status === 'pending' && item.retryAt && item.retryAt > Date.now()) return 'text-xs text-amber-300';
    if (item.status === 'success') return 'text-xs text-green-400';
    return 'text-xs text-telegram-subtext';
}

function getUploadDisplayName(path: string): string {
    const normalizedPath = path.replace(/\\/g, '/');
    return normalizedPath.split('/').pop() || path;
}
