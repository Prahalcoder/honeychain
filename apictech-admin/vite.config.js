import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The beekeeper app owns 5173; the backend allows 5173 and 5174 for CORS.
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5174, strictPort: true },
})
