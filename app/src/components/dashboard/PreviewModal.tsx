import { type ReactNode, useEffect, useRef, useState } from 'react';
import { File, FileText, Search, Table2, X } from 'lucide-react';
import { TelegramFile } from '../../types';
import {
    getFileExtension,
    isDocxPreviewFile,
    isImageFile,
    isSpreadsheetPreviewFile,
    isTextPreviewFile,
} from '../../utils';
import { invokeCommand, toAssetUrl } from '../../platform';
import { usePreviewNavigationGestures } from '../../hooks/usePreviewNavigationGestures';

const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
const PREVIEW_CACHE_MAX_ITEMS = 8;
const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
const SPREADSHEET_PREVIEW_MAX_ROWS = 60;
const SPREADSHEET_PREVIEW_MAX_COLS = 12;

type SpreadsheetSheetPreview = {
    name: string;
    rows: string[][];
    totalRows: number;
    totalCols: number;
    truncated: boolean;
};

type SpreadsheetPreview = {
    sheets: SpreadsheetSheetPreview[];
    truncated: boolean;
};

type PreviewCacheValue = {
    src: string;
    textContent?: string;
    htmlContent?: string;
    sheetPreview?: SpreadsheetPreview;
    truncated?: boolean;
    cachedAt: number;
};

const previewCache = new Map<string, PreviewCacheValue>();
const pendingPrefetch = new Set<string>();

const getPreviewCacheKey = (fileId: number, folderId: number | null) => `${folderId ?? 'home'}:${fileId}`;

const touchPreviewCache = (key: string, value: PreviewCacheValue) => {
    if (previewCache.has(key)) previewCache.delete(key);
    previewCache.set(key, value);

    while (previewCache.size > PREVIEW_CACHE_MAX_ITEMS) {
        const oldestKey = previewCache.keys().next().value;
        if (!oldestKey) break;
        previewCache.delete(oldestKey);
    }
};

const getCachedPreview = (key: string): PreviewCacheValue | null => {
    const value = previewCache.get(key);
    if (!value) return null;

    if (Date.now() - value.cachedAt > PREVIEW_CACHE_TTL_MS) {
        previewCache.delete(key);
        return null;
    }

    touchPreviewCache(key, value);
    return value;
};

const rememberPreview = (key: string, value: Omit<PreviewCacheValue, 'cachedAt'>) => {
    touchPreviewCache(key, { ...value, cachedAt: Date.now() });
};

const forgetPreview = (key: string) => {
    previewCache.delete(key);
};

const isSafeToPrefetch = (file: TelegramFile) => isImageFile(file);

interface PreviewModalProps {
    file: TelegramFile;
    onClose: () => void;
    onNext?: () => void;
    onPrev?: () => void;
    currentIndex?: number;
    totalItems?: number;
    nextFile?: TelegramFile | null;
    prevFile?: TelegramFile | null;
    activeFolderId: number | null;
}

export function PreviewModal({
    file,
    onClose,
    onNext,
    onPrev,
    currentIndex,
    totalItems,
    nextFile,
    prevFile,
    activeFolderId,
}: PreviewModalProps) {
    const [src, setSrc] = useState<string | null>(null);
    const [textContent, setTextContent] = useState<string | null>(null);
    const [htmlContent, setHtmlContent] = useState<string | null>(null);
    const [sheetPreview, setSheetPreview] = useState<SpreadsheetPreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloadNonce, setReloadNonce] = useState(0);
    const [retryCount, setRetryCount] = useState(0);
    const [isPreviewTruncated, setIsPreviewTruncated] = useState(false);
    const [previewSearchTerm, setPreviewSearchTerm] = useState('');
    const latestRequestRef = useRef(0);

    const imagePreview = isImageFile(file);
    const textPreview = isTextPreviewFile(file);
    const docxPreview = isDocxPreviewFile(file);
    const spreadsheetPreviewEnabled = isSpreadsheetPreviewFile(file);
    const navigationGestures = usePreviewNavigationGestures({ onNext, onPrev });

    useEffect(() => {
        setRetryCount(0);
        setReloadNonce(0);
        setSrc(null);
        setTextContent(null);
        setHtmlContent(null);
        setSheetPreview(null);
        setIsPreviewTruncated(false);
        setPreviewSearchTerm('');
    }, [file.id, activeFolderId]);

    useEffect(() => {
        const load = async () => {
            const key = getPreviewCacheKey(file.id, activeFolderId);
            const shouldBypassCache = reloadNonce > 0;
            const requestId = ++latestRequestRef.current;
            const cachedValue = shouldBypassCache ? null : getCachedPreview(key);

            if (cachedValue) {
                if (requestId !== latestRequestRef.current) return;
                setSrc(cachedValue.src);
                setTextContent(cachedValue.textContent || null);
                setHtmlContent(cachedValue.htmlContent || null);
                setSheetPreview(cachedValue.sheetPreview || null);
                setIsPreviewTruncated(Boolean(cachedValue.truncated));
                setLoading(false);
                setError(null);
                return;
            }

            setLoading(true);
            setError(null);
            setSrc(null);
            setTextContent(null);
            setHtmlContent(null);
            setSheetPreview(null);
            setIsPreviewTruncated(false);

            try {
                const path = await invokeCommand<string>('cmd_get_preview', {
                    messageId: file.id,
                    folderId: activeFolderId,
                });
                if (requestId !== latestRequestRef.current) return;

                if (!path) {
                    setError('Preview not available');
                    return;
                }

                const normalized = path.startsWith('data:') ? path : await toAssetUrl(path);
                if (requestId !== latestRequestRef.current) return;

                const nextCacheValue: Omit<PreviewCacheValue, 'cachedAt'> = { src: normalized };
                setSrc(normalized);

                if (textPreview) {
                    const previewResult = await loadTextPreview(normalized);
                    if (requestId !== latestRequestRef.current) return;
                    setTextContent(previewResult.content);
                    setIsPreviewTruncated(previewResult.truncated);
                    nextCacheValue.textContent = previewResult.content;
                    nextCacheValue.truncated = previewResult.truncated;
                } else if (docxPreview) {
                    const previewResult = await loadDocxPreview(normalized);
                    if (requestId !== latestRequestRef.current) return;
                    setHtmlContent(previewResult.content);
                    setIsPreviewTruncated(previewResult.truncated);
                    nextCacheValue.htmlContent = previewResult.content;
                    nextCacheValue.truncated = previewResult.truncated;
                } else if (spreadsheetPreviewEnabled) {
                    const previewResult = await loadSpreadsheetPreview(normalized);
                    if (requestId !== latestRequestRef.current) return;
                    setSheetPreview(previewResult.preview);
                    setIsPreviewTruncated(previewResult.truncated);
                    nextCacheValue.sheetPreview = previewResult.preview;
                    nextCacheValue.truncated = previewResult.truncated;
                }

                rememberPreview(key, nextCacheValue);
            } catch (e) {
                if (requestId !== latestRequestRef.current) return;
                setError(formatPreviewError(e));
            } finally {
                if (requestId !== latestRequestRef.current) return;
                setLoading(false);
            }
        };

        load();
    }, [activeFolderId, docxPreview, file, reloadNonce, spreadsheetPreviewEnabled, textPreview]);

    useEffect(() => {
        const candidates = [nextFile, prevFile].filter((candidate): candidate is TelegramFile => !!candidate && isSafeToPrefetch(candidate));

        candidates.forEach((candidate) => {
            const key = getPreviewCacheKey(candidate.id, activeFolderId);
            if (getCachedPreview(key) || pendingPrefetch.has(key)) return;

            pendingPrefetch.add(key);
            invokeCommand<string>('cmd_get_preview', {
                messageId: candidate.id,
                folderId: activeFolderId,
            }).then((path) => {
                if (!path) return;
                return toAssetUrl(path).then((normalized) => {
                    rememberPreview(key, { src: normalized });
                });
            }).catch(() => {
                // Ignore prefetch errors; the main preview flow will surface them.
            }).finally(() => {
                pendingPrefetch.delete(key);
            });
        });
    }, [nextFile, prevFile, activeFolderId]);

    useEffect(() => {
        const content = textContent
            || stripHtml(htmlContent || '')
            || flattenSpreadsheetPreview(sheetPreview)
            || '';
        if (!content.trim()) return;
        invokeCommand('cmd_index_file_text', {
            messageId: file.id,
            text: content,
            source: 'preview',
        }).catch(() => undefined);
    }, [file.id, htmlContent, sheetPreview, textContent]);

    const searchableText = textContent || stripHtml(htmlContent || '') || flattenSpreadsheetPreview(sheetPreview);
    const searchMatchCount = previewSearchTerm.trim()
        ? countMatches(searchableText, previewSearchTerm.trim())
        : 0;

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            const key = e.key.toLowerCase();

            if (e.key === 'ArrowRight' || key === 'l') {
                e.preventDefault();
                onNext?.();
                return;
            }

            if (e.key === 'ArrowLeft' || key === 'j') {
                e.preventDefault();
                onPrev?.();
                return;
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, onNext, onPrev]);

    return (
        <div
            className="fixed inset-0 z-[150] flex items-center justify-center bg-black/95 backdrop-blur-sm"
            onClick={onClose}
            {...navigationGestures}
        >
            <div className="relative flex h-full w-full flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 z-20 rounded-full bg-black/60 p-2 transition-colors hover:bg-black/80"
                    style={{ color: '#ffffff' }}
                >
                    <X className="h-6 w-6" />
                </button>

                {loading && (
                    <div className="flex flex-col items-center gap-4 text-white">
                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-telegram-primary border-t-transparent"></div>
                        <p>Loading preview...</p>
                        <p className="text-xs text-white/50">Downloading from Telegram...</p>
                    </div>
                )}

                {error && (
                    <div className="rounded-lg border border-red-500/20 bg-white/10 p-4 text-red-400">
                        <p className="font-bold">Preview Error</p>
                        <p className="text-sm">{error}</p>
                    </div>
                )}

                {!loading && !error && src && (
                    <div className="flex h-full w-full flex-col items-center justify-center">
                        {imagePreview ? (
                            <div className="flex h-full w-full items-center justify-center">
                                <img
                                    src={src}
                                    className="max-h-[100dvh] max-w-[100vw] bg-black object-contain"
                                    alt="Preview"
                                    onError={() => {
                                        const key = getPreviewCacheKey(file.id, activeFolderId);
                                        forgetPreview(key);

                                        if (retryCount < 1) {
                                            setRetryCount((prev) => prev + 1);
                                            setReloadNonce((prev) => prev + 1);
                                            return;
                                        }

                                        setError('Failed to render image preview');
                                    }}
                                />
                            </div>
                        ) : textPreview && textContent !== null ? (
                            <div className="h-full w-full overflow-hidden bg-[#0b1220]">
                                <PreviewHeader
                                    icon={<FileText className="h-4 w-4" />}
                                    label={getTextPreviewLabel(file)}
                                    hint={isPreviewTruncated ? 'Preview trimmed for speed' : undefined}
                                    extra={<PreviewSearch value={previewSearchTerm} onChange={setPreviewSearchTerm} matches={searchMatchCount} />}
                                />
                                <pre className="custom-scrollbar h-[calc(100dvh-3rem)] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-sm leading-6 text-slate-100">
                                    {renderHighlightedText(textContent, previewSearchTerm)}
                                </pre>
                            </div>
                        ) : docxPreview && htmlContent !== null ? (
                            <div className="h-full w-full overflow-hidden bg-[#0d1527]">
                                <PreviewHeader
                                    icon={<FileText className="h-4 w-4" />}
                                    label="Document preview"
                                    hint={isPreviewTruncated ? 'Some large sections may be condensed' : undefined}
                                    extra={<PreviewSearch value={previewSearchTerm} onChange={setPreviewSearchTerm} matches={searchMatchCount} />}
                                />
                                <div className="custom-scrollbar h-[calc(100dvh-3rem)] overflow-auto px-6 py-5 text-sm leading-7 text-slate-100">
                                    <div
                                        className="prose prose-invert max-w-none prose-headings:text-white prose-p:text-slate-100 prose-li:text-slate-100 prose-strong:text-white prose-a:text-telegram-primary"
                                        dangerouslySetInnerHTML={{ __html: htmlContent }}
                                    />
                                </div>
                            </div>
                        ) : spreadsheetPreviewEnabled && sheetPreview ? (
                            <div className="h-full w-full overflow-hidden bg-[#0b1220]">
                                <PreviewHeader
                                    icon={<Table2 className="h-4 w-4" />}
                                    label="Spreadsheet preview"
                                    hint={sheetPreview.truncated ? 'Large sheets were trimmed for fast preview' : undefined}
                                    extra={<PreviewSearch value={previewSearchTerm} onChange={setPreviewSearchTerm} matches={searchMatchCount} />}
                                />
                                <div className="custom-scrollbar h-[calc(100dvh-3rem)] overflow-auto px-4 py-4">
                                    <div className="flex flex-col gap-6">
                                        {sheetPreview.sheets.length === 0 ? (
                                            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/70">
                                                No readable cells were found in this sheet.
                                            </div>
                                        ) : (
                                            sheetPreview.sheets.map((sheet) => (
                                                <div key={sheet.name} className="rounded-lg border border-white/10 bg-white/5">
                                                    <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-medium text-white">{sheet.name}</p>
                                                            <p className="text-xs text-white/50">{sheet.totalRows} row(s), {sheet.totalCols} column(s)</p>
                                                        </div>
                                                        {sheet.truncated && (
                                                            <span className="text-xs text-amber-300">Trimmed preview</span>
                                                        )}
                                                    </div>
                                                    <div className="overflow-auto">
                                                        <table className="min-w-full border-collapse text-left text-sm text-slate-100">
                                                            <tbody>
                                                                {sheet.rows.map((row, rowIndex) => (
                                                                    <tr key={`${sheet.name}:${rowIndex}`} className="border-b border-white/5 align-top last:border-b-0">
                                                                        {row.map((cell, cellIndex) => (
                                                                            <td
                                                                                key={`${sheet.name}:${rowIndex}:${cellIndex}`}
                                                                                className="min-w-[8rem] max-w-[18rem] border-r border-white/5 px-3 py-2 whitespace-pre-wrap break-words last:border-r-0"
                                                                            >
                                                                                {cell || ' '}
                                                                            </td>
                                                                        ))}
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center bg-[#1c1c1c] p-8 text-center">
                                <File className="mx-auto mb-4 h-16 w-16 text-telegram-primary" />
                                <h3 className="mb-2 text-xl font-medium text-white">{file.name}</h3>
                                <p className="mb-6 text-gray-400">Inline preview is not available for this format yet.</p>
                                <p className="text-xs text-gray-500">File type: {getFileExtension(file) || 'unknown'}</p>
                            </div>
                        )}
                    </div>
                )}

                <div className="absolute bottom-4 left-1/2 max-w-[calc(100vw-2rem)] -translate-x-1/2 truncate rounded-full bg-black/45 px-3 py-1.5 text-sm text-white/70 backdrop-blur">
                    {file.name}
                    {typeof currentIndex === 'number' && typeof totalItems === 'number' && totalItems > 0 && (
                        <span className="ml-3">{currentIndex + 1}/{totalItems}</span>
                    )}
                </div>
            </div>
        </div>
    );
}

function PreviewHeader({ icon, label, hint, extra }: { icon: ReactNode; label: string; hint?: string; extra?: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 pr-16 text-xs text-white/60">
            <span className="flex items-center gap-2 uppercase tracking-[0.18em]">
                {icon}
                {label}
            </span>
            <span className="flex min-w-0 items-center gap-3">
                {extra}
                {hint && <span>{hint}</span>}
            </span>
        </div>
    );
}

function PreviewSearch({ value, onChange, matches }: { value: string; onChange: (value: string) => void; matches: number }) {
    return (
        <label className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1 normal-case tracking-normal">
            <Search className="h-3.5 w-3.5" />
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="w-32 bg-transparent text-xs text-white outline-none placeholder:text-white/40"
                placeholder="Search preview"
                onClick={(event) => event.stopPropagation()}
            />
            {value.trim() && <span className="text-[10px] text-white/40">{matches}</span>}
        </label>
    );
}

async function loadTextPreview(src: string): Promise<{ content: string; truncated: boolean }> {
    const response = await fetch(src);
    if (!response.ok) {
        throw new Error(`Failed to load text preview (${response.status})`);
    }

    const blob = await response.blob();
    const truncated = blob.size > TEXT_PREVIEW_MAX_BYTES;
    const previewBlob = truncated ? blob.slice(0, TEXT_PREVIEW_MAX_BYTES) : blob;
    const rawText = await previewBlob.text();

    return {
        content: formatPreviewText(rawText),
        truncated,
    };
}

async function loadDocxPreview(src: string): Promise<{ content: string; truncated: boolean }> {
    const arrayBuffer = await fetchPreviewArrayBuffer(src);
    const mammoth = await import('mammoth/mammoth.browser');
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const content = sanitizePreviewHtml(result.value || '<p>No readable text found in this document.</p>');

    return {
        content,
        truncated: result.messages.length > 0,
    };
}

async function loadSpreadsheetPreview(src: string): Promise<{ preview: SpreadsheetPreview; truncated: boolean }> {
    const response = await fetch(src);
    if (!response.ok) {
        throw new Error(`Failed to load spreadsheet preview (${response.status})`);
    }

    const rawText = await response.text();
    const delimiter = detectTableDelimiter(rawText);
    const allRows = rawText
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => splitDelimitedLine(line, delimiter));
    const totalRows = allRows.length;
    const totalCols = allRows.reduce((max, row) => Math.max(max, row.length), 0);
    const truncated = totalRows > SPREADSHEET_PREVIEW_MAX_ROWS || totalCols > SPREADSHEET_PREVIEW_MAX_COLS;
    const rows = allRows
        .slice(0, SPREADSHEET_PREVIEW_MAX_ROWS)
        .map((row) => row.slice(0, SPREADSHEET_PREVIEW_MAX_COLS).map(formatSpreadsheetCell));

    return {
        preview: {
            sheets: [{
                name: delimiter === '\t' ? 'TSV Preview' : 'CSV Preview',
                rows,
                totalRows,
                totalCols,
                truncated,
            }],
            truncated,
        },
        truncated,
    };
}

async function fetchPreviewArrayBuffer(src: string): Promise<ArrayBuffer> {
    const response = await fetch(src);
    if (!response.ok) {
        throw new Error(`Failed to load preview data (${response.status})`);
    }
    return await response.arrayBuffer();
}

function formatPreviewText(text: string): string {
    const trimmed = text.replace(/\u0000/g, '');
    try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(parsed, null, 2);
    } catch {
        return trimmed;
    }
}

function renderHighlightedText(text: string, query: string): ReactNode {
    const needle = query.trim();
    if (!needle) return text;

    const lowerText = text.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    const parts: ReactNode[] = [];
    let cursor = 0;
    let index = lowerText.indexOf(lowerNeedle);

    while (index !== -1) {
        if (index > cursor) parts.push(text.slice(cursor, index));
        parts.push(
            <mark key={`${index}:${needle}`} className="rounded bg-yellow-300/80 px-0.5 text-black">
                {text.slice(index, index + needle.length)}
            </mark>
        );
        cursor = index + needle.length;
        index = lowerText.indexOf(lowerNeedle, cursor);
    }

    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts;
}

function countMatches(text: string, query: string): number {
    if (!text || !query) return 0;
    const matches = text.toLowerCase().match(new RegExp(escapeRegExp(query.toLowerCase()), 'g'));
    return matches?.length || 0;
}

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHtml(html: string): string {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
}

function flattenSpreadsheetPreview(preview: SpreadsheetPreview | null): string {
    if (!preview) return '';
    return preview.sheets
        .flatMap((sheet) => sheet.rows.flatMap((row) => row))
        .join(' ');
}

function sanitizePreviewHtml(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');

    doc.querySelectorAll('script,style,iframe,object,embed').forEach((node) => node.remove());
    doc.querySelectorAll('*').forEach((node) => {
        Array.from(node.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim();

            if (name.startsWith('on') || name === 'srcdoc') {
                node.removeAttribute(attribute.name);
                return;
            }

            if ((name === 'href' || name === 'src') && /^javascript:/i.test(value)) {
                node.removeAttribute(attribute.name);
                return;
            }
        });

        if (node.tagName === 'A') {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noreferrer noopener');
        }
    });

    return doc.body.innerHTML || '<p>No readable text found in this document.</p>';
}

function formatSpreadsheetCell(value: string | number | boolean | null): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value);
}

function detectTableDelimiter(text: string): ',' | '\t' {
    const sample = text.slice(0, 4096);
    const commaCount = (sample.match(/,/g) || []).length;
    const tabCount = (sample.match(/\t/g) || []).length;
    return tabCount > commaCount ? '\t' : ',';
}

function splitDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        const next = line[index + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                index++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === delimiter && !inQuotes) {
            cells.push(current);
            current = '';
            continue;
        }

        current += char;
    }

    cells.push(current);
    return cells;
}

function getTextPreviewLabel(file: TelegramFile) {
    const ext = getFileExtension(file);
    if (ext) return `${ext} preview`;
    if (file.mime_type) return `${file.mime_type} preview`;
    return 'Text preview';
}

function formatPreviewError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
