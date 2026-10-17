using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
public sealed class AdminBlogController : ControllerBase
{
    private readonly AdminModulesRepository _db;

    public AdminBlogController(AdminModulesRepository db)
    {
        _db = db;
    }

    // --- STOREFRONT ENDPOINTS ---

    [HttpGet("api/storefront/blog")]
    public async Task<IActionResult> StorefrontList(CancellationToken cancellationToken)
    {
        var sql = @"
            SELECT 
              id, 
              title, 
              slug, 
              content, 
              image_url AS ""imageUrl"", 
              meta_title AS ""metaTitle"", 
              meta_description AS ""metaDescription"", 
              read_time_minutes AS ""readTimeMinutes"", 
              is_published AS ""isPublished"", 
              created_at_utc AS ""createdAtUtc"", 
              updated_at_utc AS ""updatedAtUtc"" 
            FROM blog_posts 
            WHERE is_published = true 
            ORDER BY created_at_utc DESC";

        var rows = await _db.QuerySqlAsync(sql, null, cancellationToken);
        var list = MapRows(rows);
        return Ok(new { success = true, data = list });
    }

    [HttpGet("api/storefront/blog/{slug}")]
    public async Task<IActionResult> StorefrontGetBySlug([FromRoute] string slug, CancellationToken cancellationToken)
    {
        var sql = @"
            SELECT 
              id, 
              title, 
              slug, 
              content, 
              image_url AS ""imageUrl"", 
              meta_title AS ""metaTitle"", 
              meta_description AS ""metaDescription"", 
              read_time_minutes AS ""readTimeMinutes"", 
              is_published AS ""isPublished"", 
              created_at_utc AS ""createdAtUtc"", 
              updated_at_utc AS ""updatedAtUtc"" 
            FROM blog_posts 
            WHERE slug = @Slug AND is_published = true";

        var rows = await _db.QuerySqlAsync(sql, new { Slug = slug.Trim().ToLowerInvariant() }, cancellationToken);
        if (rows.Count == 0)
            return NotFound(new { success = false, message = "Blog yazısı bulunamadı." });

        var item = MapRow(rows[0]);
        return Ok(new { success = true, data = item });
    }

    // --- ADMIN ENDPOINTS (Secured) ---

    [HttpGet("api/admin/blog")]
    [Authorize(Roles = "Owner,Admin")]
    public async Task<IActionResult> AdminList(CancellationToken cancellationToken)
    {
        var sql = @"
            SELECT 
              id, 
              title, 
              slug, 
              content, 
              image_url AS ""imageUrl"", 
              meta_title AS ""metaTitle"", 
              meta_description AS ""metaDescription"", 
              read_time_minutes AS ""readTimeMinutes"", 
              is_published AS ""isPublished"", 
              created_at_utc AS ""createdAtUtc"", 
              updated_at_utc AS ""updatedAtUtc"" 
            FROM blog_posts 
            ORDER BY created_at_utc DESC";

        var rows = await _db.QuerySqlAsync(sql, null, cancellationToken);
        var list = MapRows(rows);
        return Ok(new { success = true, data = list });
    }

    [HttpGet("api/admin/blog/{id:guid}")]
    [Authorize(Roles = "Owner,Admin")]
    public async Task<IActionResult> AdminGetById([FromRoute] Guid id, CancellationToken cancellationToken)
    {
        var sql = @"
            SELECT 
              id, 
              title, 
              slug, 
              content, 
              image_url AS ""imageUrl"", 
              meta_title AS ""metaTitle"", 
              meta_description AS ""metaDescription"", 
              read_time_minutes AS ""readTimeMinutes"", 
              is_published AS ""isPublished"", 
              created_at_utc AS ""createdAtUtc"", 
              updated_at_utc AS ""updatedAtUtc"" 
            FROM blog_posts 
            WHERE id = @Id";

        var rows = await _db.QuerySqlAsync(sql, new { Id = id }, cancellationToken);
        if (rows.Count == 0)
            return NotFound(new { success = false, message = "Blog yazısı bulunamadı." });

        var item = MapRow(rows[0]);
        return Ok(new { success = true, data = item });
    }

    public sealed class UpsertBlogPostRequest
    {
        public string Title { get; set; } = string.Empty;
        public string Slug { get; set; } = string.Empty;
        public string Content { get; set; } = string.Empty;
        public string ImageUrl { get; set; } = string.Empty;
        public string MetaTitle { get; set; } = string.Empty;
        public string MetaDescription { get; set; } = string.Empty;
        public int ReadTimeMinutes { get; set; } = 5;
        public bool IsPublished { get; set; } = true;
    }

    [HttpPost("api/admin/blog")]
    [Authorize(Roles = "Owner,Admin")]
    public async Task<IActionResult> Create([FromBody] UpsertBlogPostRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { success = false, message = "Başlık boş olamaz." });
        if (string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(new { success = false, message = "İçerik boş olamaz." });

        var slug = string.IsNullOrWhiteSpace(request.Slug) 
            ? GenerateSlug(request.Title) 
            : GenerateSlug(request.Slug);

        // Check unique slug
        var checkSql = "SELECT COUNT(*) FROM blog_posts WHERE slug = @Slug";
        var countRows = await _db.QuerySqlAsync(checkSql, new { Slug = slug }, cancellationToken);
        if (countRows.Count > 0 && Convert.ToInt32(countRows[0].Values.First()) > 0)
        {
            // Append random suffix
            slug += "-" + new Random().Next(100, 999);
        }

        var id = Guid.NewGuid();
        var sql = @"
            INSERT INTO blog_posts (
              id, title, slug, content, image_url, 
              meta_title, meta_description, read_time_minutes, is_published
            ) VALUES (
              @Id, @Title, @Slug, @Content, @ImageUrl, 
              @MetaTitle, @MetaDescription, @ReadTimeMinutes, @IsPublished
            )";

        await _db.ExecuteSqlAsync(sql, new {
            Id = id,
            Title = request.Title.Trim(),
            Slug = slug,
            Content = request.Content.Trim(),
            ImageUrl = (request.ImageUrl ?? "").Trim(),
            MetaTitle = (request.MetaTitle ?? "").Trim(),
            MetaDescription = (request.MetaDescription ?? "").Trim(),
            ReadTimeMinutes = request.ReadTimeMinutes < 1 ? 5 : request.ReadTimeMinutes,
            IsPublished = request.IsPublished
        }, cancellationToken);

        return Ok(new { success = true, message = "Blog yazısı başarıyla eklendi.", data = new { id, slug } });
    }

    [HttpPut("api/admin/blog/{id:guid}")]
    [Authorize(Roles = "Owner,Admin")]
    public async Task<IActionResult> Update([FromRoute] Guid id, [FromBody] UpsertBlogPostRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { success = false, message = "Başlık boş olamaz." });
        if (string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(new { success = false, message = "İçerik boş olamaz." });

        var existingSql = "SELECT id FROM blog_posts WHERE id = @Id";
        var exists = await _db.QuerySqlAsync(existingSql, new { Id = id }, cancellationToken);
        if (exists.Count == 0)
            return NotFound(new { success = false, message = "Yazar bulunamadı." });

        var slug = string.IsNullOrWhiteSpace(request.Slug) 
            ? GenerateSlug(request.Title) 
            : GenerateSlug(request.Slug);

        // Check unique slug (excluding self)
        var checkSql = "SELECT COUNT(*) FROM blog_posts WHERE slug = @Slug AND id <> @Id";
        var countRows = await _db.QuerySqlAsync(checkSql, new { Slug = slug, Id = id }, cancellationToken);
        if (countRows.Count > 0 && Convert.ToInt32(countRows[0].Values.First()) > 0)
        {
            slug += "-" + new Random().Next(100, 999);
        }

        var sql = @"
            UPDATE blog_posts SET 
              title = @Title, 
              slug = @Slug, 
              content = @Content, 
              image_url = @ImageUrl, 
              meta_title = @MetaTitle, 
              meta_description = @MetaDescription, 
              read_time_minutes = @ReadTimeMinutes, 
              is_published = @IsPublished, 
              updated_at_utc = (now() AT TIME ZONE 'utc') 
            WHERE id = @Id";

        await _db.ExecuteSqlAsync(sql, new {
            Id = id,
            Title = request.Title.Trim(),
            Slug = slug,
            Content = request.Content.Trim(),
            ImageUrl = (request.ImageUrl ?? "").Trim(),
            MetaTitle = (request.MetaTitle ?? "").Trim(),
            MetaDescription = (request.MetaDescription ?? "").Trim(),
            ReadTimeMinutes = request.ReadTimeMinutes < 1 ? 5 : request.ReadTimeMinutes,
            IsPublished = request.IsPublished
        }, cancellationToken);

        return Ok(new { success = true, message = "Blog yazısı başarıyla güncellendi.", data = new { id, slug } });
    }

    [HttpDelete("api/admin/blog/{id:guid}")]
    [Authorize(Roles = "Owner,Admin")]
    public async Task<IActionResult> Delete([FromRoute] Guid id, CancellationToken cancellationToken)
    {
        var existingSql = "SELECT id FROM blog_posts WHERE id = @Id";
        var exists = await _db.QuerySqlAsync(existingSql, new { Id = id }, cancellationToken);
        if (exists.Count == 0)
            return NotFound(new { success = false, message = "Blog yazısı bulunamadı." });

        var sql = "DELETE FROM blog_posts WHERE id = @Id";
        await _db.ExecuteSqlAsync(sql, new { Id = id }, cancellationToken);

        return Ok(new { success = true, message = "Blog yazısı başarıyla silindi." });
    }

    // --- PRIVATE UTILITIES ---

    private static List<object> MapRows(List<Dictionary<string, object>> rows)
    {
        return rows.Select(MapRow).ToList();
    }

    private static object MapRow(Dictionary<string, object> row)
    {
        return new
        {
            id = row.TryGetValue("id", out var id) ? id : null,
            title = row.TryGetValue("title", out var title) ? title?.ToString() ?? "" : "",
            slug = row.TryGetValue("slug", out var slug) ? slug?.ToString() ?? "" : "",
            content = row.TryGetValue("content", out var content) ? content?.ToString() ?? "" : "",
            imageUrl = row.TryGetValue("imageUrl", out var img) ? img?.ToString() ?? "" : "",
            metaTitle = row.TryGetValue("metaTitle", out var mt) ? mt?.ToString() ?? "" : "",
            metaDescription = row.TryGetValue("metaDescription", out var md) ? md?.ToString() ?? "" : "",
            readTimeMinutes = row.TryGetValue("readTimeMinutes", out var rtm) ? Convert.ToInt32(rtm) : 5,
            isPublished = row.TryGetValue("isPublished", out var ip) ? Convert.ToBoolean(ip) : false,
            createdAtUtc = row.TryGetValue("createdAtUtc", out var ca) ? ca : null,
            updatedAtUtc = row.TryGetValue("updatedAtUtc", out var ua) ? ua : null
        };
    }

    private static string GenerateSlug(string phrase)
    {
        string str = phrase.ToLowerInvariant();
        str = str.Replace("ı", "i").Replace("ğ", "g").Replace("ü", "u").Replace("ş", "s").Replace("ö", "o").Replace("ç", "c");
        str = System.Text.RegularExpressions.Regex.Replace(str, @"[^a-z0-9\s-]", "");
        str = System.Text.RegularExpressions.Regex.Replace(str, @"\s+", " ").Trim();
        str = str.Replace(" ", "-");
        return str;
    }
}
