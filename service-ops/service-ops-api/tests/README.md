# Teknik servis kabul testleri

Promptdaki 13 kabul senaryosunun (#51) uçtan uca karşılığı. Mock yok — gerçek API'lere,
gerçek veritabanına karşı çalışır.

## Çalıştırmadan önce

İki API ayakta olmalı:

| Servis      | Adres                   |
| ----------- | ----------------------- |
| B2B ERP API | http://localhost:5200   |
| ServiceOps  | http://localhost:5137   |

Oturum, uygulamanın kendi kullandığı yoldan alınır: B2B'de giriş → `/api/auth/exchange` ile
ServiceOps token'ına takas. Ham ERP token'ı normal auth hattında geçmez, takas tek kapıdır.

## Çalıştırma

```bash
node tests/kabul-testleri.js
```

Varsayılan firma `DEMOTEST`. Değiştirmek için:

```bash
TEST_TENANT=DEMO TEST_USER=ssa TEST_PASS=... node tests/kabul-testleri.js
```

## Temizlik

Test, `SNTEST-` seri numaralı ve `TEST MÜŞTERİ` adlı kayıtlar üretir. Silmek için:

```bash
node tests/temizle.js
```

**Dikkat:** test, hak ediş listesindeki İLK kaydı 90 USD / Onaylandı yapar. Bu gerçek bir kayıt
olabilir; `temizle.js` yalnızca test ödemelerini siler, hak edişi geri almaz. Üretim benzeri bir
veritabanında koşturmayın.

## Neyi kapsıyor

- Test 1/7 — büyük ve küçük ürün kaydı, kategori kolonunun doğru yazılması
- Test 2 — saha planı ve **planlanan güne göre** süzme (oluşturma tarihi değil)
- Test 3 — servis faturası
- Test 4 — atölyeye alma, aynı ServiceId, duplicate kayıt oluşmaması
- Test 5 — atölye hazır
- Test 8 — hak ediş → 90 USD → personel ekstresinde hareket, para birimi başına bakiye
- Test 11 — B2B cari/bayi listesi ve fatura tipi çözümü
- #32 bayi performans raporu, #41 bildirim ucu, #45 zaman çizelgesi
- Regresyon: `/api/erp/customers` ve `/api/erp/dealers` rota çakışması, kategori süzgecinin
  tümleyen olması, fatura tekilliği (ikinci istek yeni fatura kesmemeli), fatura iptalinin
  işareti geri alması
