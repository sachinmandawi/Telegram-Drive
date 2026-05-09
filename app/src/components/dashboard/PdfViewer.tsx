import { useEffect, useState, useRef } from 'react';
import { X, ZoomIn, ZoomOut, Maximize, PanelLeft, RotateCcw, RotateCw } from 'lucide-react';
// Use the legacy build because the modern build uses Map.getOrInsertComputed(),
// which isn't available in Tauri's WebKit WebView
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { TelegramFile } from '../../types';
import { invokeCommand, toAssetUrl } from '../../platform';
import { usePreviewNavigationGestures } from '../../hooks/usePreviewNavigationGestures';

// Use Vite's ?url suffix to get a properly bundled asset URL for the worker
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
    file: TelegramFile;
    onClose: () => void;
    onNext?: () => void;
    onPrev?: () => void;
    currentIndex?: number;
    totalItems?: number;
    activeFolderId: number | null;
}

export function PdfViewer({ file, onClose, onNext, onPrev, currentIndex, totalItems, activeFolderId }: PdfViewerProps) {
    const [sourceUrl, setSourceUrl] = useState<string | null>(null);
    const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [numPages, setNumPages] = useState<number>(0);
    const [scale, setScale] = useState<number>(1.2);
    const [rotation, setRotation] = useState<number>(0);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [thumbnailOpen, setThumbnailOpen] = useState(true);
    const [activePage, setActivePage] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);
    const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
    const navigationGestures = usePreviewNavigationGestures({ onNext, onPrev });

    // Resolve the same preview source used by every other file preview. This
    // keeps PDF loading consistent across website, desktop, and Android builds.
    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;

        setSourceUrl(null);
        setPdf(null);
        setNumPages(0);
        setActivePage(1);
        setScale(1.2);
        setRotation(0);
        setLoading(true);
        setError(null);

        const loadSource = async () => {
            try {
                const path = await invokeCommand<string>('cmd_get_preview', {
                    messageId: file.id,
                    folderId: activeFolderId,
                });

                if (!path) {
                    throw new Error('Preview not available');
                }

                const normalized = await toAssetUrl(path);

                if (cancelled) {
                    if (normalized.startsWith('blob:')) URL.revokeObjectURL(normalized);
                    return;
                }

                if (normalized.startsWith('blob:')) objectUrl = normalized;
                setSourceUrl(normalized);
            } catch (err) {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : 'Failed to load PDF preview.';
                setError(message);
                setLoading(false);
            }
        };

        loadSource();

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [activeFolderId, file.id]);

    // Load PDF document as bytes. Passing data to PDF.js avoids flaky URL/range
    // loading in WebViews while still working in normal browsers.
    useEffect(() => {
        if (!sourceUrl) return;

        let cancelled = false;
        let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
        setLoading(true);
        setError(null);
        setPdf(null);
        setNumPages(0);

        const loadPdf = async () => {
            try {
                const response = await fetch(sourceUrl);
                if (!response.ok) {
                    throw new Error(`Failed to load PDF data (${response.status})`);
                }
                const data = new Uint8Array(await response.arrayBuffer());
                if (cancelled) return;
                loadingTask = pdfjsLib.getDocument({ data });

                if (!loadingTask) return;

                const pdfDoc = await loadingTask.promise;
                if (cancelled) {
                    pdfDoc.destroy();
                    return;
                }

                if (pdfRef.current) {
                    pdfRef.current.destroy();
                }

                pdfRef.current = pdfDoc;
                setPdf(pdfDoc);
                setNumPages(pdfDoc.numPages);
                setLoading(false);
            } catch (err) {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : 'Failed to load PDF document.';
                setError(message);
                setLoading(false);
            }
        };

        loadPdf();

        return () => {
            cancelled = true;
            loadingTask?.destroy();
        };
    }, [sourceUrl, file.id]);

    // Cleanup PDF document on unmount
    useEffect(() => {
        return () => {
            if (pdfRef.current) {
                pdfRef.current.destroy();
                pdfRef.current = null;
            }
        };
    }, []);

    // Keyboard shortcuts
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
                return;
            }

            if (e.key === '=' || key === '+') {
                e.preventDefault();
                setScale(s => Math.min(s + 0.2, 3));
                return;
            }

            if (e.key === '-') {
                e.preventDefault();
                setScale(s => Math.max(s - 0.2, 0.5));
                return;
            }

            if (key === 'r') {
                e.preventDefault();
                setRotation((current) => (current + 90) % 360);
                return;
            }

            if (e.key === '0') {
                e.preventDefault();
                setScale(1.2);
                setRotation(0);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, onNext, onPrev]);

    const handleZoomIn = (e: React.MouseEvent) => {
        e.stopPropagation();
        setScale(s => Math.min(s + 0.2, 3));
    };

    const handleZoomOut = (e: React.MouseEvent) => {
        e.stopPropagation();
        setScale(s => Math.max(s - 0.2, 0.5));
    };

    const handleFitWidth = (e: React.MouseEvent) => {
        e.stopPropagation();
        setScale(1.2);
    };

    const handleRotate = (e: React.MouseEvent) => {
        e.stopPropagation();
        setRotation((current) => (current + 90) % 360);
    };

    const handleResetView = (e: React.MouseEvent) => {
        e.stopPropagation();
        setScale(1.2);
        setRotation(0);
    };

    const scrollToPage = (pageNumber: number) => {
        const page = document.getElementById(getPdfPageDomId(file.id, pageNumber));
        page?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActivePage(pageNumber);
    };

    return (
        <div
            className="fixed inset-0 z-[200] flex flex-col bg-black/95 backdrop-blur-md animate-in fade-in duration-200"
            onClick={onClose}
            {...navigationGestures}
        >
            {/* Header / Controls */}
            <div className="absolute top-4 left-0 right-0 z-10 flex items-center justify-between px-8 pr-20 pointer-events-none">
                <div className="text-white bg-black/40 backdrop-blur-md px-4 py-2 rounded-full pointer-events-auto border border-white/10">
                    <h3 className="text-sm font-medium px-2 max-w-sm truncate">{file.name}</h3>
                </div>

                <div className="flex items-center gap-2 pointer-events-auto bg-black/40 backdrop-blur-md p-1.5 rounded-full border border-white/10">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setThumbnailOpen((current) => !current);
                        }}
                        className={`p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors ${thumbnailOpen ? 'bg-white/10 text-white' : ''}`}
                        title="Page thumbnails"
                    >
                        <PanelLeft className="w-4 h-4" />
                    </button>
                    <div className="w-px h-4 bg-white/20 mx-1"></div>
                    <button onClick={handleZoomOut} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors" title="Zoom Out (-)">
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-white/90 font-medium min-w-[3rem] text-center">{Math.round(scale * 100)}%</span>
                    <button onClick={handleZoomIn} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors" title="Zoom In (+)">
                        <ZoomIn className="w-4 h-4" />
                    </button>
                    <div className="w-px h-4 bg-white/20 mx-1"></div>
                    <button onClick={handleFitWidth} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors" title="Fit Width">
                        <Maximize className="w-4 h-4" />
                    </button>
                    <button onClick={handleRotate} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors" title="Rotate Right (R)">
                        <RotateCw className="w-4 h-4" />
                    </button>
                    <button onClick={handleResetView} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors" title="Reset View (0)">
                        <RotateCcw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <button
                onClick={onClose}
                className="absolute top-4 right-4 p-3 text-white/50 hover:text-white bg-black/40 backdrop-blur-md hover:bg-black/60 rounded-full transition-all z-10 border border-white/10"
            >
                <X className="w-6 h-6" />
            </button>

            {pdf && thumbnailOpen && (
                <PdfThumbnailRail
                    pdf={pdf}
                    numPages={numPages}
                    activePage={activePage}
                    onSelect={scrollToPage}
                    rotation={rotation}
                />
            )}

            {/* Scrollable Document Container */}
            <div
                ref={containerRef}
                className={`flex-1 w-full overflow-auto custom-scrollbar flex flex-col items-center pt-20 pb-8 relative transition-[padding] ${pdf && thumbnailOpen ? 'md:pl-48' : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
                {loading && (
                    <div className="flex flex-col items-center justify-center flex-1 text-white absolute inset-0">
                        <div className="w-10 h-10 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin mb-4"></div>
                        <p>Loading document...</p>
                        <p className="text-xs text-white/50 mt-1">Downloading from Telegram...</p>
                    </div>
                )}

                {error && (
                    <div className="flex flex-col items-center justify-center text-white bg-red-500/20 p-6 rounded-xl border border-red-500/50 mt-20">
                        <p className="font-bold mb-2">Error</p>
                        <p className="text-sm">{error}</p>
                    </div>
                )}

                {pdf && numPages > 0 && (
                    <div className="flex flex-col gap-4 w-full items-center">
                        {Array.from({ length: numPages }, (_, index) => (
                            <PdfPage
                                key={`${file.id}_page_${index + 1}`}
                                pageNumber={index + 1}
                                pdf={pdf}
                                scale={scale}
                                rotation={rotation}
                                fileId={file.id}
                                onVisiblePage={setActivePage}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Footer Navigation Info */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-sm bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full pointer-events-none border border-white/10">
                {typeof currentIndex === 'number' && typeof totalItems === 'number' && totalItems > 0 && (
                    <span className="mr-3 border-r border-white/20 pr-3">File {currentIndex + 1} of {totalItems}</span>
                )}
                <span>{numPages} {numPages === 1 ? 'page' : 'pages'}</span>
            </div>
        </div>
    );
}

// Individual page component, lazy-loaded via IntersectionObserver.
function PdfPage({
    pageNumber,
    pdf,
    scale,
    rotation,
    fileId,
    onVisiblePage,
}: {
    pageNumber: number;
    pdf: pdfjsLib.PDFDocumentProxy;
    scale: number;
    rotation: number;
    fileId: number;
    onVisiblePage: (pageNumber: number) => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const renderTaskRef = useRef<ReturnType<pdfjsLib.PDFPageProxy['render']> | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [page, setPage] = useState<pdfjsLib.PDFPageProxy | null>(null);

    // IntersectionObserver loads page data when within 1000px of the viewport.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setIsVisible(true);
                    onVisiblePage(pageNumber);
                }
            },
            { rootMargin: '1000px 0px', threshold: 0.2 }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [onVisiblePage, pageNumber]);

    // Fetch the PDF page object when visible
    useEffect(() => {
        if (!isVisible || !pdf) return;

        let cancelled = false;
        pdf.getPage(pageNumber).then(loadedPage => {
            if (!cancelled) {
                setPage(loadedPage);
            }
        }).catch(() => {
            if (!cancelled) setPage(null);
        });

        return () => {
            cancelled = true;
        };
    }, [isVisible, pdf, pageNumber]);

    // Render the page to canvas when page data or zoom changes.
    useEffect(() => {
        if (!page || !canvasRef.current || !isVisible) return;

        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (!context) return;

        // Cancel any in-flight render before starting a new one
        if (renderTaskRef.current) {
            renderTaskRef.current.cancel();
            renderTaskRef.current = null;
        }

        // Size canvas and clear before render to avoid stale frame flash
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        context.clearRect(0, 0, viewport.width, viewport.height);

        const renderTask = page.render({
            canvasContext: context,
            viewport: viewport,
            canvas: canvas,
        });
        renderTaskRef.current = renderTask;

        renderTask.promise.catch(() => {
            // Rendering can be cancelled during zoom or navigation.
        });

        return () => {
            renderTask.cancel();
            renderTaskRef.current = null;
        };
    }, [page, scale, rotation, isVisible, pageNumber]);

    // Estimated dimensions for the placeholder before page loads (US Letter @ 96 DPI)
    const sideways = rotation % 180 !== 0;
    const estimatedHeight = (sideways ? 816 : 1056) * scale;
    const estimatedWidth = (sideways ? 1056 : 816) * scale;

    return (
        <div
            id={getPdfPageDomId(fileId, pageNumber)}
            ref={containerRef}
            className="relative flex flex-col items-center my-2 shadow-[0_10px_40px_rgba(0,0,0,0.5)] rounded-lg overflow-hidden bg-white/5 transition-shadow"
            style={{
                minHeight: !page ? `${estimatedHeight}px` : undefined,
                minWidth: !page ? `${estimatedWidth}px` : undefined,
            }}
        >
            <canvas ref={canvasRef} className="max-w-full h-auto bg-white" />

            {!page && isVisible && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-white/30">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"></div>
                </div>
            )}
        </div>
    );
}

function PdfThumbnailRail({
    pdf,
    numPages,
    activePage,
    onSelect,
    rotation,
}: {
    pdf: pdfjsLib.PDFDocumentProxy;
    numPages: number;
    activePage: number;
    onSelect: (pageNumber: number) => void;
    rotation: number;
}) {
    return (
        <aside
            className="absolute bottom-16 left-4 top-20 z-10 hidden w-40 overflow-hidden rounded-xl border border-white/10 bg-black/50 p-2 backdrop-blur-xl md:block"
            onClick={(event) => event.stopPropagation()}
        >
            <div className="mb-2 px-2 text-xs font-medium uppercase tracking-[0.14em] text-white/50">Pages</div>
            <div className="custom-scrollbar flex h-[calc(100%-1.75rem)] flex-col gap-2 overflow-auto pr-1">
                {Array.from({ length: numPages }, (_, index) => (
                    <PdfThumbnail
                        key={`thumb-${index + 1}`}
                        pdf={pdf}
                        pageNumber={index + 1}
                        active={activePage === index + 1}
                        onSelect={onSelect}
                        rotation={rotation}
                    />
                ))}
            </div>
        </aside>
    );
}

function PdfThumbnail({
    pdf,
    pageNumber,
    active,
    onSelect,
    rotation,
}: {
    pdf: pdfjsLib.PDFDocumentProxy;
    pageNumber: number;
    active: boolean;
    onSelect: (pageNumber: number) => void;
    rotation: number;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const renderTaskRef = useRef<ReturnType<pdfjsLib.PDFPageProxy['render']> | null>(null);

    useEffect(() => {
        let cancelled = false;
        const render = async () => {
            const page = await pdf.getPage(pageNumber);
            if (cancelled || !canvasRef.current) return;

            const viewport = page.getViewport({ scale: 0.18, rotation });
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');
            if (!context) return;

            canvas.width = viewport.width;
            canvas.height = viewport.height;
            context.clearRect(0, 0, viewport.width, viewport.height);

            const task = page.render({ canvasContext: context, viewport, canvas });
            renderTaskRef.current = task;
            task.promise.catch(() => undefined);
        };

        render().catch(() => undefined);

        return () => {
            cancelled = true;
            renderTaskRef.current?.cancel();
            renderTaskRef.current = null;
        };
    }, [pdf, pageNumber, rotation]);

    return (
        <button
            type="button"
            onClick={() => onSelect(pageNumber)}
            className={`group rounded-lg border p-1 text-left transition ${active ? 'border-telegram-primary bg-telegram-primary/15' : 'border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10'}`}
        >
            <canvas ref={canvasRef} className="mx-auto max-h-36 max-w-full rounded bg-white shadow" />
            <div className="mt-1 text-center text-xs text-white/60 group-hover:text-white">Page {pageNumber}</div>
        </button>
    );
}

function getPdfPageDomId(fileId: number, pageNumber: number) {
    return `pdf-page-${fileId}-${pageNumber}`;
}
