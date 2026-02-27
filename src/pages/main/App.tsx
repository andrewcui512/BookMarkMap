/**
 * Main Page App — full-page bookmark manager
 * Features: tree view with one-click expand/collapse all, search, context menu
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { TreeView, useExpandedState } from '@/components/TreeView';
import { ContextMenu, useContextMenu } from '@/components/ContextMenu';
import { ToastContainer, useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { useBookmarks } from '@/hooks/useBookmarks';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { checkLinks } from '@/lib/link-checker';
import { ensureOriginsPermission, WEB_ACCESS_ORIGINS } from '@/lib/permissions';
import * as bm from '@/lib/bookmark-manager';
import type { ContextMenuTarget } from '@/components/ContextMenu';
import type { BookmarkNode, LinkCheckResult } from '@/types/bookmark';
import './main.css';

type ViewType = 'all' | 'recent';
const PROTECTED_NODE_IDS = new Set(['0', '1', '2', '3']);

function isReadOnlyNodeId(id: string): boolean {
    return PROTECTED_NODE_IDS.has(id) || id === 'recent-root';
}

export default function App() {
    const { t } = useI18n();
    useTheme();
    const { bookmarks, loading, load, searchLocal, flatten, getRecentBookmarks, moveToInvalid } = useBookmarks();
    const { toasts, show: showToast } = useToast();
    const { expanded, toggle: onToggle } = useExpandedState('expandedNodesMain');
    const [view, setView] = useState<ViewType>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [displayNodes, setDisplayNodes] = useState<any[]>([]);

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

    const allExpanded = allFolderIds.length > 0 && allFolderIds.every(id => expanded.has(id));

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

    // Toggle: if any collapsed → expand all; if all expanded → collapse all
    const toggleExpandAll = useCallback(() => {
        if (allExpanded) {
            collapseAll();
        } else {
            expandAll();
        }
    }, [allExpanded, expandAll, collapseAll]);

    // Update display based on view and search
    useEffect(() => {
        let nodes: any[] = bookmarks;
        if (searchQuery.trim()) {
            nodes = searchLocal(searchQuery);
        } else if (view === 'recent') {
            const recent = getRecentBookmarks(bookmarks as unknown as BookmarkNode[], 7);
            nodes = [{ id: 'recent-root', title: t('recentDays', '7'), children: recent }];
        }
        setDisplayNodes(nodes);
    }, [bookmarks, searchQuery, view, searchLocal, getRecentBookmarks, t]);

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
    }, [load, showToast, t]);

    const contextMenu = useContextMenu(handleContextAction);
    const menuItems = (target: ContextMenuTarget) => [
        { action: 'open', label: t('open'), icon: '🔗', hidden: target.isFolder },
        { action: 'copy', label: t('copyLink'), icon: '📋', hidden: target.isFolder },
        { action: 'rename', label: t('rename'), icon: '✏️', hidden: isReadOnlyNodeId(target.id) },
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
                    <button className="sidebar-item" onClick={() => setNewFolderOpen(true)}>
                        ➕ {t('newFolder')}
                    </button>
                </nav>
                <div className="sidebar-divider" />
                <nav className="sidebar-nav">
                    <button className="sidebar-item" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('mindmap.html') })}>
                        🗺️ {t('openBookMarkMap')}
                    </button>
                    <button className="sidebar-item" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('ai.html') })}>
                        🤖 AI {t('classify')}
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
                        <button
                            className={`tree-toggle-btn ${allExpanded ? 'expanded' : ''}`}
                            onClick={toggleExpandAll}
                            title={allExpanded ? t('collapseAllNodes') : t('expandAllNodes')}
                        >
                            {allExpanded ? (
                                <><span className="tree-toggle-icon">⊟</span> {t('collapseAll')}</>
                            ) : (
                                <><span className="tree-toggle-icon">⊞</span> {t('expandAll')}</>
                            )}
                        </button>
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
                            placeholder={t('searchPlaceholder')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </header>

                <div className="main-content">
                    {loading ? (
                        <div className="state-container"><div className="spinner" /><div className="state-text">{t('loading')}</div></div>
                    ) : displayNodes.length === 0 ? (
                        <div className="state-container"><div className="state-icon">📭</div><div className="state-text">{searchQuery ? t('noResults') : t('noBookmarks')}</div></div>
                    ) : (
                        <TreeView
                            nodes={displayNodes as any}
                            searchQuery={searchQuery}
                            expandedNodes={expanded}
                            onToggle={onToggle}
                            onContextMenu={(e, node) => {
                                const target: ContextMenuTarget = { id: node.id, title: node.title, url: node.url, isFolder: !node.url };
                                contextMenu.show(e, target, menuItems(target));
                            }}
                            onClick={(node) => { if (node.url) chrome.tabs.create({ url: node.url }); }}
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
                            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={async () => {
                                await moveToInvalid(invalidResults.map(r => r.id!));
                                setLinkCheckOpen(false);
                                load({ silent: true });
                                showToast(t('movedToInvalid'), 'success');
                            }}>
                                📂 {t('moveToInvalid')}
                            </button>
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
