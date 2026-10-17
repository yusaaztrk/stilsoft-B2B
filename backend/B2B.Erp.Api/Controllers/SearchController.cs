using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.DTOs.Search;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class SearchController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public SearchController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string? query, [FromQuery] int take = 12, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 30);

        var qRaw = string.IsNullOrWhiteSpace(query) ? null : query.Trim();
        if (string.IsNullOrWhiteSpace(qRaw) || qRaw.Length < 2)
        {
            return Ok(new GlobalSearchResponse
            {
                Success = true,
                Data = new GlobalSearchData { Items = new List<GlobalSearchItem>() }
            });
        }

        // CARİ KAPSAMI TEK KAYNAKTAN OKUNUR: `CustomerScope`.
        //
        // Burada claim ham metin olarak TEK BİR cari kodu sanılıyordu. Oysa `Carikodu`
        // (bkz. Core/Authorization/CustomerScope.cs):
        //   • BOŞ  → SINIRSIZ (erişim yok DEĞİL)
        //   • '*' / 'ALL' → sınırsız
        //   • virgüllü liste → plasiyer portföyü
        //
        // Sonuçları şunlardı: (a) kendisine cari atanmamış ofis/muhasebe personeli arama
        // kutusunda HİÇBİR sonuç göremiyordu (boş = sınırsız olması gerekirken boş liste
        // dönülüyordu); (b) '*' taşıyan hesapta '*' düz metin kod sanılıp hiçbir şeye
        // eşleşmiyordu; (c) virgüllü portföy tek kod gibi okunduğu için plasiyerin araması
        // da boş dönüyordu. Şube/alt hesap genişletmesi de elle ve eksikti (yalnız
        // ParentCustomerCode; -1/-2/-3 alt hesapları atlanıyordu) — faturalar o alt
        // hesaplara yazıldığı için arama onları bulamazdı.
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var isUnrestricted = isSuperAdmin || CustomerScope.IsUnrestrictedFor(User);

        List<string>? allowedCustomerCodes = null;
        if (!isUnrestricted)
        {
            var scopeCodes = CustomerScope.Of(User);
            allowedCustomerCodes = await CustomerScope.ExpandAsync(
                _dbContext.Customers.AsNoTracking(), scopeCodes, cancellationToken);

            // Kapsam tanımlı ama hiçbir koda genişlemiyorsa gösterilecek bir şey yok.
            if (allowedCustomerCodes.Count == 0)
            {
                return Ok(new GlobalSearchResponse
                {
                    Success = true,
                    Data = new GlobalSearchData { Items = new List<GlobalSearchItem>() }
                });
            }
        }

        var q = qRaw.ToLowerInvariant();

        // Invoices: match by invoice no prefix first (fast) then contains
        var invoiceLinesQuery = _dbContext.Set<InvoiceLine>().AsNoTracking();

        var invoicesBase =
            from inv in _dbContext.Set<Invoice>().AsNoTracking()
            join cust in _dbContext.Customers.AsNoTracking() on inv.CustomerCode equals cust.CustomerCode into custJoin
            from cust in custJoin.DefaultIfEmpty()
            where invoiceLinesQuery.Any(l => l.InvoiceId == inv.Id)
            where isUnrestricted || (allowedCustomerCodes != null && allowedCustomerCodes.Contains(inv.CustomerCode))
            select new
            {
                inv.Id,
                inv.InvoiceNo,
                inv.Date,
                CustomerName = cust != null ? cust.Name : string.Empty
            };

        var invoicesQuery = invoicesBase
            .Where(x => x.InvoiceNo.ToLower().StartsWith(q) || x.InvoiceNo.ToLower().Contains(q) || x.CustomerName.ToLower().Contains(q))
            .OrderByDescending(x => x.Date)
            .ThenByDescending(x => x.InvoiceNo)
            .Take(take)
            .Select(x => new GlobalSearchItem
            {
                Type = "invoice",
                Key = $"invoice:{x.Id}",
                Title = $"Fatura: {x.InvoiceNo}",
                Subtitle = string.IsNullOrWhiteSpace(x.CustomerName) ? x.Date.ToString("yyyy-MM-dd") : $"{x.CustomerName} • {x.Date:yyyy-MM-dd}",
                Href = $"/invoice/fatura-dokumu/{x.Id}"
            });

        var items = await invoicesQuery.ToListAsync(cancellationToken);

        return Ok(new GlobalSearchResponse
        {
            Success = true,
            Data = new GlobalSearchData { Items = items }
        });
    }
}
