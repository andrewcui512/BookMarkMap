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
import { callBackground } from '@/lib/utils';
import * as bm from '@/lib/bookmark-manager';
import type { ContextMenuTarget } from '@/components/ContextMenu';
import type { BookmarkNode, LinkCheckResult } from '@/types/bookmark';
import './main.css';

type ViewType = 'all' | 'recent';

export default function App() {
    const { t } = useI18n();
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
            nodes = [{ id: 'recent-root', title: t('recent') || '最近 7 天', children: recent }];
        }
        setDisplayNodes(nodes);
    }, [bookmarks, searchQuery, view, searchLocal, getRecentBookmarks, t]);

    // Context menu
    const handleContextAction = useCallback(async (action: string, target: ContextMenuTarget) => {
        switch (action) {
            case 'open':
                if (target.url) chrome.tabs.create({ url: target.url });
                break;
            case 'copy':
                if (target.url) {
                    await navigator.clipboard.writeText(target.url);
                    showToast(t('copied') || '已复制', 'success');
                }
                break;
            case 'rename': {
                const newTitle = prompt(t('rename') || '重命名', target.title);
                if (newTitle && newTitle !== target.title) {
                    await bm.rename(target.id, newTitle);
                    load();
                }
                break;
            }
            case 'move':
                setMoveTargetId(target.id);
                setMoveOpen(true);
                break;
            case 'delete': {
                const msg = target.isFolder ? (t('confirmDeleteFolder') || '删除此文件夹及所有内容？') : (t('confirmDelete') || '确认删除？');
                if (confirm(msg)) {
                    await bm.remove(target.id);
                    load();
                }
                break;
            }
        }
    }, [load, showToast, t]);

    const contextMenu = useContextMenu(handleContextAction);
    const menuItems = (target: ContextMenuTarget) => [
        { action: 'open', label: t('open') || '打开', icon: '🔗', hidden: target.isFolder },
        { action: 'copy', label: t('copyLink') || '复制链接', icon: '📋', hidden: target.isFolder },
        { action: 'rename', label: t('rename') || '重命名', icon: '✏️' },
        { action: 'move', label: t('moveTo') || '移动到...', icon: '📂' },
        { action: 'delete', label: t('delete') || '删除', icon: '🗑️', danger: true },
    ];

    // Folders for select
    const folderOptions = collectFolders(bookmarks as unknown as BookmarkNode[]);

    // New folder
    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        await bm.createFolder(newFolderParent, newFolderName.trim());
        setNewFolderOpen(false);
        setNewFolderName('');
        load();
        showToast(t('folderCreated') || '文件夹已创建', 'success');
    };

    // Move
    const handleMove = async () => {
        if (!moveTargetId) return;
        await bm.move(moveTargetId, moveTargetFolder);
        setMoveOpen(false);
        setMoveTargetId(null);
        load();
        showToast(t('moved') || '已移动', 'success');
    };

    // Link check
    const handleLinkCheck = async () => {
        setLinkCheckOpen(true);
        setLinkChecking(true);
        setLinkCheckResults([]);
        const allBookmarks = flatten(bookmarks as unknown as BookmarkNode[]);

        try {
            const resp = await callBackground<{ results: LinkCheckResult[] }>({
                type: 'CHECK_LINKS_BATCH',
                bookmarks: allBookmarks.map((b: any) => ({ id: b.id, url: b.url, title: b.title })),
            });
            setLinkCheckResults(resp.results || []);
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

    const viewTitle =
        view === 'all' ? (t('allBookmarks') || '全部书签') :
            (t('recent') || '最近');

    return (
        <div className="main-container">
            {/* Sidebar */}
            <aside className="main-sidebar">
                <div className="sidebar-brand">📚 Bookmark Tree</div>
                <nav className="sidebar-nav">
                    {(['all', 'recent'] as ViewType[]).map(v => (
                        <button key={v} className={`sidebar-item ${view === v ? 'active' : ''}`}
                            onClick={() => { setView(v); setSearchQuery(''); }}>
                            {v === 'all' ? '📋' : '🕐'} {v === 'all' ? (t('allBookmarks') || '全部') : (t('recent') || '最近')}
                        </button>
                    ))}
                </nav>
                <div className="sidebar-divider" />
                <nav className="sidebar-nav">
                    <button className="sidebar-item" onClick={handleLinkCheck}>
                        🔍 {t('checkLinks') || '检测失效链接'}
                    </button>
                    <button className="sidebar-item" onClick={() => setNewFolderOpen(true)}>
                        ➕ {t('newFolder') || '新建文件夹'}
                    </button>
                </nav>
                <div className="sidebar-divider" />
                <nav className="sidebar-nav">
                    <button className="sidebar-item" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('mindmap.html') })}>
                        🗺️ {t('mindMap') || '思维导图'}
                    </button>
                    <button className="sidebar-item" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('ai.html') })}>
                        🤖 AI {t('classify') || '分类'}
                    </button>
                    <button className="sidebar-item" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') })}>
                        ⚙️ {t('settings') || '设置'}
                    </button>
                </nav>
                <div className="sidebar-stats">
                    <span>📁 {folderCount} 个文件夹</span>
                    <span>🔖 {bookmarkCount} 个书签</span>
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
                            title={allExpanded ? '收起全部节点' : '展开全部节点'}
                        >
                            {allExpanded ? (
                                <><span className="tree-toggle-icon">⊟</span> 收起全部</>
                            ) : (
                                <><span className="tree-toggle-icon">⊞</span> 展开全部</>
                            )}
                        </button>
                        <button className="tree-toggle-btn" onClick={expandAll} title="展开全部节点">
                            <span className="tree-toggle-icon">📂</span> 全部展开
                        </button>
                        <button className="tree-toggle-btn" onClick={collapseAll} title="收起全部节点">
                            <span className="tree-toggle-icon">📁</span> 全部收起
                        </button>
                    </div>

                    <div className="main-search">
                        <input
                            type="text"
                            placeholder={t('searchPlaceholder') || '搜索书签...'}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </header>

                <div className="main-content">
                    {loading ? (
                        <div className="state-container"><div className="spinner" /><div className="state-text">{t('loading') || '加载中...'}</div></div>
                    ) : displayNodes.length === 0 ? (
                        <div className="state-container"><div className="state-icon">📭</div><div className="state-text">{searchQuery ? (t('noResults') || '无匹配结果') : (t('noBookmarks') || '暂无书签')}</div></div>
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
            <Modal open={newFolderOpen} onClose={() => setNewFolderOpen(false)} title={t('newFolder') || '新建文件夹'}
                footer={<><button className="btn" onClick={() => setNewFolderOpen(false)}>{t('cancel') || '取消'}</button><button className="btn btn-primary" onClick={handleCreateFolder}>{t('create') || '创建'}</button></>}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <input type="text" placeholder={t('folderName') || '文件夹名称'} value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} autoFocus />
                    <select value={newFolderParent} onChange={(e) => setNewFolderParent(e.target.value)}>
                        {folderOptions.map(f => <option key={f.id} value={f.id}>{'　'.repeat(f.depth)}{f.title}</option>)}
                    </select>
                </div>
            </Modal>

            <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title={t('moveTo') || '移动到...'}
                footer={<><button className="btn" onClick={() => setMoveOpen(false)}>{t('cancel') || '取消'}</button><button className="btn btn-primary" onClick={handleMove}>{t('move') || '移动'}</button></>}>
                <select value={moveTargetFolder} onChange={(e) => setMoveTargetFolder(e.target.value)} style={{ width: '100%' }}>
                    {folderOptions.map(f => <option key={f.id} value={f.id}>{'　'.repeat(f.depth)}{f.title}</option>)}
                </select>
            </Modal>

            <Modal open={linkCheckOpen} onClose={() => setLinkCheckOpen(false)} title={t('checkLinks') || '失效链接检测'} width="600px">
                {linkChecking ? (
                    <div className="state-container"><div className="spinner" /><div className="state-text">{t('checking') || '检测中...'}</div></div>
                ) : (
                    <div>
                        <p style={{ marginBottom: 12 }}>{t('found') || '发现'} {invalidResults.length} {t('invalidLinks') || '个失效链接'}</p>
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
                                load();
                                showToast(t('movedToInvalid') || '已移至失效书签文件夹', 'success');
                            }}>
                                📂 {t('moveToInvalid') || '移至失效书签文件夹'}
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
function collectFolders(nodes: BookmarkNode[], depth = 0): FolderOption[] {
    const result: FolderOption[] = [];
    for (const node of nodes) {
        if (!node.url) {
            result.push({ id: node.id, title: node.title || '未命名', depth });
            if (node.children) result.push(...collectFolders(node.children, depth + 1));
        }
    }
    return result;
}
