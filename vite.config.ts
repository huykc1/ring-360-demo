import { defineConfig } from 'vite';
import config from './prototype.config.json';

// `vite build --mode editor` builds the level editor alone into dist-editor/editor/ (served at <pagesUrl>/editor/).
export default defineConfig(({ mode }) => ({
    base: './',
    // Set by scripts/publish-site.sh ("latest" or a tag like "v0.2.0"); "dev" when run locally.
    define: { __APP_VERSION__: JSON.stringify(process.env.SITE_VERSION ?? 'dev') },
    server: { port: config.devPort },
    worker: { format: 'es' },
    build: {
        chunkSizeWarningLimit: 1500,
        ...(mode === 'editor' ? { outDir: 'dist-editor', assetsDir: 'editor/assets' } : {}),
        rollupOptions: {
            ...(mode === 'editor' ? { input: 'editor/index.html' } : {}),
            output: {
                manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined)
            }
        }
    }
}));
