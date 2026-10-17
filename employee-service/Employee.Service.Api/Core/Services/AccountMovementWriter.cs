using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>Kasa/banka hareketi yazma sonucu.</summary>
public sealed record AccountMovementResult(bool Ok, string? Error, int? CurrencyTypeId, decimal? Rate, decimal? CurrencyAmount)
{
    public static AccountMovementResult Skipped() => new(true, null, null, null, null);
    public static AccountMovementResult Failed(string error) => new(false, error, null, null, null);
}

/// <summary>
/// Personel ödemelerinin kasa/banka tarafını yazar.
///
/// <para>Bu mantık üç ayrı controller'a (ödeme, prim planı, yemek planı) kopyalanmıştı ve
/// kopyalar birbirinden ayrışmıştı: prim ve yemek toplu ödemesinde tutar hesaplanıp
/// <c>bankTotal</c>/<c>cashTotal</c> değişkenleri hiç kullanılmadan bırakılıyordu, yani
/// planlar "Ödendi" işaretlendiği hâlde kasadan/bankadan para çıkmıyordu. Tek yere alındı.</para>
/// </summary>
public sealed class AccountMovementWriter
{
    private readonly AppDbContext _dbContext;
    private readonly bool _enabled;

    public AccountMovementWriter(AppDbContext dbContext, IConfiguration configuration)
    {
        _dbContext = dbContext;
        _enabled = AccountMovementSettings.IsEnabled(configuration);
    }

    public async Task<int?> GetBankCurrencyTypeIdAsync(int bankAccountDefinitionId, CancellationToken cancellationToken)
        => await _dbContext.Database
            .SqlQuery<int?>($"SELECT \"CurrencyTypeId\" AS \"Value\" FROM \"BankAccountDefinitions\" WHERE \"Id\" = {bankAccountDefinitionId} LIMIT 1")
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<int?> GetCashCurrencyTypeIdAsync(int cashAccountId, CancellationToken cancellationToken)
        => await _dbContext.Database
            .SqlQuery<int?>($"SELECT \"CurrencyTypeId\" AS \"Value\" FROM \"CashAccounts\" WHERE \"Id\" = {cashAccountId} LIMIT 1")
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>
    /// Ödeme tutarı TL'dir; hareket ise HESABIN kendi para birimindedir. Kur sabit <c>1</c>
    /// yazılırsa 38.000 ₺ maaş dolar hesaptan 38.000 $ olarak düşer ve bakiye ~38 kat erir.
    /// Kur <c>ExchangeRates</c> tablosundan okunur (ana API'nin TCMB senkronu doldurur).
    ///
    /// <para>Kodlama ana API ile aynı: 0/1 = TRY, 2 = EUR, 3 = USD, 4 = GBP.</para>
    /// </summary>
    private async Task<(int CurrencyTypeId, decimal Rate, decimal CurrencyAmount)> ResolveAsync(
        int accountCurrencyTypeId,
        decimal tryAmount,
        CancellationToken cancellationToken)
    {
        var normalized = accountCurrencyTypeId == 0 ? 1 : accountCurrencyTypeId;
        if (normalized == 1) return (1, 1m, tryAmount);

        var code = normalized switch
        {
            2 => "EUR",
            3 => "USD",
            4 => "GBP",
            _ => null
        };

        if (code is null)
        {
            throw new InvalidOperationException($"Hesabın para birimi tanınmıyor (kod {accountCurrencyTypeId}).");
        }

        var rate = await _dbContext.Database
            .SqlQuery<decimal?>($@"
SELECT CASE WHEN ""SellingRate"" > 0 THEN ""SellingRate"" ELSE ""BuyingRate"" END AS ""Value""
FROM ""ExchangeRates""
WHERE ""CurrencyCode"" = {code}
ORDER BY ""RateDate"" DESC
LIMIT 1")
            .FirstOrDefaultAsync(cancellationToken);


        if (rate is not > 0m)
        {
            throw new InvalidOperationException($"{code} kuru alınamadı, ödeme kaydedilmedi. Lütfen sonra tekrar deneyin.");
        }

        return (normalized, rate.Value, Math.Round(tryAmount / rate.Value, 2, MidpointRounding.AwayFromZero));
    }

    /// <summary>
    /// Hareketi yazar. <paramref name="direction"/>: 1 = giriş, 2 = çıkış.
    /// <paramref name="knownRate"/> doluysa kur yeniden çözülmez — iptal (ters kayıt) yolunda
    /// orijinal hareketin kuru kullanılır ki döviz hesapta bakiye tam sıfırlansın.
    /// </summary>
    public async Task<AccountMovementResult> WriteAsync(
        int? bankAccountDefinitionId,
        int? cashAccountId,
        decimal amount,
        DateTime dateUtc,
        int direction,
        string description,
        string username,
        DateTime nowUtc,
        (int CurrencyTypeId, decimal Rate)? knownRate,
        CancellationToken cancellationToken)
    {
        if (amount <= 0) return AccountMovementResult.Skipped();

        // Kasa/banka bağlantısı pasifken yeni çıkış hareketi yazılmaz; ödeme servis içinde
        // "ödendi" olarak kalır. Ters kayıt (direction 1) hariç tutulur: kuru kayıtlı bir
        // hareket gerçekten yazılmışsa iptalde para hesaba geri dönmek zorunda.
        var isReversalOfWrittenMovement = direction == 1 && knownRate is { Rate: > 0m };
        if (!_enabled && !isReversalOfWrittenMovement) return AccountMovementResult.Skipped();

        var hasBank = bankAccountDefinitionId is > 0;
        var hasCash = cashAccountId is > 0;

        if (!hasBank && !hasCash)
        {
            return AccountMovementResult.Failed("Ödeme kaynağı (banka/kasa) seçilmedi.");
        }

        var accountCurrencyTypeId = hasBank
            ? await GetBankCurrencyTypeIdAsync(bankAccountDefinitionId!.Value, cancellationToken)
            : await GetCashCurrencyTypeIdAsync(cashAccountId!.Value, cancellationToken);

        if (!accountCurrencyTypeId.HasValue)
        {
            return AccountMovementResult.Failed(hasBank ? "Banka hesabı bulunamadı" : "Kasa bulunamadı");
        }

        (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) mv;

        if (knownRate.HasValue && knownRate.Value.Rate > 0m)
        {
            var known = knownRate.Value;
            mv = (known.CurrencyTypeId, known.Rate, Math.Round(amount / known.Rate, 2, MidpointRounding.AwayFromZero));
        }
        else
        {
            try
            {
                mv = await ResolveAsync(accountCurrencyTypeId.Value, amount, cancellationToken);
            }
            catch (InvalidOperationException ex)
            {
                return AccountMovementResult.Failed(ex.Message);
            }
        }

        if (hasBank)
        {
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO ""BankAccountTransactions""(
  ""BankAccountDefinitionId"", ""Date"", ""Direction"", ""Amount"",
  ""CurrencyTypeId"", ""CurrencyRate"", ""CurrencyAmount"",
  ""CounterpartyType"", ""CounterpartyCode"", ""CounterpartyName"",
  ""DocumentNo"", ""MaturityDate"", ""Description"", ""IsPosFee"",
  ""CreateUser"", ""CreateTime"", ""EditUser"", ""EditTime"")
VALUES (
  {bankAccountDefinitionId!.Value}, {dateUtc}, {direction}, {amount},
  {mv.CurrencyTypeId}, {mv.Rate}, {mv.CurrencyAmount},
  {2}, {string.Empty}, {string.Empty},
  NULL, NULL, {description}, FALSE,
  {username}, {nowUtc}, NULL, NULL
)
", cancellationToken);
        }
        else
        {
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO ""CashAccountTransactions""(
  ""CashAccountId"", ""Date"", ""Direction"", ""Amount"",
  ""CurrencyTypeId"", ""CurrencyRate"", ""CurrencyAmount"",
  ""CounterpartyType"", ""CounterpartyCode"", ""CounterpartyName"",
  ""ReferenceType"", ""ReferenceId"", ""LinkedBankAccountTransactionId"",
  ""Description"", ""CreateUser"", ""CreateTime"", ""EditUser"", ""EditTime"")
VALUES (
  {cashAccountId!.Value}, {dateUtc}, {direction}, {amount},
  {mv.CurrencyTypeId}, {mv.Rate}, {mv.CurrencyAmount},
  {3}, {string.Empty}, {string.Empty},
  {1}, NULL, NULL,
  {description}, {username}, {nowUtc}, NULL, NULL
)
", cancellationToken);
        }

        return new AccountMovementResult(true, null, mv.CurrencyTypeId, mv.Rate, mv.CurrencyAmount);
    }
}
