using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Core.Services;

public enum CreditLimitStatus
{
    /// <summary>Cari bulunamadı / limit kaydı yok: kontrol uygulanmaz.</summary>
    NotApplicable = 0,
    Within = 1,
    Exceeded = 2,
    SchemaOutdated = 3,
    CalculationFailed = 4
}

/// <summary>
/// Bir belgenin (sipariş, teklif) cariye getireceği riskin limit karşısındaki durumu.
/// Tüm tutarlar limit carisinin para biriminde döner.
/// </summary>
public sealed class CreditLimitEvaluation
{
    public CreditLimitStatus Status { get; init; }

    public string CustomerCode { get; init; } = string.Empty;

    /// <summary>Şube ise limitin okunduğu ana cari, değilse carinin kendisi.</summary>
    public string LimitCustomerCode { get; init; } = string.Empty;

    public decimal CreditLimit { get; init; }
    public int CurrencyTypeId { get; init; }
    public string CurrencySymbol { get; init; } = "₺";

    public decimal Balance { get; init; }
    public decimal ExposureBalance { get; init; }
    public decimal OpenOrdersRisk { get; init; }
    public decimal OpenInvoicesRisk { get; init; }
    public decimal DocumentTotal { get; init; }
    public decimal Projected { get; init; }

    /// <summary>Limitin aşılan kısmı; aşım yoksa 0.</summary>
    public decimal RequiredPayment => Projected > CreditLimit ? Projected - CreditLimit : 0m;

    public string? SqlState { get; init; }
    public string? ErrorType { get; init; }
    public string? Error { get; init; }
    public string? InnerError { get; init; }
}

public interface ICreditLimitService
{
    /// <summary>
    /// Cari için mevcut risk (bakiye + portföydeki çekler + açık siparişler + işlenmemiş
    /// faturalar) üzerine <paramref name="documentTotal"/> eklendiğinde limitin aşılıp
    /// aşılmadığını hesaplar.
    /// </summary>
    /// <param name="documentTotal">
    /// Belgenin KDV dahil genel toplamı, <paramref name="documentCurrencyTypeId"/> ile
    /// belirtilen para biriminde. ÇEVRİLMEZ.
    /// </param>
    /// <param name="documentCurrencyTypeId">Belgenin para birimi (1=TRY 2=EUR 3=USD 4=GBP).</param>
    Task<CreditLimitEvaluation> EvaluateAsync(
        string? customerCode,
        decimal documentTotal,
        int documentCurrencyTypeId = 1,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// KREDİ LİMİTİ PARA BİRİMİ BAŞINA AYRI YÜRÜR (2026-08-19, kullanıcı kuralı).
///
/// <para>
/// Eskiden tek bir TL limiti vardı ve bütün risk bileşenleri TL çapasında toplanıyordu.
/// İki sorun üretiyordu: (1) aynı 10.000 dolarlık borç kur değiştikçe farklı miktarda limit
/// tüketiyordu, (2) belgenin tutarı yanlışlıkla dövizken TL sanıldığında risk kur katı kadar
/// eksik hesaplanıyordu. Artık dolarlı belge YALNIZCA dolar limitine, euro belge euro
/// limitine yürür; bu sınıfın hiçbir yerinde kurla çarpma/bölme yoktur.
/// </para>
///
/// <para>
/// ⚠️ HESAP KAPSAMI: mal satışları carinin -1/-2/-3 alt hesabına, tahsilatlar ana cariye
/// yazılır. Limit yalnızca ana koda bakıyordu, yani faturaların borcunu HİÇ GÖRMÜYORDU —
/// ana hesapta yalnız alacaklar birikiyor, bakiye eksi çıkıyor ve limit hiç aşılmıyordu.
/// (Ölçüldü: DEMOTEST'te borçların 3.876.101'i alt hesapta, ana hesapta 106.133.)
/// Artık ana kod + bütün alt hesapları tek havuz sayılıyor.
/// </para>
/// </summary>
public sealed class CreditLimitService : ICreditLimitService
{
    private readonly AppDbContext _dbContext;
    private readonly IMoneyServiceClient _money;
    private readonly ICustomerAccountService _customerAccountService;

    public CreditLimitService(
        AppDbContext dbContext,
        IMoneyServiceClient money,
        ICustomerAccountService customerAccountService)
    {
        _dbContext = dbContext;
        _money = money;
        _customerAccountService = customerAccountService;
    }

    public async Task<CreditLimitEvaluation> EvaluateAsync(
        string? customerCode,
        decimal documentTotal,
        int documentCurrencyTypeId = 1,
        CancellationToken cancellationToken = default)
    {
        var code = (customerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(code))
        {
            return new CreditLimitEvaluation { Status = CreditLimitStatus.NotApplicable };
        }

        var currency = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(documentCurrencyTypeId);
        var currencySymbol = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToSymbol(currency);

        // Şubenin riski ana carinin limitinden düşer.
        var targetCustomer = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == code)
            .Select(x => new { x.CustomerCode, x.ParentCustomerCode, x.CustomerType })
            .FirstOrDefaultAsync(cancellationToken);

        var limitCustomerCode = code;
        if (targetCustomer != null)
        {
            var isSube = string.Equals(targetCustomer.CustomerType, "sube", StringComparison.OrdinalIgnoreCase) ||
                         string.Equals(targetCustomer.CustomerType, "şube", StringComparison.OrdinalIgnoreCase) ||
                         (targetCustomer.CustomerCode ?? "").StartsWith("01-");

            if (isSube && !string.IsNullOrWhiteSpace(targetCustomer.ParentCustomerCode))
            {
                limitCustomerCode = targetCustomer.ParentCustomerCode.Trim();
            }
        }

        var limitInfo = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == limitCustomerCode)
            .Select(x => new { x.CustomerCode, x.CreditLimit, x.CreditLimitUsd, x.CreditLimitEur, x.CreditLimitGbp })
            .FirstOrDefaultAsync(cancellationToken);

        if (limitInfo is null)
        {
            return new CreditLimitEvaluation
            {
                Status = CreditLimitStatus.NotApplicable,
                CustomerCode = code,
                LimitCustomerCode = limitCustomerCode,
                CurrencyTypeId = currency,
                CurrencySymbol = currencySymbol
            };
        }

        // Belgenin para biriminin KENDİ limiti. Başka para biriminin limiti bu hesaba girmez.
        var creditLimit = currency switch
        {
            B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Usd => limitInfo.CreditLimitUsd,
            B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Eur => limitInfo.CreditLimitEur,
            B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Gbp => limitInfo.CreditLimitGbp,
            _ => limitInfo.CreditLimit
        };

        try
        {
            // Ana cari + alt hesaplar (-1/-2/-3) tek havuz.
            var relatedCodes = await _customerAccountService
                .GetRelatedCustomerCodesForLedgerAsync(limitCustomerCode, cancellationToken);

            if (relatedCodes.Count == 0)
            {
                relatedCodes = new List<string> { limitCustomerCode };
            }

            // BAKİYE BELGENİN PARA BİRİMİNDE. Amount TL çapasıdır, satırın kendi tutarı
            // CurrencyAmount'tadır; boş kalmış eski satırda TL tutara düşülür (o satırlar
            // zaten TL). Başka para birimindeki satırlar bu hesaba HİÇ girmez.
            var ledgerRows = await _dbContext.CustomerLedgerEntries
                .AsNoTracking()
                .Where(x => relatedCodes.Contains(x.CustomerCode))
                .Select(x => new { x.Direction, x.CurrencyTypeId, x.CurrencyAmount, x.Amount })
                .ToListAsync(cancellationToken);

            var balance = 0m;
            foreach (var row in ledgerRows)
            {
                if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(row.CurrencyTypeId) != currency)
                {
                    continue;
                }

                var value = row.CurrencyAmount > 0m ? row.CurrencyAmount : row.Amount;
                balance += row.Direction == CustomerLedgerEntryDirection.Debit ? value : -value;
            }

            // PORTFÖYDEKİ ÇEKLER — yalnızca aynı para birimindekiler, HAM tutarla.
            // Eskiden hepsi kurla TL'ye çevrilip tek toplama giriyordu.
            var pendingChecksAmount = await _dbContext.CustomerChecks
                .AsNoTracking()
                .Where(x => x.PaymentStatus == CustomerCheckPaymentStatus.Pending
                            && x.Status != CustomerCheckStatus.Returned
                            && x.Status != CustomerCheckStatus.Dishonored)
                .Where(x => (x.Status == CustomerCheckStatus.EndorsedToCustomer && x.CurrentCustomerCode != null && relatedCodes.Contains(x.CurrentCustomerCode))
                            || (x.Status != CustomerCheckStatus.EndorsedToCustomer && relatedCodes.Contains(x.CustomerCode)))
                .Where(x => (x.CurrencyTypeId == 0 ? 1 : x.CurrencyTypeId) == currency)
                .Select(x => (decimal?)x.Amount)
                .SumAsync(cancellationToken) ?? 0m;

            var exposureBalance = balance + pendingChecksAmount;

            // AÇIK SİPARİŞ RİSKİ — kalemlerden, belgenin para biriminde.
            //
            // Sipariş başlığının GrandTotal'ı TL'dir; oranlayıp dövize çevirmek yine kur
            // demekti. Kalemin kendi dövizli fiyatı kullanılıyor, faturalanan kısım aynı
            // ölçüyle düşülüyor.
            var openOrderIds = await _dbContext.Set<SalesOrder>()
                .AsNoTracking()
                .Where(x => relatedCodes.Contains(x.CustomerCode) && x.Status == 0)
                .Select(x => x.Id)
                .ToListAsync(cancellationToken);

            var openOrdersRisk = 0m;
            if (openOrderIds.Count > 0)
            {
                var orderLines = await _dbContext.Set<SalesOrderLine>()
                    .AsNoTracking()
                    .Where(l => openOrderIds.Contains(l.SalesOrderId) && !l.IsGift)
                    .Select(l => new { l.Id, l.CurrencyTypeId, l.Quantity, l.UnitPrice, l.CurrencyUnitPrice, l.VatRate })
                    .ToListAsync(cancellationToken);

                var scopedLines = orderLines
                    .Where(l => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(l.CurrencyTypeId) == currency)
                    .ToList();

                var scopedLineIds = scopedLines.Select(l => l.Id).ToList();

                var orderedGross = scopedLines
                    .Sum(l => l.Quantity * DocPrice(l.CurrencyTypeId, l.UnitPrice, l.CurrencyUnitPrice) * (1m + (l.VatRate / 100m)));

                var invoicedGross = 0m;
                if (scopedLineIds.Count > 0)
                {
                    var invoicedRows = await _dbContext.Set<InvoiceLine>()
                        .AsNoTracking()
                        .Where(il => il.SalesOrderLineId != null && scopedLineIds.Contains(il.SalesOrderLineId.Value))
                        .Select(il => new { il.CurrencyTypeId, il.Quantity, il.UnitPrice, il.CurrencyUnitPrice, il.VatRate })
                        .ToListAsync(cancellationToken);

                    invoicedGross = invoicedRows
                        .Sum(il => il.Quantity * DocPrice(il.CurrencyTypeId, il.UnitPrice, il.CurrencyUnitPrice) * (1m + (il.VatRate / 100m)));
                }

                openOrdersRisk = orderedGross - invoicedGross;
            }

            if (openOrdersRisk < 0m) openOrdersRisk = 0m;

            // EKSTREYE HENÜZ DÜŞMEMİŞ FATURALAR — yine kalemlerden, belgenin para biriminde.
            var openInvoiceIds = await _dbContext.Set<Invoice>()
                .AsNoTracking()
                .Where(x => x.Type == InvoiceType.SalesInvoice && relatedCodes.Contains(x.CustomerCode))
                .Where(inv => !_dbContext.CustomerLedgerEntries.Any(le =>
                    le.ReferenceType == CustomerLedgerEntryReferenceType.Invoice && le.ReferenceId == inv.Id))
                .Select(x => x.Id)
                .ToListAsync(cancellationToken);

            var openInvoicesRisk = 0m;
            if (openInvoiceIds.Count > 0)
            {
                var openInvoiceLines = await _dbContext.Set<InvoiceLine>()
                    .AsNoTracking()
                    .Where(il => openInvoiceIds.Contains(il.InvoiceId))
                    .Select(il => new { il.CurrencyTypeId, il.Quantity, il.UnitPrice, il.CurrencyUnitPrice, il.VatRate })
                    .ToListAsync(cancellationToken);

                openInvoicesRisk = openInvoiceLines
                    .Where(il => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(il.CurrencyTypeId) == currency)
                    .Sum(il => il.Quantity * DocPrice(il.CurrencyTypeId, il.UnitPrice, il.CurrencyUnitPrice) * (1m + (il.VatRate / 100m)));
            }

            if (openInvoicesRisk < 0m) openInvoicesRisk = 0m;

            var projected = exposureBalance + openOrdersRisk + openInvoicesRisk + documentTotal;

            return new CreditLimitEvaluation
            {
                Status = projected > creditLimit ? CreditLimitStatus.Exceeded : CreditLimitStatus.Within,
                CustomerCode = code,
                LimitCustomerCode = limitCustomerCode,
                CreditLimit = creditLimit,
                CurrencyTypeId = currency,
                CurrencySymbol = currencySymbol,
                Balance = balance,
                ExposureBalance = exposureBalance,
                OpenOrdersRisk = openOrdersRisk,
                OpenInvoicesRisk = openInvoicesRisk,
                DocumentTotal = documentTotal,
                Projected = projected
            };
        }
        catch (PostgresException pg) when (pg.SqlState == "42703")
        {
            // Kiracı şeması eski (kolon yok). 500 yerine anlaşılır durum dönülür.
            return new CreditLimitEvaluation
            {
                Status = CreditLimitStatus.SchemaOutdated,
                CustomerCode = code,
                LimitCustomerCode = limitCustomerCode,
                CurrencyTypeId = currency,
                CurrencySymbol = currencySymbol,
                SqlState = pg.SqlState,
                ErrorType = pg.GetType().Name,
                Error = pg.Message,
                InnerError = pg.InnerException?.Message
            };
        }
        catch (Exception ex)
        {
            return new CreditLimitEvaluation
            {
                Status = CreditLimitStatus.CalculationFailed,
                CustomerCode = code,
                LimitCustomerCode = limitCustomerCode,
                CurrencyTypeId = currency,
                CurrencySymbol = currencySymbol,
                ErrorType = ex.GetType().Name,
                Error = ex.Message,
                InnerError = ex.InnerException?.Message
            };
        }
    }

    /// <summary>
    /// Satırın BELGE PARASINDAKİ birim fiyatı. TL satırda UnitPrice zaten TL'dir; dövizli
    /// satırda dövizli değer CurrencyUnitPrice'tadır (UnitPrice TL çapası). Dövizli alan boş
    /// kalmış eski satırda TL fiyata düşülür — kurla bölmek yerine böyle saymak yeğ: bu
    /// sınıfın tamamı "hiç kur kullanma" kuralı üzerine kurulu.
    /// </summary>
    private static decimal DocPrice(int lineCurrencyTypeId, decimal unitPrice, decimal currencyUnitPrice)
    {
        if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(lineCurrencyTypeId)) return unitPrice;
        return currencyUnitPrice > 0m ? currencyUnitPrice : unitPrice;
    }

    private async Task<decimal> ResolveTryRateAsync(int currencyTypeId, CancellationToken cancellationToken)
    {
        // GBP (4) bir ara USD'ye (3) katlanıyordu ve switch'te GBP hiç yoktu; sterlin
        // takipli carinin limiti dolar kuruyla değerlendiriliyordu.
        if (currencyTypeId is 0 or 1) return 1m;

        var code = currencyTypeId switch
        {
            2 => "EUR",
            3 => "USD",
            4 => "GBP",
            _ => null
        };

        if (string.IsNullOrWhiteSpace(code)) return 0m;

        try
        {
            return await _money.GetLatestTryRateAsync(code, cancellationToken);
        }
        catch
        {
            return 0m;
        }
    }
}
