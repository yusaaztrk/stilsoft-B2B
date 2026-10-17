using B2B.Erp.Api.Features.Payment;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Tahsilat motorunun para birimi matematiği.
///
/// <para>
/// Motor ÜÇ para birimi tanır — borç · ödeme · para üstü — ama uzun süre yalnızca İKİ kur
/// taşıyordu. Borcun kendi kuru yoktu, dolayısıyla borç tarafı ÖDEME kuruyla çevriliyordu.
/// Borç ile ödeme aynı paradayken ya da biri TL iken sonuç doğru çıkıyor, bu yüzden hata
/// gözle görünmüyordu; <b>çapraz dövizde ise borcu yanlış kapatıyordu.</b>
/// </para>
/// </summary>
public class PaymentEngineCurrencyTests
{
    private const int Try = 1;
    private const int Eur = 2;
    private const int Usd = 3;

    // --- Çapraz döviz: hatanın ta kendisi -----------------------------------------------------

    [Fact]
    public void Cross_currency_payment_uses_the_debt_currency_rate()
    {
        // 100 EUR borç (kur 40) · 100 USD ödeme (kur 38) = 3.800 ₺
        // Doğrusu: 3.800 / 40 = 95 EUR tahsil. Borç KAPANMAZ, 5 EUR kalır.
        var result = PaymentEngine.Calculate(new PaymentCalculationRequest
        {
            DebtAmount = 100m,
            DebtCurrencyTypeId = Eur,
            DebtExchangeRate = 40m,
            ReceivedAmount = 100m,
            PaymentCurrencyTypeId = Usd,
            ExchangeRate = 38m
        });

        Assert.Equal(3800m, result.ReceivedAmountInTry);
        Assert.Equal(95m, result.ReceivedAmountInDebtCurrency);
        Assert.Equal(5m, result.RemainingDebtAmount);
        Assert.False(result.IsFullPayment);
    }

    [Fact]
    public void Cross_currency_payment_does_not_close_the_debt_by_face_value()
    {
        // Kur verilmezse motor ödeme kuruna düşer ve 100 USD, 100 EUR borcu KAPATIRDI.
        // Borcun kuru verildiğinde bu bir daha olmamalı — asıl regresyon bariyeri budur.
        var wrong = PaymentEngine.Calculate(new PaymentCalculationRequest
        {
            DebtAmount = 100m,
            DebtCurrencyTypeId = Eur,
            ReceivedAmount = 100m,
            PaymentCurrencyTypeId = Usd,
            ExchangeRate = 38m
        });

        var right = PaymentEngine.Calculate(new PaymentCalculationRequest
        {
            DebtAmount = 100m,
            DebtCurrencyTypeId = Eur,
            DebtExchangeRate = 40m,
            ReceivedAmount = 100m,
            PaymentCurrencyTypeId = Usd,
            ExchangeRate = 38m
        });

        Assert.True(wrong.IsFullPayment);      // eski (kursuz) davranış: borç kapanıyor
        Assert.False(right.IsFullPayment);     // borcun kendi kuruyla: kapanmıyor
    }

    // --- Davranışın DEĞİŞMEMESİ gereken hâller ------------------------------------------------

    [Fact]
    public void Same_currency_is_unaffected()
    {
        // Borç ve ödeme aynı paradaysa iki kur zaten eşit; sonuç eskisiyle birebir aynı olmalı.
        var withDebtRate = PaymentEngine.Calculate(new PaymentCalculationRequest
        {
            DebtAmount = 100m, DebtCurrencyTypeId = Usd, DebtExchangeRate = 38m,
            ReceivedAmount = 100m, PaymentCurrencyTypeId = Usd, ExchangeRate = 38m
        });

        var withoutDebtRate = PaymentEngine.Calculate(new PaymentCalculationRequest
        {
            DebtAmount = 100m, DebtCurrencyTypeId = Usd,
            ReceivedAmount = 100m, PaymentCurrencyTypeId = Usd, ExchangeRate = 38m
        });

        Assert.Equal(withoutDebtRate.ReceivedAmountInTry, withDebtRate.ReceivedAmountInTry);
        Assert.Equal(withoutDebtRate.ReceivedAmountInDebtCurrency, withDebtRate.ReceivedAmountInDebtCurrency);
        Assert.Equal(withoutDebtRate.RemainingDebtAmount, withDebtRate.RemainingDebtAmount);
        Assert.True(withDebtRate.IsFullPayment);
    }

    [Fact]
    public void Foreign_debt_paid_in_lira()
    {
        // 100 USD borç (kur 38), 3.800 ₺ ödeme → tam kapanır.
        var result = PaymentEngine.Calculate(new PaymentCalculationRequest
        {
            DebtAmount = 100m, DebtCurrencyTypeId = Usd, DebtExchangeRate = 38m,
            ReceivedAmount = 3800m, PaymentCurrencyTypeId = Try, ExchangeRate = 38m
        });

        Assert.Equal(100m, result.ReceivedAmountInDebtCurrency);
        Assert.True(result.IsFullPayment);
        Assert.Equal(0m, result.RemainingDebtAmount);
    }

    [Fact]
    public void Lira_debt_paid_in_foreign_currency()
    {
        // 3.800 ₺ borç, 100 USD ödeme (kur 38) → tam kapanır.
        var result = PaymentEngine.Calculate(new PaymentCalculationRequest
        {
            DebtAmount = 3800m, DebtCurrencyTypeId = Try, DebtExchangeRate = 1m,
            ReceivedAmount = 100m, PaymentCurrencyTypeId = Usd, ExchangeRate = 38m
        });

        Assert.Equal(3800m, result.ReceivedAmountInTry);
        Assert.True(result.IsFullPayment);
    }

    [Fact]
    public void Pure_lira_payment_is_untouched()
    {
        var result = PaymentEngine.Calculate(new PaymentCalculationRequest
        {
            DebtAmount = 1000m, DebtCurrencyTypeId = Try,
            ReceivedAmount = 1000m, PaymentCurrencyTypeId = Try
        });

        Assert.Equal(1000m, result.ReceivedAmountInTry);
        Assert.Equal(1000m, result.ReceivedAmountInDebtCurrency);
        Assert.True(result.IsFullPayment);
        Assert.Equal(0m, result.ChangeAmount);
    }

    // --- Fazla ödeme / para üstü ---------------------------------------------------------------

    [Fact]
    public void Overpayment_of_a_foreign_debt_returns_change_in_lira()
    {
        // 100 USD borç (kur 38 = 3.800 ₺), 4.000 ₺ ödendi → 200 ₺ para üstü.
        var result = PaymentEngine.Calculate(new PaymentCalculationRequest
        {
            DebtAmount = 100m, DebtCurrencyTypeId = Usd, DebtExchangeRate = 38m,
            ReceivedAmount = 4000m, PaymentCurrencyTypeId = Try, ExchangeRate = 38m,
            ChangeCurrencyTypeId = Try
        });

        Assert.True(result.IsFullPayment);
        Assert.Equal(200m, result.ChangeAmountInTry);
        Assert.Equal(200m, result.ChangeAmount);
    }

    [Fact]
    public void Partial_payment_leaves_the_remainder_in_the_debt_currency()
    {
        // 100 USD borç, 1.900 ₺ ödeme (kur 38) = 50 USD → 50 USD kalır.
        var result = PaymentEngine.Calculate(new PaymentCalculationRequest
        {
            DebtAmount = 100m, DebtCurrencyTypeId = Usd, DebtExchangeRate = 38m,
            ReceivedAmount = 1900m, PaymentCurrencyTypeId = Try, ExchangeRate = 38m
        });

        Assert.Equal(50m, result.ReceivedAmountInDebtCurrency);
        Assert.Equal(50m, result.RemainingDebtAmount);
        Assert.False(result.IsFullPayment);
        Assert.Equal(0m, result.ChangeAmount);
    }

    // --- TL çapası değişmezi -------------------------------------------------------------------

    [Theory]
    [InlineData(Try, 1, Try, 1)]
    [InlineData(Usd, 38, Usd, 38)]
    [InlineData(Usd, 38, Try, 38)]
    [InlineData(Eur, 40, Usd, 38)]
    public void Tl_anchor_holds_amount_equals_debt_amount_times_debt_rate(
        int debtCurrency, decimal debtRate, int payCurrency, decimal payRate)
    {
        var result = PaymentEngine.Calculate(new PaymentCalculationRequest
        {
            DebtAmount = 100m,
            DebtCurrencyTypeId = debtCurrency,
            DebtExchangeRate = debtRate,
            ReceivedAmount = 10m,
            PaymentCurrencyTypeId = payCurrency,
            ExchangeRate = payRate
        });

        // Deftere yazılan TL tutar, borç dövizindeki tutarın KENDİ kuruyla çarpımı olmalı.
        var expectedTry = result.AppliedToDebtAmount * debtRate;
        Assert.Equal(
            Math.Round(expectedTry, 2, MidpointRounding.AwayFromZero),
            result.AppliedToDebtAmountInTry);
    }
}
