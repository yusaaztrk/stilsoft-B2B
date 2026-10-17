using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Checks;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class PayableChecksController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly IMoneyServiceClient _money;

    public PayableChecksController(AppDbContext dbContext, IMoneyServiceClient money)
    {
        _dbContext = dbContext;
        _money = money;
    }

    // Bu yardımcı ESKİ kodlamayı (0=TRY 1=USD 2=EUR 3=GBP) taşıyordu: TL çeki USD kuruyla,
    // USD çeki GBP kuruyla damgalanıyor, GBP çeki (4) null düşüp hiç kesilemiyordu.
    // Kanonik kodlama CurrencyTypeHelper'da (1=TRY 2=EUR 3=USD 4=GBP).
    private static string? MapCurrencyTypeIdToCode(int currencyTypeId)
        => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCode(currencyTypeId);

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt == default) return DateTime.UtcNow;
        return dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }

    private string GetUsernameOrSystem()
    {
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        return string.IsNullOrWhiteSpace(username) ? "System" : username;
    }

    /*
      BORÇ ÇEKİ CARİ EKSTREYE VERİLDİĞİ AN YAZILIR (2026-10-12, kullanıcı kararı: "verildiği anda olacak").

      Eskiden ekstre satırı yalnız "Öde" işleminde, ÖDEME tarihiyle yazılıyordu: cariye verilen ama vadesi
      gelmemiş çek ekstrede hiç görünmüyor, carinin borcu olduğundan fazla duruyordu. Artık:
        - Ver (tekli/toplu) → veriliş tarihiyle satır; Düzenle → satır yeniden yazılır.
        - Öde → yalnız banka çıkışı (satır zaten var; eski çekte yoksa eklenir).
        - Ödemeyi geri al / beklemeye al (ödenmişten) → yalnız banka hareketi silinir, satır KALIR.
        - İptal / Sil / İade / Karşılıksız → satır kalkar (borç geri gelir); iptalden beklemeye → yeniden yazılır.
      Defter seçimi MÜŞTERİ ÖNCE (müşteri çekiyle aynı kural): kod hem müşteri hem tedarikçi tablosundaysa
      eskiden "Öde" satırı tedarikçi defterine gidiyor, müşterinin ekstresinde hiç görünmüyordu.
      Satırın kimliği: ReferenceId = çek Id + TransactionType "Borç Çeki" (müşteri çeki ile id'ler çakışır).
      Müşteri Çeki akışına (CustomerChecksController) DOKUNULMADI.
    */
    private const string LedgerType = "Borç Çeki";

    private async Task AddIssueLedgerAsync(PayableCheck entity, string username, DateTime now, CancellationToken ct)
    {
        // Ekstre kayıt zamanına göre sıralanır: satır, belgenin GİRİLDİĞİ ana oturur (eski kayıtta da).
        var sira = entity.CreateTime == default ? now : entity.CreateTime;
        var documentNo = !string.IsNullOrWhiteSpace(entity.CheckNo) ? entity.CheckNo : entity.DocumentNo;
        var currency = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId);
        var rate = entity.CurrencyRate > 0m ? entity.CurrencyRate : 1m;
        var tl = Math.Round(entity.Amount * rate, 2, MidpointRounding.AwayFromZero);
        var description = $"Borç Çeki Verildi ({documentNo})";

        if (!string.IsNullOrWhiteSpace(entity.CustomerCode))
        {
            _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
            {
                CustomerCode = entity.CustomerCode,
                Date = entity.IssueDate,
                DueDate = entity.DueDate,
                Direction = CustomerLedgerEntryDirection.Debit,
                Amount = tl,
                CurrencyTypeId = currency,
                CurrencyRate = rate,
                CurrencyAmount = entity.Amount,
                PaymentCurrencyTypeId = currency,
                PaymentCurrencyRate = rate,
                PaymentCurrencyAmount = entity.Amount,
                DocumentNo = documentNo,
                Description = description,
                TransactionType = LedgerType,
                ReferenceType = CustomerLedgerEntryReferenceType.Check,
                ReferenceId = entity.Id,
                CreateUser = username,
                CreateTime = sira
            });
            return;
        }

        if (entity.SupplierId.HasValue)
        {
            var supplierCode = await _dbContext.Suppliers.AsNoTracking()
                .Where(x => x.Id == entity.SupplierId.Value)
                .Select(x => x.SupplierCode)
                .FirstOrDefaultAsync(ct);
            if (string.IsNullOrWhiteSpace(supplierCode)) return;

            _dbContext.SupplierLedgerEntries.Add(new SupplierLedgerEntry
            {
                SupplierCode = supplierCode,
                Date = entity.IssueDate,
                DueDate = entity.DueDate,
                Direction = SupplierLedgerEntryDirection.Debit,
                Amount = tl,
                CurrencyTypeId = currency,
                CurrencyRate = rate,
                CurrencyAmount = entity.Amount,
                DocumentNo = documentNo,
                Description = description,
                TransactionType = LedgerType,
                ReferenceType = SupplierLedgerEntryReferenceType.Manual,
                ReferenceId = entity.Id,
                CreateUser = username,
                CreateTime = sira
            });
        }
    }

    private async Task<bool> HasIssueLedgerAsync(int checkId, CancellationToken ct) =>
        await _dbContext.CustomerLedgerEntries.AnyAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check
                                                             && x.ReferenceId == checkId && x.TransactionType == LedgerType, ct)
        || await _dbContext.SupplierLedgerEntries.AnyAsync(x => x.ReferenceId == checkId && x.TransactionType == LedgerType, ct);

    private async Task RemoveIssueLedgerAsync(int checkId, CancellationToken ct)
    {
        var cust = await _dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check && x.ReferenceId == checkId && x.TransactionType == LedgerType)
            .ToListAsync(ct);
        if (cust.Count > 0) _dbContext.CustomerLedgerEntries.RemoveRange(cust);

        var sup = await _dbContext.SupplierLedgerEntries
            .Where(x => x.ReferenceId == checkId && x.TransactionType == LedgerType)
            .ToListAsync(ct);
        if (sup.Count > 0) _dbContext.SupplierLedgerEntries.RemoveRange(sup);
    }

    private async Task<string> GenerateDocumentNo15Async(CancellationToken cancellationToken)
    {
        // 15-digit numeric: yyMMddHHmmssfff
        for (var i = 0; i < 20; i++)
        {
            var docNo = DateTime.UtcNow.ToString("yyMMddHHmmssfff");
            var exists = await _dbContext.PayableChecks.AsNoTracking().AnyAsync(x => x.DocumentNo == docNo, cancellationToken);
            if (!exists) return docNo;
            await Task.Delay(1, cancellationToken);
        }

        // SAYISAL KALMALI (denetim md. 1/3).
        //
        // Yedek yol `Guid.NewGuid().ToString("N")` kullanıyordu; onaltılık gösterim `a-f`
        // harfleri içerir ve bu alan 15 HANELİ SAYI olarak tanımlı. Banka/muhasebe dosya
        // aktarımları harf gördüğünde belgeyi reddeder. Yedek yol da sayısal üretiyor.
        return System.Random.Shared.NextInt64(100000000000000L, 999999999999999L).ToString();
    }

    private static bool IsUniqueViolation(DbUpdateException ex)
    {
        if (ex.InnerException is not Npgsql.PostgresException pg) return false;
        // 23505: unique_violation
        return pg.SqlState == "23505";
    }

    private static bool IsDeadlockException(Exception? ex)
    {
        while (ex is not null)
        {
            if (ex is Npgsql.PostgresException pgEx && pgEx.SqlState == "40P01")
                return true;
            ex = ex.InnerException;
        }
        return false;
    }

    private static long? TryParseLong(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return long.TryParse(value.Trim(), out var n) ? n : null;
    }

    private async Task<string> GenerateNextBordroNoAsync(CancellationToken cancellationToken)
    {
        // Numeric, increasing: max(DocumentNo) + 1 (fallback to timestamp if none)
        //
        // SIRALAMA SQL'DE METİNDİ ve metin sıralamasında "99" > "100000": numara 99'a ulaştığı
        // anda en büyük belge sonsuza dek "99" görünüyor, üretilen numara her seferinde "100"
        // oluyordu — yani numaratör 99'dan sonra ilerlemiyor ve mükerrer bordro numarası
        // üretiyordu. Sayısal karşılaştırma yapılabilmesi için numaralar okunup en büyüğü
        // sayısal olarak seçiliyor (tablo küçük; sayısal olmayan eski değerler eleniyor).
        // EN BÜYÜK NUMARA SQL TARAFINDA BULUNUR (denetim md. 2 — O(N) bellek).
        //
        // Yukarıdaki metin-sıralaması tuzağı yüzünden numaralar belleğe çekilip sayısal
        // karşılaştırılıyordu; çek sayısı arttıkça her yeni çek girişinde bütün belge
        // numaraları ağdan geçiyordu. Aynı sayısal karşılaştırma PostgreSQL'de de yapılabilir:
        // yalnız tamamı rakam olan değerler `bigint`e çevrilip `MAX` alınıyor (regex süzgeci
        // olmadan `CAST` sayısal olmayan eski kayıtlarda patlardı). Ham SQL çalışmazsa
        // eski (belleğe alan) yola düşülüyor — numara üretememek daha kötü olur.
        long? maxNum = null;

        try
        {
            var rows = await _dbContext.Database
                .SqlQueryRaw<long>(
                    @"SELECT COALESCE(MAX(CAST(""DocumentNo"" AS bigint)), 0) AS ""Value""
                      FROM ""PayableChecks""
                      WHERE ""DocumentNo"" ~ '^[0-9]+$'")
                .ToListAsync(cancellationToken);

            if (rows.Count > 0 && rows[0] > 0) maxNum = rows[0];
        }
        catch
        {
            maxNum = null;
        }

        if (maxNum is null)
        {
            var documentNos = await _dbContext.PayableChecks
                .AsNoTracking()
                .Select(x => x.DocumentNo)
                .ToListAsync(cancellationToken);

            foreach (var doc in documentNos)
            {
                var parsed = TryParseLong(doc);
                if (parsed.HasValue && (maxNum is null || parsed.Value > maxNum.Value))
                {
                    maxNum = parsed.Value;
                }
            }
        }

        if (maxNum.HasValue)
        {
            return (maxNum.Value + 1).ToString();
        }

        // fallback to 15-digit numeric in case legacy data isn't numeric
        return await GenerateDocumentNo15Async(cancellationToken);
    }

    [HttpGet]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> List([FromQuery] string? customerCode = null, [FromQuery] int take = 200, CancellationToken cancellationToken = default)
    {
        take = Math.Max(1, Math.Min(1000, take));
        var cleanCustomerCode = string.IsNullOrWhiteSpace(customerCode) ? null : customerCode.Trim();

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            try
            {
                var query = from pc in _dbContext.PayableChecks.AsNoTracking()
                            join c in _dbContext.Customers.AsNoTracking() on pc.CustomerCode equals c.CustomerCode into cJoin
                            from c in cJoin.DefaultIfEmpty()
                            join s in _dbContext.Suppliers.AsNoTracking() on pc.SupplierId equals s.Id into sJoin
                            from s in sJoin.DefaultIfEmpty()
                            join b in _dbContext.BankAccountDefinitions.AsNoTracking() on pc.BankAccountDefinitionId equals b.Id into bJoin
                            from b in bJoin.DefaultIfEmpty()
                            select new { pc, c, s, b };

                if (cleanCustomerCode != null)
                {
                    query = query.Where(x => x.pc.CustomerCode == cleanCustomerCode);
                }

                var rows = await query
                    .OrderByDescending(x => x.pc.DueDate).ThenByDescending(x => x.pc.Id)
                    .Take(take)
                    .Select(x => new PayableCheckListItemResponse
                    {
                        Id = x.pc.Id,
                        DocumentNo = x.pc.DocumentNo,
                        CustomerCode = x.pc.CustomerCode ?? (x.s != null ? x.s.SupplierCode : string.Empty),
                        CustomerName = x.c != null ? (x.c.Name ?? string.Empty) : (x.s != null ? (x.s.FullName ?? string.Empty) : string.Empty),
                        IssueDate = x.pc.IssueDate,
                        DueDate = x.pc.DueDate,
                        Amount = x.pc.Amount,
                        CurrencyTypeId = x.pc.CurrencyTypeId,
                        CurrencyRate = x.pc.CurrencyRate,
                        CurrencyAmount = x.pc.CurrencyAmount,
                        BankName = x.pc.BankName,
                        BranchName = x.pc.BranchName,
                        CheckNo = x.pc.CheckNo,
                        Status = x.pc.Status,
                        BankAccountDefinitionId = x.pc.BankAccountDefinitionId,
                        BankAccountName = x.b != null ? x.b.AccountName : null,
                        CreateUser = x.pc.CreateUser
                    })
                    .ToListAsync(cancellationToken);

                return Ok(new { success = true, data = rows });
            }
            catch (Exception ex) when (IsDeadlockException(ex) && attempt < 5)
            {
                await Task.Delay(100 * attempt, cancellationToken);
            }
        }

        return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Listeleme işlemi tekrar deneyin" });
    }

    [HttpPost]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> Create([FromBody] CreatePayableCheckRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        // Bordro No sistem tarafından otomatik atanır
        var documentNo = string.Empty;
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            var candidate = await GenerateNextBordroNoAsync(cancellationToken);
            var exists = await _dbContext.PayableChecks.AsNoTracking().AnyAsync(x => x.DocumentNo == candidate, cancellationToken);
            if (!exists)
            {
                documentNo = candidate;
                break;
            }
            await Task.Delay(10 * attempt, cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(documentNo))
        {
            documentNo = await GenerateDocumentNo15Async(cancellationToken);
        }

        var customerCode = request.CustomerCode?.Trim();
        if (string.IsNullOrWhiteSpace(customerCode)) return BadRequest(new { success = false, message = "Cari seçmelisiniz" });

        var checkNo = string.IsNullOrWhiteSpace(request.CheckNo) ? null : request.CheckNo.Trim();
        if (!string.IsNullOrWhiteSpace(checkNo))
        {
            var existsCheckNo = await _dbContext.PayableChecks.AsNoTracking().AnyAsync(x => x.CheckNo == checkNo, cancellationToken);
            if (existsCheckNo)
            {
                return BadRequest(new { success = false, message = $"Çek seri no zaten mevcut: {checkNo}" });
            }
        }

        var supplier = await _dbContext.Suppliers.AsNoTracking().FirstOrDefaultAsync(x => x.SupplierCode == customerCode, cancellationToken);
        var customer = await _dbContext.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (supplier == null && customer == null)
        {
            return BadRequest(new { success = false, message = $"Cari bulunamadı: '{customerCode}'" });
        }

        if (request.BankAccountDefinitionId <= 0)
        {
            return BadRequest(new { success = false, message = "Banka hesabı seçmelisiniz" });
        }

        var bankExists = await _dbContext.BankAccountDefinitions.AsNoTracking().AnyAsync(x => x.Id == request.BankAccountDefinitionId, cancellationToken);
        if (!bankExists) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });

        var currencyRate = request.CurrencyRate;
        if (currencyRate <= 0)
        {
            var code = MapCurrencyTypeIdToCode(request.CurrencyTypeId);
            if (string.IsNullOrWhiteSpace(code))
            {
                return BadRequest(new { success = false, message = "Döviz kur geçersiz" });
            }

            if (code == "TRY")
            {
                currencyRate = 1m;
            }
            else
            {
                try
                {
                    currencyRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                }
                catch
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                    {
                        success = false,
                        message = "Kur bilgisi alınamadı. Lütfen kuru elle girin."
                    });
                }

                if (currencyRate <= 0)
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                    {
                        success = false,
                        message = "Kur bilgisi alınamadı. Lütfen kuru elle girin."
                    });
                }
            }
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        var entity = new PayableCheck
        {
            DocumentNo = documentNo,
            CustomerCode = customer != null ? customer.CustomerCode : null,
            SupplierId = supplier != null ? supplier.Id : null,
            IssueDate = NormalizeUtc(request.IssueDate),
            DueDate = NormalizeUtc(request.DueDate),
            Amount = request.Amount,
            CurrencyTypeId = request.CurrencyTypeId,
            CurrencyRate = currencyRate,
            CurrencyAmount = request.Amount * currencyRate,
            BankName = string.IsNullOrWhiteSpace(request.BankName) ? null : request.BankName.Trim(),
            BranchName = string.IsNullOrWhiteSpace(request.BranchName) ? null : request.BranchName.Trim(),
            CheckNo = checkNo,
            Status = PayableCheckStatus.Issued,
            BankAccountDefinitionId = request.BankAccountDefinitionId,
            CreateUser = username,
            CreateTime = now
        };


        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        _dbContext.PayableChecks.Add(entity);
        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // very rare race - regenerate and retry once
            entity.DocumentNo = await GenerateNextBordroNoAsync(cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableCheck,
            DocumentId = entity.Id,
            Date = entity.IssueDate,
            Type = CheckOperationType.Create,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = entity.BankAccountDefinitionId,
            Description = "Oluşturuldu",
            CreateUser = username,
            CreateTime = now
        });

        // Cari ekstreye veriliş anında (bkz. AddIssueLedgerAsync).
        await AddIssueLedgerAsync(entity, username, now, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id } });
    }

    [HttpPost("bulk")]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> BulkCreate([FromBody] List<CreatePayableCheckRequest> requests, CancellationToken cancellationToken)
    {
        if (requests is null || requests.Count == 0)
        {
            return BadRequest(new { success = false, message = "Kayıt bulunamadı" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        var createdIds = new List<int>();

        var inputCheckNos = requests
            .Select(r => string.IsNullOrWhiteSpace(r.CheckNo) ? null : r.CheckNo.Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Cast<string>()
            .ToList();

        var dupInInput = inputCheckNos
            .GroupBy(x => x)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .FirstOrDefault();

        if (!string.IsNullOrWhiteSpace(dupInInput))
        {
            return BadRequest(new { success = false, message = $"Aynı çek seri no birden fazla kez girilmiş: {dupInInput}" });
        }

        if (inputCheckNos.Count > 0)
        {
            var existsAny = await _dbContext.PayableChecks.AsNoTracking().AnyAsync(x => x.CheckNo != null && inputCheckNos.Contains(x.CheckNo), cancellationToken);
            if (existsAny)
            {
                return BadRequest(new { success = false, message = "Girilen çek seri no'larından bazıları zaten mevcut" });
            }
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        foreach (var request in requests)
        {
            if (!TryValidateModel(request)) return ValidationProblem(ModelState);

            var documentNo = await GenerateNextBordroNoAsync(cancellationToken);

            var customerCode = request.CustomerCode?.Trim();
            if (string.IsNullOrWhiteSpace(customerCode)) return BadRequest(new { success = false, message = "Cari seçmelisiniz" });

            var supplier = await _dbContext.Suppliers.AsNoTracking().FirstOrDefaultAsync(x => x.SupplierCode == customerCode, cancellationToken);
            var customer = await _dbContext.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

            if (supplier == null && customer == null)
            {
                return BadRequest(new { success = false, message = $"Cari bulunamadı: '{customerCode}'" });
            }

            if (request.BankAccountDefinitionId <= 0)
            {
                return BadRequest(new { success = false, message = "Banka hesabı seçmelisiniz" });
            }

            var bankExists = await _dbContext.BankAccountDefinitions.AsNoTracking().AnyAsync(x => x.Id == request.BankAccountDefinitionId, cancellationToken);
            if (!bankExists) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });

            var currencyRate = request.CurrencyRate;
            if (currencyRate <= 0)
            {
                var code = MapCurrencyTypeIdToCode(request.CurrencyTypeId);
                if (string.IsNullOrWhiteSpace(code))
                {
                    return BadRequest(new { success = false, message = "Döviz kur geçersiz" });
                }

                if (code == "TRY")
                {
                    currencyRate = 1m;
                }
                else
                {
                    try
                    {
                        currencyRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                    }
                    catch
                    {
                        return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                        {
                            success = false,
                            message = "Kur bilgisi alınamadı. Lütfen kuru elle girin."
                        });
                    }

                    if (currencyRate <= 0)
                    {
                        return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                        {
                            success = false,
                            message = "Kur bilgisi alınamadı. Lütfen kuru elle girin."
                        });
                    }
                }
            }

            var checkNo = string.IsNullOrWhiteSpace(request.CheckNo) ? null : request.CheckNo.Trim();

            var entity = new PayableCheck
            {
                DocumentNo = documentNo,
                CustomerCode = customer != null ? customer.CustomerCode : null,
                SupplierId = supplier != null ? supplier.Id : null,
                IssueDate = NormalizeUtc(request.IssueDate),
                DueDate = NormalizeUtc(request.DueDate),
                Amount = request.Amount,
                CurrencyTypeId = request.CurrencyTypeId,
                CurrencyRate = currencyRate,
                CurrencyAmount = request.Amount * currencyRate,
                BankName = string.IsNullOrWhiteSpace(request.BankName) ? null : request.BankName.Trim(),
                BranchName = string.IsNullOrWhiteSpace(request.BranchName) ? null : request.BranchName.Trim(),
                CheckNo = checkNo,
                Status = PayableCheckStatus.Issued,
                BankAccountDefinitionId = request.BankAccountDefinitionId,
                CreateUser = username,
                CreateTime = now
            };

            _dbContext.PayableChecks.Add(entity);
            try
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (IsUniqueViolation(ex))
            {
                // rare race; regenerate and retry
                entity.DocumentNo = await GenerateNextBordroNoAsync(cancellationToken);
                await _dbContext.SaveChangesAsync(cancellationToken);
            }

            _dbContext.CheckOperations.Add(new CheckOperation
            {
                DocumentType = CheckDocumentType.PayableCheck,
                DocumentId = entity.Id,
                Date = entity.IssueDate,
                Type = CheckOperationType.Create,
                Amount = entity.Amount,
                CurrencyTypeId = entity.CurrencyTypeId,
                BankAccountDefinitionId = entity.BankAccountDefinitionId,
                Description = "Oluşturuldu",
                CreateUser = username,
                CreateTime = now
            });

            await AddIssueLedgerAsync(entity, username, now, cancellationToken);

            await _dbContext.SaveChangesAsync(cancellationToken);
            createdIds.Add(entity.Id);
        }

        await tx.CommitAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = createdIds.Select(id => new { id }).ToList() });
    }

    [HttpPost("{id:int}/endorse-to-bank")]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> EndorseToBank([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!request.BankAccountDefinitionId.HasValue || request.BankAccountDefinitionId.Value <= 0)
        {
            return BadRequest(new { success = false, message = "Banka hesabı seçmelisiniz" });
        }

        var entity = await _dbContext.PayableChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != PayableCheckStatus.Issued)
        {
            return BadRequest(new { success = false, message = "Bu işlem sadece ilk kayıttaki borç çekleri için yapılabilir" });
        }

        var bankExists = await _dbContext.BankAccountDefinitions.AsNoTracking().AnyAsync(x => x.Id == request.BankAccountDefinitionId.Value, cancellationToken);
        if (!bankExists) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableCheckStatus.EndorsedToBank;
        entity.BankAccountDefinitionId = request.BankAccountDefinitionId.Value;
        entity.EditUser = username;
        entity.EditTime = now;

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.EndorseToBankForCollection,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = entity.BankAccountDefinitionId,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/pay")]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> Pay([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var bankId = request.BankAccountDefinitionId ?? entity.BankAccountDefinitionId;
        if (!bankId.HasValue || bankId.Value <= 0)
        {
            return BadRequest(new { success = false, message = "Banka hesabı seçmelisiniz" });
        }

        if (entity.Status == PayableCheckStatus.Paid)
        {
            return BadRequest(new { success = false, message = "Bu borç çeki zaten ödendi" });
        }

        var bankAcc = await _dbContext.BankAccountDefinitions.AsNoTracking()
            .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.CurrencyTypeId })
            .FirstOrDefaultAsync(x => x.Id == bankId.Value, cancellationToken);

        if (bankAcc is null) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });

        var customer = !string.IsNullOrWhiteSpace(entity.CustomerCode)
            ? await _dbContext.Customers.AsNoTracking().Select(x => new { x.CustomerCode, x.Name }).FirstOrDefaultAsync(x => x.CustomerCode == entity.CustomerCode, cancellationToken)
            : null;

        var supplier = entity.SupplierId.HasValue
            ? await _dbContext.Suppliers.AsNoTracking().Select(x => new { x.Id, x.SupplierCode, x.FullName }).FirstOrDefaultAsync(x => x.Id == entity.SupplierId.Value, cancellationToken)
            : null;

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        // Çek tutarı çekin kendi parasında; TL sütunu kurla üretilir.
        var payableRate = 1m;
        if (!B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.IsValid(entity.CurrencyTypeId)
            || B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(entity.CurrencyTypeId) != 1)
        {
            try
            {
                var payableCode = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToIsoCode(entity.CurrencyTypeId);
                var fetched = await _money.GetLatestTryRateAsync(payableCode, cancellationToken);
                if (fetched > 0m) payableRate = fetched;
            }
            catch { payableRate = 1m; }
        }
        var payableTlAmount = Math.Round(entity.Amount * payableRate, 2, MidpointRounding.AwayFromZero);

        // Banka hareketi HESABIN kendi para birimindedir, belgenin değil: TL hesaptan ödenen
        // dolar çeki satıra "USD" yazıyordu ve TL banka ekstresi süzgecinde (0/1) kayboluyordu.
        // Kur hareket yazılmadan ÖNCE çözülüyor — ortada yarım kayıt kalmasın diye.
        (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) bankMv;
        try
        {
            bankMv = await B2B.Erp.Api.Core.Helpers.AccountMovementCurrency.ResolveAsync(
                _money, bankAcc.CurrencyTypeId, payableTlAmount, cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(503, new { success = false, message = ex.Message });
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableCheckStatus.Paid;
        entity.BankAccountDefinitionId = bankAcc.Id;
        entity.EditUser = username;
        entity.EditTime = now;

        _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
        {
            BankAccountDefinitionId = bankAcc.Id,
            Date = date,
            Direction = BankAccountTransactionDirection.Out,
            Amount = payableTlAmount,
            CurrencyTypeId = bankMv.CurrencyTypeId,
            CurrencyRate = bankMv.Rate,
            CurrencyAmount = bankMv.CurrencyAmount,
            CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
            CounterpartyCode = customer?.CustomerCode ?? supplier?.SupplierCode ?? string.Empty,
            CounterpartyName = customer?.Name ?? supplier?.FullName ?? string.Empty,
            Description = $"Borç Çeki Ödeme ({entity.DocumentNo})",
            IsPosFee = false,
            CreateUser = username,
            CreateTime = now
        });

        // Ekstre satırı çek VERİLİRKEN yazıldı; ödeme yalnız bankadan çıkıştır. Bu değişiklikten
        // önce verilmiş (satırı olmayan) çekte satır burada veriliş tarihiyle eklenir.
        if (!await HasIssueLedgerAsync(entity.Id, cancellationToken))
        {
            await AddIssueLedgerAsync(entity, username, now, cancellationToken);
        }

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.Collect,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = bankAcc.Id,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/unpay")]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> Unpay([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != PayableCheckStatus.Paid)
        {
            return BadRequest(new { success = false, message = "Bu çek ödendi durumunda değil" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableCheckStatus.Issued;
        entity.EditUser = username;
        entity.EditTime = now;

        var bankTx = await _dbContext.BankAccountTransactions
            .Where(x => x.BankAccountDefinitionId == entity.BankAccountDefinitionId && x.Description == $"Borç Çeki Ödeme ({entity.DocumentNo})")
            .ToListAsync(cancellationToken);
        if (bankTx.Count > 0)
        {
            _dbContext.BankAccountTransactions.RemoveRange(bankTx);
        }

        // Ekstre satırı SİLİNMEZ: ödeme geri alındı ama çek hâlâ cariye verilmiş durumda.
        // (Eskiden ödeme satırı silinirdi; satır artık verilişte yazılıyor.)
        if (!await HasIssueLedgerAsync(entity.Id, cancellationToken))
        {
            await AddIssueLedgerAsync(entity, username, now, cancellationToken);
        }

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableCheck,
            DocumentId = entity.Id,
            Date = now,
            Type = CheckOperationType.Create,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = entity.BankAccountDefinitionId,
            Description = "Ödendi işlemi iptal edildi, beklemeye alındı.",
            CreateUser = username,
            CreateTime = now
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/return")]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> Return([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status == PayableCheckStatus.Paid)
        {
            return BadRequest(new { success = false, message = "Ödenmiş borç çeki iade edilemez" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableCheckStatus.Returned;
        entity.EditUser = username;
        entity.EditTime = now;

        // Çek bize iade edildi: cariye ödeme yapılmamış sayılır, ekstre satırı kalkar.
        await RemoveIssueLedgerAsync(entity.Id, cancellationToken);

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.Return,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = entity.BankAccountDefinitionId,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/dishonor")]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> Dishonor([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status == PayableCheckStatus.Paid)
        {
            return BadRequest(new { success = false, message = "Ödenmiş borç çeki karşılıksız yapılamaz" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableCheckStatus.Dishonored;
        entity.EditUser = username;
        entity.EditTime = now;

        // Karşılıksız: cariye ödeme gerçekleşmedi, ekstre satırı kalkar (borç geri gelir).
        await RemoveIssueLedgerAsync(entity.Id, cancellationToken);

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.Dishonor,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = entity.BankAccountDefinitionId,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPut("{id:int}")]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] CreatePayableCheckRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var entity = await _dbContext.PayableChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != PayableCheckStatus.Issued)
        {
            return BadRequest(new { success = false, message = "Sadece 'İlk Kayıt' durumundaki borç çekleri düzenlenebilir" });
        }

        var customerCode = request.CustomerCode?.Trim();
        if (string.IsNullOrWhiteSpace(customerCode)) return BadRequest(new { success = false, message = "Cari seçmelisiniz" });

        var supplier = await _dbContext.Suppliers.AsNoTracking().FirstOrDefaultAsync(x => x.SupplierCode == customerCode, cancellationToken);
        var customer = await _dbContext.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (supplier == null && customer == null)
        {
            return BadRequest(new { success = false, message = $"Cari bulunamadı: '{customerCode}'" });
        }

        if (request.BankAccountDefinitionId <= 0)
        {
            return BadRequest(new { success = false, message = "Banka hesabı seçmelisiniz" });
        }

        var bankExists = await _dbContext.BankAccountDefinitions.AsNoTracking().AnyAsync(x => x.Id == request.BankAccountDefinitionId, cancellationToken);
        if (!bankExists) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });

        var checkNo = string.IsNullOrWhiteSpace(request.CheckNo) ? null : request.CheckNo.Trim();
        if (!string.IsNullOrWhiteSpace(checkNo))
        {
            var exists = await _dbContext.PayableChecks.AsNoTracking()
                .AnyAsync(x => x.Id != id && x.CheckNo == checkNo, cancellationToken);
            if (exists)
            {
                return BadRequest(new { success = false, message = "Girilen çek seri no zaten mevcut" });
            }
        }

        var currencyRate = request.CurrencyRate;
        if (currencyRate <= 0)
        {
            var code = MapCurrencyTypeIdToCode(request.CurrencyTypeId);
            if (code == "TRY")
            {
                currencyRate = 1m;
            }
            else if (!string.IsNullOrWhiteSpace(code))
            {
                try
                {
                    currencyRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
                }
                catch
                {
                    currencyRate = 1m;
                }
            }
            else
            {
                currencyRate = 1m;
            }
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.CustomerCode = customer != null ? customer.CustomerCode : null;
        entity.SupplierId = supplier != null ? supplier.Id : null;
        entity.IssueDate = NormalizeUtc(request.IssueDate);
        entity.DueDate = NormalizeUtc(request.DueDate);
        entity.Amount = request.Amount;
        entity.CurrencyTypeId = request.CurrencyTypeId;
        entity.CurrencyRate = currencyRate;
        entity.CurrencyAmount = request.Amount * currencyRate;
        entity.BankName = string.IsNullOrWhiteSpace(request.BankName) ? null : request.BankName.Trim();
        entity.BranchName = string.IsNullOrWhiteSpace(request.BranchName) ? null : request.BranchName.Trim();
        entity.CheckNo = checkNo;
        entity.BankAccountDefinitionId = request.BankAccountDefinitionId;
        entity.EditTime = now;
        entity.EditUser = username;

        // Cari, tutar, kur ya da tarih değişmiş olabilir: ekstre satırı yeniden yazılır.
        await RemoveIssueLedgerAsync(entity.Id, cancellationToken);
        await AddIssueLedgerAsync(entity, username, now, cancellationToken);

        var op = await _dbContext.CheckOperations
            .FirstOrDefaultAsync(x => x.DocumentType == CheckDocumentType.PayableCheck && x.DocumentId == entity.Id && x.Type == CheckOperationType.Create, cancellationToken);
        if (op != null)
        {
            op.Date = entity.IssueDate;
            op.Amount = entity.Amount;
            op.CurrencyTypeId = entity.CurrencyTypeId;
            op.BankAccountDefinitionId = entity.BankAccountDefinitionId;
            op.EditTime = now;
            op.EditUser = username;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = entity.Id } });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, entity, "deleteRule/borcCeki", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        if (entity.Status != PayableCheckStatus.Issued)
        {
            return BadRequest(new { success = false, message = "Çek silinmesi için 'İlk Kayıt' (beklemede) durumunda olmalıdır. Lütfen önce beklemeye alınız." });
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var ops = await _dbContext.CheckOperations.Where(x => x.DocumentType == CheckDocumentType.PayableCheck && x.DocumentId == entity.Id)
            .ToListAsync(cancellationToken);
        if (ops.Count > 0) _dbContext.CheckOperations.RemoveRange(ops);

        // Verilişte yazılan ekstre satırı da gider.
        await RemoveIssueLedgerAsync(entity.Id, cancellationToken);

        // SİLME İZİ (kullanıcı kararı, 2026-08-17): kim sildi, hangi belge, ne tutar.
        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "check",
            PageKey = "debtCheck",
            RecordType = "BorcCeki",
            RecordId = entity.Id.ToString(),
            Description = $"Borç çeki silindi: {entity.CheckNo ?? entity.DocumentNo} · {entity.Amount:N2}",
            DetailsJson = System.Text.Json.JsonSerializer.Serialize(new
            {
                entity.Id,
                entity.CheckNo,
                entity.DocumentNo,
                entity.Amount,
                entity.CurrencyTypeId,
                entity.DueDate,
                entity.Status,
                entity.CustomerCode
            }),
            CreateUser = GetUsernameOrSystem(),
            CreateTime = DateTime.UtcNow
        });

        _dbContext.PayableChecks.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/cancel")]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> Cancel([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, entity, "deleteRule/borcCeki", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        if (entity.Status != PayableCheckStatus.Issued)
        {
            return BadRequest(new { success = false, message = "Bu işlem sadece beklemede durumundaki borç çekleri için yapılabilir" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableCheckStatus.Cancelled;
        entity.EditUser = username;
        entity.EditTime = now;

        // İptal: çek verilmemiş sayılır, ekstre satırı kalkar.
        await RemoveIssueLedgerAsync(entity.Id, cancellationToken);

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.Dishonor,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = entity.BankAccountDefinitionId,
            Description = "İptal Edildi",
            CreateUser = username,
            CreateTime = now
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/revert-to-pending")]
    [AuthorizePage("check", "debtCheck")]
    public async Task<IActionResult> RevertToPending([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != PayableCheckStatus.Paid && entity.Status != PayableCheckStatus.Cancelled)
        {
            return BadRequest(new { success = false, message = "Bu işlem sadece ödenmiş veya iptal edilmiş borç çekleri için yapılabilir" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        if (entity.Status == PayableCheckStatus.Paid)
        {
            // Delete BankAccountTransaction
            // x.Amount BANKA hareketinin TL karşılığı, entity.Amount çekin kendi parası:
            // dövizli çekte eşleşme hiç tutmuyor ve hareket bankada asılı kalıyordu.
            // Belge no + hesap + yön zaten tekil.
            var bankTx = await _dbContext.BankAccountTransactions
                .FirstOrDefaultAsync(x => x.BankAccountDefinitionId == entity.BankAccountDefinitionId &&
                                         x.Direction == BankAccountTransactionDirection.Out &&
                                         x.Description != null &&
                                         x.Description.Contains(entity.DocumentNo), cancellationToken);
            if (bankTx is not null)
            {
                _dbContext.BankAccountTransactions.Remove(bankTx);
            }

            // Ekstre satırı KALIR: ödeme geri alındı, çek hâlâ cariye verilmiş.
        }

        // İptalden (ya da satırı olmayan eski çekten) beklemeye: çek yeniden verilmiş sayılır.
        if (!await HasIssueLedgerAsync(entity.Id, cancellationToken))
        {
            await AddIssueLedgerAsync(entity, username, now, cancellationToken);
        }

        entity.Status = PayableCheckStatus.Issued;
        entity.EditUser = username;
        entity.EditTime = now;

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.Return,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = entity.BankAccountDefinitionId,
            Description = "Beklemeye Alındı",
            CreateUser = username,
            CreateTime = now
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
