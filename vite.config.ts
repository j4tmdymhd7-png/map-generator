import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

const now = new Date()
const buildDate = `${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear()).slice(2)}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
