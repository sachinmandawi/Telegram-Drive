import { useCallback, useRef } from 'react';
import type { TouchEvent, WheelEvent } from 'react';

interface PreviewNavigationGestureOptions {
    onNext?: () => void;
    onPrev?: () => void;
}

const WHEEL_THRESHOLD = 48;
const SWIPE_THRESHOLD = 54;
const VERTICAL_TOLERANCE = 1.4;
const NAVIGATION_COOLDOWN_MS = 450;

export function usePreviewNavigationGestures({ onNext, onPrev }: PreviewNavigationGestureOptions) {
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const lastNavigateAtRef = useRef(0);

    const navigate = useCallback((direction: 'next' | 'prev') => {
        const now = Date.now();
        if (now - lastNavigateAtRef.current < NAVIGATION_COOLDOWN_MS) return;
        lastNavigateAtRef.current = now;

        if (direction === 'next') onNext?.();
        else onPrev?.();
    }, [onNext, onPrev]);

    const handleWheel = useCallback((event: WheelEvent) => {
        if (Math.abs(event.deltaX) < WHEEL_THRESHOLD || Math.abs(event.deltaX) < Math.abs(event.deltaY) * VERTICAL_TOLERANCE) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        navigate(event.deltaX > 0 ? 'next' : 'prev');
    }, [navigate]);

    const handleTouchStart = useCallback((event: TouchEvent) => {
        const touch = event.touches[0];
        if (!touch) return;
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    }, []);

    const handleTouchEnd = useCallback((event: TouchEvent) => {
        const start = touchStartRef.current;
        touchStartRef.current = null;
        const touch = event.changedTouches[0];
        if (!start || !touch) return;

        const deltaX = touch.clientX - start.x;
        const deltaY = touch.clientY - start.y;
        if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * VERTICAL_TOLERANCE) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        navigate(deltaX < 0 ? 'next' : 'prev');
    }, [navigate]);

    return {
        onWheel: handleWheel,
        onTouchStart: handleTouchStart,
        onTouchEnd: handleTouchEnd,
        onTouchCancel: () => {
            touchStartRef.current = null;
        },
    };
}
