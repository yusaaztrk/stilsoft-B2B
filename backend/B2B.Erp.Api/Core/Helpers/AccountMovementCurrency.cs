using B2B.Erp.Api.Features.Currency;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// Tutarı TL olarak bilinen bir ödemenin (maaş, prim, yemek, nakit avans) kasa/banka
/// hareketine nasıl yazılacağını çözer.
///
/// <para>
/// PROJE KURALI: bir hesap hareketi DAİMA hesabın kendi para birimine aittir
/// (<c>CashAccountTransactionsController</c>, <c>BankAccountTransactionsController</c>).
/// <c>Amount</c> TL değeri, <c>CurrencyAmount</c> hesabın para birimindeki değeri taşır.
/// Dolayısıyla TL bir maaş dolar kasadan ödenirse kasadan çıkan tutar TL rakamı değil,
/// o günün kuruyla dolar karşılığıdır.
/// </para>
///
/// <para>
/// Bu çözümleme atlanıp <c>CurrencyRate = 1</c> ve <c>CurrencyAmount = tryAmount</c>
/// yazılırsa dolar hesabın bakiyesi TL rakamı kadar azalır. Bakiye döviz başına yürüdüğü
/// ve döviz hesapta <c>CurrencyAmount</c> okunduğu için (<c>CashAccountsController</c>)
/// hata doğrudan bakiyeye vurur — 40.000 TL maaş, dolar kasadan 40.000 $ düşer.
/// </para>
/// </summary>
public static class AccountMovementCurrency
{
    /// <summary>
    /// Hesabın para birimi, o günün TL kuru ve hesabın para birimindeki tutar.
    /// TL hesapta kur 1 ve tutar aynen döner; kur servisine hiç gidilmez.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// Döviz hesapta kur alınamazsa. Çağıran 503 döndürmeli — sessizce 1 yazmak
    /// bakiyeyi bozar.
    /// </exception>
    public static Task<(int CurrencyTypeId, decimal Rate, decimal CurrencyAmount)> ResolveAsync(
        ICurrencyRateService money,
        int accountCurrencyTypeId,
        decimal tryAmount,
        CancellationToken cancellationToken = default)
        => ResolveAsync(money.GetLatestTryRateAsync, accountCurrencyTypeId, tryAmount, cancellationToken);

    /// <summary>
    /// Aynı çözümleme, kur servisini <see cref="Core.Interfaces.IMoneyServiceClient"/> olarak
    /// enjekte eden denetleyiciler için (çek/senet yolları). İki arayüz de aynı imzayı taşıyor;
    /// mantık tek yerde kalsın diye çağrı buraya devrediliyor.
    /// </summary>
    public static Task<(int CurrencyTypeId, decimal Rate, decimal CurrencyAmount)> ResolveAsync(
        Core.Interfaces.IMoneyServiceClient money,
        int accountCurrencyTypeId,
        decimal tryAmount,
        CancellationToken cancellationToken = default)
        => ResolveAsync(
            (code, ct) => money.GetLatestTryRateAsync(code, ct),
            accountCurrencyTypeId,
            tryAmount,
            cancellationToken);

    private static async Task<(int CurrencyTypeId, decimal Rate, decimal CurrencyAmount)> ResolveAsync(
        Func<string, CancellationToken, Task<decimal>> getLatestTryRate,
        int accountCurrencyTypeId,
        decimal tryAmount,
        CancellationToken cancellationToken)
    {
        var currencyTypeId = CurrencyTypeHelper.Normalize(accountCurrencyTypeId);

        if (CurrencyTypeHelper.IsTry(currencyTypeId))
        {
            return (currencyTypeId, 1m, tryAmount);
        }

        var code = CurrencyTypeHelper.ToCode(currencyTypeId)
            ?? throw new InvalidOperationException($"Hesabın para birimi tanınmıyor (kod {accountCurrencyTypeId}).");

        decimal rate;
        try
        {
            rate = await getLatestTryRate(code, cancellationToken);
        }
        catch
        {
            rate = 0m;
        }

        if (rate <= 0)
        {
            throw new InvalidOperationException($"{code} kuru alınamadı, ödeme kaydedilmedi. Lütfen sonra tekrar deneyin.");
        }

        return (currencyTypeId, rate, Math.Round(tryAmount / rate, 2, MidpointRounding.AwayFromZero));
    }
}
