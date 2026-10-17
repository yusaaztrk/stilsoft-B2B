using System.Globalization;
using System.Text;
using Npgsql;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Storefront;

public sealed class ContentPage
{
    public Guid Id { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Summary { get; set; }
    public string Body { get; set; } = string.Empty;
    public bool IsPublished { get; set; }
    public bool ShowInFooter { get; set; }
    public int SortOrder { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

/// <summary>
/// Bayinin kendi yazdığı içerik sayfaları ("Hakkımızda", "Sıkça sorulanlar" gibi).
///
/// YASAL SAYFALARIN YERİNE GEÇMEZ: mesafeli satış, KVKK ve çerez sayfaları kod içinde duruyor
/// çünkü tablolu yapıları var ve firma bilgisini ayarlardan çekiyorlar. Serbest metne
/// indirgenirlerse hem o yapı hem "eksik bilgi" uyarısı kaybolur.
///
/// Gövde <b>düz metin</b> olarak saklanıyor, HTML değil. Sebep: panele HTML yazma imkânı vermek,
/// vitrine istediği etiketi sokabilen bir kapı açmak demek — bir personel hesabı ele geçtiğinde
/// mağazanın her sayfasına betik eklenebilirdi. Vitrin metni paragraflara bölüp basıyor;
/// "## " ile başlayan satır ara başlık, "- " ile başlayan satır madde oluyor.
/// </summary>
public sealed class ContentPageStore
{
    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;

    /// <summary>Vitrinin kendi rotalarıyla çakışacak adresler. Çakışma sessiz bir 404 üretirdi.</summary>
    private static readonly HashSet<string> ReservedSlugs = new(StringComparer.OrdinalIgnoreCase)
    {
        "urunler", "urun", "kategori", "arama", "sepet", "odeme", "hesabim", "giris", "uye-ol",
        "mesafeli-satis", "gizlilik", "kvkk", "cerez", "teslimat", "servis", "iletisim",
        "sitemap.xml", "robots.txt", "api", "sayfa"
    };

    public ContentPageStore(TenantResolver tenant, ShopSchema schema)
    {
        _tenant = tenant;
        _schema = schema;
    }

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        return conn;
    }

    public static string Slugify(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;

        // Türkçe harfler önce karşılıklarına çevriliyor: Unicode normalizasyonu 'ı' ve 'ş' gibi
        // harfleri beklenen şekilde ayıklamıyor, adres "hakkmzda" gibi çıkıyordu.
        var map = new Dictionary<char, string>
        {
            ['ç'] = "c", ['Ç'] = "c", ['ğ'] = "g", ['Ğ'] = "g", ['ı'] = "i", ['I'] = "i",
            ['İ'] = "i", ['i'] = "i", ['ö'] = "o", ['Ö'] = "o", ['ş'] = "s", ['Ş'] = "s",
            ['ü'] = "u", ['Ü'] = "u"
        };

        var sb = new StringBuilder();
        foreach (var ch in value.Trim())
        {
            if (map.TryGetValue(ch, out var replacement)) { sb.Append(replacement); continue; }
            if (char.IsLetterOrDigit(ch)) { sb.Append(char.ToLowerInvariant(ch)); continue; }
            if (ch is ' ' or '-' or '_' or '/') sb.Append('-');
        }

        var slug = sb.ToString();
        while (slug.Contains("--", StringComparison.Ordinal)) slug = slug.Replace("--", "-");
        return slug.Trim('-');
    }

    public async Task<IReadOnlyList<ContentPage>> ListAsync(bool onlyPublished, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand($"""
            SELECT id, slug, title, summary, body, is_published, show_in_footer, sort_order, updated_at, updated_by
            FROM public.content_pages
            {(onlyPublished ? "WHERE is_published" : "")}
            ORDER BY sort_order, title
            """, conn);

        var rows = new List<ContentPage>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) rows.Add(Read(reader));
        return rows;
    }

    public async Task<ContentPage?> GetBySlugAsync(string slug, bool onlyPublished, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand($"""
            SELECT id, slug, title, summary, body, is_published, show_in_footer, sort_order, updated_at, updated_by
            FROM public.content_pages
            WHERE lower(slug) = lower(@s) {(onlyPublished ? "AND is_published" : "")}
            LIMIT 1
            """, conn);
        cmd.Parameters.AddWithValue("s", (slug ?? string.Empty).Trim());

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? Read(reader) : null;
    }

    /// <returns>Hata metni; null ise kaydedildi.</returns>
    public async Task<string?> SaveAsync(ContentPage page, string updatedBy, CancellationToken ct)
    {
        var title = (page.Title ?? string.Empty).Trim();
        if (title.Length == 0) return "Başlık zorunlu.";

        var slug = Slugify(string.IsNullOrWhiteSpace(page.Slug) ? title : page.Slug);
        if (slug.Length == 0) return "Adres üretilemedi. Başlıkta en az bir harf ya da rakam olmalı.";
        if (ReservedSlugs.Contains(slug)) return $"'{slug}' adresi sitenin kendi sayfalarından biri; başka bir adres seçin.";

        await using var conn = await OpenAsync(ct);

        // Adres tekilliği veritabanında da tutuluyor (kısmi olmayan tekil indeks); buradaki
        // kontrol yalnızca kullanıcıya okunabilir bir mesaj vermek için.
        await using (var clash = new NpgsqlCommand(
            "SELECT 1 FROM public.content_pages WHERE lower(slug) = lower(@s) AND id <> @id LIMIT 1", conn))
        {
            clash.Parameters.AddWithValue("s", slug);
            clash.Parameters.AddWithValue("id", page.Id == Guid.Empty ? Guid.NewGuid() : page.Id);
            if (await clash.ExecuteScalarAsync(ct) is not null) return $"'{slug}' adresi başka bir sayfada kullanılıyor.";
        }

        var id = page.Id == Guid.Empty ? Guid.NewGuid() : page.Id;

        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.content_pages (id, slug, title, summary, body, is_published, show_in_footer, sort_order, created_at, updated_at, updated_by)
            VALUES (@id, @slug, @title, @summary, @body, @pub, @footer, @sort, now(), now(), @by)
            ON CONFLICT (id) DO UPDATE SET
              slug = @slug, title = @title, summary = @summary, body = @body,
              is_published = @pub, show_in_footer = @footer, sort_order = @sort,
              updated_at = now(), updated_by = @by
            """, conn);

        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("slug", slug);
        cmd.Parameters.AddWithValue("title", title);
        cmd.Parameters.AddWithValue("summary", (object?)page.Summary?.Trim() ?? DBNull.Value);
        cmd.Parameters.AddWithValue("body", (page.Body ?? string.Empty).Trim());
        cmd.Parameters.AddWithValue("pub", page.IsPublished);
        cmd.Parameters.AddWithValue("footer", page.ShowInFooter);
        cmd.Parameters.AddWithValue("sort", page.SortOrder);
        cmd.Parameters.AddWithValue("by", updatedBy);

        await cmd.ExecuteNonQueryAsync(ct);
        page.Id = id;
        page.Slug = slug;
        return null;
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("DELETE FROM public.content_pages WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    private static ContentPage Read(NpgsqlDataReader reader) => new()
    {
        Id = reader.GetGuid(0),
        Slug = reader.GetString(1),
        Title = reader.GetString(2),
        Summary = reader.IsDBNull(3) ? null : reader.GetString(3),
        Body = reader.GetString(4),
        IsPublished = reader.GetBoolean(5),
        ShowInFooter = reader.GetBoolean(6),
        SortOrder = reader.GetInt32(7),
        UpdatedAt = reader.GetDateTime(8),
        UpdatedBy = reader.IsDBNull(9) ? null : reader.GetString(9)
    };
}
