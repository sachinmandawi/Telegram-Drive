import { useState, useEffect } from 'react';
import { invokeCommand, isTauriRuntime } from '../platform';

/**
 * Network detection for Tauri apps using lightweight backend check
 * 
 * Uses cmd_is_network_available which does a simple TCP connection test
 * to Telegram servers without using grammers (avoids stack overflow).
 * 
 * Polls every 10 seconds - very lightweight (~2ms per check).
 */
export function useNetworkStatus() {
    const [isOnline, setIsOnline] = useState(true);

    useEffect(() => {
        if (!isTauriRuntime()) {
            const updateBrowserStatus = () => setIsOnline(navigator.onLine);
            updateBrowserStatus();
            window.addEventListener('online', updateBrowserStatus);
            window.addEventListener('offline', updateBrowserStatus);

            return () => {
                window.removeEventListener('online', updateBrowserStatus);
                window.removeEventListener('offline', updateBrowserStatus);
            };
        }

        const checkNetwork = async () => {
            try {
                const available = await invokeCommand<boolean>('cmd_is_network_available');
                setIsOnline(available);
            } catch {
                setIsOnline(false);
            }
        };

        checkNetwork();
        const interval = setInterval(checkNetwork, 10000);
        return () => clearInterval(interval);
    }, []);

    return isOnline;
}
