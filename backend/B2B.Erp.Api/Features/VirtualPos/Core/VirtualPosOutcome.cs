using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

/// <summary>
/// Bir 3D geri çağrısının sonucu üç şeyden biridir; hangisi olduğuna KARAR VEREN TEK YER burası.
///
/// <para>
/// <b>Neden tek yer:</b> "banka ne dedi" ile "ne yapmalıyız" aynı şey değil ve bu ayrım daha
/// önce iki ayrı kopya hâlinde yaşıyordu. <c>SaveReceiptNo</c> karar verilmemiş durumları
/// doğru sayıyordu (ProviderError + AuthorizationPending + Unknown); e-ticaret köprüsü ise
/// yalnızca <see cref="VirtualPosPaymentStatus.ProviderError"/>'ü tanıyordu. Aradaki fark
/// sessiz bir para kaybıydı: CardPlus provizyonu "bilinmiyor" dönen bir ödeme e-ticaret
/// tarafında KALICI olarak <c>Failed</c> damgalanıyor, sonradan gelen geçerli onay da o kaydı
/// açamıyordu — para çekilmiş, sipariş ölü. Kural bir kere yazılır, iki taraf da buradan okur.
/// </para>
/// </summary>
public enum VirtualPosOutcomeKind
{
    /// <summary>Banka tahsil etti. Sipariş kapatılabilir.</summary>
    Paid,

    /// <summary>
    /// Banka "hayır" dedi. Karar kesin ve para hareketi yok — müşteri yeniden deneyebilir.
    /// </summary>
    Declined,

    /// <summary>
    /// Sonuç HENÜZ BELLİ DEĞİL ama kendiliğinden belli olacak: ya bankanın tekrar göndereceği
    /// geçerli bir geri çağrıyla, ya da hâlihazırda süren provizyonu tamamlayan diğer istekle.
    /// Kayıt <c>Pending</c> bırakılır — <c>Failed</c> damgalanırsa o geçerli sonuç kaydı bir
    /// daha açamaz.
    /// </summary>
    Undecided,

    /// <summary>
    /// Sonuç belli değil ve KENDİLİĞİNDEN BELLİ OLMAYACAK: para çekilmiş olabilir. Yeniden
    /// denemek çift tahsilat riski taşır, başarısız saymak çekilmiş parayı yok saymak olur.
    /// İnsan bakmalı.
    /// </summary>
    NeedsHuman
}

public static class VirtualPosOutcome
{
    /// <summary>
    /// Geri çağrı sonucunu sınıflandırır.
    ///
    /// <paramref name="isSuccess"/> bankanın form alanından değil, imza/tutar/para birimi
    /// doğrulamasından geçmiş karardan gelir; burada o karar yeniden yorumlanmaz.
    /// </summary>
    public static VirtualPosOutcomeKind Classify(bool isSuccess, int status)
    {
        if (isSuccess) return VirtualPosOutcomeKind.Paid;

        return (VirtualPosPaymentStatus)status switch
        {
            // Provizyon uçuşta ya da sonucu bilinmiyor (zaman aşımı, kart verisi bulunamadı).
            // CardPlusCompletionService'in kendi yorumu: "banka parayı çekmiş olabilir; ne
            // başarı ne başarısızlık, körlemesine tekrar denenmemeli."
            VirtualPosPaymentStatus.AuthorizationPending => VirtualPosOutcomeKind.NeedsHuman,
            VirtualPosPaymentStatus.Unknown => VirtualPosOutcomeKind.NeedsHuman,

            // "Banka konuştu ama söylediğini doğrulayamadık" — imza tutmadı, tutar eşleşmedi,
            // POS tanımı çözülemedi. RED DEĞİL: geçerli bir geri çağrı sonradan gelebilir.
            VirtualPosPaymentStatus.ProviderError => VirtualPosOutcomeKind.Undecided,

            // 3D doğrulandı, provizyon adımı henüz bitmedi. Bu durumu gören istek, provizyonu
            // ele geçirme yarışını KAYBEDEN istektir; kazanan aynı ödemeyi birazdan
            // sonuçlandıracak. Burada "başarısız" yazmak, kazananın yazacağı "ödendi"yi
            // engellerdi.
            VirtualPosPaymentStatus.ThreeDVerified => VirtualPosOutcomeKind.Undecided,

            _ => VirtualPosOutcomeKind.Declined
        };
    }

    /// <summary>
    /// Tahsilatın gerçekleştiği kesin mi? Makbuz yalnızca böyle bir işleme girilebilir.
    /// </summary>
    public static bool IsCaptured(bool isSuccess, VirtualPosPaymentStatus status)
        => isSuccess
           || status == VirtualPosPaymentStatus.Authorized
           || status == VirtualPosPaymentStatus.AccountingPending
           || status == VirtualPosPaymentStatus.AccountingPosted;

    /// <summary>
    /// Sonucu bankadan doğrulanamamış işlem. "Başarısız" demek yanlış olur: parası çekilmiş
    /// olabilir.
    /// </summary>
    public static bool IsUndecided(VirtualPosPaymentStatus status)
    {
        var kind = Classify(false, (int)status);
        return kind is VirtualPosOutcomeKind.Undecided or VirtualPosOutcomeKind.NeedsHuman;
    }
}
