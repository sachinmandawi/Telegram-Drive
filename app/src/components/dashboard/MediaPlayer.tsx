import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { TelegramFile } from '../../types';
import { isVideoFile, isAudioFile } from '../../utils';
import { getBrowserFileObjectUrl, invokeCommand, isSavedMessagesDefaultStorage, isTauriRuntime, type StreamInfo } from '../../platform';
import { usePreviewNavigationGestures } from '../../hooks/usePreviewNavigationGestures';

interface MediaPlayerProps {
    file: TelegramFile;
    onClose: () => void;
    onNext?: () => void;
    onPrev?: () => void;
    currentIndex?: number;
    totalItems?: number;
    activeFolderId: number | null;
}

export function MediaPlayer({ file, onClose, onNext, onPrev, currentIndex, totalItems, activeFolderId }: MediaPlayerProps) {
    const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
    const [browserUrl, setBrowserUrl] = useState<string | null>(null);
    const isDesktopRuntime = isTauriRuntime();
    const useDesktopStream = isDesktopRuntime && !isSavedMessagesDefaultStorage();

    useEffect(() => {
        let cancelled = false;

        if (useDesktopStream) {
            setBrowserUrl(null);
            invokeCommand<StreamInfo>('cmd_get_stream_info')
                .then((info) => {
                    if (!cancelled) setStreamInfo(info);
                })
                .catch(() => {
                    if (!cancelled) setStreamInfo(null);
                });

            return () => {
                cancelled = true;
            };
        }

        setStreamInfo(null);
        let objectUrl: string | null = null;
        getBrowserFileObjectUrl(file.id).then((url) => {
            if (cancelled) {
                URL.revokeObjectURL(url);
                return;
            }
            objectUrl = url;
            setBrowserUrl(url);
        }).catch(() => setBrowserUrl(null));

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [file.id, useDesktopStream]);

    const folderIdParam = activeFolderId !== null ? activeFolderId.toString() : 'home';
    const streamUrl = browserUrl || (streamInfo
        ? `${streamInfo.base_url}/stream/${folderIdParam}/${file.id}?token=${encodeURIComponent(streamInfo.token)}`
        : null);

    const isVideo = isVideoFile(file);
    const isAudio = isAudioFile(file);
    const navigationGestures = usePreviewNavigationGestures({ onNext, onPrev });

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
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-md animate-in fade-in duration-200"
            onClick={onClose}
            {...navigationGestures}
        >
            <div className="relative flex h-full w-full flex-col items-center justify-center" onClick={e => e.stopPropagation()}>
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 z-20 rounded-full bg-black/50 p-2 text-white/70 transition-all hover:bg-white/15 hover:text-white"
                >
                    <X className="w-6 h-6" />
                </button>

                <div className="flex h-full w-full items-center justify-center bg-black">
                    {!streamUrl ? (
                        <div className="flex flex-col items-center gap-4 text-white">
                            <div className="w-10 h-10 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin"></div>
                            <p>Preparing stream...</p>
                        </div>
                    ) : isVideo ? (
                        <video
                            src={streamUrl}
                            controls
                            autoPlay
                            className="h-full w-full object-contain"
                        />
                    ) : isAudio ? (
                        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-telegram-primary/20 to-black">
                            <div className="w-32 h-32 rounded-full bg-telegram-surface flex items-center justify-center mb-8 shadow-xl animate-pulse-slow">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-telegram-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                            </div>
                            <audio src={streamUrl} controls autoPlay className="w-full max-w-md" />
                        </div>
                    ) : (
                        <div className="text-white">Unsupported media type</div>
                    )}
                </div>

                <div className="absolute bottom-4 left-1/2 max-w-[calc(100vw-2rem)] -translate-x-1/2 truncate rounded-full bg-black/45 px-3 py-1.5 text-center text-sm text-white/70 backdrop-blur">
                    {file.name}
                    {typeof currentIndex === 'number' && typeof totalItems === 'number' && totalItems > 0 && (
                        <span className="ml-2">- {currentIndex + 1}/{totalItems}</span>
                    )}
                </div>
            </div>
        </div>
    );
}
