/**
 * Background Service Worker (TypeScript)
 * Handles: AI requests, link checking, settings management, bookmark events
 */

import { getNormalizedSettings, getAiConfigByIdOrActive, assertAiConfigReady, updateAiConfigStats, pushHistory, getDefaultSettings } from '@/lib/ai-config';
import { checkLink, checkLinks } from '@/lib/link-checker';
import { searchBookmarksWithAi } from '@/background/ai-search';
import { toChatCompletionsEndpoint } from '@/lib/ai-endpoint';
import { dedupeUrls, now } from '@/lib/utils';
import { removeTagsForIds, readTagsStore, replaceTagsStore } from '@/lib/tags-storage';
import { analyzeBatchCleanup, applyAutoTagRulesToMap } from '@/lib/organizer';
import { popLastOperationSnapshot, pushOperationSnapshot } from '@/lib/operation-history';
import type { AiConfig, AiConfigStats } from '@/types/bookmark';

/* ────── Install / Update ────── */

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('BookMarkMap installed');
        chrome.storage.sync.set({ settings: getDefaultSettings() });
    } else if (details.reason === 'update') {
        console.log('BookMarkMap updated to', chrome.runtime.getManifest().version);
    }
});

/* ────── Message router ────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
        case 'CHECK_LINK':
            checkLink(message.url)
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'CHECK_LINKS_BATCH':
            checkLinks(message.bookmarks)
                .then((results) => sendResponse({ results }))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'AI_SEARCH_BOOKMARKS':
            (async () => {
                const query = String(message.query || '');
                const maxResults = typeof message.maxResults === 'number' ? message.maxResults : undefined;
                const configId = typeof message.configId === 'string' ? message.configId : undefined;
                const tagFilters = Array.isArray(message.tagFilters) ? message.tagFilters.map(String).filter(Boolean) : [];
                const scope = message.scope === 'recent' ? 'recent' : 'all';
                const recentDays = typeof message.recentDays === 'number' && message.recentDays > 0 ? message.recentDays : 7;

                const provided = Array.isArray(message.bookmarks) ? message.bookmarks : null;
                const bookmarks = provided?.length ? provided : await collectBookmarksForAi({ scope, recentDays, tagFilters });
                const contextKey = `scope=${scope};days=${recentDays};tags=${tagFilters.join(',')};n=${bookmarks.length}`;

                return searchBookmarksWithAi(query, bookmarks, configId, maxResults, contextKey);
            })()
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'OPEN_URLS_IN_WINDOW':
            openUrlsInWindow(Array.isArray(message.urls) ? message.urls : [])
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'TEST_AI_CONNECTION':
            testAiConnection(message.configId)
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'GET_SETTINGS':
            getNormalizedSettings()
                .then((settings) => sendResponse({ settings }))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'SAVE_SETTINGS':
            chrome.storage.sync.set({ settings: message.settings }, () => {
                sendResponse({ success: true });
            });
            return true;

        case 'ANALYZE_BATCH_CLEANUP':
            collectBookmarksTree()
                .then((tree) => sendResponse(analyzeBatchCleanup(tree)))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'APPLY_AUTO_TAG_RULES':
            applyAutoTagRules()
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'UNDO_LAST_OPERATION':
            undoLastOperation()
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        default:
            sendResponse({ error: 'Unknown message type' });
    }
});

async function collectBookmarksTree() {
    return (await chrome.bookmarks.getTree()) as any[];
}

async function snapshotBookmarksByIds(ids: string[], label: string) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    const snapshots = [];
    for (const id of uniqueIds) {
        try {
            const node = (await chrome.bookmarks.get(id))[0];
            if (!node) continue;
            snapshots.push({
                id: node.id,
                parentId: node.parentId,
                index: node.index,
                title: node.title || '',
                url: node.url,
            });
        } catch {
            // ignore missing nodes
        }
    }
    if (snapshots.length > 0) {
        await pushOperationSnapshot(label, snapshots);
    }
}

async function applyAutoTagRules() {
    const settings = await getNormalizedSettings();
    const rules = settings.autoTagRules || [];
    const tree = (await chrome.bookmarks.getTree()) as any[];
    const tagStore = await readTagsStore();
    const { nextTagsById, result } = applyAutoTagRulesToMap(tree, tagStore.tagsById || {}, rules);
    if (result.updatedBookmarks > 0) {
        await replaceTagsStore(nextTagsById);
    }
    return result;
}

async function undoLastOperation() {
    const snapshot = await popLastOperationSnapshot();
    if (!snapshot) return { restored: 0, label: null };

    let restored = 0;
    for (const node of snapshot.nodes) {
        try {
            await chrome.bookmarks.move(node.id, {
                parentId: node.parentId,
                index: typeof node.index === 'number' ? node.index : undefined,
            });
            const updatePayload: Parameters<typeof chrome.bookmarks.update>[1] = { title: node.title };
            if (node.url) updatePayload.url = node.url;
            await chrome.bookmarks.update(node.id, updatePayload);
            restored += 1;
        } catch {
            // Skip nodes that no longer exist or cannot be restored.
        }
    }

    return { restored, label: snapshot.label };
}

async function collectBookmarksForAi(options: { scope: 'all' | 'recent'; recentDays: number; tagFilters: string[] }) {
    const tree = await chrome.bookmarks.getTree();
    const tagsStore = await readTagsStore();
    const tagsById = tagsStore.tagsById || {};

    const cutoff = Date.now() - options.recentDays * 24 * 60 * 60 * 1000;
    const results: Array<{ id: string; title: string; url: string; dateAdded?: number; tags?: string[] }> = [];

    const traverse = (nodes: chrome.bookmarks.BookmarkTreeNode[] | undefined) => {
        if (!nodes) return;
        for (const n of nodes) {
            if (n.url) {
                if (options.scope === 'recent' && (n.dateAdded || 0) <= cutoff) {
                    continue;
                }
                const tags = Array.isArray(tagsById[n.id]) ? tagsById[n.id] : [];
                if (options.tagFilters.length > 0 && !options.tagFilters.every((tf) => tags.includes(tf))) {
                    continue;
                }
                results.push({
                    id: n.id,
                    title: n.title || '',
                    url: n.url,
                    dateAdded: n.dateAdded,
                    tags,
                });
            }
            if (n.children && n.children.length) traverse(n.children);
        }
    };
    traverse(tree);
    return results;
}

async function openUrlsInWindow(input: unknown[]) {
    const urls = dedupeUrls(input.filter((url): url is string => typeof url === 'string'));
    let windowId: number | null = null;
    let openedCount = 0;

    for (const url of urls) {
        try {
            if (windowId === null) {
                const created = await chrome.windows.create({ url, focused: true });
                windowId = typeof created.id === 'number' ? created.id : null;
                openedCount += 1;
                continue;
            }

            await chrome.tabs.create({ windowId, url, active: false });
            openedCount += 1;
        } catch (err) {
            console.warn('[open-urls-in-window] failed', url, err);
        }
    }

    return { openedCount, total: urls.length, windowId };
}

/* ────── AI: Test connection ────── */

async function testAiConnection(configId?: string) {
    const config = await getAiConfigByIdOrActive(configId || null);
    assertAiConfigReady(config);

    const startTime = Date.now();
    const endpoint = toChatCompletionsEndpoint(config.apiEndpoint);

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model || 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Hi, this is a connection test. Reply with "OK".' }],
            max_tokens: 10,
        }),
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';
    const usage = data.usage || null;

    // Update stats
    if (usage) {
        await updateAiConfigStats(config.id, (stats: AiConfigStats) => {
            stats.totalRequests++;
            stats.totalPromptTokens += usage.prompt_tokens || 0;
            stats.totalCompletionTokens += usage.completion_tokens || 0;
            stats.totalTokens += usage.total_tokens || 0;
            stats.lastUsed = now();
            pushHistory(stats, {
                time: now(),
                promptTokens: usage.prompt_tokens || 0,
                completionTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || 0,
            });
        });
    }

    return {
        success: true,
        reply: reply.trim(),
        elapsed,
        model: config.model,
        usage,
    };
}

/* ────── Bookmark event logging ────── */

chrome.bookmarks.onCreated.addListener((_id, bookmark) => {
    console.log('Bookmark created:', bookmark.title);
});

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
    console.log('Bookmark removed:', id);
    // Cleanup local-only tag metadata for removed nodes.
    // removeInfo.node may contain a subtree when a folder is removed.
    const handler = async (removeInfo?: chrome.bookmarks.BookmarkRemoveInfo) => {
        const ids: string[] = [];
        const collect = (n: chrome.bookmarks.BookmarkTreeNode | undefined) => {
            if (!n) return;
            ids.push(n.id);
            n.children?.forEach((c) => collect(c));
        };
        collect(removeInfo?.node);
        if (ids.length === 0) ids.push(id);
        await removeTagsForIds(ids);
    };
    void handler(removeInfo).catch((err) => {
        console.warn('[tags] cleanup failed', err);
    });
});

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
    console.log('Bookmark changed:', id, changeInfo);
});

chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
    console.log('Bookmark moved:', id, moveInfo);
});
