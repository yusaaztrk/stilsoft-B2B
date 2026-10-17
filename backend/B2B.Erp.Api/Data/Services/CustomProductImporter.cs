using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace B2B.Erp.Api.Data.Services;

public static class CustomProductImporter
{
    private static string NormalizeText(string? s) => string.IsNullOrWhiteSpace(s) ? string.Empty : s.Trim();

    public static async Task ImportCustomStocksAsync(AppDbContext dbContext, string webRootPath, Microsoft.Extensions.Logging.ILogger logger)
    {
        string excelPath = @"C:\Users\Admin\Downloads\stoklarsonhali.xlsx";
        string imageSourceDir = @"C:\Users\Admin\Desktop\stokkartlari";

        if (!File.Exists(excelPath))
        {
            logger.LogWarning($"[CustomImport] Excel file not found at: {excelPath}");
            return;
        }

        logger.LogInformation($"[CustomImport] Starting import from: {excelPath}");

        using var workbook = new XLWorkbook(excelPath);
        var worksheet = workbook.Worksheets.FirstOrDefault();
        if (worksheet == null)
        {
            logger.LogWarning("[CustomImport] No worksheet found in Excel.");
            return;
        }

        var rows = worksheet.RowsUsed().Skip(1); // skip header row

        // Preload database lookup collections
        var suppliers = await dbContext.Set<Supplier>().ToListAsync();
        var customers = await dbContext.Customers.ToListAsync();
        var priceGroups = await dbContext.PriceGroups.ToListAsync();

        var uploadsDir = Path.Combine(webRootPath, "uploads", "products");
        Directory.CreateDirectory(uploadsDir);

        var imageFiles = Directory.Exists(imageSourceDir)
            ? Directory.GetFiles(imageSourceDir)
            : Array.Empty<string>();

        // Cache image paths by name (case-insensitive, without extension)
        var imagePathByName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in imageFiles)
        {
            var name = Path.GetFileNameWithoutExtension(file);
            if (!string.IsNullOrEmpty(name))
            {
                imagePathByName[name] = file;
            }
        }

        int successCount = 0;
        int updateCount = 0;

        foreach (var row in rows)
        {
            var stockCode = NormalizeText(row.Cell(1).GetString());
            var name = NormalizeText(row.Cell(2).GetString());
            var categoryName = NormalizeText(row.Cell(3).GetString());
            var subCategoryName = NormalizeText(row.Cell(4).GetString());
            var supplierCode = NormalizeText(row.Cell(5).GetString());
            var boxQtyRaw = NormalizeText(row.Cell(6).GetString());
            var taxRateRaw = NormalizeText(row.Cell(7).GetString());
            var purchasePriceRaw = NormalizeText(row.Cell(8).GetString());
            var barcode = NormalizeText(row.Cell(9).GetString());
            var statusRaw = NormalizeText(row.Cell(10).GetString());
            var discountRateRaw = NormalizeText(row.Cell(11).GetString());
            var containerQtyRaw = NormalizeText(row.Cell(12).GetString());
            var freightRaw = NormalizeText(row.Cell(13).GetString());
            var currencyRaw = NormalizeText(row.Cell(14).GetString());

            if (string.IsNullOrEmpty(stockCode) || string.IsNullOrEmpty(name))
            {
                continue;
            }

            // 1. Resolve Supplier ID
            int? supplierId = null;
            if (!string.IsNullOrEmpty(supplierCode))
            {
                var supp = suppliers.FirstOrDefault(x => string.Equals(x.SupplierCode, supplierCode, StringComparison.OrdinalIgnoreCase));
                if (supp == null)
                {
                    // Check if customer exists to register as shadow supplier
                    var cust = customers.FirstOrDefault(x => string.Equals(x.CustomerCode, supplierCode, StringComparison.OrdinalIgnoreCase));
                    string fullName = cust != null ? cust.Name : $"Tedarikçi {supplierCode}";
                    
                    var newSupp = new Supplier
                    {
                        SupplierCode = supplierCode,
                        FullName = fullName
                    };
                    dbContext.Set<Supplier>().Add(newSupp);
                    await dbContext.SaveChangesAsync();
                    
                    suppliers.Add(newSupp);
                    supplierId = newSupp.Id;
                }
                else
                {
                    supplierId = supp.Id;
                }
            }

            // 2. Parse numbers
            int boxQty = int.TryParse(boxQtyRaw, out var bq) ? bq : 0;
            int taxRate = int.TryParse(taxRateRaw, out var tr) ? tr : 0;
            decimal purchasePrice = decimal.TryParse(purchasePriceRaw, out var pp) ? pp : 0m;
            decimal discountRate = decimal.TryParse(discountRateRaw, out var dr) ? dr : 0m;
            int containerQty = int.TryParse(containerQtyRaw, out var cq) ? cq : 0;
            decimal freight = decimal.TryParse(freightRaw, out var fr) ? fr : 0m;

            // 3. Para birimi: 1=TRY 2=EUR 3=USD 4=GBP (tek kodlama, 2026-08-14)
            //
            // STERLİN EKLENDİ: burada yalnızca dolar ve euro tanınıyordu, sterlin sessizce
            // son dala (TL) düşüyordu — Excel'de "STERLİN" yazan ürün liraya çevrilip içeri
            // alınıyor ve hangi para biriminde olduğu tamamen kayboluyordu. Aynı DOSYADAKİ
            // banka hesabı içe aktarımı sterlini zaten tanıyordu; kardeş yol atlanmış.
            //
            // Karşılaştırma da `Contains`e çevrildi: Excel'de "USD ($)", "EURO " gibi
            // varyasyonlar tam eşitlikte eleniyordu.
            var currencyUpper = (currencyRaw ?? string.Empty).Trim().ToUpperInvariant();
            int currencyCode = 0;
            string currencyStr = "TL";
            if (currencyUpper.Contains("DOLAR") || currencyUpper.Contains("USD"))
            {
                currencyCode = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Usd;
                currencyStr = "USD";
            }
            else if (currencyUpper.Contains("EURO") || currencyUpper.Contains("EUR"))
            {
                currencyCode = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Eur;
                currencyStr = "EUR";
            }
            else if (currencyUpper.Contains("STERLİN") || currencyUpper.Contains("STERLIN") || currencyUpper.Contains("GBP"))
            {
                currencyCode = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Gbp;
                currencyStr = "GBP";
            }

            // 4. Resolve Active and Visibility status (E vs H)
            bool isActive = true;
            string bsyVisibleFlag = "E";
            if (string.Equals(statusRaw, "H", StringComparison.OrdinalIgnoreCase))
            {
                isActive = false;
                bsyVisibleFlag = "H";
            }

            // 5. Image search and processing
            string? savedImageUrl = null;
            if (imagePathByName.TryGetValue(stockCode, out var sourceImagePath))
            {
                try
                {
                    var safeName = $"{Guid.NewGuid():N}.webp";
                    var destPath = Path.Combine(uploadsDir, safeName);

                    using (var image = await Image.LoadAsync(sourceImagePath))
                    using (var fs = File.Create(destPath))
                    {
                        await image.SaveAsync(fs, new WebpEncoder());
                    }

                    savedImageUrl = $"/uploads/products/{safeName}";
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, $"[CustomImport] Image conversion failed for product {stockCode} from path {sourceImagePath}");
                }
            }

            // 6. Save product to database
            var product = await dbContext.Products
                .Include(p => p.ProductPrices)
                .FirstOrDefaultAsync(x => x.StockCode == stockCode);
            bool isNew = product == null;

            if (isNew)
            {
                product = new Product
                {
                    StockCode = stockCode,
                    CreatedAt = DateTimeOffset.UtcNow,
                    Unit = "ADET"
                };
                dbContext.Products.Add(product);
            }

            product.Name = name;
            var categories = dbContext.ProductCategories.AsNoTracking().ToList();
            var mainCat = categories.FirstOrDefault(c => c.ParentId == null && (string.Equals(c.Name, categoryName, StringComparison.OrdinalIgnoreCase) || string.Equals(c.Key, categoryName, StringComparison.OrdinalIgnoreCase)));
            var subCat = categories.FirstOrDefault(c => c.ParentId != null && (string.Equals(c.Name, subCategoryName, StringComparison.OrdinalIgnoreCase) || string.Equals(c.Key, subCategoryName, StringComparison.OrdinalIgnoreCase)));
            product.MainCategoryId = mainCat?.Id;
            product.CategoryId = subCat?.Id;
            product.SupplierId = supplierId;
            product.BoxQuantity = boxQty;
            product.TaxRate = taxRate;
            product.PurchasePrice = purchasePrice;
            product.Barcode = string.IsNullOrEmpty(barcode) ? null : barcode;
            product.IsActive = isActive;
            // Pasif ürün her koşulda satışa kapalıdır (kullanıcı kuralı, 2026-08-12).
            product.BsyVisibleFlag = isActive ? bsyVisibleFlag : "H";
            product.DiscountRate = discountRate;
            product.ContainerQuantity = containerQty;
            product.Freight = freight;
            product.CurrencyCode = currencyCode;
            product.Stock = 0; // Quantity is 0 in all warehouses
            product.MinStock = 0;
            product.IsOfficial = false;

            if (savedImageUrl != null)
            {
                product.ImageUrl = savedImageUrl;
                product.ImageUrlsJson = $"[\"{savedImageUrl}\"]";
            }

            await dbContext.SaveChangesAsync();

            // 7. Ensure default product prices are seeded (one for each active PriceGroup)
            foreach (var pg in priceGroups)
            {
                var existingPrice = product.ProductPrices.FirstOrDefault(x => x.PriceGroupId == pg.Id);
                if (existingPrice == null)
                {
                    dbContext.Set<ProductPrice>().Add(new ProductPrice
                    {
                        Id = Guid.NewGuid(),
                        ProductId = product.Id,
                        PriceGroupId = pg.Id,
                        Price = 0m, // default selling price is 0
                        Currency = currencyStr
                    });
                }
                else
                {
                    existingPrice.Currency = currencyStr;
                }
            }

            if (isNew) successCount++;
            else updateCount++;
        }

        await dbContext.SaveChangesAsync();
        logger.LogInformation($"[CustomImport] Completed! Created: {successCount}, Updated: {updateCount}");
    }

    public static async Task SetStock50ForActiveProductsAsync(AppDbContext dbContext, Microsoft.Extensions.Logging.ILogger logger)
    {
        logger.LogInformation("[CustomImport] Starting SetStock50ForActiveProductsAsync...");

        var warehouses = await dbContext.Set<Warehouse>().Where(x => x.IsActive).ToListAsync();
        if (warehouses.Count == 0)
        {
            logger.LogWarning("[CustomImport] No active warehouses found!");
            return;
        }

        var activeProducts = await dbContext.Products.Where(p => p.IsActive).ToListAsync();
        logger.LogInformation($"[CustomImport] Found {activeProducts.Count} active products to update.");

        var nowUtc = DateTime.UtcNow;
        var username = "import";

        foreach (var product in activeProducts)
        {
            // 1. Remove existing stock movements for this product to prevent duplicate/incorrect balances
            var existingMovements = await dbContext.Set<StockMovement>()
                .Where(x => x.StockCode == product.StockCode)
                .ToListAsync();
            
            if (existingMovements.Count > 0)
            {
                dbContext.Set<StockMovement>().RemoveRange(existingMovements);
            }

            // 2. Add 50 stock for each warehouse
            var docNo = $"DEVIR-{product.StockCode}";
            var lineNo = 1;
            foreach (var wh in warehouses)
            {
                dbContext.Set<StockMovement>().Add(new StockMovement
                {
                    InvoiceNo = docNo,
                    CustomerCode = string.Empty,
                    DeliveryCustomerCode = string.Empty,
                    StockCode = product.StockCode,
                    Direction = StockMovementDirection.In,
                    Quantity = 50m,
                    UnitPrice = 0m,
                    NetUnitPrice = 0m,
                    VatRate = 0m,
                    BagNo = string.Empty,
                    WarehouseCode = wh.WarehouseCode,
                    Delivered = true,
                    Date = nowUtc,
                    LineNo = lineNo++,
                    CreateUser = username,
                    CreateTime = nowUtc
                });
            }

            // 3. Update main stock count
            product.Stock = 50 * warehouses.Count;
        }

        await dbContext.SaveChangesAsync();
        logger.LogInformation($"[CustomImport] Successfully set stock to 50 for each warehouse for {activeProducts.Count} products!");
    }

    private static readonly string RawPriceListData = @"
SEG70301	6.900,00
SEG54040	3.900,00
SEG70100	11.600,00
SEG70151	9.200,00
SEG70351	4.200,00
SEG70101	11.200,00
SEG70150	9.600,00
SEG54005	5.600,00
SEG70361	9.200,00
SEG70111	13.500,00
SEG70110	14.500,00
SEG70491	8.500,00
SEG70421	12.500,00
SEG70161	8.200,00
SEG70160	7.900,00
SEG54010	4.200,00
SEG70400	8.200,00
SEG70300	7.200,00
SEG70472	6.400,00
SBE70511	13.000,00
SEG70440	7.200,00
SEG70165	8.400,00
SEG70166	8.800,00
SEG70471	6.600,00
SEG70430	6.200,00
SEG70401	7.500,00
SEG70490	9.000,00
ST-ST00515	600,00
SEG70450	5.500,00
SEG70350	4.000,00
SEG70380	24.000,00
SEG70480	7.800,00
SEG70460	7.200,00
SEG70461	4.200,00
SBE70510	13.800,00
SEG70360	8.800,00
SBE70120	16.500,00
SBE70121	16.000,00
SEG70470	6.200,00
SEG70420	11.800,00
SBE70402	6.700,00
ST-ST00375	600,00
SBE90950	9.200,00
SEG70481	7.400,00
ST-ST00491	600,00
SBE90951	8.900,00
SBE90801	17.500,00
SBE90802	18.800,00
SBE90810	24.000,00
SBE90310	9.600,00
SBE90446	27.500,00
SBE90452	30.000,00
SBE90443	23.900,00
SBE90447	29.300,00
SBE90440	18.500,00
SBE90555	33.000,00
SBE90558	26.500,00
SBE90411	15.500,00
SBE90465	33.600,00
SBE90466	32.000,00
SBE90573	39.000,00
SBE90550	19.600,00
SBE90575	56.000,00
SBE90556	24.900,00
SBE90671	24.200,00
SBE90645	14.900,00
SBE90670	22.600,00
SBE90646	14.900,00
SBE90755	26.200,00
SBE90001	26.000,00
SBE90100	15.200,00
SBE90004	22.500,00
SBE90156	28.400,00
SBE90070	10.600,00
SBE90154	15.600,00
SBE90000	26.000,00
SBE90155	15.600,00
SBE90104	15.200,00
ST00512	400,00
STV70711	18.000,00
STV70731	14.500,00
STV70681	15.000,00
STV70721	12.700,00
ST00515	600,00
STV70713	35.000,00
STV70712	24.600,00
STV70710	12.700,00
STV70723	24.600,00
ST00511	350,00
STV70720	7.800,00
STV70714	7.800,00
ST0634601	600,00
STV70724	35.000,00
STV70734	39.000,00
STV70732	20.500,00
STV70650	7.800,00
ST00514	1.600,00
STV70722	18.000,00
ST06346	600,00
STV70733	28.000,00
SBE92010	0,00
SBE92000	28.000,00
SBE92002	42.000,00
SBE92012	0,00
SBE92011	0,00
SBE92001	35.000,00
SEG50220	8.000,00
SEG50221	8.200,00
SEG50210	6.300,00
SEG50235	6.400,00
SEG50230	13.400,00
SBE90903	21.600,00
SBE90910	17.000,00
SBE90901	12.000,00
SBE90911	17.000,00
SBE90900	12.000,00
SEG50051	7.800,00
SEG50015	2.800,00
SEG50010	4.500,00
SEG50052	8.800,00
SEG50013	4.500,00
SEG52040	900,00
SEG52030	700,00
SEG52032	700,00
SEG52700	2.400,00
SEG52031	700,00
SEG52701	2.400,00
SEG50050	8.800,00
SEG53031	2.800,00
SEG53030	2.800,00
SEG53036	3.200,00
SET12302	6.500,00
SET11050	5.500,00
SET12300	6.500,00
SET10020	9.000,00
SET11026	4.400,00
SET12310	7.800,00
SET13025	2.000,00
SET12385	6.500,00
SET12360	7.900,00
SET14015	13.200,00
SET12350	9.900,00
SET13023	2.000,00
SET13035	3.200,00
SET13200	3.400,00
SET12366	9.900,00
SGH20572	2.400,00
SGH20062	3.900,00
SGH20554	2.200,00
SGH20050	4.900,00
SGH20032	4.300,00
SGH22021	3.400,00
SGH20080	12.000,00
SGH20060	7.000,00
SGH22011	3.400,00
SGH23101	4.000,00
SGH22202	3.300,00
SGH22162	3.300,00
SGH22201	2.100,00
SGH25670	4.500,00
SGH21510	6.600,00
SGH21520	6.600,00
SGH22061	4.500,00
SGH25671	4.500,00
SGH23091	3.500,00
SGH23503	5.800,00
SGH22210	2.800,00
SGH27710	400,00
SGH22031	2.400,00
SGH22830	2.400,00
SGH22160	2.000,00
SGH26400	800,00
SGH23106	4.000,00
SGH24151	1.600,00
SGH23100	4.000,00
SGH23114	4.000,00
SGH22062	4.800,00
SGH25605	3.600,00
SGH22193	3.300,00
SGH23262	4.500,00
SGH23261	4.200,00
SGH22161	2.400,00
SGH22200	1.500,00
SGH23506	1.900,00
SGH23620	2.400,00
SGH22835	2.000,00
SGH22215	4.900,00
SGH24700	5.500,00
SGH26401	800,00
SGH23014	3.800,00
SGH23260	4.600,00
SGH24751	5.500,00
SGH27700	500,00
SGH24150	1.600,00
SGH25690	4.500,00
SGH24610	4.500,00
SGH24703	5.500,00
SGH25691	4.500,00
SIH30100	3.800,00
SIH30530	3.100,00
SIH30340	2.200,00
SIH30624	3.900,00
SIH30551	4.300,00
SIH31203	3.200,00
SIH30450	2.600,00
SIH31200	1.800,00
SIH30552	4.300,00
SIH30608	3.900,00
SIH31022	1.800,00
SIH30625	3.900,00
SIH31050	1.800,00
SIH31550	1.000,00
SIH31162	2.800,00
SIH31231	9.000,00
SIH30560	4.300,00
SIH30628	3.700,00
SIH31521	900,00
SIH31025	1.800,00
SIH31161	2.800,00
SIH32025	1.000,00
SIH32011	1.300,00
SIH31034	1.800,00
SIH30621	3.900,00
SIH31160	2.800,00
SIH31184	2.800,00
SIH31164	2.800,00
SIH30622	3.900,00
SIH33200	7.200,00
SIH31206	3.200,00
SIH31306	5.600,00
SIH31230	9.000,00
SIH33060	4.500,00
SIH31522	900,00
SIH31524	900,00
SIH32020	2.000,00
SKB41500	3.200,00
SKB40116	2.000,00
SKB40120	1.600,00
SKB41505	2.200,00
SKB40110	1.200,00
SKB40051	1.200,00
SKB48050	1.600,00
SKB48051	1.600,00
SKB43050	1.400,00
SKB43055	1.400,00
SKB40121	1.600,00
SKB49050	1.900,00
SKB44050	1.600,00
SKB45050	1.600,00
SUT66000	1.600,00
SUT61012	1.400,00
SUT66011	1.200,00
SUT61010	1.400,00
SUT61011	1.400,00
SUT61060	2.400,00
SUT61070	3.600,00
SUT64011	2.200,00
SUT61061	2.400,00
SUT69010	3.900,00
SUT64010	2.200,00
SUT65010	8.500,00
SUT66001	1.600,00
SUT66010	1.200,00
TEST02	0,00
TEST01	0,00
TS.ST00501	0,00
TS.ST00502	0,00
1999559278	8.500,00
1999559298	1.900,00
1999559663	2.900,00
1999559297	3.300,00
1999558254	7.100,00
1999559351	3.850,00
1999559277	3.850,00
1999559619	3.000,00
1999559352	6.500,00
1999559489	6.100,00
1999559502	4.950,00
1999559620	1.900,00
1999559279	23.700,00
1999559560	8.200,00
19000000107	18.500,00
1999559662	14.500,00
1999559276	10.900,00
1999558474	8.900,00
190000003845	5.000,00
1999559503	11.900,00
1999559654	12.300,00
19000000100	10.100,00
1999559488	18.800,00
1999558187	20.300,00
1999559299	15.400,00
YTKST007	0,00
YTKST001	0,00
YTKST005	0,00
YTKST011	0,00
YTKST004	0,00
YTKST002	0,00
YTKST013	0,00
YTKST003	0,00
YTKST006	0,00
YTKST012	0,00
YTKST014	0,00
YTKST008	0,00
1999559621	7.500,00
1999559487	14.400,00
1999559672	22.000,00
BZT0000160	0,00
1999559286	12.300,00
1999559280	5.800,00
1999559566	11.600,00
1999559291	16.000,00
1999559501	11.100,00
BZT0000090	0,00
1999559285	8.600,00
1999559281	8.700,00
1999559290	9.800,00
1999559296	19.300,00
1999559381	2.000,00
1999559380	1.100,00
ST00513	800,00
SSERVIS	800,00
";

    public static async Task ImportCustomPricesAsync(AppDbContext dbContext, Microsoft.Extensions.Logging.ILogger logger)
    {
        logger.LogInformation("[CustomImport] Starting ImportCustomPricesAsync...");

        var priceGroups = await dbContext.PriceGroups.ToListAsync();
        var products = await dbContext.Products.Include(p => p.ProductPrices).ToListAsync();

        var lines = RawPriceListData.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        int matchCount = 0;
        int skipCount = 0;

        foreach (var line in lines)
        {
            var parts = line.Split(new[] { '\t', ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) continue;

            var stockCode = parts[0].Trim();
            var price4Str = parts[1].Trim();

            var product = products.FirstOrDefault(x => string.Equals(x.StockCode, stockCode, StringComparison.OrdinalIgnoreCase));
            if (product == null)
            {
                skipCount++;
                continue;
            }

            decimal price4 = ParseTurkishPrice(price4Str);

            // BU LİSTE TL'DİR — bilerek sabit.
            //
            // Kaynak `RawPriceListData`, dosyanın içine gömülü SABİT bir fiyat listesidir
            // (SEG70301 6.900,00 · SBE90575 56.000,00 …) ve rakamlar TL piyasa fiyatlarıdır.
            // Genel bir içe aktarıcı değil, tek seferlik bir kütük.
            //
            // Bir ara burayı `product.SalesCurrencyCode`e bağlamıştım — YANLIŞTI: sistemin
            // "fiyat satırı ürünün satış dövizini izler" kuralı doğru olsa da, o kural fiyatın
            // ürünün para biriminde GİRİLDİĞİ yerler için geçerli. Buradaki sayılar TL, o yüzden
            // satış dövizi USD olan bir üründe 56.000 sayısı 56.000 $ olarak yazılırdı (~30 kat).
            //
            // Bu kütük tekrar çalıştırılacaksa ve dövizli ürünler varsa, doğru yol fiyatı o
            // günün kuruyla ürünün dövizine ÇEVİRMEKTİR; para birimi etiketini değiştirmek değil.
            string currencyStr = "TRY";

            // Evaluate and save/update prices for all 7 active Price Groups
            foreach (var pg in priceGroups)
            {
                var formula = string.IsNullOrWhiteSpace(pg.Formula) ? "F4" : pg.Formula.Trim();
                decimal calculatedPrice = 0m;
                try
                {
                    calculatedPrice = FormulaEvaluator.Evaluate(formula, price4, product.TaxRate, product.DiscountRate);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, $"[CustomImport] Formula evaluation failed for group {pg.Code} on product {product.StockCode}");
                    calculatedPrice = price4; // fallback to raw price 4
                }

                var existingPrice = product.ProductPrices.FirstOrDefault(x => x.PriceGroupId == pg.Id);
                if (existingPrice == null)
                {
                    dbContext.Set<ProductPrice>().Add(new ProductPrice
                    {
                        Id = Guid.NewGuid(),
                        ProductId = product.Id,
                        PriceGroupId = pg.Id,
                        Price = calculatedPrice,
                        Currency = currencyStr
                    });
                }
                else
                {
                    existingPrice.Price = calculatedPrice;
                    existingPrice.Currency = currencyStr;
                }
            }

            matchCount++;
        }

        await dbContext.SaveChangesAsync();
        logger.LogInformation($"[CustomImport] Completed pricing update! Matched and updated: {matchCount}, Skipped/not found: {skipCount}");
    }

    private static decimal ParseTurkishPrice(string raw)
    {
        var s = raw.Trim().Replace(" ", string.Empty);
        if (s.Contains('.') && s.Contains(','))
        {
            s = s.Replace(".", string.Empty).Replace(',', '.');
        }
        else if (s.Contains(','))
        {
            s = s.Replace(',', '.');
        }
        return decimal.TryParse(s, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var val) ? val : 0m;
    }

    public static async Task SyncAllCustomerCategoriesAsync(AppDbContext dbContext, Microsoft.Extensions.Logging.ILogger logger)
    {
        logger.LogInformation("[CustomImport] Starting SyncAllCustomerCategoriesAsync...");

        // 1. Delete permissions for inactive or deleted categories
        int deletedCount = await dbContext.Database.ExecuteSqlRawAsync(@"
            DELETE FROM ""CustomerProductCategories""
            WHERE ""ProductCategoryId"" NOT IN (
                SELECT ""Id"" FROM ""ProductCategories"" WHERE ""IsActive"" = true
            );
        ");
        logger.LogInformation($"[CustomImport] Deleted {deletedCount} obsolete category permission records.");

        // 2. Insert missing category permissions for all active categories and all customers
        int insertedCount = await dbContext.Database.ExecuteSqlRawAsync(@"
            INSERT INTO ""CustomerProductCategories"" (""CustomerCode"", ""ProductCategoryId"")
            SELECT c.""CustomerCode"", pc.""Id""
            FROM ""Customers"" c
            CROSS JOIN ""ProductCategories"" pc
            WHERE pc.""IsActive"" = true
            ON CONFLICT (""CustomerCode"", ""ProductCategoryId"") DO NOTHING;
        ");
        logger.LogInformation($"[CustomImport] Inserted {insertedCount} missing category permission records.");
    }

    public static async Task NormalizeProductGroupCodesAsync(AppDbContext dbContext, Microsoft.Extensions.Logging.ILogger logger)
    {
        await Task.CompletedTask;
    }

    private static string? NormalizeGroupCodeForStorage(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var v = value
            .Trim()
            .ToUpperInvariant()
            .Replace('İ', 'I')
            .Replace('ı', 'I')
            .Replace('Ğ', 'G')
            .Replace('ğ', 'G')
            .Replace('Ü', 'U')
            .Replace('ü', 'U')
            .Replace('Ş', 'S')
            .Replace('ş', 'S')
            .Replace('Ö', 'O')
            .Replace('ö', 'O')
            .Replace('Ç', 'C')
            .Replace('ç', 'C')
            .Replace(' ', '_');

        // collapse multiple underscores
        while (v.Contains("__", StringComparison.Ordinal))
        {
            v = v.Replace("__", "_", StringComparison.Ordinal);
        }

        return v;
    }

    /// <summary>
    /// <b>KALDIRILDI — kasıtlı olarak çalışmıyor.</b>
    ///
    /// <para>
    /// Eskiden tek bir cümleyle bütün fiyat satırlarını TL'ye eziyordu:
    /// <c>UPDATE "ProductPrices" SET "Currency" = 'TRY' WHERE "Currency" &lt;&gt; 'TRY'</c>.
    /// O gün ürünü dövizle satmanın bir yolu yoktu, dolayısıyla zararsızdı. Artık satış
    /// dövizi sistemin taşıyıcı özelliklerinden biri (<c>Product.SalesCurrencyCode</c> +
    /// <c>ProductPrices.Currency</c>): bu metot çalıştığı an <b>her dolar/euro/sterlin fiyatı
    /// geri dönüşsüz olarak TL'ye çevirirdi</b> ve hangi ürünün hangi para biriminde olduğu
    /// bilgisi tamamen kaybolurdu.
    /// </para>
    ///
    /// <para>
    /// Çağıranı yoktu; silmek yerine patlayan bir kütük bırakıldı ki ileride "toplu TL'ye
    /// çevir" gerektiğinde tekrar yazılmasın, bilinçli bir karar olsun. Gerçekten gerekiyorsa
    /// tek tek para birimi seçilerek ve yedek alınarak yapılmalı.
    /// </para>
    /// </summary>
    [Obsolete("Bütün döviz fiyatlarını geri dönüşsüz siler. Çağrılmamalı.", error: true)]
    public static Task ForceSalesCurrencyToTryAsync(AppDbContext dbContext, Microsoft.Extensions.Logging.ILogger logger)
        => throw new InvalidOperationException(
            "ForceSalesCurrencyToTryAsync devre dışı: tüm ProductPrices satırlarını TL'ye ezip " +
            "ürünlerin satış para birimini geri dönüşsüz yok ediyordu.");

    public static async Task SeedCashAccountsAsync(AppDbContext dbContext, Microsoft.Extensions.Logging.ILogger logger)
    {
        logger.LogInformation("[CustomImport] Starting SeedCashAccountsAsync...");

        var accounts = new List<(string Code, string Name, int CurrencyTypeId)>
        {
            ("01", "HASPOLAT KASA", 1),
            ("02", "MAĞAZA KASA", 1),
            ("0267", "CARDPLUS KREDİ KARTI", 1),
            ("03", "SERVİS KASA", 1),
            ("0680", "ISBANKASI KREDİ KARTI", 1),
            ("5542", "HALK KREDİ KARTI", 1),
            ("7016", "GARANTİ KREDİ KARTI", 1),
            ("8507", "ZIRAAT KREDİ KARTI", 1),
            ("9999", "SANAL POS CEKİMLERİ", 1),
            ("8002", "İKTİSAT KREDİ KARTI", 1),
            ("1567", "UNIVERSAL KREDİ KARTI", 1),
            ("666", "test dolar", 3),
            ("HSP_USD", "HASPOLAT USD KASA", 3),
            ("HSP_EURO", "HASPOLAT EURO KASA", 2),
            ("HSP_GBP", "HASPOLAT GBP KASA", 4),
            ("MGZ_USD", "MAĞAZA USD KASA", 3),
            ("MGZ_EURO", "MAĞAZA EURO KASA", 2),
            ("MGZ_GBP", "MAĞAZA GBP KASA", 4),
            ("04", "MUHASEBE KASA", 1),
            ("MHS_USD", "MUHASEBE USD KASA", 3),
            ("MHS_EURO", "MUHASEBE EURO KASA", 2),
            ("MHS_GBP", "MUHASEBE GBP KASA", 4),
            ("63658", "ASBANK KREDİ KARTI", 1),
            ("63254", "NEAR EAST BANK KREDİ KARTI", 1)
        };

        var dbSet = dbContext.Set<CashAccount>();
        int added = 0;
        int updated = 0;

        foreach (var acc in accounts)
        {
            var existing = await dbSet.FirstOrDefaultAsync(x => x.Code == acc.Code);
            if (existing == null)
            {
                dbSet.Add(new CashAccount
                {
                    Code = acc.Code,
                    Name = acc.Name,
                    CurrencyTypeId = acc.CurrencyTypeId,
                    LastCarryDate = DateTime.UtcNow,
                    LastCarryAmount = 0,
                    CreateUser = "System",
                    CreateTime = DateTime.UtcNow
                });
                added++;
            }
            else
            {
                if (existing.Name != acc.Name || existing.CurrencyTypeId != acc.CurrencyTypeId)
                {
                    existing.Name = acc.Name;
                    existing.CurrencyTypeId = acc.CurrencyTypeId;
                    existing.EditUser = "System";
                    existing.EditTime = DateTime.UtcNow;
                    updated++;
                }
            }
        }

        if (added > 0 || updated > 0)
        {
            await dbContext.SaveChangesAsync();
        }

        logger.LogInformation($"[CustomImport] Successfully seeded cash accounts: added {added}, updated {updated}.");
    }

    public static async Task DeleteTargetBankAccountAsync(AppDbContext dbContext, Microsoft.Extensions.Logging.ILogger logger, string tenantDbName)
    {
        logger.LogInformation("[CustomDelete] Starting DeleteTargetBankAccountAsync...");

        var targetAccount = await dbContext.BankAccountDefinitions.FirstOrDefaultAsync(x => x.AccountCode == "95555");
        if (targetAccount != null)
        {
            // Set FKs to NULL in other tables safely
            try
            {
                await dbContext.Database.ExecuteSqlRawAsync(
                    @"UPDATE ""PayableNotes"" SET ""BankAccountDefinitionId"" = NULL WHERE ""BankAccountDefinitionId"" = " + targetAccount.Id);
            }
            catch (Exception ex) { logger.LogWarning($"[CustomDelete] Failed updating PayableNotes: {ex.Message}"); }
            
            try
            {
                await dbContext.Database.ExecuteSqlRawAsync(
                    @"UPDATE ""PayableChecks"" SET ""BankAccountDefinitionId"" = NULL WHERE ""BankAccountDefinitionId"" = " + targetAccount.Id);
            }
            catch (Exception ex) { logger.LogWarning($"[CustomDelete] Failed updating PayableChecks BankAccountDefinitionId: {ex.Message}"); }
            
            try
            {
                await dbContext.Database.ExecuteSqlRawAsync(
                    @"UPDATE ""PayableChecks"" SET ""CurrentBankAccountDefinitionId"" = NULL WHERE ""CurrentBankAccountDefinitionId"" = " + targetAccount.Id);
            }
            catch (Exception ex) { logger.LogWarning($"[CustomDelete] Failed updating PayableChecks CurrentBankAccountDefinitionId: {ex.Message}"); }

            try
            {
                await dbContext.Database.ExecuteSqlRawAsync(
                    @"UPDATE ""EmployeeBonusPlans"" SET ""BankAccountDefinitionId"" = NULL WHERE ""BankAccountDefinitionId"" = " + targetAccount.Id);
            }
            catch (Exception ex) { logger.LogWarning($"[CustomDelete] Failed updating EmployeeBonusPlans: {ex.Message}"); }

            try
            {
                await dbContext.Database.ExecuteSqlRawAsync(
                    @"UPDATE ""CheckOperations"" SET ""BankAccountDefinitionId"" = NULL WHERE ""BankAccountDefinitionId"" = " + targetAccount.Id);
            }
            catch (Exception ex) { logger.LogWarning($"[CustomDelete] Failed updating CheckOperations: {ex.Message}"); }

            // Delete transactions
            try
            {
                var txs = await dbContext.BankAccountTransactions.Where(x => x.BankAccountDefinitionId == targetAccount.Id).ToListAsync();
                if (txs.Count > 0)
                {
                    dbContext.BankAccountTransactions.RemoveRange(txs);
                }
            }
            catch (Exception ex) { logger.LogWarning($"[CustomDelete] Failed deleting BankAccountTransactions: {ex.Message}"); }

            // Delete definition
            try
            {
                dbContext.BankAccountDefinitions.Remove(targetAccount);
                await dbContext.SaveChangesAsync();
                logger.LogInformation($"[CustomDelete] Successfully deleted BankAccountDefinition '95555' from '{tenantDbName}'.");
            }
            catch (Exception ex)
            {
                logger.LogError($"[CustomDelete] Failed to delete BankAccountDefinition from '{tenantDbName}': {ex}");
            }
        }
        else
        {
            logger.LogInformation($"[CustomDelete] BankAccountDefinition '95555' not found in '{tenantDbName}'.");
        }
    }

    public static async Task InspectBankAccountsExcelAsync(Microsoft.Extensions.Logging.ILogger logger)
    {
        var filePath = @"C:\Users\Admin\Downloads\banka_hesaplari.xlsx";
        if (!System.IO.File.Exists(filePath))
        {
            logger.LogError($"[BankInspect] File not found: {filePath}");
            return;
        }

        try
        {
            using (var workbook = new ClosedXML.Excel.XLWorkbook(filePath))
            {
                var worksheet = workbook.Worksheet(1);
                var rows = worksheet.RangeUsed().RowsUsed().ToList();
                logger.LogInformation($"[BankInspect] Total rows found: {rows.Count}");
                for (int i = 0; i < Math.Min(rows.Count, 30); i++)
                {
                    var cells = rows[i].Cells().Select(c => c.Value.ToString()).ToList();
                    logger.LogInformation($"[BankInspect] Row {i}: {string.Join(" | ", cells)}");
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogError($"[BankInspect] Error reading excel: {ex}");
        }
    }

    public static async Task ImportBankAccountsExcelAsync(AppDbContext dbContext, Microsoft.Extensions.Logging.ILogger logger, string tenantDbName)
    {
        logger.LogInformation($"[BankImport] Starting ImportBankAccountsExcelAsync for '{tenantDbName}'...");

        var filePath = @"C:\Users\Admin\Downloads\banka_hesaplari.xlsx";
        if (!System.IO.File.Exists(filePath))
        {
            logger.LogError($"[BankImport] File not found: {filePath}");
            return;
        }

        try
        {
            using (var workbook = new ClosedXML.Excel.XLWorkbook(filePath))
            {
                var worksheet = workbook.Worksheet(1);
                var rows = worksheet.RangeUsed().RowsUsed().ToList();
                logger.LogInformation($"[BankImport] Total rows found: {rows.Count}");

                int added = 0;
                int updated = 0;

                for (int i = 1; i < rows.Count; i++)
                {
                    var row = rows[i];
                    var bankCode = row.Cell(1).Value.ToString().Trim();
                    var bankName = row.Cell(2).Value.ToString().Trim();
                    var accountCode = row.Cell(3).Value.ToString().Trim();
                    var accountName = row.Cell(4).Value.ToString().Trim();
                    var ibanOrLinked = row.Cell(5).Value.ToString().Trim();
                    var accountTypeStr = row.Cell(6).Value.ToString().Trim();
                    var currencyStr = row.Cell(7).Value.ToString().Trim();

                    if (string.IsNullOrWhiteSpace(bankCode) || string.IsNullOrWhiteSpace(accountCode))
                    {
                        continue;
                    }

                    // 1. Find or create BankDetail
                    var bankDetail = await dbContext.BankDetails.FirstOrDefaultAsync(x => x.BankDetailCode == bankCode);
                    if (bankDetail == null)
                    {
                        bankDetail = new BankDetail
                        {
                            BankDetailCode = bankCode,
                            Name = string.IsNullOrWhiteSpace(bankName) ? bankCode : bankName,
                            IsActive = true
                        };
                        dbContext.BankDetails.Add(bankDetail);
                        await dbContext.SaveChangesAsync();
                    }

                    // 2. Map Account Type
                    int accountType = 0;
                    if (int.TryParse(accountTypeStr, out var at))
                    {
                        accountType = at;
                    }

                    // 3. Map Currency
                    int currencyTypeId = 1;
                    var curUpper = currencyStr.ToUpperInvariant();
                    if (curUpper.Contains("DOLAR") || curUpper.Contains("USD"))
                    {
                        currencyTypeId = 3;
                    }
                    else if (curUpper.Contains("EURO") || curUpper.Contains("EUR"))
                    {
                        currencyTypeId = 2;
                    }
                    else if (curUpper.Contains("STERLİN") || curUpper.Contains("STERLIN") || curUpper.Contains("GBP"))
                    {
                        currencyTypeId = 4;
                    }

                    // 4. Find or create BankAccountDefinition
                    var existing = await dbContext.BankAccountDefinitions
                        .FirstOrDefaultAsync(x => x.BankDetailId == bankDetail.Id && x.AccountCode == accountCode);

                    if (existing == null)
                    {
                        dbContext.BankAccountDefinitions.Add(new BankAccountDefinition
                        {
                            BankDetailId = bankDetail.Id,
                            AccountCode = accountCode,
                            AccountName = accountName,
                            AccountNo = ibanOrLinked,
                            AccountType = accountType,
                            CurrencyTypeId = currencyTypeId,
                            Budget = 0,
                            CreateUser = "System",
                            CreateTime = DateTime.UtcNow
                        });
                        added++;
                    }
                    else
                    {
                        existing.AccountName = accountName;
                        existing.AccountNo = ibanOrLinked;
                        existing.AccountType = accountType;
                        existing.CurrencyTypeId = currencyTypeId;
                        existing.EditUser = "System";
                        existing.EditTime = DateTime.UtcNow;
                        updated++;
                    }
                }

                if (added > 0 || updated > 0)
                {
                    await dbContext.SaveChangesAsync();
                }

                logger.LogInformation($"[BankImport] Successfully processed Excel import for '{tenantDbName}': added {added}, updated {updated}.");
            }
        }
        catch (Exception ex)
        {
            logger.LogError($"[BankImport] Error processing bank accounts excel for '{tenantDbName}': {ex}");
        }
    }
}

public static class FormulaEvaluator
{
    private class Token
    {
        public string Type { get; set; } = string.Empty; // "num", "id", "op", "lp", "rp", "comma", "eof"
        public string Value { get; set; } = string.Empty;
    }

    public static decimal Evaluate(string expr, decimal f4, decimal kdv, decimal discount)
    {
        var s = expr.Trim();
        var i = 0;

        Token NextTok()
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
            if (i >= s.Length) return new Token { Type = "eof" };
            var ch = s[i];
            if (ch == '(') { i++; return new Token { Type = "lp" }; }
            if (ch == ')') { i++; return new Token { Type = "rp" }; }
            if (ch == ',') { i++; return new Token { Type = "comma" }; }
            if (ch == '+' || ch == '-' || ch == '*' || ch == '/') { i++; return new Token { Type = "op", Value = ch.ToString() }; }
            if (char.IsDigit(ch) || ch == '.')
            {
                var start = i;
                while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.')) i++;
                return new Token { Type = "num", Value = s.Substring(start, i - start) };
            }
            if (char.IsLetter(ch) || ch == '_')
            {
                var start = i;
                while (i < s.Length && (char.IsLetterOrDigit(s[i]) || s[i] == '_')) i++;
                return new Token { Type = "id", Value = s.Substring(start, i - start) };
            }
            throw new Exception("Geçersiz karakter: " + ch);
        }

        var cur = NextTok();

        void Eat(string type)
        {
            if (cur.Type != type) throw new Exception("Formül parse hatası");
            cur = NextTok();
        }

        decimal ParsePrimary()
        {
            if (cur.Type == "op" && cur.Value == "-")
            {
                Eat("op");
                return -ParsePrimary();
            }
            if (cur.Type == "num")
            {
                var n = decimal.Parse(cur.Value, System.Globalization.CultureInfo.InvariantCulture);
                Eat("num");
                return n;
            }
            if (cur.Type == "id")
            {
                var id = cur.Value.ToUpperInvariant();
                Eat("id");
                if (cur.Type == "lp")
                {
                    Eat("lp");
                    var args = new List<decimal>();
                    if (cur.Type != "rp")
                    {
                        args.Add(ParseExpr());
                        while (cur.Type == "comma")
                        {
                            Eat("comma");
                            args.Add(ParseExpr());
                        }
                    }
                    Eat("rp");
                    if (id == "REMOVE_KDV")
                    {
                        var denom = 1m + (kdv / 100m);
                        return args[0] / denom;
                    }
                    if (id == "ADD_KDV")
                    {
                        var denom = 1m + (kdv / 100m);
                        return args[0] * denom;
                    }
                    throw new Exception("Bilinmeyen fonksiyon: " + id);
                }
                if (id == "F4") return f4;
                if (id == "KDV") return kdv;
                if (id == "DISCOUNT") return discount;
                throw new Exception("Bilinmeyen değişken: " + id);
            }
            if (cur.Type == "lp")
            {
                Eat("lp");
                var val = ParseExpr();
                Eat("rp");
                return val;
            }
            throw new Exception("Formül parse hatası");
        }

        decimal ParseMul()
        {
            var v = ParsePrimary();
            while (cur.Type == "op" && (cur.Value == "*" || cur.Value == "/"))
            {
                var op = cur.Value;
                Eat("op");
                var r = ParsePrimary();
                v = op == "*" ? v * r : v / r;
            }
            return v;
        }

        decimal ParseExpr()
        {
            var v = ParseMul();
            while (cur.Type == "op" && (cur.Value == "+" || cur.Value == "-"))
            {
                var op = cur.Value;
                Eat("op");
                var r = ParseMul();
                v = op == "+" ? v + r : v - r;
            }
            return v;
        }

        var result = ParseExpr();
        if (cur.Type != "eof") throw new Exception("Formül parse hatası");
        return Math.Round(result, 2);
    }
}
