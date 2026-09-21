import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Public Honey Chain website. Keeper is 5173, Admin 5174, this site 5175.
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5175, strictPort: true },
})
