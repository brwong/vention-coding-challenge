import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Nodes claim ports from 7700 upward, so keep the UI well clear of them.
  server: { port: 5173 },
})
