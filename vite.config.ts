import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    server: {
        port: 5173,
        hmr: false,
    },
    base: './',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    // Monaco Editor worker 需要独立打包
    worker: {
        format: 'es',
    },
});
