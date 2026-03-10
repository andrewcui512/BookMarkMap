/**
 * Hook for AI-powered bookmark search with caching and fallback
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { BookmarkNode, AiSearchResponse, SearchResult } from '@/types/bookmark';

interface UseAiSearchOptions {
    enabled: boolean;  // AI search enabled/disabled
    debounceMs?: number;
    maxResults?: number;
    onError?: (error: Error) => void;
}

interface UseAiSearchReturn {
    // State
    aiSearchEnabled: boolean;
    setAiSearchEnabled: (enabled: boolean) => void;
    searching: boolean;
    results: SearchResult[];
    error: string | null;
    cached: boolean;

    // Actions
    search: (query: string, bookmarks: BookmarkNode[]) => Promise<void>;
    clear: () => void;
}

export function useAiSearch(options: UseAiSearchOptions): UseAiSearchReturn {
    const { enabled: initialEnabled = false, debounceMs = 800, maxResults = 20, onError } = options;

    const [aiSearchEnabled, setAiSearchEnabled] = useState(() => {
        // Persist preference in localStorage
        const stored = localStorage.getItem('aiSearchEnabled');
        return stored !== null ? stored === 'true' : initialEnabled;
    });

    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [cached, setCached] = useState(false);

    const debounceTimerRef = useRef<number | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Persist preference
    useEffect(() => {
        localStorage.setItem('aiSearchEnabled', String(aiSearchEnabled));
    }, [aiSearchEnabled]);

    const search = useCallback(async (query: string, bookmarks: BookmarkNode[]) => {
        // Clear previous timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Abort previous request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const trimmedQuery = query.trim();

        if (!trimmedQuery) {
            setResults([]);
            setError(null);
            setCached(false);
            return;
        }

        if (!aiSearchEnabled) {
            return; // Traditional search handles this
        }

        // Debounce
        debounceTimerRef.current = window.setTimeout(async () => {
            setSearching(true);
            setError(null);

            const controller = new AbortController();
            abortControllerRef.current = controller;

            try {
                // Flatten bookmarks
                const flatBookmarks = flattenBookmarks(bookmarks);

                if (flatBookmarks.length === 0) {
                    setResults([]);
                    setSearching(false);
                    return;
                }

                // Call background worker
                const response = await chrome.runtime.sendMessage({
                    type: 'AI_SEARCH_BOOKMARKS',
                    query: trimmedQuery,
                    bookmarks: flatBookmarks.map(b => ({
                        id: b.id,
                        title: b.title,
                        url: b.url || '',
                        dateAdded: b.dateAdded,
                    })),
                    maxResults,
                }) as AiSearchResponse;

                if (controller.signal.aborted) {
                    return;
                }

                if ((response as any).error) {
                    throw new Error((response as any).error);
                }

                setResults(response.results || []);
                setCached(response.cached || false);
                setError(null);
            } catch (err) {
                if (controller.signal.aborted) {
                    return;
                }

                const errorMessage = (err as Error).message;
                setError(errorMessage);
                setResults([]);

                if (onError) {
                    onError(err as Error);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setSearching(false);
                }
            }
        }, debounceMs);
    }, [aiSearchEnabled, debounceMs, maxResults, onError]);

    const clear = useCallback(() => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setResults([]);
        setError(null);
        setSearching(false);
        setCached(false);
    }, []);

    return {
        aiSearchEnabled,
        setAiSearchEnabled,
        searching,
        results,
        error,
        cached,
        search,
        clear,
    };
}

function flattenBookmarks(bookmarks: BookmarkNode[]): BookmarkNode[] {
    const result: BookmarkNode[] = [];

    function traverse(nodes: BookmarkNode[]) {
        nodes.forEach(node => {
            if (node.url) {
                result.push(node);
            }
            if (node.children) {
                traverse(node.children);
            }
        });
    }

    traverse(bookmarks);
    return result;
}
