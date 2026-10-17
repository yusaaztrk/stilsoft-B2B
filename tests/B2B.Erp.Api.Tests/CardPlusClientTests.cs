using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Xunit;

namespace B2B.Erp.Api.Tests;

public class CardPlusClientTests
{
    static CardPlusClientTests() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    /// <summary>Captures the outgoing request and returns a canned reply. No network.</summary>
    private sealed class FakeHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;
        public HttpRequestMessage? LastRequest { get; private set; }
        public byte[]? LastBodyBytes { get; private set; }
        public int CallCount { get; private set; }

        public FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) => _responder = responder;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;
            LastRequest = request;
            if (request.Content != null) LastBodyBytes = await request.Content.ReadAsByteArrayAsync(cancellationToken);
            return _responder(request);
        }
    }

    private static HttpResponseMessage XmlReply(string xml, HttpStatusCode status = HttpStatusCode.OK)
        => new(status) { Content = new ByteArrayContent(Encoding.GetEncoding(28599).GetBytes(xml)) };

    private static CardPlusAuthorizationRequest Request(string orderId = "SPTEST0001") => new(
        XmlUrl: "https://sanalpos.example-test.invalid/fim/api",
        Name: "TESTUSER", Password: "TESTPASS", ClientId: "CLIENT136",
        OrderId: orderId, Amount: 150.75m, InstallmentCount: 1,
        Pan: "4355084355084358", ExpiryMonth: "12", ExpiryYear: "26",
        Cavv: "CAVVVALUE", Xid: "XIDVALUE", Eci: "05");

    private static (CardPlusClient Client, FakeHandler Handler) Build(
        Func<HttpRequestMessage, HttpResponseMessage> responder)
    {
        var handler = new FakeHandler(responder);
        return (new CardPlusClient(new HttpClient(handler)), handler);
    }

    private const string ApprovedXml =
        "<CC5Response><OrderId>SPTEST0001</OrderId><Response>Approved</Response>" +
        "<ProcReturnCode>00</ProcReturnCode><AuthCode>987654</AuthCode>" +
        "<HostRefNum>HOSTREF1</HostRefNum><TransId>TRANS1</TransId><ErrMsg></ErrMsg></CC5Response>";

    // --- 8-16: request shape -----------------------------------------------------------

    [Fact]
    public async Task Posts_to_the_configured_endpoint()
    {
        var (client, handler) = Build(_ => XmlReply(ApprovedXml));
        await client.AuthorizeAsync(Request());

        Assert.Equal(HttpMethod.Post, handler.LastRequest!.Method);
        Assert.Equal("https://sanalpos.example-test.invalid/fim/api", handler.LastRequest.RequestUri!.ToString());
    }

    [Fact]
    public async Task Content_type_declares_iso_8859_9()
    {
        var (client, handler) = Build(_ => XmlReply(ApprovedXml));
        await client.AuthorizeAsync(Request());

        // A single header, and the charset must survive. The optional space after ';' is
        // normalised by HttpClient and is equivalent per RFC 7231, so it is not asserted.
        var values = handler.LastRequest!.Content!.Headers.GetValues("Content-Type").ToList();
        Assert.Single(values);

        var contentType = values[0].Replace(" ", string.Empty);
        Assert.Equal("application/x-www-form-urlencoded;charset=ISO-8859-9", contentType);
    }

    [Fact]
    public async Task Body_is_data_field_with_cc5request_and_iso_bytes()
    {
        var (client, handler) = Build(_ => XmlReply(ApprovedXml));
        await client.AuthorizeAsync(Request());

        var body = Encoding.GetEncoding(28599).GetString(handler.LastBodyBytes!);
        Assert.StartsWith("DATA=", body);

        var xml = Uri.UnescapeDataString(body.Substring("DATA=".Length));
        Assert.Contains("<CC5Request>", xml);
        Assert.Contains("</CC5Request>", xml);
    }

    private static async Task<string> CapturedXml(CardPlusAuthorizationRequest? request = null)
    {
        var (client, handler) = Build(_ => XmlReply(ApprovedXml));
        await client.AuthorizeAsync(request ?? Request());
        var body = Encoding.GetEncoding(28599).GetString(handler.LastBodyBytes!);
        return Uri.UnescapeDataString(body.Substring("DATA=".Length));
    }

    [Theory]
    [InlineData("<Mode>P</Mode>")]
    [InlineData("<Type>Auth</Type>")]
    [InlineData("<Currency>949</Currency>")]
    [InlineData("<VersionInfo>EPAYMENT-1.0.0.5</VersionInfo>")]
    [InlineData("<PayerAuthenticationCode>CAVVVALUE</PayerAuthenticationCode>")]
    [InlineData("<PayerTxnId>XIDVALUE</PayerTxnId>")]
    [InlineData("<PayerSecurityLevel>05</PayerSecurityLevel>")]
    [InlineData("<Total>150.75</Total>")]
    [InlineData("<OrderId>SPTEST0001</OrderId>")]
    public async Task Request_carries_verified_fields(string expectedFragment)
    {
        Assert.Contains(expectedFragment, await CapturedXml());
    }

    // --- 17: CVV is never sent ---------------------------------------------------------

    [Fact]
    public async Task Cvv_is_never_sent()
    {
        var xml = await CapturedXml();

        Assert.DoesNotContain("Cvv2Val", xml, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("cv2", xml, StringComparison.OrdinalIgnoreCase);
    }

    // --- 22-25: response handling -------------------------------------------------------

    [Fact]
    public async Task Approved_response_is_approved()
    {
        var (client, _) = Build(_ => XmlReply(ApprovedXml));
        var result = await client.AuthorizeAsync(Request());

        Assert.Equal(CardPlusOutcome.Approved, result.Outcome);
        Assert.Equal("00", result.ProcReturnCode);
        Assert.Equal("987654", result.AuthorizationCode);
        Assert.Equal("HOSTREF1", result.HostReferenceNumber);
        Assert.Equal("TRANS1", result.BankTransactionId);
    }

    [Fact]
    public async Task Declined_response_is_declined_not_error()
    {
        const string declined =
            "<CC5Response><OrderId>SPTEST0001</OrderId><Response>Declined</Response>" +
            "<ProcReturnCode>51</ProcReturnCode><ErrMsg>Yetersiz bakiye</ErrMsg></CC5Response>";

        var (client, _) = Build(_ => XmlReply(declined));
        var result = await client.AuthorizeAsync(Request());

        Assert.Equal(CardPlusOutcome.Declined, result.Outcome);
        Assert.Equal("51", result.ProcReturnCode);
    }

    [Theory]
    [InlineData("<CC5Response><OrderId>SPTEST0001</Response></CC5Response>")]
    [InlineData("not xml at all")]
    [InlineData("<CC5Response><unclosed>")]
    public async Task Malformed_response_is_provider_error_not_decline(string malformed)
    {
        var (client, _) = Build(_ => XmlReply(malformed));
        var result = await client.AuthorizeAsync(Request());

        Assert.Equal(CardPlusOutcome.ProviderError, result.Outcome);
    }

    [Fact]
    public async Task Response_for_a_different_order_is_rejected()
    {
        const string otherOrder =
            "<CC5Response><OrderId>SOMEONE-ELSE</OrderId><Response>Approved</Response>" +
            "<ProcReturnCode>00</ProcReturnCode></CC5Response>";

        var (client, _) = Build(_ => XmlReply(otherOrder));
        var result = await client.AuthorizeAsync(Request());

        Assert.Equal(CardPlusOutcome.ProviderError, result.Outcome);
    }

    [Fact]
    public async Task Response_without_expected_fields_is_provider_error()
    {
        var (client, _) = Build(_ => XmlReply("<CC5Response><Something>x</Something></CC5Response>"));
        var result = await client.AuthorizeAsync(Request());

        Assert.Equal(CardPlusOutcome.ProviderError, result.Outcome);
    }

    // --- 26-27: timeout must never look like a decline -------------------------------------

    [Fact]
    public async Task Timeout_is_unknown_not_failed()
    {
        var (client, handler) = Build(_ => throw new TaskCanceledException("timeout"));
        var result = await client.AuthorizeAsync(Request());

        Assert.Equal(CardPlusOutcome.Unknown, result.Outcome);
        Assert.Equal(1, handler.CallCount); // 27: no automatic retry
    }

    [Fact]
    public async Task Connection_failure_is_unknown_and_not_retried()
    {
        var (client, handler) = Build(_ => throw new HttpRequestException("no route"));
        var result = await client.AuthorizeAsync(Request());

        Assert.Equal(CardPlusOutcome.Unknown, result.Outcome);
        Assert.Equal(1, handler.CallCount);
    }

    // --- 32: XXE ---------------------------------------------------------------------------

    [Fact]
    public async Task External_entity_document_is_not_processed()
    {
        const string xxe =
            "<?xml version=\"1.0\"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM \"file:///c:/windows/win.ini\">]>" +
            "<CC5Response><OrderId>SPTEST0001</OrderId><ProcReturnCode>&xxe;</ProcReturnCode></CC5Response>";

        var (client, _) = Build(_ => XmlReply(xxe));
        var result = await client.AuthorizeAsync(Request());

        Assert.Equal(CardPlusOutcome.ProviderError, result.Outcome);
        Assert.DoesNotContain("win.ini", result.ErrorDescription, StringComparison.OrdinalIgnoreCase);
    }

    // --- endpoint must come from configuration ----------------------------------------------

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-a-url")]
    [InlineData("ftp://example.invalid/api")]
    public async Task Missing_or_invalid_endpoint_fails_without_calling_out(string url)
    {
        var (client, handler) = Build(_ => XmlReply(ApprovedXml));
        var result = await client.AuthorizeAsync(Request() with { XmlUrl = url });

        Assert.Equal(CardPlusOutcome.ProviderError, result.Outcome);
        Assert.Equal(0, handler.CallCount);
    }

    // --- 30: raw XML never leaks into the result ---------------------------------------------

    [Fact]
    public async Task Raw_response_xml_is_not_carried_in_the_result()
    {
        const string chatty =
            "<CC5Response><OrderId>SPTEST0001</OrderId><Response>Declined</Response>" +
            "<ProcReturnCode>51</ProcReturnCode><ErrMsg>hata</ErrMsg>" +
            "<Extra>SETTLEID=123;TRXDATE=2026</Extra></CC5Response>";

        var (client, _) = Build(_ => XmlReply(chatty));
        var result = await client.AuthorizeAsync(Request());

        Assert.DoesNotContain("CC5Response", result.ErrorDescription);
        Assert.DoesNotContain("SETTLEID", result.ErrorDescription);
    }

    [Fact]
    public async Task Long_bank_message_is_capped()
    {
        var longMsg = new string('x', 500);
        var (client, _) = Build(_ => XmlReply(
            $"<CC5Response><OrderId>SPTEST0001</OrderId><ProcReturnCode>51</ProcReturnCode><ErrMsg>{longMsg}</ErrMsg></CC5Response>"));

        var result = await client.AuthorizeAsync(Request());

        Assert.True(result.ErrorDescription.Length <= 200);
    }
}
