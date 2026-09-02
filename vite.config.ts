import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        open: true,
        allowedHosts: ['.monkeycode-ai.online'],
      },
      plugins: [
        vue(),
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
          '@components': path.resolve(__dirname, './components'),
          '@services': path.resolve(__dirname, './services'),
          '@utils': path.resolve(__dirname, './utils'),
          '@types': path.resolve(__dirname, './types'),
        }
      },
      build: {
        outDir: 'dist',
        sourcemap: mode === 'development',
        minify: 'terser',
        terserOptions: {
          compress: {
            drop_console: mode === 'production',
            drop_debugger: mode === 'production',
          },
        },
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules/vue/')) {
                return 'vendor';
              }
              if (id.includes('node_modules/lucide-vue-next/')) {
                return 'ui';
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
      css: {
        devSourcemap: true,
      },
      preview: {
        port: 4173,
      },
    };
});
