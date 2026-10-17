namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// Ekstre satırının kendi para birimindeki tutarını çözer.
///
/// <para>
/// <c>Amount</c> her zaman TL çapasıdır, <c>CurrencyAmount</c> satırın kendi parasıdır. Eski
/// (ya da bozuk) satırlarda <c>CurrencyAmount</c> boş kalabiliyor; o durumda değer TL'de
/// <c>Amount</c>'tan, dövizde <c>Amount / kur</c>'dan türetilir — aksi halde satır döviz
/// bakiyesine hiç girmez ve bakiye sessizce eksik çıkar.
/// </para>
///
/// <para>
/// Bu mantık ekstre okuyucusunda (<c>CustomerLedgerController</c>) vardı ama dönem kapanışı
/// (<c>AccountingPeriodService</c>) ham <c>CurrencyAmount</c> topluyordu: dövizli satırda
/// döviz bakiyesi 0 görünüp TL tutar döviz gibi devrediyordu. Tek kaynak burası.
/// </para>
/// </summary>
public static class LedgerAmount
{
    public static decimal InCurrency(int currencyTypeId, decimal amount, decimal currencyAmount, decimal rate)
    {
        if (currencyAmount > 0m) return currencyAmount;
        if (CurrencyTypeHelper.IsTry(currencyTypeId)) return amount;
        return rate > 0m ? Math.Round(amount / rate, 2, MidpointRounding.AwayFromZero) : amount;
    }
}
