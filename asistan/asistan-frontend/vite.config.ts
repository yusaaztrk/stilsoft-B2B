import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
  Canlıda ekran Asistan.Api'nin wwwroot'undan, API ile AYNI siteden sunulur
  (asistan.example.com). Geliştirmede de aynı-kaynak davranışı olsun diye API
  istekleri Vite üzerinden 5160'a aktarılır; kodda adres yazmıyoruz.
*/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:5160',
      '/dev': 'http://localhost:5160',
      '/health': 'http://localhost:5160'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
