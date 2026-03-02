import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'util', 'process'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  define: {
    'process.env': {},
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws':  { target: 'ws://localhost:8080',  ws: true, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          solana:   ['@solana/web3.js','@solana/wallet-adapter-react'],
          wallets:  ['@solana/wallet-adapter-wallets','@solana/wallet-adapter-phantom',
                     '@solana/wallet-adapter-solflare','@solana/wallet-adapter-backpack'],
          charts:   ['recharts'],
          motion:   ['framer-motion'],
        },
      },
    },
  },
})
