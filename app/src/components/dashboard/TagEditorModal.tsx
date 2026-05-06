import { useEffect, useState } from 'react';
import { Tag, X } from 'lucide-react';

interface TagEditorModalProps {
    title: string;
    initialTags?: string[];
    onSave: (tags: string[]) => void;
    onClose: () => void;
}

export function TagEditorModal({ title, initialTags = [], onSave, onClose }: TagEditorModalProps) {
    const [value, setValue] = useState(initialTags.join(', '));

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                onSave(parseTags(value));
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose, onSave, value]);

    return (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
            <div className="w-full max-w-md rounded-xl border border-telegram-border bg-telegram-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-telegram-border px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <Tag className="h-4 w-4 text-telegram-primary" />
                        <h2 className="truncate text-sm font-semibold text-telegram-text">{title}</h2>
                    </div>
                    <button onClick={onClose} className="rounded-md p-1 text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="space-y-3 px-4 py-4">
                    <input
                        autoFocus
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        className="w-full rounded-lg border border-telegram-border bg-telegram-hover px-3 py-2 text-sm text-telegram-text outline-none focus:border-telegram-primary/60"
                        placeholder="work, invoices, personal"
                    />
                    <div className="flex flex-wrap gap-2">
                        {parseTags(value).map((tag) => (
                            <span key={tag} className="rounded-full bg-telegram-primary/15 px-2 py-1 text-xs text-telegram-primary">
                                {tag}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-telegram-border px-4 py-3">
                    <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text">
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(parseTags(value))}
                        className="rounded-md bg-telegram-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-telegram-primary/90"
                    >
                        Save Tags
                    </button>
                </div>
            </div>
        </div>
    );
}

function parseTags(value: string): string[] {
    return Array.from(new Set(value
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)))
        .slice(0, 20);
}
