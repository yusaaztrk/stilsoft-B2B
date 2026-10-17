using B2B.Erp.Api.Core.Accounting;
using Xunit;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// İskontonun net / KDV ayrımı. Sayılar CANLI faturalardan alındı (2026-08-26 incelemesi),
/// uydurulmadı — böylece test "kod ne yapıyorsa o" değil, "sahada ne olması gerekiyorsa o"
/// diyor.
/// </summary>
public class InvoiceDiscountMathTests
{
    /// <summary>
    /// A00000000071245 — kullanıcının bildirdiği fatura.
    /// Liste KDV dahil 7.400,00 · girilen iskonto 800,00 · tahsil edilecek 6.600,00.
    /// </summary>
    [Fact]
    public void CanliFatura_071245_BeklenenAyrimiUretir()
    {
        var s = InvoiceDiscountMath.Hesapla(brut: 6379.31m, brutKdv: 1020.69m, kdvDahilIskonto: 800m);

        // Beklenen değerler ELLE çıkarıldı, koddan kopyalanmadı:
        //   oran = 6.600 / 7.400
        //   net  = 6.379,31 x oran = 5.689,6549  -> 5.689,65
        //   KDV  = 6.600,00 - 5.689,65           =   910,35
        //   iskontonun net karşılığı             =   689,66  (kullanıcının beklediği rakam)
        // NOT: 6.379,31 x 1,16 = 7.399,9996'dır, tam 7.400 değil; bu yüzden "6.600/1,16"
        // kestirmesi 1 kuruş yukarıda (5.689,66) çıkar. Doğrusu kalemlerden gelen zincirdir.
        Assert.Equal(6600.00m, s.GenelToplam);   // müşteriyle anlaşılan tutar DEĞİŞMEZ
        Assert.Equal(5689.65m, s.NetToplam);
        Assert.Equal(910.35m, s.KdvToplam);
        Assert.Equal(689.66m, s.NetIskonto);
    }

    /// <summary>
    /// A00000000071173 — 580.000,00'lık büyük fatura, karışık KDV oranlı.
    /// Kalemlerin KDV dahil toplamı 737.299,96, iskonto 157.299,96.
    /// </summary>
    [Fact]
    public void CanliFatura_071173_GenelToplamiKorur()
    {
        var s = InvoiceDiscountMath.Hesapla(brut: 694242.98m, brutKdv: 43056.98m, kdvDahilIskonto: 157299.96m);

        Assert.Equal(580000.00m, s.GenelToplam);
        Assert.Equal(s.GenelToplam, s.NetToplam + s.KdvToplam);
        Assert.Equal(694242.98m - s.NetToplam, s.NetIskonto);
    }

    /// <summary>Net + KDV her zaman genel toplama BİREBİR eşit olmalı (yuvarlama kayması yok).</summary>
    [Theory]
    [InlineData(6379.31, 1020.69, 800)]
    [InlineData(694242.98, 43056.98, 157299.96)]
    [InlineData(11379.32, 1820.69, 2275.86)]
    [InlineData(2413.79, 386.21, 516.55)]
    [InlineData(1068.97, 171.04, 40)]
    [InlineData(100, 16, 33.33)]
    [InlineData(0.01, 0.00, 0)]
    public void NetArtiKdv_HerZaman_GenelToplamaEsittir(double brut, double kdv, double iskonto)
    {
        var s = InvoiceDiscountMath.Hesapla((decimal)brut, (decimal)kdv, (decimal)iskonto);
        Assert.Equal(s.GenelToplam, s.NetToplam + s.KdvToplam);
    }

    /// <summary>Brüt − İskonto = Net bağıntısı basımdaki üç satırın tutarlılığı için şart.</summary>
    [Theory]
    [InlineData(6379.31, 1020.69, 800)]
    [InlineData(694242.98, 43056.98, 157299.96)]
    [InlineData(2586.21, 413.79, 699.90)]
    public void BrutEksiIskonto_NetiVerir(double brut, double kdv, double iskonto)
    {
        var s = InvoiceDiscountMath.Hesapla((decimal)brut, (decimal)kdv, (decimal)iskonto);
        Assert.Equal((decimal)brut - s.NetIskonto, s.NetToplam);
    }

    /// <summary>
    /// KDV'siz cari (Açık / Askeriye): `brutKdv = 0`. Formül ESKİ davranışa aynen düşmeli,
    /// yoksa KDV'siz carilerde iskonto sessizce değişirdi.
    /// </summary>
    [Theory]
    [InlineData(1000, 200)]
    [InlineData(6379.31, 800)]
    [InlineData(0.05, 0.01)]
    public void KdvsizCaride_EskiDavranisaDuser(double brut, double iskonto)
    {
        var s = InvoiceDiscountMath.Hesapla((decimal)brut, 0m, (decimal)iskonto);

        Assert.Equal(0m, s.KdvToplam);
        Assert.Equal((decimal)iskonto, s.NetIskonto);
        Assert.Equal((decimal)brut - (decimal)iskonto, s.NetToplam);
        Assert.Equal((decimal)brut - (decimal)iskonto, s.GenelToplam);
    }

    /// <summary>İskonto yoksa hiçbir şey değişmemeli — en sık senaryo bu.</summary>
    [Fact]
    public void IskontoYoksa_TutarlarAynenKalir()
    {
        var s = InvoiceDiscountMath.Hesapla(1000m, 160m, 0m);

        Assert.Equal(1000m, s.NetToplam);
        Assert.Equal(160m, s.KdvToplam);
        Assert.Equal(1160m, s.GenelToplam);
        Assert.Equal(0m, s.NetIskonto);
    }

    /// <summary>İskonto belgeyi aşarsa kırpılır; eksi tutar üretilmez.</summary>
    [Fact]
    public void AsiriIskonto_SifiraKirpilir()
    {
        var s = InvoiceDiscountMath.Hesapla(1000m, 160m, 99999m);

        Assert.Equal(0m, s.GenelToplam);
        Assert.Equal(0m, s.NetToplam);
        Assert.Equal(0m, s.KdvToplam);
        Assert.Equal(1000m, s.NetIskonto);
    }

    /// <summary>Negatif giriş savunması — hiçbir alan eksiye düşmemeli.</summary>
    [Fact]
    public void NegatifGirdi_EksiUretmez()
    {
        var s = InvoiceDiscountMath.Hesapla(-5m, -3m, -10m);

        Assert.True(s.NetToplam >= 0m);
        Assert.True(s.KdvToplam >= 0m);
        Assert.True(s.GenelToplam >= 0m);
        Assert.True(s.NetIskonto >= 0m);
    }

    /// <summary>Sıfır tutarlı belge bölme hatası vermemeli.</summary>
    [Fact]
    public void SifirBelge_PatlamazSifirDoner()
    {
        var s = InvoiceDiscountMath.Hesapla(0m, 0m, 100m);

        Assert.Equal(0m, s.GenelToplam);
        Assert.Equal(0m, s.NetToplam);
        Assert.Equal(0m, s.KdvToplam);
    }
}
