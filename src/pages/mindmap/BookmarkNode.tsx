/**
 * Custom bookmark node for React Flow
 */

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import './mindmap.css';

interface BookmarkNodeData {
    label: string;
    isFolder: boolean;
    url?: string;
    childCount: number;
    isCollapsed: boolean;
    isSearchMatch: boolean;
    isDropTarget?: boolean;
    onToggle: () => void;
    [key: string]: unknown;
}

export const BookmarkNodeComponent = memo(({ data, dragging }: NodeProps) => {
    const d = data as unknown as BookmarkNodeData;
    const [hovered, setHovered] = useState(false);

    const handleClick = () => {
        if (dragging) return;
        if (d.isFolder) {
            d.onToggle();
        } else if (d.url) {
            chrome.tabs.create({ url: d.url });
        }
    };

    return (
        <div
            className={`mindmap-node ${d.isFolder ? 'folder' : 'bookmark'} ${d.isSearchMatch ? 'search-match' : ''} ${d.isCollapsed ? 'collapsed' : ''} ${d.isDropTarget ? 'drop-target' : ''}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={handleClick}
        >
            <Handle type="target" position={Position.Left} className="mindmap-handle" />

            <div className="mindmap-node-icon">
                {d.isFolder ? (d.isCollapsed ? '📁' : '📂') : <FaviconSmall url={d.url} />}
            </div>

            <div className="mindmap-node-label" title={d.url || d.label}>
                {d.label}
            </div>

            {d.isFolder && d.childCount > 0 && (
                <span className="mindmap-node-count">{d.childCount}</span>
            )}

            {d.isFolder && d.isCollapsed && (
                <span className="mindmap-node-expand" title="展开">▶</span>
            )}

            <Handle type="source" position={Position.Right} className="mindmap-handle" />

            {hovered && d.url && (
                <div className="mindmap-url-tooltip">{d.url}</div>
            )}
        </div>
    );
});

BookmarkNodeComponent.displayName = 'BookmarkNodeComponent';

function FaviconSmall({ url }: { url?: string }) {
    const [failed, setFailed] = useState(false);
    if (!url || failed) return <span>🔖</span>;
    const src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=16`;
    return <img src={src} onError={() => setFailed(true)} alt="" width={14} height={14} style={{ borderRadius: 2 }} />;
}
