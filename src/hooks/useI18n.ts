/**
 * React hook for internationalization
 */

import { useCallback } from 'react';
import { getMessage } from '@/lib/i18n';

export function useI18n() {
    const t = useCallback((key: string, substitutions?: string | string[]): string => {
        return getMessage(key, substitutions);
    }, []);

    return { t };
}
