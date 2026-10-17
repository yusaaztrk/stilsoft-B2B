using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.Qr;

public static class QrDtos
{
    public sealed class DailyQrResponse
    {
        public string Date { get; set; } = string.Empty;
        public string Path { get; set; } = string.Empty;
    }

    public sealed class EmployeeCheckInRequest
    {
        [Required]
        [StringLength(100)]
        public string Username { get; set; } = string.Empty;

        [Required]
        [StringLength(100)]
        public string Password { get; set; } = string.Empty;

        [Range(-90.0, 90.0, ErrorMessage = "Geçersiz enlem değeri.")]
        public decimal Latitude { get; set; }

        [Range(-180.0, 180.0, ErrorMessage = "Geçersiz boylam değeri.")]
        public decimal Longitude { get; set; }

        /// <summary>Telefonun bildirdiği konum hassasiyeti (m); sahte konum tespitinde kullanılır.</summary>
        public double? Accuracy { get; set; }
    }

    public sealed class EmployeeCheckOutRequest
    {
        [Required]
        [StringLength(100)]
        public string Username { get; set; } = string.Empty;

        [Required]
        [StringLength(100)]
        public string Password { get; set; } = string.Empty;

        [Range(-90.0, 90.0, ErrorMessage = "Geçersiz enlem değeri.")]
        public decimal Latitude { get; set; }

        [Range(-180.0, 180.0, ErrorMessage = "Geçersiz boylam değeri.")]
        public decimal Longitude { get; set; }

        /// <summary>Telefonun bildirdiği konum hassasiyeti (m); sahte konum tespitinde kullanılır.</summary>
        public double? Accuracy { get; set; }
    }
}
