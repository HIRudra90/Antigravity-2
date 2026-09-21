import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    watch: {
      // The Python venv and model binaries live inside the repo. Without this
      // Vite watches them and a pip install triggers full page reloads (and
      // burns file watchers on tens of thousands of irrelevant files).
      ignored: [
        '**/.venv/**',
        '**/backend/models_bin/**',
        '**/__pycache__/**',
        // Rendered video output: large MP4s and per-frame PNG caches that
        // would otherwise trigger a page reload every time a render runs.
        '**/brag-output/**',
      ],
    },
  },
})
