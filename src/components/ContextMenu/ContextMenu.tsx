/**
 * Unified context menu component
 * Replaces separate ContextMenu classes in popup.js and main.js
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import './ContextMenu.css';

export interface ContextMenuItem {
    action: string;
    label: string;
    icon?: string;
    hidden?: boolean;
    danger?: boolean;
}

interface ContextMenuState {
    visible: boolean;
    x: number;
    y: number;
    target: ContextMenuTarget | null;
    items: ContextMenuItem[];
}

export interface ContextMenuTarget {
    id: string;
    title: string;
    url?: string;
    isFolder: boolean;
    childCount?: number;
}

export function useContextMenu(onAction: (action: string, target: ContextMenuTarget) => void) {
    const [state, setState] = useState<ContextMenuState>({
        visible: false,
        x: 0,
        y: 0,
        target: null,
        items: [],
    });

    const show = useCallback(
        (e: React.MouseEvent, target: ContextMenuTarget, items: ContextMenuItem[]) => {
            e.preventDefault();
            e.stopPropagation();

            const visibleItems = items.filter((i) => !i.hidden);

            // Compute position to stay within viewport
            let x = e.clientX;
            let y = e.clientY;
            const menuWidth = 180;
            const menuHeight = visibleItems.length * 36 + 8;

            if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 5;
            if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 5;

            setState({ visible: true, x, y, target, items: visibleItems });
        },
        []
    );

    const hide = useCallback(() => {
        setState((prev) => ({ ...prev, visible: false, target: null }));
    }, []);

    const handleAction = useCallback(
        (action: string) => {
            if (state.target) {
                Promise.resolve(onAction(action, state.target)).catch((err) => {
                    console.error('Context menu action failed:', err);
                });
            }
            hide();
        },
        [state.target, onAction, hide]
    );

    // Close on click outside or ESC
    useEffect(() => {
        if (!state.visible) return;

        const handleClick = () => hide();
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') hide();
        };

        document.addEventListener('click', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('click', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [state.visible, hide]);

    return { state, show, hide, handleAction };
}

interface ContextMenuComponentProps {
    state: {
        visible: boolean;
        x: number;
        y: number;
        items: ContextMenuItem[];
    };
    onAction: (action: string) => void;
}

export function ContextMenu({ state, onAction }: ContextMenuComponentProps) {
    const ref = useRef<HTMLDivElement>(null);

    if (!state.visible) return null;

    return (
        <div
            ref={ref}
            className="context-menu"
            style={{ left: state.x, top: state.y }}
            onClick={(e) => e.stopPropagation()}
        >
            {state.items.map((item) => (
                <button
                    key={item.action}
                    className={`context-menu-item ${item.danger ? 'danger' : ''}`}
                    onClick={() => onAction(item.action)}
                >
                    {item.icon && <span className="context-menu-icon">{item.icon}</span>}
                    <span>{item.label}</span>
                </button>
            ))}
        </div>
    );
}
