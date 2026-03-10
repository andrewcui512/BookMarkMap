/**
 * Background Service Worker (TypeScript)
 * Handles: AI requests, link checking, settings management, bookmark events
 */

import { getNormalizedSettings, getAiConfigByIdOrActive, assertAiConfigReady, updateAiConfigStats, pushHistory, getDefaultSettings } from '@/lib/ai-config';
import { checkLink, checkLinks } from '@/lib/link-checker';
import { searchBookmarksWithAi } from '@/background/ai-search';
import { now } from '@/lib/utils';
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
            searchBookmarksWithAi(
                message.query,
                message.bookmarks,
                message.configId,
                message.maxResults
            )
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

/* ────── AI: Test connection ────── */

async function testAiConnection(configId?: string) {
    const config = await getAiConfigByIdOrActive(configId || null);
    assertAiConfigReady(config);

    const startTime = Date.now();

    const response = await fetch(config.apiEndpoint, {
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

chrome.bookmarks.onRemoved.addListener((id) => {
    console.log('Bookmark removed:', id);
});

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
    console.log('Bookmark changed:', id, changeInfo);
});

chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
    console.log('Bookmark moved:', id, moveInfo);
});
