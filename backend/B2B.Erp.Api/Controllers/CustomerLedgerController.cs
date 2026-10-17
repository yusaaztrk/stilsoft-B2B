using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.CustomerLedger;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/customer-ledger")]
[Authorize]
public sealed class CustomerLedgerController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly Core.Services.ICustomerAccountService _customerAccountService;

    public CustomerLedgerController(AppDbContext dbContext, Core.Services.ICustomerAccountService customerAccountService)
    {
        _dbContext = dbContext;
        _customerAccountService = customerAccountService;
    }

    [HttpGet]
    [AuthorizePage("reports", "cariEkstre")]
    public async Task<IActionResult> List(
        [FromQuery] string customerCode,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] string? accountType,
        [FromQuery] int? periodId,
        CancellationToken cancellationToken = default)
    {
        customerCode = (customerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(customerCode))
        {
            return Ok(new { success = true, data = new CustomerLedgerListResponseDto() });
        }

        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var userCariKodu = User.FindFirst("Carikodu")?.Value?.Trim();
        var isAllCaris = isSsa || string.IsNullOrEmpty(userCariKodu) || userCariKodu == "*" || string.Equals(userCariKodu, "ALL", StringComparison.OrdinalIgnoreCase);

        if (!isAllCaris)
        {
            var userIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? User.FindFirst("UserId")?.Value;
            if (int.TryParse(userIdStr, out var uId))
            {
                var dbCariCode = await _dbContext.Users.AsNoTracking().Where(u => u.Id == uId).Select(u => u.Carikodu).FirstOrDefaultAsync(cancellationToken);
                var dbCari = dbCariCode?.Trim();
                if (string.IsNullOrEmpty(dbCari) || dbCari == "*" || string.Equals(dbCari, "ALL", StringComparison.OrdinalIgnoreCase))
                {
                    isAllCaris = true;
                }
            }
        }

        if (!isAllCaris)
        {
            var salesmanCode = User.FindFirst("SalesmanCode")?.Value?.Trim();
            if (!string.IsNullOrEmpty(salesmanCode))
            {
                var allowed = await _dbContext.Customers.AsNoTracking().AnyAsync(x =>
                    x.CustomerCode == customerCode &&
                     // Şube paylaşılmaz (2026-09-06): kendi plasiyeri olan şube ana carinin
                     // plasiyerine açılmaz; yalnız plasiyeri BOŞ şube ana cariden miras alır.
                    (x.SalesmanCode == salesmanCode ||
                     (x.ParentCustomerCode != null
                      && (x.SalesmanCode == null || x.SalesmanCode == "")
                      && _dbContext.Customers.Any(p => p.CustomerCode == x.ParentCustomerCode && p.SalesmanCode == salesmanCode))), cancellationToken);

                if (!allowed)
                {
                    return Forbid();
                }
            }
            else if (!string.IsNullOrEmpty(userCariKodu))
            {
                var allowed = customerCode == userCariKodu || await _dbContext.Customers.AsNoTracking().AnyAsync(x =>
                    x.CustomerCode == customerCode && x.ParentCustomerCode == userCariKodu, cancellationToken);

                if (!allowed)
                {
                    return Forbid();
                }
            }
        }

        // CARİ EKSTRE TİP YETKİSİ (2026-10-11): kullanıcıya hangi cari tiplerinin ekstresi açıksa.
        var ekstreTipleri = await B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.AllowedAsync(_dbContext, User, cancellationToken);
        if (ekstreTipleri is not null)
        {
            var tip = await CariEkstreTipiAsync(customerCode, cancellationToken);
            if (!ekstreTipleri.Contains(tip)) return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.DeniedMessage(tip) });
        }

        string resolvedCustomerCode = customerCode;
        string resolvedCustomerName = string.Empty;
        string resolvedCustomerEmail = string.Empty;
        string resolvedCustomerPhone = string.Empty;

        var cust = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == customerCode)
            .Select(x => new { x.CustomerCode, x.Name, x.Email, x.Phone, x.InvoiceType, x.AccountRole, x.PriceGroupId, PriceGroupCode = x.PriceGroupEntity != null ? (int?)x.PriceGroupEntity.Code : null })
            .FirstOrDefaultAsync(cancellationToken);

        var mainCustomerCodeCheck = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(customerCode);
        var invoiceAccountCodeCheck = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.BuildInvoiceAccountCode(mainCustomerCodeCheck);

        bool hasConnectedInvoiceAccount = await _dbContext.Customers
            .AsNoTracking()
            .AnyAsync(x => x.CustomerCode == invoiceAccountCodeCheck || (x.MainCustomerCode == mainCustomerCodeCheck && x.AccountRole == CustomerAccountRole.InvoiceAccount), cancellationToken);

        bool isFaturaAccountCustomer = cust != null && !hasConnectedInvoiceAccount && cust.AccountRole != CustomerAccountRole.OpenMain && (
            (cust.InvoiceType != null && (cust.InvoiceType.Equals("FATURA", StringComparison.OrdinalIgnoreCase) || cust.InvoiceType.Equals("FATURALI", StringComparison.OrdinalIgnoreCase) || cust.InvoiceType.Equals("ASKERIYE", StringComparison.OrdinalIgnoreCase) || cust.InvoiceType.Equals("ASKERİYE", StringComparison.OrdinalIgnoreCase))) ||
            (cust.PriceGroupCode.HasValue && (cust.PriceGroupCode.Value == 1 || cust.PriceGroupCode.Value == 2 || cust.PriceGroupCode.Value == 3 || cust.PriceGroupCode.Value == 7)) ||
            (cust.Name != null && (cust.Name.ToUpper().Contains("ASKERİYE") || cust.Name.ToUpper().Contains("ASKERIYE") || cust.Name.ToUpper().Contains("KOLORDU") || cust.Name.ToUpper().Contains("TUGAY") || cust.Name.ToUpper().Contains("KOMUTAN")))
        );

        if (cust != null && ((cust.InvoiceType != null && cust.InvoiceType.Equals("ACIK", StringComparison.OrdinalIgnoreCase)) || (cust.PriceGroupCode.HasValue && cust.PriceGroupCode.Value >= 4 && cust.PriceGroupCode.Value <= 6)))
        {
            isFaturaAccountCustomer = false;
        }

        if (cust != null)
        {
            resolvedCustomerCode = cust.CustomerCode;
            resolvedCustomerName = cust.Name ?? string.Empty;
            resolvedCustomerEmail = cust.Email ?? string.Empty;
            resolvedCustomerPhone = cust.Phone ?? string.Empty;
        }
        else
        {
            var mCust = await _dbContext.MuhtelifCustomers
                .AsNoTracking()
                .Where(x => x.CustomerCode == customerCode)
                .Select(x => new { x.CustomerCode, x.Name, x.Email, x.Phone })
                .FirstOrDefaultAsync(cancellationToken);

            if (mCust != null)
            {
                resolvedCustomerCode = mCust.CustomerCode;
                resolvedCustomerName = mCust.Name ?? string.Empty;
                resolvedCustomerEmail = mCust.Email ?? string.Empty;
                resolvedCustomerPhone = mCust.Phone ?? string.Empty;
            }
            else
            {
                return Ok(new { success = true, data = new CustomerLedgerListResponseDto() });
            }
        }

        static DateTime? Norm(DateTime? d)
        {
            if (!d.HasValue) return null;
            var v = d.Value;
            if (v == default) return null;
            return v.Kind == DateTimeKind.Utc ? v : DateTime.SpecifyKind(v, DateTimeKind.Utc);
        }

        var from = Norm(fromDate);
        var to = Norm(toDate);
        if (to.HasValue)
        {
            // include the whole day
            to = to.Value.Date.AddDays(1).AddTicks(-1);
            to = DateTime.SpecifyKind(to.Value, DateTimeKind.Utc);
        }

        var relatedCustomerCodes = await _customerAccountService.GetRelatedCustomerCodesForLedgerAsync(customerCode, cancellationToken);
        var mainCustomerCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(customerCode);
        var faturaAccountCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.BuildInvoiceAccountCode(mainCustomerCode);
        var acikAccountCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.BuildOpenAccountCode(mainCustomerCode);
        var askeriyeAccountCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.BuildAskeriyeAccountCode(mainCustomerCode);

        var normAccountType = (accountType ?? string.Empty).Trim().ToUpperInvariant();
        List<string> targetCodes;
        if (normAccountType == "ACIK")
        {
            targetCodes = new List<string> { acikAccountCode, mainCustomerCode };
            if (!string.IsNullOrWhiteSpace(mainCustomerCodeCheck) && !targetCodes.Contains(mainCustomerCodeCheck))
            {
                targetCodes.Add(mainCustomerCodeCheck);
            }
        }
        else if (normAccountType == "FATURA")
        {
            targetCodes = new List<string> { faturaAccountCode, mainCustomerCode };
            if (!string.IsNullOrWhiteSpace(mainCustomerCodeCheck) && !targetCodes.Contains(mainCustomerCodeCheck))
            {
                targetCodes.Add(mainCustomerCodeCheck);
            }
        }
        else if (normAccountType == "ASKERIYE")
        {
            targetCodes = new List<string> { askeriyeAccountCode, mainCustomerCode };
        }
        else
        {
            targetCodes = relatedCustomerCodes;
            if (!string.IsNullOrWhiteSpace(mainCustomerCode) && !targetCodes.Contains(mainCustomerCode))
            {
                targetCodes.Add(mainCustomerCode);
            }
        }

        var baseQuery = _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .Where(x => targetCodes.Contains(x.CustomerCode));

        if (periodId.HasValue && periodId.Value > 0)
        {
            baseQuery = baseQuery.Where(x => x.AccountingPeriodId == periodId.Value || (x.AccountingPeriodId == null && !x.IsOpeningBalance));
        }
        else
        {
            // "Tüm Dönemler": Exclude opening balance devir entries to prevent double-counting balances across years
            baseQuery = baseQuery.Where(x => !x.IsOpeningBalance);
        }

        if (from.HasValue) baseQuery = baseQuery.Where(x => x.Date >= from.Value);
        if (to.HasValue) baseQuery = baseQuery.Where(x => x.Date <= to.Value);

        var rows = await baseQuery
            .OrderBy(x => x.CreateTime)
            .ThenBy(x => x.Id)
            .Select(x => new LedgerRowDto
            {
                Id = x.Id,
                CustomerCode = x.CustomerCode,
                Date = x.Date,
                CreateTime = x.CreateTime,
                DueDate = x.DueDate,
                Direction = x.Direction,
                Amount = x.Amount,
                CurrencyTypeId = x.CurrencyTypeId,
                CurrencyRate = x.CurrencyRate,
                CurrencyAmount = x.CurrencyAmount,
                PaymentCurrencyTypeId = x.PaymentCurrencyTypeId,
                PaymentCurrencyRate = x.PaymentCurrencyRate,
                PaymentCurrencyAmount = x.PaymentCurrencyAmount,
                TargetAccountCurrencyTypeId = x.TargetAccountCurrencyTypeId,
                ExchangeCode = x.ExchangeCode,
                DocumentNo = x.DocumentNo,
                Description = x.Description,
                TransactionType = x.TransactionType,
                DeliveryCustomerCode = x.DeliveryCustomerCode,
                ReferenceType = x.ReferenceType,
                ReferenceId = x.ReferenceId,
                Balance = x.Balance
            })
            .ToListAsync(cancellationToken);

        rows = rows
            .OrderBy(x => x.CreateTime)
            .ThenBy(x => x.Id)
            .ToList();

        var customerCheckIds = rows
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check 
                     && x.ReferenceId.HasValue 
                     && x.TransactionType == "Müşteri Çeki")
            .Select(x => x.ReferenceId!.Value)
            .Distinct()
            .ToList();

        var payableCheckIds = rows
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check 
                     && x.ReferenceId.HasValue 
                     && x.TransactionType == "Borç Çeki")
            .Select(x => x.ReferenceId!.Value)
            .Distinct()
            .ToList();

        var customerCheckNos = customerCheckIds.Count > 0
            ? await _dbContext.CustomerChecks
                .AsNoTracking()
                .Where(x => customerCheckIds.Contains(x.Id))
                .Select(x => new { x.Id, x.CheckNo, x.DocumentNo })
                .ToDictionaryAsync(x => x.Id, x => !string.IsNullOrWhiteSpace(x.CheckNo) ? x.CheckNo : x.DocumentNo, cancellationToken)
            : new Dictionary<int, string>();

        var payableCheckNos = payableCheckIds.Count > 0
            ? await _dbContext.PayableChecks
                .AsNoTracking()
                .Where(x => payableCheckIds.Contains(x.Id))
                .Select(x => new { x.Id, x.CheckNo, x.DocumentNo })
                .ToDictionaryAsync(x => x.Id, x => !string.IsNullOrWhiteSpace(x.CheckNo) ? x.CheckNo : x.DocumentNo, cancellationToken)
            : new Dictionary<int, string>();


        foreach (var r in rows)
        {
            Console.WriteLine($"[LEDGER-DEBUG] Id={r.Id}, Date={r.Date:yyyy-MM-dd HH:mm:ss}, Type={r.TransactionType}, Doc={r.DocumentNo}, Direction={r.Direction}, Amount={r.Amount}");
        }

        var deliveryCodes = rows
            .Select(x => x.DeliveryCustomerCode)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x!)
            .Distinct()
            .ToList();

        var deliveryNames = deliveryCodes.Count == 0
            ? new Dictionary<string, string>()
            : await _dbContext.Customers
                .AsNoTracking()
                .Where(x => deliveryCodes.Contains(x.CustomerCode))
                .Select(x => new { x.CustomerCode, x.Name })
                .ToDictionaryAsync(x => x.CustomerCode, x => x.Name, cancellationToken);

        var invoiceIds = rows
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice && x.ReferenceId.HasValue && x.ReferenceId.Value > 0)
            .Select(x => x.ReferenceId!.Value)
            .Distinct()
            .ToList();

        var invoiceGrandTotals = new Dictionary<int, decimal>();

        // ⚠️ `ReferenceType = Invoice` İKİ TABLOYU BİRDEN GÖSTERİYOR (2026-08-22'de canlıda yakalandı).
        //
        // Hem `Invoices` (satış) hem `PurchaseInvoices` (alış/gider) defter satırlarını AYNI
        // `ReferenceType` değeriyle yazıyor, ama id dizileri AYRI: iki tabloda da 1 numaralı
        // kayıt var ve bunlar farklı belgeler. Aşağıda `ReferenceId` yalnızca `Invoices`'ta
        // arandığı için alış faturasından doğmuş satır, aynı numaralı bir SATIŞ faturasıyla
        // eşleşiyordu.
        //
        // Canlı örnek: defter satırı 486, gerçek tutar 370.000,00 (HZ260822125428, alış).
        // `ReferenceId = 1` → `Invoices` id 1 = A00000000071102, 20.860,00. Ekstre ekranda
        // 20.860,00 yazıyordu. Bakiye doğruydu (o `Amount` alanından gelir), YANLIŞ OLAN
        // yalnızca gösterilen tutar ve açıklamaydı — ama kullanıcı için ekstre okunamaz hale
        // geliyordu.
        //
        // Kimlik kuralı: eşleşme ancak faturanın KENDİ belge numarası defter satırınınkiyle
        // aynıysa kabul edilir. Tutmuyorsa satırın kendi değerleri kullanılır.
        var invoiceDocNos = new Dictionary<int, string>();
        var invoiceNotesMap = new Dictionary<int, string>();
        if (invoiceIds.Count > 0)
        {
            var invData = await _dbContext.Invoices
                .AsNoTracking()
                .Where(x => invoiceIds.Contains(x.Id))
                .Select(x => new { x.Id, x.GrandTotal, x.Description, x.InvoiceNo })
                .ToListAsync(cancellationToken);

            invoiceGrandTotals = invData.ToDictionary(x => x.Id, x => x.GrandTotal);
            invoiceDocNos = invData.ToDictionary(x => x.Id, x => x.InvoiceNo ?? string.Empty);

            var lineDescs = await _dbContext.Set<InvoiceLine>()
                .AsNoTracking()
                .Where(x => invoiceIds.Contains(x.InvoiceId) && !string.IsNullOrWhiteSpace(x.Description))
                .Select(x => new { x.InvoiceId, Description = x.Description!.Trim() })
                .ToListAsync(cancellationToken);

            var lineDescLookup = lineDescs
                .GroupBy(x => x.InvoiceId)
                .ToDictionary(
                    g => g.Key,
                    g => new HashSet<string>(g.Select(x => x.Description), StringComparer.OrdinalIgnoreCase)
                );

            foreach (var inv in invData)
            {
                var n = !string.IsNullOrWhiteSpace(inv.Description) ? inv.Description.Trim() : string.Empty;
                if (!string.IsNullOrEmpty(n))
                {
                    if (lineDescLookup.TryGetValue(inv.Id, out var lineSet) && lineSet.Contains(n))
                    {
                        continue;
                    }
                    invoiceNotesMap[inv.Id] = n;
                }
            }
        }

        // TL üzerinden yürüyen bakiye (geriye dönük uyumluluk) ve PARA BİRİMİ BAŞINA yürüyen
        // bakiye birlikte hesaplanır. Karışık dövizli caride tek sayılık bakiye anlamsızdır:
        // TL alacağı ile USD alacağı ayrı hesaplardır, birbirine mahsup edilmez.
        decimal running = 0m;
        var runningByCurrency = new Dictionary<int, decimal>();
        var debitByCurrency = new Dictionary<int, decimal>();
        var creditByCurrency = new Dictionary<int, decimal>();
        var openingByCurrency = new Dictionary<int, decimal>();

        // 0 ile 1 kodda AYNI şeydir (TL); tek anahtarda toplanmalı, yoksa aynı cari iki TL
        // bakiyesi gösterir.
        static int NormalizeCurrency(int currencyTypeId) => currencyTypeId <= 0 ? 1 : currencyTypeId;

        // Satırın kendi para birimindeki tutarı. CurrencyAmount boş kalmış eski kayıtlarda
        // TL için Amount'a, dövizde Amount/kur'a düşülür — aksi halde o satır bakiyeye hiç
        // girmez ve bakiye sessizce eksik çıkar.
        // Tek kaynak Core/Helpers/LedgerAmount: dönem kapanışı da aynı kuralı kullanıyor.
        static decimal AmountInCurrency(int currencyTypeId, decimal amount, decimal currencyAmount, decimal rate)
            => B2B.Erp.Api.Core.Helpers.LedgerAmount.InCurrency(currencyTypeId, amount, currencyAmount, rate);

        if (from.HasValue)
        {
            var priorQuery = _dbContext.CustomerLedgerEntries
                .AsNoTracking()
                .Where(x => targetCodes.Contains(x.CustomerCode) && x.Date < from.Value);

            if (periodId.HasValue && periodId.Value > 0)
            {
                priorQuery = priorQuery.Where(x => x.AccountingPeriodId == periodId.Value || (x.AccountingPeriodId == null && !x.IsOpeningBalance));
            }
            else
            {
                priorQuery = priorQuery.Where(x => !x.IsOpeningBalance);
            }

            var priorRows = await priorQuery
                .Select(x => new
                {
                    x.Direction,
                    x.Amount,
                    x.ReferenceType,
                    x.ReferenceId,
                    x.TransactionType,
                    x.CurrencyTypeId,
                    x.CurrencyAmount,
                    x.CurrencyRate
                })
                .ToListAsync(cancellationToken);

            var priorInvoiceIds = priorRows
                .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice && x.ReferenceId.HasValue && x.ReferenceId.Value > 0)
                .Select(x => x.ReferenceId!.Value)
                .Distinct()
                .ToList();

            var priorInvoiceTotals = new Dictionary<int, decimal>();
            if (priorInvoiceIds.Count > 0)
            {
                priorInvoiceTotals = await _dbContext.Invoices
                    .AsNoTracking()
                    .Where(x => priorInvoiceIds.Contains(x.Id))
                    .ToDictionaryAsync(x => x.Id, x => x.GrandTotal, cancellationToken);
            }

            foreach (var p in priorRows)
            {
                var pAmount = p.Amount;
                var pCurrencyAmount = p.CurrencyAmount;

                if (p.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                    && p.ReferenceId.HasValue
                    && p.TransactionType != null
                    && p.TransactionType.Contains("Fatura", StringComparison.OrdinalIgnoreCase)
                    && priorInvoiceTotals.TryGetValue(p.ReferenceId.Value, out var invTotal)
                    && invTotal > 0m)
                {
                    if (p.CurrencyTypeId > 1 && p.CurrencyRate > 0m)
                    {
                        pCurrencyAmount = invTotal;
                        pAmount = Math.Round(invTotal * p.CurrencyRate, 2, MidpointRounding.AwayFromZero);
                    }
                    else
                    {
                        pAmount = invTotal;
                        pCurrencyAmount = invTotal;
                    }
                }

                var pCur = NormalizeCurrency(p.CurrencyTypeId);
                var pInCur = AmountInCurrency(p.CurrencyTypeId, pAmount, pCurrencyAmount, p.CurrencyRate);
                var pSigned = p.Direction == CustomerLedgerEntryDirection.Debit ? pInCur : -pInCur;

                runningByCurrency[pCur] = runningByCurrency.GetValueOrDefault(pCur) + pSigned;
                openingByCurrency[pCur] = openingByCurrency.GetValueOrDefault(pCur) + pSigned;

                if (p.Direction == CustomerLedgerEntryDirection.Debit)
                {
                    running += pAmount;
                }
                else
                {
                    running -= pAmount;
                }
            }
        }

        decimal totalDebit = 0m;
        decimal totalCredit = 0m;

        // Eşleşen faturanın gerçekten AYNI belge olup olmadığı: belge numaraları tutmalı.
        // Defter satırında belge no yoksa eşleşmeye güvenilmez, satırın kendi değerleri kalır.
        bool AyniBelgeMi(int invoiceId, string? ledgerDocumentNo)
        {
            if (string.IsNullOrWhiteSpace(ledgerDocumentNo)) return false;
            if (!invoiceDocNos.TryGetValue(invoiceId, out var invoiceNo)) return false;
            return string.Equals(invoiceNo?.Trim(), ledgerDocumentNo.Trim(), StringComparison.OrdinalIgnoreCase);
        }

        var items = new List<CustomerLedgerListItemDto>(rows.Count);
        foreach (var r in rows)
        {
            var rAmount = r.Amount;
            var rCurrencyAmount = r.CurrencyAmount;

            // Fatura kaydı ise net Genel Toplam tutarını (iskonto ve KDV düşülmüş nihai tutar) esas al
            if (r.ReferenceType == CustomerLedgerEntryReferenceType.Invoice 
                && r.ReferenceId.HasValue 
                && r.TransactionType != null 
                && r.TransactionType.Contains("Fatura", StringComparison.OrdinalIgnoreCase)
                && invoiceGrandTotals.TryGetValue(r.ReferenceId.Value, out var invGrandTotal)
                && AyniBelgeMi(r.ReferenceId.Value, r.DocumentNo))
            {
                if (invGrandTotal > 0m)
                {
                    if (r.CurrencyTypeId > 1 && r.CurrencyRate > 0m)
                    {
                        rCurrencyAmount = invGrandTotal;
                        rAmount = Math.Round(invGrandTotal * r.CurrencyRate, 2, MidpointRounding.AwayFromZero);
                    }
                    else
                    {
                        rAmount = invGrandTotal;
                        rCurrencyAmount = invGrandTotal;
                    }
                }
            }

            var debit = r.Direction == CustomerLedgerEntryDirection.Debit ? rAmount : 0m;
            var credit = r.Direction == CustomerLedgerEntryDirection.Credit ? rAmount : 0m;

            totalDebit += debit;
            totalCredit += credit;

            running += debit;
            running -= credit;

            // Satırın KENDİ para birimindeki yürüyen bakiye. Her döviz kendi içinde ilerler;
            // "Tümü" görünümünde bile TL satırı TL'yi, USD satırı USD'yi ilerletir.
            var rowCur = NormalizeCurrency(r.CurrencyTypeId);
            var rowInCur = AmountInCurrency(r.CurrencyTypeId, rAmount, rCurrencyAmount, r.CurrencyRate);

            if (r.Direction == CustomerLedgerEntryDirection.Debit)
            {
                debitByCurrency[rowCur] = debitByCurrency.GetValueOrDefault(rowCur) + rowInCur;
                runningByCurrency[rowCur] = runningByCurrency.GetValueOrDefault(rowCur) + rowInCur;
            }
            else
            {
                creditByCurrency[rowCur] = creditByCurrency.GetValueOrDefault(rowCur) + rowInCur;
                runningByCurrency[rowCur] = runningByCurrency.GetValueOrDefault(rowCur) - rowInCur;
            }

            var rowCurrencyBalance = runningByCurrency.GetValueOrDefault(rowCur);

            var hasDetails = !string.IsNullOrWhiteSpace(r.DocumentNo)
                && !string.Equals(r.TransactionType, "Ödeme", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(r.TransactionType, "Tahsilat", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(r.TransactionType, "Virman", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(r.TransactionType, "Devir", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(r.TransactionType, "Açılış", StringComparison.OrdinalIgnoreCase);


            // KAYITLI DEĞER VARSA O KULLANILIR. Önceden "kayıtlı tutar TL tutara ÇOK YAKINSA
            // sahtedir" varsayımıyla (`Math.Abs(... - rAmount) > 0.01m`) yeniden hesaplanıyordu;
            // tutarlar tesadüfen yakın olduğunda (100 $ ödeme ↔ 100 ₺ satır) doğru değer
            // eziliyor ve 100 $ ekstrede 2,63 $ görünüyordu. Türetme yalnız kayıt BOŞSA yapılır.
            decimal paymentCurrAmt;
            if (r.PaymentCurrencyAmount > 0m)
            {
                paymentCurrAmt = r.PaymentCurrencyAmount;
            }
            else if (r.PaymentCurrencyTypeId > 1 && r.PaymentCurrencyRate > 0m)
            {
                paymentCurrAmt = Math.Round(rAmount / r.PaymentCurrencyRate, 2, MidpointRounding.AwayFromZero);
            }
            else
            {
                paymentCurrAmt = rCurrencyAmount;
            }

            string itemTransAccountType;
            if (r.CustomerCode.EndsWith("-3"))
            {
                itemTransAccountType = "ASKERIYE";
            }
            else if (r.CustomerCode.EndsWith("-2"))
            {
                itemTransAccountType = "ACIK";
            }
            else if (r.CustomerCode.EndsWith("-1"))
            {
                itemTransAccountType = "FATURA";
            }
            else
            {
                itemTransAccountType = cust != null && cust.AccountRole == CustomerAccountRole.OpenMain ? "ACIK" : "FATURA";
            }

            var itemDocNo = r.DocumentNo;
            if (r.ReferenceType == CustomerLedgerEntryReferenceType.Check && r.ReferenceId.HasValue)
            {
                if (r.TransactionType == "Müşteri Çeki" && customerCheckNos.TryGetValue(r.ReferenceId.Value, out var checkNo))
                {
                    itemDocNo = checkNo;
                }
                else if (r.TransactionType == "Borç Çeki" && payableCheckNos.TryGetValue(r.ReferenceId.Value, out var pCheckNo))
                {
                    itemDocNo = pCheckNo;
                }
            }

            items.Add(new CustomerLedgerListItemDto
            {
                Id = r.Id,
                CustomerCode = r.CustomerCode,
                DisplayCustomerCode = mainCustomerCode,
                SourceCustomerCode = r.CustomerCode,
                TransactionAccountType = itemTransAccountType,
                CustomerName = resolvedCustomerName,
                DeliveryCustomerCode = r.DeliveryCustomerCode,
                DeliveryCustomerName = !string.IsNullOrWhiteSpace(r.DeliveryCustomerCode) && deliveryNames.TryGetValue(r.DeliveryCustomerCode!, out var dn)
                    ? dn
                    : null,
                Date = r.Date,
                DueDate = r.DueDate,
                DocumentNo = itemDocNo,
                // Açıklama da aynı kimlik kapısından geçer; yoksa alış faturasının satırında
                // alakasız bir satış faturasının notu görünüyordu.
                Description = (r.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                               && r.ReferenceId.HasValue
                               && AyniBelgeMi(r.ReferenceId.Value, r.DocumentNo))
                    ? (invoiceNotesMap.TryGetValue(r.ReferenceId.Value, out var invNote) ? invNote : string.Empty)
                    : r.Description,
                TransactionType = r.TransactionType,
                Debit = debit,
                Credit = credit,
                CurrencyTypeId = r.CurrencyTypeId,
                CurrencyRate = r.CurrencyRate,
                CurrencyAmount = rCurrencyAmount,
                PaymentCurrencyTypeId = r.PaymentCurrencyTypeId,
                PaymentCurrencyRate = r.PaymentCurrencyRate,
                PaymentCurrencyAmount = paymentCurrAmt,
                TargetAccountCurrencyTypeId = r.TargetAccountCurrencyTypeId,
                ExchangeCode = r.ExchangeCode,
                Balance = running,
                CurrencyBalance = rowCurrencyBalance,
                ReferenceType = r.ReferenceType,
                ReferenceId = r.ReferenceId,
                HasDetails = hasDetails
            });
        }

        var openItems = items.Where(x => x.TransactionAccountType == "ACIK").ToList();
        var openDebit = openItems.Sum(x => x.Debit);
        var openCredit = openItems.Sum(x => x.Credit);

        var invoiceItems = items.Where(x => x.TransactionAccountType == "FATURA").ToList();
        var invoiceDebit = invoiceItems.Sum(x => x.Debit);
        var invoiceCredit = invoiceItems.Sum(x => x.Credit);

        // Para birimi başına bakiye. Devri OLUP dönem içinde hiç hareketi olmayan döviz de
        // listeye girmeli — aksi halde açık bakiye ekrandan kaybolur.
        var currencyKeys = debitByCurrency.Keys
            .Concat(creditByCurrency.Keys)
            .Concat(openingByCurrency.Keys)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        var currencyBalances = currencyKeys
            .Select(cur => new CustomerLedgerCurrencyBalanceDto
            {
                CurrencyTypeId = cur,
                CurrencyCode = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToCode(cur),
                CurrencySymbol = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToSymbol(cur),
                TotalDebit = debitByCurrency.GetValueOrDefault(cur),
                TotalCredit = creditByCurrency.GetValueOrDefault(cur),
                Opening = openingByCurrency.GetValueOrDefault(cur),
                Balance = runningByCurrency.GetValueOrDefault(cur)
            })
            .ToList();

        var resp = new CustomerLedgerListResponseDto
        {
            CustomerCode = mainCustomerCode,
            CustomerName = resolvedCustomerName,
            Mail = resolvedCustomerEmail,
            Phone = resolvedCustomerPhone,
            Summary = new CustomerLedgerSummaryDto
            {
                TotalDebit = totalDebit,
                TotalCredit = totalCredit,
                Balance = totalDebit - totalCredit
            },
            OpenSummary = new CustomerLedgerSummaryDto
            {
                TotalDebit = openDebit,
                TotalCredit = openCredit,
                Balance = openDebit - openCredit
            },
            InvoiceSummary = new CustomerLedgerSummaryDto
            {
                TotalDebit = invoiceDebit,
                TotalCredit = invoiceCredit,
                Balance = invoiceDebit - invoiceCredit
            },
            CurrencyBalances = currencyBalances,
            Items = items
        };

        return Ok(new { success = true, data = resp });
    }

    /// <summary>
    /// Kullanıcı bu carinin ekstresine erişebilir mi — liste ucundaki kuralın derlenmiş hâli.
    ///
    /// Üç yol: (1) kapsam sınırsız (SSA, ofis kullanıcısı: `Carikodu` boş/'*'/'ALL'),
    /// (2) cari kullanıcının portföyünde — şube ve alt hesaplar dahil,
    /// (3) cari kullanıcının plasiyer kodunda (kendi ya da bağlı olduğu şube üzerinden).
    /// </summary>
    private async Task<bool> CanAccessLedgerCustomerAsync(string? customerCode, CancellationToken cancellationToken)
    {
        var code = (customerCode ?? string.Empty).Trim();
        if (code.Length == 0) return true;

        if (User.FindFirst("IsSuperSuperAdmin")?.Value == "1") return true;
        if (CustomerScope.IsUnrestrictedFor(User)) return true;

        var allowed = await CustomerScope.ExpandAsync(
            _dbContext.Customers.AsNoTracking(), CustomerScope.Of(User), cancellationToken);

        if (allowed.Contains(code, StringComparer.OrdinalIgnoreCase)) return true;

        var salesmanCode = User.FindFirst("SalesmanCode")?.Value?.Trim();
        if (string.IsNullOrEmpty(salesmanCode)) return false;

        return await _dbContext.Customers.AsNoTracking().AnyAsync(x =>
            x.CustomerCode == code &&
            (x.SalesmanCode == salesmanCode ||
             // Şube paylaşılmaz (2026-09-06); yalnız plasiyeri boş şube miras alır.
             (x.ParentCustomerCode != null
              && (x.SalesmanCode == null || x.SalesmanCode == "")
              && _dbContext.Customers.Any(p => p.CustomerCode == x.ParentCustomerCode && p.SalesmanCode == salesmanCode))),
            cancellationToken);
    }

    /// <summary>
    /// Oturumdaki kullanıcının cari ekstrede görebileceği tipler (null = hepsi). Ekstre ekranı cari
    /// listesini buna göre süzer; asıl kapı yine liste/detay uçlarında.
    /// </summary>
    [HttpGet("ekstre-kapsami")]
    public async Task<IActionResult> EkstreKapsami(CancellationToken cancellationToken = default)
    {
        var allowed = await B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.AllowedAsync(_dbContext, User, cancellationToken);
        return Ok(new { success = true, data = new { tipler = allowed } });
    }

    /// <summary>Carinin ekstre tipi — tip metni yoksa koda bakar; alt hesap ana carinin tipini alır.</summary>
    private async Task<string> CariEkstreTipiAsync(string customerCode, CancellationToken ct)
    {
        var code = (customerCode ?? string.Empty).Trim();
        var row = await _dbContext.Customers.AsNoTracking()
            .Where(x => x.CustomerCode == code)
            .Select(x => new { x.CustomerType, x.ParentCustomerCode })
            .FirstOrDefaultAsync(ct);
        var type = row?.CustomerType;
        if (string.IsNullOrWhiteSpace(type) && !string.IsNullOrWhiteSpace(row?.ParentCustomerCode) && code.StartsWith("120-"))
        {
            type = await _dbContext.Customers.AsNoTracking()
                .Where(x => x.CustomerCode == row!.ParentCustomerCode)
                .Select(x => x.CustomerType)
                .FirstOrDefaultAsync(ct);
        }
        return B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.ClassifyCustomer(code, type);
    }

    [HttpGet("{id:int}/details")]
    [AuthorizePage("reports", "cariEkstre")]
    public async Task<IActionResult> Details([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entry = await _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (entry is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        // KAPSAM KAPISI DETAYDA DA GEÇERLİ. Liste ucu hangi carinin ekstresini görebileceğini
        // kontrol ediyordu ama bu uç YALNIZ satır id'si alıyordu: id deneyen ya da bilen bir
        // bayi/plasiyer, kapsamı dışındaki bir carinin fatura kalemlerini (ürün, miktar, birim
        // fiyat) okuyabiliyordu. Liste ile aynı üç yol: sınırsız kapsam · portföydeki cari
        // (şube/alt hesap dahil) · plasiyerin kendi carisi.
        if (!await CanAccessLedgerCustomerAsync(entry.CustomerCode, cancellationToken))
        {
            return Forbid();
        }

        var detayTipleri = await B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.AllowedAsync(_dbContext, User, cancellationToken);
        if (detayTipleri is not null)
        {
            var tip = await CariEkstreTipiAsync(entry.CustomerCode, cancellationToken);
            if (!detayTipleri.Contains(tip)) return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.DeniedMessage(tip) });
        }

        var docNo = (entry.DocumentNo ?? string.Empty).Trim();
        var digitsOnly = new string(docNo.Where(char.IsDigit).ToArray());
        var sigDigits = digitsOnly.TrimStart('0');
        var entryAmount = entry.Amount;

        // SATIRIN KALEMİ, SATIRIN KENDİ BELGESİNDEN GELİR — "aynı carinin bir belgesi"nden DEĞİL.
        //
        // Eskiden arama şu VEYA'ları taşıyordu: `Invoice.CustomerCode.StartsWith(cariÖneki)`,
        // `InvoiceNo.Contains(docNo)`, `InvoiceNo.Contains(sigDigits)`. Yani carinin BÜTÜN
        // faturaları aday oluyor, ardından bir puanlama en iyisini seçiyordu; puanlama hiçbir
        // aday tutmasa bile `return 10` verip `FirstOrDefault()` ile rastgele birini
        // döndürüyordu. Sonuç: 1.500 €'luk bir ÇEK satırı açıldığında aynı carinin 1.500 $'lık
        // faturasının ürünü listeleniyordu (tutar+tarih 500 puan alıyor).
        //
        // Artık kimlik esas: `ReferenceType` satırın ne olduğunu, `ReferenceId` hangi belge
        // olduğunu söyler. Üç veritabanında da fatura tipli (2) satırların HEPSİNDE
        // `ReferenceId` dolu, yani kimlikle eşleşme fatura tarafını tam kapsıyor.
        // Çek/senet/kasa/banka/virman/açılış satırlarının kalemi YOKTUR; onlar Stage 4'teki
        // özet satırına düşer ve satırın kendi tutarını/dövizini gösterir.
        var refId = entry.ReferenceId.HasValue && entry.ReferenceId.Value > 0 ? entry.ReferenceId.Value : (int?)null;
        var isInvoiceEntry = entry.ReferenceType == CustomerLedgerEntryReferenceType.Invoice;
        // Elle açılan eski satırlarda tip güvenilir değil; onlarda YALNIZCA birebir belge no
        // eşleşmesine izin verilir (`Contains` yok, cari önekiyle tarama yok).
        var isManualEntry = entry.ReferenceType == CustomerLedgerEntryReferenceType.Manual;
        var canHaveDocumentLines = isInvoiceEntry || isManualEntry;

        // ALIŞ TARAFINDAN GELEN SATIRLARDA `ReferenceId` BAŞKA BİR TABLONUN KİMLİĞİDİR
        // (2026-08-20).
        //
        // `PurchaseInvoicesController` ekstre satırını `ReferenceType = Invoice` ile yazıyor
        // ama `ReferenceId`'ye `PurchaseInvoices.Id` koyuyor. Aşağıdaki arama ise
        // `InvoiceLine.InvoiceId == refId` diyor — yani YANLIŞ TABLONUN kimliğiyle arıyor.
        // Görülen sonuç: hizmet alış faturasının ekstre satırı açıldığında kalem bulunamıyor,
        // satır özet dalına düşüyor ve "Stok Adı" yerine "Faturamız", "Stok Kodu" yerine belge
        // numarası yazıyordu.
        //
        // Daha kötüsü sessiz olanı: iki tablonun kimlikleri çakışabilir; o durumda BAŞKA bir
        // faturanın kalemleri listelenirdi.
        //
        // `PurchaseInvoices` ana belge, `Invoices` ondan türetilir ve belge numaraları AYNIdır;
        // bu yüzden hem `SourcePurchaseInvoiceId` hem de belge numarası tutuyorsa eşleşme
        // kesindir. Belge numarası şartı, satış tarafındaki bir kimlik çakışmasının yanlışlıkla
        // buraya düşmesini engeller.
        if (isInvoiceEntry && refId.HasValue && !string.IsNullOrEmpty(docNo))
        {
            var derivedInvoiceId = await _dbContext.Invoices
                .AsNoTracking()
                .Where(x => x.SourcePurchaseInvoiceId == refId.Value && x.InvoiceNo == docNo)
                .Select(x => (int?)x.Id)
                .FirstOrDefaultAsync(cancellationToken);

            if (derivedInvoiceId.HasValue && derivedInvoiceId.Value > 0)
            {
                refId = derivedInvoiceId.Value;
            }
        }

        // Stage 1: Search in InvoiceLine
        var invoiceLineCandidates = canHaveDocumentLines
            ? await _dbContext.Set<InvoiceLine>()
                .AsNoTracking()
                .Include(x => x.Invoice)
                /*
                 * KİMLİK TEK BAŞINA YETMİYOR — BELGE NUMARASI DA TUTMALI (2026-09-08).
                 *
                 * `ReferenceType = Invoice` damgasını HEM satış (`Invoices`) HEM alış
                 * (`PurchaseInvoices`) tarafı yazıyor, ama iki tablonun kimlik dizileri AYRI.
                 * Yukarıdaki türetme ("alıştan doğan satış faturasını bul") tutmadığında
                 * `refId` alış tablosunun kimliği olarak KALIYOR ve burası onu satış
                 * faturası kimliği sanıp o faturanın kalemlerini listeliyordu.
                 *
                 * Canlı kanıt (DEMO_CANLI, 2026-09-08): defter satırı 750,
                 * `HZ260824134219`, 87.500,00, cari 770-01-000030, `ReferenceId = 27`.
                 *   - `PurchaseInvoices` 27 = HZ260824134219, 87.500,00  (DOĞRU belge)
                 *   - `Invoices`         27 = 100000000000010, 6.080,00, cari 120-01-000848-2
                 * Ekstre, 87.500'lük nakliye satırının altında BAŞKA BİR CARİNİN 6.080'lik
                 * ankastre ocağını gösteriyordu. Yalnızca yanlış kalem değil, başka
                 * müşterinin fatura satırının sızması demekti.
                 *
                 * Ölçüm (aynı veritabanı): `ReferenceType = Invoice` olan 1072 satırdan
                 * 975'inde fatura numarası defter belge numarasıyla AYNI (sağlıklı),
                 * 84'ünde farklı (çakışma) ve bu 84'ün 83'ünde cari de farklı. Yani belge
                 * numarası şartı sağlıklı satırların HİÇBİRİNİ kesmiyor, çakışanların
                 * TAMAMINI kesiyor.
                 *
                 * Çakışan satırlarda kalem GÖSTERİLMEMESİ doğru davranış: o satır aslında
                 * bir alış/gider belgesinden doğdu ve alış faturası araması müşteri
                 * ekstresinden bilerek kaldırılmıştı (tedarikçinin kendi ucu var). Bakiye
                 * zaten satırın kendi `Amount` alanından geliyor, etkilenmiyor.
                 */
                .Where(x => isInvoiceEntry && refId.HasValue
                    ? x.InvoiceId == refId.Value
                    : (!string.IsNullOrEmpty(docNo) && x.Invoice.InvoiceNo == docNo))
                .ToListAsync(cancellationToken)
            : new List<InvoiceLine>();

        /*
         * KİMLİKLE BULUNAN FATURA GERÇEKTEN BU SATIRIN BELGESİ Mİ? (2026-09-08)
         *
         * Yukarıdaki sorgu `ReferenceId`'yi satış faturası kimliği kabul ediyor. Ama
         * `ReferenceType = Invoice` damgasını HEM satış (`Invoices`) HEM alış
         * (`PurchaseInvoices`) tarafı yazıyor ve iki tablonun kimlik dizileri AYRI —
         * aynı sayı iki farklı belgeye denk geliyor.
         *
         * Canlı kanıt (DEMO_CANLI): defter satırı 750, `HZ260824134219`, 87.500,00,
         * cari 770-01-000030, `ReferenceId = 27`.
         *   `PurchaseInvoices` 27 = HZ260824134219, 87.500,00        (DOĞRU belge)
         *   `Invoices`         27 = 100000000000010, 6.080,00,
         *                            cari 120-01-000848-2            (BAŞKA CARİ)
         * Ekstre, nakliye satırının altında başka bir carinin ankastre ocağını
         * gösteriyordu: yanlış kalem olmasının ötesinde veri sızıntısı.
         *
         * NEDEN SADECE "BELGE NO EŞİT OLSUN" DEMİYORUZ:
         * `InvoicesController.UpdateInvoiceHeader` fatura numarasını değiştirirken defter
         * satırının `DocumentNo` alanını GÜNCELLEMİYOR. Numarası sonradan düzeltilmiş
         * meşru faturalarda ikisi ayrışıyor; katı eşitlik onları da keserdi.
         *
         * KURAL: kimlikle gelen fatura kabul edilir ancak
         *   (a) belge numarası tutuyorsa,  YA DA
         *   (b) ANA CARİSİ defter satırınınkiyle aynı VE tutarı satırın tutarıyla eşitse.
         * (b) numarası değiştirilmiş faturayı kurtarır; kimlik çakışmasını kurtarmaz,
         *     çünkü çakışan belge hem başka cariye ait hem de başka tutarda.
         *
         * Ölçüm (aynı veritabanı): `ReferenceType = Invoice` olan 1072 satırın 975'inde
         * belge numarası zaten tutuyor, 84'ünde tutmuyor ve bu 84'ün 83'ünde cari de
         * farklı. Kural sağlıklı satırların hiçbirini kesmiyor.
         *
         * Süzme BELLEKTE yapılıyor: ana hesap indirgemesi ve tutar karşılaştırması
         * `CustomerAccountHelper` üzerinden geçiyor, SQL'e çevrilemez.
         */
        if (isInvoiceEntry && refId.HasValue && invoiceLineCandidates.Count > 0)
        {
            var entryMainCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper
                .GetMainCodeFromInvoiceAccountCode(entry.CustomerCode ?? string.Empty);

            invoiceLineCandidates = invoiceLineCandidates
                .Where(x =>
                {
                    var inv = x.Invoice;
                    if (inv is null) return false;

                    var invNo = (inv.InvoiceNo ?? string.Empty).Trim();
                    if (!string.IsNullOrEmpty(docNo)
                        && invNo.Equals(docNo, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }

                    var invMainCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper
                        .GetMainCodeFromInvoiceAccountCode(inv.CustomerCode ?? string.Empty);

                    var sameCustomer = !string.IsNullOrEmpty(entryMainCode)
                        && string.Equals(entryMainCode, invMainCode, StringComparison.OrdinalIgnoreCase);

                    return sameCustomer && Math.Abs(inv.GrandTotal - entryAmount) < 0.05m;
                })
                .ToList();
        }

        if (invoiceLineCandidates.Count > 0)
        {
            var groupedByInvoice = invoiceLineCandidates.GroupBy(x => x.InvoiceId).ToList();

            var bestGroup = groupedByInvoice
                .OrderByDescending(g =>
                {
                    var parentInv = g.First().Invoice;
                    if (entry.ReferenceId.HasValue && parentInv.Id == entry.ReferenceId.Value) return 1000;
                    var invNo = (parentInv.InvoiceNo ?? string.Empty).Trim();
                    var invDigits = new string(invNo.Where(char.IsDigit).ToArray()).TrimStart('0');

                    if (!string.IsNullOrEmpty(docNo) && invNo.Equals(docNo, StringComparison.OrdinalIgnoreCase)) return 900;
                    if (!string.IsNullOrEmpty(docNo) && (invNo.EndsWith(docNo, StringComparison.OrdinalIgnoreCase) || docNo.EndsWith(invNo, StringComparison.OrdinalIgnoreCase))) return 800;
                    if (!string.IsNullOrEmpty(sigDigits) && sigDigits.Length >= 2 && invDigits.Equals(sigDigits, StringComparison.OrdinalIgnoreCase)) return 700;
                    if (!string.IsNullOrEmpty(sigDigits) && sigDigits.Length >= 2 && (invDigits.EndsWith(sigDigits, StringComparison.OrdinalIgnoreCase) || sigDigits.EndsWith(invDigits, StringComparison.OrdinalIgnoreCase))) return 600;
                    if (parentInv.Date.Date == entry.Date.Date && Math.Abs(parentInv.GrandTotal - entryAmount) < 1.00m) return 500;
                    if (Math.Abs(parentInv.GrandTotal - entryAmount) < 0.05m) return 400;
                    return 10;
                })
                .FirstOrDefault();

            if (bestGroup != null)
            {
                var invoiceLines = bestGroup.OrderBy(x => x.LineNo).ToList();
                var parentInvoice = bestGroup.First().Invoice;
                var montajText = !string.IsNullOrWhiteSpace(parentInvoice.InstallationName)
                    ? parentInvoice.InstallationName.Trim()
                    : string.Empty;

                var stockCodes = invoiceLines.Select(x => x.StockCode).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();
                var products = await _dbContext.Products.AsNoTracking()
                    .Where(x => stockCodes.Contains(x.StockCode))
                    .Select(x => new { x.StockCode, x.Name, x.Barcode })
                    .ToListAsync(cancellationToken);
                var productMap = products.ToDictionary(x => x.StockCode, x => x, StringComparer.OrdinalIgnoreCase);

                var services = await _dbContext.Set<ServiceCatalogItem>().AsNoTracking()
                    .Where(x => stockCodes.Contains(x.Code))
                    .Select(x => new { x.Code, x.Name })
                    .ToListAsync(cancellationToken);
                var serviceMap = services.ToDictionary(x => x.Code, x => x.Name, StringComparer.OrdinalIgnoreCase);

                var soLineIds = invoiceLines.Select(x => x.SalesOrderLineId).Where(x => x.HasValue && x.Value > 0).Select(x => x!.Value).Distinct().ToList();
                var giftLineIds = new HashSet<int>();
                var lineMontajMap = new Dictionary<int, string>();
                if (soLineIds.Count > 0)
                {
                    var soLinesData = await (
                        from sol in _dbContext.Set<SalesOrderLine>().AsNoTracking()
                        join ins in _dbContext.Set<Installation>().AsNoTracking() on sol.InstallationId equals ins.Id into insJoin
                        from ins in insJoin.DefaultIfEmpty()
                        where soLineIds.Contains(sol.Id)
                        select new
                        {
                            sol.Id,
                            sol.IsGift,
                            InstallationName = ins != null ? ins.InstallationName : null
                        }
                    ).ToListAsync(cancellationToken);

                    giftLineIds = soLinesData.Where(x => x.IsGift).Select(x => x.Id).ToHashSet();
                    foreach (var item in soLinesData)
                    {
                        if (!string.IsNullOrWhiteSpace(item.InstallationName))
                        {
                            lineMontajMap[item.Id] = item.InstallationName.Trim();
                        }
                    }
                }

                // MONTAJ KALEME DE BAĞLI OLABİLİR (2026-09-25, kullanıcı: "fatura dökümde MUSTAFA
                // ERGİN var ama ekstrede yok"). Yukarıdaki arama yalnız sipariş satırından gidiyor;
                // Fatura Döküm'de "Montaj Ekle" ile girilen montaj fatura kalemine (`InvoiceLineId`
                // / `LineageId`) bağlanıyor. Fatura Döküm kalem listesiyle aynı kural: önce kaleme
                // doğrudan bağlı, iptal edilmemiş montaj; yoksa sipariş satırınınki.
                var invLineIds = invoiceLines.Select(x => x.Id).ToList();
                var invLineageIds = invoiceLines.Where(x => x.LineageId.HasValue).Select(x => x.LineageId!.Value).ToList();
                var directInstallations = await _dbContext.Set<Installation>()
                    .AsNoTracking()
                    .Where(x => ((x.InvoiceLineId.HasValue && invLineIds.Contains(x.InvoiceLineId.Value))
                                 || (x.LineageId.HasValue && invLineageIds.Contains(x.LineageId.Value)))
                                && x.Status != "Pasif / İptal" && x.Status != "Pasif / Geri Alındı")
                    .OrderBy(x => x.Id)
                    .Select(x => new { x.InvoiceLineId, x.LineageId, x.InstallationName })
                    .ToListAsync(cancellationToken);

                var salesLines = invoiceLines.Select(line =>
                {
                    productMap.TryGetValue(line.StockCode ?? string.Empty, out var prod);
                    serviceMap.TryGetValue(line.StockCode ?? string.Empty, out var srvName);
                    var isGift = (line.SalesOrderLineId.HasValue && giftLineIds.Contains(line.SalesOrderLineId.Value))
                                 || line.UnitPrice == 0.01m
                                 || (line.Description != null && line.Description.ToLower().Contains("hediye"));

                    var effUnitPrice = isGift ? 0.01m : (line.CurrencyUnitPrice > 0m ? line.CurrencyUnitPrice : line.UnitPrice);

                    var finalStockName = prod != null && !string.IsNullOrWhiteSpace(prod.Name)
                        ? prod.Name
                        : (!string.IsNullOrWhiteSpace(srvName)
                            ? srvName
                            : (!string.IsNullOrWhiteSpace(line.Description) ? line.Description : (line.StockCode ?? string.Empty)));

                    var directMontaj = directInstallations
                        .Where(i => i.InvoiceLineId == line.Id || (line.LineageId.HasValue && i.LineageId == line.LineageId.Value))
                        .Select(i => (i.InstallationName ?? string.Empty).Trim())
                        .FirstOrDefault(n => n.Length > 0);

                    var lineMontaj = !string.IsNullOrEmpty(directMontaj)
                        ? directMontaj
                        : (line.SalesOrderLineId.HasValue && lineMontajMap.TryGetValue(line.SalesOrderLineId.Value, out var mVal) && !string.IsNullOrWhiteSpace(mVal)
                            ? mVal
                            : string.Empty);

                    return new CustomerLedgerDetailLineDto
                    {
                        Id = line.Id,
                        StockCode = line.StockCode ?? string.Empty,
                        StockName = finalStockName,
                        Description = line.Description ?? string.Empty,
                        Montaj = lineMontaj,
                        Barcode = prod?.Barcode ?? string.Empty,
                        Quantity = line.Quantity,
                        UnitPrice = line.UnitPrice,
                        Total = line.Quantity * line.UnitPrice,
                        CurrencyTypeId = line.CurrencyTypeId,
                        CurrencyUnitPrice = effUnitPrice,
                        CurrencyTotal = line.Quantity * effUnitPrice,
                        VatRate = isGift ? 0m : line.VatRate,
                        IsGift = isGift
                    };
                }).ToList();

                return Ok(new { success = true, data = salesLines });
            }
        }

        /*
         * Stage 2: ALIŞ / GİDER FATURASININ KALEMLERİ — KİMLİK **VE** BELGE NUMARASIYLA.
         *
         * Bu arama daha önce kaldırılmıştı ve haklı olarak: eski hâli cari kodunu
         * `SupplierCode` önekiyle karşılaştırıyor, müşteri satırının `ReferenceId`'sini de
         * körlemesine `PurchaseInvoiceId` sanıyordu. İki tablonun kimlikleri çakıştığında
         * alakasız bir alış faturasının kalemleri dönüyordu.
         *
         * Buradaki fark: TAHMİN YOK. Alış faturası ancak HEM kimliği (`Id == refId`) HEM
         * belge numarası (`DocumentNo == docNo`) defter satırıyla birebir tutarsa kabul
         * ediliyor. Belge numarası alış faturalarında tekil olduğu için bu ikili eşleşme
         * belgeyi kesin olarak tanımlar — başkasının verisinin buraya düşmesi mümkün değil.
         *
         * Neden gerekli: `ReferenceType = Invoice` damgasını hem satış hem alış tarafı
         * yazıyor. Satış tarafında karşılık bulunamayan satırlar (canlıda 84 adet) aslında
         * alış/gider belgesinden doğmuş satırlar; buraya kadar geldilerse gerçek belgeleri
         * budur. Öncesinde bu satırlar açılınca BAŞKA bir carinin satış faturası
         * gösteriliyordu; sonra da hiçbir şey göstermiyordu. Doğrusu kendi belgesi.
         *
         * Sıra önemli: bu blok Stage 1'den SONRA. Satış tarafında belge numarası tutan bir
         * fatura varsa o kazanır; buraya yalnızca satış tarafı boş dönerse gelinir.
         */
        if (canHaveDocumentLines && isInvoiceEntry && refId.HasValue && !string.IsNullOrEmpty(docNo))
        {
            var purchaseInvoice = await _dbContext.Set<PurchaseInvoice>()
                .AsNoTracking()
                .Where(x => x.Id == refId.Value && x.DocumentNo == docNo)
                .Select(x => new { x.Id, x.CurrencyTypeId })
                .FirstOrDefaultAsync(cancellationToken);

            if (purchaseInvoice is not null)
            {
                var purchaseLines = await _dbContext.Set<PurchaseInvoiceLine>()
                    .AsNoTracking()
                    .Where(x => x.PurchaseInvoiceId == purchaseInvoice.Id)
                    .OrderBy(x => x.Id)
                    .ToListAsync(cancellationToken);

                if (purchaseLines.Count > 0)
                {
                    var pStockCodes = purchaseLines
                        .Select(x => x.StockCode)
                        .Where(x => !string.IsNullOrWhiteSpace(x))
                        .Distinct()
                        .ToList();

                    // Ürün adı ve barkod ürün kartından; alış satırında yalnızca stok kodu var
                    // ve müşteriye kod göstermek okunmaz bir ekstre demek.
                    var pProducts = await _dbContext.Products.AsNoTracking()
                        .Where(x => pStockCodes.Contains(x.StockCode))
                        .Select(x => new { x.StockCode, x.Name, x.Barcode })
                        .ToListAsync(cancellationToken);
                    var pProductMap = pProducts.ToDictionary(x => x.StockCode, x => x, StringComparer.OrdinalIgnoreCase);

                    // Hizmet kartları ayrı tabloda (nakliye, montaj bedeli gibi kalemler).
                    var pServices = await _dbContext.Set<ServiceCatalogItem>().AsNoTracking()
                        .Where(x => pStockCodes.Contains(x.Code))
                        .Select(x => new { x.Code, x.Name })
                        .ToListAsync(cancellationToken);
                    var pServiceMap = pServices.ToDictionary(x => x.Code, x => x.Name, StringComparer.OrdinalIgnoreCase);

                    var purchaseDtos = purchaseLines.Select(line =>
                    {
                        pProductMap.TryGetValue(line.StockCode ?? string.Empty, out var prod);
                        pServiceMap.TryGetValue(line.StockCode ?? string.Empty, out var srvName);

                        var stockName = prod != null && !string.IsNullOrWhiteSpace(prod.Name)
                            ? prod.Name
                            : (!string.IsNullOrWhiteSpace(srvName)
                                ? srvName
                                : (!string.IsNullOrWhiteSpace(line.Description) ? line.Description! : (line.StockCode ?? string.Empty)));

                        // Belge kendi dövizindeyse satırın döviz fiyatı, değilse TL fiyatı.
                        var effUnit = line.CurrencyUnitPrice > 0m ? line.CurrencyUnitPrice : line.UnitPrice;

                        return new CustomerLedgerDetailLineDto
                        {
                            Id = line.Id,
                            StockCode = line.StockCode ?? string.Empty,
                            StockName = stockName,
                            Description = line.Description ?? string.Empty,
                            // Montaj bilgisi ALIŞ satırında yok; boş bırakılıyor, uydurulmuyor.
                            Montaj = string.Empty,
                            Barcode = prod?.Barcode ?? string.Empty,
                            Quantity = line.Quantity,
                            UnitPrice = line.UnitPrice,
                            Total = line.Quantity * line.UnitPrice,
                            CurrencyTypeId = purchaseInvoice.CurrencyTypeId,
                            CurrencyUnitPrice = effUnit,
                            CurrencyTotal = line.Quantity * effUnit,
                            VatRate = line.VatRate,
                            IsGift = false
                        };
                    }).ToList();

                    return Ok(new { success = true, data = purchaseDtos });
                }
            }
        }



        // Stage 3: Search in SalesOrderLine
        //
        // Yalnızca belge numarası BİREBİR bir sipariş numarasıysa. Cari önekiyle tarama ve
        // `Contains` kaldırıldı: ikisi de "aynı carinin herhangi bir siparişi"ni aday yapıyordu.
        var oCandidates = canHaveDocumentLines && !string.IsNullOrEmpty(docNo)
            ? await _dbContext.Set<SalesOrderLine>()
                .AsNoTracking()
                .Include(x => x.SalesOrder)
                .Where(x => x.SalesOrder.OrderNo == docNo)
                .ToListAsync(cancellationToken)
            : new List<SalesOrderLine>();

        if (oCandidates.Count > 0)
        {
            var groupedByOrder = oCandidates.GroupBy(x => x.SalesOrderId).ToList();
            var bestGroup = groupedByOrder
                .OrderByDescending(g =>
                {
                    var parentOrder = g.First().SalesOrder;
                    var ordNo = (parentOrder.OrderNo ?? string.Empty).Trim();
                    if (!string.IsNullOrEmpty(docNo) && ordNo.Equals(docNo, StringComparison.OrdinalIgnoreCase)) return 900;
                    if (parentOrder.CreateTime.Date == entry.Date.Date && Math.Abs(parentOrder.GrandTotal - entryAmount) < 1.00m) return 500;
                    return 10;
                })
                .FirstOrDefault();

            if (bestGroup != null)
            {
                var oLines = bestGroup.ToList();
                var parentOrder = bestGroup.First().SalesOrder;
                var oStockCodes = oLines.Select(x => x.StockCode).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();
                var oProducts = await _dbContext.Products.AsNoTracking()
                    .Where(x => oStockCodes.Contains(x.StockCode))
                    .Select(x => new { x.StockCode, x.Name, x.Barcode })
                    .ToListAsync(cancellationToken);
                var oProductMap = oProducts.ToDictionary(x => x.StockCode, x => x, StringComparer.OrdinalIgnoreCase);

                var oSoLineIds = oLines.Select(x => x.Id).ToList();
                var oLineMontajMap = new Dictionary<int, string>();
                if (oSoLineIds.Count > 0)
                {
                    var oMontajData = await (
                        from sol in _dbContext.Set<SalesOrderLine>().AsNoTracking()
                        join ins in _dbContext.Set<Installation>().AsNoTracking() on sol.InstallationId equals ins.Id into insJoin
                        from ins in insJoin.DefaultIfEmpty()
                        where oSoLineIds.Contains(sol.Id)
                        select new
                        {
                            sol.Id,
                            InstallationName = ins != null ? ins.InstallationName : null
                        }
                    ).ToListAsync(cancellationToken);

                    foreach (var item in oMontajData)
                    {
                        if (!string.IsNullOrWhiteSpace(item.InstallationName))
                        {
                            oLineMontajMap[item.Id] = item.InstallationName.Trim();
                        }
                    }
                }

                var mappedOrderLines = oLines.Select(line =>
                {
                    oProductMap.TryGetValue(line.StockCode ?? string.Empty, out var prod);
                    var isGift = line.IsGift || line.UnitPrice == 0.01m;
                    var effUnitPrice = isGift ? 0.01m : (line.CurrencyUnitPrice > 0m ? line.CurrencyUnitPrice : line.UnitPrice);
                    var lineMontaj = oLineMontajMap.TryGetValue(line.Id, out var mVal) ? mVal : string.Empty;

                    return new CustomerLedgerDetailLineDto
                    {
                        Id = line.Id,
                        StockCode = line.StockCode ?? string.Empty,
                        StockName = prod != null && !string.IsNullOrWhiteSpace(prod.Name) ? prod.Name : line.StockCode,
                        Description = line.Description ?? string.Empty,
                        Montaj = lineMontaj,
                        Barcode = prod?.Barcode ?? string.Empty,
                        Quantity = line.Quantity,
                        UnitPrice = line.UnitPrice,
                        Total = line.Quantity * line.UnitPrice,
                        CurrencyTypeId = line.CurrencyTypeId,
                        CurrencyUnitPrice = effUnitPrice,
                        CurrencyTotal = line.Quantity * effUnitPrice,
                        VatRate = isGift ? 0m : line.VatRate,
                        IsGift = isGift
                    };
                }).ToList();

                return Ok(new { success = true, data = mappedOrderLines });
            }
        }

        // Stage 4: Ultimate Fallback for Ledger Entry
        // If entry is a Sales Invoice / Fatura entry with amount > 0, generate a clean summary line
        if (entry.Amount > 0m && !string.IsNullOrWhiteSpace(docNo))
        {
            var fallbackMontaj = string.Empty;

            var descStr = !string.IsNullOrWhiteSpace(entry.Description) ? entry.Description.Trim() : "Fatura Kalemi";

            var fallbackLine = new CustomerLedgerDetailLineDto
            {
                Id = entry.Id,
                StockCode = docNo,
                StockName = descStr,
                Montaj = fallbackMontaj,
                Barcode = string.Empty,
                Quantity = 1,
                UnitPrice = entry.Amount,
                Total = entry.Amount,
                CurrencyTypeId = entry.CurrencyTypeId,
                CurrencyUnitPrice = entry.CurrencyAmount > 0m ? entry.CurrencyAmount : entry.Amount,
                CurrencyTotal = entry.CurrencyAmount > 0m ? entry.CurrencyAmount : entry.Amount,
                // Bu satır zaten ekstre tutarının KENDİSİ (KDV dahil); üstüne KDV eklenmez.
                VatRate = 0m,
                IsGift = false
            };

            return Ok(new { success = true, data = new[] { fallbackLine } });
        }

        return Ok(new { success = true, data = Array.Empty<CustomerLedgerDetailLineDto>() });
    }

    private sealed class LedgerRowDto
    {
        public int Id { get; set; }
        public string CustomerCode { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public DateTime CreateTime { get; set; }
        public DateTime? DueDate { get; set; }
        public CustomerLedgerEntryDirection Direction { get; set; }
        public decimal Amount { get; set; }
        public int CurrencyTypeId { get; set; }
        public decimal CurrencyRate { get; set; }
        public decimal CurrencyAmount { get; set; }
        public int PaymentCurrencyTypeId { get; set; }
        public decimal PaymentCurrencyRate { get; set; }
        public decimal PaymentCurrencyAmount { get; set; }

        /// <summary>
        /// Paranin ISLENDIGI cari doviz hesabi: 0 = belirtilmemis (eski satirlar),
        /// 1 = TRY, 2 = EUR, 3 = USD, 4 = GBP. Tutar bu hesaba CEVRILMEZ; yalniz damgadir.
        /// </summary>
        public int TargetAccountCurrencyTypeId { get; set; }
        public string? ExchangeCode { get; set; }
        public string DocumentNo { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string TransactionType { get; set; } = string.Empty;
        public string? DeliveryCustomerCode { get; set; }
        public CustomerLedgerEntryReferenceType ReferenceType { get; set; }
        public int? ReferenceId { get; set; }
        public decimal Balance { get; set; }
    }
}
