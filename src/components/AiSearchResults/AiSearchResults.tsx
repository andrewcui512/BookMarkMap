/**
 * Display AI search results with relevance scores and reasons
 */

import { useI18n } from '@/hooks/useI18n';
import type { SearchResult } from '@/types/bookmark';
import { getTagDisplayLabel, isSystemTag, sortTagsForDisplay } from '@/lib/tags';
import './AiSearchResults.css';

interface AiSearchResultsProps {
    results: SearchResult[];
    onOpen: (result: SearchResult) => void;
    onContextMenu?: (e: React.MouseEvent, result: SearchResult) => void;
    cached?: boolean;
    getTags?: (bookmarkId: string) => string[];
}

export function AiSearchResults({ results, onOpen, onContextMenu, cached, getTags }: AiSearchResultsProps) {
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
                    {getTags ? (
                        (() => {
                            const tags = sortTagsForDisplay(getTags(result.id) || []);
                            if (!tags.length) return null;
                            const display = tags.map((x) => getTagDisplayLabel(x, t));
                            const shown = tags.slice(0, 3);
                            const more = Math.max(0, tags.length - shown.length);
                            return (
                                <div className="ai-search-result-tags" title={display.join(', ')}>
                                    {shown.map((tag) => (
                                        <span key={tag} className={`ai-tag-chip ${isSystemTag(tag) ? 'system' : ''}`}>
                                            {getTagDisplayLabel(tag, t)}
                                        </span>
                                    ))}
                                    {more > 0 ? (
                                        <span className="ai-tag-more">+{more}</span>
                                    ) : null}
                                </div>
                            );
                        })()
                    ) : null}
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
