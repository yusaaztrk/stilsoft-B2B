using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Claims;
using System.Xml.Linq;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>Ödeme ekranından gelen B2B kaynak seçimi. <c>Kind</c>: 1 kasa, 2 banka.</summary>
public sealed class ErpPaymentSource
{
    public int Kind { get; set; }
    public int AccountId { get; set; }

    /// <summary>1 döviz = kaç TL. Boşsa TCMB döviz satış kuru kullanılır; TL hesapta yok sayılır.</summary>
    public decimal? Rate { get; set; }
}

public sealed record ErpAccountOption(int Kind, int Id, string Name, int CurrencyTypeId, string CurrencyCode, decimal? Rate);

/// <summary>
/// PERSONEL ÖDEMELERİNİN B2B KASA/BANKA TARAFI (2026-09-27 kullanıcı kararı).
///
/// <para>Personel ödemeleri artık B2B'deki kasa ve bankalardan çıkıyor (personel programının kendi
/// kasası yerine). Her ödeme İŞLEMİ için seçilen hesaba TEK satır yazılır: tekil ödemede o ödeme,
/// toplu ödemede TOPLAM. Açıklama "Personel Ödemesi - Maaş 2026-09" gibidir, PERSONEL ADI YAZILMAZ.
/// Personel kırılımı personel programındaki üst kayıt + alt satır yapısında kalır (bkz.
/// <see cref="EmployeeCashService"/>); B2B satırı yalnız ÜST kayda bağlanır.</para>
///
/// <para>Tutar kuralı B2B ile aynı: <c>Amount</c> her zaman TL, <c>CurrencyAmount</c> hesabın KENDİ
/// para biriminde (B2B dövizli hesabın bakiyesini <c>CurrencyAmount</c>'tan okur). Personelin
/// borcu TL olduğu için ödeme TL girilir; dövizli hesapta kur TCMB'den gelir, elle değiştirilebilir.</para>
///
/// <para>Eski yol (<see cref="AccountMovementWriter"/>, <c>EmployeePayments:WriteAccountMovements</c>)
/// KAPALI kalıyor ve bu sınıftan bağımsız: B2B'de artık olmayan <c>ReferenceNo</c> kolonuna ve hiç
/// olmayan <c>ExchangeRates</c> tablosuna bakıyordu, açılsaydı ödeme hata verecekti.</para>
///
/// <para>Satır B2B'de KİLİTLİDİR (B2B düzenleme/silme uçları <c>EmployeeCashTransactions.ErpTransactionId</c>
/// bağına bakıp reddeder). Değişiklik yalnız personel programından yapılır; bu sınıf B2B satırını
/// güncel tutar.</para>
/// </summary>
public sealed class ErpPaymentAccountService
{
    public const int KindCash = 1;
    public const int KindBank = 2;
    public const string CounterpartyLabel = "Personel Ödemesi";

    private static readonly ConcurrentDictionary<string, (decimal Rate, DateTime FetchedUtc)> RateCache = new();
    private static readonly TimeSpan RateCacheTtl = TimeSpan.FromMinutes(30);

    private readonly AppDbContext _dbContext;

    public ErpPaymentAccountService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public static string CurrencyCode(int currencyTypeId) => currencyTypeId switch
    {
        2 => "EUR",
        3 => "USD",
        4 => "GBP",
        _ => "TRY"
    };

    private static int NormalizeCurrency(int currencyTypeId) => currencyTypeId is 2 or 3 or 4 ? currencyTypeId : 1;

    public static string PaymentTypeLabel(int? paymentType) => paymentType switch
    {
        (int)EmployeePaymentType.Salary => "Maaş",
        (int)EmployeePaymentType.Bonus => "Prim",
        (int)EmployeePaymentType.CashAdvance => "Avans",
        (int)EmployeePaymentType.Meal => "Yemek",
        _ => string.Empty
    };

    /// <summary>"Personel Ödemesi - Maaş 2026-09". İSİM YOK (kullanıcı kararı). Avansta dönem yazılmaz.</summary>
    public static string BuildDescription(int? paymentType, string? salaryPeriod)
    {
        var label = PaymentTypeLabel(paymentType);
        if (string.IsNullOrEmpty(label)) return CounterpartyLabel;
        var period = paymentType == (int)EmployeePaymentType.CashAdvance ? null : salaryPeriod?.Trim();
        return string.IsNullOrEmpty(period)
            ? $"{CounterpartyLabel} - {label}"
            : $"{CounterpartyLabel} - {label} {period}";
    }

    // ------------------------------------------------------------------ kur

    /// <summary>TCMB döviz satış kuru (B2B ile aynı kaynak: today.xml, ForexSelling). 30 dk önbellek.</summary>
    public static async Task<decimal?> GetTcmbRateAsync(string code, CancellationToken cancellationToken)
    {
        if (code == "TRY") return 1m;
        if (RateCache.TryGetValue(code, out var cached) && DateTime.UtcNow - cached.FetchedUtc < RateCacheTtl)
        {
            return cached.Rate;
        }

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
            var bytes = await client.GetByteArrayAsync("https://www.tcmb.gov.tr/kurlar/today.xml", cancellationToken);
            using var ms = new MemoryStream(bytes);
            var doc = XDocument.Load(ms);
            var now = DateTime.UtcNow;
            foreach (var el in doc.Descendants("Currency"))
            {
                var c = el.Attribute("CurrencyCode")?.Value?.Trim().ToUpperInvariant();
                if (string.IsNullOrEmpty(c)) continue;
                var selling = ParseDecimal(el.Element("ForexSelling")?.Value);
                var buying = ParseDecimal(el.Element("ForexBuying")?.Value);
                var rate = selling > 0 ? selling : buying;
                if (rate > 0) RateCache[c] = (rate, now);
            }
        }
        catch
        {
            // TCMB'ye ulaşılamazsa eski önbellek (varsa) kullanılır; yoksa ekran kuru elle ister.
        }

        return RateCache.TryGetValue(code, out var latest) ? latest.Rate : null;
    }

    private static decimal ParseDecimal(string? val)
    {
        if (string.IsNullOrWhiteSpace(val)) return 0m;
        return decimal.TryParse(val.Trim().Replace(',', '.'), NumberStyles.Any, CultureInfo.InvariantCulture, out var r) ? r : 0m;
    }

    // ------------------------------------------------------------------ yetki + liste

    private sealed class AccountRow
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public int CurrencyTypeId { get; set; }
    }

    /// <summary>
    /// Kullanıcı B2B'de TÜM hesapları görür mü? SSA ya da B2B rolü süper yönetici olan.
    /// Değilse <c>UserCashAccounts</c> / <c>UserBankAccounts</c> yetkisi esas (B2B ile aynı kural).
    /// Personel portalına B2B hesabıyla gelmeyen kullanıcının (ErpUserId yok) hiçbir hesabı yoktur.
    /// </summary>
    private async Task<(bool All, int? ErpUserId)> ResolveScopeAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        if (user.FindFirst("IsSuperSuperAdmin")?.Value == "1") return (true, null);

        if (!int.TryParse(user.FindFirst("ErpUserId")?.Value, out var erpUserId) || erpUserId <= 0)
        {
            return (false, null);
        }

        var isSuper = await _dbContext.Database
            .SqlQuery<bool>($@"
SELECT COALESCE(r.""IsSuperAdmin"", FALSE) AS ""Value""
FROM ""Users"" u LEFT JOIN ""Roles"" r ON r.""Id"" = u.""RoleId""
WHERE u.""Id"" = {erpUserId}")
            .ToListAsync(cancellationToken);

        return (isSuper.FirstOrDefault(), erpUserId);
    }

    public async Task<List<ErpAccountOption>> ListForUserAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var (all, erpUserId) = await ResolveScopeAsync(user, cancellationToken);
        if (!all && erpUserId is null) return new List<ErpAccountOption>();

        var uid = erpUserId ?? 0;

        var cash = await _dbContext.Database.SqlQuery<AccountRow>($@"
SELECT c.""Id"", CASE WHEN COALESCE(c.""Code"", '') = '' OR c.""Code"" = c.""Name"" THEN COALESCE(c.""Name"", '') ELSE c.""Code"" || ' ' || COALESCE(c.""Name"", '') END AS ""Name"", c.""CurrencyTypeId""
FROM ""CashAccounts"" c
WHERE {all} OR EXISTS (SELECT 1 FROM ""UserCashAccounts"" x WHERE x.""UserId"" = {uid} AND x.""CashAccountId"" = c.""Id"")
ORDER BY c.""Name""").ToListAsync(cancellationToken);

        var bank = await _dbContext.Database.SqlQuery<AccountRow>($@"
SELECT b.""Id"", TRIM(COALESCE(b.""AccountName"", '') || CASE WHEN COALESCE(b.""AccountNo"", '') <> '' THEN ' (' || b.""AccountNo"" || ')' ELSE '' END) AS ""Name"", b.""CurrencyTypeId""
FROM ""BankAccountDefinitions"" b
WHERE {all} OR EXISTS (SELECT 1 FROM ""UserBankAccounts"" x WHERE x.""UserId"" = {uid} AND x.""BankAccountId"" = b.""Id"")
ORDER BY b.""AccountName""").ToListAsync(cancellationToken);

        var result = new List<ErpAccountOption>(cash.Count + bank.Count);
        foreach (var (kind, rows) in new[] { (KindCash, cash), (KindBank, bank) })
        {
            foreach (var r in rows)
            {
                var cur = NormalizeCurrency(r.CurrencyTypeId);
                var code = CurrencyCode(cur);
                result.Add(new ErpAccountOption(kind, r.Id, r.Name, cur, code, await GetTcmbRateAsync(code, cancellationToken)));
            }
        }

        return result;
    }

    private async Task<AccountRow?> GetAccountAsync(int kind, int id, CancellationToken cancellationToken)
    {
        var rows = kind == KindCash
            ? await _dbContext.Database.SqlQuery<AccountRow>($@"
SELECT ""Id"", CASE WHEN COALESCE(""Code"", '') = '' OR ""Code"" = ""Name"" THEN COALESCE(""Name"", '') ELSE ""Code"" || ' ' || COALESCE(""Name"", '') END AS ""Name"", ""CurrencyTypeId""
FROM ""CashAccounts"" WHERE ""Id"" = {id}").ToListAsync(cancellationToken)
            : await _dbContext.Database.SqlQuery<AccountRow>($@"
SELECT ""Id"", TRIM(COALESCE(""AccountName"", '') || CASE WHEN COALESCE(""AccountNo"", '') <> '' THEN ' (' || ""AccountNo"" || ')' ELSE '' END) AS ""Name"", ""CurrencyTypeId""
FROM ""BankAccountDefinitions"" WHERE ""Id"" = {id}").ToListAsync(cancellationToken);
        return rows.FirstOrDefault();
    }

    private async Task<bool> HasAccessAsync(ClaimsPrincipal user, int kind, int id, CancellationToken cancellationToken)
    {
        var (all, erpUserId) = await ResolveScopeAsync(user, cancellationToken);
        if (all) return true;
        if (erpUserId is null) return false;

        var uid = erpUserId.Value;
        var hit = kind == KindCash
            ? await _dbContext.Database.SqlQuery<int>($@"SELECT 1 AS ""Value"" FROM ""UserCashAccounts"" WHERE ""UserId"" = {uid} AND ""CashAccountId"" = {id}").ToListAsync(cancellationToken)
            : await _dbContext.Database.SqlQuery<int>($@"SELECT 1 AS ""Value"" FROM ""UserBankAccounts"" WHERE ""UserId"" = {uid} AND ""BankAccountId"" = {id}").ToListAsync(cancellationToken);
        return hit.Count > 0;
    }

    // ------------------------------------------------------------------ yazma

    /// <summary>
    /// Üst kayda (tekil ödeme satırı ya da toplu üst satır) karşılık B2B hesabına TEK çıkış satırı
    /// yazar ve bağı üst kayda işler. Çağıran aynı veritabanı işleminin içinde olmalı: hata dönerse
    /// işlem geri alınır, B2B'de öksüz satır kalmaz. Dönen metin hata mesajıdır; null = başarılı.
    /// </summary>
    public async Task<string?> AttachAsync(
        EmployeeCashTransaction top,
        ErpPaymentSource source,
        ClaimsPrincipal user,
        string username,
        CancellationToken cancellationToken)
    {
        if (source.Kind is not (KindCash or KindBank) || source.AccountId <= 0)
        {
            return "Kasa/banka seçimi geçersiz.";
        }

        if (top.Amount <= 0m) return null;

        var account = await GetAccountAsync(source.Kind, source.AccountId, cancellationToken);
        if (account is null) return source.Kind == KindCash ? "Kasa bulunamadı." : "Banka hesabı bulunamadı.";

        if (!await HasAccessAsync(user, source.Kind, source.AccountId, cancellationToken))
        {
            return "Bu kasa/bankaya yetkiniz yok.";
        }

        var currency = NormalizeCurrency(account.CurrencyTypeId);
        decimal rate;
        if (currency == 1)
        {
            rate = 1m;
        }
        else if (source.Rate is > 0m)
        {
            rate = source.Rate.Value;
        }
        else
        {
            var tcmb = await GetTcmbRateAsync(CurrencyCode(currency), cancellationToken);
            if (tcmb is not > 0m)
            {
                return $"{CurrencyCode(currency)} kuru TCMB'den alınamadı. Lütfen kuru elle girin.";
            }
            rate = tcmb.Value;
        }

        var currencyAmount = currency == 1 ? top.Amount : Math.Round(top.Amount / rate, 2, MidpointRounding.AwayFromZero);
        var description = BuildDescription(top.PaymentType, top.SalaryPeriod);
        var now = DateTime.UtcNow;

        List<int> ids;
        if (source.Kind == KindCash)
        {
            ids = await _dbContext.Database.SqlQuery<int>($@"
INSERT INTO ""CashAccountTransactions""(
  ""CashAccountId"", ""Date"", ""Direction"", ""Amount"",
  ""CurrencyTypeId"", ""CurrencyRate"", ""CurrencyAmount"",
  ""CounterpartyType"", ""CounterpartyCode"", ""CounterpartyName"",
  ""ReferenceType"", ""ReferenceId"", ""LinkedBankAccountTransactionId"",
  ""DocumentNo"", ""Description"",
  ""TenderCurrencyTypeId"", ""TenderRate"", ""TenderAmount"",
  ""CreateUser"", ""CreateTime"")
VALUES (
  {source.AccountId}, {top.Date}, {2}, {top.Amount},
  {currency}, {rate}, {currencyAmount},
  {3}, {string.Empty}, {CounterpartyLabel},
  {1}, NULL, NULL,
  {top.ReferenceNo}, {description},
  {0}, {0m}, {0m},
  {username}, {now})
RETURNING ""Id"" AS ""Value""").ToListAsync(cancellationToken);
        }
        else
        {
            ids = await _dbContext.Database.SqlQuery<int>($@"
INSERT INTO ""BankAccountTransactions""(
  ""BankAccountDefinitionId"", ""Date"", ""Direction"", ""Amount"",
  ""CurrencyTypeId"", ""CurrencyRate"", ""CurrencyAmount"",
  ""CounterpartyType"", ""CounterpartyCode"", ""CounterpartyName"",
  ""DocumentNo"", ""MaturityDate"", ""Description"", ""IsPosFee"",
  ""TenderCurrencyTypeId"", ""TenderRate"", ""TenderAmount"",
  ""PosFeeBsmvRate"", ""PosFeeVatRate"", ""PosFeeBsmvAmount"", ""PosFeeVatAmount"", ""ExpenseType"",
  ""CreateUser"", ""CreateTime"")
VALUES (
  {source.AccountId}, {top.Date}, {2}, {top.Amount},
  {currency}, {rate}, {currencyAmount},
  {2}, {string.Empty}, {CounterpartyLabel},
  {top.ReferenceNo}, NULL, {description}, FALSE,
  {0}, {0m}, {0m},
  {0m}, {0m}, {0m}, {0m}, {0},
  {username}, {now})
RETURNING ""Id"" AS ""Value""").ToListAsync(cancellationToken);
        }

        top.ErpAccountKind = source.Kind;
        top.ErpAccountId = source.AccountId;
        top.ErpAccountName = account.Name.Length > 200 ? account.Name[..200] : account.Name;
        top.ErpTransactionId = ids.First();
        top.ErpCurrencyTypeId = currency;
        top.ErpRate = rate;
        top.ErpCurrencyAmount = currencyAmount;
        return null;
    }

    /// <summary>
    /// Üst kaydın tutarı/tarihi değiştiyse (düzenleme ya da toplu ödemeden bir kişinin geri
    /// alınması) B2B satırını aynı KURLA günceller — kur değişirse dövizli hesapta bakiye kayardı.
    /// </summary>
    public async Task SyncAsync(EmployeeCashTransaction top, string username, CancellationToken cancellationToken)
    {
        if (top.ErpTransactionId is not > 0 || top.ErpAccountKind is null) return;

        var rate = top.ErpRate is > 0m ? top.ErpRate.Value : 1m;
        var currencyAmount = (top.ErpCurrencyTypeId ?? 1) == 1
            ? top.Amount
            : Math.Round(top.Amount / rate, 2, MidpointRounding.AwayFromZero);
        top.ErpCurrencyAmount = currencyAmount;

        var id = top.ErpTransactionId.Value;
        var now = DateTime.UtcNow;
        if (top.ErpAccountKind == KindCash)
        {
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($@"
UPDATE ""CashAccountTransactions""
SET ""Amount"" = {top.Amount}, ""CurrencyAmount"" = {currencyAmount}, ""Date"" = {top.Date},
    ""EditUser"" = {username}, ""EditTime"" = {now}
WHERE ""Id"" = {id}", cancellationToken);
        }
        else
        {
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($@"
UPDATE ""BankAccountTransactions""
SET ""Amount"" = {top.Amount}, ""CurrencyAmount"" = {currencyAmount}, ""Date"" = {top.Date},
    ""EditUser"" = {username}, ""EditTime"" = {now}
WHERE ""Id"" = {id}", cancellationToken);
        }
    }

    /// <summary>Üst kayıt kaldırılırken B2B satırını siler.</summary>
    public async Task DeleteAsync(EmployeeCashTransaction top, CancellationToken cancellationToken)
    {
        if (top.ErpTransactionId is not > 0 || top.ErpAccountKind is null) return;

        var id = top.ErpTransactionId.Value;
        if (top.ErpAccountKind == KindCash)
        {
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($@"DELETE FROM ""CashAccountTransactions"" WHERE ""Id"" = {id}", cancellationToken);
        }
        else
        {
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($@"DELETE FROM ""BankAccountTransactions"" WHERE ""Id"" = {id}", cancellationToken);
        }
    }
}
