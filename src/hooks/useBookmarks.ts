/**
 * React hook for bookmark operations
 */

import { useState, useCallback, useRef } from 'react';
import * as bm from '@/lib/bookmark-manager';
import type { BookmarkNode } from '@/types/bookmark';

type ChromeNode = chrome.bookmarks.BookmarkTreeNode;

export function useBookmarks() {
    const [bookmarks, setBookmarks] = useState<ChromeNode[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hasLoadedOnceRef = useRef(false);

    const load = useCallback(async (options?: { silent?: boolean }) => {
        const silent = options?.silent ?? false;
        const showLoading = !silent || !hasLoadedOnceRef.current;

        if (showLoading) setLoading(true);
        setError(null);
        try {
            const tree = await bm.getAll();
            setBookmarks(tree);
            hasLoadedOnceRef.current = true;
        } catch (err) {
            setError((err as Error).message);
        } finally {
            if (showLoading) setLoading(false);
        }
    }, []);

    const searchLocal = useCallback(
        (query: string, options?: { getTags?: (bookmarkId: string) => string[] }): BookmarkNode[] => {
            if (!query.trim()) return bookmarks as unknown as BookmarkNode[];
            return bm.search(bookmarks as unknown as BookmarkNode[], query, options);
        },
        [bookmarks]
    );

    const renameBookmark = useCallback(
        async (id: string, title: string) => {
            await bm.rename(id, title);
            await load({ silent: true });
        },
        [load]
    );

    const removeBookmark = useCallback(
        async (id: string) => {
            await bm.remove(id);
            await load({ silent: true });
        },
        [load]
    );

    const moveBookmark = useCallback(
        async (id: string, parentId: string, index?: number) => {
            await bm.move(id, parentId, index);
            await load({ silent: true });
        },
        [load]
    );

    const createNewFolder = useCallback(
        async (parentId: string, title: string) => {
            const node = await bm.createFolder(parentId, title);
            await load({ silent: true });
            return node;
        },
        [load]
    );

    return {
        bookmarks,
        loading,
        error,
        load,
        searchLocal,
        renameBookmark,
        removeBookmark,
        moveBookmark,
        createNewFolder,
        flatten: bm.flatten,
        getRecentBookmarks: bm.getRecentBookmarks,
        moveToInvalid: bm.moveToInvalid,
    };
}
