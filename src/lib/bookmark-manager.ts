/**
 * Bookmark manager — wraps chrome.bookmarks API
 * Migrated from scripts/bookmark-manager.js to TypeScript.
 */

import type { BookmarkNode } from '@/types/bookmark';
import { getMessage } from '@/lib/i18n';

type ChromeBookmarkTreeNode = chrome.bookmarks.BookmarkTreeNode;

/** Get the full bookmark tree */
export async function getAll(): Promise<ChromeBookmarkTreeNode[]> {
    return chrome.bookmarks.getTree();
}

/** Get children of a node */
export async function getChildren(id: string): Promise<ChromeBookmarkTreeNode[]> {
    return chrome.bookmarks.getChildren(id);
}

/** Get a single node by ID */
export async function getNode(id: string): Promise<ChromeBookmarkTreeNode> {
    const nodes = await chrome.bookmarks.get(id);
    return nodes[0];
}

/** Get a subtree by node ID (includes the node itself and all descendants). */
export async function getSubTree(id: string): Promise<ChromeBookmarkTreeNode> {
    const nodes = await chrome.bookmarks.getSubTree(id);
    return nodes[0];
}

/** Create a folder */
export async function createFolder(parentId: string, title: string): Promise<ChromeBookmarkTreeNode> {
    return chrome.bookmarks.create({ parentId, title });
}

/** Create a bookmark */
export async function createBookmark(
    parentId: string,
    title: string,
    url: string
): Promise<ChromeBookmarkTreeNode> {
    return chrome.bookmarks.create({ parentId, title, url });
}

/** Move a bookmark to a new parent (and optionally a specific index) */
export async function move(
    id: string,
    parentId: string,
    index?: number
): Promise<ChromeBookmarkTreeNode> {
    const destination: chrome.bookmarks.BookmarkDestinationArg = { parentId };
    if (index !== undefined) destination.index = index;
    return chrome.bookmarks.move(id, destination);
}

/** Rename a bookmark or folder */
export async function rename(id: string, title: string): Promise<ChromeBookmarkTreeNode> {
    return chrome.bookmarks.update(id, { title });
}

/** Update a bookmark's URL */
export async function updateUrl(id: string, url: string): Promise<ChromeBookmarkTreeNode> {
    return chrome.bookmarks.update(id, { url });
}

/** Remove a bookmark or empty folder; falls back to removeTree for non-empty folders */
export async function remove(id: string): Promise<void> {
    try {
        await chrome.bookmarks.remove(id);
    } catch {
        await chrome.bookmarks.removeTree(id);
    }
}

/** Remove a folder and all its children */
export async function removeTree(id: string): Promise<void> {
    await chrome.bookmarks.removeTree(id);
}

/** Search bookmarks via Chrome API */
export async function searchApi(query: string): Promise<ChromeBookmarkTreeNode[]> {
    return chrome.bookmarks.search(query);
}

/** Local in-memory search (preserves tree structure) */
export function search(bookmarks: BookmarkNode[], query: string): BookmarkNode[] {
    const lowerQuery = query.toLowerCase();

    function filterNode(node: BookmarkNode): BookmarkNode | null {
        const isFolder = !node.url;
        const titleMatch = node.title?.toLowerCase().includes(lowerQuery);
        const urlMatch = node.url?.toLowerCase().includes(lowerQuery);

        if (isFolder && node.children) {
            const filteredChildren = node.children
                .map((child) => filterNode(child))
                .filter(Boolean) as BookmarkNode[];

            if (filteredChildren.length > 0 || titleMatch) {
                return { ...node, children: filteredChildren };
            }
        } else if (titleMatch || urlMatch) {
            return { ...node };
        }

        return null;
    }

    return bookmarks.map((node) => filterNode(node)).filter(Boolean) as BookmarkNode[];
}

/** Flatten bookmark tree to a list of bookmarks (no folders) */
export function flatten(bookmarks: BookmarkNode[]): BookmarkNode[] {
    const result: BookmarkNode[] = [];

    function traverse(nodes: BookmarkNode[]) {
        nodes.forEach((node) => {
            if (node.url) result.push(node);
            if (node.children) traverse(node.children);
        });
    }

    traverse(bookmarks);
    return result;
}

/** Get or create the "已失效书签" (invalid bookmarks) folder */
export async function getOrCreateInvalidFolder(): Promise<ChromeBookmarkTreeNode> {
    const INVALID_FOLDER_NAME = getMessage('invalidFolder');

    const results = await searchApi(INVALID_FOLDER_NAME);
    const existing = results.find((r) => !r.url && r.title === INVALID_FOLDER_NAME);
    if (existing) return existing;

    // Create under "其他书签" (Other Bookmarks, ID "2")
    const tree = await getAll();
    const otherBookmarks = tree[0].children?.find((c) => c.id === '2') || tree[0].children?.[1];
    if (!otherBookmarks) throw new Error('Cannot find Other Bookmarks folder');

    return createFolder(otherBookmarks.id, INVALID_FOLDER_NAME);
}

/** Batch move bookmarks to the invalid folder */
export async function moveToInvalid(bookmarkIds: string[]): Promise<void> {
    const invalidFolder = await getOrCreateInvalidFolder();
    for (const id of bookmarkIds) {
        await move(id, invalidFolder.id);
    }
}

/** Get recent bookmarks (added within the last N days) */
export function getRecentBookmarks(bookmarks: BookmarkNode[], days: number = 7): BookmarkNode[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const flat = flatten(bookmarks);
    return flat.filter((b) => b.dateAdded && b.dateAdded > cutoff);
}
