namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// POS komisyonunun İÇİNDEKİ vergi bileşenlerini ayrıştırır (denetim md. A4).
///
/// <para>
/// Banka hesaptan TEK bir tutar çeker; komisyonun kendisi, üzerine BSMV, sonra KDV o tutarın
/// içindedir. Sistem bugüne kadar bu tutarı tek kalem gider olarak yazıyordu: KDV indirimi
/// için ayrıştırma elle yapılmak zorundaydı.
/// </para>
///
/// <para>
/// <b>Para hareketi değişmez.</b> Girilen tutar BRÜT'tür ve hesaptan aynen o kadar düşer;
/// burada üretilen değerler yalnızca o brüt tutarın içini açıklar. Toplam asla büyümez.
/// </para>
///
/// <para>
/// Ayrıştırma sırası mevzuattaki kuruluş sırasının tersidir (dışarıdan içeri):
/// brüt = ((komisyon × (1 + bsmv)) × (1 + kdv)). Dolayısıyla önce KDV, sonra BSMV çıkarılır.
/// Oranların ikisi de kullanıcı tarafından girilir; 0 verilirse o bileşen hiç hesaplanmaz.
/// </para>
/// </summary>
public static class PosFeeTaxBreakdown
{
    /// <summary>Ayrıştırma sonucu. Üç bileşenin toplamı daima brüt tutara eşittir.</summary>
    public readonly record struct Result(decimal Net, decimal BsmvAmount, decimal VatAmount);

    /// <summary>
    /// Oranlar yüzde olarak verilir (5 = %5). Negatif ya da anlamsız değerler yok sayılır:
    /// hatalı bir oran yüzünden gider tutarının bozulmasındansa ayrıştırmanın yapılmaması
    /// yeğdir — para hareketi her hâlükârda doğru kalır.
    /// </summary>
    public static Result Split(decimal grossAmount, decimal bsmvRatePercent, decimal vatRatePercent)
    {
        if (grossAmount <= 0m) return new Result(0m, 0m, 0m);

        var bsmv = bsmvRatePercent > 0m ? bsmvRatePercent / 100m : 0m;
        var vat = vatRatePercent > 0m ? vatRatePercent / 100m : 0m;

        if (bsmv <= 0m && vat <= 0m)
        {
            // Oran girilmemiş: ayrıştırma yok, brütün tamamı komisyondur.
            return new Result(Round(grossAmount), 0m, 0m);
        }

        // Dışarıdan içeri: önce KDV soyulur.
        var bsmvDahilKomisyon = vat > 0m ? grossAmount / (1m + vat) : grossAmount;
        var vatAmount = grossAmount - bsmvDahilKomisyon;

        // Sonra BSMV soyulur; geriye kalan çıplak komisyondur.
        var net = bsmv > 0m ? bsmvDahilKomisyon / (1m + bsmv) : bsmvDahilKomisyon;
        var bsmvAmount = bsmvDahilKomisyon - net;

        var vatRounded = Round(vatAmount);
        var bsmvRounded = Round(bsmvAmount);

        // Toplam brütü AŞMASIN ya da eksik kalmasın: yuvarlama artığı net tarafa yazılır,
        // çünkü üç bileşenin toplamı hesaptan düşen tutarla birebir tutmak zorundadır.
        var netRounded = Round(grossAmount) - vatRounded - bsmvRounded;

        return new Result(netRounded, bsmvRounded, vatRounded);
    }

    private static decimal Round(decimal value)
        => decimal.Round(value, 2, MidpointRounding.AwayFromZero);
}
