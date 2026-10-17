namespace B2B.Erp.Api.Dtos.Reports;

public sealed class CustomerAgeingReportItemDto
{
    public string CustomerCode { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public string Region { get; set; } = string.Empty;
    public string SalesmanName { get; set; } = string.Empty;
    public string Group { get; set; } = string.Empty;
    /// <summary>
    /// Satırın para birimi (1=TRY 2=EUR 3=USD 4=GBP). Yaşlandırma para birimi başına AYRI
    /// yürür (2026-08-17): dolar borcu TL ödemeyle kapanmaz, tutarlar TL'ye çevrilip
    /// toplanmaz. Bir carinin iki para biriminde açık borcu varsa iki satır çıkar.
    /// </summary>
    public int CurrencyTypeId { get; set; } = 1;

    /// <summary>Ekranda basılacak kod: TRY / EUR / USD / GBP.</summary>
    public string CurrencyCode { get; set; } = "TRY";

    public decimal TotalDebit { get; set; }
    public decimal Devir { get; set; }
    public decimal[] MonthlyDebits { get; set; } = new decimal[12]; // 0: Jan, 1: Feb, ..., 11: Dec
}

public sealed class CustomerAgeingReportResponseDto
{
    public int Year { get; set; }

    /// <summary>Süzgeçte seçili para birimi; genel toplamlar YALNIZ bu para birimine aittir.</summary>
    public int CurrencyTypeId { get; set; } = 1;

    public string CurrencyCode { get; set; } = "TRY";

    /// <summary>Raporda hareketi olan para birimleri — ekran süzgeci bunları düğme yapar.</summary>
    public List<int> AvailableCurrencyTypeIds { get; set; } = new();

    public List<CustomerAgeingReportItemDto> Items { get; set; } = new();
    public decimal GrandTotalDebit { get; set; }
    public decimal GrandTotalDevir { get; set; }
    public decimal[] GrandMonthlyTotals { get; set; } = new decimal[12];
}
