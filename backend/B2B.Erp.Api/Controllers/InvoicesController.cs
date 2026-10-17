using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using B2B.Erp.Api.Core.Http;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Invoices;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.InvoicePrint;
using B2B.Erp.Api.Features.InvoiceList;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Text.Json;
using System.Net.Http.Json;
using Npgsql;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class InvoicesController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    private readonly Core.Interfaces.IMoneyServiceClient _money;

    private static string? MapCurrencyTypeIdToCode(int currencyTypeId)
    {
        return currencyTypeId switch
        {
            1 => "TRY",
            2 => "EUR",
            3 => "USD",
            4 => "GBP",
            _ => null
        };
    }

    /// <summary>
    /// Türkçe süzgeç değerini ASCII'ye indirger.
    ///
    /// <para>
    /// Karşılaştırma <c>ToLowerInvariant()</c> ile yapılıyordu ve NOKTALI BÜYÜK İ (U+0130)
    /// bu dönüşümde düz <c>i</c> olmuyor. Ekran süzgeç değerlerini büyük harfle gönderiyor
    /// ("HİZMET", "TAMİR", "İADE"), dolayısıyla bu üç seçenekte karşılaştırma tutmuyordu ve
    /// süzgeç SESSİZCE devre dışı kalıyordu: kullanıcı "İADE" seçiyor, liste hiç daralmıyordu.
    /// </para>
    ///
    /// <para>
    /// Hata gösteren değil susan cinstendi — seçenek işaretli görünüp sonuç değişmiyordu.
    /// </para>
    /// </summary>
    /// <summary>
    /// Faturanin KENDI para birimindeki genel toplami - ISKONTO UYGULANMIS.
    /// </summary>
    /// <remarks>
    /// (2026-08-24, kullanici bildirimi: "limit ile cari ekstre tutmuyor".)
    ///
    /// Genel toplam UC ayri yerde kalemlerden yeniden toplaniyordu:
    /// <c>miktar x birim fiyat x (1 + KDV)</c>. Bu hesapta iskonto YOK. Sonuclari:
    ///   - cariye faturadan buyuk borc yaziliyordu (A00000000071173: 580.000 yerine 737.299,96),
    ///   - para ustu hesabinda musteri, iskontolu tutari tam odedigi halde eksik odemis
    ///     gorunuyordu.
    ///
    /// Dogru kaynak faturanin kendi basligidir: <see cref="Invoice.GrandTotal"/> TL capasini,
    /// <see cref="Invoice.ExchangeRate"/> ise belge anindaki donmus kuru tasir. TL faturada
    /// bolme yapilmaz - kurus kaymasi uretmesin diye.
    /// </remarks>
    private static decimal BelgeParasiGenelToplam(Invoice invoice, int currencyTypeId)
    {
        if (currencyTypeId <= 1) return invoice.GrandTotal;

        var rate = invoice.ExchangeRate <= 0m ? 1m : invoice.ExchangeRate;
        if (rate <= 1.0001m) return invoice.GrandTotal;

        return Math.Round(invoice.GrandTotal / rate, 2, MidpointRounding.AwayFromZero);
    }

    private static string NormalizeTurkishFilterValue(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        if (trimmed.Length == 0) return string.Empty;

        var sb = new System.Text.StringBuilder(trimmed.Length);
        foreach (var ch in trimmed)
        {
            var c = ch switch
            {
                'İ' or 'I' or 'ı' or 'i' => 'i',
                'Ş' or 'ş' => 's',
                'Ğ' or 'ğ' => 'g',
                'Ü' or 'ü' => 'u',
                'Ö' or 'ö' => 'o',
                'Ç' or 'ç' => 'c',
                _ => char.ToLowerInvariant(ch)
            };
            sb.Append(c);
        }

        return sb.ToString();
    }

    [HttpPost("{invoiceId:int}/mark-paid")]
    [AuthorizePage("invoice", "faturaDokumOdemeAlindi")]
    [AuthorizePage("invoice", "faturaDokumNakitMiktar")]
    public async Task<IActionResult> MarkInvoicePaid([FromRoute] int invoiceId, [FromBody] MarkInvoicePaidRequest request, CancellationToken cancellationToken)
    {
        if (invoiceId <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var roleIdClaim = User.Claims.FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))?.Value;

        if (request.IsManualPayment == true)
        {
            if (!isSsa && !isSuperAdmin && int.TryParse(roleIdClaim, out var roleId))
            {
                var allowed = await _dbContext.RolePagePermissions
                    .AsNoTracking()
                    .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && rpp.Page.ModuleKey == "invoice" && rpp.Page.Key == "faturaDokumOdemeAlindi", cancellationToken);
                if (!allowed)
                {
                    return StatusCode(403, new { success = false, message = "Bu işlem için yetkiniz yok." });
                }
            }

            var manualInvoice = await _dbContext.Set<Invoice>().FirstOrDefaultAsync(x => x.Id == invoiceId, cancellationToken);
            if (manualInvoice is null) return NotFound(new { success = false, message = "Fatura bulunamadı" });

            var manualExpectedCashDirection = (manualInvoice.Type == InvoiceType.PurchaseInvoice
                                         || manualInvoice.Type == InvoiceType.ServiceInvoice
                                         || manualInvoice.Type == InvoiceType.ReturnInvoice)
                ? CashAccountTransactionDirection.Out
                : CashAccountTransactionDirection.In;

            var manualExpectedBankDirection = (manualInvoice.Type == InvoiceType.PurchaseInvoice
                                         || manualInvoice.Type == InvoiceType.ServiceInvoice
                                         || manualInvoice.Type == InvoiceType.ReturnInvoice)
                ? BankAccountTransactionDirection.Out
                : BankAccountTransactionDirection.In;

            var manualAlreadyCash = await _dbContext.Set<CashAccountTransaction>()
                .AsNoTracking()
                .AnyAsync(x => x.ReferenceType == CashAccountTransactionReferenceType.Invoice
                               && x.ReferenceId == invoiceId
                               && x.Direction == manualExpectedCashDirection, cancellationToken);

            var manualAlreadyBank = await _dbContext.Set<BankAccountTransaction>()
                .AsNoTracking()
                .AnyAsync(x => x.Direction == manualExpectedBankDirection
                               && x.DocumentNo != null
                               && x.DocumentNo == manualInvoice.InvoiceNo, cancellationToken);

            if (manualAlreadyCash || manualAlreadyBank || manualInvoice.IsManuallyPaid)
            {
                return BadRequest(new { success = false, message = "Bu fatura için zaten tahsilat girilmiş" });
            }

            manualInvoice.IsManuallyPaid = true;
            await _dbContext.SaveChangesAsync(cancellationToken);
            return Ok(new { success = true });
        }

        if (!isSsa && !isSuperAdmin && int.TryParse(roleIdClaim, out var roleId_))
        {
            var isCashPayment = request.CashReceivedAmount.HasValue && request.CashReceivedAmount.Value > 0;
            var requiredKey = isCashPayment ? "faturaDokumNakitMiktar" : "faturaDokumOdemeAlindi";
            var allowed = await _dbContext.RolePagePermissions
                .AsNoTracking()
                .AnyAsync(rpp => rpp.RoleId == roleId_ && rpp.CanAccess && rpp.Page.ModuleKey == "invoice" && rpp.Page.Key == requiredKey, cancellationToken);
            if (!allowed)
            {
                return StatusCode(403, new { success = false, message = "Bu işlem için yetkiniz yok." });
            }
        }

        if (!request.TakePaymentNow)
        {
            return BadRequest(new { success = false, message = "Ödeme alınmadı" });
        }

        var cashAccountId = request.CashAccountId.HasValue && request.CashAccountId.Value > 0
            ? request.CashAccountId.Value
            : (int?)null;

        var bankAccountDefinitionId = request.BankAccountDefinitionId.HasValue && request.BankAccountDefinitionId.Value > 0
            ? request.BankAccountDefinitionId.Value
            : (int?)null;

        var changeCashAccountId = request.ChangeCashAccountId.HasValue && request.ChangeCashAccountId.Value > 0
            ? request.ChangeCashAccountId.Value
            : (int?)null;

        var changeBankAccountDefinitionId = request.ChangeBankAccountDefinitionId.HasValue && request.ChangeBankAccountDefinitionId.Value > 0
            ? request.ChangeBankAccountDefinitionId.Value
            : (int?)null;

        if (cashAccountId is not null && bankAccountDefinitionId is not null)
        {
            return BadRequest(new { success = false, message = "Kasa ve banka aynı anda seçilemez" });
        }

        if (changeCashAccountId is not null && changeBankAccountDefinitionId is not null)
        {
            return BadRequest(new { success = false, message = "Fazlalık ödenecek hesapta kasa ve banka aynı anda seçilemez" });
        }

        if (cashAccountId is null && bankAccountDefinitionId is null)
        {
            return BadRequest(new { success = false, message = "Kasa veya banka seçmelisiniz" });
        }

        var invoice = await _dbContext.Set<Invoice>().FirstOrDefaultAsync(x => x.Id == invoiceId, cancellationToken);
        if (invoice is null) return NotFound(new { success = false, message = "Fatura bulunamadı" });

        invoice.IsPriceOverridden = request.IsPriceOverridden.GetValueOrDefault(false);

        string? supplierCodeForPayment = null;
        if (invoice.SourcePurchaseInvoiceId.HasValue && invoice.SourcePurchaseInvoiceId.Value > 0)
        {
            var p = await _dbContext.Set<PurchaseInvoice>()
                .AsNoTracking()
                .Where(x => x.Id == invoice.SourcePurchaseInvoiceId.Value)
                .Select(x => new { x.Kind, x.SupplierCode })
                .FirstOrDefaultAsync(cancellationToken);

            if (p is not null && p.Kind == PurchaseInvoiceKind.Purchase)
            {
                var sc = (p.SupplierCode ?? string.Empty).Trim();
                if (!string.IsNullOrWhiteSpace(sc))
                {
                    supplierCodeForPayment = sc;
                }
            }
        }

        var isPurchaseSide = invoice.Type == InvoiceType.PurchaseInvoice
            || invoice.Type == InvoiceType.ServiceInvoice
            || invoice.Type == InvoiceType.ReturnInvoice;

        var shouldWriteLedger = invoice.Type != InvoiceType.PurchaseInvoice;

        var expectedCashDirection = isPurchaseSide
            ? CashAccountTransactionDirection.Out
            : CashAccountTransactionDirection.In;

        var expectedBankDirection = isPurchaseSide
            ? BankAccountTransactionDirection.Out
            : BankAccountTransactionDirection.In;

        var expectedLedgerDirection = isPurchaseSide
            ? CustomerLedgerEntryDirection.Debit
            : CustomerLedgerEntryDirection.Credit;

        var isReturnInvoice = invoice.Type == InvoiceType.ReturnInvoice;
        var resolvedLedgerDirection = isReturnInvoice
            ? CustomerLedgerEntryDirection.Credit
            : expectedLedgerDirection;

        var invoiceTypeLabel = invoice.Type == InvoiceType.PurchaseInvoice
            ? "Alış Faturası"
            : invoice.Type == InvoiceType.ServiceInvoice
                ? "Hizmet Faturası"
                : invoice.Type == InvoiceType.ReturnInvoice
                    ? "İade Faturası"
                    : "Satış Faturası";

        var customerCode = (invoice.CustomerCode ?? string.Empty).Trim();
        var deliveryCustomerCode = (invoice.DeliveryCustomerCode ?? string.Empty).Trim();

        if (shouldWriteLedger && isPurchaseSide && invoice.SourcePurchaseInvoiceId.HasValue && invoice.SourcePurchaseInvoiceId.Value > 0)
        {
            var p = await _dbContext.Set<PurchaseInvoice>()
                .AsNoTracking()
                .Select(x => new { x.Id, x.Kind, x.SupplierCode, x.ServiceCode, x.CustomerCode })
                .FirstOrDefaultAsync(x => x.Id == invoice.SourcePurchaseInvoiceId.Value, cancellationToken);

            if (p is not null)
            {
                var resolved = p.Kind == PurchaseInvoiceKind.Purchase
                    ? (p.SupplierCode ?? string.Empty)
                    : p.Kind == PurchaseInvoiceKind.Service
                        ? (p.CustomerCode ?? string.Empty)
                        : (p.CustomerCode ?? string.Empty);

                if (!string.IsNullOrWhiteSpace(resolved))
                {
                    customerCode = resolved.Trim();
                }
            }
        }

        var alreadyCash = await _dbContext.Set<CashAccountTransaction>()
            .AsNoTracking()
            .AnyAsync(x => x.ReferenceType == CashAccountTransactionReferenceType.Invoice
                           && x.ReferenceId == invoiceId
                           && x.Direction == expectedCashDirection, cancellationToken);

        var alreadyBank = await _dbContext.Set<BankAccountTransaction>()
            .AsNoTracking()
            .AnyAsync(x => x.Direction == expectedBankDirection
                           && x.DocumentNo != null
                           && x.DocumentNo == invoice.InvoiceNo, cancellationToken);

        if (alreadyCash || alreadyBank)
        {
            return BadRequest(new { success = false, message = "Bu fatura için zaten tahsilat girilmiş" });
        }

        Customer? customer = null;
        string? muhtelifName = null;
        string? muhtelifCode = null;
        if (shouldWriteLedger)
        {
            if (string.IsNullOrWhiteSpace(customerCode))
            {
                // No customer code at all — skip ledger
                shouldWriteLedger = false;
            }
            else
            {
                customer = await _dbContext.Customers
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

                if (customer is null)
                {
                    // Check if this is a BayiMuhtelif customer — if so skip ledger silently
                    var muhtelifCustomer = await _dbContext.Set<BayiMuhtelifCustomer>()
                        .AsNoTracking()
                        .Select(x => new { x.CustomerCode, x.Name })
                        .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

                    if (muhtelifCustomer is not null)
                    {
                        // Muhtelif customer: skip ledger entry, only record kasa/banka
                        shouldWriteLedger = false;
                        muhtelifName = muhtelifCustomer.Name;
                        muhtelifCode = muhtelifCustomer.CustomerCode;
                    }
                    else
                    {
                        // Fall back to CustomerNameOverride if set (e.g., from a cari offer invoice)
                        if (!string.IsNullOrWhiteSpace(invoice.CustomerNameOverride))
                        {
                            shouldWriteLedger = false;
                            muhtelifName = invoice.CustomerNameOverride;
                            muhtelifCode = customerCode;
                        }
                        else
                        {
                            return BadRequest(new { success = false, message = "Cari bulunamadı" });
                        }
                    }
                }
            }
        }

        // `?? 1` yalnızca cari BULUNAMAZSA devreye girer; kayıtta 0 duruyorsa (eski TL
        // varsayılanı) değer 0 kalırdı ve aşağıdaki `!= 1` dalı TL cariyi DÖVİZLİ sanardı.
        // İstemci kur gönderdiğinde TL fatura o kurla damgalanıp bütün döviz matematiği kayardı.
        var customerCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(
            customer?.CurrencyTypeId ?? 1);

        // BELGENİN PARA BİRİMİ CARİNİNKİNİ EZER (2026-08-17, kullanıcı kararı).
        //
        // Ödeme satırı, KAPATTIĞI BORCUN para birimini taşımak zorunda. Fatura EUR kesildiyse
        // (para birimi kalemlerin satış dövizinden geliyor) ödemesi de EUR borç kapatır; cari
        // kartı TL diye satırı TL yazmak dövizli borcu ekstrede hiç göstermemek demekti.
        // Fatura başlığı kendi para birimini ve DONMUŞ kurunu taşıyor; onu kullanmak ödeme
        // anının kuruyla yeniden değerlemeyi de önlüyor.
        if (invoice.CurrencyTypeId > 0)
        {
            customerCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(invoice.CurrencyTypeId);
        }

        var customerTryRate = 1m;
        if (customerCurrencyTypeId != 1)
        {
            if (invoice.CurrencyTypeId > 0 && invoice.ExchangeRate > 0)
            {
                customerTryRate = invoice.ExchangeRate;
            }
            else if (request.InvoiceCurrencyRate.HasValue && request.InvoiceCurrencyRate.Value > 0)
            {
                customerTryRate = request.InvoiceCurrencyRate.Value;
            }
            else
            {
                var code = MapCurrencyTypeIdToCode(customerCurrencyTypeId);
                if (!string.IsNullOrWhiteSpace(code))
                {
                    try
                    {
                        customerTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                    }
                    catch
                    {
                        customerTryRate = 1m;
                    }
                }
            }
        }

        int invoiceCurrencyTypeId = 0;
        decimal invoiceCurrencyGrandTotal = invoice.GrandTotal;
        decimal invoiceTryRate = request.InvoiceCurrencyRate.GetValueOrDefault(1m);

        var invoiceLines = await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(x => x.InvoiceId == invoice.Id)
            .ToListAsync(cancellationToken);

        var curIds = invoiceLines
            .Where(x => x.CurrencyTypeId > 0 && x.CurrencyUnitPrice > 0)
            .Select(x => x.CurrencyTypeId)
            .Distinct()
            .ToList();

        if (curIds.Count == 1)
        {
            invoiceCurrencyTypeId = curIds[0];
            // Kalemleri yeniden toplamak ISKONTOYU YOK SAYIYORDU; gerekce `BelgeParasiGenelToplam` icinde.
            invoiceCurrencyGrandTotal = BelgeParasiGenelToplam(invoice, invoiceCurrencyTypeId);
        }

        if (invoiceCurrencyTypeId == 0)
        {
            invoiceTryRate = 1m;
        }
        else
        {
            if (invoiceTryRate <= 1.0001m)
            {
                var code = MapCurrencyTypeIdToCode(invoiceCurrencyTypeId);
                if (!string.IsNullOrWhiteSpace(code))
                {
                    try
                    {
                        invoiceTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                    }
                    catch
                    {
                        invoiceTryRate = 1m;
                    }
                }
                if (invoiceTryRate <= 0) invoiceTryRate = 1m;
            }
        }

        // Faturanın para birimi ve kuru BAŞLIKTA donduruluyor (2026-08-14). Öncesinde yalnızca
        // yerel değişkende kalıyor, kaydedilmiyordu; fatura sonradan okunduğunda dövizi
        // kalemlerden yeniden çıkarılıyor, kur ise tamamen kayboluyordu. Muhasebe fişi ve KDV
        // beyanı fatura ANINDAKİ kuru ister — güncel kurla yeniden değerlemek yasak.
        invoice.CurrencyTypeId = invoiceCurrencyTypeId;
        invoice.ExchangeRate = invoiceTryRate <= 0 ? 1m : invoiceTryRate;
        invoice.RateSource = invoiceCurrencyTypeId == 0
            ? null
            : (request.InvoiceCurrencyRate.HasValue && request.InvoiceCurrencyRate.Value > 0 ? "Manuel" : "TCMB");

        var isChangeScenario = request.CashReceivedAmount.HasValue 
            && request.CashReceivedAmount.Value > invoiceCurrencyGrandTotal
            && (request.ChangeCashAccountId.HasValue || request.ChangeBankAccountDefinitionId.HasValue);
        var paymentTryAmount = isChangeScenario
            ? (request.CashReceivedAmount.Value * invoiceTryRate)
            : (request.CashReceivedAmount.HasValue
                ? request.CashReceivedAmount.Value * invoiceTryRate
                : invoice.GrandTotal);

        var ledgerPaymentTryAmount = isChangeScenario ? invoice.GrandTotal : paymentTryAmount;

        var now = DateTime.UtcNow;
        var username = User.Identity?.Name ?? "System";

        var invoiceDate = invoice.Date;
        if (invoiceDate.Kind != DateTimeKind.Utc)
        {
            invoiceDate = DateTime.SpecifyKind(invoiceDate, DateTimeKind.Utc);
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        if (cashAccountId is not null)
        {
            var cash = await _dbContext.CashAccounts
                .AsNoTracking()
                .Where(x => x.Id == cashAccountId.Value)
                .Select(x => new { x.Id, x.Name, x.CurrencyTypeId })
                .FirstOrDefaultAsync(cancellationToken);

            if (cash is null)
            {
                await tx.RollbackAsync(cancellationToken);
                return BadRequest(new { success = false, message = "Kasa bulunamadı" });
            }

            // HESABIN PARASI TL Mİ? (2026-08-19 düzeltmesi)
            //
            // Buradaki kontrol `cashCurrencyTypeId == 0` idi. TL kasa/banka tanımları ekrandan
            // 1 ile yazılıyor (0 yalnızca eski kayıtlarda kalan varsayılan), dolayısıyla TL bir
            // kasa DÖVİZLİ sanılıyor ve istekle gelen kur ona uygulanıyordu: satır TL
            // (`CurrencyTypeId=1`) görünürken `CurrencyAmount` tutarın kura bölünmüş hâli
            // oluyordu. `CurrencyTypeHelper.IsTry` iki hâli de TL kabul eder.
            var cashCurrencyTypeId = cash.CurrencyTypeId;
            var cashTryRate = 1m;
            if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId))
            {
                cashTryRate = 1m;
            }
            else
            {
                if (request.CurrencyRate > 0m)
                {
                    cashTryRate = request.CurrencyRate;
                }
                else
                {
                    var code = MapCurrencyTypeIdToCode(cashCurrencyTypeId);
                    if (!string.IsNullOrWhiteSpace(code))
                    {
                        try
                        {
                            cashTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                        }
                        catch
                        {
                            cashTryRate = 1m;
                        }
                    }
                }

                if (cashTryRate <= 0) cashTryRate = 1m;
            }

            var cashCurrencyAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId)
                ? paymentTryAmount
                : (cashTryRate > 0 ? paymentTryAmount / cashTryRate : 0m);

            _dbContext.CashAccountTransactions.Add(new CashAccountTransaction
            {
                CashAccountId = cashAccountId.Value,
                Date = invoiceDate,
                Direction = expectedCashDirection,
                Amount = paymentTryAmount,
                CurrencyTypeId = cashCurrencyTypeId,
                CurrencyRate = cashTryRate,
                CurrencyAmount = cashCurrencyAmount,
                CounterpartyType = shouldWriteLedger ? CashAccountTransactionCounterpartyType.Customer : CashAccountTransactionCounterpartyType.Muhtelif,
                CounterpartyCode = shouldWriteLedger ? customerCode : (muhtelifCode ?? string.Empty),
                CounterpartyName = shouldWriteLedger ? (customer?.Name ?? string.Empty).Trim() : (muhtelifName ?? string.Empty).Trim(),
                ReferenceType = CashAccountTransactionReferenceType.Invoice,
                ReferenceId = invoice.Id,
                Description = $"{invoiceTypeLabel}: {invoice.InvoiceNo}",
                CreateUser = username,
                CreateTime = now
            });

            if (isPurchaseSide && !string.IsNullOrWhiteSpace(supplierCodeForPayment))
            {
                var cashLabel = !string.IsNullOrWhiteSpace(cash.Name)
                    ? cash.Name.Trim()
                    : $"Kasa {cash.Id}";

                _dbContext.SupplierLedgerEntries.Add(new SupplierLedgerEntry
                {
                    SupplierCode = supplierCodeForPayment,
                    Date = invoiceDate,
                    DueDate = invoiceDate,
                    Direction = SupplierLedgerEntryDirection.Debit,
                    Amount = ledgerPaymentTryAmount,
                    // `Supplier` varlığında takip dövizi ALANI YOK; hareketin para birimi
                    // fiilen paranın çıktığı hesaptan alınır. Öncesinde sabit TL yazılıyordu ve
                    // dövizli kasadan yapılan tedarikçi ödemesi deftere TL olarak düşüyordu.
                    CurrencyTypeId = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(cashCurrencyTypeId),
                    CurrencyRate = cashTryRate <= 0 ? 1m : cashTryRate,
                    CurrencyAmount = cashTryRate > 0
                        ? Math.Round(ledgerPaymentTryAmount / cashTryRate, 2, MidpointRounding.AwayFromZero)
                        : ledgerPaymentTryAmount,
                    DocumentNo = invoice.InvoiceNo,
                    Description = $"Kasa Ödeme ({cashLabel}) ({invoice.InvoiceNo})",
                    TransactionType = "Kasa",
                    ReferenceType = SupplierLedgerEntryReferenceType.CashTransaction,
                    ReferenceId = null,
                    CreateUser = username,
                    CreateTime = now
                });
            }

            if (shouldWriteLedger)
            {
                var customerCurrencyAmount = customerTryRate > 0 ? Math.Round(ledgerPaymentTryAmount / customerTryRate, 4) : ledgerPaymentTryAmount;
                var netPaymentCurrencyAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId)
                    ? ledgerPaymentTryAmount
                    : (cashTryRate > 0 ? ledgerPaymentTryAmount / cashTryRate : 0m);
                var (pTypeId, pRate, pAmount) = PaymentCurrencyCalculator.CalculatePaymentCurrencyInfo(
                    customerCurrencyTypeId, customerCurrencyAmount, customerTryRate,
                    cashCurrencyTypeId, netPaymentCurrencyAmount, cashTryRate, ledgerPaymentTryAmount);

                _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                {
                    CustomerCode = customerCode,
                    Date = invoiceDate,
                    DueDate = invoiceDate,
                    Direction = resolvedLedgerDirection,
                    Amount = ledgerPaymentTryAmount,
                    CurrencyTypeId = customerCurrencyTypeId,
                    CurrencyRate = customerTryRate <= 0 ? 1m : customerTryRate,
                    CurrencyAmount = customerCurrencyAmount,
                    PaymentCurrencyTypeId = pTypeId,
                    PaymentCurrencyRate = pRate,
                    PaymentCurrencyAmount = pAmount,
                    DocumentNo = invoice.InvoiceNo,
                    Description = $"Kasa {(isPurchaseSide ? "Ödeme" : "Tahsilat")} ({invoice.InvoiceNo})",
                    TransactionType = isReturnInvoice ? "İade Faturası" : "Kasa",
                    DeliveryCustomerCode = deliveryCustomerCode,
                    ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                    ReferenceId = invoice.Id,
                    CreateUser = username,
                    CreateTime = now
                });
            }

            try
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (
                ex.InnerException is Npgsql.PostgresException pg
                && pg.SqlState == "42703"
                && (pg.MessageText?.Contains("BankAccountTransactions", StringComparison.OrdinalIgnoreCase) ?? false)
                && (
                    (pg.MessageText?.Contains("DocumentNo", StringComparison.OrdinalIgnoreCase) ?? false)
                    || (pg.MessageText?.Contains("MaturityDate", StringComparison.OrdinalIgnoreCase) ?? false)
                    || (pg.MessageText?.Contains("Description", StringComparison.OrdinalIgnoreCase) ?? false)))
            {
                await _dbContext.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"BankAccountTransactions\" ADD COLUMN IF NOT EXISTS \"DocumentNo\" character varying(30) NULL;" +
                    " ALTER TABLE \"BankAccountTransactions\" ADD COLUMN IF NOT EXISTS \"MaturityDate\" timestamp with time zone NULL;" +
                    " ALTER TABLE \"BankAccountTransactions\" ADD COLUMN IF NOT EXISTS \"Description\" character varying(2000) NULL;",
                    cancellationToken);

                await _dbContext.SaveChangesAsync(cancellationToken);
            }
        }

        if (bankAccountDefinitionId is not null)
        {
            var bank = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.AccountType, x.CurrencyTypeId })
                .FirstOrDefaultAsync(x => x.Id == bankAccountDefinitionId.Value, cancellationToken);

            if (bank is null)
            {
                await tx.RollbackAsync(cancellationToken);
                return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });
            }

            var bankCurrencyTypeId = bank.CurrencyTypeId;
            var bankTryRate = 1m;
            if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(bankCurrencyTypeId))
            {
                bankTryRate = 1m;
            }
            else
            {
                if (request.CurrencyRate > 0m)
                {
                    bankTryRate = request.CurrencyRate;
                }
                else
                {
                    var code = MapCurrencyTypeIdToCode(bankCurrencyTypeId);
                    if (!string.IsNullOrWhiteSpace(code))
                    {
                        try
                        {
                            bankTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                        }
                        catch
                        {
                            bankTryRate = 1m;
                        }
                    }
                }

                if (bankTryRate <= 0) bankTryRate = 1m;
            }

            var bankCurrencyAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(bankCurrencyTypeId)
                ? paymentTryAmount
                : (bankTryRate > 0 ? paymentTryAmount / bankTryRate : 0m);

            _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
            {
                BankAccountDefinitionId = bankAccountDefinitionId.Value,
                Date = invoiceDate,
                Direction = expectedBankDirection,
                Amount = paymentTryAmount,
                CurrencyTypeId = bankCurrencyTypeId,
                CurrencyRate = bankTryRate,
                CurrencyAmount = bankCurrencyAmount,
                CounterpartyType = shouldWriteLedger ? BankAccountTransactionCounterpartyType.Customer : (muhtelifCode != null ? BankAccountTransactionCounterpartyType.Customer : BankAccountTransactionCounterpartyType.Bank),
                CounterpartyCode = shouldWriteLedger ? customerCode : (muhtelifCode ?? bank.AccountCode ?? string.Empty),
                CounterpartyName = shouldWriteLedger
                    ? (customer?.Name ?? string.Empty).Trim()
                    : (muhtelifName != null ? muhtelifName.Trim() : (bank.AccountName ?? string.Empty).Trim()),
                DocumentNo = invoice.InvoiceNo,
                Description = $"{invoiceTypeLabel}: {invoice.InvoiceNo}",
                IsPosFee = false,
                CreateUser = username,
                CreateTime = now
            });

            if (isPurchaseSide && !string.IsNullOrWhiteSpace(supplierCodeForPayment))
            {
                var bankLabel = !string.IsNullOrWhiteSpace(bank.AccountName)
                    ? $"{bank.AccountCode} - {bank.AccountName}"
                    : bank.AccountCode;

                _dbContext.SupplierLedgerEntries.Add(new SupplierLedgerEntry
                {
                    SupplierCode = supplierCodeForPayment,
                    Date = invoiceDate,
                    DueDate = invoiceDate,
                    Direction = SupplierLedgerEntryDirection.Debit,
                    Amount = ledgerPaymentTryAmount,
                    // `Supplier` varlığında takip dövizi ALANI YOK; hareketin para birimi
                    // fiilen paranın çıktığı hesaptan alınır. Öncesinde sabit TL yazılıyordu ve
                    // dövizli kasadan yapılan tedarikçi ödemesi deftere TL olarak düşüyordu.
                    CurrencyTypeId = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(bankCurrencyTypeId),
                    CurrencyRate = bankTryRate <= 0 ? 1m : bankTryRate,
                    CurrencyAmount = bankTryRate > 0
                        ? Math.Round(ledgerPaymentTryAmount / bankTryRate, 2, MidpointRounding.AwayFromZero)
                        : ledgerPaymentTryAmount,
                    DocumentNo = invoice.InvoiceNo,
                    Description = $"Banka Ödeme ({bankLabel}) ({invoice.InvoiceNo})",
                    TransactionType = "Banka",
                    ReferenceType = SupplierLedgerEntryReferenceType.BankTransaction,
                    ReferenceId = null,
                    CreateUser = username,
                    CreateTime = now
                });
            }

            if (shouldWriteLedger)
            {
                var customerCurrencyAmount = customerTryRate > 0 ? Math.Round(ledgerPaymentTryAmount / customerTryRate, 4) : ledgerPaymentTryAmount;
                var netPaymentCurrencyAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(bankCurrencyTypeId)
                    ? ledgerPaymentTryAmount
                    : (bankTryRate > 0 ? ledgerPaymentTryAmount / bankTryRate : 0m);
                var (pTypeId, pRate, pAmount) = PaymentCurrencyCalculator.CalculatePaymentCurrencyInfo(
                    customerCurrencyTypeId, customerCurrencyAmount, customerTryRate,
                    bankCurrencyTypeId, netPaymentCurrencyAmount, bankTryRate, ledgerPaymentTryAmount);

                _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                {
                    CustomerCode = customerCode,
                    Date = invoiceDate,
                    DueDate = invoiceDate,
                    Direction = resolvedLedgerDirection,
                    Amount = ledgerPaymentTryAmount,
                    CurrencyTypeId = customerCurrencyTypeId,
                    CurrencyRate = customerTryRate <= 0 ? 1m : customerTryRate,
                    CurrencyAmount = customerCurrencyAmount,
                    PaymentCurrencyTypeId = pTypeId,
                    PaymentCurrencyRate = pRate,
                    PaymentCurrencyAmount = pAmount,
                    DocumentNo = invoice.InvoiceNo,
                    Description = $"Banka {(isPurchaseSide ? "Ödeme" : "Tahsilat")} ({invoice.InvoiceNo})",
                    TransactionType = isReturnInvoice ? "İade Faturası" : "Banka",
                    DeliveryCustomerCode = deliveryCustomerCode,
                    ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                    ReferenceId = invoice.Id,
                    CreateUser = username,
                    CreateTime = now
                });
            }

            if (request.PosFee.HasValue && request.PosFee.Value > 0)
            {
                _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
                {
                    BankAccountDefinitionId = bankAccountDefinitionId.Value,
                    Date = invoiceDate,
                    Direction = BankAccountTransactionDirection.Out,
                    Amount = request.PosFee.Value,
                    // POS masrafı her zaman TL. Ham 0 yerine TL'nin kanonik değeri:
                    // 0 da TL demek ama banka hareket listesi TL'yi 1 ile süzüyordu ve bu satır
                    // hiçbir ekranda görünmüyordu. (Aynı düzeltme BankAccountTransactions ve
                    // BankAccountTransfers denetleyicilerinde de yapıldı.)
                    CurrencyTypeId = CurrencyTypeHelper.Try,
                    CurrencyRate = 1m,
                    CurrencyAmount = request.PosFee.Value,
                    CounterpartyType = shouldWriteLedger ? BankAccountTransactionCounterpartyType.Customer : BankAccountTransactionCounterpartyType.Bank,
                    CounterpartyCode = shouldWriteLedger ? customerCode : bank.AccountCode,
                    CounterpartyName = shouldWriteLedger
                        ? (customer?.Name ?? string.Empty).Trim()
                        : (bank.AccountName ?? string.Empty).Trim(),
                    DocumentNo = invoice.InvoiceNo,
                    Description = $"POS Masrafı: {invoice.InvoiceNo}",
                    IsPosFee = true,
                    // Masraf türü damgası (2026-08-20): Banka Masrafları ekranı satırın
                    // hangi masraf hesabına ait olduğunu bu alandan okur.
                    ExpenseType = (int)BankExpenseType.PosFee,
                    // Brütün içindeki BSMV/KDV ayrıştırması (denetim md. A4). Oranlar elle
                    // girilir; girilmezse sıfır kalır ve satır bugüne kadarki hâliyle aynıdır.
                    PosFeeBsmvRate = request.PosFeeBsmvRate ?? 0m,
                    PosFeeVatRate = request.PosFeeVatRate ?? 0m,
                    PosFeeBsmvAmount = B2B.Erp.Api.Core.Helpers.PosFeeTaxBreakdown
                        .Split(request.PosFee.Value, request.PosFeeBsmvRate ?? 0m, request.PosFeeVatRate ?? 0m).BsmvAmount,
                    PosFeeVatAmount = B2B.Erp.Api.Core.Helpers.PosFeeTaxBreakdown
                        .Split(request.PosFee.Value, request.PosFeeBsmvRate ?? 0m, request.PosFeeVatRate ?? 0m).VatAmount,
                    CreateUser = username,
                    CreateTime = now
                });
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        if (isChangeScenario)
        {
            var cashReceived = request.CashReceivedAmount.Value;

            invoiceLines = await _dbContext.Set<InvoiceLine>()
                .AsNoTracking()
                .Where(x => x.InvoiceId == invoice.Id)
                .ToListAsync(cancellationToken);

            invoiceCurrencyTypeId = 0;
            invoiceCurrencyGrandTotal = invoice.GrandTotal;

            curIds = invoiceLines
                .Where(x => x.CurrencyTypeId > 0 && x.CurrencyUnitPrice > 0)
                .Select(x => x.CurrencyTypeId)
                .Distinct()
                .ToList();

            if (curIds.Count == 1)
            {
                invoiceCurrencyTypeId = curIds[0];
                // Kalemleri yeniden toplamak ISKONTOYU YOK SAYIYORDU; gerekce `BelgeParasiGenelToplam` icinde.
                invoiceCurrencyGrandTotal = BelgeParasiGenelToplam(invoice, invoiceCurrencyTypeId);
            }

            var diffCurrency = cashReceived - invoiceCurrencyGrandTotal;
            if (diffCurrency > 0.0001m)
            {
                if (changeCashAccountId is null && changeBankAccountDefinitionId is null)
                {
                    if (diffCurrency <= 1.00m)
                    {
                        cashReceived = invoiceCurrencyGrandTotal;
                        diffCurrency = 0m;
                    }
                    else
                    {
                        await tx.RollbackAsync(cancellationToken);
                        return BadRequest(new { success = false, message = "Nakit miktar fatura tutarından büyükse fazlalık ödenecek hesabı seçmelisiniz" });
                    }
                }
            }

            if (diffCurrency > 0.0001m)
            {

                invoiceTryRate = request.InvoiceCurrencyRate.GetValueOrDefault();
                if (invoiceCurrencyTypeId == 0)
                {
                    invoiceTryRate = 1m;
                }
                else
                {
                    if (invoiceTryRate <= 1.0001m)
                    {
                        var code = MapCurrencyTypeIdToCode(invoiceCurrencyTypeId);
                        if (!string.IsNullOrWhiteSpace(code))
                        {
                            try
                            {
                                invoiceTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                            }
                            catch
                            {
                                invoiceTryRate = 1m;
                            }
                        }

                        if (invoiceTryRate <= 0) invoiceTryRate = 1m;
                    }
                }

                var diffTry = invoiceCurrencyTypeId == 0 ? diffCurrency : diffCurrency * invoiceTryRate;
                if (diffTry > 0.0001m)
                {
                    if (changeCashAccountId is not null)
                    {
                        var cash = await _dbContext.CashAccounts
                            .AsNoTracking()
                            .Select(x => new { x.Id, x.CurrencyTypeId })
                            .FirstOrDefaultAsync(x => x.Id == changeCashAccountId.Value, cancellationToken);

                        if (cash is null)
                        {
                            await tx.RollbackAsync(cancellationToken);
                            return BadRequest(new { success = false, message = "Fazlalık kasası bulunamadı" });
                        }

                        var changeCurrencyTypeId = cash.CurrencyTypeId;
                        var currencyRate = (request.ChangeCurrencyRate.HasValue && request.ChangeCurrencyRate.Value > 0) ? request.ChangeCurrencyRate.Value : 1m;
                        var currencyAmount = diffTry;
                        if (request.ChangeCurrencyRate.GetValueOrDefault() <= 0m && !B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(changeCurrencyTypeId))
                        {
                            var changeCode = MapCurrencyTypeIdToCode(changeCurrencyTypeId);
                            if (string.IsNullOrWhiteSpace(changeCode))
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return BadRequest(new { success = false, message = "Geçersiz para birimi" });
                            }

                            try
                            {
                                currencyRate = await _money.GetLatestTryRateAsync(changeCode, cancellationToken);
                            }
                            catch
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                            }

                            if (currencyRate <= 0)
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                            }
                        }

                        if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(changeCurrencyTypeId))
                        {
                            currencyAmount = diffTry / currencyRate;
                        }

                        // Calculate cash account balance in its currency
                        var carry = (decimal)await _dbContext.CashAccounts
                            .Where(x => x.Id == changeCashAccountId.Value)
                            .Select(x => x.LastCarryAmount)
                            .FirstOrDefaultAsync(cancellationToken);

                        var transactions = await _dbContext.CashAccountTransactions
                            .AsNoTracking()
                            .Where(x => x.CashAccountId == changeCashAccountId.Value)
                            .Select(x => new { x.Direction, x.Amount, x.CurrencyAmount, x.CurrencyTypeId })
                            .ToListAsync(cancellationToken);

                        var normCurId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(changeCurrencyTypeId);

                        // Kasanın KENDİ para birimindeki hareketler sayılır.
                        //
                        // Öncesinde süzgeç yoktu: `CurrencyAmount` bütün hareketler üzerinden
                        // toplanıyordu, yani dolarla euro yan yana ekleniyordu. Kanonik bakiye
                        // (`CashAccountsController`) bu süzgeci zaten uyguluyor — burası kardeş
                        // yol olarak atlanmıştı. Sonuç bir GÖSTERİM değil, para üstü ödemesini
                        // açan/kapatan YETERLİ BAKİYE kapısıydı.
                        var ownCurrency = transactions
                            .Where(x => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.SameCurrency(normCurId, x.CurrencyTypeId))
                            .ToList();

                        var inTry = ownCurrency.Where(x => x.Direction == CashAccountTransactionDirection.In).Sum(x => x.Amount);
                        var outTry = ownCurrency.Where(x => x.Direction == CashAccountTransactionDirection.Out).Sum(x => x.Amount);
                        var inCur = ownCurrency.Where(x => x.Direction == CashAccountTransactionDirection.In).Sum(x => x.CurrencyAmount);
                        var outCur = ownCurrency.Where(x => x.Direction == CashAccountTransactionDirection.Out).Sum(x => x.CurrencyAmount);

                        var cashBalance = carry + (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(normCurId)
                            ? (inTry - outTry)
                            : (inCur - outCur));

                        if (cashBalance < currencyAmount)
                        {
                            await tx.RollbackAsync(cancellationToken);
                            return BadRequest(new { success = false, message = $"Para üstü kasasında yetersiz bakiye! (Kasa Bakiyesi: {cashBalance:N2}, Gereken: {currencyAmount:N2})" });
                        }

                        _dbContext.CashAccountTransactions.Add(new CashAccountTransaction
                        {
                            CashAccountId = changeCashAccountId.Value,
                            Date = invoiceDate,
                            Direction = CashAccountTransactionDirection.Out,
                            Amount = diffTry,
                            CurrencyTypeId = changeCurrencyTypeId,
                            CurrencyRate = currencyRate,
                            CurrencyAmount = currencyAmount,
                            CounterpartyType = shouldWriteLedger ? CashAccountTransactionCounterpartyType.Customer : CashAccountTransactionCounterpartyType.Muhtelif,
                            CounterpartyCode = shouldWriteLedger ? customerCode : string.Empty,
                            CounterpartyName = shouldWriteLedger ? (customer?.Name ?? string.Empty).Trim() : string.Empty,
                            ReferenceType = CashAccountTransactionReferenceType.Invoice,
                            ReferenceId = invoice.Id,
                            Description = $"Para Üstü / Fazlalık Ödeme: {invoice.InvoiceNo}",
                            CreateUser = username,
                            CreateTime = now
                        });
                    }

                    if (changeBankAccountDefinitionId is not null)
                    {
                        var bank = await _dbContext.BankAccountDefinitions
                            .AsNoTracking()
                            .Select(x => new { x.Id, x.CurrencyTypeId, x.AccountCode, x.AccountName, x.Budget })
                            .FirstOrDefaultAsync(x => x.Id == changeBankAccountDefinitionId.Value, cancellationToken);

                        if (bank is null)
                        {
                            await tx.RollbackAsync(cancellationToken);
                            return BadRequest(new { success = false, message = "Fazlalık banka hesabı bulunamadı" });
                        }

                        var changeCurrencyTypeId = bank.CurrencyTypeId;
                        var currencyRate = (request.ChangeCurrencyRate.HasValue && request.ChangeCurrencyRate.Value > 0) ? request.ChangeCurrencyRate.Value : 1m;
                        var currencyAmount = diffTry;
                        if (request.ChangeCurrencyRate.GetValueOrDefault() <= 0m && !B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(changeCurrencyTypeId))
                        {
                            var changeCode = MapCurrencyTypeIdToCode(changeCurrencyTypeId);
                            if (string.IsNullOrWhiteSpace(changeCode))
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return BadRequest(new { success = false, message = "Geçersiz para birimi" });
                            }

                            try
                            {
                                currencyRate = await _money.GetLatestTryRateAsync(changeCode, cancellationToken);
                            }
                            catch
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                            }

                            if (currencyRate <= 0)
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                            }
                        }

                        if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(changeCurrencyTypeId))
                        {
                            currencyAmount = diffTry / currencyRate;
                        }

                        // Calculate bank account balance in its currency
                        var normBankCurId = bank.CurrencyTypeId;
                        var sums = await _dbContext.BankAccountTransactions
                            .AsNoTracking()
                            .Where(x => x.BankAccountDefinitionId == changeBankAccountDefinitionId.Value)
                            .GroupBy(x => 1)
                            .Select(g => new
                            {
                                InAmount = g.Where(x => x.Direction == BankAccountTransactionDirection.In)
                                    .Sum(x => (decimal?)(normBankCurId == 0 ? x.Amount : (x.CurrencyTypeId == normBankCurId ? x.CurrencyAmount : 0m))) ?? 0m,
                                OutAmount = g.Where(x => x.Direction == BankAccountTransactionDirection.Out)
                                    .Sum(x => (decimal?)(normBankCurId == 0 ? x.Amount : (x.CurrencyTypeId == normBankCurId ? x.CurrencyAmount : 0m))) ?? 0m
                            })
                            .FirstOrDefaultAsync(cancellationToken);

                        var inAmt = sums?.InAmount ?? 0m;
                        var outAmt = sums?.OutAmount ?? 0m;
                        var bankBalance = bank.Budget + (inAmt - outAmt);

                        if (bankBalance < currencyAmount)
                        {
                            await tx.RollbackAsync(cancellationToken);
                            return BadRequest(new { success = false, message = $"Para üstü banka hesabında yetersiz bakiye! (Bakiye: {bankBalance:N2}, Gereken: {currencyAmount:N2})" });
                        }

                        _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
                        {
                            BankAccountDefinitionId = changeBankAccountDefinitionId.Value,
                            Date = invoiceDate,
                            Direction = BankAccountTransactionDirection.Out,
                            Amount = diffTry,
                            CurrencyTypeId = changeCurrencyTypeId,
                            CurrencyRate = currencyRate,
                            CurrencyAmount = currencyAmount,
                            CounterpartyType = shouldWriteLedger ? BankAccountTransactionCounterpartyType.Customer : BankAccountTransactionCounterpartyType.Bank,
                            CounterpartyCode = shouldWriteLedger ? customerCode : bank.AccountCode,
                            CounterpartyName = shouldWriteLedger ? (customer?.Name ?? string.Empty).Trim() : (bank.AccountName ?? string.Empty).Trim(),
                            DocumentNo = invoice.InvoiceNo,
                            Description = $"Para Üstü / Fazlalık Ödeme ({invoice.InvoiceNo})",
                            IsPosFee = false,
                            CreateUser = username,
                            CreateTime = now
                        });
                    }

                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
            }
        }

        await tx.CommitAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("{invoiceId:int}/mark-unpaid")]
    [AuthorizePage("invoice", "faturaDokumOdemeAlindi")]
    [AuthorizePage("invoice", "faturaDokumNakitMiktar")]
    public async Task<IActionResult> MarkInvoiceUnpaid([FromRoute] int invoiceId, CancellationToken cancellationToken)
    {
        if (invoiceId <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var invoice = await _dbContext.Set<Invoice>().FirstOrDefaultAsync(x => x.Id == invoiceId, cancellationToken);
        if (invoice is null) return NotFound(new { success = false, message = "Fatura bulunamadı" });

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            invoice.IsManuallyPaid = false;

            // Delete associated CashAccountTransaction entries.
            // BELGE NO KAPISI (2026-09-08): `ReferenceId` satış/alış faturası arasında
            // ayrışmıyor (id dizileri ayrı, aynı numara iki tabloda da var); belge no da
            // eşleşmezse aynı id'li alış faturasının kasa hareketi de silinirdi.
            var cashTransactions = await _dbContext.CashAccountTransactions
                .Where(x => x.ReferenceType == CashAccountTransactionReferenceType.Invoice
                            && x.ReferenceId == invoice.Id
                            && x.DocumentNo == invoice.InvoiceNo)
                .ToListAsync(cancellationToken);
            if (cashTransactions.Count > 0)
            {
                _dbContext.CashAccountTransactions.RemoveRange(cashTransactions);
            }

            // Delete associated BankAccountTransaction entries (including POS fee transactions)
            if (!string.IsNullOrWhiteSpace(invoice.InvoiceNo))
            {
                var bankTransactions = await _dbContext.BankAccountTransactions
                    .Where(x => x.DocumentNo == invoice.InvoiceNo)
                    .ToListAsync(cancellationToken);
                if (bankTransactions.Count > 0)
                {
                    _dbContext.BankAccountTransactions.RemoveRange(bankTransactions);
                }
            }

            // Delete payment CustomerLedgerEntries (only Kasa/Banka/etc. NOT the invoice's own debit/credit entry).
            // BELGE NO KAPISI (2026-09-08): id çakışması — bkz. yukarıdaki kasa hareketi silmesi.
            var paymentLedgerEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                            && x.ReferenceId == invoice.Id
                            && x.DocumentNo == invoice.InvoiceNo
                            && (x.TransactionType == "Kasa" || x.TransactionType == "Banka" || x.TransactionType == "POS"))
                .ToListAsync(cancellationToken);
            if (paymentLedgerEntries.Count > 0)
            {
                _dbContext.CustomerLedgerEntries.RemoveRange(paymentLedgerEntries);
            }

            // Delete payment SupplierLedgerEntries (only Kasa/Banka/etc. NOT the invoice's own entry)
            if (!string.IsNullOrWhiteSpace(invoice.InvoiceNo))
            {
                var paymentSupplierEntries = await _dbContext.SupplierLedgerEntries
                    .Where(x => x.DocumentNo == invoice.InvoiceNo 
                                && (x.TransactionType == "Kasa" || x.TransactionType == "Banka"))
                    .ToListAsync(cancellationToken);
                if (paymentSupplierEntries.Count > 0)
                {
                    _dbContext.SupplierLedgerEntries.RemoveRange(paymentSupplierEntries);
                }
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);
            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(cancellationToken);
            return StatusCode(500, new { success = false, message = "Ödeme iptal edilirken bir hata oluştu: " + ex.Message });
        }
    }

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly Core.Interfaces.ICampaignService _campaignService;
    private readonly B2B.Erp.Api.Core.Logging.IUserActivityLogger _userActivityLogger;
    private readonly Core.Services.ICustomerAccountService _customerAccountService;
    private readonly Core.Services.IPriceGroupMappingService _priceGroupMappingService;
    private readonly Core.Services.IInvoiceSynchronizationService _invoiceSyncService;
    private readonly Data.Services.TenantConnectionStringResolver _tenantResolver;


    /// <summary>
    /// FİRMANIN SAATİ (2026-08-20 kullanıcı kararı, denetim md. D1). Fatura tarihi "bugün"
    /// olarak UTC takvim gününden yazılıyordu; KKTC (UTC+3) gibi bir yerde yerel
    /// 00:00–03:00 arasında kesilen fatura BİR ÖNCEKİ güne damgalanıyordu.
    /// </summary>
    private readonly B2B.Erp.Api.Core.Helpers.CompanyClock _clock;
    private readonly B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService _ecommerceFulfilment;

    public InvoicesController(
        AppDbContext dbContext,
        Core.Interfaces.IMoneyServiceClient money,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        Core.Interfaces.ICampaignService campaignService,
        B2B.Erp.Api.Core.Logging.IUserActivityLogger userActivityLogger,
        Core.Services.ICustomerAccountService customerAccountService,
        Core.Services.IPriceGroupMappingService priceGroupMappingService,
        Core.Services.IInvoiceSynchronizationService invoiceSyncService,
        Data.Services.TenantConnectionStringResolver tenantResolver,
        B2B.Erp.Api.Core.Helpers.CompanyClock clock,
        B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService ecommerceFulfilment)
    {
        _dbContext = dbContext;
        _money = money;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _campaignService = campaignService;
        _userActivityLogger = userActivityLogger;
        _customerAccountService = customerAccountService;
        _priceGroupMappingService = priceGroupMappingService;
        _invoiceSyncService = invoiceSyncService;
        _tenantResolver = tenantResolver;
        _clock = clock;
        _ecommerceFulfilment = ecommerceFulfilment;
    }

    [HttpGet("list")]
    [AuthorizePage("invoice", "faturaDokum")]
    public async Task<IActionResult> GetInvoiceList(
        [FromQuery] string? query,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] int? page,
        [FromQuery] int? pageSize,
        [FromQuery] string? sortBy,
        [FromQuery] string? sortDir,

        [FromQuery] string? islemTipiIn,
        [FromQuery] string? faturaAcikIn,
        [FromQuery] string? plasiyerIn,
        [FromQuery] string? islemYapanIn,

        [FromQuery] string? tarihOp,
        [FromQuery] string? tarihV1,
        [FromQuery] string? tarihV2,

        [FromQuery] string? faturaNoOp,
        [FromQuery] string? faturaNoV1,
        [FromQuery] string? faturaNoV2,

        [FromQuery] string? cariAdiOp,
        [FromQuery] string? cariAdiV1,
        [FromQuery] string? cariAdiV2,

        [FromQuery] string? brutTutarOp,
        [FromQuery] string? brutTutarV1,
        [FromQuery] string? brutTutarV2,

        [FromQuery] string? iskontoOp,
        [FromQuery] string? iskontoV1,
        [FromQuery] string? iskontoV2,

        // Kampanya sütunu (2026-09-30): İskonto ile aynı sayı süzgeci, CampaignDiscount üzerinde.
        [FromQuery] string? kampanyaIndirimiOp,
        [FromQuery] string? kampanyaIndirimiV1,
        [FromQuery] string? kampanyaIndirimiV2,

        [FromQuery] string? netTutarOp,
        [FromQuery] string? netTutarV1,
        [FromQuery] string? netTutarV2,

        [FromQuery] string? kdvTutariOp,
        [FromQuery] string? kdvTutariV1,
        [FromQuery] string? kdvTutariV2,

        [FromQuery] string? genelToplamOp,
        [FromQuery] string? genelToplamV1,
        [FromQuery] string? genelToplamV2,

        [FromQuery] string? plasiyerOp,
        [FromQuery] string? plasiyerV1,
        [FromQuery] string? plasiyerV2,

        [FromQuery] string? islemYapanOp,
        [FromQuery] string? islemYapanV1,
        [FromQuery] string? islemYapanV2,

        [FromQuery] string? cikisDeposuOp,
        [FromQuery] string? cikisDeposuV1,
        CancellationToken cancellationToken)
    {
        static string? NormalizeText(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

        static string? NormalizeTextLower(string? s)
        {
            var v = NormalizeText(s);
            return v is null ? null : v.ToLowerInvariant();
        }

        static string NormalizeOp(string? op)
        {
            var v = NormalizeTextLower(op) ?? string.Empty;
            return v switch
            {
                "contains" => "contains",
                "not_contains" => "not_contains",
                "starts_with" => "starts_with",
                "ends_with" => "ends_with",
                "eq" => "eq",
                "neq" => "neq",
                "lt" => "lt",
                "gt" => "gt",
                "lte" => "lte",
                "gte" => "gte",
                "between" => "between",
                "empty" => "empty",
                "not_empty" => "not_empty",
                "null" => "empty",
                "not_null" => "not_empty",
                _ => "contains"
            };
        }

        static List<string>? ParseInList(string? raw)
        {
            var s = NormalizeText(raw);
            if (s is null) return null;
            var parts = s.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var list = parts.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            return list.Count == 0 ? null : list;
        }

        static bool TryParseDecimal(string? raw, out decimal value)
        {
            value = 0m;
            var s = NormalizeText(raw);
            if (s is null) return false;
            s = s.Replace(" ", string.Empty);
            if (s.Contains(',') && s.Contains('.'))
            {
                s = s.Replace(".", string.Empty).Replace(',', '.');
            }
            else
            {
                s = s.Replace(',', '.');
            }

            return decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out value);
        }

        static bool TryParseDate(string? raw, out DateTime value)
        {
            value = default;
            var s = NormalizeText(raw);
            if (s is null) return false;
            if (DateTime.TryParse(s, CultureInfo.GetCultureInfo("tr-TR"), DateTimeStyles.AssumeLocal, out value)) return true;

            var formats = new[] { "yyyy-MM-dd", "dd.MM.yyyy", "dd/MM/yyyy" };
            return DateTime.TryParseExact(s, formats, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out value);
        }

        var scopedQuery = await B2B.Erp.Api.Features.InvoiceList.InvoiceListBaseQuery.BuildAsync(_dbContext, User, cancellationToken);
        if (scopedQuery is null)
        {
            return Ok(new { success = true, data = Array.Empty<InvoiceListItemResponse>() });
        }

        var baseQuery = scopedQuery;

        var q = string.IsNullOrWhiteSpace(query) ? null : query.Trim().ToLowerInvariant();

        DateTime? fromStart = fromDate.HasValue ? DateTime.SpecifyKind(fromDate.Value.Date, DateTimeKind.Utc) : null;
        DateTime? toStartExclusive;

        if (toDate.HasValue)
        {
            toStartExclusive = DateTime.SpecifyKind(toDate.Value.Date.AddDays(1), DateTimeKind.Utc);
        }
        else if (fromDate.HasValue)
        {
            toStartExclusive = DateTime.SpecifyKind(fromDate.Value.Date.AddDays(1), DateTimeKind.Utc);
        }
        else
        {
            toStartExclusive = null;
        }

        if (fromStart.HasValue)
        {
            baseQuery = baseQuery.Where(x => x.Date >= fromStart.Value);
        }

        if (toStartExclusive.HasValue)
        {
            baseQuery = baseQuery.Where(x => x.Date < toStartExclusive.Value);
        }

        static string NormalizeTurkishSearch(string s) =>
            s.ToLower()
             .Replace("ı", "i")
             .Replace("İ", "i")
             .Replace("ğ", "g")
             .Replace("Ğ", "g")
             .Replace("ü", "u")
             .Replace("Ü", "u")
             .Replace("ş", "s")
             .Replace("Ş", "s")
             .Replace("ö", "o")
             .Replace("Ö", "o")
             .Replace("ç", "c")
             .Replace("Ç", "c");

        if (q is not null)
        {
            var qNorm = NormalizeTurkishSearch(q);
            baseQuery = baseQuery.Where(x =>
                x.InvoiceNo.ToLower().Contains(q) ||
                x.InvoiceNo.ToLower()
                    .Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c")
                    .Contains(qNorm) ||
                x.CustomerName.ToLower().Contains(q) ||
                x.CustomerName.ToLower()
                    .Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c")
                    .Contains(qNorm));
        }

        var islemTipiInList = ParseInList(islemTipiIn);
        var faturaAcikInList = ParseInList(faturaAcikIn);
        var plasiyerInList = ParseInList(plasiyerIn);
        var islemYapanInList = ParseInList(islemYapanIn);

        if (islemTipiInList is not null && islemTipiInList.Count > 0)
        {
            // TAMİR ve HİZMET aynı `Type`'ı ('H') taşır; ikisini `SourcePurchaseInvoiceId`
            // ayırır — doluysa alış tarafından gelen gider faturasıdır (HİZMET), boşsa
            // servis geliridir (TAMİR). Sütun bu ikisini ayrı yazdığı için süzgeç de ayırmak
            // zorunda. Ayrıca "tamir" hiç eşlenmiyordu: o seçenekle süzmek listeyi hiç
            // daraltmıyordu.
            var allowedTypes = new List<InvoiceType>();
            var includeExpenseService = false;
            var includeRepairService = false;

            foreach (var s in islemTipiInList)
            {
                var t = NormalizeTurkishFilterValue(s);
                if (t == "satis") allowedTypes.Add(InvoiceType.SalesInvoice);
                else if (t == "alis") allowedTypes.Add(InvoiceType.PurchaseInvoice);
                else if (t == "hizmet") includeExpenseService = true;
                else if (t == "tamir") includeRepairService = true;
                else if (t == "iade") allowedTypes.Add(InvoiceType.ReturnInvoice);
            }

            if (allowedTypes.Count > 0 || includeExpenseService || includeRepairService)
            {
                baseQuery = baseQuery.Where(x =>
                    allowedTypes.Contains(x.Type)
                    || (includeExpenseService
                        && x.Type == InvoiceType.ServiceInvoice
                        && x.SourcePurchaseInvoiceId != null
                        && x.SourcePurchaseInvoiceId > 0)
                    || (includeRepairService
                        && x.Type == InvoiceType.ServiceInvoice
                        && (x.SourcePurchaseInvoiceId == null || x.SourcePurchaseInvoiceId <= 0)));
            }
        }

        if (plasiyerInList is not null && plasiyerInList.Count > 0)
        {
            baseQuery = baseQuery.Where(x => plasiyerInList.Contains(x.SalesmanCode));
        }

        if (islemYapanInList is not null && islemYapanInList.Count > 0)
        {
            baseQuery = baseQuery.Where(x => islemYapanInList.Contains(x.CreateUser));
        }

        if (faturaAcikInList is not null && faturaAcikInList.Count > 0)
        {
            /**
             * FATURA TİPİ SÜZGECİ RENK GRUBUYLA ÇALIŞIR (2026-08-22).
             *
             * Ekranda satırın taşıdığı tek ayrım renktir: yeşil = muaf, mavi = faturalı,
             * sarı = açık hesap. Süzgeç de artık bu grupları alıyor (YESIL / MAVI / SARI).
             *
             * Koşul, listenin `FaturaAcik` projeksiyonunun AYNISI olmak ZORUNDA. Eskiden
             * süzgeç ham `CustomerInvoiceTypeOverride ?? CustomerInvoiceType` üzerinden
             * çalışıyordu: kodu "-3" ile biten bir cari ekranda MUAF görünüyor ama MUAF
             * süzgecine hiç takılmıyordu. İki ifade ayrı yazıldığı sürece bu ayrışma
             * kaçınılmaz — değiştirilecekse İKİSİ BİRDEN değişmeli.
             *
             * Renk belirteci gelmezse eski davranış korunur: ham tip adıyla tam eşleşme.
             */
            var colorTokens = faturaAcikInList
                .Select(v => v.Trim().ToUpperInvariant())
                .ToHashSet(StringComparer.Ordinal);

            var wantsGreen = colorTokens.Contains("YESIL");
            var wantsBlue = colorTokens.Contains("MAVI");
            var wantsYellow = colorTokens.Contains("SARI");

            if (wantsGreen || wantsBlue || wantsYellow)
            {
                baseQuery = baseQuery.Where(x =>
                    (wantsGreen &&
                        ((x.CustomerCode != null && (x.CustomerCode.EndsWith("-3") || x.CustomerCode.Contains("-3]"))) ||
                         (!string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) && (x.CustomerInvoiceTypeOverride == "ASKERIYE" || x.CustomerInvoiceTypeOverride == "ASKERİYE" || x.CustomerInvoiceTypeOverride == "MUAF")) ||
                         (!string.IsNullOrWhiteSpace(x.CustomerInvoiceType) && (x.CustomerInvoiceType == "ASKERIYE" || x.CustomerInvoiceType == "ASKERİYE" || x.CustomerInvoiceType == "MUAF"))))
                    ||
                    (wantsBlue &&
                        !((x.CustomerCode != null && (x.CustomerCode.EndsWith("-3") || x.CustomerCode.Contains("-3]"))) ||
                          (!string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) && (x.CustomerInvoiceTypeOverride == "ASKERIYE" || x.CustomerInvoiceTypeOverride == "ASKERİYE" || x.CustomerInvoiceTypeOverride == "MUAF")) ||
                          (!string.IsNullOrWhiteSpace(x.CustomerInvoiceType) && (x.CustomerInvoiceType == "ASKERIYE" || x.CustomerInvoiceType == "ASKERİYE" || x.CustomerInvoiceType == "MUAF"))) &&
                        ((!string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) ? x.CustomerInvoiceTypeOverride : x.CustomerInvoiceType) == "FATURA" ||
                         (!string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) ? x.CustomerInvoiceTypeOverride : x.CustomerInvoiceType) == "FATURALI"))
                    ||
                    (wantsYellow &&
                        !((x.CustomerCode != null && (x.CustomerCode.EndsWith("-3") || x.CustomerCode.Contains("-3]"))) ||
                          (!string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) && (x.CustomerInvoiceTypeOverride == "ASKERIYE" || x.CustomerInvoiceTypeOverride == "ASKERİYE" || x.CustomerInvoiceTypeOverride == "MUAF")) ||
                          (!string.IsNullOrWhiteSpace(x.CustomerInvoiceType) && (x.CustomerInvoiceType == "ASKERIYE" || x.CustomerInvoiceType == "ASKERİYE" || x.CustomerInvoiceType == "MUAF"))) &&
                        (!string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) ? x.CustomerInvoiceTypeOverride : x.CustomerInvoiceType) != "FATURA" &&
                        (!string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) ? x.CustomerInvoiceTypeOverride : x.CustomerInvoiceType) != "FATURALI"));
            }
            else
            {
                baseQuery = baseQuery.Where(x => faturaAcikInList.Contains(!string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) ? x.CustomerInvoiceTypeOverride : x.CustomerInvoiceType));
            }
        }

        var normTarihOp = NormalizeOp(tarihOp);
        if (TryParseDate(tarihV1, out var tarihA) || (normTarihOp == "between" && TryParseDate(tarihV2, out _)) || normTarihOp == "empty" || normTarihOp == "not_empty")
        {
            var hasA = TryParseDate(tarihV1, out tarihA);
            var hasB = TryParseDate(tarihV2, out var tarihB);
            if (normTarihOp == "empty")
            {
                baseQuery = baseQuery.Where(x => x.Date == default);
            }
            else if (normTarihOp == "not_empty")
            {
                baseQuery = baseQuery.Where(x => x.Date != default);
            }
            else if (normTarihOp == "between")
            {
                if (hasA && hasB)
                {
                    var min = tarihA.Date < tarihB.Date ? tarihA.Date : tarihB.Date;
                    var max = tarihA.Date < tarihB.Date ? tarihB.Date : tarihA.Date;
                    var minUtc = DateTime.SpecifyKind(min, DateTimeKind.Utc);
                    var maxUtc = DateTime.SpecifyKind(max.AddDays(1), DateTimeKind.Utc);
                    baseQuery = baseQuery.Where(x => x.Date >= minUtc && x.Date < maxUtc);
                }
                else if (hasA)
                {
                    var tarihAUtc = DateTime.SpecifyKind(tarihA.Date, DateTimeKind.Utc);
                    baseQuery = baseQuery.Where(x => x.Date >= tarihAUtc);
                }
                else if (hasB)
                {
                    var tarihBUtc = DateTime.SpecifyKind(tarihB.Date.AddDays(1), DateTimeKind.Utc);
                    baseQuery = baseQuery.Where(x => x.Date < tarihBUtc);
                }
            }
            else if (hasA)
            {
                var tarihAUtc = DateTime.SpecifyKind(tarihA.Date, DateTimeKind.Utc);
                baseQuery = normTarihOp switch
                {
                    "eq" => baseQuery.Where(x => x.Date >= tarihAUtc && x.Date < tarihAUtc.AddDays(1)),
                    "neq" => baseQuery.Where(x => x.Date < tarihAUtc || x.Date >= tarihAUtc.AddDays(1)),
                    "lt" => baseQuery.Where(x => x.Date < tarihAUtc),
                    "gt" => baseQuery.Where(x => x.Date >= tarihAUtc.AddDays(1)),
                    "lte" => baseQuery.Where(x => x.Date < tarihAUtc.AddDays(1)),
                    "gte" => baseQuery.Where(x => x.Date >= tarihAUtc),
                    _ => baseQuery
                };
            }
        }

        // Expression.Invoke is not translatable. Apply filters explicitly per property.
        var faturaNoA = NormalizeTextLower(faturaNoV1);
        var faturaNoB = NormalizeTextLower(faturaNoV2);
        var faturaNoO = NormalizeOp(faturaNoOp);
        if (faturaNoA is not null || (faturaNoO == "between" && faturaNoB is not null) || faturaNoO == "empty" || faturaNoO == "not_empty")
        {
            var fNoNorm = faturaNoA is not null ? NormalizeTurkishSearch(faturaNoA) : string.Empty;
            baseQuery = faturaNoO switch
            {
                "empty" => baseQuery.Where(x => string.IsNullOrEmpty(x.InvoiceNo)),
                "not_empty" => baseQuery.Where(x => !string.IsNullOrEmpty(x.InvoiceNo)),
                "not_contains" => baseQuery.Where(x => 
                    !x.InvoiceNo.ToLower().Contains(faturaNoA ?? string.Empty) &&
                    !x.InvoiceNo.ToLower().Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c").Contains(fNoNorm)),
                "starts_with" => baseQuery.Where(x => 
                    x.InvoiceNo.ToLower().StartsWith(faturaNoA ?? string.Empty) ||
                    x.InvoiceNo.ToLower().Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c").StartsWith(fNoNorm)),
                "ends_with" => baseQuery.Where(x => 
                    x.InvoiceNo.ToLower().EndsWith(faturaNoA ?? string.Empty) ||
                    x.InvoiceNo.ToLower().Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c").EndsWith(fNoNorm)),
                "eq" => baseQuery.Where(x => 
                    x.InvoiceNo.ToLower() == (faturaNoA ?? string.Empty) ||
                    x.InvoiceNo.ToLower().Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c") == fNoNorm),
                "neq" => baseQuery.Where(x => 
                    x.InvoiceNo.ToLower() != (faturaNoA ?? string.Empty) &&
                    x.InvoiceNo.ToLower().Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c") != fNoNorm),
                "between" => baseQuery.Where(x => string.Compare(x.InvoiceNo.ToLower(), faturaNoA ?? string.Empty, StringComparison.Ordinal) >= 0 && string.Compare(x.InvoiceNo.ToLower(), faturaNoB ?? string.Empty, StringComparison.Ordinal) <= 0),
                _ => baseQuery.Where(x => 
                    x.InvoiceNo.ToLower().Contains(faturaNoA ?? string.Empty) ||
                    x.InvoiceNo.ToLower().Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c").Contains(fNoNorm))
            };
        }

        var cariAdiA = NormalizeTextLower(cariAdiV1);
        var cariAdiB = NormalizeTextLower(cariAdiV2);
        var cariAdiO = NormalizeOp(cariAdiOp);
        if (cariAdiA is not null || (cariAdiO == "between" && cariAdiB is not null) || cariAdiO == "empty" || cariAdiO == "not_empty")
        {
            var cariNorm = cariAdiA is not null ? NormalizeTurkishSearch(cariAdiA) : string.Empty;
            baseQuery = cariAdiO switch
            {
                "empty" => baseQuery.Where(x => string.IsNullOrEmpty(x.CustomerNameOverride ?? x.CustomerName)),
                "not_empty" => baseQuery.Where(x => !string.IsNullOrEmpty(x.CustomerNameOverride ?? x.CustomerName)),
                "not_contains" => baseQuery.Where(x => 
                    !((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower().Contains(cariAdiA ?? string.Empty) &&
                    !((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower()
                        .Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c")
                        .Contains(cariNorm)),
                "starts_with" => baseQuery.Where(x => 
                    ((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower().StartsWith(cariAdiA ?? string.Empty) ||
                    ((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower()
                        .Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c")
                        .StartsWith(cariNorm)),
                "ends_with" => baseQuery.Where(x => 
                    ((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower().EndsWith(cariAdiA ?? string.Empty) ||
                    ((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower()
                        .Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c")
                        .EndsWith(cariNorm)),
                "eq" => baseQuery.Where(x => 
                    ((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower() == (cariAdiA ?? string.Empty) ||
                    ((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower()
                        .Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c") == cariNorm),
                "neq" => baseQuery.Where(x => 
                    ((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower() != (cariAdiA ?? string.Empty) &&
                    ((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower()
                        .Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c") != cariNorm),
                "between" => baseQuery.Where(x => string.Compare(((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower(), cariAdiA ?? string.Empty, StringComparison.Ordinal) >= 0 && string.Compare(((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower(), cariAdiB ?? string.Empty, StringComparison.Ordinal) <= 0),
                _ => baseQuery.Where(x => 
                    ((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower().Contains(cariAdiA ?? string.Empty) ||
                    ((x.CustomerNameOverride ?? x.CustomerName) ?? string.Empty).ToLower()
                        .Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c")
                        .Contains(cariNorm))
            };
        }

        var brutO = NormalizeOp(brutTutarOp);
        if (TryParseDecimal(brutTutarV1, out var brutA) || (brutO == "between" && TryParseDecimal(brutTutarV2, out _)) || brutO == "empty" || brutO == "not_empty")
        {
            var hasA = TryParseDecimal(brutTutarV1, out brutA);
            var hasB = TryParseDecimal(brutTutarV2, out var brutB);
            if (brutO == "empty")
            {
                baseQuery = baseQuery.Where(x => x.Subtotal == 0);
            }
            else if (brutO == "not_empty")
            {
                baseQuery = baseQuery.Where(x => x.Subtotal != 0);
            }
            else if (brutO == "between")
            {
                if (hasA && hasB)
                {
                    var min = Math.Min(brutA, brutB);
                    var max = Math.Max(brutA, brutB);
                    baseQuery = baseQuery.Where(x => x.Subtotal >= min && x.Subtotal <= max);
                }
                else if (hasA) baseQuery = baseQuery.Where(x => x.Subtotal >= brutA);
                else if (hasB) baseQuery = baseQuery.Where(x => x.Subtotal <= brutB);
            }
            else if (hasA)
            {
                baseQuery = brutO switch
                {
                    "eq" => baseQuery.Where(x => x.Subtotal == brutA),
                    "neq" => baseQuery.Where(x => x.Subtotal != brutA),
                    "lt" => baseQuery.Where(x => x.Subtotal < brutA),
                    "gt" => baseQuery.Where(x => x.Subtotal > brutA),
                    "lte" => baseQuery.Where(x => x.Subtotal <= brutA),
                    "gte" => baseQuery.Where(x => x.Subtotal >= brutA),
                    _ => baseQuery
                };
            }
        }

        var iskO = NormalizeOp(iskontoOp);
        if (TryParseDecimal(iskontoV1, out var iskA) || (iskO == "between" && TryParseDecimal(iskontoV2, out _)) || iskO == "empty" || iskO == "not_empty")
        {
            var hasA = TryParseDecimal(iskontoV1, out iskA);
            var hasB = TryParseDecimal(iskontoV2, out var iskB);
            if (iskO == "empty")
            {
                baseQuery = baseQuery.Where(x => x.Discount == 0);
            }
            else if (iskO == "not_empty")
            {
                baseQuery = baseQuery.Where(x => x.Discount != 0);
            }
            else if (iskO == "between")
            {
                if (hasA && hasB)
                {
                    var min = Math.Min(iskA, iskB);
                    var max = Math.Max(iskA, iskB);
                    baseQuery = baseQuery.Where(x => x.Discount >= min && x.Discount <= max);
                }
                else if (hasA) baseQuery = baseQuery.Where(x => x.Discount >= iskA);
                else if (hasB) baseQuery = baseQuery.Where(x => x.Discount <= iskB);
            }
            else if (hasA)
            {
                baseQuery = iskO switch
                {
                    "eq" => baseQuery.Where(x => x.Discount == iskA),
                    "neq" => baseQuery.Where(x => x.Discount != iskA),
                    "lt" => baseQuery.Where(x => x.Discount < iskA),
                    "gt" => baseQuery.Where(x => x.Discount > iskA),
                    "lte" => baseQuery.Where(x => x.Discount <= iskA),
                    "gte" => baseQuery.Where(x => x.Discount >= iskA),
                    _ => baseQuery
                };
            }
        }

        var kmpO = NormalizeOp(kampanyaIndirimiOp);
        if (TryParseDecimal(kampanyaIndirimiV1, out var kmpA) || (kmpO == "between" && TryParseDecimal(kampanyaIndirimiV2, out _)) || kmpO == "empty" || kmpO == "not_empty")
        {
            var hasA = TryParseDecimal(kampanyaIndirimiV1, out kmpA);
            var hasB = TryParseDecimal(kampanyaIndirimiV2, out var kmpB);
            if (kmpO == "empty")
            {
                baseQuery = baseQuery.Where(x => x.CampaignDiscount == 0);
            }
            else if (kmpO == "not_empty")
            {
                baseQuery = baseQuery.Where(x => x.CampaignDiscount != 0);
            }
            else if (kmpO == "between")
            {
                if (hasA && hasB)
                {
                    var min = Math.Min(kmpA, kmpB);
                    var max = Math.Max(kmpA, kmpB);
                    baseQuery = baseQuery.Where(x => x.CampaignDiscount >= min && x.CampaignDiscount <= max);
                }
                else if (hasA) baseQuery = baseQuery.Where(x => x.CampaignDiscount >= kmpA);
                else if (hasB) baseQuery = baseQuery.Where(x => x.CampaignDiscount <= kmpB);
            }
            else if (hasA)
            {
                baseQuery = kmpO switch
                {
                    "eq" => baseQuery.Where(x => x.CampaignDiscount == kmpA),
                    "neq" => baseQuery.Where(x => x.CampaignDiscount != kmpA),
                    "lt" => baseQuery.Where(x => x.CampaignDiscount < kmpA),
                    "gt" => baseQuery.Where(x => x.CampaignDiscount > kmpA),
                    "lte" => baseQuery.Where(x => x.CampaignDiscount <= kmpA),
                    "gte" => baseQuery.Where(x => x.CampaignDiscount >= kmpA),
                    _ => baseQuery
                };
            }
        }

        var netO = NormalizeOp(netTutarOp);
        if (TryParseDecimal(netTutarV1, out var netA) || (netO == "between" && TryParseDecimal(netTutarV2, out _)) || netO == "empty" || netO == "not_empty")
        {
            var hasA = TryParseDecimal(netTutarV1, out netA);
            var hasB = TryParseDecimal(netTutarV2, out var netB);
            if (netO == "empty")
            {
                baseQuery = baseQuery.Where(x => x.NetTotal == 0);
            }
            else if (netO == "not_empty")
            {
                baseQuery = baseQuery.Where(x => x.NetTotal != 0);
            }
            else if (netO == "between")
            {
                if (hasA && hasB)
                {
                    var min = Math.Min(netA, netB);
                    var max = Math.Max(netA, netB);
                    baseQuery = baseQuery.Where(x => x.NetTotal >= min && x.NetTotal <= max);
                }
                else if (hasA) baseQuery = baseQuery.Where(x => x.NetTotal >= netA);
                else if (hasB) baseQuery = baseQuery.Where(x => x.NetTotal <= netB);
            }
            else if (hasA)
            {
                baseQuery = netO switch
                {
                    "eq" => baseQuery.Where(x => x.NetTotal == netA),
                    "neq" => baseQuery.Where(x => x.NetTotal != netA),
                    "lt" => baseQuery.Where(x => x.NetTotal < netA),
                    "gt" => baseQuery.Where(x => x.NetTotal > netA),
                    "lte" => baseQuery.Where(x => x.NetTotal <= netA),
                    "gte" => baseQuery.Where(x => x.NetTotal >= netA),
                    _ => baseQuery
                };
            }
        }

        var kdvO = NormalizeOp(kdvTutariOp);
        if (TryParseDecimal(kdvTutariV1, out var kdvA) || (kdvO == "between" && TryParseDecimal(kdvTutariV2, out _)) || kdvO == "empty" || kdvO == "not_empty")
        {
            var hasA = TryParseDecimal(kdvTutariV1, out kdvA);
            var hasB = TryParseDecimal(kdvTutariV2, out var kdvB);
            if (kdvO == "empty")
            {
                baseQuery = baseQuery.Where(x => x.VatTotal == 0);
            }
            else if (kdvO == "not_empty")
            {
                baseQuery = baseQuery.Where(x => x.VatTotal != 0);
            }
            else if (kdvO == "between")
            {
                if (hasA && hasB)
                {
                    var min = Math.Min(kdvA, kdvB);
                    var max = Math.Max(kdvA, kdvB);
                    baseQuery = baseQuery.Where(x => x.VatTotal >= min && x.VatTotal <= max);
                }
                else if (hasA) baseQuery = baseQuery.Where(x => x.VatTotal >= kdvA);
                else if (hasB) baseQuery = baseQuery.Where(x => x.VatTotal <= kdvB);
            }
            else if (hasA)
            {
                baseQuery = kdvO switch
                {
                    "eq" => baseQuery.Where(x => x.VatTotal == kdvA),
                    "neq" => baseQuery.Where(x => x.VatTotal != kdvA),
                    "lt" => baseQuery.Where(x => x.VatTotal < kdvA),
                    "gt" => baseQuery.Where(x => x.VatTotal > kdvA),
                    "lte" => baseQuery.Where(x => x.VatTotal <= kdvA),
                    "gte" => baseQuery.Where(x => x.VatTotal >= kdvA),
                    _ => baseQuery
                };
            }
        }

        var genO = NormalizeOp(genelToplamOp);
        if (TryParseDecimal(genelToplamV1, out var genA) || (genO == "between" && TryParseDecimal(genelToplamV2, out _)) || genO == "empty" || genO == "not_empty")
        {
            var hasA = TryParseDecimal(genelToplamV1, out genA);
            var hasB = TryParseDecimal(genelToplamV2, out var genB);
            if (genO == "empty")
            {
                baseQuery = baseQuery.Where(x => x.GrandTotal == 0);
            }
            else if (genO == "not_empty")
            {
                baseQuery = baseQuery.Where(x => x.GrandTotal != 0);
            }
            else if (genO == "between")
            {
                if (hasA && hasB)
                {
                    var min = Math.Min(genA, genB);
                    var max = Math.Max(genA, genB);
                    baseQuery = baseQuery.Where(x => x.GrandTotal >= min && x.GrandTotal <= max);
                }
                else if (hasA) baseQuery = baseQuery.Where(x => x.GrandTotal >= genA);
                else if (hasB) baseQuery = baseQuery.Where(x => x.GrandTotal <= genB);
            }
            else if (hasA)
            {
                baseQuery = genO switch
                {
                    "eq" => baseQuery.Where(x => x.GrandTotal == genA),
                    "neq" => baseQuery.Where(x => x.GrandTotal != genA),
                    "lt" => baseQuery.Where(x => x.GrandTotal < genA),
                    "gt" => baseQuery.Where(x => x.GrandTotal > genA),
                    "lte" => baseQuery.Where(x => x.GrandTotal <= genA),
                    "gte" => baseQuery.Where(x => x.GrandTotal >= genA),
                    _ => baseQuery
                };
            }
        }

        var plasiyerA = NormalizeTextLower(plasiyerV1);
        var plasiyerB = NormalizeTextLower(plasiyerV2);
        var plasiyerO = NormalizeOp(plasiyerOp);
        if (plasiyerA is not null || (plasiyerO == "between" && plasiyerB is not null) || plasiyerO == "empty" || plasiyerO == "not_empty")
        {
            baseQuery = plasiyerO switch
            {
                "empty" => baseQuery.Where(x => string.IsNullOrEmpty(x.SalesmanCode)),
                "not_empty" => baseQuery.Where(x => !string.IsNullOrEmpty(x.SalesmanCode)),
                "not_contains" => baseQuery.Where(x => !x.SalesmanCode.ToLower().Contains(plasiyerA ?? string.Empty)),
                "starts_with" => baseQuery.Where(x => x.SalesmanCode.ToLower().StartsWith(plasiyerA ?? string.Empty)),
                "ends_with" => baseQuery.Where(x => x.SalesmanCode.ToLower().EndsWith(plasiyerA ?? string.Empty)),
                "eq" => baseQuery.Where(x => x.SalesmanCode.ToLower() == (plasiyerA ?? string.Empty)),
                "neq" => baseQuery.Where(x => x.SalesmanCode.ToLower() != (plasiyerA ?? string.Empty)),
                "between" => baseQuery.Where(x => string.Compare(x.SalesmanCode.ToLower(), plasiyerA ?? string.Empty, StringComparison.Ordinal) >= 0 && string.Compare(x.SalesmanCode.ToLower(), plasiyerB ?? string.Empty, StringComparison.Ordinal) <= 0),
                _ => baseQuery.Where(x => x.SalesmanCode.ToLower().Contains(plasiyerA ?? string.Empty))
            };
        }

        var islemYapanA = NormalizeTextLower(islemYapanV1);
        var islemYapanB = NormalizeTextLower(islemYapanV2);
        var islemYapanO = NormalizeOp(islemYapanOp);
        if (islemYapanA is not null || (islemYapanO == "between" && islemYapanB is not null) || islemYapanO == "empty" || islemYapanO == "not_empty")
        {
            baseQuery = islemYapanO switch
            {
                "empty" => baseQuery.Where(x => string.IsNullOrEmpty(x.CreateUser)),
                "not_empty" => baseQuery.Where(x => !string.IsNullOrEmpty(x.CreateUser)),
                "not_contains" => baseQuery.Where(x => !x.CreateUser.ToLower().Contains(islemYapanA ?? string.Empty)),
                "starts_with" => baseQuery.Where(x => x.CreateUser.ToLower().StartsWith(islemYapanA ?? string.Empty)),
                "ends_with" => baseQuery.Where(x => x.CreateUser.ToLower().EndsWith(islemYapanA ?? string.Empty)),
                "eq" => baseQuery.Where(x => x.CreateUser.ToLower() == (islemYapanA ?? string.Empty)),
                "neq" => baseQuery.Where(x => x.CreateUser.ToLower() != (islemYapanA ?? string.Empty)),
                "between" => baseQuery.Where(x => string.Compare(x.CreateUser.ToLower(), islemYapanA ?? string.Empty, StringComparison.Ordinal) >= 0 && string.Compare(x.CreateUser.ToLower(), islemYapanB ?? string.Empty, StringComparison.Ordinal) <= 0),
                _ => baseQuery.Where(x => x.CreateUser.ToLower().Contains(islemYapanA ?? string.Empty))
            };
        }

        /*
          ÇIKIŞ DEPOSU SÜZGECİ (2026-09-16, kullanıcı bildirimi: "fatura dökümünde çıkış deposu
          filtresi çalışmıyor").

          Kolon 2026-09-05'te eklendi ama uçta karşılığı yoktu: ekran `cikisDeposuOp/V1`
          gönderiyor, parametre bağlanmadığı için süzgeç sessizce yok sayılıyordu.

          Depo başlıkta değil KALEMDE durur; hücrede görünen metin "KOD AD" (ör. "11 MAGAZA DEPO")
          ya da birden çok depoda "Karışık (n depo): ...". Bu yüzden eşleşme depo bazında
          yapılır: aranan metin depo etiketine uyan depolar bellekte bulunur (depo tablosu
          küçük), fatura kalemlerinden BİRİ o depolardan çıktıysa fatura listede kalır. Olumsuz
          operatörlerde (içermez / eşit değil) HİÇBİR kalem o depolardan çıkmamış olmalı.
          Türkçe harf farkı gözetilmez ("mağaza" = "MAGAZA").
        */
        var cikisDeposuO = NormalizeOp(cikisDeposuOp);
        var cikisDeposuA = NormalizeTurkishFilterValue(cikisDeposuV1);
        if (cikisDeposuO == "empty" || cikisDeposuO == "not_empty")
        {
            var varMi = cikisDeposuO == "not_empty";
            baseQuery = baseQuery.Where(x =>
                _dbContext.Set<InvoiceLine>().Any(l => l.InvoiceId == x.Id && l.WarehouseCode != null) == varMi);
        }
        else if (cikisDeposuA.Length > 0)
        {
            var depolar = await _dbContext.Warehouses
                .AsNoTracking()
                .Select(w => new { w.WarehouseCode, w.Name })
                .ToListAsync(cancellationToken);

            bool Uyar(string etiket) => cikisDeposuO switch
            {
                "starts_with" => etiket.StartsWith(cikisDeposuA, StringComparison.Ordinal),
                "ends_with" => etiket.EndsWith(cikisDeposuA, StringComparison.Ordinal),
                "eq" or "neq" => etiket == cikisDeposuA,
                _ => etiket.Contains(cikisDeposuA, StringComparison.Ordinal)
            };

            var eslesenKodlar = depolar
                .Where(w =>
                {
                    var kod = w.WarehouseCode.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    var etiket = NormalizeTurkishFilterValue(string.IsNullOrWhiteSpace(w.Name) ? kod : $"{kod} {w.Name}");
                    // Yalnız ad ya da yalnız kod yazılmışsa da ("eşittir" dahil) bulunsun.
                    return Uyar(etiket) || Uyar(kod) || (!string.IsNullOrWhiteSpace(w.Name) && Uyar(NormalizeTurkishFilterValue(w.Name)));
                })
                .Select(w => w.WarehouseCode)
                .ToList();

            var olumsuz = cikisDeposuO == "not_contains" || cikisDeposuO == "neq";
            baseQuery = olumsuz
                ? baseQuery.Where(x => !_dbContext.Set<InvoiceLine>()
                    .Any(l => l.InvoiceId == x.Id && l.WarehouseCode != null && eslesenKodlar.Contains(l.WarehouseCode.Value)))
                : baseQuery.Where(x => _dbContext.Set<InvoiceLine>()
                    .Any(l => l.InvoiceId == x.Id && l.WarehouseCode != null && eslesenKodlar.Contains(l.WarehouseCode.Value)));
        }

        var normalizedPage = Math.Max(1, page ?? 1);
        // ÜST SINIR 5000 — arayüzdeki "Sınırsız" seçeneğiyle AYNI sayı olmak zorunda
        // (`DataTablePagination.UNLIMITED_PAGE_SIZE`). Ayrışırsa istemci tek sayfa sanar,
        // sunucu kırpılmış sayfa döndürür ve kalan kayıtlara ulaşılamaz.
        var normalizedPageSize = Math.Clamp(pageSize ?? 10, 1, 5000);

        const int maxDeadlockAttempts = 3;
        for (var attempt = 1; attempt <= maxDeadlockAttempts; attempt++)
        {
            try
            {
                var totalCount = await baseQuery.CountAsync(cancellationToken);

                var queryForPage = baseQuery;
                
                var sortB = NormalizeTextLower(sortBy) ?? "tarih";
                var isDesc = NormalizeTextLower(sortDir) == "desc";

                queryForPage = sortB switch
                {
                    "islemtipi" => isDesc ? queryForPage.OrderByDescending(x => x.Type).ThenByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.Type).ThenByDescending(x => x.InvoiceNo),
                    "tarih" => isDesc ? queryForPage.OrderByDescending(x => x.Date).ThenByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.Date).ThenByDescending(x => x.InvoiceNo),
                    "faturano" => isDesc ? queryForPage.OrderByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.InvoiceNo),
                    "cariadi" => isDesc ? queryForPage.OrderByDescending(x => x.CustomerName).ThenByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.CustomerName).ThenByDescending(x => x.InvoiceNo),
                    "faturaacik" => isDesc 
                        ? queryForPage.OrderByDescending(x => !string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) ? x.CustomerInvoiceTypeOverride : x.CustomerInvoiceType).ThenByDescending(x => x.InvoiceNo)
                        : queryForPage.OrderBy(x => !string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) ? x.CustomerInvoiceTypeOverride : x.CustomerInvoiceType).ThenByDescending(x => x.InvoiceNo),
                    "bruttutar" => isDesc ? queryForPage.OrderByDescending(x => x.Subtotal).ThenByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.Subtotal).ThenByDescending(x => x.InvoiceNo),
                    "iskonto" => isDesc ? queryForPage.OrderByDescending(x => x.Discount).ThenByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.Discount).ThenByDescending(x => x.InvoiceNo),
                    "kampanyaindirimi" => isDesc ? queryForPage.OrderByDescending(x => x.CampaignDiscount).ThenByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.CampaignDiscount).ThenByDescending(x => x.InvoiceNo),
                    "nettutar" => isDesc ? queryForPage.OrderByDescending(x => x.NetTotal).ThenByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.NetTotal).ThenByDescending(x => x.InvoiceNo),
                    "kdvtutari" => isDesc ? queryForPage.OrderByDescending(x => x.VatTotal).ThenByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.VatTotal).ThenByDescending(x => x.InvoiceNo),
                    "geneltoplam" => isDesc ? queryForPage.OrderByDescending(x => x.GrandTotal).ThenByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.GrandTotal).ThenByDescending(x => x.InvoiceNo),
                    "plasiyer" => isDesc ? queryForPage.OrderByDescending(x => x.SalesmanCode).ThenByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.SalesmanCode).ThenByDescending(x => x.InvoiceNo),
                    "islemyapan" => isDesc ? queryForPage.OrderByDescending(x => x.CreateUser).ThenByDescending(x => x.InvoiceNo) : queryForPage.OrderBy(x => x.CreateUser).ThenByDescending(x => x.InvoiceNo),
                    _ => queryForPage.OrderByDescending(x => x.Date).ThenByDescending(x => x.InvoiceNo)
                };

                var rows = await queryForPage
                    .Skip((normalizedPage - 1) * normalizedPageSize)
                    .Take(normalizedPageSize)
                    .ToListAsync(cancellationToken);

                var invoiceIds = rows.Select(x => x.Id).ToList();
                var invoiceNos = rows.Select(x => x.InvoiceNo).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
                var invoiceTypeById = rows.ToDictionary(x => x.Id, x => x.Type);

                var cashTx = await _dbContext.Set<CashAccountTransaction>()
                    .AsNoTracking()
                    .Where(x => x.ReferenceType == CashAccountTransactionReferenceType.Invoice
                                && x.ReferenceId.HasValue
                                && invoiceIds.Contains(x.ReferenceId.Value)
                                && (x.Direction == CashAccountTransactionDirection.In || x.Direction == CashAccountTransactionDirection.Out))
                    .Join(_dbContext.CashAccounts.AsNoTracking(), t => t.CashAccountId, a => a.Id, (t, a) => new
                    {
                        InvoiceId = t.ReferenceId!.Value,
                        CashAccountId = a.Id,
                        CashAccountCode = a.Code,
                        CashAccountName = a.Name,
                        Direction = t.Direction,
                        Amount = t.Amount
                    })
                    .ToListAsync(cancellationToken);

                var cashByInvoiceId = cashTx
                    .GroupBy(x => x.InvoiceId)
                    .ToDictionary(g => g.Key, g => g.ToList());

                /*
                  ÇIKIŞ DEPOSU (2026-09-05 kullanıcı isteği: "fatura dökümünde malın hangi
                  depodan çıktığı yazsın").

                  Depo fatura BAŞLIĞINDA değil, KALEM seviyesinde duruyor
                  (`InvoiceLine.WarehouseCode`) — bir faturanın kalemleri farklı depolardan
                  çıkabiliyor (servis kalemi teknisyenin aracından çıkar). Bu yüzden:
                    - tek depo varsa adı yazılır,
                    - birden çok depo varsa "Karışık (n depo)" yazılır; hangi depolar olduğu
                      ekranda ipucu olarak gösterilir,
                    - kalemi olmayan/deposu boş faturada boş kalır (hizmet faturası gibi).

                  Depo ADI ayrı tabloda; kod→ad eşlemesi tek sorguyla alınıp bellekte kuruluyor.
                */
                var lineWarehouses = await _dbContext.Set<InvoiceLine>()
                    .AsNoTracking()
                    .Where(l => invoiceIds.Contains(l.InvoiceId) && l.WarehouseCode != null)
                    .Select(l => new { l.InvoiceId, Code = l.WarehouseCode!.Value })
                    .Distinct()
                    .ToListAsync(cancellationToken);

                var warehouseNameByCode = new Dictionary<int, string>();
                if (lineWarehouses.Count > 0)
                {
                    var kodlar = lineWarehouses.Select(x => x.Code).Distinct().ToList();
                    warehouseNameByCode = await _dbContext.Warehouses
                        .AsNoTracking()
                        .Where(w => kodlar.Contains(w.WarehouseCode))
                        .ToDictionaryAsync(w => w.WarehouseCode, w => w.Name ?? string.Empty, cancellationToken);
                }

                var warehouseByInvoiceId = lineWarehouses
                    .GroupBy(x => x.InvoiceId)
                    .ToDictionary(
                        g => g.Key,
                        g =>
                        {
                            var adlar = g
                                .Select(x => warehouseNameByCode.TryGetValue(x.Code, out var ad) && !string.IsNullOrWhiteSpace(ad)
                                    ? $"{x.Code} {ad}"
                                    : x.Code.ToString())
                                .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
                                .ToList();

                            return adlar.Count == 1
                                ? adlar[0]
                                : $"Karışık ({adlar.Count} depo): {string.Join(", ", adlar)}";
                        });

                var bankTx = await _dbContext.Set<BankAccountTransaction>()
                    .AsNoTracking()
                    .Where(x => (x.Direction == BankAccountTransactionDirection.In || x.Direction == BankAccountTransactionDirection.Out)
                                && x.DocumentNo != null
                                && invoiceNos.Contains(x.DocumentNo))
                    .Join(_dbContext.BankAccountDefinitions.AsNoTracking(), t => t.BankAccountDefinitionId, a => a.Id, (t, a) => new
                    {
                        InvoiceNo = t.DocumentNo!,
                        BankAccountDefinitionId = a.Id,
                        BankAccountCode = a.AccountCode,
                        BankAccountName = a.AccountName,
                        Direction = t.Direction,
                        Amount = t.Amount,
                        IsPosFee = t.IsPosFee
                    })
                    .ToListAsync(cancellationToken);

                var bankByInvoiceNo = bankTx
                    .GroupBy(x => x.InvoiceNo)
                    .ToDictionary(g => g.Key, g => g.ToList());

                var items = rows
                    .Select(x =>
                    {
                var paid = false;
                string? paidTo = null;

                var expectedCashDirection = x.Type == InvoiceType.PurchaseInvoice
                                            || x.Type == InvoiceType.ServiceInvoice
                                            || x.Type == InvoiceType.ReturnInvoice
                    ? CashAccountTransactionDirection.Out
                    : CashAccountTransactionDirection.In;

                var expectedBankDirection = x.Type == InvoiceType.PurchaseInvoice
                                            || x.Type == InvoiceType.ServiceInvoice
                                            || x.Type == InvoiceType.ReturnInvoice
                    ? BankAccountTransactionDirection.Out
                    : BankAccountTransactionDirection.In;

                var totalPaidTry = 0m;
                var paidTargetsList = new List<string>();

                if (x.IsManuallyPaid)
                {
                    paid = true;
                    paidTo = "Manuel Ödeme";
                }
                else
                {
                    if (cashByInvoiceId.TryGetValue(x.Id, out var cList))
                    {
                        foreach (var c in cList.Where(t => t.Direction == expectedCashDirection))
                        {
                            totalPaidTry += c.Amount;
                            paidTargetsList.Add($"Kasa: {c.CashAccountCode}{(!string.IsNullOrWhiteSpace(c.CashAccountName) ? " - " + c.CashAccountName : string.Empty)} ({c.Amount:N2} TL)");
                        }
                    }

                    if (bankByInvoiceNo.TryGetValue(x.InvoiceNo, out var bList))
                    {
                        foreach (var b in bList.Where(t => t.Direction == expectedBankDirection && !t.IsPosFee))
                        {
                            totalPaidTry += b.Amount;
                            paidTargetsList.Add($"Banka: {b.BankAccountCode}{(!string.IsNullOrWhiteSpace(b.BankAccountName) ? " - " + b.BankAccountName : string.Empty)} ({b.Amount:N2} TL)");
                        }
                    }

                    if (!x.IsPriceOverridden && totalPaidTry >= (x.GrandTotal - 0.05m))
                    {
                        paid = true;
                        paidTo = string.Join(", ", paidTargetsList);
                    }
                    else if (totalPaidTry > 0)
                    {
                        paid = false;
                        paidTo = $"Kısmi Ödeme: {string.Join(", ", paidTargetsList)}";
                    }
                }

                return new InvoiceListItemResponse
                {
                    Id = x.Id,
                    // `Type` TEK BAŞINA faturanın ne olduğunu SÖYLEMEZ: `ServiceInvoice` ('H')
                    // hem SERVİS GELİRİ hem de ALIŞ tarafındaki GİDER FATURASI için kullanılıyor.
                    // Ayırt edici alan `SourcePurchaseInvoiceId` — doluysa belge bir alış
                    // faturasından türemiştir. Bu ayrım yapılmadığı için kullanıcının kestiği
                    // hizmet ALIŞ faturası dökümde "TAMİR" (servis geliri) görünüyordu.
                    IslemTipi = x.Type == InvoiceType.SalesInvoice
                        ? "SATIŞ"
                        : x.Type == InvoiceType.PurchaseInvoice
                            ? "ALIŞ"
                            : x.Type == InvoiceType.ServiceInvoice
                                ? (x.SourcePurchaseInvoiceId.HasValue && x.SourcePurchaseInvoiceId.Value > 0
                                    ? "HİZMET"
                                    : "TAMİR")
                                : x.Type == InvoiceType.ReturnInvoice
                                    ? "İADE"
                                    : x.Type.ToString(),
                    Tarih = x.Date,
                    FaturaNo = x.InvoiceNo,
                    SourceCustomerOfferId = x.SourceCustomerOfferId,
                    CariAdi = !string.IsNullOrWhiteSpace(x.CustomerNameOverride) ? x.CustomerNameOverride : x.CustomerName,
                    CariKodu = x.CustomerCode ?? string.Empty,
                    FaturaAcik = ((x.CustomerCode != null && (x.CustomerCode.EndsWith("-3") || x.CustomerCode.Contains("-3]"))) ||
                                 (!string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) && (x.CustomerInvoiceTypeOverride == "ASKERIYE" || x.CustomerInvoiceTypeOverride == "ASKERİYE" || x.CustomerInvoiceTypeOverride == "MUAF")) ||
                                 (!string.IsNullOrWhiteSpace(x.CustomerInvoiceType) && (x.CustomerInvoiceType == "ASKERIYE" || x.CustomerInvoiceType == "ASKERİYE" || x.CustomerInvoiceType == "MUAF")))
                                 ? "MUAF"
                                 : (!string.IsNullOrWhiteSpace(x.CustomerInvoiceTypeOverride) ? x.CustomerInvoiceTypeOverride : x.CustomerInvoiceType),
                    BrutTutar = x.Subtotal,
                    Iskonto = x.Discount,
                    KampanyaIndirimi = x.CampaignDiscount,
                    NetTutar = x.NetTotal,
                    KdvTutari = x.VatTotal,
                    GenelToplam = x.GrandTotal,
                    // Belgenin kendi para birimi + donmuş kuru (fatura başlığında saklanıyor).
                    ParaBirimiTipi = x.CurrencyTypeId,
                    Kur = x.ExchangeRate <= 0m ? 1m : x.ExchangeRate,
                    CikisDeposu = warehouseByInvoiceId.TryGetValue(x.Id, out var depoAdi) ? depoAdi : null,
                    Plasiyer = !string.IsNullOrWhiteSpace(x.SalesmanCode)
                        ? (!string.IsNullOrWhiteSpace(x.SalesmanName) ? $"{x.SalesmanCode} - {x.SalesmanName}" : x.SalesmanCode)
                        : null,
                    IslemYapan = x.CreateUser,
                    Saat = x.CreateTime,
                    OdemeAlindi = paid,
                    OdemeHedefi = paidTo,
                    OdemeKasaId = cashByInvoiceId.TryGetValue(x.Id, out var c2List) ? c2List.FirstOrDefault(t => t.Direction == expectedCashDirection)?.CashAccountId : null,
                    OdemeBankaId = bankByInvoiceNo.TryGetValue(x.InvoiceNo, out var b2List) ? b2List.FirstOrDefault(t => t.Direction == expectedBankDirection)?.BankAccountDefinitionId : null
                };
            })
            .ToList();

        // HATA AYIKLAMA KALINTISI KALDIRILDI (2026-08-22).
        //
        // Burada her istekte bütün cevap `invoice_list_response.json` diye diske yazılıyordu:
        // sayfa başına serileştirme + dosya yazımı. Fatura Dökümü'nün yavaşlığının bir parçası
        // buydu. Ayrıca dosya uygulama klasöründe duruyor ve son isteğin fatura verisini
        // (cari adları, tutarlar) düz metin olarak taşıyor — sunucuda gereksiz bir sızıntı.
        return Ok(new { success = true, data = new { items, total = totalCount, page = normalizedPage, pageSize = normalizedPageSize } });
    }
            catch (PostgresException ex) when (ex.SqlState == "40P01" && attempt < maxDeadlockAttempts)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(100 * attempt), cancellationToken);
            }
            catch (InvalidOperationException ex) when (attempt < maxDeadlockAttempts && ex.InnerException is PostgresException pg && pg.SqlState == "40P01")
            {
                await Task.Delay(TimeSpan.FromMilliseconds(100 * attempt), cancellationToken);
            }
        }

        return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Geçici veritabanı kilidi oluştu. Lütfen tekrar deneyin." });

    }

    /// <summary>
    /// The invoice as it goes onto the pre-printed form, as a PDF.
    ///
    /// The variable data only — no frame, no captions, no heading. Those are already printed on
    /// the stock, and the layout is measured to the tenth of a millimetre against the output of
    /// the ERP this replaces (docs/fatura-basim-olculeri.md). The browser must not scale it.
    /// </summary>
    [HttpGet("{invoiceId:int}/yazdir")]
    [AuthorizePage("invoice", "faturaDokum")]
    public async Task<IActionResult> PrintInvoice([FromRoute] int invoiceId, CancellationToken cancellationToken)
    {
        var model = await new InvoicePrintModelBuilder(_dbContext).BuildAsync(invoiceId, cancellationToken);
        if (model is null)
        {
            return NotFound(new { success = false, message = "Fatura bulunamadı" });
        }

        var pdf = new InvoiceFormRenderer().Render(model);

        // inline: the point is to land in the print dialog, not the downloads folder.
        Response.Headers.ContentDisposition = $"inline; filename=fatura-{invoiceId}.pdf";
        return File(pdf, "application/pdf");
    }

    /// <summary>
    /// Barcode labels for everything on the invoice, one page per unit.
    ///
    /// Drawn on the server for the same reason the invoice is: the symbol has to come out at the
    /// exact module width or a scanner will not read it, and a browser printing HTML cannot
    /// promise that. Lines whose barcode is not valid EAN-13 are left out and counted, rather
    /// than printed as something that only looks like a barcode.
    /// </summary>
    [HttpGet("{invoiceId:int}/barkod")]
    [AuthorizePage("invoice", "faturaDokum")]
    public async Task<IActionResult> PrintInvoiceBarcodes([FromRoute] int invoiceId, CancellationToken cancellationToken)
    {
        var model = await new InvoicePrintModelBuilder(_dbContext).BuildAsync(invoiceId, cancellationToken);
        if (model is null)
        {
            return NotFound(new { success = false, message = "Fatura bulunamadı" });
        }

        /*
          ETİKET FİYATI: "ETİKET BASIM FİYATLI" EKRANIYLA AYNI KURAL (2026-08-24).

          Önce `line.Fiyat` basılıyordu — faturanın satır fiyatı, yani BAYİNİN FİYAT GRUBUNA
          göre hesaplanmış tutar. Aynı ürünün rafına, faturanın kesildiği bayiye göre farklı
          etiket çıkıyordu. Doğrusu katalog fiyatı (Fiyat 4).

          KURAL EKRANIN KENDİ KURALIDIR, buraya UYDURULMADI. `EtiketBasimPage.tsx` içindeki
          `ensureF4Groups` + `getProductEffectivePriceInfo` birebir taşındı:

            1. Fiyat 4 grubu ADA GÖRE DEĞİL, SIRALAMAYLA bulunur. Grup adları ve formüller
               firmadan firmaya değişiyor; tek bir ölçüt (ör. yalnız `Code == 4`) bir firmada
               doğru, ötekinde sessizce yanlış fiyat demek:
                 0) Code==4 ve adı "4-60" kalıbında     3) adı "4"/"04" ile başlıyor
                 1) adı "4-60" kalıbında                4) formülü F4 / F4* / REMOVE_KDV(F4
                 2) Code==4
               Ürün için EN KÜÇÜK sıra numaralı grup kazanır.
            2. Fiyat 4 değeri > 0 ise o basılır; para birimi fiyat satırından, o boşsa ürünün
               satış dövizinden, o da yoksa ürünün dövizinden okunur.
            3. Fiyat 4 yoksa ürünün kendi birim fiyatına düşülür (ekran da öyle yapıyor).
            4. Çevrim YOK: fiyat hangi para birimindeyse o basılır.

          ⚠️ İKİ KOPYA AYNI KALMALI. Biri değişip öteki kalırsa aynı ürüne iki ekran iki farklı
          etiket basar — bu depoda fiyat motorlarında aynı kural zaten yazılı
          (bkz. PriceFormulaEvaluator ↔ AtliFiyatlandirmaPage).
        */
        var stokKodlari = await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(x => x.InvoiceId == invoiceId)
            .OrderBy(x => x.LineNo)
            .Select(x => x.StockCode)
            .ToListAsync(cancellationToken);

        var etiketFiyatlari = await ResolveLabelPricesAsync(stokKodlari, cancellationToken);

        /*
          Etiketi satırla eşlemek için stok kodu gerekiyor; basım modelinde o alan yok.
          Sıra güvenli: model satırları da fatura satırları da `LineNo` ile sıralanıyor ve
          basım modeli hiçbir satırı ELEMİYOR (builder bütün satırları döngüyle ekliyor).
        */
        var labels = model.Lines.Select((line, index) =>
        {
            var stokKodu = index < stokKodlari.Count ? stokKodlari[index] : null;
            LabelPrice? katalog = null;
            if (stokKodu != null) etiketFiyatlari.TryGetValue(stokKodu, out katalog);

            return new ProductLabel
            {
                // Catalogue name, not the line description: a line noted "Bu ürün jaleye teslim
                // edilecek" would otherwise print that on the label instead of the product.
                StokAdi = line.UrunAdi,
                Barkod = line.Barkod,
                Fiyat = katalog?.Price ?? line.Fiyat,
                ParaBirimi = katalog != null
                    ? katalog.Currency
                    : (string.IsNullOrWhiteSpace(model.ParaBirimiKodu) ? null : model.ParaBirimiKodu),
                // A line for three units gets three labels.
                Adet = (int)Math.Max(1, Math.Floor(line.Miktar)),
            };
        });

        var pdf = new ProductLabelRenderer().Render(labels, out var skipped);

        if (skipped > 0)
        {
            // Surfaced as a header so the page can tell the user, without turning a partly
            // usable print into an error.
            Response.Headers["X-Barkod-Atlanan"] = skipped.ToString();
        }

        Response.Headers.ContentDisposition = $"inline; filename=barkod-{invoiceId}.pdf";
        return File(pdf, "application/pdf");
    }

    /// <summary>Etiket icin cozulmus fiyat: tutar + basilacak para birimi.</summary>
    private sealed record LabelPrice(decimal Price, string? Currency);

    /// <summary>
    /// Stok kodlari icin ETIKET fiyatini cozer. Kural "Etiket Basim Fiyatli" ekraniyla
    /// birebir; ayrintili gerekce cagiran yerdeki aciklamada.
    /// </summary>
    private async Task<Dictionary<string, LabelPrice>> ResolveLabelPricesAsync(
        IReadOnlyCollection<string> stockCodes,
        CancellationToken cancellationToken)
    {
        var sonuc = new Dictionary<string, LabelPrice>(StringComparer.OrdinalIgnoreCase);
        if (stockCodes.Count == 0) return sonuc;

        var gruplar = await _dbContext.Set<PriceGroup>().AsNoTracking()
            .Select(g => new { g.Id, g.Code, g.Name, g.Formula })
            .ToListAsync(cancellationToken);

        // Sayfadaki `ensureF4Groups` ile ayni siralama.
        var sira = new Dictionary<Guid, int>();
        foreach (var g in gruplar)
        {
            var ad = (g.Name ?? string.Empty).Trim();
            var adKucuk = ad.ToLowerInvariant();
            var formul = (g.Formula ?? string.Empty).Trim().ToUpperInvariant();

            var tam60 = System.Text.RegularExpressions.Regex.IsMatch(adKucuk, @"^0?4\s*[-\u2013]\s*60\b")
                        || (adKucuk.Contains("60") && adKucuk.StartsWith("4"));
            var adaGore4 = ad.StartsWith("4", StringComparison.Ordinal) || ad.StartsWith("04", StringComparison.Ordinal);
            var f4Formul = formul == "F4" || formul.StartsWith("F4*", StringComparison.Ordinal)
                           || formul.StartsWith("REMOVE_KDV(F4", StringComparison.Ordinal);

            int? rank = null;
            if (g.Code == 4 && tam60) rank = 0;
            else if (tam60) rank = 1;
            else if (g.Code == 4) rank = 2;
            else if (adaGore4) rank = 3;
            else if (f4Formul) rank = 4;

            if (rank is null) continue;
            if (!sira.TryGetValue(g.Id, out var onceki) || rank.Value < onceki) sira[g.Id] = rank.Value;
        }

        if (sira.Count == 0) return sonuc;

        var grupIdleri = sira.Keys.ToList();

        var satirlar = await (
            from p in _dbContext.Set<Product>().AsNoTracking()
            join pp in _dbContext.Set<ProductPrice>().AsNoTracking() on p.Id equals pp.ProductId into ppj
            from pp in ppj.DefaultIfEmpty()
            where stockCodes.Contains(p.StockCode)
            select new
            {
                p.StockCode,
                p.SalesCurrencyCode,
                p.CurrencyCode,
                PriceGroupId = (Guid?)(pp != null ? pp.PriceGroupId : Guid.Empty),
                Price = (decimal?)(pp != null ? pp.Price : 0m),
                Currency = pp != null ? pp.Currency : null,
            }).ToListAsync(cancellationToken);

        foreach (var grup in satirlar.GroupBy(x => x.StockCode, StringComparer.OrdinalIgnoreCase))
        {
            var urun = grup.First();

            var enIyi = grup
                .Where(x => x.PriceGroupId.HasValue && sira.ContainsKey(x.PriceGroupId.Value))
                .OrderBy(x => sira[x.PriceGroupId!.Value])
                .FirstOrDefault();

            if (enIyi != null && (enIyi.Price ?? 0m) > 0m)
            {
                var kod = !string.IsNullOrWhiteSpace(enIyi.Currency)
                    ? enIyi.Currency!
                    : (urun.SalesCurrencyCode > 0 ? urun.SalesCurrencyCode.ToString() : urun.CurrencyCode.ToString());
                sonuc[grup.Key] = new LabelPrice(enIyi.Price!.Value, NormalizeLabelCurrency(kod));
                continue;
            }

            /*
              Fiyat 4 kaydi YOKSA burada bir sey donmuyoruz ve cagiran taraf FATURA SATIRI
              fiyatina dusuyor (eski davranis).

              Ekran bu durumda urunun `unitPrice` alanina dusuyor; ama o bir urun kolonu degil,
              ProductsController'in "en iyi fiyat grubu" mantigiyla TURETTIGI bir deger. Onu
              burada yeniden uretmeye calismak, tam da kacinmak istedigimiz seyi yapardi:
              ikinci bir fiyat kurali. Fiyat 4'u olmayan urun zaten etikete basilacak katalog
              fiyati olmayan urundur; fatura satiri en azindan gercek bir tutar.
            */
        }

        return sonuc;
    }

    /// <summary>Sayfadaki `normalizeCurrencyCode` ile birebir: EUR/USD/GBP disindaki her sey TL.</summary>
    private static string NormalizeLabelCurrency(string? raw)
    {
        var norm = (raw ?? string.Empty).Trim().ToUpperInvariant();
        if (norm == "EUR" || norm == "2") return "EUR";
        if (norm == "USD" || norm == "3") return "USD";
        if (norm == "GBP" || norm == "4") return "GBP";
        return "TL";
    }

    [HttpGet("{invoiceId:int}")]
    [AuthorizePage("invoice", "faturaDokum")]
    public async Task<IActionResult> GetInvoiceHeader([FromRoute] int invoiceId, CancellationToken cancellationToken)
    {
        var data = await (
            from inv in _dbContext.Set<Invoice>().AsNoTracking()
            join cust in _dbContext.Customers.AsNoTracking() on inv.CustomerCode equals cust.CustomerCode into custJoin
            from cust in custJoin.DefaultIfEmpty()
            where inv.Id == invoiceId
            select new
            {
                id = inv.Id,
                faturaNo = inv.InvoiceNo,
                cariKodu = inv.CustomerCode,
                faturaAcik = ((inv.CustomerCode != null && inv.CustomerCode.EndsWith("-3")) ||
                             (!string.IsNullOrEmpty(inv.CustomerInvoiceTypeOverride) && (inv.CustomerInvoiceTypeOverride == "ASKERIYE" || inv.CustomerInvoiceTypeOverride == "ASKERİYE" || inv.CustomerInvoiceTypeOverride == "MUAF")) ||
                             (cust != null && cust.InvoiceType != null && (cust.InvoiceType == "ASKERIYE" || cust.InvoiceType == "ASKERİYE" || cust.InvoiceType == "MUAF")))
                             ? "MUAF"
                             : (!string.IsNullOrEmpty(inv.CustomerInvoiceTypeOverride)
                                 ? inv.CustomerInvoiceTypeOverride
                                 : (cust != null ? cust.InvoiceType : string.Empty)),
                description = inv.Description,
                currencyTypeId = inv.CurrencyTypeId,
                exchangeRate = inv.ExchangeRate,
                rateSource = inv.RateSource
            }
        ).FirstOrDefaultAsync(cancellationToken);

        if (data is null)
        {
            return NotFound(new { success = false, message = "Fatura bulunamadı" });
        }

        return Ok(new { success = true, data });
    }

    [HttpGet("{invoiceId:int}/lines")]
    [AuthorizePage("invoice", "faturaDokum")]
    public async Task<IActionResult> GetInvoiceLines([FromRoute] int invoiceId, CancellationToken cancellationToken)
    {
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var currentCode = User.FindFirst("Carikodu")?.Value;
        currentCode = string.IsNullOrWhiteSpace(currentCode) ? null : currentCode.Trim();

        // "TÜM CARİLER" JOKERİ. Ofis kullanıcılarının Carikodu claim'i tek bir cari değil, "*"
        // (ya da "ALL") olur; bu "hepsini görür" demektir ve projenin her yerinde böyle okunur
        // (SalesOrders, CustomerLedger, CariOffers, Products...).
        //
        // Burada okunmuyordu: "*" GERÇEK BİR CARİ KODU sanılıyor, faturanın carisi ("120-01-…")
        // bu listede bulunamıyor ve uç nokta boş dizi dönüyordu. Sonuç: süper admin dışında
        // HERKES her faturada "Kalem bulunamadı" görüyordu. Fatura satırı gizlemek bir yetki
        // kararıdır; joker kod da tam olarak "kısıtlama yok" demek.
        var seesAllCustomers = isSuperAdmin
            || currentCode is null
            || currentCode == "*"
            || string.Equals(currentCode, "ALL", StringComparison.OrdinalIgnoreCase);

        List<string>? allowedCustomerCodes = null;
        if (!seesAllCustomers && currentCode is not null)
        {
            allowedCustomerCodes = new List<string> { currentCode };
            if (currentCode.StartsWith("120-", StringComparison.OrdinalIgnoreCase))
            {
                var branchCodes = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.ParentCustomerCode == currentCode)
                    .Select(x => x.CustomerCode)
                    .ToListAsync(cancellationToken);

                if (branchCodes.Count > 0) allowedCustomerCodes.AddRange(branchCodes);
            }
        }

        if (!seesAllCustomers)
        {

            var invoiceCustomerCode = await _dbContext.Set<Invoice>()
                .AsNoTracking()
                .Where(x => x.Id == invoiceId)
                .Select(x => x.CustomerCode)
                .FirstOrDefaultAsync(cancellationToken);

            if (invoiceCustomerCode is null || allowedCustomerCodes is null || !allowedCustomerCodes.Contains(invoiceCustomerCode.Trim()))
            {
                return Ok(new { success = true, data = Array.Empty<object>() });
            }
        }

        var invoiceType = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .Where(x => x.Id == invoiceId)
            .Select(x => x.Type)
            .FirstOrDefaultAsync(cancellationToken);

        var dbData = await (
                from invLine in _dbContext.Set<InvoiceLine>().AsNoTracking()
                join soLine in _dbContext.Set<SalesOrderLine>().AsNoTracking() on invLine.SalesOrderLineId equals (int?)soLine.Id into soJoin
                from soLine in soJoin.DefaultIfEmpty()
                join installation in _dbContext.Set<Installation>().AsNoTracking() on soLine.InstallationId equals installation.Id into insJoin
                from installation in insJoin.DefaultIfEmpty()
                join product in _dbContext.Set<Product>().AsNoTracking() on invLine.StockCode equals product.StockCode into productJoin
                from product in productJoin.DefaultIfEmpty()
                join service in _dbContext.Set<ServiceCatalogItem>().AsNoTracking() on invLine.StockCode equals service.Code into serviceJoin
                from service in serviceJoin.DefaultIfEmpty()
                where invLine.InvoiceId == invoiceId
                orderby invLine.LineNo
                select new
                {
                    Id = invLine.Id,
                    LineageId = invLine.LineageId,

                    SalesOrderLineId = invLine.SalesOrderLineId,
                    StockCode = invLine.StockCode,
                    StockName = invoiceType == InvoiceType.ServiceInvoice && service != null
                        ? service.Name
                        : (product != null ? product.Name : string.Empty),
                    Description = invLine.Description,
                    VatRate = invLine.VatRate,
                    Quantity = invLine.Quantity,
                    UnitPrice = invLine.UnitPrice,
                    CurrencyTypeId = invLine.CurrencyTypeId,
                    CurrencyRate = invLine.CurrencyRate,
                    CurrencyUnitPrice = invLine.CurrencyUnitPrice,
                    Total = invLine.Quantity * invLine.UnitPrice,
                    Barcode = product != null ? product.Barcode : null,
                    BarcodeType = product != null ? product.BarcodeType : "CODE128",

                    IsGift = soLine != null && soLine.IsGift,
                    DiscountAmount = soLine != null ? soLine.DiscountAmount : 0m,

                    InstallationId = soLine != null ? soLine.InstallationId : null,
                    InstallationName = installation != null ? installation.InstallationName : null,
                    InstallationPhone = installation != null ? installation.InstallationPhone : null,
                    DealerName = installation != null ? installation.DealerName : null,
                    ProductName = installation != null ? installation.ProductName : null,
                    InstallationQuantity = installation != null ? installation.Quantity : (decimal?)null,
                    Address = installation != null ? installation.Address : null,
                    Region = installation != null ? installation.Region : null,
                    DealerDescription = installation != null ? installation.DealerDescription : null
                }
            )
            .ToListAsync(cancellationToken);

        // Montaj yukarıdaki sorguya YALNIZCA sipariş satırı üzerinden bağlanıyor. Fatura dökümünden
        // girilen montajlar ise doğrudan fatura kalemine (`InvoiceLineId` / `LineageId`) bağlı; onlar
        // bu yüzden hiç görünmüyor, "Montaj İsmi" boş kalıyordu. İkinci yol burada toplanıyor.
        var lineIds = dbData.Select(x => x.Id).ToList();
        var lineLineageIds = dbData.Where(x => x.LineageId.HasValue).Select(x => x.LineageId!.Value).ToList();

        var directInstallations = await _dbContext.Set<Installation>()
            .AsNoTracking()
            .Where(x => ((x.InvoiceLineId.HasValue && lineIds.Contains(x.InvoiceLineId.Value))
                         || (x.LineageId.HasValue && lineLineageIds.Contains(x.LineageId.Value)))
                        && x.Status != "Pasif / İptal" && x.Status != "Pasif / Geri Alındı")
            .OrderBy(x => x.Id)
            .ToListAsync(cancellationToken);

        List<Installation> InstallationsForLine(int lineId, Guid? lineageId) => directInstallations
            .Where(i => i.InvoiceLineId == lineId || (lineageId.HasValue && i.LineageId == lineageId.Value))
            .ToList();

        var data = dbData.Select(x =>
        {
            var desc = x.Description ?? string.Empty;
            var campaignNote = string.Empty;
            if (x.IsGift)
            {
                campaignNote = " (Kampanya - Hediye)";
            }
            else if (x.DiscountAmount > 0)
            {
                campaignNote = " (Kampanya İndirimi)";
            }

            if (!string.IsNullOrEmpty(campaignNote) && !desc.Contains("Kampanya", StringComparison.OrdinalIgnoreCase))
            {
                desc = string.IsNullOrWhiteSpace(desc) ? campaignNote.Trim() : $"{desc} {campaignNote}";
            }

            var lineInstallations = InstallationsForLine(x.Id, x.LineageId);
            var firstDirect = lineInstallations.FirstOrDefault();

            // Sipariş akışından gelen montaj da sayılır; kalemde hiç montaj yoksa istemci
            // "Montaj Ekle", varsa "Montaj Düzenle" gösterir.
            // Aynı montaj HER İKİ yoldan da bağlı olabilir (fatura kesilirken hem
            // `InvoiceLineId` hem `SalesOrderLine.InstallationId` yazılıyor); iki kez sayılmasın.
            var orderMontajIsSeparate = x.InstallationId.HasValue
                && lineInstallations.All(i => i.Id != x.InstallationId.Value);

            var installationCount = lineInstallations.Count + (orderMontajIsSeparate ? 1 : 0);
            var installedQuantity = lineInstallations.Sum(i => i.Quantity)
                + (orderMontajIsSeparate ? (x.InstallationQuantity ?? 0m) : 0m);

            return new
            {
                x.Id,
                x.SalesOrderLineId,
                x.StockCode,
                x.StockName,
                Description = desc,
                x.VatRate,
                x.Quantity,
                x.UnitPrice,
                x.CurrencyTypeId,
                x.CurrencyRate,
                x.CurrencyUnitPrice,
                x.Total,
                x.Barcode,
                x.BarcodeType,
                x.IsGift,
                x.DiscountAmount,
                x.InstallationId,
                InstallationName = x.InstallationName ?? firstDirect?.InstallationName,
                InstallationPhone = x.InstallationPhone ?? firstDirect?.InstallationPhone,
                DealerName = x.DealerName ?? firstDirect?.DealerName,
                ProductName = x.ProductName ?? firstDirect?.ProductName,
                InstallationQuantity = x.InstallationQuantity ?? firstDirect?.Quantity,
                Address = x.Address ?? firstDirect?.Address,
                Region = x.Region ?? firstDirect?.Region,
                DealerDescription = x.DealerDescription ?? firstDirect?.DealerDescription,
                InstallationCount = installationCount,
                InstalledQuantity = installedQuantity
            };
        }).ToList();

        return Ok(new { success = true, data });
    }

    [HttpPost("create-sales-invoice")]
    [AuthorizePage("invoice", "satisFatura")]
    public async Task<IActionResult> CreateSalesInvoice([FromBody] CreateSalesInvoiceRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var rawCustomerCode = (request.CustomerCode ?? string.Empty).Trim();
        var customerCode = rawCustomerCode;
        if (!string.IsNullOrWhiteSpace(customerCode))
        {
            var resolvedCode = await _customerAccountService.ResolveTargetInvoiceCustomerCodeAsync(customerCode, cancellationToken: cancellationToken);
            if (!string.IsNullOrWhiteSpace(resolvedCode))
            {
                customerCode = resolvedCode;
            }
        }
        var deliveryCustomerCode = (request.DeliveryCustomerCode ?? string.Empty).Trim();
        var serie = (request.InvoiceSerie ?? string.Empty).Trim();

        var currentCode = User.FindFirst("Carikodu")?.Value;
        currentCode = string.IsNullOrWhiteSpace(currentCode) ? null : currentCode.Trim();

        var currentCustomerType = currentCode is null
            ? null
            : await _dbContext.Customers
                .AsNoTracking()
                .Where(x => x.CustomerCode == currentCode)
                .Select(x => x.CustomerType)
                .FirstOrDefaultAsync(cancellationToken);

        var isMagazaUser = !string.IsNullOrWhiteSpace(currentCustomerType) &&
                           (string.Equals(currentCustomerType.Trim(), "Mağaza", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(currentCustomerType.Trim(), "Magaza", StringComparison.OrdinalIgnoreCase));

        if (isMagazaUser && currentCode is not null && !string.Equals(deliveryCustomerCode, currentCode, StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { success = false, message = "Teslim cari kodu mağaza kullanıcısı ile eşleşmiyor" });
        }

        var invoiceTypeSourceCode = customerCode;

        var customerInvoiceType = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == invoiceTypeSourceCode)
            .Select(x => x.InvoiceType)
            .FirstOrDefaultAsync(cancellationToken);

        /*
          HEDEF ALT HESABIN ROLÜ ESASTIR (2026-10-14 canlı bildirim: "fiyat grubunu açıktan faturaya
          aldım, fatura keserken KDV gelmiyor" — 120-03-004623, fatura 100000000009999).

          Fatura hangi alt hesaba kesileceğini ana carinin tipinden/grubundan seçiyor
          (ResolveTargetInvoiceCustomerCodeAsync): faturalı → -1, açık → -2, askeriye → -3. Ama KDV ve
          seri kararı o alt hesabın KENDİ kaydındaki InvoiceType/grup alanından okunuyordu. Cari açıktan
          faturaya alınınca -1 hesabın kaydı eskide (ACIK, grup 4) kalabiliyordu; sipariş ve ekran KDV'li
          hesaplarken fatura KDV'siz ve açık seri (1…) ile kesiliyordu. Seçimle karar aynı kaynaktan olsun:
          -1 her zaman FATURA, -2 ACIK, -3 ASKERIYE. Alt hesap değilse eski kural aynen.
        */
        var hedefRolTipi = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.IsInvoiceAccountCode(customerCode) ? "FATURA"
            : B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.IsOpenAccountCode(customerCode) ? "ACIK"
            : B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.IsAskeriyeAccountCode(customerCode) ? "ASKERIYE"
            : null;
        if (hedefRolTipi is not null)
        {
            customerInvoiceType = hedefRolTipi;
        }

        static string NormalizeInvoiceTypeForOverride(string? value)
        {
            var s = (value ?? string.Empty).Trim().ToUpperInvariant();
            if (s == "ACIK" || s == "AÇIK" || s.Contains("ACIK") || s.Contains("AÇIK"))
            {
                return "ACIK";
            }

            // ASKERIYE/MUAF kendi damgasini alir. Eskiden bos donuyordu ve cagiran taraf
            // `isOpenCustomer ? "ACIK" : "FATURA"` yedegine dusuyordu; muaf satis ya acik
            // ya normal fatura gibi damgalaniyordu. FATURA kontrolunden ONCE olmali:
            // "ASKERIYE TIPI FATURA" gibi bir metin aksi halde FATURA'ya kacardi.
            if (s == "ASKERIYE" || s == "ASKERİYE" || s == "MUAF" || s.Contains("ASKER"))
            {
                return "ASKERIYE";
            }

            if (s == "FATURA" || s.Contains("FATURA"))
            {
                return "FATURA";
            }

            return string.Empty;
        }

        var customerInvoiceTypeNormalized = (customerInvoiceType ?? string.Empty).Trim().ToUpperInvariant();
        var isOpenCustomer = customerInvoiceTypeNormalized == "ACIK"
                             || customerInvoiceTypeNormalized == "AÇIK"
                             || customerInvoiceTypeNormalized.Contains("ACIK")
                             || customerInvoiceTypeNormalized.Contains("AÇIK");

        var customerInvoiceTypeOverride = NormalizeInvoiceTypeForOverride(customerInvoiceType);
        if (customerInvoiceTypeOverride.Length == 0)
        {
            customerInvoiceTypeOverride = isOpenCustomer ? "ACIK" : "FATURA";
        }

        if (string.IsNullOrWhiteSpace(customerCode))
        {
            ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode zorunludur");
        }

        if (string.IsNullOrWhiteSpace(deliveryCustomerCode))
        {
            ModelState.AddModelError(nameof(request.DeliveryCustomerCode), "DeliveryCustomerCode zorunludur");
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        string invoiceNo;
        if (isOpenCustomer)
        {
            // Açık Hesap: serie "1", otomatik numara oluştur
            var openSerie = "1";
            if (request.InvoiceNumber.HasValue && request.InvoiceNumber.Value > 0)
            {
                invoiceNo = openSerie + request.InvoiceNumber.Value.ToString().PadLeft(14, '0');
            }
            else
            {
                // ATOMİK NUMARATÖR (denetim md. 224): eskiden bütün açık hesap fatura
                // numaraları RAM'e çekilip en büyüğü +1 ediliyordu; aynı anda fatura kesen iki
                // kullanıcı AYNI numarayı alıp ikincisi tekil indeks hatasıyla düşüyordu.
                invoiceNo = await B2B.Erp.Api.Core.Helpers.OpenInvoiceNumberAllocator.NextAsync(
                    _dbContext, openSerie, cancellationToken);
            }
        }
        else
        {
            // Fatura: serie frontendden gelir (ör: "A"), numara el ile girilir
            var faturaSerie = string.IsNullOrWhiteSpace(serie) ? "A" : serie;
            if (faturaSerie.Length > 2) faturaSerie = faturaSerie.Substring(0, 2);

            if (!request.InvoiceNumber.HasValue || request.InvoiceNumber.Value <= 0 || request.InvoiceNumber.Value > 99999999999999L)
            {
                return BadRequest(new { success = false, message = "Fatura tipi müşteriler için fatura numarası el ile girilmelidir (1 ile 99999999999999 arasında)." });
            }

            invoiceNo = faturaSerie + request.InvoiceNumber.Value.ToString().PadLeft(14 - (faturaSerie.Length - 1), '0');
            if (invoiceNo.Length != 15)
            {
                invoiceNo = faturaSerie + request.InvoiceNumber.Value.ToString().PadLeft(15 - faturaSerie.Length, '0');
            }
        }

        var exists = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .AnyAsync(x => x.InvoiceNo == invoiceNo, cancellationToken);

        if (exists)
        {
            return Conflict(new { success = false, message = $"Fatura no zaten mevcut: {invoiceNo}" });
        }

        var lines = request.Lines ?? new();
        if (lines.Count == 0)
        {
            ModelState.AddModelError(nameof(request.Lines), "En az 1 satır seçmelisiniz");
            return ValidationProblem(ModelState);
        }

        var lineIds = lines.Select(x => x.SalesOrderLineId).Distinct().ToList();

        var orderLinesQuery =
            from line in _dbContext.Set<SalesOrderLine>().AsNoTracking()
            join order in _dbContext.Set<SalesOrder>().AsNoTracking() on line.SalesOrderId equals order.Id
            where lineIds.Contains(line.Id)
            select new OrderLineInvoiceDetail
            {
                LineId = line.Id,
                OrderId = order.Id,
                CustomerCode = order.CustomerCode,
                DeliveryCustomerCode = order.DeliveryCustomerCode,
                CampaignDetailsJson = order.CampaignDetailsJson,
                OrderSubtotal = order.Subtotal,
                OrderCampaignDiscount = order.CampaignDiscount,
                StockCode = line.StockCode,
                Description = line.Description,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                CurrencyTypeId = line.CurrencyTypeId,
                CurrencyRate = line.CurrencyRate,
                CurrencyUnitPrice = line.CurrencyUnitPrice,
                VatRate = line.VatRate,
                IsGift = line.IsGift,
                DiscountAmount = line.DiscountAmount,
                InstallationId = line.InstallationId,
                LineageId = line.LineageId,
                SourceWarehouseCode = line.SourceWarehouseCode
            };

        var mainCustomerCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(rawCustomerCode);
        var relatedCustomerCodes = await _customerAccountService.GetRelatedCustomerCodesForLedgerAsync(mainCustomerCode, cancellationToken);

        if (isMagazaUser)
        {
            orderLinesQuery = orderLinesQuery.Where(x => relatedCustomerCodes.Contains(x.CustomerCode) && x.DeliveryCustomerCode == currentCode);
        }
        else
        {
            orderLinesQuery = orderLinesQuery.Where(x => relatedCustomerCodes.Contains(x.CustomerCode));
        }

        var orderLines = await orderLinesQuery.ToListAsync(cancellationToken);

        // Ensure all gift lines have symbolic price (0.01m) and 0 VAT/discount
        foreach (var line in orderLines.Where(x => x.IsGift))
        {
            line.UnitPrice = 0.01m;
            line.CurrencyUnitPrice = 0.01m;
            line.DiscountAmount = 0m;
            line.VatRate = 0m;
        }

        var lineMap = orderLines.ToDictionary(x => x.LineId, x => x);

        foreach (var l in lines)
        {
            if (!lineMap.ContainsKey(l.SalesOrderLineId))
            {
                return BadRequest(new { success = false, message = "Seçilen sipariş satırı bulunamadı" });
            }
        }

        /*
         * E-TİCARET SİPARİŞİ ÖDENMEDEN FATURALANAMAZ.
         *
         * Vitrindeki sipariş, kart ekranına GİRİLMEDEN ÖNCE ERP'de açılıyor: ödeme tutarının
         * tek kaynağı siparişin kendisi olsun diye (bkz. /api/ecommerce/orders ve
         * VirtualPos akışı). Bunun bedeli, ödeme yarıda kalırsa ERP'de sahibi olmayan bir
         * sipariş kalması. O sipariş bayinin sipariş listesinde diğerlerinden AYIRT EDİLEMEZ
         * duruyordu; faturası kesilirse mal, parası hiç gelmemiş bir müşteriye çıkardı ve
         * stok da o faturayla düşerdi.
         *
         * Kapı burada, fatura kesme anında: "ödendi" bilgisinin tek kaynağı bankanın imzası
         * doğrulanarak yazılan EcommerceOrderPayments satırı. Sipariş ekranındaki durum
         * etiketi bilgi verir, bu kapı ise engeller.
         *
         * NOT: bu kapı yalnızca ProcessedBy = ETICARET siparişlerini ilgilendirir. Bayinin
         * kendi açtığı siparişler bu yoldan geçmez.
         */
        var invoicedOrderIds = lines
            .Select(l => lineMap[l.SalesOrderLineId].OrderId)
            .Distinct()
            .ToList();

        var ecommerceOrderNos = await _dbContext.Set<SalesOrder>()
            .AsNoTracking()
            .Where(x => invoicedOrderIds.Contains(x.Id) && x.ProcessedBy != null && x.ProcessedBy.ToUpper() == "ETICARET")
            .Select(x => x.OrderNo)
            .ToListAsync(cancellationToken);

        if (ecommerceOrderNos.Count > 0)
        {
            var paidOrderNos = await _dbContext.EcommerceOrderPayments
                .AsNoTracking()
                .Where(x => ecommerceOrderNos.Contains(x.SalesOrderNo) && x.Status == (int)EcommercePaymentStatus.Paid)
                .Select(x => x.SalesOrderNo)
                .Distinct()
                .ToListAsync(cancellationToken);

            var unpaid = ecommerceOrderNos.Except(paidOrderNos, StringComparer.OrdinalIgnoreCase).ToList();
            if (unpaid.Count > 0)
            {
                return BadRequest(new
                {
                    success = false,
                    message = "Ödemesi tamamlanmamış e-ticaret siparişi faturalanamaz: "
                              + string.Join(", ", unpaid)
                              + ". Ödeme onayı geldikten sonra tekrar deneyin."
                });
            }
        }

        var existingInvoicedMap = await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(x => x.SalesOrderLineId.HasValue && lineIds.Contains(x.SalesOrderLineId.Value))
            .GroupBy(x => x.SalesOrderLineId!.Value)
            .Select(g => new { SalesOrderLineId = g.Key, Qty = g.Sum(x => (decimal?)x.Quantity) ?? 0m })
            .ToDictionaryAsync(x => x.SalesOrderLineId, x => x.Qty, cancellationToken);

        var orderQtyMap = await _dbContext.Set<SalesOrderLine>()
            .AsNoTracking()
            .Where(x => lineIds.Contains(x.Id))
            .Select(x => new { LineId = x.Id, Qty = x.Quantity })
            .ToDictionaryAsync(x => x.LineId, x => x.Qty, cancellationToken);

        foreach (var l in lines)
        {
            var orderQty = orderQtyMap.TryGetValue(l.SalesOrderLineId, out var oq) ? oq : 0m;
            var already = existingInvoicedMap.TryGetValue(l.SalesOrderLineId, out var iq) ? iq : 0m;
            var remaining = orderQty - already;
            if (remaining <= 0)
            {
                return BadRequest(new { success = false, message = "Kalem zaten tamamen faturalanmış" });
            }
            if (l.InvoiceQuantity > remaining)
            {
                return BadRequest(new { success = false, message = "Fatura miktarı kalan miktardan büyük olamaz" });
            }
        }

        // ============================================================================
        // TEK FATURA = TEK PARA BİRİMİ = TEK KUR.
        //
        // Başlık tek `CurrencyTypeId`/`ExchangeRate` taşır. Farklı paralardaki satırlar aynı
        // faturaya girerse toplam iki para biriminin ÇIPLAK TOPLAMI olur ve sonra hepsi tek
        // kurla çarpılır: TL satır dolar kuruyla 48 katına çıkar. Kanıt: DEMOTEST fatura 76
        // (2.172,41 ₺ + 1.090,91 $ = "3.263,32", başlık USD).
        //
        // Sepet karışık dövize zaten izin vermiyor ama fatura dökümünde FARKLI SİPARİŞLERİN
        // satırları tek faturada birleştirilebiliyor — delik oradaydı. Proforma aktarımı da
        // aynı kuralı açık hatayla uyguluyor.
        // Hediye satırı sayılmaz: sembolik 0,01 taşır ve TL siparişte para birimi 0 kalır.
        // ============================================================================
        var invoicedLineCurrencies = lines
            .Select(l => lineMap[l.SalesOrderLineId])
            .Where(sol => !sol.IsGift)
            .Select(sol => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(sol.CurrencyTypeId))
            .Distinct()
            .ToList();

        if (invoicedLineCurrencies.Count > 1)
        {
            return BadRequest(new
            {
                success = false,
                message = "Bir faturada tek para birimi olabilir. Seçilen sipariş satırları farklı para birimlerinde — ayrı ayrı faturalayın."
            });
        }

        static decimal GetLineActualUnitPrice(OrderLineInvoiceDetail soLine)
        {
            if (soLine.IsGift) return 0.01m;
            if (soLine.CurrencyTypeId > 1 && soLine.CurrencyUnitPrice > 0)
            {
                return soLine.CurrencyUnitPrice;
            }
            return soLine.UnitPrice;
        }

        // SİPARİŞ TARAFI TL ÇAPASI TUTAR (`DiscountAmount`, `OrderSubtotal`,
        // `OrderCampaignDiscount`); buradaki hesap ise BELGENİN PARASINDA yürüyor.
        // İkisi aynı ölçüde olmazsa dolarlı bir siparişte indirim satır tabanından büyük
        // görünür ve satırı sıfırlar. Kur siparişin DONMUŞ kurudur.
        static decimal ToDocCurrency(decimal tryAmount, OrderLineInvoiceDetail soLine)
            => soLine.CurrencyTypeId > 1 && soLine.CurrencyRate > 0m
                ? tryAmount / soLine.CurrencyRate
                : tryAmount;

        var subtotal = lines.Sum(l => l.InvoiceQuantity * GetLineActualUnitPrice(lineMap[l.SalesOrderLineId]));

        var orderIds = orderLines.Select(x => x.OrderId).Distinct().ToList();
        var relatedIrsaliyes = await _dbContext.Set<Irsaliye>()
            .Include(x => x.Product)
            .Where(x => x.TransferredSalesOrderId.HasValue && orderIds.Contains(x.TransferredSalesOrderId.Value))
            .ToListAsync(cancellationToken);

        var consignmentOrderLineIds = orderLines
            .Where(soLine => relatedIrsaliyes.Any(irs => irs.TransferredSalesOrderId == soLine.OrderId && irs.Product != null && irs.Product.StockCode == soLine.StockCode))
            .Select(soLine => soLine.LineId)
            .ToHashSet();

        // Campaign discount is stored per SalesOrderLine as DiscountAmount (total for the full order qty).
        // When invoicing partially, we pro-rate it by (invoiceQty / orderQty).
        var campaignDiscount = 0m;
        // Kalem kampanyasının NET tutarı ve KDV'si ayrı toplanır (bkz. aşağıda "KAMPANYA İNDİRİMİ
        // KDV MATRAHINDAN DÜŞER").
        var satirKampanyaNet = 0m;
        var satirKampanyaKdv = 0m;
        foreach (var l in lines)
        {
            var soLine = lineMap[l.SalesOrderLineId];
            if (soLine.IsGift)
            {
                continue;
            }
            if (soLine.Quantity <= 0m) continue;

            var prorate = l.InvoiceQuantity / soLine.Quantity;
            if (prorate <= 0m) continue;
            if (prorate > 1m) prorate = 1m;

            var lineCampaign = ToDocCurrency(soLine.DiscountAmount, soLine) * prorate;
            if (lineCampaign <= 0m) continue;

            var lineBase = l.InvoiceQuantity * GetLineActualUnitPrice(soLine);
            if (lineCampaign > lineBase) lineCampaign = lineBase;

            campaignDiscount += lineCampaign;
            satirKampanyaNet += lineCampaign;
            satirKampanyaKdv += lineCampaign * (soLine.VatRate / 100m);
        }

        // Order-level campaign discounts (e.g. Quantity-Tiered fixed amount) are stored on SalesOrder.CampaignDiscount.
        // Important: SalesOrder.CampaignDiscount is the TOTAL campaign discount for the order, which may already 
        // include distributed line-level discounts. We must only prorate the 'pure' order-level portion to avoid double-counting.
        var orderLevelCampaignDiscount = 0m;

        // Get total line-level campaign discounts for each affected order to find the 'pure' header portion
        var orderLineDiscountsTotals = await _dbContext.Set<SalesOrderLine>()
            .AsNoTracking()
            .Where(x => orderIds.Contains(x.SalesOrderId))
            .GroupBy(x => x.SalesOrderId)
            // HEDİYE KALEMİNİN İNDİRİMİ KENDİ KALEMİNİNDİR (2026-10-01). Kampanya motoru "indirim satırı"
            // modunda hediyeyi normal fiyatla yazıp tamamını o kalemin `DiscountAmount`'una koyuyor. Fatura hediyeyi
            // 0,01'den keser; indirim "sipariş geneli" sayılırsa müşteriden hediyenin değeri BİR DAHA düşülüyordu.
            // Sembolik fiyat modunda hediyenin indirimi zaten 0'dır — orada hiçbir şey değişmez.
            .Select(g => new { OrderId = g.Key, TotalLineCampaignSum = g.Sum(l => l.DiscountAmount) })
            .ToDictionaryAsync(x => x.OrderId, x => x.TotalLineCampaignSum, cancellationToken);

        foreach (var orderId in orderIds)
        {
            var anyRow = orderLines.FirstOrDefault(x => x.OrderId == orderId);
            if (anyRow is null) continue;
            if (anyRow.OrderSubtotal <= 0m) continue;
            if (anyRow.OrderCampaignDiscount <= 0m) continue;

            var totalLineDiscountsForThisOrder = orderLineDiscountsTotals.TryGetValue(orderId, out var tld) ? tld : 0m;
            // Üçü de TL çapası; çıkarma TL'de yapılıp sonuç belgenin parasına indiriliyor.
            var pureOrderLevelPart = ToDocCurrency(anyRow.OrderCampaignDiscount - totalLineDiscountsForThisOrder, anyRow);
            if (pureOrderLevelPart < 0m) pureOrderLevelPart = 0m;

            if (pureOrderLevelPart <= 0m) continue;

            var invoicedGrossForOrder = lines
                .Where(x => lineMap[x.SalesOrderLineId].OrderId == orderId)
                .Sum(x =>
                {
                    var soLine = lineMap[x.SalesOrderLineId];
                    if (soLine.IsGift) return 0m;
                    return x.InvoiceQuantity * GetLineActualUnitPrice(soLine);
                });

            if (invoicedGrossForOrder <= 0m) continue;

            // Pay belgenin parasında; payda TL çapası olduğu için aynı ölçüye indiriliyor.
            var ratio = invoicedGrossForOrder / ToDocCurrency(anyRow.OrderSubtotal, anyRow);
            if (ratio <= 0m) continue;
            if (ratio > 1m) ratio = 1m;

            var prorated = pureOrderLevelPart * ratio;
            if (prorated <= 0m) continue;
            if (prorated > invoicedGrossForOrder) prorated = invoicedGrossForOrder;

            orderLevelCampaignDiscount += prorated;
        }

        campaignDiscount += orderLevelCampaignDiscount;

        var customer = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        /*
          CİRO ŞUBEYİ SATAN PLASİYERE YAZILIR (2026-09-07 kullanıcı isteği).

          Şubeli bayide fatura ANA firmaya kesilir, mal ŞUBEYE teslim edilir; ana firma ile
          şubenin plasiyeri farklı olabiliyor. Damga yalnız fatura carisinden okunuyordu, bu
          yüzden Gazimağusa şubesine satan plasiyerin cirosu ana firmanın plasiyerine düşüyordu
          (Satış Pazarlama Raporu faturanın kendi `SalesmanCode` damgasını okur).

          Teslim carisinin KENDİ plasiyeri varsa o kazanır; yoksa fatura carisininki kalır.
          Teslim carisi fatura carisiyle aynıysa zaten değişen bir şey yok.

          YALNIZ BAYİ ŞUBESİ (`01-` ile başlayan kod). Mağazaya teslim edilen perakende satışta
          teslim carisi MAGAZA (`120-04-…`, plasiyer 100) oluyor; kural oraya da uygulansaydı
          bugüne kadar "GENEL" diliminde duran 248 bin TL'lik mağaza cirosu MAGAZA plasiyerine
          kayardı. Kullanıcı kararı (2026-09-07): mağaza satışı GENEL kalsın.
        */
        Entities.Customer? deliveryCustomer = null;
        if (!string.IsNullOrWhiteSpace(deliveryCustomerCode) &&
            deliveryCustomerCode.StartsWith("01-", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(deliveryCustomerCode, customerCode, StringComparison.OrdinalIgnoreCase))
        {
            deliveryCustomer = await _dbContext.Customers
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.CustomerCode == deliveryCustomerCode, cancellationToken);
        }

        var invoiceSalesmanCode = !string.IsNullOrWhiteSpace(deliveryCustomer?.SalesmanCode)
            ? deliveryCustomer!.SalesmanCode
            : customer?.SalesmanCode;

        int? customerPgCode = null;
        if (customer?.PriceGroupId != null)
        {
            customerPgCode = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(pg => pg.Id == customer.PriceGroupId.Value)
                .Select(pg => (int?)pg.Code)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var isNoVatCustomer = hedefRolTipi is not null
            ? hedefRolTipi != "FATURA"
            : (customer != null && (
            (customer.InvoiceType != null && (customer.InvoiceType.Equals("ACIK", StringComparison.OrdinalIgnoreCase) || customer.InvoiceType.Equals("AÇIK", StringComparison.OrdinalIgnoreCase) || customer.InvoiceType.Equals("ASKERIYE", StringComparison.OrdinalIgnoreCase) || customer.InvoiceType.Equals("ASKERİYE", StringComparison.OrdinalIgnoreCase))) ||
            (customerPgCode.HasValue && customerPgCode.Value >= 4 && customerPgCode.Value <= 7)
        ));

        /*
          İSKONTO KDV DAHİL GİRİLİR — GENEL TOPLAM KORUNUR (2026-08-26, kullanıcı bildirimi:
          "iskontoyu KDV'ye dağıtması lazımdı, 800 yazınca 689,66 indirim olacaktı").

          Satıcı iskontoyu MÜŞTERİNİN ÖDEYECEĞİ tutar üzerinden giriyor: liste KDV dahil
          7.400,00 → 800,00 iskonto → tahsil edilecek 6.600,00. Canlı veriden birebir
          doğrulandı (A00000000071245 ve A00000000071173):

              brüt + brütten KDV = KDV dahil taban
              KDV dahil taban − iskonto = faturanın GENEL TOPLAMI   (kayıtta zaten doğruydu)

          Eski hesap iskontoyu NET'ten düşüp KDV'yi iskontosuz brütten alıyordu:
              net 5.579,31 + KDV 1.020,69 = 6.600,00
          Toplam tesadüfen tutuyordu ama içindeki ayrım yanlıştı — KDV 128,00 fazla, net 128,00
          eksik. Fatura basımında "KDV kırılımı 892,69 / TOPLAM K.D.V. 1.020,69" çelişkisi ve
          Muhasebe Satış Raporu'ndaki fazla KDV buradan geliyordu.

          Doğrusu: kalan oranı KDV DAHİL taban üzerinden bulup net ile KDV'yi birlikte
          küçültmek. Genel toplam DEĞİŞMEZ (müşteriyle anlaşılan tutar korunur), yalnızca
          net/KDV ayrımı düzelir:
              oran = (KDV dahil taban − iskonto) / KDV dahil taban
              net  = brüt        × oran      → 5.689,66
              KDV  = brütten KDV × oran      →   910,34
              genel toplam = 6.600,00 (aynı)

          Saklanan `Discount` artık iskontonun NET karşılığıdır (689,66); böylece
          `Subtotal − Discount = NetTotal` bağıntısı ve basımdaki "BRÜT − İNDİRİM = NET"
          satırı tutarlı olur.

          KDV'siz cari (`isNoVatCustomer`) durumunda `kdvBrutten = 0` olduğu için formül
          eski davranışa aynen düşer: net = brüt − iskonto.
        */
        var kdvBrutten = isNoVatCustomer ? 0m : lines.Sum(l =>
        {
            var soLine = lineMap[l.SalesOrderLineId];
            if (soLine.IsGift) return 0m; // Do not calculate VAT for gift lines
            var baseTotal = l.InvoiceQuantity * GetLineActualUnitPrice(soLine);
            return baseTotal * (soLine.VatRate / 100m);
        });

        /*
          YÜZDE İNDİRİM KDV DAHİL TABANDAN HESAPLANIR (2026-09-16, kullanıcı bildirimi: "%10 KDV'li
          faturada %10 indirim yapınca genel toplam ara toplama eşit çıkıyor, KDV'yi mi katmıyor").

          Girilen iskonto `InvoiceDiscountMath`'e KDV DAHİL tutar olarak gidiyor. Yüzde ise KDV
          HARİÇ brütten (`subtotal`) hesaplanıyordu; iki ölçü karışınca indirim eksik uygulanıyordu:
              brüt 58.036,36 · KDV %10 → taban 63.840,00
              %10 → 5.803,64 (brütün %10'u) KDV dahil sayılıyor → genel 58.036,36 (olması gereken 57.456,00)
          %10 KDV'de genel toplam tesadüfen ara toplama eşit çıktığı için göze battı; %16'da da
          aynı eksik vardı (100 + 16 → %10 → 106,00; doğrusu 104,40), sadece fark edilmiyordu.

          Tutar (₺) iskontosu zaten KDV dahil giriliyor; üst sınır ve yetki oranı da aynı tabana
          bakar, yoksa KDV dahil 1.000 TL'lik belgede %10 yetkili kullanıcı en fazla 862 TL'nin
          %10'unu düşebiliyordu. Bu yüzden blok, KDV bilindikten sonra çalışır.
        */
        var kdvDahilTaban = subtotal + kdvBrutten;

        var manualDiscount = request.DiscountType switch
        {
            DiscountType.Amount => request.DiscountValue,
            DiscountType.Percentage => kdvDahilTaban * (request.DiscountValue / 100m),
            _ => 0m
        };

        if (manualDiscount < 0m) manualDiscount = 0m;
        if (kdvDahilTaban > 0m && manualDiscount > kdvDahilTaban) manualDiscount = kdvDahilTaban;

        var roleCode = (User.FindFirst("RoleCode")?.Value ?? User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? string.Empty).Trim();
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var maxDiscountRate = 0m;

        if (isSsa)
        {
            maxDiscountRate = 100m;
        }
        else
        {
            var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (int.TryParse(userIdClaim, out var userId) && userId > 0)
            {
                var userDiscountRate = await _dbContext.Set<User>()
                    .Where(u => u.Id == userId)
                    .Select(u => u.DiscountRate)
                    .FirstOrDefaultAsync(cancellationToken);
                maxDiscountRate = userDiscountRate ?? 100m;
            }
        }

        if (kdvDahilTaban > 0m && manualDiscount > (kdvDahilTaban * (maxDiscountRate / 100m) + 0.01m))
        {
            return BadRequest(new { success = false, message = $"Yetkiniz dahilinde uygulayabileceğiniz maksimum indirim oranı %{maxDiscountRate}'dir." });
        }

        if (campaignDiscount < 0m) campaignDiscount = 0m;
        if (subtotal > 0m && campaignDiscount > subtotal) campaignDiscount = subtotal;

        /*
          KAMPANYA İNDİRİMİ KDV MATRAHINDAN DÜŞER (2026-09-30, kullanıcı bildirimi: A00000000072141 —
          "toplamı 16.800 olması lazım, fatura basımda 16.990 çıkıyor").

          Kalem kampanyası (`SalesOrderLine.DiscountAmount`) KDV HARİÇ bir tutardır: 19.809,52'lik
          klimadan 3.809,52 düşülür → 16.000,00 + %5 KDV = 16.800,00. Kampanya motoru siparişte
          KDV'yi bu indirimli satırdan hesaplıyor (CampaignService, 2026-09-18) — sipariş 16.800.
          Fatura ise kampanyayı elle iskontoyla (KDV DAHİL) TOPLAYIP tamamını KDV dahil iskonto
          sayıyordu: 20.800,00 − 3.809,52 = 16.990,48. Kampanyanın KDV'si (190,48) müşteriden
          fazladan alınıyor, sipariş ile fatura (ve siparişe göre alınan ödeme) tutmuyordu.

          Doğrusu motorla birebir:
            • kalem kampanyası brütten VE kendi KDV oranıyla KDV'den düşülür (matrah küçülür);
            • elle iskonto ile sipariş geneli kampanya (motorda da genel toplamdan düşer) KDV DAHİL
              kalır ve kalan taban üzerinden `InvoiceDiscountMath` ile uygulanır (2026-08-26 kuralı).
          KDV'siz caride (`isNoVatCustomer`) kampanyanın KDV'si yoktur.
        */
        var satirKampanya = Math.Min(satirKampanyaNet, subtotal);
        var satirKampanyaKdvi = isNoVatCustomer ? 0m : Math.Min(satirKampanyaKdv, kdvBrutten);
        var kampanyaSonrasiBrut = subtotal - satirKampanya;
        var kampanyaSonrasiKdv = kdvBrutten - satirKampanyaKdvi;

        var kdvDahilIskonto = manualDiscount + orderLevelCampaignDiscount;
        // Hesap TEK KAYNAKTAN: Core/Accounting/InvoiceDiscountMath (birim testli).
        var iskontoSonuc = B2B.Erp.Api.Core.Accounting.InvoiceDiscountMath.Hesapla(
            kampanyaSonrasiBrut, kampanyaSonrasiKdv, kdvDahilIskonto);

        var netTotal = iskontoSonuc.NetToplam;
        var vatTotal = iskontoSonuc.KdvToplam;
        var grandTotal = iskontoSonuc.GenelToplam;

        // Saklanan `Discount` NET karşılıktır ve kampanyayı İÇERİR: Brüt − İskonto = Net.
        var discount = decimal.Round(subtotal - netTotal, 2, MidpointRounding.AwayFromZero);
        if (discount < 0m) discount = 0m;

        // Kampanya payı da NET: kalem kampanyası aynen; sipariş geneli kampanya elle iskontoyla
        // AYNI oranda net karşılığına çekilir (hesaplayıcının sınırladığı iskonto esas alınır).
        // Fatura Döküm/Satış Pazarlama "İskonto = Discount − Kampanya" farkını bununla gösteriyor.
        var uygulananKdvDahilIskonto = Math.Min(kdvDahilIskonto, kampanyaSonrasiBrut + kampanyaSonrasiKdv);
        var siparisGeneliNet = uygulananKdvDahilIskonto > 0m
            ? Math.Min(orderLevelCampaignDiscount, uygulananKdvDahilIskonto) * (iskontoSonuc.NetIskonto / uygulananKdvDahilIskonto)
            : 0m;
        campaignDiscount = decimal.Round(satirKampanya + siparisGeneliNet, 2, MidpointRounding.AwayFromZero);

        // ============================================================================
        // TL ÇAPASI — BELGENİN PARASININ YANINDA, YERİNE DEĞİL (2026-08-19).
        //
        // Yukarıdaki bütün hesap (kampanya payları, indirim oranları, KDV) SİPARİŞİN KENDİ
        // PARASINDA yürür ve öyle kalır — kampanya motoruna hiç dokunulmuyor. Yalnızca
        // KAYDEDİLEN alanlar TL'ye çevrilir:
        //   InvoiceLine.UnitPrice / Invoice.* toplamları  -> TL karşılığı
        //   InvoiceLine.CurrencyUnitPrice                 -> belgenin kendi parası
        //
        // NEDEN ŞART: kur değerlemesi (dönem sonu) "işlem anındaki TL karşılığı" ile
        // "bugünkü kurla TL karşılığı" farkını arar. İşlem anındaki TL çapası yoksa kur farkı
        // HESAPLANAMAZ. Aynı şekilde yevmiye ve mizan tek para biriminde denk gelmek zorunda.
        // Kur, siparişin kendi donmuş kurudur — bugünkü kur DEĞİL; sonradan yeniden
        // hesaplamak geçmiş belgeyi kaydırır.
        // ============================================================================
        var firstLineWithCurrency = lines
            .Select(l => lineMap.TryGetValue(l.SalesOrderLineId, out var sol) ? sol : null)
            .FirstOrDefault(sol => sol != null && sol.CurrencyTypeId > 1);

        var invoiceCurrencyTypeId = firstLineWithCurrency?.CurrencyTypeId ?? 1;
        var invoiceExchangeRate = request.InvoiceCurrencyRate.HasValue && request.InvoiceCurrencyRate.Value > 0
            ? request.InvoiceCurrencyRate.Value
            : (request.CurrencyRate > 0
                ? request.CurrencyRate
                : (firstLineWithCurrency?.CurrencyRate > 0 ? firstLineWithCurrency.CurrencyRate : 1m));

        var isForeignInvoice = !B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(invoiceCurrencyTypeId);
        var invoiceAnchorRate = invoiceExchangeRate <= 0m ? 1m : invoiceExchangeRate;

        // ÇAPA KURU BURADA KESİNLEŞİR. Başlığa damgalanan kur ile toplamları çeviren kur AYNI
        // olmak zorunda; ayrışırsa fatura "1.500 $ = 1.500 TL ama kur 47,9" gibi kendi içinde
        // çelişen bir belge olur. Siparişin donmuş kuru yoksa (yalnız o zaman) günün kuru çekilir.
        if (isForeignInvoice && invoiceAnchorRate <= 1.0001m)
        {
            var anchorCode = MapCurrencyTypeIdToCode(invoiceCurrencyTypeId);
            if (!string.IsNullOrWhiteSpace(anchorCode))
            {
                try
                {
                    var fetchedAnchorRate = await _money.GetLatestTryRateAsync(anchorCode, cancellationToken);
                    if (fetchedAnchorRate > 0m) invoiceAnchorRate = fetchedAnchorRate;
                }
                catch
                {
                    // Kur alınamazsa 1 kalır: tutar bozulmaz, TL çapası dövizle aynı sayıda
                    // kalır. Uydurma kur yazmaktan iyidir.
                }
            }
        }

        invoiceExchangeRate = invoiceAnchorRate;

        decimal ToTry(decimal docAmount)
            => isForeignInvoice
                ? Math.Round(docAmount * invoiceAnchorRate, 2, MidpointRounding.AwayFromZero)
                : docAmount;

        // Belgenin kendi parasındaki toplamlar (cari hareketi ve dövizli raporlar için).
        var docSubtotal = subtotal;
        var docDiscount = discount;
        var docNetTotal = netTotal;
        var docVatTotal = vatTotal;
        var docGrandTotal = grandTotal;
        var docCampaignDiscount = campaignDiscount;

        subtotal = ToTry(subtotal);
        discount = ToTry(discount);
        netTotal = ToTry(netTotal);
        vatTotal = ToTry(vatTotal);
        grandTotal = ToTry(grandTotal);
        campaignDiscount = ToTry(campaignDiscount);

        var takePaymentNow = request.TakePaymentNow;

        var cashAccountId = takePaymentNow && request.CashAccountId.HasValue && request.CashAccountId.Value > 0
            ? request.CashAccountId.Value
            : (int?)null;

        var bankAccountDefinitionId = takePaymentNow && request.BankAccountDefinitionId.HasValue && request.BankAccountDefinitionId.Value > 0
            ? request.BankAccountDefinitionId.Value
            : (int?)null;

        var changeCashAccountId = takePaymentNow && request.ChangeCashAccountId.HasValue && request.ChangeCashAccountId.Value > 0
            ? request.ChangeCashAccountId.Value
            : (int?)null;

        var changeBankAccountDefinitionId = takePaymentNow && request.ChangeBankAccountDefinitionId.HasValue && request.ChangeBankAccountDefinitionId.Value > 0
            ? request.ChangeBankAccountDefinitionId.Value
            : (int?)null;

        if (cashAccountId is not null && bankAccountDefinitionId is not null)
        {
            return BadRequest(new { success = false, message = "Kasa ve banka aynı anda seçilemez" });
        }

        if (takePaymentNow && cashAccountId is null && bankAccountDefinitionId is null)
        {
            return BadRequest(new { success = false, message = "Ödemeyi hemen al seçildiyse kasa veya banka seçmelisiniz" });
        }

        if (!request.WarehouseCode.HasValue)
        {
            return BadRequest(new { success = false, message = "Depo seçimi zorunludur" });
        }
        var warehouseCode = request.WarehouseCode.Value;

        var warehouse = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.IsActive && x.WarehouseCode == warehouseCode, cancellationToken);

        if (warehouse is null)
        {
            return BadRequest(new { success = false, message = "Depo bulunamadı" });
        }

        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        if (!isSuperAdmin)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(userIdClaim, out var userId) || userId <= 0)
            {
                return BadRequest(new { success = false, message = "Kullanıcı bulunamadı" });
            }

            var allowed = await _dbContext.UserWarehouses
                .AsNoTracking()
                .AnyAsync(x => x.UserId == userId && x.WarehouseCode == warehouseCode, cancellationToken);

            if (!allowed)
            {
                return BadRequest(new { success = false, message = "Bu depo için yetkiniz yok" });
            }
        }

        // ---- KALEM BAZLI ÇIKIŞ DEPOSU (kullanıcı kuralı, 2026-08-13) ----
        //
        // Başlıktaki depo VARSAYILAN olarak kalır; her kalem kendi deposunu taşıyabilir.
        // İki kural birden geçerli:
        //
        //  1. SERVİSTEN GELEN KALEM, işlemi yapan teknisyenin deposundan çıkar. Faturayı kesen
        //     kişinin o depoya yetkisi OLMAYABİLİR ve bu normaldir — senaryonun tamamı bu:
        //     müdürün tek deposu var (Haspolat), parça teknisyenin arabasından çıkmış. Bu yüzden
        //     servis damgalı kalemde depo yetkisi ARANMAZ; sınır, kalemin kendi damgasıdır
        //     (`SalesOrderLine.SourceWarehouseCode`) — kullanıcı oraya istediği depoyu yazamaz.
        //  2. Servis dışı ya da damgadan FARKLI bir depo seçilmişse normal yetki kontrolü işler;
        //     aksi halde bu alan, başkasının deposundan stok düşürmenin serbest kapısı olurdu.
        var lineWarehouseByOrderLineId = new Dictionary<int, int>();
        {
            // NEGATİF DEPO KODU GEÇERLİDİR (ör. -21 YP SİPARİŞ, bkz. WarehousesController);
            // kontroller bu yüzden `!= 0`. `> 0` filtresi negatif kodlu depoyu sessizce düşürüp
            // kalemi başlık deposundan çıkarıyordu.
            var requestedLineWarehouses = request.Lines
                .Where(x => x.WarehouseCode.HasValue && x.WarehouseCode.Value != 0)
                .Select(x => x.WarehouseCode!.Value)
                .Distinct()
                .ToList();

            var activeLineWarehouses = requestedLineWarehouses.Count == 0
                ? new List<int>()
                : await _dbContext.Set<Warehouse>()
                    .AsNoTracking()
                    .Where(x => x.IsActive && requestedLineWarehouses.Contains(x.WarehouseCode))
                    .Select(x => x.WarehouseCode)
                    .ToListAsync(cancellationToken);

            var userWarehouseCodes = new HashSet<int>();
            if (!isSuperAdmin)
            {
                var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                if (int.TryParse(userIdClaim, out var uid) && uid > 0)
                {
                    userWarehouseCodes = (await _dbContext.UserWarehouses
                        .AsNoTracking()
                        .Where(x => x.UserId == uid)
                        .Select(x => x.WarehouseCode)
                        .ToListAsync(cancellationToken)).ToHashSet();
                }
            }

            foreach (var reqLine in request.Lines)
            {
                if (!reqLine.WarehouseCode.HasValue || reqLine.WarehouseCode.Value == 0) continue;
                var code = reqLine.WarehouseCode.Value;
                if (code == warehouseCode)
                {
                    // Başlıkla aynı depo: zaten yukarıda doğrulandı, tekrar sorgulamaya gerek yok.
                    lineWarehouseByOrderLineId[reqLine.SalesOrderLineId] = code;
                    continue;
                }

                if (!activeLineWarehouses.Contains(code))
                {
                    return BadRequest(new { success = false, message = $"Kalem deposu bulunamadı veya aktif değil (kod: {code})" });
                }

                var stampedCode = lineMap.TryGetValue(reqLine.SalesOrderLineId, out var soLineForWarehouse)
                    ? soLineForWarehouse.SourceWarehouseCode
                    : null;

                var isStampedServiceWarehouse = stampedCode.HasValue && stampedCode.Value == code;

                if (!isSuperAdmin && !isStampedServiceWarehouse && !userWarehouseCodes.Contains(code))
                {
                    return BadRequest(new { success = false, message = $"Kalem için seçilen depoya yetkiniz yok (kod: {code})" });
                }

                lineWarehouseByOrderLineId[reqLine.SalesOrderLineId] = code;
            }
        }

        var firstInstallationId = orderLines.Select(x => x.InstallationId).FirstOrDefault(x => x != null);
        Installation? installation = null;
        if (firstInstallationId is not null)
        {
            installation = await _dbContext.Set<Installation>()
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == firstInstallationId.Value, cancellationToken);
        }

        var now = DateTime.UtcNow;
        var username = User.Identity?.Name ?? "System";

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        // AYNI SİPARİŞ SATIRI İKİ KEZ FATURALANIYORDU (2026-08-21, ölçüldü).
        //
        // Yukarıdaki "kalan miktar" kontrolü işlemin DIŞINDA ve kilitsizdi: iki istek
        // (çift tıklama, istemci yeniden denemesi, iki sekme) `existingInvoicedMap`i aynı anda
        // BOŞ okuyup ikisi de kontrolden geçiyor ve iki ayrı fatura yazıyordu. Kanıt: 98 ve 99
        // numaralı faturalar aynı saniyede aynı sipariş satırlarını (264, 265) faturaladı —
        // stok iki kez düştü, cariye iki kez borç yazıldı.
        //
        // Çözüm: sipariş satırları burada KİLİTLENİR (FOR UPDATE) ve kontrol işlemin içinde
        // TEKRARLANIR. İkinci istek birincisi işlemi bitirene kadar bekler, sonra onun yazdığı
        // fatura satırlarını görür ve reddedilir. Salt "önce oku, yoksa yaz" yetmez.
        await _dbContext.Database.ExecuteSqlRawAsync(
            "SELECT 1 FROM \"SalesOrderLines\" WHERE \"Id\" = ANY({0}) FOR UPDATE",
            new object[] { lineIds.ToArray() },
            cancellationToken);

        var invoicedNow = await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(x => x.SalesOrderLineId.HasValue && lineIds.Contains(x.SalesOrderLineId.Value))
            .GroupBy(x => x.SalesOrderLineId!.Value)
            .Select(g => new { SalesOrderLineId = g.Key, Qty = g.Sum(x => (decimal?)x.Quantity) ?? 0m })
            .ToDictionaryAsync(x => x.SalesOrderLineId, x => x.Qty, cancellationToken);

        foreach (var l in lines)
        {
            var orderQty = orderQtyMap.TryGetValue(l.SalesOrderLineId, out var oq2) ? oq2 : 0m;
            var already = invoicedNow.TryGetValue(l.SalesOrderLineId, out var iq2) ? iq2 : 0m;
            if (l.InvoiceQuantity > orderQty - already)
            {
                await tx.RollbackAsync(cancellationToken);
                return BadRequest(new
                {
                    success = false,
                    message = "Bu sipariş satırı bu sırada başka bir faturaya alınmış. Sayfayı yenileyip tekrar deneyin."
                });
            }
        }

        var isServiceOrder = orderLines.Any(x =>
            (x.StockCode != null && x.StockCode.StartsWith("HİZ-TAMİR", StringComparison.OrdinalIgnoreCase)) ||
            (x.Description != null && (x.Description.Contains("Servis Onarım", StringComparison.OrdinalIgnoreCase) || x.Description.Contains("Garantili Bedelsiz", StringComparison.OrdinalIgnoreCase)))
        );

        var invoice = new Invoice
        {
            Type = isServiceOrder ? InvoiceType.ServiceInvoice : InvoiceType.SalesInvoice,
            InvoiceNo = invoiceNo,
            CustomerCode = customerCode,
            CustomerInvoiceTypeOverride = customerInvoiceTypeOverride,
            DeliveryCustomerCode = deliveryCustomerCode,
            Date = request.Date == default ? now : request.Date,
            VatIncluded = request.VatIncluded,
            CurrencyTypeId = invoiceCurrencyTypeId,
            ExchangeRate = invoiceExchangeRate <= 0 ? 1m : invoiceExchangeRate,
            RateSource = invoiceCurrencyTypeId <= 1 ? null : (request.InvoiceCurrencyRate.HasValue && request.InvoiceCurrencyRate.Value > 0 ? "Manuel" : "TCMB"),
            Subtotal = subtotal,
            Discount = discount,
            NetTotal = netTotal,
            VatTotal = vatTotal,
            GrandTotal = grandTotal,
            CampaignDiscount = campaignDiscount,
            CampaignDetailsJson = !string.IsNullOrWhiteSpace(request.CampaignDetailsJson)
                ? request.CampaignDetailsJson
                : orderLines.Select(x => x.CampaignDetailsJson).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().FirstOrDefault(),
            SalesmanCode = invoiceSalesmanCode,
            Description = request.Description,
            InstallationName = installation?.InstallationName,
            InstallationPhone = installation?.InstallationPhone,
            CreateUser = username,
            CreateTime = now,
            EditUser = null,
            EditTime = null,
            IsPriceOverridden = request.IsPriceOverridden.GetValueOrDefault(false)
        };

        _dbContext.Set<Invoice>().Add(invoice);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var invoiceDate = invoice.Date;
        if (invoiceDate.Kind != DateTimeKind.Utc)
        {
            invoiceDate = DateTime.SpecifyKind(invoiceDate, DateTimeKind.Utc);
        }

        var invoiceLines = lines
            .OrderBy(x => x.SalesOrderLineId)
            .Select((l, idx) =>
            {
                var soLine = lineMap[l.SalesOrderLineId];
                var originalDesc = soLine.Description ?? string.Empty;
                var campaignNote = string.Empty;
                if (soLine.IsGift)
                {
                    campaignNote = " (Kampanya - Hediye)";
                }
                else if (soLine.DiscountAmount > 0)
                {
                    campaignNote = " (Kampanya İndirimi)";
                }

                var description = originalDesc;
                if (!string.IsNullOrEmpty(campaignNote) && !originalDesc.Contains("Kampanya", StringComparison.OrdinalIgnoreCase))
                {
                    description = string.IsNullOrWhiteSpace(originalDesc) ? campaignNote.Trim() : $"{originalDesc} {campaignNote}";
                }

                var lineLid = soLine.LineageId ?? Guid.NewGuid();
                // `GetLineActualUnitPrice` belgenin parasındaki fiyatı verir; TL çapası
                // faturanın donmuş kuruyla üretilir (bkz. yukarıdaki TL ÇAPASI notu).
                var docUnitPrice = GetLineActualUnitPrice(soLine);
                var actualUnitPrice = ToTry(docUnitPrice);

                return new InvoiceLine
                {
                    InvoiceId = invoice.Id,
                    SalesOrderLineId = l.SalesOrderLineId,
                    LineageId = lineLid,
                    StockCode = soLine.StockCode,
                    Description = description,
                    Quantity = l.InvoiceQuantity,
                    UnitPrice = actualUnitPrice,
                    CurrencyTypeId = soLine.CurrencyTypeId > 0 ? soLine.CurrencyTypeId : invoiceCurrencyTypeId,
                    CurrencyRate = invoiceExchangeRate <= 0 ? 1m : invoiceExchangeRate,
                    CurrencyUnitPrice = docUnitPrice,
                    VatRate = soLine.VatRate,
                    LineNo = idx + 1,
                    // Kalem kendi deposunu taşımıyorsa faturanın başlık deposundan çıkar.
                    // Değer BURADA sabitleniyor: fatura silinince iade de bu koddan okunuyor,
                    // aksi halde araç deposundan çıkan parça merkez depoya iade edilirdi.
                    WarehouseCode = lineWarehouseByOrderLineId.TryGetValue(l.SalesOrderLineId, out var lineWh)
                        ? lineWh
                        : warehouseCode,
                    CreateUser = username,
                    CreateTime = now,
                    EditUser = null,
                    EditTime = null
                };
            })
            .ToList();

        _dbContext.Set<InvoiceLine>().AddRange(invoiceLines);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Re-link installations matching LineageId or SalesOrderLineId
        var createdLineageIds = invoiceLines.Where(x => x.LineageId.HasValue).Select(x => x.LineageId!.Value).ToList();
        var createdSoLineIds = invoiceLines.Where(x => x.SalesOrderLineId.HasValue).Select(x => x.SalesOrderLineId!.Value).ToList();

        var relinkInstallations = await _dbContext.Set<Installation>()
            .Where(x => (x.LineageId.HasValue && createdLineageIds.Contains(x.LineageId.Value)) ||
                        (x.SalesOrderLineId.HasValue && createdSoLineIds.Contains(x.SalesOrderLineId.Value)))
            .ToListAsync(cancellationToken);

        if (relinkInstallations.Count > 0)
        {
            var lineByLineage = invoiceLines.Where(x => x.LineageId.HasValue).ToDictionary(x => x.LineageId!.Value, x => x);
            var lineBySoId = invoiceLines.Where(x => x.SalesOrderLineId.HasValue).ToDictionary(x => x.SalesOrderLineId!.Value, x => x);

            foreach (var inst in relinkInstallations)
            {
                InvoiceLine? matchedLine = null;
                if (inst.LineageId.HasValue && lineByLineage.TryGetValue(inst.LineageId.Value, out var l1)) matchedLine = l1;
                else if (inst.SalesOrderLineId.HasValue && lineBySoId.TryGetValue(inst.SalesOrderLineId.Value, out var l2)) matchedLine = l2;

                if (matchedLine is not null)
                {
                    inst.InvoiceLineId = matchedLine.Id;
                    if (inst.Status == "Pasif / Geri Alındı") inst.Status = "Yeni Kayıt";
                }
            }
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        /*
         * KALEMİN KENDİ MONTAJ KAYDININ KİMLİĞİ (2026-09-08 canlı hata).
         *
         * Sipariş ekranında montajlı satır açılırken `SalesOrderLine.Installation = installation`
         * yazılıyor; bu yalnızca `SalesOrderLine.InstallationId`'yi dolduruyor,
         * `Installation.SalesOrderLineId` sütunu NULL kalıyor. Bağ tek yönlü.
         *
         * Aşağıdaki döngü mevcut kaydı yalnızca `Installation.SalesOrderLineId` üzerinden
         * arıyordu; sipariş kökenli montajı hiç bulamıyor ve İKİNCİSİNİ açıyordu. Görülen
         * sonuç (MNT-0000437): 2 satırlık siparişte 3 montaj kalemi — kullanıcı bir satırın
         * montaj bilgisini düzeltince o satır için ikinci bir kalem doğuyordu.
         *
         * Kalemi kimliğiyle önceden çözüyoruz; tahmin yok, kardeş montajlara dokunulmuyor.
         */
        var soLineInstallationIdByLineId = createdSoLineIds.Count == 0
            ? new Dictionary<int, int>()
            : await _dbContext.Set<SalesOrderLine>()
                .AsNoTracking()
                .Where(x => createdSoLineIds.Contains(x.Id) && x.InstallationId != null)
                .Select(x => new { x.Id, InstallationId = x.InstallationId!.Value })
                .ToDictionaryAsync(x => x.Id, x => x.InstallationId, cancellationToken);

        // Process line-level installation requests sent from Sales Invoice page
        foreach (var l in lines)
        {
            if (l.Installation is null) continue;
            var createdInvoiceLine = invoiceLines.FirstOrDefault(x => x.SalesOrderLineId == l.SalesOrderLineId);
            if (createdInvoiceLine is null) continue;

            Installation? existingInst = null;

            // (1) Sipariş satırının KENDİ montaj kaydı. Tek yönlü bağ yüzünden yalnızca buradan
            //     bulunabiliyor; aşağıdaki eski arama bunu göremiyordu.
            if (soLineInstallationIdByLineId.TryGetValue(l.SalesOrderLineId, out var soInstallationId))
            {
                existingInst = relinkInstallations.FirstOrDefault(x => x.Id == soInstallationId)
                    ?? await _dbContext.Set<Installation>()
                        .FirstOrDefaultAsync(x => x.Id == soInstallationId, cancellationToken);
            }

            // (2) Fatura ekranından sonradan eklenmiş montajlar; onlarda alan dolu.
            existingInst ??= relinkInstallations.FirstOrDefault(x => x.SalesOrderLineId == l.SalesOrderLineId)
                ?? await _dbContext.Set<Installation>().FirstOrDefaultAsync(x => x.SalesOrderLineId == l.SalesOrderLineId, cancellationToken);

            if (existingInst is not null)
            {
                existingInst.DealerName = string.IsNullOrWhiteSpace(l.Installation.DealerName) ? (invoice?.CustomerCode ?? string.Empty) : l.Installation.DealerName.Trim();
                existingInst.ProductName = string.IsNullOrWhiteSpace(l.Installation.ProductName) ? createdInvoiceLine.StockCode : l.Installation.ProductName.Trim();
                existingInst.Quantity = l.Installation.Quantity <= 0 ? l.InvoiceQuantity : l.Installation.Quantity;
                existingInst.InstallationName = string.IsNullOrWhiteSpace(l.Installation.CustomerName) ? null : l.Installation.CustomerName.Trim();
                existingInst.InstallationPhone = string.IsNullOrWhiteSpace(l.Installation.Phone) ? null : l.Installation.Phone.Trim();
                existingInst.Address = string.IsNullOrWhiteSpace(l.Installation.Address) ? "-" : l.Installation.Address.Trim();
                existingInst.Region = string.IsNullOrWhiteSpace(l.Installation.Region) ? "-" : l.Installation.Region.Trim();
                existingInst.DealerDescription = string.IsNullOrWhiteSpace(l.Installation.Note) ? null : l.Installation.Note.Trim();
                existingInst.InvoiceLineId = createdInvoiceLine.Id;
                // Bağ bundan sonra ÇİFT yönlü: bir sonraki arama hangi yoldan gelirse gelsin
                // aynı kaydı buluyor.
                existingInst.SalesOrderLineId ??= createdInvoiceLine.SalesOrderLineId;
                existingInst.EditUser = username;
                existingInst.EditTime = now;
                if (existingInst.Status == "Pasif / Geri Alındı") existingInst.Status = "Yeni Kayıt";
                _dbContext.Set<Installation>().Update(existingInst);
            }
            else
            {
                var newInst = new Installation
                {
                    InvoiceLineId = createdInvoiceLine.Id,
                    SalesOrderLineId = createdInvoiceLine.SalesOrderLineId,
                    LineageId = createdInvoiceLine.LineageId ?? Guid.NewGuid(),
                    DealerCode = invoice?.CustomerCode,
                    DealerName = string.IsNullOrWhiteSpace(l.Installation.DealerName) ? (invoice?.CustomerCode ?? string.Empty) : l.Installation.DealerName.Trim(),
                    ProductName = string.IsNullOrWhiteSpace(l.Installation.ProductName) ? createdInvoiceLine.StockCode : l.Installation.ProductName.Trim(),
                    Quantity = l.Installation.Quantity <= 0 ? l.InvoiceQuantity : l.Installation.Quantity,
                    InstallationName = string.IsNullOrWhiteSpace(l.Installation.CustomerName) ? null : l.Installation.CustomerName.Trim(),
                    InstallationPhone = string.IsNullOrWhiteSpace(l.Installation.Phone) ? null : l.Installation.Phone.Trim(),
                    Address = string.IsNullOrWhiteSpace(l.Installation.Address) ? "-" : l.Installation.Address.Trim(),
                    Region = string.IsNullOrWhiteSpace(l.Installation.Region) ? "-" : l.Installation.Region.Trim(),
                    DealerDescription = string.IsNullOrWhiteSpace(l.Installation.Note) ? null : l.Installation.Note.Trim(),
                    Type = "Montaj",
                    Status = "Yeni Kayıt",
                    CreateUser = username,
                    CreateTime = now
                };
                _dbContext.Set<Installation>().Add(newInst);
                await _dbContext.SaveChangesAsync(cancellationToken);

                // Bu dal artık NADİR olmalı: sipariş ekranında montaj girilmiş bir satır
                // buraya düşerse mevcut kayıt bulunamamış demektir. Sessizce ikinci montaj
                // doğurmak canlıda üç kalemlik montaj fişine yol açmıştı; izi kalsın.
                Console.WriteLine(
                    $"[Montaj] Fatura ekranindan YENI montaj kaydi: siparis satiri {l.SalesOrderLineId}, " +
                    $"montaj {newInst.Id}. [montaj-dupe-fix-v7]");

                // Update the SalesOrderLine itself so details endpoint can query it!
                var soLineEntity = await _dbContext.Set<SalesOrderLine>().FirstOrDefaultAsync(x => x.Id == createdInvoiceLine.SalesOrderLineId, cancellationToken);
                if (soLineEntity is not null)
                {
                    soLineEntity.InstallationId = newInst.Id;
                    soLineEntity.EditUser = username;
                    soLineEntity.EditTime = now;
                    _dbContext.Set<SalesOrderLine>().Update(soLineEntity);
                }
            }
        }
        await _dbContext.SaveChangesAsync(cancellationToken);

        // BELGENİN PARA BİRİMİ KALEMLERDEN GELİR (2026-08-17).
        // Eskiden CARİNİN kartındaki döviz okunuyordu; o alan kaldırıldı ve bir cariye her
        // para biriminde satış yapılabiliyor. Değişken adı geri kalan yüzlerce satırda
        // kullanıldığı için korundu — anlamı artık "belgenin para birimi".
        var customerCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(
            invoiceLines.FirstOrDefault(x => x.CurrencyTypeId > B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try)?.CurrencyTypeId ?? 1);
        var customerTryRate = 1m;
        if (customerCurrencyTypeId != 1)
        {
            if (request.InvoiceCurrencyRate.HasValue && request.InvoiceCurrencyRate.Value > 0)
            {
                customerTryRate = request.InvoiceCurrencyRate.Value;
            }
            else
            {
                var lineRate = invoiceLines.FirstOrDefault(x => x.CurrencyTypeId == customerCurrencyTypeId)?.CurrencyRate ?? 1m;
                if (lineRate > 1m)
                {
                    customerTryRate = lineRate;
                }
                else
                {
                    var code = MapCurrencyTypeIdToCode(customerCurrencyTypeId);
                    if (!string.IsNullOrWhiteSpace(code))
                    {
                        try
                        {
                            customerTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                        }
                        catch
                        {
                            customerTryRate = 1m;
                        }
                    }
                }
            }
        }

        var invoiceCustomerCurrencyAmount = customerTryRate > 0 ? Math.Round(invoice.GrandTotal / customerTryRate, 2, MidpointRounding.AwayFromZero) : Math.Round(invoice.GrandTotal, 2, MidpointRounding.AwayFromZero);

        decimal invoiceCurrencyGrandTotal = invoice.GrandTotal;
        // Toplamları çeviren kurun AYNISI. Eskiden `request`ten okunup gerekirse GÜNÜN
        // kuru çekiliyordu; o kur toplamları çeviren kurdan farklı olabiliyordu.
        decimal invoiceTryRate = invoiceAnchorRate;

        var curIds = invoiceLines
            .Where(x => x.CurrencyTypeId > 0 && x.CurrencyUnitPrice > 0)
            .Select(x => x.CurrencyTypeId)
            .Distinct()
            .ToList();

        if (curIds.Count == 1)
        {
            invoiceCurrencyTypeId = curIds[0];

            /*
              CARİYE YAZILAN BORÇ FATURANIN GENEL TOPLAMIDIR — KALEMLERİN HAM TOPLAMI DEĞİL.
              (2026-08-24, kullanıcı bildirimi: "limit ile cari ekstre tutmuyor, ödeme
              tutarının burada ne işi var, 2 kere mi hesaplamış".)

              Burada genel toplam kalemlerden YENİDEN toplanıyordu: `miktar × birim fiyat ×
              (1 + KDV)`. Bu hesapta İSKONTO YOK. Faturada indirim varsa cariye, faturanın
              kendisinden DAHA BÜYÜK bir borç yazılıyordu.

              Canlı örnek (A00000000071173, MUSTAFA AROĞLU LTD.):
                brüt 694.242,98 − iskonto 157.299,96 = net 536.943,02 + KDV 43.056,98
                → faturanın genel toplamı 580.000,00
                → ekstreye yazılan borç      737.299,96   (= brüt + KDV, iskontosuz)
              Cari 157.299,96 ₺ fazla borçlandırılmıştı; Limit Risk Raporu da defteri
              okuduğu için aynı fazlalığı gösteriyordu.

              `docGrandTotal` yukarıda hesaplanan, BELGENİN KENDİ PARASINDAKİ genel toplamdır
              (net + KDV, indirim uygulanmış) ve TL çevriminden ÖNCE alınmıştır — burada
              istenen değer tam olarak odur.
            */
            invoiceCurrencyGrandTotal = docGrandTotal;
        }

        if (invoiceCurrencyTypeId == 0)
        {
            invoiceTryRate = 1m;
        }
        else
        {
            if (invoiceTryRate <= 1.0001m)
            {
                var code = MapCurrencyTypeIdToCode(invoiceCurrencyTypeId);
                if (!string.IsNullOrWhiteSpace(code))
                {
                    try
                    {
                        invoiceTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                    }
                    catch
                    {
                        invoiceTryRate = 1m;
                    }
                }
                if (invoiceTryRate <= 0) invoiceTryRate = 1m;
            }
        }

        // Faturanın para birimi ve kuru BAŞLIKTA donduruluyor (2026-08-14). Öncesinde yalnızca
        // yerel değişkende kalıyor, kaydedilmiyordu; fatura sonradan okunduğunda dövizi
        // kalemlerden yeniden çıkarılıyor, kur ise tamamen kayboluyordu. Muhasebe fişi ve KDV
        // beyanı fatura ANINDAKİ kuru ister — güncel kurla yeniden değerlemek yasak.
        invoice.CurrencyTypeId = invoiceCurrencyTypeId;
        invoice.ExchangeRate = invoiceTryRate <= 0 ? 1m : invoiceTryRate;
        invoice.RateSource = invoiceCurrencyTypeId == 0
            ? null
            : (request.InvoiceCurrencyRate.HasValue && request.InvoiceCurrencyRate.Value > 0 ? "Manuel" : "TCMB");

        var isChangeScenario = request.CashReceivedAmount.HasValue 
            && request.CashReceivedAmount.Value > invoiceCurrencyGrandTotal
            && (request.ChangeCashAccountId.HasValue || request.ChangeBankAccountDefinitionId.HasValue);
        var paymentTryAmount = isChangeScenario
            ? (request.CashReceivedAmount.Value * invoiceTryRate)
            : (request.CashReceivedAmount.HasValue
                ? request.CashReceivedAmount.Value * invoiceTryRate
                : invoice.GrandTotal);

        var ledgerPaymentTryAmount = isChangeScenario ? invoice.GrandTotal : paymentTryAmount;

        // CARİ HAREKETİ BELGENİN PARA BİRİMİNDE YAZILIR — CARİNİNKİNDE DEĞİL (2026-08-17,
        // kullanıcı kararı: "fatura kesilirken ürün tipine göre kesilir").
        //
        // Fatura BAŞLIĞI zaten üründen geliyordu (yukarıda `invoiceCurrencyTypeId` kalemlerin
        // satış dövizinden çıkarılıyor), ama ekstreye yazılan satır carinin kartındaki para
        // birimini kullanıyordu. Cariler fiilen hep TL olduğu için sonuç şuydu: EUR fiyatlı
        // ürün EUR faturaya kesiliyor, ama cari ekstresine TL satır düşüyor, kur 1 damgalanıyor
        // ve dövizli bakiye hiç oluşmuyordu. Belge ile defter aynı parayı konuşmak zorunda.
        //
        // TL çapası (`Amount`) DEĞİŞMEZ: her satır TL karşılığını taşımaya devam eder.
        var ledgerCurrencyTypeId = invoiceCurrencyTypeId > 0
            ? invoiceCurrencyTypeId
            : (customerCurrencyTypeId == 0 ? 1 : customerCurrencyTypeId);

        var ledgerCurrencyRate = invoiceCurrencyTypeId > 0
            ? (invoice.ExchangeRate <= 0 ? 1m : invoice.ExchangeRate)
            : (customerTryRate <= 0 ? 1m : customerTryRate);

        var ledgerCurrencyAmount = invoiceCurrencyTypeId > 0
            ? Math.Round(invoiceCurrencyGrandTotal, 2, MidpointRounding.AwayFromZero)
            : invoiceCustomerCurrencyAmount;

        _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
        {
            CustomerCode = customerCode,
            Date = invoiceDate,
            DueDate = invoiceDate,
            Direction = CustomerLedgerEntryDirection.Debit,
            // TL ÇAPASI FATURANIN KENDİSİNDEN OKUNUR, YENİDEN ÇARPILMAZ.
            //
            // `CurrencyAmount × kur` ile yeniden hesaplamak kuruş farkı üretiyordu: dövizli
            // toplam 2 haneye yuvarlandıktan SONRA çarpıldığı için başlığın TL toplamıyla
            // 5 kuruş ayrışıyor, cari bakiyesi faturayla tutmuyordu (1.200,00 $ örneğinde
            // 57.498,60 ↔ 57.498,65). Başlık zaten TL saklıyor; tek doğru kaynak o.
            Amount = ledgerCurrencyTypeId > 1 && ledgerCurrencyRate > 0
                ? invoice.GrandTotal
                : ledgerCurrencyAmount,
            CurrencyTypeId = ledgerCurrencyTypeId,
            CurrencyRate = ledgerCurrencyRate,
            CurrencyAmount = ledgerCurrencyAmount,
            // Fatura kaydı: ödeme YOK, bu yalnız borç satırı. Yine de üçlü kendi içinde
            // TUTARLI olmalı — (para birimi + kur + tutar) aynı parayı anlatır ve
            // `tutar × kur = Amount` eşitliğini sağlamalıdır. Kur 1 bırakılınca dövizli
            // faturada üçlü çelişiyordu (8.308,39 € × 1 ≠ 458.943,22 ₺): cari ekstresinde
            // "Kur" sütunu 1 görünüyor, bu üçlüyü okuyan her yol da faturayı TL sanıyordu.
            // Aynı hata cari açılış devrinde de vardı ve orada da düzeltildi.
            PaymentCurrencyTypeId = ledgerCurrencyTypeId,
            PaymentCurrencyRate = ledgerCurrencyRate,
            PaymentCurrencyAmount = ledgerCurrencyAmount,
            DocumentNo = invoice.InvoiceNo,
            Description = string.IsNullOrWhiteSpace(invoice.Description) ? "Faturamız" : invoice.Description,
            TransactionType = invoice.Type == InvoiceType.ServiceInvoice ? "Tamir Faturası" : "Satış Faturası",
            DeliveryCustomerCode = deliveryCustomerCode,
            ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
            ReferenceId = invoice.Id,
            CreateUser = username,
            CreateTime = now
        });

        await _dbContext.SaveChangesAsync(cancellationToken);

        if (cashAccountId is not null)
        {
            var cash = await _dbContext.CashAccounts
                .AsNoTracking()
                .Select(x => new { x.Id, x.CurrencyTypeId })
                .FirstOrDefaultAsync(x => x.Id == cashAccountId.Value, cancellationToken);

            if (cash is null)
            {
                await tx.RollbackAsync(cancellationToken);
                return BadRequest(new { success = false, message = "Kasa bulunamadı" });
            }

            // HESABIN PARASI TL Mİ? (2026-08-19 düzeltmesi)
            //
            // Buradaki kontrol `cashCurrencyTypeId == 0` idi. TL kasa/banka tanımları ekrandan
            // 1 ile yazılıyor (0 yalnızca eski kayıtlarda kalan varsayılan), dolayısıyla TL bir
            // kasa DÖVİZLİ sanılıyor ve istekle gelen kur ona uygulanıyordu: satır TL
            // (`CurrencyTypeId=1`) görünürken `CurrencyAmount` tutarın kura bölünmüş hâli
            // oluyordu. `CurrencyTypeHelper.IsTry` iki hâli de TL kabul eder.
            var cashCurrencyTypeId = cash.CurrencyTypeId;
            var cashTryRate = 1m;
            if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId))
            {
                cashTryRate = 1m;
            }
            else
            {
                if (request.CurrencyRate > 0m)
                {
                    cashTryRate = request.CurrencyRate;
                }
                else
                {
                    var code = MapCurrencyTypeIdToCode(cashCurrencyTypeId);
                    if (!string.IsNullOrWhiteSpace(code))
                    {
                        try
                        {
                            cashTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                        }
                        catch
                        {
                            cashTryRate = 1m;
                        }
                    }
                }

                if (cashTryRate <= 0) cashTryRate = 1m;
            }

            var cashCurrencyAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId)
                ? paymentTryAmount
                : (cashTryRate > 0 ? paymentTryAmount / cashTryRate : 0m);

            _dbContext.CashAccountTransactions.Add(new CashAccountTransaction
            {
                CashAccountId = cashAccountId.Value,
                Date = invoiceDate,
                Direction = CashAccountTransactionDirection.In,
                Amount = paymentTryAmount,
                CurrencyTypeId = cashCurrencyTypeId,
                CurrencyRate = cashTryRate,
                CurrencyAmount = cashCurrencyAmount,
                CounterpartyType = CashAccountTransactionCounterpartyType.Customer,
                CounterpartyCode = customerCode,
                CounterpartyName = (customer?.Name ?? string.Empty).Trim(),
                ReferenceType = CashAccountTransactionReferenceType.Invoice,
                ReferenceId = invoice.Id,
                Description = $"Satış Faturası: {invoice.InvoiceNo}",
                CreateUser = username,
                CreateTime = now
            });

            // Kasa tahsilatı: cari ekstreye Credit (Alacak) satırı yaz
            if (isChangeScenario)
            {
                var payCurrencyAmount = cashCurrencyAmount;
                var custCurrencyAmount = paymentTryAmount / (customerTryRate > 0 ? customerTryRate : 1m);
                _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                {
                    CustomerCode = customerCode,
                    Date = invoiceDate,
                    DueDate = invoiceDate,
                    Direction = CustomerLedgerEntryDirection.Credit,
                    Amount = paymentTryAmount,
                    CurrencyTypeId = customerCurrencyTypeId,
                    CurrencyRate = customerTryRate <= 0 ? 1m : customerTryRate,
                    CurrencyAmount = custCurrencyAmount,
                    PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId) ? 1 : cashCurrencyTypeId,
                    PaymentCurrencyRate = cashTryRate,
                    PaymentCurrencyAmount = payCurrencyAmount,
                    DocumentNo = invoice.InvoiceNo,
                    Description = $"Kasa Tahsilat ({invoice.InvoiceNo})",
                    TransactionType = "Kasa",
                    DeliveryCustomerCode = deliveryCustomerCode,
                    ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                    ReferenceId = invoice.Id,
                    CreateUser = username,
                    CreateTime = now
                });
            }
            else
            {
                var customerCurrencyAmountCash = customerTryRate > 0 ? Math.Round(ledgerPaymentTryAmount / customerTryRate, 4) : ledgerPaymentTryAmount;
                var netPaymentCurrencyAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId)
                    ? ledgerPaymentTryAmount
                    : (cashTryRate > 0 ? ledgerPaymentTryAmount / cashTryRate : 0m);
                var (cpTypeId, cpRate, cpAmount) = PaymentCurrencyCalculator.CalculatePaymentCurrencyInfo(
                    customerCurrencyTypeId, customerCurrencyAmountCash, customerTryRate,
                    cashCurrencyTypeId, netPaymentCurrencyAmount, cashTryRate, ledgerPaymentTryAmount);

                _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                {
                    CustomerCode = customerCode,
                    Date = invoiceDate,
                    DueDate = invoiceDate,
                    Direction = CustomerLedgerEntryDirection.Credit,
                    Amount = ledgerPaymentTryAmount,
                    CurrencyTypeId = customerCurrencyTypeId,
                    CurrencyRate = customerTryRate <= 0 ? 1m : customerTryRate,
                    CurrencyAmount = customerCurrencyAmountCash,
                    PaymentCurrencyTypeId = cpTypeId,
                    PaymentCurrencyRate = cpRate,
                    PaymentCurrencyAmount = cpAmount,
                    DocumentNo = invoice.InvoiceNo,
                    Description = $"Kasa Tahsilat ({invoice.InvoiceNo})",
                    TransactionType = "Kasa",
                    DeliveryCustomerCode = deliveryCustomerCode,
                    ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                    ReferenceId = invoice.Id,
                    CreateUser = username,
                    CreateTime = now
                });
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        if (bankAccountDefinitionId is not null)
        {
            var bank = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.AccountType, x.CurrencyTypeId })
                .FirstOrDefaultAsync(x => x.Id == bankAccountDefinitionId.Value, cancellationToken);

            if (bank is null)
            {
                await tx.RollbackAsync(cancellationToken);
                return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });
            }
            var isPosAccount = bank.AccountType == 14;
            var bankDesc = isPosAccount ? $"POS Tahsilat - Satış Faturası: {invoice.InvoiceNo}" : $"Satış Faturası: {invoice.InvoiceNo}";

            var bankCurrencyTypeId = bank.CurrencyTypeId;
            var bankTryRate = 1m;
            if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(bankCurrencyTypeId))
            {
                bankTryRate = 1m;
            }
            else
            {
                if (request.CurrencyRate > 0m)
                {
                    bankTryRate = request.CurrencyRate;
                }
                else
                {
                    var code = MapCurrencyTypeIdToCode(bankCurrencyTypeId);
                    if (!string.IsNullOrWhiteSpace(code))
                    {
                        try
                        {
                            bankTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                        }
                        catch
                        {
                            bankTryRate = 1m;
                        }
                    }
                }

                if (bankTryRate <= 0) bankTryRate = 1m;
            }

            var bankCurrencyAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(bankCurrencyTypeId)
                ? paymentTryAmount
                : (bankTryRate > 0 ? paymentTryAmount / bankTryRate : 0m);
            _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
            {
                BankAccountDefinitionId = bankAccountDefinitionId.Value,
                Date = invoiceDate,
                Direction = BankAccountTransactionDirection.In,
                Amount = paymentTryAmount,
                CurrencyTypeId = bankCurrencyTypeId,
                CurrencyRate = bankTryRate,
                CurrencyAmount = bankCurrencyAmount,
                CounterpartyType = BankAccountTransactionCounterpartyType.Customer,
                CounterpartyCode = invoice.CustomerCode,
                CounterpartyName = (customer?.Name ?? string.Empty).Trim(),
                DocumentNo = invoice.InvoiceNo,
                Description = bankDesc,
                IsPosFee = false,
                CreateUser = username,
                CreateTime = now
            });

            if (isChangeScenario)
            {
                var payCurrencyAmount = bankCurrencyAmount;
                var custCurrencyAmount = paymentTryAmount / (customerTryRate > 0 ? customerTryRate : 1m);
                _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                {
                    CustomerCode = customerCode,
                    Date = invoiceDate,
                    DueDate = invoiceDate,
                    Direction = CustomerLedgerEntryDirection.Credit,
                    Amount = paymentTryAmount,
                    CurrencyTypeId = customerCurrencyTypeId,
                    CurrencyRate = customerTryRate <= 0 ? 1m : customerTryRate,
                    CurrencyAmount = custCurrencyAmount,
                    PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(bankCurrencyTypeId) ? 1 : bankCurrencyTypeId,
                    PaymentCurrencyRate = bankTryRate,
                    PaymentCurrencyAmount = payCurrencyAmount,
                    DocumentNo = invoice.InvoiceNo,
                    Description = $"Banka Tahsilat ({invoice.InvoiceNo})",
                    TransactionType = "Banka",
                    DeliveryCustomerCode = deliveryCustomerCode,
                    ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                    ReferenceId = invoice.Id,
                    CreateUser = username,
                    CreateTime = now
                });
            }
            else
            {
                var customerCurrencyAmountBank = customerTryRate > 0 ? Math.Round(ledgerPaymentTryAmount / customerTryRate, 4) : ledgerPaymentTryAmount;
                var netPaymentCurrencyAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(bankCurrencyTypeId)
                    ? ledgerPaymentTryAmount
                    : (bankTryRate > 0 ? ledgerPaymentTryAmount / bankTryRate : 0m);
                var (bpTypeId, bpRate, bpAmount) = PaymentCurrencyCalculator.CalculatePaymentCurrencyInfo(
                    customerCurrencyTypeId, customerCurrencyAmountBank, customerTryRate,
                    bankCurrencyTypeId, netPaymentCurrencyAmount, bankTryRate, ledgerPaymentTryAmount);

                _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                {
                    CustomerCode = customerCode,
                    Date = invoiceDate,
                    DueDate = invoiceDate,
                    Direction = CustomerLedgerEntryDirection.Credit,
                    Amount = ledgerPaymentTryAmount,
                    CurrencyTypeId = customerCurrencyTypeId,
                    CurrencyRate = customerTryRate <= 0 ? 1m : customerTryRate,
                    CurrencyAmount = customerCurrencyAmountBank,
                    PaymentCurrencyTypeId = bpTypeId,
                    PaymentCurrencyRate = bpRate,
                    PaymentCurrencyAmount = bpAmount,
                    DocumentNo = invoice.InvoiceNo,
                    Description = $"Banka Tahsilat ({invoice.InvoiceNo})",
                    TransactionType = "Banka",
                    DeliveryCustomerCode = deliveryCustomerCode,
                    ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                    ReferenceId = invoice.Id,
                    CreateUser = username,
                    CreateTime = now
                });
            }

            try
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (
                ex.InnerException is Npgsql.PostgresException pg
                && pg.SqlState == "42703"
                && (pg.MessageText?.Contains("BankAccountTransactions", StringComparison.OrdinalIgnoreCase) ?? false)
                && (
                    (pg.MessageText?.Contains("DocumentNo", StringComparison.OrdinalIgnoreCase) ?? false)
                    || (pg.MessageText?.Contains("MaturityDate", StringComparison.OrdinalIgnoreCase) ?? false)
                    || (pg.MessageText?.Contains("Description", StringComparison.OrdinalIgnoreCase) ?? false)))
            {
                await _dbContext.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"BankAccountTransactions\" ADD COLUMN IF NOT EXISTS \"DocumentNo\" character varying(30) NULL;" +
                    " ALTER TABLE \"BankAccountTransactions\" ADD COLUMN IF NOT EXISTS \"MaturityDate\" timestamp with time zone NULL;" +
                    " ALTER TABLE \"BankAccountTransactions\" ADD COLUMN IF NOT EXISTS \"Description\" character varying(2000) NULL;",
                    cancellationToken);

                await _dbContext.SaveChangesAsync(cancellationToken);
            }
        }

        if (takePaymentNow && isChangeScenario)
        {
            var cashReceived = request.CashReceivedAmount.Value;

            invoiceCurrencyTypeId = 0;
            invoiceCurrencyGrandTotal = invoice.GrandTotal;

            curIds = invoiceLines
                .Where(x => x.CurrencyTypeId > 0 && x.CurrencyUnitPrice > 0)
                .Select(x => x.CurrencyTypeId)
                .Distinct()
                .ToList();

            if (curIds.Count == 1)
            {
                invoiceCurrencyTypeId = curIds[0];
                // Kalemleri yeniden toplamak ISKONTOYU YOK SAYIYORDU; gerekce `BelgeParasiGenelToplam` icinde.
                invoiceCurrencyGrandTotal = BelgeParasiGenelToplam(invoice, invoiceCurrencyTypeId);
            }

            var diffCurrency = cashReceived - invoiceCurrencyGrandTotal;
            if (diffCurrency > 0.0001m)
            {
                if (changeCashAccountId is null && changeBankAccountDefinitionId is null)
                {
                    if (diffCurrency <= 1.00m)
                    {
                        cashReceived = invoiceCurrencyGrandTotal;
                        diffCurrency = 0m;
                    }
                    else
                    {
                        await tx.RollbackAsync(cancellationToken);
                        return BadRequest(new { success = false, message = "Nakit miktar fatura tutarından büyükse fazlalık ödenecek hesabı seçmelisiniz" });
                    }
                }
            }

            if (diffCurrency > 0.0001m)
            {

                invoiceTryRate = request.InvoiceCurrencyRate.GetValueOrDefault();
                if (invoiceCurrencyTypeId == 0)
                {
                    invoiceTryRate = 1m;
                }
                else
                {
                    if (invoiceTryRate <= 1.0001m)
                    {
                        var code = MapCurrencyTypeIdToCode(invoiceCurrencyTypeId);
                        if (!string.IsNullOrWhiteSpace(code))
                        {
                            try
                            {
                                invoiceTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                            }
                            catch
                            {
                                invoiceTryRate = 1m;
                            }
                        }

                        if (invoiceTryRate <= 0) invoiceTryRate = 1m;
                    }
                }

                var diffTry = invoiceCurrencyTypeId == 0 ? diffCurrency : diffCurrency * invoiceTryRate;
                if (diffTry > 0.0001m)
                {
                    if (changeCashAccountId is not null)
                    {
                        var cash = await _dbContext.CashAccounts
                            .AsNoTracking()
                            .Select(x => new { x.Id, x.CurrencyTypeId })
                            .FirstOrDefaultAsync(x => x.Id == changeCashAccountId.Value, cancellationToken);

                        if (cash is null)
                        {
                            await tx.RollbackAsync(cancellationToken);
                            return BadRequest(new { success = false, message = "Fazlalık kasası bulunamadı" });
                        }

                        var changeCurrencyTypeId = cash.CurrencyTypeId;
                        var currencyRate = (request.ChangeCurrencyRate.HasValue && request.ChangeCurrencyRate.Value > 0) ? request.ChangeCurrencyRate.Value : 1m;
                        var currencyAmount = diffTry;
                        if (request.ChangeCurrencyRate.GetValueOrDefault() <= 0m && !B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(changeCurrencyTypeId))
                        {
                            var changeCode = MapCurrencyTypeIdToCode(changeCurrencyTypeId);
                            if (string.IsNullOrWhiteSpace(changeCode))
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return BadRequest(new { success = false, message = "Geçersiz para birimi" });
                            }

                            try
                            {
                                currencyRate = await _money.GetLatestTryRateAsync(changeCode, cancellationToken);
                            }
                            catch
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                            }

                            if (currencyRate <= 0)
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                            }
                        }

                        if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(changeCurrencyTypeId))
                        {
                            currencyAmount = diffTry / currencyRate;
                        }

                        // Calculate cash account balance in its currency
                        var carry = (decimal)await _dbContext.CashAccounts
                            .Where(x => x.Id == changeCashAccountId.Value)
                            .Select(x => x.LastCarryAmount)
                            .FirstOrDefaultAsync(cancellationToken);

                        var transactions = await _dbContext.CashAccountTransactions
                            .AsNoTracking()
                            .Where(x => x.CashAccountId == changeCashAccountId.Value)
                            .Select(x => new { x.Direction, x.Amount, x.CurrencyAmount, x.CurrencyTypeId })
                            .ToListAsync(cancellationToken);

                        var normCurId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(changeCurrencyTypeId);

                        // Kasanın KENDİ para birimindeki hareketler sayılır.
                        //
                        // Öncesinde süzgeç yoktu: `CurrencyAmount` bütün hareketler üzerinden
                        // toplanıyordu, yani dolarla euro yan yana ekleniyordu. Kanonik bakiye
                        // (`CashAccountsController`) bu süzgeci zaten uyguluyor — burası kardeş
                        // yol olarak atlanmıştı. Sonuç bir GÖSTERİM değil, para üstü ödemesini
                        // açan/kapatan YETERLİ BAKİYE kapısıydı.
                        var ownCurrency = transactions
                            .Where(x => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.SameCurrency(normCurId, x.CurrencyTypeId))
                            .ToList();

                        var inTry = ownCurrency.Where(x => x.Direction == CashAccountTransactionDirection.In).Sum(x => x.Amount);
                        var outTry = ownCurrency.Where(x => x.Direction == CashAccountTransactionDirection.Out).Sum(x => x.Amount);
                        var inCur = ownCurrency.Where(x => x.Direction == CashAccountTransactionDirection.In).Sum(x => x.CurrencyAmount);
                        var outCur = ownCurrency.Where(x => x.Direction == CashAccountTransactionDirection.Out).Sum(x => x.CurrencyAmount);

                        var cashBalance = carry + (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(normCurId)
                            ? (inTry - outTry)
                            : (inCur - outCur));

                        if (cashBalance < currencyAmount)
                        {
                            await tx.RollbackAsync(cancellationToken);
                            return BadRequest(new { success = false, message = $"Para üstü kasasında yetersiz bakiye! (Kasa Bakiyesi: {cashBalance:N2}, Gereken: {currencyAmount:N2})" });
                        }

                        _dbContext.CashAccountTransactions.Add(new CashAccountTransaction
                        {
                            CashAccountId = changeCashAccountId.Value,
                            Date = invoiceDate,
                            Direction = CashAccountTransactionDirection.Out,
                            Amount = diffTry,
                            CurrencyTypeId = changeCurrencyTypeId,
                            CurrencyRate = currencyRate,
                            CurrencyAmount = currencyAmount,
                            CounterpartyType = CashAccountTransactionCounterpartyType.Customer,
                            CounterpartyCode = customerCode,
                            CounterpartyName = (customer?.Name ?? string.Empty).Trim(),
                            ReferenceType = CashAccountTransactionReferenceType.Invoice,
                            ReferenceId = invoice.Id,
                            Description = $"Para Üstü / Fazlalık Ödeme: {invoice.InvoiceNo}",
                            CreateUser = username,
                            CreateTime = now
                        });

                        _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                        {
                            CustomerCode = customerCode,
                            Date = invoiceDate,
                            DueDate = invoiceDate,
                            Direction = CustomerLedgerEntryDirection.Debit,
                            Amount = diffTry,
                            CurrencyTypeId = customerCurrencyTypeId,
                            CurrencyRate = customerTryRate <= 0 ? 1m : customerTryRate,
                            CurrencyAmount = diffTry / (customerTryRate > 0 ? customerTryRate : 1m),
                            PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(changeCurrencyTypeId) ? 1 : changeCurrencyTypeId,
                            PaymentCurrencyRate = currencyRate,
                            PaymentCurrencyAmount = currencyAmount,
                            DocumentNo = invoice.InvoiceNo,
                            Description = "Para Üstü",
                            TransactionType = "Kasa",
                            DeliveryCustomerCode = deliveryCustomerCode,
                            ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                            ReferenceId = invoice.Id,
                            CreateUser = username,
                            CreateTime = now
                        });

                        await _dbContext.SaveChangesAsync(cancellationToken);
                    }

                    if (changeBankAccountDefinitionId is not null)
                    {
                        var bank = await _dbContext.BankAccountDefinitions
                            .AsNoTracking()
                            .Select(x => new { x.Id, x.CurrencyTypeId, x.AccountCode, x.AccountName, x.Budget })
                            .FirstOrDefaultAsync(x => x.Id == changeBankAccountDefinitionId.Value, cancellationToken);

                        if (bank is null)
                        {
                            await tx.RollbackAsync(cancellationToken);
                            return BadRequest(new { success = false, message = "Fazlalık banka hesabı bulunamadı" });
                        }

                        var changeCurrencyTypeId = bank.CurrencyTypeId;
                        var currencyRate = (request.ChangeCurrencyRate.HasValue && request.ChangeCurrencyRate.Value > 0) ? request.ChangeCurrencyRate.Value : 1m;
                        var currencyAmount = diffTry;
                        if (request.ChangeCurrencyRate.GetValueOrDefault() <= 0m && !B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(changeCurrencyTypeId))
                        {
                            var changeCode = MapCurrencyTypeIdToCode(changeCurrencyTypeId);
                            if (string.IsNullOrWhiteSpace(changeCode))
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return BadRequest(new { success = false, message = "Geçersiz para birimi" });
                            }

                            try
                            {
                                currencyRate = await _money.GetLatestTryRateAsync(changeCode, cancellationToken);
                            }
                            catch
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                            }

                            if (currencyRate <= 0)
                            {
                                await tx.RollbackAsync(cancellationToken);
                                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
                            }
                        }

                        if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(changeCurrencyTypeId))
                        {
                            currencyAmount = diffTry / currencyRate;
                        }

                        // Calculate bank account balance in its currency
                        var normBankCurId = bank.CurrencyTypeId;
                        var sums = await _dbContext.BankAccountTransactions
                            .AsNoTracking()
                            .Where(x => x.BankAccountDefinitionId == changeBankAccountDefinitionId.Value)
                            .GroupBy(x => 1)
                            .Select(g => new
                            {
                                InAmount = g.Where(x => x.Direction == BankAccountTransactionDirection.In)
                                    .Sum(x => (decimal?)(normBankCurId == 0 ? x.Amount : (x.CurrencyTypeId == normBankCurId ? x.CurrencyAmount : 0m))) ?? 0m,
                                OutAmount = g.Where(x => x.Direction == BankAccountTransactionDirection.Out)
                                    .Sum(x => (decimal?)(normBankCurId == 0 ? x.Amount : (x.CurrencyTypeId == normBankCurId ? x.CurrencyAmount : 0m))) ?? 0m
                            })
                            .FirstOrDefaultAsync(cancellationToken);

                        var inAmt = sums?.InAmount ?? 0m;
                        var outAmt = sums?.OutAmount ?? 0m;
                        var bankBalance = bank.Budget + (inAmt - outAmt);

                        if (bankBalance < currencyAmount)
                        {
                            await tx.RollbackAsync(cancellationToken);
                            return BadRequest(new { success = false, message = $"Para üstü banka hesabında yetersiz bakiye! (Bakiye: {bankBalance:N2}, Gereken: {currencyAmount:N2})" });
                        }

                        var bankDesc = $"Para Üstü / Fazlalık Ödeme - Satış Faturası: {invoice.InvoiceNo}";

                        _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
                        {
                            BankAccountDefinitionId = changeBankAccountDefinitionId.Value,
                            Date = invoiceDate,
                            Direction = BankAccountTransactionDirection.Out,
                            Amount = diffTry,
                            CurrencyTypeId = changeCurrencyTypeId,
                            CurrencyRate = currencyRate,
                            CurrencyAmount = currencyAmount,
                            CounterpartyType = BankAccountTransactionCounterpartyType.Customer,
                            CounterpartyCode = invoice.CustomerCode,
                            CounterpartyName = (customer?.Name ?? string.Empty).Trim(),
                            DocumentNo = invoice.InvoiceNo,
                            Description = bankDesc,
                            IsPosFee = false,
                            CreateUser = username,
                            CreateTime = now
                        });

                        _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                        {
                            CustomerCode = customerCode,
                            Date = invoiceDate,
                            DueDate = invoiceDate,
                            Direction = CustomerLedgerEntryDirection.Debit,
                            Amount = diffTry,
                            CurrencyTypeId = customerCurrencyTypeId,
                            CurrencyRate = customerTryRate <= 0 ? 1m : customerTryRate,
                            CurrencyAmount = diffTry / (customerTryRate > 0 ? customerTryRate : 1m),
                            PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(changeCurrencyTypeId) ? 1 : changeCurrencyTypeId,
                            PaymentCurrencyRate = currencyRate,
                            PaymentCurrencyAmount = currencyAmount,
                            DocumentNo = invoice.InvoiceNo,
                            Description = "Para Üstü",
                            TransactionType = "Banka",
                            DeliveryCustomerCode = deliveryCustomerCode,
                            ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                            ReferenceId = invoice.Id,
                            CreateUser = username,
                            CreateTime = now
                        });

                        await _dbContext.SaveChangesAsync(cancellationToken);
                    }
                }
            }
        }

        var billableLines = invoiceLines
            .Where(x => !x.SalesOrderLineId.HasValue || !consignmentOrderLineIds.Contains(x.SalesOrderLineId.Value))
            .ToList();

        // `Product.Stock` (genel adet) hâlâ depo bağımsız; oradaki düşüm için toplam gerekiyor.
        var requiredByStockCode = billableLines
            .GroupBy(x => x.StockCode)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Quantity));

        // STOK KONTROLÜ ARTIK DEPO BAZINDA.
        //
        // Eskiden bütün kalemler faturanın tek deposundan sorgulanıyordu. Kalemler farklı
        // depolardan çıkabildiği için o hesap iki yönden de yanlış sonuç verirdi: araç deposunda
        // olan parça merkez deposunda yok diye fatura reddedilir, ya da tersi — merkez deposunda
        // olan parça araç deposundan eksiye düşürülerek satılırdı.
        var requiredByWarehouse = billableLines
            .GroupBy(x => new { Warehouse = x.WarehouseCode ?? warehouseCode, x.StockCode })
            .ToDictionary(g => (g.Key.Warehouse, g.Key.StockCode), g => g.Sum(x => x.Quantity));

        if (requiredByWarehouse.Count > 0)
        {
            var involvedWarehouseCodes = requiredByWarehouse.Keys.Select(k => k.Warehouse).Distinct().ToList();
            var involvedStockCodes = requiredByWarehouse.Keys.Select(k => k.StockCode).Distinct().ToList();

            // Eksi bakiye kontrolü DEPONUN kendi ayarı; her depoyu kendi bayrağıyla değerlendir.
            var negativeControlByWarehouse = await _dbContext.Set<Warehouse>()
                .AsNoTracking()
                .Where(x => involvedWarehouseCodes.Contains(x.WarehouseCode))
                .Select(x => new { x.WarehouseCode, x.NegativeBalanceControl, x.Name })
                .ToListAsync(cancellationToken);

            var balances = await _dbContext.Set<StockMovement>()
                .AsNoTracking()
                .Where(x => involvedWarehouseCodes.Contains(x.WarehouseCode) && involvedStockCodes.Contains(x.StockCode))
                .GroupBy(x => new { x.WarehouseCode, x.StockCode })
                .Select(g => new
                {
                    g.Key.WarehouseCode,
                    g.Key.StockCode,
                    InQty = g.Where(x => x.Direction == StockMovementDirection.In).Sum(x => x.Quantity),
                    OutQty = g.Where(x => x.Direction == StockMovementDirection.Out).Sum(x => x.Quantity)
                })
                .ToListAsync(cancellationToken);

            var balanceByKey = balances.ToDictionary(x => (x.WarehouseCode, x.StockCode), x => x.InQty - x.OutQty);

            foreach (var kvp in requiredByWarehouse)
            {
                var whCode = kvp.Key.Warehouse;
                var stockCode = kvp.Key.StockCode;
                var reqQty = kvp.Value;
                var whInfo = negativeControlByWarehouse.FirstOrDefault(x => x.WarehouseCode == whCode);
                if (whInfo is null || !whInfo.NegativeBalanceControl) continue;

                var balance = balanceByKey.TryGetValue((whCode, stockCode), out var b) ? b : 0m;
                if (balance < reqQty)
                {
                    await tx.RollbackAsync(cancellationToken);
                    return BadRequest(new
                    {
                        success = false,
                        message = $"Depo stok yetersiz: {stockCode} — {whInfo.Name} ({whCode}) deposunda {balance} adet var, {reqQty} adet isteniyor."
                    });
                }
            }
        }

        await CreateSalesInvoiceStockMovements(invoice, invoiceLines, discount, subtotal, warehouseCode, consignmentOrderLineIds, cancellationToken);

        if (requiredByStockCode.Count > 0)
        {
            var stockCodes = requiredByStockCode.Keys.ToList();
            var products = await _dbContext.Products
                .Where(x => stockCodes.Contains(x.StockCode))
                .ToListAsync(cancellationToken);

            foreach (var p in products)
            {
                if (!requiredByStockCode.TryGetValue(p.StockCode, out var reqQty)) continue;
                // Hizmet kartı (MONTAJ-BEDELI vb.) envanter tutmaz; genel stok sayacına dokunma.
                if (B2B.Erp.Api.Core.Accounting.InvoiceLineNatureResolver.IsServiceProductType(p.ProductType)) continue;
                var deltaInt = (int)Math.Round(reqQty, MidpointRounding.AwayFromZero);
                if (deltaInt <= 0) continue;
                // STOK EKSİYE DÜŞEBİLİR (2026-08-20 kullanıcı kararı, denetim md. A5).
                //
                // Değer `next < 0 ? 0 : next` ile sessizce sıfıra çekiliyordu: depoda
                // olmayan mal satıldığında bu ekranda hiç görünmüyor, aşırı satış
                // gizleniyordu. Kullanıcı kararı: "depolarda eksiye düşebilir" —
                // gerçek değer yazılıyor, kırpma yok. Stoksuz satışı ENGELLEYEN kural
                // ayrı ve yerinde duruyor (deponun `NegativeBalanceControl` ayarı +
                // `invoice/stokYokSiparis` yetkisi); burası yalnızca sonucu yazar.
                var next = p.Stock - deltaInt;
                p.Stock = next;
            }
        }

        // Handle consignment return movements and Product.Stock updates
        foreach (var line in invoiceLines)
        {
            if (line.SalesOrderLineId.HasValue && consignmentOrderLineIds.Contains(line.SalesOrderLineId.Value))
            {
                var soLine = lineMap[line.SalesOrderLineId.Value];
                var irs = relatedIrsaliyes.FirstOrDefault(x => x.TransferredSalesOrderId == soLine.OrderId && x.Product != null && x.Product.StockCode == soLine.StockCode);
                if (irs != null && irs.ShippedQuantity.HasValue)
                {
                    var product = await _dbContext.Products
                        .FirstOrDefaultAsync(p => p.StockCode == line.StockCode, cancellationToken);

                    // Find original dispatch warehouse
                    var originalDispatch = await _dbContext.Set<StockMovement>()
                        .AsNoTracking()
                        .FirstOrDefaultAsync(x => x.InvoiceNo == "KONS-" + irs.IrsaliyeNo && x.StockCode == line.StockCode && x.Direction == StockMovementDirection.Out, cancellationToken);
                    var originalWarehouseCode = originalDispatch?.WarehouseCode ?? warehouseCode;

                    var alreadyInvoiced = existingInvoicedMap.TryGetValue(line.SalesOrderLineId.Value, out var val) ? val : 0m;

                    var existingReturn = await _dbContext.Set<StockMovement>()
                        .FirstOrDefaultAsync(x => x.InvoiceNo == "KONS-IADE-" + irs.IrsaliyeNo && x.StockCode == line.StockCode && x.Direction == StockMovementDirection.In, cancellationToken);

                    var previousReturnedQty = existingReturn?.Quantity ?? 0m;
                    var totalInvoiced = alreadyInvoiced + line.Quantity;
                    var newReturnedQty = irs.ShippedQuantity.Value - totalInvoiced;

                    if (existingReturn != null)
                    {
                        _dbContext.Set<StockMovement>().Remove(existingReturn);
                    }

                    if (newReturnedQty > 0)
                    {
                        var returnMovement = new StockMovement
                        {
                            InvoiceNo = "KONS-IADE-" + irs.IrsaliyeNo,
                            CustomerCode = invoice.CustomerCode ?? string.Empty,
                            DeliveryCustomerCode = invoice.DeliveryCustomerCode ?? string.Empty,
                            StockCode = line.StockCode,
                            Direction = StockMovementDirection.In,
                            Quantity = newReturnedQty,
                            UnitPrice = 0,
                            NetUnitPrice = 0,
                            VatRate = line.VatRate,
                            Delivered = true,
                            Date = _clock.TodayAsDocumentDate(),
                            WarehouseCode = originalWarehouseCode,
                            LineNo = 1,
                            CreateUser = username,
                            CreateTime = now
                        };
                        _dbContext.Set<StockMovement>().Add(returnMovement);
                    }

                    var stockChange = (int)Math.Round(newReturnedQty - previousReturnedQty, MidpointRounding.AwayFromZero);
                    if (stockChange != 0 && product != null)
                    {
                        product.Stock += stockChange;
                    }
                }
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        await _userActivityLogger.LogAsync(
            "invoice",
            "faturaDokum",
            "Aktarma",
            $"Sipariş/İrsaliye fatura dökümüne aktarıldı (Fatura No: {invoice.InvoiceNo}, Cari: {invoice.CustomerCode}).",
            invoice.Id.ToString(),
            new { invoiceId = invoice.Id, invoiceNo = invoice.InvoiceNo },
            cancellationToken);

        // Notify Service Ops for installable products
        await NotifyServiceOpsForInstallations(invoice, invoiceLines, cancellationToken);

        // E-ticaret siparişinin teslimatı da fatura anında ServiceOps'a düşer.
        await NotifyServiceOpsForEcommerceDeliveryAsync(invoice, invoiceLines, cancellationToken);

        return Ok(new { success = true, data = new { id = invoice.Id, invoiceNo = invoice.InvoiceNo } });
    }

    [HttpPost("create-direct-vehicle-sale")]
    [AuthorizePage("invoice", "satisFatura")]
    public async Task<IActionResult> CreateDirectVehicleSale(
        [FromBody] CreateDirectVehicleSaleRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var paymentMethod = (request.PaymentMethod ?? string.Empty).Trim();
        if (!string.Equals(paymentMethod, "Cash", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(paymentMethod, "Bank", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(paymentMethod, "OpenAccount", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { success = false, message = "Geçersiz ödeme tipi. Seçenekler: Cash, Bank, OpenAccount" });
        }

        if ((string.Equals(paymentMethod, "Cash", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(paymentMethod, "Bank", StringComparison.OrdinalIgnoreCase)) &&
            (!request.AccountId.HasValue || request.AccountId.Value <= 0))
        {
            return BadRequest(new { success = false, message = "Nakit veya banka satışı için kasa/banka hesabı seçilmelidir" });
        }

        var warehouseCode = request.WarehouseCode;
        if (warehouseCode <= 0)
        {
            return BadRequest(new { success = false, message = "Geçersiz depo kodu" });
        }

        // 1. Verify Warehouse and Access
        var warehouse = await _dbContext.Set<Warehouse>()
            .FirstOrDefaultAsync(x => x.WarehouseCode == warehouseCode && x.IsActive, cancellationToken);

        if (warehouse is null)
        {
            return BadRequest(new { success = false, message = "Depo bulunamadı veya aktif değil" });
        }

        if (!warehouse.IsVehicle)
        {
            return BadRequest(new { success = false, message = "Seçilen depo bir araç deposu değildir" });
        }

        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!isSuperAdmin)
        {
            if (!int.TryParse(userIdClaim, out var userId) || userId <= 0)
            {
                return BadRequest(new { success = false, message = "Kullanıcı bulunamadı" });
            }

            var allowed = await _dbContext.UserWarehouses
                .AsNoTracking()
                .AnyAsync(x => x.UserId == userId && x.WarehouseCode == warehouseCode, cancellationToken);

            if (!allowed)
            {
                return BadRequest(new { success = false, message = "Bu araç deposu için yetkiniz yok" });
            }
        }

        // 2. Verify Customer
        var customerCode = (request.CustomerCode ?? string.Empty).Trim();
        var customer = await _dbContext.Customers
            .Include(x => x.PriceGroupEntity)
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode && x.IsActive, cancellationToken);

        if (customer is null)
        {
            return BadRequest(new { success = false, message = "Müşteri bulunamadı veya aktif değil" });
        }

        // BELGENİN PARA BİRİMİ KALEMLERDEN GELİR (2026-08-17).
        // Burada eskiden CARİNİN kartındaki para birimi okunuyordu: dolarla satılan ürün,
        // cari kartı EUR ise EUR faturaya dönüşüyordu. Cari kartındaki döviz alanı kaldırıldı;
        // bir cariye her para biriminde satış yapılabiliyor. Değerler kalemler kurulduktan
        // sonra (aşağıda, fatura oluşturmadan hemen önce) çözülüyor.
        var documentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try;
        var documentTryRate = 1m;

        var deliveryCustomerCode = string.IsNullOrWhiteSpace(request.DeliveryCustomerCode)
            ? customerCode
            : request.DeliveryCustomerCode.Trim();

        var customerInvoiceTypeNormalized = (customer.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
        // ASKERIYE AYRI TESPIT EDILIR: asagidaki `isOpenCustomer` yalnizca ACIK metnine
        // bakiyordu, muaf cari bu ucta "FATURA" damgasi aliyordu (A00000000071311 boyle
        // olustu). Damga belgenin niteligidir; muaf satis kayitta muaf gorunmeli.
        var isAskeriyeCustomer = customerInvoiceTypeNormalized == "ASKERIYE"
                                 || customerInvoiceTypeNormalized == "ASKERİYE"
                                 || customerInvoiceTypeNormalized == "MUAF";
        var isOpenCustomer = isAskeriyeCustomer
                             || customerInvoiceTypeNormalized == "ACIK"
                             || customerInvoiceTypeNormalized == "AÇIK"
                             || customerInvoiceTypeNormalized.Contains("ACIK")
                             || customerInvoiceTypeNormalized.Contains("AÇIK");

        // 3. Generate Invoice Number (invoiceNo)
        string serie;
        if (isOpenCustomer)
        {
            serie = "1";
        }
        else
        {
            serie = string.IsNullOrWhiteSpace(request.InvoiceSerie) ? "A" : request.InvoiceSerie.Trim();
            if (serie.Length != 1)
            {
                return BadRequest(new { success = false, message = "Fatura serisi 1 karakter olmalıdır" });
            }
        }

        string invoiceNo;
        if (request.InvoiceNumber.HasValue)
        {
            invoiceNo = serie + request.InvoiceNumber.Value.ToString().PadLeft(14, '0');
        }
        else
        {
            var existing = await _dbContext.Set<Invoice>()
                .AsNoTracking()
                .Where(x => x.InvoiceNo.StartsWith(serie) && x.InvoiceNo.Length == 15)
                .Select(x => x.InvoiceNo)
                .ToListAsync(cancellationToken);

            long max = -1;
            foreach (var invNo in existing)
            {
                if (string.IsNullOrWhiteSpace(invNo) || invNo.Length != 15) continue;
                var tail = invNo.Substring(1);
                if (long.TryParse(tail, out var n))
                {
                    if (n > max) max = n;
                }
            }

            var next = max + 1;
            invoiceNo = serie + next.ToString().PadLeft(14, '0');
        }

        var invoiceExists = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .AnyAsync(x => x.InvoiceNo == invoiceNo, cancellationToken);

        if (invoiceExists)
        {
            return Conflict(new { success = false, message = $"Fatura no zaten mevcut: {invoiceNo}" });
        }

        // 4. Load Products and Verify Stock/Price
        var requestedLines = request.Lines ?? new();
        if (requestedLines.Count == 0)
        {
            return BadRequest(new { success = false, message = "En az 1 satır seçmelisiniz" });
        }

        if (requestedLines.Count > 17)
        {
            return BadRequest(new { success = false, message = "En fazla 17 kalem faturalaştırabilirsiniz." });
        }

        var stockCodes = requestedLines.Select(x => x.StockCode.Trim()).Distinct().ToList();
        var products = await _dbContext.Products
            .Include(x => x.ProductPrices)
            .Where(x => stockCodes.Contains(x.StockCode) && x.IsActive)
            .ToListAsync(cancellationToken);

        var productByStockCode = products.ToDictionary(x => x.StockCode, x => x, StringComparer.OrdinalIgnoreCase);
        foreach (var sc in stockCodes)
        {
            if (!productByStockCode.ContainsKey(sc))
            {
                return BadRequest(new { success = false, message = $"Ürün bulunamadı veya aktif değil: {sc}" });
            }
        }

        // Load exchange rates and resolve base prices
        var tryRateCache = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
        {
            { "TRY", 1m }
        };

        var basePricesByStockCode = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        var baseCurrencyByStockCode = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var priceGroupId = customer.PriceGroupId;
        if (!priceGroupId.HasValue)
        {
            return BadRequest(new { success = false, message = "Müşterinin fiyat grubu tanımlı değil" });
        }

        int? directPgCode = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(pg => pg.Id == priceGroupId.Value)
            .Select(pg => (int?)pg.Code)
            .FirstOrDefaultAsync(cancellationToken);

        var isDirectNoVatCustomer = (
            (customer.InvoiceType != null && (customer.InvoiceType.Equals("ACIK", StringComparison.OrdinalIgnoreCase) || customer.InvoiceType.Equals("AÇIK", StringComparison.OrdinalIgnoreCase) || customer.InvoiceType.Equals("ASKERIYE", StringComparison.OrdinalIgnoreCase) || customer.InvoiceType.Equals("ASKERİYE", StringComparison.OrdinalIgnoreCase))) ||
            (directPgCode.HasValue && directPgCode.Value >= 4 && directPgCode.Value <= 7)
        );

        // Şubede özel fiyat BAĞLI CARİDEN okunur; bkz. CustomerPriceOwner.
        var overrideCustomerCode = await Core.Helpers.CustomerPriceOwner.ResolveAsync(
            _dbContext, customerCode, cancellationToken);

        foreach (var sc in stockCodes)
        {
            var product = productByStockCode[sc];
            decimal price = 0m;
            string currency = "TRY";

            var overridePrice = await _dbContext.CustomerProductPriceOverrides
                .AsNoTracking()
                .Where(x => x.IsActive)
                .Where(x => x.CustomerCode == overrideCustomerCode)
                .Where(x => x.ProductId == product.Id)
                .Where(x => x.PriceGroupId == priceGroupId.Value)
                .FirstOrDefaultAsync(cancellationToken);

            if (overridePrice is not null)
            {
                price = overridePrice.Price;
                currency = (overridePrice.Currency ?? "TRY").Trim();
            }
            else
            {
                var pgPrice = product.ProductPrices
                    .Where(x => x.PriceGroupId == priceGroupId.Value)
                    .OrderBy(x => x.Price)
                    .FirstOrDefault();

                if (pgPrice is not null)
                {
                    price = pgPrice.Price;
                    currency = (pgPrice.Currency ?? "TRY").Trim();
                }
            }

            if (price <= 0m)
            {
                return BadRequest(new { success = false, message = $"Ürünün fiyatı tanımlanmamış veya geçersiz: {sc}" });
            }

            basePricesByStockCode[sc] = price;
            baseCurrencyByStockCode[sc] = currency;
        }

        // Convert all prices to TRY
        var evalLines = new List<Dtos.Campaigns.EvaluateSalesOrderLineRequest>();
        foreach (var line in requestedLines)
        {
            var sc = line.StockCode.Trim();
            var product = productByStockCode[sc];
            var currency = baseCurrencyByStockCode[sc];
            var price = basePricesByStockCode[sc];

            if (!tryRateCache.TryGetValue(currency, out var rate))
            {
                try
                {
                    rate = await _money.GetLatestTryRateAsync(currency, cancellationToken);
                }
                catch
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = $"Döviz kuru alınamadı ({currency}). Lütfen daha sonra deneyin." });
                }

                if (rate <= 0m) rate = 1m;
                tryRateCache[currency] = rate;
            }

            var priceTry = price * rate;

            evalLines.Add(new Dtos.Campaigns.EvaluateSalesOrderLineRequest
            {
                StockCode = product.StockCode,
                Quantity = line.Quantity,
                UnitPrice = priceTry,
                VatRate = isDirectNoVatCustomer ? 0m : product.TaxRate
            });
        }

        // 5. Evaluate Campaigns
        var evalRequest = new Dtos.Campaigns.EvaluateSalesOrderRequest
        {
            CustomerCode = customerCode,
            Lines = evalLines
        };

        var eval = await _campaignService.EvaluateSalesOrder(evalRequest, cancellationToken);

        // Gather all required quantities (including gift items!)
        var requiredByStockCode = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in eval.Lines)
        {
            if (requiredByStockCode.ContainsKey(line.StockCode))
            {
                requiredByStockCode[line.StockCode] += line.Quantity;
            }
            else
            {
                requiredByStockCode[line.StockCode] = line.Quantity;
            }
        }

        // Make sure all products (including gifts) are loaded and active
        var allStockCodes = requiredByStockCode.Keys.ToList();
        var allProducts = await _dbContext.Products
            .Where(x => allStockCodes.Contains(x.StockCode) && x.IsActive)
            .ToListAsync(cancellationToken);

        var allProductByStockCode = allProducts.ToDictionary(x => x.StockCode, x => x, StringComparer.OrdinalIgnoreCase);
        foreach (var sc in allStockCodes)
        {
            if (!allProductByStockCode.ContainsKey(sc))
            {
                return BadRequest(new { success = false, message = $"Kampanya sonucu eklenen hediye/promosyon ürünü bulunamadı veya aktif değil: {sc}" });
            }
        }

        var now = DateTime.UtcNow;
        var username = User.Identity?.Name ?? "System";

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        // 6. Enforce Negative Stock Control
        if (requiredByStockCode.Count > 0)
        {
            var balances = await _dbContext.Set<StockMovement>()
                .AsNoTracking()
                .Where(x => x.WarehouseCode == warehouseCode && allStockCodes.Contains(x.StockCode))
                .GroupBy(x => x.StockCode)
                .Select(g => new
                {
                    StockCode = g.Key,
                    InQty = g.Where(x => x.Direction == StockMovementDirection.In).Sum(x => x.Quantity),
                    OutQty = g.Where(x => x.Direction == StockMovementDirection.Out).Sum(x => x.Quantity)
                })
                .ToListAsync(cancellationToken);

            var balanceByCode = balances.ToDictionary(x => x.StockCode, x => x.InQty - x.OutQty, StringComparer.OrdinalIgnoreCase);
            foreach (var (stockCode, reqQty) in requiredByStockCode)
            {
                var balance = balanceByCode.TryGetValue(stockCode, out var b) ? b : 0m;
                if (warehouse.NegativeBalanceControl && balance < reqQty)
                {
                    await tx.RollbackAsync(cancellationToken);
                    return BadRequest(new { success = false, message = $"Depo stok yetersiz: {stockCode} (Mevcut: {balance}, İstenen: {reqQty})" });
                }
            }
        }

        // 7. Create SalesOrder
        var siparisNo = "S" + DateTime.UtcNow.ToString("yyMMddHHmmssff");
        var campaignDetailsJson = JsonSerializer.Serialize(new
        {
            appliedCampaignIds = eval.AppliedCampaignIds,
            appliedPriceGroupId = eval.AppliedPriceGroupId,
            lines = eval.Lines,
            appliedCampaignDetails = eval.AppliedCampaignDetails
        });

        var directTaxTotal = isDirectNoVatCustomer ? 0m : eval.TaxTotal;
        var directGrandTotal = eval.Subtotal - eval.DiscountTotal + directTaxTotal;
        if (directGrandTotal < 0m) directGrandTotal = 0m;

        var order = new SalesOrder
        {
            CustomerCode = customerCode,
            DeliveryCustomerCode = deliveryCustomerCode,
            Subtotal = eval.Subtotal,
            VatTotal = directTaxTotal,
            GrandTotal = directGrandTotal,
            CampaignDiscount = eval.DiscountTotal,
            CampaignDetailsJson = campaignDetailsJson,
            Status = 1, // Immediately closed/billed
            OrderNo = siparisNo,
            ProcessedBy = username,
            ProcessedAt = now,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.Set<SalesOrder>().Add(order);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Add SalesOrderLines
        var lineNo = 1;
        var salesOrderLines = new List<SalesOrderLine>();

        foreach (var l in eval.Lines)
        {
            var product = allProductByStockCode[l.StockCode];
            var baseCurrency = baseCurrencyByStockCode.TryGetValue(l.StockCode, out var bc) ? bc : "TRY";
            var basePrice = basePricesByStockCode.TryGetValue(l.StockCode, out var bp) ? bp : 0m;

            // ESKİ KODLAMA KALINTISI DÜZELTİLDİ: burada "USD" => 1 ve "GBP" => 3 yazıyordu.
            // Sistemin kodlaması 1=TRY 2=EUR 3=USD 4=GBP olduğu için dolarla satılan bir ürün
            // satıra TL (1) olarak, sterlin ise DOLAR (3) olarak damgalanıyordu — üstelik
            // `CurrencyUnitPrice` gerçek döviz tutarı, `CurrencyRate` de gerçek kur olduğu için
            // satır kendi içinde tutarsız kalıyor ve fatura satırına da öyle kopyalanıyordu.
            // Metinden koda çeviri tek kaynaktan yapılmalı.
            var currencyTypeId = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper
                .MapCurrencyStringToCurrencyTypeId(baseCurrency);
            var rate = tryRateCache.TryGetValue(baseCurrency, out var r) ? r : 1m;

            var sol = new SalesOrderLine
            {
                SalesOrderId = order.Id,
                StockCode = l.StockCode,
                Description = product.Name,
                Quantity = l.Quantity,
                UnitPrice = l.IsGift ? 0.01m : l.UnitPrice,
                CurrencyTypeId = currencyTypeId,
                CurrencyRate = rate,
                CurrencyUnitPrice = l.IsGift ? 0.01m : basePrice,
                VatRate = l.IsGift ? 0m : l.VatRate,
                IsGift = l.IsGift,
                DiscountAmount = l.IsGift ? 0m : l.DiscountAmount,
                LineNo = lineNo++,
                CampaignCode = null,
                Montage = false,
                GroupId = null,
                OrderNo = siparisNo,
                CreateUser = username,
                CreateTime = now
            };

            salesOrderLines.Add(sol);
        }

        _dbContext.Set<SalesOrderLine>().AddRange(salesOrderLines);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Map lines
        var lineIndex = 0;
        var invoiceLines = salesOrderLines.Select(sol => new InvoiceLine
        {
            SalesOrderLineId = sol.Id,
            StockCode = sol.StockCode,
            Description = sol.Description,
            Quantity = sol.Quantity,
            UnitPrice = sol.UnitPrice,
            CurrencyTypeId = sol.CurrencyTypeId,
            CurrencyRate = sol.CurrencyRate,
            CurrencyUnitPrice = sol.CurrencyUnitPrice,
            VatRate = sol.VatRate,
            LineNo = ++lineIndex,
            CreateUser = username,
            CreateTime = now
        }).ToList();

        // Belgenin para birimi: kalemlerin (hediye olmayan) para birimi. Sepet tek para
        // birimli olduğu için kalemler zaten tek para biriminde; yine de ilk dövizli kalem
        // esas alınır, hiç yoksa TL. Kur da o kalemin DONMUŞ kurudur — canlı kur çekilmez.
        var currencyLine = salesOrderLines
            .FirstOrDefault(x => !x.IsGift && x.CurrencyTypeId > B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try);
        if (currencyLine != null)
        {
            documentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(currencyLine.CurrencyTypeId);
            documentTryRate = currencyLine.CurrencyRate > 0m ? currencyLine.CurrencyRate : 1m;
        }

        // 8. Create Invoice
        var invoice = new Invoice
        {
            Type = InvoiceType.SalesInvoice,
            InvoiceNo = invoiceNo,
            CustomerCode = customerCode,
            // Askeriye ONCE: `isOpenCustomer` yalnizca ACIK'a bakiyor, muaf cari buradan
            // "FATURA" damgasi aliyordu (fatura A00000000071311 boyle olustu).
            CustomerInvoiceTypeOverride = isAskeriyeCustomer ? "ASKERIYE" : (isOpenCustomer ? "ACIK" : "FATURA"),
            DeliveryCustomerCode = deliveryCustomerCode,
            Date = now,
            VatIncluded = false,
            Subtotal = eval.Subtotal,
            Discount = 0m,
            NetTotal = eval.Subtotal - eval.DiscountTotal,
            VatTotal = eval.TaxTotal,
            GrandTotal = eval.GrandTotal,
            CampaignDiscount = eval.DiscountTotal,
            CampaignDetailsJson = campaignDetailsJson,
            SalesmanCode = customer.SalesmanCode ?? warehouse.SalesmanCode,
            Description = $"Mobil Araç Satışı: {invoiceNo}",
            // Para birimi ve fatura anındaki kur başlıkta dondurulur (2026-08-14).
            // Para birimi KALEMLERDEN gelir (2026-08-17); carinin kartına bakılmaz —
            // aşağıdaki cari hareketi de aynı para birimini ve kuru kullanıyor.
            CurrencyTypeId = documentCurrencyTypeId <= 1 ? 0 : documentCurrencyTypeId,
            ExchangeRate = documentCurrencyTypeId <= 1 ? 1m : (documentTryRate <= 0 ? 1m : documentTryRate),
            RateSource = documentCurrencyTypeId <= 1 ? null : "TCMB",
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.Set<Invoice>().Add(invoice);
        await _dbContext.SaveChangesAsync(cancellationToken);

        foreach (var il in invoiceLines)
        {
            il.InvoiceId = invoice.Id;
        }
        _dbContext.Set<InvoiceLine>().AddRange(invoiceLines);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 9. Stock Movements
        var movements = invoiceLines.Select(l => {
            var matchingSol = salesOrderLines.FirstOrDefault(sol => sol.Id == l.SalesOrderLineId);
            var discountAmount = matchingSol?.DiscountAmount ?? 0m;
            var netUnitPrice = l.UnitPrice - (l.Quantity > 0 ? discountAmount / l.Quantity : 0m);

            return new StockMovement
            {
                InvoiceNo = invoiceNo,
                CustomerCode = customerCode,
                DeliveryCustomerCode = deliveryCustomerCode,
                StockCode = l.StockCode,
                Direction = StockMovementDirection.Out,
                Quantity = l.Quantity,
                UnitPrice = l.UnitPrice,
                // Stok hareketi TL çapası tutar; belgenin kendi parası ayrı kolonlarda
                // (2026-08-19). Öncesinde tabloda para birimi hiç yoktu ve ürün satış /
                // stok raporları dolarlı satışı TL satıştan ayırt edemiyordu.
                CurrencyTypeId = l.CurrencyTypeId,
                CurrencyRate = l.CurrencyRate <= 0m ? 1m : l.CurrencyRate,
                CurrencyUnitPrice = l.CurrencyUnitPrice > 0m ? l.CurrencyUnitPrice : l.UnitPrice,
                NetUnitPrice = netUnitPrice,
                VatRate = l.VatRate,
                BagNo = string.Empty,
                SalesmanCode = invoice.SalesmanCode,
                WarehouseCode = warehouseCode,
                Delivered = true,
                Date = now,
                LineNo = l.LineNo,
                CreateUser = username,
                CreateTime = now
            };
        }).ToList();

        _dbContext.Set<StockMovement>().AddRange(movements);

        // Decrement global stock counts on Product entity
        foreach (var p in products)
        {
            if (requiredByStockCode.TryGetValue(p.StockCode, out var reqQty))
            {
                var deltaInt = (int)Math.Round(reqQty, MidpointRounding.AwayFromZero);
                if (deltaInt > 0)
                {
                    // STOK EKSİYE DÜŞEBİLİR (2026-08-20 kullanıcı kararı, denetim md. A5).
                    //
                    // Değer `next < 0 ? 0 : next` ile sessizce sıfıra çekiliyordu: depoda
                    // olmayan mal satıldığında bu ekranda hiç görünmüyor, aşırı satış
                    // gizleniyordu. Kullanıcı kararı: "depolarda eksiye düşebilir" —
                    // gerçek değer yazılıyor, kırpma yok. Stoksuz satışı ENGELLEYEN kural
                    // ayrı ve yerinde duruyor (deponun `NegativeBalanceControl` ayarı +
                    // `invoice/stokYokSiparis` yetkisi); burası yalnızca sonucu yazar.
                    var next = p.Stock - deltaInt;
                    p.Stock = next;
                }
            }
        }

        // 10. Financial/Cari Integration
        // Customer Ledger Entry (Debit)
        _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
        {
            CustomerCode = customerCode,
            Date = now,
            DueDate = now,
            Direction = CustomerLedgerEntryDirection.Debit,
            Amount = invoice.GrandTotal,
            CurrencyTypeId = documentCurrencyTypeId,
            CurrencyRate = documentTryRate <= 0 ? 1m : documentTryRate,
            CurrencyAmount = documentTryRate > 0 ? Math.Round(invoice.GrandTotal / documentTryRate, 4) : invoice.GrandTotal,
            PaymentCurrencyTypeId = documentCurrencyTypeId == 0 ? 1 : documentCurrencyTypeId,
            PaymentCurrencyRate = documentTryRate <= 0 ? 1m : documentTryRate,
            PaymentCurrencyAmount = documentTryRate > 0 ? Math.Round(invoice.GrandTotal / documentTryRate, 4) : invoice.GrandTotal,
            DocumentNo = invoiceNo,
            Description = $"Araç Deposu Satışı: {invoiceNo}",
            TransactionType = "Satış Faturası",
            DeliveryCustomerCode = deliveryCustomerCode,
            ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
            ReferenceId = invoice.Id,
            CreateUser = username,
            CreateTime = now
        });

        // 11. Payment Handling (if Cash or Bank)
        if (string.Equals(paymentMethod, "Cash", StringComparison.OrdinalIgnoreCase))
        {
            var cashAccountId = request.AccountId!.Value;
            var cash = await _dbContext.CashAccounts
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == cashAccountId, cancellationToken);

            if (cash is null)
            {
                await tx.RollbackAsync(cancellationToken);
                return BadRequest(new { success = false, message = "Kasa hesabı bulunamadı" });
            }

            var cashCurrencyTypeId = cash.CurrencyTypeId;
            var cashTryRate = 1m;
            if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId))
            {
                var code = MapCurrencyTypeIdToCode(cashCurrencyTypeId);
                if (string.IsNullOrWhiteSpace(code))
                {
                    await tx.RollbackAsync(cancellationToken);
                    return BadRequest(new { success = false, message = "Geçersiz kasa para birimi" });
                }

                try
                {
                    cashTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                }
                catch
                {
                    await tx.RollbackAsync(cancellationToken);
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı" });
                }
            }

            var cashCurrencyAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId)
                ? invoice.GrandTotal
                : (cashTryRate > 0 ? invoice.GrandTotal / cashTryRate : 0m);

            _dbContext.CashAccountTransactions.Add(new CashAccountTransaction
            {
                CashAccountId = cashAccountId,
                Date = now,
                Direction = CashAccountTransactionDirection.In,
                Amount = invoice.GrandTotal,
                CurrencyTypeId = cashCurrencyTypeId,
                CurrencyRate = cashTryRate,
                CurrencyAmount = cashCurrencyAmount,
                CounterpartyType = CashAccountTransactionCounterpartyType.Customer,
                CounterpartyCode = customerCode,
                CounterpartyName = customer.Name.Trim(),
                ReferenceType = CashAccountTransactionReferenceType.Invoice,
                ReferenceId = invoice.Id,
                Description = $"Satış Faturası: {invoiceNo}",
                CreateUser = username,
                CreateTime = now
            });

            // Offsetting Credit entry
            _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
            {
                CustomerCode = customerCode,
                Date = now,
                DueDate = now,
                Direction = CustomerLedgerEntryDirection.Credit,
                Amount = invoice.GrandTotal,
                CurrencyTypeId = documentCurrencyTypeId,
                CurrencyRate = documentTryRate <= 0 ? 1m : documentTryRate,
                CurrencyAmount = documentTryRate > 0 ? Math.Round(invoice.GrandTotal / documentTryRate, 4) : invoice.GrandTotal,
                PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId) ? 1 : cashCurrencyTypeId,
                PaymentCurrencyRate = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId) ? 1m : cashTryRate,
                PaymentCurrencyAmount = cashCurrencyAmount,
                DocumentNo = invoiceNo,
                Description = $"Kasa Tahsilat ({invoiceNo})",
                TransactionType = "Kasa",
                DeliveryCustomerCode = deliveryCustomerCode,
                ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                ReferenceId = invoice.Id,
                CreateUser = username,
                CreateTime = now
            });
        }
        else if (string.Equals(paymentMethod, "Bank", StringComparison.OrdinalIgnoreCase))
        {
            var bankAccountDefinitionId = request.AccountId!.Value;
            var bank = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == bankAccountDefinitionId, cancellationToken);

            if (bank is null)
            {
                await tx.RollbackAsync(cancellationToken);
                return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });
            }

            var bankCurrencyTypeId = bank.CurrencyTypeId;
            var bankTryRate = 1m;
            if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(bankCurrencyTypeId))
            {
                var code = MapCurrencyTypeIdToCode(bankCurrencyTypeId);
                if (string.IsNullOrWhiteSpace(code))
                {
                    await tx.RollbackAsync(cancellationToken);
                    return BadRequest(new { success = false, message = "Geçersiz banka para birimi" });
                }

                try
                {
                    bankTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                }
                catch
                {
                    await tx.RollbackAsync(cancellationToken);
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı" });
                }
            }

            var bankCurrencyAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(bankCurrencyTypeId)
                ? invoice.GrandTotal
                : (bankTryRate > 0 ? invoice.GrandTotal / bankTryRate : 0m);

            _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
            {
                BankAccountDefinitionId = bankAccountDefinitionId,
                Date = now,
                Direction = BankAccountTransactionDirection.In,
                Amount = invoice.GrandTotal,
                CurrencyTypeId = bankCurrencyTypeId,
                CurrencyRate = bankTryRate,
                CurrencyAmount = bankCurrencyAmount,
                CounterpartyType = BankAccountTransactionCounterpartyType.Customer,
                CounterpartyCode = customerCode,
                CounterpartyName = customer.Name.Trim(),
                DocumentNo = invoiceNo,
                Description = $"Satış Faturası: {invoiceNo}",
                IsPosFee = false,
                CreateUser = username,
                CreateTime = now
            });

            // Offsetting Credit entry
            _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
            {
                CustomerCode = customerCode,
                Date = now,
                DueDate = now,
                Direction = CustomerLedgerEntryDirection.Credit,
                Amount = invoice.GrandTotal,
                CurrencyTypeId = documentCurrencyTypeId,
                CurrencyRate = documentTryRate <= 0 ? 1m : documentTryRate,
                CurrencyAmount = documentTryRate > 0 ? Math.Round(invoice.GrandTotal / documentTryRate, 4) : invoice.GrandTotal,
                PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(bankCurrencyTypeId) ? 1 : bankCurrencyTypeId,
                PaymentCurrencyRate = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(bankCurrencyTypeId) ? 1m : bankTryRate,
                PaymentCurrencyAmount = bankCurrencyAmount,
                DocumentNo = invoiceNo,
                Description = $"Banka Tahsilat ({invoiceNo})",
                TransactionType = "Banka",
                DeliveryCustomerCode = deliveryCustomerCode,
                ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                ReferenceId = invoice.Id,
                CreateUser = username,
                CreateTime = now
            });
        }
        else if (string.Equals(paymentMethod, "OpenAccount", StringComparison.OrdinalIgnoreCase))
        {
            if (request.CashAmount.HasValue && request.CashAmount.Value > 0 && request.AccountId.HasValue && request.AccountId.Value > 0)
            {
                var cashAccountId = request.AccountId.Value;
                var cash = await _dbContext.CashAccounts
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Id == cashAccountId, cancellationToken);

                if (cash is null)
                {
                    await tx.RollbackAsync(cancellationToken);
                    return BadRequest(new { success = false, message = "Kasa hesabı bulunamadı" });
                }

                var cashCurrencyTypeId = cash.CurrencyTypeId;
                var cashTryRate = 1m;
                if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId))
                {
                    var code = MapCurrencyTypeIdToCode(cashCurrencyTypeId);
                    if (string.IsNullOrWhiteSpace(code))
                    {
                        await tx.RollbackAsync(cancellationToken);
                        return BadRequest(new { success = false, message = "Geçersiz kasa para birimi" });
                    }

                    try
                    {
                        cashTryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                    }
                    catch
                    {
                        await tx.RollbackAsync(cancellationToken);
                        return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı" });
                    }
                }

                var cashAmountToPay = request.CashAmount.Value;
                var cashCurrencyAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId)
                    ? cashAmountToPay
                    : (cashTryRate > 0 ? cashAmountToPay / cashTryRate : 0m);

                _dbContext.CashAccountTransactions.Add(new CashAccountTransaction
                {
                    CashAccountId = cashAccountId,
                    Date = now,
                    Direction = CashAccountTransactionDirection.In,
                    Amount = cashAmountToPay,
                    CurrencyTypeId = cashCurrencyTypeId,
                    CurrencyRate = cashTryRate,
                    CurrencyAmount = cashCurrencyAmount,
                    CounterpartyType = CashAccountTransactionCounterpartyType.Customer,
                    CounterpartyCode = customerCode,
                    CounterpartyName = customer.Name.Trim(),
                    ReferenceType = CashAccountTransactionReferenceType.Invoice,
                    ReferenceId = invoice.Id,
                    Description = $"Araç Deposu Satışı - Kısmi Nakit Ödeme ({invoiceNo})",
                    CreateUser = username,
                    CreateTime = now
                });

                // Offsetting Credit entry
                _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                {
                    CustomerCode = customerCode,
                    Date = now,
                    DueDate = now,
                    Direction = CustomerLedgerEntryDirection.Credit,
                    Amount = cashAmountToPay,
                    CurrencyTypeId = documentCurrencyTypeId,
                    CurrencyRate = documentTryRate <= 0 ? 1m : documentTryRate,
                    CurrencyAmount = documentTryRate > 0 ? Math.Round(cashAmountToPay / documentTryRate, 4) : cashAmountToPay,
                    PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId) ? 1 : cashCurrencyTypeId,
                    PaymentCurrencyRate = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(cashCurrencyTypeId) ? 1m : cashTryRate,
                    PaymentCurrencyAmount = cashCurrencyAmount,
                    DocumentNo = invoiceNo,
                    Description = $"Kasa Tahsilat - Kısmi ({invoiceNo})",
                    TransactionType = "Kasa",
                    DeliveryCustomerCode = deliveryCustomerCode,
                    ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                    ReferenceId = invoice.Id,
                    CreateUser = username,
                    CreateTime = now
                });
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            message = "Mobil araç satışı başarıyla tamamlandı",
            data = new
            {
                invoiceId = invoice.Id,
                invoiceNo,
                orderId = order.Id,
                orderNo = siparisNo,
                subtotal = invoice.Subtotal,
                discount = invoice.CampaignDiscount,
                vatTotal = invoice.VatTotal,
                grandTotal = invoice.GrandTotal
            }
        });
    }

    [HttpPost("calculate-direct-sale-prices")]
    [AuthorizePage("invoice", "satisFatura")]
    public async Task<IActionResult> CalculateDirectSalePrices(
        [FromBody] CalculateDirectSalePricesRequest request,
        CancellationToken cancellationToken)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.CustomerCode))
        {
            return BadRequest(new { success = false, message = "Müşteri kodu zorunludur" });
        }

        var customer = await _dbContext.Customers
            .Include(x => x.PriceGroupEntity)
            .FirstOrDefaultAsync(x => x.CustomerCode == request.CustomerCode.Trim() && x.IsActive, cancellationToken);

        if (customer is null)
        {
            return BadRequest(new { success = false, message = "Müşteri bulunamadı veya aktif değil" });
        }

        var priceGroupId = customer.PriceGroupId;
        if (!priceGroupId.HasValue)
        {
            return BadRequest(new { success = false, message = "Müşterinin fiyat grubu tanımlı değil" });
        }

        var stockCodes = request.StockCodes ?? new List<string>();
        if (stockCodes.Count == 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var products = await _dbContext.Products
            .Include(x => x.ProductPrices)
            .Where(x => stockCodes.Contains(x.StockCode) && x.IsActive)
            .ToListAsync(cancellationToken);

        var productByStockCode = products.ToDictionary(x => x.StockCode, x => x, StringComparer.OrdinalIgnoreCase);

        var tryRateCache = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
        {
            { "TRY", 1m }
        };

        var responseList = new List<CalculateDirectSalePricesResponse>();

        // Şubede özel fiyat BAĞLI CARİDEN okunur; bkz. CustomerPriceOwner.
        var overrideCustomerCode = await Core.Helpers.CustomerPriceOwner.ResolveAsync(
            _dbContext, customer.CustomerCode, cancellationToken);

        foreach (var sc in stockCodes)
        {
            if (!productByStockCode.TryGetValue(sc, out var product)) continue;

            decimal price = 0m;
            string currency = "TRY";

            var overridePrice = await _dbContext.CustomerProductPriceOverrides
                .AsNoTracking()
                .Where(x => x.IsActive)
                .Where(x => x.CustomerCode == overrideCustomerCode)
                .Where(x => x.ProductId == product.Id)
                .Where(x => x.PriceGroupId == priceGroupId.Value)
                .FirstOrDefaultAsync(cancellationToken);

            if (overridePrice is not null)
            {
                price = overridePrice.Price;
                currency = (overridePrice.Currency ?? "TRY").Trim();
            }
            else
            {
                var pgPrice = product.ProductPrices
                    .Where(x => x.PriceGroupId == priceGroupId.Value)
                    .OrderBy(x => x.Price)
                    .FirstOrDefault();

                if (pgPrice is not null)
                {
                    price = pgPrice.Price;
                    currency = (pgPrice.Currency ?? "TRY").Trim();
                }
            }

            if (price <= 0m) continue;

            if (!tryRateCache.TryGetValue(currency, out var rate))
            {
                try
                {
                    rate = await _money.GetLatestTryRateAsync(currency, cancellationToken);
                }
                catch
                {
                    rate = 1m;
                }
                tryRateCache[currency] = rate;
            }

            var priceTry = price * rate;

            responseList.Add(new CalculateDirectSalePricesResponse
            {
                StockCode = product.StockCode,
                UnitPrice = price,
                Currency = currency,
                UnitPriceTry = priceTry,
                TaxRate = product.TaxRate
            });
        }

        return Ok(new { success = true, data = responseList });
    }

    [HttpPut("{invoiceId:int}/header")]
    [AuthorizePage("invoice", "faturaDokumUstBilgiGuncelle")]
    public async Task<IActionResult> UpdateInvoiceHeader(
        [FromRoute] int invoiceId,
        [FromBody] UpdateInvoiceHeaderRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var invoice = await _dbContext.Set<Invoice>()
            .FirstOrDefaultAsync(x => x.Id == invoiceId, cancellationToken);

        if (invoice is null)
        {
            return NotFound(new { success = false, message = "Fatura bulunamadı" });
        }

        var newInvoiceNo = request.InvoiceNo is null ? null : request.InvoiceNo.Trim();
        var newCustomerCode = request.CustomerCode is null ? null : request.CustomerCode.Trim();
        var newInvoiceTypeOverride = request.CustomerInvoiceTypeOverride is null ? null : request.CustomerInvoiceTypeOverride.Trim();
        var requestedPriceGroupId = request.PriceGroupId;

        if (newInvoiceNo is not null && string.IsNullOrWhiteSpace(newInvoiceNo)) newInvoiceNo = null;
        if (newCustomerCode is not null && string.IsNullOrWhiteSpace(newCustomerCode)) newCustomerCode = null;
        if (newInvoiceTypeOverride is not null && string.IsNullOrWhiteSpace(newInvoiceTypeOverride)) newInvoiceTypeOverride = null;

        if (newCustomerCode is not null)
        {
            if (invoice.Type == InvoiceType.PurchaseInvoice)
            {
                var exists = await _dbContext.Set<Supplier>()
                    .AsNoTracking()
                    .AnyAsync(x => x.SupplierCode == newCustomerCode, cancellationToken);

                if (!exists)
                {
                    return BadRequest(new { success = false, message = "Geçersiz tedarikçi" });
                }
            }
            else if (invoice.Type == InvoiceType.ServiceInvoice
                     && invoice.SourcePurchaseInvoiceId.HasValue
                     && invoice.SourcePurchaseInvoiceId.Value > 0)
            {
                // Type='H' İKİ ŞEYİ BİRDEN TEMSİL EDER (bkz. [[fatura-niteligi-siniflandirma]]):
                // SourcePurchaseInvoiceId doluysa "Hizmet Alışı" (gider, PurchaseInvoices.Kind=
                // Service'ten türer) — bu dalda CustomerCode gerçekten bir ServiceCatalogItem
                // koduDUR. Kaynak YOKSA "Tamir Faturası"dır (servis geliri, ServiceOps'tan gelen
                // arıza/tamir işi, GERÇEK bir cariye kesilir — bkz. isHizmetAlisi/isTamirFaturasi
                // ayrımı ~satır 6928) ve aşağıdaki normal cari doğrulamasına düşmelidir. Bu ayrım
                // yokken her Tamir Faturası'nın üst bilgisi "Geçersiz hizmet" ile reddediliyordu
                // (2026-09-10, canlı kanıt: fatura 1386, cari 120-03-002097-2).
                var exists = await _dbContext.Set<ServiceCatalogItem>()
                    .AsNoTracking()
                    .AnyAsync(x => x.Code == newCustomerCode, cancellationToken);

                if (!exists)
                {
                    return BadRequest(new { success = false, message = "Geçersiz hizmet" });
                }
            }
            else
            {
                var exists = await _dbContext.Customers
                    .AsNoTracking()
                    .AnyAsync(x => x.CustomerCode == newCustomerCode, cancellationToken);

                if (!exists)
                {
                    return BadRequest(new { success = false, message = "Geçersiz cari" });
                }
            }
        }

        if (newInvoiceNo is not null)
        {
            var exists = await _dbContext.Set<Invoice>()
                .AsNoTracking()
                .AnyAsync(x => x.InvoiceNo == newInvoiceNo && x.Id != invoice.Id, cancellationToken);

            if (exists)
            {
                return Conflict(new { success = false, message = "Fatura no zaten mevcut" });
            }
        }

        var previousInvoiceNo = invoice.InvoiceNo;
        var previousCustomerCode = invoice.CustomerCode;
        var shouldUpdateInvoiceNo = newInvoiceNo is not null && !string.Equals(previousInvoiceNo, newInvoiceNo, StringComparison.Ordinal);
        var shouldUpdateCustomerCode = newCustomerCode is not null && !string.Equals(previousCustomerCode, newCustomerCode, StringComparison.Ordinal);
        var shouldUpdateInvoiceTypeOverride = request.CustomerInvoiceTypeOverride is not null;

        static string NormalizeInvoiceTypeOverride(string? value)
        {
            var s = (value ?? string.Empty).Trim().ToUpperInvariant();
            if (s == "ACIK" || s == "AÇIK" || s == "ACIK" || s == "AÇIK") return "ACIK";
            if (s == "FATURA") return "FATURA";
            return string.Empty;
        }

        string? previousEffectiveInvoiceType = null;
        if (!string.IsNullOrWhiteSpace(invoice.CustomerInvoiceTypeOverride))
        {
            previousEffectiveInvoiceType = invoice.CustomerInvoiceTypeOverride;
        }
        else
        {
            var custCode = newCustomerCode ?? invoice.CustomerCode;
            if (!string.IsNullOrWhiteSpace(custCode))
            {
                var mainCustCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(custCode);
                previousEffectiveInvoiceType = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.CustomerCode == mainCustCode || x.CustomerCode == custCode)
                    .Select(x => x.InvoiceType)
                    .FirstOrDefaultAsync(cancellationToken);
            }
        }

        var prevTypeNorm = NormalizeInvoiceTypeOverride(previousEffectiveInvoiceType);
        var requestedTypeNorm = shouldUpdateInvoiceTypeOverride ? NormalizeInvoiceTypeOverride(newInvoiceTypeOverride) : string.Empty;
        var nextTypeNorm = shouldUpdateInvoiceTypeOverride ? requestedTypeNorm : prevTypeNorm;

        invoice.Description = request.Description?.Trim();
        invoice.InstallationName = request.InstallationName?.Trim();
        invoice.InstallationPhone = request.InstallationPhone?.Trim();
        if (request.ExchangeRate.HasValue && request.ExchangeRate.Value > 0)
        {
            invoice.ExchangeRate = request.ExchangeRate.Value;
            invoice.RateSource = "Manuel";
        }

        /*
          FATURA TARİHİ DÜZENLEME (kullanıcı isteği, 2026-09-03).

          Yalnız satış / açık satış faturasında. Alış / hizmet / iade faturasında yok sayılır:
          o faturalar tedarikçi ekstresi (SupplierLedgerEntry) kullanıyor ve bu uç onu hiç
          senkronlamıyor — tarihi değiştirmek fatura ile ekstreyi ayrıştırırdı.

          KUR'A DOKUNULMAZ: `Invoice.ExchangeRate` fatura anındaki DONMUŞ kurdur; tarihi
          değiştirmek onu otomatik güncellemez. O gün başka kur geçerliyse kullanıcı aynı
          modaldeki kur alanından elle günceller.

          Genel Ayarlar "Fatura Silme Kilit Tarihi" burada da geçerli: kilitli bir döneme
          ya da kilitli dönemden tarih taşınamaz (kapanmış KDV dönemine dokunmayı engeller).
        */
        var yeniTarih = request.Date?.Date;
        var tarihDegisiyorMu = false;
        if (yeniTarih.HasValue)
        {
            var tarihDuzenlenebilir = invoice.Type == InvoiceType.SalesInvoice || invoice.Type == InvoiceType.OpenInvoice;
            if (tarihDuzenlenebilir && yeniTarih.Value != invoice.Date.Date)
            {
                var invoiceLockDate = await _dbContext.Set<JwtSessionSetting>()
                    .AsNoTracking()
                    .OrderBy(x => x.Id)
                    .Select(x => x.InvoiceDeleteLockDate)
                    .FirstOrDefaultAsync(cancellationToken);

                if (invoiceLockDate.HasValue &&
                    (invoice.Date.Date < invoiceLockDate.Value.Date || yeniTarih.Value < invoiceLockDate.Value.Date))
                {
                    return BadRequest(new
                    {
                        success = false,
                        message = $"Fatura tarihi, Genel Ayarlar'daki kilit tarihinden ({invoiceLockDate.Value:dd.MM.yyyy}) önceki bir güne taşınamaz veya o günden önce olan bir faturanın tarihi değiştirilemez."
                    });
                }

                invoice.Date = DateTime.SpecifyKind(yeniTarih.Value, DateTimeKind.Utc);
                tarihDegisiyorMu = true;
            }
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var targetCustomerCode = newCustomerCode ?? invoice.CustomerCode;
        var resolvedInvoiceCustomerCode = await _customerAccountService.ResolveTargetInvoiceCustomerCodeAsync(targetCustomerCode, nextTypeNorm, cancellationToken);
        if (!string.IsNullOrWhiteSpace(resolvedInvoiceCustomerCode))
        {
            newCustomerCode = resolvedInvoiceCustomerCode;
            if (!string.Equals(invoice.CustomerCode, resolvedInvoiceCustomerCode, StringComparison.Ordinal))
            {
                invoice.CustomerCode = resolvedInvoiceCustomerCode;
                shouldUpdateCustomerCode = true;
            }
        }

        if (shouldUpdateInvoiceTypeOverride)
        {
            if (prevTypeNorm == "FATURA" && requestedTypeNorm == "ACIK")
            {
                await tx.RollbackAsync(cancellationToken);
                return BadRequest(new { success = false, message = "FATURA tipindeki fatura AÇIK tipine döndürülemez" });
            }

            // Store normalized values to keep data consistent
            invoice.CustomerInvoiceTypeOverride = requestedTypeNorm.Length > 0 ? requestedTypeNorm : newInvoiceTypeOverride;
        }

        var isTargetFaturaAccount = (resolvedInvoiceCustomerCode ?? string.Empty).EndsWith("-1");
        var isPreviousOpenAccount = (previousCustomerCode ?? string.Empty).EndsWith("-2") || prevTypeNorm == "ACIK";
        var shouldRecalcFromAcikToFatura = (prevTypeNorm == "ACIK" && nextTypeNorm == "FATURA") || (isPreviousOpenAccount && isTargetFaturaAccount);
        if (shouldRecalcFromAcikToFatura)
        {

            // Find target invoice price group
            Guid? targetPgId = requestedPriceGroupId;
            if (!targetPgId.HasValue)
            {
                var custPgId = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.CustomerCode == (previousCustomerCode ?? invoice.CustomerCode))
                    .Select(x => x.PriceGroupId)
                    .FirstOrDefaultAsync(cancellationToken);

                if (custPgId.HasValue)
                {
                    targetPgId = await _priceGroupMappingService.GetMappedInvoiceGroupIdAsync(custPgId.Value, cancellationToken);
                }
            }

            if (!targetPgId.HasValue)
            {
                await tx.RollbackAsync(cancellationToken);
                return BadRequest(new { success = false, message = "FATURA tipine geçiş için eşleşen fatura fiyat grubu bulunamadı." });
            }

            var pg = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(x => x.Id == targetPgId.Value && x.IsActive)
                .Select(x => new { x.Id, x.InvoiceType, x.Formula })
                .FirstOrDefaultAsync(cancellationToken);

            if (pg is null)
            {
                await tx.RollbackAsync(cancellationToken);
                return BadRequest(new { success = false, message = "Geçersiz fiyat grubu" });
            }

            var lines = await _dbContext.Set<InvoiceLine>()
                .Where(x => x.InvoiceId == invoice.Id)
                .ToListAsync(cancellationToken);

            var stockCodes = lines
                .Select(x => (x.StockCode ?? string.Empty).Trim())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var products = await _dbContext.Products
                .AsNoTracking()
                .Where(x => stockCodes.Contains(x.StockCode))
                .Select(x => new { x.Id, x.StockCode, x.TaxRate, x.DiscountRate, x.InstallationFee })
                .ToListAsync(cancellationToken);

            var productByStockCode = products
                .Where(x => !string.IsNullOrWhiteSpace(x.StockCode))
                .ToDictionary(x => x.StockCode, x => x, StringComparer.OrdinalIgnoreCase);

            var basePriceGroupF4Id = new Guid("44444444-4444-4444-4444-444444444444");
            var productIds = products.Select(x => x.Id).Distinct().ToList();
            var priceRows = await _dbContext.ProductPrices
                .AsNoTracking()
                .Where(x => productIds.Contains(x.ProductId) && (x.PriceGroupId == basePriceGroupF4Id || x.PriceGroupId == pg.Id))
                .Select(x => new { x.ProductId, x.PriceGroupId, x.Price })
                .ToListAsync(cancellationToken);

            var f4PriceByProductId = priceRows
                .Where(x => x.PriceGroupId == basePriceGroupF4Id)
                .GroupBy(x => x.ProductId)
                .ToDictionary(x => x.Key, x => x.First().Price);

            var directPriceByProductId = priceRows
                .Where(x => x.PriceGroupId == pg.Id)
                .GroupBy(x => x.ProductId)
                .ToDictionary(x => x.Key, x => x.First().Price);

            static decimal RemoveKdv(decimal price, decimal vatRate)
            {
                var denom = 1m + (vatRate / 100m);
                if (denom <= 0m) return price;
                return price / denom;
            }

            /*
              MONTAJ BEDELİ YENİDEN FİYATLAMADA KAYBOLUYORDU (2026-09-02, canlı bulgu).

              Aşağıdaki döngü satırın fiyatını F4 tabanından YENİDEN türetiyor ve mevcut
              `UnitPrice`ı tamamen atıyor. Montaj bedeli ise ayrı bir satır değil, sepette
              ürünün birim fiyatına KATILMIŞ durumda — dolayısıyla bu türetmede sessizce
              siliniyordu.

              KANIT (fatura A00000000041302, 31.08.2026):
                  sipariş satırı  24.885,71  (= 24.600,00 katalog + 285,71 montaj neti)
                  fatura satırı   23.428,57  (= 24.600,00 / 1,05 — montaj YOK)
              Müşteriden montaj ücreti alınmamış oluyor.

              ÇÖZÜM: yeniden türetilen fiyata montajın NET karşılığı geri eklenir. Brüt
              sonuç böyle doğru çıkar: (23.428,57 + 285,71) × 1,05 = 24.900,00 = katalog
              24.600 + montaj 300. Bedeli türetimden ÖNCE eklemek (yani 24.885,71'i bölmek)
              montajın KDV'sini ikinci kez düşürürdü.

              MONTAJ İSTENDİĞİNİN KAYNAĞI: `SalesOrderLines.Montage`. Fiyattan geri okumak
              (fark 285,71 mi diye bakmak) kampanyalı/iskontolu satırda yanılır.
            */
            var montajliSiparisSatirlari = new HashSet<int>();
            var montajSiparisIdleri = lines
                .Where(x => x.SalesOrderLineId.HasValue)
                .Select(x => x.SalesOrderLineId!.Value)
                .Distinct()
                .ToList();
            if (montajSiparisIdleri.Count > 0)
            {
                var montajliIdler = await _dbContext.Set<SalesOrderLine>()
                    .AsNoTracking()
                    .Where(x => montajSiparisIdleri.Contains(x.Id) && x.Montage)
                    .Select(x => x.Id)
                    .ToListAsync(cancellationToken);
                foreach (var mid in montajliIdler) montajliSiparisSatirlari.Add(mid);
            }

            // İSKONTO ÇEVRİMİ İÇİN ESKİ SATIR DURUMU — aşağıdaki hesapta kullanılıyor.
            // Aşağıdaki döngü `UnitPrice` ve `VatRate` alanlarını YERİNDE değiştiriyor;
            // sonrasında satırların ESKİ KDV oranına ulaşmanın yolu kalmıyor.
            var eskiBrut = lines.Sum(x => x.Quantity * x.UnitPrice);
            var eskiKdv = lines.Sum(x => (x.Quantity * x.UnitPrice) * (x.VatRate / 100m));

            /*
              TAMİR/HİZMET KALEMLERİ (HİZ-*) Products TABLOSUNDA YOKTUR — ServiceOps'ta işçilik
              bedeli serbest metinle girildiği için ürün kartı açılmaz (2026-09-10 canlı bulgu).
              Aşağıdaki döngü yalnız `productByStockCode`'da bulunan satırları işliyordu; bu
              kalemler bulunamadığı için sessizce ATLANIYOR — VatRate 0'da donuk kalıyor, dönüşen
              fatura "KDV 0,00" çıkıyordu (fatura 1386→1389, cari 120-03-002097, kanıt: brüt
              1.250,00, KDV 0,00).

              DÜZELTME ÜRÜN SATIRLARIYLA BİREBİR AYNI DAVRANMALI: aşağıdaki ürün dalı (satır
              ~6234) hiçbir cari muafiyet kontrolü YAPMADAN doğrudan `p.TaxRate`yi uyguluyor —
              cari "ACIK" tipinde olsa bile. İlk denemede burada CREATE anındaki (`isAcik`)
              muafiyet kuralını kopyalamıştım; YANLIŞTI — o kural "bu işlem AÇIK durumdayken mi
              KDV'siz kalsın" diye sorar, "bu cari kalıcı muaf mı" diye sormaz. DEMO'da
              neredeyse her carinin `InvoiceType` alanı varsayılan olarak "ACIK" (gerçek bir
              muafiyet değil), bu yüzden o kontrol KDV'yi neredeyse HİÇ uygulamıyordu.

              Doğru kural: dönüşüm anının kendisi (AÇIK->FATURA) zaten resmî faturalanma anıdır;
              tıpkı üründe olduğu gibi burada da KOŞULSUZ %16 (ServiceVatRate) uygulanır.
            */
            foreach (var l in lines)
            {
                if (!productByStockCode.TryGetValue(l.StockCode, out var p))
                {
                    var stockCodeTrim = (l.StockCode ?? string.Empty).Trim();
                    var isServiceLine = stockCodeTrim.StartsWith("HİZ", StringComparison.OrdinalIgnoreCase)
                                        || stockCodeTrim.StartsWith("HIZ", StringComparison.OrdinalIgnoreCase);

                    if (isServiceLine)
                    {
                        var grossAmount = l.UnitPrice;
                        l.VatRate = ServiceVatRate;
                        l.UnitPrice = decimal.Round(RemoveKdv(grossAmount, ServiceVatRate), 2, MidpointRounding.AwayFromZero);
                        l.CurrencyUnitPrice = l.UnitPrice; // Servis kalemleri TL'dir, döviz çevrimi yok.
                    }

                    continue;
                }

                var vatRate = (decimal)p.TaxRate;
                var discountRate = (decimal)p.DiscountRate;
                var baseF4 = f4PriceByProductId.TryGetValue(p.Id, out var b) ? b : l.UnitPrice;
                var direct = directPriceByProductId.TryGetValue(p.Id, out var d) ? d : (decimal?)null;

                var formula = (pg.Formula ?? string.Empty).Trim().ToUpperInvariant();
                decimal nextUnitPrice;
                if (formula == "REMOVE_KDV(F4)")
                {
                    nextUnitPrice = RemoveKdv(baseF4, vatRate);
                }
                else if (formula == "REMOVE_KDV(F4*0.88)")
                {
                    nextUnitPrice = RemoveKdv(baseF4 * 0.88m, vatRate);
                }
                else if (formula == "REMOVE_KDV(F4*(1-DISCOUNT/100))")
                {
                    nextUnitPrice = RemoveKdv(baseF4 * (1m - (discountRate / 100m)), vatRate);
                }
                else
                {
                    nextUnitPrice = direct ?? baseF4;
                }

                if (nextUnitPrice < 0m) nextUnitPrice = 0m;

                // Montaj bedeli KDV DAHİL girilir; net karşılığı türetilen fiyatın üstüne biner.
                if (l.SalesOrderLineId.HasValue
                    && montajliSiparisSatirlari.Contains(l.SalesOrderLineId.Value))
                {
                    var montajBrut = p.InstallationFee ?? 0m;
                    if (montajBrut > 0m)
                    {
                        nextUnitPrice += RemoveKdv(montajBrut, vatRate);
                    }
                }

                l.UnitPrice = decimal.Round(nextUnitPrice, 2, MidpointRounding.AwayFromZero);
                l.VatRate = decimal.Round(vatRate, 2, MidpointRounding.AwayFromZero);

                // TL çapası yeniden hesaplandı; belgenin kendi parasındaki karşılığı da
                // yeniden türetilmeli. Öncesinde `CurrencyUnitPrice` ESKİ değerinde
                // kalıyordu: dövizli açık fatura resmi faturaya çevrilince TL sütunu
                // değişip döviz sütunu donuyor, iki ekstre birbirini tutmuyordu.
                if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(l.CurrencyTypeId) && l.CurrencyRate > 0m)
                {
                    l.CurrencyUnitPrice = decimal.Round(l.UnitPrice / l.CurrencyRate, 4, MidpointRounding.AwayFromZero);
                }
                else
                {
                    l.CurrencyUnitPrice = l.UnitPrice;
                }
            }

            var subtotal = lines.Sum(x => x.Quantity * x.UnitPrice);

            /*
              İSKONTO KDV DAHİL GİRİLİR — AÇIK → FATURA DÖNÜŞÜMÜNDE DE (2026-08-29 bildirimi:
              "üst bilgi güncelle deyince tutar sapıyor ... gün sonunda KDV dahil 7500 görmemiz
              lazım").

              CANLI ÖRNEK — KIYMET GROUP, 100000000000164 → A00000000999999:
                  açık fatura : brüt 8.400,00   iskonto 900,00   KDV %0    genel toplam 7.500,00
                  dönüşünce   : brüt 7.241,37   iskonto 900,00   KDV %16   genel toplam 7.355,99
              Sapma 144,01 TL = 900 × 0,16.

              SEBEP: saklanan iskonto NET kabul edilip KDV'siz tabandan düşülüyor, KDV sonra
              ÜSTÜNE ekleniyordu. İskonto fiilen 900 × 1,16 = 1.044,00 oluyordu.

              Buradaki eski yorum "saklanan iskonto zaten nettir, ikinci kez KDV dahil sayılırsa
              fatura her güncellemede küçülür" diyordu ve FATURA → FATURA güncellemesi için
              DOĞRUYDU. Kaçırdığı durum KDV ORANININ DEĞİŞMESİ: açık faturada KDV %0 olduğu için
              net iskonto ile brüt iskonto AYNI sayıdır (900 = 900). Fatura hesabına geçince
              satırlar %16'ya çıkıyor, ama iskonto hâlâ eski (KDV'siz) tabanın neti sayılıyor.

              DOĞRUSU: saklanan net iskontoyu ESKİ satır durumundan KDV dahil karşılığına geri
              çevirip, YENİ satır durumuyla ortak hesaba vermek. Çevrim `InvoiceDiscountMath`
              içindeki `netIskonto = brüt − net` bağıntısının tersidir:

                  kdvDahilIskonto = netIskonto × (kdvDahilTaban / brüt)        [eski durumla]

              FATURA → FATURA'da bu çevrim KİMLİKTİR (1,16 ile çarpılıp 1,16'ya bölünür), yani
              düğmeye üst üste basmak faturayı küçültmez — eski yorumun asıl korkusu buydu.
            */
            var kdvDahilIskonto = eskiBrut > 0m
                ? invoice.Discount * ((eskiBrut + eskiKdv) / eskiBrut)
                : invoice.Discount;
            if (kdvDahilIskonto < 0m) kdvDahilIskonto = 0m;

            var yeniKdvBrutten = lines.Sum(x => (x.Quantity * x.UnitPrice) * (x.VatRate / 100m));

            // HESAP TEK KAYNAKTAN: `CreateSalesInvoice` ile aynı sınıf. Bu uç kendi kopyasını
            // taşıyordu — sınıfın kendi açıklaması "üç uçta tekrarlanıyordu" derken bu ucu da
            // sayıyor ama bağlanmamıştı; 144,01 TL sapma tam olarak o kopyadan çıktı.
            var iskontoSonuc = B2B.Erp.Api.Core.Accounting.InvoiceDiscountMath.Hesapla(
                subtotal, yeniKdvBrutten, kdvDahilIskonto);

            // Kampanya payı `Discount` içinde SAYILI olduğu için aynı çevrimden geçmeli; aksi
            // halde raporlardaki "iskonto − kampanya" farkı kayar. Kampanyasız faturada
            // (CampaignDiscount = 0) buranın hiçbir etkisi yoktur.
            if (invoice.CampaignDiscount > 0m)
            {
                var kdvDahilKampanya = eskiBrut > 0m
                    ? invoice.CampaignDiscount * ((eskiBrut + eskiKdv) / eskiBrut)
                    : invoice.CampaignDiscount;

                invoice.CampaignDiscount = kdvDahilIskonto > 0m
                    ? decimal.Round(kdvDahilKampanya * (iskontoSonuc.NetIskonto / kdvDahilIskonto),
                                    2, MidpointRounding.AwayFromZero)
                    : 0m;
            }

            invoice.Subtotal = subtotal;
            invoice.Discount = iskontoSonuc.NetIskonto;
            invoice.NetTotal = iskontoSonuc.NetToplam;
            invoice.VatTotal = iskontoSonuc.KdvToplam;
            invoice.GrandTotal = iskontoSonuc.GenelToplam;
        }

        if (shouldUpdateInvoiceNo)
        {
            invoice.InvoiceNo = newInvoiceNo!;
        }

        if (shouldUpdateCustomerCode)
        {
            invoice.CustomerCode = newCustomerCode!;

            /*
              TESLİM CARİSİ DE TAKİP EDER (2026-09-03 kullanıcı bildirimi: "teslim cari adı
              ağrı ticaret olarak kalmış").

              Fatura oluşturulurken teslim carisi verilmezse cariye eşitlenir
              (`deliveryCustomerCode = request.DeliveryCustomerCode ?? customerCode`), yani
              sıradan satışta ikisi AYNIDIR. Üst bilgiden cari değiştirilince yalnız
              `CustomerCode` yenileniyor, teslim carisi eski cariye çakılı kalıyordu:
              A00000000071494 faturası ARABANLI ELEKTRONİK'e alındı ama ekstrenin "Teslim
              Cari Adı" sütunu AĞRI TİCARET yazmaya devam etti.

              ŞUBE SATIŞINA DOKUNULMAZ: teslim carisi gerçekten BAŞKA bir cariyse (şube
              teslimi, [[sube_cari_fiyat_kurgusu]]) o bilgi gerçek teslim bilgisidir ve
              korunur. Yalnız "cariyle aynıydı" ya da hiç yazılmamış olan hâl taşınır.
              Karşılaştırma ana koda indirgenerek yapılır: fatura kodu alt hesap ekli
              (`-1/-2/-3`) olabilirken teslim kodu ana hesap biçiminde durabiliyor.
            */
            var eskiTeslimKodu = (invoice.DeliveryCustomerCode ?? string.Empty).Trim();
            var teslimCariyeEsitti = string.IsNullOrWhiteSpace(eskiTeslimKodu)
                || string.Equals(eskiTeslimKodu, previousCustomerCode, StringComparison.Ordinal)
                || string.Equals(
                    B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(eskiTeslimKodu),
                    B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(previousCustomerCode),
                    StringComparison.Ordinal);

            if (teslimCariyeEsitti)
            {
                invoice.DeliveryCustomerCode = newCustomerCode!;
            }
        }

        invoice.EditUser = User.Identity?.Name ?? "System";
        invoice.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Sync StockMovements, CustomerLedgerEntries, and payment records atomically
        await _invoiceSyncService.SyncInvoiceHeaderUpdateAsync(invoice, previousInvoiceNo, previousCustomerCode, cancellationToken, tarihDegisiyorMu);

        await tx.CommitAsync(cancellationToken);

        // MONTAJDAKİ FATURA NO İZİ DE YENİLENİR (kullanıcı isteği, 2026-08-13).
        //
        // Fatura iptal edilip yeni numarayla yazıldığında veya üst bilgi güncellendiğinde:
        // Montaj tarafındaki kayıtlar hem fatura no hem de montaj ID'leri (ExternalRef)
        // üzerinden tespit edilerek açıklamalarındaki [Fatura No: ...] etiketi güncellenir.
        var invoiceLines = await _dbContext.Set<InvoiceLine>()
            .Where(x => x.InvoiceId == invoice.Id)
            .ToListAsync(cancellationToken);
        var installations = await CollectInstallationsForLinesAsync(invoiceLines, cancellationToken);
        var externalRefs = installations.Select(inst => InstallationExternalRef(inst.Id)).Distinct().ToList();

        /*
          BAYİ ADI ANA CARİDEN OKUNUR (2026-09-03).

          Faturanın kodu alt hesap ekli olabilir (`120-01-000544-1`); montaj kaydı ANA cariyi
          tutar, adı da ana cariden gelir ([[cari-alt-hesap-kurali]]). Ek atılmadan aranırsa
          `Customers` içinde karşılığı bulunamaz ve ad boş gider.
        */
        var montajDealerCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(invoice.CustomerCode);
        var montajDealerName = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == montajDealerCode)
            .Select(x => x.Name)
            .FirstOrDefaultAsync(cancellationToken);

        /*
         * FATURA NUMARASI DEĞİŞTİYSE, ONU METİN OLARAK TAŞIYAN KAYITLAR DA GÜNCELLENİR
         * (2026-09-08).
         *
         * Fatura numarası yalnızca `Invoices.InvoiceNo` alanında durmuyor; kesim sırasında
         * yan kayıtlara KOPYALANIYOR. Üst bilgiden numara değiştirildiğinde bugüne kadar
         * yalnız faturanın kendi alanı yenileniyordu, kopyalar eski numarada kalıyordu.
         *
         * Görülen sonuç (DEMO_CANLI, 2026-09-08): cari ekstresinde satırın belge numarası
         * ile faturanın numarası ayrışıyor. Ekstre kalemi eşleştirmesi belge numarasına
         * bakmak zorunda (kimlik tek başına yetmiyor, `ReferenceType = Invoice` damgasını
         * alış tarafı da yazıyor) — numaralar ayrışınca eşleştirme kimliğe düşüyor ve
         * kimlik çakışmasında BAŞKA bir belgenin kalemleri görünüyordu.
         *
         * KAPSAM DAR TUTULDU: her kayıt kendi faturasına KİMLİKLE bağlanarak bulunuyor,
         * "numarası aynı olan her şey" diye taranmıyor. Stok hareketinde kimlik alanı yok,
         * orada zorunlu olarak eski numara kullanılıyor — silme yolu (
         * `DeleteStockMovementsForInvoice`) da yıllardır aynı kapsamı kullanıyor.
         *
         * Banka hareketlerine DOKUNULMUYOR: o tabloda faturaya kimlikle bağ yok ve belge
         * numarası başka belgelerle çakışabiliyor; yanlış satırı yeniden numaralamak,
         * düzeltmeye çalıştığımız sorunun daha kötüsü olurdu.
         */
        if (shouldUpdateInvoiceNo && !string.IsNullOrWhiteSpace(previousInvoiceNo))
        {
            var eskiNo = previousInvoiceNo.Trim();
            var yeniNo = invoice.InvoiceNo.Trim();
            var senkronlanan = 0;
            var kaynakBelgeSenkron = 0;

            var defterSatirlari = await _dbContext.CustomerLedgerEntries
                .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                            && x.ReferenceId == invoice.Id
                            && x.DocumentNo == eskiNo)
                .ToListAsync(cancellationToken);

            foreach (var satir in defterSatirlari)
            {
                satir.DocumentNo = yeniNo;
                senkronlanan++;
            }

            var stokHareketleri = await _dbContext.Set<StockMovement>()
                .Where(x => x.InvoiceNo == eskiNo)
                .ToListAsync(cancellationToken);

            foreach (var hareket in stokHareketleri)
            {
                hareket.InvoiceNo = yeniNo;
                senkronlanan++;
            }

            /*
             * KAYNAK ALIŞ/GİDER FATURASI DA TAKİP EDER.
             *
             * Gider faturası (`PurchaseInvoices`) ana belge, satış faturası ondan türetiliyor
             * ve bu sistemde İKİSİNİN BELGE NUMARASI AYNIDIR — ekstre kalem eşleştirmesi de
             * (`CustomerLedgerController.Details`) tam bu varsayıma dayanıyor:
             * `SourcePurchaseInvoiceId == ReferenceId && InvoiceNo == DocumentNo`.
             *
             * Üst bilgiden satış faturasının numarası değiştirilince kaynak belge eski
             * numarada kalıyor, o eşleştirme kırılıyor ve defter satırı kimliğe düşüyordu.
             * Kimlik ise iki tablo arasında çakışabildiği için başka bir belgenin kalemleri
             * görünüyordu (canlı örnek: 147 numaralı satış faturası 000000000001095'e
             * çevrildi, kaynak alış HZ260824134219'da kaldı).
             *
             * DAR KAPSAM: yalnızca faturanın KENDİ kaynak belgesi ve yalnızca hâlâ ESKİ
             * numarayı taşıyorsa. Başka bir belgeyi yeniden numaralamak mümkün değil.
             */
            if (invoice.SourcePurchaseInvoiceId.HasValue)
            {
                var kaynakAlis = await _dbContext.Set<PurchaseInvoice>()
                    .FirstOrDefaultAsync(
                        x => x.Id == invoice.SourcePurchaseInvoiceId.Value && x.DocumentNo == eskiNo,
                        cancellationToken);

                if (kaynakAlis is not null)
                {
                    kaynakAlis.DocumentNo = yeniNo;
                    senkronlanan++;
                    kaynakBelgeSenkron++;

                    // Bu belgenin defter satırları kaynak ALIŞ faturasının kimliğine bağlı,
                    // satış faturasınınkine değil — yukarıdaki kapsam onları görmüyor.
                    var alisDefterSatirlari = await _dbContext.CustomerLedgerEntries
                        .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                                    && x.ReferenceId == kaynakAlis.Id
                                    && x.DocumentNo == eskiNo)
                        .ToListAsync(cancellationToken);

                    foreach (var satir in alisDefterSatirlari)
                    {
                        satir.DocumentNo = yeniNo;
                        senkronlanan++;
                        kaynakBelgeSenkron++;
                    }

                    var tedarikciSatirlari = await _dbContext.Set<SupplierLedgerEntry>()
                        .Where(x => x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice
                                    && x.ReferenceId == kaynakAlis.Id
                                    && x.DocumentNo == eskiNo)
                        .ToListAsync(cancellationToken);

                    foreach (var satir in tedarikciSatirlari)
                    {
                        satir.DocumentNo = yeniNo;
                        senkronlanan++;
                        kaynakBelgeSenkron++;
                    }
                }
            }

            var kasaHareketleri = await _dbContext.CashAccountTransactions
                .Where(x => x.ReferenceType == CashAccountTransactionReferenceType.Invoice
                            && x.ReferenceId == invoice.Id
                            && x.DocumentNo == eskiNo)
                .ToListAsync(cancellationToken);

            foreach (var hareket in kasaHareketleri)
            {
                hareket.DocumentNo = yeniNo;
                senkronlanan++;
            }

            if (senkronlanan > 0)
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
                Console.WriteLine(
                    $"[Fatura Yeniden Numaralama] {eskiNo} -> {yeniNo}: " +
                    $"{defterSatirlari.Count} defter, {stokHareketleri.Count} stok, " +
                    $"{kasaHareketleri.Count} kasa, {kaynakBelgeSenkron} kaynak alis kaydi senkronlandi. [docno-sync-v5]");
            }
        }

        if (shouldUpdateInvoiceNo || shouldUpdateCustomerCode || externalRefs.Count > 0)
        {
            await NotifyServiceOpsInvoiceRenumberedAsync(
                previousInvoiceNo, invoice.InvoiceNo, externalRefs, cancellationToken,
                montajDealerCode, montajDealerName);
        }

        return Ok(new { success = true });
    }

    /// <summary>
    /// Fatura numarası değiştiğinde ServiceOps'taki montaj izini günceller.
    ///
    /// Eşleşmeyi ServiceOps hem eski fatura numarası hem de montaj kalemlerinin
    /// ExternalRef (B2B-INST-X) anahtarları üzerinden yapar.
    /// </summary>
    private async Task NotifyServiceOpsInvoiceRenumberedAsync(
        string? oldInvoiceNo,
        string? newInvoiceNo,
        List<string>? externalRefs,
        CancellationToken ct,
        string? dealerCode = null,
        string? dealerName = null)
    {
        var oldNo = (oldInvoiceNo ?? string.Empty).Trim();
        var newNo = (newInvoiceNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(newNo)) return;

        try
        {
            using var client = CreateServiceOpsClient();
            if (client is null) return;

            /*
              BAYİ DE GÖNDERİLİR (2026-09-03, kullanıcı bildirimi).

              Fatura üst bilgisinden cari değiştirildiğinde montaj kaydı ESKİ bayide kalıyordu:
              buradan yalnızca fatura numarası gidiyordu, cari hiç gitmiyordu. ServiceOps
              tarafında da bayi yalnız kayıt OLUŞTURULURKEN yazılıp bir daha güncellenmiyordu.
              Örnek: A00000000071405 faturası ARABANLI ELEKTRONİK'e alındı, montaj AĞRI
              TİCARET'te kaldı.

              Alanlar isteğe bağlı: gönderilmezse ServiceOps bayiye dokunmaz.
            */
            var body = new StringContent(
                JsonSerializer.Serialize(new
                {
                    newInvoiceNo = newNo,
                    externalRefs = externalRefs ?? new List<string>(),
                    dealerCode = string.IsNullOrWhiteSpace(dealerCode) ? null : dealerCode.Trim(),
                    dealerName = string.IsNullOrWhiteSpace(dealerName) ? null : dealerName.Trim()
                }),
                System.Text.Encoding.UTF8,
                "application/json");

            var urlOldNo = string.IsNullOrWhiteSpace(oldNo) ? "none" : oldNo;
            var res = await client.PutAsync($"api/montaj/invoice/{Uri.EscapeDataString(urlOldNo)}/renumber", body, ct);
            var text = await res.Content.ReadAsStringAsync(ct);
            Console.WriteLine($"[ServiceOps Renumber] {oldNo} -> {newNo} (Refs: {externalRefs?.Count ?? 0}, Bayi: {dealerCode ?? "-"}) : {(int)res.StatusCode} {text}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ServiceOps Renumber] error: {ex.Message}");
        }
    }

    /// <summary>
    /// Flattens an exception chain into something a user can act on.
    ///
    /// A failed delete surfaces as DbUpdateException wrapping a PostgresException, and only the
    /// inner one knows which table and constraint objected. Postgres' own detail line names the
    /// offending row, so it is included ahead of the generic wrapper text.
    /// </summary>
    private static string DescribeException(Exception ex)
    {
        var parts = new List<string>();

        for (var current = ex; current is not null; current = current.InnerException)
        {
            if (current is Npgsql.PostgresException pg)
            {
                // The constraint name is what identifies the real blocker.
                var where = string.IsNullOrWhiteSpace(pg.TableName) ? "" : $" [{pg.TableName}]";
                var constraint = string.IsNullOrWhiteSpace(pg.ConstraintName) ? "" : $" ({pg.ConstraintName})";
                parts.Add($"{pg.MessageText}{where}{constraint}");
                if (!string.IsNullOrWhiteSpace(pg.Detail)) parts.Add(pg.Detail);
            }
            else if (current.InnerException is null)
            {
                // Only the innermost non-Postgres message adds anything; the outer ones are
                // "See the inner exception for details".
                parts.Add(current.Message);
            }
        }

        return parts.Count > 0 ? string.Join(" — ", parts.Distinct()) : ex.Message;
    }

    [HttpDelete("{invoiceId:int}")]
    [AuthorizePage("invoice", "faturaDokumSil")]
    public async Task<IActionResult> DeleteInvoice([FromRoute] int invoiceId, CancellationToken cancellationToken)
    {
        var invoice = await _dbContext.Set<Invoice>()
            .FirstOrDefaultAsync(x => x.Id == invoiceId, cancellationToken);

        if (invoice is null)
        {
            return NotFound(new { success = false, message = "Fatura bulunamadı" });
        }

        // Genel Ayarlar Fatura Silme Kilit Tarihi Kontrolü (Diğer tüm yetki/silme kurallarını ezer)
        var lockDate = await _dbContext.Set<JwtSessionSetting>()
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => x.InvoiceDeleteLockDate)
            .FirstOrDefaultAsync(cancellationToken);

        if (lockDate.HasValue && invoice.Date.Date < lockDate.Value.Date)
        {
            return BadRequest(new { success = false, message = $"Fatura tarihi ({invoice.Date:dd.MM.yyyy}), Genel Ayarlar'da belirlenen silme kilit tarihinden ({lockDate.Value:dd.MM.yyyy}) önce olduğu için bu fatura silinemez." });
        }

        if (!await this.CanDeleteRecordAsync(_dbContext, invoice, cancellationToken))
        {
            return BadRequest(new { success = false, message = "Sadece kendi oluşturduğunuz işlemleri silebilirsiniz." });
        }

        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var roleIdClaim = User.Claims.FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))?.Value;
        if (!isSsa && !isSuperAdmin && int.TryParse(roleIdClaim, out var roleId))
        {
            var hasRestriction = await _dbContext.RolePagePermissions
                .AsNoTracking()
                .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && rpp.Page.ModuleKey == "deleteRule" && rpp.Page.Key == "deleteRule/faturaDokum", cancellationToken);
            if (hasRestriction && DateTime.UtcNow - invoice.CreateTime > TimeSpan.FromDays(1))
            {
                return BadRequest(new { success = false, message = "Bu kayıt silinemez" });
            }
        }

        var lines = await _dbContext.Set<InvoiceLine>()
            .Where(x => x.InvoiceId == invoiceId)
            .ToListAsync(cancellationToken);

        // Teslimat kaydını düşürebilmek için sipariş numaraları kalemler silinmeden önce alınır.
        var ecommerceOrderNos = await CollectEcommerceOrderNosAsync(lines, cancellationToken);

        // Servis bağlantısı da SİLMEDEN ÖNCE çözülür: bağ, kalemlerin işaret ettiği sipariş
        // üzerinden kuruluyor ve kalemler silindikten sonra geriye izlenecek bir şey kalmıyor.
        var linkedService = await ResolveLinkedServiceRecordAsync(invoice, lines, cancellationToken);

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
            if (string.IsNullOrWhiteSpace(username)) username = "System";

            // 1. Delete invoice lines
            if (lines.Count > 0)
            {
                _dbContext.Set<InvoiceLine>().RemoveRange(lines);
            }

            // 2. Delete stock movements
            await DeleteStockMovementsForInvoice(invoice.InvoiceNo, cancellationToken);

            // Delete customer ledger entries (cari hareket) - only the invoice itself, NOT payment/collection ledger entries
            //
            // BELGE NO KAPISI (2026-09-08). `Invoices` (satış) ve `PurchaseInvoices` (alış)
            // cari deftere AYNI `ReferenceType` (Invoice) ile yazıyor, id dizileri AYRI: aynı
            // numaralı kayıt iki tabloda da var. Yalnız `ReferenceId`ye bakan bu silme, aynı
            // id'li BİR ALIŞ faturasının defter satırını da siliyordu (simetrik: alış silme
            // yolu da satış satırını siliyordu — 100000000000046 / EMİNE KILINÇ). Satış
            // faturasının kendi defter satırı `DocumentNo == invoice.InvoiceNo` taşır (satır
            // ~4053); belge no tutmayan satır bu faturaya ait değil.
            var ledgerEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                            && x.ReferenceId == invoice.Id
                            && x.DocumentNo == invoice.InvoiceNo
                            && x.TransactionType != "Kasa"
                            && x.TransactionType != "Banka"
                            && x.TransactionType != "POS"
                            && x.TransactionType != "Çek/Senet")
                .ToListAsync(cancellationToken);
            if (ledgerEntries.Count > 0)
            {
                _dbContext.CustomerLedgerEntries.RemoveRange(ledgerEntries);
            }

            // Do NOT delete associated CashAccountTransaction entries. We only fetch them for logging.
            var cashTransactions = await _dbContext.CashAccountTransactions
                .Where(x => (x.ReferenceType == CashAccountTransactionReferenceType.Invoice && x.ReferenceId == invoice.Id)
                            || (!string.IsNullOrEmpty(x.Description) && x.Description.Contains(invoice.InvoiceNo)))
                .ToListAsync(cancellationToken);

            // Do NOT delete associated BankAccountTransaction entries. We only fetch them for logging.
            var bankTransactions = new List<BankAccountTransaction>();
            var supplierEntries = new List<SupplierLedgerEntry>();
            if (!string.IsNullOrWhiteSpace(invoice.InvoiceNo))
            {
                bankTransactions = await _dbContext.BankAccountTransactions
                    .Where(x => x.DocumentNo == invoice.InvoiceNo
                                || (!string.IsNullOrEmpty(x.Description) && x.Description.Contains(invoice.InvoiceNo)))
                    .ToListAsync(cancellationToken);

                // Only delete the invoice itself from SupplierLedgerEntries, do NOT delete payment entries.
                // BELGE NO KAPISI (2026-09-08) — bkz. yukarıdaki cari defter silmesi: id çakışması.
                supplierEntries = await _dbContext.SupplierLedgerEntries
                    .Where(x => x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice
                                && x.ReferenceId == invoice.Id
                                && x.DocumentNo == invoice.InvoiceNo
                                && x.TransactionType != "Kasa"
                                && x.TransactionType != "Banka"
                                && x.TransactionType != "POS"
                                && x.TransactionType != "Çek/Senet")
                    .ToListAsync(cancellationToken);
                if (supplierEntries.Count > 0)
                {
                    _dbContext.SupplierLedgerEntries.RemoveRange(supplierEntries);
                }
            }

            var sourcePurchaseId = invoice.SourcePurchaseInvoiceId;
            var isPurchaseDerived = invoice.Type == InvoiceType.PurchaseInvoice
                                   || invoice.Type == InvoiceType.ServiceInvoice
                                   || invoice.Type == InvoiceType.ReturnInvoice;

            PurchaseInvoice? purchase = null;
            if (isPurchaseDerived && sourcePurchaseId.HasValue)
            {
                purchase = await _dbContext.Set<PurchaseInvoice>()
                    .Include(x => x.Lines)
                    .FirstOrDefaultAsync(x => x.Id == sourcePurchaseId.Value, cancellationToken);
            }

            // Also delete SupplierLedgerEntries and CustomerLedgerEntries linked via purchase invoice if the purchase invoice is being deleted
            if (isPurchaseDerived && sourcePurchaseId.HasValue && (purchase == null || purchase.Kind != PurchaseInvoiceKind.Purchase))
            {
                var purchaseSupplierEntries = await _dbContext.SupplierLedgerEntries
                    .Where(x => x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice 
                                && x.ReferenceId == sourcePurchaseId.Value
                                && x.TransactionType != "Kasa"
                                && x.TransactionType != "Banka"
                                && x.TransactionType != "POS"
                                && x.TransactionType != "Çek/Senet")
                    .ToListAsync(cancellationToken);
                if (purchaseSupplierEntries.Count > 0)
                {
                    _dbContext.SupplierLedgerEntries.RemoveRange(purchaseSupplierEntries);
                }

                var purchaseCustomerEntries = await _dbContext.CustomerLedgerEntries
                    .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice 
                                && x.ReferenceId == sourcePurchaseId.Value
                                && x.TransactionType != "Kasa"
                                && x.TransactionType != "Banka"
                                && x.TransactionType != "POS"
                                && x.TransactionType != "Çek/Senet")
                    .ToListAsync(cancellationToken);
                if (purchaseCustomerEntries.Count > 0)
                {
                    _dbContext.CustomerLedgerEntries.RemoveRange(purchaseCustomerEntries);
                }
            }

            // Reset CariOffer link
            var cariOffer = await _dbContext.CariOffers
                .FirstOrDefaultAsync(x => x.InvoiceId == invoice.Id, cancellationToken);
            if (cariOffer != null)
            {
                cariOffer.InvoiceId = null;
                cariOffer.InvoiceNo = null;
                cariOffer.EditUser = username;
                cariOffer.EditTime = DateTime.UtcNow;
            }

            // 3. Mark associated Installations as Passive / Reverted instead of deleting
            var invLineIds = lines.Select(x => x.Id).ToList();
            var lineLineageIds = lines.Where(x => x.LineageId.HasValue).Select(x => x.LineageId!.Value).ToList();
            var sourceLineIds = lines
                .Where(x => x.SalesOrderLineId.HasValue)
                .Select(x => x.SalesOrderLineId!.Value)
                .Distinct()
                .ToList();

            var installationsToDeactivate = await _dbContext.Set<Installation>()
                .Where(x => (x.InvoiceLineId.HasValue && invLineIds.Contains(x.InvoiceLineId.Value)) ||
                            (x.LineageId.HasValue && lineLineageIds.Contains(x.LineageId.Value)) ||
                            (x.SalesOrderLineId.HasValue && sourceLineIds.Contains(x.SalesOrderLineId.Value)))
                .ToListAsync(cancellationToken);

            foreach (var inst in installationsToDeactivate)
            {
                inst.InvoiceLineId = null;
                inst.Status = "Pasif / Geri Alındı";
            }

            // 4. Log deletion

            var cashIds = cashTransactions.Select(c => c.CashAccountId).Distinct().ToList();
            var cashMap = cashIds.Count > 0
                ? await _dbContext.CashAccounts.AsNoTracking().Where(ca => cashIds.Contains(ca.Id)).ToDictionaryAsync(ca => ca.Id, ca => ca.Name, cancellationToken)
                : new Dictionary<int, string>();

            var bankIds = bankTransactions.Select(b => b.BankAccountDefinitionId).Distinct().ToList();
            var bankMap = bankIds.Count > 0
                ? await _dbContext.BankAccountDefinitions.AsNoTracking().Where(ba => bankIds.Contains(ba.Id)).ToDictionaryAsync(ba => ba.Id, ba => ba.AccountName, cancellationToken)
                : new Dictionary<int, string>();

            var backupData = new
            {
                CariOfferId = cariOffer?.Id,
                invoice.InvoiceNo,
                invoice.Type,
                invoice.CustomerCode,
                invoice.CustomerNameOverride,
                invoice.CustomerInvoiceTypeOverride,
                invoice.DeliveryCustomerCode,
                invoice.Date,
                invoice.VatIncluded,
                invoice.Subtotal,
                invoice.Discount,
                invoice.NetTotal,
                invoice.VatTotal,
                invoice.GrandTotal,
                // Faturanın para birimi ve FATURA ANINDAKİ donmuş kuru silme kaydına da
                // girmeli. Kalemler ve ekstre satırları dövizlerini yedekliyordu ama başlık
                // yedeklemiyordu: dövizli bir fatura silindiğinde belgenin hangi kurla
                // kesildiği kayıttan tamamen kayboluyordu. Bu alanlar zaten "muhasebe fişi
                // fatura anındaki kuru ister, sonradan yeniden değerlemek yasak" diye
                // eklenmişti — silme kaydı da o denetim izinin parçası.
                invoice.CurrencyTypeId,
                invoice.ExchangeRate,
                invoice.RateSource,
                invoice.CampaignDiscount,
                invoice.CampaignDetailsJson,
                invoice.SalesmanCode,
                invoice.Description,
                invoice.InstallationName,
                invoice.InstallationPhone,
                invoice.SourceCustomerOfferId,
                invoice.SourcePurchaseInvoiceId,
                invoice.CreateUser,
                invoice.CreateTime,
                invoice.IsManuallyPaid,
                Lines = lines.Select(l => new
                {
                    l.SalesOrderLineId,
                    l.SourcePurchaseInvoiceLineId,
                    l.StockCode,
                    l.Description,
                    l.Quantity,
                    l.UnitPrice,
                    l.CurrencyTypeId,
                    l.CurrencyRate,
                    l.CurrencyUnitPrice,
                    l.VatRate,
                    l.LineNo,
                    // Kalemin ÇIKIŞ DEPOSU yedeğe de girer: fatura geri alındığında stok, çıktığı
                    // depoya birebir dönmeli. Yedekte olmazsa geri yükleme faturanın başlık
                    // deposuna düşer ve araç stoğu kalıcı olarak kayar.
                    l.WarehouseCode,
                    l.CreateUser,
                    l.CreateTime
                }).ToList(),
                CashTransactions = new List<object>(),
                BankTransactions = new List<object>(),
                CustomerLedgerEntries = ledgerEntries.Select(cle => new
                {
                    cle.CustomerCode,
                    cle.Date,
                    cle.DueDate,
                    cle.Direction,
                    cle.Amount,
                    cle.CurrencyTypeId,
                    cle.CurrencyRate,
                    cle.CurrencyAmount,
                    cle.DocumentNo,
                    cle.Description,
                    cle.TransactionType,
                    cle.DeliveryCustomerCode,
                    cle.ReferenceType,
                    cle.ReferenceId,
                    cle.CreateUser,
                    cle.CreateTime
                }).ToList(),
                SupplierLedgerEntries = supplierEntries.Select(sle => new
                {
                    sle.SupplierCode,
                    sle.Date,
                    sle.DueDate,
                    sle.Direction,
                    sle.Amount,
                    sle.CurrencyTypeId,
                    sle.CurrencyRate,
                    sle.CurrencyAmount,
                    sle.DocumentNo,
                    sle.Description,
                    sle.TransactionType,
                    sle.ReferenceType,
                    sle.ReferenceId,
                    sle.CreateUser,
                    sle.CreateTime
                }).ToList()
            };

            /*
              SİLME KAYDININ ETKİ NOTU — TAMİR FATURASI ALIŞ SANILMASIN (2026-08-28).

              `isPurchaseDerived` ServiceInvoice'ı ALIŞ tarafına koyuyor, çünkü `Type='H'` iki
              ayrı belgeyi birden temsil ediyor (bkz. [[fatura-niteligi-siniflandirma]]):
              `SourcePurchaseInvoiceId` doluysa HİZMET ALIŞI (gider), boşsa TAMİR FATURASI
              (servis geliri). Ayrım yalnızca o alanla yapılır — listeleme tarafı da öyle
              yapıyor (`canHizmet` / `canTamir` süzgeçleri).

              Etki notu bu ayrımı yapmıyordu: 2026-08-28'de silinen `A00000000066687` numaralı
              TAMİR faturasının kaydına "Alış Faturası silindiği için stok DÜŞTÜ, SATICI
              hareketleri silindi" yazıldı. İkisi de yanlıştı.

              DAVRANIŞ DOĞRUYDU, YALNIZCA METİN YANLIŞTI: `isPurchaseDerived`'a bağlı bütün
              işlemler ayrıca `sourcePurchaseId.HasValue` istiyor ve tamir faturasında o alan
              boş; müşteri ekstre satırı ise tipten bağımsız ana yoldan siliniyor. Yine de
              düzeltiliyor, çünkü YANLIŞ DENETİM İZİ yanlış teşhise yol açar — bu kayda bir ay
              sonra bakan biri stoğun bozulduğu sonucuna varır.
            */
            var isHizmetAlisi = invoice.Type == InvoiceType.ServiceInvoice
                                && invoice.SourcePurchaseInvoiceId.HasValue
                                && invoice.SourcePurchaseInvoiceId.Value > 0;
            var isTamirFaturasi = invoice.Type == InvoiceType.ServiceInvoice && !isHizmetAlisi;

            /*
              NOT YALNIZCA DOĞRULANMIŞ OLANI SÖYLER. İlk yazımda "işçilik kalemi stok tutmaz"
              deniyordu; bu yanlıştı. `TMR-SRVS` (TAMİR SERVİS) stok tutan bir ürün kartıdır ve
              hareket kaydında her tamir faturasıyla birlikte "Ürün Kartı güncellendi" etkisi
              görünüyor. Stok hareketleri tipten bağımsız olarak `DeleteStockMovementsForInvoice`
              ile geri alınır — not da bunu söylüyor.
            */
            var impactNote = isTamirFaturasi
                ? " [Etki: Tamir Faturası silindiği için ilgili cari hareketleri silindi ve kalemlerin stok hareketleri geri alındı.]"
                : isPurchaseDerived
                    ? " [Etki: Alış Faturası silindiği için ilgili ürünlerin stok miktarları düştü. İlişkili satıcı hareketleri silindi.]"
                    : " [Etki: Satış Faturası silindiği için ilgili ürünlerin stok miktarları arttı. İlişkili cari hareketleri silindi.]";

            _dbContext.Set<DeletionLog>().Add(new DeletionLog
            {
                ModuleKey = "invoice",
                PageKey = "faturaDokum",
                RecordType = "Fatura",
                RecordId = invoice.Id.ToString(),
                ParentType = null,
                ParentId = null,
                Description = $"Fatura silindi: {invoice.InvoiceNo}.{impactNote}",
                DetailsJson = JsonSerializer.Serialize(backupData),
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });

            _dbContext.Set<Invoice>().Remove(invoice);
            await _dbContext.SaveChangesAsync(cancellationToken);

            if (isPurchaseDerived && sourcePurchaseId.HasValue && purchase is not null)
            {
                if (purchase.Kind == PurchaseInvoiceKind.Purchase)
                {
                    purchase.TerminStatus = PurchaseInvoiceTerminStatus.Waiting;
                    foreach (var line in purchase.Lines)
                    {
                        line.WarehouseCode = null;
                    }
                    _dbContext.Set<PurchaseInvoice>().Update(purchase);

                    /*
                      EKSTRE DE SIFIRLANIR (2026-09-01 kullanıcı bildirimi).

                      Fatura dökümünden silme, alışı termine geri alıyordu ama tedarikçi
                      ekstresine "Teslim Edildi" anında yazılan satır yerinde kalıyordu:
                      mal gelmemiş, fatura yok, borç duruyor. Belge yeniden teslim
                      edildiğinde satır zaten yeniden yazılır (bkz.
                      PurchaseInvoicesController.SyncPurchaseInvoiceLedgerEntryAsync),
                      yani burada silmek veri kaybı değil, aynı kuralın karşılığıdır.

                      Ödeme satırlarına dokunulmaz; yardımcı onları dışarıda bırakıyor.
                    */
                    await PurchaseLedgerCleanup.RemoveLedgerEntriesForPurchaseAsync(
                        _dbContext, purchase.Id, purchase.DocumentNo, cancellationToken);

                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
                else
                {
                    _dbContext.Set<PurchaseInvoice>().Remove(purchase);
                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
            }

            // 5. Notify ServiceOps to delete the installations
            await NotifyServiceOpsForInstallationDeletion(invoice.InvoiceNo, cancellationToken);

            await transaction.CommitAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(cancellationToken);

            // EF's own message for a failed save is "See the inner exception for details", which
            // is exactly what the user was being shown — a sentence telling them to look at
            // something they cannot see. The chain is unwound here so the message names the
            // constraint that actually refused, which is the only part worth reading.
            var detail = DescribeException(ex);
            Console.WriteLine($"[Invoice Deletion Error]: {detail}");
            return StatusCode(500, new { success = false, message = "Fatura silinirken bir hata oluştu: " + detail });
        }

        // COMMIT'ten sonra: silme geri alınmışsa ServiceOps'a haber gitmemeli.
        //
        // SERVİS TARAFI İKİYE AYRILIR (kullanıcı kuralı, 2026-08-13):
        //  - MONTAJ: fatura silinince montaj zaten iptale düşüyor. O akış DOĞRU ve buradan
        //    yönetilmiyor (yukarıdaki `NotifyServiceOpsForInstallationDeletion`, olduğu yerde
        //    olduğu gibi bırakıldı — kullanıcı açıkça "montaj kısmının akışı doğru, orayı bozma"
        //    dedi).
        //  - ARIZA (saha / atölye): kayıt SİLİNMEZ, faturalama öncesindeki durumuna DÖNER —
        //    sahadaysa sahaya, atölyedeyse atölyeye. Arıza kaydı faturadan doğmaz, kendi başına
        //    yaşayan bir iştir; silinseydi cihazın servis geçmişi de yok olurdu.
        //    Aşağıdaki çağrı YALNIZCA bu ikinci durumu kapsıyor: bağ, servis faturası kesilirken
        //    yazılan `serviceRecordId` üzerinden kuruluyor ve montaj kayıtlarında o alan yok.
        await NotifyServiceOpsForEcommerceDeliveryRemovalAsync(ecommerceOrderNos, cancellationToken);
        await RevertServiceRecordAfterInvoiceDeletionAsync(linkedService, cancellationToken);

        return Ok(new { success = true });
    }

    /// <summary>
    /// Silinen faturanın bağlı olduğu servis kaydını bulur.
    ///
    /// Bağ, faturanın kalemlerinin geldiği SİPARİŞTE duruyor: servis faturası ServiceOps'tan
    /// gelirken `SalesOrder.CampaignDetailsJson` içine `serviceRecordId` / `serviceNumber` /
    /// `sourcePage` yazılıyor. Fatura kendi `CampaignDetailsJson`'ında da taşıyabiliyor (doğrudan
    /// oluşturulan servis faturaları), o yüzden iki kaynağa da bakılıyor.
    ///
    /// Kalemler silinmeden ÖNCE çağrılmalı — sonrasında sipariş satırına giden köprü kopuyor.
    /// </summary>
    private async Task<(string RecordId, string SourcePage)?> ResolveLinkedServiceRecordAsync(
        Invoice invoice,
        List<InvoiceLine> lines,
        CancellationToken cancellationToken)
    {
        static (string RecordId, string SourcePage)? ReadFrom(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object) return null;

                var recordId = root.TryGetProperty("serviceRecordId", out var idProp) ? idProp.GetString() : null;
                if (string.IsNullOrWhiteSpace(recordId))
                {
                    recordId = root.TryGetProperty("serviceNumber", out var noProp) ? noProp.GetString() : null;
                }
                if (string.IsNullOrWhiteSpace(recordId)) return null;

                var sourcePage = root.TryGetProperty("sourcePage", out var srcProp)
                    ? (srcProp.GetString() ?? "AtolyeAriza")
                    : "AtolyeAriza";

                return (recordId!, sourcePage);
            }
            catch
            {
                return null;
            }
        }

        var fromInvoice = ReadFrom(invoice.CampaignDetailsJson);
        if (fromInvoice is not null) return fromInvoice;

        var salesOrderLineIds = lines
            .Where(x => x.SalesOrderLineId.HasValue)
            .Select(x => x.SalesOrderLineId!.Value)
            .Distinct()
            .ToList();

        if (salesOrderLineIds.Count == 0) return null;

        var orderJsons = await _dbContext.Set<SalesOrderLine>()
            .AsNoTracking()
            .Where(x => salesOrderLineIds.Contains(x.Id))
            .Select(x => x.SalesOrder.CampaignDetailsJson)
            .ToListAsync(cancellationToken);

        foreach (var json in orderJsons)
        {
            var parsed = ReadFrom(json);
            if (parsed is not null) return parsed;
        }

        return null;
    }

    /// <summary>
    /// Fatura silindikten sonra servis kaydını faturalama öncesindeki durumuna döndürür.
    ///
    /// Kullanıcı kuralı (2026-08-13): "sipariş raporundan satış faturasını silersem, servisle
    /// ilgili bir işlem varsa o iş tamamlandı/gerçekleşti'den tekrar eski haline gelecek —
    /// sahadaysa sahada, atölyedeyse atölyede."
    ///
    /// Eskiden bu bildirim YALNIZCA sipariş taslağı silinirken (SalesOrdersController) gidiyordu;
    /// asıl faturanın silinmesi ServiceOps'a hiç haber verilmiyordu ve kayıt sonsuza kadar
    /// "faturalandı" durumunda kalıyordu — üstelik `IsInvoiced` damgası yüzünden bir daha
    /// faturalanamıyordu.
    ///
    /// Hangi duruma dönüleceğini ServiceOps biliyor (faturalama anında damgalıyor); burada
    /// yalnızca "fatura silindi" haberi veriliyor. Başarısızlık faturayı silmeyi GERİ ALMAZ:
    /// fatura zaten silindi, servis tarafının ulaşılamaması ikinci bir olaydır ve loglanır.
    /// </summary>
    private async Task RevertServiceRecordAfterInvoiceDeletionAsync(
        (string RecordId, string SourcePage)? link,
        CancellationToken cancellationToken)
    {
        if (link is null) return;

        try
        {
            var client = CreateServiceOpsClient();
            if (client is null) return;

            var body = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
            var res = await client.PostAsync(
                $"api/servicerecords/{Uri.EscapeDataString(link.Value.RecordId)}/revert-to-ready?sourcePage={Uri.EscapeDataString(link.Value.SourcePage)}",
                body,
                cancellationToken);

            if (!res.IsSuccessStatusCode)
            {
                var text = await res.Content.ReadAsStringAsync(cancellationToken);
                Console.WriteLine($"[ServiceOps Revert] {(int)res.StatusCode}: {text}");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ServiceOps Revert] error: {ex.Message}");
        }
    }

    [AtomicRequest]
    /// <summary>
    /// KALEM SİLME KAPATILDI (2026-08-26 · kullanıcı kararı).
    ///
    /// Kesilmiş fatura bir BELGEDİR: yarısı oyulmaz. Yanlış kalem varsa fatura TÜMÜYLE
    /// silinip yeniden kesilir; kontrol basımdan ÖNCE yapılır.
    ///
    /// GEREKÇE — bu uçla yapılan 4 silmenin 4'ü de cari ekstreyi bozdu:
    ///   • Son kalem silinince fatura kalkıyor, cari hareketi kalıyordu → öksüz borç
    ///     (SERVİS HİZMET, 3.100 TL: belge 100000000000016 ve 100000000000039).
    ///   • Kalem silinip fatura ayakta kalınca fatura küçülüyor, cari hareketi
    ///     küçülmüyordu → fazla borç (MEHMET KOYUNCU, 8.480 TL: belge 100000000000019).
    /// Ayrıca tam silme `DeletionLogs`'a faturanın TAMAMINI yazar (kalemler + cari
    /// hareketleri + ödemeler); kalem silme yalnız o kalemi yazıyordu.
    ///
    /// Arayüzdeki "Sil" düğmesi de kaldırıldı (`InvoiceListPage`). Bu kapı, eski sekmeyle
    /// ya da doğrudan istekle gelinmesine karşı duruyor.
    ///
    /// AŞAĞIDAKİ GÖVDE BİLEREK SİLİNMEDİ: iki hata da içinde düzeltildi. Bu yol ileride
    /// yeniden açılırsa hatalar birlikte geri gelmesin diye duruyor.
    /// </summary>
    [HttpDelete("{invoiceId:int}/lines/{invoiceLineId:int}")]
    [AuthorizePage("invoice", "faturaDokum")]
    public async Task<IActionResult> DeleteInvoiceLine([FromRoute] int invoiceId, [FromRoute] int invoiceLineId, CancellationToken cancellationToken)
    {
        return BadRequest(new
        {
            success = false,
            message = "Fatura kalemi tek tek silinemez. Faturada yanlış varsa faturanın TAMAMINI silip yeniden kesin."
        });

#pragma warning disable CS0162 // Ulaşılamayan kod — yukarıdaki kapı bilerek kondu, gövde referans olarak duruyor.
        var invoice = await _dbContext.Set<Invoice>()
            .FirstOrDefaultAsync(x => x.Id == invoiceId, cancellationToken);

        if (invoice is null)
        {
            return NotFound(new { success = false, message = "Fatura bulunamadı" });
        }

        var line = await _dbContext.Set<InvoiceLine>()
            .FirstOrDefaultAsync(x => x.Id == invoiceLineId && x.InvoiceId == invoiceId, cancellationToken);

        if (line is null)
        {
            return NotFound(new { success = false, message = "Fatura kalemi bulunamadı" });
        }

        // Genel Ayarlar Fatura Silme Kilit Tarihi Kontrolü (Diğer tüm yetki/silme kurallarını ezer)
        var lockDateLine = await _dbContext.Set<JwtSessionSetting>()
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => x.InvoiceDeleteLockDate)
            .FirstOrDefaultAsync(cancellationToken);

        if (lockDateLine.HasValue && invoice.Date.Date < lockDateLine.Value.Date)
        {
            return BadRequest(new { success = false, message = $"Fatura tarihi ({invoice.Date:dd.MM.yyyy}), Genel Ayarlar'da belirlenen silme kilit tarihinden ({lockDateLine.Value:dd.MM.yyyy}) önce olduğu için bu fatura kalemi silinemez." });
        }

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var lineDetails = new
        {
            invoiceId = invoice.Id,
            invoiceNo = invoice.InvoiceNo,
            invoiceLineId = line.Id,
            salesOrderLineId = line.SalesOrderLineId,
            sourcePurchaseInvoiceLineId = line.SourcePurchaseInvoiceLineId,
            stockCode = line.StockCode,
            description = line.Description,
            qty = line.Quantity,
            unitPrice = line.UnitPrice,
            currencyTypeId = line.CurrencyTypeId,
            currencyRate = line.CurrencyRate,
            currencyUnitPrice = line.CurrencyUnitPrice,
            vatRate = line.VatRate,
            lineNo = line.LineNo,
            createUser = line.CreateUser,
            createTime = line.CreateTime
        };

        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "invoice",
            PageKey = "faturaDokum",
            RecordType = "FaturaKalemi",
            RecordId = line.Id.ToString(),
            ParentType = "Fatura",
            ParentId = invoice.Id.ToString(),
            Description = $"Fatura kalemi silindi: {invoice.InvoiceNo} / {line.StockCode} / {line.Quantity}",
            DetailsJson = JsonSerializer.Serialize(lineDetails),
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        });

        var sourcePurchaseLineId = line.SourcePurchaseInvoiceLineId;
        var sourcePurchaseInvoiceId = invoice.SourcePurchaseInvoiceId;
        var isPurchaseDerived = invoice.Type == InvoiceType.PurchaseInvoice
                               || invoice.Type == InvoiceType.ServiceInvoice
                               || invoice.Type == InvoiceType.ReturnInvoice;

        // Kalem silinince o kalemin montajları da düşer. Kimlikler ServiceOps'a haber vermek için
        // ÖNCE toplanır: kalem silindikten sonra bağ koptuğu için bir daha bulunamazlar.
        // Sipariş akışından gelen montaj kaleme değil sipariş satırına bağlı olduğu için
        // aşağıdaki pasifleştirme sorgusuna takılmıyor; ServiceOps'a bildirim ise ikisini de kapsar.
        var montajIdsToRemove = (await CollectInstallationsForLinesAsync(new List<InvoiceLine> { line }, cancellationToken))
            .Select(x => x.Id)
            .ToList();

        // Aynı gerekçe teslimat için de geçerli: bağ kalemle birlikte gidiyor.
        var ecommerceOrderNos = await CollectEcommerceOrderNosAsync(new List<InvoiceLine> { line }, cancellationToken);

        // Deactivate associated installations
        var installationsToDeactivate = await _dbContext.Set<Installation>()
            .Where(x => (x.InvoiceLineId == line.Id || (line.LineageId.HasValue && x.LineageId == line.LineageId.Value)) && x.Status != "Pasif / İptal" && x.Status != "Pasif / Geri Alındı")
            .ToListAsync(cancellationToken);

        foreach (var inst in installationsToDeactivate)
        {
            inst.Status = "Pasif / İptal";
            inst.EditUser = username;
            inst.EditTime = DateTime.UtcNow;
        }

        _dbContext.Set<InvoiceLine>().Remove(line);

        await DeleteStockMovementsForInvoiceLine(invoice.InvoiceNo, line.LineNo, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Sync single deletion to ServiceOps
        foreach (var montajId in montajIdsToRemove)
        {
            await NotifyServiceOpsForInstallationRemoval(montajId, cancellationToken);
        }

        if (isPurchaseDerived && sourcePurchaseLineId.HasValue && sourcePurchaseInvoiceId.HasValue)
        {
            var purchase = await _dbContext.Set<PurchaseInvoice>()
                .Include(x => x.Lines)
                .FirstOrDefaultAsync(x => x.Id == sourcePurchaseInvoiceId.Value, cancellationToken);

            if (purchase is not null)
            {
                var pline = purchase.Lines.FirstOrDefault(x => x.Id == sourcePurchaseLineId.Value);
                if (pline is not null)
                {
                    _dbContext.Set<PurchaseInvoiceLine>().Remove(pline);
                    purchase.Lines.Remove(pline);
                    await _dbContext.SaveChangesAsync(cancellationToken);
                }

                // Recompute purchase totals based on remaining lines (mirror behavior)
                decimal pSubtotal = 0m;
                decimal pDiscountTotal = 0m;
                decimal pNetTotal = 0m;
                decimal pVatTotal = 0m;

                foreach (var l in purchase.Lines.OrderBy(x => x.LineNo))
                {
                    var baseTotal = l.Quantity * l.UnitPrice;
                    var disc = 0m;
                    // Tutar iskontosu ADET BAŞINADIR — qty ile çarpılmazsa iskonto olması
                    // gerekenin 1/qty'si kadar düşer (2026-09-10, PurchaseInvoiceMath.Satir ile aynı hata).
                    if (l.DiscountType == PurchaseInvoiceLineDiscountType.Amount) disc = Math.Max(0m, l.DiscountValue * l.Quantity);
                    if (l.DiscountType == PurchaseInvoiceLineDiscountType.Percentage) disc = Math.Max(0m, (baseTotal * l.DiscountValue) / 100m);
                    if (disc > baseTotal) disc = baseTotal;

                    var net = baseTotal - disc;
                    var vat = purchase.VatExempt ? 0m : (net * l.VatRate) / 100m;

                    pSubtotal += baseTotal;
                    pDiscountTotal += disc;
                    pNetTotal += net;
                    pVatTotal += vat;
                }

                purchase.Subtotal = Math.Max(0m, pSubtotal);
                purchase.DiscountTotal = Math.Max(0m, pDiscountTotal);
                purchase.NetTotal = Math.Max(0m, pNetTotal);
                purchase.VatTotal = Math.Max(0m, pVatTotal);
                purchase.GrandTotal = purchase.VatExempt ? purchase.NetTotal : purchase.NetTotal + purchase.VatTotal;
                purchase.EditUser = User.Identity?.Name ?? "System";
                purchase.EditTime = DateTime.UtcNow;

                await _dbContext.SaveChangesAsync(cancellationToken);
            }
        }

        var remaining = await _dbContext.Set<InvoiceLine>()
            .Where(x => x.InvoiceId == invoiceId)
            .OrderBy(x => x.LineNo)
            .ToListAsync(cancellationToken);

        if (remaining.Count == 0)
        {
            // Son kalem de silindi → fatura kalkıyor. CARİ HAREKETİ DE BİRLİKTE GİTMELİ.
            //
            // Buradaki eksiklik canlıda 3.100 TL'lik öksüz borç bıraktı (2026-08-26):
            // SERVİS HİZMET carisinde iki fatura (100000000000016 · 100000000000039)
            // kalem kalem silinmiş, faturalar kalkmış, ekstre satırları yerinde kalmıştı.
            // Müşteri, karşılığı olmayan bir borçla görünüyordu.
            //
            // Süzgeç `DeleteInvoice`'takinin (bkz. ~6137) AYNISI: yalnız faturanın KENDİ
            // borç/alacak satırı silinir; Kasa/Banka/POS/Çek-Senet satırları TAHSİLATTIR,
            // faturayla birlikte silinemez — para gerçekten alınmıştır.
            var lineDeleteLedgerEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                            && x.ReferenceId == invoice.Id
                            && x.TransactionType != "Kasa"
                            && x.TransactionType != "Banka"
                            && x.TransactionType != "POS"
                            && x.TransactionType != "Çek/Senet")
                .ToListAsync(cancellationToken);

            if (lineDeleteLedgerEntries.Count > 0)
            {
                _dbContext.CustomerLedgerEntries.RemoveRange(lineDeleteLedgerEntries);
            }

            _dbContext.Set<Invoice>().Remove(invoice);
            await _dbContext.SaveChangesAsync(cancellationToken);
            await NotifyServiceOpsForInstallationDeletion(invoice.InvoiceNo, cancellationToken);
            await NotifyServiceOpsForEcommerceDeliveryRemovalAsync(ecommerceOrderNos, cancellationToken);
            return Ok(new { success = true, deletedInvoice = true });
        }

        // Resequence line numbers
        for (var i = 0; i < remaining.Count; i++)
        {
            remaining[i].LineNo = i + 1;
        }

        // Recompute totals keeping existing discount amount (clamped)
        var subtotal = remaining.Sum(x => x.Quantity * x.UnitPrice);
        var discount = invoice.Discount;
        if (discount < 0) discount = 0;
        if (subtotal > 0 && discount > subtotal) discount = subtotal;

        var netTotal = subtotal - discount;
        var discountRatio = subtotal > 0 ? (discount / subtotal) : 0m;

        // `discountRatio` yukarıda ZATEN hesaplanıyordu ama hiç kullanılmıyordu — düzeltme
        // yarım bırakılmış. KDV matrahı artık iskontolu tutar.
        var vatTotal = decimal.Round(remaining.Sum(x =>
        {
            var baseTotal = x.Quantity * x.UnitPrice;
            return baseTotal * (1m - discountRatio) * (x.VatRate / 100m);
        }), 2, MidpointRounding.AwayFromZero);

        var grandTotal = netTotal + vatTotal;

        var previousGrandTotal = invoice.GrandTotal;

        invoice.Subtotal = subtotal;
        invoice.Discount = discount;
        invoice.NetTotal = netTotal;
        invoice.VatTotal = vatTotal;
        invoice.GrandTotal = grandTotal;

        // Fatura küçüldü → CARİ HAREKETİ DE KÜÇÜLMELİ.
        //
        // Bu eksiklik canlıda 8.480 TL'lik fazla borç bıraktı (2026-08-26): fatura
        // 100000000000019'dan 8.480'lik kalem silinmiş, fatura 33.920 → 25.440 düşmüş,
        // ekstre 33.920'de kalmıştı. Müşteri karşılığı olmayan bir borcu taşıyordu.
        //
        // Süzgeç `DeleteInvoice`'takiyle (~6137) aynı: yalnız faturanın KENDİ borç satırı.
        // Kasa/Banka/POS/Çek-Senet satırları TAHSİLATTIR — fatura küçüldü diye küçültülemez,
        // para gerçekten alınmıştır.
        //
        // Tutar ORANLA ölçeklenir, yeniden TÜRETİLMEZ: `Amount` TL çapası, `CurrencyAmount`
        // dövizli değerdir ve üçlü `CurrencyAmount × CurrencyRate = Amount` eşitliğini tutmak
        // zorundadır (bkz. `CreateSalesInvoice`'taki uzun yorum). Bölme/çarpmayla yeniden
        // hesaplamak kuruş kaydırıyor; oran üç alanı da aynı anda ve tutarlı taşır.
        if (previousGrandTotal > 0m && Math.Abs(grandTotal - previousGrandTotal) > 0.001m)
        {
            var invoiceLedgerEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                            && x.ReferenceId == invoice.Id
                            && x.TransactionType != "Kasa"
                            && x.TransactionType != "Banka"
                            && x.TransactionType != "POS"
                            && x.TransactionType != "Çek/Senet")
                .ToListAsync(cancellationToken);

            var ledgerRatio = grandTotal / previousGrandTotal;

            foreach (var ledgerEntry in invoiceLedgerEntries)
            {
                ledgerEntry.Amount = decimal.Round(ledgerEntry.Amount * ledgerRatio, 2, MidpointRounding.AwayFromZero);
                ledgerEntry.CurrencyAmount = decimal.Round(ledgerEntry.CurrencyAmount * ledgerRatio, 2, MidpointRounding.AwayFromZero);
                ledgerEntry.PaymentCurrencyAmount = decimal.Round(ledgerEntry.PaymentCurrencyAmount * ledgerRatio, 2, MidpointRounding.AwayFromZero);
                ledgerEntry.EditUser = username;
                ledgerEntry.EditTime = DateTime.UtcNow;
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Fatura duruyor ama silinen kalem o siparişin son kalemi olabilir.
        await NotifyServiceOpsForEcommerceDeliveryRemovalAsync(ecommerceOrderNos, cancellationToken);

        return Ok(new { success = true });
#pragma warning restore CS0162
    }

    private async Task CreateSalesInvoiceStockMovements(
        Invoice invoice,
        List<InvoiceLine> lines,
        decimal totalDiscount,
        decimal subtotal,
        int warehouseCode,
        HashSet<int> consignmentOrderLineIds,
        CancellationToken cancellationToken)
    {
        var invNo = (invoice.InvoiceNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(invNo)) return;

        var username = User.Identity?.Name ?? "System";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var ratio = subtotal > 0m ? (totalDiscount / subtotal) : 0m;
        if (ratio < 0m) ratio = 0m;
        if (ratio > 1m) ratio = 1m;

        var date = invoice.Date;
        if (date.Kind != DateTimeKind.Utc)
        {
            date = DateTime.SpecifyKind(date, DateTimeKind.Utc);
        }

        // HİZMET KARTLI SATIR STOK HAREKETİ YAZMAZ. Montaj bedeli gibi tutarlar stoksuz bir
        // hizmet ürünü (MONTAJ-BEDELI, ProductType=HIZMET) üzerinden faturalanıyor; o satır
        // envanterden mal çıkışı değildir. Kartı olmayan serbest-metin satırına dokunulmaz —
        // yalnız kartı AÇIKÇA hizmet tipinde olanlar atlanır (bugün başka hiçbir üründe yok).
        var lineStockCodes = lines
            .Select(x => (x.StockCode ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var serviceTypeStockCodes = lineStockCodes.Count == 0
            ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            : (await _dbContext.Products.AsNoTracking()
                    .Where(p => lineStockCodes.Contains(p.StockCode))
                    .Select(p => new { p.StockCode, p.ProductType })
                    .ToListAsync(cancellationToken))
                .Where(p => B2B.Erp.Api.Core.Accounting.InvoiceLineNatureResolver.IsServiceProductType(p.ProductType))
                .Select(p => p.StockCode)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var movements = new List<StockMovement>();
        foreach (var l in lines.OrderBy(x => x.LineNo))
        {
            if (l.SalesOrderLineId.HasValue && consignmentOrderLineIds.Contains(l.SalesOrderLineId.Value))
            {
                continue;
            }

            if (serviceTypeStockCodes.Contains((l.StockCode ?? string.Empty).Trim()))
            {
                continue;
            }

            var qty = l.Quantity;
            var unitPrice = l.UnitPrice;
            var netUnitPrice = unitPrice * (1m - ratio);

            movements.Add(new StockMovement
            {
                InvoiceNo = invNo,
                CustomerCode = invoice.CustomerCode ?? string.Empty,
                DeliveryCustomerCode = invoice.DeliveryCustomerCode ?? string.Empty,
                StockCode = l.StockCode,
                Direction = StockMovementDirection.Out,
                Quantity = qty,
                UnitPrice = unitPrice,
                NetUnitPrice = netUnitPrice,
                VatRate = l.VatRate,
                BagNo = string.Empty,
                SalesmanCode = invoice.SalesmanCode,
                // Hareket KALEMİN deposuna yazılır; kalem depo taşımıyorsa faturanın başlık
                // deposuna düşülür (eski davranış). Fatura silinirken iade de bu hareketin
                // deposundan geri alınıyor, yani stok gittiği yere birebir dönüyor.
                WarehouseCode = l.WarehouseCode ?? warehouseCode,
                Delivered = true,
                Date = date,
                LineNo = l.LineNo,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });
        }

        if (movements.Count > 0)
        {
            _dbContext.Set<StockMovement>().AddRange(movements);
        }

        await Task.CompletedTask;
        _ = cancellationToken;
    }

    private async Task DeleteStockMovementsForInvoice(string invoiceNo, CancellationToken cancellationToken)
    {
        var invNo = (invoiceNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(invNo)) return;

        var existing = await _dbContext.Set<StockMovement>()
            .Where(x => x.InvoiceNo == invNo)
            .ToListAsync(cancellationToken);

        if (existing.Count > 0)
        {
            _dbContext.Set<StockMovement>().RemoveRange(existing);
        }
    }

    private async Task DeleteStockMovementsForInvoiceLine(string invoiceNo, int lineNo, CancellationToken cancellationToken)
    {
        var invNo = (invoiceNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(invNo)) return;

        var existing = await _dbContext.Set<StockMovement>()
            .Where(x => x.InvoiceNo == invNo && x.LineNo == lineNo)
            .ToListAsync(cancellationToken);

        if (existing.Count > 0)
        {
            _dbContext.Set<StockMovement>().RemoveRange(existing);
        }
    }

    /// <summary>
    /// ServiceOps'taki montaj kalemini B2B <see cref="Installation"/> kaydına bağlayan dış anahtar.
    ///
    /// Bu anahtar olmadan iki taraf birbirini yalnızca "fatura no + ürün adı" ile eşleştirebiliyordu:
    /// aynı faturada aynı üründen iki montaj varsa biri diğerini eziyor, ürün adı ERP'de değişince
    /// hiçbiri bulunamıyordu. Artık montajın kimliği taşınıyor; ServiceOps aynı anahtarı ikinci kez
    /// görünce kopya açmak yerine kalemi günceller.
    /// </summary>
    private static string InstallationExternalRef(int installationId) => $"B2B-INST-{installationId}";

    private static bool IsActiveInstallation(Installation x)
        => x.Status != "Pasif / İptal" && x.Status != "Pasif / Geri Alındı";

    /// <summary>
    /// ServiceOps'a giden istemciyi kurar. HttpContext'e (Request/User) yalnızca burada, yani
    /// istek iş parçacığında dokunulur — dönen istemci arka plan görevine güvenle taşınabilir.
    /// Firma kodu çözülemezse null döner: başlıksız istek ServiceOps'ta varsayılan tenant'a
    /// düşer ve montaj yanlış veritabanına yazılırdı.
    /// </summary>
    private HttpClient? CreateServiceOpsClient()
    {
        var tenantCode = Request.Headers["X-Tenant-Code"].FirstOrDefault()
            ?? User.FindFirst("TenantCode")?.Value
            ?? User.FindFirst("tenantCode")?.Value
            ?? _tenantResolver.GetCurrentTenantCode();

        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            Console.WriteLine("[ServiceOps Webhook] Error: tenantCode is empty. Cannot send webhook.");
            return null;
        }

        var client = _httpClientFactory.CreateClient();
        client.BaseAddress = new Uri(_configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5100");

        // ServiceOps tarafindaki bu uclar artik kimlik istiyor: eskiden [AllowAnonymous] idi ve
        // agdan erisen herkes montaj kaydi olusturup fatura no ile silebiliyordu.
        var soKey = _configuration["ServiceOps:InternalApiKey"];
        if (!string.IsNullOrWhiteSpace(soKey)) client.DefaultRequestHeaders.Add("X-ServiceOps-Key", soKey);

        var authHeader = Request.Headers["Authorization"].FirstOrDefault();
        if (!string.IsNullOrEmpty(authHeader)) client.DefaultRequestHeaders.Add("Authorization", authHeader);

        client.DefaultRequestHeaders.Add("X-Tenant-Code", tenantCode);
        return client;
    }

    /// <summary>
    /// Verilen fatura kalemlerine ait AKTİF montajları ServiceOps'a gönderir.
    ///
    /// Montaj iki ayrı yoldan doğabiliyor ve eskiden yalnızca birincisi taranıyordu:
    ///  1. Sipariş akışı — `SalesOrderLine.InstallationId`
    ///  2. Fatura dökümü — montaj doğrudan fatura kalemine bağlanır (`Installation.InvoiceLineId`)
    /// İkincisi hiç gönderilmediği için fatura dökümünden girilen montajlar ServiceOps'a düşmüyordu.
    ///
    /// Gönderim montaj başına yapılır, kalem başına değil: bir fatura kaleminde farklı adreslere
    /// birden çok montaj olabilir.
    /// </summary>
    private async Task NotifyServiceOpsForInstallations(Invoice invoice, List<InvoiceLine> lines, CancellationToken ct)
    {
        try
        {
            var installations = await CollectInstallationsForLinesAsync(lines, ct);
            Console.WriteLine($"[ServiceOps Webhook] Found {installations.Count} installations across {lines.Count} invoice lines.");
            if (installations.Count == 0) return;

            await SendInstallationsToServiceOpsAsync(invoice, installations, ct);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ServiceOps Webhook Error]: {ex.Message}");
        }
    }

    /// <summary>
    /// Bir fatura kalemine bağlı aktif montajları her iki bağlantı yolundan toplar
    /// (sipariş satırı üzerinden ve doğrudan fatura kalemi / soy kimliği üzerinden).
    /// </summary>
    private async Task<List<Installation>> CollectInstallationsForLinesAsync(List<InvoiceLine> lines, CancellationToken ct)
    {
        var lineIds = lines.Select(x => x.Id).Where(x => x > 0).Distinct().ToList();
        var lineageIds = lines.Where(x => x.LineageId.HasValue).Select(x => x.LineageId!.Value).Distinct().ToList();

        var sourceLineIds = lines
            .Where(x => x.SalesOrderLineId.HasValue)
            .Select(x => x.SalesOrderLineId!.Value)
            .Distinct()
            .ToList();

        var orderInstallationIds = sourceLineIds.Count == 0
            ? new List<int>()
            : await _dbContext.Set<SalesOrderLine>()
                .AsNoTracking()
                .Where(x => sourceLineIds.Contains(x.Id) && x.InstallationId.HasValue)
                .Select(x => x.InstallationId!.Value)
                .Distinct()
                .ToListAsync(ct);

        var found = await _dbContext.Set<Installation>()
            .AsNoTracking()
            .Where(x => orderInstallationIds.Contains(x.Id)
                        || (x.InvoiceLineId.HasValue && lineIds.Contains(x.InvoiceLineId.Value))
                        || (x.LineageId.HasValue && lineageIds.Contains(x.LineageId.Value)))
            .ToListAsync(ct);

        return found
            .Where(IsActiveInstallation)
            .GroupBy(x => x.Id)
            .Select(g => g.First())
            .ToList();
    }

    /// <summary>
    /// Montajları ServiceOps'a POST'lar. Yavaş olan HTTP kısmı arka plana alınır; istemci ve
    /// gövdeler istek iş parçacığında hazırlanır.
    /// </summary>
    private async Task SendInstallationsToServiceOpsAsync(Invoice invoice, List<Installation> installations, CancellationToken ct)
    {
        var client = CreateServiceOpsClient();
        if (client is null) return;

        var stockCodes = installations
            .Select(x => x.ProductName)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct()
            .ToList();

        // Montajın ProductName'i çoğu kayıtta stok kodudur; ürün tablosundan okunabiliyorsa
        // ServiceOps'a okunabilir adı gönderilir, kod da ayrı alanda taşınır.
        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode))
            .Select(x => new { x.StockCode, x.Name })
            .ToDictionaryAsync(x => x.StockCode, x => x.Name, ct);

        var dealerName = await _dbContext.Customers
            .Where(c => c.CustomerCode == invoice.CustomerCode)
            .Select(c => c.Name)
            .FirstOrDefaultAsync(ct) ?? string.Empty;

        var payloads = installations.Select(inst =>
        {
            products.TryGetValue(inst.ProductName ?? string.Empty, out var resolvedName);

            return new
            {
                DealerCode = FirstNonEmpty(inst.DealerCode, invoice.CustomerCode),
                DealerName = FirstNonEmpty(inst.DealerName, dealerName, invoice.CustomerCode),
                ProductName = FirstNonEmpty(resolvedName, inst.ProductName, "-"),
                ProductStockCode = string.IsNullOrWhiteSpace(resolvedName) ? null : inst.ProductName,
                Quantity = inst.Quantity <= 0 ? 1m : inst.Quantity,
                CustomerName = FirstNonEmpty(inst.InstallationName, invoice.InstallationName, "Müşteri Adı Belirtilmedi"),
                Phone = FirstNonEmpty(inst.InstallationPhone, invoice.InstallationPhone, "Belirtilmedi"),
                Address = FirstNonEmpty(inst.Address, invoice.Description, "Adres Belirtilmedi"),
                Region = FirstNonEmpty(inst.Region, "Merkez"),
                // Fatura izini ServiceOps kendisi ekliyor; buradan da eklenirse açıklamada iki kez çıkar.
                Note = inst.DealerDescription,
                InvoiceNo = invoice.InvoiceNo,
                ExternalRef = InstallationExternalRef(inst.Id),
                Type = "Montaj"
            };
        }).ToList();

        _ = Task.Run(async () =>
        {
            try
            {
                using (client)
                {
                    foreach (var payload in payloads)
                    {
                        var response = await client.PostAsJsonAsync("api/montaj", payload);
                        Console.WriteLine($"[ServiceOps Webhook] POST api/montaj ({payload.ExternalRef}) → {(int)response.StatusCode}");
                        if (!response.IsSuccessStatusCode)
                        {
                            Console.WriteLine($"[ServiceOps Webhook Error] {await response.Content.ReadAsStringAsync()}");
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ServiceOps Webhook Background Task Error]: {ex.Message}");
            }
        });
    }

    /// <summary>Fatura tümüyle silindiğinde o faturanın bütün montajlarını ServiceOps'tan düşürür.</summary>
    private async Task NotifyServiceOpsForInstallationDeletion(string invoiceNo, CancellationToken ct)
    {
        try
        {
            using var client = CreateServiceOpsClient();
            if (client is null) return;

            var response = await client.DeleteAsync($"api/montaj/invoice/{Uri.EscapeDataString(invoiceNo)}", ct);
            Console.WriteLine($"[ServiceOps Webhook] DELETE api/montaj/invoice/{invoiceNo} → {(int)response.StatusCode}");
            if (!response.IsSuccessStatusCode)
            {
                Console.WriteLine($"[ServiceOps Webhook Error] ServiceOps montaj silme hatası: {await response.Content.ReadAsStringAsync(ct)}");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ServiceOps Webhook Error]: {ex.Message}");
        }
    }

    /// <summary>
    /// Tek bir montajı ServiceOps'tan düşürür.
    ///
    /// Eskiden bu iş "faturanın o ürüne ait montajlarını sil, sonra hepsini yeniden gönder"
    /// şeklindeydi. Silme ürün ADINA bakıyordu (aynı üründen iki montaj varsa ikisini birden
    /// siliyordu) ve yeniden oluşturma ServiceOps'taki planlama/teknisyen atamasını her
    /// düzenlemede sıfırlıyordu. Artık yalnızca hedef montaj, kimliğiyle düşürülür.
    /// </summary>
    /// <summary>
    /// Servisten gelen fiyatlara uygulanan KDV oranı. Serviste girilen tutar KDV DAHİLDİR.
    /// </summary>
    private const decimal ServiceVatRate = 16m;

    /// <summary>
    /// KDV DAHİL bir tutarı net ve KDV olarak ayırır: 1160 @ %16 → (1000,00 ; 160,00).
    ///
    /// Net önce yuvarlanıp KDV FARKTAN bulunuyor; tersi yapılıp ikisi ayrı ayrı yuvarlansaydı
    /// net + KDV toplamı girilen tutarı bir kuruş şaşırabilirdi. Müşteriden tahsil edilecek
    /// tutar girilen tutardır, faturanın genel toplamı ona birebir oturmalı.
    /// </summary>
    private static (decimal Net, decimal Vat) SplitVatInclusive(decimal grossAmount, decimal vatRate)
    {
        if (vatRate <= 0m) return (grossAmount, 0m);

        var net = Math.Round(grossAmount / (1m + (vatRate / 100m)), 2, MidpointRounding.AwayFromZero);
        return (net, grossAmount - net);
    }

    private async Task NotifyServiceOpsForInstallationRemoval(int installationId, CancellationToken ct)
    {
        try
        {
            using var client = CreateServiceOpsClient();
            if (client is null) return;

            var reference = InstallationExternalRef(installationId);
            var response = await client.DeleteAsync($"api/montaj/external/{Uri.EscapeDataString(reference)}", ct);
            Console.WriteLine($"[ServiceOps Webhook] DELETE api/montaj/external/{reference} → {(int)response.StatusCode}");
            if (!response.IsSuccessStatusCode)
            {
                Console.WriteLine($"[ServiceOps Webhook Error] {await response.Content.ReadAsStringAsync(ct)}");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ServiceOps Webhook Error]: {ex.Message}");
        }
    }


    /// <summary>
    /// E-ticaret siparişini bayi siparişinden ayıran işaret (<see cref="SalesOrder.ProcessedBy"/>).
    /// Fatura tipine bakılamaz: e-ticaret faturası da bayi faturası da <c>FATURA</c> tipindedir ve
    /// o alan muhasebe satış raporunu yönlendirdiği için etiket olarak kullanılamaz.
    /// </summary>
    private const string EcommerceOrderMarker = "ETICARET";

    /// <summary>
    /// E-ticaret siparişi faturalandığında ServiceOps'taki teslimat (kargo) kaydını GÜNCELLER.
    ///
    /// NE DEĞİŞTİ (2026-09-09): kayıt artık burada AÇILMIYOR, ödeme onaylandığı anda açılıyor
    /// (<see cref="B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService.CreateCargoTaskAsync"/>).
    /// Müşterinin isteği "satın alma tamamlanınca kayıt düşsün, fatura kesilince aşamalar
    /// yürüsün" idi; eski hâlde parası alınmış siparişin teslimat tarafında hiçbir izi yoktu.
    ///
    /// Burada yapılan tek şey aynı kaydı FATURA NUMARASIYLA tazelemek. Kayıt yoksa (ödeme
    /// adımı atlanmış eski sipariş, ya da o an ServiceOps'a ulaşılamamış) bu çağrı onu açar —
    /// yani eski davranış da korunuyor.
    ///
    /// TEK KOD YOLU: paket dökümü, montajlı satırların hariç tutulması ve adres seçimi
    /// e-ticaret tarafında tek yerde duruyor. Burada ikinci bir gövde kurulsaydı, iki yol
    /// ilk değişiklikte ayrışır ve faturadan sonra kuryenin gördüğü döküm başkalaşırdı.
    /// </summary>
    private async Task NotifyServiceOpsForEcommerceDeliveryAsync(Invoice invoice, List<InvoiceLine> lines, CancellationToken ct)
    {
        try
        {
            var orderNos = await CollectEcommerceOrderNosAsync(lines, ct);
            if (orderNos.Count == 0) return;

            foreach (var orderNo in orderNos)
            {
                await _ecommerceFulfilment.CreateCargoTaskAsync(orderNo, invoice.InvoiceNo, ct);
            }
        }
        catch (Exception ex)
        {
            // Fatura kesildi, stok düştü ve muhasebeye işlendi; teslimat kaydı güncellenemedi
            // diye fatura geri alınmaz. Kayıt ServiceOps ekranından elle de düzenlenebiliyor.
            Console.WriteLine($"[ServiceOps Webhook Error]: {ex.Message}");
        }
    }

    /// <summary>
    /// Verilen fatura kalemlerinin dokunduğu E-TİCARET sipariş numaraları.
    ///
    /// Silme akışlarında kalemler kaldırılmadan ÖNCE çağrılmalı: kalem gidince fatura ile sipariş
    /// arasındaki bağ (<c>InvoiceLine.SalesOrderLineId</c>) da gider ve hangi teslimatın
    /// etkilendiği bir daha bulunamaz.
    /// </summary>
    private async Task<List<string>> CollectEcommerceOrderNosAsync(List<InvoiceLine> lines, CancellationToken ct)
    {
        var orderLineIds = lines
            .Where(x => x.SalesOrderLineId.HasValue)
            .Select(x => x.SalesOrderLineId!.Value)
            .Distinct()
            .ToList();

        if (orderLineIds.Count == 0) return new List<string>();

        return await _dbContext.Set<SalesOrderLine>()
            .AsNoTracking()
            .Where(l => orderLineIds.Contains(l.Id))
            .Join(_dbContext.Set<SalesOrder>().AsNoTracking(),
                l => l.SalesOrderId, o => o.Id,
                (l, o) => new { o.OrderNo, o.ProcessedBy })
            .Where(x => x.ProcessedBy.ToUpper() == EcommerceOrderMarker)
            .Select(x => x.OrderNo)
            .Distinct()
            .ToListAsync(ct);
    }

    /// <summary>
    /// Faturası kalmayan e-ticaret siparişlerinin teslimat kaydını ServiceOps'tan düşürür.
    ///
    /// SİPARİŞ BAŞINA KARAR VERİLİR, FATURA BAŞINA DEĞİL. Bir siparişten kısmi sevkiyatla birden
    /// çok fatura çıkabiliyor; birini silmek teslimatın tamamının iptali anlamına gelmez. Bu yüzden
    /// silmeden önce "bu siparişin başka faturası kaldı mı" diye bakılır ve yalnızca hiç kalmadıysa
    /// kayıt düşürülür. Teslimat kaydı da zaten sipariş numarasına bağlı, fatura numarasına değil.
    ///
    /// DİKKAT — bu geri alınamaz: kayıt silinince teslim kanıtı (alıcı adı, imza fotoğrafı, konum)
    /// ve tarihçe de gider. Yola çıkmış bir teslimatın faturası silinirse saha bunu haber almaz.
    /// Müşteri bu davranışı bilerek istedi; durum kontrolü (teslim edilmişse koru) bilinçli olarak
    /// KONMADI.
    /// </summary>
    private async Task NotifyServiceOpsForEcommerceDeliveryRemovalAsync(List<string> orderNos, CancellationToken ct)
    {
        if (orderNos.Count == 0) return;

        try
        {
            var orphaned = new List<string>();

            foreach (var orderNo in orderNos)
            {
                var orderLineIds = await _dbContext.Set<SalesOrder>()
                    .AsNoTracking()
                    .Where(o => o.OrderNo == orderNo)
                    .SelectMany(o => o.Lines.Select(l => l.Id))
                    .ToListAsync(ct);

                if (orderLineIds.Count == 0) continue;

                var stillInvoiced = await _dbContext.Set<InvoiceLine>()
                    .AsNoTracking()
                    .AnyAsync(l => l.SalesOrderLineId != null && orderLineIds.Contains(l.SalesOrderLineId!.Value), ct);

                if (!stillInvoiced) orphaned.Add(orderNo);
            }

            if (orphaned.Count == 0) return;

            var client = CreateServiceOpsClient();
            if (client is null) return;

            _ = Task.Run(async () =>
            {
                try
                {
                    using (client)
                    {
                        foreach (var orderNo in orphaned)
                        {
                            var response = await client.DeleteAsync($"api/cargotracking/order/{Uri.EscapeDataString(orderNo)}");
                            Console.WriteLine($"[ServiceOps Webhook] DELETE api/cargotracking/order/{orderNo} → {(int)response.StatusCode}");
                            if (!response.IsSuccessStatusCode)
                            {
                                Console.WriteLine($"[ServiceOps Webhook Error] {await response.Content.ReadAsStringAsync()}");
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[ServiceOps Webhook Background Task Error]: {ex.Message}");
                }
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ServiceOps Webhook Error]: {ex.Message}");
        }
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return string.Empty;
    }

    public class OrderLineInvoiceDetail
    {
        public int LineId { get; set; }
        public int OrderId { get; set; }
        public string CustomerCode { get; set; } = string.Empty;
        public string DeliveryCustomerCode { get; set; } = string.Empty;
        public string? CampaignDetailsJson { get; set; }
        public decimal OrderSubtotal { get; set; }
        public decimal OrderCampaignDiscount { get; set; }
        public string StockCode { get; set; } = string.Empty;
        public string? Description { get; set; }
        public decimal Quantity { get; set; }
        public decimal UnitPrice { get; set; }
        public int CurrencyTypeId { get; set; }
        public decimal CurrencyRate { get; set; }
        public decimal CurrencyUnitPrice { get; set; }
        public decimal VatRate { get; set; }
        public bool IsGift { get; set; }
        public decimal DiscountAmount { get; set; }
        public int? InstallationId { get; set; }
        public Guid? LineageId { get; set; }

        /// <summary>
        /// Servisin damgaladığı çıkış deposu. İstemcinin gönderdiği kalem deposu bununla
        /// karşılaştırılıyor: kullanıcı, yetkisi olmayan bir depoyu ancak servis o depoyu
        /// damgalamışsa seçebilir.
        /// </summary>
        public int? SourceWarehouseCode { get; set; }
    }

    [HttpPost("create-service-invoice")]
    [AuthorizePage("invoice", "satisFatura")]
    public async Task<IActionResult> CreateServiceInvoice(
        [FromBody] CreateServiceInvoiceRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var customerCode = (request.CustomerCode ?? string.Empty).Trim();

        // CARİ EŞLEŞMEZSE İŞLEM DURUR (2026-09-13 denetim düzeltmesi).
        //
        // Eskiden buraya "cari bulunamadı" düşüldüğünde sistemdeki İLK AKTİF cari sessizce
        // devreye giriyordu — istek "HIZ-NAKLIYE" gibi gerçek bir cari kaydı olmayan bir kod
        // gönderdiğinde fatura, hiç ilgisi olmayan rastgele bir müşteriye yazılıyordu. Denetimde
        // bu yüzden 87.500 TL'lik bir servis faturası hiçbir cari ekstresine hiç yansımamış
        // olarak bulundu. Rastgele carinin borcuna eklenmek daha da kötü olurdu; doğrusu
        // isteği reddedip çağırana ("Satış Faturası" ekranı / ServiceOps) haber vermektir.
        if (string.IsNullOrWhiteSpace(customerCode))
        {
            return BadRequest(new { success = false, message = "Servis faturası için cari kodu belirtilmedi." });
        }

        var customer = await _dbContext.Customers
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (customer is null)
        {
            var codeLower = customerCode.ToLower();
            customer = await _dbContext.Customers
                .FirstOrDefaultAsync(x => x.CustomerCode.ToLower() == codeLower, cancellationToken);
        }

        if (customer is null)
        {
            return BadRequest(new { success = false, message = $"'{customerCode}' koduyla kayıtlı bir cari/müşteri bulunamadı." });
        }

        // Carinin para birimi burada okunuyordu; hiçbir yerde KULLANILMIYORDU (ölü kod) ve
        // her servis faturasında boşuna canlı kur çekiyordu. Servis faturasının para birimi
        // zaten aşağıdaki `serviceCurrencyTypeId` — isteğin kendi para birimi (2026-08-17).

        // Generate Invoice Number (invoiceNo)
        var serie = "S";
        var existing = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .Where(x => x.InvoiceNo.StartsWith(serie) && x.InvoiceNo.Length == 15)
            .Select(x => x.InvoiceNo)
            .ToListAsync(cancellationToken);

        long max = -1;
        foreach (var invNo in existing)
        {
            if (string.IsNullOrWhiteSpace(invNo) || invNo.Length != 15) continue;
            var tail = invNo.Substring(1);
            if (long.TryParse(tail, out var n))
            {
                if (n > max) max = n;
            }
        }

        var next = max + 1;
        var invoiceNo = serie + next.ToString().PadLeft(14, '0');

        var now = DateTime.UtcNow;
        var username = User.Identity?.Name ?? "System";

        // KDV MUAFİYETİ. Projenin geri kalanı muafiyeti üç değerden tanır: ACIK, MUAF,
        // ASKERIYE/ASKERİYE (bkz. fatura listesi ve CustomerAccountService). Burada yalnızca
        // "ACIK" aranıyordu; MUAF ve ASKERİYE cariler muaf sayılmıyor ve faturalarına %16 KDV
        // biniyordu. Ekranda "MUAF" rozeti görünürken tutara KDV eklenmesinin sebebi buydu.
        static bool IsVatExemptType(string? value)
        {
            var v = (value ?? string.Empty).Trim();
            return string.Equals(v, "ACIK", StringComparison.OrdinalIgnoreCase)
                || string.Equals(v, "MUAF", StringComparison.OrdinalIgnoreCase)
                || string.Equals(v, "ASKERIYE", StringComparison.OrdinalIgnoreCase)
                || string.Equals(v, "ASKERİYE", StringComparison.OrdinalIgnoreCase);
        }

        var isAcik = IsVatExemptType(customer.InvoiceType) || IsVatExemptType(customer.CustomerType);

        // SERVİSTE GİRİLEN FİYAT KDV DAHİLDİR (kullanıcı kararı, 2026-08-11).
        //
        // Teknisyen/servis personeli müşteriden tahsil edilecek TUTARI giriyor: 1160 yazdıysa
        // müşteri 1160 ödeyecek demektir. Fatura ise bunu ayrıştırmalı: net 1000 + %16 KDV 160.
        // Eskiden oran sabit sıfırdı ve girilen tutar olduğu gibi ara toplama yazılıyordu; fatura
        // "KDV 0,00" çıkıyor, tahsil edilen KDV hiç görünmüyordu.
        //
        // Muaf cari (ACIK/MUAF/ASKERİYE) istisnadır: orada KDV zaten doğmuyor, girilen tutar
        // olduğu gibi net kabul edilir ve ayrıştırma YAPILMAZ.
        var vatRate = isAcik ? 0m : ServiceVatRate;
        var siparisNo = "S" + DateTime.UtcNow.ToString("yyMMddHHmmssfff");

        decimal grandTotal = 0m;
        decimal subtotalTotal = 0m;
        decimal vatTotalSum = 0m;

        var lineRequests = new List<(string stockCode, string desc, decimal qty, decimal linePrice, bool isWarranty)>();

        // 1. Add Spare Parts items (both paid and warranty/garantili)
        if (request.Items != null && request.Items.Count > 0)
        {
            foreach (var item in request.Items)
            {
                var stockCode = string.IsNullOrWhiteSpace(item.StockCode) ? "YEDEK-PARCA" : item.StockCode.Trim();
                var baseDesc = string.IsNullOrWhiteSpace(item.Description) ? "Yedek Parça" : item.Description.Trim();
                var desc = item.IsWarranty ? (baseDesc.Contains("Garantili", StringComparison.OrdinalIgnoreCase) ? baseDesc : $"{baseDesc} (Garantili Bedelsiz)") : baseDesc;
                var qty = item.Quantity > 0 ? item.Quantity : 1;
                var linePrice = item.IsWarranty ? 0m : (item.Price * qty);

                lineRequests.Add((stockCode, desc, qty, linePrice, item.IsWarranty));
            }
        }

        // MÜŞTERİ ÖNEKİ: "<ad> - <telefon> - ".
        //
        // Servis kalemlerinin açıklaması yalnız ürün adını taşıyordu; faturaya bakan kişi işin
        // hangi son müşteriye ait olduğunu göremiyordu (cari genelde bayi). Ad ve telefondan
        // hangisi geldiyse o yazılır, ikisi de boşsa önek hiç eklenmez ve açıklama eskisiyle
        // BİREBİR aynı kalır.
        var musteriAdi = (request.ServiceCustomerName ?? string.Empty).Trim();
        var musteriTel = (request.ServiceCustomerPhone ?? string.Empty).Trim();
        var musteriParcalari = new List<string>();
        if (musteriAdi.Length > 0) musteriParcalari.Add(musteriAdi);
        if (musteriTel.Length > 0) musteriParcalari.Add(musteriTel);
        // MÜŞTERİ BİLGİSİ AÇIKLAMANIN İKİNCİ SATIRINDA (2026-08-21 kullanıcı düzeltmesi).
        //
        // Önce aynı satırın BAŞINA ekleniyordu; kâğıtta kalem adı sütununda "MESUT DEMİR -
        // 0555 555 5555 - Servis Onarım İşçilik Bedeli - ST-BİKAHVE ..." diye çıkıyor ve
        // müşteri ne aldığını göremiyordu. Kullanıcı kuralı: satırda ürün yeter.
        //
        // Silmek de doğru değil: Satış Faturası ekranındaki NOT kutusu kalem açıklamalarından
        // türüyor (InvoicePage, `setNote(parts.join('\n'))`), yani ikisi TEK kaynaktan besleniyor.
        // Silseydim NOT'tan da giderdi. Bu yüzden bilgi ayrı bir SATIR olarak ekleniyor:
        // NOT iki satırı da gösterir, basım yalnız ilk satırı yazar (bkz. InvoicePrintModelBuilder).
        var musteriSatiri = musteriParcalari.Count > 0 ? "\n" + string.Join(" - ", musteriParcalari) : string.Empty;

        // 2. Add Repair / Labor Fee if > 0 and not already in items
        var hasLaborInItems = lineRequests.Any(x => 
            x.stockCode.StartsWith("HIZ", StringComparison.OrdinalIgnoreCase) || 
            x.stockCode.StartsWith("HİZ", StringComparison.OrdinalIgnoreCase) || 
            x.desc.Contains("Servis Onarım", StringComparison.OrdinalIgnoreCase) ||
            x.desc.Contains("İşçilik", StringComparison.OrdinalIgnoreCase));

        if (request.Price > 0 && !hasLaborInItems)
        {
            lineRequests.Add(("HİZ-TAMİR", $"Servis Onarım İşçilik Bedeli - {request.ProductName}{musteriSatiri}", 1, request.Price, false));
        }

        // BEDELSİZ İŞ FATURAYA GİTMEZ (2026-08-21 kullanıcı kuralı).
        //
        // Buraya düşmek "ne kalem var ne işçilik bedeli" demektir: yukarıda bedel > 0 ise
        // işçilik satırı, kalem varsa kalem satırları zaten eklenmiş olurdu. Eskiden bu durumda
        // 0 TL'lik bir "Hazır Ürün Teslimat" satırı açılıyor ve servis tarafında bedelsiz
        // kapatılan HER iş, bayiye 0 TL'lik bir satış faturası taslağı olarak düşüyordu.
        // Böyle bir faturanın ticari karşılığı yok; kullanıcı gitmemesini istedi.
        //
        // Garantili kalemler bu kuralın DIŞINDA: onların fiyatı 0 olsa da kalem olarak
        // eklendikleri için liste boş kalmaz ve fatura oluşmaya devam eder.
        if (lineRequests.Count == 0)
        {
            return BadRequest(new
            {
                success = false,
                message = "Faturalanacak tutar yok: işlem bedeli 0 ve faturaya girecek kalem bulunmuyor."
            });
        }

        // SERVİS FİYATININ PARA BİRİMİ (2026-08-14).
        // İstek belirtmezse TL — ServiceOps bu alanı göndermeye başlayana kadar davranış
        // bugünküyle aynıdır. Belirtirse fiyatlar O PARA BİRİMİNDEDİR ve TL karşılıkları
        // kurla üretilir; sipariş/fatura toplamları her zaman TL tutulur.
        var serviceCurrencyTypeId = request.CurrencyTypeId.GetValueOrDefault(1);
        if (serviceCurrencyTypeId <= 0) serviceCurrencyTypeId = 1;

        var serviceRate = 1m;
        if (serviceCurrencyTypeId != 1)
        {
            if (request.ExchangeRate.HasValue && request.ExchangeRate.Value > 0m)
            {
                serviceRate = request.ExchangeRate.Value;
            }
            else
            {
                var svcCode = MapCurrencyTypeIdToCode(serviceCurrencyTypeId);
                if (!string.IsNullOrWhiteSpace(svcCode))
                {
                    try
                    {
                        serviceRate = await _money.GetLatestTryRateAsync(svcCode, cancellationToken);
                    }
                    catch
                    {
                        serviceRate = 1m;
                    }
                }
            }

            if (serviceRate <= 0m) serviceRate = 1m;
        }

        foreach (var lr in lineRequests)
        {
            // GARANTİ kapsamındaki parça ücretsizdir: satırı aşağıda `lineSubtotal = 0` ile
            // yazılıyor ama BAŞLIK toplamına tam fiyattan giriyordu. Sonuç: başlıkta 4.000 ₺,
            // altındaki satırda 0 ₺ — muhasebeci için kapanmayan fark. Satır ile başlık aynı
            // kuralı izlemeli.
            if (lr.isWarranty) continue;

            // `linePrice` KDV DAHİL tutardır; net ve KDV buradan ayrıştırılır.
            // Toplamlar satır bazında yuvarlanan değerlerden kuruluyor ki fatura satırlarının
            // toplamı ile başlıktaki toplam birbirini tutsun.
            var (sub, vat) = SplitVatInclusive(lr.linePrice, vatRate);

            // Sipariş toplamları TL tutulur; dövizli serviste kurla çevrilir.
            subtotalTotal += Math.Round(sub * serviceRate, 2, MidpointRounding.AwayFromZero);
            vatTotalSum += Math.Round(vat * serviceRate, 2, MidpointRounding.AwayFromZero);
            grandTotal += Math.Round((sub + vat) * serviceRate, 2, MidpointRounding.AwayFromZero);
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var serviceRecId = (request.ServiceRecordId ?? string.Empty).Trim();
            var serviceNo = (request.ServiceNumber ?? string.Empty).Trim();

            var creatorName = !string.IsNullOrWhiteSpace(request.PerformerName)
                ? request.PerformerName.Trim()
                : (username ?? "System");

            string userWarehouseNames = string.Empty;

            // KALEMİN ÇIKIŞ DEPOSU BURADA BELİRLENİR (kullanıcı kuralı, 2026-08-13).
            //
            // Sıra: (1) servis tarafının bildirdiği teknisyen ARAÇ deposu, (2) işlemi yapan
            // kişinin B2B'deki tek deposu. İkisi de yoksa NULL kalır ve satış faturası ekranı
            // depoyu kullanıcıya sordurur — "bir yere" yazmak, yanlış yere yazmaktır.
            //
            // Neden faturayı kesen kişinin deposu DEĞİL: müdür faturayı imzalıyor ama parça
            // teknisyenin arabasından çıkmış oluyor; müdürün deposundan düşmek iki depoyu birden
            // bozar (bkz. SalesOrderLine.SourceWarehouseCode).
            int? sourceWarehouseCode = request.PerformerWarehouseCode.HasValue && request.PerformerWarehouseCode.Value != 0
                ? request.PerformerWarehouseCode.Value
                : null;

            try
            {
                var performerLookup = (request.PerformerUsername ?? creatorName).Trim();
                var userObj = await _dbContext.Users.AsNoTracking()
                    .FirstOrDefaultAsync(u => u.Username.ToLower() == performerLookup.ToLower()
                                              || (u.Unvan != null && u.Unvan.ToLower() == performerLookup.ToLower()), cancellationToken);

                if (userObj != null)
                {
                    var userWcodes = await _dbContext.Set<UserWarehouse>().AsNoTracking()
                        .Where(uw => uw.UserId == userObj.Id)
                        .Select(uw => uw.WarehouseCode)
                        .ToListAsync(cancellationToken);

                    if (userWcodes.Count > 0)
                    {
                        var whList = await _dbContext.Set<Warehouse>().AsNoTracking()
                            .Where(w => userWcodes.Contains(w.WarehouseCode))
                            .Select(w => $"{w.Name} (Kod: {w.WarehouseCode})")
                            .ToListAsync(cancellationToken);

                        userWarehouseNames = string.Join(", ", whList);
                    }

                    // Yalnızca TEK deposu varsa otomatik seçilir. Birden çok depoda hangisinden
                    // çıktığı bilinemez; tahmin etmek yerine ekran sorar.
                    if (sourceWarehouseCode is null)
                    {
                        if (userObj.DefaultWarehouseCode.HasValue && userObj.DefaultWarehouseCode.Value != 0)
                        {
                            sourceWarehouseCode = userObj.DefaultWarehouseCode.Value;
                        }
                        else if (userWcodes.Count == 1)
                        {
                            sourceWarehouseCode = userWcodes[0];
                        }
                    }
                }
            }
            catch
            {
                userWarehouseNames = string.Empty;
            }

            var campaignData = new
            {
                serviceRecordId = serviceRecId,
                serviceNumber = serviceNo,
                sourcePage = string.IsNullOrWhiteSpace(request.SourcePage) ? "AtolyeAriza" : request.SourcePage.Trim(),
                isServiceInvoice = true,
                performerName = creatorName,
                assignedWarehouses = userWarehouseNames
            };

            var salesOrder = new SalesOrder
            {
                CustomerCode = customer.CustomerCode,
                DeliveryCustomerCode = customer.CustomerCode,
                Subtotal = subtotalTotal,
                VatTotal = vatTotalSum,
                GrandTotal = grandTotal,
                CampaignDiscount = 0m,
                CampaignDetailsJson = JsonSerializer.Serialize(campaignData),
                Status = 0, // Pending / Waiting for Sales Invoice creation in Satış Faturası page!
                OrderNo = siparisNo,
                ProcessedBy = creatorName,
                ProcessedAt = now,
                CreateUser = creatorName,
                CreateTime = now
            };

            _dbContext.Set<SalesOrder>().Add(salesOrder);
            await _dbContext.SaveChangesAsync(cancellationToken);

            int lineNo = 1;
            foreach (var lr in lineRequests)
            {
                // Satıra NET birim fiyat yazılır. `linePrice` KDV dahil geldiği için önce
                // ayrıştırılıyor; aksi halde satırda hem KDV dahil fiyat durur hem de üstüne
                // %16 eklenir ve fatura 1160 yerine 1345,60 çıkardı.
                var (lineNet, _) = SplitVatInclusive(lr.linePrice, vatRate);
                var lineSubtotal = lr.isWarranty || lr.qty == 0 ? 0m : (lineNet / lr.qty);
                var salesOrderLine = new SalesOrderLine
                {
                    SalesOrderId = salesOrder.Id,
                    StockCode = lr.stockCode,
                    Description = lr.desc,
                    Quantity = lr.qty,
                    // UnitPrice DAİMA TL'dir (fatura toplamları oradan kurulur);
                    // CurrencyUnitPrice servisin gönderdiği para birimindeki fiyattır.
                    // TL serviste ikisi eşittir — bugünkü davranış korunur.
                    UnitPrice = Math.Round(lineSubtotal * serviceRate, 4, MidpointRounding.AwayFromZero),
                    CurrencyTypeId = serviceCurrencyTypeId <= 1 ? 0 : serviceCurrencyTypeId,
                    CurrencyRate = serviceRate,
                    CurrencyUnitPrice = lineSubtotal,
                    VatRate = vatRate,
                    IsGift = lr.isWarranty,
                    DiscountAmount = 0m,
                    LineNo = lineNo++,
                    Montage = false,
                    // Satış faturası ekranı bu iki alandan "SERVİS" rozetini ve öntanımlı
                    // çıkış deposunu kuruyor.
                    SourceWarehouseCode = sourceWarehouseCode,
                    ServicePerformerName = creatorName,
                    CreateUser = username,
                    CreateTime = now
                };

                _dbContext.Set<SalesOrderLine>().Add(salesOrderLine);
            }
            await _dbContext.SaveChangesAsync(cancellationToken);

            await tx.CommitAsync(cancellationToken);

            return Ok(new { success = true, data = new { orderNo = siparisNo } });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(cancellationToken);
            return StatusCode(500, new { success = false, message = "Fatura taslağı oluşturulurken hata: " + ex.Message });
        }
    }

    // [AllowAnonymous] idi: kimlik doğrulaması olmadan, servis kayıt numarası verilen bütün
    // SalesOrder ve satırlarını kalıcı olarak siliyordu. Tek çağıranı ServiceOps'un vekil ucu
    // (ErpController.cs) ve o zaten `Authorization: Bearer <ssa token>` gönderiyor — ssa süper
    // admin claim'i taşıdığı için sayfa kapısından da erken geçer, yani akış aynen çalışır.
    [HttpDelete("cancel-service-invoice-by-record/{serviceRecordId}")]
    [AuthorizePage("invoice", "satisFatura")]
    public async Task<IActionResult> CancelServiceInvoiceByRecord([FromRoute] string serviceRecordId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(serviceRecordId))
        {
            return BadRequest(new { success = false, message = "Geçersiz servis kayıt kimliği" });
        }

        var targetId = serviceRecordId.Trim();
        var orders = await _dbContext.Set<SalesOrder>()
            .Include(x => x.Lines)
            .Where(x => x.CampaignDetailsJson != null && (x.CampaignDetailsJson.Contains($"\"serviceRecordId\":\"{targetId}\"") || x.CampaignDetailsJson.Contains($"\"serviceNumber\":\"{targetId}\"")))
            .ToListAsync(cancellationToken);

        if (orders.Count == 0)
        {
            return Ok(new { success = true, deletedCount = 0, message = "Silinecek sipariş bulunamadı" });
        }

        foreach (var order in orders)
        {
            _dbContext.Set<SalesOrderLine>().RemoveRange(order.Lines);
            _dbContext.Set<SalesOrder>().Remove(order);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, deletedCount = orders.Count, message = "İlişkili servis satış faturası taslağı silindi." });
    }

    [HttpGet("lines/{invoiceLineId:int}/installations")]
    public async Task<IActionResult> GetInvoiceLineInstallations([FromRoute] int invoiceLineId, CancellationToken cancellationToken)
    {
        var line = await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == invoiceLineId, cancellationToken);

        if (line is null)
        {
            return NotFound(new { success = false, message = "Fatura kalemi bulunamadı" });
        }

        var installations = await _dbContext.Set<Installation>()
            .AsNoTracking()
            .Where(x => (x.InvoiceLineId == invoiceLineId || (line.LineageId.HasValue && x.LineageId == line.LineageId.Value)) && x.Status != "Pasif / Geri Alındı" && x.Status != "Pasif / İptal")
            .OrderBy(x => x.Id)
            .Select(x => new
            {
                x.Id,
                x.LineageId,
                x.InstallationClientId,
                x.InvoiceLineId,
                x.DealerCode,
                x.DealerName,
                x.ProductName,
                x.Quantity,
                x.InstallationName,
                x.InstallationPhone,
                x.Address,
                x.Region,
                x.DealerDescription,
                x.Type,
                x.Status,
                x.Technician,
                x.PlannedDateUtc,
                x.CreateUser,
                x.CreateTime
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, lineQuantity = line.Quantity, data = installations });
    }

    [HttpPost("lines/{invoiceLineId:int}/installations")]
    public async Task<IActionResult> CreateInvoiceLineInstallation([FromRoute] int invoiceLineId, [FromBody] CreateInvoiceLineInstallationRequest request, CancellationToken cancellationToken)
    {
        if (request is null) return BadRequest(new { success = false, message = "Geçersiz istek" });

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "System";
        var strategy = _dbContext.Database.CreateExecutionStrategy();

        return await strategy.ExecuteAsync<IActionResult>(async () =>
        {
            await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

            // 1. Idempotency Check via InstallationClientId
            if (request.InstallationClientId.HasValue)
            {
                var existingInst = await _dbContext.Set<Installation>()
                    .FirstOrDefaultAsync(x => x.InstallationClientId == request.InstallationClientId.Value, cancellationToken);
                if (existingInst != null)
                {
                    return Ok(new { success = true, data = ProjectInstallation(existingInst), isDuplicate = true });
                }
            }

            var line = await _dbContext.Set<InvoiceLine>()
                .FirstOrDefaultAsync(x => x.Id == invoiceLineId, cancellationToken);
            if (line is null)
            {
                return NotFound(new { success = false, message = "Fatura kalemi bulunamadı" });
            }

            var invoice = await _dbContext.Set<Invoice>()
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == line.InvoiceId, cancellationToken);

            var lineageId = line.LineageId ?? request.LineageId ?? Guid.NewGuid();
            if (!line.LineageId.HasValue)
            {
                line.LineageId = lineageId;
            }

            // 2. Quantity Validation: requested <= Line.Quantity
            var requestedQty = request.Quantity <= 0 ? 1m : request.Quantity;

            if (requestedQty > line.Quantity)
            {
                return BadRequest(new { success = false, message = $"Montaj miktarı fatura kalemi miktarını aşamaz! (Kalem Miktarı: {line.Quantity:N0}, Eklenmek İstenen: {requestedQty:N0})" });
            }

            var inst = new Installation
            {
                InvoiceLineId = line.Id,
                SalesOrderLineId = line.SalesOrderLineId,
                LineageId = lineageId,
                InstallationClientId = request.InstallationClientId,
                DealerCode = invoice?.CustomerCode,
                DealerName = string.IsNullOrWhiteSpace(request.DealerName) ? (invoice?.CustomerCode ?? string.Empty) : request.DealerName.Trim(),
                ProductName = string.IsNullOrWhiteSpace(request.ProductName) ? line.StockCode : request.ProductName.Trim(),
                Quantity = requestedQty,
                InstallationName = string.IsNullOrWhiteSpace(request.CustomerName) ? null : request.CustomerName.Trim(),
                InstallationPhone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim(),
                Address = string.IsNullOrWhiteSpace(request.Address) ? "-" : request.Address.Trim(),
                Region = string.IsNullOrWhiteSpace(request.Region) ? "-" : request.Region.Trim(),
                DealerDescription = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim(),
                Type = "Montaj",
                Status = "Yeni Kayıt",
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            };

            _dbContext.Set<Installation>().Add(inst);
            await _dbContext.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);

            if (invoice != null)
            {
                // Yalnızca yeni montaj gönderilir. Eskiden önce kalemin TÜM montajları ServiceOps'tan
                // silinip hepsi yeniden yaratılıyordu; bu, kardeş montajların planlama ve teknisyen
                // atamasını her ekleme işleminde sıfırlıyordu.
                await SendInstallationsToServiceOpsAsync(invoice, new List<Installation> { inst }, cancellationToken);
            }

            return Ok(new { success = true, data = ProjectInstallation(inst) });
        });
    }

    [HttpPut("installations/{installationId:int}")]
    public async Task<IActionResult> UpdateInvoiceLineInstallation([FromRoute] int installationId, [FromBody] UpdateInvoiceLineInstallationRequest request, CancellationToken cancellationToken)
    {
        if (request is null) return BadRequest(new { success = false, message = "Geçersiz istek" });

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "System";
        var strategy = _dbContext.Database.CreateExecutionStrategy();

        return await strategy.ExecuteAsync<IActionResult>(async () =>
        {
            await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

            var inst = await _dbContext.Set<Installation>()
                .FirstOrDefaultAsync(x => x.Id == installationId, cancellationToken);
            if (inst is null) return NotFound(new { success = false, message = "Montaj kaydı bulunamadı" });

            InvoiceLine? line = null;
            if (inst.InvoiceLineId.HasValue)
            {
                line = await _dbContext.Set<InvoiceLine>().FirstOrDefaultAsync(x => x.Id == inst.InvoiceLineId.Value, cancellationToken);
            }
            else if (inst.LineageId.HasValue)
            {
                line = await _dbContext.Set<InvoiceLine>().FirstOrDefaultAsync(x => x.LineageId == inst.LineageId.Value, cancellationToken);
            }

            var requestedQty = request.Quantity <= 0 ? 1m : request.Quantity;

            if (line is not null)
            {
                if (requestedQty > line.Quantity)
                {
                    return BadRequest(new { success = false, message = $"Güncellenen montaj miktarı fatura kalemi miktarını aşamaz! (Kalem Miktarı: {line.Quantity:N0}, İstenen: {requestedQty:N0})" });
                }
            }

            inst.Quantity = requestedQty;
            if (!string.IsNullOrWhiteSpace(request.DealerName)) inst.DealerName = request.DealerName.Trim();
            if (!string.IsNullOrWhiteSpace(request.ProductName)) inst.ProductName = request.ProductName.Trim();
            inst.InstallationName = string.IsNullOrWhiteSpace(request.CustomerName) ? null : request.CustomerName.Trim();
            inst.InstallationPhone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
            if (!string.IsNullOrWhiteSpace(request.Address)) inst.Address = request.Address.Trim();
            if (!string.IsNullOrWhiteSpace(request.Region)) inst.Region = request.Region.Trim();
            inst.DealerDescription = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
            inst.EditUser = username;
            inst.EditTime = DateTime.UtcNow;

            await _dbContext.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);

            if (line != null)
            {
                var invoice = await _dbContext.Set<Invoice>().AsNoTracking().FirstOrDefaultAsync(x => x.Id == line.InvoiceId, cancellationToken);
                if (invoice != null)
                {
                    // Aynı dış anahtarla gidiyor: ServiceOps kopya açmaz, mevcut kalemi günceller.
                    await SendInstallationsToServiceOpsAsync(invoice, new List<Installation> { inst }, cancellationToken);
                }
            }

            return Ok(new { success = true, data = ProjectInstallation(inst) });
        });
    }

    [HttpDelete("installations/{installationId:int}")]
    public async Task<IActionResult> DeleteInvoiceLineInstallation([FromRoute] int installationId, CancellationToken cancellationToken)
    {
        var inst = await _dbContext.Set<Installation>()
            .FirstOrDefaultAsync(x => x.Id == installationId, cancellationToken);
        if (inst is null) return NotFound(new { success = false, message = "Montaj kaydı bulunamadı" });

        // Montaj faturaya bağlıysa silme kuralı FATURANIN kuralıdır (Fatura Dökümü: sahiplik + 24 saat).
        var montajFaturasi = inst.InvoiceLineId.HasValue
            ? await _dbContext.Set<InvoiceLine>().AsNoTracking()
                .Where(l => l.Id == inst.InvoiceLineId.Value)
                .Join(_dbContext.Set<Invoice>().AsNoTracking(), l => l.InvoiceId, i => i.Id, (l, i) => i)
                .FirstOrDefaultAsync(cancellationToken)
            : null;
        if (montajFaturasi is not null)
        {
            var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, montajFaturasi, "deleteRule/faturaDokum", cancellationToken);
            if (silmeKurali is not null) return silmeKurali;
        }

        inst.Status = "Pasif / İptal";
        inst.EditUser = User.FindFirst(ClaimTypes.Name)?.Value ?? "System";
        inst.EditTime = DateTime.UtcNow;

        // Sipariş satırı bu montajı işaret ediyorsa bağı da kopar: kalem sayımı pasif montajları
        // eliyor ama `SalesOrderLine.InstallationId`'yi ayrıca ekliyor, işaretçi kalırsa montajı
        // silinen kalem listede hâlâ "Montaj Düzenle" gösterirdi.
        var referencingOrderLines = await _dbContext.Set<SalesOrderLine>()
            .Where(x => x.InstallationId == inst.Id)
            .ToListAsync(cancellationToken);
        foreach (var ol in referencingOrderLines) ol.InstallationId = null;

        await _dbContext.SaveChangesAsync(cancellationToken);

        await NotifyServiceOpsForInstallationRemoval(inst.Id, cancellationToken);

        return Ok(new { success = true });
    }

    /// <summary>
    /// Fatura kaleminin BÜTÜN montajlarını kaldırır — kalem "montajsız" hale gelir.
    ///
    /// Tek tek silme (<see cref="DeleteInvoiceLineInstallation"/>) zaten vardı ama bir kalemde
    /// birden çok montaj adresi olabiliyor; hepsini teker teker silmek hem zahmetli hem de yarım
    /// bırakmaya açıktı. Burada kalemin montaj alanları da temizleniyor: yalnızca montaj
    /// satırlarını pasife almak yetmez, sipariş akışından gelen <c>InvoiceLine.InstallationId</c>
    /// dolu kaldığı sürece kalem listede hâlâ "montajlı" görünürdü.
    ///
    /// Silme ServiceOps'a da yansır (montaj başına <c>DELETE api/montaj/external/{ref}</c>),
    /// aksi halde bayi tarafında montaj kaydı öksüz kalırdı.
    /// </summary>
    [HttpDelete("lines/{lineId:int}/installations")]
    public async Task<IActionResult> RemoveAllInstallationsFromLine([FromRoute] int lineId, CancellationToken cancellationToken)
    {
        var line = await _dbContext.Set<InvoiceLine>()
            .FirstOrDefaultAsync(x => x.Id == lineId, cancellationToken);
        if (line is null) return NotFound(new { success = false, message = "Fatura kalemi bulunamadı" });

        // Silme kuralı FATURANIN kuralıdır (Fatura Dökümü: sahiplik + 24 saat).
        var montajFaturasi = await _dbContext.Set<Invoice>().AsNoTracking()
            .FirstOrDefaultAsync(i => i.Id == line.InvoiceId, cancellationToken);
        if (montajFaturasi is not null)
        {
            var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, montajFaturasi, "deleteRule/faturaDokum", cancellationToken);
            if (silmeKurali is not null) return silmeKurali;
        }

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "System";
        var now = DateTime.UtcNow;

        // Sipariş akışından gelen montaj kaleme SalesOrderLine üzerinden bağlı; fatura dökümünden
        // girilenler ise doğrudan `InvoiceLineId` / `LineageId` ile. Üç bağ da toplanmazsa
        // geride "montajsız" sayılmayan bir kalem kalır.
        SalesOrderLine? orderLine = null;
        if (line.SalesOrderLineId.HasValue)
        {
            orderLine = await _dbContext.Set<SalesOrderLine>()
                .FirstOrDefaultAsync(x => x.Id == line.SalesOrderLineId.Value, cancellationToken);
        }

        var orderInstallationId = orderLine?.InstallationId;

        var installations = await _dbContext.Set<Installation>()
            .Where(x => x.InvoiceLineId == lineId
                        || (line.LineageId.HasValue && x.LineageId == line.LineageId.Value)
                        || (orderInstallationId.HasValue && x.Id == orderInstallationId.Value))
            .ToListAsync(cancellationToken);

        var removedIds = new List<int>();
        foreach (var inst in installations)
        {
            // Zaten pasif olanı tekrar damgalamıyoruz ama ServiceOps'a yine de bildiriyoruz:
            // önceki denemede webhook düşmüş olabilir, silme isteği tekrarlanabilir olmalı.
            if (inst.Status != "Pasif / İptal" && inst.Status != "Pasif / Geri Alındı")
            {
                inst.Status = "Pasif / İptal";
                inst.EditUser = username;
                inst.EditTime = now;
            }
            removedIds.Add(inst.Id);
        }

        // Sipariş satırındaki işaretçi de kopmalı: montaj satırlarını pasife almak tek başına
        // yetmiyor, `SalesOrderLine.InstallationId` dolu kaldığı sürece liste kalemi "montajlı"
        // saymaya devam ediyordu (sayım o işaretçiyi ayrıca ekliyor).
        if (orderLine is not null) orderLine.InstallationId = null;

        await _dbContext.SaveChangesAsync(cancellationToken);

        foreach (var id in removedIds)
        {
            await NotifyServiceOpsForInstallationRemoval(id, cancellationToken);
        }

        return Ok(new { success = true, removed = removedIds.Count });
    }

    private static object ProjectInstallation(Installation inst)
    {
        return new
        {
            inst.Id,
            inst.InvoiceLineId,
            inst.SalesOrderLineId,
            inst.LineageId,
            inst.InstallationClientId,
            inst.DealerCode,
            inst.DealerName,
            inst.ProductName,
            inst.Quantity,
            inst.InstallationName,
            inst.InstallationPhone,
            Address = inst.Address ?? string.Empty,
            Region = inst.Region ?? string.Empty,
            DealerDescription = inst.DealerDescription ?? string.Empty,
            inst.Type,
            inst.Status,
            inst.Technician,
            inst.PlannedDateUtc,
            inst.CreateUser,
            inst.CreateTime
        };
    }
}

public sealed class ServiceInvoiceItemRequest
{
    public string StockCode { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; } = 1;
    public decimal Price { get; set; }
    public bool IsWarranty { get; set; }
}

public sealed class CreateServiceInvoiceRequest
{
    [Required]
    public string CustomerCode { get; set; } = string.Empty;

    [Required]
    public string ProductName { get; set; } = string.Empty;

    public decimal Price { get; set; }

    public List<ServiceInvoiceItemRequest>? Items { get; set; }

    public string? ServiceRecordId { get; set; }

    public string? ServiceNumber { get; set; }

    public string? SourcePage { get; set; }

    public string? PerformerName { get; set; }

    /// <summary>
    /// İşlemi yapan teknisyenin ARAÇ deposu. ServiceOps çözüp gönderir
    /// (<c>Technicians.WarehouseCode</c>); B2B'nin ServiceOps teknisyen tablosuna erişimi yok.
    /// Gelmezse kullanıcının B2B depo yetkisine düşülür.
    /// </summary>
    public int? PerformerWarehouseCode { get; set; }

    /// <summary>
    /// İşlemi yapanın KULLANICI ADI. <see cref="PerformerName"/> ekranda gösterilen ad olduğu
    /// için (ör. "Tarık Demir") kullanıcı tablosunda her zaman eşleşmiyor; depo çözümü bu alanla
    /// yapılıyor, yoksa ada düşülüyor.
    /// </summary>
    public string? PerformerUsername { get; set; }

    /// <summary>
    /// <see cref="Price"/> ve kalem fiyatlarının para birimi: 1=TRY 2=EUR 3=USD 4=GBP.
    /// GÖNDERİLMEZSE TL kabul edilir — ServiceOps bu alanı göndermeye başlayana kadar
    /// davranış bugünküyle birebir aynıdır.
    ///
    /// Carinin para birimi BURADA KULLANILMAZ: servis fiyatı carinin dövizinde olmak zorunda
    /// değil. Fiyatın hangi parada olduğunu yalnızca gönderen taraf bilir; carinin dövizini
    /// varsaymak TL tutarı dolar olarak damgalardı.
    /// </summary>
    public int? CurrencyTypeId { get; set; }

    /// <summary>
    /// İşlem anındaki kur (1 döviz = X TL). Gönderilmezse güncel kur çekilir.
    /// TL için anlamsızdır.
    /// </summary>
    public decimal? ExchangeRate { get; set; }

    /// <summary>
    /// İşİ YAPTIRAN SON MÜŞTERİNİN ADI ve TELEFONU — fatura açıklamasının başına yazılır
    /// (2026-08-21 kullanıcı kuralı).
    ///
    /// <para>
    /// Cari çoğu zaman BAYİ olduğu için faturadaki cari adı "işi kim yaptırdı" sorusunu
    /// cevaplamıyor; kâğıtta yalnız ürün adı görünüyordu. Değerler ServiceOps'ta duruyor
    /// (servis kaydı) ve oradan gönderiliyor — B2B'nin servis kaydına erişimi yok.
    /// Gelmezse açıklama eskisi gibi yalnız ürün adıyla kalır.
    /// </para>
    /// </summary>
    public string? ServiceCustomerName { get; set; }

    /// <inheritdoc cref="ServiceCustomerName"/>
    public string? ServiceCustomerPhone { get; set; }
}

public sealed class CreateDirectVehicleSaleRequest
{
    [Required]
    public string CustomerCode { get; set; } = string.Empty;

    public string? DeliveryCustomerCode { get; set; }

    [Required]
    public int WarehouseCode { get; set; }

    [Required]
    public string PaymentMethod { get; set; } = string.Empty; // Cash, Bank, OpenAccount

    public int? AccountId { get; set; } // CashAccountId or BankAccountDefinitionId

    public decimal? CashAmount { get; set; }

    public string? InvoiceSerie { get; set; }
    public long? InvoiceNumber { get; set; }

    [Required]
    public List<DirectVehicleSaleLineRequest> Lines { get; set; } = new();
}

public sealed class DirectVehicleSaleLineRequest
{
    [Required]
    public string StockCode { get; set; } = string.Empty;

    [Range(0.001, double.MaxValue)]
    public decimal Quantity { get; set; }
}

public sealed class CalculateDirectSalePricesRequest
{
    [Required]
    public string CustomerCode { get; set; } = string.Empty;

    [Required]
    public List<string> StockCodes { get; set; } = new();
}

public sealed class CalculateDirectSalePricesResponse
{
    public string StockCode { get; set; } = string.Empty;
    public decimal UnitPrice { get; set; }
    public string Currency { get; set; } = "TRY";
    public decimal UnitPriceTry { get; set; }
    public decimal TaxRate { get; set; }
}

public sealed class CreateInvoiceLineInstallationRequest
{
    public Guid? InstallationClientId { get; set; }
    public Guid? LineageId { get; set; }
    public decimal Quantity { get; set; }
    public string? CustomerName { get; set; }
    public string? Phone { get; set; }
    public string? Address { get; set; }
    public string? Region { get; set; }
    public string? Note { get; set; }
    public string? DealerName { get; set; }
    public string? ProductName { get; set; }
}

public sealed class UpdateInvoiceLineInstallationRequest
{
    public decimal Quantity { get; set; }
    public string? CustomerName { get; set; }
    public string? Phone { get; set; }
    public string? Address { get; set; }
    public string? Region { get; set; }
    public string? Note { get; set; }
    public string? DealerName { get; set; }
    public string? ProductName { get; set; }
}

internal static class PaymentCurrencyCalculator
{
    public static (int typeId, decimal rate, decimal amount) CalculatePaymentCurrencyInfo(
        int customerCurrencyTypeId,
        decimal customerCurrencyAmount,
        decimal customerTryRate,
        int paymentAccountCurrencyTypeId,
        decimal paymentAccountCurrencyAmount,
        decimal paymentAccountTryRate,
        decimal grandTotal)
    {
        var typeId = paymentAccountCurrencyTypeId == 0 ? 1 : paymentAccountCurrencyTypeId;
        var amount = paymentAccountCurrencyAmount > 0 ? paymentAccountCurrencyAmount : grandTotal;
        
        var custCurr = customerCurrencyTypeId == 0 ? 1 : customerCurrencyTypeId;
        var payCurr = typeId;

        decimal rate = 1m;

        if (custCurr == payCurr)
        {
            rate = 1m;
        }
        else if (custCurr != 1 && payCurr != 1)
        {
            // Çapraz Kur: örn EUR (1000 EUR) faturayı USD (1082.05 USD) kasasından ödeme
            // rate = USD tutarı / EUR tutarı = 1082.05 / 1000 = 1.08205 (EUR/USD Çapraz Kuru)
            if (customerCurrencyAmount > 0 && amount > 0)
            {
                rate = Math.Round(amount / customerCurrencyAmount, 4);
            }
            else if (paymentAccountTryRate > 0 && customerTryRate > 0)
            {
                rate = Math.Round(customerTryRate / paymentAccountTryRate, 4);
            }
        }
        else if (custCurr == 1 && payCurr != 1)
        {
            // TL fatura -> Döviz Kasa (USD): USD/TRY kuru
            rate = paymentAccountTryRate <= 0 ? 1m : paymentAccountTryRate;
        }
        else if (custCurr != 1 && payCurr == 1)
        {
            // Döviz fatura (EUR) -> TL Kasa: EUR/TRY kuru
            rate = customerTryRate <= 0 ? 1m : customerTryRate;
        }

        return (typeId, rate, amount);
    }
}
