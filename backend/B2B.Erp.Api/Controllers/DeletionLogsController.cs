using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.DTOs.DeletionLogs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using B2B.Erp.Api.Entities;
using System.Text.Json;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class DeletionLogsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public DeletionLogsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    [AuthorizePage("users", "silinenKayitlar")]
    public async Task<IActionResult> GetAll(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? q = null,
        [FromQuery] DateTime? deletedDate = null,
        [FromQuery] string? deletedBy = null,
        [FromQuery] string? moduleKey = null,
        [FromQuery] string? pageKey = null,
        [FromQuery] string? recordType = null,
        [FromQuery] string? parentType = null,
        CancellationToken cancellationToken = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _dbContext.Set<B2B.Erp.Api.Entities.DeletionLog>().AsNoTracking().AsQueryable();

        if (deletedDate.HasValue)
        {
            var day = DateTime.SpecifyKind(deletedDate.Value.Date, DateTimeKind.Utc);
            var next = day.AddDays(1);
            query = query.Where(x => x.CreateTime >= day && x.CreateTime < next);
        }

        static List<string> SplitCsv(string? s) =>
            string.IsNullOrWhiteSpace(s)
                ? new List<string>()
                : s.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

        var deletedByList = SplitCsv(deletedBy);
        if (deletedByList.Count > 0)
        {
            query = query.Where(x => deletedByList.Contains(x.CreateUser));
        }

        var moduleKeyList = SplitCsv(moduleKey);
        if (moduleKeyList.Count > 0)
        {
            query = query.Where(x => moduleKeyList.Contains(x.ModuleKey));
        }

        var pageKeyList = SplitCsv(pageKey);
        if (pageKeyList.Count > 0)
        {
            query = query.Where(x => pageKeyList.Contains(x.PageKey));
        }

        var recordTypeList = SplitCsv(recordType);
        if (recordTypeList.Count > 0)
        {
            query = query.Where(x => recordTypeList.Contains(x.RecordType));
        }

        var parentTypeList = SplitCsv(parentType);
        if (parentTypeList.Count > 0)
        {
            query = query.Where(x => x.ParentType != null && parentTypeList.Contains(x.ParentType));
        }

        var term = string.IsNullOrWhiteSpace(q) ? null : q.Trim().ToLowerInvariant();
        if (!string.IsNullOrWhiteSpace(term))
        {
            query = query.Where(x =>
                x.ModuleKey.ToLower().Contains(term) ||
                x.PageKey.ToLower().Contains(term) ||
                x.RecordType.ToLower().Contains(term) ||
                x.RecordId.ToLower().Contains(term) ||
                (x.ParentType != null && x.ParentType.ToLower().Contains(term)) ||
                (x.ParentId != null && x.ParentId.ToLower().Contains(term)) ||
                (x.Description != null && x.Description.ToLower().Contains(term)) ||
                (x.Reason != null && x.Reason.ToLower().Contains(term)) ||
                x.CreateUser.ToLower().Contains(term)
            );
        }

        var total = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(x => x.CreateTime)
            .ThenByDescending(x => x.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new DeletionLogResponse
            {
                Id = x.Id,
                ModuleKey = x.ModuleKey,
                PageKey = x.PageKey,
                RecordType = x.RecordType,
                RecordId = x.RecordId,
                ParentType = x.ParentType,
                ParentId = x.ParentId,
                Description = x.Description,
                DeletedBy = x.CreateUser,
                DeletedAt = x.CreateTime,
                DetailsJson = x.DetailsJson,
                Reason = x.Reason
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = new { items, total, page, pageSize } });
    }

    [HttpGet("facets")]
    [AuthorizePage("users", "silinenKayitlar")]
    public async Task<IActionResult> GetFacets([FromQuery] string? q = null, [FromQuery] DateTime? deletedDate = null, CancellationToken cancellationToken = default)
    {
        var query = _dbContext.Set<B2B.Erp.Api.Entities.DeletionLog>().AsNoTracking().AsQueryable();

        if (deletedDate.HasValue)
        {
            var day = DateTime.SpecifyKind(deletedDate.Value.Date, DateTimeKind.Utc);
            var next = day.AddDays(1);
            query = query.Where(x => x.CreateTime >= day && x.CreateTime < next);
        }

        var term = string.IsNullOrWhiteSpace(q) ? null : q.Trim().ToLowerInvariant();
        if (!string.IsNullOrWhiteSpace(term))
        {
            query = query.Where(x =>
                x.ModuleKey.ToLower().Contains(term) ||
                x.PageKey.ToLower().Contains(term) ||
                x.RecordType.ToLower().Contains(term) ||
                x.RecordId.ToLower().Contains(term) ||
                (x.ParentType != null && x.ParentType.ToLower().Contains(term)) ||
                (x.ParentId != null && x.ParentId.ToLower().Contains(term)) ||
                (x.Description != null && x.Description.ToLower().Contains(term)) ||
                x.CreateUser.ToLower().Contains(term)
            );
        }

        var deletedBy = await query.Select(x => x.CreateUser).Distinct().OrderBy(x => x).ToListAsync(cancellationToken);
        var moduleKeys = await query.Select(x => x.ModuleKey).Distinct().OrderBy(x => x).ToListAsync(cancellationToken);
        var pageKeys = await query.Select(x => x.PageKey).Distinct().OrderBy(x => x).ToListAsync(cancellationToken);
        var recordTypes = await query.Select(x => x.RecordType).Distinct().OrderBy(x => x).ToListAsync(cancellationToken);
        var parentTypes = await query.Where(x => x.ParentType != null).Select(x => x.ParentType!).Distinct().OrderBy(x => x).ToListAsync(cancellationToken);

        return Ok(new { success = true, data = new { deletedBy, moduleKeys, pageKeys, recordTypes, parentTypes } });
    }
    [HttpPost("restore/{id:int}")]
    [AuthorizePage("users", "silinenKayitlar")]
    public async Task<IActionResult> Restore([FromRoute] int id, CancellationToken cancellationToken)
    {
        return BadRequest(new { success = false, message = "Silinen kayıtlar geri yüklenemez. Sadece detayları görüntülenebilir." });
    }

    private void CreateStockMovementsForInvoice(AppDbContext dbContext, Invoice invoice, List<InvoiceLine> lines)
    {
        var movements = new List<StockMovement>();
        var subtotal = invoice.Subtotal;
        var discount = invoice.Discount;
        var discountFactor = subtotal == 0 ? 1m : (1m - (discount / subtotal));

        var firstWh = dbContext.Warehouses.AsNoTracking().Select(w => w.WarehouseCode).FirstOrDefault();
        var validWhCode = firstWh != 0 ? firstWh : 1;
        if (firstWh == 0 && !dbContext.Warehouses.Any(w => w.WarehouseCode == 1))
        {
            dbContext.Warehouses.Add(new Warehouse { WarehouseCode = 1, Name = "Ana Depo", IsActive = true });
            dbContext.SaveChanges();
        }

        foreach (var line in lines)
        {
            movements.Add(new StockMovement
            {
                InvoiceNo = invoice.InvoiceNo,
                CustomerCode = invoice.CustomerCode ?? "",
                DeliveryCustomerCode = invoice.DeliveryCustomerCode ?? "",
                StockCode = line.StockCode,
                Direction = StockMovementDirection.Out,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                // Kalem kendi çıkış deposunu taşıyorsa oraya iade edilir. Sabit "ilk depo"
                // düşüşü, servisten gelip teknisyenin aracından çıkmış bir kalemi merkez depoya
                // geri yazıyordu: iki depo birden bozuluyordu.
                WarehouseCode = line.WarehouseCode ?? validWhCode,
                NetUnitPrice = line.UnitPrice * discountFactor,
                VatRate = line.VatRate,
                Delivered = true,
                Date = invoice.Date,
                LineNo = line.LineNo,
                CreateUser = invoice.CreateUser,
                CreateTime = DateTime.UtcNow
            });
        }

        dbContext.Set<StockMovement>().AddRange(movements);
    }

    private void CreateStockMovementsForPurchaseInvoice(AppDbContext dbContext, PurchaseInvoice invoice)
    {
        if (invoice.Kind == PurchaseInvoiceKind.Purchase && invoice.TerminStatus == PurchaseInvoiceTerminStatus.Waiting)
        {
            return;
        }

        var docNo = (invoice.DocumentNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(docNo)) return;

        var customerCode = (invoice.CustomerCode ?? string.Empty).Trim();
        var date = invoice.Date.Kind == DateTimeKind.Utc ? invoice.Date : DateTime.SpecifyKind(invoice.Date, DateTimeKind.Utc);

        // `StockMovement`ta para birimi kolonu YOK; tasarım gereği TL taşır. Alış faturasının
        // kalem fiyatı ise faturanın KENDİ parasındadır. Geri yüklerken ham yazılıyordu:
        // 100 $'lık ürünün stok maliyeti 3.800 ₺ yerine 100 ₺ düşüyor, envanter değerlemesi
        // ~38 kat çöküyordu. Faturanın DONMUŞ kuru kullanılır (bugünün kuru değil).
        // Kardeş yol: PurchaseInvoicesController.ReplaceStockMovementsForPurchaseInvoice.
        var stockRate = invoice.ExchangeRate > 0m ? invoice.ExchangeRate : 1m;

        var movements = new List<StockMovement>();
        foreach (var l in invoice.Lines)
        {
            if (!l.WarehouseCode.HasValue) continue;

            var qty = l.Quantity;
            var unitPrice = Math.Round(l.UnitPrice * stockRate, 4, MidpointRounding.AwayFromZero);

            var baseTotal = qty * unitPrice;
            var disc = 0m;
            // Tutar indirimi de faturanın parasında; TL'ye çevrilmeden TL brütten düşülemez.
            // Oransal indirim etkilenmez (oran birimsiz). Tutar indirimi ADET BAŞINADIR — qty
            // ile çarpılmazsa stok maliyeti (netUnitPrice) olması gerekenden yüksek çıkar
            // (2026-09-10, kardeş yol PurchaseInvoicesController.ReplaceStockMovementsForPurchaseInvoice
            // ile aynı hata).
            if (l.DiscountType == PurchaseInvoiceLineDiscountType.Amount) disc = Math.Max(0m, l.DiscountValue * stockRate * qty);
            if (l.DiscountType == PurchaseInvoiceLineDiscountType.Percentage) disc = Math.Max(0m, (baseTotal * l.DiscountValue) / 100m);
            if (disc > baseTotal) disc = baseTotal;

            var netTotal = baseTotal - disc;
            var netUnitPrice = qty == 0m ? unitPrice : netTotal / qty;

            movements.Add(new StockMovement
            {
                InvoiceNo = docNo,
                CustomerCode = customerCode,
                DeliveryCustomerCode = customerCode,
                StockCode = l.StockCode,
                Direction = StockMovementDirection.In,
                Quantity = qty,
                UnitPrice = unitPrice,
                NetUnitPrice = netUnitPrice,
                VatRate = l.VatRate,
                BagNo = string.Empty,
                SalesmanCode = invoice.SalesmanCode,
                WarehouseCode = l.WarehouseCode.Value,
                Delivered = true,
                Date = date,
                LineNo = l.LineNo,
                CreateUser = invoice.CreateUser,
                CreateTime = DateTime.UtcNow
            });
        }

        dbContext.Set<StockMovement>().AddRange(movements);
    }
}

public class MuhtelifCustomerRestoreDto
{
    public string OwnerCustomerCode { get; set; } = string.Empty;
    public string? CustomerCode { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? City { get; set; }
    public string? District { get; set; }
    public string? Address { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? TaxOffice { get; set; }
    public string? TaxNumber { get; set; }
}

public class BayiMuhtelifCustomerRestoreDto
{
    public string OwnerCustomerCode { get; set; } = string.Empty;
    public string? CustomerCode { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? City { get; set; }
    public string? District { get; set; }
    public string? Address { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? TaxOffice { get; set; }
    public string? TaxNumber { get; set; }
}

public class InvoiceLineRestoreDto
{
    public int? SalesOrderLineId { get; set; }
    public int? SourcePurchaseInvoiceLineId { get; set; }
    public string StockCode { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public int CurrencyTypeId { get; set; }
    public decimal CurrencyRate { get; set; }
    public decimal CurrencyUnitPrice { get; set; }
    public decimal VatRate { get; set; }
    public int LineNo { get; set; }

    /// <summary>
    /// Kalemin çıkış deposu. Geri yüklemede stok hareketi bu depoya yazılır — silinen faturadaki
    /// kalemler farklı depolardan çıkmış olabiliyor (servisten gelen kalem teknisyenin aracından).
    /// </summary>
    public int? WarehouseCode { get; set; }
}

public class CashTransactionRestoreDto
{
    public int CashAccountId { get; set; }
    public DateTime Date { get; set; }
    public CashAccountTransactionDirection Direction { get; set; }
    public decimal Amount { get; set; }
    public int CurrencyTypeId { get; set; }
    public decimal CurrencyRate { get; set; }
    public decimal CurrencyAmount { get; set; }
    public CashAccountTransactionCounterpartyType CounterpartyType { get; set; }
    public string CounterpartyCode { get; set; } = string.Empty;
    public string CounterpartyName { get; set; } = string.Empty;
    public CashAccountTransactionReferenceType? ReferenceType { get; set; }
    public int? ReferenceId { get; set; }
    public string? Description { get; set; }
    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }
}

public class BankTransactionRestoreDto
{
    public int BankAccountDefinitionId { get; set; }
    public DateTime Date { get; set; }
    public BankAccountTransactionDirection Direction { get; set; }
    public decimal Amount { get; set; }
    public int CurrencyTypeId { get; set; }
    public decimal CurrencyRate { get; set; }
    public decimal CurrencyAmount { get; set; }
    public BankAccountTransactionCounterpartyType CounterpartyType { get; set; }
    public string CounterpartyCode { get; set; } = string.Empty;
    public string CounterpartyName { get; set; } = string.Empty;
    public string? DocumentNo { get; set; }
    public string? Description { get; set; }
    public bool IsPosFee { get; set; }
    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }
}

public class CustomerLedgerEntryRestoreDto
{
    public string CustomerCode { get; set; } = string.Empty;
    public DateTime Date { get; set; }
    public DateTime DueDate { get; set; }
    public CustomerLedgerEntryDirection Direction { get; set; }
    public decimal Amount { get; set; }
    public int CurrencyTypeId { get; set; }
    public decimal CurrencyRate { get; set; }
    public decimal CurrencyAmount { get; set; }
    public string? DocumentNo { get; set; }
    public string? Description { get; set; }
    public string TransactionType { get; set; } = string.Empty;
    public string? DeliveryCustomerCode { get; set; }
    public CustomerLedgerEntryReferenceType? ReferenceType { get; set; }
    public int? ReferenceId { get; set; }
    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }
}

public class SupplierLedgerEntryRestoreDto
{
    public string SupplierCode { get; set; } = string.Empty;
    public DateTime Date { get; set; }
    public DateTime DueDate { get; set; }
    public SupplierLedgerEntryDirection Direction { get; set; }
    public decimal Amount { get; set; }
    public int CurrencyTypeId { get; set; }
    public decimal CurrencyRate { get; set; }
    public decimal CurrencyAmount { get; set; }
    public string? DocumentNo { get; set; }
    public string? Description { get; set; }
    public string TransactionType { get; set; } = string.Empty;
    public SupplierLedgerEntryReferenceType? ReferenceType { get; set; }
    public int? ReferenceId { get; set; }
    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }
}

public class InvoiceRestoreDto
{
    public int? CariOfferId { get; set; }
    public string InvoiceNo { get; set; } = string.Empty;
    public InvoiceType Type { get; set; }
    public string CustomerCode { get; set; } = string.Empty;
    public string? CustomerNameOverride { get; set; }
    public string? CustomerInvoiceTypeOverride { get; set; }
    public string DeliveryCustomerCode { get; set; } = string.Empty;
    public DateTime Date { get; set; }
    public bool VatIncluded { get; set; }
    public decimal Subtotal { get; set; }
    public decimal Discount { get; set; }
    public decimal CampaignDiscount { get; set; }
    public string? CampaignDetailsJson { get; set; }
    public decimal NetTotal { get; set; }
    public decimal VatTotal { get; set; }
    public decimal GrandTotal { get; set; }
    public string? SalesmanCode { get; set; }
    public string? Description { get; set; }
    public string? InstallationName { get; set; }
    public string? InstallationPhone { get; set; }
    public int? SourceCustomerOfferId { get; set; }
    public int? SourcePurchaseInvoiceId { get; set; }
    public bool IsManuallyPaid { get; set; }
    public List<InvoiceLineRestoreDto>? Lines { get; set; }
    public List<CashTransactionRestoreDto>? CashTransactions { get; set; }
    public List<BankTransactionRestoreDto>? BankTransactions { get; set; }
    public List<CustomerLedgerEntryRestoreDto>? CustomerLedgerEntries { get; set; }
    public List<SupplierLedgerEntryRestoreDto>? SupplierLedgerEntries { get; set; }
}

public class SalesOrderLineRestoreDto
{
    public int? InstallationId { get; set; }
    public string StockCode { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public int CurrencyTypeId { get; set; }
    public decimal CurrencyRate { get; set; }
    public decimal CurrencyUnitPrice { get; set; }
    public decimal VatRate { get; set; }
    public bool IsGift { get; set; }
    public decimal DiscountAmount { get; set; }
    public int LineNo { get; set; }
    public string? CampaignCode { get; set; }
    public bool Montage { get; set; }
    public int? GroupId { get; set; }
    public string OrderNo { get; set; } = string.Empty;
}

public class SalesOrderRestoreDto
{
    public string CustomerCode { get; set; } = string.Empty;
    public string DeliveryCustomerCode { get; set; } = string.Empty;
    public decimal Subtotal { get; set; }
    public decimal VatTotal { get; set; }
    public decimal GrandTotal { get; set; }
    public decimal CampaignDiscount { get; set; }
    public string? CampaignDetailsJson { get; set; }
    public int Status { get; set; }
    public string OrderNo { get; set; } = string.Empty;
    public string ProcessedBy { get; set; } = string.Empty;
    public DateTime ProcessedAt { get; set; }
    public List<SalesOrderLineRestoreDto>? Lines { get; set; }
}

public class IrsaliyeRestoreDto
{
    public string IrsaliyeNo { get; set; } = string.Empty;
    public string CustomerCode { get; set; } = string.Empty;
    public Guid ProductId { get; set; }
    public decimal Quantity { get; set; }
    public decimal? ShippedQuantity { get; set; }
    public string? Description { get; set; }
    public DateTime Date { get; set; }
    public IrsaliyeStatus Status { get; set; }
    public int? TransferredSalesOrderId { get; set; }
    public string CreateUserRole { get; set; } = string.Empty;
}

public class CustomerOfferLineRestoreDto
{
    public Guid ProductId { get; set; }
    public string StockCode { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal VatRate { get; set; }
    public CustomerOfferLineDiscountType DiscountType { get; set; }
    public decimal DiscountValue { get; set; }
    public int LineNo { get; set; }
}

public class CustomerOfferRestoreDto
{
    public string DocumentNo { get; set; } = string.Empty;
    public string? ProformaDocumentNo { get; set; }
    public DateTime Date { get; set; }
    public string? CustomerCode { get; set; }
    public string? DeliveryCustomerCode { get; set; }
    public bool VatExempt { get; set; }
    public decimal Subtotal { get; set; }
    public decimal DiscountTotal { get; set; }
    public decimal NetTotal { get; set; }
    public decimal VatTotal { get; set; }
    public decimal GrandTotal { get; set; }
    public string? SalesmanCode { get; set; }
    public string? Description { get; set; }
    public MuhtelifCustomerRestoreDto? MuhtelifCustomer { get; set; }
    public List<CustomerOfferLineRestoreDto>? Lines { get; set; }
}

public class ProformaRestoreDto
{
    public int CustomerOfferId { get; set; }
    public string DocumentNo { get; set; } = string.Empty;
    public string ProformaDocumentNo { get; set; } = string.Empty;
}

public class CariOfferLineRestoreDto
{
    public Guid ProductId { get; set; }
    public string StockCode { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal VatRate { get; set; }
    public CustomerOfferLineDiscountType DiscountType { get; set; }
    public decimal DiscountValue { get; set; }
    public int LineNo { get; set; }
}

public class CariOfferRestoreDto
{
    public string DocumentNo { get; set; } = string.Empty;
    public string? ProformaDocumentNo { get; set; }
    public DateTime Date { get; set; }
    public string? CustomerCode { get; set; }
    public string? DeliveryCustomerCode { get; set; }
    public bool VatExempt { get; set; }
    public decimal Subtotal { get; set; }
    public decimal DiscountTotal { get; set; }
    public decimal NetTotal { get; set; }
    public decimal VatTotal { get; set; }
    public decimal GrandTotal { get; set; }
    public int? InvoiceId { get; set; }
    public string? InvoiceNo { get; set; }
    public string? SalesmanCode { get; set; }
    public string? Description { get; set; }
    public BayiMuhtelifCustomerRestoreDto? BayiMuhtelifCustomer { get; set; }
    public List<CariOfferLineRestoreDto>? Lines { get; set; }
}

public class CariProformaRestoreDto
{
    public int CariOfferId { get; set; }
    public string DocumentNo { get; set; } = string.Empty;
    public string ProformaDocumentNo { get; set; } = string.Empty;
    public int? InvoiceId { get; set; }
    public string? InvoiceNo { get; set; }
}

public class PurchaseInvoiceLineRestoreDto
{
    public Guid? ProductId { get; set; }
    public string StockCode { get; set; } = string.Empty;
    public int? WarehouseCode { get; set; }
    public string? Description { get; set; }
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal VatRate { get; set; }
    public PurchaseInvoiceLineDiscountType DiscountType { get; set; }
    public decimal DiscountValue { get; set; }
    public PurchaseInvoiceLineDeliveryStatus? DeliveryStatus { get; set; }
    public string? DeliveryTeam { get; set; }
    public DateTime? DeliveryDispatchDate { get; set; }
    public DateTime? DeliveryCompletedDate { get; set; }
    public int LineNo { get; set; }
}

public class PurchaseInvoiceRestoreDto
{
    public string DocumentNo { get; set; } = string.Empty;
    public DateTime Date { get; set; }
    public PurchaseInvoiceKind Kind { get; set; }
    public PurchaseInvoiceTerminStatus TerminStatus { get; set; }
    public string? SupplierCode { get; set; }
    public string? ServiceCode { get; set; }
    public string? CustomerCode { get; set; }
    public bool VatExempt { get; set; }
    public bool Approved { get; set; }
    public decimal Subtotal { get; set; }
    public decimal DiscountTotal { get; set; }
    public decimal NetTotal { get; set; }
    public decimal VatTotal { get; set; }
    public decimal GrandTotal { get; set; }
    public string? SalesmanCode { get; set; }
    public string? Description { get; set; }
    public MuhtelifCustomerRestoreDto? MuhtelifCustomer { get; set; }
    public List<PurchaseInvoiceLineRestoreDto>? Lines { get; set; }
}

