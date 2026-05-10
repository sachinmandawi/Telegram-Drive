import { useEffect, useCallback } from 'react';

interface UseKeyboardShortcutsProps {
    onSelectAll: () => void;
    onDelete: () => void;
    onEscape: () => void;
    onSearch: () => void;
    onEnter?: () => void;
    onCut?: () => void;
    onCopy?: () => void;
    onPaste?: () => void;
    onRename?: () => void;
    onProperties?: () => void;
    enabled?: boolean;
}

export function useKeyboardShortcuts({
    onSelectAll,
    onDelete,
    onEscape,
    onSearch,
    onEnter,
    onCut,
    onCopy,
    onPaste,
    onRename,
    onProperties,
    enabled = true
}: UseKeyboardShortcutsProps) {

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!enabled) return;

        // Don't trigger shortcuts when typing in inputs
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            // Only allow Escape in inputs
            if (e.key === 'Escape') {
                (target as HTMLInputElement).blur();
                onEscape();
            }
            return;
        }

        const isMod = e.metaKey || e.ctrlKey;

        const key = e.key.toLowerCase();

        // Cmd/Ctrl + A - Select All
        if (isMod && key === 'a') {
            e.preventDefault();
            onSelectAll();
            return;
        }

        // Cmd/Ctrl + F - Focus Search
        if (isMod && key === 'f') {
            e.preventDefault();
            onSearch();
            return;
        }

        if (isMod && key === 'x' && onCut) {
            e.preventDefault();
            onCut();
            return;
        }

        if (isMod && key === 'c' && onCopy) {
            e.preventDefault();
            onCopy();
            return;
        }

        if (isMod && key === 'v' && onPaste) {
            e.preventDefault();
            onPaste();
            return;
        }

        // Delete / Backspace - Delete selected
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            onDelete();
            return;
        }

        // Escape - Clear selection
        if (e.key === 'Escape') {
            e.preventDefault();
            onEscape();
            return;
        }
        if (e.key === 'F2' && onRename) {
            e.preventDefault();
            onRename();
            return;
        }
        if (e.altKey && e.key === 'Enter' && onProperties) {
            e.preventDefault();
            onProperties();
            return;
        }
        // Enter - Open / Preview
        if (e.key === 'Enter') {
            e.preventDefault();
            onEnter?.();
            return;
        }
    }, [enabled, onSelectAll, onDelete, onEscape, onSearch, onEnter, onCut, onCopy, onPaste, onRename, onProperties]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
}
