using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Npgsql;
using Microsoft.Extensions.Configuration;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class InformationPagesRepository
{
    private readonly string _connStr;

    public InformationPagesRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS information_pages (
  key varchar(50) PRIMARY KEY,
  title varchar(200) NOT NULL,
  content_html text NOT NULL,
  updated_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);

        // Seed default pages if they don't exist
        var defaultPages = new List<(string Key, string Title, string Content)>
        {
            ("about-us", "Hakkımızda", "<h1>Hakkımızda</h1><p>Biz en kaliteli ürünleri sunan bir teknoloji mağazasıyız.</p>"),
            ("kvkk", "KVKK Aydınlatma Metni", "<h1>KVKK Aydınlatma Metni</h1><p>Kişisel verilerinizin korunması politikamız...</p>"),
            ("privacy", "Gizlilik Politikası", "<h1>Gizlilik Sözleşmesi</h1><p>Gizlilik şartlarımız...</p>"),
            ("distance-selling", "Mesafeli Satış Sözleşmesi", "<h1>Mesafeli Satış Sözleşmesi</h1><p>Satış koşulları...</p>"),
            ("returns", "İade ve Değişim Koşulları", "<h1>İade Koşulları</h1><p>İade ve değişim süreçleri...</p>"),
            ("help", "Destek / SSS", "<h1>Destek ve Yardım</h1><p>Sıkça sorulan sorular...</p>")
        };

        foreach (var page in defaultPages)
        {
            await using var checkCmd = conn.CreateCommand();
            checkCmd.CommandText = "SELECT COUNT(1) FROM information_pages WHERE key = @Key";
            checkCmd.Parameters.AddWithValue("Key", page.Key);
            var count = Convert.ToInt64(await checkCmd.ExecuteScalarAsync(cancellationToken));

            if (count == 0)
            {
                await using var insertCmd = conn.CreateCommand();
                insertCmd.CommandText = @"
INSERT INTO information_pages (key, title, content_html, updated_at_utc)
VALUES (@Key, @Title, @Content, (now() AT TIME ZONE 'utc'))";
                insertCmd.Parameters.AddWithValue("Key", page.Key);
                insertCmd.Parameters.AddWithValue("Title", page.Title);
                insertCmd.Parameters.AddWithValue("Content", page.Content);
                await insertCmd.ExecuteNonQueryAsync(cancellationToken);
            }
        }
    }

    public async Task<List<InformationPage>> GetAllAsync(CancellationToken cancellationToken)
    {
        var list = new List<InformationPage>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT key, title, content_html, updated_at_utc FROM information_pages ORDER BY key ASC";
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(new InformationPage
            {
                Key = reader.GetString(0),
                Title = reader.GetString(1),
                ContentHtml = reader.GetString(2),
                UpdatedAtUtc = reader.GetDateTime(3)
            });
        }
        return list;
    }

    public async Task<InformationPage?> GetByKeyAsync(string key, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT key, title, content_html, updated_at_utc FROM information_pages WHERE key = @Key";
        cmd.Parameters.AddWithValue("Key", key);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (await reader.ReadAsync(cancellationToken))
        {
            return new InformationPage
            {
                Key = reader.GetString(0),
                Title = reader.GetString(1),
                ContentHtml = reader.GetString(2),
                UpdatedAtUtc = reader.GetDateTime(3)
            };
        }
        return null;
    }

    public async Task UpsertPageAsync(string key, string title, string contentHtml, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO information_pages (key, title, content_html, updated_at_utc)
VALUES (@Key, @Title, @Content, (now() AT TIME ZONE 'utc'))
ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, content_html = EXCLUDED.content_html, updated_at_utc = EXCLUDED.updated_at_utc;";
        cmd.Parameters.AddWithValue("Key", key);
        cmd.Parameters.AddWithValue("Title", title);
        cmd.Parameters.AddWithValue("Content", contentHtml);
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
