using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.SupplierLedger;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/supplier-ledger")]
[Authorize]
public sealed class SupplierLedgerController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public SupplierLedgerController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    [AuthorizePage("reports", "cariEkstre")]
    public async Task<IActionResult> List(
        [FromQuery] string supplierCode,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        CancellationToken cancellationToken = default)
    {
        supplierCode = (supplierCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(supplierCode))
        {
            return Ok(new { success = true, data = new SupplierLedgerListResponseDto() });
        }

        // CARİ EKSTRE TİP YETKİSİ (2026-10-11): tedarikçi ekstresi kapalıysa.
        var supTipleri = await B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.AllowedAsync(_dbContext, User, cancellationToken);
        if (supTipleri is not null && !supTipleri.Contains(B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.Tedarikci))
        {
            var tip = B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.Tedarikci;
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.DeniedMessage(tip) });
        }

        var sup = await _dbContext.Suppliers
            .AsNoTracking()
            .Where(x => x.SupplierCode == supplierCode)
            .Select(x => new { x.SupplierCode, x.FullName })
            .FirstOrDefaultAsync(cancellationToken);

        if (sup is null)
        {
            return Ok(new { success = true, data = new SupplierLedgerListResponseDto() });
        }

        static DateTime? Norm(DateTime? d)
        {
            if (!d.HasValue) return null;
            var v = d.Value;
            if (v == default) return null;
            return v.Kind == DateTimeKind.Utc ? v : DateTime.SpecifyKind(v, DateTimeKind.Utc);
        }

        var from = Norm(fromDate);
        var to = Norm(toDate);
        if (to.HasValue)
        {
            to = to.Value.Date.AddDays(1).AddTicks(-1);
            to = DateTime.SpecifyKind(to.Value, DateTimeKind.Utc);
        }

        var baseQuery = _dbContext.SupplierLedgerEntries
            .AsNoTracking()
            .Where(x => x.SupplierCode == supplierCode);

        if (from.HasValue) baseQuery = baseQuery.Where(x => x.Date >= from.Value);
        if (to.HasValue) baseQuery = baseQuery.Where(x => x.Date <= to.Value);

        var rows = await baseQuery
            .OrderBy(x => x.CreateTime)
            .ThenBy(x => x.Id)
            .Select(x => new
            {
                x.Id,
                x.SupplierCode,
                x.Date,
                x.CreateTime,
                x.DueDate,
                x.Direction,
                x.Amount,
                x.CurrencyTypeId,
                x.CurrencyRate,
                x.CurrencyAmount,
                x.DocumentNo,
                x.Description,
                x.TransactionType,
                x.ReferenceType,
                x.ReferenceId
            })
            .ToListAsync(cancellationToken);

        rows = rows
            .OrderBy(x => x.CreateTime)
            .ThenBy(x => x.Id)
            .ToList();

        var payableCheckIds = rows
            .Where(x => x.ReferenceId.HasValue 
                     && (x.TransactionType == "Borç Çeki" || (x.Description != null && x.Description.Contains("Çek"))))
            .Select(x => x.ReferenceId!.Value)
            .Distinct()
            .ToList();

        var payableCheckNos = payableCheckIds.Count > 0
            ? await _dbContext.PayableChecks
                .AsNoTracking()
                .Where(x => payableCheckIds.Contains(x.Id))
                .Select(x => new { x.Id, x.CheckNo, x.DocumentNo })
                .ToDictionaryAsync(x => x.Id, x => !string.IsNullOrWhiteSpace(x.CheckNo) ? x.CheckNo : x.DocumentNo, cancellationToken)
            : new Dictionary<int, string>();


        // AÇILIŞ (DEVİR) BAKİYESİ.
        //
        // Yürüyen bakiye 0'dan başlatılıyordu: `fromDate` verildiğinde o tarihten ÖNCEKİ
        // hareketler hiç hesaba katılmıyor, tedarikçiye 100.000 ₺ borç varken ayın ekstresi
        // "0'dan başlayan" bir bakiye gösteriyordu. Cari ekstre kardeşi (`CustomerLedger`)
        // önceki dönemi zaten topluyor; tedarikçi tarafı atlanmış.
        //
        // Toplamlar (TotalDebit/TotalCredit) BİLEREK dokunulmadan bırakıldı: onlar seçilen
        // aralığın hareket toplamıdır, devir onlara dahil edilirse "bu ay ne aldık" sorusu
        // bozulur. Devir yalnız yürüyen bakiyeyi doğru yerden başlatır.
        decimal opening = 0m;
        if (from.HasValue)
        {
            var priorRows = await _dbContext.SupplierLedgerEntries
                .AsNoTracking()
                .Where(x => x.SupplierCode == supplierCode && x.Date < from.Value)
                .Select(x => new { x.Direction, x.Amount })
                .ToListAsync(cancellationToken);

            foreach (var p in priorRows)
            {
                if (p.Direction == SupplierLedgerEntryDirection.Debit) opening += p.Amount;
                else opening -= p.Amount;
            }
        }

        decimal running = opening;
        decimal totalDebit = 0m;
        decimal totalCredit = 0m;

        // PARA BİRİMİ BAŞINA BAKİYE (2026-08-17, kullanıcı kararı). Müşteri ekstresindeki
        // vektörün aynısı: skaler TL alanlar korunuyor, yanına döviz kırılımı ekleniyor.
        // Tutar satırın KENDİ parasında okunuyor (`CurrencyAmount` boşsa TL tutardan türetiliyor,
        // müşteri ekstresiyle aynı kural), 0 ile 1 tek TL anahtarında toplanıyor.
        var debitByCurrency = new Dictionary<int, decimal>();
        var runningByCurrency = new Dictionary<int, decimal>();
        var creditByCurrency = new Dictionary<int, decimal>();
        var openingByCurrency = new Dictionary<int, decimal>();

        if (from.HasValue)
        {
            var priorFxRows = await _dbContext.SupplierLedgerEntries
                .AsNoTracking()
                .Where(x => x.SupplierCode == supplierCode && x.Date < from.Value)
                .Select(x => new { x.Direction, x.Amount, x.CurrencyTypeId, x.CurrencyRate, x.CurrencyAmount })
                .ToListAsync(cancellationToken);

            foreach (var p in priorFxRows)
            {
                var cur = CurrencyTypeHelper.Normalize(p.CurrencyTypeId);
                var val = LedgerAmount.InCurrency(p.CurrencyTypeId, p.Amount, p.CurrencyAmount, p.CurrencyRate);
                var signed = p.Direction == SupplierLedgerEntryDirection.Debit ? val : -val;
                openingByCurrency[cur] = openingByCurrency.GetValueOrDefault(cur) + signed;
            }
        }

        /*
          Para birimi bazlı yürüyen bakiye DEVİRDEN başlar — TL çapasındaki `running`
          değişkeni de `opening`ten başlıyor (yukarıda). Bu satır olmasaydı tarih
          süzgeci kullanıldığında döviz bakiyeleri devri saymaz, ilk satırdan
          sıfırdan başlardı.
        */
        foreach (var kv in openingByCurrency) runningByCurrency[kv.Key] = kv.Value;

        var items = new List<SupplierLedgerListItemDto>(rows.Count);
        foreach (var r in rows)
        {
            var debit = r.Direction == SupplierLedgerEntryDirection.Debit ? r.Amount : 0m;
            var credit = r.Direction == SupplierLedgerEntryDirection.Credit ? r.Amount : 0m;

            totalDebit += debit;
            totalCredit += credit;

            running += debit;
            running -= credit;

            var rowCur = CurrencyTypeHelper.Normalize(r.CurrencyTypeId);
            var rowCurAmount = LedgerAmount.InCurrency(r.CurrencyTypeId, r.Amount, r.CurrencyAmount, r.CurrencyRate);

            // Para birimi başına YÜRÜYEN bakiye — müşteri ekstresindeki ile aynı kural.
            if (r.Direction == SupplierLedgerEntryDirection.Debit)
            {
                debitByCurrency[rowCur] = debitByCurrency.GetValueOrDefault(rowCur) + rowCurAmount;
                runningByCurrency[rowCur] = runningByCurrency.GetValueOrDefault(rowCur) + rowCurAmount;
            }
            else
            {
                creditByCurrency[rowCur] = creditByCurrency.GetValueOrDefault(rowCur) + rowCurAmount;
                runningByCurrency[rowCur] = runningByCurrency.GetValueOrDefault(rowCur) - rowCurAmount;
            }

            var hasDetails = r.ReferenceType == SupplierLedgerEntryReferenceType.Invoice && r.ReferenceId.HasValue && r.ReferenceId.Value > 0;

            var itemDocNo = r.DocumentNo;
            if (r.ReferenceId.HasValue && payableCheckNos.TryGetValue(r.ReferenceId.Value, out var checkNo))
            {
                itemDocNo = checkNo;
            }

            items.Add(new SupplierLedgerListItemDto
            {
                Id = r.Id,
                SupplierCode = sup.SupplierCode,
                SupplierName = sup.FullName ?? string.Empty,
                Date = r.Date,
                DueDate = r.DueDate,
                DocumentNo = itemDocNo,
                Description = r.Description,
                TransactionType = r.TransactionType,
                Debit = debit,
                Credit = credit,
                CurrencyTypeId = r.CurrencyTypeId,
                CurrencyRate = r.CurrencyRate,
                CurrencyAmount = r.CurrencyAmount,
                Balance = running,
                CurrencyBalance = runningByCurrency.GetValueOrDefault(rowCur),
                ReferenceType = r.ReferenceType,
                ReferenceId = r.ReferenceId,
                HasDetails = hasDetails
            });
        }

        var resp = new SupplierLedgerListResponseDto
        {
            SupplierCode = sup.SupplierCode,
            SupplierName = sup.FullName ?? string.Empty,
            Summary = new SupplierLedgerSummaryDto
            {
                TotalDebit = totalDebit,
                TotalCredit = totalCredit,
                // Bakiye devri İÇERİR (ekranda "kalan borç" bu). Aralık toplamları
                // yukarıdaki iki alanda ayrı duruyor.
                Balance = opening + totalDebit - totalCredit
            },
            CurrencyBalances = debitByCurrency.Keys
                .Union(creditByCurrency.Keys)
                .Union(openingByCurrency.Keys)
                .Distinct()
                .Select(cur =>
                {
                    var d = debitByCurrency.GetValueOrDefault(cur);
                    var c = creditByCurrency.GetValueOrDefault(cur);
                    var o = openingByCurrency.GetValueOrDefault(cur);
                    return new SupplierLedgerCurrencyBalanceDto
                    {
                        CurrencyTypeId = cur,
                        CurrencyCode = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCodeOrTry(cur),
                        CurrencySymbol = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToSymbol(cur),
                        TotalDebit = d,
                        TotalCredit = c,
                        Opening = o,
                        Balance = o + d - c
                    };
                })
                .OrderBy(x => x.CurrencyTypeId)
                .ToList(),
            Items = items
        };

        return Ok(new { success = true, data = resp });
    }

    [HttpGet("{id:int}/details")]
    [AuthorizePage("reports", "cariEkstre")]
    public async Task<IActionResult> Details([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var supTipleri = await B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.AllowedAsync(_dbContext, User, cancellationToken);
        if (supTipleri is not null && !supTipleri.Contains(B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.Tedarikci))
        {
            var tip = B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.Tedarikci;
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.DeniedMessage(tip) });
        }

        var entry = await _dbContext.SupplierLedgerEntries
            .AsNoTracking()
            .Where(x => x.Id == id)
            .Select(x => new { x.Id, x.ReferenceType, x.ReferenceId })
            .FirstOrDefaultAsync(cancellationToken);

        if (entry is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entry.ReferenceType != SupplierLedgerEntryReferenceType.Invoice || !entry.ReferenceId.HasValue || entry.ReferenceId.Value <= 0)
        {
            return Ok(new { success = true, data = Array.Empty<SupplierLedgerDetailLineDto>() });
        }

        var invoiceId = entry.ReferenceId.Value;

        var lines = await (
                from line in _dbContext.Set<PurchaseInvoiceLine>().AsNoTracking()
                // Alış faturasının para birimi (2026-08-14'te eklendi). `PurchaseInvoiceLine`
                // kendi dövizini taşımaz — tutar faturanın para birimindedir.
                join pinv in _dbContext.Set<PurchaseInvoice>().AsNoTracking() on line.PurchaseInvoiceId equals pinv.Id
                join prodById in _dbContext.Set<Product>().AsNoTracking() on line.ProductId equals prodById.Id into pIdJoin
                from prodById in pIdJoin.DefaultIfEmpty()
                join prodByCode in _dbContext.Set<Product>().AsNoTracking() on line.StockCode equals prodByCode.StockCode into pCodeJoin
                from prodByCode in pCodeJoin.DefaultIfEmpty()
                where line.PurchaseInvoiceId == invoiceId
                orderby line.LineNo
                select new SupplierLedgerDetailLineDto
                {
                    Id = line.Id,
                    StockCode = line.StockCode,
                    StockName =
                        (prodById != null && !string.IsNullOrWhiteSpace(prodById.Name))
                            ? prodById.Name
                            : (prodByCode != null && !string.IsNullOrWhiteSpace(prodByCode.Name))
                                ? prodByCode.Name
                                : (line.Description ?? string.Empty),
                    Barcode = prodById != null
                        ? (prodById.Barcode ?? string.Empty)
                        : (prodByCode != null ? (prodByCode.Barcode ?? string.Empty) : string.Empty),
                    Quantity = line.Quantity,
                    // TL çapası — raporun TL kolonları bunu okur.
                    UnitPrice = line.UnitPrice,
                    Total = line.Quantity * line.UnitPrice,
                    CurrencyTypeId = pinv.CurrencyTypeId,
                    /*
                      BELGENİN KENDİ PARASINDAKİ FİYAT (2026-09-01 düzeltmesi).

                      Buraya `line.UnitPrice` yazılıyordu; o alan TL ÇAPASIDIR. Sonuç: 117,50 $
                      girilen kalem cari ekstre detayında "5.670,70 $" görünüyordu (TL değeri,
                      dolar etiketiyle). Doğru kaynak `CurrencyUnitPrice`.

                      Damgasız ESKİ satırlarda o alan 0'dır; orada `UnitPrice` zaten belgenin
                      parasındadır ve eski davranış korunur.
                    */
                    CurrencyUnitPrice = line.CurrencyUnitPrice > 0m ? line.CurrencyUnitPrice : line.UnitPrice,
                    CurrencyTotal = line.Quantity * (line.CurrencyUnitPrice > 0m ? line.CurrencyUnitPrice : line.UnitPrice),
                    IsGift = false
                })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = lines });
    }
}
