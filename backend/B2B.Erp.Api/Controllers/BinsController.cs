using B2B.Erp.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Text;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class BinsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    private sealed record BankLookupDto(string Id, string TcmbKodu, string Name, bool IsActive);

    public BinsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("{bin6}")]
    public async Task<IActionResult> GetByBin6([FromRoute] string bin6, CancellationToken cancellationToken = default)
    {
        try
        {
            var cleaned = (bin6 ?? string.Empty).Trim();
            if (cleaned.Length != 6 || cleaned.Any(ch => ch < '0' || ch > '9'))
            {
                return BadRequest(new { success = false, message = "BIN 6 haneli sayısal olmalıdır." });
            }

        static string NormalizeName(string input)
        {
            var s = (input ?? string.Empty).Trim().ToLowerInvariant();
            s = s.Normalize(NormalizationForm.FormD);

            var sb = new StringBuilder(s.Length);
            foreach (var ch in s)
            {
                var cat = CharUnicodeInfo.GetUnicodeCategory(ch);
                if (cat == UnicodeCategory.NonSpacingMark) continue;

                if (ch == 'ı')
                {
                    sb.Append('i');
                    continue;
                }

                sb.Append(ch);
            }

            return sb
                .ToString()
                .Normalize(NormalizationForm.FormC)
                .Replace(".", string.Empty)
                .Replace(" ", string.Empty);
        }

        static string CanonicalizeBankNameForInstallments(string bankName)
        {
            var key = NormalizeName(bankName);
            if (key.Contains("ziraat")) return "T.C. ZİRAAT BANKASI A.Ş.";
            if (key.Contains("isbank") || key.Contains("isbankasi") || key.Contains("turkiyeisbankasi")) return "TÜRKİYE İŞ BANKASI A.Ş.";
            if (key.Contains("garanti")) return "T. GARANTİ BANKASI A.Ş.";
            if (key.Contains("halk")) return "HALK BANKASI";
            if (key.Contains("creditwest")) return "CREDITWEST BANK LTD.";
            if (key.Contains("koopmerkez") || key.Contains("ktkoopmerkez")) return "K.T.KOOPMERKEZ BANKASI LTD.";
            return bankName;
        }

            var binMatch = await _dbContext.BankBins
            .AsNoTracking()
            .Where(x => x.Bin6 == cleaned)
            .OrderBy(x => x.Id)
            .Select(x => new
            {
                x.BankCode,
                x.InstallmentBankCode
            })
            .FirstOrDefaultAsync(cancellationToken);

            if (binMatch is null)
            {
                return Ok(new
                {
                    success = true,
                    data = new
                    {
                        bin6 = cleaned,
                        bank = (object?)null,
                        installmentBank = (object?)null,
                        installments = Array.Empty<object>()
                    }
                });
            }

        var bankCode = (binMatch.BankCode ?? string.Empty).Trim();
        var installmentBankCode = (binMatch.InstallmentBankCode ?? string.Empty).Trim();

        var useBankCode = bankCode;
        var useInstallmentBankCode = installmentBankCode;

        BankLookupDto? bank = null;
        if (!string.IsNullOrWhiteSpace(useBankCode))
        {
            bank = await _dbContext.BankDetails
                .AsNoTracking()
                .Where(x => x.BankDetailCode == useBankCode || x.BankDetailCode.Trim() == useBankCode)
                .Select(x => new BankLookupDto(x.Id.ToString(), x.BankDetailCode, x.Name, x.IsActive))
                .FirstOrDefaultAsync(cancellationToken);
        }

        BankLookupDto? installmentBank = null;
        if (!string.IsNullOrWhiteSpace(useInstallmentBankCode))
        {
            installmentBank = await _dbContext.BankDetails
                .AsNoTracking()
                .Where(x => x.BankDetailCode == useInstallmentBankCode || x.BankDetailCode.Trim() == useInstallmentBankCode)
                .Select(x => new BankLookupDto(x.Id.ToString(), x.BankDetailCode, x.Name, x.IsActive))
                .FirstOrDefaultAsync(cancellationToken);
        }

        // TAKSIT TABLOSU, PARAYI CEKEN POS'UN BANKASINDAN OKUNUR.
        //
        // Onceden burada BankBins.TAKSIT_BANKA_KODU (installmentBank) kullaniliyordu. O kolon
        // 999 BIN'in 831'i icin GARANTI diyor; sonuc olarak Ziraat karti takan kullanici
        // ekranda "Kart Bankasi: Ziraat" gorup Garanti'nin taksit tablosunu aliyordu -
        // Ziraat'e tanimlanan taksit hicbir kartta gorunmuyordu.
        //
        // Oysa parayi ceken POS bu kolona HIC bakmiyor: VirtualPosRouting "kartin bankasi
        // once gelir, o bankanin aktif POS'u yoksa varsayilan POS'a duser" diyor ve
        // TAKSIT_BANKA_KODU'nu bilerek yok sayiyor. Ekran ile tahsilat iki farkli bankayi
        // gosteriyordu. Burasi artik ayni kurali uyguluyor.
        var posBankCode = await ResolvePaymentPosBankCodeAsync(binMatch.BankCode, cancellationToken);

        BankLookupDto? posBank = null;
        if (posBankCode > 0)
        {
            var posBankCodeText = posBankCode.ToString();
            posBank = await _dbContext.BankDetails
                .AsNoTracking()
                .Where(x => x.BankDetailCode == posBankCodeText || x.BankDetailCode.Trim() == posBankCodeText)
                .Select(x => new BankLookupDto(x.Id.ToString(), x.BankDetailCode, x.Name, x.IsActive))
                .FirstOrDefaultAsync(cancellationToken);
        }

        // Cozulemezse eski davranisa dusuyoruz: taksitsiz birakmaktansa bilinen bir tablo.
        installmentBank = posBank ?? installmentBank;

        var installmentsBankNameSource = (posBank?.Name ?? bank?.Name ?? installmentBank?.Name) ?? string.Empty;
        if (string.IsNullOrWhiteSpace(installmentsBankNameSource))
        {
            return Ok(new
            {
                success = true,
                data = new
                {
                    bin6 = cleaned,
                    bank,
                    installmentBank,
                    installments = Array.Empty<object>()
                }
            });
        }
        var canonicalBankName = CanonicalizeBankNameForInstallments(installmentsBankNameSource);
        var normalizedBankName = NormalizeName(canonicalBankName);

        var ruleEntities = await _dbContext.InstallmentRules
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder)
            .ToListAsync(cancellationToken);

        var installments = ruleEntities
            .Where(x => NormalizeName(x.BankName) == normalizedBankName)
            .Select(x => new
            {
                id = x.Id,
                bankName = x.BankName,
                installmentText = x.InstallmentText,
                minAmountText = x.MinAmountText,
                descriptionText = x.DescriptionText,
                sortOrder = x.SortOrder,
                isActive = x.IsActive
            })
            .ToList();

            return Ok(new
            {
                success = true,
                data = new
                {
                    bin6 = cleaned,
                    bank,
                    installmentBank,
                    installments
                }
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    /// <summary>
    /// Parayi hangi POS'un cekecegini bulur; taksit tablosu o bankadan okunur.
    ///
    /// <para>
    /// Kural <see cref="B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosRouting"/> ile AYNI
    /// olmak zorunda: kartin bankasi once gelir, o bankanin kullanilabilir bir POS tanimi
    /// yoksa varsayilan POS'a duser. Protokolu dogrulanmamis banka (KOOPBANK) ve saglayiciya
    /// eslesmeyen POS tipi atlanir - tahsilat da onlari atliyor.
    /// </para>
    ///
    /// <para>
    /// Ikisi ayrisirsa ekranda bir bankanin taksitleri gorunurken para baska bankanin
    /// POS'undan cekilir; kullanicinin bir bankaya tanimladigi taksit hic gorunmez.
    /// </para>
    /// </summary>
    private async Task<int> ResolvePaymentPosBankCodeAsync(string? issuerBankCode, CancellationToken cancellationToken)
    {
        int.TryParse((issuerBankCode ?? string.Empty).Trim(), out var issuer);

        var candidates = B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosRouting.BuildBankCandidates(0, issuer);

        foreach (var bankCode in candidates)
        {
            if (bankCode <= 0) continue;
            if (!B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosRouting.CanProcessPayments(bankCode)) continue;

            var posType = await _dbContext.VirtualPosDefinitions
                .AsNoTracking()
                .Where(x => x.BankCode == bankCode && x.IsActive)
                .Select(x => x.PosType)
                .FirstOrDefaultAsync(cancellationToken);

            if (posType is null) continue;
            if (B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosRouting.ResolveProviderType(posType) is null) continue;

            return bankCode;
        }

        return 0;
    }
}
