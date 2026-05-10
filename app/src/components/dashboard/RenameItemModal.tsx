import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { TelegramFile } from '../../types';

interface RenameItemModalProps {
    item: TelegramFile;
    onClose: () => void;
    onSave: (name: string) => void;
}

export function RenameItemModal({ item, onClose, onSave }: RenameItemModalProps) {
    const [name, setName] = useState(item.name);
    const inputRef = useRef<HTMLInputElement>(null);
    const trimmed = name.trim();
    const canSave = trimmed.length > 0 && trimmed !== item.name;
    const selectionEnd = useMemo(() => {
        if (item.type === 'folder') return item.name.length;
        const dotIndex = item.name.lastIndexOf('.');
        return dotIndex > 0 ? dotIndex : item.name.length;
    }, [item.name, item.type]);

    useEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(0, selectionEnd);
    }, [selectionEnd]);

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <form
                className="w-full max-w-sm overflow-hidden rounded-lg border border-telegram-border bg-telegram-surface shadow-2xl"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                    event.preventDefault();
                    if (canSave) onSave(trimmed);
                }}
            >
                <div className="flex items-center justify-between border-b border-telegram-border px-4 py-3">
                    <h3 className="text-sm font-semibold text-telegram-text">Rename</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-telegram-subtext transition hover:bg-telegram-hover hover:text-telegram-text"
                        aria-label="Close"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="space-y-3 px-4 py-4">
                    <input
                        ref={inputRef}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                onClose();
                            }
                        }}
                        className="h-10 w-full rounded-md border border-telegram-border bg-telegram-hover px-3 text-sm text-telegram-text outline-none transition focus:border-telegram-primary/70"
                    />
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md border border-telegram-border px-3 py-2 text-xs font-medium text-telegram-text transition hover:bg-telegram-hover"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!canSave}
                            className="inline-flex items-center gap-1.5 rounded-md bg-telegram-primary px-3 py-2 text-xs font-semibold text-black transition hover:bg-telegram-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Check className="h-3.5 w-3.5" />
                            Rename
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
