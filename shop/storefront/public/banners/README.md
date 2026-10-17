# Anasayfa afişleri (slider)

Stilsoft'un kendi hazırlattığı **1920x700 WebP** afişleri. Anasayfadaki görsel vitrin
(`components/HeroSlider.tsx`) bu dosyaları sırayla döndürüyor ve her afiş tıklanabilir
(ödül afişi hariç — onun bir kategori/arama karşılığı yok, bilerek tıklanmaz bırakıldı).

| Dosya | Afiş | Tıklayınca gider |
|---|---|---|
| `slider-sikayetvar-odul.webp` | Şikayetvar A.C.E. Awards — 11. Yıl Diamond Ödülü | *(tıklanmaz — ödül duyurusu)* |
| `slider-yeni-supurge.webp` | Yeni şarjlı dikey süpürge — bitmeyen çekim gücü | `/kategori/ev-temizligi` |
| `slider-ankastre-set.webp` | ANKASTRE SET — Kalite, şıklık ve kolaylık | `/kategori/ankastre` |
| `slider-tv.webp` | Başka bir dünya tam karşınızda (4K Ultra HD Smart) | `/arama?q=televizyon` |
| `slider-steamgen-3000.webp` | Steamgen 3000 — Ütü yapmayı şimdi çok seviyoruz | `/kategori/utu` |
| `slider-su-sebili.webp` | İster evde ister ofiste sıcak & soğuk suyunuz | `/kategori/sebil` |
| `slider-megatron-2.webp` | Megatron II — Enerjisi yüksek, hareketleri esnek | `/kategori/ev-temizligi` |
| `slider-klima.webp` | Evinizin havası değişsin | `/kategori/klima` |
| `slider-bikahve.webp` | BiKahve Maxi Filter — Her daim sıcak anılar | `/kategori/icecek-hazirlama` |
| `slider-gurmega.webp` | Gurmega — İyi tosttan ve ızgaradan gurme anlar | `/kategori/gida-hazirlama` |
| `slider-fonmatik.webp` | Fönmatik BLDC-9041 | `/kategori/kisisel-bakim` |
| `slider-camasir-makinesi.webp` | Giysilere karşı hassas, lekelere karşı güçlü | `/kategori/camasir-makinesi` |

## Yeni afiş eklerken

- **Ölçü 1920x700 olmalı.** Kadraj (`app/globals.css` → `.visual-hero-viewport`) tam bu
  orana ayarlı; başka orandaki dosyanın altı/üstü kırpılır ve afişin metni kesilir.
- Dosya adı ve adres eşlemesi `components/HeroSlider.tsx` içinde. Bir afişi başka
  kategoriye bağlamak için orayı değiştirin; kategori adresleri canlı katalogla
  doğrulanmalı (su sebilinin adresi `sebil`, `su-sebili` değil).
- Televizyonun ERP'de **kategorisi yok**; o afiş bu yüzden aramaya gidiyor. Kategori
  açılırsa bağlantı `/kategori/<adres>` olarak güncellenmeli.

## Telefon

Afiş telefonda doğal olarak kısa bir şerit hâline geliyor (375px genişlikte ~137px).
Kırpmak yerine tamamını göstermek tercih edildi: afişlerin metni kadrajın içine
tasarlandı, kırpınca okunmuyor. Kalıcı çözüm telefona ayrı kare/dikey bir set
hazırlatmak — o set gelirse `HeroSlider` içinde `<picture>`/`sizes` ile ayrılabilir.

## Eski dosyalar

Yapay zekâyla üretilmiş `banner-*.jpg` yer tutucuları (1376x768) silindi. Marka
tipografisi, ürün adı ve kampanya metni taşımıyorlardı.
