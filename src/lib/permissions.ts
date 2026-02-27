/**
 * Permission helpers — for MV3 optional_host_permissions.
 */

export const WEB_ACCESS_ORIGINS = ['http://*/*', 'https://*/*'] as const;

export function urlToOriginPattern(url: string): string | null {
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return `${u.protocol}//${u.hostname}/*`;
    } catch {
        return null;
    }
}

export async function hasOriginsPermission(origins: string[]): Promise<boolean> {
    try {
        return await chrome.permissions.contains({ origins });
    } catch {
        return false;
    }
}

export async function requestOriginsPermission(origins: string[]): Promise<boolean> {
    try {
        return await chrome.permissions.request({ origins });
    } catch {
        return false;
    }
}

export async function ensureOriginsPermission(origins: string[]): Promise<boolean> {
    const has = await hasOriginsPermission(origins);
    if (has) return true;
    return requestOriginsPermission(origins);
}

