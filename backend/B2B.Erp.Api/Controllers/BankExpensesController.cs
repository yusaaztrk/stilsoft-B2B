using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Core.Http;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// BANKA MASRAF HESAPLARI — her banka hesabının kendi masraf defteri (2026-08-20).
///
/// <para>
/// <b>Neden yeniden yazıldı.</b> Önceki POS masrafı ekranı bütün bankaların masraflarını
/// <c>Amount</c> (TL çapası) üzerinden topluyordu; dolar hesabın 10 $'lık masrafı ile TL
/// hesabın 10 ₺'lik masrafı aynı sütunda toplanıyordu. Üstüne masraf satırı Havale/EFT
/// yolunda SABİT TL damgalanıyordu, yani dövizli hesabın masrafı o hesabın ekstresinde
/// hiç görünmüyordu. Kullanıcının gördüğü "masraflar bozuk, gözükmüyor" tam olarak buydu.
/// </para>
///
/// <para>
/// <b>Kural: masraf, ait olduğu hesabın para birimindedir.</b> 1.500 $'lık aktarımın
/// 10 $'lık masrafı, paranın çıktığı dolar hesabında 10 $ olarak durur. TL karşılığı
/// (<c>Amount</c>) yalnızca çapadır; toplam raporu için kullanılır, masrafın kendisi
/// değildir. Farklı para birimleri ASLA tek toplama indirilmez — her para birimi kendi
/// kovasında yürür (bkz. döviz mimarisi: vektör bakiye).
/// </para>
///
/// <para>
/// <b>Tablo eklenmedi.</b> Masraf hesaptan çıkan gerçek paradır; ayrı tabloya yazılsaydı
/// banka bakiyesi ile masraf listesi iki ayrı kaynaktan gelir ve ayrışırdı. Satır yine
/// <c>BankAccountTransactions</c> içinde bir ÇIKIŞ hareketidir, yalnızca
/// <see cref="BankAccountTransaction.ExpenseType"/> ile hangi masraf hesabına ait olduğu
/// damgalanır.
/// </para>
///
/// <para>
/// Sayfa yetkisi <c>bank/bankaMasraflari</c>: kullanıcı kararıyla yalnız Yönetim ve
/// SuperAdmin rollerine seed ediliyor; SSA zaten claim'i ile bütün sayfa kontrollerini
/// geçer (bkz. <c>BankExpenseSchema</c>).
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class BankExpensesController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly IMoneyServiceClient _money;

    public BankExpensesController(AppDbContext dbContext, IMoneyServiceClient money)
    {
        _dbContext = dbContext;
        _money = money;
    }

    private const string ModuleKey = "bank";
    private const string PageKey = "bankaMasraflari";

    /// <summary>Ekranda gösterilecek masraf türleri; sıra ekrandaki sıradır.</summary>
    private static readonly (int Value, string Name)[] ExpenseTypes =
    {
        ((int)BankExpenseType.PosFee, "POS Masrafı"),
        ((int)BankExpenseType.LoanUsageFee, "Kredi Kullanım Masrafı"),
        ((int)BankExpenseType.TransferFee, "Havale/EFT Masrafı"),
        ((int)BankExpenseType.AccountFee, "Hesap İşletim Ücreti"),
        ((int)BankExpenseType.Other, "Diğer Banka Masrafı")
    };

    private static string ExpenseTypeName(int value)
    {
        foreach (var t in ExpenseTypes)
        {
            if (t.Value == value) return t.Name;
        }

        // Bilinmeyen tür sessizce yutulmaz: ekranda kimliğiyle görünsün ki veri kaymışsa
        // fark edilsin. Boş metin döndürmek satırı "adsız masraf" yapardı.
        return $"Masraf ({value})";
    }

    /// <summary>
    /// Kullanıcıya atanmış banka hesapları; <c>null</c> = kısıt yok (süper admin / SSA).
    /// Diğer banka denetleyicilerindeki kuralın aynısı — masraf ekranı bankadan bankaya
    /// farklı bir görünürlük kuralı uygulasaydı aynı hesap iki ekranda iki türlü görünürdü.
    /// </summary>
    private async Task<List<int>?> GetUserAssignedBankAccountIdsAsync(CancellationToken cancellationToken)
    {
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1" || User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (isSuperAdmin) return null;

        var username = User.Identity?.Name;
        if (string.IsNullOrWhiteSpace(username)) return null;

        var u = await _dbContext.Users
            .AsNoTracking()
            .Include(x => x.UserBankAccounts)
            .FirstOrDefaultAsync(x => x.Username == username, cancellationToken);

        if (u is null) return new List<int>();

        var ids = u.UserBankAccounts.Select(x => x.BankAccountId).Distinct().ToList();
        if (u.DefaultBankAccountId.HasValue && !ids.Contains(u.DefaultBankAccountId.Value))
        {
            ids.Add(u.DefaultBankAccountId.Value);
        }

        // HİÇ ATAMA YOKSA KISIT DA YOK.
        //
        // Boş liste ile süzülürse ekran BOŞ açılır ve kullanıcı yine "masraflar gözükmüyor"
        // der — oysa yetkisi olan bir kullanıcının hiç banka ataması olmaması normaldir
        // (atama, Havale/EFT ekranında kimin hangi hesaba işlem yapacağını sınırlamak için
        // konmuştu, raporu gizlemek için değil). Sayfanın kendisi zaten iki role kapalı.
        return ids.Count == 0 ? null : ids;
    }

    private static DateTime? StartUtc(DateTime? d)
        => d.HasValue ? DateTime.SpecifyKind(d.Value.Date, DateTimeKind.Utc) : null;

    private static DateTime? EndUtc(DateTime? d)
        => d.HasValue ? DateTime.SpecifyKind(d.Value.Date, DateTimeKind.Utc).AddDays(1).AddTicks(-1) : null;

    private IQueryable<BankAccountTransaction> ExpenseQuery(
        List<int>? allowedBankIds,
        int? bankAccountDefinitionId,
        int? expenseType,
        DateTime? startDate,
        DateTime? endDate)
    {
        // ExpenseType > 0 tek süzgeç: eski satırlar açılışta damgalandığı için
        // (bkz. BankExpenseSchema backfill) `IsPosFee` ayrıca sorulmaz.
        var q = _dbContext.BankAccountTransactions.AsNoTracking().Where(x => x.ExpenseType > 0);

        if (allowedBankIds != null) q = q.Where(x => allowedBankIds.Contains(x.BankAccountDefinitionId));
        if (bankAccountDefinitionId is int id && id > 0) q = q.Where(x => x.BankAccountDefinitionId == id);
        if (expenseType is int t && t > 0) q = q.Where(x => x.ExpenseType == t);

        var s = StartUtc(startDate);
        var e = EndUtc(endDate);
        if (s.HasValue) q = q.Where(x => x.Date >= s.Value);
        if (e.HasValue) q = q.Where(x => x.Date <= e.Value);

        return q;
    }

    public sealed class ExpenseBucketDto
    {
        public int BankAccountDefinitionId { get; set; }
        public int ExpenseType { get; set; }
        public string ExpenseTypeName { get; set; } = string.Empty;
        public int CurrencyTypeId { get; set; }
        public string CurrencyCode { get; set; } = string.Empty;
        /// <summary>Brüt masraf, HESABIN para biriminde.</summary>
        public decimal Gross { get; set; }
        public decimal Bsmv { get; set; }
        public decimal Vat { get; set; }
        /// <summary>Brütten vergiler düşülmüş çıplak komisyon.</summary>
        public decimal Net { get; set; }
        /// <summary>TL çapası — yalnız genel toplam için; masrafın kendisi <see cref="Gross"/>.</summary>
        public decimal TryAmount { get; set; }
        public int Count { get; set; }
    }

    /// <summary>
    /// Soldaki banka listesi + her hesabın masraf kırılımı tek istekte.
    ///
    /// <para>
    /// Hesaplar masrafı OLMAYANLARLA BİRLİKTE dönüyor: sol liste bir seçicidir, boş hesabın
    /// listeden düşmesi "o hesabın masrafı yok" ile "o hesap yok"u ayırt edilemez yapardı.
    /// </para>
    /// </summary>
    [HttpGet("overview")]
    [AuthorizePage(ModuleKey, PageKey)]
    public async Task<IActionResult> Overview(
        [FromQuery] DateTime? startDate,
        [FromQuery] DateTime? endDate,
        [FromQuery] int? expenseType,
        CancellationToken cancellationToken = default)
    {
        var allowedBankIds = await GetUserAssignedBankAccountIdsAsync(cancellationToken);

        var accountsQuery = _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Include(x => x.BankDetail)
            .AsQueryable();

        if (allowedBankIds != null) accountsQuery = accountsQuery.Where(x => allowedBankIds.Contains(x.Id));

        var accounts = await accountsQuery
            .OrderBy(x => x.AccountName)
            .Select(x => new
            {
                x.Id,
                x.AccountCode,
                x.AccountName,
                x.AccountNo,
                x.CurrencyTypeId,
                BankName = x.BankDetail != null ? x.BankDetail.Name : string.Empty
            })
            .ToListAsync(cancellationToken);

        var rows = await ExpenseQuery(allowedBankIds, null, expenseType, startDate, endDate)
            .Select(x => new
            {
                x.BankAccountDefinitionId,
                x.ExpenseType,
                x.CurrencyTypeId,
                x.Amount,
                x.CurrencyAmount,
                x.PosFeeBsmvAmount,
                x.PosFeeVatAmount
            })
            .ToListAsync(cancellationToken);

        // Gruplama bellekte: 0 ile 1'i tek TL kovasında toplamak (CurrencyTypeHelper.Normalize)
        // SQL'e çevrilemiyor, ayrı bırakılırsa aynı hesap iki TL satırı gösterirdi.
        var buckets = rows
            .GroupBy(x => new
            {
                x.BankAccountDefinitionId,
                x.ExpenseType,
                CurrencyTypeId = CurrencyTypeHelper.Normalize(x.CurrencyTypeId)
            })
            .Select(g =>
            {
                // ESKİ SATIR KORUMASI: `CurrencyAmount` boş kalmış kayıtlarda tutar
                // `Amount`tadır (TL). Sıfır kabul edilseydi o masraf toplamdan düşerdi.
                var gross = g.Sum(x => x.CurrencyAmount > 0 ? x.CurrencyAmount : x.Amount);
                var bsmv = g.Sum(x => x.PosFeeBsmvAmount);
                var vat = g.Sum(x => x.PosFeeVatAmount);

                return new ExpenseBucketDto
                {
                    BankAccountDefinitionId = g.Key.BankAccountDefinitionId,
                    ExpenseType = g.Key.ExpenseType,
                    ExpenseTypeName = ExpenseTypeName(g.Key.ExpenseType),
                    CurrencyTypeId = g.Key.CurrencyTypeId,
                    CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(g.Key.CurrencyTypeId),
                    Gross = gross,
                    Bsmv = bsmv,
                    Vat = vat,
                    Net = gross - bsmv - vat,
                    TryAmount = g.Sum(x => x.Amount),
                    Count = g.Count()
                };
            })
            .OrderBy(x => x.BankAccountDefinitionId)
            .ThenBy(x => x.ExpenseType)
            .ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                accounts = accounts.Select(a => new
                {
                    id = a.Id,
                    accountCode = a.AccountCode,
                    accountName = a.AccountName,
                    accountNo = a.AccountNo,
                    bankName = a.BankName,
                    currencyTypeId = CurrencyTypeHelper.Normalize(a.CurrencyTypeId),
                    currencyCode = CurrencyTypeHelper.ToCodeOrTry(a.CurrencyTypeId)
                }),
                buckets,
                expenseTypes = ExpenseTypes.Select(t => new { value = t.Value, name = t.Name })
            }
        });
    }

    /// <summary>Seçili hesabın (ya da hepsinin) masraf satırları.</summary>
    [HttpGet]
    [AuthorizePage(ModuleKey, PageKey)]
    public async Task<IActionResult> List(
        [FromQuery] int? bankAccountDefinitionId,
        [FromQuery] int? expenseType,
        [FromQuery] DateTime? startDate,
        [FromQuery] DateTime? endDate,
        [FromQuery] int take = 500,
        CancellationToken cancellationToken = default)
    {
        take = Math.Max(1, Math.Min(2000, take));

        var allowedBankIds = await GetUserAssignedBankAccountIdsAsync(cancellationToken);
        var q = ExpenseQuery(allowedBankIds, bankAccountDefinitionId, expenseType, startDate, endDate);

        var raw = await (
                from tx in q
                join acc in _dbContext.BankAccountDefinitions.AsNoTracking()
                    on tx.BankAccountDefinitionId equals acc.Id
                orderby tx.Date descending, tx.CreateTime descending, tx.Id descending
                select new
                {
                    tx.Id,
                    tx.BankAccountDefinitionId,
                    acc.AccountCode,
                    acc.AccountName,
                    tx.Date,
                    tx.ExpenseType,
                    tx.ExpenseLoanId,
                    tx.CurrencyTypeId,
                    tx.CurrencyRate,
                    tx.CurrencyAmount,
                    tx.Amount,
                    tx.PosFeeBsmvRate,
                    tx.PosFeeVatRate,
                    tx.PosFeeBsmvAmount,
                    tx.PosFeeVatAmount,
                    tx.DocumentNo,
                    tx.Description,
                    tx.CounterpartyName,
                    tx.CreateUser
                })
            .Take(take)
            .ToListAsync(cancellationToken);

        var loanIds = raw.Where(x => x.ExpenseLoanId.HasValue).Select(x => x.ExpenseLoanId!.Value).Distinct().ToList();
        var loanCodes = loanIds.Count == 0
            ? new Dictionary<int, string>()
            : await _dbContext.Set<Loan>()
                .AsNoTracking()
                .Where(l => loanIds.Contains(l.Id))
                .ToDictionaryAsync(l => l.Id, l => l.LoanCode, cancellationToken);

        var data = raw.Select(x =>
        {
            var gross = x.CurrencyAmount > 0 ? x.CurrencyAmount : x.Amount;
            return new
            {
                id = x.Id,
                bankAccountDefinitionId = x.BankAccountDefinitionId,
                bankAccountCode = x.AccountCode,
                bankAccountName = x.AccountName,
                date = x.Date,
                expenseType = x.ExpenseType,
                expenseTypeName = ExpenseTypeName(x.ExpenseType),
                loanId = x.ExpenseLoanId,
                loanCode = x.ExpenseLoanId.HasValue && loanCodes.TryGetValue(x.ExpenseLoanId.Value, out var lc) ? lc : null,
                currencyTypeId = CurrencyTypeHelper.Normalize(x.CurrencyTypeId),
                currencyCode = CurrencyTypeHelper.ToCodeOrTry(x.CurrencyTypeId),
                currencyRate = x.CurrencyRate,
                // Brüt = hesaptan düşen tutar, HESABIN para biriminde.
                gross,
                bsmvRate = x.PosFeeBsmvRate,
                vatRate = x.PosFeeVatRate,
                bsmv = x.PosFeeBsmvAmount,
                vat = x.PosFeeVatAmount,
                net = gross - x.PosFeeBsmvAmount - x.PosFeeVatAmount,
                tryAmount = x.Amount,
                documentNo = x.DocumentNo,
                description = x.Description,
                counterpartyName = x.CounterpartyName,
                createUser = x.CreateUser
            };
        }).ToList();

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// Kredi kullanım masrafı girilirken seçilecek krediler.
    ///
    /// <para>
    /// Kredi listesi <c>LoansController</c>'da da var ama orası <c>bank/krediler</c>
    /// sayfasına bağlı: masraf sayfasına yetkili ama kredi sayfasına yetkisiz bir kullanıcı
    /// 403 alır ve seçici sessizce boş kalırdı. Bu uç masraf sayfasının kendi yetkisiyle
    /// çalışır ve yalnız seçim için gereken üç alanı döner.
    /// </para>
    /// </summary>
    [HttpGet("loans")]
    [AuthorizePage(ModuleKey, PageKey)]
    public async Task<IActionResult> Loans(
        [FromQuery] int? bankAccountDefinitionId,
        CancellationToken cancellationToken = default)
    {
        var q = _dbContext.Set<Loan>().AsNoTracking().Where(x => x.CancelledAt == null);
        if (bankAccountDefinitionId is int id && id > 0) q = q.Where(x => x.BankAccountDefinitionId == id);

        var data = await q
            .OrderByDescending(x => x.StartDate)
            .Select(x => new
            {
                id = x.Id,
                loanCode = x.LoanCode,
                contractNo = x.ContractNo,
                bankAccountDefinitionId = x.BankAccountDefinitionId,
                principalAmount = x.PrincipalAmount,
                currencyTypeId = x.CurrencyTypeId
            })
            .Take(500)
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    public sealed class CreateBankExpenseRequest
    {
        [Required]
        public int BankAccountDefinitionId { get; set; }

        public DateTime Date { get; set; }

        /// <summary>Bkz. <see cref="BankExpenseType"/>. 0 kabul edilmez.</summary>
        [Required]
        public int ExpenseType { get; set; }

        /// <summary>
        /// BRÜT masraf, HESABIN PARA BİRİMİNDE. Dolar hesaba 10 $ masraf giriliyorsa 10.
        ///
        /// <para>
        /// Havale/EFT ekranı masrafı TL girip sunucuda çeviriyor; burası bilerek TERSİ:
        /// kullanıcı bankasının ekstresine bakıp orada gördüğü tutarı yazar, ekstre de
        /// hesabın kendi parasındadır. TL'ye çevirme kur ile burada yapılır.
        /// </para>
        /// </summary>
        public decimal Amount { get; set; }

        /// <summary>1 hesap parası = X ₺. Verilmezse günün kuru çekilir; TL hesapta 1.</summary>
        public decimal CurrencyRate { get; set; }

        /// <summary>BSMV oranı, yüzde (5 = %5). 0 = ayrıştırma yok.</summary>
        public decimal? BsmvRate { get; set; }

        /// <summary>KDV oranı, yüzde (20 = %20). 0 = ayrıştırma yok.</summary>
        public decimal? VatRate { get; set; }

        public string? Description { get; set; }

        /// <summary>Kredi kullanım masrafında ilgili kredi; diğer türlerde yok sayılır.</summary>
        public int? LoanId { get; set; }
    }

    /// <summary>
    /// Masrafı elle işler (kullanıcı kararı: "masraf kaydını bizde işleyebiliriz").
    ///
    /// <para>
    /// Satır normal bir ÇIKIŞ hareketidir: banka bakiyesinden düşer. Masrafı bakiyeden
    /// düşmeyen bir "not" olarak yazmak, ekranda masraf gösterip bankayla tutmayan bir
    /// bakiye bırakırdı.
    /// </para>
    /// </summary>
    [HttpPost]
    [AtomicRequest]
    [AuthorizePage(ModuleKey, PageKey)]
    public async Task<IActionResult> Create([FromBody] CreateBankExpenseRequest request, CancellationToken cancellationToken)
    {
        if (request is null) return BadRequest(new { success = false, message = "Geçersiz istek" });
        if (request.BankAccountDefinitionId <= 0) return BadRequest(new { success = false, message = "Banka hesabı seçilmelidir" });
        if (request.Amount <= 0) return BadRequest(new { success = false, message = "Masraf tutarı sıfırdan büyük olmalıdır" });

        if (!Enum.IsDefined(typeof(BankExpenseType), request.ExpenseType)
            || request.ExpenseType == (int)BankExpenseType.None)
        {
            return BadRequest(new { success = false, message = "Geçersiz masraf türü" });
        }

        var allowedBankIds = await GetUserAssignedBankAccountIdsAsync(cancellationToken);
        if (allowedBankIds != null && !allowedBankIds.Contains(request.BankAccountDefinitionId))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Bu banka hesabına yetkiniz yok" });
        }

        var account = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == request.BankAccountDefinitionId, cancellationToken);

        if (account is null) return NotFound(new { success = false, message = "Banka hesabı bulunamadı" });

        var accountCurrencyTypeId = CurrencyTypeHelper.Normalize(account.CurrencyTypeId);

        // KUR: "1 hesap parası = X ₺" — yönü asla ters saklanmaz (bkz. döviz mimarisi).
        decimal tryRate;
        if (CurrencyTypeHelper.IsTry(accountCurrencyTypeId))
        {
            tryRate = 1m;
        }
        else if (request.CurrencyRate > 0)
        {
            tryRate = request.CurrencyRate;
        }
        else
        {
            var code = CurrencyTypeHelper.ToCode(accountCurrencyTypeId);
            if (string.IsNullOrWhiteSpace(code))
            {
                return BadRequest(new { success = false, message = "Banka hesabının para birimi geçersiz" });
            }

            try
            {
                tryRate = await _money.GetLatestTryRateAsync(code, cancellationToken);
            }
            catch
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
            }

            if (tryRate <= 0)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Kur bilgisi alınamadı. Lütfen kuru elle girin." });
            }
        }

        int? loanId = null;
        if (request.ExpenseType == (int)BankExpenseType.LoanUsageFee && request.LoanId is int lid && lid > 0)
        {
            var loanExists = await _dbContext.Set<Loan>().AsNoTracking().AnyAsync(x => x.Id == lid, cancellationToken);
            if (!loanExists) return BadRequest(new { success = false, message = "Kredi bulunamadı" });
            loanId = lid;
        }

        var now = DateTime.UtcNow;
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var dateUtc = request.Date == default
            ? now
            : (request.Date.Kind == DateTimeKind.Utc ? request.Date : DateTime.SpecifyKind(request.Date, DateTimeKind.Utc));
        var date = DateTime.SpecifyKind(dateUtc.Date + now.TimeOfDay, DateTimeKind.Utc);

        // Brütün içindeki BSMV/KDV — tutarlar hesabın para biriminde, `Amount` ile aynı ölçekte.
        var vergi = PosFeeTaxBreakdown.Split(request.Amount, request.BsmvRate ?? 0m, request.VatRate ?? 0m);

        var typeName = ExpenseTypeName(request.ExpenseType);
        var accountLabel = !string.IsNullOrWhiteSpace(account.AccountName)
            ? account.AccountName.Trim()
            : (account.AccountCode ?? string.Empty).Trim();

        var description = !string.IsNullOrWhiteSpace(request.Description)
            ? request.Description.Trim()
            : $"{typeName}: {accountLabel}";
        if (description.Length > 2000) description = description[..2000];

        var entity = new BankAccountTransaction
        {
            BankAccountDefinitionId = account.Id,
            Date = date,
            Direction = BankAccountTransactionDirection.Out,
            // TL ÇAPASI türetilir, girilmez: kullanıcı hesabın parasında yazar.
            Amount = Math.Round(request.Amount * tryRate, 2, MidpointRounding.AwayFromZero),
            CurrencyTypeId = accountCurrencyTypeId,
            CurrencyRate = tryRate,
            CurrencyAmount = request.Amount,
            CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
            CounterpartyCode = (account.AccountCode ?? string.Empty).Trim(),
            CounterpartyName = accountLabel,
            Description = description,
            // Eski ekranlar ve silme yolu bu bayrağı okuyor; yalnız POS masrafında true.
            IsPosFee = request.ExpenseType == (int)BankExpenseType.PosFee,
            ExpenseType = request.ExpenseType,
            ExpenseLoanId = loanId,
            PosFeeBsmvRate = request.BsmvRate ?? 0m,
            PosFeeVatRate = request.VatRate ?? 0m,
            PosFeeBsmvAmount = vergi.BsmvAmount,
            PosFeeVatAmount = vergi.VatAmount,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.BankAccountTransactions.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id } });
    }

    /// <summary>
    /// Masraf satırını siler. Yalnız MASRAF satırları (<c>ExpenseType &gt; 0</c>) — normal
    /// para hareketleri bu uçtan silinemez, onların kendi silme yolu ayna kaydı ve cari
    /// hareketlerini de temizliyor.
    /// </summary>
    [HttpDelete("{id:int}")]
    [AtomicRequest]
    [AuthorizePage(ModuleKey, PageKey)]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.BankAccountTransactions.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.ExpenseType <= 0)
        {
            return BadRequest(new { success = false, message = "Bu kayıt bir masraf satırı değil; banka hareketleri ekranından silinmelidir." });
        }

        var allowedBankIds = await GetUserAssignedBankAccountIdsAsync(cancellationToken);
        if (allowedBankIds != null && !allowedBankIds.Contains(entity.BankAccountDefinitionId))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Bu banka hesabına yetkiniz yok" });
        }

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, entity, "deleteRule/bankaMasraf", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var backup = new
        {
            entity.Id,
            entity.BankAccountDefinitionId,
            entity.Date,
            entity.Direction,
            entity.Amount,
            entity.CurrencyTypeId,
            entity.CurrencyRate,
            entity.CurrencyAmount,
            entity.ExpenseType,
            entity.ExpenseLoanId,
            entity.IsPosFee,
            entity.PosFeeBsmvRate,
            entity.PosFeeVatRate,
            entity.PosFeeBsmvAmount,
            entity.PosFeeVatAmount,
            entity.CounterpartyCode,
            entity.CounterpartyName,
            entity.DocumentNo,
            entity.Description,
            entity.CreateUser,
            entity.CreateTime
        };

        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = ModuleKey,
            PageKey = PageKey,
            RecordType = "BankaMasrafi",
            RecordId = entity.Id.ToString(),
            ParentType = null,
            ParentId = null,
            Description = $"{ExpenseTypeName(entity.ExpenseType)} silindi: "
                          + $"{entity.CurrencyAmount:N2} {CurrencyTypeHelper.ToCodeOrTry(entity.CurrencyTypeId)} ({entity.Description})",
            DetailsJson = JsonSerializer.Serialize(backup),
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        });

        _dbContext.BankAccountTransactions.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
