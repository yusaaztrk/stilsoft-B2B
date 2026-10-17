namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// Para birimi yardımcısı — <b>tüm mantık <see cref="CurrencyTypeHelper"/>'a devredilir.</b>
///
/// <para>
/// Bu sınıf ayrı bir kaynak DEĞİLDİR. İki ayrı "tek doğru kaynak" tutmak, bu projenin
/// 2026-08-14'te temizlediği hatanın ta kendisiydi: <c>CurrencyTypeId</c> ile
/// <c>Product.CurrencyCode</c> iki ayrı kodlamaydı ve <c>3</c> birinde USD, diğerinde GBP
/// anlamına geliyordu. Ürün kodu <c>CurrencyTypeId</c> beklenen bir yere geçtiğinde sterlin
/// sessizce dolara dönüyordu.
/// </para>
///
/// <para>
/// Artık sistemde <b>tek kodlama</b> var: <c>1=TRY 2=EUR 3=USD 4=GBP</c> (0 = TL, eski
/// varsayılan). Eski ürün kodlaması tek bir <c>UPDATE</c> ile göç ettirildi
/// (<c>Program.cs</c>, <c>migration:productcurrency-v2</c>).
/// </para>
///
/// <para>
/// Sınıf yalnızca <b>geriye dönük uyumluluk</b> için duruyor: onlarca çağrı noktası bu adı
/// kullanıyor. Yeni kod doğrudan <see cref="CurrencyTypeHelper"/> çağırmalıdır.
/// </para>
/// </summary>
public static class ProductCurrencyHelper
{
    public const int Try = CurrencyTypeHelper.Try;
    public const int Eur = CurrencyTypeHelper.Eur;
    public const int Usd = CurrencyTypeHelper.Usd;
    public const int Gbp = CurrencyTypeHelper.Gbp;

    /// <summary>0 (eski varsayılan) TL'ye normalize edilir.</summary>
    public static int Normalize(int currencyTypeId) => CurrencyTypeHelper.Normalize(currencyTypeId);

    /// <summary>Bilinen bir para birimi mi? 0 da geçerlidir (TL).</summary>
    public static bool IsValid(int currencyTypeId) => CurrencyTypeHelper.IsKnown(currencyTypeId);

    public static int MapCurrencyStringToCurrencyTypeId(string? currency, int defaultTypeId = Try)
    {
        if (string.IsNullOrWhiteSpace(currency)) return defaultTypeId;
        return (currency.Trim().ToUpperInvariant()) switch
        {
            "USD" => Usd,
            "EUR" => Eur,
            "GBP" => Gbp,
            "TL" or "TRY" => Try,
            _ => defaultTypeId
        };
    }

    /// <summary>
    /// Ürün kartının para birimi artık aynı kodlamayı kullanır; ayrı bir ürün kodlaması
    /// kalmadığı için bu ad yalnızca mevcut çağrılar için duruyor.
    /// </summary>
    public static int MapCurrencyStringToProductCurrencyCode(string? currency, int defaultCode = Try)
        => MapCurrencyStringToCurrencyTypeId(currency, defaultCode);

    /// <summary>Ekranda gösterilecek simge.</summary>
    public static string MapCurrencyTypeIdToSymbol(int currencyTypeId) => Normalize(currencyTypeId) switch
    {
        Eur => "€",
        Usd => "$",
        Gbp => "£",
        _ => "₺"
    };

    /// <summary>Ekran kodu — TL için "TL" (ISO değil).</summary>
    public static string MapCurrencyTypeIdToCode(int currencyTypeId) => Normalize(currencyTypeId) switch
    {
        Eur => "EUR",
        Usd => "USD",
        Gbp => "GBP",
        _ => "TL"
    };

    /// <summary>Kur servisi için ISO kodu — TL için "TRY".</summary>
    public static string MapCurrencyTypeIdToIsoCode(int currencyTypeId)
        => CurrencyTypeHelper.ToCodeOrTry(currencyTypeId);
}
