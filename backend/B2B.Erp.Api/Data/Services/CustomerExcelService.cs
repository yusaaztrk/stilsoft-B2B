using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Customers;
using B2B.Erp.Api.Entities;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using System.Globalization;

namespace B2B.Erp.Api.Data.Services;

public sealed class CustomerExcelService : ICustomerExcelService
{
    private readonly AppDbContext _dbContext;

    public CustomerExcelService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    // Column names MUST be stable for export/import round-trip.
    private static class Cols
    {
        public const string CustomerCode = "CustomerCode";
        public const string Name = "Name";
        public const string CustomerType = "CustomerType";
        public const string ParentCustomerCode = "ParentCustomerCode";
        public const string PriceGroupCode = "PriceGroupCode";
        public const string InvoiceType = "InvoiceType";
        public const string DiscountRate = "DiscountRate";
        public const string CreditLimit = "CreditLimit";
        public const string CurrencyTypeId = "CurrencyTypeId";
        public const string SalesmanCode = "SalesmanCode";
        public const string Phone = "Phone";
        public const string Email = "Email";
        public const string Fax = "Fax";
        public const string Address = "Address";
        public const string City = "City";
        public const string District = "District";
        public const string TaxOffice = "TaxOffice";
        public const string TaxNumber = "TaxNumber";
        public const string IdentityNumber = "IdentityNumber";
        public const string ProductCategory1 = "ProductCategory1";
        public const string ProductCategory2 = "ProductCategory2";
        public const string ProductCategory3 = "ProductCategory3";
        public const string ProductCategory4 = "ProductCategory4";
        public const string ProductCategory5 = "ProductCategory5";
        public const string ProductCategories = "ProductCategories"; // comma separated main categories: "A, B, C"
        public const string ProductCategoriesAll = "Hepsi"; // "Hepsi" toggle in template
        public const string IsActive = "IsActive";
    }

    public async Task<byte[]> BuildTemplateAsync(CancellationToken cancellationToken)
    {
        var priceGroups = await _dbContext.PriceGroups
            .AsNoTracking()
            .OrderBy(x => x.Code)
            .Select(x => new { x.Code, x.Name, x.InvoiceType })
            .ToListAsync(cancellationToken);

        var salesmen = await _dbContext.Salesmen
            .AsNoTracking()
            .OrderBy(x => x.SalesmanCode)
            .Select(x => new { x.SalesmanCode, x.Description })
            .ToListAsync(cancellationToken);

        var parentCustomers = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.CustomerCode)
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        var productCategories = await _dbContext.ProductCategories
            .AsNoTracking()
            .Select(x => new { x.Id, x.Name, x.ParentId })
            .ToListAsync(cancellationToken);

        var rootCategoryNames = productCategories
            .Where(x => !x.ParentId.HasValue)
            .Select(x => (x.Name ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x, StringComparer.CurrentCultureIgnoreCase)
            .Take(20)
            .ToList();

        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Customers");
        var lists = wb.AddWorksheet("Lists");

        var headers = new List<string>
        {
            Cols.CustomerCode,
            Cols.Name,
            Cols.CustomerType,
            Cols.ParentCustomerCode,
            Cols.PriceGroupCode,
            Cols.InvoiceType,
            Cols.DiscountRate,
            Cols.CreditLimit,
            Cols.CurrencyTypeId,
            Cols.SalesmanCode,
            Cols.Phone,
            Cols.Email,
            Cols.Fax,
            Cols.Address,
            Cols.City,
            Cols.District,
            Cols.TaxOffice,
            Cols.TaxNumber,
            Cols.IdentityNumber,
            Cols.ProductCategories,
            Cols.ProductCategoriesAll
        };

        foreach (var n in rootCategoryNames)
        {
            headers.Add(n);
        }

        headers.Add(Cols.IsActive);

        var headerIndex = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < headers.Count; i++)
        {
            headerIndex[headers[i]] = i + 1;
        }

        for (var i = 0; i < headers.Count; i++)
        {
            ws.Cell(1, i + 1).Value = headers[i];
            ws.Cell(1, i + 1).Style.Font.Bold = true;
            ws.Cell(1, i + 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#F3F4F6");
        }

        // Write lookup lists
        int listCol = 1;

        (string name, List<string> values) customerTypes = (
            "CustomerTypes",
            new List<string> { "Müşteri", "Bayi", "Çalışan", "Şube", "Parekende", "Mağaza" }
        );

        (string name, List<string> values) invoiceTypes = ("InvoiceTypes", new List<string> { "FATURA", "ACIK" });
        (string name, List<string> values) currencyTypeIds = ("CurrencyTypeIds", new List<string> { "1", "2", "3" });
        (string name, List<string> values) isActiveValues = ("IsActiveValues", new List<string> { "TRUE", "FALSE" });
        (string name, List<string> values) priceGroupCodes = ("PriceGroupCodes", priceGroups.Select(x => x.Code.ToString(CultureInfo.InvariantCulture)).ToList());
        (string name, List<string> values) salesmanCodes = ("SalesmanCodes", salesmen.Select(x => (x.SalesmanCode ?? string.Empty).Trim()).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList());
        (string name, List<string> values) parentCustomerCodes = ("ParentCustomerCodes", parentCustomers);
        (string name, List<string> values) rootProductCategories = ("RootProductCategories", rootCategoryNames);

        var listsToWrite = new List<(string name, List<string> values)>
        {
            customerTypes,
            invoiceTypes,
            currencyTypeIds,
            isActiveValues,
            priceGroupCodes,
            salesmanCodes,
            parentCustomerCodes,
            rootProductCategories
        };

        // BoolValues for TRUE/FALSE dropdowns (more stable than inline list on some Excel versions)
        listsToWrite.Add(("BoolValues", new List<string> { "TRUE", "FALSE" }));

        foreach (var (name, values) in listsToWrite)
        {
            lists.Cell(1, listCol).Value = name;
            lists.Cell(1, listCol).Style.Font.Bold = true;

            for (var r = 0; r < values.Count; r++)
            {
                lists.Cell(2 + r, listCol).Value = values[r];
            }

            if (values.Count > 0)
            {
                var range = lists.Range(2, listCol, 1 + values.Count, listCol);
                range.AddToNamed(name, XLScope.Workbook);
            }

            listCol++;
        }

        // PriceGroupCode -> InvoiceType map (for auto formula in template)
        // Build an Excel range like:
        // A: PriceGroupCode
        // B: InvoiceType
        var mapStartCol = listCol;
        lists.Cell(1, mapStartCol).Value = "PriceGroupInvoiceMap";
        lists.Cell(1, mapStartCol).Style.Font.Bold = true;
        lists.Cell(1, mapStartCol + 1).Value = "InvoiceType";
        lists.Cell(1, mapStartCol + 1).Style.Font.Bold = true;

        for (var i = 0; i < priceGroups.Count; i++)
        {
            var pg = priceGroups[i];
            lists.Cell(2 + i, mapStartCol).Value = pg.Code.ToString(CultureInfo.InvariantCulture);

            var inv = NormalizeInvoiceType(pg.InvoiceType);
            if (string.IsNullOrWhiteSpace(inv))
            {
                inv = pg.Code is >= 4 and <= 6 ? "ACIK" : "FATURA";
            }
            lists.Cell(2 + i, mapStartCol + 1).Value = inv;
        }

        if (priceGroups.Count > 0)
        {
            var mapRange = lists.Range(2, mapStartCol, 1 + priceGroups.Count, mapStartCol + 1);
            mapRange.AddToNamed("PriceGroupInvoiceMap", XLScope.Workbook);
        }

        // Hide lists sheet
        lists.Hide();

        // Apply data validations
        const int maxRows = 500;
        var fromRow = 2;
        var toRow = maxRows;

        void ApplyListValidation(string colName, string namedRange)
        {
            if (!headerIndex.TryGetValue(colName, out var col)) return;
            var rng = ws.Range(fromRow, col, toRow, col);
            rng.CreateDataValidation().List(namedRange, true);
        }

        ApplyListValidation(Cols.CustomerType, "CustomerTypes");
        ApplyListValidation(Cols.InvoiceType, "InvoiceTypes");
        ApplyListValidation(Cols.CurrencyTypeId, "CurrencyTypeIds");
        ApplyListValidation(Cols.IsActive, "IsActiveValues");
        ApplyListValidation(Cols.PriceGroupCode, "PriceGroupCodes");
        ApplyListValidation(Cols.SalesmanCode, "SalesmanCodes");
        ApplyListValidation(Cols.ParentCustomerCode, "ParentCustomerCodes");

        // Checkbox-like category selection: TRUE/FALSE columns + ProductCategories formula
        void ApplyBoolValidation(string colName)
        {
            if (!headerIndex.TryGetValue(colName, out var col)) return;
            var rng = ws.Range(fromRow, col, toRow, col);
            rng.CreateDataValidation().List("BoolValues", true);
        }

        ApplyBoolValidation(Cols.ProductCategoriesAll);
        foreach (var n in rootCategoryNames)
        {
            ApplyBoolValidation(n);
        }

        // ProductCategories: auto build comma-separated string from selected booleans
        if (headerIndex.TryGetValue(Cols.ProductCategories, out var productCatsCol)
            && headerIndex.TryGetValue(Cols.ProductCategoriesAll, out var allCol))
        {
            for (var r = fromRow; r <= toRow; r++)
            {
                var catsCell = ws.Cell(r, productCatsCol);
                var allCell = ws.Cell(r, allCol);
                var allRef = $"{allCell.Address.ColumnLetter}{allCell.Address.RowNumber}";

                var allText = string.Join(", ", rootCategoryNames.Select(n => n.Replace("\"", "")));

                // Build using CONCATENATE (older Excel friendly). We'll append ", " after each selected item,
                // then trim the trailing comma-space.
                var selectedParts = new List<string>();
                foreach (var n in rootCategoryNames)
                {
                    if (!headerIndex.TryGetValue(n, out var catCol)) continue;
                    var catCell = ws.Cell(r, catCol);
                    var catRef = $"{catCell.Address.ColumnLetter}{catCell.Address.RowNumber}";
                    var safeName = n.Replace("\"", "");
                    selectedParts.Add($"IF({catRef}=TRUE,\"{safeName}, \",\"\")");
                }

                var concat = selectedParts.Count == 0 ? "\"\"" : $"CONCATENATE({string.Join(",", selectedParts)})";
                var trimmed = $"IF(RIGHT({concat},2)=\", \",LEFT({concat},LEN({concat})-2),{concat})";

                catsCell.FormulaA1 = $"=IF({allRef}=TRUE,\"{allText}\",{trimmed})";
            }
        }

        // InvoiceType: auto fill from PriceGroupCode
        if (headerIndex.TryGetValue(Cols.InvoiceType, out var invCol) && headerIndex.TryGetValue(Cols.PriceGroupCode, out var pgCol))
        {
            for (var r = fromRow; r <= toRow; r++)
            {
                var invoiceCell = ws.Cell(r, invCol);
                var pgCell = ws.Cell(r, pgCol);
                var pgRef = $"{pgCell.Address.ColumnLetter}{pgCell.Address.RowNumber}";
                invoiceCell.FormulaA1 = $"=IFERROR(VLOOKUP({pgRef},PriceGroupInvoiceMap,2,FALSE),\"\")";
            }
        }

        // Phone column: force Text format to prevent scientific notation and allow leading 0.
        if (headerIndex.TryGetValue(Cols.Phone, out var phoneCol))
        {
            ws.Column(phoneCol).Style.NumberFormat.Format = "@";

            // Add a validation prompt (users can type like 0555 555 55 55)
            var phoneRange = ws.Range(fromRow, phoneCol, toRow, phoneCol);
            var dv = phoneRange.CreateDataValidation();
            dv.IgnoreBlanks = true;
            dv.ShowInputMessage = true;
            dv.InputTitle = "Telefon";
            dv.InputMessage = "Örnek: 0555 555 55 55 (import sırasında boşluklar temizlenir)";
        }

        ws.SheetView.FreezeRows(1);
        ws.Columns().AdjustToContents();

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    public async Task<byte[]> BuildExportAsync(CancellationToken cancellationToken)
    {
        var priceGroups = await _dbContext.PriceGroups
            .AsNoTracking()
            .Select(x => new { x.Id, x.Code, x.Name, x.InvoiceType })
            .ToListAsync(cancellationToken);

        var priceGroupById = priceGroups.ToDictionary(x => x.Id, x => x);

        var categories = await _dbContext.ProductCategories
            .AsNoTracking()
            .Select(x => new { x.Id, x.Name, x.ParentId })
            .ToListAsync(cancellationToken);

        var catById = categories.ToDictionary(x => x.Id, x => x);
        string BuildCategoryPath(Guid id)
        {
            if (!catById.TryGetValue(id, out var c)) return string.Empty;
            if (!c.ParentId.HasValue) return c.Name;
            var parent = catById.TryGetValue(c.ParentId.Value, out var p) ? p.Name : string.Empty;
            if (string.IsNullOrWhiteSpace(parent)) return c.Name;
            return parent + " > " + c.Name;
        }

        var customerCodes = await _dbContext.Customers
            .AsNoTracking()
            .OrderBy(x => x.CustomerCode)
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        var categoryMap = await _dbContext.CustomerProductCategories
            .AsNoTracking()
            .Where(x => customerCodes.Contains(x.CustomerCode))
            .GroupBy(x => x.CustomerCode)
            .ToDictionaryAsync(g => g.Key, g => g.Select(x => x.ProductCategoryId).ToList(), cancellationToken);

        var customers = await _dbContext.Customers
            .AsNoTracking()
            .OrderBy(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Customers");

        var headers = new[]
        {
            Cols.CustomerCode,
            Cols.Name,
            Cols.CustomerType,
            Cols.ParentCustomerCode,
            Cols.PriceGroupCode,
            Cols.InvoiceType,
            Cols.DiscountRate,
            Cols.CreditLimit,
            Cols.CurrencyTypeId,
            Cols.SalesmanCode,
            Cols.Phone,
            Cols.Email,
            Cols.Fax,
            Cols.Address,
            Cols.City,
            Cols.District,
            Cols.TaxOffice,
            Cols.TaxNumber,
            Cols.IdentityNumber,
            Cols.ProductCategories,
            Cols.IsActive
        };

        for (var i = 0; i < headers.Length; i++)
        {
            ws.Cell(1, i + 1).Value = headers[i];
            ws.Cell(1, i + 1).Style.Font.Bold = true;
            ws.Cell(1, i + 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#F3F4F6");
        }

        var row = 2;
        foreach (var c in customers)
        {
            priceGroupById.TryGetValue(c.PriceGroupId ?? Guid.Empty, out var pg);

            var catIds = categoryMap.TryGetValue(c.CustomerCode, out var ids) ? ids : new List<Guid>();
            var cats = catIds.Select(BuildCategoryPath).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();

            ws.Cell(row, 1).Value = c.CustomerCode;
            ws.Cell(row, 2).Value = c.Name;
            ws.Cell(row, 3).Value = c.CustomerType;
            ws.Cell(row, 4).Value = c.ParentCustomerCode;
            ws.Cell(row, 5).Value = pg?.Code;
            ws.Cell(row, 6).Value = c.InvoiceType;
            ws.Cell(row, 7).Value = c.DiscountRate;
            ws.Cell(row, 8).Value = c.CreditLimit;
            ws.Cell(row, 9).Value = c.CurrencyTypeId;
            ws.Cell(row, 10).Value = c.SalesmanCode;
            ws.Cell(row, 11).Value = c.Phone;
            ws.Cell(row, 12).Value = c.Email;
            ws.Cell(row, 13).Value = c.Fax;
            ws.Cell(row, 14).Value = c.Address;
            ws.Cell(row, 15).Value = c.City;
            ws.Cell(row, 16).Value = c.District;
            ws.Cell(row, 17).Value = c.TaxOffice;
            ws.Cell(row, 18).Value = c.TaxNumber;
            ws.Cell(row, 19).Value = c.IdentityNumber;
            ws.Cell(row, 20).Value = string.Join(", ", cats);
            ws.Cell(row, 21).Value = c.IsActive;
            row++;
        }

        ws.SheetView.FreezeRows(1);
        ws.Columns().AdjustToContents();

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    private static string NormalizeCustomerType(string raw)
    {
        var s = (raw ?? string.Empty).Trim().ToLowerInvariant();
        if (s == "müşteri" || s == "musteri") return "musteri";
        if (s == "bayi") return "bayi";
        if (s == "çalışan" || s == "calisan") return "calisan";
        if (s == "şube" || s == "sube") return "sube";
        if (s == "parekende" || s == "perakende") return "parekende";
        if (s == "mağaza" || s == "magaza") return "magaza";
        if (s == "hizmet") return "hizmet";
        return s;
    }

    private static string ResolveCustomerPrefixByType(string normalizedType)
    {
        return normalizedType switch
        {
            "bayi" => "120-01-",
            "musteri" => "120-03-",
            "calisan" => "120-07-",
            "sube" => "120-04-",
            "parekende" => "120-04-",
            "magaza" => "120-04-",
            "hizmet" => "770-01-",
            _ => ""
        };
    }

    private static string NormalizeInvoiceType(string? value)
    {
        var s = (value ?? string.Empty).Trim().ToUpperInvariant();
        if (s == "ACIK") return "ACIK";
        if (s == "FATURA") return "FATURA";
        return string.Empty;
    }


    private static long ParseLast6DigitsOrZero(string code, string prefix)
    {
        var s = (code ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(prefix) || !s.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return 0;
        var suffix = s.Substring(prefix.Length);
        if (suffix.Length != 6) return 0;
        return long.TryParse(suffix, out var n) ? n : 0;
    }

    private static bool TryParseParentForBranchCode(string parentCustomerCode, out string branchBasePrefix)
    {
        branchBasePrefix = string.Empty;
        var p = (parentCustomerCode ?? string.Empty).Trim();
        var parts = p.Split('-', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length != 3) return false;
        if (parts[0].Length == 0) return false;

        var mid = parts[1];
        var last6 = parts[2];
        if (mid.Length != 2) return false;
        if (last6.Length != 6) return false;
        if (!mid.All(char.IsDigit)) return false;
        if (!last6.All(char.IsDigit)) return false;

        branchBasePrefix = $"{mid}-{last6}-";
        return true;
    }

    private static int ParseLast3DigitsOrZero(string code, string prefix)
    {
        var s = (code ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(prefix) || !s.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return 0;
        var suffix = s.Substring(prefix.Length);
        if (suffix.Length != 3) return 0;
        return int.TryParse(suffix, out var n) ? n : 0;
    }

    private async Task<string> ReserveNextBranchCustomerCode(string branchBasePrefix, CancellationToken cancellationToken)
    {
        await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

        var keySafe = branchBasePrefix.TrimEnd('-');
        var seriesKey = $"customer-branch:{keySafe}";
        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        var existingCodes = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode.StartsWith(branchBasePrefix))
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        var maxExisting = existingCodes.Count == 0 ? 0 : existingCodes.Max(c => ParseLast3DigitsOrZero(c, branchBasePrefix));

        if (series is null)
        {
            series = new NumberSeries
            {
                Key = seriesKey,
                LastValue = maxExisting
            };

            _dbContext.NumberSeries.Add(series);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        else if (series.LastValue < maxExisting)
        {
            series.LastValue = maxExisting;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        series.LastValue += 1;
        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        var n = (int)series.LastValue;
        if (n < 1) n = 1;
        if (n > 999) n = 999;
        return branchBasePrefix + n.ToString("D3");
    }

    private async Task<string> ReserveNextCustomerCode(string prefix, CancellationToken cancellationToken)
    {
        await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

        var seriesKey = $"customer:{prefix.TrimEnd('-')}";
        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        var existingCodes = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode.StartsWith(prefix))
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        var maxExisting = existingCodes.Count == 0 ? 0 : existingCodes.Max(c => ParseLast6DigitsOrZero(c, prefix));

        if (series is null)
        {
            series = new NumberSeries
            {
                Key = seriesKey,
                LastValue = maxExisting
            };

            _dbContext.NumberSeries.Add(series);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        else if (series.LastValue < maxExisting)
        {
            series.LastValue = maxExisting;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        series.LastValue += 1;
        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return prefix + series.LastValue.ToString("D6");
    }

    private static decimal? TryParseDecimal(object? value)
    {
        var s = Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        s = s.Trim();
        if (string.IsNullOrWhiteSpace(s)) return null;

        // TR-style input support
        s = s.Replace(".", string.Empty).Replace(',', '.');
        return decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : null;
    }

    private static double? TryParseDouble(object? value)
    {
        var dec = TryParseDecimal(value);
        if (!dec.HasValue) return null;
        return (double)dec.Value;
    }

    private static int? TryParseInt(object? value)
    {
        var s = Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        s = s.Trim();
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (!int.TryParse(s, out var n)) return null;
        return n;
    }

    private static bool? TryParseBool(object? value)
    {
        if (value is null) return null;
        if (value is bool b) return b;

        var s = Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        s = s.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (s == "1" || s == "true" || s == "evet" || s == "yes") return true;
        if (s == "0" || s == "false" || s == "hayir" || s == "hayır" || s == "no") return false;
        return null;
    }

    public async Task<CustomerExcelImportResult> ImportAsync(IFormFile file, CancellationToken cancellationToken)
    {
        var result = new CustomerExcelImportResult();

        try
        {
            if (file is null || file.Length <= 0)
            {
                result.RowErrors.Add(new CustomerExcelImportRowError { RowNumber = 0, Errors = new List<string> { "Dosya bulunamadı" } });
                return result;
            }

            await using var stream = file.OpenReadStream();
            using var wb = new XLWorkbook(stream);
            var ws = wb.Worksheets.FirstOrDefault(x => string.Equals(x.Name, "Customers", StringComparison.OrdinalIgnoreCase)) ?? wb.Worksheets.FirstOrDefault();
            if (ws is null)
            {
                result.RowErrors.Add(new CustomerExcelImportRowError { RowNumber = 0, Errors = new List<string> { "Excel sayfası bulunamadı" } });
                return result;
            }

        var headerRow = ws.Row(1);
        var lastCol = headerRow.LastCellUsed()?.Address.ColumnNumber ?? 0;
        var colIndexByName = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var c = 1; c <= lastCol; c++)
        {
            var name = headerRow.Cell(c).GetString().Trim();
            if (string.IsNullOrWhiteSpace(name)) continue;
            if (!colIndexByName.ContainsKey(name)) colIndexByName[name] = c;
        }

        int? Col(string name) => colIndexByName.TryGetValue(name, out var idx) ? idx : null;

        // Lookup caches
        var priceGroups = await _dbContext.PriceGroups
            .AsNoTracking()
            .Select(x => new { x.Id, x.Code, x.Name, x.InvoiceType })
            .ToListAsync(cancellationToken);

        var priceGroupByCode = priceGroups
            .GroupBy(x => x.Code)
            .ToDictionary(g => g.Key, g => g.First());

        var productCategories = await _dbContext.ProductCategories
            .AsNoTracking()
            .Select(x => new { x.Id, x.Name, x.ParentId })
            .ToListAsync(cancellationToken);

        var rootCategories = productCategories
            .Where(x => !x.ParentId.HasValue)
            .ToList();

        var rootCategoryIdByName = rootCategories
            .Where(x => !string.IsNullOrWhiteSpace(x.Name))
            .GroupBy(x => x.Name.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

        var catsByParent = productCategories
            .Where(x => x.ParentId.HasValue)
            .GroupBy(x => x.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());

        var childIdsByParent = productCategories
            .Where(x => x.ParentId.HasValue)
            .GroupBy(x => x.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Id).ToList());

        List<Guid> GetDescendants(Guid rootId)
        {
            var resultIds = new List<Guid>();
            var q = new Queue<Guid>();
            q.Enqueue(rootId);

            while (q.Count > 0)
            {
                var cur = q.Dequeue();
                if (!childIdsByParent.TryGetValue(cur, out var children)) continue;
                foreach (var c in children)
                {
                    resultIds.Add(c);
                    q.Enqueue(c);
                }
            }

            return resultIds;
        }

        Guid? ResolveRootCategory(string raw)
        {
            var s = (raw ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(s)) return null;

            // only root category names are supported for import
            var match = rootCategories.FirstOrDefault(x => string.Equals(x.Name, s, StringComparison.OrdinalIgnoreCase));
            if (match is null)
            {
                match = rootCategories.FirstOrDefault(x => string.Equals(x.Name, s, StringComparison.CurrentCultureIgnoreCase));
            }

            return match?.Id;
        }

        var lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;
        for (var r = 2; r <= lastRow; r++)
        {
            var row = ws.Row(r);
            if (row.IsEmpty()) continue;

            var errors = new List<string>();

            string GetS(string col)
            {
                var ci = Col(col);
                if (!ci.HasValue) return string.Empty;
                return row.Cell(ci.Value).GetString().Trim();
            }

            string GetSmartString(string col)
            {
                var ci = Col(col);
                if (!ci.HasValue) return string.Empty;
                var cell = row.Cell(ci.Value);

                try
                {
                    if (cell.DataType == XLDataType.Number)
                    {
                        // Prevent scientific notation (e.g., 5E+09) for phone/identity/tax numbers
                        var d = cell.GetDouble();
                        if (double.IsNaN(d) || double.IsInfinity(d)) return string.Empty;
                        var asLong = (long)Math.Round(d, 0, MidpointRounding.AwayFromZero);
                        return asLong.ToString(CultureInfo.InvariantCulture).Trim();
                    }
                }
                catch
                {
                    // ignore and fallback to GetString
                }

                return cell.GetString().Trim();
            }

            object? GetV(string col)
            {
                var ci = Col(col);
                if (!ci.HasValue) return null;
                var cell = row.Cell(ci.Value);
                return cell.Value;
            }

            var name = GetS(Cols.Name);
            var customerType = GetS(Cols.CustomerType);
            var invoiceTypeRaw = GetS(Cols.InvoiceType);

            var importedCustomerCode = GetS(Cols.CustomerCode);
            var parentCustomerCode = GetS(Cols.ParentCustomerCode);

            // Skip rows that have no meaningful data (Excel data validation can mark rows as used)
            var anyMeaningful =
                !string.IsNullOrWhiteSpace(importedCustomerCode) ||
                !string.IsNullOrWhiteSpace(name) ||
                !string.IsNullOrWhiteSpace(customerType) ||
                !string.IsNullOrWhiteSpace(invoiceTypeRaw) ||
                !string.IsNullOrWhiteSpace(parentCustomerCode) ||
                !string.IsNullOrWhiteSpace(GetS(Cols.PriceGroupCode)) ||
                !string.IsNullOrWhiteSpace(GetS(Cols.SalesmanCode)) ||
                !string.IsNullOrWhiteSpace(GetS(Cols.Phone)) ||
                !string.IsNullOrWhiteSpace(GetS(Cols.Email)) ||
                !string.IsNullOrWhiteSpace(GetS(Cols.TaxNumber)) ||
                !string.IsNullOrWhiteSpace(GetS(Cols.IdentityNumber)) ||
                !string.IsNullOrWhiteSpace(GetS(Cols.ProductCategories));

            if (!anyMeaningful)
            {
                continue;
            }

            var priceGroupCode = TryParseInt(GetV(Cols.PriceGroupCode));
            var discountRate = TryParseDouble(GetV(Cols.DiscountRate)) ?? 0;
            var creditLimit = TryParseDecimal(GetV(Cols.CreditLimit)) ?? 0;
            var currencyTypeId = TryParseInt(GetV(Cols.CurrencyTypeId)) ?? 1;
            if (currencyTypeId < 1 || currencyTypeId > 3) currencyTypeId = 1;

            var isActive = TryParseBool(GetV(Cols.IsActive)) ?? true;

            if (string.IsNullOrWhiteSpace(name)) errors.Add("Name zorunludur");
            if (string.IsNullOrWhiteSpace(customerType)) errors.Add("CustomerType zorunludur");

            var normalizedType = NormalizeCustomerType(customerType);

            // Şube kontrolü
            if (normalizedType == "sube")
            {
                if (string.IsNullOrWhiteSpace(parentCustomerCode))
                {
                    errors.Add("Şube için ParentCustomerCode zorunludur");
                }
                else
                {
                    var parentExists = await _dbContext.Customers
                        .AsNoTracking()
                        .AnyAsync(x => x.CustomerCode == parentCustomerCode, cancellationToken);

                    if (!parentExists)
                    {
                        errors.Add("ParentCustomerCode geçersiz (cari bulunamadı)");
                    }
                    else if (!TryParseParentForBranchCode(parentCustomerCode, out _))
                    {
                        errors.Add("ParentCustomerCode formatı geçersiz");
                    }
                }
            }

            // PriceGroup -> InvoiceType override
            Guid? priceGroupId = null;
            string invoiceType = NormalizeInvoiceType(invoiceTypeRaw);
            if (priceGroupCode.HasValue)
            {
                if (!priceGroupByCode.TryGetValue(priceGroupCode.Value, out var pg))
                {
                    errors.Add("PriceGroupCode geçersiz");
                }
                else
                {
                    priceGroupId = pg.Id;
                    var inv = NormalizeInvoiceType(pg.InvoiceType);
                    if (string.IsNullOrWhiteSpace(inv))
                    {
                        // rule from PriceGroupsController: code 4-6 forces ACIK, else default FATURA
                        inv = priceGroupCode.Value is >= 4 and <= 6 ? "ACIK" : "FATURA";
                    }

                    // Always override when price group provided
                    invoiceType = inv;
                }
            }

            if (string.IsNullOrWhiteSpace(invoiceType))
            {
                if (!priceGroupCode.HasValue)
                {
                    errors.Add("InvoiceType zorunludur (FATURA/ACIK)");
                }
            }
            else if (invoiceType != "FATURA" && invoiceType != "ACIK")
            {
                errors.Add("InvoiceType FATURA veya ACIK olmalıdır");
            }

            // Product categories resolve
            var productCategoryIds = new List<Guid>();

            // 1) Read checkbox-like bool columns (Hepsi + root category columns)
            var hepsiRaw = GetS(Cols.ProductCategoriesAll);
            var hepsiBool = TryParseBool(GetV(Cols.ProductCategoriesAll)) ??
                            (string.Equals(hepsiRaw, "TRUE", StringComparison.OrdinalIgnoreCase) ||
                             string.Equals(hepsiRaw, "EVET", StringComparison.OrdinalIgnoreCase) ||
                             string.Equals(hepsiRaw, "YES", StringComparison.OrdinalIgnoreCase));

            if (hepsiBool)
            {
                // Hepsi: select all categories (root + sub)
                productCategoryIds.AddRange(productCategories.Select(x => x.Id));
            }
            else
            {
                foreach (var kvp in rootCategoryIdByName)
                {
                    var raw = GetS(kvp.Key);
                    var isSelected = TryParseBool(GetV(kvp.Key)) ??
                                     (string.Equals(raw, "TRUE", StringComparison.OrdinalIgnoreCase) ||
                                      string.Equals(raw, "EVET", StringComparison.OrdinalIgnoreCase) ||
                                      string.Equals(raw, "YES", StringComparison.OrdinalIgnoreCase));

                    if (isSelected)
                    {
                        productCategoryIds.Add(kvp.Value);
                        productCategoryIds.AddRange(GetDescendants(kvp.Value));
                    }
                }
            }

            var productCategoriesRaw = GetS(Cols.ProductCategories);
            if (!string.IsNullOrWhiteSpace(productCategoriesRaw) && productCategoriesRaw.TrimStart().StartsWith("#", StringComparison.OrdinalIgnoreCase))
            {
                productCategoriesRaw = string.Empty;
            }
            if (!string.IsNullOrWhiteSpace(productCategoriesRaw))
            {
                var parts = productCategoriesRaw
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(x => x.Trim())
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .ToList();

                foreach (var p in parts)
                {
                    var id = ResolveRootCategory(p);
                    if (!id.HasValue)
                    {
                        errors.Add($"Ürün kategorisi bulunamadı: {p}");
                        continue;
                    }
                    productCategoryIds.Add(id.Value);
                    productCategoryIds.AddRange(GetDescendants(id.Value));
                }
            }

            productCategoryIds = productCategoryIds.Distinct().ToList();

            // FK validations for categories (mirrors Create)
            if (productCategoryIds.Count > 0)
            {
                var existsCount = await _dbContext.ProductCategories
                    .AsNoTracking()
                    .Where(x => productCategoryIds.Contains(x.Id))
                    .Select(x => x.Id)
                    .Distinct()
                    .CountAsync(cancellationToken);

                if (existsCount != productCategoryIds.Count)
                {
                    errors.Add("ProductCategoryIds içinde geçersiz kategori var");
                }
            }

            static string DigitsOnly(string input)
            {
                if (string.IsNullOrWhiteSpace(input)) return string.Empty;
                var chars = input.Where(char.IsDigit).ToArray();
                return new string(chars);
            }

            var phoneRaw = GetSmartString(Cols.Phone);
            var phone = DigitsOnly(phoneRaw);
            var formattedPhone = string.Empty;
            if (!string.IsNullOrWhiteSpace(phone))
            {
                if (phone.Length != 11 || !phone.All(char.IsDigit) || phone[0] != '0')
                {
                    errors.Add("Telefon 0 ile başlamalı ve 11 haneli olmalıdır");
                }
                else
                {
                    formattedPhone = $"{phone.Substring(0, 4)} {phone.Substring(4, 3)} {phone.Substring(7, 4)}";
                }
            }

            var identityNumber = GetSmartString(Cols.IdentityNumber);
            if (!string.IsNullOrWhiteSpace(identityNumber))
            {
                if (identityNumber.Length != 11 || !identityNumber.All(char.IsDigit))
                {
                    errors.Add("TC Kimlik No 11 haneli olmalıdır");
                }
            }

            if (errors.Count > 0)
            {
                result.RowErrors.Add(new CustomerExcelImportRowError
                {
                    RowNumber = r,
                    CustomerCode = importedCustomerCode,
                    Errors = errors
                });
                continue;
            }

            // CustomerCode generation/validation (mirrors Create)
            // Excel'deki CustomerCode her zaman yok sayılır; CustomerType'a göre sistem otomatik üretir.
            var customerCode = string.Empty;

            if (normalizedType == "sube")
            {
                // parent validated above
                TryParseParentForBranchCode(parentCustomerCode, out var branchBasePrefix);
                customerCode = await ReserveNextBranchCustomerCode(branchBasePrefix, cancellationToken);
            }
            else
            {
                var prefix = ResolveCustomerPrefixByType(normalizedType);
                if (string.IsNullOrWhiteSpace(prefix))
                {
                    result.RowErrors.Add(new CustomerExcelImportRowError
                    {
                        RowNumber = r,
                        CustomerCode = importedCustomerCode,
                        Errors = new List<string> { "Geçersiz CustomerType" }
                    });
                    continue;
                }

                customerCode = await ReserveNextCustomerCode(prefix, cancellationToken);
            }

            var exists = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.CustomerCode == customerCode, cancellationToken);

            if (exists)
            {
                var prefix = ResolveCustomerPrefixByType(normalizedType);
                if (string.IsNullOrWhiteSpace(prefix))
                {
                    result.RowErrors.Add(new CustomerExcelImportRowError
                    {
                        RowNumber = r,
                        CustomerCode = customerCode,
                        Errors = new List<string> { "CustomerCode benzersiz olmalıdır" }
                    });
                    continue;
                }

                customerCode = await ReserveNextCustomerCode(prefix, cancellationToken);
            }

            if (priceGroupId.HasValue)
            {
                var pgExists = await _dbContext.PriceGroups
                    .AsNoTracking()
                    .AnyAsync(x => x.Id == priceGroupId.Value, cancellationToken);

                if (!pgExists)
                {
                    result.RowErrors.Add(new CustomerExcelImportRowError
                    {
                        RowNumber = r,
                        CustomerCode = customerCode,
                        Errors = new List<string> { "PriceGroupId geçersiz" }
                    });
                    continue;
                }
            }

            if (!string.IsNullOrWhiteSpace(parentCustomerCode) && normalizedType != "sube")
            {
                var parentExists = await _dbContext.Customers
                    .AsNoTracking()
                    .AnyAsync(x => x.CustomerCode == parentCustomerCode, cancellationToken);

                if (!parentExists)
                {
                    result.RowErrors.Add(new CustomerExcelImportRowError
                    {
                        RowNumber = r,
                        CustomerCode = customerCode,
                        Errors = new List<string> { "ParentCustomerCode geçersiz" }
                    });
                    continue;
                }
            }

            try
            {
                var entity = new Customer
                {
                    CustomerCode = customerCode,
                    Name = name,
                    Address = NullIfEmpty(GetS(Cols.Address)),
                    City = NullIfEmpty(GetS(Cols.City)),
                    District = NullIfEmpty(GetS(Cols.District)),
                    Phone = NullIfEmpty(formattedPhone),
                    Fax = NullIfEmpty(GetS(Cols.Fax)),
                    Email = NullIfEmpty(GetS(Cols.Email)),
                    TaxOffice = NullIfEmpty(GetS(Cols.TaxOffice)),
                    TaxNumber = NullIfEmpty(GetSmartString(Cols.TaxNumber)),
                    IdentityNumber = NullIfEmpty(identityNumber),
                    CustomerType = customerType.Trim(),
                    InvoiceType = invoiceType,
                    ProductCategory = null,
                    IsActive = isActive,
                    PriceGroupId = priceGroupId,
                    DiscountRate = discountRate,
                    SalesmanCode = NullIfEmpty(GetS(Cols.SalesmanCode)),
                    CreditLimit = creditLimit,
                    ParentCustomerCode = string.IsNullOrWhiteSpace(parentCustomerCode) ? null : parentCustomerCode,
                    CurrencyTypeId = currencyTypeId
                };

                _dbContext.Customers.Add(entity);

                foreach (var id in productCategoryIds)
                {
                    _dbContext.CustomerProductCategories.Add(new CustomerProductCategory
                    {
                        CustomerCode = entity.CustomerCode,
                        ProductCategoryId = id
                    });
                }

                await _dbContext.SaveChangesAsync(cancellationToken);
                result.SuccessCount += 1;
            }
            catch (DbUpdateException ex)
            {
                result.RowErrors.Add(new CustomerExcelImportRowError
                {
                    RowNumber = r,
                    CustomerCode = customerCode,
                    Errors = new List<string> { "DB kayıt hatası: " + ex.Message }
                });
            }
            catch (Exception ex)
            {
                result.RowErrors.Add(new CustomerExcelImportRowError
                {
                    RowNumber = r,
                    CustomerCode = customerCode,
                    Errors = new List<string> { "Beklenmeyen hata: " + ex.Message }
                });
            }
        }

            return result;
        }
        catch (Exception ex)
        {
            result.RowErrors.Add(new CustomerExcelImportRowError
            {
                RowNumber = 0,
                Errors = new List<string> { "Import işlemi sırasında hata: " + ex.Message }
            });
            return result;
        }
    }

    private static string? NullIfEmpty(string? s)
    {
        var t = (s ?? string.Empty).Trim();
        return string.IsNullOrWhiteSpace(t) ? null : t;
    }
}
