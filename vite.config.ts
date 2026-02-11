import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import { resolve } from 'path';

export default defineConfig({
    plugins: [
        react(),
        crx({ manifest }),
    ],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
    build: {
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'src/pages/popup/index.html'),
                main: resolve(__dirname, 'src/pages/main/index.html'),
                mindmap: resolve(__dirname, 'src/pages/mindmap/index.html'),
                ai: resolve(__dirname, 'src/pages/ai/index.html'),
                settings: resolve(__dirname, 'src/pages/settings/index.html'),
            },
        },
    },
});
