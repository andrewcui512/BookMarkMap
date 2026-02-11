/**
 * Toast notification component
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import './Toast.css';

type ToastType = 'default' | 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
    id: number;
    message: string;
    type: ToastType;
}

let toastIdCounter = 0;

export function useToast() {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    const show = useCallback((message: string, type: ToastType = 'default', duration = 2200) => {
        const id = ++toastIdCounter;
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
    }, []);

    return { toasts, show };
}

export interface ToastContainerProps {
    toasts: ToastItem[];
}

export function ToastContainer({ toasts }: ToastContainerProps) {
    return (
        <div className="toast-container">
            {toasts.map((t) => (
                <ToastMessage key={t.id} item={t} />
            ))}
        </div>
    );
}

function ToastMessage({ item }: { item: ToastItem }) {
    const [visible, setVisible] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        requestAnimationFrame(() => setVisible(true));
    }, []);

    return (
        <div ref={ref} className={`toast toast-${item.type} ${visible ? 'toast-enter' : ''}`}>
            {item.message}
        </div>
    );
}
