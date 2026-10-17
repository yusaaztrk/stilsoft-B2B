using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.DTOs.AccountingPeriods;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

public interface IAccountingPeriodService
{
    Task<AccountingPeriod?> GetActivePeriodAsync(CancellationToken cancellationToken = default);
    Task<List<AccountingPeriodDto>> ListPeriodsAsync(CancellationToken cancellationToken = default);
    Task<AccountingPeriodDto> CreatePeriodAsync(CreateAccountingPeriodDto dto, string userId, CancellationToken cancellationToken = default);
    Task<PeriodClosingValidationReportDto> ValidateClosePeriodAsync(int periodId, CancellationToken cancellationToken = default);
    Task<CloseAccountingPeriodResultDto> ClosePeriodAndTransferBalancesAsync(int periodId, string userId, string? customTransferName = null, CancellationToken cancellationToken = default);
    Task<bool> ReopenPeriodAsync(int periodId, string userId, CancellationToken cancellationToken = default);
    Task<bool> DeletePeriodAsync(int periodId, CancellationToken cancellationToken = default);
    Task EnsurePeriodAssignedForEntryAsync(CustomerLedgerEntry entry, CancellationToken cancellationToken = default);
    Task<bool> IsDateInClosedPeriodAsync(DateTime date, CancellationToken cancellationToken = default);
}

public sealed class AccountingPeriodService : IAccountingPeriodService
{
    private readonly AppDbContext _dbContext;

    public AccountingPeriodService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<AccountingPeriod?> GetActivePeriodAsync(CancellationToken cancellationToken = default)
    {
        return await _dbContext.AccountingPeriods
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.IsActive && !x.IsClosed, cancellationToken);
    }

    public async Task<List<AccountingPeriodDto>> ListPeriodsAsync(CancellationToken cancellationToken = default)
    {
        var periods = await _dbContext.AccountingPeriods
            .AsNoTracking()
            .OrderBy(x => x.FiscalYear)
            .ThenBy(x => x.StartDate)
            .ToListAsync(cancellationToken);

        // Seed default current year period if none exists yet
        if (periods.Count == 0)
        {
            var currentYear = DateTime.UtcNow.Year;
            var defaultPeriod = new AccountingPeriod
            {
                Code = currentYear.ToString(),
                Name = $"{currentYear} Mali Yılı",
                FiscalYear = currentYear,
                StartDate = DateTime.SpecifyKind(new DateTime(currentYear, 1, 1, 0, 0, 0), DateTimeKind.Utc),
                EndDate = DateTime.SpecifyKind(new DateTime(currentYear, 12, 31, 23, 59, 59), DateTimeKind.Utc),
                Status = AccountingPeriodStatus.Open,
                IsActive = true,
                IsClosed = false,
                CreateUser = "System",
                CreateTime = DateTime.UtcNow
            };

            _dbContext.AccountingPeriods.Add(defaultPeriod);
            await _dbContext.SaveChangesAsync(cancellationToken);
            periods.Add(defaultPeriod);
        }

        // BURADA "auto-heal" VARDI VE KALDIRILDI: açık dönem yoksa en son dönemi LİSTELEME
        // sırasında yeniden açıyor, `ClosedAt` ve `ClosedByUserId` damgalarını da siliyordu.
        // Yani dönemler ekranını açmak, resmen kapatılmış bir mali dönemi geri açıp kapanış
        // izini yok ediyordu — kapalı döneme fatura kesilmesinin önü de böyle açılıyordu.
        // Bir GET isteği veriyi değiştirmemeli; dönemi geri açmanın kasıtlı ve yetkili yolu
        // zaten var (`ReopenPeriodAsync`). Normal akışta bu dal hiç gerekmiyor: `ClosePeriodAsync`
        // dönemi kapatırken hedef dönemi oluşturup açık ve aktif bırakıyor, hiç dönem yoksa da
        // yukarıdaki varsayılan dönem oluşturma çalışıyor.

        return periods.Select(p => new AccountingPeriodDto
        {
            Id = p.Id,
            Code = p.Code,
            Name = p.Name,
            FiscalYear = p.FiscalYear,
            StartDate = p.StartDate,
            EndDate = p.EndDate,
            Status = (int)p.Status,
            StatusName = p.Status switch
            {
                AccountingPeriodStatus.Draft => "Taslak",
                AccountingPeriodStatus.Open => "Açık",
                AccountingPeriodStatus.Closing => "Kapanıyor",
                AccountingPeriodStatus.Closed => "Kapalı",
                AccountingPeriodStatus.Reopened => "Yeniden Açıldı",
                _ => "Bilinmiyor"
            },
            IsActive = p.IsActive,
            IsClosed = p.IsClosed,
            ClosedAt = p.ClosedAt,
            ClosedByUserId = p.ClosedByUserId,
            ReopenedAt = p.ReopenedAt,
            ReopenedByUserId = p.ReopenedByUserId
        }).ToList();
    }

    public async Task<AccountingPeriodDto> CreatePeriodAsync(CreateAccountingPeriodDto dto, string userId, CancellationToken cancellationToken = default)
    {
        var code = (dto.Code ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(code)) throw new InvalidOperationException("Dönem kodu boş olamaz.");

        var existingCode = await _dbContext.AccountingPeriods.AnyAsync(x => x.Code == code, cancellationToken);
        if (existingCode) throw new InvalidOperationException($"'{code}' kodlu mali dönem zaten mevcut.");

        var startUtc = dto.StartDate.Kind == DateTimeKind.Utc ? dto.StartDate : DateTime.SpecifyKind(dto.StartDate, DateTimeKind.Utc);
        var endUtc = dto.EndDate.Kind == DateTimeKind.Utc ? dto.EndDate : DateTime.SpecifyKind(dto.EndDate, DateTimeKind.Utc);

        if (startUtc >= endUtc) throw new InvalidOperationException("Başlangıç tarihi bitiş tarihinden önce olmalıdır.");

        // DÖNEMLER ÇAKIŞAMAZ (denetim md. 5).
        //
        // Kod tekilliği ve "başlangıç < bitiş" denetleniyordu ama tarih aralığının mevcut
        // dönemlerle ÇAKIŞIP çakışmadığı hiç bakılmıyordu: iki aktif mali dönem birlikte
        // açılabiliyor, o tarihlere düşen belge hangi döneme ait olduğunu söyleyemiyordu
        // (devir ve mizan da ikiye bölünüyordu). İki aralık, biri diğerinin bitişinden ÖNCE
        // başlıyorsa çakışır; uç uca eklenen dönemler (birinin bitişi = diğerinin başlangıcı)
        // çakışma sayılmaz — izin kontrolündeki kuralın aynısı.
        var overlapping = await _dbContext.AccountingPeriods
            .AsNoTracking()
            .Where(x => startUtc < x.EndDate && x.StartDate < endUtc)
            .Select(x => new { x.Code, x.StartDate, x.EndDate })
            .FirstOrDefaultAsync(cancellationToken);

        if (overlapping is not null)
        {
            throw new InvalidOperationException(
                $"Bu tarih aralığı '{overlapping.Code}' dönemiyle çakışıyor " +
                $"({overlapping.StartDate:dd.MM.yyyy} - {overlapping.EndDate:dd.MM.yyyy}). Mali dönemler çakışamaz.");
        }

        var period = new AccountingPeriod
        {
            Code = code,
            Name = (dto.Name ?? string.Empty).Trim(),
            FiscalYear = dto.FiscalYear,
            StartDate = startUtc,
            EndDate = endUtc,
            Status = AccountingPeriodStatus.Open,
            IsActive = true,
            IsClosed = false,
            CreateUser = userId,
            CreateTime = DateTime.UtcNow
        };

        _dbContext.AccountingPeriods.Add(period);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new AccountingPeriodDto
        {
            Id = period.Id,
            Code = period.Code,
            Name = period.Name,
            FiscalYear = period.FiscalYear,
            StartDate = period.StartDate,
            EndDate = period.EndDate,
            Status = (int)period.Status,
            StatusName = "Açık",
            IsActive = period.IsActive,
            IsClosed = period.IsClosed
        };
    }

    public async Task<PeriodClosingValidationReportDto> ValidateClosePeriodAsync(int periodId, CancellationToken cancellationToken = default)
    {
        var report = new PeriodClosingValidationReportDto();

        var period = await _dbContext.AccountingPeriods
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == periodId, cancellationToken);

        if (period == null)
        {
            report.CanClose = false;
            report.CriticalErrors.Add("Mali dönem bulunamadı.");
            return report;
        }

        if (period.IsClosed)
        {
            report.CanClose = false;
            report.CriticalErrors.Add("Bu mali dönem zaten kapalıdır.");
            return report;
        }

        var entriesInPeriod = await _dbContext.CustomerLedgerEntries
            .AsNoTracking()
            .Where(x => x.Date >= period.StartDate && x.Date <= period.EndDate)
            .ToListAsync(cancellationToken);

        report.TotalEntriesInPeriod = entriesInPeriod.Count;
        report.TotalCustomers = entriesInPeriod.Select(x => x.CustomerCode).Distinct().Count();

        // Check for unassigned period entries
        var unassignedCount = entriesInPeriod.Count(x => x.AccountingPeriodId == null);
        if (unassignedCount > 0)
        {
            report.Warnings.Add($"{unassignedCount} adet hareket henüz bu döneme etiketlenmemiş (Devir sırasında otomatik etiketlenecek).");
        }

        // Calculate currency summaries.
        //
        // NORMALİZE ŞART: 0 ve 1'in İKİSİ DE TL'dir (eski satırlar 0, yeni ekranlar 1 yazıyor).
        // Ham CurrencyTypeId ile gruplanınca aynı para birimi iki kovaya bölünüyor ve dönem
        // kapatma raporunda "TRY" satırının yanında bir de "CURR-0" satırı beliriyordu —
        // muhasebecinin kapatmadan önce okuduğu tek özet bu.
        var currencyGroups = entriesInPeriod
            .GroupBy(x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId))
            .ToList();

        foreach (var group in currencyGroups)
        {
            var currencyCode = CurrencyTypeHelper.ToCode(group.Key) ?? $"CURR-{group.Key}";

            // CurrencyAmount'ı boş kalmış dövizli satır özette 0 sayılıyordu; kapanış
            // hesabıyla aynı fallback kullanılır (Amount / kur).
            decimal debit = group.Where(x => x.Direction == CustomerLedgerEntryDirection.Debit)
                .Sum(x => LedgerAmount.InCurrency(x.CurrencyTypeId, x.Amount, x.CurrencyAmount, x.CurrencyRate));
            decimal credit = group.Where(x => x.Direction == CustomerLedgerEntryDirection.Credit)
                .Sum(x => LedgerAmount.InCurrency(x.CurrencyTypeId, x.Amount, x.CurrencyAmount, x.CurrencyRate));

            report.CurrencySummaries.Add(new PeriodCurrencySummaryDto
            {
                CurrencyTypeId = group.Key,
                CurrencyCode = currencyCode,
                TotalDebit = debit,
                TotalCredit = credit,
                NetBalance = debit - credit
            });
        }

        return report;
    }

    public async Task<CloseAccountingPeriodResultDto> ClosePeriodAndTransferBalancesAsync(int periodId, string userId, string? customTransferName = null, CancellationToken cancellationToken = default)
    {
        var period = await _dbContext.AccountingPeriods
            .FirstOrDefaultAsync(x => x.Id == periodId, cancellationToken);

        if (period == null) throw new InvalidOperationException("Mali dönem bulunamadı.");
        if (period.IsClosed) throw new InvalidOperationException("Bu mali dönem zaten kapalıdır.");

        /*
          ONAYSIZ BELGE UYARISI (2026-08-20 kullanıcı kararı, denetim md. A3).

          Dönem, içinde ONAYSIZ alış faturası dururken kapatılabiliyordu ve kimse haberdar
          olmuyordu. Onaysız alış faturası cari ekstresine ve stoğa işlemez; dolayısıyla
          devreden bakiye o faturaların tutarı kadar eksik hesaplanır ve fatura sonradan
          onaylanırsa KAPALI döneme yazılmış olur.

          Kullanıcı kararı: kapatmayı ENGELLEME, uyar. Kapatma yapılır, sonuçta ne
          kaçırıldığı ekranda gösterilir; kullanıcı isterse dönemi tekrar açıp düzeltir.
        */
        var warnings = new List<string>();

        var unapprovedPurchases = await _dbContext.PurchaseInvoices
            .AsNoTracking()
            .Where(x => !x.Approved && x.Date >= period.StartDate && x.Date <= period.EndDate)
            .Select(x => new { x.DocumentNo, x.GrandTotal })
            .ToListAsync(cancellationToken);

        if (unapprovedPurchases.Count > 0)
        {
            var toplam = unapprovedPurchases.Sum(x => x.GrandTotal);
            var ornekler = string.Join(", ", unapprovedPurchases.Take(5).Select(x => x.DocumentNo));
            var devami = unapprovedPurchases.Count > 5 ? $" (+{unapprovedPurchases.Count - 5} tane daha)" : string.Empty;

            warnings.Add(
                $"Bu dönemde ONAYSIZ {unapprovedPurchases.Count} alış faturası var (toplam {toplam:N2}). " +
                $"Onaysız faturalar cariye ve stoğa işlemediği için devir bakiyesi bu tutar kadar eksik olabilir. " +
                $"Belge no: {ornekler}{devami}");
        }

        var nextFiscalYear = period.FiscalYear + 1;
        var targetPeriod = await _dbContext.AccountingPeriods
            .FirstOrDefaultAsync(x => x.FiscalYear == nextFiscalYear, cancellationToken);

        var transferDesc = !string.IsNullOrWhiteSpace(customTransferName)
            ? customTransferName.Trim()
            : $"{nextFiscalYear} Mali Yılı";

        if (targetPeriod == null)
        {
            var startUtc = DateTime.SpecifyKind(new DateTime(nextFiscalYear, 1, 1, 0, 0, 0), DateTimeKind.Utc);
            var endUtc = DateTime.SpecifyKind(new DateTime(nextFiscalYear, 12, 31, 23, 59, 59), DateTimeKind.Utc);

            targetPeriod = new AccountingPeriod
            {
                Code = nextFiscalYear.ToString(),
                Name = transferDesc,
                FiscalYear = nextFiscalYear,
                StartDate = startUtc,
                EndDate = endUtc,
                Status = AccountingPeriodStatus.Open,
                IsActive = true,
                IsClosed = false,
                CreateUser = userId,
                CreateTime = DateTime.UtcNow
            };

            _dbContext.AccountingPeriods.Add(targetPeriod);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        else
        {
            targetPeriod.Name = transferDesc;
            targetPeriod.IsActive = true;
            targetPeriod.IsClosed = false;
            targetPeriod.Status = AccountingPeriodStatus.Open;
        }

        // Execute in single DB transaction for absolute data consistency
        using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            // 1. Assign current period ID to all entries in period range if missing
            var unassignedEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => x.Date >= period.StartDate && x.Date <= period.EndDate && x.AccountingPeriodId == null)
                .ToListAsync(cancellationToken);

            foreach (var e in unassignedEntries)
            {
                e.AccountingPeriodId = period.Id;
            }

            if (unassignedEntries.Count > 0)
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
            }

            // 2. Remove any previous opening balance entries in target period created from this source period
            var existingDevirEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => x.IsOpeningBalance && x.SourcePeriodId == period.Id)
                .ToListAsync(cancellationToken);

            if (existingDevirEntries.Count > 0)
            {
                _dbContext.CustomerLedgerEntries.RemoveRange(existingDevirEntries);
                await _dbContext.SaveChangesAsync(cancellationToken);
            }

            // Compute closing balances per individual CustomerCode & CurrencyTypeId (keeps alt bayiler and accounts strictly separate)
            var periodIdsUpToCurrent = await _dbContext.AccountingPeriods
                .Where(p => p.FiscalYear <= period.FiscalYear)
                .Select(p => p.Id)
                .ToListAsync(cancellationToken);

            var allPeriodEntries = await _dbContext.CustomerLedgerEntries
                .AsNoTracking()
                .Where(x => !x.IsCancelled && (
                    (x.AccountingPeriodId != null && periodIdsUpToCurrent.Contains(x.AccountingPeriodId.Value)) ||
                    (x.AccountingPeriodId == null && x.Date <= period.EndDate)
                ))
                .ToListAsync(cancellationToken);

            // NORMALİZE ŞART: 0 ve 1 ikisi de TL. Ham kodla gruplanınca eski (0) ve yeni (1)
            // TL hareketleri ayrı düşüyor ve aynı cariye AYNI para biriminden İKİ DEVİR
            // satırı yazılıyordu. Devir satırı dönemin tek açılış kaydı olmak zorunda.
            var balances = allPeriodEntries
                .Where(x => !string.IsNullOrWhiteSpace(x.CustomerCode))
                .GroupBy(x => new
                {
                    CustomerCode = x.CustomerCode.Trim(),
                    CurrencyTypeId = CurrencyTypeHelper.Normalize(x.CurrencyTypeId)
                })
                .Select(g => new
                {
                    g.Key.CustomerCode,
                    g.Key.CurrencyTypeId,
                    DebitTry = g.Where(x => x.Direction == CustomerLedgerEntryDirection.Debit).Sum(x => x.Amount),
                    CreditTry = g.Where(x => x.Direction == CustomerLedgerEntryDirection.Credit).Sum(x => x.Amount),
                    // Ham CurrencyAmount toplanıyordu: dövizli ama CurrencyAmount'ı boş kalmış
                    // satırda döviz bakiyesi 0 çıkıyor, aşağıdaki fallback de TL tutarı DÖVİZ
                    // olarak devrediyordu (38.000 ₺ → 38.000 $). Ekstre okuyucusuyla aynı kural.
                    DebitFx = g.Where(x => x.Direction == CustomerLedgerEntryDirection.Debit)
                        .Sum(x => LedgerAmount.InCurrency(x.CurrencyTypeId, x.Amount, x.CurrencyAmount, x.CurrencyRate)),
                    CreditFx = g.Where(x => x.Direction == CustomerLedgerEntryDirection.Credit)
                        .Sum(x => LedgerAmount.InCurrency(x.CurrencyTypeId, x.Amount, x.CurrencyAmount, x.CurrencyRate))
                })
                .ToList();

            // Devir satırı HEDEF DÖNEMİN BAŞINDA durmalı. Kapanış hangi gün çalıştırılırsa
            // çalıştırılsın açılış o güne yazılıyordu: 2025 dönemi 2026-03-15'te kapatılınca
            // 2026 açılışı 15 Mart'a düşüyor ve Ocak-Şubat tarihli ekstre raporunda
            // dönemin açılış bakiyesi hiç görünmüyordu. Çalışma anı CreateTime'da kalıyor.
            var openingDate = DateTime.SpecifyKind(targetPeriod.StartDate.Date, DateTimeKind.Utc);
            int newOpeningCount = 0;

            foreach (var b in balances)
            {
                decimal netTry = b.DebitTry - b.CreditTry;
                decimal netFx = b.DebitFx - b.CreditFx;

                if (netTry == 0m && netFx == 0m) continue; // Skip zero balance accounts

                // Yön TL bakiyeden okunur; TL değeri boş olan eski dövizli satırlarda
                // (Amount doldurulmamış) netTry 0 çıkıyor ve borç bakiye ALACAK yazılıyordu.
                // O durumda döviz bakiyenin işareti kullanılır.
                var signSource = netTry != 0m ? netTry : netFx;
                var direction = signSource > 0m ? CustomerLedgerEntryDirection.Debit : CustomerLedgerEntryDirection.Credit;
                decimal absTry = Math.Abs(netTry);
                decimal absFx = Math.Abs(netFx);

                var devirRate = CurrencyTypeHelper.IsTry(b.CurrencyTypeId)
                    ? 1.0m
                    : (absFx > 0 ? Math.Round(absTry / absFx, 6) : 1.0m);
                // absTry'ye düşmek YALNIZ TL'de doğru: dövizde TL rakamını döviz tutarı
                // olarak yazmak bakiyeyi kur katı kadar şişirir.
                var devirCurrencyAmount = absFx > 0
                    ? absFx
                    : (CurrencyTypeHelper.IsTry(b.CurrencyTypeId) ? absTry : 0m);

                var devirEntry = new CustomerLedgerEntry
                {
                    CustomerCode = b.CustomerCode,
                    Date = openingDate,
                    DueDate = openingDate,
                    Direction = direction,
                    Amount = absTry,
                    CurrencyTypeId = b.CurrencyTypeId,
                    CurrencyRate = devirRate,
                    CurrencyAmount = devirCurrencyAmount,
                    // Devir satırı işlem/ödeme döviz alanlarını hiç doldurmuyordu (0 kalıyordu);
                    // bu alanları okuyan ekstre ve mutabakat yolları açılış bakiyesini
                    // eşleştiremiyordu. Devirde işlemin parası = bakiyenin parası.
                    PaymentCurrencyTypeId = b.CurrencyTypeId,
                    PaymentCurrencyRate = devirRate,
                    PaymentCurrencyAmount = devirCurrencyAmount,
                    DocumentNo = $"DEVİR-{period.FiscalYear}",
                    Description = transferDesc,
                    TransactionType = "DEVİR",
                    ReferenceType = CustomerLedgerEntryReferenceType.OpeningBalance,
                    ReferenceId = period.Id,
                    AccountingPeriodId = targetPeriod.Id,
                    IsOpeningBalance = true,
                    SourcePeriodId = period.Id,
                    CreateUser = userId,
                    CreateTime = DateTime.UtcNow
                };

                _dbContext.CustomerLedgerEntries.Add(devirEntry);
                newOpeningCount++;
            }

            // 4. Mark period closed
            period.IsClosed = true;
            period.Status = AccountingPeriodStatus.Closed;
            period.ClosedAt = DateTime.UtcNow;
            period.ClosedByUserId = userId;
            period.IsActive = false;

            targetPeriod.IsActive = true;

            await _dbContext.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);

            return new CloseAccountingPeriodResultDto
            {
                Success = true,
                Message = $"{period.Name} başarıyla kapatıldı. {targetPeriod.Name} için {newOpeningCount} adet devir kaydı oluşturuldu.",
                ClosedPeriodId = period.Id,
                TargetPeriodId = targetPeriod.Id,
                GeneratedOpeningEntriesCount = newOpeningCount,
                Warnings = warnings
            };
        }
        catch
        {
            await tx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<bool> ReopenPeriodAsync(int periodId, string userId, CancellationToken cancellationToken = default)
    {
        var period = await _dbContext.AccountingPeriods
            .FirstOrDefaultAsync(x => x.Id == periodId, cancellationToken);

        if (period == null) throw new InvalidOperationException("Mali dönem bulunamadı.");

        // Check if any subsequent period is already closed
        var closedSubsequent = await _dbContext.AccountingPeriods
            .AnyAsync(x => x.FiscalYear > period.FiscalYear && x.IsClosed, cancellationToken);

        if (closedSubsequent)
        {
            throw new InvalidOperationException("Daha sonraki mali dönemler kapalı durumdadır. Önce en son kapalı dönemi açmalısınız.");
        }

        using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            // Target period is next fiscal year
            var targetPeriod = await _dbContext.AccountingPeriods
                .FirstOrDefaultAsync(x => x.FiscalYear == period.FiscalYear + 1, cancellationToken);

            // Remove opening balance entries created from this period or placed in target period
            var devirEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => x.IsOpeningBalance && (
                    x.SourcePeriodId == period.Id || 
                    x.ReferenceId == period.Id || 
                    (targetPeriod != null && x.AccountingPeriodId == targetPeriod.Id)
                ))
                .ToListAsync(cancellationToken);

            if (devirEntries.Count > 0)
            {
                _dbContext.CustomerLedgerEntries.RemoveRange(devirEntries);
                await _dbContext.SaveChangesAsync(cancellationToken);
            }

            period.IsClosed = false;
            period.Status = AccountingPeriodStatus.Reopened;
            period.ReopenedAt = DateTime.UtcNow;
            period.ReopenedByUserId = userId;
            period.IsActive = true;

            await _dbContext.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await tx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<bool> DeletePeriodAsync(int periodId, CancellationToken cancellationToken = default)
    {
        var period = await _dbContext.AccountingPeriods
            .FirstOrDefaultAsync(x => x.Id == periodId, cancellationToken);

        if (period == null) return false;

        // Check 1: Initial first period cannot be deleted
        var minFiscalYear = await _dbContext.AccountingPeriods
            .MinAsync(x => x.FiscalYear, cancellationToken);

        if (period.FiscalYear <= minFiscalYear)
        {
            throw new InvalidOperationException($"İlk mali dönem ({period.FiscalYear}) silinemez veya geri alınamaz.");
        }

        // Check 2: Must be latest period (train sequential rule)
        var maxFiscalYear = await _dbContext.AccountingPeriods
            .MaxAsync(x => x.FiscalYear, cancellationToken);

        if (period.FiscalYear < maxFiscalYear)
        {
            throw new InvalidOperationException("Yalnızca en son açılan mali dönem geri alınabilir.");
        }

        using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            // 1. Find previous period and re-activate it
            var prevPeriod = await _dbContext.AccountingPeriods
                .Where(x => x.FiscalYear < period.FiscalYear)
                .OrderByDescending(x => x.FiscalYear)
                .FirstOrDefaultAsync(cancellationToken);

            if (prevPeriod != null)
            {
                prevPeriod.IsClosed = false;
                prevPeriod.Status = AccountingPeriodStatus.Open;
                prevPeriod.IsActive = true;
                prevPeriod.ClosedAt = null;
                prevPeriod.ClosedByUserId = null;
                _dbContext.AccountingPeriods.Update(prevPeriod);
            }

            // 2. Remove devir / opening balance entries for this period
            var relatedDevirEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => (x.IsOpeningBalance || x.TransactionType == "DEVİR") && 
                            (x.AccountingPeriodId == period.Id || (prevPeriod != null && x.SourcePeriodId == prevPeriod.Id)))
                .ToListAsync(cancellationToken);

            if (relatedDevirEntries.Count > 0)
            {
                _dbContext.CustomerLedgerEntries.RemoveRange(relatedDevirEntries);
                await _dbContext.SaveChangesAsync(cancellationToken);
            }

            // 3. Log to DeletionLogs for Silinen Kayıtlar
            var deletionLog = new DeletionLog
            {
                ModuleKey = "users",
                PageKey = "maliDonemler",
                RecordType = "AccountingPeriod",
                RecordId = period.Id.ToString(),
                Description = $"\"{period.Name}\" ({period.FiscalYear}) dönemi geri alındı. Devir kayıtları temizlendi ve {period.FiscalYear - 1} dönemi yeniden aktif edildi.",
                DetailsJson = System.Text.Json.JsonSerializer.Serialize(period),
                CreateTime = DateTime.UtcNow,
                CreateUser = period.ClosedByUserId ?? "Admin"
            };
            _dbContext.Set<DeletionLog>().Add(deletionLog);

            // 4. Remove period record
            _dbContext.AccountingPeriods.Remove(period);
            await _dbContext.SaveChangesAsync(cancellationToken);

            await tx.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await tx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task EnsurePeriodAssignedForEntryAsync(CustomerLedgerEntry entry, CancellationToken cancellationToken = default)
    {
        if (entry.AccountingPeriodId != null && entry.AccountingPeriodId > 0) return;

        var entryUtc = entry.Date.Kind == DateTimeKind.Utc ? entry.Date : DateTime.SpecifyKind(entry.Date, DateTimeKind.Utc);

        var matchingPeriod = await _dbContext.AccountingPeriods
            .AsNoTracking()
            .FirstOrDefaultAsync(x => entryUtc >= x.StartDate && entryUtc <= x.EndDate, cancellationToken);

        if (matchingPeriod != null)
        {
            entry.AccountingPeriodId = matchingPeriod.Id;
        }
    }

    public async Task<bool> IsDateInClosedPeriodAsync(DateTime date, CancellationToken cancellationToken = default)
    {
        var dateUtc = date.Kind == DateTimeKind.Utc ? date : DateTime.SpecifyKind(date, DateTimeKind.Utc);

        return await _dbContext.AccountingPeriods
            .AsNoTracking()
            .AnyAsync(x => x.IsClosed && dateUtc >= x.StartDate && dateUtc <= x.EndDate, cancellationToken);
    }
}
