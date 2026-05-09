import { Moon, SlidersHorizontal, Sun, Wrench, X, type LucideIcon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface SettingsPageProps {
    onOpenTools: () => void;
    onRepairDrive?: () => void;
    isRepairing?: boolean;
    onClose: () => void;
}

export function SettingsPage({
    onOpenTools,
    onRepairDrive,
    isRepairing = false,
    onClose,
}: SettingsPageProps) {
    const { theme, toggleTheme } = useTheme();

    return (
        <div className="fixed inset-0 z-[205] flex flex-col bg-telegram-bg text-telegram-text" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-center justify-between border-b border-telegram-border bg-telegram-surface px-4 pb-3 pt-[calc(0.85rem+env(safe-area-inset-top))] md:px-6 md:py-4">
                <div>
                    <h2 className="text-lg font-semibold">Settings</h2>
                    <p className="text-xs text-telegram-subtext">Display, drive tools, and recovery controls</p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md p-2 text-telegram-subtext transition hover:bg-telegram-hover hover:text-telegram-text"
                    aria-label="Close settings"
                >
                    <X className="h-5 w-5" />
                </button>
            </header>

            <main className="custom-scrollbar flex-1 overflow-auto p-4 md:p-6">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                    <section className="rounded-lg border border-telegram-border bg-telegram-surface p-4">
                        <SettingHeader icon={SlidersHorizontal} title="Drive Tools" />
                        <div className="mt-4 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    onClose();
                                    onOpenTools();
                                }}
                                className="tool-btn"
                            >
                                <SlidersHorizontal className="h-4 w-4" />
                                Open Drive Tools
                            </button>
                            {onRepairDrive && (
                                <button
                                    type="button"
                                    onClick={onRepairDrive}
                                    disabled={isRepairing}
                                    className="tool-btn"
                                >
                                    <Wrench className={`h-4 w-4 ${isRepairing ? 'animate-pulse' : ''}`} />
                                    {isRepairing ? 'Repairing Index...' : 'Repair Index'}
                                </button>
                            )}
                        </div>
                    </section>

                    <section className="rounded-lg border border-telegram-border bg-telegram-surface p-4">
                        <SettingHeader icon={theme === 'dark' ? Moon : Sun} title="Theme" />
                        <button
                            type="button"
                            onClick={toggleTheme}
                            className="mt-4 inline-flex h-11 items-center gap-2 rounded-md border border-telegram-border bg-telegram-hover px-4 text-sm font-medium text-telegram-text transition hover:border-telegram-primary/60"
                        >
                            {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4 text-telegram-primary" />}
                            {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                        </button>
                    </section>
                </div>
            </main>
        </div>
    );
}

function SettingHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
    return (
        <div className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="h-4 w-4 text-telegram-primary" />
            {title}
        </div>
    );
}
