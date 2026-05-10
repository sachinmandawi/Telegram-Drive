import { type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent, useEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, ChevronLeft, ChevronRight, Download, File, FileText, Presentation, RotateCcw, RotateCw, Search, Table2, ZoomIn, ZoomOut } from 'lucide-react';
import { TelegramFile } from '../../types';
import {
    formatBytes,
    getFileExtension,
    isArchivePreviewFile,
    isDocxPreviewFile,
    isImageFile,
    isPresentationPreviewFile,
    isSpreadsheetPreviewFile,
    isTextPreviewFile,
} from '../../utils';
import { invokeCommand, toAssetUrl } from '../../platform';
import { usePreviewNavigationGestures } from '../../hooks/usePreviewNavigationGestures';

const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
const PREVIEW_CACHE_MAX_ITEMS = 8;
const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
const SPREADSHEET_PREVIEW_MAX_ROWS = 80;
const SPREADSHEET_PREVIEW_MAX_COLS = 16;
const SPREADSHEET_PREVIEW_MAX_SHEETS = 6;
const ARCHIVE_PREVIEW_MAX_ENTRIES = 250;
const PRESENTATION_PREVIEW_MAX_SLIDES = 40;

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

type ArchiveEntryPreview = {
    name: string;
    path: string;
    type: string;
    size?: number;
    compressedSize?: number;
    date?: string;
    directory: boolean;
};

type ArchivePreview = {
    entries: ArchiveEntryPreview[];
    totalEntries: number;
    totalFiles: number;
    totalFolders: number;
    totalBytes: number;
    truncated: boolean;
};

type PresentationSlidePreview = {
    number: number;
    title: string;
    lines: string[];
};

type PresentationPreview = {
    slides: PresentationSlidePreview[];
    totalSlides: number;
    truncated: boolean;
};

type ZipTextFile = {
    async(type: 'string'): Promise<string>;
};

type ZipArchive = {
    file(path: string): ZipTextFile | null;
};

type PreviewCacheValue = {
    src: string;
    textContent?: string;
    htmlContent?: string;
    sheetPreview?: SpreadsheetPreview;
    archivePreview?: ArchivePreview;
    presentationPreview?: PresentationPreview;
    truncated?: boolean;
    cachedAt: number;
};

type PreviewPointer = {
    x: number;
    y: number;
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
    const [archivePreview, setArchivePreview] = useState<ArchivePreview | null>(null);
    const [presentationPreview, setPresentationPreview] = useState<PresentationPreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloadNonce, setReloadNonce] = useState(0);
    const [retryCount, setRetryCount] = useState(0);
    const [isPreviewTruncated, setIsPreviewTruncated] = useState(false);
    const [previewSearchTerm, setPreviewSearchTerm] = useState('');
    const [chromeVisible, setChromeVisible] = useState(true);
    const latestRequestRef = useRef(0);

    const imagePreview = isImageFile(file);
    const textPreview = isTextPreviewFile(file);
    const docxPreview = isDocxPreviewFile(file);
    const spreadsheetPreviewEnabled = isSpreadsheetPreviewFile(file);
    const archivePreviewEnabled = isArchivePreviewFile(file);
    const presentationPreviewEnabled = isPresentationPreviewFile(file);
    const navigationGestures = usePreviewNavigationGestures({ onNext, onPrev });

    useEffect(() => {
        setRetryCount(0);
        setReloadNonce(0);
        setSrc(null);
        setTextContent(null);
        setHtmlContent(null);
        setSheetPreview(null);
        setArchivePreview(null);
        setPresentationPreview(null);
        setIsPreviewTruncated(false);
        setPreviewSearchTerm('');
        setChromeVisible(true);
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
                setArchivePreview(cachedValue.archivePreview || null);
                setPresentationPreview(cachedValue.presentationPreview || null);
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
            setArchivePreview(null);
            setPresentationPreview(null);
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
                    const previewResult = await loadSpreadsheetPreview(normalized, file);
                    if (requestId !== latestRequestRef.current) return;
                    setSheetPreview(previewResult.preview);
                    setIsPreviewTruncated(previewResult.truncated);
                    nextCacheValue.sheetPreview = previewResult.preview;
                    nextCacheValue.truncated = previewResult.truncated;
                } else if (presentationPreviewEnabled) {
                    const previewResult = await loadPresentationPreview(normalized);
                    if (requestId !== latestRequestRef.current) return;
                    setPresentationPreview(previewResult.preview);
                    setIsPreviewTruncated(previewResult.truncated);
                    nextCacheValue.presentationPreview = previewResult.preview;
                    nextCacheValue.truncated = previewResult.truncated;
                } else if (archivePreviewEnabled) {
                    const previewResult = await loadArchivePreview(normalized);
                    if (requestId !== latestRequestRef.current) return;
                    setArchivePreview(previewResult.preview);
                    setIsPreviewTruncated(previewResult.truncated);
                    nextCacheValue.archivePreview = previewResult.preview;
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
    }, [activeFolderId, archivePreviewEnabled, docxPreview, file, presentationPreviewEnabled, reloadNonce, spreadsheetPreviewEnabled, textPreview]);

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
            || flattenPresentationPreview(presentationPreview)
            || flattenArchivePreview(archivePreview)
            || '';
        if (!content.trim()) return;
        invokeCommand('cmd_index_file_text', {
            messageId: file.id,
            text: content,
            source: 'preview',
        }).catch(() => undefined);
    }, [archivePreview, file.id, htmlContent, presentationPreview, sheetPreview, textContent]);

    const searchableText = textContent
        || stripHtml(htmlContent || '')
        || flattenSpreadsheetPreview(sheetPreview)
        || flattenPresentationPreview(presentationPreview)
        || flattenArchivePreview(archivePreview);
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

    const hasMultipleItems = typeof currentIndex === 'number' && typeof totalItems === 'number' && totalItems > 1;
    const previewChromeVisible = !imagePreview || chromeVisible;

    return (
        <div
            className="fixed inset-0 z-[150] bg-[#05070a] text-white"
            {...navigationGestures}
        >
            <div className="relative h-full w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <PreviewAppBar
                    file={file}
                    src={src}
                    visible={previewChromeVisible}
                    onClose={onClose}
                    currentIndex={currentIndex}
                    totalItems={totalItems}
                />

                {hasMultipleItems && (
                    <>
                        <PreviewSideButton
                            side="left"
                            label="Previous file"
                            visible={previewChromeVisible}
                            onClick={onPrev}
                        />
                        <PreviewSideButton
                            side="right"
                            label="Next file"
                            visible={previewChromeVisible}
                            onClick={onNext}
                        />
                    </>
                )}

                <div className={`flex h-full w-full flex-col items-center justify-center ${imagePreview ? '' : 'pt-14'}`}>
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
                            <ZoomableImagePreview
                                src={src}
                                alt={file.name}
                                controlsVisible={chromeVisible}
                                onToggleChrome={() => setChromeVisible((visible) => !visible)}
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
                        ) : textPreview && textContent !== null ? (
                            <div className="h-full w-full overflow-hidden bg-[#0b1220]">
                                <PreviewHeader
                                    icon={<FileText className="h-4 w-4" />}
                                    label={getTextPreviewLabel(file)}
                                    hint={isPreviewTruncated ? 'Preview trimmed for speed' : undefined}
                                    extra={<PreviewSearch value={previewSearchTerm} onChange={setPreviewSearchTerm} matches={searchMatchCount} />}
                                />
                                <pre className="custom-scrollbar h-[calc(100%_-_3rem)] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-sm leading-6 text-slate-100">
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
                                <div className="custom-scrollbar h-[calc(100%_-_3rem)] overflow-auto px-6 py-5 text-sm leading-7 text-slate-100">
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
                                <div className="custom-scrollbar h-[calc(100%_-_3rem)] overflow-auto px-4 py-4">
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
                        ) : presentationPreviewEnabled && presentationPreview ? (
                            <div className="h-full w-full overflow-hidden bg-[#111827]">
                                <PreviewHeader
                                    icon={<Presentation className="h-4 w-4" />}
                                    label="Presentation preview"
                                    hint={presentationPreview.truncated ? 'Large decks were trimmed for fast preview' : undefined}
                                    extra={<PreviewSearch value={previewSearchTerm} onChange={setPreviewSearchTerm} matches={searchMatchCount} />}
                                />
                                <div className="custom-scrollbar h-[calc(100%_-_3rem)] overflow-auto px-4 py-5">
                                    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
                                        {presentationPreview.slides.length === 0 ? (
                                            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/70">
                                                No readable slide text was found.
                                            </div>
                                        ) : (
                                            presentationPreview.slides.map((slide) => (
                                                <section key={slide.number} className="rounded-lg border border-white/10 bg-white/[0.04] p-4 shadow-lg">
                                                    <div className="mb-3 flex items-center gap-3 border-b border-white/10 pb-3">
                                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-telegram-primary/20 text-sm font-semibold text-telegram-primary">
                                                            {slide.number}
                                                        </div>
                                                        <h3 className="min-w-0 truncate text-base font-semibold text-white">{slide.title}</h3>
                                                    </div>
                                                    <div className="space-y-2 text-sm leading-6 text-slate-100">
                                                        {slide.lines.length === 0 ? (
                                                            <p className="text-white/50">No text on this slide.</p>
                                                        ) : (
                                                            slide.lines.map((line, index) => (
                                                                <p key={`${slide.number}:${index}`}>{renderHighlightedText(line, previewSearchTerm)}</p>
                                                            ))
                                                        )}
                                                    </div>
                                                </section>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : archivePreviewEnabled && archivePreview ? (
                            <div className="h-full w-full overflow-hidden bg-[#0b1220]">
                                <PreviewHeader
                                    icon={<Archive className="h-4 w-4" />}
                                    label="Archive preview"
                                    hint={archivePreview.truncated ? 'Large archives were trimmed for fast preview' : undefined}
                                    extra={<PreviewSearch value={previewSearchTerm} onChange={setPreviewSearchTerm} matches={searchMatchCount} />}
                                />
                                <div className="custom-scrollbar h-[calc(100%_-_3rem)] overflow-auto px-4 py-4">
                                    <div className="mb-4 grid gap-3 text-sm text-white/80 sm:grid-cols-3">
                                        <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                                            <p className="text-xs uppercase tracking-[0.16em] text-white/40">Files</p>
                                            <p className="mt-1 text-xl font-semibold text-white">{archivePreview.totalFiles}</p>
                                        </div>
                                        <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                                            <p className="text-xs uppercase tracking-[0.16em] text-white/40">Folders</p>
                                            <p className="mt-1 text-xl font-semibold text-white">{archivePreview.totalFolders}</p>
                                        </div>
                                        <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                                            <p className="text-xs uppercase tracking-[0.16em] text-white/40">Uncompressed</p>
                                            <p className="mt-1 text-xl font-semibold text-white">{formatBytes(archivePreview.totalBytes)}</p>
                                        </div>
                                    </div>
                                    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
                                        <div className="grid grid-cols-[minmax(0,1fr)_5rem_7rem] gap-3 border-b border-white/10 px-3 py-2 text-xs uppercase tracking-[0.12em] text-white/40 md:grid-cols-[minmax(0,1fr)_7rem_8rem_9rem]">
                                            <span>Name</span>
                                            <span>Type</span>
                                            <span className="text-right">Size</span>
                                            <span className="hidden md:block">Modified</span>
                                        </div>
                                        {archivePreview.entries.length === 0 ? (
                                            <div className="px-4 py-6 text-sm text-white/60">No entries found in this archive.</div>
                                        ) : (
                                            archivePreview.entries.map((entry) => (
                                                <div key={entry.path} className="grid grid-cols-[minmax(0,1fr)_5rem_7rem] gap-3 border-b border-white/5 px-3 py-2 text-sm text-slate-100 last:border-b-0 md:grid-cols-[minmax(0,1fr)_7rem_8rem_9rem]">
                                                    <span className="truncate" title={entry.path}>{renderHighlightedText(entry.path, previewSearchTerm)}</span>
                                                    <span className="truncate text-white/50">{entry.type}</span>
                                                    <span className="text-right text-white/60">{entry.size === undefined ? '-' : formatBytes(entry.size)}</span>
                                                    <span className="hidden truncate text-white/40 md:block">{entry.date || '-'}</span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full w-full overflow-hidden bg-[#111827]">
                                <PreviewHeader
                                    icon={<File className="h-4 w-4" />}
                                    label={getNativePreviewLabel(file)}
                                    hint="Metadata preview"
                                />
                                <UnsupportedFilePreview file={file} src={src} />
                            </div>
                        )}
                    </div>
                )}

                </div>
            </div>
        </div>
    );
}

function PreviewAppBar({
    file,
    src,
    visible,
    onClose,
    currentIndex,
    totalItems,
}: {
    file: TelegramFile;
    src: string | null;
    visible: boolean;
    onClose: () => void;
    currentIndex?: number;
    totalItems?: number;
}) {
    const subtitle = getPreviewSubtitle(file, currentIndex, totalItems);

    return (
        <div
            className={`absolute inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-white/10 bg-[#17212b]/95 px-2 text-white shadow-lg backdrop-blur transition-all duration-200 sm:px-3 ${visible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0'}`}
        >
            <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
                aria-label="Close preview"
                title="Back"
            >
                <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-medium leading-5 text-white" title={file.name}>
                    {file.name}
                </h2>
                <p className="truncate text-xs leading-4 text-white/55">{subtitle}</p>
            </div>
            {src && (
                <a
                    href={src}
                    download={file.name}
                    onClick={(event) => event.stopPropagation()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white"
                    aria-label="Download file"
                    title="Download"
                >
                    <Download className="h-5 w-5" />
                </a>
            )}
        </div>
    );
}

function PreviewSideButton({
    side,
    label,
    visible,
    onClick,
}: {
    side: 'left' | 'right';
    label: string;
    visible: boolean;
    onClick?: () => void;
}) {
    if (!onClick) return null;

    const Icon = side === 'left' ? ChevronLeft : ChevronRight;
    const positionClass = side === 'left' ? 'left-3' : 'right-3';

    return (
        <button
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                onClick();
            }}
            className={`absolute ${positionClass} top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/80 shadow-xl backdrop-blur transition-all duration-200 hover:bg-black/65 hover:text-white sm:flex ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            aria-label={label}
            title={label}
        >
            <Icon className="h-6 w-6" />
        </button>
    );
}

function getPreviewSubtitle(file: TelegramFile, currentIndex?: number, totalItems?: number) {
    const parts: string[] = [];
    if (typeof currentIndex === 'number' && typeof totalItems === 'number' && totalItems > 1) {
        parts.push(`${currentIndex + 1}/${totalItems}`);
    }
    if (file.size) parts.push(formatBytes(file.size));
    const extension = getFileExtension(file);
    if (extension) {
        parts.push(`${extension.toUpperCase()} preview`);
    } else if (file.mime_type) {
        parts.push(file.mime_type);
    } else {
        parts.push('Preview');
    }
    return parts.join(' - ');
}

function ZoomableImagePreview({
    src,
    alt,
    controlsVisible,
    onToggleChrome,
    onError,
}: {
    src: string;
    alt: string;
    controlsVisible: boolean;
    onToggleChrome: () => void;
    onError: () => void;
}) {
    const [scale, setScale] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const dragRef = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
    const activePointersRef = useRef(new Map<number, PreviewPointer>());
    const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
    const gestureMovedRef = useRef(false);
    const lastPinchAtRef = useRef(0);

    useEffect(() => {
        setScale(1);
        setRotation(0);
        setOffset({ x: 0, y: 0 });
        dragRef.current = null;
        pinchRef.current = null;
        activePointersRef.current.clear();
    }, [src]);

    const clampScale = (value: number) => Math.min(5, Math.max(0.5, value));
    const zoomBy = (delta: number) => {
        setScale((current) => {
            const next = clampScale(current + delta);
            if (next === 1) setOffset({ x: 0, y: 0 });
            return next;
        });
    };
    const rotateRight = () => {
        setRotation((current) => (current + 90) % 360);
        setOffset({ x: 0, y: 0 });
    };
    const reset = () => {
        setScale(1);
        setRotation(0);
        setOffset({ x: 0, y: 0 });
    };

    const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        zoomBy(event.deltaY < 0 ? 0.25 : -0.25);
    };

    const getPointerPair = () => Array.from(activePointersRef.current.values()).slice(0, 2);
    const getPointerDistance = (first: PreviewPointer, second: PreviewPointer) => Math.hypot(first.x - second.x, first.y - second.y);

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (activePointersRef.current.size >= 2) {
            const [first, second] = getPointerPair();
            if (first && second) {
                event.preventDefault();
                event.stopPropagation();
                dragRef.current = null;
                pinchRef.current = {
                    distance: getPointerDistance(first, second),
                    scale,
                };
                gestureMovedRef.current = true;
                lastPinchAtRef.current = Date.now();
            }
            return;
        }

        pinchRef.current = null;
        gestureMovedRef.current = false;

        if (scale > 1) {
            event.preventDefault();
            event.stopPropagation();
            dragRef.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                offsetX: offset.x,
                offsetY: offset.y,
            };
        }
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (activePointersRef.current.has(event.pointerId)) {
            activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }

        if (activePointersRef.current.size >= 2) {
            const [first, second] = getPointerPair();
            if (!first || !second) return;

            event.preventDefault();
            event.stopPropagation();
            gestureMovedRef.current = true;
            lastPinchAtRef.current = Date.now();

            const distance = getPointerDistance(first, second);
            if (!pinchRef.current || pinchRef.current.distance <= 0) {
                pinchRef.current = { distance, scale };
                return;
            }

            const nextScale = clampScale(pinchRef.current.scale * (distance / pinchRef.current.distance));
            setScale(nextScale);
            if (nextScale <= 1) setOffset({ x: 0, y: 0 });
            return;
        }

        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        gestureMovedRef.current = true;
        setOffset({
            x: drag.offsetX + event.clientX - drag.x,
            y: drag.offsetY + event.clientY - drag.y,
        });
    };

    const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        const wasPinching = Boolean(pinchRef.current) || activePointersRef.current.size > 1;
        activePointersRef.current.delete(event.pointerId);
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // The pointer may already be released by the browser.
        }

        const drag = dragRef.current;
        if (drag?.pointerId === event.pointerId) {
            event.preventDefault();
            event.stopPropagation();
            dragRef.current = null;
        }

        if (wasPinching) {
            event.preventDefault();
            event.stopPropagation();
            pinchRef.current = null;
            gestureMovedRef.current = true;
            lastPinchAtRef.current = Date.now();
        }
    };

    return (
        <div
            className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black"
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onTouchEnd={(event) => {
                if (Date.now() - lastPinchAtRef.current < 450) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }}
            onTouchCancel={(event) => {
                if (Date.now() - lastPinchAtRef.current < 450) {
                    event.stopPropagation();
                }
            }}
            onClick={(event) => {
                event.stopPropagation();
                if (gestureMovedRef.current || Date.now() - lastPinchAtRef.current < 450) {
                    gestureMovedRef.current = false;
                    return;
                }
                onToggleChrome();
            }}
            onDoubleClick={(event) => {
                event.stopPropagation();
                scale === 1 ? setScale(2.5) : reset();
            }}
            style={{ touchAction: 'none' }}
        >
            <img
                src={src}
                className={`max-h-[100dvh] max-w-[100vw] select-none object-contain ${scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
                alt={alt}
                draggable={false}
                onError={onError}
                style={{
                    transform: `translate3d(${offset.x}px, ${offset.y}px, 0) rotate(${rotation}deg) scale(${scale})`,
                    transition: dragRef.current ? 'none' : 'transform 120ms ease-out',
                }}
            />
            <div className={`absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/55 p-1.5 text-white shadow-2xl backdrop-blur transition-all duration-200 ${controlsVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'}`}>
                <button type="button" className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white" onClick={(event) => { event.stopPropagation(); zoomBy(-0.25); }} title="Zoom out">
                    <ZoomOut className="h-4 w-4" />
                </button>
                <span className="min-w-12 text-center text-xs font-medium">{Math.round(scale * 100)}%</span>
                <button type="button" className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white" onClick={(event) => { event.stopPropagation(); zoomBy(0.25); }} title="Zoom in">
                    <ZoomIn className="h-4 w-4" />
                </button>
                <button type="button" className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white" onClick={(event) => { event.stopPropagation(); rotateRight(); }} title="Rotate right">
                    <RotateCw className="h-4 w-4" />
                </button>
                <button type="button" className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white" onClick={(event) => { event.stopPropagation(); reset(); }} title="Reset image">
                    <RotateCcw className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

function UnsupportedFilePreview({ file, src }: { file: TelegramFile; src: string }) {
    const details = [
        ['Name', file.name],
        ['Type', getFileExtension(file)?.toUpperCase() || file.mime_type || 'Unknown'],
        ['Size', formatBytes(file.size || 0)],
        ['MIME', file.mime_type || 'Unknown'],
        ['File ID', String(file.id)],
        ['Created', file.created_at || 'Unknown'],
    ];

    return (
        <div className="grid h-[calc(100%_-_3rem)] min-h-0 w-full grid-cols-1 bg-[#111827] lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-h-0 overflow-hidden border-b border-white/10 bg-black/25 lg:border-b-0 lg:border-r">
                <object
                    data={src}
                    type={file.mime_type || undefined}
                    className="h-full w-full bg-white"
                    aria-label={file.name}
                >
                    <div className="flex h-full w-full flex-col items-center justify-center bg-[#141b2a] p-8 text-center">
                        <File className="mx-auto mb-4 h-16 w-16 text-telegram-primary" />
                        <h3 className="mb-2 max-w-xl truncate text-xl font-medium text-white">{file.name}</h3>
                        <p className="text-sm text-gray-400">This device cannot render this file inline.</p>
                    </div>
                </object>
            </div>
            <aside className="custom-scrollbar overflow-auto p-5 text-sm text-slate-100">
                <div className="mb-5 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-telegram-primary/15 text-telegram-primary">
                        <File className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-white" title={file.name}>{file.name}</h3>
                        <p className="text-xs text-white/50">File metadata</p>
                    </div>
                </div>
                <dl className="space-y-3">
                    {details.map(([label, value]) => (
                        <div key={label} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                            <dt className="text-[11px] uppercase tracking-[0.14em] text-white/40">{label}</dt>
                            <dd className="mt-1 break-words text-white/85">{value}</dd>
                        </div>
                    ))}
                </dl>
                <a
                    href={src}
                    download={file.name}
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-telegram-primary px-4 py-2 text-sm font-semibold text-black transition hover:bg-telegram-primary/90"
                    onClick={(event) => event.stopPropagation()}
                >
                    <Download className="h-4 w-4" />
                    Download file
                </a>
            </aside>
        </div>
    );
}

function PreviewHeader({ icon, label, hint, extra }: { icon: ReactNode; label: string; hint?: string; extra?: ReactNode }) {
    return (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#17212b] px-4 py-2 text-xs text-white/65">
            <span className="flex min-w-0 items-center gap-2 font-medium uppercase">
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

async function loadSpreadsheetPreview(src: string, file: TelegramFile): Promise<{ preview: SpreadsheetPreview; truncated: boolean }> {
    const extension = getFileExtension(file);
    if (extension === 'xlsx') {
        return loadWorkbookPreview(src);
    }

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

async function loadWorkbookPreview(src: string): Promise<{ preview: SpreadsheetPreview; truncated: boolean }> {
    const arrayBuffer = await fetchPreviewArrayBuffer(src);
    const JSZip = (await import('jszip')).default;
    const workbook = await JSZip.loadAsync(arrayBuffer);
    const sharedStrings = await readXlsxSharedStrings(workbook);
    const workbookInfo = await readXlsxWorkbookInfo(workbook);
    const sheetInfos = workbookInfo.slice(0, SPREADSHEET_PREVIEW_MAX_SHEETS);

    const sheets: SpreadsheetSheetPreview[] = [];
    for (const sheetInfo of sheetInfos) {
        const sheetFile = workbook.file(sheetInfo.path);
        if (!sheetFile) continue;
        const rawRows = parseXlsxWorksheet(await sheetFile.async('string'), sharedStrings);
        const totalRows = rawRows.length;
        const totalCols = rawRows.reduce((max, row) => Math.max(max, row.length), 0);
        const truncated = totalRows > SPREADSHEET_PREVIEW_MAX_ROWS || totalCols > SPREADSHEET_PREVIEW_MAX_COLS;
        const rows = rawRows
            .slice(0, SPREADSHEET_PREVIEW_MAX_ROWS)
            .map((row) => row.slice(0, SPREADSHEET_PREVIEW_MAX_COLS).map(formatSpreadsheetCell));

        sheets.push({
            name: sheetInfo.name,
            rows,
            totalRows,
            totalCols,
            truncated,
        });
    }

    const truncated = workbookInfo.length > sheetInfos.length || sheets.some((sheet) => sheet.truncated);

    return {
        preview: { sheets, truncated },
        truncated,
    };
}

async function loadArchivePreview(src: string): Promise<{ preview: ArchivePreview; truncated: boolean }> {
    const arrayBuffer = await fetchPreviewArrayBuffer(src);
    const JSZip = (await import('jszip')).default;
    const archive = await JSZip.loadAsync(arrayBuffer);
    const entries = Object.values(archive.files)
        .sort((a, b) => a.name.localeCompare(b.name));

    const mapped = entries.map((entry) => {
        const sizes = getZipEntrySizes(entry);
        return {
            name: getArchiveEntryName(entry.name),
            path: entry.name,
            type: entry.dir ? 'Folder' : (getFileExtension(entry.name)?.toUpperCase() || 'File'),
            size: sizes.uncompressedSize,
            compressedSize: sizes.compressedSize,
            date: entry.date ? formatShortDate(entry.date) : undefined,
            directory: entry.dir,
        };
    });
    const totalFiles = mapped.filter((entry) => !entry.directory).length;
    const totalFolders = mapped.filter((entry) => entry.directory).length;
    const totalBytes = mapped.reduce((sum, entry) => sum + (entry.size || 0), 0);
    const truncated = mapped.length > ARCHIVE_PREVIEW_MAX_ENTRIES;

    return {
        preview: {
            entries: mapped.slice(0, ARCHIVE_PREVIEW_MAX_ENTRIES),
            totalEntries: mapped.length,
            totalFiles,
            totalFolders,
            totalBytes,
            truncated,
        },
        truncated,
    };
}

async function loadPresentationPreview(src: string): Promise<{ preview: PresentationPreview; truncated: boolean }> {
    const arrayBuffer = await fetchPreviewArrayBuffer(src);
    const JSZip = (await import('jszip')).default;
    const archive = await JSZip.loadAsync(arrayBuffer);
    const slideEntries = Object.values(archive.files)
        .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name))
        .sort((a, b) => getSlideNumber(a.name) - getSlideNumber(b.name));

    const slides: PresentationSlidePreview[] = [];
    for (const entry of slideEntries.slice(0, PRESENTATION_PREVIEW_MAX_SLIDES)) {
        const xml = await entry.async('string');
        const lines = extractPptxSlideText(xml);
        const slideNumber = getSlideNumber(entry.name);
        slides.push({
            number: slideNumber,
            title: lines.find(Boolean) || `Slide ${slideNumber}`,
            lines,
        });
    }

    const truncated = slideEntries.length > PRESENTATION_PREVIEW_MAX_SLIDES;
    return {
        preview: {
            slides,
            totalSlides: slideEntries.length,
            truncated,
        },
        truncated,
    };
}

async function readXlsxSharedStrings(workbook: ZipArchive): Promise<string[]> {
    const file = workbook.file('xl/sharedStrings.xml');
    if (!file) return [];

    const doc = parseXml(await file.async('string'));
    return getXmlChildren(doc, 'si').map((node) => (
        getXmlChildren(node, 't').map((textNode) => textNode.textContent || '').join('')
    ));
}

async function readXlsxWorkbookInfo(workbook: ZipArchive): Promise<{ name: string; path: string }[]> {
    const workbookFile = workbook.file('xl/workbook.xml');
    if (!workbookFile) throw new Error('Workbook metadata not found');

    const rels = await readXlsxWorkbookRelationships(workbook);
    const doc = parseXml(await workbookFile.async('string'));
    const sheets = getXmlChildren(doc, 'sheet');

    return sheets.map((sheet, index) => {
        const relationshipId = sheet.getAttribute('r:id')
            || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
            || '';
        const fallbackPath = `xl/worksheets/sheet${index + 1}.xml`;
        return {
            name: sheet.getAttribute('name') || `Sheet ${index + 1}`,
            path: rels.get(relationshipId) || fallbackPath,
        };
    });
}

async function readXlsxWorkbookRelationships(workbook: ZipArchive): Promise<Map<string, string>> {
    const relsFile = workbook.file('xl/_rels/workbook.xml.rels');
    const rels = new Map<string, string>();
    if (!relsFile) return rels;

    const doc = parseXml(await relsFile.async('string'));
    for (const node of getXmlChildren(doc, 'Relationship')) {
        const id = node.getAttribute('Id');
        const target = node.getAttribute('Target');
        if (id && target) rels.set(id, normalizeXlsxTargetPath(target));
    }
    return rels;
}

function parseXlsxWorksheet(xml: string, sharedStrings: string[]): string[][] {
    const doc = parseXml(xml);
    const rowNodes = getXmlChildren(doc, 'row');
    const rows: string[][] = [];

    for (const rowNode of rowNodes) {
        const cells: string[] = [];
        const cellNodes = getXmlChildren(rowNode, 'c');

        for (const cellNode of cellNodes) {
            const cellRef = cellNode.getAttribute('r') || '';
            const columnIndex = getXlsxColumnIndex(cellRef) ?? cells.length;
            while (cells.length < columnIndex) cells.push('');
            cells[columnIndex] = readXlsxCellValue(cellNode, sharedStrings);
        }

        rows.push(trimTrailingEmptyCells(cells));
    }

    return rows.filter((row) => row.some((cell) => cell.trim()));
}

function readXlsxCellValue(cellNode: Element, sharedStrings: string[]): string {
    const type = cellNode.getAttribute('t');
    const valueNode = getXmlChildren(cellNode, 'v')[0];
    const rawValue = valueNode?.textContent || '';

    if (type === 's') {
        const sharedIndex = Number(rawValue);
        return Number.isFinite(sharedIndex) ? sharedStrings[sharedIndex] || '' : '';
    }

    if (type === 'inlineStr') {
        return getXmlChildren(cellNode, 't').map((node) => node.textContent || '').join('');
    }

    if (type === 'b') {
        return rawValue === '1' ? 'TRUE' : 'FALSE';
    }

    return rawValue;
}

function parseXml(xml: string): XMLDocument {
    return new DOMParser().parseFromString(xml, 'application/xml');
}

function getXmlChildren(root: ParentNode, localName: string): Element[] {
    return Array.from(root.querySelectorAll('*'))
        .filter((node): node is Element => node instanceof Element && node.localName === localName);
}

function normalizeXlsxTargetPath(target: string): string {
    const trimmed = target.replace(/^\/+/, '');
    if (trimmed.startsWith('xl/')) return trimmed;
    return `xl/${trimmed}`;
}

function getXlsxColumnIndex(cellRef: string): number | null {
    const match = cellRef.match(/^[A-Z]+/i);
    if (!match) return null;

    let index = 0;
    for (const char of match[0].toUpperCase()) {
        index = index * 26 + char.charCodeAt(0) - 64;
    }
    return index - 1;
}

function trimTrailingEmptyCells(cells: string[]): string[] {
    let end = cells.length;
    while (end > 0 && !cells[end - 1]) end--;
    return cells.slice(0, end);
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

function flattenArchivePreview(preview: ArchivePreview | null): string {
    if (!preview) return '';
    return preview.entries.map((entry) => entry.path).join(' ');
}

function flattenPresentationPreview(preview: PresentationPreview | null): string {
    if (!preview) return '';
    return preview.slides.flatMap((slide) => [slide.title, ...slide.lines]).join(' ');
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

function getZipEntrySizes(entry: unknown): { uncompressedSize?: number; compressedSize?: number } {
    const data = (entry as { _data?: { uncompressedSize?: number; compressedSize?: number } })._data;
    return {
        uncompressedSize: typeof data?.uncompressedSize === 'number' ? data.uncompressedSize : undefined,
        compressedSize: typeof data?.compressedSize === 'number' ? data.compressedSize : undefined,
    };
}

function getArchiveEntryName(path: string): string {
    const normalized = path.replace(/\/+$/, '');
    return normalized.split('/').pop() || normalized || path;
}

function formatShortDate(date: Date): string {
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function getSlideNumber(path: string): number {
    const match = path.match(/slide(\d+)\.xml$/i);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function extractPptxSlideText(xml: string): string[] {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const nodes = Array.from(doc.getElementsByTagName('*'))
        .filter((node) => node.localName === 't');
    const lines = nodes
        .map((node) => normalizeXmlText(node.textContent || ''))
        .filter(Boolean);
    return Array.from(new Set(lines));
}

function normalizeXmlText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function getTextPreviewLabel(file: TelegramFile) {
    const ext = getFileExtension(file);
    if (ext) return `${ext} preview`;
    if (file.mime_type) return `${file.mime_type} preview`;
    return 'Text preview';
}

function getNativePreviewLabel(file: TelegramFile) {
    const ext = getFileExtension(file);
    if (ext) return `${ext} preview`;
    if (file.mime_type) return `${file.mime_type} preview`;
    return 'File preview';
}

function formatPreviewError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
