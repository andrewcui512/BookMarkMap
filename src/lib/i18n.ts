/**
 * Internationalization helper
 * Unified i18n functions extracted from popup.js, main.js, settings.js
 */

type PlaceholderDef = { content: string };
type MessageDef = {
    message: string;
    placeholders?: Record<string, PlaceholderDef>;
};
type LocaleMessages = Record<string, MessageDef>;

const MESSAGE_CACHE: Partial<Record<'zh_CN' | 'en', LocaleMessages>> = {};
const LOADING: Partial<Record<'zh_CN' | 'en', Promise<LocaleMessages>>> = {};

let currentLanguage: 'zh_CN' | 'en' = 'zh_CN';

function normalizeLanguage(lang: string | null | undefined): 'zh_CN' | 'en' {
    return lang === 'en' ? 'en' : 'zh_CN';
}

function escapeRegExp(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toSubArray(substitutions?: string | string[]): string[] {
    if (typeof substitutions === 'string') return [substitutions];
    if (Array.isArray(substitutions)) return substitutions;
    return [];
}

function applySubstitutions(
    template: string,
    placeholders: MessageDef['placeholders'] | undefined,
    substitutions?: string | string[]
): string {
    let result = template;
    const subs = toSubArray(substitutions);

    // 1) Named placeholders ($COUNT$, $DAYS$...) based on placeholders mapping.
    if (placeholders) {
        for (const [name, def] of Object.entries(placeholders)) {
            const match = def?.content?.match(/^\$(\d+)$/);
            const idx = match ? Number(match[1]) : NaN;
            const value = Number.isFinite(idx) ? (subs[idx - 1] ?? '') : '';
            const re = new RegExp(`\\$${escapeRegExp(name)}\\$`, 'gi');
            result = result.replace(re, value);
        }
    }

    // 2) Positional placeholders ($1, $2...)
    result = result.replace(/\$(\d+)/g, (_m, n) => {
        const idx = Number(n);
        if (!Number.isFinite(idx) || idx <= 0) return '';
        return subs[idx - 1] ?? '';
    });

    return result;
}

export function getCurrentLanguage(): 'zh_CN' | 'en' {
    return currentLanguage;
}

export function setCurrentLanguage(lang: string): void {
    currentLanguage = normalizeLanguage(lang);
}

export async function loadLocaleMessages(lang: string): Promise<LocaleMessages> {
    const locale = normalizeLanguage(lang);
    if (MESSAGE_CACHE[locale]) return MESSAGE_CACHE[locale]!;
    if (LOADING[locale]) return LOADING[locale]!;

    const promise = (async () => {
        const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to load locale messages: ${locale}`);
        const json = (await res.json()) as LocaleMessages;
        MESSAGE_CACHE[locale] = json;
        return json;
    })();

    LOADING[locale] = promise;
    try {
        return await promise;
    } finally {
        delete LOADING[locale];
    }
}

/** Get a translated message by key (supports runtime language switching). */
export function getMessage(key: string, substitutions?: string | string[]): string {
    const locale = currentLanguage;
    const messages = MESSAGE_CACHE[locale];
    const def = messages?.[key];

    if (def?.message) {
        return applySubstitutions(def.message, def.placeholders, substitutions);
    }

    // Fallback to Chrome i18n (browser locale), then key itself.
    const fallback = chrome.i18n?.getMessage?.(key, substitutions as any);
    return fallback || key;
}
