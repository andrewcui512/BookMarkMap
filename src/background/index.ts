/**
 * Background Service Worker (TypeScript)
 * Handles: AI requests, link checking, settings management, bookmark events
 */

import { getNormalizedSettings, getAiConfigByIdOrActive, assertAiConfigReady, updateAiConfigStats, pushHistory, extractJsonFromText, getDefaultSettings } from '@/lib/ai-config';
import { checkLink, checkLinks } from '@/lib/link-checker';
import { now } from '@/lib/utils';
import type { AiConfigStats, OperationRecord } from '@/types/bookmark';

/* ────── Install / Update ────── */

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('Bookmark Tree installed');
        chrome.storage.sync.set({ settings: getDefaultSettings() });
    } else if (details.reason === 'update') {
        console.log('Bookmark Tree updated to', chrome.runtime.getManifest().version);
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

        case 'CLASSIFY_BOOKMARKS':
            classifyBookmarks(message.bookmarks, message.configId)
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

        case 'SAVE_OPERATION':
            saveOperation(message.operation)
                .then(() => sendResponse({ success: true }))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'GET_OPERATIONS':
            getOperations()
                .then((operations) => sendResponse({ operations }))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'DELETE_OPERATION':
            deleteOperation(message.operationId)
                .then(() => sendResponse({ success: true }))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        default:
            sendResponse({ error: 'Unknown message type' });
    }
});

/* ────── AI: Classify bookmarks ────── */

async function classifyBookmarks(
    bookmarks: { id: string; title: string; url: string }[],
    configId?: string
) {
    const config = await getAiConfigByIdOrActive(configId || null);
    assertAiConfigReady(config);

    const bookmarkList = bookmarks
        .map((b, i) => `${i + 1}. [${b.title}](${b.url})`)
        .join('\n');

    const prompt = `请将以下书签分类整理。要求：
1. 根据内容和主题将书签分成合适的类别
2. 每个类别给一个简短清晰的中文名称
3. 以 JSON 格式返回，格式为：{ "categories": [{ "category": "分类名", "bookmarks": [{ "id": "书签ID", "title": "标题", "url": "URL" }] }] }
4. 每个书签只能归入一个分类

书签列表：
${bookmarkList}

书签数据（用于获取 ID）：
${JSON.stringify(bookmarks)}`;

    const response = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model || 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
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

    // Parse AI response
    const parsed = extractJsonFromText(content);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('AI response could not be parsed as JSON. Raw: ' + content.substring(0, 500));
    }

    return { ...(parsed as object), usage };
}

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

/* ────── Operation history (for undo) ────── */

async function saveOperation(operation: OperationRecord): Promise<void> {
    const result = await chrome.storage.local.get(['aiOperationHistory']);
    const history: OperationRecord[] = result.aiOperationHistory || [];
    history.push(operation);
    // Keep last 20 operations
    if (history.length > 20) history.splice(0, history.length - 20);
    await chrome.storage.local.set({ aiOperationHistory: history });
}

async function getOperations(): Promise<OperationRecord[]> {
    const result = await chrome.storage.local.get(['aiOperationHistory']);
    return result.aiOperationHistory || [];
}

async function deleteOperation(operationId: string): Promise<void> {
    const result = await chrome.storage.local.get(['aiOperationHistory']);
    const history: OperationRecord[] = result.aiOperationHistory || [];
    const filtered = history.filter((op) => op.id !== operationId);
    await chrome.storage.local.set({ aiOperationHistory: filtered });
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
