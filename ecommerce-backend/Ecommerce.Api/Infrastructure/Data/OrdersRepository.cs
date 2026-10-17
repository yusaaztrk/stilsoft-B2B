using System.Text.Json;
using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class OrdersRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _connStr;

    public OrdersRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  order_no text NOT NULL UNIQUE,
  customer_id uuid NULL,
  customer_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  status text NOT NULL,
  payment_status text NOT NULL,
  total numeric(18,2) NOT NULL,
  lines_json text NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_orders_created_at ON orders (created_at_utc DESC);
CREATE INDEX IF NOT EXISTS ix_orders_email ON orders (email);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS campaign_discount_amount numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cargo_fee numeric(18,2) NOT NULL DEFAULT 0;
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<StoreOrder> CreateAsync(StoreOrder order, CancellationToken cancellationToken)
    {
        order.Id = order.Id == Guid.Empty ? Guid.NewGuid() : order.Id;
        order.OrderNo = string.IsNullOrWhiteSpace(order.OrderNo) ? $"EC{DateTime.UtcNow:yyyyMMddHHmmssfff}" : order.OrderNo;
        order.Total = Math.Max(0, order.Lines.Sum(x => x.LineTotal) + order.CargoFee);

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO orders (id, order_no, customer_id, customer_name, email, phone, address, status, payment_status, total, lines_json, created_at_utc, coupon_code, discount_amount, campaign_discount_amount, cargo_fee)
VALUES (@id, @no, @customer_id, @name, @email, @phone, @address, @status, @payment, @total, @lines, (now() AT TIME ZONE 'utc'), @coupon_code, @discount_amount, @campaign_discount_amount, @cargo_fee)
RETURNING created_at_utc;";
        cmd.Parameters.AddWithValue("id", order.Id);
        cmd.Parameters.AddWithValue("no", order.OrderNo);
        cmd.Parameters.AddWithValue("customer_id", (object?)order.CustomerId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("name", order.CustomerName.Trim());
        cmd.Parameters.AddWithValue("email", order.Email.Trim().ToLowerInvariant());
        cmd.Parameters.AddWithValue("phone", order.Phone.Trim());
        cmd.Parameters.AddWithValue("address", order.Address.Trim());
        cmd.Parameters.AddWithValue("status", order.Status);
        cmd.Parameters.AddWithValue("payment", order.PaymentStatus);
        cmd.Parameters.AddWithValue("total", order.Total);
        cmd.Parameters.AddWithValue("lines", JsonSerializer.Serialize(order.Lines, JsonOptions));
        cmd.Parameters.AddWithValue("coupon_code", (object?)order.CouponCode ?? DBNull.Value);
        cmd.Parameters.AddWithValue("discount_amount", order.DiscountAmount);
        cmd.Parameters.AddWithValue("campaign_discount_amount", order.CampaignDiscountAmount);
        cmd.Parameters.AddWithValue("cargo_fee", order.CargoFee);
        order.CreatedAtUtc = (await cmd.ExecuteScalarAsync(cancellationToken) as DateTimeOffset? ?? DateTimeOffset.UtcNow);
        return order;
    }

    public async Task<List<StoreOrder>> ListAsync(CancellationToken cancellationToken)
    {
        var result = new List<StoreOrder>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT id, order_no, customer_id, customer_name, email, phone, address, status, payment_status, total, lines_json, created_at_utc, coupon_code, discount_amount, campaign_discount_amount, cargo_fee FROM orders ORDER BY created_at_utc DESC LIMIT 500";
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            result.Add(ReadOrder(reader));
        return result;
    }

    public async Task<List<StoreOrder>> ListByCustomerIdAsync(Guid customerId, int take, CancellationToken cancellationToken)
    {
        if (customerId == Guid.Empty) return new List<StoreOrder>();
        take = Math.Clamp(take, 10, 500);

        var result = new List<StoreOrder>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT id, order_no, customer_id, customer_name, email, phone, address, status, payment_status, total, lines_json, created_at_utc, coupon_code, discount_amount, campaign_discount_amount, cargo_fee FROM orders WHERE customer_id=@cid ORDER BY created_at_utc DESC LIMIT @take";
        cmd.Parameters.AddWithValue("cid", customerId);
        cmd.Parameters.AddWithValue("take", take);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            result.Add(ReadOrder(reader));
        return result;
    }

    public async Task<StoreOrder?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT id, order_no, customer_id, customer_name, email, phone, address, status, payment_status, total, lines_json, created_at_utc, coupon_code, discount_amount, campaign_discount_amount, cargo_fee FROM orders WHERE id=@id";
        cmd.Parameters.AddWithValue("id", id);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (await reader.ReadAsync(cancellationToken))
            return ReadOrder(reader);
        return null;
    }

    public async Task UpdateStatusAsync(Guid id, string status, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"UPDATE orders SET status=@status WHERE id=@id";
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("status", status.Trim());
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<StoreOrder?> GetByOrderNoAsync(string orderNo, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT id, order_no, customer_id, customer_name, email, phone, address, status, payment_status, total, lines_json, created_at_utc, coupon_code, discount_amount, campaign_discount_amount, cargo_fee FROM orders WHERE order_no=@no";
        cmd.Parameters.AddWithValue("no", orderNo.Trim());
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (await reader.ReadAsync(cancellationToken))
            return ReadOrder(reader);
        return null;
    }

    public async Task UpdateStatusAndPaymentAsync(Guid id, string status, string paymentStatus, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"UPDATE orders SET status=@status, payment_status=@paymentStatus WHERE id=@id";
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("status", status.Trim());
        cmd.Parameters.AddWithValue("paymentStatus", paymentStatus.Trim());
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private static StoreOrder ReadOrder(NpgsqlDataReader reader) => new()
    {
        Id = reader.GetGuid(0),
        OrderNo = reader.GetString(1),
        CustomerId = reader.IsDBNull(2) ? null : reader.GetGuid(2),
        CustomerName = reader.GetString(3),
        Email = reader.GetString(4),
        Phone = reader.GetString(5),
        Address = reader.GetString(6),
        Status = reader.GetString(7),
        PaymentStatus = reader.GetString(8),
        Total = reader.GetDecimal(9),
        Lines = JsonSerializer.Deserialize<List<StoreOrderLine>>(reader.GetString(10), JsonOptions) ?? new(),
        CreatedAtUtc = reader.GetFieldValue<DateTimeOffset>(11),
        CouponCode = reader.IsDBNull(12) ? null : reader.GetString(12),
        DiscountAmount = reader.IsDBNull(13) ? 0 : reader.GetDecimal(13),
        CampaignDiscountAmount = reader.IsDBNull(14) ? 0 : reader.GetDecimal(14),
        CargoFee = reader.IsDBNull(15) ? 0 : reader.GetDecimal(15)
    };
}
