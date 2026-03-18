/**
 * Bookmark tags (local-only metadata)
 * Stored in chrome.storage.local under a versioned schema.
 */

export const TAGS_STORAGE_KEY = 'bookmarkMap.tags.v1';

export const SYSTEM_TAG_INVALID = '@invalid';

export type TagsById = Record<string, string[]>;

export interface TagsStoreV1 {
    version: 1;
    tagsById: TagsById;
}

export type TagTranslator = (key: string, substitutions?: string | string[]) => string;

export function createEmptyTagsStore(): TagsStoreV1 {
    return { version: 1, tagsById: {} };
}

function collapseSpaces(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a user-facing tag to a canonical stored value.
 * - trims
 * - collapses whitespace
 * - lowercases ASCII (case-insensitive matching for common tags)
 */
export function normalizeTag(raw: string): string | null {
    const trimmed = collapseSpaces(String(raw || ''));
    if (!trimmed) return null;

    // keep system tags as-is (currently only @invalid)
    if (trimmed.startsWith('@')) return trimmed;

    // normalize ASCII letters for stable matching/dedup
    return trimmed.toLowerCase();
}

export function uniqTags(tags: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const t of tags) {
        const n = normalizeTag(t);
        if (!n) continue;
        if (seen.has(n)) continue;
        seen.add(n);
        result.push(n);
    }
    return result;
}

/**
 * Resolve user input into a canonical stored tag.
 * Supports:
 * - direct system tag: "@invalid"
 * - localized aliases: "失效", "invalid"
 */
export function resolveTagAlias(input: string): string | null {
    const s = collapseSpaces(String(input || ''));
    if (!s) return null;

    const raw = s.startsWith('#') ? s.slice(1) : s;
    const lower = raw.toLowerCase();

    if (raw === SYSTEM_TAG_INVALID) return SYSTEM_TAG_INVALID;
    if (lower === 'invalid' || raw === '失效') return SYSTEM_TAG_INVALID;

    return normalizeTag(raw);
}

export function isSystemTag(tag: string): boolean {
    return String(tag || '').startsWith('@');
}

export function getTagDisplayLabel(tag: string, t: TagTranslator): string {
    if (tag === SYSTEM_TAG_INVALID) return t('tagInvalid');
    return tag;
}

export function sortTagsForDisplay(tags: string[]): string[] {
    const copy = [...tags];
    copy.sort((a, b) => {
        const sa = isSystemTag(a);
        const sb = isSystemTag(b);
        if (sa !== sb) return sa ? -1 : 1;
        return a.localeCompare(b);
    });
    return copy;
}

export function parseSearchQuery(query: string): { textQuery: string; tagFilters: string[] } {
    const parts = String(query || '').split(/\s+/).filter(Boolean);
    const tagFilters: string[] = [];
    const textParts: string[] = [];

    for (const p of parts) {
        const lower = p.toLowerCase();
        if (p.startsWith('#') && p.length > 1) {
            tagFilters.push(p.slice(1));
            continue;
        }
        if (lower.startsWith('tag:') && p.length > 4) {
            tagFilters.push(p.slice(4));
            continue;
        }
        textParts.push(p);
    }

    const resolved = uniqTags(tagFilters.map((x) => resolveTagAlias(x) || '').filter(Boolean));
    return { textQuery: textParts.join(' ').trim(), tagFilters: resolved };
}

