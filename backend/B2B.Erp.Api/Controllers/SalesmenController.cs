using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Salesmen;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class SalesmenController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public SalesmenController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <summary>
    /// Salesmen for a dropdown.
    ///
    /// <paramref name="cariOnly"/> narrows the list to the salesmen marked as customer-facing
    /// (<see cref="B2B.Erp.Api.Entities.User.IsCariPlasiyeri"/>), which is what the customer
    /// offer screen asks for.
    ///
    /// The narrowing is also FORCED for any requester bound to a single customer account,
    /// whatever they pass. Otherwise a cari could call this endpoint directly and read the
    /// firm's entire salesman list — the restriction has to hold at the endpoint, not only in
    /// the screen that happens to call it.
    /// </summary>
    [HttpGet("dropdown")]
    [Authorize]
    public async Task<IActionResult> GetDropdown([FromQuery] bool cariOnly = false, CancellationToken cancellationToken = default)
    {
        if (RequesterIsBoundToSingleCustomer())
        {
            cariOnly = true;
        }

        var salesmen = await _dbContext.Salesmen
            .AsNoTracking()
            .OrderBy(x => x.SalesmanCode)
            .ToListAsync(cancellationToken);

        var linkedUsers = await _dbContext.Users
            .AsNoTracking()
            .Where(u => u.SalesmanCode != null)
            .Select(u => new { u.SalesmanCode, DiscountRate = (double?)u.DiscountRate, u.IsCariPlasiyeri, u.IsActive })
            .ToListAsync(cancellationToken);

        var byCode = linkedUsers
            .Where(u => !string.IsNullOrWhiteSpace(u.SalesmanCode))
            .GroupBy(u => u.SalesmanCode!.Trim(), StringComparer.OrdinalIgnoreCase)
            // Aynı plasiyer koduna birden çok kullanıcı bağlı olabiliyor (çıkan personelin pasif
            // hesabı + yerine gelen aktif hesap). `First()` pasif olanı seçince aşağıdaki
            // `cariOnly` süzgeci o plasiyeri listeden tamamen düşürüyor ve iskonto oranı da eski
            // hesaptan okunuyordu — aktif ve cari plasiyeri olan hesap öne alınır.
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(u => u.IsActive)
                      .ThenByDescending(u => u.IsCariPlasiyeri)
                      .First(),
                StringComparer.OrdinalIgnoreCase);

        var data = salesmen
            .Select(x => new
            {
                Salesman = x,
                User = byCode.TryGetValue(x.SalesmanCode.Trim(), out var u) ? u : null
            })
            // A deactivated salesman account must not stay quotable by customers
            .Where(x => !cariOnly || (x.User is { IsCariPlasiyeri: true, IsActive: true }))
            .Select(x => new SalesmanDropdownItemResponse
            {
                SalesmanCode = x.Salesman.SalesmanCode,
                Description = x.Salesman.Description,
                DiscountRate = x.User?.DiscountRate
            })
            .ToList();

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// True when the signed-in account represents one specific customer. '*' and 'ALL' are the
    /// established wildcards for an office account that is not tied to a single cari.
    /// </summary>
    private bool RequesterIsBoundToSingleCustomer()
    {
        var code = (User.FindFirst("Carikodu")?.Value ?? string.Empty).Trim();

        return code.Length > 0
               && code != "*"
               && !code.Equals("ALL", StringComparison.OrdinalIgnoreCase);
    }
}
