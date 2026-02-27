/**
 * Background Service Worker (TypeScript)
 * Handles: AI requests, link checking, settings management, bookmark events
 */

import { getNormalizedSettings, getAiConfigByIdOrActive, assertAiConfigReady, updateAiConfigStats, pushHistory, extractJsonFromText, getDefaultSettings } from '@/lib/ai-config';
import { checkLink, checkLinks, getWhitelist, isWhitelisted } from '@/lib/link-checker';
import { WEB_ACCESS_ORIGINS } from '@/lib/permissions';
import { fetchPageMeta, formatMetaHint } from '@/lib/page-meta';
import { now } from '@/lib/utils';
import type { AiConfig, AiConfigStats, OperationRecord } from '@/types/bookmark';

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
        case 'AI_CLASSIFY_LOG':
            // Internal progress messages. Ignore.
            sendResponse({ ok: true });
            return true;

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

        case 'AI_PLAN_BOOKMARKS':
            planBookmarkCategories(message.bookmarks, message.configId, message.opId, message.parentFolderId)
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'AI_CLASSIFY_BOOKMARKS_BATCH':
            classifyBookmarksBatch(message.bookmarks, message.plan, message.configId, message.opId, message.defaultCategoryName, message.preferEnglish, message.batchIndex, message.batchTotal, message.pass)
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'AI_CLASSIFY_ALL_BOOKMARKS':
            classifyAllBookmarks(message.bookmarks, message.configId, message.opId, message.parentFolderId)
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        // Legacy message types (kept for backward compatibility)
        case 'AI_CLASSIFY':
            classifyBookmarks(message.bookmarks, message.configId, message.opId, message.parentFolderId)
                .then((result) => sendResponse(toLegacyClassifyResponse(result as ClassifyOutput)))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        case 'CLASSIFY_BOOKMARKS':
            classifyBookmarks(message.bookmarks, message.configId, message.opId, message.parentFolderId)
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ error: err.message }));
            return true;

        // Legacy message types (kept for backward compatibility)
        case 'AI_TEST':
            testAiConnection(message.configId)
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

type ClassifyBookmarkInput = { id: string; title: string; url: string };
type ClassifyBookmarkInputWithHint = ClassifyBookmarkInput & { hint?: string };
type PromptMode = 'title_domain' | 'title_only';
type LogLevel = 'info' | 'warn' | 'error';

type NormalizedCategory = { category: string; ids: string[]; reason?: string };
type PlanCategory = { category: string; description?: string };
type ClassifyCategoryOutput = { category: string; reason?: string; bookmarks: ClassifyBookmarkInput[] };
type ClassifyOutput = { categories: ClassifyCategoryOutput[]; skipped: number; failed?: number; usage: any | null };
const FIXED_UNCATEGORIZED_CATEGORY = '未分类(AI)';

const LEGACY_SKIPPED_CATEGORY_NAMES = new Set([
    '已跳过（内容风控）',
    '已跳过（请求失败）',
    'Skipped (Content Filter)',
    'Skipped (Request Failed)',
]);

function toLegacyClassifyResponse(result: ClassifyOutput) {
    const classifications: { id: string; url: string; category: string }[] = [];
    for (const category of result.categories || []) {
        const categoryName = String(category?.category || '').trim();
        if (!categoryName || LEGACY_SKIPPED_CATEGORY_NAMES.has(categoryName)) continue;
        for (const bk of category.bookmarks || []) {
            const id = String(bk?.id || '').trim();
            const url = String(bk?.url || '');
            if (!id && !url) continue;
            classifications.push({ id, url, category: categoryName });
        }
    }

    return {
        classifications,
        skipped: Number(result.skipped || 0),
        failed: Number(result.failed || 0),
        usage: result.usage ?? null,
    };
}

function sanitizeBookmarkTitle(title: string): string {
    return String(title || '')
        .replace(/\s+/g, ' ')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim()
        .slice(0, 120);
}

function sanitizeCategoryName(name: string): string {
    return String(name || '')
        .replace(/\s+/g, ' ')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim()
        .slice(0, 60);
}

function getHostname(url: string): string {
    if (!url) return '';
    try {
        return new URL(url).hostname || '';
    } catch {
        return '';
    }
}

function normalizeUrlForMeta(url: string): string | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        u.hash = '';
        return u.toString();
    } catch {
        return null;
    }
}

function isTitleUnclear(title: string): boolean {
    const t = sanitizeBookmarkTitle(title).toLowerCase();
    if (!t) return true;
    if (t.length <= 4) return true;
    if (/^https?:\/\//i.test(t)) return true;
    if (/^\d{1,8}$/.test(t)) return true;
    if (/^[\W_]+$/.test(t)) return true;

    const generic = [
        'home', 'index', 'default', 'main', 'start', 'new tab', 'untitled', 'bookmark', 'bookmarks', 'link',
        '首页', '主页', '默认', '无标题', '新标签页', '标签页', '书签', '链接', '页面',
    ];
    if (generic.includes(t)) return true;
    if (t === '-' || t === '—') return true;

    // Looks like a bare domain
    if (/^[a-z0-9.-]+\.(com|cn|net|org|io|dev|app|co|me|tv|cc)$/i.test(t)) return true;

    return false;
}

function isSensitiveForAiInput(title: string, url?: string): boolean {
    const text = `${String(title || '')} ${String(url || '')}`.toLowerCase();
    if (!text.trim()) return false;

    const patterns: RegExp[] = [
        /\b(porn|xxx|sex|hentai|nsfw|adult|erotic|jav|xvideos?|pornhub|jable|missav)\b/i,
        /(成人|色情|黄色|黄站|无码|有码|成人视频|福利姬|看片|字母圈|bdsm|约炮|偷拍|自慰|AV\b)/i,
    ];
    return patterns.some((re) => re.test(text));
}

function sanitizeReason(reason: string): string {
    return String(reason || '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim()
        .slice(0, 240);
}

function sanitizeHint(hint: string): string {
    return String(hint || '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim()
        .slice(0, 320);
}

function mergeReason(a?: string, b?: string): string | undefined {
    const left = sanitizeReason(a || '');
    const right = sanitizeReason(b || '');
    if (!left) return right || undefined;
    if (!right) return left || undefined;
    if (left === right) return left;
    if (left.includes(right)) return left;
    if (right.includes(left)) return right;
    const merged = `${left}; ${right}`.trim();
    return merged.slice(0, 240);
}

function buildPlanPrompt(
    sampleItems: { title: string; domain?: string }[],
    preferEnglish: boolean,
    preferredFolders: { title: string; count: number }[],
    maxCategories: number
): string {
    const preferredText = preferredFolders.length
        ? preferredFolders
            .map((f) => `- ${f.title}${Number.isFinite(f.count) ? ` (${f.count})` : ''}`)
            .join('\n')
        : '';

    const sampleText = sampleItems
        .map((b, i) => {
            const parts = [`title=${b.title}`];
            if (b.domain) parts.push(`domain=${b.domain}`);
            return `${i + 1}. ${parts.join(' | ')}`;
        })
        .join('\n');

    if (preferEnglish) {
        return `Design a top-level folder plan (<= ${maxCategories} folders) to organize a personal Chrome bookmark library.

Output STRICT JSON only (no markdown):
{ "plan": [{ "category": "Name", "description": "Short description" }] }

Constraints:
1) plan length: 5~${maxCategories} (and <= ${maxCategories}).
2) Prefer reusing an existing folder name EXACTLY when it fits (do not rewrite/translate it).
3) Category names must be short, clear, broad; avoid near-duplicates/synonyms; avoid over-fragmentation.
4) Do NOT include any URLs in output.

Existing folders under the target folder (you can reuse exact names):
${preferredText || '(none)'}

Sample bookmarks:
${sampleText}`;
    }

    return `请为我的个人 Chrome 书签库设计“一级分类文件夹”规划（不超过 ${maxCategories} 个）。

只输出严格 JSON（不要 markdown）：
{ "plan": [{ "category": "分类名", "description": "简短说明" }] }

要求：
1）plan 数量建议 5~${maxCategories}（且不超过 ${maxCategories}）。
2）尽量优先复用我已有的文件夹名称（必须原文完全一致，不要改写/翻译）。
3）分类名要短、清晰、偏宽泛；避免同义重复；避免过度细分。
4）输出中不要包含任何 URL。

目标文件夹下已有文件夹名称（可复用原文）：
${preferredText || '（无）'}

书签样本：
${sampleText}`;
}

function normalizePlanResponse(
    parsed: unknown,
    preferEnglish: boolean,
    maxCategories: number
): PlanCategory[] {
    const raw = (parsed as any)?.plan;
    const list = Array.isArray(raw) ? raw : [];
    const out: PlanCategory[] = [];
    const seen = new Set<string>();

    for (const x of list) {
        const name = sanitizeCategoryName(String(x?.category || x?.name || '').trim());
        if (!name) continue;
        const lower = name.toLowerCase();
        if (lower === 'uncategorized' || name === '未分类') continue;
        if (seen.has(name)) continue;
        seen.add(name);
        const descRaw = String(x?.description || x?.desc || x?.hint || '').trim();
        const description = sanitizeReason(descRaw).slice(0, preferEnglish ? 160 : 80) || undefined;
        out.push({ category: name, description });
        if (out.length >= maxCategories) break;
    }

    return out;
}

function buildClassifyPrompt(
    items: { id: string; title: string; domain?: string; hint?: string }[],
    preferEnglish: boolean,
    mode: PromptMode,
    plan: PlanCategory[],
    defaultCategory: string
): string {
    const list = items
        .map((b, i) => {
            const parts = [`id=${b.id}`, `title=${b.title}`];
            if (b.domain) parts.push(`domain=${b.domain}`);
            if (b.hint) parts.push(`hint=${b.hint}`);
            return `${i + 1}. ${parts.join(' | ')}`;
        })
        .join('\n');

    const planText = plan
        .map((p) => (p.description ? `- ${p.category}: ${p.description}` : `- ${p.category}`))
        .join('\n');

    if (preferEnglish) {
        return `Organize the following bookmarks into the ALLOWED top-level folders below.

Allowed folders (use ONLY these exact names; if none fit, use "${defaultCategory}"):
${planText || `- ${defaultCategory}`}

Rules:
1) Return STRICT JSON only (no markdown).
2) Use this schema: { "categories": [{ "category": "Name", "reason": "Short reason", "bookmarkIds": ["id1","id2"] }] }
3) Every id must appear exactly once.
4) Do NOT include any URLs in your output.
5) "reason" should be short (<= 100 chars), explain grouping by keywords/topics (based on title/domain/hint).
6) Use title as primary. domain helps. If "hint" exists, it comes from webpage meta (title/description/h1) and can help disambiguate unclear titles.
7) Do NOT invent new category names. Use only the allowed folders above or "${defaultCategory}".

Bookmarks:
${list}`;
    }

    return `请把以下书签整理到“允许的一级分类文件夹”中。

允许的分类（只能使用以下名称；不匹配放到“${defaultCategory}”）：
${planText || `- ${defaultCategory}`}

要求：
1）只返回严格的 JSON（不要 markdown）。
2）格式：{ "categories": [{ "category": "分类名", "reason": "简短原因", "bookmarkIds": ["id1","id2"] }] }
3）每个 id 必须且只能出现一次。
4）不要在输出中包含任何 URL。
5）reason 要简短（建议 <= 60 字），说明按哪些关键词/主题归类（基于标题/域名/hint）。
6）以标题为主；域名可辅助；如果存在 hint，则 hint 来自网页 meta（title/description/h1），可用于标题不清晰时的辅助判断。
7）不要发明新的分类名，只能使用“允许的分类”里的名称或“${defaultCategory}”。

书签列表：
${list}`;
}

function isContentFilterErrorText(errorText: string): boolean {
    const lower = (errorText || '').toLowerCase();
    if (lower.includes('content_filter')) return true;
    if (lower.includes('high risk')) return true;
    if (lower.includes('safety') && lower.includes('reject')) return true;
    return false;
}

function isContentFilterErrorData(data: unknown): boolean {
    const anyData = data as any;
    const err = anyData?.error;
    const type = err?.type || err?.code;
    const message = String(err?.message || '');
    if (type === 'content_filter') return true;
    if (isContentFilterErrorText(message)) return true;
    return false;
}

function isNetworkErrorMessage(errorText: string): boolean {
    const lower = (errorText || '').toLowerCase();
    if (!lower) return false;
    if (lower.includes('failed to fetch')) return true;
    if (lower.includes('networkerror')) return true;
    if (lower.includes('load failed')) return true;
    if (lower.includes('connection') && lower.includes('aborted')) return true;
    if (lower.includes('internet connection appears to be offline')) return true;
    return false;
}

function isNetworkError(err: unknown): boolean {
    const anyErr = err as any;
    if (anyErr?.isNetworkError) return true;
    if (anyErr?.name === 'AbortError') return true;
    const msg = String(anyErr?.message || '');
    return isNetworkErrorMessage(msg);
}

function isRetryableStatus(status: unknown): boolean {
    const s = Number(status);
    if (!Number.isFinite(s)) return false;
    return [408, 409, 425, 429, 500, 502, 503, 504].includes(s);
}

function isRetryableError(err: unknown): boolean {
    if (isNetworkError(err)) return true;
    const anyErr = err as any;
    return isRetryableStatus(anyErr?.status);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recordUsage(configId: string, usage: any): Promise<void> {
    if (!usage) return;
    await updateAiConfigStats(configId, (stats: AiConfigStats) => {
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

function accumulateUsage(total: any | null, add: any | null): any | null {
    if (!add) return total;
    if (!total) {
        return {
            prompt_tokens: add.prompt_tokens || 0,
            completion_tokens: add.completion_tokens || 0,
            total_tokens: add.total_tokens || 0,
        };
    }
    return {
        prompt_tokens: (total.prompt_tokens || 0) + (add.prompt_tokens || 0),
        completion_tokens: (total.completion_tokens || 0) + (add.completion_tokens || 0),
        total_tokens: (total.total_tokens || 0) + (add.total_tokens || 0),
    };
}

function normalizeAiCategories(
    parsed: unknown,
    allowedBookmarks: ClassifyBookmarkInput[],
    preferEnglish: boolean,
    allowedCategoryNames: Set<string> | undefined,
    defaultCategoryName: string
): NormalizedCategory[] {
    const defaultCategory = defaultCategoryName || (preferEnglish ? 'Uncategorized' : '未分类');
    const allowedIds = new Set(allowedBookmarks.map((b) => b.id));
    const used = new Set<string>();
    const categories: NormalizedCategory[] = [];

    const rawCategories = (parsed as any)?.categories;
    const list = Array.isArray(rawCategories) ? rawCategories : (Array.isArray(parsed) ? parsed : []);

    for (const raw of list) {
        let name = sanitizeCategoryName(String(raw?.category || raw?.name || '').trim()) || defaultCategory;
        if (allowedCategoryNames && !allowedCategoryNames.has(name)) {
            name = defaultCategory;
        }
        const reason = sanitizeReason(String(raw?.reason || raw?.rationale || raw?.why || ''));

        const ids: string[] = [];
        const rawIds = Array.isArray(raw?.bookmarkIds) ? raw.bookmarkIds : null;
        if (rawIds) {
            for (const x of rawIds) {
                const id = String(x || '').trim();
                if (!id || !allowedIds.has(id) || used.has(id)) continue;
                used.add(id);
                ids.push(id);
            }
        } else if (Array.isArray(raw?.bookmarks)) {
            for (const b of raw.bookmarks) {
                const id = String((b as any)?.id || b || '').trim();
                if (!id || !allowedIds.has(id) || used.has(id)) continue;
                used.add(id);
                ids.push(id);
            }
        }

        if (ids.length > 0) categories.push({ category: name, reason: reason || undefined, ids });
    }

    const remaining = allowedBookmarks.map((b) => b.id).filter((id) => !used.has(id));
    if (remaining.length > 0) {
        categories.push({
            category: defaultCategory,
            reason: preferEnglish ? 'Unclear topic from title/domain/hint.' : '标题/域名/hint 不足以判断主题。',
            ids: remaining,
        });
    }

    if (categories.length === 0) {
        categories.push({
            category: defaultCategory,
            reason: preferEnglish ? 'Unclear topic from title/domain/hint.' : '标题/域名/hint 不足以判断主题。',
            ids: allowedBookmarks.map((b) => b.id),
        });
    }

    return categories;
}

async function callChatCompletions(
    config: AiConfig,
    prompt: string,
    temperature: number,
    timeoutMs: number = 120_000,
    systemPrompt?: string
): Promise<{ content: string; usage: any | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const messages = systemPrompt
            ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
            : [{ role: 'user', content: prompt }];
        const response = await fetch(config.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model || 'gpt-3.5-turbo',
                messages,
                temperature,
            }),
            signal: controller.signal,
        });
        const rawText = await response.text();
        let data: any = null;
        try {
            data = JSON.parse(rawText);
        } catch {
            // keep as text
        }

        if (!response.ok) {
            const isContentFilter = isContentFilterErrorData(data) || isContentFilterErrorText(rawText);
            const err = new Error(`API error ${response.status}: ${rawText}`) as any;
            err.isContentFilter = isContentFilter;
            err.status = response.status;
            throw err;
        }

        if (!data || typeof data !== 'object') {
            throw new Error('API response is not valid JSON.');
        }

        return {
            content: data.choices?.[0]?.message?.content || '',
            usage: data.usage || null,
        };
    } catch (err) {
        const anyErr = err as any;
        if (anyErr?.name === 'AbortError') {
            const e = new Error(`Request timeout after ${timeoutMs}ms`) as any;
            e.isNetworkError = true;
            e.isTimeout = true;
            throw e;
        }
        if (isNetworkErrorMessage(String(anyErr?.message || ''))) {
            anyErr.isNetworkError = true;
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function createEmitLog(opId?: string) {
    return (level: LogLevel, msg: string) => {
        if (!opId) return;
        try {
            chrome.runtime.sendMessage({
                type: 'AI_CLASSIFY_LOG',
                opId,
                level,
                message: msg,
                time: now(),
            });
        } catch {
            // ignore
        }
    };
}

function detectKimiProvider(aiConfig: AiConfig): boolean {
    const providerLower = String(aiConfig.providerId || '').toLowerCase();
    const endpointLower = String(aiConfig.apiEndpoint || '').toLowerCase();
    return providerLower === 'kimi' || endpointLower.includes('moonshot.cn');
}

function getTimeoutCapMs(aiConfig: AiConfig): number {
    return detectKimiProvider(aiConfig) ? 360_000 : 240_000;
}

function getRecommendedBatchSize(aiConfig: AiConfig, totalItems: number): number {
    const isKimi = detectKimiProvider(aiConfig);
    if (isKimi) {
        return (
            totalItems > 2000 ? 24 :
                totalItems > 1000 ? 30 :
                    totalItems > 600 ? 40 :
                        60
        );
    }
    return (
        totalItems > 2000 ? 40 :
            totalItems > 1000 ? 60 :
                totalItems > 600 ? 80 :
                    120
    );
}

function getPreferEnglish(settings: any): boolean {
    return String(settings?.language || '').toLowerCase().startsWith('en');
}

async function planBookmarkCategories(
    bookmarksRaw: ClassifyBookmarkInput[] | unknown,
    configId?: string,
    opId?: string,
    parentFolderId?: string
) {
    const bookmarks = Array.isArray(bookmarksRaw) ? (bookmarksRaw as ClassifyBookmarkInput[]) : [];

    const config = await getAiConfigByIdOrActive(configId || null);
    assertAiConfigReady(config);
    const aiConfig: AiConfig = config;

    const settings = await getNormalizedSettings();
    const preferEnglish = getPreferEnglish(settings);
    const systemPrompt = preferEnglish
        ? 'You are a bookmark classification assistant. Follow the user rules strictly. Output STRICT JSON only. Never include any URLs.'
        : '你是一个书签分类助手。请严格遵守用户的分类要求，只输出严格 JSON，不要输出任何 URL。';

    const emitLog = createEmitLog(opId);
    const timeoutCapMs = getTimeoutCapMs(aiConfig);
    const batchSize = getRecommendedBatchSize(aiConfig, bookmarks.length);
    const defaultCategoryName = preferEnglish ? 'Uncategorized' : '未分类';
    const MAX_TOP_CATEGORIES = 9;

    emitLog('info', preferEnglish
        ? `plan start items=${bookmarks.length} batchSize=${batchSize}`
        : `规划分类开始 items=${bookmarks.length} batchSize=${batchSize}`);

    let preferredFolders: { title: string; count: number }[] = [];
    if (parentFolderId) {
        try {
            const trees = await chrome.bookmarks.getSubTree(String(parentFolderId));
            const root = trees?.[0];
            const protectedIds = new Set<string>(['0', '1', '2', '3', String(parentFolderId)]);
            const stats = new Map<string, { count: number; minDepth: number }>();

            const walk = (node: chrome.bookmarks.BookmarkTreeNode, depth: number): number => {
                if (node.url) return 1;
                let total = 0;
                for (const child of node.children || []) {
                    total += walk(child, depth + 1);
                }
                if (!protectedIds.has(node.id)) {
                    const title = sanitizeCategoryName(node.title || '');
                    if (title) {
                        const entry = stats.get(title) || { count: 0, minDepth: depth };
                        entry.count += total;
                        entry.minDepth = Math.min(entry.minDepth, depth);
                        stats.set(title, entry);
                    }
                }
                return total;
            };

            if (root) walk(root, 0);

            preferredFolders = [...stats.entries()]
                .map(([title, v]) => ({ title, count: v.count, depth: v.minDepth }))
                .filter((x) => !!x.title)
                .sort((a, b) => (b.count - a.count) || (a.depth - b.depth) || a.title.localeCompare(b.title))
                .slice(0, 60)
                .map(({ title, count }) => ({ title, count }));
        } catch {
            preferredFolders = [];
        }
    }

    if (preferredFolders.length > 0) {
        const preview = preferredFolders.slice(0, 10).map((x) => x.title).join(preferEnglish ? ', ' : '、') + (preferredFolders.length > 10 ? '…' : '');
        emitLog('info', preferEnglish
            ? `preferred folders (subtree): count=${preferredFolders.length} preview=${preview}`
            : `目标文件夹已有分类（含子孙）：count=${preferredFolders.length} preview=${preview}`);
    }

    let plan: PlanCategory[] = [];
    let totalUsage: any | null = null;

    try {
        const sampleSize = Math.min(180, bookmarks.length);
        const step = Math.max(1, Math.floor(bookmarks.length / Math.max(1, sampleSize)));
        const sampleItems: { title: string; domain?: string }[] = [];
        let skippedSensitive = 0;
        for (let idx = 0; idx < bookmarks.length && sampleItems.length < sampleSize; idx += step) {
            const b = bookmarks[idx];
            if (isSensitiveForAiInput(b.title, b.url)) {
                skippedSensitive++;
                continue;
            }
            sampleItems.push({
                title: sanitizeBookmarkTitle(b.title),
                domain: getHostname(b.url),
            });
        }
        if (skippedSensitive > 0) {
            emitLog('info', preferEnglish
                ? `plan sample filtered sensitive=${skippedSensitive}`
                : `规划样本已过滤敏感条目=${skippedSensitive}`);
        }

        const planPrompt = buildPlanPrompt(sampleItems, preferEnglish, preferredFolders, MAX_TOP_CATEGORIES);
        emitLog('info', preferEnglish
            ? `plan prompt chars=${planPrompt.length} sample=${sampleItems.length} preferred=${preferredFolders.length} max=${MAX_TOP_CATEGORIES}`
            : `规划 prompt chars=${planPrompt.length} sample=${sampleItems.length} preferred=${preferredFolders.length} max=${MAX_TOP_CATEGORIES}`);

        const startMs = Date.now();
        const timeoutMs = Math.min(timeoutCapMs, 180_000);
        const res = await callChatCompletions(aiConfig, planPrompt, 0.2, timeoutMs, systemPrompt);
        emitLog('info', `plan response ms=${Date.now() - startMs}`);
        totalUsage = accumulateUsage(totalUsage, res.usage);
        if (res.usage) await recordUsage(aiConfig.id, res.usage);

        const parsed = extractJsonFromText(res.content);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Plan response parse failed (not JSON)');
        }
        plan = normalizePlanResponse(parsed, preferEnglish, MAX_TOP_CATEGORIES);
    } catch (err) {
        emitLog('warn', preferEnglish
            ? `plan failed, fallback. ${(err as Error).message}`
            : `规划分类失败，使用回退策略。${(err as Error).message}`);
    }

    if (plan.length === 0) {
        const fromPreferred = preferredFolders.map((x) => x.title).filter(Boolean).slice(0, MAX_TOP_CATEGORIES);
        if (fromPreferred.length > 0) {
            plan = fromPreferred.map((t) => ({ category: t }));
        } else if (preferEnglish) {
            plan = [
                { category: 'Programming' },
                { category: 'AI' },
                { category: 'Tools' },
                { category: 'Learning' },
                { category: 'Work' },
                { category: 'News' },
                { category: 'Design' },
                { category: 'Entertainment' },
                { category: 'Shopping' },
                { category: 'Misc' },
            ].slice(0, MAX_TOP_CATEGORIES);
        } else {
            plan = [
                { category: '开发' },
                { category: 'AI' },
                { category: '工具' },
                { category: '学习' },
                { category: '工作' },
                { category: '资讯' },
                { category: '设计' },
                { category: '娱乐' },
                { category: '购物' },
                { category: '其他' },
            ].slice(0, MAX_TOP_CATEGORIES);
        }
        emitLog('warn', preferEnglish
            ? `plan: using fallback categories (${plan.length})`
            : `规划分类：使用回退分类（${plan.length}）`);
    }

    emitLog('info', preferEnglish
        ? `plan categories=${plan.map((p) => p.category).join(', ')}`
        : `规划分类=${plan.map((p) => p.category).join('、')}`);

    return {
        plan,
        defaultCategoryName,
        preferEnglish,
        batchSize,
        usage: totalUsage,
    };
}

async function classifyBookmarksBatch(
    bookmarksRaw: ClassifyBookmarkInputWithHint[] | unknown,
    planRaw: PlanCategory[] | unknown,
    configId?: string,
    opId?: string,
    defaultCategoryNameRaw?: string,
    preferEnglishRaw?: boolean,
    batchIndex?: number,
    batchTotal?: number,
    pass?: number
) {
    const bookmarks = Array.isArray(bookmarksRaw) ? (bookmarksRaw as ClassifyBookmarkInputWithHint[]) : [];
    const planList = Array.isArray(planRaw) ? (planRaw as PlanCategory[]) : [];

    const config = await getAiConfigByIdOrActive(configId || null);
    assertAiConfigReady(config);
    const aiConfig: AiConfig = config;

    const settings = await getNormalizedSettings();
    const preferEnglish = typeof preferEnglishRaw === 'boolean' ? preferEnglishRaw : getPreferEnglish(settings);
    const systemPrompt = preferEnglish
        ? 'You are a bookmark classification assistant. Follow the user rules strictly. Output STRICT JSON only. Never include any URLs.'
        : '你是一个书签分类助手。请严格遵守用户的分类要求，只输出严格 JSON，不要输出任何 URL。';

    const emitLog = createEmitLog(opId);
    const timeoutCapMs = getTimeoutCapMs(aiConfig);
    const defaultCategoryName = sanitizeCategoryName(String(defaultCategoryNameRaw || '').trim()) || (preferEnglish ? 'Uncategorized' : '未分类');
    const MAX_TOP_CATEGORIES = 9;

    const plan: PlanCategory[] = [];
    const seen = new Set<string>();
    for (const p of planList) {
        const name = sanitizeCategoryName(String((p as any)?.category || (p as any)?.name || '').trim());
        if (!name) continue;
        if (name.toLowerCase() === 'uncategorized' || name === '未分类') continue;
        if (seen.has(name)) continue;
        seen.add(name);
        plan.push({ category: name, description: sanitizeReason(String((p as any)?.description || '').trim()) || undefined });
        if (plan.length >= MAX_TOP_CATEGORIES) break;
    }

    const batchLabel = (Number.isFinite(Number(batchIndex)) && Number.isFinite(Number(batchTotal)) && Number(batchIndex) > 0 && Number(batchTotal) > 0)
        ? `batch ${Number(batchIndex)}/${Number(batchTotal)}`
        : '';
    const passLabel = pass ? ` pass=${pass}` : '';
    emitLog('info', `${batchLabel || 'batch'}${passLabel} items=${bookmarks.length}`);

    if (bookmarks.length === 0) {
        return { categories: [], skipped: 0, failed: 0, usage: null };
    }

    const byId = new Map<string, ClassifyBookmarkInputWithHint>(bookmarks.map((b) => [b.id, b]));
    const skippedBookmarks: ClassifyBookmarkInputWithHint[] = [];
    const requestFailedBookmarks: ClassifyBookmarkInputWithHint[] = [];
    let totalUsage: any | null = null;
    let requestCount = 0;

    const allowedCategoryNames = new Set<string>([defaultCategoryName, ...plan.map((p) => p.category)]);
    const categoryToData = new Map<string, { ids: string[]; reason?: string }>();
    const assigned = new Set<string>();
    const requestFailedSet = new Set<string>();

    function mergeCategories(cats: NormalizedCategory[]) {
        for (const cat of cats) {
            const name = cat.category;
            const entry = categoryToData.get(name) || { ids: [] as string[], reason: undefined as string | undefined };
            const list = entry.ids;
            for (const id of cat.ids) {
                if (!byId.has(id) || assigned.has(id)) continue;
                assigned.add(id);
                list.push(id);
            }
            entry.reason = mergeReason(entry.reason, cat.reason);
            categoryToData.set(name, entry);
        }
    }

    function markRequestFailed(items: ClassifyBookmarkInputWithHint[], reasonLog?: string) {
        for (const b of items) {
            if (!b || assigned.has(b.id) || requestFailedSet.has(b.id)) continue;
            requestFailedSet.add(b.id);
            requestFailedBookmarks.push(b);
        }
        if (reasonLog) emitLog('warn', reasonLog);
    }

    // Pre-classify clearly sensitive entries locally to reduce provider content-filter retries/timeouts.
    const aiCandidates: ClassifyBookmarkInputWithHint[] = [];
    let sensitiveLocalCount = 0;
    const sensitiveCategoryName = preferEnglish ? 'Sensitive (Manual Review)' : '敏感内容（需手动复核）';
    const sensitiveReason = preferEnglish
        ? 'Locally grouped by safety keywords to avoid provider content filtering.'
        : '根据安全关键词在本地归类，避免触发模型内容风控。';
    for (const b of bookmarks) {
        if (isSensitiveForAiInput(b.title, b.url)) {
            const entry = categoryToData.get(sensitiveCategoryName) || { ids: [] as string[], reason: undefined as string | undefined };
            if (!assigned.has(b.id)) {
                entry.ids.push(b.id);
                assigned.add(b.id);
                sensitiveLocalCount++;
            }
            entry.reason = mergeReason(entry.reason, sensitiveReason);
            categoryToData.set(sensitiveCategoryName, entry);
            continue;
        }
        aiCandidates.push(b);
    }
    if (sensitiveLocalCount > 0) {
        emitLog('info', preferEnglish
            ? `locally grouped sensitive items=${sensitiveLocalCount}`
            : `已本地归类敏感条目=${sensitiveLocalCount}`);
    }

    // Keep each message-call bounded to avoid MV3 message channel closure.
    const batchRuntimeBudgetMs = Math.min(300_000, Math.max(180_000, aiCandidates.length * 8_000));
    const batchDeadlineMs = Date.now() + batchRuntimeBudgetMs;
    function throwIfBatchDeadlineExceeded() {
        if (Date.now() <= batchDeadlineMs) return;
        const err = new Error(preferEnglish
            ? `Batch runtime exceeded ${batchRuntimeBudgetMs}ms; mark remaining as request failed.`
            : `单批处理超时（>${batchRuntimeBudgetMs}ms），剩余条目将标记为请求失败。`) as Error & { isBatchDeadline?: boolean };
        err.isBatchDeadline = true;
        throw err;
    }

    const MAX_REQUESTS = Math.min(36, Math.max(10, Math.ceil(Math.max(aiCandidates.length, 1) * 0.8)));

    async function classifyOnce(subset: ClassifyBookmarkInputWithHint[], mode: PromptMode) {
        throwIfBatchDeadlineExceeded();
        requestCount++;
        if (requestCount > MAX_REQUESTS) {
            throw new Error(preferEnglish
                ? 'Too many retries. Please classify fewer bookmarks at a time.'
                : '重试次数过多（可能有大量条目触发风控）。请减少一次分类的书签数量后再试。');
        }

        emitLog('info', `${batchLabel ? `${batchLabel} ` : ''}#${requestCount} mode=${mode} items=${subset.length}`);

        const items = subset.map((b) => {
            const title = sanitizeBookmarkTitle(b.title);
            const domain = mode === 'title_domain' ? getHostname(b.url) : undefined;
            const hint = sanitizeHint(String((b as any)?.hint || '')) || undefined;
            return { id: b.id, title, domain, hint };
        });

        const hintCount = items.reduce((n, x) => n + (x.hint ? 1 : 0), 0);

        const prompt = buildClassifyPrompt(items, preferEnglish, mode, plan, defaultCategoryName);
        const preview = items
            .slice(0, 3)
            .map((x) => {
                const parts = [`id=${x.id}`, `title=${x.title}`];
                if (mode === 'title_domain') parts.push(`domain=${x.domain || '-'}`);
                if (x.hint) parts.push(`hint=${x.hint.slice(0, 80)}`);
                return parts.join(' | ');
            })
            .join(' || ');
        emitLog('info', `${batchLabel ? `${batchLabel} ` : ''}prompt chars=${prompt.length} hint=${hintCount} preview=${preview}${items.length > 3 ? ' || ...' : ''}`);

        let content = '';
        let usage: any | null = null;
        const startMs = Date.now();
        const baseTimeoutMs = Math.min(timeoutCapMs, 45_000 + subset.length * 400);
        const maxAttempts = 2;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            throwIfBatchDeadlineExceeded();
            const timeoutMs = attempt === 1 ? baseTimeoutMs : Math.min(timeoutCapMs, Math.round(baseTimeoutMs * 1.5));
            try {
                if (attempt > 1) {
                    emitLog('warn', `${batchLabel ? `${batchLabel} ` : ''}retry attempt=${attempt}/${maxAttempts} timeoutMs=${timeoutMs}`);
                    await sleep(800);
                }
                const res = await callChatCompletions(aiConfig, prompt, 0.2, timeoutMs, systemPrompt);
                content = res.content;
                usage = res.usage;
                break;
            } catch (err) {
                const anyErr = err as any;
                if (anyErr?.isContentFilter) {
                    emitLog('warn', `${batchLabel ? `${batchLabel} ` : ''}content_filter (mode=${mode}, items=${subset.length})`);
                    throw err;
                }
                if (attempt < maxAttempts && isRetryableError(err)) {
                    emitLog('warn', `${batchLabel ? `${batchLabel} ` : ''}retryable_error (mode=${mode}, items=${subset.length}): ${(err as Error).message}`);
                    continue;
                }
                if (isRetryableError(err)) {
                    emitLog('warn', `${batchLabel ? `${batchLabel} ` : ''}retryable_error_final (mode=${mode}, items=${subset.length}): ${(err as Error).message}`);
                } else {
                    emitLog('error', (err as Error).message);
                }
                throw err;
            }
        }

        emitLog('info', `${batchLabel ? `${batchLabel} ` : ''}response ms=${Date.now() - startMs}`);
        totalUsage = accumulateUsage(totalUsage, usage);
        if (usage) await recordUsage(aiConfig.id, usage);

        const parsed = extractJsonFromText(content);
        if (!parsed || typeof parsed !== 'object') {
            emitLog('error', 'AI response parse failed (not JSON)');
            throw new Error('AI response could not be parsed as JSON. Raw: ' + content.substring(0, 500));
        }

        return normalizeAiCategories(parsed, subset as unknown as ClassifyBookmarkInput[], preferEnglish, allowedCategoryNames, defaultCategoryName);
    }

    async function splitAndProcess(subset: ClassifyBookmarkInputWithHint[], reasonHint: string) {
        const stack: ClassifyBookmarkInputWithHint[][] = [subset];
        emitLog('warn', `${batchLabel ? `${batchLabel} ` : ''}fallback: split (${reasonHint}) items=${subset.length}`);

        while (stack.length > 0) {
            if (Date.now() > batchDeadlineMs) {
                markRequestFailed(
                    stack.flat(),
                    `${batchLabel ? `${batchLabel} ` : ''}stop split due to batch runtime budget; mark remaining as request_failed`
                );
                return;
            }
            const part = stack.pop()!;
            try {
                const cats = await classifyOnce(part, 'title_only');
                mergeCategories(cats);
                continue;
            } catch (err) {
                const anyErr = err as any;
                if (anyErr?.isBatchDeadline) {
                    markRequestFailed(
                        [...part, ...stack.flat()],
                        `${batchLabel ? `${batchLabel} ` : ''}stop split due to batch runtime budget; mark remaining as request_failed`
                    );
                    return;
                }
                const cf = !!anyErr?.isContentFilter;
                const retryable = isRetryableError(err);
                if (!cf && !retryable) throw err;

                if (part.length <= 1) {
                    const b = part[0];
                    if (b) {
                        if (cf) {
                            skippedBookmarks.push(b);
                            emitLog('warn', `${batchLabel ? `${batchLabel} ` : ''}skip(content_filter) id=${b.id} title=${sanitizeBookmarkTitle(b.title)} domain=${getHostname(b.url) || '-'}`);
                        } else {
                            markRequestFailed([b], `${batchLabel ? `${batchLabel} ` : ''}skip(request_failed) id=${b.id} title=${sanitizeBookmarkTitle(b.title)} domain=${getHostname(b.url) || '-'}`);
                        }
                    }
                    continue;
                }

                emitLog('warn', `${batchLabel ? `${batchLabel} ` : ''}split items=${part.length} reason=${cf ? 'content_filter' : 'request_error'}`);
                const mid = Math.ceil(part.length / 2);
                stack.push(part.slice(mid));
                stack.push(part.slice(0, mid));
            }
        }
    }

    async function processSubset(subset: ClassifyBookmarkInputWithHint[]) {
        if (subset.length === 0) return;
        try {
            const cats = await classifyOnce(subset, 'title_domain');
            mergeCategories(cats);
            return;
        } catch (err) {
            const anyErr = err as any;
            if (anyErr?.isBatchDeadline) {
                markRequestFailed(subset, `${batchLabel ? `${batchLabel} ` : ''}batch runtime budget exceeded; mark subset as request_failed`);
                return;
            }
            if (!anyErr?.isContentFilter && !isRetryableError(err)) throw err;
            if (anyErr?.isContentFilter) emitLog('warn', `${batchLabel ? `${batchLabel} ` : ''}fallback: retry with title_only (items=${subset.length})`);
            else emitLog('warn', `${batchLabel ? `${batchLabel} ` : ''}fallback: retry with title_only due to request_error (items=${subset.length})`);
        }

        try {
            const cats = await classifyOnce(subset, 'title_only');
            mergeCategories(cats);
            return;
        } catch (err2) {
            const anyErr2 = err2 as any;
            if (anyErr2?.isBatchDeadline) {
                markRequestFailed(subset, `${batchLabel ? `${batchLabel} ` : ''}batch runtime budget exceeded; mark subset as request_failed`);
                return;
            }
            if (!anyErr2?.isContentFilter && !isRetryableError(err2)) throw err2;
            if (anyErr2?.isContentFilter) {
                await splitAndProcess(subset, 'content_filter');
            } else {
                await splitAndProcess(subset, 'request_error');
            }
            return;
        }
    }

    await processSubset(aiCandidates);

    const skippedIds = new Set(skippedBookmarks.map((b) => b.id));
    const failedIds = new Set(requestFailedBookmarks.map((b) => b.id));
    const remaining = bookmarks.filter((b) => !assigned.has(b.id) && !skippedIds.has(b.id) && !failedIds.has(b.id));
    if (remaining.length > 0) {
        const name = defaultCategoryName;
        const entry = categoryToData.get(name) || { ids: [] as string[], reason: undefined as string | undefined };
        const list = entry.ids;
        for (const b of remaining) list.push(b.id);
        if (!entry.reason) {
            entry.reason = preferEnglish ? 'Unclear topic from title/domain/hint.' : '标题/域名/hint 不足以判断主题。';
        }
        categoryToData.set(name, entry);
    }

    if (skippedBookmarks.length > 0) {
        const name = preferEnglish ? 'Skipped (Content Filter)' : '已跳过（内容风控）';
        const entry = categoryToData.get(name) || { ids: [] as string[], reason: undefined as string | undefined };
        const list = entry.ids;
        for (const b of skippedBookmarks) list.push(b.id);
        entry.reason = preferEnglish
            ? 'Skipped due to provider content filter.'
            : '因接口内容风控被拒绝，已跳过这些条目。';
        categoryToData.set(name, entry);
    }

    if (requestFailedBookmarks.length > 0) {
        const name = preferEnglish ? 'Skipped (Request Failed)' : '已跳过（请求失败）';
        const entry = categoryToData.get(name) || { ids: [] as string[], reason: undefined as string | undefined };
        const list = entry.ids;
        for (const b of requestFailedBookmarks) list.push(b.id);
        entry.reason = preferEnglish
            ? 'Skipped due to repeated request failures/timeouts.'
            : '因网络错误/超时等请求失败原因，已跳过这些条目。';
        categoryToData.set(name, entry);
    }

    const categories = [...categoryToData.entries()]
        .filter(([, data]) => data.ids.length > 0)
        .map(([category, data]) => ({
            category,
            reason: data.reason,
            bookmarks: data.ids
                .map((id) => byId.get(id))
                .filter(Boolean)
                .map((b) => ({ id: b!.id, title: b!.title, url: b!.url })),
        }));

    emitLog('info', `${batchLabel || 'batch'} done categories=${categories.length} skipped=${skippedBookmarks.length} failed=${requestFailedBookmarks.length} requests=${requestCount}`);

    return { categories, skipped: skippedBookmarks.length, failed: requestFailedBookmarks.length, usage: totalUsage };
}

async function classifyAllBookmarks(
    bookmarksRaw: ClassifyBookmarkInput[] | unknown,
    configId?: string,
    opId?: string,
    parentFolderId?: string
) {
    const config = await getAiConfigByIdOrActive(configId || null);
    assertAiConfigReady(config);
    const aiConfig: AiConfig = config;

    const settings = await getNormalizedSettings();
    const preferEnglish = getPreferEnglish(settings);
    const systemPrompt = preferEnglish
        ? 'You are a bookmark classification assistant. Follow the user rules strictly. Output STRICT JSON only. Never include any URLs.'
        : '你是一个书签分类助手。请严格遵守用户的分类要求，只输出严格 JSON，不要输出任何 URL。';
    const emitLog = createEmitLog(opId);

    const defaultUntitled = preferEnglish ? 'Untitled Bookmark' : '未命名书签';
    const normalizedBookmarks: ClassifyBookmarkInput[] = (Array.isArray(bookmarksRaw) ? bookmarksRaw : [])
        .map((b: any) => ({
            id: String(b?.id || '').trim(),
            title: sanitizeBookmarkTitle(String(b?.title || '').trim()) || defaultUntitled,
            url: String(b?.url || ''),
        }))
        .filter((b) => !!b.id);

    if (normalizedBookmarks.length === 0) {
        return {
            categories: [],
            skipped: 0,
            failed: 0,
            summary: { total: 0, assigned: 0, uncategorized: 0, failed: 0 },
            usage: null,
        };
    }

    emitLog('info', preferEnglish
        ? `full classify start total=${normalizedBookmarks.length} mode=title_only`
        : `全量分类开始 total=${normalizedBookmarks.length} mode=仅标题`);

    // Reuse existing planner but force title-only sample by stripping URLs.
    const planInput = normalizedBookmarks.map((b) => ({ id: b.id, title: b.title, url: '' }));
    const planRes = await planBookmarkCategories(planInput, configId, opId, parentFolderId);
    const plan = Array.isArray(planRes?.plan) ? planRes.plan : [];
    const defaultCategoryName = FIXED_UNCATEGORIZED_CATEGORY;

    // Keep batch size moderate for stability and predictable latency.
    const batchSize = Math.max(20, Math.min(80, Number(planRes?.batchSize) || 40));
    const allowedCategoryNames = new Set<string>([defaultCategoryName, ...plan.map((p: any) => String(p.category || '').trim()).filter(Boolean)]);
    const byId = new Map<string, ClassifyBookmarkInput>(normalizedBookmarks.map((b) => [b.id, b]));
    const categoryToData = new Map<string, { ids: string[]; reason?: string }>();
    const assigned = new Set<string>();
    let totalUsage: any | null = planRes?.usage || null;
    let failedByRequest = 0;

    const appendToCategory = (name: string, ids: string[], reason?: string) => {
        const entry = categoryToData.get(name) || { ids: [] as string[], reason: undefined as string | undefined };
        for (const id of ids) {
            if (!byId.has(id) || assigned.has(id)) continue;
            assigned.add(id);
            entry.ids.push(id);
        }
        entry.reason = mergeReason(entry.reason, reason);
        categoryToData.set(name, entry);
    };

    const mergeNormalizedCategories = (cats: NormalizedCategory[]) => {
        for (const cat of cats) appendToCategory(cat.category, cat.ids, cat.reason);
    };

    const chunk = <T,>(arr: T[], size: number): T[][] => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
    };

    const batches = chunk(normalizedBookmarks, batchSize);
    if (batches.length > 1) {
        emitLog('info', preferEnglish
            ? `assign in batches totalBatches=${batches.length} batchSize<=${batchSize}`
            : `映射分类分批执行 totalBatches=${batches.length} batchSize<=${batchSize}`);
    }

    const timeoutCapMs = getTimeoutCapMs(aiConfig);
    const maxAttempts = 2;

    for (let i = 0; i < batches.length; i++) {
        const subset = batches[i];
        emitLog('info', `batch ${i + 1}/${batches.length} items=${subset.length}`);

        const items = subset.map((b) => ({ id: b.id, title: b.title }));
        const prompt = buildClassifyPrompt(items, preferEnglish, 'title_only', plan, defaultCategoryName);

        let parsedOk = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const timeoutMs = Math.min(timeoutCapMs, attempt === 1 ? 60_000 : 90_000);
            try {
                if (attempt > 1) {
                    emitLog('warn', `batch ${i + 1}/${batches.length} retry attempt=${attempt}/${maxAttempts} timeoutMs=${timeoutMs}`);
                    await sleep(500);
                }
                const start = Date.now();
                const res = await callChatCompletions(aiConfig, prompt, 0.2, timeoutMs, systemPrompt);
                emitLog('info', `batch ${i + 1}/${batches.length} response ms=${Date.now() - start}`);
                totalUsage = accumulateUsage(totalUsage, res.usage);
                if (res.usage) await recordUsage(aiConfig.id, res.usage);

                const parsed = extractJsonFromText(res.content);
                if (!parsed || typeof parsed !== 'object') {
                    throw new Error('AI response parse failed (not JSON)');
                }
                const cats = normalizeAiCategories(parsed, subset, preferEnglish, allowedCategoryNames, defaultCategoryName);
                mergeNormalizedCategories(cats);
                parsedOk = true;
                break;
            } catch (err) {
                const retryable = isRetryableError(err);
                if (attempt < maxAttempts && retryable) {
                    emitLog('warn', `batch ${i + 1}/${batches.length} retryable_error: ${(err as Error).message}`);
                    continue;
                }
                emitLog('warn', `batch ${i + 1}/${batches.length} fallback_to_uncategorized: ${(err as Error).message}`);
                break;
            }
        }

        if (!parsedOk) {
            failedByRequest += subset.length;
            appendToCategory(
                defaultCategoryName,
                subset.map((b) => b.id),
                preferEnglish
                    ? `Auto-fallback to ${FIXED_UNCATEGORIZED_CATEGORY} due to request/parsing failure.`
                    : `因请求失败或解析失败自动归入“${FIXED_UNCATEGORIZED_CATEGORY}”。`
            );
        }
    }

    const remaining = normalizedBookmarks.map((b) => b.id).filter((id) => !assigned.has(id));
    if (remaining.length > 0) {
        appendToCategory(
            defaultCategoryName,
            remaining,
            preferEnglish
                ? `Unassigned by model; auto-filled into ${FIXED_UNCATEGORIZED_CATEGORY}.`
                : `模型未覆盖到的条目，已自动补入“${FIXED_UNCATEGORIZED_CATEGORY}”。`
        );
    }

    const categories = [...categoryToData.entries()]
        .filter(([, data]) => data.ids.length > 0)
        .map(([category, data]) => ({
            category,
            reason: data.reason,
            bookmarks: data.ids
                .map((id) => byId.get(id))
                .filter(Boolean)
                .map((b) => ({ id: b!.id, title: b!.title, url: b!.url })),
        }));

    const uncategorizedCount = categories
        .filter((c) => c.category === defaultCategoryName)
        .reduce((sum, c) => sum + c.bookmarks.length, 0);

    const summary = {
        total: normalizedBookmarks.length,
        assigned: normalizedBookmarks.length,
        uncategorized: uncategorizedCount,
        failed: failedByRequest,
    };

    emitLog('info', preferEnglish
        ? `full classify done total=${summary.total} uncategorized=${summary.uncategorized} failed=${summary.failed}`
        : `全量分类完成 total=${summary.total} 未分类=${summary.uncategorized} 请求失败归并=${summary.failed}`);

    return {
        categories,
        skipped: 0,
        failed: failedByRequest,
        summary,
        usage: totalUsage,
        defaultCategoryName,
        batchSize,
    };
}

async function classifyBookmarks(
    bookmarks: ClassifyBookmarkInput[],
    configId?: string,
    opId?: string,
    parentFolderId?: string
) {
    const config = await getAiConfigByIdOrActive(configId || null);
    assertAiConfigReady(config);
    const aiConfig: AiConfig = config;

    const settings = await getNormalizedSettings();
    const preferEnglish = String(settings.language || '').toLowerCase().startsWith('en');
    const systemPrompt = preferEnglish
        ? 'You are a bookmark classification assistant. Follow the user rules strictly. Output STRICT JSON only. Never include any URLs.'
        : '你是一个书签分类助手。请严格遵守用户的分类要求，只输出严格 JSON，不要输出任何 URL。';

    if (bookmarks.length === 0) {
        return { categories: [], skipped: 0, usage: null };
    }

    const byId = new Map<string, ClassifyBookmarkInput>(bookmarks.map((b) => [b.id, b]));
    const skippedBookmarks: ClassifyBookmarkInput[] = [];
    const requestFailedBookmarks: ClassifyBookmarkInput[] = [];
    let totalUsage: any | null = null;
    let requestCount = 0;

    const providerLower = String(aiConfig.providerId || '').toLowerCase();
    const endpointLower = String(aiConfig.apiEndpoint || '').toLowerCase();
    const isKimi = providerLower === 'kimi' || endpointLower.includes('moonshot.cn');
    const timeoutCapMs = isKimi ? 360_000 : 240_000;

    const BATCH_SIZE = isKimi
        ? (
            bookmarks.length > 2000 ? 24 :
                bookmarks.length > 1000 ? 30 :
                    bookmarks.length > 600 ? 40 :
                        60
        )
        : (
            bookmarks.length > 2000 ? 40 :
                bookmarks.length > 1000 ? 60 :
                    bookmarks.length > 600 ? 80 :
                        120
        );
    const batchCount = Math.ceil(bookmarks.length / BATCH_SIZE);
    const MAX_REQUESTS = Math.min(800, Math.max(60, batchCount * 25 + 60));

    const emitLog = (level: LogLevel, msg: string) => {
        if (!opId) return;
        try {
            chrome.runtime.sendMessage({
                type: 'AI_CLASSIFY_LOG',
                opId,
                level,
                message: msg,
                time: now(),
            });
        } catch {
            // ignore
        }
    };

    emitLog('info', `start items=${bookmarks.length}`);
    emitLog('info', preferEnglish
        ? `config provider=${aiConfig.providerId} model=${aiConfig.model || '-'} batchSize=${BATCH_SIZE}`
        : `配置：provider=${aiConfig.providerId} model=${aiConfig.model || '-'} batchSize=${BATCH_SIZE}`);
    emitLog('info', preferEnglish
        ? 'payload: id + title (+ hostname). No full URLs are sent.'
        : '发送内容：id + 标题（可选域名 hostname），不包含完整 URL（路径/参数）。');

    const metaEnabled = !!settings.aiFetchMeta;
    let metaPermission = false;
    let firewallWhitelist: string[] = [];
    const metaHintCache = new Map<string, string>(); // normalizedUrl -> hint (may be empty string)
    let metaBudget = Math.min(320, Math.max(80, Math.round(bookmarks.length * 0.2)));
    const META_PER_REQUEST_LIMIT = 12;

    if (metaEnabled) {
        try {
            metaPermission = await chrome.permissions.contains({ origins: [...WEB_ACCESS_ORIGINS] as unknown as string[] });
        } catch {
            metaPermission = false;
        }

        if (!metaPermission) {
            emitLog('warn', preferEnglish
                ? 'meta: enabled in settings but site access permission is not granted. Continue without webpage hints.'
                : 'meta：已在设置中开启，但未授权“访问网站”。将不抓取网页摘要继续分类。');
        } else {
            firewallWhitelist = await getWhitelist();
            emitLog('info', preferEnglish
                ? `meta: enabled (second pass for Uncategorized; unclear titles). budget=${metaBudget} perRequest<=${META_PER_REQUEST_LIMIT}`
                : `meta：已开启（仅对“未分类”二次细分，且标题不清晰时抓取）。预算=${metaBudget} 每次<=${META_PER_REQUEST_LIMIT}`);
        }
    }

    const defaultCategoryName = preferEnglish ? 'Uncategorized' : '未分类';
    const MAX_TOP_CATEGORIES = 9;

    let preferredFolders: { title: string; count: number }[] = [];
    if (parentFolderId) {
        try {
            const trees = await chrome.bookmarks.getSubTree(String(parentFolderId));
            const root = trees?.[0];
            const protectedIds = new Set<string>(['0', '1', '2', '3', String(parentFolderId)]);
            const stats = new Map<string, { count: number; minDepth: number }>();

            const walk = (node: chrome.bookmarks.BookmarkTreeNode, depth: number): number => {
                if (node.url) return 1;
                let total = 0;
                for (const child of node.children || []) {
                    total += walk(child, depth + 1);
                }
                if (!protectedIds.has(node.id)) {
                    const title = sanitizeCategoryName(node.title || '');
                    if (title) {
                        const entry = stats.get(title) || { count: 0, minDepth: depth };
                        entry.count += total;
                        entry.minDepth = Math.min(entry.minDepth, depth);
                        stats.set(title, entry);
                    }
                }
                return total;
            };

            if (root) walk(root, 0);

            preferredFolders = [...stats.entries()]
                .map(([title, v]) => ({ title, count: v.count, depth: v.minDepth }))
                .filter((x) => !!x.title)
                .sort((a, b) => (b.count - a.count) || (a.depth - b.depth) || a.title.localeCompare(b.title))
                .slice(0, 60)
                .map(({ title, count }) => ({ title, count }));
        } catch {
            preferredFolders = [];
        }
    }
    if (preferredFolders.length > 0) {
        const preview = preferredFolders.slice(0, 10).map((x) => x.title).join('、') + (preferredFolders.length > 10 ? '…' : '');
        emitLog('info', preferEnglish
            ? `preferred folders (subtree): count=${preferredFolders.length} preview=${preview}`
            : `目标文件夹已有分类（含子孙）：count=${preferredFolders.length} preview=${preview}`);
    }

    // Step 0: Plan top-level categories (<= 10) once, then batch-assign bookmarks into the plan.
    let plan: PlanCategory[] = [];
    try {
        const sampleSize = Math.min(180, bookmarks.length);
        const step = Math.max(1, Math.floor(bookmarks.length / Math.max(1, sampleSize)));
        const sampleItems: { title: string; domain?: string }[] = [];
        let skippedSensitive = 0;
        for (let idx = 0; idx < bookmarks.length && sampleItems.length < sampleSize; idx += step) {
            const b = bookmarks[idx];
            if (isSensitiveForAiInput(b.title, b.url)) {
                skippedSensitive++;
                continue;
            }
            sampleItems.push({
                title: sanitizeBookmarkTitle(b.title),
                domain: getHostname(b.url),
            });
        }
        if (skippedSensitive > 0) {
            emitLog('info', preferEnglish
                ? `plan sample filtered sensitive=${skippedSensitive}`
                : `规划样本已过滤敏感条目=${skippedSensitive}`);
        }

        const planPrompt = buildPlanPrompt(sampleItems, preferEnglish, preferredFolders, MAX_TOP_CATEGORIES);
        emitLog('info', preferEnglish
            ? `plan: max=${MAX_TOP_CATEGORIES} sample=${sampleItems.length} preferred=${preferredFolders.length} prompt chars=${planPrompt.length}`
            : `规划分类：max=${MAX_TOP_CATEGORIES} sample=${sampleItems.length} preferred=${preferredFolders.length} prompt chars=${planPrompt.length}`);

        const startMs = Date.now();
        const timeoutMs = Math.min(timeoutCapMs, 180_000);
        const res = await callChatCompletions(aiConfig, planPrompt, 0.2, timeoutMs, systemPrompt);
        emitLog('info', `plan response ms=${Date.now() - startMs}`);
        totalUsage = accumulateUsage(totalUsage, res.usage);
        if (res.usage) await recordUsage(aiConfig.id, res.usage);

        const parsed = extractJsonFromText(res.content);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Plan response parse failed (not JSON)');
        }
        plan = normalizePlanResponse(parsed, preferEnglish, MAX_TOP_CATEGORIES);
    } catch (err) {
        emitLog('warn', preferEnglish
            ? `plan: failed, fallback. ${(err as Error).message}`
            : `规划分类失败，使用回退策略。${(err as Error).message}`);
    }

    if (plan.length === 0) {
        const fromPreferred = preferredFolders.map((x) => x.title).filter(Boolean).slice(0, MAX_TOP_CATEGORIES);
        if (fromPreferred.length > 0) {
            plan = fromPreferred.map((t) => ({ category: t }));
        } else if (preferEnglish) {
            plan = [
                { category: 'Programming' },
                { category: 'AI' },
                { category: 'Tools' },
                { category: 'Learning' },
                { category: 'Work' },
                { category: 'News' },
                { category: 'Design' },
                { category: 'Entertainment' },
                { category: 'Shopping' },
                { category: 'Misc' },
            ].slice(0, MAX_TOP_CATEGORIES);
        } else {
            plan = [
                { category: '开发' },
                { category: 'AI' },
                { category: '工具' },
                { category: '学习' },
                { category: '工作' },
                { category: '资讯' },
                { category: '设计' },
                { category: '娱乐' },
                { category: '购物' },
                { category: '其他' },
            ].slice(0, MAX_TOP_CATEGORIES);
        }
        emitLog('warn', preferEnglish
            ? `plan: using fallback categories (${plan.length})`
            : `规划分类：使用回退分类（${plan.length}）`);
    }

    emitLog('info', preferEnglish
        ? `plan categories=${plan.map((p) => p.category).join(', ')}`
        : `规划分类=${plan.map((p) => p.category).join('、')}`);

    const allowedCategoryNames = new Set<string>([defaultCategoryName, ...plan.map((p) => p.category)]);

    const categoryToData = new Map<string, { ids: string[]; reason?: string }>();
    const assigned = new Set<string>();

    function mergeCategories(cats: NormalizedCategory[]) {
        for (const cat of cats) {
            const name = cat.category;
            const entry = categoryToData.get(name) || { ids: [] as string[], reason: undefined as string | undefined };
            const list = entry.ids;
            for (const id of cat.ids) {
                if (!byId.has(id) || assigned.has(id)) continue;
                assigned.add(id);
                list.push(id);
            }
            entry.reason = mergeReason(entry.reason, cat.reason);
            categoryToData.set(name, entry);
        }
    }

    async function ensureMetaHints(subset: ClassifyBookmarkInput[]): Promise<{
        unclear: number;
        cached: number;
        fetched: number;
        failed: number;
        skippedNoUrl: number;
        skippedWhitelist: number;
        budgetLeft: number;
    } | null> {
        if (!metaEnabled || !metaPermission) return null;
        if (metaBudget <= 0) return null;

        const unclearItems = subset.filter((b) => isTitleUnclear(b.title));
        if (unclearItems.length === 0) return null;

        let cached = 0;
        let skippedNoUrl = 0;
        let skippedWhitelist = 0;

        const candidates: { key: string; url: string; prio: number }[] = [];
        const seenKeys = new Set<string>();
        for (const b of unclearItems) {
            const key = normalizeUrlForMeta(b.url);
            if (!key) {
                skippedNoUrl++;
                continue;
            }
            if (firewallWhitelist.length > 0 && isWhitelisted(b.url, firewallWhitelist)) {
                skippedWhitelist++;
                continue;
            }
            if (metaHintCache.has(key)) {
                cached++;
                continue;
            }
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            candidates.push({ key, url: key, prio: sanitizeBookmarkTitle(b.title).length });
        }

        candidates.sort((a, b) => a.prio - b.prio);
        const fetchCount = Math.max(0, Math.min(META_PER_REQUEST_LIMIT, metaBudget, candidates.length));
        if (fetchCount === 0) {
            return {
                unclear: unclearItems.length,
                cached,
                fetched: 0,
                failed: 0,
                skippedNoUrl,
                skippedWhitelist,
                budgetLeft: metaBudget,
            };
        }

        const toFetch = candidates.slice(0, fetchCount);
        metaBudget -= toFetch.length;

        let cursor = 0;
        let fetched = 0;
        let failed = 0;
        const concurrency = Math.min(4, toFetch.length);
        const worker = async () => {
            while (true) {
                const idx = cursor++;
                if (idx >= toFetch.length) break;
                const job = toFetch[idx];
                if (metaHintCache.has(job.key)) continue;
                const meta = await fetchPageMeta(job.url, { timeoutMs: 9000, maxBytes: 140_000 });
                const hint = sanitizeHint(formatMetaHint(meta));
                metaHintCache.set(job.key, hint);
                if (hint) fetched++;
                else failed++;
            }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));

        return {
            unclear: unclearItems.length,
            cached,
            fetched,
            failed,
            skippedNoUrl,
            skippedWhitelist,
            budgetLeft: metaBudget,
        };
    }

    async function classifyOnce(subset: ClassifyBookmarkInput[], mode: PromptMode, useMetaHints: boolean) {
        requestCount++;
        if (requestCount > MAX_REQUESTS) {
            throw new Error(preferEnglish
                ? 'Too many retries. Please classify fewer bookmarks at a time.'
                : '重试次数过多（可能有大量条目触发风控）。请减少一次分类的书签数量后再试。');
        }

        emitLog('info', `#${requestCount} mode=${mode} items=${subset.length}`);

        const metaStats = useMetaHints ? await ensureMetaHints(subset) : null;

        const items = subset.map((b) => {
            const title = sanitizeBookmarkTitle(b.title);
            const domain = mode === 'title_domain' ? getHostname(b.url) : undefined;
            let hint: string | undefined;
            if (useMetaHints && metaEnabled && metaPermission && isTitleUnclear(title)) {
                const key = normalizeUrlForMeta(b.url);
                const cachedHint = key ? metaHintCache.get(key) : '';
                if (cachedHint) hint = cachedHint;
            }
            return { id: b.id, title, domain, hint };
        });

        const hintCount = items.reduce((n, x) => n + (x.hint ? 1 : 0), 0);
        if (metaStats) {
            emitLog(
                'info',
                `meta unclear=${metaStats.unclear} hint=${hintCount} fetched=${metaStats.fetched} cached=${metaStats.cached} failed=${metaStats.failed} skipWl=${metaStats.skippedWhitelist} budgetLeft=${metaStats.budgetLeft}`
            );
        }

        const prompt = buildClassifyPrompt(items, preferEnglish, mode, plan, defaultCategoryName);
        const preview = items
            .slice(0, 3)
            .map((x) => {
                const parts = [`id=${x.id}`, `title=${x.title}`];
                if (mode === 'title_domain') parts.push(`domain=${x.domain || '-'}`);
                if (x.hint) parts.push(`hint=${x.hint.slice(0, 80)}`);
                return parts.join(' | ');
            })
            .join(' || ');
        emitLog('info', `prompt chars=${prompt.length} hint=${hintCount} preview=${preview}${items.length > 3 ? ' || ...' : ''}`);
        let content = '';
        let usage: any | null = null;
        const startMs = Date.now();
        const baseTimeoutMs = Math.min(timeoutCapMs, 90_000 + subset.length * 600);
        const maxAttempts = 2;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const timeoutMs = attempt === 1 ? baseTimeoutMs : Math.min(timeoutCapMs, Math.round(baseTimeoutMs * 1.8));
            try {
                if (attempt > 1) {
                    emitLog('warn', `retry attempt=${attempt}/${maxAttempts} timeoutMs=${timeoutMs}`);
                    await sleep(800);
                }
                const res = await callChatCompletions(aiConfig, prompt, 0.2, timeoutMs, systemPrompt);
                content = res.content;
                usage = res.usage;
                break;
            } catch (err) {
                const anyErr = err as any;
                if (anyErr?.isContentFilter) {
                    emitLog('warn', `content_filter (mode=${mode}, items=${subset.length})`);
                    throw err;
                }
                if (attempt < maxAttempts && isRetryableError(err)) {
                    emitLog('warn', `retryable_error (mode=${mode}, items=${subset.length}): ${(err as Error).message}`);
                    continue;
                }
                if (isRetryableError(err)) {
                    emitLog('warn', `retryable_error_final (mode=${mode}, items=${subset.length}): ${(err as Error).message}`);
                } else {
                    emitLog('error', (err as Error).message);
                }
                throw err;
            }
        }

        emitLog('info', `response ms=${Date.now() - startMs}`);
        totalUsage = accumulateUsage(totalUsage, usage);
        if (usage) await recordUsage(aiConfig.id, usage);

        const parsed = extractJsonFromText(content);
        if (!parsed || typeof parsed !== 'object') {
            emitLog('error', 'AI response parse failed (not JSON)');
            throw new Error('AI response could not be parsed as JSON. Raw: ' + content.substring(0, 500));
        }

        return normalizeAiCategories(parsed, subset, preferEnglish, allowedCategoryNames, defaultCategoryName);
    }

    async function splitAndProcess(subset: ClassifyBookmarkInput[], reasonHint: string, useMetaHints: boolean) {
        const stack: ClassifyBookmarkInput[][] = [subset];
        emitLog('warn', `fallback: split (${reasonHint}) items=${subset.length}`);

        while (stack.length > 0) {
            const part = stack.pop()!;
            try {
                const cats = await classifyOnce(part, 'title_only', useMetaHints);
                mergeCategories(cats);
                continue;
            } catch (err) {
                const anyErr = err as any;
                const cf = !!anyErr?.isContentFilter;
                const retryable = isRetryableError(err);
                if (!cf && !retryable) throw err;

                if (part.length <= 1) {
                    const b = part[0];
                    if (b) {
                        if (cf) {
                            skippedBookmarks.push(b);
                            emitLog('warn', `skip(content_filter) id=${b.id} title=${sanitizeBookmarkTitle(b.title)} domain=${getHostname(b.url) || '-'}`);
                        } else {
                            requestFailedBookmarks.push(b);
                            emitLog('warn', `skip(request_failed) id=${b.id} title=${sanitizeBookmarkTitle(b.title)} domain=${getHostname(b.url) || '-'}`);
                        }
                    }
                    continue;
                }

                emitLog('warn', `split items=${part.length} reason=${cf ? 'content_filter' : 'request_error'}`);
                const mid = Math.ceil(part.length / 2);
                stack.push(part.slice(mid));
                stack.push(part.slice(0, mid));
            }
        }
    }

    async function processSubset(subset: ClassifyBookmarkInput[], useMetaHints: boolean) {
        try {
            const cats = await classifyOnce(subset, 'title_domain', useMetaHints);
            mergeCategories(cats);
            return;
        } catch (err) {
            const anyErr = err as any;
            if (!anyErr?.isContentFilter && !isRetryableError(err)) throw err;
            if (anyErr?.isContentFilter) emitLog('warn', `fallback: retry with title_only (items=${subset.length})`);
            else emitLog('warn', `fallback: retry with title_only due to request_error (items=${subset.length})`);
        }

        try {
            const cats = await classifyOnce(subset, 'title_only', useMetaHints);
            mergeCategories(cats);
            return;
        } catch (err2) {
            const anyErr2 = err2 as any;
            if (!anyErr2?.isContentFilter && !isRetryableError(err2)) throw err2;
            if (anyErr2?.isContentFilter) {
                await splitAndProcess(subset, 'content_filter', useMetaHints);
            } else {
                await splitAndProcess(subset, 'request_error', useMetaHints);
            }
            return;
        }
    }

    function chunk<T>(arr: T[], size: number): T[][] {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
    }

    const batches = chunk(bookmarks, BATCH_SIZE);
    if (batches.length > 1) {
        emitLog('info', `batch mode: batches=${batches.length} size<=${BATCH_SIZE}`);
    }

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        emitLog('info', `batch ${i + 1}/${batches.length} items=${batch.length}`);
        await processSubset(batch, false);
    }

    // Second pass: refine Uncategorized using lightweight webpage hints (optional).
    const uncategorizedEntry = categoryToData.get(defaultCategoryName);
    const uncategorizedIds = uncategorizedEntry?.ids ? [...uncategorizedEntry.ids] : [];
    if (metaEnabled && metaPermission && uncategorizedIds.length > 0) {
        const subset = uncategorizedIds
            .map((id) => byId.get(id))
            .filter(Boolean) as ClassifyBookmarkInput[];

        emitLog('info', preferEnglish
            ? `second pass: refine Uncategorized items=${subset.length}`
            : `二次细分：未分类 items=${subset.length}`);

        // Remove from current Uncategorized assignment so we can re-assign.
        if (uncategorizedEntry) {
            uncategorizedEntry.ids = [];
            categoryToData.set(defaultCategoryName, uncategorizedEntry);
        }
        for (const b of subset) assigned.delete(b.id);

        const secondBatches = chunk(subset, BATCH_SIZE);
        if (secondBatches.length > 1) {
            emitLog('info', preferEnglish
                ? `second pass batch mode: batches=${secondBatches.length} size<=${BATCH_SIZE}`
                : `二次细分分批：batches=${secondBatches.length} size<=${BATCH_SIZE}`);
        }

        for (let i = 0; i < secondBatches.length; i++) {
            const batch = secondBatches[i];
            emitLog('info', preferEnglish
                ? `second pass batch ${i + 1}/${secondBatches.length} items=${batch.length}`
                : `二次细分 batch ${i + 1}/${secondBatches.length} items=${batch.length}`);
            await processSubset(batch, true);
        }
    } else if (metaEnabled && metaPermission) {
        emitLog('info', preferEnglish
            ? 'second pass: no Uncategorized items'
            : '二次细分：未分类为空');
    }

    // Put remaining items into Uncategorized (should be rare)
    const skippedIds = new Set(skippedBookmarks.map((b) => b.id));
    const failedIds = new Set(requestFailedBookmarks.map((b) => b.id));
    const remaining = bookmarks.filter((b) => !assigned.has(b.id) && !skippedIds.has(b.id) && !failedIds.has(b.id));
    if (remaining.length > 0) {
        const name = defaultCategoryName;
        const entry = categoryToData.get(name) || { ids: [] as string[], reason: undefined as string | undefined };
        const list = entry.ids;
        for (const b of remaining) list.push(b.id);
        if (!entry.reason) {
            entry.reason = preferEnglish ? 'Unclear topic from title/domain/hint.' : '标题/域名/hint 不足以判断主题。';
        }
        categoryToData.set(name, entry);
    }

    if (skippedBookmarks.length > 0) {
        const name = preferEnglish ? 'Skipped (Content Filter)' : '已跳过（内容风控）';
        const entry = categoryToData.get(name) || { ids: [] as string[], reason: undefined as string | undefined };
        const list = entry.ids;
        for (const b of skippedBookmarks) list.push(b.id);
        entry.reason = preferEnglish
            ? 'Skipped due to provider content filter.'
            : '因接口内容风控被拒绝，已跳过这些条目。';
        categoryToData.set(name, entry);
    }

    if (requestFailedBookmarks.length > 0) {
        const name = preferEnglish ? 'Skipped (Request Failed)' : '已跳过（请求失败）';
        const entry = categoryToData.get(name) || { ids: [] as string[], reason: undefined as string | undefined };
        const list = entry.ids;
        for (const b of requestFailedBookmarks) list.push(b.id);
        entry.reason = preferEnglish
            ? 'Skipped due to repeated request failures/timeouts.'
            : '因网络错误/超时等请求失败原因，已跳过这些条目。';
        categoryToData.set(name, entry);
    }

    const categories = [...categoryToData.entries()]
        .filter(([, data]) => data.ids.length > 0)
        .map(([category, data]) => ({
            category,
            reason: data.reason,
            bookmarks: data.ids
                .map((id) => byId.get(id))
                .filter(Boolean)
                .map((b) => ({ id: b!.id, title: b!.title, url: b!.url })),
        }));

    emitLog('info', `done categories=${categories.length} skipped=${skippedBookmarks.length} failed=${requestFailedBookmarks.length} requests=${requestCount}`);
    return { categories, skipped: skippedBookmarks.length, failed: requestFailedBookmarks.length, usage: totalUsage };
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
