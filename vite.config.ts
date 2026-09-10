import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { dedupe: ['three'] },
  base: './',
  build: {
    rollupOptions: { input: { game: 'index.html', redTeam: 'red-team.html', admin: 'admin.html', minimap: 'minimap.html' } },
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  worker: { format: 'es' },
  server: { port: 5173, host: '127.0.0.1' },
});
