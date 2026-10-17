using System;

namespace ServiceOps.Domain.Entities;

/// <summary>
/// Bir montaj kabul kaydının tek bir kalemi (ürün satırı). Kabul kaydı artık tek ürün +
/// açıklama metnine gömülü "Miktar: N" değil; her ürün satırı ayrı bir kalem ve planlama
/// bu kalemler üzerinden yapılıyor.
/// </summary>
public class ServiceRecordItem
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid ServiceId { get; set; }
    public ServiceRecord Service { get; set; } = null!;

    public string ProductName { get; set; } = string.Empty;
    public string? ProductStockCode { get; set; }
    public string? SerialNumber { get; set; }

    public int Quantity { get; set; } = 1;

    public string? Notes { get; set; }

    /// <summary>
    /// Bu kalemin montajının gideceği son müşteri.
    ///
    /// Bir fatura tek montaj kaydına düşüyor ama aynı faturada farklı adreslere montaj olabilir;
    /// o yüzden müşteri/adres kayıt düzeyinde değil KALEM düzeyinde tutulur. Boşsa kaydın kendi
    /// müşteri bilgisi geçerlidir (tek adresli kayıtlarda ve eski kayıtlarda böyle).
    /// </summary>
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }
    public string? CustomerAddress { get; set; }

    /// <summary>
    /// Kalemi üreten dış kaydın kimliği (B2B fatura montajı için "B2B-INST-{id}").
    /// Webhook aynı montajı iki kez gönderdiğinde kalem çoğalmasın, fatura/kalem silindiğinde
    /// hangi kalemin düşeceği ürün adına bakmadan bulunabilsin diye var.
    /// </summary>
    public string? ExternalRef { get; set; }

    /// <summary>Formda göründüğü sıra; planlama ekranı da bu sırayla listeler.</summary>
    public int SortOrder { get; set; }

    /// <summary>
    /// Kalem iptal edildiyse dolu. İptal KALEM seviyesindedir: aynı kaydın (faturanın) diğer
    /// kalemleri işlemeye devam eder, kayıt ancak TÜM kalemleri iptal olduğunda iptale düşer.
    ///
    /// Görev satırlarının hepsini iptal etmek TEK BAŞINA yetmez, bu damga da şart:
    /// <c>EnsureDeferredTasksForItemsAsync</c> eksik adedi tamamlarken iptal satırlarını
    /// saymadığı için, damgasız kalan bir kalem ilk liste yenilemesinde tertemiz "Yeni Kayıt"
    /// satırlarıyla geri dirilirdi.
    /// </summary>
    public DateTime? CancelledAt { get; set; }

    /// <summary>Kullanıcının girdiği iptal nedeni; kalemin her görev satırının geçmişine de yazılır.</summary>
    public string? CancelReason { get; set; }

    /// <summary>
    /// Bu KALEMİN servis fişinin en son basıldığı an; hiç basılmadıysa boş.
    ///
    /// <para>Fiş basımı en baştan beri kalem bazlıydı (fiş ekranı <c>itemId</c> alıyor), ama
    /// damga değildi: basım yalnızca KAYIT üzerindeki <see cref="ServiceRecord.IsPrinted"/>
    /// bayrağını set ediyordu. Sonucu, aynı faturanın bir kalemini bastığınızda listedeki
    /// bütün kalemlerin "Servis Fişi ✓" görünmesiydi — hangi fişin gerçekten basıldığı
    /// okunamıyordu (2026-09-09 kullanıcı şikâyeti).</para>
    ///
    /// <para><b>Neden bool değil tarih:</b> kullanıcı tik'in yanında basım tarihini de
    /// istiyor. Tarih hem tik'i (dolu mu?) hem de "ne zaman basıldı"yı tek alanda taşır.</para>
    ///
    /// <para><b>IsPrinted'in yerine GEÇMEZ.</b> O bayrak sahaya aktarım kilidinin kendisi
    /// (bkz. <c>ServiceRecordsController.MarkAsPrinted</c>) ve kayıt düzeyinde kalmaya devam
    /// eder; buradaki damga yalnızca hangi kalemin fişinin basıldığını gösterir.</para>
    ///
    /// <para>Yeniden basımda ÜSTÜNE yazılır: kullanıcının sorusu "en son ne zaman basıldı".
    /// Basım geçmişinin tamamı zaten Activities'te duruyor.</para>
    /// </summary>
    public DateTime? SlipPrintedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
