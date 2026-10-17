using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Xunit;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Bir geri çağrının "ödendi / reddedildi / henüz belli değil / insan bakmalı" ayrımı.
///
/// Bu testler bir para kaybını kilitliyor: e-ticaret köprüsü eskiden yalnızca
/// <see cref="VirtualPosPaymentStatus.ProviderError"/>'ü "karar verilmedi" sayıyor, geri kalan
/// her başarısız durumu KALICI olarak <c>Failed</c> damgalıyordu. Ödeme kaydı bir kez Failed
/// olduktan sonra bankanın gerçek onayı bile o siparişi açamıyor — para çekilmiş, sipariş ölü.
/// </summary>
public class VirtualPosOutcomeTests
{
    [Fact]
    public void Basarili_dogrulama_odendi_sayilir()
    {
        Assert.Equal(
            VirtualPosOutcomeKind.Paid,
            VirtualPosOutcome.Classify(isSuccess: true, (int)VirtualPosPaymentStatus.Authorized));
    }

    [Fact]
    public void Bankanin_reddi_kesin_karardir()
    {
        // Müşteri yeniden deneyebilmeli: gerçek bir red, para hareketi olmadığı anlamına gelir.
        Assert.Equal(
            VirtualPosOutcomeKind.Declined,
            VirtualPosOutcome.Classify(isSuccess: false, (int)VirtualPosPaymentStatus.Failed));
    }

    [Theory]
    // "Banka konuştu ama söylediğini doğrulayamadık" — geçerli bir geri çağrı sonradan gelebilir.
    [InlineData(VirtualPosPaymentStatus.ProviderError)]
    // 3D doğrulandı, provizyon başka bir istek tarafından sürdürülüyor. Bu isteğin "başarısız"
    // yazması, kazanan isteğin yazacağı "ödendi"yi engellerdi.
    [InlineData(VirtualPosPaymentStatus.ThreeDVerified)]
    public void Kendiliginden_netlesecek_durumlar_basarisiz_sayilmaz(VirtualPosPaymentStatus status)
    {
        Assert.Equal(
            VirtualPosOutcomeKind.Undecided,
            VirtualPosOutcome.Classify(isSuccess: false, (int)status));
    }

    [Theory]
    // CardPlus provizyonu zaman aşımı / kart verisi bulunamadı — banka parayı çekmiş olabilir.
    [InlineData(VirtualPosPaymentStatus.AuthorizationPending)]
    [InlineData(VirtualPosPaymentStatus.Unknown)]
    public void Parasi_cekilmis_olabilecek_durumlar_insana_gider(VirtualPosPaymentStatus status)
    {
        var kind = VirtualPosOutcome.Classify(isSuccess: false, (int)status);

        Assert.Equal(VirtualPosOutcomeKind.NeedsHuman, kind);

        // Asıl korunan şey bu: bu durumların hiçbiri "banka reddetti" sayılmamalı.
        Assert.NotEqual(VirtualPosOutcomeKind.Declined, kind);
    }

    [Theory]
    [InlineData(VirtualPosPaymentStatus.ProviderError)]
    [InlineData(VirtualPosPaymentStatus.AuthorizationPending)]
    [InlineData(VirtualPosPaymentStatus.Unknown)]
    [InlineData(VirtualPosPaymentStatus.ThreeDVerified)]
    public void Karar_verilmemis_islemler_IsUndecided_der(VirtualPosPaymentStatus status)
        => Assert.True(VirtualPosOutcome.IsUndecided(status));

    [Theory]
    [InlineData(VirtualPosPaymentStatus.Failed)]
    [InlineData(VirtualPosPaymentStatus.Authorized)]
    public void Karari_kesin_islemler_IsUndecided_demez(VirtualPosPaymentStatus status)
        => Assert.False(VirtualPosOutcome.IsUndecided(status));

    [Theory]
    [InlineData(VirtualPosPaymentStatus.Authorized)]
    [InlineData(VirtualPosPaymentStatus.AccountingPending)]
    [InlineData(VirtualPosPaymentStatus.AccountingPosted)]
    public void Tahsil_edilmis_islemlere_makbuz_girilebilir(VirtualPosPaymentStatus status)
        => Assert.True(VirtualPosOutcome.IsCaptured(isSuccess: false, status));

    [Theory]
    // Sonucu belirsiz bir işlem tahsil edilmiş SAYILMAZ: makbuz kesilmemeli.
    [InlineData(VirtualPosPaymentStatus.AuthorizationPending)]
    [InlineData(VirtualPosPaymentStatus.ProviderError)]
    [InlineData(VirtualPosPaymentStatus.Failed)]
    public void Tahsil_edilmemis_islemlere_makbuz_girilemez(VirtualPosPaymentStatus status)
        => Assert.False(VirtualPosOutcome.IsCaptured(isSuccess: false, status));
}
