using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Checks;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class PayableNotesController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient _money;

    public PayableNotesController(
        AppDbContext dbContext,
        B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient money)
    {
        _money = money;
        _dbContext = dbContext;
    }

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
      BORÇ SENEDİ CARİ EKSTREYE VERİLDİĞİ AN YAZILIR (2026-10-12, kullanıcı kararı; borç çekiyle aynı kural,
      bkz. PayableChecksController). Eskiden satır yalnız "Öde" işleminde, ödeme tarihiyle yazılıyordu.
        - Ver (tekli/toplu) → veriliş tarihiyle satır; Düzenle → satır yeniden yazılır.
        - Öde → yalnız banka çıkışı (satır zaten var; eski senette yoksa eklenir).
        - Ödemeyi geri al / beklemeye al (ödenmişten) → yalnız banka hareketi silinir, satır KALIR.
        - İptal / Sil / İade / Karşılıksız → satır kalkar; iptalden beklemeye → yeniden yazılır.
      Defter seçimi MÜŞTERİ ÖNCE. Satır kimliği: ReferenceId = senet Id + TransactionType "Borç Senedi".
    */
    private const string LedgerType = "Borç Senedi";

    private async Task AddIssueLedgerAsync(PayableNote entity, string username, DateTime now, CancellationToken ct)
    {
        // Ekstre kayıt zamanına göre sıralanır: satır, belgenin GİRİLDİĞİ ana oturur (eski kayıtta da).
        var sira = entity.CreateTime == default ? now : entity.CreateTime;
        var documentNo = !string.IsNullOrWhiteSpace(entity.NoteNo) ? entity.NoteNo : entity.DocumentNo;
        var currency = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId);
        var rate = 1m;
        if (currency != 1)
        {
            try
            {
                var code = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToIsoCode(entity.CurrencyTypeId);
                var fetched = await _money.GetLatestTryRateAsync(code, ct);
                if (fetched > 0m) rate = fetched;
            }
            catch { rate = 1m; }
        }
        var tl = Math.Round(entity.Amount * rate, 2, MidpointRounding.AwayFromZero);
        var description = $"Borç Senedi Verildi ({documentNo})";

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
                ReferenceType = CustomerLedgerEntryReferenceType.Note,
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

    // Müşteri satırında TransactionType eski kayıtlarda boş olabilir: Note + ReferenceId yeterli
    // (Note türünü yalnız borç senedi yazıyor). Tedarikçide TransactionType şart (Manual ortak).
    private async Task<bool> HasIssueLedgerAsync(int noteId, CancellationToken ct) =>
        await _dbContext.CustomerLedgerEntries.AnyAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Note && x.ReferenceId == noteId, ct)
        || await _dbContext.SupplierLedgerEntries.AnyAsync(x => x.ReferenceId == noteId && x.TransactionType == LedgerType, ct);

    private async Task RemoveIssueLedgerAsync(int noteId, CancellationToken ct)
    {
        var cust = await _dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Note && x.ReferenceId == noteId)
            .ToListAsync(ct);
        if (cust.Count > 0) _dbContext.CustomerLedgerEntries.RemoveRange(cust);

        var sup = await _dbContext.SupplierLedgerEntries
            .Where(x => x.ReferenceId == noteId && x.TransactionType == LedgerType)
            .ToListAsync(ct);
        if (sup.Count > 0) _dbContext.SupplierLedgerEntries.RemoveRange(sup);
    }

    private async Task<string> GenerateDocumentNo15Async(CancellationToken cancellationToken)
    {
        // 15-digit numeric: yyMMddHHmmssfff
        for (var i = 0; i < 20; i++)
        {
            var docNo = DateTime.UtcNow.ToString("yyMMddHHmmssfff");
            var exists = await _dbContext.PayableNotes.AsNoTracking().AnyAsync(x => x.DocumentNo == docNo, cancellationToken);
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

    private async Task<string> GenerateScNoAsync(CancellationToken cancellationToken)
    {
        // 15-digit numeric starting with 8
        for (var i = 0; i < 20; i++)
        {
            var code = "8" + DateTime.UtcNow.ToString("yyMMddHHmmssfff");
            code = code.Length > 15 ? code.Substring(0, 15) : code;
            var exists = await _dbContext.PayableNotes.AsNoTracking().AnyAsync(x => x.ScNo == code, cancellationToken);
            if (!exists) return code;
            await Task.Delay(1, cancellationToken);
        }

        // Yedek yol da sayısal: "8" + 14 hane (bkz. yukarıdaki not).
        return "8" + System.Random.Shared.NextInt64(10000000000000L, 99999999999999L).ToString();
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

    private static bool IsSchemaDriftException(Exception? ex)
    {
        while (ex is not null)
        {
            if (ex is Npgsql.PostgresException pgEx && pgEx.SqlState == "42703")
                return true;
            ex = ex.InnerException;
        }
        return false;
    }

    [HttpGet]
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> List([FromQuery] string? customerCode = null, [FromQuery] int take = 200, CancellationToken cancellationToken = default)
    {
        take = Math.Max(1, Math.Min(1000, take));
        var cleanCustomerCode = string.IsNullOrWhiteSpace(customerCode) ? null : customerCode.Trim();

        const int maxAttempts = 5;
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                var query = from pn in _dbContext.PayableNotes.AsNoTracking()
                            join c in _dbContext.Customers.AsNoTracking() on pn.CustomerCode equals c.CustomerCode into cJoin
                            from c in cJoin.DefaultIfEmpty()
                            join s in _dbContext.Suppliers.AsNoTracking() on pn.SupplierId equals s.Id into sJoin
                            from s in sJoin.DefaultIfEmpty()
                            join b in _dbContext.BankAccountDefinitions.AsNoTracking() on pn.BankAccountDefinitionId equals b.Id into bJoin
                            from b in bJoin.DefaultIfEmpty()
                            select new { pn, c, s, b };

                if (cleanCustomerCode != null)
                {
                    query = query.Where(x => x.pn.CustomerCode == cleanCustomerCode);
                }

                var rows = await query
                    .OrderByDescending(x => x.pn.DueDate).ThenByDescending(x => x.pn.Id)
                    .Take(take)
                    .Select(x => new PayableNoteListItemResponse
                    {
                        Id = x.pn.Id,
                        ScNo = x.pn.ScNo,
                        DocumentNo = x.pn.DocumentNo,
                        CustomerCode = x.pn.CustomerCode ?? (x.s != null ? x.s.SupplierCode : string.Empty),
                        CustomerName = x.c != null ? (x.c.Name ?? string.Empty) : (x.s != null ? (x.s.FullName ?? string.Empty) : string.Empty),
                        IssueDate = x.pn.IssueDate,
                        DueDate = x.pn.DueDate,
                        Amount = x.pn.Amount,
                        CurrencyTypeId = x.pn.CurrencyTypeId,
                        NoteNo = x.pn.NoteNo,
                        Status = x.pn.Status,
                        BankAccountDefinitionId = x.pn.BankAccountDefinitionId,
                        BankAccountName = x.b != null ? x.b.AccountName : null,
                        CreateUser = x.pn.CreateUser
                    })
                    .ToListAsync(cancellationToken);

                return Ok(new { success = true, data = rows });
            }
            catch (Exception ex) when (IsDeadlockException(ex) && attempt < maxAttempts)
            {
                await Task.Delay(100 * attempt, cancellationToken);
            }
            catch (Exception ex) when (IsSchemaDriftException(ex) && attempt < maxAttempts)
            {
                // Tenant DB schema drift: add missing ScNo column and retry once
                await _dbContext.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"PayableNotes\" ADD COLUMN IF NOT EXISTS \"ScNo\" character varying(20) NOT NULL DEFAULT '';\n" +
                    "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_PayableNotes_ScNo\" ON \"PayableNotes\" (\"ScNo\");",
                    cancellationToken);
            }
        }

        return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Listeleme işlemi tekrar deneyin" });
    }

    [HttpPost]
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> Create([FromBody] CreatePayableNoteRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        try
        {
            await _dbContext.Database.ExecuteSqlRawAsync(
                "ALTER TABLE \"PayableNotes\" ADD COLUMN IF NOT EXISTS \"ScNo\" character varying(20) NOT NULL DEFAULT '';\n" +
                "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_PayableNotes_ScNo\" ON \"PayableNotes\" (\"ScNo\");",
                cancellationToken);
        }
        catch
        {
            // ignore, will fail later with a clearer error if truly broken
        }

        var requestedDocNo = string.IsNullOrWhiteSpace(request.DocumentNo) ? null : request.DocumentNo.Trim();
        var documentNo = requestedDocNo ?? await GenerateDocumentNo15Async(cancellationToken);

        var exists = await _dbContext.PayableNotes.AsNoTracking().AnyAsync(x => x.DocumentNo == documentNo, cancellationToken);
        if (exists) return BadRequest(new { success = false, message = "Belge No zaten kullanılıyor" });

        var customerCode = request.CustomerCode?.Trim();
        if (string.IsNullOrWhiteSpace(customerCode)) return BadRequest(new { success = false, message = "Cari seçmelisiniz" });

        var supplier = await _dbContext.Suppliers.AsNoTracking().FirstOrDefaultAsync(x => x.SupplierCode == customerCode, cancellationToken);
        var customer = await _dbContext.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (supplier == null && customer == null)
        {
            return BadRequest(new { success = false, message = $"Cari bulunamadı: '{customerCode}'" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        var scNo = await GenerateScNoAsync(cancellationToken);

        var entity = new PayableNote
        {
            ScNo = scNo,
            DocumentNo = documentNo,
            CustomerCode = customer != null ? customer.CustomerCode : null,
            SupplierId = supplier != null ? supplier.Id : null,
            IssueDate = NormalizeUtc(request.IssueDate),
            DueDate = NormalizeUtc(request.DueDate),
            Amount = request.Amount,
            CurrencyTypeId = 0,
            NoteNo = string.IsNullOrWhiteSpace(request.NoteNo) ? null : request.NoteNo.Trim(),
            Status = PayableNoteStatus.Issued,
            BankAccountDefinitionId = request.BankAccountDefinitionId,
            CreateUser = username,
            CreateTime = now
        };

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        _dbContext.PayableNotes.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableNote,
            DocumentId = entity.Id,
            Date = entity.IssueDate,
            Type = CheckOperationType.Create,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
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
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> BulkCreate([FromBody] List<CreatePayableNoteRequest> requests, CancellationToken cancellationToken)
    {
        if (requests is null || requests.Count == 0)
        {
            return BadRequest(new { success = false, message = "Kayıt bulunamadı" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        var docNoSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var scNoSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var createdIds = new List<int>();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        foreach (var request in requests)
        {
            if (!TryValidateModel(request)) return ValidationProblem(ModelState);

            var requestedDocNo = string.IsNullOrWhiteSpace(request.DocumentNo) ? null : request.DocumentNo.Trim();
            var documentNo = requestedDocNo ?? await GenerateDocumentNo15Async(cancellationToken);
            if (!docNoSet.Add(documentNo))
            {
                return BadRequest(new { success = false, message = $"Belge No tekrarlı: {documentNo}" });
            }

            var exists = await _dbContext.PayableNotes.AsNoTracking().AnyAsync(x => x.DocumentNo == documentNo, cancellationToken);
            if (exists) return BadRequest(new { success = false, message = "Belge No zaten kullanılıyor" });

            var customerCode = request.CustomerCode?.Trim();
            if (string.IsNullOrWhiteSpace(customerCode)) return BadRequest(new { success = false, message = "Cari seçmelisiniz" });

            var supplier = await _dbContext.Suppliers.AsNoTracking().FirstOrDefaultAsync(x => x.SupplierCode == customerCode, cancellationToken);
            var customer = await _dbContext.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

            if (supplier == null && customer == null)
            {
                return BadRequest(new { success = false, message = $"Cari bulunamadı: '{customerCode}'" });
            }

            var scNo = await GenerateScNoAsync(cancellationToken);
            if (!scNoSet.Add(scNo))
            {
                return BadRequest(new { success = false, message = "SC_NO tekrarlı üretildi" });
            }

            var entity = new PayableNote
            {
                ScNo = scNo,
                DocumentNo = documentNo,
                CustomerCode = customer != null ? customer.CustomerCode : null,
                SupplierId = supplier != null ? supplier.Id : null,
                IssueDate = NormalizeUtc(request.IssueDate),
                DueDate = NormalizeUtc(request.DueDate),
                Amount = request.Amount,
                CurrencyTypeId = 0,
                NoteNo = string.IsNullOrWhiteSpace(request.NoteNo) ? null : request.NoteNo.Trim(),
                Status = PayableNoteStatus.Issued,
                BankAccountDefinitionId = request.BankAccountDefinitionId,
                CreateUser = username,
                CreateTime = now
            };

            _dbContext.PayableNotes.Add(entity);
            await _dbContext.SaveChangesAsync(cancellationToken);

            _dbContext.CheckOperations.Add(new CheckOperation
            {
                DocumentType = CheckDocumentType.PayableNote,
                DocumentId = entity.Id,
                Date = entity.IssueDate,
                Type = CheckOperationType.Create,
                Amount = entity.Amount,
                CurrencyTypeId = entity.CurrencyTypeId,
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
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> EndorseToBank([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!request.BankAccountDefinitionId.HasValue || request.BankAccountDefinitionId.Value <= 0)
        {
            return BadRequest(new { success = false, message = "Banka hesabı seçmelisiniz" });
        }

        var entity = await _dbContext.PayableNotes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != PayableNoteStatus.Issued)
        {
            return BadRequest(new { success = false, message = "Bu işlem sadece ilk kayıttaki borç senetleri için yapılabilir" });
        }

        var bankExists = await _dbContext.BankAccountDefinitions.AsNoTracking().AnyAsync(x => x.Id == request.BankAccountDefinitionId.Value, cancellationToken);
        if (!bankExists) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableNoteStatus.EndorsedToBank;
        entity.BankAccountDefinitionId = request.BankAccountDefinitionId.Value;
        entity.EditUser = username;
        entity.EditTime = now;

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableNote,
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
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> Pay([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableNotes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var bankId = request.BankAccountDefinitionId ?? entity.BankAccountDefinitionId;
        if (!bankId.HasValue || bankId.Value <= 0)
        {
            return BadRequest(new { success = false, message = "Banka hesabı seçmelisiniz" });
        }

        if (entity.Status == PayableNoteStatus.Paid)
        {
            return BadRequest(new { success = false, message = "Bu borç senedi zaten ödendi" });
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

        // Senet tutarı senedin KENDİ para birimindedir; TL sütunu kurla üretilir.
        // Öncesinde kur sabit 1 yazılıyor, dövizli senet deftere TL olarak düşüyordu.
        var noteRate = 1m;
        if (B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(entity.CurrencyTypeId) != 1)
        {
            try
            {
                var noteCode = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToIsoCode(entity.CurrencyTypeId);
                var fetched = await _money.GetLatestTryRateAsync(noteCode, cancellationToken);
                if (fetched > 0m) noteRate = fetched;
            }
            catch { noteRate = 1m; }
        }
        var noteTlAmount = Math.Round(entity.Amount * noteRate, 2, MidpointRounding.AwayFromZero);

        // Banka hareketi HESABIN para birimindedir, senedin değil. Senedin dövizi yazılınca
        // hareket hesabın ekstre süzgecine takılmıyor, bakiyeye de yanlış birimden vuruyordu.
        (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) bankMv;
        try
        {
            bankMv = await B2B.Erp.Api.Core.Helpers.AccountMovementCurrency.ResolveAsync(
                _money, bankAcc.CurrencyTypeId, noteTlAmount, cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(503, new { success = false, message = ex.Message });
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableNoteStatus.Paid;
        entity.BankAccountDefinitionId = bankAcc.Id;
        entity.EditUser = username;
        entity.EditTime = now;

        _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
        {
            BankAccountDefinitionId = bankAcc.Id,
            Date = date,
            Direction = BankAccountTransactionDirection.Out,
            Amount = noteTlAmount,
            CurrencyTypeId = bankMv.CurrencyTypeId,
            CurrencyRate = bankMv.Rate,
            CurrencyAmount = bankMv.CurrencyAmount,
            CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
            CounterpartyCode = customer?.CustomerCode ?? supplier?.SupplierCode ?? string.Empty,
            CounterpartyName = customer?.Name ?? supplier?.FullName ?? string.Empty,
            Description = $"Borç Senedi Ödeme ({entity.DocumentNo})",
            IsPosFee = false,
            CreateUser = username,
            CreateTime = now
        });

        // Ekstre satırı senet VERİLİRKEN yazıldı; ödeme yalnız bankadan çıkıştır. Bu değişiklikten
        // önce verilmiş (satırı olmayan) senette satır burada veriliş tarihiyle eklenir.
        if (!await HasIssueLedgerAsync(entity.Id, cancellationToken))
        {
            await AddIssueLedgerAsync(entity, username, now, cancellationToken);
        }

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableNote,
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
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> Unpay([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableNotes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != PayableNoteStatus.Paid)
        {
            return BadRequest(new { success = false, message = "Bu senet ödendi durumunda değil" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableNoteStatus.Issued;
        entity.EditUser = username;
        entity.EditTime = now;

        var bankTx = await _dbContext.BankAccountTransactions
            .Where(x => x.BankAccountDefinitionId == entity.BankAccountDefinitionId && x.Description == $"Borç Senedi Ödeme ({entity.DocumentNo})")
            .ToListAsync(cancellationToken);
        if (bankTx.Count > 0)
        {
            _dbContext.BankAccountTransactions.RemoveRange(bankTx);
        }

        // Ekstre satırı SİLİNMEZ: ödeme geri alındı ama senet hâlâ cariye verilmiş durumda.
        if (!await HasIssueLedgerAsync(entity.Id, cancellationToken))
        {
            await AddIssueLedgerAsync(entity, username, now, cancellationToken);
        }

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableNote,
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
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> Return([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableNotes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status == PayableNoteStatus.Paid)
        {
            return BadRequest(new { success = false, message = "Ödenmiş borç senedi iade edilemez" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableNoteStatus.Returned;
        entity.EditUser = username;
        entity.EditTime = now;

        // Senet bize iade edildi: cariye ödeme yapılmamış sayılır, ekstre satırı kalkar.
        await RemoveIssueLedgerAsync(entity.Id, cancellationToken);

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableNote,
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
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> Dishonor([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableNotes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status == PayableNoteStatus.Paid)
        {
            return BadRequest(new { success = false, message = "Ödenmiş borç senedi karşılıksız yapılamaz" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableNoteStatus.Dishonored;
        entity.EditUser = username;
        entity.EditTime = now;

        // Karşılıksız: cariye ödeme gerçekleşmedi, ekstre satırı kalkar (borç geri gelir).
        await RemoveIssueLedgerAsync(entity.Id, cancellationToken);

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableNote,
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
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] CreatePayableNoteRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var entity = await _dbContext.PayableNotes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != PayableNoteStatus.Issued)
        {
            return BadRequest(new { success = false, message = "Sadece 'İlk Kayıt' durumundaki borç senetleri düzenlenebilir" });
        }

        var customerCode = request.CustomerCode?.Trim();
        if (string.IsNullOrWhiteSpace(customerCode)) return BadRequest(new { success = false, message = "Cari seçmelisiniz" });

        var supplier = await _dbContext.Suppliers.AsNoTracking().FirstOrDefaultAsync(x => x.SupplierCode == customerCode, cancellationToken);
        var customer = await _dbContext.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (supplier == null && customer == null)
        {
            return BadRequest(new { success = false, message = $"Cari bulunamadı: '{customerCode}'" });
        }

        if (request.BankAccountDefinitionId.HasValue && request.BankAccountDefinitionId.Value > 0)
        {
            var bankExists = await _dbContext.BankAccountDefinitions.AsNoTracking().AnyAsync(x => x.Id == request.BankAccountDefinitionId.Value, cancellationToken);
            if (!bankExists) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });
        }

        var noteNo = string.IsNullOrWhiteSpace(request.NoteNo) ? null : request.NoteNo.Trim();
        if (!string.IsNullOrWhiteSpace(noteNo))
        {
            var exists = await _dbContext.PayableNotes.AsNoTracking()
                .AnyAsync(x => x.Id != id && x.NoteNo == noteNo, cancellationToken);
            if (exists)
            {
                return BadRequest(new { success = false, message = "Girilen senet no zaten mevcut" });
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
        entity.NoteNo = noteNo;
        entity.BankAccountDefinitionId = request.BankAccountDefinitionId;
        entity.EditTime = now;
        entity.EditUser = username;

        // Cari, tutar ya da tarih değişmiş olabilir: ekstre satırı yeniden yazılır.
        await RemoveIssueLedgerAsync(entity.Id, cancellationToken);
        await AddIssueLedgerAsync(entity, username, now, cancellationToken);

        var op = await _dbContext.CheckOperations
            .FirstOrDefaultAsync(x => x.DocumentType == CheckDocumentType.PayableNote && x.DocumentId == entity.Id && x.Type == CheckOperationType.Create, cancellationToken);
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
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableNotes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, entity, "deleteRule/borcSenedi", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        if (entity.Status != PayableNoteStatus.Issued)
        {
            return BadRequest(new { success = false, message = "Senet silinmesi için 'İlk Kayıt' (beklemede) durumunda olmalıdır. Lütfen önce beklemeye alınız." });
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var ops = await _dbContext.CheckOperations.Where(x => x.DocumentType == CheckDocumentType.PayableNote && x.DocumentId == entity.Id)
            .ToListAsync(cancellationToken);
        if (ops.Count > 0) _dbContext.CheckOperations.RemoveRange(ops);

        // Verilişte yazılan ekstre satırı da gider.
        await RemoveIssueLedgerAsync(entity.Id, cancellationToken);

        // SİLME İZİ (kullanıcı kararı, 2026-08-17).
        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "check",
            PageKey = "debtNote",
            RecordType = "BorcSenedi",
            RecordId = entity.Id.ToString(),
            Description = $"Borç senedi silindi: {entity.NoteNo ?? entity.DocumentNo} · {entity.Amount:N2}",
            DetailsJson = System.Text.Json.JsonSerializer.Serialize(new
            {
                entity.Id,
                entity.NoteNo,
                entity.DocumentNo,
                entity.Amount,
                entity.CurrencyTypeId,
                entity.DueDate,
                entity.Status
            }),
            CreateUser = GetUsernameOrSystem(),
            CreateTime = DateTime.UtcNow
        });

        _dbContext.PayableNotes.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/cancel")]
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> Cancel([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableNotes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, entity, "deleteRule/borcSenedi", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        if (entity.Status != PayableNoteStatus.Issued)
        {
            return BadRequest(new { success = false, message = "Bu işlem sadece beklemede durumundaki borç senetleri için yapılabilir" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = PayableNoteStatus.Cancelled;
        entity.EditUser = username;
        entity.EditTime = now;

        // İptal: senet verilmemiş sayılır, ekstre satırı kalkar.
        await RemoveIssueLedgerAsync(entity.Id, cancellationToken);

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableNote,
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
    [AuthorizePage("check", "debtNote")]
    public async Task<IActionResult> RevertToPending([FromRoute] int id, [FromBody] PayableActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.PayableNotes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != PayableNoteStatus.Paid && entity.Status != PayableNoteStatus.Cancelled)
        {
            return BadRequest(new { success = false, message = "Bu işlem sadece ödenmiş veya iptal edilmiş borç senetleri için yapılabilir" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        if (entity.Status == PayableNoteStatus.Paid)
        {
            // Delete BankAccountTransaction
            // x.Amount BANKA hareketinin TL karşılığı, entity.Amount senedin kendi parası:
            // dövizli senette eşleşme tutmuyor, hareket bankada asılı kalıyordu.
            var bankTx = await _dbContext.BankAccountTransactions
                .FirstOrDefaultAsync(x => x.BankAccountDefinitionId == entity.BankAccountDefinitionId &&
                                         x.Direction == BankAccountTransactionDirection.Out &&
                                         x.Description != null &&
                                         x.Description.Contains(entity.DocumentNo), cancellationToken);
            if (bankTx is not null)
            {
                _dbContext.BankAccountTransactions.Remove(bankTx);
            }

            // Ekstre satırı KALIR: ödeme geri alındı, senet hâlâ cariye verilmiş.
        }

        // İptalden (ya da satırı olmayan eski senetten) beklemeye: senet yeniden verilmiş sayılır.
        if (!await HasIssueLedgerAsync(entity.Id, cancellationToken))
        {
            await AddIssueLedgerAsync(entity, username, now, cancellationToken);
        }

        entity.Status = PayableNoteStatus.Issued;
        entity.EditUser = username;
        entity.EditTime = now;

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.PayableNote,
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
