import { defineConfig, searchForWorkspaceRoot } from 'vite'

export default defineConfig({
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(import.meta.dirname), '../poc-001'] },
  },
})
