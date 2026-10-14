import { normalizeTag, uniqTags } from '@/lib/tags';
import type {
    AutoTagApplyResult,
    AutoTagRule,
    BatchCleanupDuplicateCandidate,
    BatchCleanupReport,
    BookmarkNode,
} from '@/types/bookmark';

interface FlatBookmark {
    id: string;
    title: string;
    url: string;
}

function flattenBookmarks(nodes: BookmarkNode[]): FlatBookmark[] {
    const result: FlatBookmark[] = [];

    const traverse = (items: BookmarkNode[]) => {
        for (const node of items) {
            if (node.url) {
                result.push({ id: node.id, title: node.title || '', url: node.url });
            }
            if (node.children?.length) traverse(node.children);
        }
    };

    traverse(nodes);
    return result;
}

function normalizeTitle(title: string): string {
    return String(title || '')
        .trim()
        .toLowerCase()
        .replace(/[|｜\-–—_:：]+/g, ' ')
        .replace(/\s+/g, ' ');
}

function normalizeHost(url: string): string {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host.replace(/^www\./, '');
    } catch {
        return '';
    }
}

export function analyzeBatchCleanup(nodes: BookmarkNode[]): BatchCleanupReport {
    const bookmarks = flattenBookmarks(nodes);
    const groups = new Map<string, BatchCleanupDuplicateCandidate>();

    for (const bookmark of bookmarks) {
        const titleKey = normalizeTitle(bookmark.title);
        const hostKey = normalizeHost(bookmark.url);
        if (!titleKey || !hostKey) continue;
        const key = `${hostKey}::${titleKey}`;

        const current = groups.get(key);
        if (!current) {
            groups.set(key, {
                key,
                title: bookmark.title,
                urls: [bookmark.url],
                ids: [bookmark.id],
                count: 1,
            });
            continue;
        }

        current.urls.push(bookmark.url);
        current.ids.push(bookmark.id);
        current.count += 1;
    }

    const duplicateCandidates = [...groups.values()]
        .filter((item) => item.count > 1)
        .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
        .slice(0, 200);

    return {
        totalBookmarks: bookmarks.length,
        duplicateCandidates,
    };
}

function splitRulePatterns(pattern: string): string[] {
    // `|` is the alternation the built-in rules use (`docs|documentation|guide`),
    // so it has to split here too — otherwise the whole string is one literal.
    return String(pattern || '')
        .split(/[|,\n]/)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
}

function matchesRule(rule: AutoTagRule, title: string, url: string): boolean {
    const titleText = title.toLowerCase();
    const urlText = url.toLowerCase();
    const host = normalizeHost(url);
    const patterns = splitRulePatterns(rule.pattern);
    if (patterns.length === 0) return false;

    if (rule.mode === 'domain') {
        return patterns.some((pattern) => host === pattern || host.endsWith(`.${pattern}`));
    }

    return patterns.some((pattern) => titleText.includes(pattern) || urlText.includes(pattern));
}

export function applyAutoTagRulesToMap(
    nodes: BookmarkNode[],
    tagsById: Record<string, string[]>,
    rules: AutoTagRule[]
): {
    nextTagsById: Record<string, string[]>;
    result: AutoTagApplyResult;
} {
    const bookmarks = flattenBookmarks(nodes);
    const nextTagsById: Record<string, string[]> = { ...tagsById };
    const enabledRules = rules.filter((rule) => rule.enabled && rule.tags.length > 0 && rule.pattern.trim());
    const ruleStats = enabledRules.map((rule) => ({
        ruleId: rule.id,
        ruleName: rule.name,
        matchCount: 0,
        updatedCount: 0,
    }));

    let matchedBookmarks = 0;
    let updatedBookmarks = 0;

    for (const bookmark of bookmarks) {
        let matchedAny = false;
        let updatedAny = false;
        let currentTags = [...(nextTagsById[bookmark.id] || [])];

        enabledRules.forEach((rule, idx) => {
            if (!matchesRule(rule, bookmark.title, bookmark.url)) return;
            matchedAny = true;
            ruleStats[idx].matchCount += 1;

            const merged = uniqTags([
                ...currentTags,
                ...rule.tags.map((tag) => normalizeTag(tag) || '').filter(Boolean),
            ]);
            if (merged.length !== currentTags.length) {
                currentTags = merged;
                updatedAny = true;
                ruleStats[idx].updatedCount += 1;
            }
        });

        if (matchedAny) matchedBookmarks += 1;
        if (updatedAny) {
            nextTagsById[bookmark.id] = currentTags;
            updatedBookmarks += 1;
        }
    }

    return {
        nextTagsById,
        result: {
            totalBookmarks: bookmarks.length,
            matchedBookmarks,
            updatedBookmarks,
            appliedRules: ruleStats.filter((item) => item.matchCount > 0),
        },
    };
}
