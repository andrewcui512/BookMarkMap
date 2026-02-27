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

// AI Classification types
export interface ClassifyCategory {
    category: string;
    reason?: string;
    bookmarks: { id: string; title: string; url: string }[];
}

export interface ClassifyResult {
    categories: ClassifyCategory[];
    skipped: number;
    failed?: number;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}

// Operation history for undo
export interface MoveRecord {
    bookmarkId: string;
    fromParentId: string;
    fromIndex: number;
    toParentId: string;
}

export interface PrunedFolderRecord {
    id: string;
    title: string;
    parentId: string;
    index: number;
}

export interface OperationRecord {
    id: string;
    timestamp: string;
    description: string;
    moves: MoveRecord[];
    foldersCreated: string[];
    prunedFolders?: PrunedFolderRecord[];
}

// Message types for background communication
export type MessageType =
    | 'CHECK_LINK'
    | 'CHECK_LINKS_BATCH'
    | 'AI_CLASSIFY'
    | 'AI_TEST'
    | 'AI_CLASSIFY_ALL_BOOKMARKS'
    | 'AI_PLAN_BOOKMARKS'
    | 'AI_CLASSIFY_BOOKMARKS_BATCH'
    | 'CLASSIFY_BOOKMARKS'
    | 'TEST_AI_CONNECTION'
    | 'GET_SETTINGS'
    | 'SAVE_SETTINGS'
    | 'SAVE_OPERATION'
    | 'GET_OPERATIONS'
    | 'DELETE_OPERATION';

export interface ExtMessage {
    type: MessageType;
    [key: string]: unknown;
}
