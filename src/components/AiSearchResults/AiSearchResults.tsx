/**
 * Display AI search results with relevance scores and reasons
 */

import { useI18n } from '@/hooks/useI18n';
import type { SearchResult } from '@/types/bookmark';
import './AiSearchResults.css';

interface AiSearchResultsProps {
    results: SearchResult[];
    onOpen: (result: SearchResult) => void;
    onContextMenu?: (e: React.MouseEvent, result: SearchResult) => void;
    cached?: boolean;
}

export function AiSearchResults({ results, onOpen, onContextMenu, cached }: AiSearchResultsProps) {
    const { t } = useI18n();

    if (results.length === 0) {
        return (
            <div className="ai-search-empty">
                <div className="ai-search-empty-icon">🔍</div>
                <div className="ai-search-empty-text">{t('noAiResults') || 'AI 未找到匹配结果'}</div>
            </div>
        );
    }

    return (
        <div className="ai-search-results">
            {cached && (
                <div className="ai-search-cache-hint">
                    ⚡ {t('cachedResults') || '缓存结果'}
                </div>
            )}
            {results.map((result) => (
                <div
                    key={result.id}
                    className="ai-search-result-item"
                    onClick={() => onOpen(result)}
                    onContextMenu={(e) => onContextMenu?.(e, result)}
                >
                    <div className="ai-search-result-header">
                        <span className="ai-search-result-title">{result.title}</span>
                        <span className="ai-search-result-score">
                            {result.relevanceScore}%
                        </span>
                    </div>
                    <div className="ai-search-result-url">{result.url}</div>
                    {result.reason && (
                        <div className="ai-search-result-reason">
                            💡 {result.reason}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
