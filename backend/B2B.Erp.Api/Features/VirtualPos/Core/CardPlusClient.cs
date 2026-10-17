using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Xml;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

public enum CardPlusOutcome
{
    /// <summary>ProcReturnCode "00" — the bank captured the payment.</summary>
    Approved = 0,
    /// <summary>The bank answered and refused.</summary>
    Declined = 1,
    /// <summary>Unreadable or untrusted answer. Never treat as a decline.</summary>
    ProviderError = 2,
    /// <summary>No answer. The authorization may or may not have happened at the bank.</summary>
    Unknown = 3
}

public sealed record CardPlusResult(
    CardPlusOutcome Outcome,
    string ProcReturnCode,
    string AuthorizationCode,
    string HostReferenceNumber,
    string BankTransactionId,
    string OrderId,
    string ErrorDescription);

public sealed record CardPlusAuthorizationRequest(
    string XmlUrl,
    string Name,
    string Password,
    string ClientId,
    string OrderId,
    decimal Amount,
    int InstallmentCount,
    string Pan,
    string ExpiryMonth,
    string ExpiryYear,
    string Cavv,
    string Xid,
    string Eci,
    /// <summary>
    /// İşlemin ISO 4217 sayısal para birimi kodu (TRY 949, EUR 978, USD 840, GBP 826).
    /// Sabit 949 gönderilirken EUR başlatılan bir işlemde banka TL çekiyor, ERP ise cariye
    /// EUR alacak yazıyordu — aradaki fark doğrudan zarar. Verilmezse TRY.
    /// </summary>
    string CurrencyNumericCode = "949");

public interface ICardPlusClient
{
    Task<CardPlusResult> AuthorizeAsync(CardPlusAuthorizationRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// CardPlus (CreditWest, bank 136) server-to-server authorization following a successful
/// NestPay 3D step.
///
/// The wire format is a CC5Request XML document posted as a single form field over
/// ISO-8859-9 — not UTF-8, which the default FormUrlEncodedContent would force.
///
/// CVV is deliberately absent: the verified legacy flow never set it on the completion
/// call, and the new design does not retain it anywhere. Cvv2Val is therefore not emitted.
/// </summary>
public sealed class CardPlusClient : ICardPlusClient
{
    private const int Iso88599CodePage = 28599;
    private const string ModeProduction = "P";
    private const string TypeAuth = "Auth";
    private const string CurrencyTry = "949";
    private const string VersionInfo = "EPAYMENT-1.0.0.5";

    private readonly HttpClient _httpClient;

    public CardPlusClient(HttpClient httpClient) => _httpClient = httpClient;

    public async Task<CardPlusResult> AuthorizeAsync(
        CardPlusAuthorizationRequest request,
        CancellationToken cancellationToken = default)
    {
        // The endpoint comes from server-side configuration only; there is no fallback URL
        if (string.IsNullOrWhiteSpace(request.XmlUrl))
        {
            return Error("CardPlus XML adresi yapılandırılmamış.");
        }

        if (!Uri.TryCreate(request.XmlUrl.Trim(), UriKind.Absolute, out var endpoint)
            || (endpoint.Scheme != Uri.UriSchemeHttps && endpoint.Scheme != Uri.UriSchemeHttp))
        {
            return Error("CardPlus XML adresi geçersiz.");
        }

        var encoding = Encoding.GetEncoding(Iso88599CodePage);
        var xml = BuildRequestXml(request);

        // Built by hand rather than with FormUrlEncodedContent, which percent-encodes using
        // UTF-8 and would put the wrong bytes on the wire for Turkish characters.
        var body = "DATA=" + Uri.EscapeDataString(xml);
        var content = new ByteArrayContent(encoding.GetBytes(body));
        // ByteArrayContent supplies its own default; replace it rather than adding a second
        // header, and set it unvalidated so the charset token survives verbatim.
        content.Headers.Remove("Content-Type");
        content.Headers.TryAddWithoutValidation(
            "Content-Type", "application/x-www-form-urlencoded;charset=ISO-8859-9");

        string responseXml;
        try
        {
            using var response = await _httpClient.PostAsync(endpoint, content, cancellationToken);

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            responseXml = encoding.GetString(bytes);

            if (!response.IsSuccessStatusCode && string.IsNullOrWhiteSpace(responseXml))
            {
                // An empty error page tells us nothing about whether the bank authorized
                return Unknown("CardPlus yanıtı alınamadı.");
            }
        }
        catch (OperationCanceledException)
        {
            // The request may well have reached the bank. Reporting a decline here would be
            // a guess, and retrying could authorize twice.
            return Unknown("CardPlus bağlantısı zaman aşımına uğradı.");
        }
        catch (HttpRequestException)
        {
            return Unknown("CardPlus bankasına ulaşılamadı.");
        }

        return ParseResponse(responseXml, request.OrderId);
    }

    /// <summary>
    /// Only the fields the verified flow sets. Cvv2Val is intentionally omitted.
    /// </summary>
    private static string BuildRequestXml(CardPlusAuthorizationRequest r)
    {
        var amount = r.Amount.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
        var installment = r.InstallmentCount > 1 ? r.InstallmentCount.ToString() : string.Empty;

        var sb = new StringBuilder();
        sb.Append("<CC5Request>");
        sb.Append(Element("Name", r.Name));
        sb.Append(Element("Password", r.Password));
        sb.Append(Element("ClientId", r.ClientId));
        sb.Append(Element("Mode", ModeProduction));
        sb.Append(Element("OrderId", r.OrderId));
        sb.Append(Element("Type", TypeAuth));
        sb.Append(Element("Number", r.Pan));
        sb.Append(Element("Expires", $"{r.ExpiryMonth}/{r.ExpiryYear}"));
        sb.Append(Element("Total", amount));
        sb.Append(Element("Currency", string.IsNullOrWhiteSpace(r.CurrencyNumericCode) ? CurrencyTry : r.CurrencyNumericCode));
        sb.Append(Element("Taksit", installment));
        sb.Append(Element("PayerSecurityLevel", r.Eci));
        sb.Append(Element("PayerTxnId", r.Xid));
        sb.Append(Element("PayerAuthenticationCode", r.Cavv));
        sb.Append(Element("VersionInfo", VersionInfo));
        sb.Append("</CC5Request>");
        return sb.ToString();
    }

    private static string Element(string name, string? value)
        => $"<{name}>{System.Security.SecurityElement.Escape(value ?? string.Empty)}</{name}>";

    /// <summary>
    /// Parses the CC5Response. DTD processing and external entity resolution are disabled,
    /// so a hostile or malformed document cannot pull in external resources — it is reported
    /// as a provider error instead.
    /// </summary>
    private static CardPlusResult ParseResponse(string responseXml, string expectedOrderId)
    {
        if (string.IsNullOrWhiteSpace(responseXml))
        {
            return Unknown("CardPlus yanıtı boş.");
        }

        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            IgnoreComments = true,
            IgnoreProcessingInstructions = true,
            IgnoreWhitespace = true
        };

        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var stringReader = new StringReader(responseXml);
            using var reader = XmlReader.Create(stringReader, settings);

            string? current = null;
            while (reader.Read())
            {
                if (reader.NodeType == XmlNodeType.Element) current = reader.Name;
                else if (reader.NodeType == XmlNodeType.Text && current != null)
                {
                    if (!values.ContainsKey(current)) values[current] = reader.Value.Trim();
                }
                else if (reader.NodeType == XmlNodeType.EndElement) current = null;
            }
        }
        catch (XmlException)
        {
            // Unreadable answer: not a decline, the payment state stays undecided
            return Error("CardPlus yanıtı çözümlenemedi.");
        }

        string Value(string key) => values.TryGetValue(key, out var v) ? v : string.Empty;

        var procReturnCode = Value("ProcReturnCode");
        var responseText = Value("Response");
        var orderId = Value("OrderId");
        var authCode = Value("AuthCode");
        var hostRefNum = Value("HostRefNum");
        var transId = Value("TransId");
        var errMsg = Value("ErrMsg");

        // A reply about a different order cannot be trusted to describe ours
        if (!string.IsNullOrEmpty(orderId)
            && !string.Equals(orderId, expectedOrderId, StringComparison.Ordinal))
        {
            return Error("CardPlus yanıtı farklı bir sipariş numarası içeriyor.");
        }

        if (string.IsNullOrEmpty(procReturnCode) && string.IsNullOrEmpty(responseText))
        {
            return Error("CardPlus yanıtı beklenen alanları içermiyor.");
        }

        var approved = procReturnCode == "00";

        return new CardPlusResult(
            approved ? CardPlusOutcome.Approved : CardPlusOutcome.Declined,
            procReturnCode,
            authCode,
            hostRefNum,
            transId,
            orderId,
            approved
                ? "CardPlus provizyonu onaylandı."
                : (string.IsNullOrWhiteSpace(errMsg) ? "CardPlus provizyonu reddedildi." : Sanitize(errMsg)));
    }

    /// <summary>Bank messages can echo input back; cap and flatten before they are stored.</summary>
    private static string Sanitize(string message)
    {
        var s = message.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return s.Length > 200 ? s.Substring(0, 200) : s;
    }

    private static CardPlusResult Error(string message) =>
        new(CardPlusOutcome.ProviderError, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, message);

    private static CardPlusResult Unknown(string message) =>
        new(CardPlusOutcome.Unknown, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, message);
}
