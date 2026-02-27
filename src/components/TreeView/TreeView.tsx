/**
 * TreeView component — React version of tree-renderer.js
 * Renders Chrome bookmarks in a collapsible tree structure.
 */

import { useState, useCallback, useEffect } from 'react';
import { useI18n } from '@/hooks/useI18n';
import './TreeView.css';

interface TreeNode {
    id: string;
    title: string;
    url?: string;
    children?: TreeNode[];
    dateAdded?: number;
}

interface TreeViewProps {
    nodes: TreeNode[];
    searchQuery?: string;
    expandedNodes?: Set<string>;
    onToggle?: (nodeId: string, expanded: boolean) => void;
    onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void;
    onClick?: (node: TreeNode) => void;
    getNodeClass?: (node: TreeNode) => string | string[] | undefined;
}

export function TreeView({
    nodes,
    searchQuery = '',
    expandedNodes: controlledExpanded,
    onToggle,
    onContextMenu,
    onClick,
    getNodeClass,
}: TreeViewProps) {
    const [internalExpanded, setInternalExpanded] = useState<Set<string>>(new Set());
    const expanded = controlledExpanded ?? internalExpanded;

    const toggle = useCallback(
        (nodeId: string) => {
            const newExpanded = new Set(expanded);
            const isExpanded = newExpanded.has(nodeId);
            if (isExpanded) {
                newExpanded.delete(nodeId);
            } else {
                newExpanded.add(nodeId);
            }
            if (!controlledExpanded) {
                setInternalExpanded(newExpanded);
            }
            onToggle?.(nodeId, !isExpanded);
        },
        [expanded, controlledExpanded, onToggle]
    );

    return (
        <div className="tree-view">
            {nodes.map((node) => (
                <TreeNodeItem
                    key={node.id}
                    node={node}
                    searchQuery={searchQuery}
                    expanded={expanded}
                    onToggle={toggle}
                    onContextMenu={onContextMenu}
                    onClick={onClick}
                    getNodeClass={getNodeClass}
                />
            ))}
        </div>
    );
}

function TreeNodeItem({
    node,
    searchQuery,
    expanded,
    onToggle,
    onContextMenu,
    onClick,
    getNodeClass,
}: {
    node: TreeNode;
    searchQuery: string;
    expanded: Set<string>;
    onToggle: (id: string) => void;
    onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void;
    onClick?: (node: TreeNode) => void;
    getNodeClass?: (node: TreeNode) => string | string[] | undefined;
}) {
    const { t } = useI18n();
    const isFolder = !node.url;
    const isExpanded = expanded.has(node.id);
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;

    // Skip root node
    if (node.id === '0') {
        return (
            <>
                {node.children?.map((child) => (
                    <TreeNodeItem
                        key={child.id}
                        node={child}
                        searchQuery={searchQuery}
                        expanded={expanded}
                        onToggle={onToggle}
                        onContextMenu={onContextMenu}
                        onClick={onClick}
                        getNodeClass={getNodeClass}
                    />
                ))}
            </>
        );
    }

    const extraClasses = getNodeClass?.(node);
    const classList = Array.isArray(extraClasses) ? extraClasses : extraClasses ? [extraClasses] : [];

    const displayTitle = node.title || (isFolder ? t('untitledFolder') : t('untitledBookmark'));

    const handleClick = () => {
        if (isFolder) {
            onToggle(node.id);
        } else {
            onClick?.(node);
        }
    };

    return (
        <div className="tree-node">
            <div
                className={`tree-node-content ${classList.join(' ')}`}
                onClick={handleClick}
                onContextMenu={(e) => onContextMenu?.(e, node)}
            >
                {/* Toggle arrow */}
                <div
                    className={`tree-node-toggle ${isExpanded ? 'expanded' : ''} ${!isFolder || !hasChildren ? 'hidden' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggle(node.id);
                    }}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                    </svg>
                </div>

                {/* Icon */}
                <div className={`tree-node-icon ${isFolder ? 'folder' : ''}`}>
                    {isFolder ? (
                        isExpanded ? '📂' : '📁'
                    ) : (
                        <FaviconImg url={node.url!} />
                    )}
                </div>

                {/* Title */}
                <div className="tree-node-title">
                    {searchQuery ? (
                        <span dangerouslySetInnerHTML={{ __html: highlightText(displayTitle, searchQuery) }} />
                    ) : (
                        displayTitle
                    )}
                    {isFolder && hasChildren && (
                        <span className="tree-node-count">({node.children!.length})</span>
                    )}
                </div>
            </div>

            {/* Children */}
            {isFolder && hasChildren && (
                <div className={`tree-node-children ${isExpanded ? '' : 'collapsed'}`}>
                    {node.children!.map((child) => (
                        <TreeNodeItem
                            key={child.id}
                            node={child}
                            searchQuery={searchQuery}
                            expanded={expanded}
                            onToggle={onToggle}
                            onContextMenu={onContextMenu}
                            onClick={onClick}
                            getNodeClass={getNodeClass}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function FaviconImg({ url }: { url: string }) {
    const [failed, setFailed] = useState(false);

    if (failed) return <span>🔖</span>;

    const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=16`;
    return <img src={faviconUrl} onError={() => setFailed(true)} alt="" width={16} height={16} />;
}

function highlightText(text: string, query: string): string {
    if (!query) return text;
    const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safe})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
}

// Persisted expand state hook
export function useExpandedState(storageKey: string) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    useEffect(() => {
        chrome.storage.local.get([storageKey], (result) => {
            const stored = result?.[storageKey];
            if (Array.isArray(stored)) {
                setExpanded(new Set(stored));
            }
        });
    }, [storageKey]);

    const toggle = useCallback(
        (nodeId: string, isExpanded: boolean) => {
            setExpanded((prev) => {
                const next = new Set(prev);
                if (isExpanded) next.add(nodeId);
                else next.delete(nodeId);
                chrome.storage.local.set({ [storageKey]: [...next] });
                return next;
            });
        },
        [storageKey]
    );

    return { expanded, toggle };
}
