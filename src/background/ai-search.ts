/**
 * AI-powered natural language bookmark search
 * Converts user queries into semantic search results
 */

import { getAiConfigByIdOrActive, assertAiConfigReady, updateAiConfigStats, pushHistory, extractJsonFromText, getNormalizedSettings } from '@/lib/ai-config';
import { toChatCompletionsEndpoint } from '@/lib/ai-endpoint';
import { now } from '@/lib/utils';
import type { AiConfig, AiConfigStats } from '@/types/bookmark';

// Types
export interface SearchBookmarkInput {
    id: string;
    title: string;
    url: string;
    dateAdded?: number;
    tags?: string[];
}

export interface SearchResult {
    id: string;
    title: string;
    url: string;
    relevanceScore: number;  // 0-100
    reason?: string;         // Why this bookmark matches
}

export interface AiSearchResponse {
    results: SearchResult[];
    query: string;
    totalMatches: number;
    usage: any | null;
    cached: boolean;
}

// Cache for recent searches (in-memory, session-scoped)
const searchCache = new Map<string, { results: SearchResult[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 50;
const CHUNK_SIZE = 180; // bookmarks per AI request (token budget)
const TOTAL_TIME_BUDGET_MS = 45_000; // best-effort budget for multi-call scanning
const PER_CALL_TIMEOUT_MS = 18_000;

/**
 * Main AI search function
 */
export async function searchBookmarksWithAi(
    query: string,
    bookmarks: SearchBookmarkInput[],
    configId?: string,
    maxResults: number = 20,
    contextKey: string = ''
): Promise<AiSearchResponse> {
    // Validate input
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
        return { results: [], query, totalMatches: 0, usage: null, cached: false };
    }

    if (bookmarks.length === 0) {
        return { results: [], query, totalMatches: 0, usage: null, cached: false };
    }

    // Check cache
    const cacheKey = `${normalizedQuery}:${configId || 'default'}:${contextKey}`;
    const cached = searchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
        return {
            results: cached.results.slice(0, maxResults),
            query: normalizedQuery,
            totalMatches: cached.results.length,
            usage: null,
            cached: true,
        };
    }

    // Get AI config
    const config = await getAiConfigByIdOrActive(configId || null);
    assertAiConfigReady(config);

    // Determine language preference
    const settings = await getNormalizedSettings();
    const preferEnglish = String(settings?.language || '').toLowerCase().startsWith('en');

    const startedAt = Date.now();
    const perChunkMaxResults = Math.min(30, Math.max(10, maxResults));
    const systemPrompt = preferEnglish
        ? 'You are a bookmark search assistant. Analyze the user query and return the most relevant bookmarks with relevance scores. Output strict JSON only.'
        : '你是书签搜索助手。分析用户查询并返回最相关的书签及相关度评分。只输出严格的 JSON。';

    // Sort by recency for more stable chunking and better early recall.
    const sorted = [...bookmarks].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    const chunks = chunkBy(sorted, CHUNK_SIZE);

    const merged = new Map<string, SearchResult>();
    let calls = 0;
    let lastError: Error | null = null;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    for (let i = 0; i < chunks.length; i++) {
        if (Date.now() - startedAt > TOTAL_TIME_BUDGET_MS) break;

        const chunk = chunks[i];
        const prompt = buildSearchPrompt(
            normalizedQuery,
            chunk,
            preferEnglish,
            perChunkMaxResults,
            i + 1,
            chunks.length
        );

        try {
            const response = await callChatCompletions(config, prompt, 0.3, PER_CALL_TIMEOUT_MS, systemPrompt);
            calls++;
            if (response.usage) {
                totalPromptTokens += response.usage.prompt_tokens || 0;
                totalCompletionTokens += response.usage.completion_tokens || 0;
                totalTokens += response.usage.total_tokens || 0;
            }

            const parsed = extractJsonFromText(response.content);
            const results = parseSearchResponse(parsed, chunk);
            for (const r of results) {
                const prev = merged.get(r.id);
                if (!prev || r.relevanceScore > prev.relevanceScore) merged.set(r.id, r);
            }
        } catch (err) {
            lastError = err as Error;
        }
    }

    if (calls === 0) {
        throw lastError || new Error('AI request failed');
    }

    // Update stats (aggregate, best-effort)
    await updateAiConfigStats(config.id, (stats: AiConfigStats) => {
        stats.totalRequests += calls;
        stats.totalPromptTokens += totalPromptTokens;
        stats.totalCompletionTokens += totalCompletionTokens;
        stats.totalTokens += totalTokens;
        stats.lastUsed = now();
        pushHistory(stats, {
            time: now(),
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens,
        });
    });

    const allResults = Array.from(merged.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Update cache
    updateCache(cacheKey, allResults);

    return {
        results: allResults.slice(0, maxResults),
        query: normalizedQuery,
        totalMatches: allResults.length,
        usage: {
            prompt_tokens: totalPromptTokens,
            completion_tokens: totalCompletionTokens,
            total_tokens: totalTokens,
            requests: calls,
        },
        cached: false,
    };
}

/**
 * Build search prompt for AI
 */
function buildSearchPrompt(
    query: string,
    bookmarks: SearchBookmarkInput[],
    preferEnglish: boolean,
    maxResults: number,
    chunkIndex: number,
    chunkCount: number
): string {
    const bookmarkList = bookmarks
        .map((b, i) => {
            const tags = Array.isArray(b.tags) ? b.tags.slice(0, 8).join(',') : '';
            const tagPart = tags ? ` | tags=${tags}` : '';
            return `${i + 1}. id=${b.id} | title=${sanitizeTitle(b.title)} | url=${extractUrlHint(b.url)}${tagPart}`;
        })
        .join('\n');

    if (preferEnglish) {
        return `Find bookmarks matching this search query: "${query}"

This is chunk ${chunkIndex}/${chunkCount} of the user's bookmark list. Only return IDs that appear in this chunk.

Return the most relevant bookmarks (up to ${maxResults}) with relevance scores.

Output STRICT JSON only (no markdown):
{
  "matches": [
    {
      "id": "bookmark_id",
      "relevanceScore": 95,
      "reason": "Brief explanation why this matches"
    }
  ]
}

Rules:
1. relevanceScore: 0-100 (100 = perfect match, 0 = no match)
2. Only include bookmarks with score >= 30
3. Sort by relevanceScore descending
4. reason: Short explanation (max 100 chars) based on title/domain/keywords
5. Consider semantic meaning, not just exact keyword matches
6. You may use tags=... as additional hints when matching
7. If query is in Chinese, match Chinese bookmarks; if English, match English bookmarks

Bookmarks:
${bookmarkList}`;
    }

    return `查找与此搜索查询匹配的书签："${query}"

这是书签列表的第 ${chunkIndex}/${chunkCount} 段。只允许返回本段列表中出现的书签ID。

返回最相关的书签（最多 ${maxResults} 个）及相关度评分。

只输出严格 JSON（不要 markdown）：
{
  "matches": [
    {
      "id": "书签ID",
      "relevanceScore": 95,
      "reason": "简短说明为何匹配"
    }
  ]
}

规则：
1. relevanceScore：0-100（100=完全匹配，0=不匹配）
2. 只包含评分 >= 30 的书签
3. 按 relevanceScore 降序排列
4. reason：简短说明（最多 60 字）基于标题/域名/关键词
5. 考虑语义含义，不仅仅是精确关键词匹配
6. 你可以把 tags=... 作为额外提示来匹配
7. 如果查询是中文，匹配中文书签；如果是英文，匹配英文书签

书签列表：
${bookmarkList}`;
}

/**
 * Parse AI response into search results
 */
function parseSearchResponse(
    parsed: any,
    bookmarks: SearchBookmarkInput[]
): SearchResult[] {
    if (!parsed || typeof parsed !== 'object') {
        return [];
    }

    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    const bookmarkMap = new Map(bookmarks.map(b => [b.id, b]));
    const results: SearchResult[] = [];

    for (const match of matches) {
        const id = String(match?.id || '').trim();
        const score = Number(match?.relevanceScore || 0);
        const reason = String(match?.reason || '').trim().slice(0, 200);

        if (!id || score < 30) continue;

        const bookmark = bookmarkMap.get(id);
        if (!bookmark) continue;

        results.push({
            id: bookmark.id,
            title: bookmark.title,
            url: bookmark.url,
            relevanceScore: Math.min(100, Math.max(0, score)),
            reason: reason || undefined,
        });
    }

    // Sort by relevance score descending
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return results;
}

/**
 * Call AI chat completions API
 */
async function callChatCompletions(
    config: AiConfig,
    prompt: string,
    temperature: number,
    timeoutMs: number,
    systemPrompt?: string
): Promise<{ content: string; usage: any | null }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const messages: any[] = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const response = await fetch(toChatCompletionsEndpoint(config.apiEndpoint), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model,
                messages,
                temperature,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const usage = data.usage || null;

        return { content, usage };
    } finally {
        clearTimeout(timeoutId);
    }
}

// Helper functions
function sanitizeTitle(title: string): string {
    return String(title || '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function extractUrlHint(url: string): string {
    try {
        const u = new URL(url);
        // Keep it short; include path because it often contains keywords.
        const hint = `${u.hostname}${u.pathname}`.slice(0, 80);
        return hint || u.hostname;
    } catch {
        return '';
    }
}

function chunkBy<T>(items: T[], size: number): T[][] {
    if (size <= 0) return [items];
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function updateCache(key: string, results: SearchResult[]): void {
    // Evict old entries if cache is full
    if (searchCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = Array.from(searchCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0]?.[0];
        if (oldestKey) searchCache.delete(oldestKey);
    }

    searchCache.set(key, { results, timestamp: Date.now() });
}
