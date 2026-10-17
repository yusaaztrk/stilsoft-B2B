using System;

namespace B2B.Erp.Api.Entities
{
    public sealed class SystemErrorLog
    {
        public long Id { get; set; }
        
        // Tarih & Saat Bilgileri (Saat, Dakika, Saniye)
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime LocalTime { get; set; } = DateTime.Now;

        // Kullanıcı Bilgileri (Kim yaptı)
        public int? UserId { get; set; }
        public string Username { get; set; } = "Anonymous";
        public string UserDisplayName { get; set; } = "Anonim Kullanıcı";
        public string RoleName { get; set; } = string.Empty;
        public string? CariKodu { get; set; }
        public string UserIp { get; set; } = string.Empty;

        // HTTP İstek Detayları
        public string HttpMethod { get; set; } = string.Empty;
        public string RequestPath { get; set; } = string.Empty;
        public string? QueryString { get; set; }
        public string? RequestBodySummary { get; set; }

        // Hata Detayları (Açıklama, Tür, StackTrace, İç Hata)
        public string ExceptionType { get; set; } = string.Empty;
        public string ErrorMessage { get; set; } = string.Empty;
        public string? InnerExceptionMessage { get; set; }
        public string? StackTrace { get; set; }
        public int StatusCode { get; set; } = 500;

        // Sistem / Tenant Bilgisi
        public string SourceModule { get; set; } = "B2B.Erp.Api";
        public string TenantCode { get; set; } = "DEMO";
        
        // Çözüm Durumu
        public bool IsResolved { get; set; } = false;
        public string? ResolutionNotes { get; set; }
        public DateTime? ResolvedAt { get; set; }
        public string? ResolvedBy { get; set; }
    }
}
