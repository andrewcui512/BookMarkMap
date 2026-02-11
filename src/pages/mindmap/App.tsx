/**
 * Mind Map Page — bookmark visualization using React Flow + dagre
 * Full-page mind-map/tree view of all bookmarks.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    Panel,
    type Node,
    type Edge,
    type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

import { useBookmarks } from '@/hooks/useBookmarks';
import { useI18n } from '@/hooks/useI18n';
import { ToastContainer, useToast } from '@/components/Toast';
import type { BookmarkNode } from '@/types/bookmark';
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

export default function App() {
    const { t } = useI18n();
    const { bookmarks, loading, load } = useBookmarks();
    const { toasts, show: showToast } = useToast();

    const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

    const [direction, setDirection] = useState<LayoutDirection>('LR');
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
    const [maxDepth, setMaxDepth] = useState(3);

    useEffect(() => { load(); }, [load]);

    // Convert bookmarks to flow nodes/edges
    const buildFlowData = useCallback(
        (bmNodes: BookmarkNode[], dir: LayoutDirection, collapsed: Set<string>, depth: number): FlowData => {
            const flowNodes: Node[] = [];
            const flowEdges: Edge[] = [];

            const traverse = (node: BookmarkNode, parentId: string | null, currentDepth: number) => {
                if (currentDepth > depth) return;

                const isFolder = !node.url;
                const isCollapsed = collapsed.has(node.id);
                const childCount = node.children?.length || 0;
                const isSearchMatch = searchQuery
                    ? node.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    node.url?.toLowerCase().includes(searchQuery.toLowerCase())
                    : false;

                flowNodes.push({
                    id: node.id,
                    type: 'bookmark',
                    position: { x: 0, y: 0 }, // Will be set by dagre
                    data: {
                        label: node.title || (isFolder ? '📁' : '🔖'),
                        isFolder,
                        url: node.url,
                        childCount,
                        isCollapsed,
                        isSearchMatch,
                        onToggle: () => {
                            setCollapsedNodes(prev => {
                                const next = new Set(prev);
                                if (next.has(node.id)) next.delete(node.id);
                                else next.add(node.id);
                                return next;
                            });
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

                if (isFolder && !isCollapsed && node.children) {
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
        [searchQuery, setCollapsedNodes]
    );

    // Rebuild when bookmarks, direction, collapsed, or depth changes
    useEffect(() => {
        if (bookmarks.length === 0) return;
        const { nodes: n, edges: e } = buildFlowData(
            bookmarks as unknown as BookmarkNode[],
            direction,
            collapsedNodes,
            maxDepth
        );
        setNodes(n);
        setEdges(e);
    }, [bookmarks, direction, collapsedNodes, maxDepth, buildFlowData, setNodes, setEdges]);

    // When search changes, rebuild to update highlighting
    useEffect(() => {
        if (bookmarks.length === 0) return;
        const { nodes: n, edges: e } = buildFlowData(
            bookmarks as unknown as BookmarkNode[],
            direction,
            collapsedNodes,
            maxDepth
        );
        setNodes(n);
        setEdges(e);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchQuery]);

    const nodeCount = nodes.length;
    const edgeCount = edges.length;

    return (
        <div className="mindmap-container">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.1}
                maxZoom={2}
                defaultEdgeOptions={{ type: 'smoothstep' }}
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
                                <select value={direction} onChange={e => setDirection(e.target.value as LayoutDirection)}>
                                    <option value="LR">{t('horizontal') || '水平'}</option>
                                    <option value="TB">{t('vertical') || '垂直'}</option>
                                </select>
                            </label>
                            <label>
                                {t('depth') || '层级'}:
                                <select value={maxDepth} onChange={e => setMaxDepth(Number(e.target.value))}>
                                    {[1, 2, 3, 4, 5, 6, 8, 10].map(d => (
                                        <option key={d} value={d}>{d}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        <div className="mindmap-stats">
                            {nodeCount} {t('nodes') || '节点'} · {edgeCount} {t('edges') || '连线'}
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

            <ToastContainer toasts={toasts} />
        </div>
    );
}
