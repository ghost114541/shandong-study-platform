import { defineConfig, searchForWorkspaceRoot } from 'vite'
import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  publicDir: '.pdf-public',
  plugins: [{
    name: 'offline-pdf-resources',
    configResolved() {
      const destination = resolve(import.meta.dirname, '.pdf-public/pdf-resources')
      mkdirSync(destination, { recursive: true })
      for (const name of ['cmaps', 'standard_fonts', 'iccs', 'LICENSE']) {
        cpSync(resolve(import.meta.dirname, 'node_modules/pdfjs-dist', name),
          resolve(destination, name), { recursive: true })
      }
    },
  }],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(import.meta.dirname), '../poc-001'] },
  },
})
