using System.Linq;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Features.Ecommerce;

/// <summary>
/// "Bu sipariş faturalanmaya hazır mı" sorusunun e-ticarete bakan yarısı.
///
/// <para>
/// <b>Bayi siparişi ile e-ticaret siparişi aynı kurala tabi değil.</b> Bayi siparişi VADELİ
/// açılır: mal çıkar, fatura kesilir, para sonra cariden tahsil edilir — ödenmemiş olması
/// tamamen normaldir. E-ticarette böyle bir cari ilişki yok; müşteri kartla peşin öder ve
/// sipariş ancak para çekildikten sonra bir taahhüt hâline gelir.
/// </para>
///
/// <para>
/// <b>Neden bu sınıf var:</b> Satış Faturası ekranı sipariş satırlarını yalnızca "kalan miktar
/// var mı" diye süzüyordu. Bu süzgeç bayi siparişi için doğru, e-ticaret siparişi için
/// yanlıştı: müşteri sepeti onaylayıp ödeme sayfasını KAPATSA bile sipariş açılıyor ve
/// faturalanmaya hazır listeye düşüyordu. Oradan kesilen bir fatura stoğu düşürür, cariye borç
/// yazar ve mal sevk edilebilir — parası hiç çekilmemiş bir sipariş için. Kural üç ayrı listede
/// birden gerekiyordu (cari listesi, kalem listesi, faturalanmamış raporu), bu yüzden tek yerde
/// duruyor: birine eklenip diğerine unutulan bir süzgeç, kapalı sanılan bir kapıdır.
/// </para>
/// </summary>
public static class EcommerceInvoiceGate
{
    /// <summary><c>SalesOrder.ProcessedBy</c> alanındaki e-ticaret damgası.</summary>
    public const string OrderMarker = "ETICARET";

    /// <summary>
    /// Parası gerçekten çekilmiş e-ticaret siparişlerinin numaraları.
    ///
    /// Yalnızca <see cref="EcommercePaymentStatus.Paid"/> sayılır. <c>NeedsReview</c> BİLEREK
    /// dışarıda: o durum "para hareket etmiş olabilir ama kayıt temiz kapanmadı" demek ve
    /// faturayı otomatik açmaya yetmez — önce insan bakmalı.
    /// </summary>
    public static IQueryable<string> PaidOrderNos(AppDbContext dbContext)
        => dbContext.EcommerceOrderPayments
            .AsNoTracking()
            .Where(p => p.Status == (int)EcommercePaymentStatus.Paid)
            .Select(p => p.SalesOrderNo);
}
