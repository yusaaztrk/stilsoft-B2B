using Ecommerce.Api.Infrastructure.Data;
using Ecommerce.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using System.IO;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/orders")]
public sealed class OrdersController : ControllerBase
{
    private readonly OrdersRepository _orders;
    private readonly ProductsRepository _products;
    private readonly ProductSettingsRepository _settings;
    private readonly AdminModulesRepository _adminModules;
    private readonly LiveActivityService _live;
    private readonly ProductMetadataRepository _meta;
    private readonly StoreDesignRepository _designRepo;
    private readonly CampaignsRepository _campaigns;
    private readonly CampaignService _campaignService;
    private readonly InvoicesRepository _invoices;

    public OrdersController(
        OrdersRepository orders,
        ProductsRepository products,
        ProductSettingsRepository settings,
        AdminModulesRepository adminModules,
        LiveActivityService live,
        ProductMetadataRepository meta,
        StoreDesignRepository designRepo,
        CampaignsRepository campaigns,
        CampaignService campaignService,
        InvoicesRepository invoices)
    {
        _orders = orders;
        _products = products;
        _settings = settings;
        _adminModules = adminModules;
        _live = live;
        _meta = meta;
        _designRepo = designRepo;
        _campaigns = campaigns;
        _campaignService = campaignService;
        _invoices = invoices;
    }

    public sealed class CheckoutRequest
    {
        public string CustomerName { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string Address { get; set; } = string.Empty;
        public List<CheckoutLine> Lines { get; set; } = new();
        public string? CouponCode { get; set; }
        public string? OrderNo { get; set; }
    }

    public sealed class CheckoutLine
    {
        public Guid ProductId { get; set; }
        public string TenantCode { get; set; } = string.Empty;
        public int Quantity { get; set; }
    }

    [HttpPost("checkout")]
    public async Task<IActionResult> Checkout([FromBody] CheckoutRequest request, CancellationToken cancellationToken)
    {
        if (request.Lines.Count == 0)
            return BadRequest(new { success = false, message = "Sepet bos olamaz" });

        if (string.IsNullOrWhiteSpace(request.CustomerName) || string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Address))
            return BadRequest(new { success = false, message = "Teslimat bilgileri eksik" });

        var phoneRaw = (request.Phone ?? string.Empty).Trim();
        var phone = new string(phoneRaw.Where(char.IsDigit).ToArray());
        if (string.IsNullOrWhiteSpace(phone) || phone.Length != 11)
            return BadRequest(new { success = false, message = "Telefon numarası 11 haneli olmalıdır (örn: 05488000000)" });

        request.Phone = phone;

        // If a previous unpaid order exists for this checkout session, cancel/delete it to release reserved stock and avoid duplicate counting
        if (!string.IsNullOrWhiteSpace(request.OrderNo))
        {
            try
            {
                var oldOrderNo = request.OrderNo.Trim();
                var oldOrder = await _orders.GetByOrderNoAsync(oldOrderNo, cancellationToken);
                if (oldOrder != null && oldOrder.PaymentStatus == "PendingVirtualPos")
                {
                    // 1. Restore stock
                    foreach (var line in oldOrder.Lines)
                    {
                        try
                        {
                            var product = await _products.GetAsync(line.TenantCode, line.ProductId, cancellationToken);
                            if (product != null)
                            {
                                var oldStock = product.Stock ?? 0;
                                var newStock = oldStock + line.Quantity;
                                var updateStockSql = "UPDATE products SET stock=@Stock WHERE tenant_code=@Tenant AND erp_product_id=@Id";
                                await _adminModules.ExecuteSqlAsync(updateStockSql, new { Stock = newStock, Tenant = line.TenantCode, Id = line.ProductId }, cancellationToken);
                            }
                        }
                        catch {}
                    }

                    // 2. Decrement and delete coupon usages
                    if (!string.IsNullOrWhiteSpace(oldOrder.CouponCode))
                    {
                        try
                        {
                            var decSql = "UPDATE coupons SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END WHERE UPPER(code) = @Code";
                            await _adminModules.ExecuteSqlAsync(decSql, new { Code = oldOrder.CouponCode.ToUpperInvariant() }, cancellationToken);

                            var deleteUsageSql = "DELETE FROM coupon_usages WHERE order_id = @OrderId";
                            await _adminModules.ExecuteSqlAsync(deleteUsageSql, new { OrderId = oldOrder.Id }, cancellationToken);
                        }
                        catch {}
                    }

                    // 3. Delete notifications
                    try
                    {
                        var deleteNotifSql = "DELETE FROM admin_notifications WHERE link = '/admin/orders' AND title LIKE @Pattern";
                        await _adminModules.ExecuteSqlAsync(deleteNotifSql, new { Pattern = $"%{oldOrder.OrderNo}%" }, cancellationToken);
                    }
                    catch {}

                    // 4. Delete the order record
                    try
                    {
                        var deleteOrderSql = "DELETE FROM orders WHERE id = @Id";
                        await _adminModules.ExecuteSqlAsync(deleteOrderSql, new { Id = oldOrder.Id }, cancellationToken);
                    }
                    catch {}
                }
            }
            catch {}
        }

        var order = new StoreOrder
        {
            CustomerName = request.CustomerName,
            Email = request.Email,
            Phone = request.Phone,
            Address = request.Address,
            CustomerId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : null
        };

        foreach (var line in request.Lines)
        {
            if (line.Quantity < 1) continue;
            var tenant = (line.TenantCode ?? string.Empty).Trim().ToUpperInvariant();
            var product = string.IsNullOrWhiteSpace(tenant)
                ? await _products.GetAnyAsync(line.ProductId, cancellationToken)
                : await _products.GetAsync(tenant, line.ProductId, cancellationToken);
            if (product is null) continue;

            var productTenant = (product.TenantCode ?? tenant).Trim().ToUpperInvariant();
            var setting = await _settings.GetAsync(productTenant, product.ErpProductId, cancellationToken);
            order.Lines.Add(new StoreOrderLine
            {
                ProductId = product.ErpProductId,
                TenantCode = productTenant,
                ProductName = product.Name ?? product.StockCode ?? product.ErpProductId.ToString(),
                UnitPrice = setting?.OverridePrice ?? product.UnitPrice ?? 0,
                Quantity = Math.Min(line.Quantity, 999),
                ImageUrl = product.ImageUrl ?? string.Empty
            });
        }

        if (order.Lines.Count == 0)
            return BadRequest(new { success = false, message = "Gecerli urun bulunamadi" });

        // 1. Fetch design settings for cargo fee and threshold
        var designSettings = await _designRepo.GetAsync(cancellationToken);
        var baseCargoFee = designSettings?.CargoFee ?? 150m;
        var freeShippingThreshold = designSettings?.FreeShippingThreshold ?? 2000m;

        // 2. Prepare items for campaign calculations
        var cartCalculationItems = order.Lines.Select(line => (
            ProductId: line.ProductId,
            TenantCode: line.TenantCode,
            Quantity: line.Quantity,
            OriginalPrice: line.UnitPrice
        )).ToList();

        // 3. Evaluate active campaigns
        var campaignResult = await _campaignService.EvaluateCartCampaignsAsync(
            cartCalculationItems,
            baseCargoFee,
            freeShippingThreshold,
            cancellationToken);

        // 4. Inject free gift items into order lines
        foreach (var gift in campaignResult.GiftItems)
        {
            order.Lines.Add(new StoreOrderLine
            {
                ProductId = gift.ProductId,
                TenantCode = gift.TenantCode,
                ProductName = "[Hediye] " + gift.ProductName,
                UnitPrice = 0,
                Quantity = gift.Quantity,
                ImageUrl = gift.ImageUrl
            });
        }

        // 5. Apply campaign results to order properties
        order.CampaignDiscountAmount = campaignResult.ItemDiscountsTotal + campaignResult.CartDiscountTotal;
        order.CargoFee = campaignResult.CargoFee;

        decimal discount = 0;
        Guid? couponId = null;

        if (!string.IsNullOrWhiteSpace(request.CouponCode))
        {
            if (order.CustomerId == null)
                return BadRequest(new { success = false, message = "Kupon kullanabilmek için üye girişi yapmanız gerekmektedir." });

            var couponCode = request.CouponCode.Trim().ToUpperInvariant();

            // Query coupon from database
            var couponSql = @"
            SELECT id, code, user_id AS ""userId"", discount_type AS ""discountType"", discount_value AS ""discountValue"", 
                   min_order_amount AS ""minOrderAmount"", max_discount_amount AS ""maxDiscountAmount"", 
                   applicable_product_id AS ""applicableProductId"", applicable_category_id AS ""applicableCategoryId"", 
                   valid_from AS ""validFrom"", valid_until AS ""validUntil"", usage_limit AS ""usageLimit"", 
                   used_count AS ""usedCount"", is_active AS ""isActive""
            FROM coupons 
            WHERE UPPER(code) = @Code";

            var couponRows = await _adminModules.QuerySqlAsync(couponSql, new { Code = couponCode }, cancellationToken);
            if (couponRows.Count == 0)
                return BadRequest(new { success = false, message = "Geçersiz kupon kodu." });

            var couponRow = couponRows[0];
            couponId = (Guid)couponRow["id"];
            var userId = couponRow["userId"] != null ? (Guid)couponRow["userId"] : (Guid?)null;
            var discountType = couponRow["discountType"]?.ToString() ?? "Percentage";
            var discountValue = Convert.ToDecimal(couponRow["discountValue"]);
            var minOrderAmount = Convert.ToDecimal(couponRow["minOrderAmount"]);
            var maxDiscountAmount = couponRow["maxDiscountAmount"] != null ? Convert.ToDecimal(couponRow["maxDiscountAmount"]) : (decimal?)null;
            var applicableProductId = couponRow["applicableProductId"] != null ? (Guid)couponRow["applicableProductId"] : (Guid?)null;
            var applicableCategoryId = couponRow["applicableCategoryId"] != null ? (Guid)couponRow["applicableCategoryId"] : (Guid?)null;
            var validFrom = Convert.ToDateTime(couponRow["validFrom"]);
            var validUntil = Convert.ToDateTime(couponRow["validUntil"]);
            var usageLimit = Convert.ToInt32(couponRow["usageLimit"]);
            var usedCount = Convert.ToInt32(couponRow["usedCount"]);
            var isActive = Convert.ToBoolean(couponRow["isActive"]);

            if (!isActive)
                return BadRequest(new { success = false, message = "Bu kupon aktif değil." });

            var now = DateTime.UtcNow;
            if (now < validFrom || now > validUntil)
                return BadRequest(new { success = false, message = "Bu kupon geçerlilik süresi dışında." });

            if (usedCount >= usageLimit)
                return BadRequest(new { success = false, message = "Bu kuponun kullanım limiti dolmuştur." });

            // Check customer mapping assignment
            var assignCheckSql = "SELECT COUNT(*) FROM coupon_customers WHERE coupon_id = @CouponId";
            var assignCheckRows = await _adminModules.QuerySqlAsync(assignCheckSql, new { CouponId = couponId.Value }, cancellationToken);
            var isRestricted = Convert.ToInt64(assignCheckRows[0]["count"]) > 0;

            if (isRestricted)
            {
                if (order.CustomerId == null)
                {
                    return BadRequest(new { success = false, message = "Bu kupon sizin hesabınıza tanımlanmamış." });
                }
                var userAssignCheckSql = "SELECT COUNT(*) FROM coupon_customers WHERE coupon_id = @CouponId AND user_id = @UserId";
                var userAssignCheckRows = await _adminModules.QuerySqlAsync(userAssignCheckSql, new { CouponId = couponId.Value, UserId = order.CustomerId.Value }, cancellationToken);
                if (Convert.ToInt64(userAssignCheckRows[0]["count"]) == 0)
                {
                    return BadRequest(new { success = false, message = "Bu kupon sizin hesabınıza tanımlanmamış." });
                }
            }

            if (order.CustomerId != null)
            {
                // Double-spend check
                var usageCheckSql = "SELECT COUNT(*) FROM coupon_usages WHERE coupon_id = @CouponId AND user_id = @UserId";
                var usageCheckRows = await _adminModules.QuerySqlAsync(usageCheckSql, new { CouponId = couponId.Value, UserId = order.CustomerId.Value }, cancellationToken);
                if (usageCheckRows.Count > 0 && Convert.ToInt64(usageCheckRows[0]["count"]) > 0)
                    return BadRequest(new { success = false, message = "Bu kuponu daha önce kullandınız." });
            }

            // Calculate total cart value from lines using campaign-discounted prices
            var subtotalSum = campaignResult.FinalTotal - campaignResult.CargoFee;
            if (subtotalSum < minOrderAmount)
                return BadRequest(new { success = false, message = $"Bu kuponu kullanabilmek için minimum sepet tutarı ₺{minOrderAmount:N2} olmalıdır." });

            decimal targetSubtotal = 0;
            if (applicableProductId != null)
            {
                var targetLine = order.Lines.FirstOrDefault(x => x.ProductId == applicableProductId.Value);
                if (targetLine == null)
                    return BadRequest(new { success = false, message = "Bu kupon sepetinizdeki belirli bir ürün için geçerlidir." });

                var campLine = campaignResult.Lines.FirstOrDefault(x => x.ProductId == applicableProductId.Value);
                var discountedPrice = campLine != null ? campLine.DiscountedPrice : targetLine.UnitPrice;
                targetSubtotal = discountedPrice * targetLine.Quantity;
            }
            else if (applicableCategoryId != null)
            {
                var productIds = order.Lines.Select(x => x.ProductId).ToList();
                var mapSql = "SELECT product_id FROM product_category_map WHERE category_id = @CatId AND product_id = ANY(@ProductIds)";
                var eligibleRows = await _adminModules.QuerySqlAsync(mapSql, new { CatId = applicableCategoryId.Value, ProductIds = productIds }, cancellationToken);
                var eligibleProductIds = eligibleRows.Select(r => (Guid)r["product_id"]).ToHashSet();

                if (eligibleProductIds.Count == 0)
                    return BadRequest(new { success = false, message = "Bu kupon sepetinizdeki belirli bir kategorideki ürünler için geçerlidir." });

                targetSubtotal = order.Lines
                    .Where(x => eligibleProductIds.Contains(x.ProductId))
                    .Sum(x => {
                        var campLine = campaignResult.Lines.FirstOrDefault(cl => cl.ProductId == x.ProductId);
                        var discountedPrice = campLine != null ? campLine.DiscountedPrice : x.UnitPrice;
                        return discountedPrice * x.Quantity;
                    });
            }
            else
            {
                targetSubtotal = subtotalSum;
            }

            if (discountType == "Percentage")
            {
                discount = targetSubtotal * (discountValue / 100m);
                if (maxDiscountAmount != null && maxDiscountAmount.Value > 0)
                {
                    discount = Math.Min(discount, maxDiscountAmount.Value);
                }
            }
            else
            {
                discount = Math.Min(discountValue, targetSubtotal);
            }

            discount = Math.Round(discount, 2);
            discount = Math.Min(discount, subtotalSum); // Coupon cannot exceed total order value

            order.CouponCode = couponCode;
            order.DiscountAmount = discount;
        }

        var totalDiscount = order.CampaignDiscountAmount + order.DiscountAmount;
        if (totalDiscount > 0)
        {
            DistributeDiscounts(order.Lines, totalDiscount);
        }

        decimal orderSubtotal = order.Lines.Sum(x => x.LineTotal);
        order.Total = Math.Max(0, orderSubtotal + order.CargoFee);

        var created = await _orders.CreateAsync(order, cancellationToken);

        // Record campaign usages if campaigns were applied
        foreach (var campDetail in campaignResult.AppliedCampaigns)
        {
            try
            {
                await _campaigns.RecordUsageAsync(
                    campDetail.CampaignId, 
                    created.Id, 
                    order.CustomerId, 
                    campDetail.DiscountAmount, 
                    cancellationToken);
            }
            catch {}
        }

        // Record coupon usage if coupon was applied
        if (couponId != null)
        {
            try
            {
                // Increment used_count
                var incSql = "UPDATE coupons SET used_count = used_count + 1 WHERE id = @Id";
                await _adminModules.ExecuteSqlAsync(incSql, new { Id = couponId.Value }, cancellationToken);

                // Insert into coupon_usages if customer was logged in
                if (order.CustomerId != null)
                {
                    var usageSql = "INSERT INTO coupon_usages (id, coupon_id, user_id, order_id) VALUES (@Id, @CouponId, @UserId, @OrderId)";
                    await _adminModules.ExecuteSqlAsync(usageSql, new {
                        Id = Guid.NewGuid(),
                        CouponId = couponId.Value,
                        UserId = order.CustomerId.Value,
                        OrderId = created.Id
                    }, cancellationToken);
                }
            }
            catch {}
        }

        // 1. Subtract stocks and alert low stock if needed
        foreach (var line in created.Lines)
        {
            try
            {
                var product = await _products.GetAsync(line.TenantCode, line.ProductId, cancellationToken);
                if (product != null)
                {
                    var oldStock = product.Stock ?? 0;
                    var newStock = Math.Max(0, oldStock - line.Quantity);

                    var updateStockSql = "UPDATE products SET stock=@Stock WHERE tenant_code=@Tenant AND erp_product_id=@Id";
                    await _adminModules.ExecuteSqlAsync(updateStockSql, new { Stock = newStock, Tenant = line.TenantCode, Id = line.ProductId }, cancellationToken);

                    if (newStock < 5)
                    {
                        var stockNotifSql = "INSERT INTO admin_notifications (id, type, title, message, is_read, link, created_at_utc) VALUES (@Id, 'stock', @Title, @Message, false, @Link, (now() AT TIME ZONE 'utc'))";
                        await _adminModules.ExecuteSqlAsync(stockNotifSql, new {
                            Id = Guid.NewGuid(),
                            Title = $"{product.Name ?? product.StockCode} stok kritik",
                            Message = $"Kritik stok seviyesinin altında (Son {newStock} adet)",
                            Link = "/admin/inventory"
                        }, cancellationToken);
                    }

                    // Stock subtraction only, warranty generation moved to CompletePayment
                }
            }
            catch { }
        }

        // 2. Insert order notification
        try
        {
            var orderNotifSql = "INSERT INTO admin_notifications (id, type, title, message, is_read, link, created_at_utc) VALUES (@Id, 'order', @Title, @Message, false, @Link, (now() AT TIME ZONE 'utc'))";
            await _adminModules.ExecuteSqlAsync(orderNotifSql, new {
                Id = Guid.NewGuid(),
                Title = $"Yeni sipariş #{created.OrderNo}",
                Message = $"{created.CustomerName} ₺{created.Total:N0} sipariş verdi",
                Link = "/admin/orders"
            }, cancellationToken);
        }
        catch { }

        try
        {
            string city = "İstanbul";
            var addressLower = (request.Address ?? "").ToLowerInvariant();
            var cities = new[] { "ankara", "izmir", "bursa", "antalya", "adana", "trabzon", "konya", "gaziantep", "diyarbakir", "samsun", "eskisehir" };
            foreach (var c in cities)
            {
                if (addressLower.Contains(c))
                {
                    city = char.ToUpper(c[0]) + c.Substring(1);
                    break;
                }
            }
            _live.AddEvent("checkout", request.CustomerName ?? "Müşteri", $"Sipariş verdi: #{created.OrderNo} (₺{created.Total:N0})", city);
        }
        catch { }

        await PopulateLineImagesAsync(new[] { created }, cancellationToken);
        return Ok(new { success = true, data = created });
    }

    public sealed class CompletePaymentRequest
    {
        public string OrderNo { get; set; } = string.Empty;
    }

    [HttpPost("complete-payment")]
    public async Task<IActionResult> CompletePayment([FromBody] CompletePaymentRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.OrderNo))
            return BadRequest(new { success = false, message = "Sipariş numarası zorunludur." });

        var order = await _orders.GetByOrderNoAsync(request.OrderNo, cancellationToken);
        if (order == null)
            return NotFound(new { success = false, message = "Sipariş bulunamadı." });

        if (order.PaymentStatus == "Paid")
            return BadRequest(new { success = false, message = "Bu siparişin ödemesi zaten tamamlanmış." });

        await _orders.UpdateStatusAndPaymentAsync(order.Id, "Processing", "Paid", cancellationToken);

        // Record the payment in admin_payments table
        try
        {
            var insertPaymentSql = @"
                INSERT INTO admin_payments (id, txn_id, order_no, customer_name, amount, method, status, created_at_utc)
                VALUES (@Id, @TxnId, @OrderNo, @CustomerName, @Amount, 'Credit Card (Virtual POS)', 'Success', (now() AT TIME ZONE 'utc'))";
            await _adminModules.ExecuteSqlAsync(insertPaymentSql, new
            {
                Id = Guid.NewGuid(),
                TxnId = $"TXN-{order.OrderNo}",
                OrderNo = order.OrderNo,
                CustomerName = order.CustomerName,
                Amount = order.Total
            }, cancellationToken);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Failed to record payment in admin_payments: {ex.Message}");
        }

        // Add event to Live Activity
        try
        {
            string city = "İstanbul";
            var addressLower = (order.Address ?? "").ToLowerInvariant();
            var cities = new[] { "ankara", "izmir", "bursa", "antalya", "adana", "trabzon", "konya", "gaziantep", "diyarbakir", "samsun", "eskisehir" };
            foreach (var c in cities)
            {
                if (addressLower.Contains(c))
                {
                    city = char.ToUpper(c[0]) + c.Substring(1);
                    break;
                }
            }
            _live.AddEvent("payment", order.CustomerName ?? "Müşteri", $"Ödeme tamamlandı: #{order.OrderNo} (₺{order.Total:N0})", city);
        }
        catch { }

        // --- GENERATE WARRANTIES IF PRODUCT HAS WARRANTY DURATION ---
        foreach (var line in order.Lines)
        {
            try
            {
                var meta = await _meta.GetAsync(line.TenantCode, line.ProductId, cancellationToken);
                if (meta != null && meta.WarrantyMonths > 0)
                {
                    for (int i = 0; i < line.Quantity; i++)
                    {
                        var warrantyId = Guid.NewGuid();
                        var year = DateTime.UtcNow.Year;
                        var randStr = Guid.NewGuid().ToString("N").Substring(0, 6).ToUpperInvariant();
                        var warrantyCode = $"STL-{year}-{randStr}";

                        var insertWarrantySql = @"
                        INSERT INTO sold_product_warranties (id, user_id, customer_name, customer_email, product_id, product_name, warranty_code, warranty_months, sold_date, status)
                        VALUES (@Id, @UserId, @CustomerName, @CustomerEmail, @ProductId, @ProductName, @WarrantyCode, @WarrantyMonths, (now() AT TIME ZONE 'utc'), 'Active')";

                        await _adminModules.ExecuteSqlAsync(insertWarrantySql, new {
                            Id = warrantyId,
                            UserId = order.CustomerId,
                            CustomerName = order.CustomerName,
                            CustomerEmail = order.Email,
                            ProductId = line.ProductId,
                            ProductName = line.ProductName,
                            WarrantyCode = warrantyCode,
                            WarrantyMonths = meta.WarrantyMonths
                        }, cancellationToken);
                    }
                }
            }
            catch { }
        }

        // --- GENERATE INVOICE PDF & RECORD ---
        StoreInvoice? invoice = null;
        try
        {
            invoice = await _invoices.GetByOrderIdAsync(order.Id, cancellationToken);
            if (invoice == null)
            {
                var invoiceNo = await _invoices.GenerateInvoiceNoAsync(cancellationToken);
                var pdfBytes = GenerateInvoicePdfBytes(order, invoiceNo);
                
                var uploadDir = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads", "invoices");
                if (!Directory.Exists(uploadDir))
                {
                    Directory.CreateDirectory(uploadDir);
                }
                
                var fileName = $"{invoiceNo}.pdf";
                var pdfPath = Path.Combine(uploadDir, fileName);
                await System.IO.File.WriteAllBytesAsync(pdfPath, pdfBytes, cancellationToken);
                
                var storeInvoice = new StoreInvoice
                {
                    OrderId = order.Id,
                    OrderNo = order.OrderNo,
                    InvoiceNo = invoiceNo,
                    GrandTotal = order.Total,
                    PdfPath = $"/uploads/invoices/{fileName}"
                };
                
                invoice = await _invoices.CreateAsync(storeInvoice, cancellationToken);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error generating invoice PDF at payment completion: {ex.Message}");
        }

        // --- EMAIL CUSTOMER WITH INVOICE ATTACHED ---
        try
        {
            var guides = new List<(string ProductName, string Url)>();
            foreach (var line in order.Lines)
            {
                var meta = await _meta.GetAsync(line.TenantCode, line.ProductId, cancellationToken);
                if (meta != null && !string.IsNullOrWhiteSpace(meta.ManualPdfUrl))
                {
                    guides.Add((line.ProductName, meta.ManualPdfUrl));
                }
            }

            var emailBody = $"<h3>Sayın {System.Net.WebUtility.HtmlEncode(order.CustomerName)},</h3>" +
                            $"<p>#{System.Net.WebUtility.HtmlEncode(order.OrderNo)} numaralı siparişiniz ve ödemeniz başarıyla tamamlanmıştır.</p>" +
                            $"<p>Siparişinize ait e-Arşiv faturanız ekte bilgilerinize sunulmuştur.</p>";

            if (guides.Count > 0)
            {
                emailBody += $"<p>Satın almış olduğunuz ürünlere ait kullanım kılavuzlarını indirmek için aşağıdaki bağlantıları kullanabilirsiniz:</p>" +
                             $"<ul>";

                foreach (var guide in guides)
                {
                    emailBody += $"<li><strong>{System.Net.WebUtility.HtmlEncode(guide.ProductName)}</strong>: " +
                                 $"<a href=\"{System.Net.WebUtility.HtmlEncode(guide.Url)}\" target=\"_blank\">Kullanım Kılavuzunu İndir</a></li>";
                }

                emailBody += $"</ul>";
            }

            emailBody += $"<p>Bizi tercih ettiğiniz için teşekkür ederiz.</p>" +
                         $"<p>Saygılarımızla,<br/>B2B ERP E-Ticaret Ekibi</p>";

            var attachments = new List<EmailAttachmentDto>();
            if (invoice != null)
            {
                var fullPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", invoice.PdfPath.TrimStart('/'));
                if (System.IO.File.Exists(fullPath))
                {
                    var pdfDataBytes = await System.IO.File.ReadAllBytesAsync(fullPath, cancellationToken);
                    attachments.Add(new EmailAttachmentDto(
                        FileName: $"{invoice.InvoiceNo}.pdf",
                        ContentType: "application/pdf",
                        Content: pdfDataBytes
                    ));
                }
            }

            // Always email the customer with the invoice attachment (and include manuals if present)
            await SendEmailAsync(order.Email, $"Sipariş Faturası {invoice?.InvoiceNo ?? ""} - Sipariş #{order.OrderNo}", emailBody, attachments, cancellationToken);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error sending invoice email at payment completion: {ex.Message}");
        }

        // Send order data to ServiceOps Cargo Tracking
        await CreateServiceOpsCargoTaskAsync(order, cancellationToken);

        return Ok(new { success = true, message = "Ödeme başarıyla tamamlandı." });
    }

    [Authorize(Policy = "perm:orders")]
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var list = await _orders.ListAsync(cancellationToken);
        await PopulateLineImagesAsync(list, cancellationToken);
        return Ok(new { success = true, data = list });
    }

    [Authorize(Policy = "perm:orders")]
    [HttpPut("{id:guid}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] Dictionary<string, string> body, CancellationToken cancellationToken)
    {
        var newStatus = body.TryGetValue("status", out var s) ? s.Trim() : "Processing";
        await _orders.UpdateStatusAsync(id, newStatus, cancellationToken);

        if (string.Equals(newStatus, "Processing", StringComparison.OrdinalIgnoreCase) || 
            string.Equals(newStatus, "Hazırlanıyor", StringComparison.OrdinalIgnoreCase) || 
            string.Equals(newStatus, "Preparing", StringComparison.OrdinalIgnoreCase))
        {
            var order = await _orders.GetByIdAsync(id, cancellationToken);
            if (order != null)
            {
                await CreateServiceOpsCargoTaskAsync(order, cancellationToken);
            }
        }

        return Ok(new { success = true });
    }

    private async Task CreateServiceOpsCargoTaskAsync(StoreOrder order, CancellationToken cancellationToken)
    {
        try
        {
            var configuration = HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            var clientFactory = HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>();
            
            var serviceOpsUrl = (configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").TrimEnd('/');
            var client = clientFactory.CreateClient();
            
            var payload = new
            {
                OrderNumber = order.OrderNo,
                ProductDetails = string.Join(", ", order.Lines.Select(l => $"{l.Quantity}x {l.ProductName}")),
                CustomerName = order.CustomerName,
                DeliveryAddress = order.Address,
                OrderDate = DateTime.UtcNow
            };
            
            var json = System.Text.Json.JsonSerializer.Serialize(payload);
            var content = new System.Net.Http.StringContent(json, System.Text.Encoding.UTF8, "application/json");
            
            var response = await client.PostAsync($"{serviceOpsUrl}/api/cargotracking", content, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                Console.WriteLine($"ServiceOps CargoTracking integration error: {response.StatusCode}");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Failed to contact ServiceOps for CargoTracking: {ex.Message}");
        }
    }

    private async Task SendEmailAsync(string recipient, string subject, string body, List<EmailAttachmentDto>? attachments, CancellationToken cancellationToken)
    {
        try
        {
            var configuration = HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            var clientFactory = HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>();

            var emailServiceUrl = (configuration["EmailService:BaseUrl"] ?? "http://localhost:5250").TrimEnd('/');
            var apiKey = configuration["EmailService:ApiKey"] ?? "B2B_ERP_EmailService_Default_Secret_API_Key_123!";

            var client = clientFactory.CreateClient();
            client.DefaultRequestHeaders.Add("X-API-Key", apiKey);

            var payload = new
            {
                tenantId = "DEFAULT",
                recipient = recipient.Trim(),
                subject = subject.Trim(),
                body = body,
                attachments = attachments,
                scheduledFor = (object?)null
            };

            var json = System.Text.Json.JsonSerializer.Serialize(payload);
            var content = new System.Net.Http.StringContent(json, System.Text.Encoding.UTF8, "application/json");

            var response = await client.PostAsync($"{emailServiceUrl}/api/email/send", content, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var error = await response.Content.ReadAsStringAsync(cancellationToken);
                Console.WriteLine($"Email service error: {response.StatusCode} - {error}");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Failed to contact email service: {ex.Message}");
        }
    }

    private async Task PopulateLineImagesAsync(IEnumerable<StoreOrder> orders, CancellationToken cancellationToken)
    {
        if (orders == null) return;
        var ordersList = orders.ToList();
        if (ordersList.Count == 0) return;

        var missingProductIds = ordersList
            .SelectMany(o => o.Lines)
            .Where(l => string.IsNullOrWhiteSpace(l.ImageUrl))
            .Select(l => l.ProductId)
            .Distinct()
            .ToList();

        var config = HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        var erpBaseUrl = (config["Erp:BaseUrl"] ?? string.Empty).Trim();

        var imageMap = new Dictionary<Guid, string>();

        if (missingProductIds.Count > 0)
        {
            var sql = "SELECT erp_product_id AS \"id\", image_url AS \"imageUrl\" FROM products WHERE erp_product_id = ANY(@ids)";
            var rows = await _adminModules.QuerySqlAsync(sql, new { ids = missingProductIds }, cancellationToken);

            foreach (var row in rows)
            {
                if (row.TryGetValue("id", out var idObj) && idObj is Guid id)
                {
                    var imgUrl = row.TryGetValue("imageUrl", out var imgObj) ? imgObj?.ToString() ?? string.Empty : string.Empty;
                    imageMap[id] = imgUrl;
                }
            }
        }

        foreach (var order in ordersList)
        {
            foreach (var line in order.Lines)
            {
                if (string.IsNullOrWhiteSpace(line.ImageUrl) && imageMap.TryGetValue(line.ProductId, out var img))
                {
                    line.ImageUrl = img;
                }

                line.ImageUrl = NormalizeImageUrl(line.ImageUrl, erpBaseUrl);
            }
        }
    }

    private static string NormalizeImageUrl(string? url, string erpBaseUrl)
    {
        var u = (url ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(u)) return string.Empty;

        if (u.StartsWith("uploads/", StringComparison.OrdinalIgnoreCase))
        {
            u = "/" + u;
        }

        if (u.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase)) return u;
        if (!u.StartsWith("/", StringComparison.Ordinal)) return u;

        var baseUrl = erpBaseUrl.Trim();
        if (string.IsNullOrWhiteSpace(baseUrl)) return u;
        if (!baseUrl.EndsWith("/")) baseUrl += "/";
        return new Uri(new Uri(baseUrl), u.TrimStart('/')).ToString();
    }

    [Authorize]
    [HttpGet("my")]
    public async Task<IActionResult> MyOrders([FromQuery] int take = 50, CancellationToken cancellationToken = default)
    {
        if (!Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) || uid == Guid.Empty)
            return Unauthorized(new { success = false, message = "Oturum bulunamadi" });

        var list = await _orders.ListByCustomerIdAsync(uid, take, cancellationToken);
        await PopulateLineImagesAsync(list, cancellationToken);
        return Ok(new { success = true, data = list });
    }

    [AllowAnonymous]
    [HttpGet("detail-by-no/{orderNo}")]
    public async Task<IActionResult> GetDetailByOrderNo(string orderNo, CancellationToken cancellationToken)
    {
        var order = await _orders.GetByOrderNoAsync(orderNo, cancellationToken);
        if (order == null) return NotFound(new { success = false, message = "Sipariş bulunamadı." });
        await PopulateLineImagesAsync(new[] { order }, cancellationToken);
        return Ok(order);
    }

    [HttpGet("cargo-tracking/{orderNo}")]
    public async Task<IActionResult> GetCargoTracking(string orderNo, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(orderNo) || orderNo.Contains('/') || orderNo.Contains('\\') || orderNo.Contains('?') || orderNo.Contains('&') || orderNo.Contains('%'))
        {
            return BadRequest(new { success = false, message = "Geçersiz sipariş numarası formatı." });
        }

        try
        {
            var configuration = HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            var clientFactory = HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>();
            var serviceOpsUrl = (configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").TrimEnd('/');
            
            var client = clientFactory.CreateClient();
            var response = await client.GetAsync($"{serviceOpsUrl}/api/cargotracking/{Uri.EscapeDataString(orderNo.Trim())}", cancellationToken);
            
            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync(cancellationToken);
                var data = System.Text.Json.JsonSerializer.Deserialize<object>(content, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return Ok(new { success = true, data });
            }
            return NotFound(new { success = false, message = "Kargo bulunamadı." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = "ServiceOps bağlantı hatası." });
        }
    }

    [Authorize(Policy = "perm:orders")]
    [HttpGet("cargo-tracking")]
    public async Task<IActionResult> ListCargoTracking(CancellationToken cancellationToken)
    {
        try
        {
            var configuration = HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            var clientFactory = HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>();
            var serviceOpsUrl = (configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").TrimEnd('/');
            
            var client = clientFactory.CreateClient();
            var response = await client.GetAsync($"{serviceOpsUrl}/api/cargotracking", cancellationToken);
            
            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync(cancellationToken);
                var data = System.Text.Json.JsonSerializer.Deserialize<object>(content, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return Ok(new { success = true, data });
            }
            return BadRequest(new { success = false, message = "Kargo listesi alınamadı." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = "ServiceOps bağlantı hatası." });
        }
    }

    [AllowAnonymous]
    [HttpPost("update-cargo-status")]
    public async Task<IActionResult> UpdateCargoStatus([FromBody] UpdateCargoStatusRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.OrderNo))
        {
            return BadRequest(new { success = false, message = "Sipariş numarası boş olamaz." });
        }

        var order = await _orders.GetByOrderNoAsync(request.OrderNo, cancellationToken);
        if (order == null)
        {
            return NotFound(new { success = false, message = "Sipariş bulunamadı." });
        }

        string mappedStatus = request.Status switch
        {
            0 => "Siparişiniz Alındı",
            1 => "Planlandı",
            2 => "Hazırlanıyor",
            3 => "Dağıtımda",
            4 => "Teslim Edildi",
            _ => "Bilinmeyen"
        };

        // 1. Update status in orders table
        await _orders.UpdateStatusAsync(order.Id, mappedStatus, cancellationToken);

        // 2. Map status integer to string for admin_shipping status
        string shippingStatus = request.Status switch
        {
            0 => "Received",
            1 => "Planned",
            2 => "Preparing",
            3 => "InTransit",
            4 => "Delivered",
            _ => "Shipped"
        };

        // 3. Upsert admin_shipping table
        try
        {
            var carrier = request.Carrier ?? "ServiceOps";
            var trackingNo = request.TrackingNo ?? request.OrderNo;
            var shippedAt = request.ShippedAt ?? DateTime.UtcNow;
            var deliveryDate = request.DeliveryDate;
            var customerName = request.CustomerName ?? order.CustomerName;

            var checkSql = "SELECT COUNT(*) FROM admin_shipping WHERE order_no = @OrderNo";
            var rowsList = await _adminModules.QuerySqlAsync(checkSql, new { OrderNo = request.OrderNo }, cancellationToken);
            var exists = rowsList.Count > 0 && Convert.ToInt64(rowsList[0]["count"]) > 0;

            string? existingHistory = null;
            if (exists)
            {
                var historyRows = await _adminModules.QuerySqlAsync("SELECT history_json FROM admin_shipping WHERE order_no = @OrderNo", new { OrderNo = request.OrderNo }, cancellationToken);
                if (historyRows.Count > 0)
                {
                    existingHistory = historyRows[0]["history_json"]?.ToString();
                }
            }

            var historyList = new List<object>();
            if (!exists)
            {
                historyList.Add(new
                {
                    status = 0,
                    statusLabel = "Siparişiniz Alındı",
                    detail = "Sipariş kargo birimine iletildi.",
                    actor = "System",
                    timestamp = order.CreatedAtUtc
                });
                if (request.Status > 0)
                {
                    historyList.Add(new
                    {
                        status = request.Status,
                        statusLabel = mappedStatus,
                        detail = request.Detail ?? $"Kargo durumu güncellendi: {mappedStatus}",
                        actor = "ServiceOps",
                        timestamp = DateTime.UtcNow
                    });
                }
            }
            else
            {
                if (!string.IsNullOrEmpty(existingHistory))
                {
                    try
                    {
                        var parsed = System.Text.Json.JsonSerializer.Deserialize<List<object>>(existingHistory);
                        if (parsed != null) historyList.AddRange(parsed);
                    }
                    catch {}
                }
                historyList.Add(new
                {
                    status = request.Status,
                    statusLabel = mappedStatus,
                    detail = request.Detail ?? $"Kargo durumu güncellendi: {mappedStatus}",
                    actor = "ServiceOps",
                    timestamp = DateTime.UtcNow
                });
            }

            var newHistoryJson = System.Text.Json.JsonSerializer.Serialize(historyList);

            if (exists)
            {
                var updateSql = @"
                    UPDATE admin_shipping 
                    SET carrier = @Carrier, tracking_no = @TrackingNo, delivery_date = @DeliveryDate, status = @Status, history_json = @HistoryJson
                    WHERE order_no = @OrderNo";
                await _adminModules.ExecuteSqlAsync(updateSql, new
                {
                    Carrier = carrier,
                    TrackingNo = trackingNo,
                    DeliveryDate = (object?)deliveryDate ?? DBNull.Value,
                    Status = shippingStatus,
                    HistoryJson = newHistoryJson,
                    OrderNo = request.OrderNo
                }, cancellationToken);
            }
            else
            {
                var insertSql = @"
                    INSERT INTO admin_shipping (id, order_no, customer_name, carrier, tracking_no, shipped_at, delivery_date, status, history_json)
                    VALUES (@Id, @OrderNo, @CustomerName, @Carrier, @TrackingNo, @ShippedAt, @DeliveryDate, @Status, @HistoryJson)";
                await _adminModules.ExecuteSqlAsync(insertSql, new
                {
                    Id = Guid.NewGuid(),
                    OrderNo = request.OrderNo,
                    CustomerName = customerName,
                    Carrier = carrier,
                    TrackingNo = trackingNo,
                    ShippedAt = shippedAt,
                    DeliveryDate = (object?)deliveryDate ?? DBNull.Value,
                    Status = shippingStatus,
                    HistoryJson = newHistoryJson
                }, cancellationToken);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error upserting admin_shipping: {ex.Message}");
        }

        return Ok(new { success = true, message = $"Sipariş durumu '{mappedStatus}' olarak güncellendi." });
    }

    private static void DistributeDiscounts(List<StoreOrderLine> lines, decimal totalDiscount)
    {
        var eligibleLines = lines.Where(l => l.UnitPrice > 0 && l.Quantity > 0)
                                 .OrderByDescending(l => l.UnitPrice * l.Quantity)
                                 .ToList();
                                 
        if (eligibleLines.Count == 0 || totalDiscount <= 0)
            return;

        decimal originalSum = eligibleLines.Sum(l => l.UnitPrice * l.Quantity);
        if (originalSum <= 0)
            return;

        if (totalDiscount >= originalSum)
        {
            foreach (var line in eligibleLines)
            {
                line.UnitPrice = 0;
            }
            return;
        }

        decimal distributedDiscountSum = 0;
        var lineDiscounts = new decimal[eligibleLines.Count];

        for (int i = 0; i < eligibleLines.Count; i++)
        {
            var line = eligibleLines[i];
            var lineOriginalTotal = line.UnitPrice * line.Quantity;
            var lineDiscount = lineOriginalTotal * (totalDiscount / originalSum);
            lineDiscount = Math.Round(lineDiscount, 2);
            lineDiscounts[i] = lineDiscount;
            distributedDiscountSum += lineDiscount;
        }

        decimal difference = totalDiscount - distributedDiscountSum;
        if (difference != 0 && eligibleLines.Count > 0)
        {
            lineDiscounts[0] += difference;
        }

        for (int i = 0; i < eligibleLines.Count; i++)
        {
            var line = eligibleLines[i];
            var lineDiscount = lineDiscounts[i];
            var lineOriginalTotal = line.UnitPrice * line.Quantity;
            var lineDiscountedTotal = Math.Max(0, lineOriginalTotal - lineDiscount);
            line.UnitPrice = Math.Round(lineDiscountedTotal / line.Quantity, 2);
        }
    }

    private byte[] GenerateInvoicePdfBytes(StoreOrder order, string invoiceNo)
    {
        decimal subtotal = order.Lines.Sum(l => l.LineTotal);
        decimal kdvRate = 0.20m;
        
        decimal vatInclusiveSubtotal = subtotal;
        decimal vatExclusiveSubtotal = Math.Round(vatInclusiveSubtotal / (1 + kdvRate), 2);
        decimal vatAmount = vatInclusiveSubtotal - vatExclusiveSubtotal;

        decimal cargoFee = order.CargoFee;
        decimal cargoVatExclusive = Math.Round(cargoFee / (1 + kdvRate), 2);
        decimal cargoVatAmount = cargoFee - cargoVatExclusive;

        decimal grandTotal = vatInclusiveSubtotal + cargoFee;

        var pdfData = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(1.5f, Unit.Centimetre);
                page.PageColor(Colors.White);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily("Helvetica"));

                page.Header().Row(row =>
                {
                    row.RelativeItem().Column(col =>
                    {
                        col.Item().Text("B2B ERP E-TİCARET A.Ş.").FontSize(16).Bold().FontColor(Colors.Red.Medium);
                        col.Item().Text("Adres: Merkez Mh. İstiklal Cd. No:123 Şişli/İstanbul");
                        col.Item().Text("Telefon: 0850 123 45 67 | E-posta: destek@b2berp.com");
                        col.Item().Text("Vergi Dairesi: Boğaziçi V.D. | Vergi No: 1234567890");
                    });

                    row.ConstantItem(150).Column(col =>
                    {
                        col.Item().Text("E-ARŞİV FATURA").FontSize(14).Bold().AlignRight();
                        col.Item().Text($"Fatura No: {invoiceNo}").Bold().AlignRight();
                        col.Item().Text($"Fatura Tarihi: {DateTime.UtcNow:dd.MM.yyyy HH:mm}").AlignRight();
                        col.Item().Text($"Sipariş No: {order.OrderNo}").AlignRight();
                        col.Item().Text($"Sipariş Tarihi: {order.CreatedAtUtc.ToLocalTime():dd.MM.yyyy HH:mm}").AlignRight();
                    });
                });

                page.Content().PaddingVertical(1, Unit.Centimetre).Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Lighten2);
                    col.Item().PaddingBottom(10);

                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("SAYIN (ALICI BİLGİLERİ)").FontSize(10).Bold().FontColor(Colors.Grey.Darken2);
                            c.Item().Text(order.CustomerName).Bold();
                            c.Item().Text($"Adres: {order.Address}");
                            c.Item().Text($"Telefon: {order.Phone}");
                            c.Item().Text($"E-posta: {order.Email}");
                        });
                    });

                    col.Item().PaddingBottom(15);

                    col.Item().Table(table =>
                    {
                        table.ColumnsDefinition(columns =>
                        {
                            columns.ConstantColumn(25);
                            columns.RelativeColumn();
                            columns.ConstantColumn(40);
                            columns.ConstantColumn(80);
                            columns.ConstantColumn(40);
                            columns.ConstantColumn(80);
                        });

                        table.Header(header =>
                        {
                            header.Cell().Background(Colors.Grey.Lighten3).Padding(5).Text("#").Bold();
                            header.Cell().Background(Colors.Grey.Lighten3).Padding(5).Text("Ürün Adı").Bold();
                            header.Cell().Background(Colors.Grey.Lighten3).Padding(5).Text("Adet").Bold().AlignRight();
                            header.Cell().Background(Colors.Grey.Lighten3).Padding(5).Text("Birim Fiyat").Bold().AlignRight();
                            header.Cell().Background(Colors.Grey.Lighten3).Padding(5).Text("KDV").Bold().AlignCenter();
                            header.Cell().Background(Colors.Grey.Lighten3).Padding(5).Text("Satır Toplamı").Bold().AlignRight();
                        });

                        for (int i = 0; i < order.Lines.Count; i++)
                        {
                            var line = order.Lines[i];
                            var index = i + 1;
                            
                            table.Cell().BorderBottom(1).BorderColor(Colors.Grey.Lighten2).Padding(5).Text(index.ToString());
                            table.Cell().BorderBottom(1).BorderColor(Colors.Grey.Lighten2).Padding(5).Text(line.ProductName);
                            table.Cell().BorderBottom(1).BorderColor(Colors.Grey.Lighten2).Padding(5).Text(line.Quantity.ToString()).AlignRight();
                            table.Cell().BorderBottom(1).BorderColor(Colors.Grey.Lighten2).Padding(5).Text($"{line.UnitPrice:N2} TL").AlignRight();
                            table.Cell().BorderBottom(1).BorderColor(Colors.Grey.Lighten2).Padding(5).Text("%20").AlignCenter();
                            table.Cell().BorderBottom(1).BorderColor(Colors.Grey.Lighten2).Padding(5).Text($"{line.LineTotal:N2} TL").AlignRight();
                        }
                    });

                    col.Item().PaddingBottom(20);

                    col.Item().AlignRight().Width(250).Column(sumCol =>
                    {
                        sumCol.Item().Row(r =>
                        {
                            r.RelativeItem().Text("Ara Toplam (KDV Dahil):");
                            r.ConstantItem(80).Text($"{vatInclusiveSubtotal:N2} TL").AlignRight();
                        });
                        
                        if (order.CampaignDiscountAmount + order.DiscountAmount > 0)
                        {
                            sumCol.Item().Row(r =>
                            {
                                r.RelativeItem().Text("Uygulanan İndirimler (Birim Fiyatlara Yedirilmiştir):").FontSize(8).Italic().FontColor(Colors.Grey.Medium);
                                r.ConstantItem(80).Text($"-{(order.CampaignDiscountAmount + order.DiscountAmount):N2} TL").FontSize(8).Italic().FontColor(Colors.Grey.Medium).AlignRight();
                            });
                        }

                        sumCol.Item().Row(r =>
                        {
                            r.RelativeItem().Text("KDV Matrahı (Toplam KDV Hariç):");
                            r.ConstantItem(80).Text($"{vatExclusiveSubtotal:N2} TL").AlignRight();
                        });

                        sumCol.Item().Row(r =>
                        {
                            r.RelativeItem().Text("Hesaplanan KDV (%20):");
                            r.ConstantItem(80).Text($"{vatAmount:N2} TL").AlignRight();
                        });

                        sumCol.Item().Row(r =>
                        {
                            r.RelativeItem().Text("Kargo Ücreti (KDV Dahil):");
                            r.ConstantItem(80).Text(cargoFee == 0 ? "Ücretsiz" : $"{cargoFee:N2} TL").AlignRight();
                        });

                        sumCol.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                        sumCol.Item().PaddingTop(5);

                        sumCol.Item().Row(r =>
                        {
                            r.RelativeItem().Text("Ödenecek Tutar / Genel Toplam:").Bold().FontSize(11);
                            r.ConstantItem(80).Text($"{grandTotal:N2} TL").Bold().FontSize(11).AlignRight();
                        });
                    });
                });

                page.Footer().Column(footer =>
                {
                    footer.Item().LineHorizontal(1).LineColor(Colors.Grey.Lighten2);
                    footer.Item().PaddingTop(5);
                    footer.Item().Row(row =>
                    {
                        row.RelativeItem().Text("Bu fatura elektronik ortamda düzenlenmiştir. Sanal POS ile Kredi Kartı tahsilatı yapılmıştır.").FontSize(8).Italic().FontColor(Colors.Grey.Medium);
                        row.ConstantItem(100).AlignRight().Text(t =>
                        {
                            t.Span("Sayfa ").FontSize(8);
                            t.CurrentPageNumber().FontSize(8);
                        });
                    });
                });
            });
        });

        using var memoryStream = new MemoryStream();
        pdfData.GeneratePdf(memoryStream);
        return memoryStream.ToArray();
    }

    [Authorize]
    [HttpGet("{id:guid}/invoice")]
    public async Task<IActionResult> GetInvoice(Guid id, [FromQuery] bool download, CancellationToken cancellationToken)
    {
        var order = await _orders.GetByIdAsync(id, cancellationToken);
        if (order == null)
            return NotFound(new { success = false, message = "Sipariş bulunamadı." });

        bool isAdmin = User.IsInRole("Owner") || User.IsInRole("Admin") || User.HasClaim("permission", "orders");
        if (!isAdmin)
        {
            if (!Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) || order.CustomerId != userId)
            {
                return Forbid();
            }
        }

        var invoice = await _invoices.GetByOrderIdAsync(id, cancellationToken);
        if (invoice == null)
            return NotFound(new { success = false, message = "Bu siparişe ait fatura bulunamadı." });

        var fullPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", invoice.PdfPath.TrimStart('/'));
        if (!System.IO.File.Exists(fullPath))
            return NotFound(new { success = false, message = "Fatura PDF dosyası bulunamadı." });

        var fileBytes = await System.IO.File.ReadAllBytesAsync(fullPath, cancellationToken);
        
        var disposition = download ? "attachment" : "inline";
        Response.Headers.Append("Content-Disposition", $"{disposition}; filename=fatura_{order.OrderNo}.pdf");
        return File(fileBytes, "application/pdf");
    }
}

public class UpdateCargoStatusRequest
{
    public string OrderNo { get; set; } = string.Empty;
    public int Status { get; set; }
    public string? Detail { get; set; }
    public string? CustomerName { get; set; }
    public string? Carrier { get; set; }
    public string? TrackingNo { get; set; }
    public DateTime? ShippedAt { get; set; }
    public DateTime? DeliveryDate { get; set; }
}

public record EmailAttachmentDto(string FileName, string ContentType, byte[] Content);
