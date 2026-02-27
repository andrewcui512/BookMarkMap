/**
 * React hook for internationalization
 */

import { useCallback, useEffect, useState } from 'react';
import { getMessage, loadLocaleMessages, setCurrentLanguage } from '@/lib/i18n';

function normalizeLanguage(lang: string | null | undefined): 'zh_CN' | 'en' {
    return lang === 'en' ? 'en' : 'zh_CN';
}

export function useI18n() {
    const [language, setLanguage] = useState<'zh_CN' | 'en'>('zh_CN');
    const [ready, setReady] = useState(false);

    // Load current language from settings
    useEffect(() => {
        chrome.storage.sync.get(['settings'], (result) => {
            const lang = normalizeLanguage(result?.settings?.language);
            setLanguage(lang);
        });
    }, []);

    // Listen for changes (settings.language)
    useEffect(() => {
        const handler: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
            if (areaName !== 'sync') return;
            const next = changes?.settings?.newValue?.language;
            if (typeof next === 'string') {
                setLanguage(normalizeLanguage(next));
            }
        };
        chrome.storage.onChanged.addListener(handler);
        return () => chrome.storage.onChanged.removeListener(handler);
    }, []);

    // Load locale messages and set global language
    useEffect(() => {
        let cancelled = false;
        setReady(false);
        setCurrentLanguage(language);
        loadLocaleMessages(language)
            .catch(() => { /* ignore */ })
            .finally(() => {
                if (!cancelled) setReady(true);
            });
        return () => { cancelled = true; };
    }, [language]);

    const t = useCallback((key: string, substitutions?: string | string[]): string => {
        // ready is intentionally referenced so components re-render after messages load.
        void ready;
        return getMessage(key, substitutions);
    }, [ready]);

    return { t, language, ready };
}
