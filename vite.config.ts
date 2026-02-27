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
    base: './',
    build: {
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'popup.html'),
                main: resolve(__dirname, 'bookmark-map.html'),
                settings: resolve(__dirname, 'settings.html'),
                ai: resolve(__dirname, 'ai.html'),
                mindmap: resolve(__dirname, 'mindmap.html'),
            },
            output: {
                chunkFileNames: 'assets/[name]-[hash].js',
                entryFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]',
            },
        },
    },
});
