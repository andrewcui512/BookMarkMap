/**
 * Toggle between traditional and AI search modes
 */

import { useI18n } from '@/hooks/useI18n';
import './SearchModeToggle.css';

interface SearchModeToggleProps {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    disabled?: boolean;
    searching?: boolean;
}

export function SearchModeToggle({ enabled, onChange, disabled, searching }: SearchModeToggleProps) {
    const { t } = useI18n();

    return (
        <div className="search-mode-toggle">
            <button
                className={`search-mode-btn ${!enabled ? 'active' : ''}`}
                onClick={() => onChange(false)}
                disabled={disabled || searching}
                title={t('traditionalSearch') || '传统搜索'}
            >
                🔍 {t('traditional') || '传统'}
            </button>
            <button
                className={`search-mode-btn ${enabled ? 'active' : ''}`}
                onClick={() => onChange(true)}
                disabled={disabled || searching}
                title={t('aiSearch') || 'AI 智能搜索'}
            >
                🤖 AI
            </button>
            {searching && <span className="search-mode-loading">⏳</span>}
        </div>
    );
}
