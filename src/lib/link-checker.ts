/**
 * Link checker — enhanced with accurate status codes via Service Worker
 * Migrated from scripts/link-checker.js to TypeScript.
 */

import type { LinkCheckResult, LinkStatus } from '@/types/bookmark';

/** Default firewall whitelist (commonly blocked domains in China) */
export const DEFAULT_WHITELIST: string[] = [
    'google.com', 'google.co', 'googleapis.com', 'gstatic.com',
    'youtube.com', 'youtu.be',
    'twitter.com', 'x.com',
    'facebook.com', 'fb.com', 'instagram.com', 'whatsapp.com',
    'telegram.org', 't.me',
    'reddit.com', 'discord.com', 'twitch.tv',
    'pinterest.com', 'tumblr.com',
    'medium.com', 'blogger.com', 'wordpress.com',
    'github.com', 'githubusercontent.com', 'stackoverflow.com',
    'wikipedia.org', 'wikimedia.org', 'archive.org',
    'dropbox.com', 'mega.nz',
    'netflix.com', 'spotify.com', 'soundcloud.com',
    'vimeo.com', 'dailymotion.com',
    'bbc.com', 'nytimes.com', 'wsj.com', 'reuters.com', 'cnn.com',
];

/** Get combined whitelist (default + user-defined) */
export async function getWhitelist(): Promise<string[]> {
    try {
        const result = await chrome.storage.sync.get(['settings']);
        const userWhitelist: string[] = result.settings?.firewallWhitelist || [];
        return [...new Set([...DEFAULT_WHITELIST, ...userWhitelist])];
    } catch {
        return DEFAULT_WHITELIST;
    }
}

/** Check if a URL's domain is in the whitelist */
export function isWhitelisted(url: string, whitelist: string[]): boolean {
    try {
        const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        return whitelist.some((domain) => {
            const d = domain.toLowerCase().replace(/^www\./, '');
            return hostname === d || hostname.endsWith('.' + d);
        });
    } catch {
        return false;
    }
}

/** Map HTTP status code to a status category */
function statusFromCode(code: number): LinkStatus {
    if (code >= 200 && code < 300) return 'valid';
    if (code >= 300 && code < 400) return 'redirect';
    if (code >= 400 && code < 500) return 'client_error';
    if (code >= 500) return 'server_error';
    return 'valid'; // opaque response (0)
}

/**
 * Check a single link (used in Service Worker context for accurate results).
 * The Service Worker has host_permissions so it can do real fetch without no-cors.
 */
export async function checkLink(url: string, whitelist?: string[]): Promise<LinkCheckResult> {
    if (!whitelist) whitelist = await getWhitelist();

    if (isWhitelisted(url, whitelist)) {
        return { url, status: 'whitelisted', statusCode: null, message: '可能被防火墙阻止' };
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        // In Service Worker context, we can get real status codes
        const response = await fetch(url, {
            method: 'HEAD',
            cache: 'no-cache',
            signal: controller.signal,
            redirect: 'follow',
        });

        clearTimeout(timeoutId);

        const status = statusFromCode(response.status);
        return {
            url,
            status,
            statusCode: response.status,
            message: response.status === 0 ? 'OK (opaque)' : `${response.status} ${response.statusText}`,
        };
    } catch (error: unknown) {
        const err = error as Error;

        if (err.name === 'AbortError') {
            return { url, status: 'timeout', statusCode: null, message: '请求超时' };
        }

        // Retry with GET (some servers reject HEAD)
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const response = await fetch(url, {
                method: 'GET',
                cache: 'no-cache',
                signal: controller.signal,
                redirect: 'follow',
            });

            clearTimeout(timeoutId);

            const status = statusFromCode(response.status);
            return {
                url,
                status,
                statusCode: response.status,
                message: `${response.status} ${response.statusText}`,
            };
        } catch (retryError: unknown) {
            const retryErr = retryError as Error;
            return {
                url,
                status: 'invalid',
                statusCode: null,
                message: retryErr.message || '无法访问',
            };
        }
    }
}

/** Batch check links with concurrency and progress callback */
export async function checkLinks(
    bookmarks: { id: string; url: string; title: string }[],
    onProgress?: (checked: number, total: number, result: LinkCheckResult) => void
): Promise<LinkCheckResult[]> {
    const whitelist = await getWhitelist();
    const results: LinkCheckResult[] = [];
    const concurrency = 5;

    for (let i = 0; i < bookmarks.length; i += concurrency) {
        const batch = bookmarks.slice(i, i + concurrency);

        const batchResults = await Promise.all(
            batch.map(async (bookmark) => {
                const result = await checkLink(bookmark.url, whitelist);
                return { ...result, id: bookmark.id, title: bookmark.title };
            })
        );

        results.push(...batchResults);

        if (onProgress) {
            batchResults.forEach((result) => onProgress(results.length, bookmarks.length, result));
        }

        // Short delay to avoid overwhelming
        if (i + concurrency < bookmarks.length) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    return results;
}

/** Get check statistics */
export function getStats(results: LinkCheckResult[]) {
    const stats = { total: results.length, valid: 0, invalid: 0, whitelisted: 0, timeout: 0, redirect: 0, client_error: 0, server_error: 0 };
    results.forEach((r) => {
        if (r.status in stats) {
            (stats as Record<string, number>)[r.status]++;
        }
    });
    return stats;
}

/** Filter invalid links */
export function getInvalidLinks(results: LinkCheckResult[]): LinkCheckResult[] {
    return results.filter((r) => r.status === 'invalid' || r.status === 'timeout' || r.status === 'client_error' || r.status === 'server_error');
}
