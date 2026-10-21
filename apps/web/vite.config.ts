/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:3000', rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
  test: { environment: 'jsdom' },
});
