/**
 * AI-powered natural language bookmark search
 * Converts user queries into semantic search results
 */

import { getAiConfigByIdOrActive, assertAiConfigReady, updateAiConfigStats, pushHistory, extractJsonFromText, getNormalizedSettings } from '@/lib/ai-config';
import { now } from '@/lib/utils';
import type { AiConfig, AiConfigStats } from '@/types/bookmark';

// Types
export interface SearchBookmarkInput {
    id: string;
    title: string;
    url: string;
    dateAdded?: number;
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

/**
 * Main AI search function
 */
export async function searchBookmarksWithAi(
    query: string,
    bookmarks: SearchBookmarkInput[],
    configId?: string,
    maxResults: number = 20
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
    const cacheKey = `${normalizedQuery}:${configId || 'default'}`;
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

    // Build prompt
    const prompt = buildSearchPrompt(normalizedQuery, bookmarks, preferEnglish, maxResults);
    const systemPrompt = preferEnglish
        ? 'You are a bookmark search assistant. Analyze the user query and return the most relevant bookmarks with relevance scores. Output strict JSON only.'
        : '你是书签搜索助手。分析用户查询并返回最相关的书签及相关度评分。只输出严格的 JSON。';

    // Call AI
    const response = await callChatCompletions(config, prompt, 0.3, 30000, systemPrompt);

    // Update stats
    if (response.usage) {
        await updateAiConfigStats(config.id, (stats: AiConfigStats) => {
            stats.totalRequests++;
            stats.totalPromptTokens += response.usage.prompt_tokens || 0;
            stats.totalCompletionTokens += response.usage.completion_tokens || 0;
            stats.totalTokens += response.usage.total_tokens || 0;
            stats.lastUsed = now();
            pushHistory(stats, {
                time: now(),
                promptTokens: response.usage.prompt_tokens || 0,
                completionTokens: response.usage.completion_tokens || 0,
                totalTokens: response.usage.total_tokens || 0,
            });
        });
    }

    // Parse response
    const parsed = extractJsonFromText(response.content);
    const results = parseSearchResponse(parsed, bookmarks, maxResults);

    // Update cache
    updateCache(cacheKey, results);

    return {
        results: results.slice(0, maxResults),
        query: normalizedQuery,
        totalMatches: results.length,
        usage: response.usage,
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
    maxResults: number
): string {
    // Sample bookmarks if too many (max 200 for context window)
    const sampleSize = Math.min(200, bookmarks.length);
    const sampledBookmarks = bookmarks.length > sampleSize
        ? sampleBookmarks(bookmarks, sampleSize)
        : bookmarks;

    const bookmarkList = sampledBookmarks
        .map((b, i) => `${i + 1}. id=${b.id} | title=${sanitizeTitle(b.title)} | url=${extractDomain(b.url)}`)
        .join('\n');

    if (preferEnglish) {
        return `Find bookmarks matching this search query: "${query}"

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
6. If query is in Chinese, match Chinese bookmarks; if English, match English bookmarks

Bookmarks:
${bookmarkList}`;
    }

    return `查找与此搜索查询匹配的书签："${query}"

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
6. 如果查询是中文，匹配中文书签；如果是英文，匹配英文书签

书签列表：
${bookmarkList}`;
}

/**
 * Parse AI response into search results
 */
function parseSearchResponse(
    parsed: any,
    bookmarks: SearchBookmarkInput[],
    maxResults: number
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

    return results.slice(0, maxResults);
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

        const response = await fetch(config.apiEndpoint, {
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

function extractDomain(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

function sampleBookmarks(bookmarks: SearchBookmarkInput[], size: number): SearchBookmarkInput[] {
    // Stratified sampling: recent + random
    const sorted = [...bookmarks].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    const recent = sorted.slice(0, Math.floor(size * 0.3));
    const remaining = sorted.slice(Math.floor(size * 0.3));

    // Random sample from remaining
    const randomSample = [];
    const step = Math.max(1, Math.floor(remaining.length / (size - recent.length)));
    for (let i = 0; i < remaining.length && randomSample.length < (size - recent.length); i += step) {
        randomSample.push(remaining[i]);
    }

    return [...recent, ...randomSample];
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
