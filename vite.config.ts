import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// Date-boundary regressions exercise both 23-hour and 25-hour local calendar days.
if (process.env.VITEST) process.env.TZ = 'Europe/Lisbon'
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: [...configDefaults.exclude, '**/.tmp/**'],
  },
})
