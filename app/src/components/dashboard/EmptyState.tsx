import { FolderPlus, Upload } from 'lucide-react';

interface EmptyStateProps {
    onUpload: () => void;
    onUploadFolder?: () => void;
    onCreateFolder?: () => void;
}

export function EmptyState({ onUpload, onUploadFolder, onCreateFolder }: EmptyStateProps) {
    return (
        <div className="flex min-h-full flex-col items-center justify-center px-4 py-12 text-center sm:px-8 sm:py-20">
            {/* Custom SVG Illustration */}
            <svg
                className="mb-6 h-32 w-32 sm:mb-8 sm:h-48 sm:w-48"
                viewBox="0 0 200 200"
                fill="none"
            >
                {/* Cloud shape - Light: Blue-ish tint, Dark: Subtle overlay */}
                <ellipse cx="100" cy="120" rx="70" ry="40" className="fill-blue-100 dark:fill-telegram-primary/5 opacity-50 dark:opacity-30" />

                {/* Folder base - Light: White with Blue Border, Dark: Dark Blue with Border */}
                <path
                    d="M40 80 L40 140 C40 145 44 150 50 150 L150 150 C156 150 160 145 160 140 L160 80 Z"
                    className="fill-white dark:fill-[#1e3a5f] stroke-blue-200 dark:stroke-telegram-primary/30"
                    strokeWidth="1"
                />

                {/* Folder tab */}
                <path
                    d="M40 80 L40 70 C40 65 44 60 50 60 L80 60 L90 70 L90 80 Z"
                    className="fill-white dark:fill-[#1e3a5f] stroke-blue-200 dark:stroke-telegram-primary/30"
                    strokeWidth="1"
                />

                {/* Plus icon in center */}
                <circle cx="100" cy="110" r="20" className="fill-blue-50 dark:fill-telegram-primary/10 stroke-blue-300 dark:stroke-telegram-primary/50" strokeWidth="2" strokeDasharray="4 2" />
                <path d="M100 100 L100 120 M90 110 L110 110" className="stroke-telegram-primary" strokeWidth="2" strokeLinecap="round" />

                {/* Floating documents */}
                <g className="animate-pulse">
                    <rect x="130" y="50" width="25" height="30" rx="3" className="fill-blue-500" />
                    <rect x="135" y="56" width="15" height="2" rx="1" className="fill-white/80" />
                    <rect x="135" y="62" width="12" height="2" rx="1" className="fill-white/80" />
                </g>

                <g opacity="0.6">
                    <rect x="45" y="40" width="20" height="25" rx="3" className="fill-gray-300 dark:fill-gray-500" />
                    <rect x="49" y="45" width="12" height="2" rx="1" className="fill-white/80" />
                    <rect x="49" y="50" width="8" height="2" rx="1" className="fill-white/80" />
                </g>
            </svg>

            <h3 className="mb-2 text-lg font-semibold text-telegram-text sm:text-xl">
                This folder is empty
            </h3>
            <p className="mb-6 max-w-xs text-sm text-telegram-subtext">
                Drag and drop files here, or upload from your computer.
            </p>

            <div className="grid w-full max-w-xs grid-cols-1 gap-2 sm:max-w-none sm:grid-cols-3 sm:gap-3">
                <button
                    onClick={onUpload}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-telegram-primary px-5 py-3 font-medium text-black shadow-lg shadow-telegram-primary/20 transition-all hover:bg-telegram-primary/90 active:scale-[0.98]"
                >
                    <Upload className="w-5 h-5" />
                    Upload Files
                </button>
                {onUploadFolder && (
                    <button
                        onClick={onUploadFolder}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-telegram-border bg-telegram-hover px-5 py-3 font-medium text-telegram-text transition-all hover:border-telegram-primary hover:text-telegram-primary active:scale-[0.98]"
                    >
                        <Upload className="w-5 h-5" />
                        Upload Folder
                    </button>
                )}
                {onCreateFolder && (
                    <button
                        onClick={onCreateFolder}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-telegram-border bg-telegram-hover px-5 py-3 font-medium text-telegram-text transition-all hover:border-telegram-primary hover:text-telegram-primary active:scale-[0.98]"
                    >
                        <FolderPlus className="w-5 h-5" />
                        Create Folder
                    </button>
                )}
            </div>

            <p className="mt-6 hidden text-xs text-telegram-subtext/50 sm:block">
                Tip: Use <kbd className="px-1.5 py-0.5 bg-telegram-hover rounded text-telegram-subtext">Cmd + F</kbd> to search
            </p>
        </div>
    );
}
