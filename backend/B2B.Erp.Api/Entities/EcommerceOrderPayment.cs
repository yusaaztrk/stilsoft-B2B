using System;
using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Entities;

/// <summary>
/// Bir e-ticaret siparişi için yapılan tek bir ödeme DENEMESİ.
///
/// Neden ayrı bir tablo: <see cref="VirtualPosTransaction"/> bankaya giden işlemi anlatır,
/// hangi siparişi kapattığını bilmez. Sipariş ile tahsilat arasındaki bağ burada duruyor ve
/// "bu sipariş ödendi mi" sorusunun tek cevabı bu tablo.
///
/// Satır DENEME başına, sipariş başına değil: başarısız bir ödemeden sonra müşteri yeniden
/// denemeli, ama her denemenin izi kalmalı. "Aynı sipariş ikinci kez ödenmiş sayılmaz" kuralı
/// bu yüzden koda değil, veritabanına yazılı — <c>Status = Paid</c> satırları için sipariş
/// numarası üzerinde KISMİ TEKİL indeks var. İki eşzamanlı callback aynı siparişi ödenmiş
/// işaretlemeye kalkarsa ikincisi PostgreSQL tarafından reddedilir; kodun yarışı kazanmasına
/// gerek kalmaz.
/// </summary>
public sealed class EcommerceOrderPayment
{
    /// <summary>
    /// Sanal POS'a verilen sipariş numarası (<c>VirtualPosTransaction.OrderNo</c>).
    /// Anahtar olarak bu seçildi: bankadan geri dönen callback'in elinde yalnızca bu var.
    /// </summary>
    [MaxLength(100)]
    public string MerchantOrderId { get; set; } = string.Empty;

    /// <summary>ERP satış siparişinin numarası — ödemenin neyi kapattığı.</summary>
    [MaxLength(50)]
    public string SalesOrderNo { get; set; } = string.Empty;

    [MaxLength(50)]
    public string CustomerCode { get; set; } = string.Empty;

    /// <summary>
    /// Denemenin başlatıldığı andaki sipariş tutarı. İstemciden ALINMAZ, siparişten okunur;
    /// bankadan dönen tutar bununla karşılaştırılır.
    /// </summary>
    public decimal Amount { get; set; }

    [MaxLength(3)]
    public string CurrencyCode { get; set; } = "TRY";

    /// <summary>Bkz. <see cref="EcommercePaymentStatus"/>. Sayılar kalıcı, yeniden numaralanmaz.</summary>
    public int Status { get; set; }

    [MaxLength(50)]
    public string AuthCode { get; set; } = string.Empty;

    [MaxLength(500)]
    public string FailureMessage { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    /// <summary>Sonucun öğrenildiği an; deneme hâlâ bankadayken null.</summary>
    public DateTime? SettledAtUtc { get; set; }
}

/// <summary>
/// Ödeme denemesinin durumu. Kayıtlı sayılar değiştirilmez, yenisi sona eklenir.
///
/// <see cref="Pending"/> "başarısız" DEĞİLDİR: müşteri banka sayfasındayken de bu durumdadır.
/// Bekleyeni başarısız saymak, ödenmiş bir siparişin ikinci kez ödenmesine izin vermek demektir.
/// </summary>
public enum EcommercePaymentStatus
{
    /// <summary>Banka sayfasına yönlendirildi, sonuç henüz gelmedi.</summary>
    Pending = 0,

    /// <summary>Banka tahsil etti. Bir sipariş için EN FAZLA bir satır bu durumda olabilir.</summary>
    Paid = 1,

    /// <summary>Banka reddetti ya da doğrulama geçilemedi. Müşteri yeniden deneyebilir.</summary>
    Failed = 2,

    /// <summary>
    /// Para hareket etti ama kayıt temiz kapanamadı — İNSAN BAKMALI.
    ///
    /// İki hâli var: (a) aynı sipariş için başka bir deneme zaten ödenmiş (çift tahsilat, iade
    /// gerekir), (b) siparişin tutarı ödeme sürerken değişmiş. İkisi de <c>Failed</c> değil:
    /// başarısız demek, tahsil edilmiş parayı yok saymak olurdu. <c>Paid</c> de değil: sipariş
    /// bu satırla kapatılamaz. Ayrımı <c>FailureMessage</c> anlatır.
    /// </summary>
    NeedsReview = 3,

    /// <summary>Müşteri "Havale/EFT" seçti; IBAN'lar gösterildi, para henüz bildirilmedi (2026-09-20).</summary>
    BankTransferRequested = 4,

    /// <summary>Müşteri "Gönderdim" dedi; bayinin banka ekstresinde görüp onaylaması bekleniyor.</summary>
    BankTransferSent = 5
}
