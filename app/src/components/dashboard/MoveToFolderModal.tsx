import { useMemo, useState } from 'react';
import { Plus, HardDrive, Folder, Search } from 'lucide-react';
import { TelegramFolder } from '../../types';

interface MoveToFolderModalProps {
    folders: TelegramFolder[];
    onClose: () => void;
    onSelect: (id: number | null) => void;
    activeFolderId: number | null;
    excludedFolderIds?: number[];
}

export function MoveToFolderModal({ folders, onClose, onSelect, activeFolderId, excludedFolderIds = [] }: MoveToFolderModalProps) {
    const [query, setQuery] = useState('');
    const excluded = useMemo(() => collectFolderTreeIds(excludedFolderIds, folders), [excludedFolderIds, folders]);
    const rows = useMemo(() => flattenFolderTree(folders, excluded, query), [excluded, folders, query]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-telegram-surface border border-telegram-border rounded-xl w-[26rem] max-w-[calc(100vw-2rem)] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-telegram-border flex justify-between items-center">
                    <h3 className="text-telegram-text font-medium">Move to Folder</h3>
                    <button onClick={onClose} className="text-telegram-subtext hover:text-telegram-text"><Plus className="w-5 h-5 rotate-45" /></button>
                </div>
                <div className="px-4 pt-3">
                    <label className="flex items-center gap-2 rounded-lg border border-telegram-border bg-telegram-hover px-3 py-2 text-sm text-telegram-subtext">
                        <Search className="h-4 w-4" />
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search folders..."
                            className="min-w-0 flex-1 bg-transparent text-telegram-text placeholder:text-telegram-subtext focus:outline-none"
                        />
                    </label>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    <button
                        onClick={() => onSelect(null)}
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-left text-telegram-text hover:bg-telegram-hover transition-colors"
                    >
                        <div className="w-8 h-8 rounded bg-telegram-primary/20 flex items-center justify-center text-telegram-primary">
                            <HardDrive className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <div className="font-medium">Saved Messages</div>
                            <div className="text-xs text-telegram-subtext">Drive root</div>
                        </div>
                    </button>

                    {rows.map(({ folder, depth, path }) => {
                        if (folder.id === activeFolderId) return null;
                        return (
                            <button
                                key={folder.id}
                                onClick={() => onSelect(folder.id)}
                                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-left text-telegram-text hover:bg-telegram-hover transition-colors"
                                style={{ paddingLeft: `${12 + Math.min(depth, 6) * 16}px` }}
                            >
                                <div className="w-8 h-8 rounded bg-telegram-hover flex items-center justify-center text-telegram-text">
                                    <Folder className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                    <div className="truncate font-medium">{folder.name}</div>
                                    <div className="truncate text-xs text-telegram-subtext">{path}</div>
                                </div>
                            </button>
                        )
                    })}

                    {rows.length === 0 && activeFolderId === null && (
                        <div className="p-4 text-center text-xs text-telegram-subtext">No other folders available. Create one first.</div>
                    )}
                </div>
            </div>
        </div>
    )
}

function collectFolderTreeIds(rootIds: number[], folders: TelegramFolder[]): Set<number> {
    const ids = new Set(rootIds);
    let changed = true;
    while (changed) {
        changed = false;
        for (const folder of folders) {
            if (!ids.has(folder.id) && ids.has(folder.parent_id ?? -1)) {
                ids.add(folder.id);
                changed = true;
            }
        }
    }
    return ids;
}

function flattenFolderTree(folders: TelegramFolder[], excluded: Set<number>, query: string) {
    const byParent = new Map<number | null, TelegramFolder[]>();
    for (const folder of folders) {
        if (folder.trashed || excluded.has(folder.id)) continue;
        const parentId = folder.parent_id ?? null;
        byParent.set(parentId, [...(byParent.get(parentId) || []), folder]);
    }
    for (const children of byParent.values()) {
        children.sort((a, b) => a.name.localeCompare(b.name));
    }

    const needle = query.trim().toLowerCase();
    const rows: { folder: TelegramFolder; depth: number; path: string }[] = [];
    const visit = (parentId: number | null, depth: number, pathParts: string[]) => {
        for (const folder of byParent.get(parentId) || []) {
            const nextPath = [...pathParts, folder.name];
            const path = nextPath.join(' / ');
            if (!needle || path.toLowerCase().includes(needle)) {
                rows.push({ folder, depth, path });
            }
            visit(folder.id, depth + 1, nextPath);
        }
    };

    visit(null, 0, []);
    return rows;
}
