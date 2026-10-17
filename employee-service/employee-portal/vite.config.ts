import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 5176 Service Ops frontend'i ile cakisiyordu; ikisi ayni anda calistirilamiyordu.
    port: 5175,
    host: true
  }
})
