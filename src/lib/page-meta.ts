/**
 * Lightweight webpage metadata fetcher for bookmark classification.
 * Extracts key points from HTML without sending full HTML to AI.
 */

export interface PageMeta {
    finalUrl?: string;
    status?: number;
    contentType?: string | null;
    title?: string;
    description?: string;
    h1?: string;
    keywords?: string;
}

function cleanText(text: string): string {
    return String(text || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function decodeHtmlEntities(text: string): string {
    // Minimal decoding for common entities; keep lightweight.
    return String(text || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_m, n) => {
            const code = Number(n);
            if (!Number.isFinite(code)) return '';
            try {
                return String.fromCharCode(code);
            } catch {
                return '';
            }
        });
}

function getAttr(tag: string, name: string): string | null {
    const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const m = tag.match(re);
    return (m?.[1] || m?.[2] || m?.[3] || null);
}

function extractTitle(html: string): string | null {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return null;
    const t = decodeHtmlEntities(cleanText(m[1]));
    return t || null;
}

function extractH1(html: string): string | null {
    const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (!m) return null;
    const t = decodeHtmlEntities(cleanText(m[1]));
    return t || null;
}

function extractMetaContent(html: string, keys: string[]): string | null {
    const want = new Set(keys.map((k) => k.toLowerCase()));
    const metas = html.match(/<meta\s+[^>]*>/gi) || [];
    for (const tag of metas) {
        const name = (getAttr(tag, 'name') || getAttr(tag, 'property') || '').toLowerCase();
        if (!name || !want.has(name)) continue;
        const content = getAttr(tag, 'content') || '';
        const t = decodeHtmlEntities(cleanText(content));
        if (t) return t;
    }
    return null;
}

async function readTextUpTo(response: Response, maxBytes: number): Promise<string> {
    const body = response.body;
    if (!body) {
        const t = await response.text();
        return t.slice(0, maxBytes);
    }

    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let result = '';
    let received = 0;

    while (received < maxBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
            received += value.byteLength;
            result += decoder.decode(value, { stream: true });
        }
    }

    try { await reader.cancel(); } catch { /* ignore */ }
    result += decoder.decode();
    return result.slice(0, maxBytes);
}

export async function fetchPageMeta(
    url: string,
    opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<PageMeta | null> {
    const timeoutMs = Math.max(3000, Math.min(30000, opts.timeoutMs ?? 12000));
    const maxBytes = Math.max(20_000, Math.min(400_000, opts.maxBytes ?? 160_000));

    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(u.toString(), {
            method: 'GET',
            cache: 'no-cache',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                Accept: 'text/html,application/xhtml+xml',
            },
        });

        const contentType = res.headers.get('content-type');
        const status = res.status;
        if (!res.ok) {
            return { status, contentType, finalUrl: res.url };
        }
        if (contentType && !contentType.toLowerCase().includes('text/html') && !contentType.toLowerCase().includes('application/xhtml')) {
            return { status, contentType, finalUrl: res.url };
        }

        const html = await readTextUpTo(res, maxBytes);
        const title = extractMetaContent(html, ['og:title', 'twitter:title']) || extractTitle(html) || undefined;
        const description =
            extractMetaContent(html, ['description', 'og:description', 'twitter:description']) || undefined;
        const h1 = extractH1(html) || undefined;
        const keywords = extractMetaContent(html, ['keywords']) || undefined;

        return {
            status,
            contentType,
            finalUrl: res.url,
            title: title?.slice(0, 180),
            description: description?.slice(0, 240),
            h1: h1?.slice(0, 180),
            keywords: keywords?.slice(0, 240),
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

export function formatMetaHint(meta: PageMeta | null | undefined): string {
    if (!meta) return '';
    const parts: string[] = [];
    if (meta.title) parts.push(`pageTitle=${meta.title}`);
    if (meta.description) parts.push(`desc=${meta.description}`);
    if (meta.h1) parts.push(`h1=${meta.h1}`);
    if (meta.keywords) parts.push(`keywords=${meta.keywords}`);
    return parts.join(' ; ').trim();
}

