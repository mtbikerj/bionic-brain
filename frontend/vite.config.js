import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Rolldown (Vite 8) doesn't pick up gl-bench's "module" field — force ESM build
      'gl-bench': 'gl-bench/dist/gl-bench.module.js',
      // @cosmograph/cosmograph ships with an unresolved internal path alias
      '@/cosmograph': path.join(__dirname, 'node_modules/@cosmograph/cosmograph/cosmograph'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
