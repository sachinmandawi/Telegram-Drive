/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_TELEGRAM_API_ID?: string;
    readonly VITE_TELEGRAM_API_HASH?: string;
    readonly VITE_DEFAULT_STORAGE?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
