import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
  plugins: [react()],

  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/auth': {
        target: 'http://localhost:3001',
      },
      '/me': {
        target: 'http://localhost:3001',
      },
    },
  },

  preview: {
    host: true,
    allowedHosts: ['.railway.app'],
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
