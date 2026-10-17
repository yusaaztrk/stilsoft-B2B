# -*- coding: utf-8 -*-
"""
E-TİCARET ÖDEME ZİNCİRİ — UÇTAN UCA LOKAL TEST

Ne yapar: gerçek bir müşterinin yaptığını yapar. Üye olur, sepete ürün atar, ödemeyi
başlatır, bankanın döndürdüğü 3D formunu AYRIŞTIRIR ve tıpkı bankanın yapacağı gibi geri
çağrı adresine POST eder. Sonra zincirin her halkasını veritabanından doğrular.

Neden sahte POS: gerçek POS bir banka sandbox'ı, gerçek üye işyeri numarası ve dışa açık
https bir geri çağrı adresi istiyor. `FakePosProvider` yalnızca Development ortamında ve
`VirtualPos:EnableFakeProvider` açıkken devreye giriyor; imzayı gerçekten doğruluyor,
yani bu test imza yolunu da sınıyor.

ÇALIŞTIRMA (ERP 5200, Shop 5150 ve PostgreSQL 5434 ayakta olmalı):
    python shop/odeme-zinciri-testi.py

UYARI: yalnızca LOKAL test veritabanı içindir. Ürün ve sipariş yazar.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

SHOP = 'http://127.0.0.1:5150'
ERP = 'http://127.0.0.1:5200'
PSQL = r'C:\Program Files\PostgreSQL\18\bin\psql.exe'
TENANT_DB = 'b2b_erp_tenant_DEMOTEST'
SHOP_DB = 'b2b_shop_tenant_DEMOTEST'

# Sahte POS'ta sonucu KART NUMARASI belirler: 0000 ile biten kart reddedilir.
CARD_OK = '4111111111111111'
CARD_DECLINED = '4111111111110000'

sonuclar = []


def kontrol(baslik, kosul, ayrinti=''):
    sonuclar.append((baslik, bool(kosul), ayrinti))
    print(('  [GECTI] ' if kosul else '  [KALDI] ') + baslik + (' -> ' + ayrinti if ayrinti else ''))
    return bool(kosul)


def sql(query, db=TENANT_DB):
    env = dict(os.environ, PGPASSWORD='b2b', PGCLIENTENCODING='UTF8')
    r = subprocess.run([PSQL, '-h', 'localhost', '-p', '5434', '-U', 'b2b', '-d', db, '-Atc', query],
                       capture_output=True, text=True, env=env, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        raise RuntimeError('psql: ' + (r.stderr or '').strip())
    return (r.stdout or '').strip()


def http(url, method='GET', body=None, headers=None, form=None):
    h = dict(headers or {})
    data = None
    if form is not None:
        data = urllib.parse.urlencode(form).encode('utf-8')
        h['Content-Type'] = 'application/x-www-form-urlencoded'
    elif body is not None:
        data = json.dumps(body).encode('utf-8')
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


import urllib.parse  # noqa: E402  (http() içinde kullanılıyor)


def sms_kutusu():
    """Sahte SMS kutusu. Yalnizca FakeSmsService aciksa (Development) cevap verir."""
    st, body = http(SHOP + '/api/admin/sms-outbox')
    if st != 200:
        return []
    return json.loads(body).get('data', [])


def sms_kodu_al(telefon):
    """Sahte kutudan bu numaraya gonderilen SON koddaki 6 haneyi ayiklar."""
    for kayit in sms_kutusu():
        m = re.search(r'\b(\d{6})\b', kayit.get('message', ''))
        if m:
            return m.group(1)
    return None


def telefon_dogrula(telefon, amac='register'):
    """
    SMS dogrulama akisini kosturur: kod iste -> sahte kutudan oku -> dogrula -> bilet.

    SMS KAPALIYSA None doner ve cagiran biletsiz devam eder; kayit ucu o durumda bileti
    zaten sormuyor. Boylece bu test hem SMS acik hem kapali ortamda calisiyor.
    """
    st, body = http(SHOP + '/api/account/sms-status')
    if st != 200 or not json.loads(body).get('enabled'):
        return None

    # HIZ SINIRINA TAKILIRSA BEKLENIR, sinir GEVSETILMEZ.
    #
    # Kayit uclarinda IP basina 10 istek / 5 dakika var (RateLimitPolicies.Auth) ve SMS
    # dogrulamasi acilinca uyelik basina uc istek gidiyor. Testi hizlandirmak icin siniri
    # gevsetmek, tam da korumak istedigimiz davranisi test disi birakmak olurdu; onun yerine
    # pencerenin kapanmasi bekleniyor.
    for deneme in range(13):
        st, body = http(SHOP + '/api/account/phone/send-code', 'POST',
                        {'phone': telefon, 'purpose': amac})
        if st != 429:
            break
        print('  ... hiz sinirina takildi, 30 sn bekleniyor (deneme %d)' % (deneme + 1))
        time.sleep(30)

    if st != 200:
        raise RuntimeError('Dogrulama kodu istenemedi (%s): %s' % (st, body[:200]))

    kod = sms_kodu_al(telefon)
    if not kod:
        raise RuntimeError('Sahte SMS kutusunda kod bulunamadi.')

    st, body = http(SHOP + '/api/account/phone/verify', 'POST',
                    {'phone': telefon, 'purpose': amac, 'code': kod})
    if st != 200:
        raise RuntimeError('Kod dogrulanamadi (%s): %s' % (st, body[:200]))

    return json.loads(body)['ticket']


def uye_ol(etiket):
    """Yeni üye + ERP'de yeni cari. E-posta tekil olmalı, zaman damgası ekleniyor."""
    email = 'test.%s.%d@lokal.test' % (etiket, int(time.time() * 1000) % 10 ** 9)
    # Numara her uyelikte farkli: numara basina 1 kod/60sn siniri var, ayni numarayi
    # tekrar kullanmak ikinci uyelikte 429 verirdi.
    telefon = '0533%07d' % (int(time.time() * 1000) % 10 ** 7)

    bilet = telefon_dogrula(telefon)

    govde = {
        'email': email,
        'password': 'LokalTest1234',
        'fullName': 'Lokal Test Musteri',
        'phone': telefon,
        'city': 'Lefkosa',
        'district': 'Gonyeli',
        'address': 'Lokal test adresi No:1',
    }
    if bilet:
        # Alan adi `phoneVerificationTicket` (RegisterRequest); vitrin de bunu gonderiyor.
        govde['phoneVerificationTicket'] = bilet

    status, body = http(SHOP + '/api/account/register', 'POST', govde)
    if status != 200:
        raise RuntimeError('Uye olusturulamadi (%s): %s' % (status, body[:300]))
    d = json.loads(body)
    return d['session'], d['member']['customerCode'], email


def sepete_ekle(token, kod, adet=1, montaj=False):
    # `wantsInstallation` 2026-09-09'da eklendi: montaj artik musterinin SECIMI.
    # Varsayilan False birakiliyor cunku vitrindeki varsayilan da bu.
    return http(SHOP + '/api/cart/items', 'POST',
                {'stockCode': kod, 'quantity': adet, 'wantsInstallation': montaj},
                {'X-Shop-Session': token})


def montaj_sec(token, kod, istiyor):
    return http(SHOP + '/api/cart/items/' + kod + '/montaj', 'PUT',
                {'wantsInstallation': istiyor},
                {'X-Shop-Session': token})


def sepet(token):
    _, body = http(SHOP + '/api/cart', headers={'X-Shop-Session': token})
    return json.loads(body)


def odeme_baslat(token, kart):
    status, body = http(SHOP + '/api/payments/start', 'POST', {
        'cardHolderName': 'LOKAL TEST',
        'cardNumber': kart,
        'expMonth': '12',
        'expYear': '2030',
        'cvc': '123',
        'installmentCount': 1,
        'bankCode': 999,          # sahte POS
        'deliveryNote': 'Lokal test siparisi',
    }, {'X-Shop-Session': token})
    return status, body


def formu_ayristir(html):
    """
    3D formundaki gizli alanları ve hedef adresi çıkarır — tarayıcının yaptığı iş.
    Testin formu GERÇEKTEN kullanması önemli: alanları elle uydurmak, form üretimindeki
    bir hatayı görünmez kılardı.
    """
    action = re.search(r'action="([^"]+)"', html)
    alanlar = dict(re.findall(r'name="([^"]+)"\s+value="([^"]*)"', html))
    if not action:
        raise RuntimeError('Formda action bulunamadi')
    return action.group(1).replace('&amp;', '&'), alanlar


def banka_geri_cagirsin(action, alanlar):
    """Bankanın yaptığının aynısı: geri çağrı adresine form POST'u."""
    return http(action, 'POST', form=alanlar)


def main():
    print('=' * 72)
    print(' E-TICARET ODEME ZINCIRI - UCTAN UCA LOKAL TEST')
    print('=' * 72)

    # ---------------------------------------------------------------- 0. ön koşul
    print('\n0) On kosullar')
    kontrol('Shop API ayakta', http(SHOP + '/api/storefront')[0] == 200)
    kontrol('ERP API ayakta', http(ERP + '/api/health')[0] == 200)
    kontrol('Sahte POS tanimli',
            sql('SELECT count(*) FROM "VirtualPosDefinitions" WHERE "BankCode"=999') == '1')

    # ---------------------------------------------------------------- 1. üyelik
    print('\n1) Uyelik ve cari acilisi')
    token, cari, email = uye_ol('basarili')
    kontrol('Uye olusturuldu', bool(token))
    kontrol('ERP carisi acildi ve 120-11- onekli', (cari or '').startswith('120-11-'), cari)
    kontrol('Cari ERP veritabaninda var',
            sql("SELECT count(*) FROM \"Customers\" WHERE \"CustomerCode\"='%s'" % cari) == '1')

    # ------------------------------------------------------- 1b. yayin kurali (kritik stok)
    print('\n1b) Yayin kurali: biten ve kritik stoktaki urunler')
    st, body = http(SHOP + '/api/catalog/products?adet=50')
    kodlar = [x['stockCode'] for x in json.loads(body)['items']] if st == 200 else []
    kontrol('Stogu biten urun vitrinde YOK', 'TEST-TUKENDI' not in kodlar, str(kodlar))
    kontrol('Kritik stoktaki urun vitrinde YOK (stok 3 < esik 12)', 'TEST-KRITIK' not in kodlar, str(kodlar))
    kontrol('Stogu bol urun vitrinde VAR', 'TEST-TV-55' in kodlar, str(kodlar))
    kontrol('Esigi 0 olan urun stogu az olsa da vitrinde VAR', 'TEST-KAHVE' in kodlar, str(kodlar))

    st, _ = sepete_ekle(token, 'TEST-KRITIK')
    kontrol('Kritik stoktaki urun sepete EKLENEMEDI', st in (404, 409), 'HTTP ' + str(st))

    # ---------------------------------------------------------------- 2. sepet
    print('\n2) Sepet ve MONTAJ SECIMI')

    # 2a. MONTAJ SECILMEDEN: bedel alinmamali. 2026-09-09 oncesinde montaj otomatikti ve
    #     montaj istemeyen musteriden de 300 TL tahsil ediliyordu.
    st, _ = sepete_ekle(token, 'TEST-TV-55', montaj=False)
    kontrol('Montajli urun sepete eklendi (montajsiz)', st == 200)
    c = sepet(token)
    kontrol('Montaj SECILMEDI -> bedel 0', abs(c['installationTotal']) < 0.01, str(c['installationTotal']))
    kontrol('Montajsiz genel toplam 24.600,00', abs(c['grandTotal'] - 24600) < 0.01, str(c['grandTotal']))
    kontrol('Satirda montaj secimi kapali',
            c['lines'][0]['wantsInstallation'] is False, str(c['lines'][0]['wantsInstallation']))
    kontrol('Montaj bedeli bilgi olarak yine geliyor (300,00)',
            abs(c['lines'][0]['installationFeeUnit'] - 300) < 0.01, str(c['lines'][0]['installationFeeUnit']))

    # 2b. MONTAJ ACILDI: bedel eklenmeli, KDV matrahi degismemeli.
    st, _ = montaj_sec(token, 'TEST-TV-55', True)
    kontrol('Sepette montaj acildi', st == 200)
    c = sepet(token)
    kontrol('Urun toplami 24.600,00', abs(c['productTotal'] - 24600) < 0.01, str(c['productTotal']))
    kontrol('Montaj bedeli 300,00', abs(c['installationTotal'] - 300) < 0.01, str(c['installationTotal']))
    kontrol('KDV 1.171,43 (montaj matraha girmiyor)', abs(c['vatTotal'] - 1171.43) < 0.01, str(c['vatTotal']))
    kontrol('GENEL TOPLAM 24.900,00', abs(c['grandTotal'] - 24900) < 0.01, str(c['grandTotal']))

    # 2c. Montaji OLMAYAN urunde secim yok sayilmali (istemciye guvenilmiyor).
    st, _ = montaj_sec(token, 'TEST-KAHVE', True)
    kontrol('Montaji olmayan urunde secim reddedildi', st == 409, 'HTTP ' + str(st))

    # ---------------------------------------------------------------- 3. ödeme başlat
    print('\n3) Odeme baslatma (3D formu)')
    st, body = odeme_baslat(token, CARD_OK)
    kontrol('Odeme baslatildi', st == 200, body[:160] if st != 200 else '')
    if st != 200:
        return ozet()
    d = json.loads(body)
    siparis = d['orderNo']
    kontrol('Siparis numarasi dondu', bool(siparis), siparis)
    kontrol('3D formu SAHTE POS formu', 'SAHTE POS' in d['htmlForm'])

    kontrol('ERP siparisi olustu',
            sql("SELECT count(*) FROM \"SalesOrders\" WHERE \"OrderNo\"='%s'" % siparis) == '1')
    kontrol('Siparis tutari sepetle ayni (24.900,00)',
            sql("SELECT \"GrandTotal\" FROM \"SalesOrders\" WHERE \"OrderNo\"='%s'" % siparis).startswith('24900'),
            sql("SELECT \"GrandTotal\" FROM \"SalesOrders\" WHERE \"OrderNo\"='%s'" % siparis))
    kontrol('Satirda montaj damgasi var',
            sql("SELECT \"Montage\" FROM \"SalesOrderLines\" l JOIN \"SalesOrders\" o ON o.\"Id\"=l.\"SalesOrderId\" WHERE o.\"OrderNo\"='%s'" % siparis) == 't')
    birim = sql("SELECT \"UnitPrice\" FROM \"SalesOrderLines\" l JOIN \"SalesOrders\" o ON o.\"Id\"=l.\"SalesOrderId\" WHERE o.\"OrderNo\"='%s'" % siparis)
    # Beklenen 23.714,29: hedef bruttten geriye hesap (24.600,00 + 300,00) / 1,05 = 23.714,2857,
    # kolon numeric(18,2) oldugu icin 23.714,29 olarak saklaniyor ve 1,05 ile carpildiginda
    # tam 24.900,00 veriyor. Onceki formul (net + bedelin neti) 23.714,28 uretiyor ve genel
    # toplam 24.899,99'a dusuyordu - bu test o 1 kurusu yakalayan testtir.
    kontrol('Birim net montaj dahil (23.714,29)', birim.startswith('23714.29'), birim)
    kontrol('Teslimat adresi siparise kopyalandi',
            sql("SELECT COALESCE(\"DeliveryAddress\",'') FROM \"SalesOrders\" WHERE \"OrderNo\"='%s'" % siparis) != '',
            sql("SELECT COALESCE(\"DeliveryAddress\",'') FROM \"SalesOrders\" WHERE \"OrderNo\"='%s'" % siparis))

    # ---------------------------------------------------------------- 4. faturalama kapısı
    print('\n4) Odenmemis siparis faturalanamaz kapisi')
    kontrol('Odeme henuz Pending',
            sql("SELECT \"Status\" FROM \"EcommerceOrderPayments\" WHERE \"SalesOrderNo\"='%s'" % siparis) == '0')

    # ---------------------------------------------------------------- 5. banka geri çağrısı
    print('\n5) Banka geri cagrisi (3D sonucu)')
    action, alanlar = formu_ayristir(d['htmlForm'])
    kontrol('Formda oid/amount/currency/hash var',
            all(k in alanlar for k in ('oid', 'amount', 'currency', 'hash')), ','.join(sorted(alanlar)))

    # 5a. KURCALANMIS geri cagri once denenir: imza dogrulamasi gercekten calisiyor mu?
    bozuk = dict(alanlar, amount='1.00')
    banka_geri_cagirsin(action, bozuk)
    kontrol('Tutari degistirilmis geri cagri ODEMEYI ACMADI',
            sql("SELECT \"Status\" FROM \"EcommerceOrderPayments\" WHERE \"SalesOrderNo\"='%s'" % siparis) != '1')

    # 5b. gercek geri cagri
    st, _ = banka_geri_cagirsin(action, alanlar)
    kontrol('Geri cagri islendi', st in (200, 302))

    durum = sql("SELECT \"Status\" FROM \"EcommerceOrderPayments\" WHERE \"SalesOrderNo\"='%s'" % siparis)
    kontrol('Odeme ODENDI olarak damgalandi (Status=1)', durum == '1', 'Status=' + durum)

    # ---------------------------------------------------------------- 6. zincirin devamı
    print('\n6) Odeme sonrasi zincir')
    kontrol('Montaj kaydi acildi',
            sql("SELECT count(*) FROM \"Installations\" i JOIN \"SalesOrderLines\" l ON l.\"Id\"=i.\"SalesOrderLineId\" JOIN \"SalesOrders\" o ON o.\"Id\"=l.\"SalesOrderId\" WHERE o.\"OrderNo\"='%s'" % siparis) == '1')
    kontrol('Montaj kaydinda teslimat adresi var',
            sql("SELECT COALESCE(i.\"Address\",'') FROM \"Installations\" i JOIN \"SalesOrderLines\" l ON l.\"Id\"=i.\"SalesOrderLineId\" JOIN \"SalesOrders\" o ON o.\"Id\"=l.\"SalesOrderId\" WHERE o.\"OrderNo\"='%s'" % siparis) != '')
    kontrol('Satir montaj kaydina baglandi (InstallationId)',
            sql("SELECT count(*) FROM \"SalesOrderLines\" l JOIN \"SalesOrders\" o ON o.\"Id\"=l.\"SalesOrderId\" WHERE o.\"OrderNo\"='%s' AND l.\"InstallationId\" IS NOT NULL" % siparis) == '1')

    # Durum sorgusu magazadan: sepet temizligi ve olay kaydi burada tetikleniyor.
    st, body = http(SHOP + '/api/payments/' + siparis, headers={'X-Shop-Session': token})
    kontrol('Magaza odemeyi ODENDI goruyor', st == 200 and json.loads(body).get('isPaid') is True, body[:120])
    kontrol('Sepet temizlendi', sepet(token)['itemCount'] == 0)

    # ---------------------------------------------------------------- 7. idempotanlık
    print('\n7) Idempotanlik (banka geri cagriyi TEKRAR gonderirse)')
    montaj_once = sql("SELECT count(*) FROM \"Installations\"")
    odeme_once = sql("SELECT count(*) FROM \"EcommerceOrderPayments\" WHERE \"SalesOrderNo\"='%s'" % siparis)
    banka_geri_cagirsin(action, alanlar)
    banka_geri_cagirsin(action, alanlar)
    kontrol('Ikinci montaj kaydi OLUSMADI',
            sql("SELECT count(*) FROM \"Installations\"") == montaj_once, 'once=' + montaj_once)
    kontrol('Ikinci odeme kaydi OLUSMADI',
            sql("SELECT count(*) FROM \"EcommerceOrderPayments\" WHERE \"SalesOrderNo\"='%s'" % siparis) == odeme_once)
    kontrol('Siparis hala tek',
            sql("SELECT count(*) FROM \"SalesOrders\" WHERE \"OrderNo\"='%s'" % siparis) == '1')

    # ---------------------------------------------------------------- 8. başarısız ödeme
    print('\n8) BASARISIZ odeme yolu (kart 0000 ile bitiyor)')

    # AYNI ÜYE yeniden kullanılıyor, ikinci bir üyelik AÇILMIYOR.
    #
    # Kayıt ucunda IP başına 10 istek / 5 dakika sınırı var (RateLimitPolicies.Auth) ve SMS
    # doğrulaması açılınca üyelik başına üç istek gidiyor (kod iste + doğrula + kayıt).
    # İkinci üyelik bu sınıra takılıyor ve test "429" ile düşüyordu — sınır doğru çalışıyor,
    # yanlış olan testin her senaryo için yeni hesap açmasıydı. Önceki adımda sepet zaten
    # temizlendiği için aynı üyeyle temiz bir sepetten devam edilebiliyor.
    token2 = token
    sepete_ekle(token2, 'TEST-ANK-SET')
    st, body = odeme_baslat(token2, CARD_DECLINED)
    kontrol('Odeme baslatildi (red edilecek kart)', st == 200, body[:160] if st != 200 else '')
    if st == 200:
        d2 = json.loads(body)
        siparis2 = d2['orderNo']
        a2, f2 = formu_ayristir(d2['htmlForm'])
        banka_geri_cagirsin(a2, f2)
        durum2 = sql("SELECT \"Status\" FROM \"EcommerceOrderPayments\" WHERE \"SalesOrderNo\"='%s'" % siparis2)
        kontrol('Odeme BASARISIZ damgalandi (Status=2)', durum2 == '2', 'Status=' + durum2)
        kontrol('Basarisiz odemede montaj kaydi ACILMADI',
                sql("SELECT count(*) FROM \"Installations\" i JOIN \"SalesOrderLines\" l ON l.\"Id\"=i.\"SalesOrderLineId\" JOIN \"SalesOrders\" o ON o.\"Id\"=l.\"SalesOrderId\" WHERE o.\"OrderNo\"='%s'" % siparis2) == '0')
        kontrol('Basarisiz odemede sepet DURUYOR (musteri tekrar deneyebilir)',
                sepet(token2)['itemCount'] > 0)
        kontrol('Stok DUSMEDI (fatura kesilmedi)',
                sql("SELECT \"Stock\" FROM \"Products\" WHERE \"StockCode\"='TEST-ANK-SET'") == '8')

    # ---------------------------------------------------------------- 9. montajsız sipariş
    print('\n9) MONTAJSIZ siparis: bedel de montaj kaydi da OLMAMALI')

    # Sepeti temizleyip montajlı ürünü MONTAJSIZ ekliyoruz. 2026-09-09 öncesinde bu mümkün
    # değildi: montajı olan ürün her koşulda montajlı sayılıyordu.
    http(SHOP + '/api/cart', 'DELETE', None, {'X-Shop-Session': token})
    sepete_ekle(token, 'TEST-TV-55', montaj=False)

    c3 = sepet(token)
    kontrol('Montajsiz sepet toplami 24.600,00', abs(c3['grandTotal'] - 24600) < 0.01, str(c3['grandTotal']))

    st, body = odeme_baslat(token, CARD_OK)
    if kontrol('Montajsiz siparis acildi', st == 200, body[:160] if st != 200 else ''):
        d3 = json.loads(body)
        siparis3 = d3['orderNo']

        kontrol('Siparis tutari 24.600,00 (montaj bedeli YOK)',
                sql("SELECT \"GrandTotal\" FROM \"SalesOrders\" WHERE \"OrderNo\"='%s'" % siparis3).startswith('24600'),
                sql("SELECT \"GrandTotal\" FROM \"SalesOrders\" WHERE \"OrderNo\"='%s'" % siparis3))
        kontrol('Satirda montaj damgasi YOK',
                sql("SELECT \"Montage\" FROM \"SalesOrderLines\" l JOIN \"SalesOrders\" o ON o.\"Id\"=l.\"SalesOrderId\" WHERE o.\"OrderNo\"='%s'" % siparis3) == 'f')

        a3, f3 = formu_ayristir(d3['htmlForm'])
        banka_geri_cagirsin(a3, f3)
        durum3 = sql("SELECT \"Status\" FROM \"EcommerceOrderPayments\" WHERE \"SalesOrderNo\"='%s'" % siparis3)
        kontrol('Montajsiz siparis ODENDI', durum3 == '1', 'Status=' + durum3)

        # Ödeme sonrası tamamlama adımları çalıştı ama montaj kaydı AÇILMAMALI.
        # Durum sorgusu tamamlama adimlarini tetikliyor (sonuc sayfasinin yaptigi cagri).
        http(SHOP + '/api/payments/' + siparis3, 'GET', None, {'X-Shop-Session': token})
        kontrol('Montajsiz siparis icin MONTAJ KAYDI ACILMADI',
                sql("SELECT count(*) FROM \"Installations\" i JOIN \"SalesOrderLines\" l ON l.\"Id\"=i.\"SalesOrderLineId\" JOIN \"SalesOrders\" o ON o.\"Id\"=l.\"SalesOrderId\" WHERE o.\"OrderNo\"='%s'" % siparis3) == '0')

    # ---------------------------------------------------------------- 10. sipariş SMS'i
    print('\n10) Siparis onay SMS i')
    kutu = sms_kutusu()
    kontrol('Odeme onayinda "Siparisiniz alindi" SMS i gonderildi',
            any('Siparisiniz alindi' in k.get('message', '') for k in kutu),
            str([k.get('message', '')[:40] for k in kutu[:3]]))

    return ozet()


def ozet():
    print('\n' + '=' * 72)
    gecti = sum(1 for _, ok, _ in sonuclar if ok)
    kaldi = [b for b, ok, _ in sonuclar if not ok]
    print(' SONUC: %d/%d gecti' % (gecti, len(sonuclar)))
    if kaldi:
        print(' KALANLAR:')
        for b in kaldi:
            print('   - ' + b)
    print('=' * 72)
    return 0 if not kaldi else 1


if __name__ == '__main__':
    sys.exit(main())
