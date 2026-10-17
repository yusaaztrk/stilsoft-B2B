using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.CustomerLedger;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/yonetim-ledger")]
[Authorize]
public sealed class YonetimLedgerController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly Core.Services.ICustomerAccountService _customerAccountService;

    public YonetimLedgerController(AppDbContext dbContext, Core.Services.ICustomerAccountService customerAccountService)
    {
        _dbContext = dbContext;
        _customerAccountService = customerAccountService;
    }

    [HttpGet]
    [AuthorizePage("reports", "yonetimEkstre")]
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
                // Bir cari TEK SATIR DEĞİLDİR: şubeler `ParentCustomerCode` ile, `-1/-2/-3`
                // alt hesapları ise `MainCustomerCode` ile bağlanır — VE faturalar asıl o alt
                // hesaplara yazılır (bkz. CustomerScope.ExpandAsync açıklaması). Kapı yalnız
                // şubeye bakıyordu: plasiyer, yetkisindeki carinin `-1` alt hesabının
                // ekstresini açmak isteyince 403 alıyordu.
                var allowed = await _dbContext.Customers.AsNoTracking().AnyAsync(x =>
                    x.CustomerCode == customerCode &&
                    (x.SalesmanCode == salesmanCode ||
                     // Şube paylaşılmaz (2026-09-06); yalnız plasiyeri boş şube miras alır.
                     (x.ParentCustomerCode != null
                      && (x.SalesmanCode == null || x.SalesmanCode == "")
                      && _dbContext.Customers.Any(p => p.CustomerCode == x.ParentCustomerCode && p.SalesmanCode == salesmanCode)) ||
                     (x.MainCustomerCode != null && _dbContext.Customers.Any(m => m.CustomerCode == x.MainCustomerCode && m.SalesmanCode == salesmanCode))), cancellationToken);

                if (!allowed)
                {
                    return Forbid();
                }
            }
            else if (!string.IsNullOrEmpty(userCariKodu))
            {
                // Aynı eksik burada da vardı: bayi kendi `-1/-2/-3` alt hesabının ekstresini
                // açamıyordu.
                var allowed = customerCode == userCariKodu || await _dbContext.Customers.AsNoTracking().AnyAsync(x =>
                    x.CustomerCode == customerCode
                    && (x.ParentCustomerCode == userCariKodu || x.MainCustomerCode == userCariKodu), cancellationToken);

                if (!allowed)
                {
                    return Forbid();
                }
            }
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
            targetCodes = new List<string> { acikAccountCode };
            if (cust != null && cust.AccountRole == CustomerAccountRole.OpenMain)
            {
                targetCodes.Add(mainCustomerCode);
            }
        }
        else if (normAccountType == "FATURA")
        {
            targetCodes = new List<string> { faturaAccountCode };
            if (cust != null && cust.AccountRole != CustomerAccountRole.OpenMain)
            {
                targetCodes.Add(mainCustomerCode);
            }
        }
        else if (normAccountType == "ASKERIYE")
        {
            targetCodes = new List<string> { askeriyeAccountCode };
        }
        else
        {
            targetCodes = relatedCustomerCodes;
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
        var invoiceNotesMap = new Dictionary<int, string>();
        if (invoiceIds.Count > 0)
        {
            var invData = await _dbContext.Invoices
                .AsNoTracking()
                .Where(x => invoiceIds.Contains(x.Id))
                .Select(x => new { x.Id, x.GrandTotal, x.Description })
                .ToListAsync(cancellationToken);

            invoiceGrandTotals = invData.ToDictionary(x => x.Id, x => x.GrandTotal);

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

        // Yönetim ekstresi cari ekstrenin kardeşidir ama yalnız TL `running` hesaplıyordu:
        // satırların CurrencyBalance'ı 0 kalıyor, yanıtta CurrencyBalances hiç dolmuyordu.
        // Karışık dövizli caride TL bakiye döviz sembolüyle gösterilince yanlış okunuyor.
        // Hesap CustomerLedgerController ile birebir aynı (ortak kural: LedgerAmount).
        decimal running = 0m;
        var runningByCurrency = new Dictionary<int, decimal>();
        var debitByCurrency = new Dictionary<int, decimal>();
        var creditByCurrency = new Dictionary<int, decimal>();
        var openingByCurrency = new Dictionary<int, decimal>();

        static int NormalizeCurrency(int currencyTypeId) => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(currencyTypeId);

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
                    x.CurrencyRate,
                    x.CurrencyAmount
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
                && invoiceGrandTotals.TryGetValue(r.ReferenceId.Value, out var invGrandTotal))
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


            decimal paymentCurrAmt;
            if (r.PaymentCurrencyTypeId > 1 && r.PaymentCurrencyRate > 0m)
            {
                if (r.PaymentCurrencyAmount > 0m && Math.Abs(r.PaymentCurrencyAmount - rAmount) > 0.01m)
                {
                    paymentCurrAmt = r.PaymentCurrencyAmount;
                }
                else
                {
                    paymentCurrAmt = Math.Round(rAmount / r.PaymentCurrencyRate, 2, MidpointRounding.AwayFromZero);
                }
            }
            else
            {
                paymentCurrAmt = r.PaymentCurrencyAmount > 0m ? r.PaymentCurrencyAmount : rCurrencyAmount;
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
                Description = (r.ReferenceType == CustomerLedgerEntryReferenceType.Invoice && r.ReferenceId.HasValue)
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
            // Devri OLUP dönem içinde hiç hareketi olmayan döviz de listeye girmeli —
            // aksi halde açık bakiye ekrandan kaybolur (cari ekstre ile aynı kural).
            CurrencyBalances = debitByCurrency.Keys
                .Concat(creditByCurrency.Keys)
                .Concat(openingByCurrency.Keys)
                .Distinct()
                .OrderBy(x => x)
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
                .ToList(),
            Items = items
        };

        return Ok(new { success = true, data = resp });
    }

    [HttpGet("{id:int}/details")]
    [AuthorizePage("reports", "yonetimEkstre")]
    public async Task<IActionResult> Details([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entry = await _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (entry is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var docNo = (entry.DocumentNo ?? string.Empty).Trim();
        var digitsOnly = new string(docNo.Where(char.IsDigit).ToArray());
        var sigDigits = digitsOnly.TrimStart('0');
        var entryAmount = entry.Amount;

        // SATIRIN KALEMİ, SATIRIN KENDİ BELGESİNDEN GELİR — "aynı carinin bir belgesi"nden
        // DEĞİL. Cari ekstredeki kardeşiyle aynı düzeltme; ayrıntılı gerekçe için
        // `CustomerLedgerController.Details`. Kısaca: cari önekiyle tarama + `Contains`
        // eşleşmeleri carinin bütün faturalarını aday yapıyor, puanlama hiçbiri tutmasa bile
        // rastgele birini döndürüyordu — 1.500 €'luk bir ÇEK satırı açıldığında aynı carinin
        // 1.500 $'lık faturasının ürünü listeleniyordu.
        var refId = entry.ReferenceId.HasValue && entry.ReferenceId.Value > 0 ? entry.ReferenceId.Value : (int?)null;
        var isInvoiceEntry = entry.ReferenceType == CustomerLedgerEntryReferenceType.Invoice;
        var isManualEntry = entry.ReferenceType == CustomerLedgerEntryReferenceType.Manual;
        var canHaveDocumentLines = isInvoiceEntry || isManualEntry;

        // Stage 1: Search in InvoiceLine
        var invoiceLineCandidates = canHaveDocumentLines
            ? await _dbContext.Set<InvoiceLine>()
                .AsNoTracking()
                .Include(x => x.Invoice)
                /*
                 * BELGE NUMARASI ŞARTI — cari ekstredekiyle AYNI hata buradaydı (2026-09-08).
                 *
                 * `ReferenceType = Invoice` damgasını hem `Invoices` hem `PurchaseInvoices`
                 * yazıyor ve kimlik dizileri ayrı; kimliğe tek başına güvenmek başka bir
                 * belgenin (çoğu zaman başka bir carinin) kalemlerini listeliyordu.
                 * Gerekçe ve canlı ölçüm için `CustomerLedgerController.Details` içindeki
                 * nota bakın — iki ekran aynı kuralı kullanmak zorunda, yoksa biri düzelip
                 * diğeri yanlış göstermeye devam eder.
                 */
                .Where(x => isInvoiceEntry && refId.HasValue
                    ? x.InvoiceId == refId.Value
                    : (!string.IsNullOrEmpty(docNo) && x.Invoice.InvoiceNo == docNo))
                .ToListAsync(cancellationToken)
            : new List<InvoiceLine>();

        /*
         * Cari ekstredekiyle AYNI kural — gerekçe ve canlı ölçüm için oradaki uzun nota bakın.
         * Kimlikle gelen fatura, belge numarası tutuyorsa ya da ana carisi + tutarı satırla
         * eşleşiyorsa kabul edilir. İki ekran aynı kuralı kullanmak zorunda, yoksa biri
         * düzelip diğeri yanlış göstermeye devam eder.
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

                    var lineMontaj = line.SalesOrderLineId.HasValue && lineMontajMap.TryGetValue(line.SalesOrderLineId.Value, out var mVal) && !string.IsNullOrWhiteSpace(mVal)
                        ? mVal
                        : string.Empty;

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
                        IsGift = isGift
                    };
                }).ToList();

                return Ok(new { success = true, data = salesLines });
            }
        }

        // Stage 2 (ALIŞ FATURASI ARAMASI) KALDIRILDI.
        //
        // Burası müşteri hareketlerinin yönetim görünümü; tedarikçi ekstresinin kendi ucu var.
        // Eski arama iki yoldan da başkasının verisini getirebiliyordu: cari kodunu
        // `PurchaseInvoice.SupplierCode` önekiyle karşılaştırmak ve satırın `ReferenceId`'sini
        // (bir SATIŞ faturası kimliği) `PurchaseInvoiceId` sanmak. İkincisi iki tablonun
        // kimlikleri çakıştığında ekranda TEDARİKÇİ ALIŞ FİYATLARINI gösteriyordu.


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
        public string DocumentNo { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string TransactionType { get; set; } = string.Empty;
        public string? DeliveryCustomerCode { get; set; }
        public CustomerLedgerEntryReferenceType ReferenceType { get; set; }
        public int? ReferenceId { get; set; }
        public decimal Balance { get; set; }
    }
}
