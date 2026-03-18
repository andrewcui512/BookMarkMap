/**
 * React hook for bookmark tags stored in chrome.storage.local
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    TAGS_STORAGE_KEY,
    type TagsById,
    type TagsStoreV1,
    uniqTags,
} from '@/lib/tags';
import { readTagsStore, updateTagsStore } from '@/lib/tags-storage';

export function useTags() {
    const [tagsById, setTagsById] = useState<TagsById>({});
    const [ready, setReady] = useState(false);

    const loadOnceRef = useRef(false);

    const reload = useCallback(async () => {
        const store = await readTagsStore();
        setTagsById(store.tagsById || {});
        setReady(true);
    }, []);

    useEffect(() => {
        if (loadOnceRef.current) return;
        loadOnceRef.current = true;
        void reload();
    }, [reload]);

    // Keep in sync across extension pages.
    useEffect(() => {
        const handler: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
            if (areaName !== 'local') return;
            if (!changes?.[TAGS_STORAGE_KEY]) return;
            const next = changes[TAGS_STORAGE_KEY].newValue as TagsStoreV1 | undefined;
            if (!next || next.version !== 1) {
                setTagsById({});
                return;
            }
            setTagsById(next.tagsById || {});
        };
        chrome.storage.onChanged.addListener(handler);
        return () => chrome.storage.onChanged.removeListener(handler);
    }, []);

    const update = useCallback(async (updater: (prev: TagsStoreV1) => TagsStoreV1) => {
        const next = await updateTagsStore(updater);
        setTagsById(next.tagsById || {});
    }, []);

    const getTags = useCallback((id: string): string[] => {
        return tagsById?.[id] || [];
    }, [tagsById]);

    const setTags = useCallback(async (id: string, tags: string[]) => {
        const nextTags = uniqTags(tags);
        await update((prev) => {
            const next: TagsStoreV1 = {
                version: 1,
                tagsById: { ...(prev.tagsById || {}) },
            };
            if (nextTags.length === 0) {
                delete next.tagsById[id];
            } else {
                next.tagsById[id] = nextTags;
            }
            return next;
        });
    }, [update]);

    const addTag = useCallback(async (id: string, tag: string) => {
        await update((prev) => {
            const tags = uniqTags([...(prev.tagsById?.[id] || []), tag]);
            const next: TagsStoreV1 = { version: 1, tagsById: { ...(prev.tagsById || {}) } };
            if (tags.length === 0) delete next.tagsById[id];
            else next.tagsById[id] = tags;
            return next;
        });
    }, [update]);

    const removeTag = useCallback(async (id: string, tag: string) => {
        await update((prev) => {
            const prevTags = prev.tagsById?.[id] || [];
            const nextTags = uniqTags(prevTags.filter((t) => t !== tag));
            const next: TagsStoreV1 = { version: 1, tagsById: { ...(prev.tagsById || {}) } };
            if (nextTags.length === 0) delete next.tagsById[id];
            else next.tagsById[id] = nextTags;
            return next;
        });
    }, [update]);

    const batchAddTag = useCallback(async (ids: string[], tag: string) => {
        const uniqueIds = [...new Set(ids.filter(Boolean))];
        if (uniqueIds.length === 0) return;
        await update((prev) => {
            const next: TagsStoreV1 = { version: 1, tagsById: { ...(prev.tagsById || {}) } };
            for (const id of uniqueIds) {
                const merged = uniqTags([...(next.tagsById[id] || []), tag]);
                if (merged.length === 0) delete next.tagsById[id];
                else next.tagsById[id] = merged;
            }
            return next;
        });
    }, [update]);

    const batchRemoveTag = useCallback(async (ids: string[], tag: string) => {
        const uniqueIds = [...new Set(ids.filter(Boolean))];
        if (uniqueIds.length === 0) return;
        await update((prev) => {
            const next: TagsStoreV1 = { version: 1, tagsById: { ...(prev.tagsById || {}) } };
            for (const id of uniqueIds) {
                const prevTags = next.tagsById[id] || [];
                const filtered = uniqTags(prevTags.filter((t) => t !== tag));
                if (filtered.length === 0) delete next.tagsById[id];
                else next.tagsById[id] = filtered;
            }
            return next;
        });
    }, [update]);

    const allTags = useMemo(() => {
        const all: string[] = [];
        for (const tags of Object.values(tagsById || {})) {
            for (const t of tags || []) all.push(t);
        }
        return [...new Set(all)].sort((a, b) => a.localeCompare(b));
    }, [tagsById]);

    return {
        ready,
        tagsById,
        getTags,
        setTags,
        addTag,
        removeTag,
        batchAddTag,
        batchRemoveTag,
        allTags,
        reload,
    };
}
