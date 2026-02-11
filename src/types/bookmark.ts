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
    bookmarks: { id: string; title: string; url: string }[];
}

export interface ClassifyResult {
    categories: ClassifyCategory[];
    skipped: number;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}

// Operation history for undo
export interface MoveRecord {
    bookmarkId: string;
    fromParentId: string;
    fromIndex: number;
    toParentId: string;
}

export interface OperationRecord {
    id: string;
    timestamp: string;
    description: string;
    moves: MoveRecord[];
    foldersCreated: string[];
}

// Message types for background communication
export type MessageType =
    | 'CHECK_LINK'
    | 'CHECK_LINKS_BATCH'
    | 'CLASSIFY_BOOKMARKS'
    | 'TEST_AI_CONNECTION'
    | 'GET_SETTINGS'
    | 'SAVE_SETTINGS';

export interface ExtMessage {
    type: MessageType;
    [key: string]: unknown;
}
