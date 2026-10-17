using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Features.Payment;

public sealed class PaymentService : IPaymentService
{
    private readonly AppDbContext _dbContext;
    private readonly B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient _money;
    private static readonly ConcurrentDictionary<string, ProcessPaymentResult> _idempotencyCache = new();

    public PaymentService(AppDbContext dbContext, B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient money)
    {
        _dbContext = dbContext;
        _money = money;
    }

    /// <summary>
    /// Borcun (carinin) para biriminin TL kuru. Ödeme kuru bunun yerine kullanılamaz — ikisi
    /// yalnızca aynı para biriminde eşittir. Bkz. <see cref="PaymentCalculationRequest.DebtExchangeRate"/>.
    /// Kur alınamazsa 0 döner ve motor eski davranışa (ödeme kuru) düşer.
    /// </summary>
    private async Task<decimal> ResolveDebtRateAsync(int debtCurrencyTypeId, CancellationToken cancellationToken)
    {
        if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(debtCurrencyTypeId)) return 1m;

        var code = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCode(debtCurrencyTypeId);
        if (string.IsNullOrWhiteSpace(code)) return 0m;

        try
        {
            var rate = await _money.GetLatestTryRateAsync(code, cancellationToken);
            return rate > 0m ? rate : 0m;
        }
        catch
        {
            return 0m;
        }
    }

    public PaymentCalculationResult Calculate(PaymentCalculationRequest request)
    {
        return PaymentEngine.Calculate(request);
    }

    public async Task<ProcessPaymentResult> ProcessInvoicePaymentAsync(
        ProcessInvoicePaymentRequest request,
        string username,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // 1. Idempotency Check
        if (!string.IsNullOrWhiteSpace(request.ClientTransactionId))
        {
            var key = request.ClientTransactionId.Trim();
            if (_idempotencyCache.TryGetValue(key, out var cachedResult))
            {
                return cachedResult;
            }
        }

        // 2. Validate Inputs & Fetch Invoice
        if (request.ReceivedAmount <= 0)
        {
            return new ProcessPaymentResult { Success = false, Message = "Alınan tutar 0 veya negatif olamaz" };
        }

        var invoice = await _dbContext.Invoices
            .FirstOrDefaultAsync(x => x.Id == request.InvoiceId, cancellationToken);

        if (invoice is null)
        {
            return new ProcessPaymentResult { Success = false, Message = "Fatura bulunamadı" };
        }

        // Calculate current paid & remaining from CustomerLedgerEntries for accuracy
        var previousPaidInTry = await _dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice && x.ReferenceId == invoice.Id && x.Direction == CustomerLedgerEntryDirection.Credit)
            .SumAsync(x => (decimal?)x.Amount, cancellationToken) ?? 0m;

        // Invoice.GrandTotal ve ekstredeki Amount'ın ikisi de TL çapasıdır — bu değer TL'dir.
        var remainingDebtTry = Math.Max(0m, invoice.GrandTotal - previousPaidInTry);
        if (remainingDebtTry <= 0.001m)
        {
            return new ProcessPaymentResult { Success = false, Message = "Bu faturanın borcu zaten tamamen ödenmiştir" };
        }

        // Fetch Customer Name
        var customer = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == invoice.CustomerCode, cancellationToken);
        var customerName = customer?.Name ?? invoice.CustomerCode;

        // BORCUN PARA BİRİMİ FATURANINDIR (2026-08-17).
        // Burada CARİNİN kartındaki döviz okunuyordu: dolar fatura, cari kartı EUR ise
        // EUR borç sanılıp tahsilat yanlış para biriminde kapanıyordu. Cari kartındaki
        // döviz alanı kaldırıldı; belge kendi para birimini ve donmuş kurunu taşıyor.
        var customerCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(
            invoice.CurrencyTypeId > 0 ? invoice.CurrencyTypeId : 1);

        // 3. Fetch Real Account Currency from Database (DO NOT TRUST FRONTEND)
        int paymentCurrencyTypeId = 1;

        var isBankPayment = string.Equals(request.PaymentMethod, "Bank", StringComparison.OrdinalIgnoreCase);
        if (isBankPayment)
        {
            var bankAcc = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == request.AccountId, cancellationToken);

            if (bankAcc is null)
            {
                return new ProcessPaymentResult { Success = false, Message = "Seçilen banka hesabı bulunamadı" };
            }
            paymentCurrencyTypeId = bankAcc.CurrencyTypeId == 0 ? 1 : bankAcc.CurrencyTypeId;
        }
        else
        {
            var cashAcc = await _dbContext.CashAccounts
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == request.AccountId, cancellationToken);

            if (cashAcc is null)
            {
                return new ProcessPaymentResult { Success = false, Message = "Seçilen kasa hesabı bulunamadı" };
            }
            paymentCurrencyTypeId = cashAcc.CurrencyTypeId == 0 ? 1 : cashAcc.CurrencyTypeId;
        }

        // 4. Resolve Change Account Currency & Verify Balance
        int changeCurrencyTypeId = 1;
        var changeAccountId = request.ChangeAccountId ?? request.AccountId;
        var isChangeBank = string.Equals(request.ChangeAccountType, "Bank", StringComparison.OrdinalIgnoreCase);

        if (isChangeBank)
        {
            var changeBank = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == changeAccountId, cancellationToken);

            if (changeBank is null)
            {
                return new ProcessPaymentResult { Success = false, Message = "Para üstünün çıkacağı banka hesabı bulunamadı" };
            }
            changeCurrencyTypeId = changeBank.CurrencyTypeId == 0 ? 1 : changeBank.CurrencyTypeId;
        }
        else
        {
            var changeCash = await _dbContext.CashAccounts
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == changeAccountId, cancellationToken);

            if (changeCash is null)
            {
                return new ProcessPaymentResult { Success = false, Message = "Para üstünün çıkacağı kasa hesabı bulunamadı" };
            }
            changeCurrencyTypeId = changeCash.CurrencyTypeId == 0 ? 1 : changeCash.CurrencyTypeId;
        }

        // 5. Run Centralized Calculation Engine
        //
        // Motor borcu KENDİ para biriminde bekler (DebtAmount × DebtExchangeRate = TL).
        // Buraya TL kalan borç `DebtCurrencyTypeId = cari dövizi` ile veriliyordu: motor
        // 38.000 ₺'yi 38.000 $ sanıp kurla bir kez DAHA çarpıyor, 1.000 $'lık fatura
        // 38.000 $ borç görünüyor ve tam ödemede bile kapanmıyordu.
        var debtCurrencyTypeId = customerCurrencyTypeId == 0 ? 1 : customerCurrencyTypeId;
        // Borcun KENDİ kuru: çapraz dövizli tahsilatta (ör. EUR borç, USD ödeme) motor
        // ödeme kurunu borç için de kullanıyor ve borcu yanlış kapatıyordu.
        //
        // Kur önce FATURANIN DONMUŞ kurudur (2026-08-17): borç fatura anındaki kurla doğdu,
        // tahsilat günündeki canlı kurla yeniden değerlenirse kapanmış fatura açık kalıyor.
        var debtRate = invoice.CurrencyTypeId > 0 && invoice.ExchangeRate > 0m
            ? invoice.ExchangeRate
            : await ResolveDebtRateAsync(debtCurrencyTypeId, cancellationToken);

        decimal debtAmountInDebtCurrency;
        if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(debtCurrencyTypeId))
        {
            debtAmountInDebtCurrency = remainingDebtTry;
        }
        else if (debtRate > 0m)
        {
            debtAmountInDebtCurrency = Math.Round(remainingDebtTry / debtRate, 2, MidpointRounding.AwayFromZero);
        }
        else
        {
            // Kur alınamadı: borcu TL olarak sunmak matematiksel olarak doğru kalır;
            // döviz etiketiyle TL rakamı vermek borcu kur katı kadar şişirirdi.
            debtCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try;
            debtAmountInDebtCurrency = remainingDebtTry;
        }

        var calcReq = new PaymentCalculationRequest
        {
            DebtAmount = debtAmountInDebtCurrency,
            DebtCurrencyTypeId = debtCurrencyTypeId,
            DebtExchangeRate = debtRate,
            ReceivedAmount = request.ReceivedAmount,
            PaymentCurrencyTypeId = paymentCurrencyTypeId,
            ExchangeRate = request.ExchangeRate > 0 ? request.ExchangeRate : 1m,
            ChangeCurrencyTypeId = changeCurrencyTypeId,
            ChangeExchangeRate = request.ChangeExchangeRate > 0 ? request.ChangeExchangeRate : 1m
        };

        var calc = PaymentEngine.Calculate(calcReq);

        // 6. Execute Single Database Transaction
        using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var now = B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow;

            // Update Invoice Paid Status Flag
            var newTotalPaid = previousPaidInTry + calc.AppliedToDebtAmountInTry;
            invoice.IsManuallyPaid = newTotalPaid >= invoice.GrandTotal - 0.001m;

            // Add CustomerLedgerEntry (Cari Alacak Kaydı - TOPLAM ALINAN TUTAR)
            var ledgerEntry = new CustomerLedgerEntry
            {
                CustomerCode = invoice.CustomerCode,
                Date = now,
                DueDate = now,
                Direction = CustomerLedgerEntryDirection.Credit,
                Amount = calc.ReceivedAmountInTry,
                CurrencyTypeId = calc.DebtCurrencyTypeId,
                // CurrencyAmount borcun (carinin) para birimindedir; kur da onun kuru olmalı.
                // Ödeme kuru yazılıyordu: çapraz dövizde Amount / CurrencyRate ≠ CurrencyAmount.
                CurrencyRate = calc.DebtCurrencyTypeId == B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try
                    ? 1m
                    : (debtRate > 0m ? debtRate : 1m),
                CurrencyAmount = calc.ReceivedAmountInDebtCurrency,
                PaymentCurrencyTypeId = calc.PaymentCurrencyTypeId,
                PaymentCurrencyRate = calc.ExchangeRate,
                PaymentCurrencyAmount = calc.ReceivedAmount,
                DocumentNo = invoice.InvoiceNo,
                Description = $"Tahsilat: {invoice.InvoiceNo}",
                TransactionType = isBankPayment ? "Banka" : "Kasa",
                DeliveryCustomerCode = invoice.DeliveryCustomerCode,
                ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                ReferenceId = invoice.Id,
                CreateUser = username,
                CreateTime = now
            };
            _dbContext.CustomerLedgerEntries.Add(ledgerEntry);

            // Add CustomerLedgerEntry for change (Cari Borç Kaydı - PARA ÜSTÜ) if change exists
            if (calc.ChangeAmount > 0)
            {
                var changeLedgerEntry = new CustomerLedgerEntry
                {
                    CustomerCode = invoice.CustomerCode,
                    Date = now,
                    DueDate = now,
                    Direction = CustomerLedgerEntryDirection.Debit,
                    Amount = calc.ChangeAmountInTry,
                    CurrencyTypeId = calc.DebtCurrencyTypeId,
                    CurrencyRate = calc.DebtCurrencyTypeId == B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try
                        ? 1m
                        : (debtRate > 0m ? debtRate : 1m),
                    CurrencyAmount = calc.OverpaymentAmountInDebtCurrency,
                    PaymentCurrencyTypeId = calc.ChangeCurrencyTypeId,
                    PaymentCurrencyRate = calc.ChangeExchangeRate,
                    PaymentCurrencyAmount = calc.ChangeAmount,
                    DocumentNo = invoice.InvoiceNo,
                    Description = "Para Üstü",
                    TransactionType = isChangeBank ? "Banka" : "Kasa",
                    DeliveryCustomerCode = invoice.DeliveryCustomerCode,
                    ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                    ReferenceId = invoice.Id,
                    CreateUser = username,
                    CreateTime = now
                };
                _dbContext.CustomerLedgerEntries.Add(changeLedgerEntry);
            }

            int? cashTxInId = null;
            int? cashTxOutId = null;
            int? bankTxInId = null;
            int? bankTxOutId = null;

            // Process Inflow (Tahsilat Girişi)
            if (isBankPayment)
            {
                var bankIn = new BankAccountTransaction
                {
                    BankAccountDefinitionId = request.AccountId,
                    Date = now,
                    Direction = BankAccountTransactionDirection.In,
                    Amount = calc.ReceivedAmountInTry,
                    CurrencyTypeId = calc.PaymentCurrencyTypeId,
                    CurrencyRate = calc.ExchangeRate,
                    CurrencyAmount = calc.ReceivedAmount,
                    CounterpartyType = BankAccountTransactionCounterpartyType.Customer,
                    CounterpartyCode = invoice.CustomerCode,
                    CounterpartyName = customerName,
                    DocumentNo = invoice.InvoiceNo,
                    Description = $"Satış Faturası Tahsilatı: {invoice.InvoiceNo}",
                    IsPosFee = false,
                    CreateUser = username,
                    CreateTime = now
                };
                _dbContext.BankAccountTransactions.Add(bankIn);
                await _dbContext.SaveChangesAsync(cancellationToken);
                bankTxInId = bankIn.Id;
            }
            else
            {
                var cashIn = new CashAccountTransaction
                {
                    CashAccountId = request.AccountId,
                    Date = now,
                    Direction = CashAccountTransactionDirection.In,
                    Amount = calc.ReceivedAmountInTry,
                    CurrencyTypeId = calc.PaymentCurrencyTypeId,
                    CurrencyRate = calc.ExchangeRate,
                    CurrencyAmount = calc.ReceivedAmount,
                    CounterpartyType = CashAccountTransactionCounterpartyType.Customer,
                    CounterpartyCode = invoice.CustomerCode,
                    CounterpartyName = customerName,
                    ReferenceType = CashAccountTransactionReferenceType.Invoice,
                    ReferenceId = invoice.Id,
                    Description = $"Satış Faturası Tahsilatı: {invoice.InvoiceNo}",
                    CreateUser = username,
                    CreateTime = now
                };
                _dbContext.CashAccountTransactions.Add(cashIn);
                await _dbContext.SaveChangesAsync(cancellationToken);
                cashTxInId = cashIn.Id;
            }

            // Process Change Outflow (Para Üstü Çıkışı) if calc.ChangeAmount > 0
            if (calc.ChangeAmount > 0)
            {
                if (isChangeBank)
                {
                    var bankOut = new BankAccountTransaction
                    {
                        BankAccountDefinitionId = changeAccountId,
                        Date = now,
                        Direction = BankAccountTransactionDirection.Out,
                        Amount = calc.ChangeAmountInTry,
                        CurrencyTypeId = calc.ChangeCurrencyTypeId,
                        CurrencyRate = calc.ChangeExchangeRate,
                        CurrencyAmount = calc.ChangeAmount,
                        CounterpartyType = BankAccountTransactionCounterpartyType.Customer,
                        CounterpartyCode = invoice.CustomerCode,
                        CounterpartyName = customerName,
                        DocumentNo = invoice.InvoiceNo,
                        Description = $"Tahsilat Para Üstü İadesi ({invoice.InvoiceNo})",
                        IsPosFee = false,
                        CreateUser = username,
                        CreateTime = now
                    };
                    _dbContext.BankAccountTransactions.Add(bankOut);
                    await _dbContext.SaveChangesAsync(cancellationToken);
                    bankTxOutId = bankOut.Id;
                }
                else
                {
                    var cashOut = new CashAccountTransaction
                    {
                        CashAccountId = changeAccountId,
                        Date = now,
                        Direction = CashAccountTransactionDirection.Out,
                        Amount = calc.ChangeAmountInTry,
                        CurrencyTypeId = calc.ChangeCurrencyTypeId,
                        CurrencyRate = calc.ChangeExchangeRate,
                        CurrencyAmount = calc.ChangeAmount,
                        CounterpartyType = CashAccountTransactionCounterpartyType.Customer,
                        CounterpartyCode = invoice.CustomerCode,
                        CounterpartyName = customerName,
                        ReferenceType = CashAccountTransactionReferenceType.Invoice,
                        ReferenceId = invoice.Id,
                        Description = $"Tahsilat Para Üstü İadesi ({invoice.InvoiceNo})",
                        CreateUser = username,
                        CreateTime = now
                    };
                    _dbContext.CashAccountTransactions.Add(cashOut);
                    await _dbContext.SaveChangesAsync(cancellationToken);
                    cashTxOutId = cashOut.Id;
                }
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);

            var result = new ProcessPaymentResult
            {
                Success = true,
                Message = "Ödeme ve para üstü işlemi başarıyla kaydedildi",
                ClientTransactionId = request.ClientTransactionId,
                Calculation = calc,
                CashTransactionInId = cashTxInId,
                CashTransactionOutId = cashTxOutId,
                BankTransactionInId = bankTxInId,
                BankTransactionOutId = bankTxOutId,
                CustomerLedgerEntryId = ledgerEntry.Id
            };

            if (!string.IsNullOrWhiteSpace(request.ClientTransactionId))
            {
                _idempotencyCache.TryAdd(request.ClientTransactionId.Trim(), result);
            }

            return result;
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(cancellationToken);
            return new ProcessPaymentResult
            {
                Success = false,
                Message = $"Ödeme kaydedilirken bir hata oluştu: {ex.Message}"
            };
        }
    }

    public async Task<ProcessPaymentResult> CancelInvoicePaymentAsync(
        int invoiceId,
        string username,
        CancellationToken cancellationToken = default)
    {
        var invoice = await _dbContext.Invoices
            .FirstOrDefaultAsync(x => x.Id == invoiceId, cancellationToken);

        if (invoice is null)
        {
            return new ProcessPaymentResult { Success = false, Message = "Fatura bulunamadı" };
        }

        using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            // BELGE NO KAPISI (2026-09-08): `ReferenceId` satış/alış faturası arasında
            // ayrışmıyor (id dizileri ayrı, aynı numara iki tabloda da var). Belge no
            // eşitliği olmadan, bu satış faturasının ödemesini iptal etmek aynı id'li BİR
            // ALIŞ faturasının cari/kasa hareketlerini de siliyordu (bkz. EMİNE KILINÇ /
            // 100000000000046). Ödeme satırları da fatura no'sunu taşır (bkz. CreateSalesInvoice).
            var invoiceNo = invoice.InvoiceNo ?? string.Empty;

            // 1. Remove associated CustomerLedgerEntries
            var ledgerEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                            && x.ReferenceId == invoiceId
                            && x.DocumentNo == invoiceNo)
                .ToListAsync(cancellationToken);

            _dbContext.CustomerLedgerEntries.RemoveRange(ledgerEntries);

            // 2. Remove associated CashAccountTransactions
            var cashTxs = await _dbContext.CashAccountTransactions
                .Where(x => x.ReferenceType == CashAccountTransactionReferenceType.Invoice
                            && x.ReferenceId == invoiceId
                            && x.DocumentNo == invoiceNo)
                .ToListAsync(cancellationToken);

            _dbContext.CashAccountTransactions.RemoveRange(cashTxs);

            // Remove associated BankAccountTransactions
            if (!string.IsNullOrWhiteSpace(invoice.InvoiceNo))
            {
                var bankTxs = await _dbContext.BankAccountTransactions
                    .Where(x => x.DocumentNo == invoice.InvoiceNo)
                    .ToListAsync(cancellationToken);

                _dbContext.BankAccountTransactions.RemoveRange(bankTxs);
            }

            // 3. Reset Invoice Paid Status
            invoice.IsManuallyPaid = false;

            await _dbContext.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);

            return new ProcessPaymentResult
            {
                Success = true,
                Message = "Fatura ödemesi başarıyla iptal edildi ve hareketler temizlendi"
            };
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(cancellationToken);
            return new ProcessPaymentResult
            {
                Success = false,
                Message = $"İptal işlemi sırasında hata oluştu: {ex.Message}"
            };
        }
    }
}
