/**
 * React hook for extension settings
 */

import { useState, useCallback, useEffect } from 'react';
import { getNormalizedSettings } from '@/lib/ai-config';
import type { Settings } from '@/types/bookmark';

export function useSettings() {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const s = await getNormalizedSettings();
            setSettings(s);
        } finally {
            setLoading(false);
        }
    }, []);

    const save = useCallback(async (newSettings: Settings) => {
        await new Promise<void>((resolve) => {
            chrome.storage.sync.set({ settings: newSettings }, () => resolve());
        });
        setSettings(newSettings);
    }, []);

    const update = useCallback(
        async (partial: Partial<Settings>) => {
            if (!settings) return;
            const merged = { ...settings, ...partial };
            await save(merged);
        },
        [settings, save]
    );

    useEffect(() => {
        load();
    }, [load]);

    return { settings, loading, load, save, update };
}
