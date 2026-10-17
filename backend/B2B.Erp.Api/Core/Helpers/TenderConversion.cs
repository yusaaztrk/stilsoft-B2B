namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// KASA/BANKA ÇEVRİMİ — TEK KURAL (2026-08-17, kullanıcı isteği).
///
/// Bir tahsilat iki ayrı gerçeği taşır ve ikisi karıştırılırsa muhasebede fark çıkar:
///   1. <b>Gelen para</b> (tender): müşteri elden 1.000 DOLAR getirdi.
///   2. <b>İşlendiği hesap</b>: bu para hangi kasaya/bankaya yazıldı — TL, USD, EUR ya da GBP.
/// İkisi aynı olmak zorunda değildir: 1.000 doları TL kasaya günün kuruyla yazabiliriz.
///
/// <para>
/// ÇAPA TL'DİR VE TEK KAYNAKTAN ÜRETİLİR: <c>TL = tenderTutar × tenderKur</c>. Hesabın kendi
/// parasındaki tutar da bu TL çapasından türetilir (<c>TL / hesapKuru</c>). Böylece ekstredeki
/// "dolar kolonu" ile TL kolonu daima aynı tek sayıdan gelir; iki ayrı çarpma yapılmadığı için
/// kuruş farkı birikmez ve genel muhasebede fark oluşmaz.
/// </para>
///
/// <para>
/// TEK İSTİSNA — <b>çevrim yoksa TL'den geri dönülmez</b>: gelen para hesabın parasıyla aynıysa
/// (1.000 $ → dolar kasası) hesap tutarı doğrudan <c>tenderTutar</c>'dır. TL'ye çevirip geri
/// bölmek 1.000,00 $'ı 999,99 $ yapabilirdi; kolonun bozulduğu yer tam olarak burasıdır.
/// </para>
/// </summary>
public static class TenderConversion
{
    public readonly record struct Result(
        int TenderCurrencyTypeId,
        decimal TenderRate,
        decimal TenderAmount,
        int AccountCurrencyTypeId,
        decimal AccountRate,
        decimal AccountAmount,
        decimal TryAmount,
        bool IsConverted);

    /// <summary>
    /// Gelen paradan hareketin bütün tutarlarını üretir.
    /// </summary>
    /// <param name="accountCurrencyTypeId">Paranın işlendiği kasa/banka hesabının para birimi.</param>
    /// <param name="accountRate">O hesabın para biriminin TL kuru (TL hesapta 1).</param>
    /// <param name="tenderCurrencyTypeId">Gelen paranın para birimi. 0/negatif ise hesapla aynı sayılır.</param>
    /// <param name="tenderRate">Gelen paranın o günkü TL kuru. Verilmezse hesabın kuru kullanılır.</param>
    /// <param name="tenderAmount">Fiziken gelen/giden tutar, gelen paranın kendi biriminde.</param>
    public static Result Resolve(
        int accountCurrencyTypeId,
        decimal accountRate,
        int tenderCurrencyTypeId,
        decimal tenderRate,
        decimal tenderAmount)
    {
        var accountCurrency = CurrencyTypeHelper.Normalize(accountCurrencyTypeId);
        var accRate = CurrencyTypeHelper.IsTry(accountCurrency)
            ? 1m
            : (accountRate > 0m ? accountRate : 1m);

        // Gelen para belirtilmemişse hareket eskisi gibi tek para birimlidir.
        var tenderCurrency = tenderCurrencyTypeId > 0
            ? CurrencyTypeHelper.Normalize(tenderCurrencyTypeId)
            : accountCurrency;

        var tndRate = CurrencyTypeHelper.IsTry(tenderCurrency)
            ? 1m
            : (tenderRate > 0m ? tenderRate : (tenderCurrency == accountCurrency ? accRate : 1m));

        var tndAmount = tenderAmount > 0m ? tenderAmount : 0m;

        // TL çapası: paranın gerçek TL değeri. Her şey buradan türer.
        var tryAmount = Math.Round(tndAmount * tndRate, 2, MidpointRounding.AwayFromZero);

        decimal accountAmount;
        var isConverted = tenderCurrency != accountCurrency;

        if (!isConverted)
        {
            // Çevrim yok: hesap tutarı gelen tutarın ta kendisidir (TL'den geri bölme YOK).
            accountAmount = tndAmount;
        }
        else if (CurrencyTypeHelper.IsTry(accountCurrency))
        {
            accountAmount = tryAmount;
        }
        else
        {
            accountAmount = accRate > 0m
                ? Math.Round(tryAmount / accRate, 2, MidpointRounding.AwayFromZero)
                : tryAmount;
        }

        return new Result(
            TenderCurrencyTypeId: tenderCurrency,
            TenderRate: tndRate,
            TenderAmount: tndAmount,
            AccountCurrencyTypeId: accountCurrency,
            AccountRate: accRate,
            AccountAmount: accountAmount,
            TryAmount: tryAmount,
            IsConverted: isConverted);
    }
}
