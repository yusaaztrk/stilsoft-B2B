using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Features.PosAccounts;

public sealed record PosMovementRow(
    int BankAccountTransactionId,
    DateTime Date,
    string Description,
    string CounterpartyCode,
    string CounterpartyName,
    decimal Debit,
    decimal Credit,
    decimal Balance,
    bool IsTransferRow,
    bool IsSettled,
    int? TransferId,
    string CreateUser,
    string Source);

/// <summary>Günün girişlerinin kaynağa göre dökümü (aktarım satırı hariç).</summary>
public sealed record PosSourceTotal(string Source, int Count, decimal Amount);

public sealed record PosDaySummary(
    int PosBankAccountDefinitionId,
    string PosAccountName,
    int? TargetBankAccountDefinitionId,
    string TargetAccountName,
    DateTime Date,
    decimal OpeningBalance,
    decimal TotalIn,
    decimal TransferredAmount,
    decimal UnsettledAmount,
    int? TransferId,
    IReadOnlyList<PosMovementRow> Rows,
    IReadOnlyList<PosSourceTotal> BySource);

public sealed record TransferOutcome(bool Success, string Message, int? TransferId = null, decimal Amount = 0m);

/// <summary>
/// Daily sweep of a POS collection account into its current account.
///
/// Two rules shape everything here:
///
/// * <b>The day is decided by the movement's date, never by the clock.</b> A sweep settles a
///   calendar day that has already closed, so a collection taken at 00:30 carries the new
///   day's date and waits for the next run instead of racing the one closing the day before.
///
/// * <b>The running balance is recomputed, never stored.</b> A backdated slip entered days
///   later shifts every balance after it, which is only correct if the balance is derived in
///   order at read time — the same approach the customer ledger screen already takes.
/// </summary>
public sealed class PosAccountTransferService
{
    private readonly AppDbContext _dbContext;
    private readonly B2B.Erp.Api.Features.Currency.ICurrencyRateService _money;

    /// <summary>
    /// GÜN SINIRI FİRMANIN SAATİNDE (denetim md. D1). Hareketler UTC damgalı; gün penceresi
    /// UTC takvim gününden kuruluyordu. KKTC (UTC+3) için sonuç: yerel 00:00–03:00 arası
    /// alınan tahsilatlar bir ÖNCEKİ günün havuzuna düşüyor, kasa günü tutmuyordu. Pencere
    /// artık firmanın 00:00'ından firmanın ertesi 00:00'ına — etiket (`TransferDate`) yine
    /// takvim günü, değişen yalnızca o etikete hangi hareketlerin girdiği.
    /// </summary>
    private readonly B2B.Erp.Api.Core.Helpers.CompanyClock _clock;

    public PosAccountTransferService(
        AppDbContext dbContext,
        B2B.Erp.Api.Features.Currency.ICurrencyRateService money,
        B2B.Erp.Api.Core.Helpers.CompanyClock clock)
    {
        _dbContext = dbContext;
        _money = money;
        _clock = clock;
    }

    /// <summary>Accounts declared as POS collection accounts.</summary>
    public const int PosAccountType = 14;

    /// <summary>
    /// VALÖR: POS parası bankaya ERTESİ GÜN geçer (2026-08-29 kullanıcı bildirimi:
    /// "ayın 28'inde yapılan vadesize 28'inde geçiyor, normalde 29'u yazmalı").
    ///
    /// Süpürme kapanmış günü topluyor ve iki banka hareketini de O GÜNÜN tarihiyle
    /// yazıyordu. Tahsilatın hangi güne ait olduğu bakımından doğruydu, ama para o gün
    /// vadesizde DEĞİLDİ: banka bir gün sonra yatırıyor. Sonuç, ERP'deki vadesiz hesabın
    /// gerçek banka ekstresiyle bir gün kaymasıydı.
    ///
    /// Sabit 1 TAKVİM GÜNÜ — kullanıcı kararı: "valör her zaman, hafta sonu ayrımı özel gün
    /// ayrımı felan yok". Cuma çekilen para cumartesi tarihini alır; iş günü kaydırması
    /// bilerek YAPILMIYOR.
    ///
    /// Kaydırma YALNIZCA yazılan iki banka hareketinin tarihine uygulanır. Süpürülen günün
    /// kimliği (`TransferDate`), hangi hareketlerin toplanacağı ve ekrandaki gün özeti
    /// DEĞİŞMEZ — aktarım hâlâ "28'in tahsilatları" kaydıdır, yalnızca parası 29'unda
    /// görünür. İkisi karıştırılırsa gün başına tek aktarım kuralı ve geç gelen slip
    /// mekanizması bozulur.
    /// </summary>
    public const int ValorGunu = 1;

    /// <summary>
    /// The midnight that starts a day, tagged UTC.
    ///
    /// <c>DateTime.Date</c> returns Kind=Unspecified, and Npgsql refuses to write that to a
    /// "timestamp with time zone" column — the sweep is keyed on this value, so an untagged
    /// one failed the whole screen rather than just one query. The date itself is what
    /// identifies the day; tagging it UTC keeps that identity stable and comparable.
    /// </summary>
    public static DateTime AsUtcDay(DateTime value)
        => DateTime.SpecifyKind(value.Date, DateTimeKind.Utc);

    /// <summary>
    /// Movements are read live from the bank tables on every call. A row deleted or corrected
    /// on the bank screens therefore disappears from here immediately — the alternative, a
    /// cached copy, would keep showing money that no longer exists.
    /// </summary>
    public async Task<PosDaySummary?> GetDayAsync(
        int posAccountId,
        DateTime date,
        CancellationToken cancellationToken = default)
    {
        var posAccount = await _dbContext.BankAccountDefinitions
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == posAccountId, cancellationToken);

        if (posAccount == null) return null;

        var setting = await _dbContext.PosAccountSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.PosBankAccountDefinitionId == posAccountId, cancellationToken);

        var targetName = string.Empty;
        if (setting?.TargetBankAccountDefinitionId != null)
        {
            targetName = await _dbContext.BankAccountDefinitions
                .AsNoTracking()
                .Where(x => x.Id == setting.TargetBankAccountDefinitionId)
                .Select(x => x.AccountName)
                .FirstOrDefaultAsync(cancellationToken) ?? string.Empty;
        }

        // Etiket takvim günü, pencere firmanın saatinde.
        var dayStart = AsUtcDay(date);
        var windowStart = _clock.CompanyDayStartUtc(date);
        var windowEnd = _clock.CompanyDayEndUtc(date);

        // Everything before the day, collapsed into the opening figure. Without it the
        // balance column would restart at zero each day and stop matching the account.
        var priorIn = await _dbContext.BankAccountTransactions
            .AsNoTracking()
            .Where(x => x.BankAccountDefinitionId == posAccountId && x.Date < windowStart)
            .SumAsync(x => (decimal?)(x.Direction == BankAccountTransactionDirection.In ? x.Amount : -x.Amount), cancellationToken) ?? 0m;

        var movements = await _dbContext.BankAccountTransactions
            .AsNoTracking()
            .Where(x => x.BankAccountDefinitionId == posAccountId && x.Date >= windowStart && x.Date < windowEnd)
            .OrderBy(x => x.Date).ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);

        var transfer = await _dbContext.PosAccountTransfers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.PosBankAccountDefinitionId == posAccountId && x.TransferDate == dayStart, cancellationToken);

        var movementIds = movements.Select(x => x.Id).ToList();
        var settledIds = await _dbContext.PosAccountTransferItems
            .AsNoTracking()
            .Where(x => movementIds.Contains(x.BankAccountTransactionId))
            .Select(x => new { x.BankAccountTransactionId, x.PosAccountTransferId })
            .ToListAsync(cancellationToken);

        var settledMap = settledIds.ToDictionary(x => x.BankAccountTransactionId, x => x.PosAccountTransferId);
        var sources = await ClassifySourcesAsync(movements, transfer?.OutBankAccountTransactionId, windowStart, windowEnd, cancellationToken);

        var rows = new List<PosMovementRow>();
        var running = priorIn;
        decimal totalIn = 0m;
        decimal unsettled = 0m;

        foreach (var m in movements)
        {
            var debit = m.Direction == BankAccountTransactionDirection.In ? m.Amount : 0m;
            var credit = m.Direction == BankAccountTransactionDirection.Out ? m.Amount : 0m;
            running += debit - credit;

            var isTransferRow = transfer != null && m.Id == transfer.OutBankAccountTransactionId;
            var isSettled = settledMap.TryGetValue(m.Id, out var tid);

            if (!isTransferRow)
            {
                totalIn += debit;
                if (!isSettled && debit > 0m) unsettled += debit;
            }

            rows.Add(new PosMovementRow(
                m.Id,
                m.Date,
                m.Description ?? string.Empty,
                m.CounterpartyCode ?? string.Empty,
                m.CounterpartyName ?? string.Empty,
                debit,
                credit,
                running,
                isTransferRow,
                isSettled || isTransferRow,
                isSettled ? tid : (isTransferRow ? transfer!.Id : null),
                m.CreateUser ?? string.Empty,
                sources[m.Id]));
        }

        var bySource = rows
            .Where(r => !r.IsTransferRow && r.Debit > 0m)
            .GroupBy(r => r.Source)
            .Select(g => new PosSourceTotal(g.Key, g.Count(), g.Sum(r => r.Debit)))
            .OrderByDescending(x => x.Amount)
            .ToList();

        return new PosDaySummary(
            posAccountId,
            posAccount.AccountName,
            setting?.TargetBankAccountDefinitionId,
            targetName,
            dayStart,
            priorIn,
            totalIn,
            transfer?.Amount ?? 0m,
            unsettled,
            transfer?.Id,
            rows,
            bySource);
    }

    /// <summary>Kaynak kodları — ekran etiketleri `PosTransferPage.tsx`'te.</summary>
    public static class Sources
    {
        public const string SanalPosEticaret = "vpos_eticaret";
        public const string SanalPosB2b = "vpos_b2b";
        public const string SatisFaturasi = "fatura";
        public const string ServisFaturasi = "servis";
        public const string BankaEkrani = "banka";
        public const string Virman = "virman";
        public const string Kasa = "kasa";
        public const string Cek = "cek";
        public const string Aktarim = "aktarim";
        public const string Masraf = "masraf";
        public const string Cikis = "cikis";
    }

    /// <summary>
    /// HAREKETİN NEREDEN GELDİĞİ (2026-10-11, kullanıcı: "hangileri banka havale/EFT'den girdi,
    /// hangileri sanal POS olmuş görelim").
    ///
    /// Kaynak SAKLANMIYOR, okuma anında hareketin bıraktığı izden çıkarılıyor:
    /// `BankAccountTransactions`'a kolon eklenemez (employee-service de yazıyor, bkz. sınıf notu),
    /// üstelik eski hareketler de sınıflanabilsin. İz sırası önemli:
    ///  * `VIRTUALPOS` kullanıcısı → sanal POS. Belge no e-ticaret ödemesinin referansıysa
    ///    (VP- + MerchantOrderId) e-ticaret, değilse B2B ödeme ekranı (/pos) ya da bayi.
    ///  * `CheckId` dolu → çek tahsili.
    ///  * Belge no bir faturanın numarası VE açıklamada o numara geçiyor → fatura kesilirken
    ///    alınan tahsilat (H tipi = servis/tamir). Elle girişte kullanıcı belge noya fatura no
    ///    yazmış olabilir; açıklama şartı onu ayırır, çünkü fatura yolları açıklamayı kendisi
    ///    "...: {FaturaNo}" diye yazar.
    ///  * Karşı taraf banka hesabı → virman; kasa → kasadan yatırma.
    ///  * Geri kalan giriş → Banka Havale/EFT ekranından elle girilen (slip) kayıt.
    /// </summary>
    private async Task<Dictionary<int, string>> ClassifySourcesAsync(
        IReadOnlyList<BankAccountTransaction> movements,
        int? transferOutId,
        DateTime windowStart,
        DateTime windowEnd,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<int, string>();
        if (movements.Count == 0) return result;

        var vposDocs = movements
            .Where(m => m.CreateUser == "VIRTUALPOS" && !string.IsNullOrWhiteSpace(m.DocumentNo))
            .Select(m => m.DocumentNo!.Trim())
            .ToHashSet(StringComparer.Ordinal);

        var eticaretRefs = new HashSet<string>(StringComparer.Ordinal);
        if (vposDocs.Count > 0)
        {
            // Ödeme denemesi bankaya gitmeden önce yazılıyor; işlem tarihi en geç bir gün sonra.
            var from = windowStart.AddDays(-3);
            var to = windowEnd.AddDays(1);
            var orderIds = await _dbContext.EcommerceOrderPayments
                .AsNoTracking()
                .Where(x => x.CreatedAtUtc >= from && x.CreatedAtUtc < to)
                .Select(x => x.MerchantOrderId)
                .ToListAsync(cancellationToken);
            foreach (var id in orderIds)
            {
                var r = B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosAccountingPlanner.BuildReference(id);
                if (vposDocs.Contains(r)) eticaretRefs.Add(r);
            }
        }

        var docNos = movements
            .Where(m => m.CreateUser != "VIRTUALPOS" && !string.IsNullOrWhiteSpace(m.DocumentNo))
            .Select(m => m.DocumentNo!.Trim())
            .Distinct()
            .ToList();
        var invoiceTypes = docNos.Count == 0
            ? new Dictionary<string, InvoiceType>()
            : (await _dbContext.Invoices
                .AsNoTracking()
                .Where(x => docNos.Contains(x.InvoiceNo))
                .Select(x => new { x.InvoiceNo, x.Type })
                .ToListAsync(cancellationToken))
                .GroupBy(x => x.InvoiceNo)
                .ToDictionary(g => g.Key, g => g.First().Type);

        var counterCodes = movements
            .Where(m => m.CounterpartyType == BankAccountTransactionCounterpartyType.Bank && !string.IsNullOrWhiteSpace(m.CounterpartyCode))
            .Select(m => m.CounterpartyCode.Trim())
            .Distinct()
            .ToList();
        var bankCodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var cashCodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (counterCodes.Count > 0)
        {
            bankCodes.UnionWith(await _dbContext.BankAccountDefinitions.AsNoTracking()
                .Where(x => counterCodes.Contains(x.AccountCode)).Select(x => x.AccountCode).ToListAsync(cancellationToken));
            cashCodes.UnionWith(await _dbContext.CashAccounts.AsNoTracking()
                .Where(x => counterCodes.Contains(x.Code)).Select(x => x.Code).ToListAsync(cancellationToken));
        }

        foreach (var m in movements)
        {
            result[m.Id] = Classify(m);
        }
        return result;

        string Classify(BankAccountTransaction m)
        {
            if (transferOutId == m.Id) return Sources.Aktarim;
            if (m.Direction == BankAccountTransactionDirection.Out)
                return m.IsPosFee || m.ExpenseType != 0 ? Sources.Masraf : Sources.Cikis;

            var doc = m.DocumentNo?.Trim();
            if (m.CreateUser == "VIRTUALPOS")
                return doc != null && eticaretRefs.Contains(doc) ? Sources.SanalPosEticaret : Sources.SanalPosB2b;
            if (m.CheckId != null) return Sources.Cek;
            if (doc != null && invoiceTypes.TryGetValue(doc, out var type) && (m.Description ?? string.Empty).Contains(doc, StringComparison.Ordinal))
                return type == InvoiceType.ServiceInvoice ? Sources.ServisFaturasi : Sources.SatisFaturasi;
            if (m.CounterpartyType == BankAccountTransactionCounterpartyType.Bank)
            {
                var code = m.CounterpartyCode?.Trim() ?? string.Empty;
                if (bankCodes.Contains(code)) return Sources.Virman;
                if (cashCodes.Contains(code)) return Sources.Kasa;
            }
            return Sources.BankaEkrani;
        }
    }

    /// <summary>
    /// Sweeps one closed day. Settles only the inflows of that day that no sweep has claimed,
    /// so re-running after a correction picks up what was missed instead of duplicating.
    /// </summary>
    public async Task<TransferOutcome> RunTransferAsync(
        int posAccountId,
        DateTime date,
        string username,
        bool isAutomatic,
        CancellationToken cancellationToken = default)
    {
        var dayStart = AsUtcDay(date);

        var setting = await _dbContext.PosAccountSettings
            .FirstOrDefaultAsync(x => x.PosBankAccountDefinitionId == posAccountId, cancellationToken);

        if (setting?.TargetBankAccountDefinitionId == null)
        {
            return new TransferOutcome(false, "Bu POS hesabı için aktarım yapılacak vadesiz hesap tanımlı değil.");
        }

        var existing = await _dbContext.PosAccountTransfers
            .FirstOrDefaultAsync(x => x.PosBankAccountDefinitionId == posAccountId && x.TransferDate == dayStart, cancellationToken);

        if (existing != null)
        {
            return new TransferOutcome(false, "Bu gün için zaten aktarım kaydı var.", existing.Id, existing.Amount);
        }

        var pending = await GetUnsettledInflowsAsync(
            posAccountId, _clock.CompanyDayStartUtc(date), _clock.CompanyDayEndUtc(date), cancellationToken);

        if (pending.Count == 0)
        {
            return new TransferOutcome(false, "Bu güne ait aktarılacak hareket yok.");
        }

        // `BankAccountTransaction.Amount` TL çapasıdır — bekleyen tahsilatların toplamı da TL.
        var amount = pending.Sum(x => x.Amount);
        var posAccount = await _dbContext.BankAccountDefinitions.FirstAsync(x => x.Id == posAccountId, cancellationToken);
        var target = await _dbContext.BankAccountDefinitions.FirstAsync(x => x.Id == setting.TargetBankAccountDefinitionId, cancellationToken);

        // Süpürmenin iki bacağı FARKLI para biriminde olabilir: çıkış POS hesabının, giriş
        // hedef hesabın parasındadır. Önceden iki bacağa da POS hesabının dövizi ve sabit
        // kur 1 yazılıyordu; dövizli POS'ta ya da dövizli hedefte 38.000 ₺'lik süpürme
        // karşı hesaba 38.000 $ olarak düşüyordu. Banka virmanı kardeşiyle aynı desen:
        // kaynak → TL çapası → hedef.
        (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) outMv;
        (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) inMv;
        try
        {
            outMv = await B2B.Erp.Api.Core.Helpers.AccountMovementCurrency.ResolveAsync(
                _money, posAccount.CurrencyTypeId, amount, cancellationToken);
            inMv = await B2B.Erp.Api.Core.Helpers.AccountMovementCurrency.ResolveAsync(
                _money, target.CurrencyTypeId, amount, cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return new TransferOutcome(false, ex.Message);
        }

        var now = B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow;
        // Hareketin tarihi artık tahsilat gününden bir gün ileride (valör). Hangi günün
        // parası olduğu açıklamada yazmazsa ekstreye bakan kişi eşleştiremez.
        var description = $"{posAccount.AccountName} --> VADESİZ AKTARIM ({dayStart:dd.MM.yyyy} tahsilatı)";

        await using var dbTx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        // The sweep is booked exactly like any other account-to-account transfer, so balances
        // and existing reports keep working without knowing this feature exists.
        // İKİ BACAK DA valör tarihini alır (bkz. ValorGunu). Yalnızca vadesiz bacağı
        // kaydırılsaydı para bir gece POS'tan çıkmış ama vadesize girmemiş olurdu; iki
        // hesabın toplamı o gece eksik görünürdü.
        var valorTarihi = dayStart.AddDays(ValorGunu);

        var outTx = BuildMovement(posAccountId, valorTarihi, BankAccountTransactionDirection.Out, amount,
            target.AccountCode, target.AccountName, description, username, now, outMv);
        var inTx = BuildMovement(setting.TargetBankAccountDefinitionId.Value, valorTarihi, BankAccountTransactionDirection.In, amount,
            posAccount.AccountCode, posAccount.AccountName, description, username, now, inMv);

        _dbContext.BankAccountTransactions.Add(outTx);
        _dbContext.BankAccountTransactions.Add(inTx);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var transfer = new PosAccountTransfer
        {
            PosBankAccountDefinitionId = posAccountId,
            TargetBankAccountDefinitionId = setting.TargetBankAccountDefinitionId.Value,
            TransferDate = dayStart,
            Amount = amount,
            OutBankAccountTransactionId = outTx.Id,
            InBankAccountTransactionId = inTx.Id,
            IsAutomatic = isAutomatic,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.PosAccountTransfers.Add(transfer);
        await _dbContext.SaveChangesAsync(cancellationToken);

        foreach (var m in pending)
        {
            _dbContext.PosAccountTransferItems.Add(new PosAccountTransferItem
            {
                PosAccountTransferId = transfer.Id,
                BankAccountTransactionId = m.Id,
                Amount = m.Amount,
                IsLateAddition = false,
                CreateUser = username,
                CreateTime = now
            });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await dbTx.CommitAsync(cancellationToken);

        return new TransferOutcome(true, "Aktarım tamamlandı.", transfer.Id, amount);
    }

    /// <summary>
    /// Adds movements found after the fact — a slip entered days late — to the sweep of the
    /// day they belong to. The existing sweep's amount and its two bank movements are raised
    /// rather than a second sweep created, so the day keeps the single transfer line the
    /// bank statement will show.
    /// </summary>
    public async Task<TransferOutcome> AddToTransferAsync(
        int transferId,
        IReadOnlyList<int> bankAccountTransactionIds,
        string username,
        CancellationToken cancellationToken = default)
    {
        if (bankAccountTransactionIds.Count == 0)
        {
            return new TransferOutcome(false, "Dahil edilecek hareket seçilmedi.");
        }

        var transfer = await _dbContext.PosAccountTransfers.FirstOrDefaultAsync(x => x.Id == transferId, cancellationToken);
        if (transfer == null) return new TransferOutcome(false, "Aktarım kaydı bulunamadı.");

        // Only unclaimed inflows of this POS account qualify. Filtering here rather than
        // trusting the posted ids keeps a caller from folding another account's money, or the
        // same movement twice, into this sweep.
        var alreadySettled = await _dbContext.PosAccountTransferItems
            .Where(x => bankAccountTransactionIds.Contains(x.BankAccountTransactionId))
            .Select(x => x.BankAccountTransactionId)
            .ToListAsync(cancellationToken);

        var movements = await _dbContext.BankAccountTransactions
            .Where(x => bankAccountTransactionIds.Contains(x.Id)
                        && x.BankAccountDefinitionId == transfer.PosBankAccountDefinitionId
                        && x.Direction == BankAccountTransactionDirection.In
                        && !alreadySettled.Contains(x.Id))
            .ToListAsync(cancellationToken);

        if (movements.Count == 0)
        {
            return new TransferOutcome(false, "Seçilen hareketler zaten aktarılmış ya da bu POS hesabına ait değil.");
        }

        var added = movements.Sum(x => x.Amount);
        var now = B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow;

        await using var dbTx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        foreach (var m in movements)
        {
            _dbContext.PosAccountTransferItems.Add(new PosAccountTransferItem
            {
                PosAccountTransferId = transfer.Id,
                BankAccountTransactionId = m.Id,
                Amount = m.Amount,
                IsLateAddition = true,
                CreateUser = username,
                CreateTime = now
            });
        }

        transfer.Amount += added;
        transfer.EditUser = username;
        transfer.EditTime = now;

        await RaiseMovementAmountAsync(transfer.OutBankAccountTransactionId, added, username, now, cancellationToken);
        await RaiseMovementAmountAsync(transfer.InBankAccountTransactionId, added, username, now, cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await dbTx.CommitAsync(cancellationToken);

        return new TransferOutcome(true, "Hareketler aktarıma dahil edildi.", transfer.Id, transfer.Amount);
    }

    /// <summary>
    /// SÜPÜRÜLMÜŞ BİR GÜNE SONRADAN DÜŞEN TAHSİLATLAR (2026-08-21, kullanıcı kararı).
    ///
    /// <para>
    /// Süpürme gün başına BİR kayıt açar ve o gün bir daha ele alınmaz. Sanal POS tahsilatı
    /// gecikmeli yazıldığında ya da o güne geriye dönük bir slip girildiğinde para POS
    /// hesabında "bekleyen" olarak takılı kalıyor, otomatik aktarım onu bir daha görmüyordu:
    /// ekranda gün süpürülmüş görünürken hesapta para duruyordu.
    /// </para>
    ///
    /// <para>
    /// Geç gelen tahsilat, günün MEVCUT aktarımına eklenir — yeni bir aktarım açılmaz. Böylece
    /// gün başına tek kayıt kuralı korunur, iki bacağın tutarı yükselir ve satır
    /// <c>IsLateAddition</c> damgasıyla ayırt edilebilir kalır (elle ekleme yolunun aynısı).
    /// </para>
    /// </summary>
    public async Task<TransferOutcome> SettleLateArrivalsAsync(
        int posAccountId,
        DateTime date,
        string username,
        CancellationToken cancellationToken = default)
    {
        var dayStart = AsUtcDay(date);

        var transfer = await _dbContext.PosAccountTransfers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.PosBankAccountDefinitionId == posAccountId && x.TransferDate == dayStart, cancellationToken);

        if (transfer == null)
        {
            return new TransferOutcome(false, "Bu gün için aktarım kaydı yok.");
        }

        var pending = await GetUnsettledInflowsAsync(
            posAccountId, _clock.CompanyDayStartUtc(date), _clock.CompanyDayEndUtc(date), cancellationToken);

        if (pending.Count == 0)
        {
            return new TransferOutcome(false, "Bu güne ait bekleyen hareket yok.");
        }

        return await AddToTransferAsync(transfer.Id, pending.Select(x => x.Id).ToList(), username, cancellationToken);
    }

    /// <summary>
    /// Removes a sweep and the two bank movements it created. The settled marks disappear
    /// with it (cascade), so the day's collections go back to unsettled and can be swept
    /// again — the correction path, rather than editing a sweep in place.
    /// </summary>
    public async Task<TransferOutcome> DeleteTransferAsync(
        int transferId,
        CancellationToken cancellationToken = default)
    {
        var transfer = await _dbContext.PosAccountTransfers.FirstOrDefaultAsync(x => x.Id == transferId, cancellationToken);
        if (transfer == null) return new TransferOutcome(false, "Aktarım kaydı bulunamadı.");

        await using var dbTx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var movementIds = new[] { transfer.OutBankAccountTransactionId, transfer.InBankAccountTransactionId }
            .Where(x => x.HasValue).Select(x => x!.Value).ToList();

        var movements = await _dbContext.BankAccountTransactions
            .Where(x => movementIds.Contains(x.Id))
            .ToListAsync(cancellationToken);

        _dbContext.BankAccountTransactions.RemoveRange(movements);
        _dbContext.PosAccountTransfers.Remove(transfer);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await dbTx.CommitAsync(cancellationToken);

        return new TransferOutcome(true, "Aktarım silindi. Hareketler tekrar aktarılabilir durumda.");
    }

    private async Task<List<(int Id, decimal Amount)>> GetUnsettledInflowsAsync(
        int posAccountId, DateTime from, DateTime to, CancellationToken cancellationToken)
    {
        var candidates = await _dbContext.BankAccountTransactions
            .AsNoTracking()
            .Where(x => x.BankAccountDefinitionId == posAccountId
                        && x.Date >= from && x.Date < to
                        && x.Direction == BankAccountTransactionDirection.In)
            .Select(x => new { x.Id, x.Amount })
            .ToListAsync(cancellationToken);

        var ids = candidates.Select(x => x.Id).ToList();
        var settled = await _dbContext.PosAccountTransferItems
            .AsNoTracking()
            .Where(x => ids.Contains(x.BankAccountTransactionId))
            .Select(x => x.BankAccountTransactionId)
            .ToListAsync(cancellationToken);

        return candidates
            .Where(x => !settled.Contains(x.Id))
            .Select(x => (x.Id, x.Amount))
            .ToList();
    }

    private async Task RaiseMovementAmountAsync(
        int? movementId, decimal delta, string username, DateTime now, CancellationToken cancellationToken)
    {
        if (movementId == null) return;

        var movement = await _dbContext.BankAccountTransactions
            .FirstOrDefaultAsync(x => x.Id == movementId.Value, cancellationToken);

        // A missing movement means someone deleted it from the bank screens. That is allowed
        // here by design, so the sweep total is still raised and the screen will show the
        // mismatch rather than this silently failing.
        if (movement == null) return;

        // delta TL çapasıdır. Döviz sütununa ham eklenirse dövizli hesabın bakiyesi kur katı
        // kadar şişer (38.000 ₺ geç ilave → 38.000 $): hareketin kendi kuruyla çevriliyor.
        var movementRate = movement.CurrencyRate > 0m ? movement.CurrencyRate : 1m;
        movement.Amount += delta;
        movement.CurrencyAmount += B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(movement.CurrencyTypeId)
            ? delta
            : Math.Round(delta / movementRate, 2, MidpointRounding.AwayFromZero);
        movement.EditUser = username;
        movement.EditTime = now;
    }

    private static BankAccountTransaction BuildMovement(
        int accountId, DateTime date, BankAccountTransactionDirection direction, decimal amount,
        string counterpartyCode, string counterpartyName, string description, string username, DateTime now,
        (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) movementCurrency)
        => new()
        {
            BankAccountDefinitionId = accountId,
            Date = date,
            Direction = direction,
            // Amount TL çapası; döviz alanları hareketin YAZILDIĞI hesabın parasında.
            // Bugün tüm POS hesapları TL (doğrulandı), yani TL kurulumda çıktı birebir aynı.
            Amount = amount,
            CurrencyTypeId = movementCurrency.CurrencyTypeId,
            CurrencyRate = movementCurrency.Rate,
            CurrencyAmount = movementCurrency.CurrencyAmount,
            CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
            CounterpartyCode = (counterpartyCode ?? string.Empty).Trim(),
            CounterpartyName = (counterpartyName ?? string.Empty).Trim(),
            Description = description,
            // Left false on purpose: POS commission is entered separately from the bank
            // screens and must not be confused with the sweep itself.
            IsPosFee = false,
            CreateUser = username,
            CreateTime = now
        };
}
