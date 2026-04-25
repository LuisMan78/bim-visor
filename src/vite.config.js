import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  preview: {
    host: '0.0.0.0',
    port: 10000,
    allowedHosts: 'all'
  },
  server: {
    port: 5173
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      }
    }
  }
})