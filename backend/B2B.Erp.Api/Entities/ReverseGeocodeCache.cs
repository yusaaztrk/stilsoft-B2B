namespace B2B.Erp.Api.Entities;

public sealed class ReverseGeocodeCache
{
    public int Id { get; set; }

    public decimal RoundedLatitude { get; set; }

    public decimal RoundedLongitude { get; set; }

    public string? City { get; set; }

    public string? District { get; set; }

    public DateTime LastFetchedUtc { get; set; }
}
