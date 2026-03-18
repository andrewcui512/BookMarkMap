/**
 * AI configuration management
 * Extracted from ai.js and background.js to eliminate duplication.
 */

import { now, normalizeStr, randomId } from './utils';
import type { AiConfig, AiConfigStats, AiUsageEntry, Settings } from '@/types/bookmark';

/** Provider presets for quick configuration */
export const PROVIDER_PRESETS = [
    {
        id: 'kimi',
        label: 'Kimi（月之暗面 Moonshot）',
        apiEndpoint: 'https://api.moonshot.cn/v1/chat/completions',
        model: 'moonshot-v1-8k',
    },
    {
        id: 'deepseek',
        label: 'DeepSeek',
        apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-chat',
    },
    {
        id: 'glm',
        label: 'GLM（智谱 BigModel）',
        apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        model: 'glm-4-flash',
    },
    {
        id: 'custom',
        label: '自定义（OpenAI 兼容）',
        apiEndpoint: '',
        model: '',
    },
] as const;

/** Ensure a config has a valid stats object */
export function ensureConfigStats(config: AiConfig): AiConfig {
    if (!config.stats) {
        config.stats = {
            totalRequests: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            lastUsed: null,
            history: [],
        };
    }
    return config;
}

/** Push a usage entry to stats history (max 50) */
export function pushHistory(stats: AiConfigStats, entry: AiUsageEntry): void {
    stats.history = stats.history || [];
    stats.history.push(entry);
    if (stats.history.length > 50) {
        stats.history = stats.history.slice(-50);
    }
}

/**
 * Normalize AI configs in settings.
 * Handles migration from legacy single-config format and ensures data integrity.
 */
export function normalizeAiConfigs(settings: Settings): Settings {
    // Initialize configs array if missing
    if (!Array.isArray(settings.aiConfigs)) {
        settings.aiConfigs = [];
    }

    // Migrate legacy single-config fields
    const legacyEndpoint = normalizeStr(settings.apiEndpoint);
    const legacyKey = normalizeStr(settings.apiKey);
    const legacyModel = normalizeStr(settings.model);

    if (legacyEndpoint || legacyKey || legacyModel) {
        const existingLegacy = settings.aiConfigs.find(
            (c) => normalizeStr(c.apiEndpoint) === legacyEndpoint && normalizeStr(c.apiKey) === legacyKey
        );
        if (!existingLegacy) {
            const migrated: AiConfig = {
                id: randomId(),
                label: '从设置页迁移',
                providerId: 'custom',
                apiEndpoint: legacyEndpoint,
                apiKey: legacyKey,
                model: legacyModel || 'gpt-3.5-turbo',
                stats: {
                    totalRequests: 0,
                    totalPromptTokens: 0,
                    totalCompletionTokens: 0,
                    totalTokens: 0,
                    lastUsed: null,
                    history: [],
                },
            };
            settings.aiConfigs.push(migrated);
            if (!settings.activeAiConfigId) {
                settings.activeAiConfigId = migrated.id;
            }
        }
        // Clean up legacy fields
        delete settings.apiEndpoint;
        delete settings.apiKey;
        delete settings.model;
    }

    // Ensure every config has stats
    settings.aiConfigs.forEach(ensureConfigStats);

    // Ensure at least one config exists so the settings UI can persist edits.
    // (Fresh installs used to have empty `aiConfigs`, which made "Test connection"
    // always fail with "AI not configured".)
    if (settings.aiConfigs.length === 0) {
        const id = randomId();
        settings.aiConfigs.push({
            id,
            label: '默认',
            providerId: 'custom',
            apiEndpoint: '',
            apiKey: '',
            model: 'gpt-3.5-turbo',
            stats: {
                totalRequests: 0,
                totalPromptTokens: 0,
                totalCompletionTokens: 0,
                totalTokens: 0,
                lastUsed: null,
                history: [],
            },
        });
        settings.activeAiConfigId = id;
    }

    // Validate activeAiConfigId
    if (
        settings.activeAiConfigId &&
        !settings.aiConfigs.find((c) => c.id === settings.activeAiConfigId)
    ) {
        settings.activeAiConfigId = settings.aiConfigs[0]?.id || null;
    }

    return settings;
}

/** Check if a config has enough info to make requests */
export function isConfigReady(config: AiConfig | null | undefined): boolean {
    return !!(config && normalizeStr(config.apiEndpoint) && normalizeStr(config.apiKey));
}

/** Assert config is ready, throw if not */
export function assertAiConfigReady(config: AiConfig | null | undefined): asserts config is AiConfig {
    if (!config) throw new Error('AI not configured');
    if (!normalizeStr(config.apiEndpoint)) throw new Error('API endpoint missing');
    if (!normalizeStr(config.apiKey)) throw new Error('API key missing');
}

/** Get provider label by ID */
export function getProviderLabel(providerId: string): string {
    return PROVIDER_PRESETS.find((p) => p.id === providerId)?.label || providerId;
}

/** Extract JSON from AI response text (handles markdown code blocks) */
export function extractJsonFromText(text: string): unknown | null {
    // Try direct parse
    try {
        return JSON.parse(text);
    } catch {
        // ignore
    }

    // Try extracting from markdown code block
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1]);
        } catch {
            // ignore
        }
    }

    // Try finding JSON-like structure
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch {
            // ignore
        }
    }

    return null;
}

/** Get default settings */
export function getDefaultSettings(): Settings {
    return {
        darkMode: 'auto',
        language: 'zh_CN',
        firewallWhitelist: [
            'google.com', 'youtube.com', 'twitter.com', 'x.com',
            'facebook.com', 'instagram.com', 'reddit.com', 'discord.com',
        ],
        aiConfigs: [],
        activeAiConfigId: null,
    };
}

/** Load, normalize, and return settings */
export async function getNormalizedSettings(): Promise<Settings> {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['settings'], (result) => {
            const raw = result.settings || getDefaultSettings();
            resolve(normalizeAiConfigs(raw));
        });
    });
}

/** Update a specific AI config's stats */
export async function updateAiConfigStats(
    configId: string,
    updater: (stats: AiConfigStats) => void
): Promise<void> {
    const settings = await getNormalizedSettings();
    const config = settings.aiConfigs.find((c) => c.id === configId);
    if (config) {
        ensureConfigStats(config);
        updater(config.stats);
        await new Promise<void>((resolve) => {
            chrome.storage.sync.set({ settings }, () => resolve());
        });
    }
}

/** Get AI config by ID or the active one */
export async function getAiConfigByIdOrActive(configId: string | null = null): Promise<AiConfig | null> {
    const settings = await getNormalizedSettings();
    if (configId) {
        return settings.aiConfigs.find((c) => c.id === configId) || null;
    }
    return settings.aiConfigs.find((c) => c.id === settings.activeAiConfigId) || null;
}
