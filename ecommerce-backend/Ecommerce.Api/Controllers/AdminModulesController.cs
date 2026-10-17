using System;
using System.Collections.Generic;
using System.Linq;
using Ecommerce.Api.Infrastructure;
using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/modules")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminModulesController : ControllerBase
{
    private readonly AdminModulesRepository _repo;
    private readonly LiveActivityService _live;

    public AdminModulesController(AdminModulesRepository repo, LiveActivityService live)
    {
        _repo = repo;
        _live = live;
    }

    // --- 1. INVOICES ENDPOINTS ---
    [HttpGet("invoices")]
    public async Task<IActionResult> GetInvoices(CancellationToken cancellationToken)
    {
        var sql = @"
            SELECT 
                i.id, 
                i.invoice_no AS ""invoiceNo"", 
                i.order_no AS ""orderNo"", 
                o.customer_name AS ""customerName"", 
                i.grand_total AS ""total"", 
                ROUND(i.grand_total - (i.grand_total / 1.20), 2) AS ""tax"", 
                'Paid' AS ""status"", 
                i.created_at_utc AS ""createdAtUtc"",
                o.id AS ""orderId""
            FROM invoices i
            JOIN orders o ON i.order_id = o.id
            ORDER BY i.created_at_utc DESC";
        var items = await _repo.QuerySqlAsync(sql, null, cancellationToken);
        return Ok(new { success = true, data = items });
    }

    // --- 2. PAYMENTS ENDPOINTS ---
    [HttpGet("payments")]
    public async Task<IActionResult> GetPayments(CancellationToken cancellationToken)
    {
        var sql = "SELECT id, txn_id AS \"txnId\", order_no AS \"orderNo\", customer_name AS \"customerName\", amount, method, status, created_at_utc AS \"createdAtUtc\" FROM admin_payments ORDER BY created_at_utc DESC";
        var items = await _repo.QuerySqlAsync(sql, null, cancellationToken);
        return Ok(new { success = true, data = items });
    }

    // --- 3. SHIPPING ENDPOINTS ---
    [HttpGet("shipping")]
    public async Task<IActionResult> GetShipping(CancellationToken cancellationToken)
    {
        var sql = @"
            SELECT 
                s.id, 
                s.order_no AS ""orderNo"", 
                s.customer_name AS ""customerName"", 
                s.carrier, 
                s.tracking_no AS ""trackingNo"", 
                s.shipped_at AS ""shippedAt"", 
                s.delivery_date AS ""deliveryDate"", 
                s.status,
                s.history_json AS ""historyJson"",
                o.address AS ""deliveryAddress"",
                o.lines_json AS ""linesJson"",
                o.created_at_utc AS ""orderDate"",
                o.email AS ""email"",
                o.phone AS ""phone"",
                o.total AS ""total"",
                o.payment_status AS ""paymentStatus"",
                o.discount_amount AS ""discountAmount"",
                o.coupon_code AS ""couponCode""
            FROM admin_shipping s
            LEFT JOIN orders o ON s.order_no = o.order_no
            ORDER BY s.shipped_at DESC";
        var items = await _repo.QuerySqlAsync(sql, null, cancellationToken);
        return Ok(new { success = true, data = items });
    }

    public sealed class UpdateShippingRequest
    {
        public string Carrier { get; set; } = "";
        public string TrackingNo { get; set; } = "";
        public string Status { get; set; } = "";
    }

    [HttpPut("shipping/{id:guid}")]
    public async Task<IActionResult> UpdateShipping(Guid id, [FromBody] UpdateShippingRequest request, CancellationToken cancellationToken)
    {
        var selectSql = "SELECT order_no, status, history_json FROM admin_shipping WHERE id = @Id";
        var rows = await _repo.QuerySqlAsync(selectSql, new { Id = id }, cancellationToken);
        if (rows.Count == 0) return NotFound(new { success = false, message = "Kargo kaydı bulunamadı." });

        var orderNo = rows[0]["orderno"]?.ToString() ?? "";
        var currentStatus = rows[0]["status"]?.ToString() ?? "";
        var existingHistory = rows[0]["historyjson"]?.ToString();

        var historyList = new List<object>();
        if (!string.IsNullOrEmpty(existingHistory))
        {
            try
            {
                var parsed = System.Text.Json.JsonSerializer.Deserialize<List<object>>(existingHistory);
                if (parsed != null) historyList.AddRange(parsed);
            }
            catch {}
        }

        string mappedStatusLabel = request.Status switch
        {
            "Received" => "Siparişiniz Alındı",
            "Planned" => "Planlandı",
            "Preparing" => "Hazırlanıyor",
            "InTransit" => "Dağıtımda",
            "Delivered" => "Teslim Edildi",
            "Delayed" => "Gecikmiş",
            "Shipped" => "Kargoda",
            _ => request.Status
        };

        if (currentStatus != request.Status)
        {
            historyList.Add(new
            {
                status = request.Status switch {
                    "Received" => 0,
                    "Planned" => 1,
                    "Preparing" => 2,
                    "InTransit" => 3,
                    "Shipped" => 3,
                    "Delivered" => 4,
                    _ => 0
                },
                statusLabel = mappedStatusLabel,
                detail = $"Kargo durumu admin tarafından güncellendi: {mappedStatusLabel}",
                actor = "Admin",
                timestamp = DateTime.UtcNow
            });
        }
        else
        {
            historyList.Add(new
            {
                status = request.Status switch {
                    "Received" => 0,
                    "Planned" => 1,
                    "Preparing" => 2,
                    "InTransit" => 3,
                    "Shipped" => 3,
                    "Delivered" => 4,
                    _ => 0
                },
                statusLabel = mappedStatusLabel,
                detail = $"Kargo bilgileri güncellendi (Kargo: {request.Carrier}, Takip No: {request.TrackingNo})",
                actor = "Admin",
                timestamp = DateTime.UtcNow
            });
        }

        var newHistoryJson = System.Text.Json.JsonSerializer.Serialize(historyList);
        string? deliveryDateSql = request.Status == "Delivered" ? ", delivery_date = @DeliveryDate" : "";
        var deliveryDate = request.Status == "Delivered" ? (object)DateTime.UtcNow : DBNull.Value;

        var updateSql = $@"
            UPDATE admin_shipping 
            SET carrier = @Carrier, tracking_no = @TrackingNo, status = @Status, history_json = @HistoryJson {deliveryDateSql} 
            WHERE id = @Id";

        await _repo.ExecuteSqlAsync(updateSql, new {
            id,
            request.Carrier,
            request.TrackingNo,
            request.Status,
            HistoryJson = newHistoryJson,
            DeliveryDate = deliveryDate
        }, cancellationToken);

        if (!string.IsNullOrEmpty(orderNo))
        {
            string orderStatus = request.Status switch
            {
                "Received" => "Siparişiniz Alındı",
                "Planned" => "Planlandı",
                "Preparing" => "Hazırlanıyor",
                "InTransit" => "Dağıtımda",
                "Shipped" => "Kargoda",
                "Delivered" => "Teslim Edildi",
                _ => "Siparişiniz Alındı"
            };

            var orderSql = "UPDATE orders SET status = @Status WHERE order_no = @OrderNo";
            await _repo.ExecuteSqlAsync(orderSql, new { Status = orderStatus, OrderNo = orderNo }, cancellationToken);
        }

        return Ok(new { success = true });
    }

    // --- 4. RETURNS ENDPOINTS ---
    [HttpGet("returns")]
    public async Task<IActionResult> GetReturns(CancellationToken cancellationToken)
    {
        var sql = "SELECT id, return_no AS \"returnNo\", order_no AS \"orderNo\", customer_name AS \"customerName\", product_name AS \"productName\", reason, amount, status, created_at_utc AS \"createdAtUtc\" FROM admin_returns ORDER BY created_at_utc DESC";
        var items = await _repo.QuerySqlAsync(sql, null, cancellationToken);
        return Ok(new { success = true, data = items });
    }

    public sealed class UpdateReturnRequest
    {
        public string Status { get; set; } = "";
    }

    [HttpPut("returns/{id:guid}")]
    public async Task<IActionResult> UpdateReturn(Guid id, [FromBody] UpdateReturnRequest request, CancellationToken cancellationToken)
    {
        var sql = "UPDATE admin_returns SET status = @Status WHERE id = @Id";
        var rows = await _repo.ExecuteSqlAsync(sql, new { id, request.Status }, cancellationToken);
        if (rows == 0) return NotFound(new { success = false, message = "İade kaydı bulunamadı." });
        return Ok(new { success = true });
    }

    // --- 5. REVIEWS ENDPOINTS ---
    [HttpGet("reviews")]
    public async Task<IActionResult> GetReviews(CancellationToken cancellationToken)
    {
        var sql = "SELECT id, product_id AS \"productId\", product_name AS \"productName\", customer_name AS \"customerName\", rating, comment, status, admin_reply AS \"adminReply\", created_at_utc AS \"createdAtUtc\" FROM admin_reviews ORDER BY created_at_utc DESC";
        var items = await _repo.QuerySqlAsync(sql, null, cancellationToken);
        return Ok(new { success = true, data = items });
    }

    public sealed class UpdateReviewStatusRequest
    {
        public string Status { get; set; } = "";
    }

    [HttpPut("reviews/{id:guid}/status")]
    public async Task<IActionResult> UpdateReviewStatus(Guid id, [FromBody] UpdateReviewStatusRequest request, CancellationToken cancellationToken)
    {
        var sql = "UPDATE admin_reviews SET status = @Status WHERE id = @Id";
        var rows = await _repo.ExecuteSqlAsync(sql, new { id, request.Status }, cancellationToken);
        if (rows == 0) return NotFound(new { success = false, message = "Yorum kaydı bulunamadı." });
        return Ok(new { success = true });
    }

    public sealed class UpdateReviewReplyRequest
    {
        public string Reply { get; set; } = "";
    }

    [HttpPut("reviews/{id:guid}/reply")]
    public async Task<IActionResult> UpdateReviewReply(Guid id, [FromBody] UpdateReviewReplyRequest request, CancellationToken cancellationToken)
    {
        var sql = "UPDATE admin_reviews SET admin_reply = @Reply WHERE id = @Id";
        var rows = await _repo.ExecuteSqlAsync(sql, new { id, Reply = request.Reply?.Trim() ?? "" }, cancellationToken);
        if (rows == 0) return NotFound(new { success = false, message = "Yorum kaydı bulunamadı." });
        return Ok(new { success = true });
    }

    [HttpDelete("reviews/{id:guid}")]
    public async Task<IActionResult> DeleteReview(Guid id, CancellationToken cancellationToken)
    {
        var checkSql = "SELECT status FROM admin_reviews WHERE id = @Id";
        var statusRows = await _repo.QuerySqlAsync(checkSql, new { id }, cancellationToken);
        if (statusRows.Count == 0) return NotFound(new { success = false, message = "Yorum bulunamadı." });

        var currentStatus = statusRows[0]["status"]?.ToString() ?? "";
        if (string.Equals(currentStatus, "Deleted", StringComparison.OrdinalIgnoreCase))
        {
            var deleteSql = "DELETE FROM admin_reviews WHERE id = @Id";
            await _repo.ExecuteSqlAsync(deleteSql, new { id }, cancellationToken);
            return Ok(new { success = true, message = "Yorum kalıcı olarak silindi." });
        }
        else
        {
            var softDeleteSql = "UPDATE admin_reviews SET status = 'Deleted' WHERE id = @Id";
            await _repo.ExecuteSqlAsync(softDeleteSql, new { id }, cancellationToken);
            return Ok(new { success = true, message = "Yorum silinenlere taşındı." });
        }
    }

    // --- 6. AFFILIATES ENDPOINTS ---
    public sealed class CreateAffiliateCouponRequest
    {
        public string Code { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty; // Brand/Person name
        public string DiscountType { get; set; } = "Percentage"; // "Percentage" or "FixedAmount"
        public decimal DiscountValue { get; set; }
        public decimal? MinOrderAmount { get; set; }
    }

    [HttpGet("affiliates")]
    public async Task<IActionResult> GetAffiliates(CancellationToken cancellationToken)
    {
        var sql = @"
        SELECT 
            c.id, 
            c.code, 
            c.discount_type AS ""discountType"", 
            c.discount_value AS ""discountValue"", 
            c.min_order_amount AS ""minOrderAmount"", 
            c.is_active AS ""isActive"", 
            c.description, 
            c.valid_from AS ""validFrom"", 
            c.valid_until AS ""validUntil"", 
            c.usage_limit AS ""usageLimit"",
            COALESCE(c.used_count, 0) AS ""usedCount"",
            COALESCE((SELECT SUM(discount_amount) FROM orders WHERE UPPER(coupon_code) = UPPER(c.code)), 0) AS ""totalDiscount""
        FROM coupons c
        ORDER BY c.created_at_utc DESC";
        var items = await _repo.QuerySqlAsync(sql, null, cancellationToken);
        return Ok(new { success = true, data = items });
    }

    [HttpPost("affiliates")]
    public async Task<IActionResult> CreateAffiliateCoupon([FromBody] CreateAffiliateCouponRequest request, CancellationToken cancellationToken)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { success = false, message = "Kupon kodu zorunludur." });

        var code = request.Code.Trim().ToUpperInvariant();

        // Check duplicate code
        var checkSql = "SELECT COUNT(*) FROM coupons WHERE UPPER(code) = @Code";
        var existsRows = await _repo.QuerySqlAsync(checkSql, new { Code = code }, cancellationToken);
        if (existsRows.Count > 0 && Convert.ToInt64(existsRows[0]["count"]) > 0)
        {
            return BadRequest(new { success = false, message = "Bu kupon kodu zaten tanımlanmış." });
        }

        var id = Guid.NewGuid();
        var sql = @"
        INSERT INTO coupons (id, code, user_id, discount_type, discount_value, min_order_amount, max_discount_amount, applicable_product_id, applicable_category_id, valid_from, valid_until, usage_limit, is_active, description, created_at_utc)
        VALUES (@Id, @Code, NULL, @DiscountType, @DiscountValue, @MinOrderAmount, NULL, NULL, NULL, @ValidFrom, @ValidUntil, 999999, true, @Description, (now() AT TIME ZONE 'utc'))";

        await _repo.ExecuteSqlAsync(sql, new {
            Id = id,
            Code = code,
            DiscountType = request.DiscountType,
            DiscountValue = request.DiscountValue,
            MinOrderAmount = request.MinOrderAmount ?? 0,
            ValidFrom = DateTime.UtcNow,
            ValidUntil = DateTime.UtcNow.AddYears(10),
            Description = request.Description
        }, cancellationToken);

        return Ok(new { success = true, id });
    }

    [HttpDelete("affiliates/{id:guid}")]
    public async Task<IActionResult> DeleteAffiliateCoupon(Guid id, CancellationToken cancellationToken)
    {
        var sql = "DELETE FROM coupons WHERE id = @Id";
        await _repo.ExecuteSqlAsync(sql, new { Id = id }, cancellationToken);
        return Ok(new { success = true, message = "Kupon başarıyla silindi." });
    }

    // --- 7. INTEGRATIONS ENDPOINTS ---
    [HttpGet("integrations")]
    public async Task<IActionResult> GetIntegrations(CancellationToken cancellationToken)
    {
        var sql = "SELECT key, value_json AS valueJson FROM admin_integrations";
        var rows = await _repo.QuerySqlAsync(sql, null, cancellationToken);
        var dict = rows.ToDictionary(x => (string)x["key"], x => (string)x["valuejson"]);
        return Ok(new { success = true, data = dict });
    }

    [HttpPut("integrations")]
    public async Task<IActionResult> SaveIntegrations([FromBody] Dictionary<string, string> request, CancellationToken cancellationToken)
    {
        foreach (var pair in request)
        {
            var sql = @"
            INSERT INTO admin_integrations (key, value_json)
            VALUES (@Key, @Value)
            ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json;";
            await _repo.ExecuteSqlAsync(sql, new { Key = pair.Key, Value = pair.Value }, cancellationToken);
        }
        return Ok(new { success = true });
    }

    // --- 8. NOTIFICATIONS ENDPOINTS ---
    [HttpGet("notifications")]
    public async Task<IActionResult> GetNotifications(CancellationToken cancellationToken)
    {
        var sql = "SELECT id, type, title, message, is_read AS \"isRead\", link, created_at_utc AS \"createdAtUtc\" FROM admin_notifications ORDER BY created_at_utc DESC";
        var items = await _repo.QuerySqlAsync(sql, null, cancellationToken);
        return Ok(new { success = true, data = items });
    }

    [HttpPost("notifications/read-all")]
    public async Task<IActionResult> ReadAllNotifications(CancellationToken cancellationToken)
    {
        var sql = "UPDATE admin_notifications SET is_read = true";
        await _repo.ExecuteSqlAsync(sql, null, cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPut("notifications/{id:guid}/read")]
    public async Task<IActionResult> ReadNotification(Guid id, CancellationToken cancellationToken)
    {
        var sql = "UPDATE admin_notifications SET is_read = true WHERE id = @Id";
        var rows = await _repo.ExecuteSqlAsync(sql, new { id }, cancellationToken);
        if (rows == 0) return NotFound(new { success = false, message = "Bildirim bulunamadı." });
        return Ok(new { success = true });
    }

    [HttpGet("low-stock")]
    public async Task<IActionResult> GetLowStockProducts([FromQuery] int minStock = 10, CancellationToken cancellationToken = default)
    {
        var sql = "SELECT erp_product_id AS \"id\", tenant_code AS \"tenantCode\", stock_code AS \"sku\", name, stock, image_url AS \"imageUrl\" FROM products WHERE stock <= @MinStock ORDER BY stock ASC";
        var items = await _repo.QuerySqlAsync(sql, new { MinStock = minStock }, cancellationToken);
        return Ok(new { success = true, data = items });
    }

    // --- 9. LIVE VIEW ENDPOINTS ---
    [HttpGet("dashboard")]
    public async Task<IActionResult> GetDashboardStats(CancellationToken cancellationToken)
    {
        // 1. KPI Stats
        var kpiSql = @"
        SELECT 
          (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status != 'Cancelled') as totalrevenue,
          (SELECT COUNT(*) FROM orders) as totalorders,
          (SELECT COUNT(*) FROM ecommerce_users WHERE role = 'Customer') as totalcustomers,
          (SELECT COALESCE(AVG(total), 0) FROM orders WHERE status != 'Cancelled') as avgorder,
          (SELECT COUNT(*) FROM products) as totalproducts,
          (SELECT COUNT(*) FROM newsletter_subscribers WHERE is_active = true) as totalsubscribers;";
        
        var kpiRows = await _repo.QuerySqlAsync(kpiSql, null, cancellationToken);
        var kpi = kpiRows.FirstOrDefault() ?? new Dictionary<string, object>();

        // 2. Weekly Sales (Last 14 Days)
        var weeklySql = @"
        SELECT 
          created_at_utc::date as orderdate,
          COALESCE(SUM(total), 0) as amount
        FROM orders 
        WHERE created_at_utc >= date_trunc('day', now()) - interval '13 days' AND status != 'Cancelled'
        GROUP BY created_at_utc::date
        ORDER BY created_at_utc::date ASC;";
        
        var weeklyRows = await _repo.QuerySqlAsync(weeklySql, null, cancellationToken);
        
        // Let's build a map of Date -> Amount
        var salesMap = new Dictionary<string, decimal>();
        foreach (var r in weeklyRows)
        {
            if (r.TryGetValue("orderdate", out var dtVal) && dtVal is DateTime dt)
            {
                var amt = r.TryGetValue("amount", out var amtVal) ? Convert.ToDecimal(amtVal) : 0m;
                salesMap[dt.ToString("yyyy-MM-dd")] = amt;
            }
        }

        // Generate the 7 days of this week and previous week
        var weeklySalesList = new List<object>();
        var dayNames = new[] { "Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt" };
        for (int i = 6; i >= 0; i--)
        {
            var curDate = DateTime.UtcNow.AddDays(-i);
            var prevDate = curDate.AddDays(-7);
            
            var curStr = curDate.ToString("yyyy-MM-dd");
            var prevStr = prevDate.ToString("yyyy-MM-dd");
            
            salesMap.TryGetValue(curStr, out var currentAmount);
            salesMap.TryGetValue(prevStr, out var previousAmount);
            
            var dayOfWeek = dayNames[(int)curDate.DayOfWeek];
            
            weeklySalesList.Add(new
            {
                day = dayOfWeek,
                current = currentAmount,
                previous = previousAmount
            });
        }

        // 2b. Daily Sales (Hourly blocks for today vs yesterday)
        var dailySql = @"
        SELECT 
          EXTRACT(HOUR FROM created_at_utc) as orderhour,
          created_at_utc::date as orderdate,
          COALESCE(SUM(total), 0) as amount
        FROM orders 
        WHERE created_at_utc >= date_trunc('day', now()) - interval '1 day' AND status != 'Cancelled'
        GROUP BY orderdate, orderhour;";

        var dailyRows = await _repo.QuerySqlAsync(dailySql, null, cancellationToken);
        var dailyMap = new Dictionary<string, decimal>();
        foreach (var r in dailyRows)
        {
            var hr = r.TryGetValue("orderhour", out var hrVal) ? Convert.ToInt32(hrVal) : 0;
            var dtStr = r.TryGetValue("orderdate", out var dtVal) && dtVal is DateTime dt ? dt.ToString("yyyy-MM-dd") : "";
            var amt = r.TryGetValue("amount", out var amtVal) ? Convert.ToDecimal(amtVal) : 0m;
            dailyMap[$"{dtStr}_{hr}"] = amt;
        }

        var dailySalesList = new List<object>();
        var todayStr = DateTime.UtcNow.ToString("yyyy-MM-dd");
        var yesterdayStr = DateTime.UtcNow.AddDays(-1).ToString("yyyy-MM-dd");
        for (int hr = 0; hr < 24; hr += 3)
        {
            decimal curAmt = 0;
            decimal prevAmt = 0;
            for (int subHr = 0; subHr < 3; subHr++)
            {
                dailyMap.TryGetValue($"{todayStr}_{hr + subHr}", out var cAmt);
                dailyMap.TryGetValue($"{yesterdayStr}_{hr + subHr}", out var pAmt);
                curAmt += cAmt;
                prevAmt += pAmt;
            }
            dailySalesList.Add(new
            {
                day = $"{hr:00}:00",
                current = curAmt,
                previous = prevAmt
            });
        }

        // 2c. Monthly Sales (Last 6 Months vs Previous Year same months)
        var monthlySql = @"
        SELECT 
          EXTRACT(MONTH FROM created_at_utc) as ordermonth,
          EXTRACT(YEAR FROM created_at_utc) as orderyear,
          COALESCE(SUM(total), 0) as amount
        FROM orders 
        WHERE created_at_utc >= date_trunc('month', now()) - interval '11 months' AND status != 'Cancelled'
        GROUP BY orderyear, ordermonth;";

        var monthlyRows = await _repo.QuerySqlAsync(monthlySql, null, cancellationToken);
        var monthlyMap = new Dictionary<string, decimal>();
        foreach (var r in monthlyRows)
        {
            var m = r.TryGetValue("ordermonth", out var mVal) ? Convert.ToInt32(mVal) : 0;
            var y = r.TryGetValue("orderyear", out var yVal) ? Convert.ToInt32(yVal) : 0;
            var amt = r.TryGetValue("amount", out var amtVal) ? Convert.ToDecimal(amtVal) : 0m;
            monthlyMap[$"{y}_{m}"] = amt;
        }

        var monthlySalesList = new List<object>();
        var monthNames = new[] { "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara" };
        for (int i = 5; i >= 0; i--)
        {
            var curMonthDate = DateTime.UtcNow.AddMonths(-i);
            var prevMonthDate = curMonthDate.AddYears(-1);

            var curKey = $"{curMonthDate.Year}_{curMonthDate.Month}";
            var prevKey = $"{prevMonthDate.Year}_{prevMonthDate.Month}";

            monthlyMap.TryGetValue(curKey, out var curAmt);
            monthlyMap.TryGetValue(prevKey, out var prevAmt);

            var monthName = monthNames[curMonthDate.Month - 1];
            monthlySalesList.Add(new
            {
                day = monthName,
                current = curAmt,
                previous = prevAmt
            });
        }

        // 3. Category Distribution (Primary categories)
        var catSql = @"
        SELECT 
          COALESCE(c.name, 'Diğer') as name,
          COUNT(DISTINCT p.erp_product_id) as count
        FROM products p
        LEFT JOIN product_category_map m ON p.erp_product_id = m.product_id
        LEFT JOIN categories c ON m.category_id = c.id AND c.parent_id IS NULL
        GROUP BY c.name
        ORDER BY count DESC;";
        
        var catRows = await _repo.QuerySqlAsync(catSql, null, cancellationToken);
        var categories = catRows.Select(x => new
        {
            name = x.TryGetValue("name", out var n) ? Convert.ToString(n) : "Diğer",
            count = x.TryGetValue("count", out var c) ? Convert.ToInt32(c) : 0
        }).ToList();

        // 4. Order Status Distribution
        var statusSql = @"SELECT status, COUNT(*) as count FROM orders GROUP BY status;";
        var statusRows = await _repo.QuerySqlAsync(statusSql, null, cancellationToken);
        var orderStatuses = statusRows.ToDictionary(
            x => x.TryGetValue("status", out var s) ? Convert.ToString(s) ?? "Pending" : "Pending",
            x => x.TryGetValue("count", out var c) ? Convert.ToInt32(c) : 0
        );

        // 5. Recent Orders (Last 5)
        var ordersSql = @"
        SELECT 
          order_no as orderno, 
          customer_name as customername, 
          total, 
          status, 
          created_at_utc as createdatutc 
        FROM orders 
        ORDER BY created_at_utc DESC 
        LIMIT 5;";
        
        var orderRows = await _repo.QuerySqlAsync(ordersSql, null, cancellationToken);
        var recentOrders = orderRows.Select(x => new
        {
            orderNo = x.TryGetValue("orderno", out var o) ? Convert.ToString(o) : "",
            customerName = x.TryGetValue("customername", out var cn) ? Convert.ToString(cn) : "",
            total = x.TryGetValue("total", out var t) ? Convert.ToDecimal(t) : 0m,
            status = x.TryGetValue("status", out var s) ? Convert.ToString(s) : "Pending",
            createdAtUtc = x.TryGetValue("createdatutc", out var ca) ? Convert.ToDateTime(ca) : DateTime.UtcNow
        }).ToList();

        // 6. Low Stock Products (Last 5)
        var stockSql = @"
        SELECT 
          name, 
          COALESCE(stock, 0) as stock 
        FROM products 
        ORDER BY COALESCE(stock, 0) ASC, name ASC 
        LIMIT 5;";
        
        var stockRows = await _repo.QuerySqlAsync(stockSql, null, cancellationToken);
        var lowStock = stockRows.Select(x => new
        {
            name = x.TryGetValue("name", out var n) ? Convert.ToString(n) : "",
            stock = x.TryGetValue("stock", out var s) ? Convert.ToInt32(s) : 0
        }).ToList();

        // 7. Recent Activities from Admin Logs (Last 5)
        var logsSql = @"
        SELECT 
          action, 
          details, 
          created_at as createdat 
        FROM admin_logs 
        ORDER BY created_at DESC 
        LIMIT 5;";
        
        var logRows = await _repo.QuerySqlAsync(logsSql, null, cancellationToken);
        var recentActivities = logRows.Select(x => new
        {
            action = x.TryGetValue("action", out var a) ? Convert.ToString(a) : "",
            details = x.TryGetValue("details", out var d) ? Convert.ToString(d) : "",
            createdAt = x.TryGetValue("createdat", out var c) ? Convert.ToDateTime(c) : DateTime.UtcNow
        }).ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                kpi = new
                {
                    totalRevenue = kpi.TryGetValue("totalrevenue", out var tr) ? Convert.ToDecimal(tr) : 0m,
                    totalOrders = kpi.TryGetValue("totalorders", out var to) ? Convert.ToInt32(to) : 0,
                    totalCustomers = kpi.TryGetValue("totalcustomers", out var tc) ? Convert.ToInt32(tc) : 0,
                    avgOrder = kpi.TryGetValue("avgorder", out var ao) ? Convert.ToDecimal(ao) : 0m,
                    totalProducts = kpi.TryGetValue("totalproducts", out var tp) ? Convert.ToInt32(tp) : 0,
                    totalSubscribers = kpi.TryGetValue("totalsubscribers", out var ts) ? Convert.ToInt32(ts) : 0
                },
                weeklySales = weeklySalesList,
                dailySales = dailySalesList,
                monthlySales = monthlySalesList,
                categories,
                orderStatuses,
                recentOrders,
                lowStock,
                recentActivities
            }
        });
    }

    [HttpGet("live")]
    public async Task<IActionResult> GetLiveView(CancellationToken cancellationToken)
    {
        var recent = _live.GetRecentEvents().Select(x => new
        {
            x.EventType,
            x.Visitor,
            x.Detail,
            x.City,
            time = x.Time
        }).ToList();

        // Calculate live KPIs
        var activeVisitors = recent.Select(x => x.Visitor).Distinct().Count();
        if (activeVisitors == 0) activeVisitors = 1;

        var pageViews = _live.GetPopularPages().Values.Sum();
        if (pageViews == 0) pageViews = 5;

        var cartCount = recent.Count(x => x.EventType == "cart");

        var ordersToday = 0;
        try
        {
            var sql = "SELECT COUNT(*) FROM orders WHERE created_at_utc >= date_trunc('day', now())";
            var rows = await _repo.QuerySqlAsync(sql, null, cancellationToken);
            if (rows.Count > 0 && rows[0].TryGetValue("count", out var countVal))
            {
                ordersToday = Convert.ToInt32(countVal);
            }
        }
        catch { }

        double conversionRate = activeVisitors > 0 ? ((double)ordersToday / activeVisitors) * 100 : 0.0;
        if (conversionRate == 0.0 && ordersToday > 0) conversionRate = 2.5;

        return Ok(new
        {
            success = true,
            data = new
            {
                recent,
                kpis = new
                {
                    activeVisitors,
                    pageViews,
                    conversionRate = $"{conversionRate:F1}%",
                    cartCount
                }
            }
        });
    }

    [HttpPost("live/event")]
    public IActionResult AddLiveEvent([FromBody] LiveActivityService.LiveEvent ev)
    {
        _live.AddEvent(ev.EventType, ev.Visitor, ev.Detail, ev.City);
        return Ok(new { success = true });
    }

    // --- 10. TECHNICAL SERVICE REQUESTS ENDPOINTS ---
    [HttpGet("service-requests")]
    public async Task<IActionResult> GetServiceRequests(CancellationToken cancellationToken)
    {
        var sql = "SELECT id, user_id AS \"userId\", full_name AS \"fullName\", phone, product_group AS \"productGroup\", model_no AS \"modelNo\", description, status, created_at_utc AS \"createdAt\" FROM technical_service_requests ORDER BY created_at_utc DESC";
        var items = await _repo.QuerySqlAsync(sql, null, cancellationToken);
        var formatted = items.Select(r => new
        {
            Id = (Guid)r["id"],
            UserId = r.TryGetValue("userId", out var uid) && uid is Guid u ? u : Guid.Empty,
            FullName = r["fullName"]?.ToString() ?? "",
            Phone = r["phone"]?.ToString() ?? "",
            ProductGroup = r["productGroup"]?.ToString() ?? "",
            ModelNo = r["modelNo"]?.ToString() ?? "",
            Description = r["description"]?.ToString() ?? "",
            Status = r["status"]?.ToString() ?? "Bekliyor",
            CreatedAt = r.TryGetValue("createdAt", out var cd) && cd is DateTime dt ? dt.ToString("yyyy-MM-dd HH:mm") : ""
        }).ToList();
        return Ok(new { success = true, data = formatted });
    }

    public sealed class UpdateServiceRequestStatusRequest
    {
        public string Status { get; set; } = "";
    }

    [HttpPut("service-requests/{id:guid}")]
    public async Task<IActionResult> UpdateServiceRequestStatus(Guid id, [FromBody] UpdateServiceRequestStatusRequest request, CancellationToken cancellationToken)
    {
        var sql = "UPDATE technical_service_requests SET status = @Status WHERE id = @Id";
        var rows = await _repo.ExecuteSqlAsync(sql, new { id, request.Status }, cancellationToken);
        if (rows == 0) return NotFound(new { success = false, message = "Talep bulunamadı." });
        return Ok(new { success = true });
    }

    [HttpDelete("service-requests/{id:guid}")]
    public async Task<IActionResult> DeleteServiceRequest(Guid id, CancellationToken cancellationToken)
    {
        var sql = "DELETE FROM technical_service_requests WHERE id = @Id";
        var rows = await _repo.ExecuteSqlAsync(sql, new { id }, cancellationToken);
        if (rows == 0) return NotFound(new { success = false, message = "Talep bulunamadı." });
        return Ok(new { success = true });
    }

    // --- 11. WARRANTIES ENDPOINTS ---
    [HttpGet("warranties")]
    public async Task<IActionResult> GetWarranties(CancellationToken cancellationToken)
    {
        var sql = "SELECT id, customer_name AS \"customerName\", customer_email AS \"customerEmail\", product_id AS \"productId\", product_name AS \"productName\", warranty_code AS \"warrantyCode\", warranty_months AS \"warrantyMonths\", sold_date AS \"soldDate\" FROM sold_product_warranties ORDER BY sold_date DESC";
        var rows = await _repo.QuerySqlAsync(sql, null, cancellationToken);

        var list = rows.Select(r => {
            var soldDate = r.TryGetValue("soldDate", out var d) && d is DateTime dt ? dt : DateTime.UtcNow;
            var months = r.TryGetValue("warrantyMonths", out var m) ? Convert.ToInt32(m) : 0;
            
            // Calculate remaining
            var now = DateTime.UtcNow;
            var endDate = soldDate.AddMonths(months);
            string remainingText;
            string status;
            if (now >= endDate)
            {
                remainingText = "Süresi Doldu";
                status = "expired";
            }
            else
            {
                int remMonths = 0;
                var tempDate = now;
                while (tempDate.AddMonths(1) <= endDate)
                {
                    tempDate = tempDate.AddMonths(1);
                    remMonths++;
                }
                int remDays = (endDate - tempDate).Days;
                
                if (remMonths > 0 && remDays > 0)
                    remainingText = $"{remMonths} Ay {remDays} Gün Kaldı";
                else if (remMonths > 0)
                    remainingText = $"{remMonths} Ay Kaldı";
                else
                    remainingText = $"{remDays} Gün Kaldı";
                
                status = "active";
            }

            return new {
                id = (Guid)r["id"],
                customerName = r["customerName"]?.ToString() ?? "",
                customerEmail = r["customerEmail"]?.ToString() ?? "",
                productId = (Guid)r["productId"],
                productName = r["productName"]?.ToString() ?? "",
                warrantyCode = r["warrantyCode"]?.ToString() ?? "",
                warrantyMonths = months,
                soldDate = soldDate.ToString("yyyy-MM-dd"),
                remainingText,
                status
            };
        }).ToList();

        return Ok(new { success = true, data = list });
    }

    // --- 12. COUPONS ENDPOINTS ---
    [HttpGet("coupons")]
    public async Task<IActionResult> GetCoupons(CancellationToken cancellationToken)
    {
        var sql = @"
        SELECT c.id, c.code, 
               c.discount_type AS ""discountType"", c.discount_value AS ""discountValue"",
               c.min_order_amount AS ""minOrderAmount"", c.max_discount_amount AS ""maxDiscountAmount"",
               c.applicable_product_id AS ""applicableProductId"", p.name AS ""productName"",
               c.applicable_category_id AS ""applicableCategoryId"", cat.name AS ""categoryName"",
               c.valid_from AS ""validFrom"", c.valid_until AS ""validUntil"",
               c.usage_limit AS ""usageLimit"", c.used_count AS ""usedCount"",
               c.is_active AS ""isActive"", c.description, c.created_at_utc AS ""createdAt""
        FROM coupons c
        LEFT JOIN products p ON c.applicable_product_id = p.erp_product_id
        LEFT JOIN categories cat ON c.applicable_category_id = cat.id
        ORDER BY c.created_at_utc DESC";
        var items = await _repo.QuerySqlAsync(sql, null, cancellationToken);

        // Fetch customer mappings
        var mapSql = @"
        SELECT cc.coupon_id AS ""couponId"", cc.user_id AS ""userId"", u.email AS ""userEmail"", u.full_name AS ""userFullName""
        FROM coupon_customers cc
        JOIN ecommerce_users u ON cc.user_id = u.id";
        var mappings = await _repo.QuerySqlAsync(mapSql, null, cancellationToken);

        // Group mappings by couponId
        var mappingsGrouped = mappings
            .GroupBy(m => (Guid)m["couponId"])
            .ToDictionary(
                g => g.Key,
                g => g.Select(m => (object)new {
                    userId = (Guid)m["userId"],
                    userEmail = m["userEmail"]?.ToString(),
                    userFullName = m["userFullName"]?.ToString()
                }).ToList()
            );

        var data = items.Select(c => {
            var id = (Guid)c["id"];
            mappingsGrouped.TryGetValue(id, out var userList);
            return new {
                id,
                code = c["code"]?.ToString(),
                discountType = c["discountType"]?.ToString(),
                discountValue = Convert.ToDecimal(c["discountValue"]),
                minOrderAmount = Convert.ToDecimal(c["minOrderAmount"]),
                maxDiscountAmount = c["maxDiscountAmount"] != null ? Convert.ToDecimal(c["maxDiscountAmount"]) : (decimal?)null,
                applicableProductId = c["applicableProductId"] != null ? (Guid)c["applicableProductId"] : (Guid?)null,
                productName = c["productName"]?.ToString(),
                applicableCategoryId = c["applicableCategoryId"] != null ? (Guid)c["applicableCategoryId"] : (Guid?)null,
                categoryName = c["categoryName"]?.ToString(),
                validFrom = c["validFrom"],
                validUntil = c["validUntil"],
                usageLimit = Convert.ToInt32(c["usageLimit"]),
                usedCount = Convert.ToInt32(c["usedCount"]),
                isActive = Convert.ToBoolean(c["isActive"]),
                description = c["description"]?.ToString(),
                createdAt = c["createdAt"],
                assignedUsers = userList ?? new List<object>()
            };
        }).ToList();

        return Ok(new { success = true, data });
    }

    public sealed class CouponSaveRequest
    {
        public string Code { get; set; } = string.Empty;
        public List<Guid> UserIds { get; set; } = new();
        public string DiscountType { get; set; } = "Percentage";
        public decimal DiscountValue { get; set; }
        public decimal MinOrderAmount { get; set; }
        public decimal? MaxDiscountAmount { get; set; }
        public Guid? ApplicableProductId { get; set; }
        public Guid? ApplicableCategoryId { get; set; }
        public DateTime ValidFrom { get; set; }
        public DateTime ValidUntil { get; set; }
        public int UsageLimit { get; set; } = 1;
        public bool IsActive { get; set; } = true;
        public string? Description { get; set; }
    }

    [HttpPost("coupons")]
    public async Task<IActionResult> CreateCoupon([FromBody] CouponSaveRequest request, CancellationToken cancellationToken)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { success = false, message = "Kupon kodu zorunludur." });

        var code = request.Code.Trim().ToUpperInvariant();

        // Check duplicate code
        var checkSql = "SELECT COUNT(*) FROM coupons WHERE UPPER(code) = @Code";
        var existsRows = await _repo.QuerySqlAsync(checkSql, new { Code = code }, cancellationToken);
        if (existsRows.Count > 0 && Convert.ToInt64(existsRows[0]["count"]) > 0)
        {
            return BadRequest(new { success = false, message = "Bu kupon kodu zaten tanımlanmış." });
        }

        var id = Guid.NewGuid();
        var sql = @"
        INSERT INTO coupons (id, code, user_id, discount_type, discount_value, min_order_amount, max_discount_amount, applicable_product_id, applicable_category_id, valid_from, valid_until, usage_limit, is_active, description)
        VALUES (@Id, @Code, NULL, @DiscountType, @DiscountValue, @MinOrderAmount, @MaxDiscountAmount, @ApplicableProductId, @ApplicableCategoryId, @ValidFrom, @ValidUntil, @UsageLimit, @IsActive, @Description)";

        await _repo.ExecuteSqlAsync(sql, new {
            Id = id,
            Code = code,
            DiscountType = request.DiscountType,
            DiscountValue = request.DiscountValue,
            MinOrderAmount = request.MinOrderAmount,
            MaxDiscountAmount = (object?)request.MaxDiscountAmount ?? DBNull.Value,
            ApplicableProductId = (object?)request.ApplicableProductId ?? DBNull.Value,
            ApplicableCategoryId = (object?)request.ApplicableCategoryId ?? DBNull.Value,
            ValidFrom = request.ValidFrom.ToUniversalTime(),
            ValidUntil = request.ValidUntil.ToUniversalTime(),
            UsageLimit = request.UsageLimit,
            IsActive = request.IsActive,
            Description = (object?)request.Description ?? DBNull.Value
        }, cancellationToken);

        // Insert new mappings
        if (request.UserIds != null && request.UserIds.Count > 0)
        {
            foreach (var uId in request.UserIds)
            {
                var mapInsertSql = "INSERT INTO coupon_customers (coupon_id, user_id) VALUES (@CouponId, @UserId) ON CONFLICT DO NOTHING";
                await _repo.ExecuteSqlAsync(mapInsertSql, new { CouponId = id, UserId = uId }, cancellationToken);
            }
        }

        // Log action
        try
        {
            var userEmail = User.Identity?.Name ?? "Admin";
            var logSql = "INSERT INTO admin_logs (id, user_email, action, details, ip_address, created_at) VALUES (@LogId, @Email, 'Kupon Tanımlandı', @Details, '127.0.0.1', (now() AT TIME ZONE 'utc'))";
            await _repo.ExecuteSqlAsync(logSql, new { LogId = Guid.NewGuid(), Email = userEmail, Details = $"Yeni kupon oluşturuldu: {code} ({request.DiscountType} - {request.DiscountValue})" }, cancellationToken);
        }
        catch {}

        return Ok(new { success = true, id });
    }

    [HttpPut("coupons/{id:guid}")]
    public async Task<IActionResult> UpdateCoupon(Guid id, [FromBody] CouponSaveRequest request, CancellationToken cancellationToken)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Code))
            return BadRequest(new { success = false, message = "Kupon kodu zorunludur." });

        var code = request.Code.Trim().ToUpperInvariant();

        // Check duplicate code (excluding current id)
        var checkSql = "SELECT COUNT(*) FROM coupons WHERE UPPER(code) = @Code AND id != @Id";
        var existsRows = await _repo.QuerySqlAsync(checkSql, new { Code = code, Id = id }, cancellationToken);
        if (existsRows.Count > 0 && Convert.ToInt64(existsRows[0]["count"]) > 0)
        {
            return BadRequest(new { success = false, message = "Bu kupon kodu başka bir kupon tarafından kullanılıyor." });
        }

        var sql = @"
        UPDATE coupons
        SET code = @Code, discount_type = @DiscountType, discount_value = @DiscountValue,
            min_order_amount = @MinOrderAmount, max_discount_amount = @MaxDiscountAmount,
            applicable_product_id = @ApplicableProductId, applicable_category_id = @ApplicableCategoryId,
            valid_from = @ValidFrom, valid_until = @ValidUntil, usage_limit = @UsageLimit,
            is_active = @IsActive, description = @Description
        WHERE id = @Id";

        var rows = await _repo.ExecuteSqlAsync(sql, new {
            Id = id,
            Code = code,
            DiscountType = request.DiscountType,
            DiscountValue = request.DiscountValue,
            MinOrderAmount = request.MinOrderAmount,
            MaxDiscountAmount = (object?)request.MaxDiscountAmount ?? DBNull.Value,
            ApplicableProductId = (object?)request.ApplicableProductId ?? DBNull.Value,
            ApplicableCategoryId = (object?)request.ApplicableCategoryId ?? DBNull.Value,
            ValidFrom = request.ValidFrom.ToUniversalTime(),
            ValidUntil = request.ValidUntil.ToUniversalTime(),
            UsageLimit = request.UsageLimit,
            IsActive = request.IsActive,
            Description = (object?)request.Description ?? DBNull.Value
        }, cancellationToken);

        if (rows == 0) return NotFound(new { success = false, message = "Kupon bulunamadı." });

        // Delete existing mappings
        var deleteMapSql = "DELETE FROM coupon_customers WHERE coupon_id = @CouponId";
        await _repo.ExecuteSqlAsync(deleteMapSql, new { CouponId = id }, cancellationToken);

        // Insert new mappings
        if (request.UserIds != null && request.UserIds.Count > 0)
        {
            foreach (var uId in request.UserIds)
            {
                var mapInsertSql = "INSERT INTO coupon_customers (coupon_id, user_id) VALUES (@CouponId, @UserId) ON CONFLICT DO NOTHING";
                await _repo.ExecuteSqlAsync(mapInsertSql, new { CouponId = id, UserId = uId }, cancellationToken);
            }
        }

        // Log action
        try
        {
            var userEmail = User.Identity?.Name ?? "Admin";
            var logSql = "INSERT INTO admin_logs (id, user_email, action, details, ip_address, created_at) VALUES (@LogId, @Email, 'Kupon Güncellendi', @Details, '127.0.0.1', (now() AT TIME ZONE 'utc'))";
            await _repo.ExecuteSqlAsync(logSql, new { LogId = Guid.NewGuid(), Email = userEmail, Details = $"Kupon güncellendi: {code}" }, cancellationToken);
        }
        catch {}

        return Ok(new { success = true });
    }

    [HttpDelete("coupons/{id:guid}")]
    public async Task<IActionResult> DeleteCoupon(Guid id, CancellationToken cancellationToken)
    {
        // Get code for logging
        string code = id.ToString();
        try
        {
            var getSql = "SELECT code FROM coupons WHERE id = @Id";
            var rowsGet = await _repo.QuerySqlAsync(getSql, new { Id = id }, cancellationToken);
            if (rowsGet.Count > 0)
            {
                code = rowsGet[0]["code"]?.ToString() ?? code;
            }
        }
        catch {}

        var sql = "DELETE FROM coupons WHERE id = @Id";
        var rows = await _repo.ExecuteSqlAsync(sql, new { id }, cancellationToken);
        if (rows == 0) return NotFound(new { success = false, message = "Kupon bulunamadı." });

        // Log action
        try
        {
            var userEmail = User.Identity?.Name ?? "Admin";
            var logSql = "INSERT INTO admin_logs (id, user_email, action, details, ip_address, created_at) VALUES (@LogId, @Email, 'Kupon Silindi', @Details, '127.0.0.1', (now() AT TIME ZONE 'utc'))";
            await _repo.ExecuteSqlAsync(logSql, new { LogId = Guid.NewGuid(), Email = userEmail, Details = $"Kupon silindi: {code}" }, cancellationToken);
        }
        catch {}

        return Ok(new { success = true });
    }

    [HttpGet("registered-products")]
    public async Task<IActionResult> GetRegisteredProducts(CancellationToken cancellationToken)
    {
        var sql = @"
            SELECT rp.id, rp.serial_number AS ""serialNumber"", rp.created_at_utc AS ""createdAtUtc"",
                   p.erp_product_id AS ""productId"", COALESCE(p.name, rp.product_name) AS ""productName"", p.image_url AS ""imageUrl"",
                   u.id AS ""userId"", u.full_name AS ""fullName"", u.email, u.phone, u.created_at_utc AS ""userCreatedAtUtc""
            FROM registered_products rp
            JOIN ecommerce_users u ON rp.user_id = u.id
            LEFT JOIN products p ON rp.product_id = p.erp_product_id
            ORDER BY rp.created_at_utc DESC";
        var items = await _repo.QuerySqlAsync(sql, null, cancellationToken);
        return Ok(new { success = true, data = items });
    }
}
