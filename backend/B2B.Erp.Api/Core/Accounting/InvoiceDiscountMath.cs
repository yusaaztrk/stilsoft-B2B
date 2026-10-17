namespace B2B.Erp.Api.Core.Accounting;

/// <summary>
/// Fatura iskontosunun net / KDV ayrımı.
///
/// <para>
/// Satıcı iskontoyu MÜŞTERİNİN ÖDEYECEĞİ tutar üzerinden girer: liste KDV dahil 7.400,00 →
/// 800,00 iskonto → tahsil edilecek 6.600,00. Bu yüzden girilen iskonto KDV DAHİLDİR ve net
/// ile KDV'ye oranlı olarak dağıtılmalıdır.
/// </para>
///
/// <para>
/// Eski hesap iskontoyu NET'ten düşüp KDV'yi iskontosuz brütten alıyordu; genel toplam
/// tesadüfen tutuyor ama içindeki ayrım yanlış oluyordu (KDV fazla, net eksik). Fatura
/// basımındaki "KDV kırılımı 892,69 / TOPLAM K.D.V. 1.020,69" çelişkisi buradan geliyordu.
/// </para>
///
/// <para>
/// Ayrı sınıf olmasının sebebi ÖLÇÜLEBİLİRLİK: hesap üç ayrı uçta (satış faturası, üst bilgi
/// güncelleme, kalem silme) tekrarlanıyordu ve hiçbiri test edilemiyordu. Para ve KDV beyanı
/// söz konusu olduğu için tek kaynak + test şart.
/// </para>
/// </summary>
public static class InvoiceDiscountMath
{
    public readonly record struct Sonuc(
        decimal NetToplam,
        decimal KdvToplam,
        decimal GenelToplam,
        decimal NetIskonto);

    /// <param name="brut">Kalemlerin KDV hariç toplamı (Subtotal).</param>
    /// <param name="brutKdv">Kalemlerin KDV'si, iskonto UYGULANMADAN.</param>
    /// <param name="kdvDahilIskonto">Kullanıcının girdiği iskonto (KDV dahil).</param>
    public static Sonuc Hesapla(decimal brut, decimal brutKdv, decimal kdvDahilIskonto)
    {
        if (brut < 0m) brut = 0m;
        if (brutKdv < 0m) brutKdv = 0m;
        if (kdvDahilIskonto < 0m) kdvDahilIskonto = 0m;

        var kdvDahilTaban = brut + brutKdv;

        // İskonto belgenin tamamını aşamaz.
        if (kdvDahilIskonto > kdvDahilTaban) kdvDahilIskonto = kdvDahilTaban;

        if (kdvDahilTaban <= 0m)
        {
            return new Sonuc(0m, 0m, 0m, 0m);
        }

        var kalanOran = (kdvDahilTaban - kdvDahilIskonto) / kdvDahilTaban;

        // GENEL TOPLAM ÖNCE ve TAM hesaplanır: müşteriyle anlaşılan tutar budur, yuvarlama
        // artığı yüzünden 1 kuruş kaymamalı.
        var genelToplam = Yuvarla(kdvDahilTaban - kdvDahilIskonto);

        var netToplam = Yuvarla(brut * kalanOran);

        // KDV genel toplamdan TÜRETİLİR; böylece `net + KDV = genel toplam` her zaman birebir
        // tutar. Ayrı ayrı yuvarlansaydı toplam 1 kuruş şaşabilirdi.
        var kdvToplam = genelToplam - netToplam;
        if (kdvToplam < 0m) kdvToplam = 0m;

        // Saklanan iskonto NET karşılığıdır: `Brüt − İskonto = Net` bağıntısı korunur, basımdaki
        // "BRÜT TUTAR − İNDİRİM = NET TOPLAM" satırı tutarlı olur.
        var netIskonto = brut - netToplam;
        if (netIskonto < 0m) netIskonto = 0m;

        return new Sonuc(netToplam, kdvToplam, genelToplam, netIskonto);
    }

    private static decimal Yuvarla(decimal v) => decimal.Round(v, 2, MidpointRounding.AwayFromZero);
}
