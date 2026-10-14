/**
 * Shared utility functions
 * Extracted from ai.js, background.js, settings.js to eliminate duplication.
 */

/** ISO timestamp */
export function now(): string {
    return new Date().toISOString();
}

/** Normalize to trimmed string */
export function normalizeStr(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** Deduplicate non-empty URLs while preserving order */
export function dedupeUrls(urls: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const url of urls) {
        const normalized = normalizeStr(url);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

/** Random short ID */
export function randomId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Mask API key for display: show first 4 + last 4 chars */
export function maskKey(key: string): string {
    if (!key || key.length <= 8) return key || '';
    return key.slice(0, 4) + '••••••' + key.slice(-4);
}

/** Format timestamp for display */
export function formatTime(ts: string | number | null): string {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

/** Send message to background service worker */
export function callBackground<T = unknown>(message: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response: T) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}
