import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => ({
  server: {
    port: 3000,
    host: '127.0.0.1',
    allowedHosts: ['.monkeycode-ai.online'],
  },
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@components': path.resolve(rootDir, 'src/components'),
      '@services': path.resolve(rootDir, 'src/services'),
      '@utils': path.resolve(rootDir, 'src/utils'),
      '@types': path.resolve(rootDir, 'types'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: mode === 'development',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/vue/')) {
            return 'vendor'
          }
          if (id.includes('node_modules/lucide-vue-next/')) {
            return 'ui'
          }
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // 减小 chunk 大小限制
    chunkSizeWarningLimit: 500,
    // 启用 Tree Shaking
    target: 'esnext',
  },
  optimizeDeps: {
    include: ['vue', 'lucide-vue-next'],
  },
  preview: {
    port: 4173,
  },
}))
