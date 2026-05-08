import { useMemo, useState } from 'react';
import { ChevronRight, Folder, HardDrive, Plus, Search } from 'lucide-react';
import { TelegramFolder } from '../../types';

type MoveConflictStrategy = 'keep_both' | 'replace' | 'skip' | 'merge';

interface MoveToFolderModalProps {
    folders: TelegramFolder[];
    onClose: () => void;
    onSelect: (id: number | null) => void;
    activeFolderId: number | null;
    excludedFolderIds?: number[];
    conflictStrategy: MoveConflictStrategy;
    onConflictStrategyChange: (strategy: MoveConflictStrategy) => void;
}

interface FolderRow {
    folder: TelegramFolder;
    depth: number;
    path: string;
    disabled: boolean;
}

export function MoveToFolderModal({
    folders,
    onClose,
    onSelect,
    activeFolderId,
    excludedFolderIds = [],
    conflictStrategy,
    onConflictStrategyChange,
}: MoveToFolderModalProps) {
    const [query, setQuery] = useState('');
    const excluded = useMemo(() => collectExcludedFolders(folders, excludedFolderIds), [folders, excludedFolderIds]);
    const rows = useMemo(() => buildFolderRows(folders, excluded, activeFolderId, query), [folders, excluded, activeFolderId, query]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="flex max-h-[84vh] w-[28rem] flex-col overflow-hidden rounded-xl border border-telegram-border bg-telegram-surface shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-telegram-border p-4">
                    <h3 className="font-medium text-telegram-text">Move to Folder</h3>
                    <button onClick={onClose} className="text-telegram-subtext hover:text-telegram-text"><Plus className="h-5 w-5 rotate-45" /></button>
                </div>

                <div className="border-b border-telegram-border p-3">
                    <div className="flex items-center gap-2 rounded-lg border border-telegram-border bg-telegram-hover px-3 py-2 text-sm">
                        <Search className="h-4 w-4 text-telegram-subtext" />
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search folders..."
                            className="w-full bg-transparent text-telegram-text placeholder:text-telegram-subtext focus:outline-none"
                        />
                    </div>
                </div>

                <div className="custom-scrollbar flex-1 overflow-y-auto p-2">
                    <button
                        onClick={() => onSelect(null)}
                        disabled={activeFolderId === null}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm text-telegram-text transition-colors hover:bg-telegram-hover disabled:cursor-default disabled:opacity-50"
                    >
                        <div className="flex h-8 w-8 items-center justify-center rounded bg-telegram-primary/20 text-telegram-primary">
                            <HardDrive className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <div className="font-medium">Saved Messages</div>
                            <div className="text-xs text-telegram-subtext">Root</div>
                        </div>
                    </button>

                    {rows.map(({ folder, depth, path, disabled }) => (
                        <button
                            key={folder.id}
                            onClick={() => onSelect(folder.id)}
                            disabled={disabled}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-telegram-text transition-colors hover:bg-telegram-hover disabled:cursor-not-allowed disabled:opacity-45"
                            style={{ paddingLeft: `${12 + depth * 18}px` }}
                            title={path}
                        >
                            {!query && depth > 0 && <ChevronRight className="h-3 w-3 text-telegram-subtext" />}
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-telegram-hover text-telegram-text">
                                <Folder className="h-4 w-4" style={{ color: folder.color || undefined }} />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate font-medium">{folder.name}</div>
                                <div className="truncate text-xs text-telegram-subtext">{path}</div>
                            </div>
                        </button>
                    ))}

                    {rows.length === 0 && (
                        <div className="p-4 text-center text-xs text-telegram-subtext">No destination folders found.</div>
                    )}
                </div>

                <div className="border-t border-telegram-border p-3">
                    <div className="mb-2 text-xs font-medium text-telegram-subtext">Duplicate names</div>
                    <div className="grid grid-cols-4 gap-1 rounded-lg border border-telegram-border bg-telegram-hover p-1 text-[11px]">
                        {[
                            ['keep_both', 'Keep both'],
                            ['merge', 'Merge'],
                            ['replace', 'Replace'],
                            ['skip', 'Skip'],
                        ].map(([value, label]) => (
                            <button
                                key={value}
                                onClick={() => onConflictStrategyChange(value as MoveConflictStrategy)}
                                className={`rounded px-2 py-1.5 ${conflictStrategy === value ? 'bg-telegram-primary text-black' : 'text-telegram-subtext hover:text-telegram-text'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="mt-2 text-[11px] text-telegram-subtext">Choice applies to every conflict in this move.</div>
                </div>
            </div>
        </div>
    );
}

function collectExcludedFolders(folders: TelegramFolder[], ids: number[]) {
    const excluded = new Set(ids);
    let changed = true;
    while (changed) {
        changed = false;
        for (const folder of folders) {
            const parentId = folder.parent_id ?? null;
            if (parentId !== null && excluded.has(parentId) && !excluded.has(folder.id)) {
                excluded.add(folder.id);
                changed = true;
            }
        }
    }
    return excluded;
}

function buildFolderRows(
    folders: TelegramFolder[],
    excluded: Set<number>,
    activeFolderId: number | null,
    query: string
): FolderRow[] {
    const activeFolders = folders.filter((folder) => !folder.trashed);
    const byParent = new Map<number | null, TelegramFolder[]>();
    const byId = new Map(activeFolders.map((folder) => [folder.id, folder]));
    for (const folder of activeFolders) {
        const parentId = folder.parent_id ?? null;
        byParent.set(parentId, [...(byParent.get(parentId) || []), folder]);
    }
    for (const [parentId, items] of byParent) {
        byParent.set(parentId, items.sort((a, b) => a.name.localeCompare(b.name)));
    }

    const lowerQuery = query.trim().toLowerCase();
    const pathFor = (folder: TelegramFolder) => {
        const names = [folder.name];
        const seen = new Set<number>([folder.id]);
        let current = folder.parent_id ? byId.get(folder.parent_id) : undefined;
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            names.unshift(current.name);
            current = current.parent_id ? byId.get(current.parent_id) : undefined;
        }
        return `Saved Messages / ${names.join(' / ')}`;
    };

    if (lowerQuery) {
        return activeFolders
            .filter((folder) => !excluded.has(folder.id))
            .map((folder) => ({ folder, depth: 0, path: pathFor(folder), disabled: folder.id === activeFolderId }))
            .filter((row) => row.folder.name.toLowerCase().includes(lowerQuery) || row.path.toLowerCase().includes(lowerQuery))
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    const rows: FolderRow[] = [];
    const walk = (parentId: number | null, depth: number) => {
        for (const folder of byParent.get(parentId) || []) {
            if (excluded.has(folder.id)) continue;
            rows.push({ folder, depth, path: pathFor(folder), disabled: folder.id === activeFolderId });
            walk(folder.id, depth + 1);
        }
    };
    walk(null, 0);
    return rows;
}
