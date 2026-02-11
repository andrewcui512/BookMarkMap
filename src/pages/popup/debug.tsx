import React from 'react';
import ReactDOM from 'react-dom/client';

// 直接操作 DOM 验证 JS 是否执行
const div = document.createElement('div');
div.style.padding = '20px';
div.style.background = '#e0f7fa';
div.style.color = '#006064';
div.innerHTML = '<h1>JS 执行成功!</h1><p>如果看到这个，说明构建配置没问题，是原代码有依赖错误。</p>';
document.body.prepend(div);

console.log('Debug script loaded');

try {
    const root = document.getElementById('root');
    if (root) {
        ReactDOM.createRoot(root).render(
            <div style={{ padding: 20, border: '2px dashed green' }}>
                <h2>React 渲染成功</h2>
            </div>
        );
    }
} catch (e) {
    console.error(e);
}