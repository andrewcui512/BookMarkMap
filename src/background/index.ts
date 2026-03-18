/**
 * Background Service Worker (TypeScript)
 * Handles: AI requests, link checking, settings management, bookmark events
 */

import { getNormalizedSettings, getAiConfigByIdOrActive, assertAiConfigReady, updateAiConfigStats, pushHistory, getDefaultSettings } from '@/lib/ai-config';
import { checkLink, checkLinks } from '@/lib/link-checker';
import { searchBookmarksWithAi } from '@/background/ai-search';
import { toChatCompletionsEndpoint } from '@/lib/ai-endpoint';
import { now } from '@/lib/utils';
import { removeTagsForIds, readTagsStore } from '@/lib/tags-storage';
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

        default:
            sendResponse({ error: 'Unknown message type' });
    }
});

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
