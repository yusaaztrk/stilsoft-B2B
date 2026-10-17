using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Reports;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/reports/customer-ageing")]
[Authorize]
public sealed class CustomerAgeingReportController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public CustomerAgeingReportController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <summary>
    /// Satırın kendi para birimindeki tutarı. `Amount` TL çapasıdır; dövizli satırda
    /// yaşlandırma o dövizin kendi tutarıyla yürür. Döviz tutarı boşsa (eski kayıt)
    /// kurla üretilir, kur da yoksa TL tutarına düşülür — yoksa satır rapordan düşerdi.
    /// </summary>
    private static decimal OwnCurrencyAmount(int currencyTypeId, decimal amount, decimal currencyAmount, decimal currencyRate)
    {
        if (CurrencyTypeHelper.IsTry(currencyTypeId)) return amount;
        if (currencyAmount > 0m) return currencyAmount;
        return currencyRate > 0m ? Math.Round(amount / currencyRate, 2, MidpointRounding.AwayFromZero) : amount;
    }

    [HttpGet]
    [AuthorizePage("reports", "yaslandirma")]
    public async Task<IActionResult> GetReport(
        [FromQuery] int? year,
        [FromQuery] int? currencyTypeId,
        CancellationToken cancellationToken = default)
    {
        var targetYear = year ?? DateTime.UtcNow.Year;

        // YAŞLANDIRMA PARA BİRİMİ BAŞINA YÜRÜR (2026-08-17).
        // Eskiden bütün satırlar TL çapası (`Amount`) üzerinden tek kovada yaşlandırılıyordu:
        // dolar borcu TL ödemeyle kapanmış görünüyor, dövizli borcun yaşı kayboluyordu.
        // Süzgeç verilmezse TL raporlanır (eski ekranla birebir aynı); ekran, hareketi olan
        // para birimlerini `AvailableCurrencyTypeIds` ile düğme yapar.
        var selectedCurrencyTypeId = CurrencyTypeHelper.Normalize(currencyTypeId ?? CurrencyTypeHelper.Try);

        // 1. Fetch Salesmen to map descriptions
        // MÜKERRER PLASİYER KODU RAPORU ÇÖKERTMEZ (denetim md. 13).
        //
        // `ToDictionary` aynı anahtardan iki kez gelirse `ArgumentException` fırlatır ve
        // rapor 500 döner. `Salesmen.SalesmanCode` üzerinde tekil indeks YOK, yani aynı kodla
        // iki kayıt açılması veri olarak mümkün. Gruplayıp ilkini almak raporu ayakta tutar;
        // tekilliği zorlamak plasiyer tanımının işi, raporun değil.
        var salesmen = (await _dbContext.Set<Salesman>()
                .AsNoTracking()
                .Select(x => new { x.SalesmanCode, x.Description })
                .ToListAsync(cancellationToken))
            .GroupBy(x => x.SalesmanCode)
            .ToDictionary(g => g.Key, g => g.First().Description);

        // Year boundaries. Everything after the selected year is out of scope, otherwise
        // a past-year report would be "paid off" by payments that were made afterwards.
        var startOfYear = new DateTime(targetYear, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var endOfYear = new DateTime(targetYear, 12, 31, 23, 59, 59, DateTimeKind.Utc);

        // 2. Fetch active MAIN customers only. Sub accounts (-1 FATURA / -2 ACIK / -3 ASKERIYE)
        //    are not separate carier: their movements roll up into the main account.
        var customersQuery = _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.IsActive)
            .Where(x => (x.MainCustomerCode == null || x.MainCustomerCode == "" || x.MainCustomerCode == x.CustomerCode)
                        && !x.CustomerCode.EndsWith("-1")
                        && !x.CustomerCode.EndsWith("-2")
                        && !x.CustomerCode.EndsWith("-3"));

        if (!CustomerScope.IsUnrestrictedFor(User))
        {
            var userScopeCodes = CustomerScope.Of(User);
            var expandedScope = await CustomerScope.ExpandAsync(_dbContext.Customers.AsNoTracking(), userScopeCodes, cancellationToken);
            customersQuery = customersQuery.Where(x => userScopeCodes.Contains(x.CustomerCode) || (x.MainCustomerCode != null && userScopeCodes.Contains(x.MainCustomerCode)) || expandedScope.Contains(x.CustomerCode));
        }

        var customers = await customersQuery
            .Select(x => new
            {
                x.CustomerCode,
                x.Name,
                x.City,
                x.District,
                x.SalesmanCode,
                x.CustomerType
            })
            .ToListAsync(cancellationToken);

        // 2b. Map every customer code (incl. sub accounts) to its main customer code
        var accountMap = await _dbContext.Customers
            .AsNoTracking()
            .Select(x => new { x.CustomerCode, x.MainCustomerCode })
            .ToListAsync(cancellationToken);

        var mainCodeLookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var a in accountMap)
        {
            if (string.IsNullOrWhiteSpace(a.CustomerCode)) continue;
            var mapped = !string.IsNullOrWhiteSpace(a.MainCustomerCode)
                ? a.MainCustomerCode.Trim()
                : CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(a.CustomerCode.Trim());
            mainCodeLookup[a.CustomerCode.Trim()] = mapped;
        }

        string ResolveMainCode(string? customerCode)
        {
            var code = (customerCode ?? string.Empty).Trim();
            if (code.Length == 0) return code;
            return mainCodeLookup.TryGetValue(code, out var mapped)
                ? mapped
                : CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(code);
        }

        // 3. Fetch ledger entries up to the end of the selected year
        var ledgerEntries = await _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .Where(x => x.Date <= endOfYear)
            .Select(x => new
            {
                x.CustomerCode,
                x.Date,
                x.Direction,
                x.Amount,
                x.CurrencyTypeId,
                x.CurrencyAmount,
                x.CurrencyRate,
                x.Id
            })
            .ToListAsync(cancellationToken);

        // Raporda hangi para birimleri var (ekran süzgeci için) — seçili olandan bağımsız.
        var availableCurrencyTypeIds = ledgerEntries
            .Select(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId))
            .Distinct()
            .OrderBy(x => x)
            .ToList();
        if (availableCurrencyTypeIds.Count == 0) availableCurrencyTypeIds.Add(CurrencyTypeHelper.Try);

        // Yalnız seçili para birimi yaşlandırılır: TL ödemesi dolar borcunu kapatamaz.
        // Karışık kovada FIFO çalıştırmak, kapanmamış dövizli borcu kapanmış gösteriyordu.
        // Group ledger entries by MAIN customer code, chronologically ordered for the FIFO pass.
        // A payment posted on the normal cari must be able to close an invoice posted on -1/-2/-3.
        var entriesByCustomer = ledgerEntries
            .Where(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId) == selectedCurrencyTypeId)
            .GroupBy(x => ResolveMainCode(x.CustomerCode), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g.OrderBy(x => x.Date).ThenBy(x => x.Id).ToList(),
                StringComparer.OrdinalIgnoreCase
            );

        var items = new List<CustomerAgeingReportItemDto>();

        var grandMonthlyTotals = new decimal[12];
        decimal grandTotalDebit = 0m;
        decimal grandTotalDevir = 0m;

        foreach (var cust in customers)
        {
            decimal totalCredit = 0m;
            var debits = new List<(DateTime Date, decimal Amount)>();

            if (entriesByCustomer.TryGetValue(cust.CustomerCode, out var entries))
            {
                foreach (var entry in entries)
                {
                    // Tutar satırın KENDİ para biriminde; TL çapası kullanılmıyor.
                    var own = OwnCurrencyAmount(entry.CurrencyTypeId, entry.Amount, entry.CurrencyAmount, entry.CurrencyRate);

                    if (entry.Direction == CustomerLedgerEntryDirection.Credit)
                    {
                        totalCredit += own;
                    }
                    else
                    {
                        debits.Add((entry.Date, own));
                    }
                }
            }

            // FIFO ageing: payments close the oldest open debt first, so whatever is left
            // is aged by the date of the invoice/debt that is still open.
            decimal remainingCredit = totalCredit;
            decimal ageingDevir = 0m;
            var ageingMonths = new decimal[12];

            foreach (var debit in debits)
            {
                if (debit.Amount <= 0m) continue;

                if (remainingCredit >= debit.Amount)
                {
                    remainingCredit -= debit.Amount;
                    continue;
                }

                // This debit is partially or fully unpaid (open)
                decimal openAmount = debit.Amount - remainingCredit;
                remainingCredit = 0m; // Credit is fully consumed

                if (debit.Date < startOfYear)
                {
                    // Open debt from previous periods (Devir)
                    ageingDevir += openAmount;
                }
                else
                {
                    // Open debt falls into target year months (entries past endOfYear were filtered out)
                    int monthIndex = debit.Date.Month - 1; // 0-11
                    ageingMonths[monthIndex] += openAmount;
                }
            }

            // Total always equals the sum of the columns shown on screen
            decimal totalAgeingBalance = ageingDevir + ageingMonths.Sum();

            // Nothing open for this cari in the selected period -> not an ageing row
            if (totalAgeingBalance <= 0m)
            {
                continue;
            }

            // Region resolving (City -> District -> Empty)
            string region = !string.IsNullOrWhiteSpace(cust.City) 
                ? cust.City.Trim() 
                : (!string.IsNullOrWhiteSpace(cust.District) ? cust.District.Trim() : "—");

            // Salesperson description mapping
            string smName = "00 - GENEL";
            if (!string.IsNullOrWhiteSpace(cust.SalesmanCode))
            {
                var code = cust.SalesmanCode.Trim();
                if (salesmen.TryGetValue(code, out var desc))
                {
                    smName = $"{code} - {desc}";
                }
                else
                {
                    smName = code;
                }
            }

            var item = new CustomerAgeingReportItemDto
            {
                CustomerCode = cust.CustomerCode,
                CustomerName = cust.Name ?? string.Empty,
                Region = region,
                SalesmanName = smName,
                Group = cust.CustomerType ?? "CARI",
                CurrencyTypeId = selectedCurrencyTypeId,
                CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(selectedCurrencyTypeId),
                TotalDebit = totalAgeingBalance,
                Devir = ageingDevir,
                MonthlyDebits = ageingMonths
            };

            items.Add(item);

            // Accumulate grand totals
            grandTotalDebit += totalAgeingBalance;
            grandTotalDevir += ageingDevir;
            for (int i = 0; i < 12; i++)
            {
                grandMonthlyTotals[i] += ageingMonths[i];
            }
        }

        // Sort items by customer name descending as standard or region then name
        var sortedItems = items
            .OrderBy(x => x.Region)
            .ThenBy(x => x.CustomerName)
            .ToList();

        var response = new CustomerAgeingReportResponseDto
        {
            Year = targetYear,
            CurrencyTypeId = selectedCurrencyTypeId,
            CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(selectedCurrencyTypeId),
            AvailableCurrencyTypeIds = availableCurrencyTypeIds,
            Items = sortedItems,
            GrandTotalDebit = grandTotalDebit,
            GrandTotalDevir = grandTotalDevir,
            GrandMonthlyTotals = grandMonthlyTotals
        };

        return Ok(new { success = true, data = response });
    }

    [HttpGet("/api/reports/supplier-ageing")]
    [AuthorizePage("reports", "yaslandirma")]
    public async Task<IActionResult> GetSupplierReport(
        [FromQuery] int? year,
        [FromQuery] int? currencyTypeId,
        CancellationToken cancellationToken = default)
    {
        var targetYear = year ?? DateTime.UtcNow.Year;

        // Müşteri yaşlandırmasıyla aynı kural: para birimi başına ayrı yaşlandırma.
        var selectedCurrencyTypeId = CurrencyTypeHelper.Normalize(currencyTypeId ?? CurrencyTypeHelper.Try);

        if (!CustomerScope.IsUnrestrictedFor(User))
        {
            return Ok(new
            {
                success = true,
                data = new CustomerAgeingReportResponseDto
                {
                    Year = targetYear,
                    CurrencyTypeId = selectedCurrencyTypeId,
                    CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(selectedCurrencyTypeId),
                    AvailableCurrencyTypeIds = new List<int> { selectedCurrencyTypeId },
                    Items = new List<CustomerAgeingReportItemDto>(),
                    GrandTotalDebit = 0m,
                    GrandTotalDevir = 0m,
                    GrandMonthlyTotals = new decimal[12]
                }
            });
        }

        var suppliers = await _dbContext.Suppliers
            .AsNoTracking()
            .Select(x => new
            {
                x.SupplierCode,
                x.FullName,
                x.Region
            })
            .ToListAsync(cancellationToken);

        var startOfYear = new DateTime(targetYear, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var endOfYear = new DateTime(targetYear, 12, 31, 23, 59, 59, DateTimeKind.Utc);

        var ledgerEntries = await _dbContext.SupplierLedgerEntries
            .AsNoTracking()
            .Where(x => x.Date <= endOfYear)
            .OrderBy(x => x.SupplierCode)
            .ThenBy(x => x.Date)
            .ThenBy(x => x.Id)
            .Select(x => new
            {
                x.SupplierCode,
                x.Date,
                x.Direction,
                x.Amount,
                x.CurrencyTypeId,
                x.CurrencyAmount,
                x.CurrencyRate
            })
            .ToListAsync(cancellationToken);

        var availableCurrencyTypeIds = ledgerEntries
            .Select(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId))
            .Distinct()
            .OrderBy(x => x)
            .ToList();
        if (availableCurrencyTypeIds.Count == 0) availableCurrencyTypeIds.Add(CurrencyTypeHelper.Try);

        var entriesBySupplier = ledgerEntries
            .Where(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId) == selectedCurrencyTypeId)
            .GroupBy(x => x.SupplierCode, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

        var items = new List<CustomerAgeingReportItemDto>();

        var grandMonthlyTotals = new decimal[12];
        decimal grandTotalDebit = 0m;
        decimal grandTotalDevir = 0m;

        foreach (var sup in suppliers)
        {
            if (!entriesBySupplier.TryGetValue(sup.SupplierCode, out var entries) || entries.Count == 0)
            {
                continue;
            }

            decimal totalDebit = 0m;
            var credits = new List<(DateTime Date, decimal Amount)>();

            foreach (var entry in entries)
            {
                // Tutar satırın KENDİ para biriminde; TL çapası kullanılmıyor.
                var own = OwnCurrencyAmount(entry.CurrencyTypeId, entry.Amount, entry.CurrencyAmount, entry.CurrencyRate);

                if (entry.Direction == SupplierLedgerEntryDirection.Debit)
                {
                    totalDebit += own;
                }
                else
                {
                    credits.Add((entry.Date, own));
                }
            }

            decimal totalCredit = credits.Sum(x => x.Amount);
            decimal netBalance = totalCredit - totalDebit;

            if (netBalance <= 0m)
            {
                continue;
            }

            decimal remainingDebit = totalDebit;
            decimal ageingDevir = 0m;
            var ageingMonths = new decimal[12];

            foreach (var credit in credits)
            {
                if (credit.Amount <= 0m) continue;

                if (remainingDebit >= credit.Amount)
                {
                    remainingDebit -= credit.Amount;
                    continue;
                }

                decimal openAmount = credit.Amount - remainingDebit;
                remainingDebit = 0m;

                if (credit.Date < startOfYear)
                {
                    ageingDevir += openAmount;
                }
                else
                {
                    int monthIndex = credit.Date.Month - 1;
                    ageingMonths[monthIndex] += openAmount;
                }
            }

            decimal totalAgeingBalance = ageingDevir + ageingMonths.Sum();

            if (totalAgeingBalance <= 0m)
            {
                continue;
            }

            var item = new CustomerAgeingReportItemDto
            {
                CustomerCode = sup.SupplierCode,
                CustomerName = sup.FullName ?? string.Empty,
                Region = !string.IsNullOrWhiteSpace(sup.Region) ? sup.Region.Trim() : "—",
                SalesmanName = "—",
                Group = "TEDARIKCI",
                CurrencyTypeId = selectedCurrencyTypeId,
                CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(selectedCurrencyTypeId),
                TotalDebit = totalAgeingBalance,
                Devir = ageingDevir,
                MonthlyDebits = ageingMonths
            };

            items.Add(item);

            grandTotalDebit += totalAgeingBalance;
            grandTotalDevir += ageingDevir;
            for (int i = 0; i < 12; i++)
            {
                grandMonthlyTotals[i] += ageingMonths[i];
            }
        }

        var sortedItems = items
            .OrderBy(x => x.Region)
            .ThenBy(x => x.CustomerName)
            .ToList();

        var response = new CustomerAgeingReportResponseDto
        {
            Year = targetYear,
            CurrencyTypeId = selectedCurrencyTypeId,
            CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(selectedCurrencyTypeId),
            AvailableCurrencyTypeIds = availableCurrencyTypeIds,
            Items = sortedItems,
            GrandTotalDebit = grandTotalDebit,
            GrandTotalDevir = grandTotalDevir,
            GrandMonthlyTotals = grandMonthlyTotals
        };

        return Ok(new { success = true, data = response });
    }
}
