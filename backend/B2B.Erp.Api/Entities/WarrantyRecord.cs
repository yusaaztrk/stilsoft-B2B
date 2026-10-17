using System;
using System.Collections.Generic;

namespace B2B.Erp.Api.Entities;

public sealed class WarrantyRecord : AuditableEntity
{
    public int Id { get; set; }
    public string TransactionType { get; set; } = "GARANTİ"; // GARANTİ, SERVİS GARANTİ, DEĞİŞİM
    public DateTime RecordDate { get; set; } = DateTime.UtcNow;
    public string WarrantyNo { get; set; } = string.Empty; // GR-000001
    public string CustomerCode { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public string Status { get; set; } = "AÇIK"; // AÇIK, SERVİSTE, BEKLEMEDE, TAMAMLANDI, DEĞİŞİM YAPILDI, İPTAL
    public decimal GrossAmount { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal NetAmount { get; set; }
    public decimal VatAmount { get; set; }
    public decimal TotalAmount { get; set; }

    /// <summary>
    /// Yukarıdaki beş tutarın para birimi (1=TRY 2=EUR 3=USD 4=GBP).
    ///
    /// NEDEN VAR: tutarlar ürünün SATIŞ fiyatından geliyor ve o fiyat dolar olabiliyor
    /// (<c>ProductPrice.Currency</c>). Para birimi yazılmadığı sürece 500 dolarlık bir
    /// garanti kaydı ekranda 500 ₺ görünüyordu ve KPI toplamlarına TL gibi giriyordu.
    /// Eski kayıtlar 1 (TL) ile doldurulur — davranışları değişmez.
    /// </summary>
    public int CurrencyTypeId { get; set; } = 1;

    /// <summary>Kayıt anındaki TL kuru. TL kayıtta 1. Toplamların TL karşılığı bununla alınır.</summary>
    public decimal CurrencyRate { get; set; } = 1m;
    public string? SalesmanCode { get; set; } // Plasiyer
    public string CreatedByUserName { get; set; } = string.Empty; // İşlem Yapan
    public string? SerialNo { get; set; }
    public string ProductCode { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public string? BrandModel { get; set; }
    public string? WarrantyStatus { get; set; }
    public DateTime LastStatusDate { get; set; } = DateTime.UtcNow;
    public string? FaultDescription { get; set; }
    public int WarrantyPeriodMonths { get; set; }
    public DateTime? CompletedDate { get; set; }

    public ICollection<WarrantyHistory> Histories { get; set; } = new List<WarrantyHistory>();
}
