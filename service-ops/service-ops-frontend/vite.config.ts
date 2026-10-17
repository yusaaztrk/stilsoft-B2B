import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
  SÜRÜM DAMGASI — "hangi dosya çalışıyor" tartışmasını bitirmek için (2026-08-28).

  İki kez üst üste, düzeltilmiş kod yazıldığı hâlde ekranda eski davranış göründü ve sebebinin
  kurulum mu yoksa kod mu olduğu ancak ağ günlüğünden dolaylı olarak anlaşılabildi. Artık
  tarayıcı konsoluna açılışta tek satır basılıyor ve `SERVIS_SURUM` ile sorulabiliyor.

  `__SERVIS_SURUM__` derleme anında sabite dönüşür; çalışma zamanında hiçbir maliyeti yok.
*/
const SURUM = 'v48'

export default defineConfig({
  plugins: [react()],
  define: {
    __SERVIS_SURUM__: JSON.stringify(`${SURUM} (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`)
  },
  server: {
    host: true
  }
})
