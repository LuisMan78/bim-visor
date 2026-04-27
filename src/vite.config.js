import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import { resolve } from 'path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  preview: {
    host: '0.0.0.0',
    port: 10000,
    allowedHosts: ['bim-visor.onrender.com', 'all']
  },
  server: {
    port: 5173
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  resolve: {
    conditions: ['browser', 'module', 'import', 'default'],
  },
  build: {
    chunkSizeWarningLimit: 10000,
    target: 'esnext',
  }
})