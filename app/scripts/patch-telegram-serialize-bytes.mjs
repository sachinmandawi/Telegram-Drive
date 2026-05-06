import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const target = join(process.cwd(), 'node_modules', 'telegram', 'tl', 'generationHelpers.js');

if (!existsSync(target)) {
  console.warn('[telegram-drive] Skipped GramJS patch: generationHelpers.js not found.');
  process.exit(0);
}

const source = readFileSync(target, 'utf8');

if (source.includes('Telegram Drive browser 2FA compatibility patch')) {
  console.log('[telegram-drive] GramJS browser 2FA patch already applied.');
  process.exit(0);
}

const marker = 'function serializeBytes(bytes) {';
const start = source.indexOf(marker);
if (start === -1) {
  console.warn('[telegram-drive] Skipped GramJS patch: serializeBytes function not found.');
  process.exit(0);
}

const nextFunction = source.indexOf('\nfunction ', start + marker.length);
if (nextFunction === -1) {
  console.warn('[telegram-drive] Skipped GramJS patch: serializeBytes function boundary not found.');
  process.exit(0);
}

const replacement = `function serializeBytes(bytes) {
    // Telegram Drive browser 2FA compatibility patch.
    if (bytes instanceof Uint8Array) {
        bytes = Buffer.from(bytes);
    }
    else if (bytes instanceof ArrayBuffer) {
        bytes = Buffer.from(new Uint8Array(bytes));
    }
    else if (ArrayBuffer.isView(bytes)) {
        bytes = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    else if (Array.isArray(bytes)) {
        bytes = Buffer.from(bytes);
    }
    else if (bytes && typeof bytes === "object" && typeof bytes.length === "number" && typeof bytes !== "function") {
        bytes = Buffer.from(bytes);
    }
`;

const patched = `${source.slice(0, start)}${replacement}${source.slice(start + marker.length, nextFunction)}${source.slice(nextFunction)}`;
writeFileSync(target, patched, 'utf8');
console.log('[telegram-drive] Applied GramJS browser 2FA patch.');
