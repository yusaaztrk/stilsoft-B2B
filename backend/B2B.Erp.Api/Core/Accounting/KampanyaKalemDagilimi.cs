namespace B2B.Erp.Api.Core.Accounting;

/// <summary>
/// SİPARİŞTEN GELEN KAMPANYALI FATURADA İNDİRİMİN KALEMLERE DAĞILIMI (2026-09-30).
///
/// <para>
/// Satış faturası 2026-09-30'dan beri kalem kampanyasını KENDİ KALEMİNDEN düşüyor: kampanya o
/// kalemin matrahını ve kendi oranıyla KDV'sini küçültür; elle iskonto ile sipariş geneli
/// kampanya belgenin tamamına orantılı yayılır (bkz. InvoicesController, "KAMPANYA İNDİRİMİ
/// KDV MATRAHINDAN DÜŞER"). Fatura böylece siparişle kuruşu kuruşuna tutuyor.
/// </para>
///
/// <para>
/// <c>InvoiceLine</c>'da indirim alanı yok; indirim başlıkta TOPLAM olarak duruyor. Onu
/// kalemlere orantılı yayan okuyucu (fatura basımının KDV kırılımı) birden fazla KDV oranlı
/// faturada başlıktaki KDV'yi tutturamaz:
///   %16'lık 10.000 (1.000 kampanya) + %5'lik 10.000 → başlık KDV 1.940,00
///   orantılı kırılım 9.500 × %16 + 9.500 × %5 = 1.995,00 → TOPLAM K.D.V. ile çelişir.
/// Proformadan gelen faturadaki aynı sorun için bkz.
/// <c>InvoicePrintModelBuilder.LoadOfferLineDiscountsAsync</c>.
/// </para>
///
/// <para>
/// DOKUNMAMA KURALI: orantılı dağıtım başlığı zaten tutuyorsa null döner, okuyucu eskisi gibi
/// çalışır. Tek oranlı faturalarda ve bu tarihten önce kesilmiş (başlığı orantılı hesaplanmış)
/// faturalarda çıktı DEĞİŞMEZ. Kalem bazlı dağıtım yalnız başlığı O tutturuyorsa kullanılır;
/// ikisi de tutmuyorsa yine null döner (fatura sonradan değişmiş demektir, eski davranış kalır).
/// </para>
/// </summary>
public static class KampanyaKalemDagilimi
{
    /// <param name="Tutar">Kalemin indirimsiz tutarı (adet × birim fiyat), belgenin parasında.</param>
    /// <param name="Kampanya">Kaleme ait kampanya indirimi (KDV hariç), belgenin parasında.</param>
    /// <param name="KdvOrani">Yüzde olarak: 16, 10, 5, 0.</param>
    public readonly record struct Kalem(decimal Tutar, decimal Kampanya, decimal KdvOrani);

    /// <summary>Kalem başına NET indirim (belgenin parasında, kalem sırasıyla) ya da null.</summary>
    public static IReadOnlyList<decimal>? KalemIndirimleri(
        IReadOnlyList<Kalem> kalemler,
        decimal netToplam,
        decimal kdvToplam)
    {
        if (kalemler.Count == 0) return null;

        var kampanya = kalemler.Sum(k => k.Kampanya);
        if (kampanya <= 0m) return null;

        var brut = kalemler.Sum(k => k.Tutar);
        if (brut <= 0m) return null;

        // Her kalemin matrahı ve KDV'si ayrı yuvarlanıyor; kalem başına 1 kuruş pay.
        var tolerans = Math.Max(0.05m, 0.01m * kalemler.Count);

        // 1) Orantılı dağıtım başlığı zaten tutuyorsa DOKUNMA.
        var oransal = netToplam / brut;
        if (Math.Abs(KdvToplami(kalemler, k => k.Tutar * oransal) - kdvToplam) <= tolerans) return null;

        // 2) Kampanya kendi kaleminden; kalan indirim kampanya sonrası tutarlara orantılı.
        var kampanyaSonrasi = brut - kampanya;
        if (kampanyaSonrasi <= 0m) return null;

        var kalanOran = netToplam / kampanyaSonrasi;

        // Kayıtlı net, kampanyası düşülmüş tutardan büyükse fatura bu hesapla kesilmemiştir.
        if (kalanOran > 1.001m) return null;
        if (kalanOran > 1m) kalanOran = 1m;

        decimal Net(Kalem k) => (k.Tutar - k.Kampanya) * kalanOran;

        if (Math.Abs(KdvToplami(kalemler, Net) - kdvToplam) > tolerans) return null;

        return kalemler.Select(k => k.Tutar - Net(k)).ToList();
    }

    /// <summary>Fatura basımının hesabı: kalemin matrahı ve KDV'si ayrı ayrı yuvarlanır.</summary>
    private static decimal KdvToplami(IReadOnlyList<Kalem> kalemler, Func<Kalem, decimal> net)
        => kalemler.Sum(k => Yuvarla(Yuvarla(net(k)) * k.KdvOrani / 100m));

    private static decimal Yuvarla(decimal v) => decimal.Round(v, 2, MidpointRounding.AwayFromZero);
}
