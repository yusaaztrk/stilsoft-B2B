// vite.config.ts
import { defineConfig } from "file:///C:/Users/Admin/Desktop/B2B-ERP/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/Admin/Desktop/B2B-ERP/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
var vite_config_default = defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    allowedHosts: [".trycloudflare.com"]
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
  esbuild: command === "build" ? { pure: ["console.log", "console.debug", "console.info"], drop: ["debugger"] } : void 0,
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
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-table": ["@tanstack/react-table", "@tanstack/react-virtual", "mantine-react-table"],
          "vendor-ui": ["@mantine/core", "@mantine/dates", "@mantine/hooks", "framer-motion"],
          "vendor-icons": ["lucide-react", "@tabler/icons-react"],
          "vendor-xlsx": ["xlsx"],
          "vendor-barcode": ["jsbarcode", "qrcode"]
        }
      }
    }
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxBZG1pblxcXFxEZXNrdG9wXFxcXEIyQi1FUlBcXFxcZnJvbnRlbmRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXEFkbWluXFxcXERlc2t0b3BcXFxcQjJCLUVSUFxcXFxmcm9udGVuZFxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvQWRtaW4vRGVza3RvcC9CMkItRVJQL2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCdcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IGNvbW1hbmQgfSkgPT4gKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTc0LFxuICAgIGhvc3Q6IHRydWUsXG4gICAgYWxsb3dlZEhvc3RzOiBbJy50cnljbG91ZGZsYXJlLmNvbSddXG4gIH0sXG5cbiAgLypcbiAgICBDQU5MSSBERVJMRU1FREUgS09OU09MIEdcdTAwRENSXHUwMERDTFRcdTAwRENTXHUwMERDIChkZW5ldGltIG1kLiAyNDcpLlxuXG4gICAgYGNvbnNvbGUubG9nYCBcdTAwRTdhXHUwMTFGclx1MDEzMWxhclx1MDEzMSBkZXJsZW1leWUgb2xkdVx1MDExRnUgZ2liaSBnaXJpeW9yZHU6IGNhbmxcdTAxMzFkYSB0YXJheVx1MDEzMWNcdTAxMzEga29uc29sdW51IGFcdTAwRTdhblxuICAgIGhlcmtlcyBBUEkgeWFuXHUwMTMxdGxhclx1MDEzMW5cdTAxMzEsIGNhcmkgbGlzdGVsZXJpbmkgdmUgemFtYW4gemFtYW4gdG9rZW4nbGFyXHUwMTMxIGdcdTAwRjZyZWJpbGl5b3JkdS5cblxuICAgIGBkcm9wOiBbJ2NvbnNvbGUnXWAgWUFaSUxNQURJIGJpbGVyZWsgXHUyMDE0IG8sIGBjb25zb2xlLmVycm9yYC9gY29uc29sZS53YXJuYCd1IGRhIHNpbGVyIHZlXG4gICAgc2FoYSBkZXN0ZVx1MDExRmluZGUgXCJrb25zb2xkYSBuZSB5YXpcdTAxMzF5b3JcIiBzb3J1c3VudW4gY2V2YWJcdTAxMzEga2FsbWF6LiBZYWxuXHUwMTMxemNhIGJpbGdpIGFtYVx1MDBFN2xcdTAxMzFcbiAgICBcdTAwRTdhXHUwMTFGclx1MDEzMWxhciAoYGxvZ2AvYGRlYnVnYC9gaW5mb2ApIHNhZiBrYWJ1bCBlZGlsaXAgYXRcdTAxMzFsXHUwMTMxeW9yOyBoYXRhIHZlIHV5YXJcdTAxMzEgc2F0XHUwMTMxcmxhclx1MDEzMSBrYWxcdTAxMzF5b3IuXG4gICAgR2VsaVx1MDE1RnRpcm1lIHN1bnVjdXN1bmRhIGhpXHUwMEU3YmlyaSBhdFx1MDEzMWxtYXogKGBjb21tYW5kID09PSAnYnVpbGQnYCBrb1x1MDE1RnVsdSkuXG4gICovXG4gIGVzYnVpbGQ6XG4gICAgY29tbWFuZCA9PT0gJ2J1aWxkJ1xuICAgICAgPyB7IHB1cmU6IFsnY29uc29sZS5sb2cnLCAnY29uc29sZS5kZWJ1ZycsICdjb25zb2xlLmluZm8nXSwgZHJvcDogWydkZWJ1Z2dlciddIH1cbiAgICAgIDogdW5kZWZpbmVkLFxuXG4gIGJ1aWxkOiB7XG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIC8qXG4gICAgICAgICAgUEFLRVQgQlx1MDBENkxNRSAoZGVuZXRpbSBtZC4gMjQ4KS5cblxuICAgICAgICAgIEhlciBcdTAxNUZleSB0ZWsgYmlyIGBpbmRleC5qc2AgaVx1MDBFN2luZGUgcGFrZXRsZW5peW9yZHU7IFJlYWN0LCB0YWJsbywgZ3JhZmlrL2lrb24gdmVcbiAgICAgICAgICBFeGNlbCBraXRhcGxcdTAxMzFrbGFyXHUwMTMxIGF5blx1MDEzMSBkb3N5YWRhIG9sZHVcdTAxMUZ1IGlcdTAwRTdpbiBpbGsgYVx1MDBFN1x1MDEzMWxcdTAxMzFcdTAxNUZ0YSBoZXBzaSBiaXJkZW4gaW5kaXJpbGl5b3JkdS5cbiAgICAgICAgICBBeXJcdTAxMzEgcGFyXHUwMEU3YWxhciBoZW0gaWxrIGFcdTAwRTdcdTAxMzFsXHUwMTMxXHUwMTVGXHUwMTMxIGhcdTAxMzF6bGFuZFx1MDEzMXJcdTAxMzF5b3IgaGVtIGRlIHV5Z3VsYW1hIGtvZHUgaGVyIGRlXHUwMTFGaVx1MDE1RnRpXHUwMTFGaW5kZVxuICAgICAgICAgIGt1bGxhblx1MDEzMWNcdTAxMzFuXHUwMTMxbiBraXRhcGxcdTAxMzFrbGFyXHUwMTMxIHllbmlkZW4gaW5kaXJtZXNpbmkgXHUwMEY2bmxcdTAwRkN5b3IgKHRhcmF5XHUwMTMxY1x1MDEzMSBcdTAwRjZuYmVsbGVcdTAxMUZpIGtvcnVudXIpLlxuXG4gICAgICAgICAgU2FkZWNlIEJcdTAwRENZXHUwMERDSyB2ZSBLQVJBUkxJIGtpdGFwbFx1MDEzMWtsYXIgYXlyXHUwMTMxbFx1MDEzMXlvcjsgYVx1MDE1Rlx1MDEzMXJcdTAxMzEgYlx1MDBGNmxtZWsgaXN0ZWsgc2F5XHUwMTMxc1x1MDEzMW5cdTAxMzEgYXJ0XHUwMTMxclx1MDEzMXBcbiAgICAgICAgICBmYXlkYXlcdTAxMzEgZ2VyaSBhbFx1MDEzMXIuXG4gICAgICAgICovXG4gICAgICAgIG1hbnVhbENodW5rczoge1xuICAgICAgICAgICd2ZW5kb3ItcmVhY3QnOiBbJ3JlYWN0JywgJ3JlYWN0LWRvbScsICdyZWFjdC1yb3V0ZXItZG9tJ10sXG4gICAgICAgICAgJ3ZlbmRvci10YWJsZSc6IFsnQHRhbnN0YWNrL3JlYWN0LXRhYmxlJywgJ0B0YW5zdGFjay9yZWFjdC12aXJ0dWFsJywgJ21hbnRpbmUtcmVhY3QtdGFibGUnXSxcbiAgICAgICAgICAndmVuZG9yLXVpJzogWydAbWFudGluZS9jb3JlJywgJ0BtYW50aW5lL2RhdGVzJywgJ0BtYW50aW5lL2hvb2tzJywgJ2ZyYW1lci1tb3Rpb24nXSxcbiAgICAgICAgICAndmVuZG9yLWljb25zJzogWydsdWNpZGUtcmVhY3QnLCAnQHRhYmxlci9pY29ucy1yZWFjdCddLFxuICAgICAgICAgICd2ZW5kb3IteGxzeCc6IFsneGxzeCddLFxuICAgICAgICAgICd2ZW5kb3ItYmFyY29kZSc6IFsnanNiYXJjb2RlJywgJ3FyY29kZSddXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn0pKVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFtVCxTQUFTLG9CQUFvQjtBQUNoVixPQUFPLFdBQVc7QUFFbEIsSUFBTyxzQkFBUSxhQUFhLENBQUMsRUFBRSxRQUFRLE9BQU87QUFBQSxFQUM1QyxTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sY0FBYyxDQUFDLG9CQUFvQjtBQUFBLEVBQ3JDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBYUEsU0FDRSxZQUFZLFVBQ1IsRUFBRSxNQUFNLENBQUMsZUFBZSxpQkFBaUIsY0FBYyxHQUFHLE1BQU0sQ0FBQyxVQUFVLEVBQUUsSUFDN0U7QUFBQSxFQUVOLE9BQU87QUFBQSxJQUNMLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsUUFZTixjQUFjO0FBQUEsVUFDWixnQkFBZ0IsQ0FBQyxTQUFTLGFBQWEsa0JBQWtCO0FBQUEsVUFDekQsZ0JBQWdCLENBQUMseUJBQXlCLDJCQUEyQixxQkFBcUI7QUFBQSxVQUMxRixhQUFhLENBQUMsaUJBQWlCLGtCQUFrQixrQkFBa0IsZUFBZTtBQUFBLFVBQ2xGLGdCQUFnQixDQUFDLGdCQUFnQixxQkFBcUI7QUFBQSxVQUN0RCxlQUFlLENBQUMsTUFBTTtBQUFBLFVBQ3RCLGtCQUFrQixDQUFDLGFBQWEsUUFBUTtBQUFBLFFBQzFDO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsRUFBRTsiLAogICJuYW1lcyI6IFtdCn0K
