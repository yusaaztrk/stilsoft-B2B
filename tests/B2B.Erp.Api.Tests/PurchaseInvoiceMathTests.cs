using B2B.Erp.Api.Core.Accounting;
using Xunit;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Alış faturası döviz matematiği (2026-08-29).
///
/// Kapsanan gerçek olaylar:
///  * TL alışın davranışı DEĞİŞMEMELİ — sistemdeki bütün alışlar TL, en büyük risk buydu.
///  * Dövizli alışta TL çapası belgenin KENDİ kuruyla hesaplanmalı.
///  * Cari deftere çifte çevrim yapılmamalı (beyanlı fatura zaten TL).
///  * Damgasız ESKİ faturaların davranışı korunmalı — iki nesil kayıt bir arada.
/// </summary>
public class PurchaseInvoiceMathTests
{
    // ───────────────────────── TL ÇAPASI ─────────────────────────

    [Fact]
    public void TlBelgede_TutarAynenKalir()
    {
        // TL alışın davranışı hiç değişmemeli: en sık kullanılan yol.
        Assert.Equal(157m, PurchaseInvoiceMath.TlCapasi(157m, 1, 1m));
        Assert.Equal(157m, PurchaseInvoiceMath.TlCapasi(157m, 1, 48.1331m)); // kur yok sayılır
    }

    [Fact]
    public void DamgasizBelgede_TutarAynenKalir()
    {
        // CurrencyTypeId = 0 "belirtilmemiş" demektir ve TL sayılır.
        Assert.Equal(157m, PurchaseInvoiceMath.TlCapasi(157m, 0, 48.1331m));
    }

    [Fact]
    public void DovizliBelgede_BelgeninKendiKuruylaCevrilir()
    {
        // 159 USD @ 48,1331 = 7.653,1629
        Assert.Equal(7653.1629m, PurchaseInvoiceMath.TlCapasi(159m, 3, 48.1331m));
    }

    [Fact]
    public void KurSifirsa_BireDuser_TutarKaybolmaz()
    {
        // Kur 0 gelirse tutarı sıfırlamak parayı yok etmek olurdu; 1 kabul edilir.
        Assert.Equal(159m, PurchaseInvoiceMath.TlCapasi(159m, 3, 0m));
    }

    // ───────────────────────── CARİ DEFTER ─────────────────────────

    [Fact]
    public void BeyanliDovizliFatura_CifteCevrilmez()
    {
        // Beyanlı faturada GrandTotal ZATEN TL çapasıdır. Kurla bir kez daha çarpılsaydı
        // tedarikçi borcu 48 katına çıkardı — düzeltilen asıl hata budur.
        var (tl, _) = PurchaseInvoiceMath.Ledger(
            grandTotal: 7653.16m, invoiceCurrencyTypeId: 3, invoiceRate: 48.1331m,
            customerCurrencyTypeId: 1, customerRate: 1m);

        Assert.Equal(7653.16m, tl);
    }

    [Fact]
    public void DamgasizEskiFatura_KurlaCarpilir()
    {
        // Damgası olmayan eski kayıtta tutar faturanın kendi para birimindedir; eski
        // davranış korunmalı, yoksa geçmiş tedarikçi bakiyeleri bozulur.
        var (tl, _) = PurchaseInvoiceMath.Ledger(
            grandTotal: 500m, invoiceCurrencyTypeId: 99, invoiceRate: 48.1331m,
            customerCurrencyTypeId: 1, customerRate: 1m);

        Assert.Equal(500m * 48.1331m, tl);
    }

    [Fact]
    public void DovizliCari_KendiParaBirimindeGorur()
    {
        // TL çapası 7.653,1629 (TlCapasi'nin ürettiği değer), cari USD, kur 48,1331 → 159,00 $
        //
        // NOT: buraya yuvarlanmış 7.653,16 verilirse sonuç 158,9999 çıkar. Bu bir hata değil,
        // ileri-geri çevrimin kaçınılmaz kuruş altı kaybıdır; testin kendisi bu yüzden
        // TlCapasi'nin gerçek çıktısını kullanıyor.
        var tlCapasi = PurchaseInvoiceMath.TlCapasi(159m, 3, 48.1331m);

        var (tl, cari) = PurchaseInvoiceMath.Ledger(
            grandTotal: tlCapasi, invoiceCurrencyTypeId: 3, invoiceRate: 48.1331m,
            customerCurrencyTypeId: 3, customerRate: 48.1331m);

        Assert.Equal(7653.1629m, tl);
        Assert.Equal(159.0000m, decimal.Round(cari, 4));
    }

    [Fact]
    public void TlCari_TlTutariAynenGorur()
    {
        var (tl, cari) = PurchaseInvoiceMath.Ledger(
            grandTotal: 1000m, invoiceCurrencyTypeId: 1, invoiceRate: 1m,
            customerCurrencyTypeId: 1, customerRate: 1m);

        Assert.Equal(1000m, tl);
        Assert.Equal(1000m, cari);
    }

    [Fact]
    public void CariKuruSifirsa_SifirDoner_BolmeHatasiVermez()
    {
        var (_, cari) = PurchaseInvoiceMath.Ledger(
            grandTotal: 1000m, invoiceCurrencyTypeId: 1, invoiceRate: 1m,
            customerCurrencyTypeId: 3, customerRate: 0m);

        Assert.Equal(0m, cari);
    }

    // ───────────────────────── KALEM HESABI ─────────────────────────

    [Fact]
    public void IskontosuzKalem_BrutNetAyni()
    {
        var s = PurchaseInvoiceMath.Satir(
            miktar: 3m, tlBirimFiyat: 100m,
            iskontoTipi: PurchaseInvoiceMath.IskontoTipi.Yok, iskontoDegeri: 0m,
            dovizTipi: 1, kur: 1m, kdvOrani: 16m, kdvIstisna: false);

        Assert.Equal(300m, s.Brut);
        Assert.Equal(0m, s.Iskonto);
        Assert.Equal(300m, s.Net);
        Assert.Equal(48m, s.Kdv);
    }

    [Fact]
    public void YuzdeIskontosu_ParaBiriminidenBagimsiz()
    {
        var s = PurchaseInvoiceMath.Satir(
            miktar: 2m, tlBirimFiyat: 500m,
            iskontoTipi: PurchaseInvoiceMath.IskontoTipi.Yuzde, iskontoDegeri: 10m,
            dovizTipi: 3, kur: 48.1331m, kdvOrani: 0m, kdvIstisna: false);

        Assert.Equal(1000m, s.Brut);
        Assert.Equal(100m, s.Iskonto);
        Assert.Equal(900m, s.Net);
    }

    [Fact]
    public void TutarIskontosu_DovizliBelgede_TlyeCevrilir()
    {
        // İskonto belgenin para biriminde girilir. 10 $ iskonto, kur 48,1331 → 481,331 ₺.
        var s = PurchaseInvoiceMath.Satir(
            miktar: 1m, tlBirimFiyat: 4813.31m,
            iskontoTipi: PurchaseInvoiceMath.IskontoTipi.Tutar, iskontoDegeri: 10m,
            dovizTipi: 3, kur: 48.1331m, kdvOrani: 0m, kdvIstisna: false);

        Assert.Equal(481.3310m, s.Iskonto);
        Assert.Equal(4813.31m - 481.3310m, s.Net);
    }

    [Fact]
    public void TutarIskontosu_AdetBasinadir_MiktarlaCarpilir()
    {
        // CANLI KANIT (2026-09-10, İA260910102928V): 3 adet × 19.914,29 ₺, İskonto alanına
        // ADET BAŞINA 2.956,98 ₺ girildi. Doğru toplam iskonto 3 × 2.956,98 = 8.870,94 ₺,
        // Net = 59.742,87 - 8.870,94 = 50.871,93 ₺. "Alış Siparişleri" listesi ve düzenleme
        // formunun özet kutusu bunu zaten doğru gösteriyordu (calcInvoiceTotalsWithConversion);
        // burası (kaydı besleyen backend hesabı) çarpmadığı için cari ekstreye giden İade
        // Faturası alacağı ~5.914 ₺ şişik (56.785,89 ₺) kaydediliyordu.
        var s = PurchaseInvoiceMath.Satir(
            miktar: 3m, tlBirimFiyat: 19914.29m,
            iskontoTipi: PurchaseInvoiceMath.IskontoTipi.Tutar, iskontoDegeri: 2956.98m,
            dovizTipi: 1, kur: 1m, kdvOrani: 0m, kdvIstisna: true);

        Assert.Equal(59742.87m, s.Brut);
        Assert.Equal(8870.94m, s.Iskonto);
        Assert.Equal(50871.93m, s.Net);
    }

    [Fact]
    public void Iskonto_BrutuAsamaz()
    {
        // Aksi hâlde net eksiye düşer ve fatura negatif borç yazardı.
        var s = PurchaseInvoiceMath.Satir(
            miktar: 1m, tlBirimFiyat: 100m,
            iskontoTipi: PurchaseInvoiceMath.IskontoTipi.Tutar, iskontoDegeri: 500m,
            dovizTipi: 1, kur: 1m, kdvOrani: 16m, kdvIstisna: false);

        Assert.Equal(100m, s.Iskonto);
        Assert.Equal(0m, s.Net);
        Assert.Equal(0m, s.Kdv);
    }

    [Fact]
    public void KdvIstisna_KdvSifir()
    {
        var s = PurchaseInvoiceMath.Satir(
            miktar: 1m, tlBirimFiyat: 1000m,
            iskontoTipi: PurchaseInvoiceMath.IskontoTipi.Yok, iskontoDegeri: 0m,
            dovizTipi: 1, kur: 1m, kdvOrani: 16m, kdvIstisna: true);

        Assert.Equal(0m, s.Kdv);
        Assert.Equal(1000m, s.Net);
    }

    // ───────────────────────── UÇTAN UCA SENARYOLAR ─────────────────────────

    [Fact]
    public void Senaryo_TlAlis_DavranisDegismedi()
    {
        // Kullanıcının en sık yaptığı iş: TL fatura, 3 adet × 100 ₺, KDV %16.
        var tl = PurchaseInvoiceMath.TlCapasi(100m, 1, 1m);
        var s = PurchaseInvoiceMath.Satir(3m, tl, PurchaseInvoiceMath.IskontoTipi.Yok, 0m, 1, 1m, 16m, false);
        var genel = s.Net + s.Kdv;
        var (defterTl, _) = PurchaseInvoiceMath.Ledger(genel, 1, 1m, 1, 1m);

        Assert.Equal(300m, s.Brut);
        Assert.Equal(348m, genel);
        Assert.Equal(348m, defterTl); // deftere aynen TL
    }

    [Fact]
    public void Senaryo_UsdAlis_TedarikciyeDogruTlBorc()
    {
        // 159 USD × 1 adet, kur 48,1331, KDV yok.
        // Beklenen tedarikçi borcu: 7.653,1629 ₺ — 48 katı DEĞİL.
        var tl = PurchaseInvoiceMath.TlCapasi(159m, 3, 48.1331m);
        var s = PurchaseInvoiceMath.Satir(1m, tl, PurchaseInvoiceMath.IskontoTipi.Yok, 0m, 3, 48.1331m, 0m, true);
        var (defterTl, defterDoviz) = PurchaseInvoiceMath.Ledger(s.Net + s.Kdv, 3, 48.1331m, 3, 48.1331m);

        Assert.Equal(7653.1629m, defterTl);
        Assert.Equal(159.0000m, decimal.Round(defterDoviz, 4));
    }

    [Fact]
    public void Senaryo_ElleKurDuzeltmesi_EfektifKuraUyar()
    {
        // Kullanıcı 159 $'lık malı gerçekte 3.800 ₺'ye almış; belge TL, fiyat elle 3.800.
        // Sistem hiçbir çevrim yapmamalı — yazılan sayı neyse o.
        var tl = PurchaseInvoiceMath.TlCapasi(3800m, 1, 1m);
        Assert.Equal(3800m, tl);

        var (defterTl, _) = PurchaseInvoiceMath.Ledger(3800m, 1, 1m, 1, 1m);
        Assert.Equal(3800m, defterTl);
    }

    [Fact]
    public void Senaryo_KismiTeslim_HerPartiKendiKuruyla()
    {
        // Aynı üründen iki parti: ilki 48,00 kurla, ikincisi 47,00 kurla.
        // Her partinin TL maliyeti KENDİ kuruyla donmalı; ikinci parti birinciyi bozmamalı.
        var parti1 = PurchaseInvoiceMath.TlCapasi(159m, 3, 48.0000m);
        var parti2 = PurchaseInvoiceMath.TlCapasi(159m, 3, 47.0000m);

        Assert.Equal(7632m, parti1);
        Assert.Equal(7473m, parti2);
        Assert.NotEqual(parti1, parti2);
    }

    /*
      TEDARİKÇİ DEFTERİ — ÇİFTE ÇEVRİM (2026-09-01 canlı hatası).

      348.250 $'lık teslimat faturası tedarikçi ekstresine 811.127.560 TL ve "16.806.997,76 $"
      olarak yazıldı. Sebep: `GrandTotal` TL çapası olduğu hâlde bir kez daha kurla çarpılıyordu.
      Müşteri defteri dalı korunuyordu, tedarikçi dalı korunmuyordu.
    */
    [Fact]
    public void Ledger_DamgaliDovizliFatura_TedarikciDefterindeCifteCevrimYapmaz()
    {
        // 348.250 $ x 48,2613 = 16.806.997,76 TL  (kayıttaki GrandTotal)
        const decimal tlCapasi = 16_806_997.76m;
        const decimal kur = 48.2613m;

        var (tryAmount, dovizAmount) = PurchaseInvoiceMath.Ledger(
            grandTotal: tlCapasi,
            invoiceCurrencyTypeId: 3,   // USD damgalı
            invoiceRate: kur,
            customerCurrencyTypeId: 3,
            customerRate: kur);

        // TL çapası OLDUĞU GİBİ kalmalı; ikinci kez çarpılırsa 811 milyon olur.
        Assert.Equal(tlCapasi, tryAmount);
        Assert.True(tryAmount < 20_000_000m, "TL tutarı kur katı şişmiş - çifte çevrim geri geldi");

        // Döviz karşılığı faturanın kendi tutarı olmalı.
        Assert.Equal(348_250m, Math.Round(dovizAmount, 0));
    }

    [Fact]
    public void Ledger_TlFatura_KurUygulanmaz()
    {
        var (tryAmount, dovizAmount) = PurchaseInvoiceMath.Ledger(
            grandTotal: 100_000m, invoiceCurrencyTypeId: 1, invoiceRate: 1m,
            customerCurrencyTypeId: 1, customerRate: 1m);

        Assert.Equal(100_000m, tryAmount);
        Assert.Equal(100_000m, dovizAmount);
    }

    /*
      DAMGASIZ (0) FATURA TL SAYILIR, ÇARPILMAZ.

      İlk yazdığım test bunun kurla çarpılmasını bekliyordu ve KALDI — beklenti yanlıştı,
      kod doğru. `IsTry(0)` true olduğu için 0 zaten TL kovasına düşüyor (0 eski kayıtlarda
      "belirtilmemiş" demek ve sistemdeki her eski alış TL'ydi). Yani `grandTotal * kur`
      dalına hiçbir gerçek değer ulaşmıyor: çifte çevrim kapısı TAM kapalı.
    */
    [Fact]
    public void Ledger_DamgasizFatura_TlSayilirCarpilmaz()
    {
        var (tryAmount, dovizAmount) = PurchaseInvoiceMath.Ledger(
            grandTotal: 1_000m, invoiceCurrencyTypeId: 0, invoiceRate: 48.2613m,
            customerCurrencyTypeId: 1, customerRate: 1m);

        Assert.Equal(1_000m, tryAmount);
        Assert.Equal(1_000m, dovizAmount);
    }
}
