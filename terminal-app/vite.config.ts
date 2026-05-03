import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig(({ mode }) => ({
  optimizeDeps: {
    exclude: ['monaco-editor'],
  },
  plugins: [
    tailwindcss(),
    react(),
    {
      name: 'html-title',
      transformIndexHtml(html) {
        const title = mode === 'development'
          ? 'Pixel City - Virtual Office (Development)'
          : 'Pixel City - Virtual Office';
        return html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
      },
    },
  ],
  base: './',
  root: 'src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        settings: resolve(__dirname, 'src/renderer/settings.html'),
      },
      external: [
        '@xterm/addon-ligatures',
      ],
    },
  },
  server: {
    port: 5913,
    strictPort: true,
    fs: {
      allow: [resolve(__dirname, '..')],
    },
  },
}))
