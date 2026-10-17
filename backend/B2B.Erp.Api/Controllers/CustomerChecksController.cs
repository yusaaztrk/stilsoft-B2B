using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
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
public sealed class CustomerChecksController : ControllerBase
{
    /// <summary>Bir çek verildi bordrosuna girebilecek en fazla çek adedi (basılı bordronun kapasitesi).</summary>
    internal const int MaxChecksPerVBordro = 25;

    private readonly AppDbContext _dbContext;
    private readonly MasterDbContext _masterDbContext;
    private readonly B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient _money;
    private readonly B2B.Erp.Api.Core.Helpers.CompanyClock _clock;

    public CustomerChecksController(
        AppDbContext dbContext,
        MasterDbContext masterDbContext,
        B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient money,
        B2B.Erp.Api.Core.Helpers.CompanyClock clock)
    {
        _dbContext = dbContext;
        _masterDbContext = masterDbContext;
        _money = money;
        _clock = clock;
    }

    /// <summary>
    /// BASIMDA GÜN: UTC damgası firmanın gününe çevrilip yazılır (2026-08-23).
    ///
    /// <para>Çek tarihleri veritabanına YEREL gece yarısının UTC karşılığı olarak giriyor
    /// (KKTC +03: <c>09.09.2026</c> → <c>2026-09-08T21:00:00Z</c>). Ekran bu damgayı yerele
    /// çevirip bastığı için listede 09.09.2026 görünüyordu; bordro ise ham UTC değerini
    /// biçimlendiriyordu ve <b>08.09.2026</b> yazıyordu. Aynı çek, iki ekranda iki tarih.</para>
    ///
    /// <para>Çevrim iki yazım biçimini de doğru gösterir: UTC gece yarısı olarak yazılmış
    /// (<c>2026-09-09T00:00:00Z</c>) eski kayıtlar da +03'te aynı güne düşer.</para>
    /// </summary>
    private string PrintDate(DateTime utc) => _clock.ToCompanyTime(utc).ToString("dd.MM.yyyy");

    /// <summary>
    /// Çekin TL kuru (1 döviz = X TL). TL çekte 1 döner.
    ///
    /// <para>
    /// Çek tutarı (<c>CustomerChecks.Amount</c>) ÇEKİN KENDİ para birimindedir. Öncesinde
    /// ekstre ve kasa/banka satırlarına kur sabit <c>1</c> yazılıyordu: 1.000 dolarlık çek
    /// deftere <b>1.000 TL</b> olarak düşüyor, TL sütunu 42.000 yerine 1.000 kalıyordu.
    /// Veride bugün dövizli çek olmadığı için hata uykudaydı.
    /// </para>
    /// </summary>
    private async Task<decimal> ResolveCheckRateAsync(int currencyTypeId, CancellationToken cancellationToken)
    {
        var norm = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(currencyTypeId);
        if (norm == 1) return 1m;

        try
        {
            var code = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToIsoCode(norm);
            var rate = await _money.GetLatestTryRateAsync(code, cancellationToken);
            return rate > 0m ? rate : 1m;
        }
        catch
        {
            return 1m;
        }
    }

    /// <summary>
    /// Çekin GİRİŞ kuru (ekstredeki ilk satırın kuru).
    ///
    /// <para>
    /// İade / karşılıksız / portföye geri alma işlemleri çekin giriş kaydını TERSLER.
    /// Ters kayıt bugünün kuruyla atılırsa döviz bakiyesi kapanır ama TL çapasında kur farkı
    /// kadar hayali bakiye kalır: 1.000 $ çek 35'ten girip 40'tan terslenince caride
    /// 5.000 ₺ borç doğuyordu. Giriş satırı bulunamazsa güncel kura düşülür (eski davranış).
    /// </para>
    /// </summary>
    private async Task<decimal> ResolveOriginalCheckRateAsync(CustomerCheck entity, CancellationToken cancellationToken)
    {
        if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(entity.CurrencyTypeId)) return 1m;

        var fromCustomerLedger = await _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check
                && x.ReferenceId == entity.Id
                && x.CurrencyRate > 0m)
            .OrderBy(x => x.Id)
            .Select(x => (decimal?)x.CurrencyRate)
            .FirstOrDefaultAsync(cancellationToken);
        if (fromCustomerLedger is > 0m) return fromCustomerLedger.Value;

        var fromSupplierLedger = await _dbContext.SupplierLedgerEntries
            .AsNoTracking()
            .Where(x => x.SupplierCode == entity.CustomerCode
                && x.ReferenceId == entity.Id
                && x.TransactionType == "Müşteri Çeki"
                && x.CurrencyRate > 0m)
            .OrderBy(x => x.Id)
            .Select(x => (decimal?)x.CurrencyRate)
            .FirstOrDefaultAsync(cancellationToken);
        if (fromSupplierLedger is > 0m) return fromSupplierLedger.Value;

        return await ResolveCheckRateAsync(entity.CurrencyTypeId, cancellationToken);
    }

    /// <summary>
    /// Çek girişi ekstre satırını DOĞRU deftere yazar.
    ///
    /// <para>
    /// Çek girişinde cari bir TEDARİKÇİ de olabiliyor (uç nokta bunu kabul ediyor), ama satır
    /// her durumda <c>CustomerLedgerEntries</c>'e yazılıyordu: tedarikçi ekstresinde çek hiç
    /// görünmüyor, müşteri defterinde ise karşılığı olmayan bir cari koduyla sahte satır
    /// oluşuyordu. Yön iki defterde de aynı anlamda: para bize geliyor (Credit).
    /// </para>
    /// </summary>
    private void AddCheckReceiptLedgerEntry(
        bool isSupplierCari,
        CustomerCheck entity,
        decimal checkRate,
        decimal checkTlAmount,
        string description,
        string username,
        DateTime now)
    {
        var documentNo = !string.IsNullOrWhiteSpace(entity.CheckNo) ? entity.CheckNo : entity.DocumentNo;
        var normalizedCurrency = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId);

        if (isSupplierCari)
        {
            _dbContext.SupplierLedgerEntries.Add(new SupplierLedgerEntry
            {
                SupplierCode = entity.CustomerCode,
                Date = entity.IssueDate,
                DueDate = entity.DueDate,
                Direction = SupplierLedgerEntryDirection.Credit,
                Amount = checkTlAmount,
                CurrencyTypeId = normalizedCurrency,
                CurrencyRate = checkRate,
                CurrencyAmount = entity.Amount,
                DocumentNo = documentNo,
                Description = description,
                TransactionType = "Müşteri Çeki",
                ReferenceType = SupplierLedgerEntryReferenceType.Manual,
                ReferenceId = entity.Id,
                CreateUser = username,
                CreateTime = now
            });
            return;
        }

        _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
        {
            CustomerCode = entity.CustomerCode,
            Date = entity.IssueDate,
            DueDate = entity.DueDate,
            Direction = CustomerLedgerEntryDirection.Credit,
            Amount = checkTlAmount,
            // Ham değil normalize: eski kayıtlarda 0 (=TL) gelebiliyor ve aynı satırın
            // `PaymentCurrencyTypeId`'si 1 yazılıyordu. Ekstredeki döviz süzgeci para birimine
            // göre kovaladığı için tek satırın iki alanının ayrışması karışıklık üretir.
            CurrencyTypeId = normalizedCurrency,
            CurrencyRate = checkRate,
            CurrencyAmount = entity.Amount,
            PaymentCurrencyTypeId = normalizedCurrency,
            PaymentCurrencyRate = checkRate,
            PaymentCurrencyAmount = entity.Amount,
            DocumentNo = documentNo,
            Description = description,
            TransactionType = "Müşteri Çeki",
            DeliveryCustomerCode = null,
            ReferenceType = CustomerLedgerEntryReferenceType.Check,
            ReferenceId = entity.Id,
            CreateUser = username,
            CreateTime = now
        });
    }

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt.Kind == DateTimeKind.Utc) return dt;
        if (dt.Kind == DateTimeKind.Unspecified) return DateTime.SpecifyKind(dt, DateTimeKind.Utc);
        return dt.ToUniversalTime();
    }

    private async Task<string> GenerateDocumentNo15Async(CancellationToken cancellationToken)
    {
        // 15-digit numeric: yyMMddHHmmssfff
        for (var i = 0; i < 20; i++)
        {
            var docNo = DateTime.UtcNow.ToString("yyMMddHHmmssfff");
            var exists = await _dbContext.CustomerChecks.AsNoTracking().AnyAsync(x => x.DocumentNo == docNo, cancellationToken);
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

    private async Task<string> GenerateNextVBordroNo15Async(CancellationToken cancellationToken)
    {
        var allVBordros = await _dbContext.CustomerChecks
            .AsNoTracking()
            .Select(x => x.VBordroNo)
            .ToListAsync(cancellationToken);

        long maxVB = 900000000000000;
        foreach (var s in allVBordros)
        {
            if (string.IsNullOrWhiteSpace(s)) continue;
            if (long.TryParse(s, out var v) && v > maxVB) maxVB = v;
        }

        return (maxVB + 1).ToString().PadLeft(15, '0');
    }

    private string GetUsernameOrSystem()
    {
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        return string.IsNullOrWhiteSpace(username) ? "System" : username;
    }

    [HttpGet]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> List([FromQuery] string? customerCode = null, [FromQuery] int take = 200, CancellationToken cancellationToken = default)
    {
        take = Math.Max(1, Math.Min(1000, take));

        var query = _dbContext.CustomerChecks.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(customerCode))
        {
            var cCode = customerCode.Trim();
            query = query.Where(x => x.CustomerCode == cCode);
        }

        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                var rows = await (
                        from chk in query
                        join cust in _dbContext.Customers.AsNoTracking() on chk.CustomerCode equals cust.CustomerCode into custJoin
                        from cust in custJoin.DefaultIfEmpty()
                        join sup in _dbContext.Suppliers.AsNoTracking() on chk.CustomerCode equals sup.SupplierCode into supJoin
                        from sup in supJoin.DefaultIfEmpty()
                        join bank in _dbContext.BankAccountDefinitions.AsNoTracking() on chk.CurrentBankAccountDefinitionId equals (int?)bank.Id into bankJoin
                        from bank in bankJoin.DefaultIfEmpty()
                        join curCust in _dbContext.Customers.AsNoTracking() on chk.CurrentCustomerCode equals curCust.CustomerCode into curCustJoin
                        from curCust in curCustJoin.DefaultIfEmpty()
                        join curSup in _dbContext.Suppliers.AsNoTracking() on chk.CurrentCustomerCode equals curSup.SupplierCode into curSupJoin
                        from curSup in curSupJoin.DefaultIfEmpty()
                        orderby chk.DueDate descending, chk.Id descending
                        select new CustomerCheckListItemResponse
                        {
                            Id = chk.Id,
                            ABordroNo = chk.ABordroNo,
                            VBordroNo = chk.VBordroNo,
                            DocumentNo = chk.DocumentNo,
                            CustomerCode = chk.CustomerCode,
                            CustomerName = cust != null ? cust.Name : (sup != null ? sup.FullName : string.Empty),
                            IssueDate = chk.IssueDate,
                            DueDate = chk.DueDate,
                            Amount = chk.Amount,
                            CurrencyTypeId = chk.CurrencyTypeId,
                            EndorsementType = chk.EndorsementType,
                            BankName = chk.BankName,
                            BranchName = chk.BranchName,
                            DistrictName = chk.DistrictName,
                            CheckNo = chk.CheckNo,
                            OriginalDebtorName = chk.OriginalDebtorName,
                            OriginalIdentityNo = chk.OriginalIdentityNo,
                            OriginalTaxNo = chk.OriginalTaxNo,
                            PaymentStatus = chk.PaymentStatus,
                            Status = chk.Status,
                            CurrentBankAccountDefinitionId = chk.CurrentBankAccountDefinitionId,
                            CurrentBankAccountName = bank != null ? bank.AccountName : null,
                            CurrentCustomerCode = chk.CurrentCustomerCode,
                            CurrentCustomerName = curCust != null ? curCust.Name : (curSup != null ? curSup.FullName : null),
                            CreateUser = chk.CreateUser
                        })
                    .Take(take)
                    .ToListAsync(cancellationToken);

                return Ok(new { success = true, data = rows });
            }
            catch (Npgsql.PostgresException ex) when (
                ex.SqlState == "42703"
                && (ex.MessageText?.Contains("CustomerChecks", StringComparison.OrdinalIgnoreCase) ?? false)
                && (
                    (ex.MessageText?.Contains("ABordroNo", StringComparison.OrdinalIgnoreCase) ?? false)
                    || (ex.MessageText?.Contains("VBordroNo", StringComparison.OrdinalIgnoreCase) ?? false))
                && attempt < 3)
            {
                await _dbContext.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"CustomerChecks\" ADD COLUMN IF NOT EXISTS \"ABordroNo\" character varying(15) NOT NULL DEFAULT '';" +
                    " ALTER TABLE \"CustomerChecks\" ADD COLUMN IF NOT EXISTS \"VBordroNo\" character varying(15) NULL;",
                    cancellationToken);

                await Task.Delay(30 * attempt, cancellationToken);
            }
            catch (Npgsql.PostgresException ex) when (ex.SqlState == "40P01" && attempt < 3)
            {
                await Task.Delay(50 * attempt, cancellationToken);
            }
            catch (InvalidOperationException ex) when (attempt < 3 && ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "40P01")
            {
                await Task.Delay(50 * attempt, cancellationToken);
            }
            catch (InvalidOperationException ex) when (
                attempt < 3
                && ex.InnerException is Npgsql.PostgresException pg
                && pg.SqlState == "42703"
                && (pg.MessageText?.Contains("CustomerChecks", StringComparison.OrdinalIgnoreCase) ?? false)
                && (
                    (pg.MessageText?.Contains("ABordroNo", StringComparison.OrdinalIgnoreCase) ?? false)
                    || (pg.MessageText?.Contains("VBordroNo", StringComparison.OrdinalIgnoreCase) ?? false)))
            {
                await _dbContext.Database.ExecuteSqlRawAsync(
                    "ALTER TABLE \"CustomerChecks\" ADD COLUMN IF NOT EXISTS \"ABordroNo\" character varying(15) NOT NULL DEFAULT '';" +
                    " ALTER TABLE \"CustomerChecks\" ADD COLUMN IF NOT EXISTS \"VBordroNo\" character varying(15) NULL;",
                    cancellationToken);

                await Task.Delay(30 * attempt, cancellationToken);
            }
        }

        // If all retries fail, let it throw to middleware
        var finalRows = await query.OrderByDescending(x => x.DueDate).ThenByDescending(x => x.Id)
            .Take(take)
            .Select(x => new CustomerCheckListItemResponse
            {
                Id = x.Id,
                ABordroNo = x.ABordroNo,
                VBordroNo = x.VBordroNo,
                DocumentNo = x.DocumentNo,
                CustomerCode = x.CustomerCode,
                CustomerName = string.Empty,
                IssueDate = x.IssueDate,
                DueDate = x.DueDate,
                Amount = x.Amount,
                CurrencyTypeId = x.CurrencyTypeId,
                EndorsementType = x.EndorsementType,
                BankName = x.BankName,
                BranchName = x.BranchName,
                DistrictName = x.DistrictName,
                CheckNo = x.CheckNo,
                OriginalDebtorName = x.OriginalDebtorName,
                OriginalIdentityNo = x.OriginalIdentityNo,
                OriginalTaxNo = x.OriginalTaxNo,
                PaymentStatus = x.PaymentStatus,
                Status = x.Status,
                CurrentBankAccountDefinitionId = x.CurrentBankAccountDefinitionId,
                CurrentBankAccountName = null,
                CurrentCustomerCode = x.CurrentCustomerCode,
                CurrentCustomerName = null,
                CreateUser = x.CreateUser
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = finalRows });
    }

    [HttpPost]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> Create([FromBody] CreateCustomerCheckRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        if (request.EndorsementType == CustomerCheckEndorsementType.Endorsed)
        {
            if (string.IsNullOrWhiteSpace(request.OriginalDebtorName))
            {
                return BadRequest(new { success = false, message = "Ciro seçildiğinde Asıl Borçlu zorunludur" });
            }
        }

        var customerName = string.Empty;
        var isSupplierCari = false;
        var customer = await _dbContext.Customers
            .AsNoTracking()
            .Select(x => new { x.CustomerCode, x.Name })
            .FirstOrDefaultAsync(x => x.CustomerCode == request.CustomerCode, cancellationToken);
        if (customer != null)
        {
            customerName = customer.Name;
        }
        else
        {
            var supplier = await _dbContext.Suppliers
                .AsNoTracking()
                .Select(x => new { x.SupplierCode, x.FullName })
                .FirstOrDefaultAsync(x => x.SupplierCode == request.CustomerCode, cancellationToken);
            if (supplier != null)
            {
                customerName = supplier.FullName;
                isSupplierCari = true;
            }
            else
            {
                return BadRequest(new { success = false, message = "Cari bulunamadı" });
            }
        }

        var requestedDocNo = string.IsNullOrWhiteSpace(request.DocumentNo) ? null : request.DocumentNo.Trim();
        var documentNo = requestedDocNo ?? await GenerateDocumentNo15Async(cancellationToken);

        var exists = await _dbContext.CustomerChecks.AsNoTracking().AnyAsync(x => x.DocumentNo == documentNo, cancellationToken);
        if (exists) return BadRequest(new { success = false, message = "Belge No zaten kullanılıyor" });

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var currentMax = await _dbContext.CustomerChecks
            .AsNoTracking()
            .Select(x => x.ABordroNo)
            .ToListAsync(cancellationToken);

        long maxVal = 900000000000000;
        foreach (var s in currentMax)
        {
            if (string.IsNullOrWhiteSpace(s)) continue;
            if (long.TryParse(s, out var v) && v > maxVal) maxVal = v;
        }

        var nextABordroNo = (maxVal + 1).ToString().PadLeft(15, '0');

        var entity = new CustomerCheck
        {
            ABordroNo = nextABordroNo,
            DocumentNo = documentNo,
            CustomerCode = request.CustomerCode.Trim(),
            IssueDate = NormalizeUtc(request.IssueDate),
            DueDate = NormalizeUtc(request.DueDate),
            Amount = request.Amount,
            CurrencyTypeId = request.CurrencyTypeId,
            EndorsementType = request.EndorsementType,
            BankName = string.IsNullOrWhiteSpace(request.BankName) ? null : request.BankName.Trim(),
            BranchName = string.IsNullOrWhiteSpace(request.BranchName) ? null : request.BranchName.Trim(),
            DistrictName = string.IsNullOrWhiteSpace(request.DistrictName) ? null : request.DistrictName.Trim(),
            CheckNo = string.IsNullOrWhiteSpace(request.CheckNo) ? null : request.CheckNo.Trim(),
            // customer tedarikçi carisinde null: doğrudan customer.Name okumak çek girişini
            // NullReferenceException ile düşürüyordu. Ad zaten yukarıda çözüldü.
            OriginalDebtorName = request.EndorsementType == CustomerCheckEndorsementType.Original
                ? customerName
                : (string.IsNullOrWhiteSpace(request.OriginalDebtorName) ? null : request.OriginalDebtorName.Trim()),
            OriginalIdentityNo = string.IsNullOrWhiteSpace(request.OriginalIdentityNo) ? null : request.OriginalIdentityNo.Trim(),
            OriginalTaxNo = string.IsNullOrWhiteSpace(request.OriginalTaxNo) ? null : request.OriginalTaxNo.Trim(),
            PaymentStatus = CustomerCheckPaymentStatus.Pending,
            Status = CustomerCheckStatus.Portfolio,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.CustomerChecks.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.CustomerCheck,
            DocumentId = entity.Id,
            Date = entity.IssueDate,
            Type = CheckOperationType.Create,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            Description = "Oluşturuldu",
            CreateUser = username,
            CreateTime = now
        });

        // Çek tutarı çekin KENDİ para birimindedir; TL sütunu kurla üretilir.
        //
        // KULLANICININ GİRDİĞİ KUR ÖNCELİKLİ (2026-08-17). Ekranda kur alanı artık müşteri
        // çekinde de var ve doldurulup gönderiliyor; çekin anlaşma kuru güncel kurdan farklı
        // olabilir. Gönderilmezse eski davranış: sunucu güncel kuru çeker.
        var checkRate = request.CurrencyRate.HasValue && request.CurrencyRate.Value > 0m
            ? request.CurrencyRate.Value
            : await ResolveCheckRateAsync(entity.CurrencyTypeId, cancellationToken);
        var checkTlAmount = Math.Round(entity.Amount * checkRate, 2, MidpointRounding.AwayFromZero);

        AddCheckReceiptLedgerEntry(isSupplierCari, entity, checkRate, checkTlAmount, "Çek Girişi", username, now);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id } });
    }

    [HttpPost("bulk")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> BulkCreate([FromBody] List<CreateCustomerCheckRequest> requests, CancellationToken cancellationToken)
    {
        if (requests is null || requests.Count == 0)
        {
            return BadRequest(new { success = false, message = "Kayıt bulunamadı" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        var docNoSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var currentMax = await _dbContext.CustomerChecks
            .AsNoTracking()
            .Select(x => x.ABordroNo)
            .ToListAsync(cancellationToken);

        long maxVal = 900000000000000;
        foreach (var s in currentMax)
        {
            if (string.IsNullOrWhiteSpace(s)) continue;
            if (long.TryParse(s, out var v) && v > maxVal) maxVal = v;
        }

        var createdIds = new List<int>();

        foreach (var request in requests)
        {
            if (!TryValidateModel(request)) return ValidationProblem(ModelState);

            if (request.EndorsementType == CustomerCheckEndorsementType.Endorsed)
            {
                if (string.IsNullOrWhiteSpace(request.OriginalDebtorName))
                {
                    return BadRequest(new { success = false, message = "Ciro seçildiğinde Asıl Borçlu zorunludur" });
                }
            }

            var customerName = string.Empty;
            var customer = await _dbContext.Customers
                .AsNoTracking()
                .Select(x => new { x.CustomerCode, x.Name })
                .FirstOrDefaultAsync(x => x.CustomerCode == request.CustomerCode, cancellationToken);
            var isSupplierCari = false;
            if (customer != null)
            {
                customerName = customer.Name;
            }
            else
            {
                var supplier = await _dbContext.Suppliers
                    .AsNoTracking()
                    .Select(x => new { x.SupplierCode, x.FullName })
                    .FirstOrDefaultAsync(x => x.SupplierCode == request.CustomerCode, cancellationToken);
                if (supplier != null)
                {
                    customerName = supplier.FullName;
                    isSupplierCari = true;
                }
                else
                {
                    return BadRequest(new { success = false, message = "Cari bulunamadı" });
                }
            }

            var requestedDocNo = string.IsNullOrWhiteSpace(request.DocumentNo) ? null : request.DocumentNo.Trim();
            var docNo = requestedDocNo ?? await GenerateDocumentNo15Async(cancellationToken);
            if (!docNoSet.Add(docNo)) return BadRequest(new { success = false, message = $"Belge No tekrarlı: {docNo}" });

            var exists = await _dbContext.CustomerChecks
                .AsNoTracking()
                .AnyAsync(x => x.DocumentNo == docNo, cancellationToken);

            if (exists)
            {
                return BadRequest(new { success = false, message = "Belge No zaten kullanılıyor" });
            }

            maxVal += 1;
            var nextABordroNo = maxVal.ToString().PadLeft(15, '0');

            var entity = new CustomerCheck
            {
                ABordroNo = nextABordroNo,
                DocumentNo = docNo,
                CustomerCode = request.CustomerCode.Trim(),
                IssueDate = NormalizeUtc(request.IssueDate),
                DueDate = NormalizeUtc(request.DueDate),
                Amount = request.Amount,
                CurrencyTypeId = request.CurrencyTypeId,
                EndorsementType = request.EndorsementType,
                BankName = string.IsNullOrWhiteSpace(request.BankName) ? null : request.BankName.Trim(),
                BranchName = string.IsNullOrWhiteSpace(request.BranchName) ? null : request.BranchName.Trim(),
                DistrictName = string.IsNullOrWhiteSpace(request.DistrictName) ? null : request.DistrictName.Trim(),
                CheckNo = string.IsNullOrWhiteSpace(request.CheckNo) ? null : request.CheckNo.Trim(),
                // Tedarikçi carisinde customer null olduğu için doğrudan okunamaz.
                OriginalDebtorName = request.EndorsementType == CustomerCheckEndorsementType.Original
                    ? customerName
                    : (string.IsNullOrWhiteSpace(request.OriginalDebtorName) ? null : request.OriginalDebtorName.Trim()),
                OriginalIdentityNo = string.IsNullOrWhiteSpace(request.OriginalIdentityNo) ? null : request.OriginalIdentityNo.Trim(),
                OriginalTaxNo = string.IsNullOrWhiteSpace(request.OriginalTaxNo) ? null : request.OriginalTaxNo.Trim(),
                PaymentStatus = CustomerCheckPaymentStatus.Pending,
                Status = CustomerCheckStatus.Portfolio,
                CreateUser = username,
                CreateTime = now
            };

            _dbContext.CustomerChecks.Add(entity);
            await _dbContext.SaveChangesAsync(cancellationToken);

            _dbContext.CheckOperations.Add(new CheckOperation
            {
                DocumentType = CheckDocumentType.CustomerCheck,
                DocumentId = entity.Id,
                Date = entity.IssueDate,
                Type = CheckOperationType.Create,
                Amount = entity.Amount,
                CurrencyTypeId = entity.CurrencyTypeId,
                Description = "Oluşturuldu",
                CreateUser = username,
                CreateTime = now
            });

            // Çek tutarı çekin KENDİ para birimindedir; TL sütunu kurla üretilir.
            var checkRate = await ResolveCheckRateAsync(entity.CurrencyTypeId, cancellationToken);
            var checkTlAmount = Math.Round(entity.Amount * checkRate, 2, MidpointRounding.AwayFromZero);

            AddCheckReceiptLedgerEntry(isSupplierCari, entity, checkRate, checkTlAmount, "Çek Girişi", username, now);

            await _dbContext.SaveChangesAsync(cancellationToken);
            createdIds.Add(entity.Id);
        }

        await tx.CommitAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = createdIds.Select(id => new { id }).ToList() });
    }

    /// <summary>
    /// Çekin BULUNDUĞU HESAP ile banka hareketlerini eşitler. Her çek işleminden sonra çağrılır.
    /// </summary>
    /// <remarks>
    /// (2026-08-24, kullanıcı kararı: "aynı kasalar arası transfer gibi — birine çıkış yazsın,
    /// birine giriş yazsın" + "hangi bankaya verirsek orada olmalı, 2 bankaya bağlamayacağız".)
    ///
    /// MODEL: TRANSFER, SİLME DEĞİL. Çek bir hesaba girdiğinde o hesaba GİRİŞ yazılır; oradan
    /// ayrıldığında satır SİLİNMEZ, karşısına ÇIKIŞ yazılır. Böylece hesabın geçmişi "şu çek
    /// şu gün girdi, şu gün çıktı" diye okunabilir kalır ve bakiye yine doğru olur.
    /// Başka bankaya devirde eski hesaba ÇIKIŞ, yeni hesaba GİRİŞ düşer — kasalar arası
    /// transferin aynısı.
    ///
    /// ÖLÇÜT "AÇIK POZİSYON": bir çekin bir hesaptaki durumu, o hesaptaki GİRİŞ sayısından
    /// ÇIKIŞ sayısı düşülerek bulunur. 1 ise çek orada duruyor, 0 ise çıkmış. Fonksiyon bu
    /// sayıyı hedef duruma çeker; bu yüzden ETKİSİZDİR (idempotent): iki kez çağrılması bir
    /// kez çağrılmasıyla aynı sonucu verir, çift satır üretmez.
    ///
    /// Satırlar kimlikle bulunur (<c>CheckId</c>), açıklama metniyle değil — metin değişirse
    /// eşleşme kaybolur ve hesapta artık satır kalırdı.
    ///
    /// TAHSİL SATIRINA DOKUNULMAZ: tahsilde yazılan gerçek para girişinin <c>CheckId</c>
    /// alanı boştur, burada görünmez. Çekin teminattan çıkışı ile paranın vadesize girişi
    /// ayrı iki satırdır — tam da transfer gibi.
    /// </remarks>
    private async Task CekHesapHareketiniEsitleAsync(
        CustomerCheck cek,
        DateTime tarih,
        string username,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var satirlar = await _dbContext.BankAccountTransactions
            .Where(x => x.CheckId == cek.Id)
            .ToListAsync(cancellationToken);

        // Çek bir hesapta DURUYOR mu? Yalnızca "bankada" sayılan durumlarda durur.
        var hedefHesapId =
            (cek.Status == CustomerCheckStatus.EndorsedToBankAsGuarantee
             || cek.Status == CustomerCheckStatus.EndorsedToBankForCollection)
                ? cek.CurrentBankAccountDefinitionId
                : null;

        // Hangi hesapta kaç net giriş var (giriş - çıkış).
        var netler = satirlar
            .GroupBy(x => x.BankAccountDefinitionId)
            .ToDictionary(
                g => g.Key,
                g => g.Count(x => x.Direction == BankAccountTransactionDirection.In)
                     - g.Count(x => x.Direction == BankAccountTransactionDirection.Out));

        // 1) Çekin OLMAMASI gereken her hesapta açık pozisyon varsa ÇIKIŞ yazılır.
        foreach (var kv in netler)
        {
            if (hedefHesapId.HasValue && kv.Key == hedefHesapId.Value) continue;
            if (kv.Value <= 0) continue;

            _dbContext.BankAccountTransactions.Add(
                await CekBankaSatiriOlusturAsync(cek, kv.Key, tarih, giris: false, username, now, cancellationToken));
        }

        if (!hedefHesapId.HasValue) return;

        // 2) Hedef hesapta açık pozisyon yoksa GİRİŞ yazılır.
        netler.TryGetValue(hedefHesapId.Value, out var hedefNet);
        if (hedefNet <= 0)
        {
            _dbContext.BankAccountTransactions.Add(
                await CekBankaSatiriOlusturAsync(cek, hedefHesapId.Value, tarih, giris: true, username, now, cancellationToken));
            return;
        }

        /*
          Çek zaten hedef hesapta duruyor: yeni satır AÇILMAZ, açık olan GİRİŞ güncellenir.
          Çekin tutarı ya da vadesi düzeltilmiş olabilir; kapanmamış bir pozisyonun
          düzeltilmesi yeni bir hareket değildir.
        */
        var acikGiris = satirlar
            .Where(x => x.BankAccountDefinitionId == hedefHesapId.Value
                        && x.Direction == BankAccountTransactionDirection.In)
            .OrderByDescending(x => x.Id)
            .FirstOrDefault();

        if (acikGiris is null) return;

        var taze = await CekBankaSatiriOlusturAsync(cek, hedefHesapId.Value, acikGiris.Date, giris: true, username, now, cancellationToken);
        acikGiris.Amount = taze.Amount;
        acikGiris.CurrencyTypeId = taze.CurrencyTypeId;
        acikGiris.CurrencyRate = taze.CurrencyRate;
        acikGiris.CurrencyAmount = taze.CurrencyAmount;
        acikGiris.CounterpartyCode = taze.CounterpartyCode;
        acikGiris.CounterpartyName = taze.CounterpartyName;
        acikGiris.DocumentNo = taze.DocumentNo;
        acikGiris.MaturityDate = taze.MaturityDate;
        acikGiris.Description = taze.Description;
        acikGiris.EditUser = username;
        acikGiris.EditTime = now;
    }

    /// <summary>Çekten doğan tek bir banka hareketi kurar (kaydetmez).</summary>
    /// <remarks>
    /// Hareket HESABIN para biriminde yazılır, çekin değil — tahsil yolundaki kuralın aynısı:
    /// TL hesaba giren dolar çeki satıra "USD" yazılınca TL banka ekstresi süzgecinde
    /// kayboluyordu.
    /// </remarks>
    private async Task<BankAccountTransaction> CekBankaSatiriOlusturAsync(
        CustomerCheck cek,
        int bankaHesapId,
        DateTime tarih,
        bool giris,
        string username,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var hesap = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Select(x => new { x.Id, x.CurrencyTypeId })
            .FirstOrDefaultAsync(x => x.Id == bankaHesapId, cancellationToken)
            ?? throw new InvalidOperationException("Banka hesabı bulunamadı");

        var kur = await ResolveCheckRateAsync(cek.CurrencyTypeId, cancellationToken);
        var tlTutar = Math.Round(cek.Amount * kur, 2, MidpointRounding.AwayFromZero);

        var mv = await B2B.Erp.Api.Core.Helpers.AccountMovementCurrency.ResolveAsync(
            _money, hesap.CurrencyTypeId, tlTutar, cancellationToken);

        var musteriAdi = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == cek.CustomerCode)
            .Select(x => x.Name)
            .FirstOrDefaultAsync(cancellationToken) ?? string.Empty;

        var tur = cek.Status == CustomerCheckStatus.EndorsedToBankForCollection ? "Tahsile" : "Teminat";

        return new BankAccountTransaction
        {
            BankAccountDefinitionId = bankaHesapId,
            CheckId = cek.Id,
            Date = tarih,
            Direction = giris ? BankAccountTransactionDirection.In : BankAccountTransactionDirection.Out,
            Amount = mv.CurrencyTypeId <= 1 ? tlTutar : tlTutar,
            CurrencyTypeId = mv.CurrencyTypeId,
            CurrencyRate = mv.Rate,
            CurrencyAmount = mv.CurrencyAmount,
            CounterpartyType = BankAccountTransactionCounterpartyType.Customer,
            CounterpartyCode = cek.CustomerCode,
            CounterpartyName = musteriAdi,
            DocumentNo = cek.DocumentNo,
            MaturityDate = cek.DueDate,
            Description = giris
                ? $"Çek Girişi - {tur} ({cek.DocumentNo})"
                : $"Çek Çıkışı - {tur} ({cek.DocumentNo})",
            IsPosFee = false,
            CreateUser = username,
            CreateTime = now
        };
    }

    [HttpPost("{id:int}/endorse-to-bank-guarantee")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> EndorseToBankGuarantee([FromRoute] int id, [FromBody] CustomerCheckActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!request.BankAccountDefinitionId.HasValue || request.BankAccountDefinitionId.Value <= 0)
        {
            return BadRequest(new { success = false, message = "Banka hesabı seçmelisiniz" });
        }

        var entity = await _dbContext.CustomerChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status == CustomerCheckStatus.EndorsedToBankAsGuarantee)
        {
            return Ok(new { success = true, data = new { vBordroNo = entity.VBordroNo ?? string.Empty } });
        }

        if (entity.Status != CustomerCheckStatus.Portfolio)
        {
            return BadRequest(new { success = false, message = $"Bu işlem sadece portföydeki çekler için yapılabilir (id={entity.Id}, status={(int)entity.Status})" });
        }

        var bank = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Select(x => new { x.Id, x.AccountType })
            .FirstOrDefaultAsync(x => x.Id == request.BankAccountDefinitionId.Value, cancellationToken);

        if (bank is null) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });
        // HESAP TIPI KISITI KALDIRILDI (2026-08-24, kullanici: "istersem vadesize felan da
        // verebilirim"). Once yalnizca AccountType==3 (Teminat Cekleri) kabul ediliyordu ve
        // cek baska bir hesaba hic verilemiyordu. Hesabi kullanici secer.

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(entity.VBordroNo))
        {
            entity.VBordroNo = await GenerateNextVBordroNo15Async(cancellationToken);
        }

        entity.Status = CustomerCheckStatus.EndorsedToBankAsGuarantee;
        entity.CurrentBankAccountDefinitionId = request.BankAccountDefinitionId.Value;
        entity.CurrentCustomerCode = null;
        entity.EditUser = username;
        entity.EditTime = now;


        var checkLedgers = await _dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check && x.ReferenceId == entity.Id)
            .ToListAsync(cancellationToken);
        foreach (var ledger in checkLedgers)
        {
            ledger.Description = "Çek Teminat";
        }

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.CustomerCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.EndorseToBankAsGuarantee,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = request.BankAccountDefinitionId.Value,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        });

        // Cek hangi hesapta duruyorsa banka hareketi ona gore yazilir/silinir/guncellenir.
        await CekHesapHareketiniEsitleAsync(entity, date, username, now, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { vBordroNo = entity.VBordroNo ?? string.Empty } });
    }

    [HttpGet("vbordro/{vBordroNo}/print")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> PrintVBordro([FromRoute] string vBordroNo, CancellationToken cancellationToken)
    {
        var no = string.IsNullOrWhiteSpace(vBordroNo) ? string.Empty : vBordroNo.Trim();
        if (no.Length == 0) return BadRequest(new { success = false, message = "Bordro no boş" });

        var checks = await (
                from chk in _dbContext.CustomerChecks.AsNoTracking()
                join bank in _dbContext.BankAccountDefinitions.AsNoTracking() on chk.CurrentBankAccountDefinitionId equals (int?)bank.Id into bankJoin
                from bank in bankJoin.DefaultIfEmpty()
                where chk.VBordroNo == no
                orderby chk.DueDate, chk.Id
                select new
                {
                    chk.CustomerCode,
                    TakasBankasi = bank != null ? bank.AccountName : null,
                    chk.IssueDate,
                    chk.OriginalDebtorName,
                    chk.BankName,
                    chk.BranchName,
                    chk.CheckNo,
                    chk.DueDate,
                    chk.Amount,
                    // Çek tutarı çekin KENDİ para birimindedir; bordroda para birimi
                    // yazılmazsa dolar çekle TL çek aynı sütunda ayırt edilemiyor ve
                    // altındaki TOPLAM ikisini toplayarak anlamsız bir sayı üretiyordu.
                    chk.CurrencyTypeId
                })
            .ToListAsync(cancellationToken);

        if (checks.Count == 0) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        // Belgedeki firma bloğu diğer basımlarla aynı sabit metindir; kiracı adı
        // ("Stilsoft Test" gibi) artık başlıkta kullanılmıyor.
        var head = checks[0];

        // ÇIKIŞ TARİHİ = ÇEKLERİN BANKAYA VERİLDİĞİ GÜN (2026-08-26 bildirimi).
        //
        // Önceden `head.IssueDate` basılıyordu: bordronun İLK çekinin (vadesi en yakın
        // olanın) KEŞİDE tarihi. Bordronun bankaya götürüldüğü günle hiçbir ilgisi yok —
        // 26 Ağustos'ta bankaya verilen bordroda 25.08.2026 yazıyordu, çünkü o gün keşide
        // edilmiş bir çek listenin başındaydı. Belge bankaya gittiği için tarih YANLIŞ
        // bilgi taşıyordu.
        //
        // Doğru kaynak teminata aktarma işleminin KENDİ tarihi: `CheckOperations.Date`
        // (`Type = EndorseToBankAsGuarantee`). Bu tarih kullanıcının işlem ekranında
        // girdiği gündür ve hem tekli hem toplu aktarma yolu onu yazar.
        //
        // Bir çek portföye dönüp yeniden teminata verilebilir; o zaman aynı çekte birden
        // fazla aktarım kaydı olur. EN SON olan bu bordroya aittir.
        var bordroCheckIds = await _dbContext.CustomerChecks.AsNoTracking()
            .Where(x => x.VBordroNo == no)
            .Select(x => x.Id)
            .ToListAsync(cancellationToken);

        var cikisTarihi = await _dbContext.CheckOperations.AsNoTracking()
            .Where(x => x.DocumentType == CheckDocumentType.CustomerCheck
                        && x.Type == CheckOperationType.EndorseToBankAsGuarantee
                        && bordroCheckIds.Contains(x.DocumentId))
            .OrderByDescending(x => x.Date)
            .Select(x => (DateTime?)x.Date)
            .FirstOrDefaultAsync(cancellationToken);

        // TOPLAM PARA BİRİMİ BAŞINA. Bordroya farklı dövizli çekler birlikte
        // konabiliyor; tek toplam 10.000 $ ile 10.000 ₺'yi 20.000 sayardı.
        var totalsByCurrency = checks
            .GroupBy(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId))
            .OrderBy(g => g.Key)
            .Select(g => new
            {
                Code = CurrencyTypeHelper.ToCodeOrTry(g.Key),
                Total = g.Sum(x => (decimal)x.Amount)
            })
            .ToList();
        // ORTALAMA VADE TUTAR AĞIRLIKLIDIR. Düz aritmetik ortalama alınıyordu: 1.000 ₺ / 10 gün
        // ile 1.000.000 ₺ / 90 günlük iki çekin bordrosunda gerçek ortalama vade ~90 günken
        // belgede 50 gün yazıyordu — banka iskontosu bu rakama bakıyor. Ağırlık çekin kendi
        // tutarıdır; tek para birimli bordroda (olağan hâl) sonuç tam doğrudur. Karışık para
        // birimli bordroda tutarlar birbirine çevrilemediği için ağırlık yaklaşıktır, ama
        // tutarı hiç saymayan eski hesaptan her hâlükârda daha doğrudur.
        var weightTotal = checks.Sum(x => Math.Abs((decimal)x.Amount));
        double avgDays;
        DateTime avgDueDate;
        DateTime avgIssueDate;

        if (checks.Count == 0)
        {
            avgDueDate = DateTime.UtcNow;
            avgIssueDate = DateTime.UtcNow;
            avgDays = 0d;
        }
        else if (weightTotal > 0m)
        {
            var issueTicks = checks.Sum(x => (double)Math.Abs((decimal)x.Amount) * x.IssueDate.Ticks) / (double)weightTotal;
            var dueTicks = checks.Sum(x => (double)Math.Abs((decimal)x.Amount) * x.DueDate.Ticks) / (double)weightTotal;
            avgIssueDate = new DateTime((long)issueTicks, DateTimeKind.Utc);
            avgDueDate = new DateTime((long)dueTicks, DateTimeKind.Utc);
            avgDays = (avgDueDate - avgIssueDate).TotalDays;
        }
        else
        {
            // Tutarların tamamı sıfırsa ağırlık yok; eski davranış (düz ortalama).
            var avgIssueTime = checks.Select(x => x.IssueDate.Ticks).Average();
            var avgDueTime = checks.Select(x => x.DueDate.Ticks).Average();
            avgIssueDate = new DateTime((long)avgIssueTime, DateTimeKind.Utc);
            avgDueDate = new DateTime((long)avgDueTime, DateTimeKind.Utc);
            avgDays = (avgDueDate - avgIssueDate).TotalDays;
        }

        static string Html(string s) => System.Net.WebUtility.HtmlEncode(s ?? string.Empty);
        static string FmtMoney(decimal v)
        {
            var nfi = (System.Globalization.CultureInfo.GetCultureInfo("tr-TR")).NumberFormat;
            return v.ToString("N2", nfi);
        }

        var html = $@"<!doctype html>
<html lang='tr'>
<head>
  <meta charset='utf-8' />
  <meta name='viewport' content='width=device-width, initial-scale=1' />
  <title>Çek Verildi Bordrosu</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin: 0; }}
    .page {{ width: 210mm; min-height: 297mm; margin: 0 auto; padding: 14mm 12mm; box-sizing: border-box; }}
    .top {{ display:flex; justify-content:space-between; align-items:flex-start; gap: 16px; }}
    /* Logo kuralı KALDIRILDI: bordroda artık logo basılmıyor (bkz. aşağıdaki not). */
    /* Logo SAĞ ÜSTTE, firma bilgisi hemen altında (diğer basımlarla aynı yerleşim). */
    .company {{ text-align: right; }}
    .company-info {{ margin-top: 4px; font-size: 9px; line-height: 1.35; color: #222; }}
    h1 {{ font-size: 14px; margin: 0; text-align: center; letter-spacing: .5px; }}
    .meta {{ margin-top: 6px; font-size: 11px; }}
    .meta div {{ margin: 1px 0; }}
    /* SABİT SÜTUN GENİŞLİĞİ + kırılabilir kelime: uzun borçlu/banka adları eskiden
       sütunu genişletip tabloyu kağıt dışına taşırıyordu.
       Ölçüler bir bordronun kapasitesi olan 25 çeke göre ayarlandı: bu satır
       yüksekliğiyle 25 kayıt TEK A4'e sığıyor (ölçüldü: içerik ~220mm, kullanılabilir
       alan 273mm). Punto/dolgu büyütülürse 25 çek ikinci sayfaya taşar. */
    table {{ width:100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }}
    th, td {{ font-size: 10px; border-bottom: 1px solid #ddd; padding: 2.5px 4px; text-align:left;
              vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }}
    th {{ color: #333; }}
    .right {{ text-align:right; }}
    .footer {{ margin-top: 12px; display:flex; justify-content:space-between; gap: 16px; }}
    /* Kaşe TOPLAM'ın altında, sağda. Ölçü 25 çeklik bordronun tek sayfada kalmasına
       göre seçildi — büyütülürse belge ikinci sayfaya taşar. */
    .stamp {{ margin-top: 6px; text-align: right; }}
    .stamp-img {{ width: 52mm; height: auto; display: inline-block; }}
    @media print {{
      @page {{ size: A4; margin: 12mm; }}
      .no-print {{ display:none; }}
      .page {{ width: auto; min-height: 0; padding: 0; margin: 0; }}
      /* Bordro ikinci sayfaya taştığında başlık satırı tekrar etsin, bir çek satırı
         iki sayfaya bölünmesin, toplam bloğu ortadan ayrılmasın. */
      thead {{ display: table-header-group; }}
      tr {{ page-break-inside: avoid; }}
      .footer, .totals {{ page-break-inside: avoid; }}
    }}
  </style>
</head>
<body>
  <div class='page'>
    <div class='top'>
      <div style='flex:1;'></div>
      <div style='flex:1;'>
        <h1>ÇEK VERİLDİ BORDROSU</h1>
      </div>
      <div style='flex:1;' class='company'>
        <!-- LOGO BASILMAZ (2026-08-23, kullanıcı kararı): bordro antetli kağıda basılıyor,
             kağıdın kendi logosunun üstüne ikinci bir logo geliyordu. Firma bilgisi kalıyor. -->
        <div class='company-info'>
          <strong>DEMO TİCARET LİMİTED</strong><br />
          Örnek Mah. Demo Cad. No:1<br />
          99010 Lefkoşa - KKTC<br />
          V.D.: Demo V.N.: 0000000
        </div>
      </div>
    </div>

    <div class='meta'>
      <div><strong>İSİM</strong> : {Html(head.TakasBankasi ?? string.Empty)}</div>
      <div><strong>ÇIKIŞ TARİHİ</strong> : {Html(cikisTarihi.HasValue ? PrintDate(cikisTarihi.Value) : string.Empty)}</div>
      <div><strong>BORDRO NO</strong> : {Html(no)}</div>
    </div>

    <table>
      <colgroup>
        <col style='width:24%' />
        <col style='width:20%' />
        <col style='width:16%' />
        <col style='width:13%' />
        <col style='width:12%' />
        <col style='width:15%' />
      </colgroup>
      <thead>
        <tr>
          <th>Çek Asıl Borçlu</th>
          <th>Çekin Bankası</th>
          <th>Çekin Şubesi</th>
          <th>Çek No</th>
          <th>Vade Tarihi</th>
          <th class='right'>Çek Tutar</th>
        </tr>
      </thead>
      <tbody>
        {string.Join("\n", checks.Select(c => $@"<tr>
          <td>{Html(c.OriginalDebtorName ?? string.Empty)}</td>
          <td>{Html(c.BankName ?? string.Empty)}</td>
          <td>{Html(c.BranchName ?? string.Empty)}</td>
          <td>{Html(c.CheckNo ?? string.Empty)}</td>
          <td>{Html(PrintDate(c.DueDate))}</td>
          <td class='right'>{Html(FmtMoney((decimal)c.Amount))} {Html(CurrencyTypeHelper.ToCodeOrTry(c.CurrencyTypeId))}</td>
        </tr>"))}
      </tbody>
    </table>

    <div class='footer'>
      <div>Yukarıda ayrıntılı kayıtlar hesabınıza {checks.Count} çekle kayıt edilmiştir.</div>
      <div class='totals right'>
        {string.Join("\n", totalsByCurrency.Select(t => $@"<div><strong>TOPLAM ({Html(t.Code)})</strong> : {Html(FmtMoney(t.Total))}</div>"))}
      </div>
    </div>
    <div class='totals' style='margin-top:4px;'>Ortalama Vade Günü : {Html(Math.Round(avgDays).ToString("0"))}</div>
    <div class='totals' style='margin-top:2px;'>Ortalama Vade Tarihi : {Html(PrintDate(avgDueDate))}</div>

    <div class='stamp totals'>
      <img class='stamp-img' src='/images/stilsoft-letterhead.png' alt='' onerror='this.style.display=""none""' />
    </div>
  </div>
</body>
</html>";

        return Content(html, "text/html; charset=utf-8");
    }

    public sealed class CustomerCheckBulkEndorseToBankGuaranteeRequest
    {
        public List<int> Ids { get; set; } = new();

        public DateTime Date { get; set; }

        public int BankAccountDefinitionId { get; set; }

        public string? Description { get; set; }
    }

    [HttpPost("endorse-to-bank-guarantee/bulk")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> EndorseToBankGuaranteeBulk([FromBody] CustomerCheckBulkEndorseToBankGuaranteeRequest request, CancellationToken cancellationToken)
    {
        var ids = (request?.Ids ?? new List<int>()).Where(x => x > 0).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { success = false, message = "Kayıt bulunamadı" });

        // Bir bordroya en fazla 25 çek sığar (basılı bordronun kapasitesi). Ekranda da
        // uyarı var ama sınır burada da durmalı: ekran kontrolü yalnızca kazayla yapılanı
        // önler, doğrudan uca istek atılırsa 26. çek sessizce bordroya girerdi.
        if (ids.Count > MaxChecksPerVBordro)
        {
            return BadRequest(new
            {
                success = false,
                message = $"Aynı bordroda en fazla {MaxChecksPerVBordro} çek aktarabilirsiniz. Seçilen: {ids.Count}"
            });
        }

        if (request.BankAccountDefinitionId <= 0) return BadRequest(new { success = false, message = "Banka hesabı seçmelisiniz" });

        var bank = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Select(x => new { x.Id, x.AccountType })
            .FirstOrDefaultAsync(x => x.Id == request.BankAccountDefinitionId, cancellationToken);

        if (bank is null) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });
        // HESAP TIPI KISITI KALDIRILDI (2026-08-24, kullanici: "istersem vadesize felan da
        // verebilirim"). Once yalnizca AccountType==3 (Teminat Cekleri) kabul ediliyordu ve
        // cek baska bir hesaba hic verilemiyordu. Hesabi kullanici secer.

        var rows = await _dbContext.CustomerChecks
            .Where(x => ids.Contains(x.Id))
            .ToListAsync(cancellationToken);

        if (rows.Count != ids.Count) return NotFound(new { success = false, message = "Bazı kayıtlar bulunamadı" });

        var invalid = rows.FirstOrDefault(x => x.Status != CustomerCheckStatus.Portfolio && x.Status != CustomerCheckStatus.EndorsedToBankAsGuarantee);
        if (invalid != null)
        {
            return BadRequest(new { success = false, message = $"Bu işlem sadece portföydeki çekler için yapılabilir (id={invalid.Id}, status={(int)invalid.Status})" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var portfolioRows = rows.Where(x => x.Status == CustomerCheckStatus.Portfolio).ToList();
        if (portfolioRows.Count == 0) return Ok(new { success = true, data = new { vBordroNo = string.Empty, updated = 0, skipped = rows.Count } });

        var vbordroNo = await GenerateNextVBordroNo15Async(cancellationToken);

        foreach (var entity in portfolioRows)
        {
            entity.VBordroNo = vbordroNo;
            entity.Status = CustomerCheckStatus.EndorsedToBankAsGuarantee;
            entity.CurrentBankAccountDefinitionId = request.BankAccountDefinitionId;
            entity.CurrentCustomerCode = null;
            entity.EditUser = username;
            entity.EditTime = now;


            _dbContext.CheckOperations.Add(new CheckOperation
            {
                DocumentType = CheckDocumentType.CustomerCheck,
                DocumentId = entity.Id,
                Date = date,
                Type = CheckOperationType.EndorseToBankAsGuarantee,
                Amount = entity.Amount,
                CurrencyTypeId = entity.CurrencyTypeId,
                BankAccountDefinitionId = request.BankAccountDefinitionId,
                Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
                CreateUser = username,
                CreateTime = now
            });

            // Bordrodaki HER cek icin ayri satir: banka ekstresinde cekler tek tek okunmali.
            await CekHesapHareketiniEsitleAsync(entity, date, username, now, cancellationToken);
        }
        var checkIds = portfolioRows.Select(x => x.Id).ToList();
        var checkLedgers = await _dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check && checkIds.Contains(x.ReferenceId ?? 0))
            .ToListAsync(cancellationToken);
        foreach (var ledger in checkLedgers)
        {
            ledger.Description = "Çek Teminat";
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { vBordroNo = vbordroNo, updated = portfolioRows.Count, skipped = rows.Count - portfolioRows.Count } });
    }

    [HttpPost("{id:int}/return-to-portfolio")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> ReturnToPortfolio([FromRoute] int id, [FromBody] CustomerCheckActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.CustomerChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status == CustomerCheckStatus.Returned || entity.Status == CustomerCheckStatus.Dishonored)
        {
            return BadRequest(new { success = false, message = "Karşılıksız veya iade durumundaki çekler için işlem yapılamaz." });
        }

        if (entity.Status == CustomerCheckStatus.Collected)
        {
            return BadRequest(new { success = false, message = "Tahsil edilmiş çek portföye alınamaz" });
        }

        if (entity.Status == CustomerCheckStatus.Portfolio)
        {
            return BadRequest(new { success = false, message = "Bu çek zaten portföyde" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var prevTargetCustomer = entity.CurrentCustomerCode;

        entity.Status = CustomerCheckStatus.Portfolio;
        entity.CurrentBankAccountDefinitionId = null;
        entity.CurrentCustomerCode = null;
        entity.EditUser = username;
        entity.EditTime = now;

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.CustomerCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.Return,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = request.BankAccountDefinitionId,
            TargetCustomerCode = prevTargetCustomer,
            Description = string.IsNullOrWhiteSpace(request.Description) ? "Portföye iade" : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        });

        // Find existing ledger entries for this check
        var checkLedgers = await _dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check && x.ReferenceId == entity.Id)
            .ToListAsync(cancellationToken);

        var aLedger = checkLedgers.FirstOrDefault(x => x.CustomerCode == entity.CustomerCode);
        if (aLedger is not null)
        {
            aLedger.Date = entity.IssueDate; // Original issue date
            aLedger.Direction = CustomerLedgerEntryDirection.Credit; // Credit (Alacak)
            aLedger.Description = "Çek Portföy";
            aLedger.EditUser = username;
            aLedger.EditTime = now;
            _dbContext.CustomerLedgerEntries.Update(aLedger);

            // Remove any other ledger entries (including B's ciro Debit entry or duplicate entries)
            var toRemove = checkLedgers.Where(x => x.Id != aLedger.Id).ToList();
            if (toRemove.Any())
            {
                _dbContext.CustomerLedgerEntries.RemoveRange(toRemove);
            }
        }
        else
        {
            // If A's entry is somehow missing, recreate it.
            // Yeniden üretilen satır GİRİŞ kuruyla yazılır: güncel kur, geçmiş tarihli
            // ekstreyi ve mizanı kur farkı kadar kaydırıyordu.
            var checkRate = await ResolveOriginalCheckRateAsync(entity, cancellationToken);
            var checkTlAmount = Math.Round(entity.Amount * checkRate, 2, MidpointRounding.AwayFromZero);

            _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
            {
                CustomerCode = entity.CustomerCode,
                Date = entity.IssueDate,
                DueDate = entity.DueDate,
                Direction = CustomerLedgerEntryDirection.Credit,
                Amount = checkTlAmount,
                // Ham değil normalize (bkz. AddCheckReceiptLedgerEntry): çeklerin bir kısmı
                // eski 0 (=TL) koduyla duruyor, aynı satırın ödeme alanı ise 1 yazıyordu.
                CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId),
                CurrencyRate = checkRate,
                CurrencyAmount = entity.Amount,
                PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId),
                PaymentCurrencyRate = checkRate,
                PaymentCurrencyAmount = entity.Amount,
                DocumentNo = !string.IsNullOrWhiteSpace(entity.CheckNo) ? entity.CheckNo : entity.DocumentNo,
                Description = "Çek Portföy",
                TransactionType = "Müşteri Çeki",
                ReferenceType = CustomerLedgerEntryReferenceType.Check,
                ReferenceId = entity.Id,
                CreateUser = username,
                CreateTime = now
            });

            // Remove any other entries that shouldn't exist (since we're returning to portfolio, no other entry should remain)
            if (checkLedgers.Any())
            {
                _dbContext.CustomerLedgerEntries.RemoveRange(checkLedgers);
            }
        }

        // Cek hangi hesapta duruyorsa banka hareketi ona gore yazilir/silinir/guncellenir.
        await CekHesapHareketiniEsitleAsync(entity, date, username, now, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/endorse-to-bank-collection")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> EndorseToBankForCollection([FromRoute] int id, [FromBody] CustomerCheckActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!request.BankAccountDefinitionId.HasValue || request.BankAccountDefinitionId.Value <= 0)
        {
            return BadRequest(new { success = false, message = "Banka hesabı seçmelisiniz" });
        }

        var entity = await _dbContext.CustomerChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != CustomerCheckStatus.Portfolio)
        {
            return BadRequest(new { success = false, message = "Bu işlem sadece portföydeki çekler için yapılabilir" });
        }

        var bank = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Select(x => new { x.Id })
            .FirstOrDefaultAsync(x => x.Id == request.BankAccountDefinitionId.Value, cancellationToken);

        if (bank is null) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = CustomerCheckStatus.EndorsedToBankForCollection;
        entity.CurrentBankAccountDefinitionId = request.BankAccountDefinitionId.Value;
        entity.CurrentCustomerCode = null;
        entity.EditUser = username;
        entity.EditTime = now;

        var checkLedgers = await _dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check && x.ReferenceId == entity.Id)
            .ToListAsync(cancellationToken);
        foreach (var ledger in checkLedgers)
        {
            ledger.Description = "Çek Tahsilat";
        }

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.CustomerCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.EndorseToBankForCollection,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = request.BankAccountDefinitionId.Value,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        });

        // Cek hangi hesapta duruyorsa banka hareketi ona gore yazilir/silinir/guncellenir.
        await CekHesapHareketiniEsitleAsync(entity, date, username, now, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/collect")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> Collect([FromRoute] int id, [FromBody] CustomerCheckActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!request.BankAccountDefinitionId.HasValue || request.BankAccountDefinitionId.Value <= 0)
        {
            return BadRequest(new { success = false, message = "Banka hesabı seçmelisiniz" });
        }

        var entity = await _dbContext.CustomerChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != CustomerCheckStatus.EndorsedToBankAsGuarantee && entity.Status != CustomerCheckStatus.EndorsedToBankForCollection)
        {
            return BadRequest(new { success = false, message = "Bu çek bankada değil" });
        }

        var bankAcc = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.CurrencyTypeId })
            .FirstOrDefaultAsync(x => x.Id == request.BankAccountDefinitionId.Value, cancellationToken);

        if (bankAcc is null) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı" });

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        // Çek tutarı çekin KENDİ para birimindedir; banka satırının TL sütunu kurla üretilir.
        var checkRate = await ResolveCheckRateAsync(entity.CurrencyTypeId, cancellationToken);
        var checkTlAmount = Math.Round(entity.Amount * checkRate, 2, MidpointRounding.AwayFromZero);

        // Banka hareketi ÇEKİN değil HESABIN para birimindedir: TL hesaba yatan dolar çeki
        // satıra "USD" yazınca TL banka ekstresi süzgecinde (0/1) kayboluyordu.
        (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) bankMv;
        try
        {
            bankMv = await B2B.Erp.Api.Core.Helpers.AccountMovementCurrency.ResolveAsync(
                _money, bankAcc.CurrencyTypeId, checkTlAmount, cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(503, new { success = false, message = ex.Message });
        }

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var customerName = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == entity.CustomerCode)
            .Select(x => x.Name)
            .FirstOrDefaultAsync(cancellationToken) ?? string.Empty;

        entity.Status = CustomerCheckStatus.Collected;
        entity.PaymentStatus = CustomerCheckPaymentStatus.Paid;
        entity.CurrentBankAccountDefinitionId = request.BankAccountDefinitionId.Value;
        entity.EditUser = username;
        entity.EditTime = now;


        var existingLedger = await _dbContext.CustomerLedgerEntries
            .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check && x.ReferenceId == entity.Id, cancellationToken);
        if (existingLedger is not null)
        {
            existingLedger.Date = date;
            existingLedger.Description = "Çek Tahsil";
            existingLedger.EditUser = username;
            existingLedger.EditTime = now;
            _dbContext.CustomerLedgerEntries.Update(existingLedger);
        }

        _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
        {
            BankAccountDefinitionId = request.BankAccountDefinitionId.Value,
            Date = date,
            Direction = BankAccountTransactionDirection.In,
            Amount = checkTlAmount,
            CurrencyTypeId = bankMv.CurrencyTypeId,
            CurrencyRate = bankMv.Rate,
            CurrencyAmount = bankMv.CurrencyAmount,
            CounterpartyType = BankAccountTransactionCounterpartyType.Customer,
            CounterpartyCode = entity.CustomerCode,
            CounterpartyName = customerName,
            Description = $"Çek Tahsil ({entity.DocumentNo})",
            IsPosFee = false,
            CreateUser = username,
            CreateTime = now
        });

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.CustomerCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.Collect,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = request.BankAccountDefinitionId.Value,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        });

        // Cek hangi hesapta duruyorsa banka hareketi ona gore yazilir/silinir/guncellenir.
        await CekHesapHareketiniEsitleAsync(entity, date, username, now, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/uncollect")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> Uncollect([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.CustomerChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != CustomerCheckStatus.Collected || entity.PaymentStatus != CustomerCheckPaymentStatus.Paid)
        {
            return BadRequest(new { success = false, message = "Bu çek tahsil edilmemiş veya ödendi durumunda değil" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        // 1. Determine previous status from history
        var prevOp = await _dbContext.CheckOperations
            .Where(x => x.DocumentType == CheckDocumentType.CustomerCheck && x.DocumentId == entity.Id && x.Type != CheckOperationType.Collect)
            .OrderByDescending(x => x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        var prevStatus = CustomerCheckStatus.EndorsedToBankForCollection; // Default fallback
        if (prevOp != null)
        {
            if (prevOp.Type == CheckOperationType.EndorseToBankAsGuarantee)
                prevStatus = CustomerCheckStatus.EndorsedToBankAsGuarantee;
            else if (prevOp.Type == CheckOperationType.EndorseToBankForCollection)
                prevStatus = CustomerCheckStatus.EndorsedToBankForCollection;
            else if (prevOp.Type == CheckOperationType.Create)
                prevStatus = CustomerCheckStatus.Portfolio;
        }

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        // 2. Revert CustomerCheck state
        entity.Status = prevStatus;
        entity.PaymentStatus = CustomerCheckPaymentStatus.Pending;
        // Portföye dönen çek artık bir bankada DEĞİLDİR; alan temizlenmeyince çek listede
        // hâlâ bankadaymış gibi görünüyordu. Bankaya teminata/tahsile verilmiş duruma
        // dönülüyorsa hesap bilgisi korunur.
        if (prevStatus == CustomerCheckStatus.Portfolio)
        {
            entity.CurrentBankAccountDefinitionId = null;
        }
        entity.EditUser = username;
        entity.EditTime = now;

        // 3. Update existing CustomerLedgerEntry
        var existingLedger = await _dbContext.CustomerLedgerEntries
            .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check && x.ReferenceId == entity.Id, cancellationToken);
        if (existingLedger is not null)
        {
            existingLedger.Date = entity.IssueDate;
            existingLedger.Description = prevStatus == CustomerCheckStatus.EndorsedToBankAsGuarantee ? "Çek Teminat" : "Çek Tahsilat";
            existingLedger.EditUser = username;
            existingLedger.EditTime = now;
            _dbContext.CustomerLedgerEntries.Update(existingLedger);
        }

        // 4. Delete the BankAccountTransaction created during collect
        // x.Amount banka hareketinin TL karşılığı, entity.Amount çekin kendi parası: dövizli
        // çekte eşleşme tutmuyor, tahsil geri alınsa da 38.000 ₺ bankada asılı kalıyordu.
        // Açıklamadaki belge no zaten tekil.
        var bankTx = await _dbContext.BankAccountTransactions
            .FirstOrDefaultAsync(x => x.CounterpartyType == BankAccountTransactionCounterpartyType.Customer
                && x.CounterpartyCode == entity.CustomerCode
                && x.Description == $"Çek Tahsil ({entity.DocumentNo})", cancellationToken);
        if (bankTx is not null)
        {
            _dbContext.BankAccountTransactions.Remove(bankTx);
        }

        // 5. Delete the Collect CheckOperation
        var collectOp = await _dbContext.CheckOperations
            .Where(x => x.DocumentType == CheckDocumentType.CustomerCheck && x.DocumentId == entity.Id && x.Type == CheckOperationType.Collect)
            .OrderByDescending(x => x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (collectOp is not null)
        {
            _dbContext.CheckOperations.Remove(collectOp);
        }

        // Cek hangi hesapta duruyorsa banka hareketi ona gore yazilir/silinir/guncellenir.
        await CekHesapHareketiniEsitleAsync(entity, now, username, now, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/endorse-to-customer")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> EndorseToCustomer([FromRoute] int id, [FromBody] CustomerCheckActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (string.IsNullOrWhiteSpace(request.TargetCustomerCode))
        {
            return BadRequest(new { success = false, message = "Hedef cari seçmelisiniz" });
        }

        var entity = await _dbContext.CustomerChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != CustomerCheckStatus.Portfolio)
        {
            return BadRequest(new { success = false, message = "Bu işlem sadece portföydeki çekler için yapılabilir" });
        }

        // Hedef cari TEDARİKÇİ de olabiliyor; o dalda `target` null kalıyor ve aşağıdaki
        // target.Name / target.CustomerCode okumaları ciroyu NullReferenceException ile
        // düşürüyordu. Kod ve ad ayrı değişkende tutulur, defter seçimi bayrağa bağlanır.
        var targetCustomerName = string.Empty;
        var targetIsSupplier = false;
        var targetCode = request.TargetCustomerCode.Trim();
        var target = await _dbContext.Customers
            .AsNoTracking()
            .Select(x => new { x.CustomerCode, x.Name })
            .FirstOrDefaultAsync(x => x.CustomerCode == request.TargetCustomerCode, cancellationToken);
        if (target != null)
        {
            targetCustomerName = target.Name;
            targetCode = target.CustomerCode;
        }
        else
        {
            var supplier = await _dbContext.Suppliers
                .AsNoTracking()
                .Select(x => new { x.SupplierCode, x.FullName })
                .FirstOrDefaultAsync(x => x.SupplierCode == request.TargetCustomerCode, cancellationToken);
            if (supplier != null)
            {
                targetCustomerName = supplier.FullName;
                targetCode = supplier.SupplierCode;
                targetIsSupplier = true;
            }
            else
            {
                return BadRequest(new { success = false, message = "Hedef cari bulunamadı" });
            }
        }

        var originalCustomerName = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == entity.CustomerCode)
            .Select(x => x.Name)
            .FirstOrDefaultAsync(cancellationToken);
        if (originalCustomerName == null)
        {
            originalCustomerName = await _dbContext.Suppliers
                .AsNoTracking()
                .Where(x => x.SupplierCode == entity.CustomerCode)
                .Select(x => x.FullName)
                .FirstOrDefaultAsync(cancellationToken) ?? entity.CustomerCode;
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.Status = CustomerCheckStatus.EndorsedToCustomer;
        entity.CurrentCustomerCode = request.TargetCustomerCode.Trim();
        entity.CurrentBankAccountDefinitionId = null;
        entity.EditUser = username;
        entity.EditTime = now;

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.CustomerCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.EndorseToCustomer,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            TargetCustomerCode = entity.CurrentCustomerCode,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        });

        // Find existing ledger entry for Customer A
        var existingLedger = await _dbContext.CustomerLedgerEntries
            .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check && x.ReferenceId == entity.Id && x.CustomerCode == entity.CustomerCode, cancellationToken);
        if (existingLedger is not null)
        {
            existingLedger.Description = $"Ciro Edildi: {targetCustomerName}";
            existingLedger.EditUser = username;
            existingLedger.EditTime = now;
            _dbContext.CustomerLedgerEntries.Update(existingLedger);
        }

        // Ciro edilen carinin defterine borç kaydı.
        // Çek tutarı çekin KENDİ para birimindedir; TL sütunu kurla üretilir.
        var checkRate = await ResolveCheckRateAsync(entity.CurrencyTypeId, cancellationToken);
        var checkTlAmount = Math.Round(entity.Amount * checkRate, 2, MidpointRounding.AwayFromZero);
        var endorseDocumentNo = !string.IsNullOrWhiteSpace(entity.CheckNo) ? entity.CheckNo : entity.DocumentNo;
        var endorseDescription = $"Ciro Gelen Çek ({entity.CustomerCode}) - {originalCustomerName}";

        if (targetIsSupplier)
        {
            // Tedarikçiye ciro = ona ödeme yapmak; borcumuz azalır (Debit).
            _dbContext.SupplierLedgerEntries.Add(new SupplierLedgerEntry
            {
                SupplierCode = targetCode,
                Date = date,
                DueDate = entity.DueDate,
                Direction = SupplierLedgerEntryDirection.Debit,
                Amount = checkTlAmount,
                CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId),
                CurrencyRate = checkRate,
                CurrencyAmount = entity.Amount,
                DocumentNo = endorseDocumentNo,
                Description = endorseDescription,
                TransactionType = "Müşteri Çeki",
                ReferenceType = SupplierLedgerEntryReferenceType.Manual,
                ReferenceId = entity.Id,
                CreateUser = username,
                CreateTime = now
            });
        }
        else
        {
            _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
            {
                CustomerCode = targetCode,
                Date = date,
                DueDate = entity.DueDate,
                Direction = CustomerLedgerEntryDirection.Debit,
                Amount = checkTlAmount,
                // Ham değil normalize (bkz. AddCheckReceiptLedgerEntry): çeklerin bir kısmı
                // eski 0 (=TL) koduyla duruyor, aynı satırın ödeme alanı ise 1 yazıyordu.
                CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId),
                CurrencyRate = checkRate,
                CurrencyAmount = entity.Amount,
                PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId),
                PaymentCurrencyRate = checkRate,
                PaymentCurrencyAmount = entity.Amount,
                DocumentNo = endorseDocumentNo,
                Description = endorseDescription,
                TransactionType = "Müşteri Çeki",
                ReferenceType = CustomerLedgerEntryReferenceType.Check,
                ReferenceId = entity.Id,
                CreateUser = username,
                CreateTime = now
            });
        }

        // Delete any other duplicate ledger entries for this check if they exist
        var otherLedgers = await _dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check && x.ReferenceId == entity.Id && x.CustomerCode != entity.CustomerCode && x.CustomerCode != targetCode)
            .ToListAsync(cancellationToken);
        if (otherLedgers.Any())
        {
            _dbContext.CustomerLedgerEntries.RemoveRange(otherLedgers);
        }

        // Cek hangi hesapta duruyorsa banka hareketi ona gore yazilir/silinir/guncellenir.
        await CekHesapHareketiniEsitleAsync(entity, date, username, now, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/return")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> Return([FromRoute] int id, [FromBody] CustomerCheckActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.CustomerChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != CustomerCheckStatus.Portfolio)
        {
            return BadRequest(new { success = false, message = "Çek portföye alınmadan iade edilemez" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var prevTargetCustomer = entity.CurrentCustomerCode;
        var ledgerCustomerCode = !string.IsNullOrWhiteSpace(prevTargetCustomer)
            ? prevTargetCustomer
            : entity.CustomerCode;

        entity.Status = CustomerCheckStatus.Returned;
        entity.CurrentBankAccountDefinitionId = null;
        entity.CurrentCustomerCode = null;
        entity.EditUser = username;
        entity.EditTime = now;

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.CustomerCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.Return,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = request.BankAccountDefinitionId,
            TargetCustomerCode = prevTargetCustomer,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        });

        // Post a Debit entry to original customer's ledger to balance out the payment
        // Ters kayıt GİRİŞ kuruyla atılır; güncel kur TL çapasında kur farkı kadar
        // hayali bakiye bırakıyordu.
        var checkRate = await ResolveOriginalCheckRateAsync(entity, cancellationToken);
        var checkTlAmount = Math.Round(entity.Amount * checkRate, 2, MidpointRounding.AwayFromZero);

        _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
        {
            CustomerCode = entity.CustomerCode,
            Date = date,
            DueDate = entity.DueDate,
            Direction = CustomerLedgerEntryDirection.Debit,
            Amount = checkTlAmount,
            // Ham değil normalize (bkz. AddCheckReceiptLedgerEntry): çeklerin bir kısmı
            // eski 0 (=TL) koduyla duruyor, aynı satırın ödeme alanı ise 1 yazıyordu.
            CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId),
            CurrencyRate = checkRate,
            CurrencyAmount = entity.Amount,
            PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId),
            PaymentCurrencyRate = checkRate,
            PaymentCurrencyAmount = entity.Amount,
            DocumentNo = !string.IsNullOrWhiteSpace(entity.CheckNo) ? entity.CheckNo : entity.DocumentNo,
            Description = "Çek İade",
            TransactionType = "Müşteri Çeki",
            DeliveryCustomerCode = null,
            ReferenceType = CustomerLedgerEntryReferenceType.Check,
            ReferenceId = entity.Id,
            CreateUser = username,
            CreateTime = now
        });

        // Cek hangi hesapta duruyorsa banka hareketi ona gore yazilir/silinir/guncellenir.
        await CekHesapHareketiniEsitleAsync(entity, date, username, now, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/dishonor")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> Dishonor([FromRoute] int id, [FromBody] CustomerCheckActionRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.CustomerChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != CustomerCheckStatus.Portfolio)
        {
            return BadRequest(new { success = false, message = "Çek portföye alınmadan karşılıksız yapılamaz" });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();
        var date = NormalizeUtc(request.Date);

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var prevTargetCustomer = entity.CurrentCustomerCode;
        var ledgerCustomerCode = !string.IsNullOrWhiteSpace(prevTargetCustomer)
            ? prevTargetCustomer
            : entity.CustomerCode;

        entity.Status = CustomerCheckStatus.Dishonored;
        entity.CurrentBankAccountDefinitionId = null;
        // İade (`Return`) dalı bunu sıfırlıyor, karşılıksız dalı atlamıştı: karşılıksız çıkan
        // çek sorgulandığında hâlâ ciro edildiği carinin elinde görünüyordu.
        entity.CurrentCustomerCode = null;
        entity.EditUser = username;
        entity.EditTime = now;

        _dbContext.CheckOperations.Add(new CheckOperation
        {
            DocumentType = CheckDocumentType.CustomerCheck,
            DocumentId = entity.Id,
            Date = date,
            Type = CheckOperationType.Dishonor,
            Amount = entity.Amount,
            CurrencyTypeId = entity.CurrencyTypeId,
            BankAccountDefinitionId = request.BankAccountDefinitionId,
            TargetCustomerCode = prevTargetCustomer,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        });

        // Post a Debit entry to original customer's ledger to balance out the payment
        // Ters kayıt GİRİŞ kuruyla atılır (bkz. ResolveOriginalCheckRateAsync).
        var checkRate = await ResolveOriginalCheckRateAsync(entity, cancellationToken);
        var checkTlAmount = Math.Round(entity.Amount * checkRate, 2, MidpointRounding.AwayFromZero);

        _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
        {
            CustomerCode = entity.CustomerCode,
            Date = date,
            DueDate = entity.DueDate,
            Direction = CustomerLedgerEntryDirection.Debit,
            Amount = checkTlAmount,
            // Ham değil normalize (bkz. AddCheckReceiptLedgerEntry): çeklerin bir kısmı
            // eski 0 (=TL) koduyla duruyor, aynı satırın ödeme alanı ise 1 yazıyordu.
            CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId),
            CurrencyRate = checkRate,
            CurrencyAmount = entity.Amount,
            PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId),
            PaymentCurrencyRate = checkRate,
            PaymentCurrencyAmount = entity.Amount,
            DocumentNo = !string.IsNullOrWhiteSpace(entity.CheckNo) ? entity.CheckNo : entity.DocumentNo,
            Description = "Çek Karşılıksız",
            TransactionType = "Müşteri Çeki",
            DeliveryCustomerCode = null,
            ReferenceType = CustomerLedgerEntryReferenceType.Check,
            ReferenceId = entity.Id,
            CreateUser = username,
            CreateTime = now
        });

        // Cek hangi hesapta duruyorsa banka hareketi ona gore yazilir/silinir/guncellenir.
        await CekHesapHareketiniEsitleAsync(entity, date, username, now, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPut("{id:int}")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] CreateCustomerCheckRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var entity = await _dbContext.CustomerChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != CustomerCheckStatus.Portfolio)
        {
            return BadRequest(new { success = false, message = "Sadece portföydeki çekler düzenlenebilir" });
        }

        if (request.EndorsementType == CustomerCheckEndorsementType.Endorsed)
        {
            if (string.IsNullOrWhiteSpace(request.OriginalDebtorName))
            {
                return BadRequest(new { success = false, message = "Ciro seçildiğinde Asıl Borçlu zorunludur" });
            }
        }

        var customerName = string.Empty;
        var isSupplierCari = false;
        var customer = await _dbContext.Customers
            .AsNoTracking()
            .Select(x => new { x.CustomerCode, x.Name })
            .FirstOrDefaultAsync(x => x.CustomerCode == request.CustomerCode, cancellationToken);
        if (customer != null)
        {
            customerName = customer.Name;
        }
        else
        {
            var supplier = await _dbContext.Suppliers
                .AsNoTracking()
                .Select(x => new { x.SupplierCode, x.FullName })
                .FirstOrDefaultAsync(x => x.SupplierCode == request.CustomerCode, cancellationToken);
            if (supplier != null)
            {
                customerName = supplier.FullName;
                isSupplierCari = true;
            }
            else
            {
                return BadRequest(new { success = false, message = "Cari bulunamadı" });
            }
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        entity.CustomerCode = request.CustomerCode.Trim();
        entity.IssueDate = NormalizeUtc(request.IssueDate);
        entity.DueDate = NormalizeUtc(request.DueDate);
        entity.Amount = request.Amount;
        entity.CurrencyTypeId = request.CurrencyTypeId;
        entity.EndorsementType = request.EndorsementType;
        entity.BankName = string.IsNullOrWhiteSpace(request.BankName) ? null : request.BankName.Trim();
        entity.BranchName = string.IsNullOrWhiteSpace(request.BranchName) ? null : request.BranchName.Trim();
        entity.DistrictName = string.IsNullOrWhiteSpace(request.DistrictName) ? null : request.DistrictName.Trim();
        entity.CheckNo = string.IsNullOrWhiteSpace(request.CheckNo) ? null : request.CheckNo.Trim();
        entity.OriginalDebtorName = request.EndorsementType == CustomerCheckEndorsementType.Original
            ? customerName
            : (string.IsNullOrWhiteSpace(request.OriginalDebtorName) ? null : request.OriginalDebtorName.Trim());
        entity.OriginalIdentityNo = string.IsNullOrWhiteSpace(request.OriginalIdentityNo) ? null : request.OriginalIdentityNo.Trim();
        entity.OriginalTaxNo = string.IsNullOrWhiteSpace(request.OriginalTaxNo) ? null : request.OriginalTaxNo.Trim();
        entity.EditTime = now;
        entity.EditUser = username;

        var checkRate = request.CurrencyRate.HasValue && request.CurrencyRate.Value > 0m
            ? request.CurrencyRate.Value
            : await ResolveCheckRateAsync(entity.CurrencyTypeId, cancellationToken);
        var checkTlAmount = Math.Round(entity.Amount * checkRate, 2, MidpointRounding.AwayFromZero);

        var ledgers = await _dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check
                && x.ReferenceId == id
                && x.TransactionType == "Müşteri Çeki")
            .ToListAsync(cancellationToken);
        if (ledgers.Count > 0) _dbContext.CustomerLedgerEntries.RemoveRange(ledgers);

        var supplierLedgers = await _dbContext.SupplierLedgerEntries
            .Where(x => x.ReferenceId == id && x.TransactionType == "Müşteri Çeki")
            .ToListAsync(cancellationToken);
        if (supplierLedgers.Count > 0) _dbContext.SupplierLedgerEntries.RemoveRange(supplierLedgers);

        AddCheckReceiptLedgerEntry(isSupplierCari, entity, checkRate, checkTlAmount, "Çek Girişi", username, now);

        var op = await _dbContext.CheckOperations
            .FirstOrDefaultAsync(x => x.DocumentType == CheckDocumentType.CustomerCheck && x.DocumentId == entity.Id && x.Type == CheckOperationType.Create, cancellationToken);
        if (op != null)
        {
            op.Date = entity.IssueDate;
            op.Amount = entity.Amount;
            op.CurrencyTypeId = entity.CurrencyTypeId;
            op.EditTime = now;
            op.EditUser = username;
        }

        // Cek duzenlendi (tutar/vade degismis olabilir): hesaptaki satir da guncellenir.
        // Cek bir hesapta degilse bu cagri hicbir sey yapmaz.
        await CekHesapHareketiniEsitleAsync(entity, entity.IssueDate, username, now, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = entity.Id } });
    }

    /// <summary>
    /// GERİYE DÖNÜK: hâlihazırda bir bankada duran çekler için eksik banka hareketlerini yazar.
    /// </summary>
    /// <remarks>
    /// (2026-08-24) Çek→banka hareketi bugün eklendi; ondan ÖNCE bankaya verilmiş çeklerin
    /// hesapta karşılığı yok. Bu uç, teminatta ya da tahsilde duran her çek için aynı
    /// eşitleme fonksiyonunu çağırır — elle SQL yazmak yerine, çünkü tutar/kur/para birimi
    /// çevrimi orada zaten sınanmış hâlde duruyor ve iki ayrı yazım biçimi ayrışırdı.
    ///
    /// ETKİSİZDİR: birden çok kez çalıştırmak satır çoğaltmaz. `onizleme=true` ile hiçbir şey
    /// yazmadan ne olacağını gösterir.
    /// </remarks>
    [HttpPost("backfill-bank-movements")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> BackfillBankMovements([FromQuery] bool onizleme = true, CancellationToken cancellationToken = default)
    {
        var bankadakiler = await _dbContext.CustomerChecks
            .Where(x => (x.Status == CustomerCheckStatus.EndorsedToBankAsGuarantee
                         || x.Status == CustomerCheckStatus.EndorsedToBankForCollection)
                        && x.CurrentBankAccountDefinitionId != null)
            .ToListAsync(cancellationToken);

        var mevcutCekIdler = await _dbContext.BankAccountTransactions
            .Where(x => x.CheckId != null)
            .Select(x => x.CheckId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);

        var eksikler = bankadakiler.Where(x => !mevcutCekIdler.Contains(x.Id)).ToList();

        if (onizleme)
        {
            return Ok(new
            {
                success = true,
                data = new
                {
                    bankadaDuranCek = bankadakiler.Count,
                    hareketiOlan = bankadakiler.Count - eksikler.Count,
                    yazilacak = eksikler.Count,
                    kalemler = eksikler.Select(x => new
                    {
                        x.Id,
                        x.DocumentNo,
                        x.CustomerCode,
                        x.Amount,
                        x.CurrencyTypeId,
                        HesapId = x.CurrentBankAccountDefinitionId,
                        Durum = (int)x.Status
                    }).ToList()
                }
            });
        }

        var now = DateTime.UtcNow;
        var username = GetUsernameOrSystem();

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var yazilan = 0;
        foreach (var cek in eksikler)
        {
            try
            {
                // Hareketin tarihi çekin KENDİ düzenleme tarihi: geriye dönük yazılan satır
                // bugünün tarihiyle görünürse banka ekstresi geçmişi yanlış anlatır.
                await CekHesapHareketiniEsitleAsync(cek, cek.IssueDate, username, now, cancellationToken);
                yazilan++;
            }
            catch (InvalidOperationException ex)
            {
                await trx.RollbackAsync(cancellationToken);
                return StatusCode(503, new { success = false, message = $"Cek {cek.DocumentNo}: {ex.Message}" });
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { yazilan } });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("check", "customerCheck")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.CustomerChecks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, entity, "deleteRule/musteriCeki", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        // GENEL AYARLAR — SİLME KİLİT TARİHİ.
        //
        // Bu belge de kasa/banka ve stok bakiyelerini etkiliyor ama kilit kontrolü yalnız
        // faturalarda vardı (tahsil edilmiş bir çek silinerek geçmiş dönem sessizce bozulabiliyordu).
        // Kilit tarihi ÖNTANIMLI NULL'dır: ayarlanmadıysa davranış birebir aynı kalır,
        // ayarlandıysa kullanıcının açık talimatı bu belgeyi de kapsar.
        var deleteLockDate = await _dbContext.Set<JwtSessionSetting>()
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => x.InvoiceDeleteLockDate)
            .FirstOrDefaultAsync(cancellationToken);

        if (deleteLockDate.HasValue && entity.IssueDate.Date < deleteLockDate.Value.Date)
        {
            return BadRequest(new { success = false, message = $"Belge tarihi ({entity.IssueDate:dd.MM.yyyy}), Genel Ayarlar'daki silme kilit tarihinden ({deleteLockDate.Value:dd.MM.yyyy}) önce olduğu için silinemez." });
        }

        if (entity.Status != CustomerCheckStatus.Portfolio)
        {
            return BadRequest(new { success = false, message = "Sadece portföydeki çekler silinebilir" });
        }

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var ops = await _dbContext.CheckOperations
            .Where(x => x.DocumentType == CheckDocumentType.CustomerCheck && x.DocumentId == id)
            .ToListAsync(cancellationToken);

        if (ops.Count > 0) _dbContext.CheckOperations.RemoveRange(ops);

        // `ReferenceType = Check` borç çekiyle ORTAK ve id dizileri ayrı olduğu için çakışır;
        // TransactionType olmadan aynı numaralı BORÇ çekinin satırı da siliniyordu.
        var ledgers = await _dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Check
                && x.ReferenceId == id
                && x.TransactionType == "Müşteri Çeki")
            .ToListAsync(cancellationToken);

        if (ledgers.Count > 0) _dbContext.CustomerLedgerEntries.RemoveRange(ledgers);

        // Çek girişi TEDARİKÇİ carisinden de yapılabiliyor (o zaman satır SupplierLedgerEntries'e
        // yazılıyor); silme yalnız müşteri defterine bakıyordu ve tedarikçi ekstresinde yetim
        // satır kalıyordu.
        var supplierLedgers = await _dbContext.SupplierLedgerEntries
            .Where(x => x.ReferenceId == id && x.TransactionType == "Müşteri Çeki")
            .ToListAsync(cancellationToken);

        if (supplierLedgers.Count > 0) _dbContext.SupplierLedgerEntries.RemoveRange(supplierLedgers);

        // SİLME İZİ (kullanıcı kararı, 2026-08-17). Çek silindiğinde kimin sildiği hiçbir yerde
        // kalmıyordu; belge tutarı, cari ve vade dahil yedeği `DetailsJson`da tutuluyor ki
        // "Silinen Kayıtlar" ekranından hem kim sildiği hem ne silindiği görülebilsin.
        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "check",
            PageKey = "customerCheck",
            RecordType = "MusteriCeki",
            RecordId = entity.Id.ToString(),
            Description = $"Müşteri çeki silindi: {entity.CheckNo ?? entity.DocumentNo} · {entity.Amount:N2} · {entity.CustomerCode}",
            DetailsJson = System.Text.Json.JsonSerializer.Serialize(new
            {
                entity.Id,
                entity.CheckNo,
                entity.DocumentNo,
                entity.CustomerCode,
                entity.Amount,
                entity.CurrencyTypeId,
                entity.IssueDate,
                entity.DueDate,
                entity.BankName,
                entity.Status
            }),
            CreateUser = GetUsernameOrSystem(),
            CreateTime = DateTime.UtcNow
        });

        // Cek siliniyor: hesaptaki giris satiri da gider. `CekHesapHareketiniEsitleAsync`
        // burada kullanilamaz — kayit siliniyor, durumuna bakmanin anlami yok.
        var silinecekCekHareketleri = await _dbContext.BankAccountTransactions
            .Where(x => x.CheckId == entity.Id)
            .ToListAsync(cancellationToken);
        if (silinecekCekHareketleri.Count > 0)
        {
            _dbContext.BankAccountTransactions.RemoveRange(silinecekCekHareketleri);
        }

        _dbContext.CustomerChecks.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
