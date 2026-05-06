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

const headerMatch = source.match(/function serializeBytes\(([^)]+)\) \{/);
const marker = headerMatch?.[0];
const paramName = headerMatch?.[1] || 'data';
const start = marker ? source.indexOf(marker) : -1;
if (start === -1) {
  console.warn('[telegram-drive] Skipped GramJS patch: serializeBytes function not found.');
  process.exit(0);
}

const nextFunction = source.indexOf('\nfunction ', start + marker.length);
if (nextFunction === -1) {
  console.warn('[telegram-drive] Skipped GramJS patch: serializeBytes function boundary not found.');
  process.exit(0);
}

const replacement = `function serializeBytes(${paramName}) {
    // Telegram Drive browser 2FA compatibility patch.
    let normalized = ${paramName};
    if (normalized instanceof Uint8Array) {
        normalized = Buffer.from(normalized);
    }
    else if (normalized instanceof ArrayBuffer) {
        normalized = Buffer.from(new Uint8Array(normalized));
    }
    else if (ArrayBuffer.isView(normalized)) {
        normalized = Buffer.from(normalized.buffer, normalized.byteOffset, normalized.byteLength);
    }
    else if (Array.isArray(normalized)) {
        normalized = Buffer.from(normalized);
    }
    else if (normalized && typeof normalized === "object" && normalized.type === "Buffer" && Array.isArray(normalized.data)) {
        normalized = Buffer.from(normalized.data);
    }
    else if (normalized && typeof normalized === "object" && typeof normalized.toBuffer === "function") {
        normalized = Buffer.from(normalized.toBuffer());
    }
    else if (normalized && typeof normalized === "object" && typeof normalized.toByteArray === "function") {
        normalized = Buffer.from(normalized.toByteArray());
    }
    else if (normalized && typeof normalized === "object" && typeof normalized.toArray === "function") {
        const converted = normalized.toArray();
        normalized = Buffer.from(Array.isArray(converted) ? converted : converted.value || []);
    }
    else if (normalized && typeof normalized === "object" && typeof normalized.length === "number" && typeof normalized !== "function") {
        normalized = Buffer.from(normalized);
    }
    ${paramName} = normalized;
`;

const patched = `${source.slice(0, start)}${replacement}${source.slice(start + marker.length, nextFunction)}${source.slice(nextFunction)}`;
writeFileSync(target, patched, 'utf8');
console.log('[telegram-drive] Applied GramJS browser 2FA patch.');
