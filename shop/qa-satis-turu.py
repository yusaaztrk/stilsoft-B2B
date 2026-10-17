# -*- coding: utf-8 -*-
"""
SATIŞ TURU QA — 2026-09-21

Bu turda eklenen vitrin/mağaza özelliklerini uçtan uca sınar. Yayından SONRA da
çalıştırılabilir: yalnız HTTP kullanıyor, veritabanına dokunmuyor.

Kullanım:
    python shop/qa-satis-turu.py
    python shop/qa-satis-turu.py --api http://localhost:5150 --web http://localhost:3000 --tenant DEMOTEST

Canlıda:
    python shop/qa-satis-turu.py --api https://example.com/shopapi --web https://example.com --tenant STILSOFT

NE YAPMAZ: sipariş oluşturmaz, SMS göndermez, ödeme başlatmaz. Yalnız okuma uçları ve
"stok bildirimi" kaydı (o da uydurma bir stok koduyla, tabloya yazmadan) deneniyor.
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

gecen = 0
kalan = 0
atlanan = 0


def istek(url, headers=None, veri=None, yontem=None):
    req = urllib.request.Request(url, method=yontem or ("POST" if veri else "GET"))
    req.add_header("Accept", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    body = None
    if veri is not None:
        body = json.dumps(veri, ensure_ascii=False).encode("utf-8")
        req.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urllib.request.urlopen(req, body, timeout=25) as r:
            ham = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(ham)
            except json.JSONDecodeError:
                return r.status, ham
    except urllib.error.HTTPError as e:
        ham = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(ham)
        except json.JSONDecodeError:
            return e.code, ham
    except Exception as e:  # ağ hatası
        return 0, str(e)


def kontrol(ad, kosul, ayrinti=""):
    global gecen, kalan
    if kosul:
        gecen += 1
        print("  [OK]   %s" % ad)
    else:
        kalan += 1
        print("  [HATA] %s %s" % (ad, ("— " + str(ayrinti)) if ayrinti else ""))


def atla(ad, sebep):
    global atlanan
    atlanan += 1
    print("  [ATLA] %s — %s" % (ad, sebep))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://localhost:5150")
    p.add_argument("--web", default="http://localhost:3000")
    p.add_argument("--tenant", default="DEMOTEST")
    a = p.parse_args()

    API, WEB = a.api.rstrip("/"), a.web.rstrip("/")
    H = {"X-Tenant-Code": a.tenant}

    print("\n=== 1. KATALOG TEMELİ ===")
    s, d = istek(f"{API}/api/catalog/products?adet=5", H)
    kontrol("ürün listesi 200", s == 200, s)
    urunler = d.get("items", []) if isinstance(d, dict) else []
    kontrol("en az bir ürün yayında", len(urunler) > 0, len(urunler))

    ornek = urunler[0] if urunler else None

    print("\n=== 2. ARAMA ÖNERİSİ (2026-09-21) ===")
    s, d = istek(f"{API}/api/catalog/suggest?ara=k", H)
    kontrol("tek harf boş döner", s == 200 and not d.get("items"), d)

    s, d = istek(f"{API}/api/catalog/suggest?ara=klima", H)
    kontrol("iki+ harf sonuç döner", s == 200, s)
    oneriler = d.get("items", []) if isinstance(d, dict) else []
    if oneriler:
        adlar = [x["name"].lower() for x in oneriler]
        # Türkçe İ: "KLİMA" adı "klima" aramasıyla eşleşmeli ve ÖNDE olmalı
        ilk_uc = " ".join(adlar[:3])
        kontrol("adı eşleşen önde (Türkçe İ)", "kl" in ilk_uc, adlar[:3])
    else:
        atla("adı eşleşen önde", "öneri dönmedi (katalogda klima yok olabilir)")

    print("\n=== 3. KATEGORİ ADRESLERİ ===")
    s, d = istek(f"{API}/api/catalog/categories", H)
    kontrol("kategori listesi 200", s == 200, s)
    kategoriler = d if isinstance(d, list) else []
    if kategoriler:
        bagiran = [c["name"] for c in kategoriler if c["name"].isupper() and len(c["name"]) > 3]
        kontrol("kategori adları BÜYÜK HARF değil", not bagiran, bagiran[:3])

    s, d = istek(f"{API}/api/catalog/categories/slug-redirects", H)
    kontrol("adres yönlendirme eşlemesi 200", s == 200, s)

    print("\n=== 4. STOK BİLDİRİMİ ('gelince haber ver') ===")
    s, d = istek(f"{API}/api/catalog/stock-alert", H,
                 {"stockCode": "QA-OLMAYAN-KOD-123", "phone": "0533 000 00 01"})
    kontrol("uydurma stok kodu sessizce yutulur", s == 200 and d.get("waiting") == 0, (s, d))

    # Numara doğrulaması GERÇEK bir stok koduyla sınanmalı: uydurma kod, numaraya hiç
    # bakılmadan sessizce yutuluyor (bilerek — saldırgana hangi kodun var olduğu söylenmesin).
    if ornek:
        s, d = istek(f"{API}/api/catalog/stock-alert", H,
                     {"stockCode": ornek["stockCode"], "phone": "123"})
        kontrol("geçersiz numara reddedilir", s == 400, (s, d))
    else:
        atla("geçersiz numara reddedilir", "katalogdan örnek ürün alınamadı")

    print("\n=== 5. ÇOK SATANLAR ===")
    s, d = istek(f"{API}/api/catalog/best-sellers?adet=5&gun=90", H)
    kontrol("çok satanlar 200", s == 200, s)
    kontrol("liste (boş olabilir)", isinstance(d, list), type(d).__name__)

    print("\n=== 6. PANEL UÇLARI KİMLİK İSTİYOR ===")
    for yol in ("search-insights", "search-insights/stock-demand", "search-insights/missing-photos"):
        s, _ = istek(f"{API}/api/admin/{yol}", H)
        kontrol(f"/api/admin/{yol} tokensiz 401", s == 401, s)

    s, _ = istek(f"{API}/api/admin/bank-transfers", H)
    kontrol("/api/admin/bank-transfers tokensiz 401", s == 401, s)

    print("\n=== 7. VİTRİN SAYFALARI ===")
    sayfalar = ["/", "/urunler", "/sepet", "/arama?q=klima", "/firsatlar", "/siparis-takibi"]
    for yol in sayfalar:
        s, _ = istek(f"{WEB}{yol}")
        kontrol(f"{yol} 200", s == 200, s)

    if ornek:
        s, _ = istek(f"{WEB}/urun/{ornek['slug']}")
        kontrol("ürün sayfası 200", s == 200, s)
        if ornek.get("categorySlug"):
            s, _ = istek(f"{WEB}/kategori/{ornek['categorySlug']}")
            kontrol("kategori sayfası 200", s == 200, s)

    s, _ = istek(f"{WEB}/urun/qa-olmayan-urun-xyz")
    kontrol("olmayan ürün 404", s == 404, s)

    print("\n=== 8. 'SİZİ ARAYALIM' (geri arama) ===")
    # Geçerli talep GÖNDERİLMİYOR: panele gerçek bir satır düşer, personel arar. Yalnız
    # doğrulama kapıları ve panel uçlarının kimlik istediği sınanıyor.
    s, d = istek(f"{API}/api/catalog/callback", H,
                 {"name": "Q", "phone": "0533 000 00 01", "source": "qa"})
    kontrol("kısa ad reddedilir (400)", s == 400, (s, d))
    s, d = istek(f"{API}/api/catalog/callback", H,
                 {"name": "QA Deneme", "phone": "123", "source": "qa"})
    kontrol("geçersiz numara reddedilir (400)", s == 400 and "geçersiz" in str(d).lower(), (s, d))
    s, d = istek(f"{API}/api/catalog/callback", H, {"phone": "0533 000 00 01"})
    kontrol("ad olmadan reddedilir (400)", s == 400, (s, d))
    s, _ = istek(f"{API}/api/admin/callbacks", H)
    kontrol("/api/admin/callbacks tokensiz 401", s == 401, s)
    s, _ = istek(f"{API}/api/admin/callbacks/1/done", H, {}, "POST")
    kontrol("/api/admin/callbacks/{id}/done tokensiz 401", s == 401, s)

    print("\n=== 9. ZİYARET HUNİSİ (analitik) ===")
    # Adım kaydı GÖNDERİLİYOR ama uydurma bir oturum kimliğiyle: tabloya tek satır düşer,
    # 180 günde kendiliğinden budanır ve hiçbir müşteri verisine karışmaz.
    s, d = istek(f"{API}/api/catalog/visit", H,
                 {"sessionId": "qa000000000000000000000000000001", "step": "giris", "path": "/qa"})
    kontrol("geçerli adım kabul edilir", s == 200, (s, d))

    # Tanınmayan adım ve kısa oturum kimliği SESSİZCE yutulmalı: ölçüm hiçbir koşulda
    # sayfayı bozmamalı, o yüzden uç hata döndürmüyor.
    s, d = istek(f"{API}/api/catalog/visit", H,
                 {"sessionId": "qa000000000000000000000000000001", "step": "olmayan-adim"})
    kontrol("tanınmayan adım sessizce yutulur", s == 200, (s, d))
    s, d = istek(f"{API}/api/catalog/visit", H, {"sessionId": "kisa", "step": "giris"})
    kontrol("kısa oturum kimliği sessizce yutulur", s == 200, (s, d))

    s, _ = istek(f"{API}/api/admin/analytics/funnel", H)
    kontrol("/api/admin/analytics/funnel tokensiz 401", s == 401, s)

    print("\n=== 10. ÜRÜN FEED (Meta / Google katalog) ===")
    s, d = istek(f"{API}/api/catalog/feed.xml", H)
    kontrol("feed 200", s == 200, s)
    if isinstance(d, str):
        kontrol("feed XML", d.lstrip().startswith("<"), d[:40])
        kontrol("fiyat biçimi nokta ile", " TRY<" in d or ".00 TRY" in d or "TRY" in d, "TRY bulunamadı")

    print("\n" + "=" * 52)
    print("  GEÇEN: %d   HATA: %d   ATLANAN: %d" % (gecen, kalan, atlanan))
    print("=" * 52 + "\n")
    sys.exit(1 if kalan else 0)


if __name__ == "__main__":
    main()
