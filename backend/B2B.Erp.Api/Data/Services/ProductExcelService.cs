using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using System.Globalization;

namespace B2B.Erp.Api.Data.Services;

public sealed class ProductExcelService : IProductExcelService
{
    private readonly AppDbContext _dbContext;

    public ProductExcelService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    // Column names MUST be stable for export/import round-trip.
    private static class Cols
    {
        public const string StockCode = "StockCode";
        public const string Name = "Name";
        public const string Description = "Description";
        public const string Barcode = "Barcode";
        public const string GroupCode = "GroupCode";
        public const string SubGroupCode = "SubGroupCode";
        public const string Unit = "Unit";
        public const string TaxRate = "TaxRate";
        public const string DiscountRate = "DiscountRate";
        public const string SupplierId = "SupplierId";
        public const string BoxQuantity = "BoxQuantity";
        public const string PurchasePrice = "PurchasePrice";
        public const string BsyVisibleFlag = "BsyVisibleFlag";
        public const string ContainerQuantity = "ContainerQuantity";
        public const string Freight = "Freight";
        public const string CurrencyCode = "CurrencyCode";
        public const string IsOfficial = "IsOfficial";
        public const string Stock = "Stock";
        public const string MinStock = "MinStock";
        public const string IsActive = "IsActive";
        public const string ImageUrl = "ImageUrl";
        public const string VideoUrl = "VideoUrl";
        public const string IsInstallable = "IsInstallable";
        public const string InstallationFee = "InstallationFee";
    }

    private static string NormalizeText(string? s) => string.IsNullOrWhiteSpace(s) ? string.Empty : s.Trim();

    private static decimal ParseDecimalLoose(string? raw)
    {
        var s = NormalizeText(raw);
        if (string.IsNullOrWhiteSpace(s)) return 0m;

        s = s.Replace(" ", string.Empty);
        if (s.Contains(',') && s.Contains('.'))
        {
            s = s.Replace(".", string.Empty).Replace(',', '.');
        }
        else
        {
            s = s.Replace(',', '.');
        }

        return decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var n) ? n : 0m;
    }

    private static int ParseIntLoose(string? raw)
    {
        var s = NormalizeText(raw);
        if (string.IsNullOrWhiteSpace(s)) return 0;
        s = s.Replace(" ", string.Empty);
        if (s.Contains('.')) s = s.Replace(".", string.Empty);
        if (s.Contains(',')) s = s.Replace(",", string.Empty);
        return int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0;
    }

    private static bool ParseBoolLoose(string? raw)
    {
        var s = NormalizeText(raw).ToLowerInvariant();
        if (s == "true" || s == "1" || s == "evet" || s == "e") return true;
        if (s == "false" || s == "0" || s == "hayir" || s == "hayır" || s == "h") return false;
        return false;
    }

    private static string WarehouseColName(int code) => $"Depo_{code}";

    private static int? ParseWarehouseColCode(string colName)
    {
        if (colName.StartsWith("Depo_", StringComparison.OrdinalIgnoreCase) &&
            int.TryParse(colName.Substring(5), out var code) && code > 0)
            return code;
        return null;
    }

    private async Task<List<(int Code, string Label)>> LoadWarehousesAsync(CancellationToken ct)
    {
        var rows = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.WarehouseCode)
            .Select(x => new { x.WarehouseCode, x.Name })
            .ToListAsync(ct);

        return rows
            .Select(w => (w.WarehouseCode, $"{w.WarehouseCode}{(string.IsNullOrWhiteSpace(w.Name) ? "" : " - " + w.Name)}"))
            .ToList();
    }

    public async Task<byte[]> BuildTemplateAsync(CancellationToken cancellationToken)
    {
        var categories = await _dbContext.ProductCategories
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Name)
            .Select(x => new { x.Id, x.Name, x.ParentId })
            .ToListAsync(cancellationToken);

        var mainNames = categories
            .Where(x => !x.ParentId.HasValue)
            .Select(x => (x.Name ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        var subNames = categories
            .Where(x => x.ParentId.HasValue)
            .Select(x => (x.Name ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        var unitValues = await _dbContext.Products
            .AsNoTracking()
            .Select(x => x.Unit)
            .Where(x => x != null)
            .Select(x => x!.Trim())
            .Where(x => x.Length > 0)
            .Distinct()
            .OrderBy(x => x)
            .Take(50)
            .ToListAsync(cancellationToken);

        var warehouses = await LoadWarehousesAsync(cancellationToken);

        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Products");
        var lists = wb.AddWorksheet("Lists");

        var headers = new List<string>
        {
            Cols.StockCode,
            Cols.Name,
            Cols.Description,
            Cols.Barcode,
            Cols.GroupCode,
            Cols.SubGroupCode,
            Cols.Unit,
            Cols.TaxRate,
            Cols.DiscountRate,
            Cols.SupplierId,
            Cols.BoxQuantity,
            Cols.PurchasePrice,
            Cols.BsyVisibleFlag,
            Cols.ContainerQuantity,
            Cols.Freight,
            Cols.CurrencyCode,
            Cols.IsOfficial,
            Cols.MinStock,
            Cols.IsActive,
            Cols.ImageUrl,
            Cols.VideoUrl,
            Cols.IsInstallable,
            Cols.InstallationFee
        };

        foreach (var (code, _) in warehouses)
            headers.Add(WarehouseColName(code));

        var warehouseLabelByColName = warehouses.ToDictionary(
            w => WarehouseColName(w.Code),
            w => w.Label,
            StringComparer.OrdinalIgnoreCase);

        var headerIndex = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < headers.Count; i++)
        {
            headerIndex[headers[i]] = i + 1;
        }

        for (var i = 0; i < headers.Count; i++)
        {
            var cell = ws.Cell(1, i + 1);
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#F3F4F6");
            if (warehouseLabelByColName.TryGetValue(headers[i], out var whLabel))
            {
                cell.Value = whLabel;
                cell.GetComment().AddText(headers[i]);
            }
            else
            {
                cell.Value = headers[i];
            }
        }

        int listCol = 1;

        void WriteList(string name, List<string> values)
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

        WriteList("MainCategories", mainNames);
        WriteList("SubCategories", subNames);
        WriteList("UnitValues", unitValues);
        WriteList("TaxRates", new List<string> { "0", "1", "8", "10", "18", "20" });
        WriteList("BoolValues", new List<string> { "TRUE", "FALSE" });
        WriteList("BsyVisibleFlags", new List<string> { "E", "H" });
        WriteList("CurrencyCodes", new List<string> { "1", "2", "3" });

        lists.Hide();

        const int maxRows = 500;
        var fromRow = 2;
        var toRow = maxRows;

        void ApplyListValidation(string colName, string namedRange)
        {
            if (!headerIndex.TryGetValue(colName, out var col)) return;
            var rng = ws.Range(fromRow, col, toRow, col);
            rng.CreateDataValidation().List(namedRange, true);
        }

        ApplyListValidation(Cols.GroupCode, "MainCategories");
        ApplyListValidation(Cols.SubGroupCode, "SubCategories");
        ApplyListValidation(Cols.Unit, "UnitValues");
        ApplyListValidation(Cols.TaxRate, "TaxRates");
        ApplyListValidation(Cols.BsyVisibleFlag, "BsyVisibleFlags");
        ApplyListValidation(Cols.CurrencyCode, "CurrencyCodes");
        ApplyListValidation(Cols.IsActive, "BoolValues");
        ApplyListValidation(Cols.IsOfficial, "BoolValues");
        ApplyListValidation(Cols.IsInstallable, "BoolValues");

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    public async Task<byte[]> BuildExportAsync(CancellationToken cancellationToken)
    {
        var items = await _dbContext.Products
            .AsNoTracking()
            .OrderBy(x => x.StockCode)
            .Select(x => new
            {
                x.StockCode,
                x.Name,
                x.Description,
                x.Barcode,
                x.MainCategoryId,
                x.CategoryId,
                x.Unit,
                x.TaxRate,
                x.DiscountRate,
                x.SupplierId,
                x.BoxQuantity,
                x.PurchasePrice,
                x.BsyVisibleFlag,
                x.ContainerQuantity,
                x.Freight,
                x.CurrencyCode,
                x.IsOfficial,
                x.Stock,
                x.MinStock,
                x.IsActive,
                x.ImageUrl,
                x.VideoUrl,
                x.IsInstallable,
                x.InstallationFee
            })
            .ToListAsync(cancellationToken);

        var warehouses = await LoadWarehousesAsync(cancellationToken);
        var warehouseCodes = warehouses.Select(w => w.Code).ToList();

        var balanceByStockAndWarehouse = new Dictionary<string, Dictionary<int, decimal>>(StringComparer.OrdinalIgnoreCase);
        if (warehouseCodes.Count > 0)
        {
            var stockBalances = await _dbContext.Set<StockMovement>()
                .AsNoTracking()
                .Where(x => warehouseCodes.Contains(x.WarehouseCode))
                .GroupBy(x => new { x.WarehouseCode, x.StockCode })
                .Select(g => new
                {
                    g.Key.WarehouseCode,
                    g.Key.StockCode,
                    Balance = g.Sum(x => x.Direction == StockMovementDirection.In ? x.Quantity : -x.Quantity)
                })
                .ToListAsync(cancellationToken);

            foreach (var b in stockBalances)
            {
                var sc = b.StockCode ?? string.Empty;
                if (!balanceByStockAndWarehouse.TryGetValue(sc, out var wDict))
                {
                    wDict = new Dictionary<int, decimal>();
                    balanceByStockAndWarehouse[sc] = wDict;
                }
                wDict[b.WarehouseCode] = b.Balance;
            }
        }

        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Products");

        var headers = new List<string>
        {
            Cols.StockCode,
            Cols.Name,
            Cols.Description,
            Cols.Barcode,
            Cols.GroupCode,
            Cols.SubGroupCode,
            Cols.Unit,
            Cols.TaxRate,
            Cols.DiscountRate,
            Cols.SupplierId,
            Cols.BoxQuantity,
            Cols.PurchasePrice,
            Cols.BsyVisibleFlag,
            Cols.ContainerQuantity,
            Cols.Freight,
            Cols.CurrencyCode,
            Cols.IsOfficial,
            Cols.MinStock,
            Cols.IsActive,
            Cols.ImageUrl,
            Cols.VideoUrl,
            Cols.IsInstallable,
            Cols.InstallationFee
        };

        foreach (var (code, label) in warehouses)
            headers.Add(WarehouseColName(code));

        for (var i = 0; i < headers.Count; i++)
        {
            ws.Cell(1, i + 1).Value = headers[i];
            ws.Cell(1, i + 1).Style.Font.Bold = true;
            ws.Cell(1, i + 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#F3F4F6");
        }

        var categories = await _dbContext.ProductCategories.AsNoTracking().ToListAsync(cancellationToken);
        var catNameMap = categories.ToDictionary(c => c.Id, c => c.Name);

        for (var r = 0; r < items.Count; r++)
        {
            var it = items[r];
            var row = r + 2;
            var gName = it.MainCategoryId.HasValue && catNameMap.TryGetValue(it.MainCategoryId.Value, out var m) ? m : "";
            var sName = it.CategoryId.HasValue && catNameMap.TryGetValue(it.CategoryId.Value, out var s) ? s : "";
            ws.Cell(row, 1).Value = it.StockCode;
            ws.Cell(row, 2).Value = it.Name;
            ws.Cell(row, 3).Value = it.Description;
            ws.Cell(row, 4).Value = it.Barcode;
            ws.Cell(row, 5).Value = gName;
            ws.Cell(row, 6).Value = sName;
            ws.Cell(row, 7).Value = it.Unit;
            ws.Cell(row, 8).Value = it.TaxRate;
            ws.Cell(row, 9).Value = it.DiscountRate;
            ws.Cell(row, 10).Value = it.SupplierId;
            ws.Cell(row, 11).Value = it.BoxQuantity;
            ws.Cell(row, 12).Value = it.PurchasePrice;
            ws.Cell(row, 13).Value = it.BsyVisibleFlag;
            ws.Cell(row, 14).Value = it.ContainerQuantity;
            ws.Cell(row, 15).Value = it.Freight;
            ws.Cell(row, 16).Value = it.CurrencyCode;
            ws.Cell(row, 17).Value = it.IsOfficial;
            ws.Cell(row, 18).Value = it.MinStock;
            ws.Cell(row, 19).Value = it.IsActive;
            ws.Cell(row, 20).Value = it.ImageUrl;
            ws.Cell(row, 21).Value = it.VideoUrl;
            ws.Cell(row, 22).Value = it.IsInstallable;
            ws.Cell(row, 23).Value = it.InstallationFee;

            var sc = it.StockCode ?? string.Empty;
            balanceByStockAndWarehouse.TryGetValue(sc, out var whBalances);
            for (var wi = 0; wi < warehouses.Count; wi++)
            {
                var col = 24 + wi;
                var qty = whBalances != null && whBalances.TryGetValue(warehouses[wi].Code, out var q) ? q : 0;
                ws.Cell(row, col).Value = qty;
            }
        }

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    public async Task<ProductExcelImportResult> ImportAsync(IFormFile file, CancellationToken cancellationToken)
    {
        var result = new ProductExcelImportResult();
        if (file == null || file.Length == 0)
        {
            result.RowErrors.Add(new ProductExcelImportRowError { RowNumber = 0, Errors = new List<string> { "Dosya boş" } });
            return result;
        }

        using var stream = file.OpenReadStream();
        using var wb = new XLWorkbook(stream);
        var ws = wb.Worksheets.FirstOrDefault() ?? wb.Worksheet("Products");

        var headerRow = ws.Row(1);
        var headerMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var cell in headerRow.CellsUsed())
        {
            var name = NormalizeText(cell.GetString());
            if (!string.IsNullOrWhiteSpace(name) && !headerMap.ContainsKey(name))
            {
                headerMap[name] = cell.Address.ColumnNumber;
            }
            // Warehouse columns: visible cell shows human label (e.g. "1 - Merkez"),
            // internal key (e.g. "Depo_1") is stored as a comment — map it too.
            if (cell.HasComment)
            {
                var commentKey = NormalizeText(cell.GetComment().Text);
                if (!string.IsNullOrWhiteSpace(commentKey) && ParseWarehouseColCode(commentKey).HasValue
                    && !headerMap.ContainsKey(commentKey))
                {
                    headerMap[commentKey] = cell.Address.ColumnNumber;
                }
            }
        }

        int Col(string colName) => headerMap.TryGetValue(colName, out var c) ? c : -1;

        /*
          BİLİMSEL GÖSTERİM BARKODU BOZMAZ (denetim md. 19).

          Uzun barkod/stok kodu (ör. 8690000000001) sayı olarak biçimlenmiş bir hücrede
          duruyorsa `GetString()` bunu "8.69E+12" diye döndürebiliyor ve kod bozuk kaydediliyor.
          Guard DAR tutuldu: yalnız üretilen metin bilimsel gösterime benziyorsa (içinde E/e ve
          işaret var) hücrenin SAYISAL değerinden yeniden kuruluyor. Diğer bütün hücrelerde
          davranış birebir aynı — ondalıklı alanlar etkilenmez.
        */
        string Cell(IXLRow r, int colIdx)
        {
            if (colIdx <= 0) return string.Empty;

            var cell = r.Cell(colIdx);
            var text = NormalizeText(cell.GetString());

            var looksScientific = text.Length > 0
                                  && (text.Contains('E') || text.Contains('e'))
                                  && (text.Contains('+') || text.Contains('-'));

            if (looksScientific && cell.DataType == XLDataType.Number)
            {
                try
                {
                    var numeric = cell.GetDouble();
                    if (Math.Abs(numeric % 1) < 0.0000001)
                    {
                        return ((long)Math.Round(numeric)).ToString(System.Globalization.CultureInfo.InvariantCulture);
                    }

                    return numeric.ToString("0.##########", System.Globalization.CultureInfo.InvariantCulture);
                }
                catch
                {
                    // Sayıya çevrilemiyorsa metin hâliyle devam.
                }
            }

            return text;
        }

        var stockCodeCol = Col(Cols.StockCode);
        var nameCol = Col(Cols.Name);
        if (stockCodeCol <= 0 || nameCol <= 0)
        {
            result.RowErrors.Add(new ProductExcelImportRowError { RowNumber = 1, Errors = new List<string> { "StockCode ve Name kolonları zorunlu" } });
            return result;
        }

        var categories = await _dbContext.ProductCategories.AsNoTracking().ToListAsync(cancellationToken);

        var lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;
        for (var r = 2; r <= lastRow; r++)
        {
            var row = ws.Row(r);
            var stockCode = Cell(row, stockCodeCol);
            var name = Cell(row, nameCol);

            if (string.IsNullOrWhiteSpace(stockCode) && string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            var errors = new List<string>();

            var groupCode = Cell(row, Col(Cols.GroupCode));
            var subGroupCode = Cell(row, Col(Cols.SubGroupCode));
            var unit = Cell(row, Col(Cols.Unit));

            if (string.IsNullOrWhiteSpace(stockCode)) errors.Add("StockCode zorunludur");
            if (string.IsNullOrWhiteSpace(name)) errors.Add("Name zorunludur");
            if (string.IsNullOrWhiteSpace(groupCode)) errors.Add("GroupCode zorunludur");
            if (string.IsNullOrWhiteSpace(subGroupCode)) errors.Add("SubGroupCode zorunludur");
            if (string.IsNullOrWhiteSpace(unit)) errors.Add("Unit zorunludur");

            var taxRate = ParseIntLoose(Cell(row, Col(Cols.TaxRate)));
            if (taxRate < 0 || taxRate > 100) errors.Add("TaxRate 0-100 aralığında olmalıdır");

            var discountRate = ParseDecimalLoose(Cell(row, Col(Cols.DiscountRate)));
            if (discountRate < 0 || discountRate > 100) errors.Add("DiscountRate 0-100 aralığında olmalıdır");

            var supplierIdRaw = Cell(row, Col(Cols.SupplierId));
            int? supplierId = null;
            if (!string.IsNullOrWhiteSpace(supplierIdRaw))
            {
                var tmp = ParseIntLoose(supplierIdRaw);
                supplierId = tmp > 0 ? tmp : null;
            }

            var boxQty = ParseIntLoose(Cell(row, Col(Cols.BoxQuantity)));
            var purchasePrice = ParseDecimalLoose(Cell(row, Col(Cols.PurchasePrice)));
            var bsyVisibleFlag = Cell(row, Col(Cols.BsyVisibleFlag));
            if (string.IsNullOrWhiteSpace(bsyVisibleFlag)) bsyVisibleFlag = "E";
            if (bsyVisibleFlag != "E" && bsyVisibleFlag != "H") errors.Add("BsyVisibleFlag E veya H olmalıdır");

            var containerQty = ParseIntLoose(Cell(row, Col(Cols.ContainerQuantity)));
            var freight = ParseDecimalLoose(Cell(row, Col(Cols.Freight)));
            var currencyCode = ParseIntLoose(Cell(row, Col(Cols.CurrencyCode)));
            var isOfficial = ParseBoolLoose(Cell(row, Col(Cols.IsOfficial)));
            var minStock = ParseIntLoose(Cell(row, Col(Cols.MinStock)));
            var isActive = ParseBoolLoose(Cell(row, Col(Cols.IsActive)));
            // Pasif ürün her koşulda satışa kapalıdır (kullanıcı kuralı, 2026-08-12). Excel'de iki
            // kolon yan yana durduğu için "IsActive=Hayır + BsyVisibleFlag=E" satırı yazmak çok
            // kolay; hata vermek yerine sessizce kurala çekiyoruz, ürün kartı ucu da böyle yapıyor.
            if (!isActive) bsyVisibleFlag = "H";

            var description = Cell(row, Col(Cols.Description));
            var barcode = Cell(row, Col(Cols.Barcode));
            var imageUrl = Cell(row, Col(Cols.ImageUrl));
            var videoUrl = Cell(row, Col(Cols.VideoUrl));
            var isInstallable = ParseBoolLoose(Cell(row, Col(Cols.IsInstallable)));

            var installationFeeRaw = Cell(row, Col(Cols.InstallationFee));
            decimal? installationFee = null;
            if (!string.IsNullOrWhiteSpace(installationFeeRaw))
            {
                var fee = ParseDecimalLoose(installationFeeRaw);
                installationFee = fee >= 0 ? fee : null;
                if (fee < 0) errors.Add("InstallationFee negatif olamaz");
            }

            if (errors.Count > 0)
            {
                result.RowErrors.Add(new ProductExcelImportRowError { RowNumber = r, StockCode = stockCode, Errors = errors });
                continue;
            }

            var existing = await _dbContext.Products
                .FirstOrDefaultAsync(x => x.StockCode == stockCode, cancellationToken);

            var isNew = existing is null;
            if (isNew)
            {
                existing = new Product
                {
                    StockCode = stockCode,
                    Name = name,
                    Unit = unit,
                    CreatedAt = DateTimeOffset.UtcNow,
                };
                _dbContext.Products.Add(existing);
            }

            existing.Name = name;
            existing.Description = string.IsNullOrWhiteSpace(description) ? null : description;
            existing.Barcode = string.IsNullOrWhiteSpace(barcode) ? null : barcode;
            var mainCat = categories.FirstOrDefault(c => c.ParentId == null && (string.Equals(c.Name, groupCode, StringComparison.OrdinalIgnoreCase) || string.Equals(c.Key, groupCode, StringComparison.OrdinalIgnoreCase)));
            var subCat = categories.FirstOrDefault(c => c.ParentId != null && (string.Equals(c.Name, subGroupCode, StringComparison.OrdinalIgnoreCase) || string.Equals(c.Key, subGroupCode, StringComparison.OrdinalIgnoreCase)));
            existing.MainCategoryId = mainCat?.Id;
            existing.CategoryId = subCat?.Id;
            existing.Unit = unit;
            existing.TaxRate = taxRate;
            existing.DiscountRate = discountRate;
            existing.SupplierId = supplierId;
            existing.BoxQuantity = boxQty;
            existing.PurchasePrice = purchasePrice;
            existing.BsyVisibleFlag = bsyVisibleFlag;
            existing.ContainerQuantity = containerQty;
            existing.Freight = freight;
            existing.CurrencyCode = currencyCode;
            existing.IsOfficial = isOfficial;
            existing.MinStock = minStock;
            existing.IsActive = isActive;
            existing.ImageUrl = string.IsNullOrWhiteSpace(imageUrl) ? null : imageUrl;
            existing.VideoUrl = string.IsNullOrWhiteSpace(videoUrl) ? null : videoUrl;
            existing.IsInstallable = isInstallable;
            existing.InstallationFee = installationFee;

            var warehouseQtys = new List<(int Code, int Qty)>();
            foreach (var kv in headerMap)
            {
                var whCode = ParseWarehouseColCode(kv.Key);
                if (!whCode.HasValue) continue;
                var qtyRaw = row.Cell(kv.Value).GetString();
                var qty = ParseIntLoose(qtyRaw);
                if (qty > 0)
                    warehouseQtys.Add((whCode.Value, qty));
            }

            if (isNew && warehouseQtys.Count > 0)
            {
                var totalFromWh = warehouseQtys.Sum(x => x.Qty);
                existing.Stock = totalFromWh;
            }

            result.SuccessCount++;
            if (isNew)
                result.WarehouseStocksToCreate.Add((stockCode, warehouseQtys));
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        if (result.WarehouseStocksToCreate.Count > 0)
        {
            var nowUtc = DateTime.UtcNow;
            var username = "import";

            var allWarehouseCodes = result.WarehouseStocksToCreate
                .SelectMany(x => x.Stocks.Select(s => s.Code))
                .Distinct()
                .ToList();

            var validWarehouseCodes = await _dbContext.Set<Warehouse>()
                .AsNoTracking()
                .Where(x => allWarehouseCodes.Contains(x.WarehouseCode) && x.IsActive)
                .Select(x => x.WarehouseCode)
                .ToListAsync(cancellationToken);

            var validSet = new HashSet<int>(validWarehouseCodes);

            foreach (var (sc, stocks) in result.WarehouseStocksToCreate)
            {
                var docNo = $"DEVIR-{sc}";
                var lineNo = 1;
                foreach (var (wCode, qty) in stocks)
                {
                    if (!validSet.Contains(wCode)) continue;
                    _dbContext.Set<StockMovement>().Add(new StockMovement
                    {
                        InvoiceNo = docNo,
                        CustomerCode = string.Empty,
                        DeliveryCustomerCode = string.Empty,
                        StockCode = sc,
                        Direction = StockMovementDirection.In,
                        Quantity = qty,
                        UnitPrice = 0m,
                        NetUnitPrice = 0m,
                        VatRate = 0m,
                        BagNo = string.Empty,
                        WarehouseCode = wCode,
                        Delivered = true,
                        Date = nowUtc,
                        LineNo = lineNo++,
                        CreateUser = username,
                        CreateTime = nowUtc
                    });
                }
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return result;
    }
}
