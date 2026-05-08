import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, FileUp, FolderPlus, FolderUp, Plus } from 'lucide-react';

interface NewMenuProps {
    onUpload?: () => void;
    onUploadFolder?: () => void;
    onCreateFolder?: () => void;
    targetLabel?: string;
    disabled?: boolean;
    variant?: 'toolbar' | 'empty' | 'tile' | 'list';
    align?: 'left' | 'right';
}

export function NewMenu({
    onUpload,
    onUploadFolder,
    onCreateFolder,
    targetLabel,
    disabled = false,
    variant = 'toolbar',
    align = 'right',
}: NewMenuProps) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const hasActions = Boolean(onUpload || onUploadFolder || onCreateFolder);

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        window.addEventListener('mousedown', close);
        return () => window.removeEventListener('mousedown', close);
    }, [open]);

    const run = (action?: () => void) => {
        if (!action) return;
        setOpen(false);
        action();
    };

    const baseButton = variant === 'toolbar'
        ? 'inline-flex items-center gap-2 rounded-lg bg-telegram-primary px-3 py-2 text-sm font-semibold text-black shadow-lg shadow-telegram-primary/20 hover:bg-telegram-primary/90 disabled:cursor-not-allowed disabled:opacity-50'
        : variant === 'empty'
            ? 'inline-flex items-center gap-2 rounded-xl bg-telegram-primary px-6 py-3 font-medium text-black shadow-lg shadow-telegram-primary/20 hover:bg-telegram-primary/90 disabled:cursor-not-allowed disabled:opacity-50'
            : variant === 'list'
                ? 'flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-telegram-border px-4 py-3 text-sm font-medium text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text disabled:cursor-not-allowed disabled:opacity-50'
                : 'flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-telegram-border p-3 text-telegram-subtext transition-all hover:border-telegram-primary hover:text-telegram-text disabled:cursor-not-allowed disabled:opacity-50';

    return (
        <div ref={menuRef} className="relative inline-flex" onClick={(event) => event.stopPropagation()}>
            <button
                type="button"
                disabled={disabled || !hasActions}
                onClick={() => setOpen((value) => !value)}
                className={baseButton}
                title={targetLabel ? `New in ${targetLabel}` : 'New'}
            >
                {variant === 'tile' ? <Plus className="h-8 w-8" /> : <Plus className="h-4 w-4" />}
                <span>{variant === 'tile' ? 'New' : '+ New'}</span>
                {variant !== 'tile' && <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {open && (
                <div
                    className={`absolute z-[120] mt-2 w-56 rounded-lg border border-telegram-border bg-telegram-surface p-1.5 shadow-2xl ${align === 'right' ? 'right-0' : 'left-0'} ${variant === 'tile' ? 'top-full left-1/2 -translate-x-1/2' : 'top-full'}`}
                >
                    {targetLabel && (
                        <div className="border-b border-telegram-border px-2 py-1.5 text-[11px] text-telegram-subtext">
                            {targetLabel}
                        </div>
                    )}
                    {onCreateFolder && (
                        <MenuButton icon={<FolderPlus className="h-4 w-4 text-telegram-primary" />} label="Folder" onClick={() => run(onCreateFolder)} />
                    )}
                    {onUpload && (
                        <MenuButton icon={<FileUp className="h-4 w-4 text-green-400" />} label="File upload" onClick={() => run(onUpload)} />
                    )}
                    {onUploadFolder && (
                        <MenuButton icon={<FolderUp className="h-4 w-4 text-yellow-400" />} label="Folder upload" onClick={() => run(onUploadFolder)} />
                    )}
                </div>
            )}
        </div>
    );
}

function MenuButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm text-telegram-text hover:bg-telegram-hover"
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}
