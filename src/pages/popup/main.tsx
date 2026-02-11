import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@/styles/common.css';

// 简单的错误边界组件
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('Popup Error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 20, color: 'red', wordBreak: 'break-all' }}>
                    <h3>发生错误</h3>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error?.message}</pre>
                    <pre style={{ fontSize: '10px', marginTop: 10 }}>{this.state.error?.stack}</pre>
                </div>
            );
        }
        return this.props.children;
    }
}

const root = document.getElementById('root');
if (!root) throw new Error('找不到 root 节点');

ReactDOM.createRoot(root).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </React.StrictMode>
);
