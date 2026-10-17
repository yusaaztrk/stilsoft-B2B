using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Api.Services;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class EarningsController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IServiceOpsPermissionService _permissions;

    public EarningsController(ApplicationDbContext context, IServiceOpsPermissionService permissions)
    {
        _context = context;
        _permissions = permissions;
    }

    [HttpGet]
    public async Task<ActionResult<object>> GetAll(
        [FromQuery] Guid? technicianId,
        [FromQuery] EarningStatus? status,
        [FromQuery] EarningSourceType? sourceType,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken)
    {
        await SyncCompletedJobsAsync(cancellationToken);

        var scope = await _permissions.GetScopeAsync(User, "hakedis", cancellationToken);
        if (!scope.CanAccess) return Forbid();

        var query = _context.TechnicianEarnings
            .AsNoTracking()
            .Include(e => e.Technician)
            .AsQueryable();

        if (!scope.CanViewAll)
        {
            if (scope.TechnicianId.HasValue)
                query = query.Where(e => e.TechnicianId == scope.TechnicianId.Value);
            else
                return Ok(new { success = true, data = Array.Empty<object>(), totals = new { count = 0, amount = 0m } });
        }

        if (technicianId.HasValue) query = query.Where(e => e.TechnicianId == technicianId.Value);
        if (status.HasValue) query = query.Where(e => e.Status == status.Value);
        if (sourceType.HasValue) query = query.Where(e => e.SourceType == sourceType.Value);
        if (from.HasValue) query = query.Where(e => e.CompletedAt >= from.Value.ToUniversalTime());
        if (to.HasValue) query = query.Where(e => e.CompletedAt <= to.Value.ToUniversalTime());

        var items = await query
            .OrderByDescending(e => e.CompletedAt)
            .Take(1000)
            .Select(e => new
            {
                e.Id,
                e.TenantCode,
                e.TechnicianId,
                technicianName = e.TechnicianName,
                e.TechnicianCariCode,
                sourceType = e.SourceType.ToString(),
                e.SourceId,
                e.SourceNumber,
                e.CustomerName,
                e.ProductName,
                e.CompletedAt,
                e.Amount,
                e.Currency,
                // Kur ve TL karşılığı ekrana da taşınır. Yoklarsa liste tutarı kendi para
                // biriminde göstermeye devam eder; ekranın tutarı TL varsayıp bölmesi YASAK.
                e.ExchangeRate,
                e.LocalAmount,
                e.ExchangeRateDate,
                status = e.Status.ToString(),
                e.PostedLedgerReference,
                e.Notes,
                e.CreatedAt,
                e.ApprovedAt,
                e.ApprovedBy,
                e.PostedAt,
                e.PostedBy
            })
            .ToListAsync(cancellationToken);

        // TOPLAM PARA BİRİMİ BAŞINA. Tek bir `amount` toplamı dönülüyordu: 90 USD ile 100 TRY
        // aynı torbada toplanıp ekranda "₺190" gibi var olmayan bir tutar çıkıyordu.
        // `amount` alanı geriye dönük uyumluluk için duruyor ama artık YALNIZCA TRY satırları.
        var byCurrency = items
            .GroupBy(x => x.Currency)
            .Select(g => new
            {
                currency = g.Key,
                count = g.Count(),
                amount = g.Sum(x => x.Amount),
                // TL karşılığı yalnızca kuru GİRİLMİŞ satırlardan toplanır; kuru olmayanı
                // 1'e saymak sessizce yanlış bir TL toplamı üretirdi.
                localAmount = g.Where(x => x.LocalAmount.HasValue).Sum(x => x.LocalAmount!.Value),
                missingRate = g.Count(x => !x.LocalAmount.HasValue && x.Amount > 0)
            })
            .OrderBy(x => x.currency)
            .ToList();

        return Ok(new
        {
            success = true,
            data = items,
            totals = new
            {
                count = items.Count,
                amount = items.Where(x => x.Currency == "TRY").Sum(x => x.Amount),
                byCurrency,
                localAmount = byCurrency.Sum(x => x.localAmount),
                missingRate = byCurrency.Sum(x => x.missingRate)
            }
        });
    }

    [HttpPost("sync")]
    public async Task<ActionResult<object>> Sync(CancellationToken cancellationToken)
    {
        var scope = await _permissions.GetScopeAsync(User, "hakedis", cancellationToken);
        if (!scope.CanViewAll) return Forbid();

        var created = await SyncCompletedJobsAsync(cancellationToken);
        return Ok(new { success = true, created });
    }

    [HttpPatch("{id:guid}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateEarningStatusRequest request, CancellationToken cancellationToken)
    {
        var scope = await _permissions.GetScopeAsync(User, "hakedis", cancellationToken);
        if (!scope.CanViewAll) return Forbid();

        var item = await _context.TechnicianEarnings.FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
        if (item == null) return NotFound();

        if (!Enum.TryParse<EarningStatus>(request.Status, true, out var status))
            return BadRequest("Geçersiz hakediş durumu");

        var actor = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "Sistem";
        item.Status = status;
        item.Notes = request.Notes ?? item.Notes;

        if (request.Amount.HasValue && request.Amount.Value > 0)
        {
            item.Amount = request.Amount.Value;
        }

        if (!string.IsNullOrWhiteSpace(request.Currency))
        {
            item.Currency = NormalizeCurrency(request.Currency);
        }

        // Kur BİLGİ olarak saklanıyor; Amount hiçbir zaman kura çevrilip ezilmiyor. TL karşılığı
        // gereken raporlar LocalAmount'u okur, orijinal tutar ve para birimi olduğu gibi durur.
        if (request.ExchangeRate.HasValue && request.ExchangeRate.Value > 0)
        {
            item.ExchangeRate = request.ExchangeRate.Value;
            item.LocalAmount = Math.Round(item.Amount * request.ExchangeRate.Value, 2);
            item.ExchangeRateDate = DateTime.UtcNow;
        }
        else if (item.Currency == "TRY")
        {
            item.ExchangeRate = 1m;
            item.LocalAmount = item.Amount;
            item.ExchangeRateDate = DateTime.UtcNow;
        }
        else if (item.ExchangeRate.HasValue && item.ExchangeRate.Value > 0)
        {
            // TUTAR DEĞİŞTİYSE TL KARŞILIĞI DA DEĞİŞİR.
            //
            // Kur gönderilmeden tutar güncellendiğinde LocalAmount eski tutardan hesaplanmış
            // haliyle kalıyordu: 90 USD × 38,5 = 3.465 TL yazılmış bir satırın tutarı 120 USD'ye
            // çekilince TL karşılığı hâlâ 3.465 görünüyordu. Kayıtlı kurla yeniden hesaplanıyor.
            item.LocalAmount = Math.Round(item.Amount * item.ExchangeRate.Value, 2);
        }
        else
        {
            // Kuru olmayan döviz tutarının TL karşılığı YOKTUR; 1'e saymak yerine boş bırakılır ki
            // raporlar "kuru girilmemiş" satırı sessizce TL toplamına katmasın.
            item.LocalAmount = null;
        }

        if (status == EarningStatus.Approved)
        {
            item.ApprovedAt = DateTime.UtcNow;
            item.ApprovedBy = actor;
        }
        else if (status == EarningStatus.PostedToLedger)
        {
            item.PostedAt = DateTime.UtcNow;
            item.PostedBy = actor;
            item.PostedLedgerReference = request.PostedLedgerReference ?? item.PostedLedgerReference;
        }

        // Hak edişin durumu ve defter hareketi TEK İŞLEM. Ayrı kaydedilirse ikisinden biri
        // başarısız olduğunda ya ekstrede karşılığı olmayan bir hak ediş ya da hak edişi olmayan
        // bir ekstre satırı kalıyordu.
        await using var tx = await _context.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await _context.SaveChangesAsync(cancellationToken);
            await SyncLedgerForEarningAsync(item, actor, cancellationToken);
            await _context.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);
        }
        catch
        {
            await tx.RollbackAsync(cancellationToken);
            throw;
        }

        return Ok(new { success = true });
    }

    /// <summary>
    /// Onaylanan hak edişi personelin defterine ALACAK olarak yazar; onay geri alınırsa satırı
    /// kaldırır. İptal ve bekleyen durumlar deftere düşmez — henüz kesinleşmemiş bir tutar
    /// personelin bakiyesini büyütmemeli.
    ///
    /// Tekrar çalıştırılabilir: satır varsa güncellenir, yoksa eklenir. Aynı hak edişten iki satır
    /// çıkmasını (EntryType, SourceId) benzersiz indeksi ayrıca garanti eder.
    /// </summary>
    private async Task SyncLedgerForEarningAsync(TechnicianEarning earning, string actor, CancellationToken cancellationToken)
    {
        var existing = await _context.TechnicianLedgerEntries
            .FirstOrDefaultAsync(l => l.EntryType == LedgerEntryType.Earning && l.SourceId == earning.Id, cancellationToken);

        var shouldExist = earning.Status is EarningStatus.Approved or EarningStatus.PostedToLedger;

        if (!shouldExist)
        {
            if (existing != null) _context.TechnicianLedgerEntries.Remove(existing);
            return;
        }

        var description = string.IsNullOrWhiteSpace(earning.ProductName)
            ? "Tamamlanan servis işi hak edişi"
            : $"Hak ediş — {earning.ProductName}";

        if (existing == null)
        {
            _context.TechnicianLedgerEntries.Add(new TechnicianLedgerEntry
            {
                TenantCode = earning.TenantCode,
                TechnicianId = earning.TechnicianId,
                EntryDate = earning.CompletedAt,
                Description = description,
                ReferenceNumber = earning.SourceNumber,
                Debit = 0m,
                Credit = earning.Amount,
                Currency = earning.Currency,
                ExchangeRate = earning.ExchangeRate,
                LocalAmount = earning.LocalAmount,
                ExchangeRateDate = earning.ExchangeRateDate,
                EntryType = LedgerEntryType.Earning,
                SourceId = earning.Id,
                CreatedBy = actor
            });
            return;
        }

        existing.EntryDate = earning.CompletedAt;
        existing.Description = description;
        existing.ReferenceNumber = earning.SourceNumber;
        existing.Credit = earning.Amount;
        existing.Currency = earning.Currency;
        existing.ExchangeRate = earning.ExchangeRate;
        existing.LocalAmount = earning.LocalAmount;
        existing.ExchangeRateDate = earning.ExchangeRateDate;
    }

    private static readonly HashSet<string> SupportedCurrencies =
        new(StringComparer.OrdinalIgnoreCase) { "TRY", "USD", "EUR", "GBP" };

    private static string NormalizeCurrency(string? raw)
    {
        var value = (raw ?? string.Empty).Trim().ToUpperInvariant();
        return SupportedCurrencies.Contains(value) ? value : "TRY";
    }

    /// <summary>
    /// Personel hak ediş ekstresi.
    ///
    /// B2B cari ekstresiyle AYNI VERİ DEĞİLDİR: orası müşterinin borcu/alacağı, burası şirketin
    /// personele borcu. Yalnızca ekran düzeni benzer.
    ///
    /// Bakiye PARA BİRİMİ BAŞINA hesaplanır; 90 USD ile 100 TRY tek bir toplamda birleştirilmez.
    ///
    /// Üç hesap kuralı — üçü de daha önce yanlıştı:
    ///
    /// 1. **Yürüyen bakiye KİŞİ + DÖVİZ başına ilerler.** Yalnızca dövize göre yürütülüyordu;
    ///    "Tüm personel" görünümünde herkesin hareketi tek bir bakiyede toplanıyor, satırlardaki
    ///    Bakiye sütunu hiçbir kişiye ait olmayan bir sayı gösteriyordu.
    ///
    /// 2. **DEVİR (açılış bakiyesi) hesaplanır.** Bakiye seçilen tarih aralığının başında
    ///    sıfırdan başlıyordu; ekran varsayılan olarak "ayın 1'i → bugün" filtresiyle açtığı için
    ///    önceki ayların bütün hak edişleri ve ödemeleri yok sayılıyor, kart üzerinde "personele
    ///    ödenecek" diye o ayın netini gösteriyordu.
    ///
    /// 3. **Kapanış bakiyesi kırpmadan etkilenmez.** Satırlar 5000 ile sınırlı; bakiye o kırpılmış
    ///    listeden toplanırsa sessizce yanlış çıkar. Bakiye artık veritabanında toplanıyor.
    /// </summary>
    [HttpGet("ledger")]
    public async Task<ActionResult<object>> GetLedger(
        [FromQuery] Guid? technicianId,
        [FromQuery] string? currency,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken)
    {
        var scope = await _permissions.GetScopeAsync(User, "hakedis", cancellationToken);
        if (!scope.CanAccess) return Forbid();

        var effectiveTechnicianId = technicianId;
        if (!scope.CanViewAll)
        {
            // Dar yetkili kullanıcı yalnızca kendi ekstresini görür; istemcinin gönderdiği
            // technicianId koşulsuz olarak eziliyor, aksi halde başkasının defteri istenebilirdi.
            if (!scope.TechnicianId.HasValue)
            {
                return Ok(new { success = true, data = Array.Empty<object>(), balances = Array.Empty<object>() });
            }
            effectiveTechnicianId = scope.TechnicianId.Value;
        }

        // Kişi ve döviz süzgeci hem dönem içi satırlara hem de DEVİR hesabına aynen uygulanmalı;
        // ortak taban sorgu bu yüzden ayrı tutuluyor.
        var baseQuery = _context.TechnicianLedgerEntries
            .AsNoTracking()
            .AsQueryable();

        if (effectiveTechnicianId.HasValue)
            baseQuery = baseQuery.Where(l => l.TechnicianId == effectiveTechnicianId.Value);
        if (!string.IsNullOrWhiteSpace(currency))
        {
            var cur = NormalizeCurrency(currency);
            baseQuery = baseQuery.Where(l => l.Currency == cur);
        }

        // GÜN SINIRI YEREL SAATE GÖRE ÇEKİLİR.
        //
        // Ekrandan "2026-08-01" geliyor; bu SAHADAKİ takvim günü. Zaman damgaları UTC saklandığı
        // için sınır, yerel gece yarısının UTC karşılığıdır. Önceki kod `.Date.ToUniversalTime()`
        // kullanıyordu: sunucunun saat dilimine göre davranıp aralığı kaydırıyor, ayın ilk/son
        // gününe ait hareketleri yanlış döneme atıyordu.
        var fromUtc = from.HasValue ? LocalDayStartUtc(from.Value) : (DateTime?)null;
        var toUtc = to.HasValue ? LocalDayStartUtc(to.Value).AddDays(1) : (DateTime?)null;

        var periodQuery = baseQuery;
        if (fromUtc.HasValue) periodQuery = periodQuery.Where(l => l.EntryDate >= fromUtc.Value);
        if (toUtc.HasValue) periodQuery = periodQuery.Where(l => l.EntryDate < toUtc.Value);

        // DEVİR: dönem başından ÖNCEKİ her şeyin kişi + döviz bazında neti.
        var opening = new Dictionary<string, decimal>();
        if (fromUtc.HasValue)
        {
            var openingRows = await baseQuery
                .Where(l => l.EntryDate < fromUtc.Value)
                .GroupBy(l => new { l.TechnicianId, l.Currency })
                .Select(g => new
                {
                    g.Key.TechnicianId,
                    g.Key.Currency,
                    Balance = g.Sum(x => x.Credit) - g.Sum(x => x.Debit)
                })
                .ToListAsync(cancellationToken);

            foreach (var row in openingRows)
            {
                opening[BalanceKey(row.TechnicianId, row.Currency)] = row.Balance;
            }
        }

        var rows = await periodQuery
            .Include(l => l.Technician)
            .OrderBy(l => l.EntryDate)
            .ThenBy(l => l.CreatedAt)
            .Take(5000)
            .Select(l => new
            {
                l.Id,
                l.TechnicianId,
                technicianName = l.Technician.FullName,
                l.EntryDate,
                l.Description,
                l.ReferenceNumber,
                l.Debit,
                l.Credit,
                l.Currency,
                l.ExchangeRate,
                l.LocalAmount,
                entryType = l.EntryType.ToString(),
                l.SourceId,
                l.CreatedAt,
                l.CreatedBy
            })
            .ToListAsync(cancellationToken);

        // Yürüyen bakiye KİŞİ + DÖVİZ başına ilerler ve o kişinin DEVRİNDEN başlar.
        var running = new Dictionary<string, decimal>(opening);
        var data = rows.Select(r =>
        {
            var key = BalanceKey(r.TechnicianId, r.Currency);
            running.TryGetValue(key, out var prev);
            var balance = prev + r.Credit - r.Debit;
            running[key] = balance;

            return new
            {
                r.Id,
                r.TechnicianId,
                r.technicianName,
                r.EntryDate,
                r.Description,
                r.ReferenceNumber,
                r.Debit,
                r.Credit,
                r.Currency,
                r.ExchangeRate,
                r.LocalAmount,
                r.entryType,
                r.SourceId,
                r.CreatedAt,
                r.CreatedBy,
                balance
            };
        }).ToList();

        // KAPANIŞ BAKİYESİ VERİTABANINDA TOPLANIR.
        //
        // Satırlar 5000 ile sınırlı ve dönem süzgeci var; bakiyeyi ekrandaki listeden toplamak,
        // hem kırpma hem de tarih aralığı yüzünden gerçek borcu göstermezdi. Buradaki toplam
        // "dönem sonuna kadar olan HER ŞEY" — devir dahil.
        var closingQuery = baseQuery;
        if (toUtc.HasValue) closingQuery = closingQuery.Where(l => l.EntryDate < toUtc.Value);

        var closingRows = await closingQuery
            .GroupBy(l => l.Currency)
            .Select(g => new
            {
                currency = g.Key,
                balance = g.Sum(x => x.Credit) - g.Sum(x => x.Debit)
            })
            .ToListAsync(cancellationToken);

        var balances = closingRows.OrderBy(x => x.currency).ToList();

        // Devir, ekranda ayrı bir satır olarak gösterilebilsin diye döviz bazında da özetlenir.
        var openingTotals = opening
            .GroupBy(kv => kv.Key.Split('|')[1])
            .Select(g => new { currency = g.Key, balance = g.Sum(x => x.Value) })
            .Where(x => x.balance != 0m)
            .OrderBy(x => x.currency)
            .ToList();

        // Dönem hareket toplamları: ekrandaki alt toplam satırı bunu kullanır; bakiyeyle
        // karıştırılmasın diye ayrı adla dönüyor.
        var periodTotals = rows
            .GroupBy(r => r.Currency)
            .Select(g => new
            {
                currency = g.Key,
                debit = g.Sum(x => x.Debit),
                credit = g.Sum(x => x.Credit)
            })
            .OrderBy(x => x.currency)
            .ToList();

        return Ok(new
        {
            success = true,
            data,
            balances,
            openingBalances = openingTotals,
            periodTotals,
            // Kırpma olduysa ekran uyarabilsin.
            truncated = rows.Count >= 5000
        });
    }

    /// <summary>Bakiye sözlüğünün anahtarı: aynı kişinin aynı dövizdeki hareketleri tek çizgide yürür.</summary>
    private static string BalanceKey(Guid technicianId, string currency)
        => $"{technicianId:N}|{(currency ?? string.Empty).ToUpperInvariant()}";

    /// <summary>
    /// Ekrandan gelen takvim gününün (yerel, UTC+3) UTC karşılığı.
    /// Saatler UTC saklandığı için gün sınırı bu dönüşüm olmadan sunucunun saat dilimine göre kayar.
    /// </summary>
    private static DateTime LocalDayStartUtc(DateTime localDate)
        => DateTime.SpecifyKind(localDate.Date, DateTimeKind.Utc).AddHours(-LocalOffsetHours);

    private const int LocalOffsetHours = 3;

    /// <summary>
    /// Personele yapılan ödeme (defterde BORÇ). Hak edişler bakiyeyi büyütür, ödemeler düşürür;
    /// ödeme kaydı olmadan ekstre yalnızca artan bir liste olurdu.
    /// </summary>
    [HttpPost("ledger/payment")]
    public async Task<ActionResult<object>> CreateLedgerPayment([FromBody] CreateLedgerPaymentRequest request, CancellationToken cancellationToken)
    {
        var scope = await _permissions.GetScopeAsync(User, "hakedis", cancellationToken);
        if (!scope.CanViewAll) return Forbid();

        if (request.TechnicianId == Guid.Empty) return BadRequest(new { success = false, message = "Personel seçilmedi." });
        if (request.Amount <= 0) return BadRequest(new { success = false, message = "Tutar sıfırdan büyük olmalı." });

        var technicianExists = await _context.Technicians.AnyAsync(t => t.Id == request.TechnicianId, cancellationToken);
        if (!technicianExists) return NotFound(new { success = false, message = "Personel bulunamadı." });

        var actor = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "Sistem";
        var currency = NormalizeCurrency(request.Currency);

        var entry = new TechnicianLedgerEntry
        {
            TenantCode = ResolveTenantCode(),
            TechnicianId = request.TechnicianId,
            EntryDate = (request.EntryDate ?? DateTime.UtcNow).ToUniversalTime(),
            Description = string.IsNullOrWhiteSpace(request.Description) ? "Personele ödeme" : request.Description.Trim(),
            ReferenceNumber = request.ReferenceNumber,
            Debit = request.Amount,
            Credit = 0m,
            Currency = currency,
            ExchangeRate = request.ExchangeRate,
            LocalAmount = request.ExchangeRate.HasValue ? Math.Round(request.Amount * request.ExchangeRate.Value, 2) : (currency == "TRY" ? request.Amount : null),
            ExchangeRateDate = request.ExchangeRate.HasValue ? DateTime.UtcNow : null,
            EntryType = request.IsAdjustment ? LedgerEntryType.Adjustment : LedgerEntryType.Payment,
            CreatedBy = actor
        };

        _context.TechnicianLedgerEntries.Add(entry);
        await _context.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, id = entry.Id });
    }

    [HttpDelete("ledger/{id:guid}")]
    public async Task<IActionResult> DeleteLedgerEntry(Guid id, CancellationToken cancellationToken)
    {
        var scope = await _permissions.GetScopeAsync(User, "hakedis", cancellationToken);
        if (!scope.CanViewAll) return Forbid();

        var entry = await _context.TechnicianLedgerEntries.FirstOrDefaultAsync(l => l.Id == id, cancellationToken);
        if (entry == null) return NotFound();

        // Hak edişten doğan satır elle silinemez; kaynağı hak edişin kendisidir. Silinirse bir
        // sonraki durum değişikliğinde geri gelir ve defter kendi kendine çelişir.
        if (entry.EntryType == LedgerEntryType.Earning)
        {
            return BadRequest(new
            {
                success = false,
                message = "Hak edişten gelen satır ekstreden silinemez. Hak edişin durumunu değiştirin."
            });
        }

        _context.TechnicianLedgerEntries.Remove(entry);
        await _context.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private async Task<int> SyncCompletedJobsAsync(CancellationToken cancellationToken)
    {
        // İPTAL EDİLMİŞ hak ediş "zaten var" SAYILMAZ.
        //
        // Tekilleştirme kaynağın kimliğine bakıyor (görev/kayıt id'si). İptal edilenler de bu
        // kümeye giriyordu ve şu kırılmayı üretiyordu: iş A'ya tamamlandı → hak ediş yazıldı →
        // tamamlanma geri alındı (hak ediş iptale çekilir) → iş B'ye atanıp tekrar tamamlandı →
        // aynı SourceId zaten kümede olduğu için B'ye HİÇ hak ediş açılmıyordu. Yani işi yapan
        // kişi hiç alamıyordu. İptaller dışarıda bırakılınca yeniden tamamlanan iş yeni bir
        // satır doğurur; iptal edilen eski satır defterde iz olarak durmaya devam eder.
        var existing = await _context.TechnicianEarnings
            .AsNoTracking()
            .Where(e => e.Status != EarningStatus.Cancelled)
            .Select(e => new { e.SourceType, e.SourceId })
            .ToListAsync(cancellationToken);
        var existingSet = existing
            .Select(e => $"{(int)e.SourceType}:{e.SourceId:N}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var tenantCode = ResolveTenantCode();
        var actor = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "Sistem";
        var toCreate = new List<TechnicianEarning>();

        var serviceRecords = await _context.ServiceRecords
            .AsNoTracking()
            .Include(s => s.AssignedTechnician)
            .Where(s => s.AssignedTechnicianId != null
                && (s.Status == ServiceStatus.Delivered || s.Status == ServiceStatus.Ready || s.Status == ServiceStatus.FieldCompleted)
                && s.CompletedAt != null)
            // SIRALAMASIZ Take(2000) hangi 2000'i getireceğini garanti etmiyordu: eşik aşıldığında
            // yeni tamamlanan işler hiç senkronlanmayabiliyordu. En yeniden geriye doğru okunuyor.
            .OrderByDescending(s => s.CompletedAt)
            .Take(2000)
            .ToListAsync(cancellationToken);

        // AYNI İŞ İKİ KEZ HAK EDİŞ DOĞURMAZ.
        //
        // Montaj kaydı görev satırlarına bölünüyor ve aşağıdaki döngü her tamamlanan GÖREV için
        // ayrı hak ediş üretiyor. Kaydın kendisi için de üretilince aynı iş iki kez ödenmiş
        // oluyordu: DEMOTEST'te MNT-0000019 hem kayıt (90 USD) hem görev (90 USD) satırı
        // yazmış, personelin ekstresi 180 USD göstermişti. Benzersizlik indeksi bunu yakalamaz —
        // iki satırın SourceType'ı farklı olduğu için indeks açısından ayrı kayıtlar.
        //
        // Kural: kaydın GÖREVİ VARSA iş birimi görevdir, kayıt seviyesinde hak ediş yazılmaz.
        // Görevi olmayan kayıtlar (saha arıza, atölye) eskisi gibi kayıt seviyesinden gelir.
        var serviceIdsWithTasks = await _context.InstallationTasks
            .AsNoTracking()
            .Where(t => t.Status != InstallationTaskStatus.Cancelled)
            .Select(t => t.ServiceId)
            .Distinct()
            .ToListAsync(cancellationToken);
        var taskBackedServiceIds = serviceIdsWithTasks.ToHashSet();

        foreach (var service in serviceRecords)
        {
            if (existingSet.Contains($"{(int)EarningSourceType.ServiceRecord}:{service.Id:N}")) continue;
            if (taskBackedServiceIds.Contains(service.Id)) continue;
            var tech = service.AssignedTechnician;
            if (tech == null || !service.AssignedTechnicianId.HasValue) continue;

            toCreate.Add(CreateEarning(
                tenantCode,
                tech,
                EarningSourceType.ServiceRecord,
                service.Id,
                service.ServiceNumber,
                service.CustomerName,
                service.ProductName,
                service.CompletedAt ?? service.UpdatedAt ?? DateTime.UtcNow,
                actor));
        }

        var installationTasks = await _context.InstallationTasks
            .AsNoTracking()
            .Include(t => t.AssignedTechnician)
            .Include(t => t.Service)
            .Where(t => t.AssignedTechnicianId != null
                && t.Status == InstallationTaskStatus.Completed
                && t.CompletedAt != null)
            .OrderByDescending(t => t.CompletedAt)
            .Take(2000)
            .ToListAsync(cancellationToken);

        foreach (var task in installationTasks)
        {
            if (existingSet.Contains($"{(int)EarningSourceType.InstallationTask}:{task.Id:N}")) continue;
            var tech = task.AssignedTechnician;
            if (tech == null || !task.AssignedTechnicianId.HasValue) continue;

            toCreate.Add(CreateEarning(
                tenantCode,
                tech,
                EarningSourceType.InstallationTask,
                task.Id,
                task.Service?.ServiceNumber,
                task.Service?.CustomerName,
                task.Service?.ProductName,
                task.CompletedAt ?? DateTime.UtcNow,
                actor));
        }

        var cargoTasks = await _context.CargoTrackingTasks
            .AsNoTracking()
            .Include(t => t.AssignedTechnician)
            .Where(t => t.AssignedTechnicianId != null && t.Status == CargoTrackingStatus.Delivered)
            .Take(2000)
            .ToListAsync(cancellationToken);

        foreach (var cargo in cargoTasks)
        {
            if (existingSet.Contains($"{(int)EarningSourceType.CargoTrackingTask}:{cargo.Id:N}")) continue;
            var tech = cargo.AssignedTechnician;
            if (tech == null || !cargo.AssignedTechnicianId.HasValue) continue;

            toCreate.Add(CreateEarning(
                tenantCode,
                tech,
                EarningSourceType.CargoTrackingTask,
                cargo.Id,
                cargo.OrderNumber,
                cargo.CustomerName,
                cargo.ProductDetails,
                cargo.UpdatedAt,
                actor));
        }

        if (toCreate.Count == 0) return 0;

        _context.TechnicianEarnings.AddRange(toCreate);
        await _context.SaveChangesAsync(cancellationToken);
        return toCreate.Count;
    }

    /// <summary>
    /// İsteğin firma kodu.
    ///
    /// Yalnız küçük harfli `tenantCode` claim'i okunuyordu; jeton PascalCase `TenantCode`
    /// taşıdığında hak ediş ve personel defteri satırları `TenantCode = null` yazılıyor ve
    /// çok kiracılı süzgeçte kayboluyordu. Başlık da son çare olarak okunuyor — vekil
    /// üzerinden gelen sunucu-sunucu çağrılarında firma orada geliyor.
    /// </summary>
    private string? ResolveTenantCode()
        => User.FindFirstValue("TenantCode")
           ?? User.FindFirstValue("tenantCode")
           ?? Request.Headers["X-Tenant-Code"].FirstOrDefault();

    private static TechnicianEarning CreateEarning(
        string? tenantCode,
        Technician technician,
        EarningSourceType sourceType,
        Guid sourceId,
        string? sourceNumber,
        string? customerName,
        string? productName,
        DateTime completedAt,
        string actor)
    {
        return new TechnicianEarning
        {
            TenantCode = tenantCode,
            TechnicianId = technician.Id,
            TechnicianName = technician.FullName,
            TechnicianCariCode = technician.UserId,
            SourceType = sourceType,
            SourceId = sourceId,
            SourceNumber = sourceNumber,
            CustomerName = customerName,
            ProductName = productName,
            CompletedAt = completedAt,
            Amount = 0m,
            Currency = "TRY",
            Status = EarningStatus.Pending,
            CreatedBy = actor,
            CreatedAt = DateTime.UtcNow
        };
    }
}

public sealed class UpdateEarningStatusRequest
{
    public string Status { get; set; } = string.Empty;
    public decimal? Amount { get; set; }
    public string? Currency { get; set; }

    /// <summary>Opsiyonel kur. Verilirse TL karşılığı hesaplanıp AYRICA saklanır; tutar bozulmaz.</summary>
    public decimal? ExchangeRate { get; set; }

    public string? PostedLedgerReference { get; set; }
    public string? Notes { get; set; }
}

public sealed class CreateLedgerPaymentRequest
{
    public Guid TechnicianId { get; set; }
    public decimal Amount { get; set; }
    public string? Currency { get; set; }
    public DateTime? EntryDate { get; set; }
    public string? Description { get; set; }
    public string? ReferenceNumber { get; set; }
    public decimal? ExchangeRate { get; set; }

    /// <summary>Ödeme yerine elle düzeltme olarak işaretler.</summary>
    public bool IsAdjustment { get; set; }
}
