/**
 * Tags storage helpers (chrome.storage.local)
 * Shared by UI hooks and background service worker.
 */

import { TAGS_STORAGE_KEY, createEmptyTagsStore, type TagsStoreV1 } from '@/lib/tags';

function normalizeStore(raw: unknown): TagsStoreV1 {
    const store = raw as TagsStoreV1 | undefined;
    if (!store || typeof store !== 'object' || store.version !== 1) return createEmptyTagsStore();
    return { version: 1, tagsById: store.tagsById || {} };
}

export function readTagsStore(): Promise<TagsStoreV1> {
    return new Promise((resolve) => {
        chrome.storage.local.get([TAGS_STORAGE_KEY], (result) => {
            resolve(normalizeStore(result?.[TAGS_STORAGE_KEY]));
        });
    });
}

export function writeTagsStore(store: TagsStoreV1): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [TAGS_STORAGE_KEY]: store }, () => resolve());
    });
}

export async function updateTagsStore(updater: (prev: TagsStoreV1) => TagsStoreV1): Promise<TagsStoreV1> {
    const prev = await readTagsStore();
    const next = normalizeStore(updater(prev));
    await writeTagsStore(next);
    return next;
}

export async function removeTagsForIds(ids: string[]): Promise<TagsStoreV1> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return readTagsStore();

    return updateTagsStore((prev) => {
        const next: TagsStoreV1 = { version: 1, tagsById: { ...(prev.tagsById || {}) } };
        for (const id of uniqueIds) {
            delete next.tagsById[id];
        }
        return next;
    });
}

