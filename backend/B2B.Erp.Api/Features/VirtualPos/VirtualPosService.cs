using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace B2B.Erp.Api.Features.VirtualPos;

public sealed class VirtualPosService : IVirtualPosService
{
    private readonly AppDbContext _dbContext;
    private readonly IVirtualPosGateway _gateway;
    private readonly ILogger<VirtualPosService> _logger;
    private readonly ICardPlusCompletionService _cardPlusCompletion;
    private readonly ITransientPaymentCardStore _cardStore;
    private readonly IVirtualPosAccountingService _accountingService;

    public VirtualPosService(
        AppDbContext dbContext,
        IVirtualPosGateway gateway,
        ILogger<VirtualPosService> logger,
        ICardPlusCompletionService cardPlusCompletion,
        ITransientPaymentCardStore cardStore,
        IVirtualPosAccountingService accountingService)
    {
        _dbContext = dbContext;
        _gateway = gateway;
        _logger = logger;
        _cardPlusCompletion = cardPlusCompletion;
        _cardStore = cardStore;
        _accountingService = accountingService;
    }

    public async Task<BinLookupResponse> LookupBinAsync(string binNumber, decimal amount, CancellationToken cancellationToken = default)
    {
        var cleanBin = (binNumber ?? "").Replace(" ", "").Trim();
        if (cleanBin.Length > 6) cleanBin = cleanBin.Substring(0, 6);

        var binRecord = await _dbContext.VirtualPosBins
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.BinNo == cleanBin, cancellationToken);

        string cardType1 = "VISA";
        string cardType2 = "KREDİ KARTI";

        if (binRecord != null)
        {
            cardType1 = binRecord.CardType1;
            cardType2 = binRecord.CardType2;
        }

        // The same resolution the payment itself will run, so the bank and the installment
        // options reported here are the ones that actually take the money. VirtualPosPaymentModal
        // sends this code straight back as the requested bank — when it named the installment
        // redirect instead of the card's own bank, it forced every payment onto that POS.
        var resolvedPos = await ResolvePosForCandidatesAsync(
            BuildBankCandidates(0, binRecord), cancellationToken);

        var targetBankCode = resolvedPos?.BankCode ?? VirtualPosRouting.DefaultPaymentBankCode;

        var installments = await GetInstallmentOptionsAsync(targetBankCode, amount, cancellationToken);

        return new BinLookupResponse
        {
            Success = true,
            BinNo = cleanBin,
            BankCode = targetBankCode,
            BankName = GetBankNameByCode(targetBankCode),
            CardType1 = cardType1,
            CardType2 = cardType2,
            Installments = installments
        };
    }

    public async Task<List<InstallmentOptionDto>> GetInstallmentOptionsAsync(int bankCode, decimal amount, CancellationToken cancellationToken = default)
    {
        var rules = await _dbContext.VirtualPosInstallmentRules
            .AsNoTracking()
            .Where(x => x.IsActive && (x.BankCode == bankCode || x.BankCode == 0))
            .OrderBy(x => x.MerchantInstallment)
            .ToListAsync(cancellationToken);

        var result = new List<InstallmentOptionDto>();

        if (rules.Count == 0)
        {
            result.Add(new InstallmentOptionDto
            {
                MerchantInstallment = 0,
                BankInstallment = 0,
                InstallmentText = "Tek Çekim",
                MinAmount = 1m,
                TotalAmount = amount,
                MonthlyAmount = amount,
                Description = "Tek Çekim"
            });
            return result;
        }

        foreach (var r in rules)
        {
            if (amount < r.MinAmount) continue;

            var instCount = r.MerchantInstallment > 0 ? r.MerchantInstallment : 1;
            var monthly = Math.Round(amount / instCount, 2, MidpointRounding.AwayFromZero);

            result.Add(new InstallmentOptionDto
            {
                MerchantInstallment = r.MerchantInstallment,
                BankInstallment = r.BankInstallment,
                InstallmentText = string.IsNullOrWhiteSpace(r.InstallmentText) ? (r.MerchantInstallment <= 0 ? "Tek Çekim" : $"{r.MerchantInstallment} Taksit") : r.InstallmentText,
                MinAmount = r.MinAmount,
                TotalAmount = amount,
                MonthlyAmount = monthly,
                Description = r.Description
            });
        }

        return result;
    }

    public async Task<VirtualPos3DHtmlResponse> Initiate3DPaymentAsync(
        VirtualPosPaymentRequest request,
        string callbackUrl,
        CancellationToken cancellationToken = default,
        string? presetMerchantOrderId = null)
    {
        await Data.Services.VirtualPosSeeder.EnsurePosDataSeededAsync(_dbContext, cancellationToken);

        if (request.Amount <= 0)
        {
            return new VirtualPos3DHtmlResponse { Success = false, Message = "Tutar 0'dan büyük olmalıdır." };
        }

        // The currency is now stored, and both the callback comparison and the ledger posting
        // depend on being able to resolve it. A code the ERP cannot map would take the payment
        // to the bank and then leave the collection unbookable, so it is refused here — before
        // any money can move, which is the only point where refusing costs nothing.
        var currencyCode = NormalizeCurrencyCode(request.CurrencyCode);
        if (VirtualPosAccountingPlanner.ResolveCurrencyTypeId(currencyCode) == null)
        {
            return new VirtualPos3DHtmlResponse
            {
                Success = false,
                Message = $"'{request.CurrencyCode}' para birimi ile ödeme alınamaz."
            };
        }

        var posDef = await ResolveProcessingPosAsync(request, cancellationToken);

        if (posDef == null)
        {
            // Never invent a definition and never pick an arbitrary bank: a payment routed
            // to the wrong merchant account is worse than a payment that does not start.
            _logger.LogError(
                "[VirtualPosService] Default virtual POS configuration (bank {BankCode}) is unavailable; payment refused.",
                VirtualPosRouting.DefaultPaymentBankCode);

            return new VirtualPos3DHtmlResponse
            {
                Success = false,
                Message = "Default virtual POS configuration is unavailable."
            };
        }

        // TAKSIT MINIMUM TUTAR DENETIMI.
        //
        // Ekrandaki kutu minimumun altinda soluk gorunuyordu ama bu yalnizca gorseldi:
        // taksit tutar girilmeden secilip sonra minimumun altinda bir tutar yazilinca
        // odeme oldugu gibi bankaya gidiyordu. Istemci tarafi bir kapi degil - istek
        // dogrudan da atilabilir. Karar burada, para hareket etmeden veriliyor.
        //
        // Olcut, parayi cekecek POS'un KENDI kuralidir (posDef.BankCode): ekranda gosterilen
        // tablo baska bir kaynaktan geliyor ve ikisi ayrisabiliyor.
        var normalizedInstallment = request.InstallmentCount <= 1 ? 0 : request.InstallmentCount;

        var installmentRule = await _dbContext.VirtualPosInstallmentRules
            .AsNoTracking()
            .Where(x => x.IsActive
                        && x.BankCode == posDef.BankCode
                        && x.MerchantInstallment == normalizedInstallment)
            .FirstOrDefaultAsync(cancellationToken);

        if (installmentRule != null && installmentRule.MinAmount > 0 && request.Amount < installmentRule.MinAmount)
        {
            var taksitAdi = normalizedInstallment <= 0 ? "Tek Çekim" : $"{normalizedInstallment} Taksit";

            _logger.LogWarning(
                "[VirtualPosService] {Installment} icin minimum {Min} TL; istenen tutar {Amount} TL. Odeme baslatilmadi.",
                taksitAdi, installmentRule.MinAmount, request.Amount);

            return new VirtualPos3DHtmlResponse
            {
                Success = false,
                Message = $"{taksitAdi} için minimum tutar {installmentRule.MinAmount:N2} TL. Girilen tutar {request.Amount:N2} TL."
            };
        }

        var config = MapDefinitionToConfiguration(posDef);

        // The storefront mints the id itself so it can record which sales order this payment
        // belongs to BEFORE the bank is contacted — the same reason the transaction row below
        // is written first. A reused id would let a new payment inherit an old one's callback,
        // so it is refused rather than silently accepted.
        var merchantOrderId = presetMerchantOrderId?.Trim() ?? string.Empty;
        if (merchantOrderId.Length == 0)
        {
            merchantOrderId = GenerateMerchantOrderId();
        }
        else if (await _dbContext.VirtualPosTransactions
                     .AsNoTracking()
                     .AnyAsync(x => x.OrderNo == merchantOrderId, cancellationToken))
        {
            return new VirtualPos3DHtmlResponse
            {
                Success = false,
                Message = "Bu ödeme numarası zaten kullanılmış."
            };
        }

        // The transaction is persisted BEFORE the bank is contacted. The bank may call back
        // faster than a later write would commit, and a callback without a stored
        // transaction is rejected outright — so the row has to exist first.
        var tx = new VirtualPosTransaction
        {
            MerchantOrderId = merchantOrderId,
            BankTransactionId = merchantOrderId,
            CustomerCode = request.CustomerCode,
            BankCode = posDef.BankCode,
            BankName = posDef.BankName,
            InstallmentCount = request.InstallmentCount,
            Amount = request.Amount,
            CurrencyCode = currencyCode,
            Is3D = true,
            CardHolderName = request.CardHolderName,
            MaskedPan = MaskCardNumber(request.CardNumber),
            CardBrand = DetectCardBrand(request.CardNumber),
            Email = request.Email,
            Phone = SanitizePhone(request.Phone),
            Status = (int)VirtualPosPaymentStatus.RedirectPrepared,
            IsSuccess = false,
            RequestPayloadMasked = $"Amount={request.Amount};Currency={request.CurrencyCode};BankCode={posDef.BankCode};Installment={request.InstallmentCount}"
        };

        _dbContext.VirtualPosTransactions.Add(tx);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Banks that authorize after the 3D step need the card number again at callback
        // time, and it is deliberately not persisted. Held in memory only, for this order,
        // consumed once, and never for any other bank.
        if (VirtualPosRouting.RequiresPostThreeDCompletion(posDef.BankCode))
        {
            _cardStore.Store(merchantOrderId, new TransientCardData(
                Pan: (request.CardNumber ?? string.Empty).Replace(" ", "").Trim(),
                ExpiryMonth: (request.ExpMonth ?? string.Empty).Trim().PadLeft(2, '0'),
                ExpiryYear: (request.ExpYear ?? string.Empty).Trim().Length == 4
                    ? (request.ExpYear ?? string.Empty).Trim().Substring(2)
                    : (request.ExpYear ?? string.Empty).Trim()));
        }

        var startResult = await _gateway.StartPaymentAsync(request, config, merchantOrderId, cancellationToken);

        if (!startResult.Success)
        {
            tx.Status = (int)VirtualPosPaymentStatus.Failed;
            tx.FailureMessage = startResult.Message;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return new VirtualPos3DHtmlResponse
        {
            Success = startResult.Success,
            HtmlForm = startResult.HtmlForm,
            Message = startResult.Message,

            // Reported back so the caller can follow this specific attempt. The field existed
            // but was never filled, which made the outcome of a payment impossible to look up
            // by anything other than guessing.
            OrderNo = merchantOrderId
        };
    }

    /// <summary>
    /// Picks the POS that will actually process the payment.
    ///
    /// The issuing bank of the card and the processing bank are different concepts: a card
    /// from a bank we have no contract with is still charged, through the default POS.
    /// Order of preference: explicitly requested bank, then the bank the BIN routes to,
    /// then the default POS.
    /// </summary>
    private async Task<VirtualPosDefinition?> ResolveProcessingPosAsync(
        VirtualPosPaymentRequest request,
        CancellationToken cancellationToken)
    {
        var cleanCard = (request.CardNumber ?? string.Empty).Replace(" ", "").Trim();
        var binRec = cleanCard.Length >= 6
            ? await _dbContext.VirtualPosBins
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.BinNo == cleanCard.Substring(0, 6), cancellationToken)
            : null;

        return await ResolvePosForCandidatesAsync(
            BuildBankCandidates(request.BankCode, binRec), cancellationToken);
    }

    /// <summary>
    /// The banks a card may be charged through, best first. The policy lives in
    /// <see cref="VirtualPosRouting.BuildBankCandidates"/>; this only reads the issuing bank
    /// off the BIN record.
    /// </summary>
    private static List<int> BuildBankCandidates(int requestedBankCode, VirtualPosBin? bin)
        => VirtualPosRouting.BuildBankCandidates(requestedBankCode, bin?.BankCode ?? 0);

    /// <summary>
    /// Walks the candidates and returns the first that can actually take the payment. A bank
    /// with no active definition, an unverified protocol, or a POS type that maps to no
    /// provider is skipped rather than selected and failed on later.
    /// </summary>
    private async Task<VirtualPosDefinition?> ResolvePosForCandidatesAsync(
        IEnumerable<int> candidates,
        CancellationToken cancellationToken)
    {
        foreach (var bankCode in candidates)
        {
            if (bankCode <= 0) continue;

            // A bank whose protocol is not verified never processes a payment
            if (!VirtualPosRouting.CanProcessPayments(bankCode))
            {
                _logger.LogInformation(
                    "[VirtualPosService] Bank {BankCode} cannot process payments; falling through to the next candidate.",
                    bankCode);
                continue;
            }

            var def = await _dbContext.VirtualPosDefinitions
                .FirstOrDefaultAsync(x => x.BankCode == bankCode && x.IsActive, cancellationToken);

            // A definition whose POS type maps to no provider is unusable
            if (def != null && VirtualPosRouting.ResolveProviderType(def.PosType) != null)
            {
                return def;
            }
        }

        return null;
    }

    /// <summary>
    /// The callback endpoint is public, so the order id must not be guessable. The rule now
    /// lives in <see cref="MerchantOrderId"/> because the storefront has to mint the same kind
    /// of id before it calls in.
    /// </summary>
    private static string GenerateMerchantOrderId() => MerchantOrderId.New();

    public async Task<VirtualPosTransactionDto> Process3DCallbackAsync(IFormCollection form, CancellationToken cancellationToken = default)
    {
        var callback = new VirtualPosCallbackData(
            form.Select(kv => new KeyValuePair<string, string>(kv.Key, kv.Value.ToString())));

        var orderNo = callback.Get("oid", "orderid", "OrderNo", "OrderId");

        // ---- V2: a callback can never create a payment ----------------------------------
        // Transactions exist only because payment initiation created them. An order id we
        // did not issue is a forged or stale callback and is rejected without side effects.
        var tx = string.IsNullOrWhiteSpace(orderNo)
            ? null
            : await _dbContext.VirtualPosTransactions
                .FirstOrDefaultAsync(x => x.OrderNo == orderNo, cancellationToken);

        if (tx == null)
        {
            _logger.LogWarning("[VirtualPosService] Callback rejected: no such payment transaction.");
            return RejectedCallbackDto("Ödeme kaydı bulunamadı.");
        }

        // ---- V9: already finalized -> return the existing outcome, no second effect ------
        if (tx.IsSuccess || tx.PaymentStatus == VirtualPosPaymentStatus.Authorized)
        {
            _logger.LogInformation("[VirtualPosService] Callback already processed for order {OrderNo}", tx.OrderNo);
            return MapToDto(tx);
        }

        // ---- V5: strict provider resolution, no fallback ---------------------------------
        // Initiation already decided which bank processes this payment and stored it. The
        // callback must resolve to exactly that configuration; anything else is rejected
        // rather than defaulted, otherwise a callback could be parsed by the wrong provider.
        var posDef = await _dbContext.VirtualPosDefinitions
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.BankCode == tx.BankCode, cancellationToken);

        if (posDef == null)
        {
            _logger.LogError("[VirtualPosService] Callback rejected: no POS definition for bank {BankCode}.", tx.BankCode);
            return await FailCallbackAsync(tx, VirtualPosPaymentStatus.ProviderError, "POS_CONFIG_MISSING", "POS tanımı bulunamadı. Ödemenin bankada gerçekleşip gerçekleşmediği doğrulanamadı.", callback, cancellationToken);
        }

        var providerType = VirtualPosRouting.ResolveProviderType(posDef.PosType);
        if (providerType == null)
        {
            _logger.LogError("[VirtualPosService] Callback rejected: unknown POS type for bank {BankCode}.", tx.BankCode);
            return await FailCallbackAsync(tx, VirtualPosPaymentStatus.ProviderError, "POS_TYPE_UNKNOWN", "POS tipi tanımsız. Banka yanıtı yorumlanamadı.", callback, cancellationToken);
        }

        // ---- V4: amount and currency must match what we asked the bank to charge ---------
        var mismatch = VerifyAmountAndCurrency(tx, callback, providerType.Value);
        if (mismatch != null)
        {
            _logger.LogError("[VirtualPosService] Callback rejected for order {OrderNo}: {Reason}", tx.OrderNo, mismatch);
            return await FailCallbackAsync(tx, VirtualPosPaymentStatus.ProviderError, "AMOUNT_CURRENCY_MISMATCH", mismatch, callback, cancellationToken);
        }

        var config = MapDefinitionToConfiguration(posDef);
        config.ProviderType = providerType.Value;

        var callbackRequest = new VirtualPosCallbackRequest { FormData = BuildProviderFormData(form) };
        var callbackResult = await _gateway.ProcessCallbackAsync(callbackRequest, config, cancellationToken);

        // ---- 136 / CardPlus: 3D success is not a completed payment ----------------------
        // A verified 3D callback only proves authentication. The money is captured by a
        // second, server-to-server authorization, so these stop at ThreeDVerified and the
        // completion service decides the final state.
        var needsCompletion = callbackResult.IsSuccess && VirtualPosRouting.RequiresPostThreeDCompletion(tx.BankCode);

        try
        {
            tx.Status = needsCompletion
                ? (int)VirtualPosPaymentStatus.ThreeDVerified
                : (int)callbackResult.Status;

            tx.IsSuccess = callbackResult.IsSuccess && !needsCompletion;
            tx.AuthorizationCode = callbackResult.AuthorizationCode;
            tx.HostReferenceNumber = callbackResult.HostReferenceNumber;
            tx.BankTransactionId = !string.IsNullOrWhiteSpace(callbackResult.BankTransactionId) ? callbackResult.BankTransactionId : tx.BankTransactionId;
            tx.FailureCode = callbackResult.ErrorCode;
            tx.FailureMessage = needsCompletion
                ? "3D doğrulaması başarılı. Banka provizyonu bekleniyor."
                : callbackResult.ErrorDescription;
            // Tamamlanma damgası yalnız KARARA bağlanır. ProviderError "banka cevap verdi
            // ama güvenemiyoruz" demek; işlem bitmiş sayılmaz, sonradan gelen geçerli bir
            // callback'in üzerine yazabilmesi gerekir.
            tx.CompletedAtUtc = needsCompletion || callbackResult.Status == VirtualPosPaymentStatus.ProviderError
                ? null
                : B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow;

            // ---- V6: allow-list, never the raw form -------------------------------------
            tx.ResponsePayloadMasked = callback.BuildStorablePayload();

            if (needsCompletion)
            {
                // ThreeDVerified has to be visible before the claim runs, otherwise the
                // conditional update has nothing to match on.
                await _dbContext.SaveChangesAsync(cancellationToken);

                await _cardPlusCompletion.CompleteAsync(tx, posDef, callback, cancellationToken);

                // Persist the authorization outcome before any bookkeeping is attempted
                await _dbContext.SaveChangesAsync(cancellationToken);

                // Only a CardPlus approval makes this a real payment
                if (tx.IsSuccess)
                {
                    await _accountingService.FinalizeAccountingAsync(tx.Id, cancellationToken);
                }

                return MapToDto(tx);
            }

            await _dbContext.SaveChangesAsync(cancellationToken);

            // Accounting is delegated to the single authoritative service. The inline ledger
            // insert that used to live here was a second, weaker path: it wrote only the
            // customer side, hard-coded the currency, guarded duplicates on DocumentNo alone
            // and put the masked card number in the description.
            //
            // Run after the payment result is committed, and outside its transaction: a
            // bookkeeping failure must never roll back or reinterpret a captured payment.
            if (callbackResult.IsSuccess)
            {
                await _accountingService.FinalizeAccountingAsync(tx.Id, cancellationToken);
            }
        }
        catch (DbUpdateConcurrencyException)
        {
            // A parallel callback for the same order won the race. Re-read and return that
            // outcome instead of writing a second time.
            _logger.LogInformation("[VirtualPosService] Concurrent callback for order {OrderNo}; returning stored outcome.", tx.OrderNo);
            _dbContext.Entry(tx).State = EntityState.Detached;
            var stored = await _dbContext.VirtualPosTransactions
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.OrderNo == tx.OrderNo, cancellationToken);
            return stored != null ? MapToDto(stored) : RejectedCallbackDto("Ödeme durumu okunamadı.");
        }

        return MapToDto(tx);
    }

    /// <summary>Outcome for a callback that was refused before it touched a transaction.</summary>
    private static VirtualPosTransactionDto RejectedCallbackDto(string message) => new()
    {
        IsSuccess = false,
        Status = (int)VirtualPosPaymentStatus.Failed,
        ErrorCode = "CALLBACK_REJECTED",
        ErrorDescription = message
    };

    /// <summary>
    /// Records a verification failure on the transaction. The payment is marked failed and
    /// no accounting is produced — reaching the callback endpoint is not a payment.
    /// </summary>
    /// <summary>
    /// Callback'i kabul etmediğimiz durumu kaydeder.
    ///
    /// DURUMU ÇAĞIRAN SEÇER, çünkü iki farklı şey var ve ikisi bir arada yazılamaz:
    ///  * <c>Failed</c> — banka "hayır" dedi. Karar kesin, para hareketi yok.
    ///  * <c>ProviderError</c> — bankanın ne dediğini DOĞRULAYAMADIK (imza yok/tutmuyor,
    ///    tutar-para birimi uyuşmuyor, POS tanımı çözülemiyor). Kart çekilmiş OLABİLİR.
    ///
    /// Bütün bu dallar eskiden <c>Failed</c> yazıyordu: parası alınmış bir tahsilat raporda
    /// kesin "Başarısız" görünüyor, <c>needsAttentionOnly</c> süzgecine düşmüyor ve makbuz
    /// bile girilemiyordu. Doğrulanamayan bir sonuç, olumsuz bir sonuç değildir.
    ///
    /// Karar verilmemiş bir ödemeye tamamlanma damgası da vurulmaz — <c>CompletedAtUtc</c>
    /// "banka cevap verdi ve iş bitti" demektir (aynı kural
    /// <see cref="Core.CardPlusCompletionService"/> içinde de uygulanıyor).
    /// </summary>
    private async Task<VirtualPosTransactionDto> FailCallbackAsync(
        VirtualPosTransaction tx,
        VirtualPosPaymentStatus status,
        string code,
        string message,
        VirtualPosCallbackData callback,
        CancellationToken cancellationToken)
    {
        tx.Status = (int)status;
        tx.IsSuccess = false;
        tx.FailureCode = code;
        tx.FailureMessage = message;
        tx.CompletedAtUtc = status == VirtualPosPaymentStatus.ProviderError
            ? null
            : B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow;
        tx.ResponsePayloadMasked = callback.BuildStorablePayload();

        await _dbContext.SaveChangesAsync(cancellationToken);
        return MapToDto(tx);
    }

    /// <summary>
    /// Compares the amount and currency the bank reports with what initiation stored.
    /// Returns null when both match, otherwise a reason. When the bank sends no amount at
    /// all the callback is refused as well: a missing field must not skip the check.
    /// </summary>
    private static string? VerifyAmountAndCurrency(
        VirtualPosTransaction tx,
        VirtualPosCallbackData callback,
        VirtualPosProviderType providerType)
    {
        var rawAmount = callback.Get("amount", "txnamount");
        var callbackAmount = VirtualPosCallbackData.ParseBankAmount(rawAmount, providerType);

        if (callbackAmount == null)
        {
            return "Callback tutar bilgisi okunamadı.";
        }

        if (!VirtualPosCallbackData.AmountsMatch(tx.Amount, callbackAmount.Value))
        {
            return "Callback tutarı işlem tutarı ile eşleşmiyor.";
        }

        var rawCurrency = callback.Get("currency", "txncurrencycode");
        if (!string.IsNullOrWhiteSpace(rawCurrency))
        {
            var expected = VirtualPosCallbackData.ToNumericCurrencyCode(tx.CurrencyCode);
            if (expected == null)
            {
                return "İşlem para birimi tanımsız.";
            }
            if (!string.Equals(expected, rawCurrency.Trim(), StringComparison.Ordinal))
            {
                return "Callback para birimi işlem para birimi ile eşleşmiyor.";
            }
        }

        return null;
    }

    /// <summary>
    /// Providers still receive the full form because they need authentication fields to
    /// evaluate the result. The dictionary is case-insensitive so a bank's casing cannot
    /// make a security check silently read an absent field.
    /// </summary>
    private static Dictionary<string, string> BuildProviderFormData(IFormCollection form)
    {
        var data = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in form)
        {
            if (!data.ContainsKey(kv.Key)) data[kv.Key] = kv.Value.ToString();
        }
        return data;
    }

    public async Task<List<VirtualPosTransactionDto>> GetTransactionsAsync(
        string? customerCode = null,
        bool? needsAttentionOnly = null,
        List<string>? allowedCustomerCodes = null,
        CancellationToken cancellationToken = default)
    {
        var query = _dbContext.VirtualPosTransactions.AsNoTracking();

        if (allowedCustomerCodes != null && allowedCustomerCodes.Count > 0)
        {
            query = query.Where(x => allowedCustomerCodes.Contains(x.CustomerCode));
        }

        if (!string.IsNullOrWhiteSpace(customerCode))
        {
            query = query.Where(x => x.CustomerCode == customerCode);
        }

        // Lets operations answer "which payments need a human?" — a CardPlus timeout, an
        // unbooked capture, or an untrusted provider answer.
        if (needsAttentionOnly == true)
        {
            query = query.Where(x =>
                x.Status == (int)VirtualPosPaymentStatus.AuthorizationPending ||
                x.Status == (int)VirtualPosPaymentStatus.AccountingPending ||
                x.Status == (int)VirtualPosPaymentStatus.ProviderError);
        }

        // Ordered by the real column, not the CreatedAtUtc alias: that property is
        // [NotMapped], so EF could not translate it and the whole query failed. Mapping runs
        // after materialisation for the same reason — MapToDto is ordinary C#, not SQL.
        var entities = await query
            .OrderByDescending(x => x.CreateTime)
            .Take(500)
            .ToListAsync(cancellationToken);

        var list = entities.Select(MapToDto).ToList();

        // The transaction stores only the customer code, but the report is read by people who
        // know names. Resolved in one pass rather than per row, and a code with no matching
        // customer simply keeps its code instead of showing a blank cell.
        var codes = list.Select(x => x.CustomerCode)
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Distinct()
            .ToList();

        if (codes.Count > 0)
        {
            var names = await _dbContext.Customers
                .AsNoTracking()
                .Where(c => codes.Contains(c.CustomerCode))
                .Select(c => new { c.CustomerCode, c.Name })
                .ToDictionaryAsync(x => x.CustomerCode, x => x.Name, cancellationToken);

            foreach (var dto in list)
            {
                dto.CustomerName = names.TryGetValue(dto.CustomerCode ?? string.Empty, out var n)
                    ? n
                    : dto.CustomerCode ?? string.Empty;
            }
        }

        return list;
    }

    public async Task<List<VirtualPosDefinitionDto>> GetPosDefinitionsAsync(CancellationToken cancellationToken = default)
    {
        return await _dbContext.VirtualPosDefinitions
            .AsNoTracking()
            .OrderBy(x => x.BankCode)
            .Select(x => new VirtualPosDefinitionDto
            {
                Id = x.Id,
                BankCode = x.BankCode,
                BankName = x.BankName,
                PosType = x.PosType,
                ClientId = x.ClientId,
                TerminalId = x.TerminalId,
                IsDefault = x.IsDefault,
                IsActive = x.IsActive
            })
            .ToListAsync(cancellationToken);
    }

    private static VirtualPosConfiguration MapDefinitionToConfiguration(VirtualPosDefinition def)
    {
        var providerType = def.BankCode switch
        {
            62 => VirtualPosProviderType.Garanti,
            120 => VirtualPosProviderType.Koopbank,
            _ => VirtualPosProviderType.NestPay
        };

        return new VirtualPosConfiguration
        {
            Id = def.Id,
            BankCode = (VirtualPosBankCode)def.BankCode,
            ProviderType = providerType,
            BankName = def.BankName,
            // The merchant number is ClientId, not UserCode: UserCode is the login user the
            // bank knows the operator by. They had been swapped, which sent Garanti a user
            // code where it expects a merchant id.
            MerchantId = def.ClientId,
            TerminalId = def.TerminalId,
            ClientId = def.ClientId,
            GatewayUrl = def.GatewayUrl,
            StoreType = def.StoreType,
            StoreKeyEncrypted = def.Key3D,
            ApiUsernameEncrypted = def.UserCode,
            ApiPasswordEncrypted = def.Password,
            ProvisionPasswordEncrypted = def.ProvisionPassword,
            IsThreeDSecureEnabled = true,
            IsActive = def.IsActive
        };
    }

    private static VirtualPosTransactionDto MapToDto(VirtualPosTransaction tx)
    {
        return new VirtualPosTransactionDto
        {
            Id = tx.Id,
            OrderNo = tx.MerchantOrderId,
            BankDocumentNo = tx.BankTransactionId,
            CustomerCode = tx.CustomerCode,
            BankCode = tx.BankCode,
            BankName = GetBankNameByCode(tx.BankCode),
            InstallmentCount = tx.InstallmentCount,
            Amount = tx.Amount,
            CurrencyCode = string.IsNullOrWhiteSpace(tx.CurrencyCode) ? "TRY" : tx.CurrencyCode,
            TransactionDate = tx.CreatedAtUtc,
            IsSuccess = tx.IsSuccess || tx.PaymentStatus == VirtualPosPaymentStatus.Authorized,
            AuthCode = tx.AuthorizationCode,
            ErrorCode = tx.FailureCode,
            ErrorDescription = tx.FailureMessage,
            Is3D = tx.Is3D,
            CardHolderName = tx.CardHolderName,
            MaskedCardNumber = tx.MaskedPan,
            Email = tx.Email,
            Phone = tx.Phone,
            Status = (int)tx.Status,
            ReceiptNo = tx.ReceiptNo ?? string.Empty
        };
    }

    /// <summary>
    /// Trims and upper-cases the requested currency, defaulting to the ERP base currency when
    /// the caller sends nothing. Never truncates: a value that does not fit the column is a
    /// value the ERP cannot resolve, and the caller rejects it rather than storing a mangled
    /// code that would later look like a valid currency.
    /// </summary>
    private static string NormalizeCurrencyCode(string? raw)
    {
        var code = (raw ?? string.Empty).Trim().ToUpperInvariant();
        return code.Length == 0 ? "TRY" : code;
    }

    /// <summary>
    /// Telefon alanina KART NUMARASI yazilmasini engeller.
    ///
    /// <para>Canliya kart numarasi tasiyan telefon degerleri dustu: odeme formundaki telefon
    /// kutusu hicbir otomatik-doldurma ipucu tasimiyordu ve tarayici, kredi karti formu
    /// sandigi icin o kutuyu da kart numarasiyla dolduruyordu. Kutu duzeltildi, ama istegi
    /// bu servis disindan kuran baska bir istemci de olabilir: kart numarasi gibi gorunen
    /// deger BURADA da yazilmaz.</para>
    ///
    /// <para>Olcut uzunluk + Luhn sagalamasi. Gercek bir telefon numarasinin 13-19 hane olup
    /// ayni zamanda Luhn'dan gecmesi pratikte gorulmez; suphede kalan deger ise kaydedilmez,
    /// cunku yanlis kaydedilmis bir telefondansa BOS telefon iyidir — digeri kart verisini
    /// veritabaninda maskesiz saklamak demektir.</para>
    /// </summary>
    private static string SanitizePhone(string? raw)
    {
        var value = (raw ?? string.Empty).Trim();
        if (value.Length == 0) return string.Empty;

        var digits = new string(value.Where(char.IsDigit).ToArray());
        return LooksLikeCardNumber(digits) ? string.Empty : value;
    }

    private static bool LooksLikeCardNumber(string digits)
    {
        if (digits.Length < 13 || digits.Length > 19) return false;

        var sum = 0;
        var doubleIt = false;
        for (var i = digits.Length - 1; i >= 0; i--)
        {
            var n = digits[i] - '0';
            if (doubleIt)
            {
                n *= 2;
                if (n > 9) n -= 9;
            }
            sum += n;
            doubleIt = !doubleIt;
        }

        return sum % 10 == 0;
    }

    private static string MaskCardNumber(string raw)
    {
        var clean = (raw ?? "").Replace(" ", "").Trim();
        if (clean.Length < 12) return clean;
        return $"{clean.Substring(0, 6)}******{clean.Substring(clean.Length - 4)}";
    }

    private static string DetectCardBrand(string raw)
    {
        var clean = (raw ?? "").Replace(" ", "").Trim();
        if (clean.StartsWith("4")) return "VISA";
        if (clean.StartsWith("5")) return "MASTERCARD";
        if (clean.StartsWith("9792") || clean.StartsWith("65")) return "TROY";
        return "CARDS";
    }

    private static string GetBankNameByCode(int code)
    {
        return code switch
        {
            10 => "ZİRAAT BANKASI",
            12 => "HALKBANK",
            62 => "GARANTİ BBVA",
            64 => "İŞ BANKASI",
            120 => "KOOPBANK",
            136 => "CREDITWEST CARDPLUS",
            _ => $"BANKA ({code})"
        };
    }
}
