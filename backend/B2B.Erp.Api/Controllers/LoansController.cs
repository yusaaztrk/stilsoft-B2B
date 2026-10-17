using System.Security.Claims;
using B2B.Erp.Api.Core.Http;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Loans;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// Taksitli banka kredileri — BİZİM bankaya olan borcumuz.
///
/// İki kural bu dosyanın tamamına hâkim:
///
/// 1. DURUM SAKLANMAZ, HESAPLANIR. Ne taksitin ne kredinin durumu veritabanına yazılır;
///    ödeme satırlarının toplamından türetilir. Yazılsaydı bir ödeme silindiğinde kayıt
///    yalan söyler ve birinin elle düzeltmesi gerekirdi.
///
/// 2. ÖDEME BANKA BAKİYESİNE İŞLER. Her taksit ödemesi bir <see cref="BankAccountTransaction"/>
///    üretir. Üretmeseydi kredi ekranı "ödedim" derken banka raporu parayı hâlâ hesapta
///    gösterirdi — iki ayrı gerçek.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class LoansController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly IMoneyServiceClient _money;


    /// <summary>
    /// FİRMANIN SAATİ (2026-08-20 kullanıcı kararı, denetim md. D1). "Bugün" UTC takvim
    /// gününden okunuyordu; KKTC (UTC+3) gibi bir yerde yerel 00:00–03:00 arasında yapılan
    /// işlem BİR ÖNCEKİ güne damgalanıyordu.
    /// </summary>
    private readonly B2B.Erp.Api.Core.Helpers.CompanyClock _clock;

    public LoansController(
        AppDbContext dbContext,
        IMoneyServiceClient money,
        B2B.Erp.Api.Core.Helpers.CompanyClock clock)
    {
        _dbContext = dbContext;
        _money = money;
        _clock = clock;
    }

    // Kuruş toleransı: ödeme toplamı taksit tutarına bu kadar yaklaştıysa "tam ödendi" sayılır.
    // Elle düzeltilmiş planlarda yuvarlama farkı kaçınılmaz; tolerans olmadan taksit
    // 0,004 kuruş yüzünden sonsuza kadar "kısmi" kalırdı.
    private const decimal Epsilon = 0.005m;

    // ---------------------------------------------------------------- yardımcılar

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt == default) return DateTime.UtcNow;
        return dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }

    private string CurrentUser() => User.FindFirst(ClaimTypes.Name)?.Value ?? User.Identity?.Name ?? string.Empty;

    private static string? Trimmed(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// BSİV oranını makul aralığa çeker.
    ///
    /// Negatif oran taksiti azaltır, üç haneli oran krediyi anlamsız hâle getirir; ikisi de
    /// sessizce kabul edilirse plan üretimi saçma rakamlar döndürür ve sebebi görünmez.
    /// </summary>
    private static decimal NormalizeBsivRate(decimal rate)
        => rate < 0m ? 0m : (rate > 100m ? 100m : rate);

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

        return ids;
    }

    /// <summary>Bankaların faizde kullandığı gün tabanı. KKTC'de gördüğümüz altı planın hepsi 360.</summary>
    private const decimal DayBasis = 360m;

    /// <summary>
    /// Taksit vadeleri. Ay ekleyerek ilerler; ayın 31'i gibi bir gün sonraki ayda yoksa
    /// <see cref="DateTime.AddMonths"/> ayın son gününe çeker — bankaların yaptığı da bu.
    /// </summary>
    private static List<DateTime> BuildDueDates(DateTime firstDueDate, int count)
    {
        var first = NormalizeUtc(firstDueDate);
        var dates = new List<DateTime>(count);
        for (var i = 0; i < count; i++) dates.Add(first.AddMonths(i));
        return dates;
    }

    /// <summary>
    /// Verilen taksit tutarıyla planı yürütür ve son bakiyeyi döner.
    ///
    /// Faiz GÜN SAYIMLI: her dönem için <c>bakiye × yıllık oran × gün / 360</c>. Bankanın
    /// belgesindeki rakamlar bu şekilde çıkıyor — düz "yıllık/12" ilk taksitte tutmuyor, çünkü
    /// kullandırım ile ilk vade arası çoğu zaman 30 gün değil (örnek: 02.12.2024 → 10.01.2025,
    /// 39 gün).
    /// </summary>
    private static decimal RunSchedule(
        decimal principal,
        decimal annualRate,
        decimal bsivRate,
        DateTime startDate,
        IReadOnlyList<DateTime> dueDates,
        decimal payment,
        List<LoanInstallment>? output)
    {
        var balance = principal;
        var periodStart = NormalizeUtc(startDate);

        for (var i = 0; i < dueDates.Count; i++)
        {
            var due = dueDates[i];
            var days = (decimal)Math.Max(0, (due.Date - periodStart.Date).TotalDays);

            var interest = Math.Round(balance * annualRate * days / DayBasis, 2, MidpointRounding.AwayFromZero);
            if (interest < 0m) interest = 0m;

            var bsiv = Math.Round(interest * bsivRate, 2, MidpointRounding.AwayFromZero);

            // Taksit anapara + faiz + BSİV'i birlikte kapatıyor; bankanın tablosunda da
            // "Taksit" kolonu üçünün toplamı.
            var principalPart = payment - interest - bsiv;
            var amount = payment;

            if (i == dueDates.Count - 1 && output is not null)
            {
                // Son satır yuvarlama artığını kapatır: aksi hâlde toplam anaparayı birkaç
                // kuruş tutmaz ve "kalan borç" hiç sıfırlanmaz.
                principalPart = balance;
                amount = principalPart + interest + bsiv;
            }

            balance = Math.Round(balance - principalPart, 2, MidpointRounding.AwayFromZero);

            output?.Add(new LoanInstallment
            {
                InstallmentNo = i + 1,
                DueDate = due,
                Amount = amount,
                PrincipalPart = principalPart,
                InterestPart = interest,
                BsivPart = bsiv
            });

            periodStart = due;
        }

        return balance;
    }

    /// <summary>
    /// Eşit taksitli plan üretir — bankanın verdiği tabloyla aynı mantıkta.
    ///
    /// ÜÇ ŞEY KAPALI FORMÜLLE ÇÖZÜLEMİYOR, o yüzden taksit tutarı ikili aramayla bulunuyor:
    ///   1. Faiz gün sayımlı (actual/360) ve dönemler eşit uzunlukta değil (28–39 gün).
    ///   2. BSİV faizin yüzdesi, yani her dönem farklı, ama taksit tutarı sabit.
    ///   3. Yuvarlama her satırda kuruşa iniyor.
    /// Klasik anüite formülü bunların hiçbirini karşılamıyordu; eski hâli ilk taksitte
    /// bankanın rakamını hiçbir zaman tutturamıyordu.
    ///
    /// Arama, "son bakiye sıfır" olacak taksit tutarını arıyor. Bakiye taksit tutarına göre
    /// azalan (monoton) bir fonksiyon, dolayısıyla ikili arama güvenli.
    ///
    /// Faiz oranı yıllık verilmişse öyle kullanılır; aylık verilmişse 12 ile çarpılıp yıllığa
    /// çevrilir — hangisi olduğu <see cref="Loan.InterestRatePeriod"/> alanında yazılı, tahmin
    /// edilirse plan 12 kat yanlış çıkar.
    /// </summary>
    private static List<LoanInstallment> BuildSchedule(
        decimal principal,
        decimal ratePercent,
        LoanInterestRatePeriod period,
        int count,
        DateTime startDate,
        DateTime firstDueDate,
        decimal bsivRatePercent,
        decimal fixedPayment = 0m)
    {
        var result = new List<LoanInstallment>();
        if (count <= 0 || principal <= 0) return result;

        // Gün sayımı yıllık oranla çalışıyor; aylık girilen oran yıllığa çevriliyor.
        var annualRate = period == LoanInterestRatePeriod.Annual
            ? ratePercent / 100m
            : ratePercent / 100m * 12m;
        if (annualRate < 0m) annualRate = 0m;

        var bsivRate = bsivRatePercent <= 0m ? 0m : bsivRatePercent / 100m;

        var dueDates = BuildDueDates(firstDueDate, count);

        decimal payment;
        if (fixedPayment > 0m)
        {
            // Banka taksit tutarını belgesinde veriyor; verildiyse aranmaz. Üretilen planın
            // faiz/BSİV satırları zaten bankanınkiyle aynı, tek belirsiz olan buydu.
            payment = fixedPayment;
        }
        else if (annualRate <= 0m)
        {
            // Faizsiz kredi: taksit anaparanın eşit bölümü, arama gereksiz.
            payment = Math.Round(principal / count, 2, MidpointRounding.AwayFromZero);
        }
        else
        {
            // Alt sınır: anaparayı taksite bölen tutar. Faiz ve BSİV'i hiç karşılamadığı için
            // bakiye kesin pozitif kalır.
            var low = principal / count;

            // Üst sınır: anaparanın tamamını + vade boyunca birikebilecek en fazla faizi +
            // BSİV'ini TEK taksitte kapatacak tutar. Hiçbir eşit taksit bundan büyük olamaz.
            var totalDays = (decimal)Math.Max(1, (dueDates[^1].Date - NormalizeUtc(startDate).Date).TotalDays);
            var high = principal * (1m + annualRate * totalDays / DayBasis) * (1m + bsivRate) + 1m;

            // 80 tur, decimal hassasiyetinde aralığı kuruşun çok altına indiriyor.
            for (var iteration = 0; iteration < 80; iteration++)
            {
                var mid = (low + high) / 2m;
                var closing = RunSchedule(principal, annualRate, bsivRate, startDate, dueDates, mid, null);
                if (closing > 0m) low = mid; else high = mid;
            }

            payment = Math.Round((low + high) / 2m, 2, MidpointRounding.AwayFromZero);
        }

        RunSchedule(principal, annualRate, bsivRate, startDate, dueDates, payment, result);
        return result;
    }

    private async Task<string> GenerateLoanCodeAsync(DateTime startDate, CancellationToken cancellationToken)
    {
        var year = (startDate == default ? DateTime.UtcNow : startDate).Year;
        var prefix = $"KRD-{year}-";

        var lastCode = await _dbContext.Loans
            .AsNoTracking()
            .Where(x => x.LoanCode.StartsWith(prefix))
            .OrderByDescending(x => x.LoanCode)
            .Select(x => x.LoanCode)
            .FirstOrDefaultAsync(cancellationToken);

        var next = 1;
        if (!string.IsNullOrWhiteSpace(lastCode))
        {
            var tail = lastCode.Substring(prefix.Length);
            if (int.TryParse(tail, out var parsed)) next = parsed + 1;
        }

        return prefix + next.ToString("D4");
    }

    private static LoanInstallmentStatusDto ResolveInstallmentStatus(decimal amount, decimal paid, DateTime dueDate, DateTime today)
    {
        if (paid >= amount - Epsilon) return LoanInstallmentStatusDto.Paid;
        if (dueDate.Date < today) return LoanInstallmentStatusDto.Overdue;
        if (paid > 0m) return LoanInstallmentStatusDto.Partial;
        return LoanInstallmentStatusDto.Pending;
    }

    /// <summary>
    /// Kredi kartını DTO'ya çevirir ve bütün toplamları hesaplar.
    /// Tek yer: liste, detay ve özet uçları aynı hesabı kullansın diye.
    /// </summary>
    private static LoanDetailDto MapLoan(
        Loan loan,
        IReadOnlyList<LoanInstallment> installments,
        ILookup<int, LoanPayment> paymentsByInstallment,
        IReadOnlyDictionary<int, (string AccountName, string BankName)> bankNames,
        DateTime today,
        bool includeInstallments)
    {
        bankNames.TryGetValue(loan.BankAccountDefinitionId, out var bank);

        var dto = new LoanDetailDto
        {
            Id = loan.Id,
            LoanCode = loan.LoanCode,
            ContractNo = loan.ContractNo,
            BankAccountDefinitionId = loan.BankAccountDefinitionId,
            BankAccountName = bank.AccountName ?? string.Empty,
            BankName = bank.BankName ?? string.Empty,
            PrincipalAmount = loan.PrincipalAmount,
            CurrencyTypeId = CurrencyTypeHelper.Normalize(loan.CurrencyTypeId),
            CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(loan.CurrencyTypeId),
            InterestRate = loan.InterestRate,
            InterestRatePeriod = loan.InterestRatePeriod,
            InstallmentCount = loan.InstallmentCount,
            StartDate = loan.StartDate,
            FirstInstallmentDate = loan.FirstInstallmentDate,
            EndDate = loan.EndDate,
            BsivRate = loan.BsivRate,
            InstallmentAmount = loan.InstallmentAmount,
            AccountNo = loan.AccountNo,
            Iban = loan.Iban,
            ProductName = loan.ProductName,
            CustomerCrmNo = loan.CustomerCrmNo,
            PlanType = loan.PlanType,
            CapitalizePeriod = loan.CapitalizePeriod,
            Fees = loan.Fees,
            Description = loan.Description,
            ClosedAt = loan.ClosedAt,
            CancelledAt = loan.CancelledAt
        };

        DateTime? nextDue = null;
        var nextDueAmount = 0m;

        // Yürüyen anapara bakiyesi. Bankanın tablosundaki "Kalan Anapara" / "Bakiye" kolonu:
        // ödemeye değil PLANA bağlı, yani o taksit ödendiğinde borcun ne olacağını gösterir.
        var runningBalance = installments.Sum(x => x.PrincipalPart);

        foreach (var inst in installments.OrderBy(x => x.InstallmentNo))
        {
            var payments = paymentsByInstallment[inst.Id].ToList();
            var paid = payments.Sum(p => p.Amount);
            var remaining = Math.Max(0m, inst.Amount - paid);
            var status = ResolveInstallmentStatus(inst.Amount, paid, inst.DueDate, today);
            var burden = inst.InterestPart + inst.BsivPart;

            runningBalance = Math.Round(runningBalance - inst.PrincipalPart, 2, MidpointRounding.AwayFromZero);

            dto.TotalPayable += inst.Amount;
            dto.TotalInterest += inst.InterestPart;
            dto.TotalBsiv += inst.BsivPart;
            dto.PaidAmount += paid;
            dto.RemainingAmount += remaining;
            dto.PaidTryAmount += payments.Sum(p => p.TryAmount);

            // Ödeme ÖNCE faiz + BSİV'e sayılır (bankaların yaptığı da bu), artan anaparaya
            // gider. Kısmi ödemede "ne kadarı faize gitti" sorusunun tek dürüst cevabı bu.
            var paidBurden = Math.Min(paid, burden);
            dto.PaidInterest += Math.Min(paid, inst.InterestPart);
            dto.PaidBsiv += Math.Max(0m, paidBurden - inst.InterestPart);

            if (status == LoanInstallmentStatusDto.Paid)
            {
                dto.PaidInstallmentCount++;
            }
            else
            {
                dto.RemainingPrincipal += Math.Max(0m, inst.PrincipalPart - Math.Max(0m, paid - burden));
            }

            if (status == LoanInstallmentStatusDto.Overdue)
            {
                dto.OverdueInstallmentCount++;
                dto.OverdueAmount += remaining;
            }

            if (remaining > Epsilon && nextDue is null)
            {
                nextDue = inst.DueDate;
                nextDueAmount = remaining;
            }

            if (includeInstallments)
            {
                // "Ödendiği tarih" YALNIZCA kapanmış taksitte dolu — bankanın belgesinde de
                // öyle. Kısmi ödemede son ödeme tarihini buraya yazmak, taksit kapanmış gibi
                // görünmesine yol açardı.
                var paidDate = status == LoanInstallmentStatusDto.Paid && payments.Count > 0
                    ? payments.Max(p => p.Date)
                    : (DateTime?)null;

                // Geç/erken gün: kapanmışsa kapandığı güne göre, kapanmamışsa bugüne göre
                // (yalnızca vadesi geçmişse; gelecekteki taksit için "erken" diye bir şey yok).
                int? lateDays = null;
                if (paidDate.HasValue)
                {
                    lateDays = (int)(paidDate.Value.Date - inst.DueDate.Date).TotalDays;
                }
                else if (inst.DueDate.Date < today)
                {
                    lateDays = (int)(today - inst.DueDate.Date).TotalDays;
                }

                dto.Installments.Add(new LoanInstallmentDto
                {
                    Id = inst.Id,
                    InstallmentNo = inst.InstallmentNo,
                    DueDate = inst.DueDate,
                    Amount = inst.Amount,
                    PrincipalPart = inst.PrincipalPart,
                    InterestPart = inst.InterestPart,
                    BsivPart = inst.BsivPart,
                    PaidInterestWithBsiv = paidBurden,
                    PaidAmount = paid,
                    RemainingAmount = remaining,
                    PaidDate = paidDate,
                    LateDays = lateDays,
                    RunningBalance = runningBalance,
                    LastPaymentDate = payments.Count == 0 ? null : payments.Max(p => p.Date),
                    Status = status,
                    Payments = payments
                        .OrderBy(p => p.Date).ThenBy(p => p.Id)
                        .Select(p =>
                        {
                            bankNames.TryGetValue(p.BankAccountDefinitionId, out var pb);
                            return new LoanPaymentDto
                            {
                                Id = p.Id,
                                LoanInstallmentId = p.LoanInstallmentId,
                                InstallmentNo = inst.InstallmentNo,
                                Date = p.Date,
                                Amount = p.Amount,
                                CurrencyRate = p.CurrencyRate,
                                TryAmount = p.TryAmount,
                                BankAccountDefinitionId = p.BankAccountDefinitionId,
                                BankAccountName = pb.AccountName ?? string.Empty,
                                BankAccountTransactionId = p.BankAccountTransactionId,
                                Description = p.Description
                            };
                        })
                        .ToList()
                });
            }
        }

        dto.NextDueDate = nextDue;
        dto.NextDueAmount = nextDueAmount;

        // Durum HESAPLANIYOR. ClosedAt yalnızca erken kapatmada dolu olur; normal bitişte
        // "ödenmemiş taksit kalmadı" yeterlidir.
        if (loan.CancelledAt.HasValue)
        {
            dto.Status = LoanStatusDto.Cancelled;
        }
        else if (loan.ClosedAt.HasValue || (installments.Count > 0 && dto.RemainingAmount <= Epsilon))
        {
            dto.Status = LoanStatusDto.Closed;
        }
        else
        {
            dto.Status = LoanStatusDto.Active;
        }

        return dto;
    }

    private async Task<(List<Loan> Loans,
                        List<LoanInstallment> Installments,
                        ILookup<int, LoanPayment> Payments,
                        Dictionary<int, (string, string)> BankNames)>
        LoadAsync(int? loanId, CancellationToken cancellationToken)
    {
        var loanQuery = _dbContext.Loans.AsNoTracking();
        if (loanId.HasValue) loanQuery = loanQuery.Where(x => x.Id == loanId.Value);

        var loans = await loanQuery.OrderByDescending(x => x.StartDate).ThenByDescending(x => x.Id).ToListAsync(cancellationToken);
        var ids = loans.Select(x => x.Id).ToList();

        var installments = await _dbContext.LoanInstallments
            .AsNoTracking()
            .Where(x => ids.Contains(x.LoanId))
            .ToListAsync(cancellationToken);

        var payments = await _dbContext.LoanPayments
            .AsNoTracking()
            .Where(x => ids.Contains(x.LoanId))
            .ToListAsync(cancellationToken);

        var bankIds = loans.Select(x => x.BankAccountDefinitionId)
            .Concat(payments.Select(x => x.BankAccountDefinitionId))
            .Distinct()
            .ToList();

        var bankNames = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Where(x => bankIds.Contains(x.Id))
            .Select(x => new { x.Id, x.AccountName, BankName = x.BankDetail != null ? x.BankDetail.Name : string.Empty })
            .ToDictionaryAsync(x => x.Id, x => (x.AccountName ?? string.Empty, x.BankName ?? string.Empty), cancellationToken);

        return (loans, installments, payments.ToLookup(x => x.LoanInstallmentId), bankNames);
    }

    // ---------------------------------------------------------------- okuma uçları

    [HttpGet]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> List([FromQuery] string? status, CancellationToken cancellationToken)
    {
        var (loans, installments, payments, bankNames) = await LoadAsync(null, cancellationToken);
        var today = _clock.TodayCompanyDate();
        var byLoan = installments.ToLookup(x => x.LoanId);

        var items = loans
            .Select(l => (LoanListItemDto)MapLoan(l, byLoan[l.Id].ToList(), payments, bankNames, today, includeInstallments: false))
            .ToList();

        var filter = (status ?? string.Empty).Trim().ToLowerInvariant();
        if (filter is "active" or "aktif") items = items.Where(x => x.Status == LoanStatusDto.Active).ToList();
        else if (filter is "closed" or "kapali" or "kapalı") items = items.Where(x => x.Status == LoanStatusDto.Closed).ToList();
        else if (filter is "cancelled" or "iptal") items = items.Where(x => x.Status == LoanStatusDto.Cancelled).ToList();

        return Ok(new { success = true, data = items });
    }

    [HttpGet("{id:int}")]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> Detail([FromRoute] int id, CancellationToken cancellationToken)
    {
        var (loans, installments, payments, bankNames) = await LoadAsync(id, cancellationToken);
        var loan = loans.FirstOrDefault();
        if (loan is null) return NotFound(new { success = false, message = "Kredi bulunamadı." });

        var dto = MapLoan(loan, installments, payments, bankNames, _clock.TodayCompanyDate(), includeInstallments: true);
        return Ok(new { success = true, data = dto });
    }

    /// <summary>Ekran üstündeki özet kartlar. Para birimleri TOPLANMAZ — ayrı satır döner.</summary>
    [HttpGet("summary")]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> Summary(CancellationToken cancellationToken)
    {
        var (loans, installments, payments, bankNames) = await LoadAsync(null, cancellationToken);
        var today = _clock.TodayCompanyDate();
        var monthStart = new DateTime(today.Year, today.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var monthEnd = monthStart.AddMonths(1);
        var byLoan = installments.ToLookup(x => x.LoanId);

        var summaries = new Dictionary<int, LoanSummaryDto>();

        foreach (var loan in loans)
        {
            var loanInstallments = byLoan[loan.Id].ToList();
            var dto = MapLoan(loan, loanInstallments, payments, bankNames, today, includeInstallments: false);
            if (dto.Status == LoanStatusDto.Cancelled) continue;

            var key = dto.CurrencyTypeId;
            if (!summaries.TryGetValue(key, out var sum))
            {
                sum = new LoanSummaryDto { CurrencyTypeId = key, CurrencyCode = dto.CurrencyCode };
                summaries[key] = sum;
            }

            sum.TotalRemaining += dto.RemainingAmount;
            sum.Overdue += dto.OverdueAmount;
            sum.PaidInterest += dto.PaidInterest;
            if (dto.Status == LoanStatusDto.Active) sum.ActiveLoanCount++;

            foreach (var inst in loanInstallments.Where(x => x.DueDate >= monthStart && x.DueDate < monthEnd))
            {
                var paid = payments[inst.Id].Sum(p => p.Amount);
                sum.DueThisMonth += Math.Max(0m, inst.Amount - paid);
            }
        }

        return Ok(new { success = true, data = summaries.Values.OrderBy(x => x.CurrencyTypeId).ToList() });
    }

    /// <summary>
    /// Kredi Vade Takvimi: ay ay nakit çıkışı. Kredi takibinin asıl değeri burada —
    /// "önümüzdeki üç ay kasadan ne çıkacak" sorusunun tek cevabı.
    /// </summary>
    [HttpGet("schedule")]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> Schedule(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken)
    {
        var (loans, installments, payments, _) = await LoadAsync(null, cancellationToken);

        // İptal edilmiş krediler takvime girmez: ödenecek bir şey yok.
        var activeLoanIds = loans.Where(x => !x.CancelledAt.HasValue).Select(x => x.Id).ToHashSet();
        var currencyByLoan = loans.ToDictionary(x => x.Id, x => CurrencyTypeHelper.Normalize(x.CurrencyTypeId));

        var rows = new Dictionary<(int Year, int Month, int Currency), LoanScheduleMonthDto>();

        foreach (var inst in installments.Where(x => activeLoanIds.Contains(x.LoanId)))
        {
            if (from.HasValue && inst.DueDate < NormalizeUtc(from.Value)) continue;
            if (to.HasValue && inst.DueDate > NormalizeUtc(to.Value)) continue;

            var currency = currencyByLoan.TryGetValue(inst.LoanId, out var c) ? c : CurrencyTypeHelper.Try;
            var key = (inst.DueDate.Year, inst.DueDate.Month, currency);

            if (!rows.TryGetValue(key, out var row))
            {
                row = new LoanScheduleMonthDto
                {
                    Year = inst.DueDate.Year,
                    Month = inst.DueDate.Month,
                    CurrencyTypeId = currency,
                    CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(currency)
                };
                rows[key] = row;
            }

            var paid = payments[inst.Id].Sum(p => p.Amount);

            row.TotalDue += inst.Amount;
            row.PrincipalDue += inst.PrincipalPart;
            row.InterestDue += inst.InterestPart;
            row.BsivDue += inst.BsivPart;
            row.Paid += paid;
            row.Remaining += Math.Max(0m, inst.Amount - paid);
            row.InstallmentCount++;
        }

        var result = rows.Values
            .OrderBy(x => x.Year).ThenBy(x => x.Month).ThenBy(x => x.CurrencyTypeId)
            .ToList();

        return Ok(new { success = true, data = result });
    }

    // ---------------------------------------------------------------- yazma uçları

    [HttpPost]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> Create([FromBody] CreateLoanRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var bankAcc = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == request.BankAccountDefinitionId, cancellationToken);

        if (bankAcc is null) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı." });

        var currencyTypeId = CurrencyTypeHelper.Normalize(
            request.CurrencyTypeId <= 0 ? bankAcc.CurrencyTypeId : request.CurrencyTypeId);

        if (CurrencyTypeHelper.ToCode(currencyTypeId) is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz para birimi." });
        }

        var startDate = NormalizeUtc(request.StartDate);
        var firstDue = request.FirstInstallmentDate == default
            ? startDate.AddMonths(1)
            : NormalizeUtc(request.FirstInstallmentDate);

        if (firstDue < startDate)
        {
            return BadRequest(new { success = false, message = "İlk taksit tarihi, kullandırım tarihinden önce olamaz." });
        }

        var now = DateTime.UtcNow;
        var user = CurrentUser();

        var loan = new Loan
        {
            LoanCode = string.IsNullOrWhiteSpace(request.LoanCode)
                ? await GenerateLoanCodeAsync(startDate, cancellationToken)
                : request.LoanCode.Trim(),
            ContractNo = string.IsNullOrWhiteSpace(request.ContractNo) ? null : request.ContractNo.Trim(),
            BankAccountDefinitionId = request.BankAccountDefinitionId,
            PrincipalAmount = request.PrincipalAmount,
            CurrencyTypeId = currencyTypeId,
            InterestRate = request.InterestRate,
            InterestRatePeriod = request.InterestRatePeriod,
            InstallmentCount = request.InstallmentCount,
            StartDate = startDate,
            FirstInstallmentDate = firstDue,
            BsivRate = NormalizeBsivRate(request.BsivRate),
            InstallmentAmount = request.InstallmentAmount < 0m ? 0m : request.InstallmentAmount,
            AccountNo = Trimmed(request.AccountNo),
            Iban = Trimmed(request.Iban),
            ProductName = Trimmed(request.ProductName),
            CustomerCrmNo = Trimmed(request.CustomerCrmNo),
            PlanType = Trimmed(request.PlanType),
            CapitalizePeriod = Trimmed(request.CapitalizePeriod),
            Fees = request.Fees,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = user,
            CreateTime = now
        };

        var schedule = BuildSchedule(
            request.PrincipalAmount,
            request.InterestRate,
            request.InterestRatePeriod,
            request.InstallmentCount,
            startDate,
            firstDue,
            loan.BsivRate,
            loan.InstallmentAmount);

        foreach (var inst in schedule)
        {
            inst.CreateUser = user;
            inst.CreateTime = now;
            loan.Installments.Add(inst);
        }

        // Vade sonu elle verilmediyse plandan alınır: banka belgesinde ayrı bir alan ve
        // kullanıcının onu ayrıca yazmak zorunda kalması gereksiz.
        loan.EndDate = request.EndDate.HasValue
            ? NormalizeUtc(request.EndDate.Value)
            : (schedule.Count > 0 ? schedule[^1].DueDate : (DateTime?)null);

        _dbContext.Loans.Add(loan);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = loan.Id, loanCode = loan.LoanCode } });
    }

    [AtomicRequest]
    [HttpPut("{id:int}")]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] UpdateLoanRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var loan = await _dbContext.Loans
            .Include(x => x.Installments)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (loan is null) return NotFound(new { success = false, message = "Kredi bulunamadı." });

        var hasPayments = await _dbContext.LoanPayments.AnyAsync(x => x.LoanId == id, cancellationToken);

        var startDate = NormalizeUtc(request.StartDate);
        var firstDue = request.FirstInstallmentDate == default
            ? startDate.AddMonths(1)
            : NormalizeUtc(request.FirstInstallmentDate);

        if (firstDue < startDate)
        {
            return BadRequest(new { success = false, message = "İlk taksit tarihi, kullandırım tarihinden önce olamaz." });
        }

        var currencyTypeId = CurrencyTypeHelper.Normalize(request.CurrencyTypeId);
        if (CurrencyTypeHelper.ToCode(currencyTypeId) is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz para birimi." });
        }

        if (hasPayments && currencyTypeId != CurrencyTypeHelper.Normalize(loan.CurrencyTypeId))
        {
            return BadRequest(new
            {
                success = false,
                message = "Ödemesi olan kredinin para birimi değiştirilemez. Ödemeler eski para biriminde kaydedildi."
            });
        }

        loan.ContractNo = string.IsNullOrWhiteSpace(request.ContractNo) ? null : request.ContractNo.Trim();
        loan.BankAccountDefinitionId = request.BankAccountDefinitionId;
        loan.PrincipalAmount = request.PrincipalAmount;
        loan.CurrencyTypeId = currencyTypeId;
        loan.InterestRate = request.InterestRate;
        loan.InterestRatePeriod = request.InterestRatePeriod;
        loan.InstallmentCount = request.InstallmentCount;
        loan.StartDate = startDate;
        loan.FirstInstallmentDate = firstDue;
        loan.BsivRate = NormalizeBsivRate(request.BsivRate);
        loan.InstallmentAmount = request.InstallmentAmount < 0m ? 0m : request.InstallmentAmount;
        loan.AccountNo = Trimmed(request.AccountNo);
        loan.Iban = Trimmed(request.Iban);
        loan.ProductName = Trimmed(request.ProductName);
        loan.CustomerCrmNo = Trimmed(request.CustomerCrmNo);
        loan.PlanType = Trimmed(request.PlanType);
        loan.CapitalizePeriod = Trimmed(request.CapitalizePeriod);
        loan.Fees = request.Fees;
        loan.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        loan.EditUser = CurrentUser();
        loan.EditTime = DateTime.UtcNow;

        if (request.EndDate.HasValue) loan.EndDate = NormalizeUtc(request.EndDate.Value);

        if (request.RegenerateSchedule)
        {
            // Ödeme varsa plan YENİDEN ÜRETİLMEZ: taksitler silinince ödemeler de kaskatla
            // giderdi ve banka hareketleri sahipsiz kalırdı.
            if (hasPayments)
            {
                return BadRequest(new
                {
                    success = false,
                    message = "Ödemesi olan kredinin taksit planı yeniden üretilemez. Önce ödemeleri geri alın."
                });
            }

            _dbContext.LoanInstallments.RemoveRange(loan.Installments);
            await _dbContext.SaveChangesAsync(cancellationToken);

            var now = DateTime.UtcNow;
            var user = CurrentUser();
            var regenerated = BuildSchedule(
                request.PrincipalAmount,
                request.InterestRate,
                request.InterestRatePeriod,
                request.InstallmentCount,
                startDate,
                firstDue,
                loan.BsivRate,
                loan.InstallmentAmount);

            foreach (var inst in regenerated)
            {
                inst.LoanId = loan.Id;
                inst.CreateUser = user;
                inst.CreateTime = now;
                _dbContext.LoanInstallments.Add(inst);
            }

            // Vade sonu elle verilmediyse yeni plandan güncellenir.
            if (!request.EndDate.HasValue && regenerated.Count > 0)
            {
                loan.EndDate = regenerated[^1].DueDate;
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    /// <summary>Tek taksit satırını düzeltir — bankanın verdiği tabloya birebir oturtmak için.</summary>
    [HttpPut("{loanId:int}/installments/{installmentId:int}")]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> UpdateInstallment(
        [FromRoute] int loanId,
        [FromRoute] int installmentId,
        [FromBody] UpdateLoanInstallmentRequest request,
        CancellationToken cancellationToken)
    {
        var inst = await _dbContext.LoanInstallments
            .FirstOrDefaultAsync(x => x.Id == installmentId && x.LoanId == loanId, cancellationToken);

        if (inst is null) return NotFound(new { success = false, message = "Taksit bulunamadı." });

        if (request.Amount < 0 || request.PrincipalPart < 0 || request.InterestPart < 0 || request.BsivPart < 0)
        {
            return BadRequest(new { success = false, message = "Tutarlar negatif olamaz." });
        }

        var paid = await _dbContext.LoanPayments
            .Where(x => x.LoanInstallmentId == installmentId)
            .SumAsync(x => (decimal?)x.Amount, cancellationToken) ?? 0m;

        if (request.Amount < paid - Epsilon)
        {
            return BadRequest(new
            {
                success = false,
                message = $"Taksit tutarı, bu taksite yapılmış {paid:N2} tutarındaki ödemeden küçük olamaz."
            });
        }

        inst.DueDate = NormalizeUtc(request.DueDate);
        inst.Amount = request.Amount;
        inst.PrincipalPart = request.PrincipalPart;
        inst.InterestPart = request.InterestPart;
        inst.BsivPart = request.BsivPart;
        inst.EditUser = CurrentUser();
        inst.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    /// <summary>
    /// Taksit ödemesi. Kısmi ödemeye izin verilir (kullanıcı kararı, 2026-08-12).
    /// Banka hareketiyle BİRLİKTE, tek veritabanı işleminde yazılır.
    /// </summary>
    [HttpPost("{loanId:int}/payments")]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> Pay(
        [FromRoute] int loanId,
        [FromBody] CreateLoanPaymentRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var loan = await _dbContext.Loans.FirstOrDefaultAsync(x => x.Id == loanId, cancellationToken);
        if (loan is null) return NotFound(new { success = false, message = "Kredi bulunamadı." });
        if (loan.CancelledAt.HasValue) return BadRequest(new { success = false, message = "İptal edilmiş krediye ödeme yapılamaz." });

        var inst = await _dbContext.LoanInstallments
            .FirstOrDefaultAsync(x => x.Id == request.LoanInstallmentId && x.LoanId == loanId, cancellationToken);

        if (inst is null) return NotFound(new { success = false, message = "Taksit bulunamadı." });

        var alreadyPaid = await _dbContext.LoanPayments
            .Where(x => x.LoanInstallmentId == inst.Id)
            .SumAsync(x => (decimal?)x.Amount, cancellationToken) ?? 0m;

        var remaining = Math.Round(inst.Amount - alreadyPaid, 2, MidpointRounding.AwayFromZero);
        if (remaining <= Epsilon)
        {
            return BadRequest(new { success = false, message = "Bu taksit zaten kapalı." });
        }

        var amount = request.Amount <= 0m ? remaining : Math.Round(request.Amount, 2, MidpointRounding.AwayFromZero);
        if (amount > remaining + Epsilon)
        {
            return BadRequest(new
            {
                success = false,
                message = $"Ödeme tutarı taksitin kalanından ({remaining:N2}) fazla olamaz."
            });
        }

        var bankAccountId = request.BankAccountDefinitionId ?? loan.BankAccountDefinitionId;

        var allowedBankIds = await GetUserAssignedBankAccountIdsAsync(cancellationToken);
        if (allowedBankIds != null && !allowedBankIds.Contains(bankAccountId))
        {
            return StatusCode(403, new
            {
                success = false,
                message = "Atanan banka hesaplarınız haricinde başka bir hesaptan ödeme yapma yetkiniz bulunmamaktadır."
            });
        }

        var bankAcc = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .Select(x => new { x.Id, x.AccountCode, x.AccountName, x.CurrencyTypeId })
            .FirstOrDefaultAsync(x => x.Id == bankAccountId, cancellationToken);

        if (bankAcc is null) return BadRequest(new { success = false, message = "Banka hesabı bulunamadı." });

        var loanCurrency = CurrencyTypeHelper.Normalize(loan.CurrencyTypeId);
        var accountCurrency = CurrencyTypeHelper.Normalize(bankAcc.CurrencyTypeId);

        // İzin verilen iki durum: hesap kredinin para biriminde, ya da TL hesaptan döviz
        // krediye ödeme (kur girilir). Üçüncü bir kombinasyon (EUR hesaptan USD kredi)
        // iki ayrı kur ister; sessizce yanlış tutar yazmaktansa reddediliyor.
        var sameCurrency = accountCurrency == loanCurrency;
        var tryAccountForeignLoan = CurrencyTypeHelper.IsTry(accountCurrency) && !CurrencyTypeHelper.IsTry(loanCurrency);

        if (!sameCurrency && !tryAccountForeignLoan)
        {
            return BadRequest(new
            {
                success = false,
                message = $"Kredi {CurrencyTypeHelper.ToCodeOrTry(loanCurrency)}, seçilen hesap {CurrencyTypeHelper.ToCodeOrTry(accountCurrency)}. "
                          + "Ödeme ya kredinin para birimindeki bir hesaptan ya da TL hesaptan yapılabilir."
            });
        }

        // Kredinin para biriminin TL karşılığı.
        var currencyRate = 1m;
        if (!CurrencyTypeHelper.IsTry(loanCurrency))
        {
            currencyRate = request.CurrencyRate;
            if (currencyRate <= 0)
            {
                var code = CurrencyTypeHelper.ToCode(loanCurrency);
                try
                {
                    currencyRate = await _money.GetLatestTryRateAsync(code!, cancellationToken);
                }
                catch
                {
                    currencyRate = 0m;
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

        var tryAmount = Math.Round(amount * currencyRate, 2, MidpointRounding.AwayFromZero);

        // Banka hareketi kuralı: Amount TL cinsinden, CurrencyAmount hesabın para biriminde.
        var accountAmount = CurrencyTypeHelper.IsTry(accountCurrency) ? tryAmount : amount;
        var accountRate = CurrencyTypeHelper.IsTry(accountCurrency) ? 1m : currencyRate;

        var now = DateTime.UtcNow;
        var user = CurrentUser();
        var paymentDate = NormalizeUtc(request.Date);

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var bankTx = new BankAccountTransaction
        {
            BankAccountDefinitionId = bankAccountId,
            Date = paymentDate,
            Direction = BankAccountTransactionDirection.Out,
            Amount = tryAmount,
            CurrencyTypeId = accountCurrency,
            CurrencyRate = accountRate,
            CurrencyAmount = accountAmount,
            CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
            CounterpartyCode = loan.LoanCode,
            CounterpartyName = string.IsNullOrWhiteSpace(loan.ContractNo)
                ? $"Kredi taksiti - {loan.LoanCode}"
                : $"Kredi taksiti - {loan.LoanCode} ({loan.ContractNo})",
            MaturityDate = inst.DueDate,
            Description = string.IsNullOrWhiteSpace(request.Description)
                ? $"Kredi taksit ödemesi ({inst.InstallmentNo}/{loan.InstallmentCount}) - {loan.LoanCode}"
                : request.Description.Trim(),
            CreateUser = user,
            CreateTime = now
        };

        _dbContext.BankAccountTransactions.Add(bankTx);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var payment = new LoanPayment
        {
            LoanId = loan.Id,
            LoanInstallmentId = inst.Id,
            Date = paymentDate,
            Amount = amount,
            CurrencyRate = currencyRate,
            TryAmount = tryAmount,
            BankAccountDefinitionId = bankAccountId,
            BankAccountTransactionId = bankTx.Id,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = user,
            CreateTime = now
        };

        _dbContext.LoanPayments.Add(payment);
        await _dbContext.SaveChangesAsync(cancellationToken);

        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = payment.Id, bankAccountTransactionId = bankTx.Id } });
    }

    /// <summary>Ödemeyi geri alır — oluşturduğu banka hareketiyle birlikte.</summary>
    [HttpDelete("payments/{paymentId:int}")]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> DeletePayment([FromRoute] int paymentId, CancellationToken cancellationToken)
    {
        var payment = await _dbContext.LoanPayments.FirstOrDefaultAsync(x => x.Id == paymentId, cancellationToken);
        if (payment is null) return NotFound(new { success = false, message = "Ödeme bulunamadı." });

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, payment, "deleteRule/kredi", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        // GENEL AYARLAR — SİLME KİLİT TARİHİ. Kredi taksit ödemesi bir BANKA hareketi üretiyor
        // ve silinince o hareket de gidiyor; kilit kontrolü fatura/çek/depo transferi/garanti
        // değişiminde vardı, kredide yoktu — geçmiş döneme ait bir ödeme silinerek kapanmış
        // dönem sessizce bozulabiliyordu. Kilit ÖNTANIMLI NULL, ayarlanmadıysa davranış aynı.
        var deleteLockDate = await _dbContext.Set<JwtSessionSetting>()
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => x.InvoiceDeleteLockDate)
            .FirstOrDefaultAsync(cancellationToken);

        if (deleteLockDate.HasValue && payment.Date.Date < deleteLockDate.Value.Date)
        {
            return BadRequest(new { success = false, message = $"Ödeme tarihi ({payment.Date:dd.MM.yyyy}), Genel Ayarlar'daki silme kilit tarihinden ({deleteLockDate.Value:dd.MM.yyyy}) önce olduğu için silinemez." });
        }

        await using var trx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        if (payment.BankAccountTransactionId.HasValue)
        {
            var bankTx = await _dbContext.BankAccountTransactions
                .FirstOrDefaultAsync(x => x.Id == payment.BankAccountTransactionId.Value, cancellationToken);

            // Ödeme silinip banka hareketi kalsaydı hesaptan para çıkmış görünmeye devam ederdi.
            if (bankTx != null) _dbContext.BankAccountTransactions.Remove(bankTx);
        }

        _dbContext.LoanPayments.Remove(payment);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await trx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }

    /// <summary>
    /// Erken kapatma. Kalan anaparayı tek seferde ödeyip kapatmak gerçek bir senaryo ve
    /// "ödenmemiş taksit kalmadı" kuralı bunu bilemez — bu yüzden ayrı bir damga var.
    /// </summary>
    [HttpPost("{id:int}/close")]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> Close([FromRoute] int id, CancellationToken cancellationToken)
    {
        var loan = await _dbContext.Loans.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (loan is null) return NotFound(new { success = false, message = "Kredi bulunamadı." });

        loan.ClosedAt = DateTime.UtcNow;
        loan.EditUser = CurrentUser();
        loan.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    /// <summary>Erken kapatmayı geri alır. Ödenmemiş taksit varsa kredi yeniden aktif görünür.</summary>
    [HttpPost("{id:int}/reopen")]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> Reopen([FromRoute] int id, CancellationToken cancellationToken)
    {
        var loan = await _dbContext.Loans.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (loan is null) return NotFound(new { success = false, message = "Kredi bulunamadı." });

        loan.ClosedAt = null;
        loan.CancelledAt = null;
        loan.EditUser = CurrentUser();
        loan.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/cancel")]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> Cancel([FromRoute] int id, CancellationToken cancellationToken)
    {
        var loan = await _dbContext.Loans.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (loan is null) return NotFound(new { success = false, message = "Kredi bulunamadı." });

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, loan, "deleteRule/kredi", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        var hasPayments = await _dbContext.LoanPayments.AnyAsync(x => x.LoanId == id, cancellationToken);
        if (hasPayments)
        {
            return BadRequest(new
            {
                success = false,
                message = "Ödemesi olan kredi iptal edilemez. Önce ödemeleri geri alın."
            });
        }

        loan.CancelledAt = DateTime.UtcNow;
        loan.EditUser = CurrentUser();
        loan.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("bank", "krediler")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        var loan = await _dbContext.Loans.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (loan is null) return NotFound(new { success = false, message = "Kredi bulunamadı." });

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, loan, "deleteRule/kredi", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        // Ödemesi olan kredi silinemez: kaskat silme taksitleri ve ödemeleri götürür ama
        // banka hareketleri KALIR — hesapta sahibi belirsiz çıkışlar oluşurdu.
        var hasPayments = await _dbContext.LoanPayments.AnyAsync(x => x.LoanId == id, cancellationToken);
        if (hasPayments)
        {
            return BadRequest(new
            {
                success = false,
                message = "Ödemesi olan kredi silinemez. Önce ödemeleri geri alın, ya da krediyi iptal edin."
            });
        }

        // SİLME İZİ (kullanıcı kararı, 2026-08-17).
        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "bank",
            PageKey = "krediler",
            RecordType = "Kredi",
            RecordId = loan.Id.ToString(),
            Description = $"Kredi silindi: {loan.LoanCode} · {loan.PrincipalAmount:N2}",
            DetailsJson = System.Text.Json.JsonSerializer.Serialize(new
            {
                loan.Id,
                loan.LoanCode,
                loan.ContractNo,
                loan.PrincipalAmount,
                loan.CurrencyTypeId,
                loan.InstallmentCount,
                loan.BankAccountDefinitionId,
                loan.StartDate
            }),
            CreateUser = CurrentUser(),
            CreateTime = DateTime.UtcNow
        });

        _dbContext.Loans.Remove(loan);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }
}
