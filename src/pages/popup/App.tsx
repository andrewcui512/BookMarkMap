/**
 * Popup App — React migration of popup.js
 */

import { useEffect, useState, useCallback } from 'react';
import { TreeView, useExpandedState } from '@/components/TreeView';
import { ContextMenu, useContextMenu } from '@/components/ContextMenu';
import { ToastContainer, useToast } from '@/components/Toast';
import { useBookmarks } from '@/hooks/useBookmarks';
import { useI18n } from '@/hooks/useI18n';
import type { ContextMenuTarget } from '@/components/ContextMenu';
import './popup.css';

export default function App() {
    const { t } = useI18n();
    const { bookmarks, loading, load, searchLocal } = useBookmarks();
    const { toasts, show: showToast } = useToast();
    const { expanded, toggle: onToggle } = useExpandedState('expandedNodes');
    const [searchQuery, setSearchQuery] = useState('');
    const [displayNodes, setDisplayNodes] = useState<any[]>([]);

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

    const handleContextAction = useCallback(
        async (action: string, target: ContextMenuTarget) => {
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
                        await chrome.bookmarks.update(target.id, { title: newTitle });
                        load();
                    }
                    break;
                }
                case 'delete': {
                    const msg = target.isFolder ? t('confirmDeleteFolder') : t('confirmDelete');
                    if (confirm(msg)) {
                        try {
                            await chrome.bookmarks.remove(target.id);
                        } catch {
                            await chrome.bookmarks.removeTree(target.id);
                        }
                        load();
                    }
                    break;
                }
            }
        },
        [load, showToast, t]
    );

    const contextMenu = useContextMenu(handleContextAction);

    const menuItems = (target: ContextMenuTarget) => [
        { action: 'open', label: t('open') || '打开', icon: '🔗', hidden: target.isFolder },
        { action: 'copy', label: t('copyLink') || '复制链接', icon: '📋', hidden: target.isFolder },
        { action: 'rename', label: t('rename') || '重命名', icon: '✏️' },
        { action: 'delete', label: t('delete') || '删除', icon: '🗑️', danger: true },
    ];

    const isEmpty = !loading && bookmarks.length === 0;
    const noResults = searchQuery.trim() && displayNodes.length === 0;

    return (
        <div className="popup-container">
            {/* Header */}
            <header className="popup-header">
                <h1 className="popup-title">📚 Bookmark Tree</h1>
                <div className="popup-actions">
                    <button
                        className="popup-icon-btn"
                        title={t('settings') || '设置'}
                        onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/settings/index.html') })}
                    >
                        ⚙️
                    </button>
                </div>
            </header>

            {/* Search */}
            <div className="popup-search">
                <input
                    type="text"
                    placeholder={t('searchPlaceholder') || '搜索书签...'}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>

            {/* Content */}
            <div className="popup-content">
                {loading && (
                    <div className="state-container">
                        <div className="spinner" />
                        <div className="state-text">{t('loading') || '加载中...'}</div>
                    </div>
                )}

                {isEmpty && (
                    <div className="state-container">
                        <div className="state-icon">📭</div>
                        <div className="state-text">{t('noBookmarks') || '暂无书签'}</div>
                    </div>
                )}

                {noResults && (
                    <div className="state-container">
                        <div className="state-icon">🔍</div>
                        <div className="state-text">{t('noResults') || '无匹配结果'}</div>
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
                    onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/main/index.html') })}
                >
                    📋 {t('openFullPage') || '完整页面'}
                </button>
                <button className="btn btn-sm"
                    onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/mindmap/index.html') })}
                >
                    🗺️ {t('mindMap') || '思维导图'}
                </button>
                <button className="btn btn-sm"
                    onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/ai/index.html') })}
                >
                    🤖 AI
                </button>
            </div>

            <ContextMenu state={contextMenu.state} onAction={contextMenu.handleAction} />
            <ToastContainer toasts={toasts} />
        </div>
    );
}
