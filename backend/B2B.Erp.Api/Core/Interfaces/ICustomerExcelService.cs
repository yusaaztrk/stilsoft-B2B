using Microsoft.AspNetCore.Http;

namespace B2B.Erp.Api.Core.Interfaces;

public interface ICustomerExcelService
{
    Task<byte[]> BuildTemplateAsync(CancellationToken cancellationToken);

    Task<byte[]> BuildExportAsync(CancellationToken cancellationToken);

    Task<CustomerExcelImportResult> ImportAsync(IFormFile file, CancellationToken cancellationToken);
}

public sealed class CustomerExcelImportResult
{
    public int SuccessCount { get; set; }

    public List<CustomerExcelImportRowError> RowErrors { get; set; } = new();
}

public sealed class CustomerExcelImportRowError
{
    public int RowNumber { get; set; }

    public string? CustomerCode { get; set; }

    public List<string> Errors { get; set; } = new();
}
