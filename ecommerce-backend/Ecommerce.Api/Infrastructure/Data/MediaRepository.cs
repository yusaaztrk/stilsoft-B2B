using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class MediaItemEntity
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public long Size { get; set; }
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public string Folder { get; set; } = string.Empty;
}

public sealed class MediaRepository
{
    private readonly string _connStr;

    public MediaRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS media_library (
  id text PRIMARY KEY,
  name text NOT NULL,
  url text NOT NULL,
  type text NOT NULL,
  size bigint NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  folder text NOT NULL DEFAULT 'Genel'
);
CREATE INDEX IF NOT EXISTS ix_media_library_folder ON media_library (folder);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<MediaItemEntity>> ListAllAsync(CancellationToken cancellationToken)
    {
        var result = new List<MediaItemEntity>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, name, url, type, size, uploaded_at, folder FROM media_library ORDER BY uploaded_at DESC";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new MediaItemEntity
            {
                Id = reader.GetString(0),
                Name = reader.GetString(1),
                Url = reader.GetString(2),
                Type = reader.GetString(3),
                Size = reader.GetInt64(4),
                UploadedAt = reader.GetFieldValue<DateTimeOffset>(5).UtcDateTime,
                Folder = reader.GetString(6)
            });
        }
        return result;
    }

    public async Task InsertAsync(MediaItemEntity item, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO media_library (id, name, url, type, size, uploaded_at, folder)
VALUES (@id, @name, @url, @type, @size, @uploaded_at, @folder)
ON CONFLICT (id) DO NOTHING;
";
        cmd.Parameters.AddWithValue("id", item.Id);
        cmd.Parameters.AddWithValue("name", item.Name);
        cmd.Parameters.AddWithValue("url", item.Url);
        cmd.Parameters.AddWithValue("type", item.Type);
        cmd.Parameters.AddWithValue("size", item.Size);
        cmd.Parameters.AddWithValue("uploaded_at", new DateTimeOffset(item.UploadedAt));
        cmd.Parameters.AddWithValue("folder", string.IsNullOrWhiteSpace(item.Folder) ? "Genel" : item.Folder);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task DeleteAsync(string id, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM media_library WHERE id = @id";
        cmd.Parameters.AddWithValue("id", id);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task RenameAsync(string id, string newName, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE media_library SET name = @name WHERE id = @id";
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("name", newName);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
