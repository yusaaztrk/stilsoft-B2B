using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class InvoicesRepository
{
    private readonly string _connStr;

    public InvoicesRepository(IConfiguration config)
    {
        _connStr = config.GetConnectionString("EcommerceDb") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(_connStr))
            throw new InvalidOperationException("ConnectionStrings:EcommerceDb must be configured.");
    }

    public async Task EnsureCreatedAsync(CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
CREATE SEQUENCE IF NOT EXISTS invoice_no_seq START 1;

CREATE TABLE IF NOT EXISTS invoices (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL,
    invoice_no text NOT NULL UNIQUE,
    order_no text NOT NULL,
    grand_total numeric(18,2) NOT NULL,
    pdf_path text NOT NULL,
    created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_invoices_order_id ON invoices (order_id);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<string> GenerateInvoiceNoAsync(CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT nextval('invoice_no_seq')";
        var seqVal = Convert.ToInt64(await cmd.ExecuteScalarAsync(cancellationToken));
        
        return $"FTR{DateTime.UtcNow:yyyy}{seqVal:D9}";
    }

    public async Task<StoreInvoice> CreateAsync(StoreInvoice invoice, CancellationToken cancellationToken)
    {
        invoice.Id = invoice.Id == Guid.Empty ? Guid.NewGuid() : invoice.Id;
        invoice.CreatedAtUtc = DateTimeOffset.UtcNow;

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO invoices (id, order_id, invoice_no, order_no, grand_total, pdf_path, created_at_utc)
VALUES (@id, @order_id, @invoice_no, @order_no, @grand_total, @pdf_path, @created_at_utc);";
        
        cmd.Parameters.AddWithValue("id", invoice.Id);
        cmd.Parameters.AddWithValue("order_id", invoice.OrderId);
        cmd.Parameters.AddWithValue("invoice_no", invoice.InvoiceNo);
        cmd.Parameters.AddWithValue("order_no", invoice.OrderNo);
        cmd.Parameters.AddWithValue("grand_total", invoice.GrandTotal);
        cmd.Parameters.AddWithValue("pdf_path", invoice.PdfPath);
        cmd.Parameters.AddWithValue("created_at_utc", invoice.CreatedAtUtc);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
        return invoice;
    }

    public async Task<StoreInvoice?> GetByOrderIdAsync(Guid orderId, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, order_id, invoice_no, order_no, grand_total, pdf_path, created_at_utc FROM invoices WHERE order_id = @order_id";
        cmd.Parameters.AddWithValue("order_id", orderId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (await reader.ReadAsync(cancellationToken))
        {
            return new StoreInvoice
            {
                Id = reader.GetGuid(0),
                OrderId = reader.GetGuid(1),
                InvoiceNo = reader.GetString(2),
                OrderNo = reader.GetString(3),
                GrandTotal = reader.GetDecimal(4),
                PdfPath = reader.GetString(5),
                CreatedAtUtc = reader.GetFieldValue<DateTimeOffset>(6)
            };
        }
        return null;
    }
}
