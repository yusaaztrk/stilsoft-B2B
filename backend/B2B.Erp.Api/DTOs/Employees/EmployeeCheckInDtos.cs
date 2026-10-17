using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.Employees;

public static class EmployeeCheckInDtos
{
    public sealed class UpsertRequest
    {
        public DateTime CheckInTime { get; set; }
    }

    public sealed class UpsertCheckOutRequest
    {
        public DateTime CheckOutTime { get; set; }

        [Range(-90.0, 90.0, ErrorMessage = "Geçersiz enlem değeri.")]
        public decimal? CheckOutLatitude { get; set; }

        [Range(-180.0, 180.0, ErrorMessage = "Geçersiz boylam değeri.")]
        public decimal? CheckOutLongitude { get; set; }
    }

    public sealed class ListItemResponse
    {
        public int Id { get; set; }
        public int EmployeeId { get; set; }
        public DateTime CheckInTime { get; set; }
        public DateTime? CheckOutTime { get; set; }
        public decimal Latitude { get; set; }
        public decimal Longitude { get; set; }
        public decimal CheckOutLatitude { get; set; }
        public decimal CheckOutLongitude { get; set; }
        public string? City { get; set; }
        public string? District { get; set; }
        public string CreateUser { get; set; } = string.Empty;
        public DateTime CreateTime { get; set; }
    }
}
