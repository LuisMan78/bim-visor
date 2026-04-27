import { defineConfig } from 'vite'

export default defineConfig({
  preview: {
    host: '0.0.0.0',
    port: 10000,
    allowedHosts: ['bim-visor.onrender.com', 'all']
  },
  server: {
    port: 5173
  },
  build: {
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      input: {
        main:     'index.html',
        vaciados: 'vaciados_entry.html',
      }
    }
  }
})