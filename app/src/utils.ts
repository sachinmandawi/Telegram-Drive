export function formatBytes(bytes: number, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function friendlyDriveError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error || '');
    const message = raw.replace(/^Error:\s*/i, '').trim();

    if (!message) return 'Something went wrong. Please try again.';
    if (/file metadata not found/i.test(message)) {
        return 'File record is missing from the Drive index. Run Repair Index, then try again.';
    }
    if (/folder metadata not found|target folder metadata not found/i.test(message)) {
        return 'Target folder is missing or out of sync. Sync or Repair Index, then try again.';
    }
    if (/invalid pin|wrong pin|pin mismatch|incorrect pin/i.test(message)) {
        return 'Wrong PIN. The item was not unlocked.';
    }
    if (/cannot use \[object file\] as file/i.test(message)) {
        return 'Browser upload payload was rejected. Retry this file once.';
    }
    if (/flood|rate limit/i.test(message)) {
        return message;
    }
    return message;
}

// File type classification.
import type { TelegramFile } from './types';

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'm4v', '3gp', '3g2', 'mpg', 'mpeg'] as const;
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'flac', 'm4a', 'm4b', 'opus', 'ogg', 'oga', 'amr', 'aif', 'aiff'] as const;
const MEDIA_EXTENSIONS: readonly string[] = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico', 'heic', 'heif'] as const;
const DOCUMENT_PREVIEW_EXTENSIONS = ['docx'] as const;
const SPREADSHEET_PREVIEW_EXTENSIONS = ['csv', 'tsv'] as const;
const TEXT_PREVIEW_EXTENSIONS = [
    'txt', 'text', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'log',
    'ini', 'cfg', 'conf', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm',
    'css', 'scss', 'less', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'env',
    'py', 'java', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'go', 'rs',
    'php', 'rb', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'rtf', 'srt', 'vtt',
    'ass', 'ssa', 'lrc', 'nfo', 'properties'
] as const;
const TEXT_PREVIEW_MIME_TYPES = [
    'application/json',
    'application/ld+json',
    'application/xml',
    'application/javascript',
    'application/x-javascript',
    'application/sql',
    'application/x-sh',
    'application/x-httpd-php',
    'application/rtf',
] as const;

type PreviewFileLike = string | Pick<TelegramFile, 'name' | 'mime_type' | 'file_ext'>;

function normalizeFileLike(input: PreviewFileLike) {
    if (typeof input === 'string') {
        return {
            name: input,
            mimeType: '',
            extension: getExtensionFromName(input),
        };
    }

    return {
        name: input.name,
        mimeType: (input.mime_type || '').toLowerCase(),
        extension: (input.file_ext || getExtensionFromName(input.name) || '').toLowerCase(),
    };
}

const endsWithAny = (input: PreviewFileLike, exts: readonly string[]) => {
    const { name, extension } = normalizeFileLike(input);
    const lower = name.toLowerCase();
    return exts.some(ext => extension === ext || lower.endsWith(`.${ext}`));
};

export const getFileExtension = (input: PreviewFileLike) => normalizeFileLike(input).extension || undefined;

export const isMediaFile = (input: PreviewFileLike) => {
    const { mimeType } = normalizeFileLike(input);
    return mimeType.startsWith('video/')
        || mimeType.startsWith('audio/')
        || endsWithAny(input, MEDIA_EXTENSIONS);
};

export const isVideoFile = (input: PreviewFileLike) => {
    const { mimeType } = normalizeFileLike(input);
    return mimeType.startsWith('video/') || endsWithAny(input, VIDEO_EXTENSIONS);
};

export const isAudioFile = (input: PreviewFileLike) => {
    const { mimeType } = normalizeFileLike(input);
    return mimeType.startsWith('audio/') || endsWithAny(input, AUDIO_EXTENSIONS);
};

export const isImageFile = (input: PreviewFileLike) => {
    const { mimeType } = normalizeFileLike(input);
    return mimeType.startsWith('image/') || endsWithAny(input, IMAGE_EXTENSIONS);
};

export const isDocxPreviewFile = (input: PreviewFileLike) => {
    const { mimeType } = normalizeFileLike(input);
    return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || endsWithAny(input, DOCUMENT_PREVIEW_EXTENSIONS);
};

export const isSpreadsheetPreviewFile = (input: PreviewFileLike) => {
    const { mimeType } = normalizeFileLike(input);
    return mimeType === 'text/csv'
        || mimeType === 'text/tab-separated-values'
        || endsWithAny(input, SPREADSHEET_PREVIEW_EXTENSIONS);
};

export const isPdfFile = (input: PreviewFileLike) => {
    const { mimeType, extension, name } = normalizeFileLike(input);
    return mimeType === 'application/pdf'
        || extension === 'pdf'
        || name.toLowerCase().endsWith('.pdf');
};

export const isTextPreviewFile = (input: PreviewFileLike) => {
    const { mimeType, extension } = normalizeFileLike(input);
    if (isSpreadsheetPreviewFile(input) || isDocxPreviewFile(input)) {
        return false;
    }

    return mimeType.startsWith('text/')
        || TEXT_PREVIEW_MIME_TYPES.includes(mimeType as typeof TEXT_PREVIEW_MIME_TYPES[number])
        || TEXT_PREVIEW_EXTENSIONS.includes(extension as typeof TEXT_PREVIEW_EXTENSIONS[number]);
};

function getExtensionFromName(name: string) {
    const ext = name.split('.').pop();
    return ext && ext !== name ? ext.toLowerCase() : '';
}
