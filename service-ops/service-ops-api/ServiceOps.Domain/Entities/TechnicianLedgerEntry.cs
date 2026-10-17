using System;

namespace ServiceOps.Domain.Entities;

/// <summary>
/// Servis personelinin hak ediş defteri: bir personelin yaptığı işlerden doğan alacağı ve
/// kendisine yapılan ödemeler.
///
/// B2B'deki CARİ EKSTRE İLE AYNI ŞEY DEĞİLDİR ve aynı tabloya bağlanmaz. Cari ekstre müşterinin
/// borcunu/alacağını tutar; bu defter şirketin personele borcunu tutar. İkisi yalnızca ekranda
/// birbirine benzer.
/// </summary>
public class TechnicianLedgerEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string? TenantCode { get; set; }

    public Guid TechnicianId { get; set; }
    public Technician Technician { get; set; } = null!;

    /// <summary>Hareketin defterdeki tarihi (işin tamamlandığı ya da ödemenin yapıldığı gün).</summary>
    public DateTime EntryDate { get; set; }

    public string Description { get; set; } = string.Empty;

    /// <summary>Varsa ilgili servis/iş numarası — ekstrede satırın hangi işe ait olduğunu gösterir.</summary>
    public string? ReferenceNumber { get; set; }

    /// <summary>Personelin borcu (şirketin ona ödediği): bakiyeyi azaltır.</summary>
    public decimal Debit { get; set; }

    /// <summary>Personelin alacağı (hak ettiği): bakiyeyi artırır.</summary>
    public decimal Credit { get; set; }

    /// <summary>
    /// Hareketin KENDİ para birimi. Bakiye para birimi başına ayrı hesaplanır; farklı dövizler
    /// tek bir tutarda toplanmaz.
    /// </summary>
    public string Currency { get; set; } = "TRY";

    /// <summary>Kullanılan kur ve TL karşılığı — bilgi amaçlı; orijinal tutar hiçbir zaman ezilmez.</summary>
    public decimal? ExchangeRate { get; set; }
    public decimal? LocalAmount { get; set; }
    public DateTime? ExchangeRateDate { get; set; }

    public LedgerEntryType EntryType { get; set; }

    /// <summary>
    /// Hareketi doğuran kayıt (hak ediş satırı). Aynı hak edişten iki defter satırı çıkmasın diye
    /// (EntryType, SourceId) üzerinde benzersiz indeks var.
    /// </summary>
    public Guid? SourceId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? CreatedBy { get; set; }
}

public enum LedgerEntryType
{
    /// <summary>Tamamlanan işten doğan hak ediş (alacak).</summary>
    Earning = 0,

    /// <summary>Personele yapılan ödeme (borç).</summary>
    Payment = 1,

    /// <summary>Elle düzeltme; iki yönde de olabilir.</summary>
    Adjustment = 2
}
