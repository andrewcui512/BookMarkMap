/**
 * Main Page App — full-page bookmark manager
 * Features: tree view with one-click expand/collapse all, search, context menu
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { TreeView, useExpandedState } from '@/components/TreeView';
import { ContextMenu, useContextMenu } from '@/components/ContextMenu';
import { ToastContainer, useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { TagEditor } from '@/components/Tags';
import { useBookmarks } from '@/hooks/useBookmarks';
import { useI18n } from '@/hooks/useI18n';
import { useTags } from '@/hooks/useTags';
import { useTheme } from '@/hooks/useTheme';
import { checkLinks } from '@/lib/link-checker';
import { ensureOriginsPermission, WEB_ACCESS_ORIGINS, urlToOriginPattern } from '@/lib/permissions';
import * as bm from '@/lib/bookmark-manager';
import { SYSTEM_TAG_INVALID, getTagDisplayLabel, parseSearchQuery, sortTagsForDisplay } from '@/lib/tags';
import { getAiConfigByIdOrActive, assertAiConfigReady } from '@/lib/ai-config';
import { callBackground, dedupeUrls } from '@/lib/utils';
import type { ContextMenuTarget } from '@/components/ContextMenu';
import type {
    AutoTagApplyResult,
    BatchCleanupReport,
    BookmarkNode,
    LinkCheckResult,
    OpenUrlsInWindowResponse,
} from '@/types/bookmark';
import './main.css';

type ViewType = 'all' | 'recent';
const PROTECTED_NODE_IDS = new Set(['0', '1', '2', '3']);
type SearchMode = 'local' | 'ai';

function isReadOnlyNodeId(id: string): boolean {
    return PROTECTED_NODE_IDS.has(id) || id === 'recent-root' || id === 'ai-search-root';
}

export default function App() {
    const { t } = useI18n();
    useTheme();
    const { bookmarks, loading, load, searchLocal, flatten, getRecentBookmarks, moveToInvalid } = useBookmarks();
    const { ready: tagsReady, getTags, setTags, batchAddTag, allTags } = useTags();
    const { toasts, show: showToast } = useToast();
    const { expanded, toggle: onToggle } = useExpandedState('expandedNodesMain');
    const [view, setView] = useState<ViewType>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMode, setSearchMode] = useState<SearchMode>('local');
    const [displayNodes, setDisplayNodes] = useState<any[]>([]);
    const parsedSearch = useMemo(() => parseSearchQuery(searchQuery), [searchQuery]);
    const [aiSearching, setAiSearching] = useState(false);
    const [aiMeta, setAiMeta] = useState<{ totalMatches: number; cached: boolean } | null>(null);
    const aiRequestSeqRef = useRef(0);
    const [debouncedQuery, setDebouncedQuery] = useState('');

    // Modals
    const [newFolderOpen, setNewFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [newFolderParent, setNewFolderParent] = useState('1');
    const [moveOpen, setMoveOpen] = useState(false);
    const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
    const [moveTargetFolder, setMoveTargetFolder] = useState('1');
    const [linkCheckOpen, setLinkCheckOpen] = useState(false);
    const [linkCheckResults, setLinkCheckResults] = useState<LinkCheckResult[]>([]);
    const [linkChecking, setLinkChecking] = useState(false);
    const [linkCheckProgress, setLinkCheckProgress] = useState({ checked: 0, total: 0 });
    const [tagEditOpen, setTagEditOpen] = useState(false);
    const [tagEditTarget, setTagEditTarget] = useState<ContextMenuTarget | null>(null);
    const [organizeOpen, setOrganizeOpen] = useState(false);
    const [cleanupReport, setCleanupReport] = useState<BatchCleanupReport | null>(null);
    const [cleanupLoading, setCleanupLoading] = useState(false);
    const [autoTagRunning, setAutoTagRunning] = useState(false);
    const [autoTagResult, setAutoTagResult] = useState<AutoTagApplyResult | null>(null);
    const [undoRunning, setUndoRunning] = useState(false);

    useEffect(() => { load(); }, [load]);

    // Collect all folder IDs for expand/collapse all
    const allFolderIds = useMemo(() => {
        const ids: string[] = [];
        function traverse(nodes: any[]) {
            nodes.forEach(n => {
                if (!n.url && n.children) {
                    ids.push(n.id);
                    traverse(n.children);
                }
            });
        }
        traverse(bookmarks as any[]);
        return ids;
    }, [bookmarks]);

    // One-click expand all
    const expandAll = useCallback(() => {
        allFolderIds.forEach(id => {
            if (!expanded.has(id)) onToggle(id, true);
        });
    }, [allFolderIds, expanded, onToggle]);

    // One-click collapse all
    const collapseAll = useCallback(() => {
        allFolderIds.forEach(id => {
            if (expanded.has(id)) onToggle(id, false);
        });
    }, [allFolderIds, expanded, onToggle]);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(searchQuery), 450);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Update display based on view and search (local mode)
    useEffect(() => {
        if (searchMode !== 'local') return;
        let nodes: any[] = bookmarks;
        if (searchQuery.trim()) {
            nodes = searchLocal(searchQuery, { getTags });
            setAiMeta(null);
        } else if (view === 'recent') {
            const recent = getRecentBookmarks(bookmarks as unknown as BookmarkNode[], 7);
            nodes = [{ id: 'recent-root', title: t('recentDays', '7'), children: recent }];
            setAiMeta(null);
        }
        setDisplayNodes(nodes);
    }, [bookmarks, searchQuery, view, searchLocal, getRecentBookmarks, t, getTags, searchMode]);

    // Update display based on view and search (AI mode)
    useEffect(() => {
        if (searchMode !== 'ai') return;

        const q = debouncedQuery.trim();
        if (!q) {
            let nodes: any[] = bookmarks;
            if (view === 'recent') {
                const recent = getRecentBookmarks(bookmarks as unknown as BookmarkNode[], 7);
                nodes = [{ id: 'recent-root', title: t('recentDays', '7'), children: recent }];
            }
            setDisplayNodes(nodes);
            setAiMeta(null);
            setAiSearching(false);
            return;
        }

        const seq = ++aiRequestSeqRef.current;
        setAiSearching(true);
        setAiMeta(null);

        void (async () => {
            try {
                const config = await getAiConfigByIdOrActive(null);
                assertAiConfigReady(config);

                const origin = urlToOriginPattern(config.apiEndpoint);
                if (!origin) throw new Error(t('apiEndpointInvalid') || 'API endpoint invalid');
                const granted = await ensureOriginsPermission([origin]);
                if (!granted) throw new Error(t('apiPermissionRequired') || 'Permission required');

                const parsed = parseSearchQuery(debouncedQuery);
                if (!parsed.textQuery.trim() && parsed.tagFilters.length > 0) {
                    // tags-only query: deterministic local results
                    setDisplayNodes(searchLocal(debouncedQuery, { getTags }));
                    setAiMeta(null);
                    return;
                }

                const result = await callBackground<any>({
                    type: 'AI_SEARCH_BOOKMARKS',
                    query: parsed.textQuery.trim() || q,
                    maxResults: 50,
                    scope: view === 'recent' ? 'recent' : 'all',
                    recentDays: 7,
                    tagFilters: parsed.tagFilters,
                });
                if (seq !== aiRequestSeqRef.current) return;
                if (result?.error) throw new Error(String(result.error));

                const results = Array.isArray(result?.results) ? result.results : [];
                setAiMeta({
                    totalMatches: Number(result?.totalMatches ?? results.length),
                    cached: Boolean(result?.cached),
                });

                const nodes = results.map((r: any) => ({
                    id: String(r.id),
                    title: String(r.title || ''),
                    url: String(r.url || ''),
                    aiScore: Number(r.relevanceScore || 0),
                    aiReason: typeof r.reason === 'string' ? r.reason : '',
                }));

                setDisplayNodes(nodes);
            } catch (err) {
                if (seq !== aiRequestSeqRef.current) return;
                setDisplayNodes([]);
                setAiMeta(null);
                showToast((err as Error).message || 'AI search failed', 'error');
            } finally {
                if (seq === aiRequestSeqRef.current) setAiSearching(false);
            }
        })();
    }, [bookmarks, debouncedQuery, ensureOriginsPermission, getRecentBookmarks, getTags, searchLocal, searchMode, showToast, t, view]);

    // Context menu
    const handleContextAction = useCallback(async (action: string, target: ContextMenuTarget) => {
        const isReadonly = isReadOnlyNodeId(target.id);
        if (isReadonly && (action === 'rename' || action === 'move' || action === 'delete')) {
            showToast(t('systemFolderReadonly') || '系统文件夹不可修改', 'warning');
            return;
        }

        switch (action) {
            case 'open':
                if (target.url) chrome.tabs.create({ url: target.url });
                break;
            case 'copy':
                if (target.url) {
                    await navigator.clipboard.writeText(target.url);
                    showToast(t('copied'), 'success');
                }
                break;
            case 'rename': {
                const newTitle = prompt(t('rename'), target.title);
                if (newTitle && newTitle !== target.title) {
                    await bm.rename(target.id, newTitle);
                    load({ silent: true });
                }
                break;
            }
            case 'tags':
                if (!tagsReady) {
                    showToast(t('loading') || '加载中', 'info');
                    return;
                }
                setTagEditTarget(target);
                setTagEditOpen(true);
                break;
            case 'move':
                setMoveTargetId(target.id);
                setMoveOpen(true);
                break;
            case 'delete': {
                const msg = target.isFolder ? t('confirmDeleteFolder') : t('confirmDelete');
                if (confirm(msg)) {
                    await bm.remove(target.id);
                    load({ silent: true });
                }
                break;
            }
        }
    }, [load, showToast, t, tagsReady]);

    const contextMenu = useContextMenu(handleContextAction);
    const menuItems = (target: ContextMenuTarget) => [
        { action: 'open', label: t('open'), icon: '🔗', hidden: target.isFolder },
        { action: 'copy', label: t('copyLink'), icon: '📋', hidden: target.isFolder },
        { action: 'rename', label: t('rename'), icon: '✏️', hidden: isReadOnlyNodeId(target.id) },
        { action: 'tags', label: t('tags'), icon: '🏷️', hidden: target.id === 'recent-root' },
        { action: 'move', label: t('moveTo'), icon: '📂', hidden: isReadOnlyNodeId(target.id) },
        { action: 'delete', label: t('delete'), icon: '🗑️', danger: true, hidden: isReadOnlyNodeId(target.id) },
    ];

    // Folders for select
    const folderOptions = collectFolders(bookmarks as unknown as BookmarkNode[], t);

    // New folder
    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        await bm.createFolder(newFolderParent, newFolderName.trim());
        setNewFolderOpen(false);
        setNewFolderName('');
        load({ silent: true });
        showToast(t('folderCreated'), 'success');
    };

    // Move
    const handleMove = async () => {
        if (!moveTargetId) return;
        if (isReadOnlyNodeId(moveTargetId)) {
            showToast(t('systemFolderReadonly') || '系统文件夹不可修改', 'warning');
            setMoveOpen(false);
            setMoveTargetId(null);
            return;
        }
        await bm.move(moveTargetId, moveTargetFolder);
        setMoveOpen(false);
        setMoveTargetId(null);
        load({ silent: true });
        showToast(t('moved'), 'success');
    };

    // Link check
    const handleLinkCheck = async () => {
        const granted = await ensureOriginsPermission([...WEB_ACCESS_ORIGINS]);
        if (!granted) {
            showToast(t('webAccessRequired'), 'warning');
            return;
        }

        setLinkCheckOpen(true);
        setLinkChecking(true);
        setLinkCheckResults([]);
        const allBookmarks = flatten(bookmarks as unknown as BookmarkNode[]);
        setLinkCheckProgress({ checked: 0, total: allBookmarks.length });

        if (allBookmarks.length === 0) {
            setLinkChecking(false);
            showToast(t('noBookmarks'), 'info');
            return;
        }

        try {
            const results = await checkLinks(
                allBookmarks.map((b: any) => ({ id: b.id, url: b.url, title: b.title })),
                (checked, total) => setLinkCheckProgress({ checked, total })
            );
            setLinkCheckResults(results || []);
        } catch (err) {
            showToast((err as Error).message, 'error');
        } finally {
            setLinkChecking(false);
        }
    };

    const invalidResults = linkCheckResults.filter(
        r => r.status === 'invalid' || r.status === 'timeout' || r.status === 'client_error' || r.status === 'server_error'
    );

    const searchResultUrls = useMemo(() => {
        if (!searchQuery.trim()) return [];

        return dedupeUrls(
            flatten(displayNodes as unknown as BookmarkNode[])
                .filter((node) => Boolean(node.url))
                .map((node) => node.url || '')
        );
    }, [displayNodes, flatten, searchQuery]);

    const handleOpenSearchResults = useCallback(async () => {
        if (!searchQuery.trim()) return;

        if (searchResultUrls.length === 0) {
            showToast(t('noSearchResultsToOpen'), 'info');
            return;
        }

        try {
            const result = await callBackground<OpenUrlsInWindowResponse>({
                type: 'OPEN_URLS_IN_WINDOW',
                urls: searchResultUrls,
            }) as OpenUrlsInWindowResponse & { error?: string };
            if (result?.error) throw new Error(result.error);
            const openedCount = Number(result?.openedCount || 0);

            if (openedCount > 0) {
                showToast(t('openedSearchResultsInWindow', String(openedCount)), 'success');
                return;
            }
        } catch (err) {
            showToast((err as Error).message, 'error');
            return;
        }

        showToast(t('noSearchResultsToOpen'), 'warning');
    }, [searchQuery, searchResultUrls, showToast, t]);

    const handleOpenOrganizer = useCallback(async () => {
        setOrganizeOpen(true);
        setCleanupLoading(true);
        setAutoTagResult(null);
        try {
            const report = await callBackground<BatchCleanupReport & { error?: string }>({
                type: 'ANALYZE_BATCH_CLEANUP',
            });
            if ((report as any)?.error) throw new Error((report as any).error);
            setCleanupReport(report);
        } catch (err) {
            showToast((err as Error).message, 'error');
        } finally {
            setCleanupLoading(false);
        }
    }, [showToast]);

    const handleRemoveDuplicates = useCallback(async () => {
        if (!cleanupReport || cleanupReport.duplicateCandidates.length === 0) {
            showToast(t('organizerNothingToClean'), 'info');
            return;
        }

        const duplicateIds = cleanupReport.duplicateCandidates.flatMap((item) => item.ids.slice(1));
        if (duplicateIds.length === 0) {
            showToast(t('organizerNothingToDelete'), 'info');
            return;
        }

        const removed = await bm.removeMany(duplicateIds, t('organizerCleanupNote'));
        await load({ silent: true });
        showToast(t('organizerDeletedCount', [String(removed)]), 'success');
        await handleOpenOrganizer();
    }, [cleanupReport, handleOpenOrganizer, load, showToast, t]);

    const handleApplyAutoTags = useCallback(async () => {
        setAutoTagRunning(true);
        try {
            const result = await callBackground<AutoTagApplyResult & { error?: string }>({
                type: 'APPLY_AUTO_TAG_RULES',
            });
            if ((result as any)?.error) throw new Error((result as any).error);
            setAutoTagResult(result);
            showToast(t('organizerTagsUpdatedCount', [String(result.updatedBookmarks)]), 'success');
        } catch (err) {
            showToast((err as Error).message, 'error');
        } finally {
            setAutoTagRunning(false);
        }
    }, [showToast, t]);

    const handleUndoLastOperation = useCallback(async () => {
        setUndoRunning(true);
        try {
            const result = await callBackground<{ restored: number; label: string | null; error?: string }>({
                type: 'UNDO_LAST_OPERATION',
            });
            if (result?.error) throw new Error(result.error);
            if (!result.restored) {
                showToast(t('undoNothing'), 'info');
                return;
            }
            await load({ silent: true });
            showToast(t('undoDone', [String(result.restored), result.label || t('recentOperation')]), 'success');
            if (organizeOpen) await handleOpenOrganizer();
        } catch (err) {
            showToast((err as Error).message, 'error');
        } finally {
            setUndoRunning(false);
        }
    }, [handleOpenOrganizer, load, organizeOpen, showToast, t]);

    const bookmarkCount = flatten(bookmarks as unknown as BookmarkNode[]).length;
    const folderCount = allFolderIds.length;
    const linkCheckPercent = linkCheckProgress.total > 0 ? Math.round((linkCheckProgress.checked / linkCheckProgress.total) * 100) : 0;

    const viewTitle =
        view === 'all' ? t('allBookmarks') :
            t('recent');

    return (
        <div className="main-container">
            {/* Sidebar */}
            <aside className="main-sidebar">
                <div className="sidebar-brand">📚 BookMarkMap</div>
                <nav className="sidebar-nav">
                    {(['all', 'recent'] as ViewType[]).map(v => (
                        <button key={v} className={`sidebar-item ${view === v ? 'active' : ''}`}
                            onClick={() => { setView(v); setSearchQuery(''); }}>
                            {v === 'all' ? '📋' : '🕐'} {v === 'all' ? t('allBookmarks') : t('recent')}
                        </button>
                    ))}
                </nav>
                <div className="sidebar-divider" />
                <nav className="sidebar-nav">
                    <button className="sidebar-item" onClick={handleLinkCheck}>
                        🔍 {t('checkLinks')}
                    </button>
                    <button className="sidebar-item" onClick={handleOpenOrganizer}>
                        {t('organizerTitle')}
                    </button>
                    <button className="sidebar-item" onClick={() => setNewFolderOpen(true)}>
                        ➕ {t('newFolder')}
                    </button>
                    <button className="sidebar-item" onClick={handleUndoLastOperation} disabled={undoRunning}>
                        {undoRunning ? t('undoRunning') : t('undoLastOperation')}
                    </button>
                </nav>
                <div className="sidebar-divider" />
                <nav className="sidebar-nav">
                    <button className="sidebar-item" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('mindmap.html') })}>
                        🗺️ {t('openBookMarkMap')}
                    </button>
                    <button className="sidebar-item" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') })}>
                        ⚙️ {t('settings')}
                    </button>
                </nav>
                <div className="sidebar-stats">
                    <span>📁 {t('folderCount', String(folderCount))}</span>
                    <span>🔖 {t('bookmarkCount', String(bookmarkCount))}</span>
                </div>
            </aside>

            {/* Main area */}
            <main className="main-area">
                <header className="main-header">
                    <h2 className="main-view-title">{viewTitle}</h2>

                    {/* Tree controls */}
                    <div className="tree-controls">
                        <button className="tree-toggle-btn" onClick={expandAll} title={t('expandAllNodes')}>
                            <span className="tree-toggle-icon">📂</span> {t('expandAll')}
                        </button>
                        <button className="tree-toggle-btn" onClick={collapseAll} title={t('collapseAllNodes')}>
                            <span className="tree-toggle-icon">📁</span> {t('collapseAll')}
                        </button>
                    </div>

                    <div className="main-search">
                        <input
                            type="text"
                            placeholder={searchMode === 'ai' ? t('searchPlaceholderAi') : t('searchPlaceholder')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <div className="search-controls">
                            <button
                                className={`tree-toggle-btn ${searchMode === 'local' ? 'expanded' : ''}`}
                                onClick={() => setSearchMode('local')}
                                title={t('searchModeLocalTitle')}
                                type="button"
                            >
                                {t('searchModeLocal')}
                            </button>
                            <button
                                className={`tree-toggle-btn ${searchMode === 'ai' ? 'expanded' : ''}`}
                                onClick={() => setSearchMode('ai')}
                                title={t('searchModeAi')}
                                type="button"
                            >
                                {aiSearching ? '⏳ AI' : '🤖 AI'}
                            </button>
                        </div>
                        {searchMode === 'ai' && debouncedQuery.trim() && !aiSearching && aiMeta ? (
                            <span className="search-meta" title={aiMeta.cached ? 'cached' : undefined}>
                                {aiMeta.totalMatches} {t('results') || 'results'}{aiMeta.cached ? ' · cached' : ''}
                            </span>
                        ) : null}
                    </div>
                </header>

                <div className="main-content">
                    {searchQuery.trim() && (
                        <div className="main-search-actions">
                            <button
                                className="tree-toggle-btn main-open-all-btn"
                                onClick={handleOpenSearchResults}
                                disabled={searchResultUrls.length === 0 || aiSearching}
                                type="button"
                            >
                                🪟 {t('openAllSearchResultsInWindow', String(searchResultUrls.length))}
                            </button>
                        </div>
                    )}
                    {loading || aiSearching ? (
                        <div className="state-container">
                            <div className="spinner" />
                            <div className="state-text">{loading ? t('loading') : t('searchingAi')}</div>
                        </div>
                    ) : displayNodes.length === 0 ? (
                        <div className="state-container"><div className="state-icon">📭</div><div className="state-text">{searchQuery ? t('noResults') : t('noBookmarks')}</div></div>
                    ) : (
                        <TreeView
                            nodes={displayNodes as any}
                            searchQuery={parsedSearch.textQuery}
                            expandedNodes={expanded}
                            onToggle={onToggle}
                            onContextMenu={(e, node) => {
                                const target: ContextMenuTarget = { id: node.id, title: node.title, url: node.url, isFolder: !node.url };
                                contextMenu.show(e, target, menuItems(target));
                            }}
                            onClick={(node) => { if (node.url) chrome.tabs.create({ url: node.url }); }}
                            getNodeClass={(node) => {
                                const tags = getTags(node.id);
                                return tags.includes(SYSTEM_TAG_INVALID) ? 'invalid' : undefined;
                            }}
                            renderRight={(node) => {
                                if (searchMode === 'ai' && node.url && typeof (node as any).aiScore === 'number') {
                                    const score = Math.round((node as any).aiScore);
                                    const reason = String((node as any).aiReason || '').trim();
                                    return (
                                        <span className="badge badge-info" title={reason || undefined}>
                                            🤖 {score}
                                        </span>
                                    );
                                }
                                const tags = getTags(node.id);
                                if (!tags || tags.length === 0) return null;
                                const hasInvalid = tags.includes(SYSTEM_TAG_INVALID);
                                const title = sortTagsForDisplay(tags).map((t0) => getTagDisplayLabel(t0, t)).join(', ');
                                return (
                                    <span className={`badge ${hasInvalid ? 'badge-warning' : 'badge-info'}`} title={title}>
                                        {hasInvalid ? `⚠️ ${t('tagInvalid')}` : `🏷️ ${tags.length}`}
                                    </span>
                                );
                            }}
                        />
                    )}
                </div>
            </main>

            {/* Modals */}
            <Modal open={newFolderOpen} onClose={() => setNewFolderOpen(false)} title={t('newFolder')}
                footer={<><button className="btn" onClick={() => setNewFolderOpen(false)}>{t('cancel')}</button><button className="btn btn-primary" onClick={handleCreateFolder}>{t('create')}</button></>}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <input type="text" placeholder={t('folderName')} value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} autoFocus />
                    <select value={newFolderParent} onChange={(e) => setNewFolderParent(e.target.value)}>
                        {folderOptions.map(f => <option key={f.id} value={f.id}>{'　'.repeat(f.depth)}{f.title}</option>)}
                    </select>
                </div>
            </Modal>

            <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title={t('moveTo')}
                footer={<><button className="btn" onClick={() => setMoveOpen(false)}>{t('cancel')}</button><button className="btn btn-primary" onClick={handleMove}>{t('move')}</button></>}>
                <select value={moveTargetFolder} onChange={(e) => setMoveTargetFolder(e.target.value)} style={{ width: '100%' }}>
                    {folderOptions.map(f => <option key={f.id} value={f.id}>{'　'.repeat(f.depth)}{f.title}</option>)}
                </select>
            </Modal>

            <Modal
                open={tagEditOpen}
                onClose={() => { setTagEditOpen(false); setTagEditTarget(null); }}
                title={`🏷️ ${t('editTags')}`}
                width="520px"
                footer={<button className="btn btn-primary" onClick={() => { setTagEditOpen(false); setTagEditTarget(null); }}>{t('close')}</button>}
            >
                <TagEditor
                    value={tagEditTarget ? getTags(tagEditTarget.id) : []}
                    suggestions={allTags}
                    onChange={(next) => {
                        if (!tagEditTarget) return;
                        void setTags(tagEditTarget.id, next);
                    }}
                />
            </Modal>

            <Modal
                open={organizeOpen}
                onClose={() => setOrganizeOpen(false)}
                title={t('organizerTitle')}
                width="820px"
                footer={
                    <>
                        <button className="btn" onClick={() => setOrganizeOpen(false)}>{t('close')}</button>
                        <button className="btn" onClick={handleApplyAutoTags} disabled={autoTagRunning}>
                            {autoTagRunning ? t('organizerRunning') : t('organizerApplyAutoTags')}
                        </button>
                        <button className="btn btn-primary" onClick={handleRemoveDuplicates} disabled={!cleanupReport || cleanupReport.duplicateCandidates.length === 0}>
                            {t('organizerRemoveDuplicates')}
                        </button>
                    </>
                }
            >
                {cleanupLoading ? (
                    <div className="state-container">
                        <div className="spinner" />
                        <div className="state-text">{t('organizerAnalyzing')}</div>
                    </div>
                ) : (
                    <div className="organizer-panel">
                        <div className="organizer-grid">
                            <div className="organizer-card">
                                <div className="organizer-card-label">{t('organizerTotalBookmarks')}</div>
                                <div className="organizer-card-value">{cleanupReport?.totalBookmarks ?? 0}</div>
                            </div>
                            <div className="organizer-card">
                                <div className="organizer-card-label">{t('organizerDuplicateGroups')}</div>
                                <div className="organizer-card-value">{cleanupReport?.duplicateCandidates.length ?? 0}</div>
                            </div>
                            <div className="organizer-card">
                                <div className="organizer-card-label">{t('organizerTagUpdates')}</div>
                                <div className="organizer-card-value">{autoTagResult?.updatedBookmarks ?? 0}</div>
                            </div>
                        </div>

                        {autoTagResult && (
                            <div className="organizer-section">
                                <div className="organizer-section-title">{t('organizerTagResults')}</div>
                                <div className="organizer-help">
                                    {t('organizerTagResultDetail', [String(autoTagResult.matchedBookmarks), String(autoTagResult.updatedBookmarks)])}
                                </div>
                            </div>
                        )}

                        <div className="organizer-section">
                            <div className="organizer-section-title">{t('organizerDuplicateCandidates')}</div>
                            <div className="organizer-help">
                                {t('organizerDuplicateRule')}
                            </div>
                            <div className="organizer-list">
                                {(cleanupReport?.duplicateCandidates || []).slice(0, 40).map((item) => (
                                    <div key={item.key} className="organizer-item">
                                        <div className="organizer-item-title">{item.title}</div>
                                        <div className="organizer-item-meta">
                                            {t('organizerDuplicateItemCount', [String(item.count)])} · {item.urls.slice(0, 2).join(' · ')}
                                        </div>
                                    </div>
                                ))}
                                {cleanupReport && cleanupReport.duplicateCandidates.length === 0 && (
                                    <div className="organizer-help">{t('organizerNoDuplicates')}</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal open={linkCheckOpen} onClose={() => setLinkCheckOpen(false)} title={t('checkLinks')} width="600px">
                {linkChecking ? (
                    <div className="link-check-progress">
                        <div className="link-check-progress-meta">
                            <span>{t('checking')}</span>
                            <span>{linkCheckProgress.checked}/{linkCheckProgress.total} ({linkCheckPercent}%)</span>
                        </div>
                        <div className="progress-bar" role="progressbar" aria-valuenow={linkCheckPercent} aria-valuemin={0} aria-valuemax={100}>
                            <div className="progress-bar-fill" style={{ width: `${linkCheckPercent}%` }} />
                        </div>
                    </div>
                ) : (
                    <div>
                        <p style={{ marginBottom: 12 }}>{t('invalidLinksFound', String(invalidResults.length))}</p>
                        <div style={{ maxHeight: 300, overflow: 'auto' }}>
                            {invalidResults.map(r => (
                                <div key={r.id} className="link-check-item">
                                    <div className="link-check-title">{r.title}</div>
                                    <div className="link-check-url">{r.url}</div>
                                    <div className="link-check-status"><span className={`badge badge-${r.status === 'timeout' ? 'warning' : 'error'}`}>{r.statusCode || r.status}</span></div>
                                </div>
                            ))}
                        </div>
                        {invalidResults.length > 0 && (
                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <button className="btn" style={{ flex: 1 }} onClick={async () => {
                                    await batchAddTag(invalidResults.map(r => r.id!), SYSTEM_TAG_INVALID);
                                    showToast(t('taggedInvalid'), 'success');
                                }}>
                                    🏷️ {t('markInvalidTag')}
                                </button>
                                <button className="btn btn-primary" style={{ flex: 1 }} onClick={async () => {
                                    await moveToInvalid(invalidResults.map(r => r.id!));
                                    setLinkCheckOpen(false);
                                    load({ silent: true });
                                    showToast(t('movedToInvalid'), 'success');
                                }}>
                                    📂 {t('moveToInvalid')}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            <ContextMenu state={contextMenu.state} onAction={contextMenu.handleAction} />
            <ToastContainer toasts={toasts} />
        </div>
    );
}

// Helper: collect folder options for select
interface FolderOption { id: string; title: string; depth: number }
type TFn = (key: string, substitutions?: string | string[]) => string;
function collectFolders(nodes: BookmarkNode[], t: TFn, depth = 0): FolderOption[] {
    const result: FolderOption[] = [];
    for (const node of nodes) {
        if (!node.url) {
            if (node.id !== '0') {
                result.push({ id: node.id, title: node.title || t('untitled'), depth });
            }
            if (node.children) result.push(...collectFolders(node.children, t, node.id === '0' ? depth : depth + 1));
        }
    }
    return result;
}
