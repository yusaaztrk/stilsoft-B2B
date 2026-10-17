using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class ContactMessageEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool IsRead { get; set; } = false;
}

public sealed class ContactMessagesRepository
{
    private readonly string _connStr;

    public ContactMessagesRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS contact_messages (
  id uuid PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  is_read boolean NOT NULL DEFAULT false,
  phone text NOT NULL DEFAULT ''
);
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ix_contact_messages_created_at ON contact_messages (created_at DESC);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<ContactMessageEntity>> ListAllAsync(CancellationToken cancellationToken)
    {
        var result = new List<ContactMessageEntity>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, full_name, email, subject, message, created_at, is_read, phone FROM contact_messages ORDER BY created_at DESC";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new ContactMessageEntity
            {
                Id = reader.GetGuid(0),
                FullName = reader.GetString(1),
                Email = reader.GetString(2),
                Subject = reader.GetString(3),
                Message = reader.GetString(4),
                CreatedAt = reader.GetFieldValue<DateTimeOffset>(5).UtcDateTime,
                IsRead = reader.GetBoolean(6),
                Phone = reader.IsDBNull(7) ? string.Empty : reader.GetString(7)
            });
        }
        return result;
    }

    public async Task AddAsync(ContactMessageEntity entity, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO contact_messages (id, full_name, email, subject, message, created_at, is_read, phone)
VALUES (@id, @full_name, @email, @subject, @message, @created_at, @is_read, @phone)
";
        cmd.Parameters.AddWithValue("id", entity.Id);
        cmd.Parameters.AddWithValue("full_name", entity.FullName);
        cmd.Parameters.AddWithValue("email", entity.Email);
        cmd.Parameters.AddWithValue("subject", entity.Subject);
        cmd.Parameters.AddWithValue("message", entity.Message);
        cmd.Parameters.AddWithValue("created_at", new DateTimeOffset(entity.CreatedAt));
        cmd.Parameters.AddWithValue("is_read", entity.IsRead);
        cmd.Parameters.AddWithValue("phone", entity.Phone ?? string.Empty);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task MarkAsReadAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE contact_messages SET is_read = true WHERE id = @id";
        cmd.Parameters.AddWithValue("id", id);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM contact_messages WHERE id = @id";
        cmd.Parameters.AddWithValue("id", id);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
