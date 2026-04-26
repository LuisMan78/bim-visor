import { defineConfig } from 'vite'
import { resolve } from 'path'

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
        main:     resolve(__dirname, 'index.html'),
        vaciados: resolve(__dirname, 'vaciados_entry.html'),
      }
    }
  }
})