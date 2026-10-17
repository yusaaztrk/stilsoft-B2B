using System;

namespace B2B.Erp.Api.Features.Payment;

public static class PaymentEngine
{
    public static PaymentCalculationResult Calculate(PaymentCalculationRequest req)
    {
        ArgumentNullException.ThrowIfNull(req);

        var debtCurr = NormalizeCurrencyTypeId(req.DebtCurrencyTypeId);
        var payCurr = NormalizeCurrencyTypeId(req.PaymentCurrencyTypeId);
        var changeCurr = NormalizeCurrencyTypeId(req.ChangeCurrencyTypeId);

        var debtAmount = Math.Max(0m, req.DebtAmount);
        var receivedAmount = Math.Max(0m, req.ReceivedAmount);
        var rate = req.ExchangeRate > 0m ? req.ExchangeRate : 1m;
        var changeRate = req.ChangeExchangeRate > 0m ? req.ChangeExchangeRate : 1m;

        // BORCUN KENDİ KURU. Verilmezse ödeme kuruna düşer — borç ve ödeme aynı paradayken
        // ikisi zaten eşit olduğu için davranış birebir korunur. Farklı olduklarında ise
        // borç tarafı artık KENDİ kuruyla çevriliyor (bkz. PaymentCalculationRequest).
        var debtRate = req.DebtExchangeRate > 0m ? req.DebtExchangeRate : rate;

        // 1. Calculate Received Amount in TRY
        decimal receivedAmountInTry;
        if (payCurr == 1) // TRY
        {
            receivedAmountInTry = Math.Round(receivedAmount, 2, MidpointRounding.AwayFromZero);
        }
        else
        {
            // Payment is in FC (e.g. USD). rate = 1 USD = X TRY
            receivedAmountInTry = Math.Round(receivedAmount * rate, 2, MidpointRounding.AwayFromZero);
        }

        // 2. Calculate Debt Amount in TRY
        decimal debtAmountInTry;
        if (debtCurr == 1) // TRY
        {
            debtAmountInTry = Math.Round(debtAmount, 2, MidpointRounding.AwayFromZero);
        }
        else
        {
            debtAmountInTry = Math.Round(debtAmount * debtRate, 2, MidpointRounding.AwayFromZero);
        }

        // 3. Calculate Received Amount in Debt Currency
        decimal receivedInDebtCurr;
        if (debtCurr == payCurr)
        {
            receivedInDebtCurr = Math.Round(receivedAmount, 2, MidpointRounding.AwayFromZero);
        }
        else if (debtCurr == 1 && payCurr != 1)
        {
            // Debt is TRY, Payment is USD
            receivedInDebtCurr = receivedAmountInTry;
        }
        else if (debtCurr != 1 && payCurr == 1)
        {
            // Debt is USD, Payment is TRY
            receivedInDebtCurr = debtRate > 0m ? Math.Round(receivedAmount / debtRate, 2, MidpointRounding.AwayFromZero) : receivedAmount;
        }
        else
        {
            // Cross currency (e.g. EUR debt paid in USD)
            receivedInDebtCurr = debtRate > 0m ? Math.Round(receivedAmountInTry / debtRate, 2, MidpointRounding.AwayFromZero) : receivedAmount;
        }

        // 4. Applied to Debt Amount (Capped to Debt Amount)
        var appliedToDebtAmount = Math.Min(debtAmount, receivedInDebtCurr);
        decimal appliedToDebtAmountInTry;
        if (debtCurr == 1)
        {
            appliedToDebtAmountInTry = Math.Round(appliedToDebtAmount, 2, MidpointRounding.AwayFromZero);
        }
        else
        {
            appliedToDebtAmountInTry = Math.Round(appliedToDebtAmount * debtRate, 2, MidpointRounding.AwayFromZero);
        }

        // 5. Overpayment Amount
        var overpaymentInDebtCurr = Math.Max(0m, receivedInDebtCurr - debtAmount);
        var overpaymentInTry = Math.Max(0m, receivedAmountInTry - appliedToDebtAmountInTry);

        // 6. Change Amount (Para Üstü) in Change Currency
        decimal changeAmount;
        decimal changeAmountInTry = Math.Round(overpaymentInTry, 2, MidpointRounding.AwayFromZero);

        if (changeCurr == 1) // TRY
        {
            changeAmount = changeAmountInTry;
        }
        else if (changeCurr == payCurr && payCurr != 1)
        {
            changeAmount = rate > 0m ? Math.Round(changeAmountInTry / rate, 2, MidpointRounding.AwayFromZero) : 0m;
        }
        else
        {
            changeAmount = changeRate > 0m ? Math.Round(changeAmountInTry / changeRate, 2, MidpointRounding.AwayFromZero) : 0m;
        }

        // 7. Remaining Debt
        var remainingDebt = Math.Max(0m, debtAmount - appliedToDebtAmount);
        var isFullPayment = remainingDebt <= 0.001m;

        return new PaymentCalculationResult
        {
            DebtAmount = Math.Round(debtAmount, 2, MidpointRounding.AwayFromZero),
            DebtCurrencyTypeId = debtCurr,
            ReceivedAmount = Math.Round(receivedAmount, 2, MidpointRounding.AwayFromZero),
            PaymentCurrencyTypeId = payCurr,
            ExchangeRate = rate,
            ReceivedAmountInDebtCurrency = Math.Round(receivedInDebtCurr, 2, MidpointRounding.AwayFromZero),
            ReceivedAmountInTry = Math.Round(receivedAmountInTry, 2, MidpointRounding.AwayFromZero),
            AppliedToDebtAmount = Math.Round(appliedToDebtAmount, 2, MidpointRounding.AwayFromZero),
            AppliedToDebtAmountInTry = Math.Round(appliedToDebtAmountInTry, 2, MidpointRounding.AwayFromZero),
            OverpaymentAmountInDebtCurrency = Math.Round(overpaymentInDebtCurr, 2, MidpointRounding.AwayFromZero),
            OverpaymentAmountInTry = Math.Round(overpaymentInTry, 2, MidpointRounding.AwayFromZero),
            ChangeAmount = Math.Round(changeAmount, 2, MidpointRounding.AwayFromZero),
            ChangeCurrencyTypeId = changeCurr,
            ChangeExchangeRate = changeRate,
            ChangeAmountInTry = Math.Round(changeAmountInTry, 2, MidpointRounding.AwayFromZero),
            IsFullPayment = isFullPayment,
            RemainingDebtAmount = Math.Round(remainingDebt, 2, MidpointRounding.AwayFromZero),
            RateDate = DateTime.UtcNow,
            RateSource = "TCMB / Snapshot",
            IsManualRate = req.ExchangeRate > 0
        };
    }

    private static int NormalizeCurrencyTypeId(int typeId)
    {
        return typeId <= 0 ? 1 : typeId;
    }
}
