// Bookmark types
export interface BookmarkNode {
    id: string;
    title: string;
    url?: string;
    parentId?: string;
    index?: number;
    dateAdded?: number;
    dateGroupModified?: number;
    children?: BookmarkNode[];
}

// AI Config types
export interface AiConfigStats {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    lastUsed: string | null;
    history: AiUsageEntry[];
}

export interface AiUsageEntry {
    time: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface AiConfig {
    id: string;
    label: string;
    providerId: string;
    apiEndpoint: string;
    apiKey: string;
    model: string;
    stats: AiConfigStats;
}

export interface Settings {
    darkMode: 'auto' | 'light' | 'dark';
    language: string;
    firewallWhitelist: string[];
    /** When enabled, fetch lightweight webpage meta for unclear titles (requires optional host permissions). */
    aiFetchMeta?: boolean;
    aiConfigs: AiConfig[];
    activeAiConfigId: string | null;
    // Legacy fields (settings page compat)
    apiEndpoint?: string;
    apiKey?: string;
    model?: string;
}

// Link check types
export type LinkStatus = 'valid' | 'invalid' | 'whitelisted' | 'timeout' | 'redirect' | 'client_error' | 'server_error';

export interface LinkCheckResult {
    url: string;
    status: LinkStatus;
    statusCode: number | null;
    message: string;
    id?: string;
    title?: string;
}

// AI Search types
export interface SearchBookmarkInput {
    id: string;
    title: string;
    url: string;
    dateAdded?: number;
    /** Local-only plugin metadata (chrome.storage.local). Not part of Chrome bookmarks. */
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

// Message types for background communication
export type MessageType =
    | 'CHECK_LINK'
    | 'CHECK_LINKS_BATCH'
    | 'AI_SEARCH_BOOKMARKS'
    | 'TEST_AI_CONNECTION'
    | 'GET_SETTINGS'
    | 'SAVE_SETTINGS';

export interface ExtMessage {
    type: MessageType;
    [key: string]: unknown;
}
