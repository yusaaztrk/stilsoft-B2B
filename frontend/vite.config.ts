import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    allowedHosts: ['.trycloudflare.com']
  },

  /*
    CANLI DERLEMEDE KONSOL GÜRÜLTÜSÜ (denetim md. 247).

    `console.log` çağrıları derlemeye olduğu gibi giriyordu: canlıda tarayıcı konsolunu açan
    herkes API yanıtlarını, cari listelerini ve zaman zaman token'ları görebiliyordu.

    `drop: ['console']` YAZILMADI bilerek — o, `console.error`/`console.warn`'u da siler ve
    saha desteğinde "konsolda ne yazıyor" sorusunun cevabı kalmaz. Yalnızca bilgi amaçlı
    çağrılar (`log`/`debug`/`info`) saf kabul edilip atılıyor; hata ve uyarı satırları kalıyor.
    Geliştirme sunucusunda hiçbiri atılmaz (`command === 'build'` koşulu).
  */
  esbuild:
    command === 'build'
      ? { pure: ['console.log', 'console.debug', 'console.info'], drop: ['debugger'] }
      : undefined,

  build: {
    rollupOptions: {
      output: {
        /*
          PAKET BÖLME (denetim md. 248).

          Her şey tek bir `index.js` içinde paketleniyordu; React, tablo, grafik/ikon ve
          Excel kitaplıkları aynı dosyada olduğu için ilk açılışta hepsi birden indiriliyordu.
          Ayrı parçalar hem ilk açılışı hızlandırıyor hem de uygulama kodu her değiştiğinde
          kullanıcının kitaplıkları yeniden indirmesini önlüyor (tarayıcı önbelleği korunur).

          Sadece BÜYÜK ve KARARLI kitaplıklar ayrılıyor; aşırı bölmek istek sayısını artırıp
          faydayı geri alır.
        */
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-table': ['@tanstack/react-table', '@tanstack/react-virtual', 'mantine-react-table'],
          'vendor-ui': ['@mantine/core', '@mantine/dates', '@mantine/hooks', 'framer-motion'],
          'vendor-icons': ['lucide-react', '@tabler/icons-react'],
          'vendor-xlsx': ['xlsx'],
          'vendor-barcode': ['jsbarcode', 'qrcode']
        }
      }
    }
  }
}))
