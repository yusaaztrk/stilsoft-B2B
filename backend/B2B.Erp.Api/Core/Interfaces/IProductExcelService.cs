using Microsoft.AspNetCore.Http;

namespace B2B.Erp.Api.Core.Interfaces;

public interface IProductExcelService
{
    Task<byte[]> BuildTemplateAsync(CancellationToken cancellationToken);

    Task<byte[]> BuildExportAsync(CancellationToken cancellationToken);

    Task<ProductExcelImportResult> ImportAsync(IFormFile file, CancellationToken cancellationToken);
}

public sealed class ProductExcelImportResult
{
    public int SuccessCount { get; set; }

    public List<ProductExcelImportRowError> RowErrors { get; set; } = new();

    internal List<(string StockCode, List<(int Code, int Qty)> Stocks)> WarehouseStocksToCreate { get; set; } = new();
}

public sealed class ProductExcelImportRowError
{
    public int RowNumber { get; set; }

    public string? StockCode { get; set; }

    public List<string> Errors { get; set; } = new();
}
