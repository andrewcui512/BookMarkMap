import { useCallback, useMemo, useState } from 'react';
import { useI18n } from '@/hooks/useI18n';
import {
    getTagDisplayLabel,
    isSystemTag,
    resolveTagAlias,
    sortTagsForDisplay,
    uniqTags,
} from '@/lib/tags';
import './TagEditor.css';

export function TagEditor({
    value,
    suggestions = [],
    onChange,
    maxTags = 20,
    placeholder,
    localOnlyHint,
}: {
    value: string[];
    suggestions?: string[];
    onChange: (tags: string[]) => void;
    maxTags?: number;
    placeholder?: string;
    localOnlyHint?: string;
}) {
    const { t } = useI18n();
    const [input, setInput] = useState('');

    const tags = useMemo(() => sortTagsForDisplay(uniqTags(value || [])), [value]);
    const canAddMore = tags.length < maxTags;

    const hintText = localOnlyHint ?? t('tagsLocalOnlyHint');

    const normalizedSuggestions = useMemo(() => {
        const existing = new Set(tags);
        const resolved = suggestions
            .map((s) => resolveTagAlias(s))
            .filter(Boolean) as string[];
        return sortTagsForDisplay(
            uniqTags(resolved).filter((s) => !existing.has(s)).slice(0, 12)
        );
    }, [suggestions, tags]);

    const commitInputs = useCallback((raw: string) => {
        if (!canAddMore) return;
        const parts = String(raw || '')
            .split(/[,\n，]+/)
            .map((s) => s.trim())
            .filter(Boolean);

        if (parts.length === 0) return;

        const toAdd: string[] = [];
        for (const p of parts) {
            const resolved = resolveTagAlias(p);
            if (!resolved) continue;
            toAdd.push(resolved);
        }

        if (toAdd.length === 0) return;

        const next = uniqTags([...(tags || []), ...toAdd]).slice(0, maxTags);
        onChange(next);
        setInput('');
    }, [canAddMore, maxTags, onChange, tags]);

    const remove = useCallback((tag: string) => {
        onChange((tags || []).filter((t) => t !== tag));
    }, [onChange, tags]);

    return (
        <div className="tag-editor">
            <div className="tag-editor-row">
                <input
                    className="tag-editor-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={placeholder ?? t('addTagPlaceholder')}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            commitInputs(input);
                        }
                    }}
                    onPaste={(e) => {
                        const text = e.clipboardData.getData('text');
                        if (/[,\n，]/.test(text)) {
                            e.preventDefault();
                            commitInputs(text);
                        }
                    }}
                    disabled={!canAddMore}
                />
                <button
                    className="btn btn-sm"
                    onClick={() => commitInputs(input)}
                    disabled={!canAddMore || !input.trim()}
                    type="button"
                >
                    {t('add') || '添加'}
                </button>
            </div>

            {tags.length > 0 ? (
                <div className="tag-editor-chips">
                    {tags.map((tag) => (
                        <span key={tag} className={`tag-chip ${isSystemTag(tag) ? 'system' : ''}`}>
                            {getTagDisplayLabel(tag, t)}
                            <button
                                type="button"
                                className="tag-chip-remove"
                                aria-label={t('delete')}
                                onClick={() => remove(tag)}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            ) : (
                <div className="tag-editor-hint">{t('noTags') || '暂无标签'}</div>
            )}

            {normalizedSuggestions.length > 0 && canAddMore && (
                <div className="tag-suggestions">
                    {normalizedSuggestions.map((s) => (
                        <button
                            key={s}
                            type="button"
                            className="tag-suggestion"
                            onClick={() => commitInputs(s)}
                            title={t('add') || '添加'}
                        >
                            + {getTagDisplayLabel(s, t)}
                        </button>
                    ))}
                </div>
            )}

            {hintText ? <div className="tag-editor-hint">{hintText}</div> : null}
        </div>
    );
}

