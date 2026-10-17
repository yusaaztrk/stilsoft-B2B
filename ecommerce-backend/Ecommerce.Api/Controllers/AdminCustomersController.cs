using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Authorize(Policy = "perm:customers")]
[Route("api/admin/customers")]
public sealed class AdminCustomersController : ControllerBase
{
    private readonly EcommerceUsersRepository _users;

    public AdminCustomersController(EcommerceUsersRepository users)
    {
        _users = users;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var data = (await _users.ListCustomersAsync(cancellationToken)).Select(u => new
        {
            u.Id,
            u.Email,
            u.FullName,
            u.Phone,
            u.IsActive,
            u.CreatedAtUtc
        });

        return Ok(new { success = true, data });
    }

    public sealed class UpdateCustomerRequest
    {
        public string FullName { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update([FromRoute] Guid id, [FromBody] UpdateCustomerRequest request, CancellationToken cancellationToken)
    {
        if (id == Guid.Empty)
            return BadRequest(new { success = false, message = "id zorunlu" });

        try
        {
            await _users.UpdateCustomerAsync(id, request.FullName, request.Phone, null, cancellationToken);
            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    public sealed class SetActiveRequest
    {
        public bool IsActive { get; set; }
    }

    [HttpPut("{id:guid}/active")]
    public async Task<IActionResult> SetActive([FromRoute] Guid id, [FromBody] SetActiveRequest request, CancellationToken cancellationToken)
    {
        if (id == Guid.Empty)
            return BadRequest(new { success = false, message = "id zorunlu" });

        await _users.SetActiveAsync(id, request.IsActive, cancellationToken);
        return Ok(new { success = true });
    }

    [HttpGet("{id:guid}/details")]
    public async Task<IActionResult> GetDetails([FromRoute] Guid id, [FromServices] AdminModulesRepository modules, CancellationToken cancellationToken)
    {
        if (id == Guid.Empty)
            return BadRequest(new { success = false, message = "id zorunlu" });

        // 1. Get customer info
        var customerSql = "SELECT id, email, full_name AS \"fullName\", phone, is_active AS \"isActive\", created_at_utc AS \"createdAtUtc\" FROM ecommerce_users WHERE id = @Id AND role = 'Customer' LIMIT 1";
        var customers = await modules.QuerySqlAsync(customerSql, new { Id = id }, cancellationToken);
        if (customers.Count == 0)
            return NotFound(new { success = false, message = "Müşteri bulunamadı." });

        var customer = customers[0];
        var email = customer["email"]?.ToString() ?? string.Empty;
        var phone = customer["phone"]?.ToString() ?? string.Empty;

        // 2. Get addresses
        var addressSql = "SELECT id, title, full_name AS \"fullName\", phone, city, district, details, region, mahalle, bina_no AS \"binaNo\", daire_no AS \"daireNo\", kat_no AS \"katNo\" FROM member_addresses WHERE user_id = @Id ORDER BY created_at_utc DESC";
        var addresses = await modules.QuerySqlAsync(addressSql, new { Id = id }, cancellationToken);

        // 3. Get orders
        var ordersSql = "SELECT id, order_no AS \"orderNo\", created_at_utc AS \"createdAtUtc\", lines_json AS \"linesJson\", total, status, payment_status AS \"paymentStatus\" FROM orders WHERE customer_id = @Id OR email = @Email ORDER BY created_at_utc DESC";
        var orders = await modules.QuerySqlAsync(ordersSql, new { Id = id, Email = email }, cancellationToken);

        // 4. Get reviews
        var reviewsSql = "SELECT id, product_name AS \"productName\", rating, comment, status, admin_reply AS \"adminReply\", created_at_utc AS \"createdAtUtc\" FROM admin_reviews WHERE customer_email = @Email ORDER BY created_at_utc DESC";
        var reviews = await modules.QuerySqlAsync(reviewsSql, new { Email = email }, cancellationToken);

        // 5. Get technical service requests
        var serviceSql = "SELECT id, product_group AS \"productGroup\", model_no AS \"modelNo\", description, status, created_at_utc AS \"createdAt\" FROM technical_service_requests WHERE user_id = @Id OR (phone = @Phone AND phone != '' AND phone IS NOT NULL) ORDER BY created_at_utc DESC";
        var serviceRequests = await modules.QuerySqlAsync(serviceSql, new { Id = id, Phone = phone }, cancellationToken);

        // Format dates and structures
        var formattedServiceRequests = serviceRequests.Select(r => new
        {
            Id = r.TryGetValue("id", out var valId) ? valId : Guid.Empty,
            ProductGroup = r.TryGetValue("productGroup", out var pg) ? pg : string.Empty,
            ModelNo = r.TryGetValue("modelNo", out var mn) ? mn : string.Empty,
            Description = r.TryGetValue("description", out var desc) ? desc : string.Empty,
            Status = r.TryGetValue("status", out var st) ? st : "Bekliyor",
            CreatedAt = r.TryGetValue("createdAt", out var cd) && cd is DateTime dt ? dt.ToString("yyyy-MM-dd HH:mm") : string.Empty
        });

        var formattedReviews = reviews.Select(r => new
        {
            Id = r.TryGetValue("id", out var valId) ? valId : Guid.Empty,
            ProductName = r.TryGetValue("productName", out var pn) ? pn : string.Empty,
            Rating = r.TryGetValue("rating", out var rat) ? rat : 5,
            Comment = r.TryGetValue("comment", out var comm) ? comm : string.Empty,
            Status = r.TryGetValue("status", out var st) ? st : string.Empty,
            AdminReply = r.TryGetValue("adminReply", out var rep) ? rep : null,
            CreatedAt = r.TryGetValue("createdAtUtc", out var cd) && cd is DateTime dt ? dt.ToString("yyyy-MM-dd HH:mm") : string.Empty
        });

        var formattedOrders = orders.Select(r => new
        {
            Id = r.TryGetValue("id", out var valId) ? valId : Guid.Empty,
            OrderNo = r.TryGetValue("orderNo", out var ono) ? ono : string.Empty,
            CreatedAt = r.TryGetValue("createdAtUtc", out var cd) && cd is DateTime dt ? dt.ToString("yyyy-MM-dd HH:mm") : string.Empty,
            LinesJson = r.TryGetValue("linesJson", out var lj) ? lj : "[]",
            Total = r.TryGetValue("total", out var tot) ? tot : 0,
            Status = r.TryGetValue("status", out var st) ? st : string.Empty,
            PaymentStatus = r.TryGetValue("paymentStatus", out var ps) ? ps : string.Empty
        });

        var formattedCustomer = new
        {
            Id = customer.TryGetValue("id", out var cid) ? cid : id,
            Email = email,
            FullName = customer.TryGetValue("fullName", out var fn) ? fn : string.Empty,
            Phone = phone,
            IsActive = customer.TryGetValue("isActive", out var act) ? act : true,
            CreatedAtUtc = customer.TryGetValue("createdAtUtc", out var crt) ? crt : null
        };

        return Ok(new
        {
            success = true,
            data = new
            {
                Profile = formattedCustomer,
                Addresses = addresses,
                Orders = formattedOrders,
                Reviews = formattedReviews,
                ServiceRequests = formattedServiceRequests
            }
        });
    }
}
