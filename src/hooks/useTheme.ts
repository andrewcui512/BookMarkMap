import { useEffect } from 'react';
import { applyThemeMode, normalizeThemeMode } from '@/lib/theme';

export function useTheme() {
    useEffect(() => {
        let cancelled = false;

        chrome.storage.sync.get(['settings'], (result) => {
            if (cancelled) return;
            applyThemeMode(normalizeThemeMode(result?.settings?.darkMode));
        });

        const handler: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
            if (areaName !== 'sync') return;
            if (!changes.settings) return;
            applyThemeMode(normalizeThemeMode(changes.settings.newValue?.darkMode));
        };

        chrome.storage.onChanged.addListener(handler);
        return () => {
            cancelled = true;
            chrome.storage.onChanged.removeListener(handler);
        };
    }, []);
}
