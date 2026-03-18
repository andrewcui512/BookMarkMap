/**
 * Mind Map Page — bookmark visualization using React Flow + dagre
 * Full-page mind-map/tree view of all bookmarks.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    Panel,
    PanOnScrollMode,
    type Node,
    type Edge,
    type NodeTypes,
    type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

import { useBookmarks } from '@/hooks/useBookmarks';
import { useI18n } from '@/hooks/useI18n';
import { useTags } from '@/hooks/useTags';
import { useTheme } from '@/hooks/useTheme';
import { ToastContainer, useToast } from '@/components/Toast';
import { ContextMenu, useContextMenu, type ContextMenuTarget } from '@/components/ContextMenu';
import { Modal } from '@/components/Modal';
import { TagEditor } from '@/components/Tags';
import type { BookmarkNode } from '@/types/bookmark';
import { SYSTEM_TAG_INVALID, parseSearchQuery, resolveTagAlias } from '@/lib/tags';
import { BookmarkNodeComponent } from './BookmarkNode';
import './mindmap.css';

const nodeTypes: NodeTypes = {
    bookmark: BookmarkNodeComponent,
};

type LayoutDirection = 'LR' | 'TB';

interface FlowData {
    nodes: Node[];
    edges: Edge[];
}

const PROTECTED_NODE_IDS = new Set(['0', '1', '2', '3']);

export default function App() {
    const { t } = useI18n();
    useTheme();
    const { bookmarks, loading, load } = useBookmarks();
    const { ready: tagsReady, getTags, setTags, allTags } = useTags();
    const { toasts, show: showToast } = useToast();

    const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

    const [direction, setDirection] = useState<LayoutDirection>('LR');
    const [searchQuery, setSearchQuery] = useState('');
    const [manualCollapsedNodes, setManualCollapsedNodes] = useState<Set<string>>(new Set());
    const [manualExpandedNodes, setManualExpandedNodes] = useState<Set<string>>(new Set());
    const [maxDepth, setMaxDepth] = useState(3);

    const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
    const pendingFitViewRef = useRef(false);

    const dropTargetIdRef = useRef<string | null>(null);

    const [tagEditOpen, setTagEditOpen] = useState(false);
    const [tagEditTarget, setTagEditTarget] = useState<ContextMenuTarget | null>(null);

    useEffect(() => { load(); }, [load]);

    const setNodeCollapsed = useCallback((nodeId: string, collapse: boolean) => {
        if (collapse) {
            setManualCollapsedNodes((prev) => {
                if (prev.has(nodeId)) return prev;
                const next = new Set(prev);
                next.add(nodeId);
                return next;
            });
            setManualExpandedNodes((prev) => {
                if (!prev.has(nodeId)) return prev;
                const next = new Set(prev);
                next.delete(nodeId);
                return next;
            });
            return;
        }

        setManualExpandedNodes((prev) => {
            if (prev.has(nodeId)) return prev;
            const next = new Set(prev);
            next.add(nodeId);
            return next;
        });
        setManualCollapsedNodes((prev) => {
            if (!prev.has(nodeId)) return prev;
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
        });
    }, []);

    const updateDropTarget = useCallback(
        (nextId: string | null) => {
            const prevId = dropTargetIdRef.current;
            if (prevId === nextId) return;

            dropTargetIdRef.current = nextId;
            setNodes((prev) =>
                prev.map((n) => {
                    if (n.id === prevId) return { ...n, data: { ...n.data, isDropTarget: false } };
                    if (n.id === nextId) return { ...n, data: { ...n.data, isDropTarget: true } };
                    return n;
                })
            );
        },
        [setNodes]
    );

    const getClosestFolderTarget = useCallback(
        (draggedId: string, candidates: Node[]) => {
            if (!reactFlowInstance) return null;
            if (candidates.length === 0) return null;

            const draggedInternal = reactFlowInstance.getInternalNode(draggedId);
            if (!draggedInternal) return null;

            const draggedW = draggedInternal.measured.width ?? draggedInternal.width ?? 0;
            const draggedH = draggedInternal.measured.height ?? draggedInternal.height ?? 0;
            const draggedCenter = {
                x: draggedInternal.internals.positionAbsolute.x + draggedW / 2,
                y: draggedInternal.internals.positionAbsolute.y + draggedH / 2,
            };

            let best: Node | null = null;
            let bestDist = Number.POSITIVE_INFINITY;

            for (const c of candidates) {
                const internal = reactFlowInstance.getInternalNode(c.id);
                if (!internal) continue;

                const w = internal.measured.width ?? internal.width ?? 0;
                const h = internal.measured.height ?? internal.height ?? 0;
                const center = {
                    x: internal.internals.positionAbsolute.x + w / 2,
                    y: internal.internals.positionAbsolute.y + h / 2,
                };

                const dx = center.x - draggedCenter.x;
                const dy = center.y - draggedCenter.y;
                const dist = dx * dx + dy * dy;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = c;
                }
            }

            return best;
        },
        [reactFlowInstance]
    );

    // Convert bookmarks to flow nodes/edges
    const buildFlowData = useCallback(
        (
            bmNodes: BookmarkNode[],
            dir: LayoutDirection,
            manualCollapsed: Set<string>,
            manualExpanded: Set<string>,
            depth: number
        ): FlowData => {
            const flowNodes: Node[] = [];
            const flowEdges: Edge[] = [];

            const hasQuery = Boolean(searchQuery.trim());
            const parsed = parseSearchQuery(searchQuery);
            const lowerTextQuery = parsed.textQuery.toLowerCase();
            const tagFilters = parsed.tagFilters;
            const resolvedTextAsTag = lowerTextQuery ? resolveTagAlias(lowerTextQuery) : null;

            const traverse = (node: BookmarkNode, parentId: string | null, currentDepth: number) => {
                const isFolder = !node.url;
                const childCount = node.children?.length || 0;
                const defaultCollapsed = currentDepth >= depth;
                const isCollapsed = isFolder && childCount > 0
                    ? (manualExpanded.has(node.id) ? false : manualCollapsed.has(node.id) ? true : defaultCollapsed)
                    : false;
                const isProtected = PROTECTED_NODE_IDS.has(node.id);
                const tags = getTags(node.id);
                const tagFilterMatch = tagFilters.length === 0 || tagFilters.every((tf) => tags.includes(tf));
                const titleMatch = lowerTextQuery ? node.title?.toLowerCase().includes(lowerTextQuery) : true;
                const urlMatch = lowerTextQuery ? node.url?.toLowerCase().includes(lowerTextQuery) : true;
                const tagsTextMatch = lowerTextQuery
                    ? tags.some((x) => x.toLowerCase().includes(lowerTextQuery)) || (resolvedTextAsTag ? tags.includes(resolvedTextAsTag) : false)
                    : true;
                const textMatch = lowerTextQuery ? (titleMatch || urlMatch || tagsTextMatch) : true;
                const isSearchMatch = hasQuery ? (tagFilterMatch && textMatch) : false;

                const isInvalid = tags.includes(SYSTEM_TAG_INVALID);

                flowNodes.push({
                    id: node.id,
                    type: 'bookmark',
                    position: { x: 0, y: 0 }, // Will be set by dagre
                    draggable: !isProtected,
                    data: {
                        label: node.title || (isFolder ? '📁' : '🔖'),
                        isFolder,
                        url: node.url,
                        childCount,
                        depth: currentDepth,
                        isCollapsed,
                        isSearchMatch,
                        isProtected,
                        isInvalid,
                        invalidLabel: t('tagInvalid'),
                        onToggle: () => {
                            if (!isFolder || childCount === 0) return;
                            setNodeCollapsed(node.id, !isCollapsed);
                        },
                    },
                });

                if (parentId) {
                    flowEdges.push({
                        id: `e-${parentId}-${node.id}`,
                        source: parentId,
                        target: node.id,
                        type: 'smoothstep',
                        style: { stroke: 'var(--border-color)', strokeWidth: 1.5 },
                        animated: isSearchMatch,
                    });
                }

                if (isFolder && node.children && childCount > 0) {
                    if (isCollapsed) return;
                    node.children.forEach(child => traverse(child, node.id, currentDepth + 1));
                }
            };

            bmNodes.forEach(n => {
                // Skip the root node but process its children
                if (n.id === '0') {
                    n.children?.forEach(child => traverse(child, null, 0));
                } else {
                    traverse(n, null, 0);
                }
            });

            // Apply dagre layout
            const g = new dagre.graphlib.Graph();
            g.setDefaultEdgeLabel(() => ({}));
            g.setGraph({
                rankdir: dir,
                nodesep: dir === 'LR' ? 20 : 40,
                ranksep: dir === 'LR' ? 180 : 80,
                marginx: 40,
                marginy: 40,
            });

            flowNodes.forEach(n => {
                g.setNode(n.id, { width: 200, height: n.data.isFolder ? 44 : 36 });
            });
            flowEdges.forEach(e => {
                g.setEdge(e.source, e.target);
            });

            dagre.layout(g);

            flowNodes.forEach(n => {
                const nodeWithPosition = g.node(n.id);
                if (nodeWithPosition) {
                    n.position = {
                        x: nodeWithPosition.x - 100, // half width
                        y: nodeWithPosition.y - (n.data.isFolder ? 22 : 18), // half height
                    };
                }
            });

            return { nodes: flowNodes, edges: flowEdges };
        },
        [getTags, searchQuery, setNodeCollapsed, t]
    );

    const relayout = useCallback(() => {
        if (bookmarks.length === 0) return;
        const { nodes: n, edges: e } = buildFlowData(
            bookmarks as unknown as BookmarkNode[],
            direction,
            manualCollapsedNodes,
            manualExpandedNodes,
            maxDepth
        );
        setNodes(n);
        setEdges(e);
    }, [bookmarks, direction, manualCollapsedNodes, manualExpandedNodes, maxDepth, buildFlowData, setNodes, setEdges]);

    // Rebuild when bookmarks, direction, collapsed, or depth changes
    useEffect(() => {
        if (bookmarks.length === 0) return;
        const { nodes: n, edges: e } = buildFlowData(
            bookmarks as unknown as BookmarkNode[],
            direction,
            manualCollapsedNodes,
            manualExpandedNodes,
            maxDepth
        );
        setNodes(n);
        setEdges(e);
    }, [bookmarks, direction, manualCollapsedNodes, manualExpandedNodes, maxDepth, buildFlowData, setNodes, setEdges]);

    const nodeCount = nodes.length;
    const edgeCount = edges.length;

    // When layout-affecting controls change (depth/layout), re-center viewport so nodes don't "disappear" off-screen.
    useEffect(() => {
        if (!reactFlowInstance) return;
        if (!pendingFitViewRef.current) return;
        if (nodes.length === 0) return;

        pendingFitViewRef.current = false;
        requestAnimationFrame(() => {
            try {
                reactFlowInstance.fitView({ padding: 0.2, duration: 250 });
            } catch (err) {
                console.warn('[mindmap] fitView failed', err);
            }
        });
    }, [reactFlowInstance, nodes]);

    const handleContextAction = useCallback(
        async (action: string, target: ContextMenuTarget) => {
            switch (action) {
                case 'open':
                    if (target.url) chrome.tabs.create({ url: target.url });
                    return;
                case 'copy':
                    if (target.url) {
                        await navigator.clipboard.writeText(target.url);
                        showToast(t('copied') || '已复制', 'success');
                    }
                    return;
                case 'tags':
                    if (!tagsReady) {
                        showToast(t('loading') || '加载中', 'info');
                        return;
                    }
                    setTagEditTarget(target);
                    setTagEditOpen(true);
                    return;
                case 'toggle':
                    if (!reactFlowInstance) return;
                    {
                        const n = reactFlowInstance.getNode(target.id);
                        const isFolder = Boolean(n?.data?.isFolder);
                        const childCount = Number(n?.data?.childCount ?? 0);
                        const isCollapsed = Boolean(n?.data?.isCollapsed);
                        if (!isFolder || childCount === 0) return;

                        setNodeCollapsed(target.id, !isCollapsed);
                    }
                    return;
                case 'delete': {
                    if (PROTECTED_NODE_IDS.has(target.id)) {
                        showToast('系统文件夹不可删除', 'warning');
                        return;
                    }
                    const msg = target.isFolder
                        ? '确定删除此文件夹及其所有内容？'
                        : '确定删除此书签？';
                    if (!confirm(msg)) return;

                    try {
                        await chrome.bookmarks.remove(target.id);
                    } catch {
                        await chrome.bookmarks.removeTree(target.id);
                    }
                    showToast(t('deleted') || '已删除', 'success');
                    await load({ silent: true });
                    return;
                }
                default:
                    return;
            }
        },
        [load, reactFlowInstance, setNodeCollapsed, showToast, t, tagsReady]
    );

    const contextMenu = useContextMenu(handleContextAction);

    const menuItems = useCallback(
        (target: ContextMenuTarget, isCollapsed: boolean) => [
            { action: 'open', label: t('open') || '打开', icon: '🔗', hidden: target.isFolder },
            { action: 'copy', label: t('copyLink') || '复制链接', icon: '📋', hidden: target.isFolder },
            { action: 'tags', label: t('tags') || '标签', icon: '🏷️' },
            {
                action: 'toggle',
                label: isCollapsed ? (t('expand') || '展开') : (t('collapse') || '收起'),
                icon: isCollapsed ? '▶' : '▼',
                hidden: !target.isFolder || Number(target.childCount ?? 0) <= 0,
            },
            {
                action: 'delete',
                label: t('delete') || '删除',
                icon: '🗑️',
                danger: true,
                hidden: PROTECTED_NODE_IDS.has(target.id),
            },
        ],
        [t]
    );

    const canDropInto = useCallback(async (draggedId: string, targetFolderId: string) => {
        if (draggedId === targetFolderId) return false;

        const draggedNode = reactFlowInstance?.getNode(draggedId);
        if (!draggedNode?.data?.isFolder) return true;

        try {
            const subtree = await chrome.bookmarks.getSubTree(draggedId);
            const root = subtree?.[0];
            const stack = [...(root?.children || [])];
            while (stack.length) {
                const n = stack.pop()!;
                if (n.id === targetFolderId) return false;
                if (n.children) stack.push(...n.children);
            }
        } catch {
            // If we can't verify safely, block the drop.
            return false;
        }
        return true;
    }, [reactFlowInstance]);

    return (
        <div className="mindmap-container">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                onInit={setReactFlowInstance}
                fitView
                minZoom={0.1}
                maxZoom={2}
                zoomOnScroll={false}
                zoomOnPinch={true}
                panOnScroll={true}
                panOnScrollMode={PanOnScrollMode.Free}
                defaultEdgeOptions={{ type: 'smoothstep' }}
                onNodeContextMenu={(e, node) => {
                    const target: ContextMenuTarget = {
                        id: node.id,
                        title: String(node.data?.label ?? ''),
                        url: node.data?.url as string | undefined,
                        isFolder: Boolean(node.data?.isFolder),
                        childCount: Number(node.data?.childCount ?? 0),
                    };
                    contextMenu.show(e, target, menuItems(target, Boolean(node.data?.isCollapsed)));
                }}
                onNodeDragStart={() => updateDropTarget(null)}
                onNodeDrag={(_e, node) => {
                    if (!reactFlowInstance) return;
                    if (PROTECTED_NODE_IDS.has(node.id)) return;

                    const intersections = reactFlowInstance.getIntersectingNodes({ id: node.id }, true);
                    const folders = intersections.filter((n) => n.id !== node.id && Boolean(n.data?.isFolder));
                    const best = getClosestFolderTarget(node.id, folders);
                    updateDropTarget(best?.id ?? null);
                }}
                onNodeDragStop={(_e, node) => {
                    void (async () => {
                        if (!reactFlowInstance) return;

                        const targetId = dropTargetIdRef.current;
                        updateDropTarget(null);

                        if (!targetId) {
                            relayout();
                            return;
                        }

                        if (PROTECTED_NODE_IDS.has(node.id)) {
                            showToast('系统文件夹不可移动', 'warning');
                            relayout();
                            return;
                        }

                        const targetNode = reactFlowInstance.getNode(targetId);
                        if (!targetNode?.data?.isFolder) {
                            relayout();
                            return;
                        }

                        const ok = await canDropInto(node.id, targetId);
                        if (!ok) {
                            showToast('不能移动到该位置', 'error');
                            relayout();
                            return;
                        }

                        try {
                            const current = (await chrome.bookmarks.get(node.id))?.[0];
                            if (!current) throw new Error('找不到要移动的节点');
                            if (current.parentId === targetId) {
                                showToast('已在该文件夹下', 'info');
                                relayout();
                                return;
                            }

                            await chrome.bookmarks.move(node.id, { parentId: targetId });
                            setNodeCollapsed(targetId, false);
                            showToast(`已移动到「${String(targetNode.data?.label ?? '')}」`, 'success');
                            await load({ silent: true });
                        } catch (err) {
                            showToast((err as Error).message || '移动失败', 'error');
                            relayout();
                        }
                    })();
                }}
            >
                <Background gap={24} size={1} color="var(--border-color)" />
                <Controls
                    showInteractive={false}
                    style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}
                />
                <MiniMap
                    nodeColor={(n) => (n.data?.isFolder ? 'var(--primary-color)' : 'var(--text-tertiary)')}
                    maskColor="rgba(0,0,0,0.1)"
                    style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}
                />

                {/* Top controls */}
                <Panel position="top-left" className="mindmap-panel">
                    <div className="mindmap-toolbar">
                        <h2>🗺️ {t('mindMap') || '思维导图'}</h2>
                        <input
                            type="text"
                            placeholder={t('searchPlaceholder') || '搜索...'}
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="mindmap-search"
                        />
                        <div className="mindmap-controls">
                            <label>
                                {t('layout') || '布局'}:
                                <select
                                    value={direction}
                                    onChange={(e) => {
                                        pendingFitViewRef.current = true;
                                        setDirection(e.target.value as LayoutDirection);
                                    }}
                                >
                                    <option value="LR">{t('horizontal') || '水平'}</option>
                                    <option value="TB">{t('vertical') || '垂直'}</option>
                                </select>
                            </label>
                            <label>
                                {t('depth') || '层级'}:
                                <select
                                    value={maxDepth}
                                    onChange={(e) => {
                                        pendingFitViewRef.current = true;
                                        setMaxDepth(Number(e.target.value));
                                    }}
                                >
                                    {[1, 2, 3, 4, 5, 6, 8, 10].map(d => (
                                        <option key={d} value={d}>{d}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        <div className="mindmap-stats">
                            {nodeCount} {t('nodes') || '节点'} · {edgeCount} {t('edges') || '连线'}
                        </div>
                        <div className="mindmap-stats">
                            {t('mindMapHint') || '拖拽节点到文件夹可移动 · 右键节点可删除'}
                        </div>
                    </div>
                </Panel>
            </ReactFlow>

            {loading && (
                <div className="mindmap-loading">
                    <div className="spinner" />
                    <span>{t('loading') || '加载中...'}</span>
                </div>
            )}

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

            <ContextMenu state={contextMenu.state} onAction={contextMenu.handleAction} />
            <ToastContainer toasts={toasts} />
        </div>
    );
}
