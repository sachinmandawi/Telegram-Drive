import { useEffect } from 'react';
import { FolderPlus, FolderUp, Plus, Upload, type LucideIcon } from 'lucide-react';

interface FloatingCreateButtonProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUploadFiles: () => void;
    onUploadFolder?: () => void;
    onCreateFolder?: () => void;
}

export function FloatingCreateButton({
    open,
    onOpenChange,
    onUploadFiles,
    onUploadFolder,
    onCreateFolder,
}: FloatingCreateButtonProps) {
    const actions: Array<{ label: string; icon: LucideIcon; onClick: () => void }> = [
        { label: 'Upload Files', icon: Upload, onClick: onUploadFiles },
    ];

    if (onUploadFolder) {
        actions.push({ label: 'Upload Folder', icon: FolderUp, onClick: onUploadFolder });
    }

    if (onCreateFolder) {
        actions.push({ label: 'Create Folder', icon: FolderPlus, onClick: onCreateFolder });
    }

    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onOpenChange(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onOpenChange, open]);

    const runAction = (action: () => void) => {
        onOpenChange(false);
        action();
    };

    if (actions.length === 0) return null;

    return (
        <>
            {open && (
                <button
                    type="button"
                    aria-label="Close create menu"
                    className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
                    onClick={() => onOpenChange(false)}
                />
            )}

            <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 flex flex-col items-end gap-3 sm:bottom-5 sm:right-5">
                {open && (
                    <div className="flex flex-col items-end gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
                        {actions.map((action) => {
                            const Icon = action.icon;
                            return (
                                <button
                                    key={action.label}
                                    type="button"
                                    onClick={() => runAction(action.onClick)}
                                    className="flex h-12 w-44 items-center justify-start gap-3 rounded-2xl border border-white/10 bg-indigo-500 px-4 text-sm font-semibold text-white shadow-xl shadow-black/25 transition hover:bg-indigo-400 active:scale-[0.98] sm:h-11 sm:rounded-xl"
                                >
                                    <Icon className="h-5 w-5 shrink-0" />
                                    <span className="whitespace-nowrap">{action.label}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                <button
                    type="button"
                    aria-expanded={open}
                    aria-label={open ? 'Close create menu' : 'Open create menu'}
                    onClick={(event) => {
                        event.stopPropagation();
                        onOpenChange(!open);
                    }}
                    className={`flex h-16 w-16 items-center justify-center rounded-2xl shadow-2xl shadow-black/30 transition active:scale-95 sm:h-14 sm:w-14 ${open ? 'pointer-events-none bg-telegram-primary text-black opacity-50 blur-[2px]' : 'bg-telegram-primary text-black hover:bg-telegram-primary/90'}`}
                >
                    <Plus className="h-8 w-8" />
                </button>
            </div>
        </>
    );
}
