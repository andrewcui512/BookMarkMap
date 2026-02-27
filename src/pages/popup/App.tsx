/**
 * Popup App — React migration of popup.js
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
import './popup.css';

const PROTECTED_NODE_IDS = new Set(['0', '1', '2', '3']);

export default function App() {
    const { t } = useI18n();
    useTheme();
    const { bookmarks, loading, load, searchLocal, flatten, moveToInvalid } = useBookmarks();
    const { toasts, show: showToast } = useToast();
    const { expanded, toggle: onToggle } = useExpandedState('expandedNodes');
    const [searchQuery, setSearchQuery] = useState('');
    const [displayNodes, setDisplayNodes] = useState<any[]>([]);

    // Modals
    const [moveOpen, setMoveOpen] = useState(false);
    const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
    const [moveTargetFolder, setMoveTargetFolder] = useState('1');

    const [linkCheckOpen, setLinkCheckOpen] = useState(false);
    const [linkCheckResults, setLinkCheckResults] = useState<LinkCheckResult[]>([]);
    const [linkChecking, setLinkChecking] = useState(false);
    const [linkCheckProgress, setLinkCheckProgress] = useState({ checked: 0, total: 0 });

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (searchQuery.trim()) {
            setDisplayNodes(searchLocal(searchQuery));
        } else {
            setDisplayNodes(bookmarks);
        }
    }, [bookmarks, searchQuery, searchLocal]);

    const matchedBookmarkUrls = useMemo(() => {
        if (!searchQuery.trim()) return [];

        const seenIds = new Set<string>();
        return flatten(displayNodes as unknown as BookmarkNode[])
            .filter((node) => {
                if (!node.url) return false;
                if (seenIds.has(node.id)) return false;
                seenIds.add(node.id);
                return true;
            })
            .map((node) => node.url!);
    }, [displayNodes, flatten, searchQuery]);

    const handleOpenSearchResults = useCallback(async () => {
        if (!searchQuery.trim()) return;

        if (matchedBookmarkUrls.length === 0) {
            showToast(t('noSearchResultsToOpen'), 'info');
            return;
        }

        const results = await Promise.allSettled(
            matchedBookmarkUrls.map((url) => chrome.tabs.create({ url, active: false }))
        );
        const openedCount = results.filter((result) => result.status === 'fulfilled').length;

        if (openedCount > 0) {
            showToast(t('openedSearchResults', String(openedCount)), 'success');
            return;
        }

        showToast(t('noSearchResultsToOpen'), 'warning');
    }, [matchedBookmarkUrls, searchQuery, showToast, t]);

    const handleContextAction = useCallback(
        async (action: string, target: ContextMenuTarget) => {
            const isReadonly = PROTECTED_NODE_IDS.has(target.id);
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
                case 'move': {
                    setMoveTargetId(target.id);
                    setMoveOpen(true);
                    break;
                }
                case 'delete': {
                    const msg = target.isFolder ? t('confirmDeleteFolder') : t('confirmDelete');
                    if (confirm(msg)) {
                        await bm.remove(target.id);
                        load({ silent: true });
                    }
                    break;
                }
            }
        },
        [load, showToast, t]
    );

    const contextMenu = useContextMenu(handleContextAction);

    const menuItems = (target: ContextMenuTarget) => [
        { action: 'open', label: t('open'), icon: '🔗', hidden: target.isFolder },
        { action: 'copy', label: t('copyLink'), icon: '📋', hidden: target.isFolder },
        { action: 'rename', label: t('rename'), icon: '✏️', hidden: PROTECTED_NODE_IDS.has(target.id) },
        { action: 'move', label: t('moveTo'), icon: '📂', hidden: PROTECTED_NODE_IDS.has(target.id) },
        { action: 'delete', label: t('delete'), icon: '🗑️', danger: true, hidden: PROTECTED_NODE_IDS.has(target.id) },
    ];

    const isEmpty = !loading && bookmarks.length === 0;
    const noResults = searchQuery.trim() && displayNodes.length === 0;

    const folderOptions = collectFolders(bookmarks as unknown as BookmarkNode[], t);

    const handleMove = async () => {
        if (!moveTargetId) return;
        if (PROTECTED_NODE_IDS.has(moveTargetId)) {
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

    const linkCheckPercent = linkCheckProgress.total > 0 ? Math.round((linkCheckProgress.checked / linkCheckProgress.total) * 100) : 0;

    return (
        <div className="popup-container">
            {/* Header */}
            <header className="popup-header">
                <h1 className="popup-title">📚 BookMarkMap</h1>
                <div className="popup-actions">
                    <button
                        className="popup-icon-btn"
                        title={t('checkLinks')}
                        onClick={handleLinkCheck}
                    >
                        🔍
                    </button>
                    <button
                        className="popup-icon-btn"
                        title={t('settings')}
                        onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') })}
                    >
                        ⚙️
                    </button>
                </div>
            </header>

            {/* Search */}
            <div className="popup-search">
                <input
                    type="text"
                    placeholder={t('searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery.trim() && (
                    <div className="popup-search-actions">
                        <button
                            className="btn btn-sm popup-open-all-btn"
                            onClick={handleOpenSearchResults}
                            disabled={matchedBookmarkUrls.length === 0}
                        >
                            🚀 {t('openAllSearchResults', String(matchedBookmarkUrls.length))}
                        </button>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="popup-content">
                {loading && (
                    <div className="state-container">
                        <div className="spinner" />
                        <div className="state-text">{t('loading')}</div>
                    </div>
                )}

                {isEmpty && (
                    <div className="state-container">
                        <div className="state-icon">📭</div>
                        <div className="state-text">{t('noBookmarks')}</div>
                    </div>
                )}

                {noResults && (
                    <div className="state-container">
                        <div className="state-icon">🔍</div>
                        <div className="state-text">{t('noResults')}</div>
                    </div>
                )}

                {!loading && !isEmpty && !noResults && (
                    <TreeView
                        nodes={displayNodes as any}
                        searchQuery={searchQuery}
                        expandedNodes={expanded}
                        onToggle={onToggle}
                        onContextMenu={(e, node) => {
                            contextMenu.show(e, {
                                id: node.id,
                                title: node.title,
                                url: node.url,
                                isFolder: !node.url,
                            }, menuItems({
                                id: node.id,
                                title: node.title,
                                url: node.url,
                                isFolder: !node.url,
                            }));
                        }}
                        onClick={(node) => {
                            if (node.url) chrome.tabs.create({ url: node.url });
                        }}
                    />
                )}
            </div>

            {/* Footer buttons */}
            <div className="popup-footer">
                <button className="btn btn-sm"
                    onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('bookmark-map.html') })}
                >
                    📋 {t('openFullPage')}
                </button>
                <button className="btn btn-sm"
                    onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('mindmap.html') })}
                >
                    🗺️ {t('openBookMarkMap')}
                </button>
                <button className="btn btn-sm"
                    onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('ai.html') })}
                >
                    🤖 AI
                </button>
            </div>

            <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title={t('moveTo')}
                footer={<><button className="btn" onClick={() => setMoveOpen(false)}>{t('cancel')}</button><button className="btn btn-primary" onClick={handleMove}>{t('move')}</button></>}>
                <select value={moveTargetFolder} onChange={(e) => setMoveTargetFolder(e.target.value)} style={{ width: '100%' }}>
                    {folderOptions.map(f => <option key={f.id} value={f.id}>{'　'.repeat(f.depth)}{f.title}</option>)}
                </select>
            </Modal>

            <Modal open={linkCheckOpen} onClose={() => setLinkCheckOpen(false)} title={t('checkLinks')} width="520px">
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
                        <div style={{ maxHeight: 260, overflow: 'auto' }}>
                            {invalidResults.map(r => (
                                <div key={r.id} className="link-check-item">
                                    <div className="link-check-title">{r.title}</div>
                                    <div className="link-check-url">{r.url}</div>
                                    <div className="link-check-status"><span className={`badge badge-${r.status === 'timeout' ? 'warning' : 'error'}`}>{r.statusCode || r.status}</span></div>
                                </div>
                            ))}
                        </div>
                        {invalidResults.length > 0 && (
                            <button className="btn btn-primary" style={{ marginTop: 12, width: '100%' }} onClick={async () => {
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
