import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发期 /api 代理到 NestJS 后端（3000）；生产由网关同源转发
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
