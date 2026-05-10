import { Clipboard, Copy, Scissors, X } from 'lucide-react';

interface PasteBarProps {
    mode: 'copy' | 'cut';
    count: number;
    disabled?: boolean;
    onPaste: () => void;
    onClear: () => void;
}

export function PasteBar({ mode, count, disabled = false, onPaste, onClear }: PasteBarProps) {
    const isCopy = mode === 'copy';
    const title = isCopy ? `Copying ${count}` : `Moving ${count}`;
    const actionLabel = isCopy ? 'Paste Copy' : 'Move Here';

    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3">
            <div className="pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-lg border border-telegram-border bg-telegram-surface/95 p-2 shadow-2xl backdrop-blur-xl">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-telegram-hover text-telegram-primary">
                    {isCopy ? <Copy className="h-4 w-4" /> : <Scissors className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-telegram-text">
                        {title} item{count === 1 ? '' : 's'}
                    </div>
                    <div className="truncate text-xs text-telegram-subtext">
                        Open a folder, then paste here.
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onPaste}
                    disabled={disabled}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-telegram-primary px-3 py-2 text-xs font-semibold text-black transition hover:bg-telegram-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Clipboard className="h-3.5 w-3.5" />
                    {actionLabel}
                </button>
                <button
                    type="button"
                    onClick={onClear}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-telegram-subtext transition hover:bg-telegram-hover hover:text-telegram-text"
                    aria-label="Clear clipboard"
                    title="Clear clipboard"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
