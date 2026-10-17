using System.Data;
using B2B.Erp.Api.Core.Audit;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// Genel Ayarlar → Sistem Denetimi. 2026-09-13 oturumunda elle çalıştırılan denetim
/// SQL'lerinin (genel-denetim*.sql) uygulama içi hali. Tamamen SALT OKUMA — hiçbir
/// sorgu veri değiştirmez. Her sorgu birbirinden bağımsız çalışır: biri hata verirse
/// diğerleri etkilenmez.
/// </summary>
[ApiController]
[Route("api/system-audit")]
[Authorize]
public sealed class SystemAuditController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public SystemAuditController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public sealed class AuditCheckResultDto
    {
        public required string Category { get; set; }
        public required string Id { get; set; }
        public required string Title { get; set; }
        public string? Note { get; set; }
        public required List<string> Columns { get; set; }
        public required List<List<string?>> Rows { get; set; }
        public int RowCount { get; set; }
        public bool Error { get; set; }
        public string? ErrorMessage { get; set; }
        public long ElapsedMs { get; set; }
    }

    [HttpPost("run")]
    [AuthorizePage("users", "sistemDenetimi")]
    public async Task<IActionResult> Run(CancellationToken cancellationToken)
    {
        var results = new List<AuditCheckResultDto>();
        var connection = _dbContext.Database.GetDbConnection();
        var shouldClose = connection.State != ConnectionState.Open;
        if (shouldClose)
        {
            await connection.OpenAsync(cancellationToken);
        }

        try
        {
            foreach (var check in SystemAuditQueries.All)
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                try
                {
                    await using var cmd = connection.CreateCommand();
                    cmd.CommandText = check.Sql;
                    cmd.CommandTimeout = 30;

                    var columns = new List<string>();
                    var rows = new List<List<string?>>();

                    await using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
                    {
                        for (var i = 0; i < reader.FieldCount; i++)
                        {
                            columns.Add(reader.GetName(i));
                        }

                        while (await reader.ReadAsync(cancellationToken))
                        {
                            var row = new List<string?>(reader.FieldCount);
                            for (var i = 0; i < reader.FieldCount; i++)
                            {
                                row.Add(reader.IsDBNull(i) ? null : Convert.ToString(reader.GetValue(i)));
                            }
                            rows.Add(row);
                        }
                    }

                    sw.Stop();
                    results.Add(new AuditCheckResultDto
                    {
                        Category = check.Category,
                        Id = check.Id,
                        Title = check.Title,
                        Note = check.Note,
                        Columns = columns,
                        Rows = rows,
                        RowCount = rows.Count,
                        Error = false,
                        ElapsedMs = sw.ElapsedMilliseconds
                    });
                }
                catch (Exception ex)
                {
                    sw.Stop();
                    results.Add(new AuditCheckResultDto
                    {
                        Category = check.Category,
                        Id = check.Id,
                        Title = check.Title,
                        Note = check.Note,
                        Columns = new List<string>(),
                        Rows = new List<List<string?>>(),
                        RowCount = 0,
                        Error = true,
                        ErrorMessage = ex.Message,
                        ElapsedMs = sw.ElapsedMilliseconds
                    });
                }
            }
        }
        finally
        {
            if (shouldClose)
            {
                await connection.CloseAsync();
            }
        }

        return Ok(new
        {
            success = true,
            data = results,
            ranAtUtc = DateTime.UtcNow
        });
    }
}
