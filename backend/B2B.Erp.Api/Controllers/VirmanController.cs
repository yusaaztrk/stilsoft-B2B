using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/virman")]
[Authorize]
public sealed class VirmanController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    private readonly B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient _money;


    /// <summary>
    /// FİRMANIN SAATİ (2026-08-20 kullanıcı kararı, denetim md. D1). "Bugün" UTC takvim
    /// gününden okunuyordu; KKTC (UTC+3) gibi bir yerde yerel 00:00–03:00 arasında yapılan
    /// işlem BİR ÖNCEKİ güne damgalanıyordu.
    /// </summary>
    private readonly B2B.Erp.Api.Core.Helpers.CompanyClock _clock;

    public VirmanController(
        AppDbContext dbContext,
        B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient money,
        B2B.Erp.Api.Core.Helpers.CompanyClock clock)
    {
        _dbContext = dbContext;
        _money = money;
        _clock = clock;
    }

    public sealed class CreateVirmanRequest
    {
        public DateTime? Date { get; set; }
        public string SourceCustomerCode { get; set; } = string.Empty;
        public string TargetCustomerCode { get; set; } = string.Empty;
        public decimal Amount { get; set; }

        /// <summary>
        /// Virmanın para birimi: 1=TRY 2=EUR 3=USD 4=GBP. Gönderilmezse TL.
        /// Bakiye döviz başına yürüdüğü için aktarımın dövizi belirtilmelidir;
        /// TL bakiyeden USD bakiyeye aktarım virman değil KUR İŞLEMİDİR.
        /// </summary>
        public int? CurrencyTypeId { get; set; }

        /// <summary>İşlem anındaki kur. Gönderilmezse güncel kur çekilir.</summary>
        public decimal? ExchangeRate { get; set; }
        public string? Description { get; set; }
        public string Direction { get; set; } = "debit"; // "debit" or "credit" relative to source customer
    }

    [HttpGet("next-document-no")]
    [AuthorizePage("cash", "virmanListesi")]
    public async Task<IActionResult> GetNextDocumentNo(CancellationToken cancellationToken)
    {
        var docNo = await GenerateUniqueDocumentNo(cancellationToken);
        return Ok(new { success = true, data = docNo });
    }

    [HttpGet]
    [AuthorizePage("cash", "virmanListesi")]
    public async Task<IActionResult> List(
        [FromQuery] int take = 200,
        [FromQuery] int skip = 0,
        CancellationToken cancellationToken = default)
    {
        take = Math.Max(1, Math.Min(1000, take));
        // Sayfalı okuma (2026-10-08): ekran 'son N' yerine skip ile hepsini çekiyor; eski kayıtlar
        // aramada/süzgeçte görünmüyordu (alış faturalarında 25.08 faturası bulunamadı).
        skip = Math.Max(0, skip);

        var rows = await _dbContext.Virmans
            .AsNoTracking()
            .OrderByDescending(x => x.Date)
            .ThenByDescending(x => x.Id)
            .Skip(skip).Take(take)
            .Select(x => new
            {
                x.Id,
                x.DocumentNo,
                x.Date,
                x.SourceCustomerCode,
                SourceCustomerName = x.SourceCustomer.Name,
                x.TargetCustomerCode,
                TargetCustomerName = x.TargetCustomer.Name,
                x.Amount,
                // Virman KENDİ para birimini taşıyor (Create bunu yazıyor) ama liste onu hiç
                // döndürmüyordu: ekran sabit ₺ basıyor, dolarlı virman lira görünüyordu.
                // Yazan var, okuyan yok — bu turda üçüncü kez çıkan desen.
                x.CurrencyTypeId,
                x.ExchangeRate,
                x.Description,
                x.CreateUser
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = rows });
    }

    [HttpPost]
    [AuthorizePage("cash", "virmanListesi")]
    public async Task<IActionResult> Create([FromBody] CreateVirmanRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var sourceCode = (request.SourceCustomerCode ?? string.Empty).Trim();
        var targetCode = (request.TargetCustomerCode ?? string.Empty).Trim();
        var direction = (request.Direction ?? "debit").Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(sourceCode))
        {
            ModelState.AddModelError(nameof(request.SourceCustomerCode), "Kaynak Cari seçilmelidir.");
        }
        if (string.IsNullOrWhiteSpace(targetCode))
        {
            ModelState.AddModelError(nameof(request.TargetCustomerCode), "Hedef Cari seçilmelidir.");
        }
        if (sourceCode == targetCode && !string.IsNullOrWhiteSpace(sourceCode))
        {
            ModelState.AddModelError(nameof(request.TargetCustomerCode), "Kaynak Cari ve Hedef Cari aynı olamaz.");
        }
        if (request.Amount <= 0)
        {
            ModelState.AddModelError(nameof(request.Amount), "Miktar sıfırdan büyük olmalıdır.");
        }
        if (direction != "debit" && direction != "credit")
        {
            ModelState.AddModelError(nameof(request.Direction), "Geçersiz virman yönü.");
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // Validate customers exist
        var sourceExists = await _dbContext.Customers.AnyAsync(x => x.CustomerCode == sourceCode, cancellationToken);
        if (!sourceExists)
        {
            ModelState.AddModelError(nameof(request.SourceCustomerCode), "Kaynak Cari veritabanında bulunamadı.");
            return ValidationProblem(ModelState);
        }

        var targetExists = await _dbContext.Customers.AnyAsync(x => x.CustomerCode == targetCode, cancellationToken);
        if (!targetExists)
        {
            ModelState.AddModelError(nameof(request.TargetCustomerCode), "Hedef Cari veritabanında bulunamadı.");
            return ValidationProblem(ModelState);
        }

        var dateRaw = request.Date?.Date ?? _clock.TodayCompanyDate();
        var date = DateTime.SpecifyKind(dateRaw, DateTimeKind.Utc);
        var username = User.Identity?.Name ?? "System";

        var docNo = await GenerateUniqueDocumentNo(cancellationToken);

        // Begin transaction
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var virmanCurrencyTypeId = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(request.CurrencyTypeId.GetValueOrDefault(1));
            var virmanRate = 1m;
            if (virmanCurrencyTypeId != 1)
            {
                if (request.ExchangeRate.HasValue && request.ExchangeRate.Value > 0m)
                {
                    virmanRate = request.ExchangeRate.Value;
                }
                else
                {
                    try
                    {
                        var virmanCode = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToIsoCode(virmanCurrencyTypeId);
                        var fetched = await _money.GetLatestTryRateAsync(virmanCode, cancellationToken);
                        if (fetched > 0m) virmanRate = fetched;
                    }
                    catch { virmanRate = 1m; }
                }
            }

            var virman = new Virman
            {
                DocumentNo = docNo,
                Date = date,
                SourceCustomerCode = sourceCode,
                TargetCustomerCode = targetCode,
                Amount = request.Amount,
                CurrencyTypeId = virmanCurrencyTypeId,
                ExchangeRate = virmanRate,
                Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            };

            _dbContext.Virmans.Add(virman);
            await _dbContext.SaveChangesAsync(cancellationToken);

            // Create ledger entries
            var sourceDirection = direction == "debit" ? CustomerLedgerEntryDirection.Debit : CustomerLedgerEntryDirection.Credit;
            var targetDirection = direction == "debit" ? CustomerLedgerEntryDirection.Credit : CustomerLedgerEntryDirection.Debit;

            // TL ÇAPASI: `CustomerLedgerEntry.Amount` HER ZAMAN TL'dir; döviz tutarı
            // `CurrencyAmount`ta durur. Buraya `request.Amount` ham yazılıyordu — oysa o tutar
            // virmanın KENDİ para birimindedir. 1.000 $'lık virman (kur 38) cari bakiyesine
            // 38.000 ₺ yerine 1.000 ₺ olarak işliyordu; ekstre, yaşlandırma ve kredi limiti
            // hep TL kolonunu okuduğu için hata tek ekranla sınırlı değildi.
            var virmanTryAmount = Math.Round(
                request.Amount * (virmanRate <= 0m ? 1m : virmanRate), 2, MidpointRounding.AwayFromZero);

            var sourceLedger = new CustomerLedgerEntry
            {
                CustomerCode = sourceCode,
                Date = date,
                Direction = sourceDirection,
                Amount = virmanTryAmount,
                // Virmana para birimi eklendi (2026-08-14). Bakiye döviz başına yürüdüğü için
                // aktarımın hangi dövizde olduğu ŞART: TL bakiyeden USD bakiyeye "virman"
                // aslında bir kur işlemidir, aynı ekstrede kalmaz.
                CurrencyTypeId = virmanCurrencyTypeId,
                CurrencyRate = virmanRate,
                CurrencyAmount = request.Amount,
                PaymentCurrencyTypeId = virmanCurrencyTypeId,
                PaymentCurrencyRate = virmanRate,
                PaymentCurrencyAmount = request.Amount,
                DocumentNo = docNo,
                Description = virman.Description,
                TransactionType = "Virman",
                ReferenceType = CustomerLedgerEntryReferenceType.Virman,
                ReferenceId = virman.Id,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            };

            var targetLedger = new CustomerLedgerEntry
            {
                CustomerCode = targetCode,
                Date = date,
                Direction = targetDirection,
                Amount = virmanTryAmount,
                CurrencyTypeId = virmanCurrencyTypeId,
                CurrencyRate = virmanRate,
                CurrencyAmount = request.Amount,
                PaymentCurrencyTypeId = virmanCurrencyTypeId,
                PaymentCurrencyRate = virmanRate,
                PaymentCurrencyAmount = request.Amount,
                DocumentNo = docNo,
                Description = virman.Description,
                TransactionType = "Virman",
                ReferenceType = CustomerLedgerEntryReferenceType.Virman,
                ReferenceId = virman.Id,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            };

            _dbContext.CustomerLedgerEntries.AddRange(sourceLedger, targetLedger);
            await _dbContext.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);

            return Ok(new { success = true, data = new { id = virman.Id, documentNo = virman.DocumentNo } });
        }
        catch (Exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public sealed class UpdateVirmanRequest
    {
        public decimal Amount { get; set; }
    }

    [HttpPut("{id:int}")]
    [AuthorizePage("cash", "virmanListesi")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] UpdateVirmanRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        if (request.Amount <= 0)
        {
            return BadRequest(new { success = false, message = "Miktar sıfırdan büyük olmalıdır." });
        }

        var virman = await _dbContext.Virmans.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (virman is null)
        {
            return NotFound(new { success = false, message = "Virman kaydı bulunamadı." });
        }

        var username = User.Identity?.Name ?? "System";

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            virman.Amount = request.Amount;
            virman.EditUser = username;
            virman.EditTime = DateTime.UtcNow;

            var ledgerEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Virman && x.ReferenceId == id)
                .ToListAsync(cancellationToken);

            // Tutar güncellenirken TL çapası da yeniden üretilmeli. Öncesinde hem `Amount`
            // hem `CurrencyAmount` aynı ham değere eziliyor, kur ise hiç dikkate alınmıyordu:
            // dövizli bir virmanın tutarını düzenlemek onu sessizce TL'ye çeviriyordu.
            // Para birimi bu uçta değişmiyor, dolayısıyla kaydın kendi kuru kullanılır.
            var updateRate = virman.ExchangeRate <= 0m ? 1m : virman.ExchangeRate;
            var updateTryAmount = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(virman.CurrencyTypeId)
                ? request.Amount
                : Math.Round(request.Amount * updateRate, 2, MidpointRounding.AwayFromZero);

            foreach (var entry in ledgerEntries)
            {
                entry.Amount = updateTryAmount;
                entry.CurrencyAmount = request.Amount;
                entry.CurrencyRate = updateRate;
                entry.CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(virman.CurrencyTypeId);
                // Ekleme dalı bu üçünü de yazıyor; güncelleme dalı atlıyordu ve tutar
                // düzeltilse bile PaymentCurrency* eski değerde kalıyordu.
                entry.PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(virman.CurrencyTypeId);
                entry.PaymentCurrencyRate = updateRate;
                entry.PaymentCurrencyAmount = request.Amount;
                entry.EditUser = username;
                entry.EditTime = DateTime.UtcNow;
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return Ok(new { success = true });
        }
        catch (Exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("cash", "virmanListesi")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var virman = await _dbContext.Virmans.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (virman is null)
        {
            return NotFound(new { success = false, message = "Virman kaydı bulunamadı." });
        }

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, virman, "deleteRule/virman", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            // Delete related customer ledger entries
            var ledgerEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Virman && x.ReferenceId == id)
                .ToListAsync(cancellationToken);

            if (ledgerEntries.Count > 0)
            {
                _dbContext.CustomerLedgerEntries.RemoveRange(ledgerEntries);
            }

            _dbContext.Virmans.Remove(virman);
            await _dbContext.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);

            return Ok(new { success = true });
        }
        catch (Exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    [HttpGet("report")]
    [AuthorizePage("cash", "virmanListesi")]
    public async Task<IActionResult> Report(
        [FromQuery] int? currencyTypeId,
        CancellationToken cancellationToken = default)
    {
        // HER KUR KENDİ KOVASINDA YÜRÜR (2026-08-19, kullanıcı kuralı).
        //
        // Rapor `Amount` (TL çapası) toplayıp tek bakiye veriyordu: dolar virmanı ile TL
        // virmanı aynı rakamda karışıyor, "bu carinin kaç doları var" sorusu cevapsız
        // kalıyordu. Artık satır KENDİ para biriminde (`CurrencyAmount`) toplanıyor ve her
        // para birimi AYRI satır oluyor. Çevrim YOK.
        var filterCurrencyTypeId = currencyTypeId.HasValue && currencyTypeId.Value > 0
            ? B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(currencyTypeId.Value)
            : (int?)null;

        var virmanRows = await _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Virman)
            .Select(x => new
            {
                x.CustomerCode,
                CustomerName = x.Customer.Name,
                x.Direction,
                x.CurrencyTypeId,
                x.CurrencyAmount,
                x.Amount
            })
            .ToListAsync(cancellationToken);

        var rawData = virmanRows
            .Select(x => new
            {
                x.CustomerCode,
                x.CustomerName,
                x.Direction,
                Cur = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(x.CurrencyTypeId),
                // Satırın kendi tutarı; boş kalmış eski satır zaten TL'dir.
                Value = x.CurrencyAmount > 0m ? x.CurrencyAmount : x.Amount
            })
            .GroupBy(x => new { x.CustomerCode, x.CustomerName, x.Cur })
            .Select(g => new
            {
                CustomerCode = g.Key.CustomerCode,
                CustomerName = g.Key.CustomerName,
                CurrencyTypeId = g.Key.Cur,
                DebitAmount = g.Where(x => x.Direction == CustomerLedgerEntryDirection.Debit).Sum(x => x.Value),
                CreditAmount = g.Where(x => x.Direction == CustomerLedgerEntryDirection.Credit).Sum(x => x.Value),
            })
            .Where(x => !filterCurrencyTypeId.HasValue || x.CurrencyTypeId == filterCurrencyTypeId.Value)
            .ToList();

        var availableCurrencyTypeIds = virmanRows
            .Select(x => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(x.CurrencyTypeId))
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        if (availableCurrencyTypeIds.Count == 0)
        {
            availableCurrencyTypeIds.Add(B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try);
        }

        var data = rawData.Select(x => new
        {
            x.CustomerCode,
            x.CustomerName,
            x.DebitAmount,
            x.CreditAmount,
            // Satırın TAMAMI bu para birimindedir.
            x.CurrencyTypeId,
            ParaBirimi = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCodeOrTry(x.CurrencyTypeId),
            ParaBirimiSimge = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToSymbol(x.CurrencyTypeId),
            // BAKİYE YÖNÜ CARİ EKSTRESİYLE AYNI: BORÇ − ALACAK (kullanıcı kararı, 2026-08-17).
            // Önceden `Alacak − Borç` yürüyordu; virman ekranları kendi içinde tutarlıydı ama
            // aynı cariye cari ekstresinden bakan kişi TERS işaret görüyordu. Detay ekranındaki
            // yürüyen bakiye de aynı anda çevrildi, ikisi ayrı düşmesin.
            Balance = x.DebitAmount - x.CreditAmount
        }).ToList();

        return Ok(new
        {
            success = true,
            currencyTypeId = filterCurrencyTypeId,
            availableCurrencyTypeIds,
            data
        });
    }

    [HttpGet("report/{customerCode}")]
    [AuthorizePage("cash", "virmanListesi")]
    public async Task<IActionResult> ReportDetail([FromRoute] string customerCode, CancellationToken cancellationToken = default)
    {
        customerCode = (customerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(customerCode))
        {
            return BadRequest(new { success = false, message = "Cari kodu geçersiz" });
        }

        var customer = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);
        if (customer is null)
        {
            return NotFound(new { success = false, message = "Cari bulunamadı" });
        }

        var items = await _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Virman && x.CustomerCode == customerCode)
            .OrderByDescending(x => x.Date)
            .ThenByDescending(x => x.Id)
            .Select(x => new
            {
                x.Id,
                x.DocumentNo,
                x.Date,
                Direction = x.Direction == CustomerLedgerEntryDirection.Debit ? "Çıkış (Borç)" : "Giriş (Alacak)",
                DirectionId = (int)x.Direction,
                x.Amount,
                // Ekstre satırı TL çapasını (`Amount`) tutar; döviz karşılığı ayrı kolonda.
                x.CurrencyTypeId,
                x.CurrencyRate,
                x.CurrencyAmount,
                x.Description,
                x.CreateUser
            })
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            customer = new { customer.CustomerCode, customer.Name },
            data = items
        });
    }

    private async Task<string> GenerateUniqueDocumentNo(CancellationToken cancellationToken)
    {
        var lastEntry = await _dbContext.Virmans
            .AsNoTracking()
            .OrderByDescending(x => x.Id)
            .Select(x => x.DocumentNo)
            .FirstOrDefaultAsync(cancellationToken);

        long nextNum = 1;
        if (!string.IsNullOrEmpty(lastEntry) && lastEntry.StartsWith("VRM") && lastEntry.Length == 13)
        {
            if (long.TryParse(lastEntry.Substring(3), out var lastNum))
            {
                nextNum = lastNum + 1;
            }
        }

        while (true)
        {
            var docNo = $"VRM{nextNum:D10}";
            var exists = await _dbContext.Virmans.AnyAsync(x => x.DocumentNo == docNo, cancellationToken);
            if (!exists)
            {
                return docNo;
            }
            nextNum++;
        }
    }
}
