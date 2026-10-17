# Vitrin yayın derlemesi — ÖNCE BUNU OKU

## Üretim paketi `npm run build` ile ALINMAZ

```
npm run build:canli
```

**Neden:** Next'in ortam değişkeni öncelik sırasında **`.env.local`, `.env.production`'ı
ezer**. Bu depoda `.env.local` geliştirme değerlerini tutuyor:

```
NEXT_PUBLIC_MEDIA_URL=http://localhost:5150/api/media
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`NEXT_PUBLIC_*` değişkenleri **derleme anında bundle'a gömülür**. Düz `npm run build` ile
alınan paket, bu yüzden canlıya `http://localhost:5150` adresini taşır ve sonuç şudur:

- **bütün ürün ve tanıtım görselleri kırılır** (tarayıcı sunucunun localhost'una erişemez)
- **canonical ve site haritası `http://localhost:3000`** olur — arama motoru açısından ağır hasar

2026-09-09'da tam olarak bu oldu ve canlıya bozuk paket gitti.

`build:canli` betiği doğru değerleri **gerçek ortam değişkeni** olarak geçiriyor; gerçek
`process.env` öncelik sırasında `.env.local`'in de üstündedir, dolayısıyla tuzak kapanır.

## Paketten önce doğrulama (üçü de geçmeli)

```sh
# 1) İstemci bundle'ında canlı medya adresi VAR mı  -> 1 (veya daha fazla) dönmeli
grep -rl "example.com/shopapi/api/media" .next/static | wc -l

# 2) Site haritası canlı adresi mi kullanıyor       -> https://example.com/... dönmeli
grep -o "https://example.com/blog/[a-z-]*" .next/server/app/sitemap.xml.body | head -1

# 3) İstemci bundle'ında localhost KALMAMALI
#    (tek bir eşleşme normaldir: URL ayrıştırma kütüphanesi, bizim ayarımız değil)
grep -rl "localhost" .next/static | wc -l
```

`.next/server` içinde `process.env.SHOP_API_URL??"http://localhost:5150"` görmek **normaldir**:
o değer sunucuda çalışma anında okunuyor, gömülü değil. Sunucudaki `.env.production` dosyası
onu doğru adrese çözüyor.

## Paket içeriği

`.next/` + `server.js` + `package.json`. **Girmez:** `node_modules/`, `public/`,
`.env.production` (sunucudaki korunur).

**`public/google40c598e3973e3db2.html` sunucuda silinmemeli** (2026-10-15): Google Search
Console doğrulaması bu dosyaya bağlı. `public/` sunucuya elle kopyalanıyorsa bu dosya da gitmeli;
silinirse doğrulama düşer.

**Sunucudaki `.env.production` isteğe bağlı satır** (2026-10-15): `META_CAPI_TOKEN=...` — Meta
Conversions API (bkz. `lib/metaCapi.ts`). Yoksa sunucudan Meta'ya hiçbir şey gönderilmez.

`.next/static` klasörünü Next standalone çıktısına kendiliğinden koymaz — elle
`standalone/.../.next/static` altına kopyalanmalı, yoksa sitede hiçbir stil ve betik yüklenmez.
