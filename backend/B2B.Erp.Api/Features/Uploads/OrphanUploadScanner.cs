using System.Text.RegularExpressions;
using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Features.Uploads;

/// <summary>Diskte duran, hiçbir kayıttan işaret edilmeyen tek bir dosya.</summary>
public sealed record OrphanUploadFile(string Folder, string FileName, long SizeBytes, DateTime LastWriteUtc);

/// <summary>Tarama sonucu. Silme istenmediyse yalnızca tarama alanları doludur.</summary>
public sealed class OrphanUploadReport
{
    /// <summary>
    /// Referans kümesi EKSİKSİZ mi? Tek bir firma veritabanı bile okunamadıysa false olur ve
    /// silme yapılmaz — okunamayan firmanın dosyaları "sahipsiz" görünürdü.
    /// </summary>
    public bool ReferenceSetComplete { get; set; }

    public List<string> Warnings { get; } = new();
    public int ScannedFileCount { get; set; }
    public int ReferencedNameCount { get; set; }
    public int GraceDays { get; set; }
    public int SkippedByGraceCount { get; set; }
    public List<OrphanUploadFile> Orphans { get; } = new();
    public long OrphanBytes { get; set; }

    public bool DeleteRequested { get; set; }
    public bool DeletePerformed { get; set; }
    public int DeletedCount { get; set; }
    public long DeletedBytes { get; set; }
    public List<string> DeleteFailures { get; } = new();
}

/// <summary>
/// YETİM YÜKLEME DOSYALARI (2026-08-20 kullanıcı kararı, denetim md. E5).
///
/// <para>
/// Ürün resmi kayıttan çıkarıldığında dosya diskte kalıyordu; yıllar içinde yüklenmiş her
/// görselin ölüsü sunucuda birikiyor. Alternatif — silme akışına dosya silmeyi eklemek —
/// bilerek SEÇİLMEDİ: aynı görsel birden çok üründe kullanılabiliyor, o yolda hâlâ kullanılan
/// bir dosya silinebilirdi. Burada karar tersinden veriliyor: dosya, hiçbir kayıtta adı
/// geçmiyorsa yetimdir.
/// </para>
///
/// <para><b>Üç emniyet kuralı</b> — üçü de "yanlışlıkla silmektense hiç silme" yönünde:</para>
/// <list type="number">
///   <item>
///     <b>Klasör beyaz listesi.</b> Yalnızca ERP'nin kendi yazdığı klasörlere bakılır
///     (<c>images, products, videos, montaj</c>). <c>uploads</c> altında başka bir uygulamanın
///     (e-ticaret: <c>categories, ecommerce, invoices</c>) klasörü varsa ve aynı diske
///     kurulmuşsa, o dosyaların sahibi başka bir veritabanıdır — buradan bakınca hepsi yetim
///     görünür. Tanımadığımız klasöre GİRİLMEZ.
///   </item>
///   <item>
///     <b>Bütün firmalar okunmalı.</b> Referanslar TEK firmadan değil, master'daki bütün
///     kiracılardan toplanır (pasif firmalar dâhil — pasif firmanın da resmi yerinde durmalı).
///     Bir firmaya ulaşılamazsa sonuç "eksik" damgalanır ve o turda hiçbir şey silinmez.
///   </item>
///   <item>
///     <b>Bekleme süresi.</b> Belirtilen günden yeni dosyalara dokunulmaz. Kullanıcı görseli
///     yükleyip ürünü henüz kaydetmemiş olabilir: dosya diskte, referansı ise henüz hiçbir
///     yerde değildir. Bu aradaki dosyayı silmek, formu doldurmakta olan kullanıcının resmini
///     elinden almak olurdu.
///   </item>
/// </list>
///
/// <para>
/// Eşleşme TAM URL ile değil DOSYA ADIYLA yapılır: yükleme uçları mutlak URL döndürüyor
/// (<c>https://sunucu/uploads/images/...</c>) ve bu adres ortamdan ortama değişiyor; kayıtlarda
/// eski alan adıyla yazılmış URL'ler var. Ada bakmak ayrıca doğru yöne hata yapar — farklı
/// klasörlerde aynı adlı iki dosya olursa sonuç dosyanın SİLİNMEMESİ olur.
/// </para>
/// </summary>
public sealed class OrphanUploadScanner
{
    /// <summary>ERP'nin kendi yazdığı klasörler. Buranın dışına asla çıkılmaz.</summary>
    public static readonly string[] OwnedFolders = { "images", "products", "videos", "montaj" };

    /// <summary>Yeni dosyaya dokunmama süresi. Yükleyip kaydetmeyen kullanıcı için geniş tutuldu.</summary>
    public const int DefaultGraceDays = 30;

    /// <summary>
    /// Bir metnin içindeki dosya adı görünümlü her parça. Ürün kayıtları hem düz URL hem JSON
    /// dizi tutuyor; ikisini de aynı süzgeçten geçirmek, biçimi ayrıştırmaya çalışmaktan hem
    /// basit hem sağlam. Fazla yakalaması sorun değil — fazla yakalanan ad dosyayı KORUR.
    /// </summary>
    private static readonly Regex FileNamePattern = new(
        @"[A-Za-z0-9_\-\.]+\.[A-Za-z0-9]{2,5}",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly MasterDbContext _masterDb;
    private readonly IConfiguration _configuration;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<OrphanUploadScanner> _logger;

    public OrphanUploadScanner(
        MasterDbContext masterDb,
        IConfiguration configuration,
        IWebHostEnvironment env,
        ILogger<OrphanUploadScanner> logger)
    {
        _masterDb = masterDb;
        _configuration = configuration;
        _env = env;
        _logger = logger;
    }

    public async Task<OrphanUploadReport> ScanAsync(bool deleteOrphans, int graceDays, CancellationToken cancellationToken)
    {
        var report = new OrphanUploadReport
        {
            GraceDays = graceDays < 0 ? DefaultGraceDays : graceDays,
            DeleteRequested = deleteOrphans
        };

        var referenced = await CollectReferencedNamesAsync(report, cancellationToken);
        report.ReferencedNameCount = referenced.Count;

        var uploadsRoot = ResolveUploadsRoot();
        if (!Directory.Exists(uploadsRoot))
        {
            report.Warnings.Add($"Yükleme klasörü bulunamadı: {uploadsRoot}");
            return report;
        }

        var cutoffUtc = DateTime.UtcNow.AddDays(-report.GraceDays);

        foreach (var folder in OwnedFolders)
        {
            var path = Path.Combine(uploadsRoot, folder);
            if (!Directory.Exists(path)) continue;

            foreach (var file in Directory.EnumerateFiles(path))
            {
                cancellationToken.ThrowIfCancellationRequested();
                report.ScannedFileCount++;

                var name = Path.GetFileName(file);
                if (referenced.Contains(name)) continue;

                var info = new FileInfo(file);

                // Oluşturma ve değiştirme damgalarının YENİ olanı esas alınır: kopyalanarak
                // taşınmış dosyalarda ikisi birbirini tutmuyor, dosyayı korumak esas.
                var touchedUtc = info.LastWriteTimeUtc > info.CreationTimeUtc
                    ? info.LastWriteTimeUtc
                    : info.CreationTimeUtc;

                if (touchedUtc > cutoffUtc)
                {
                    report.SkippedByGraceCount++;
                    continue;
                }

                report.Orphans.Add(new OrphanUploadFile(folder, name, info.Length, info.LastWriteTimeUtc));
                report.OrphanBytes += info.Length;
            }
        }

        if (!deleteOrphans) return report;

        if (!report.ReferenceSetComplete)
        {
            report.Warnings.Add(
                "Referans listesi eksik olduğu için HİÇBİR dosya silinmedi. " +
                "Ulaşılamayan firma veritabanı düzeldikten sonra tekrar çalıştırın.");
            return report;
        }

        report.DeletePerformed = true;

        foreach (var orphan in report.Orphans)
        {
            var full = Path.Combine(uploadsRoot, orphan.Folder, orphan.FileName);
            try
            {
                File.Delete(full);
                report.DeletedCount++;
                report.DeletedBytes += orphan.SizeBytes;
            }
            catch (Exception ex)
            {
                // Kilitli ya da izin verilmeyen dosya turu durdurmaz; sıradaki denenir.
                report.DeleteFailures.Add($"{orphan.Folder}/{orphan.FileName}: {ex.Message}");
            }
        }

        _logger.LogInformation(
            "[OrphanUploadScanner] {Deleted} yetim dosya silindi ({Bytes} bayt), {Failed} başarısız.",
            report.DeletedCount, report.DeletedBytes, report.DeleteFailures.Count);

        return report;
    }

    /// <summary>
    /// Yükleme kökü çalışma dizininden değil web kökünden çözülür; IIS/servis altında çalışma
    /// dizini sitenin klasörü olmayabilir (bkz. <c>UploadsController.ResolveUploadFolder</c>).
    /// </summary>
    private string ResolveUploadsRoot()
    {
        var root = _env.WebRootPath;
        if (string.IsNullOrWhiteSpace(root))
        {
            root = Path.Combine(
                string.IsNullOrWhiteSpace(_env.ContentRootPath) ? Directory.GetCurrentDirectory() : _env.ContentRootPath,
                "wwwroot");
        }

        return Path.Combine(root, "uploads");
    }

    private async Task<HashSet<string>> CollectReferencedNamesAsync(OrphanUploadReport report, CancellationToken cancellationToken)
    {
        // Dosya sistemi büyük/küçük harfe Windows'ta duyarsız, Linux'ta duyarlı. Duyarsız
        // karşılaştırma iki ortamda da dosyayı KORUYAN taraftır.
        var referenced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        report.ReferenceSetComplete = true;

        var baseConnStr = _configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(baseConnStr))
        {
            report.ReferenceSetComplete = false;
            report.Warnings.Add("DefaultConnection tanımlı değil; firma veritabanları taranamadı.");
            return referenced;
        }

        List<Entities.Tenant> tenants;
        try
        {
            // PASİF firmalar da dâhil: firma kapalıyken de resimleri yerinde durmalı.
            tenants = await _masterDb.Tenants.AsNoTracking().ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            report.ReferenceSetComplete = false;
            report.Warnings.Add($"Firma listesi okunamadı: {ex.Message}");
            return referenced;
        }

        foreach (var tenant in tenants)
        {
            AddNames(tenant.LogoPath, referenced);
        }

        foreach (var dbName in tenants.Select(x => x.DbName).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct())
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                var csb = new NpgsqlConnectionStringBuilder(baseConnStr) { Database = dbName };
                var options = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(csb.ConnectionString).Options;
                await using var db = new AppDbContext(options);

                var productRefs = await db.Products
                    .AsNoTracking()
                    .Select(x => new { x.ImageUrl, x.ImageUrlsJson, x.VideoUrl, x.VideoUrlsJson })
                    .ToListAsync(cancellationToken);

                foreach (var row in productRefs)
                {
                    AddNames(row.ImageUrl, referenced);
                    AddNames(row.ImageUrlsJson, referenced);
                    AddNames(row.VideoUrl, referenced);
                    AddNames(row.VideoUrlsJson, referenced);
                }

                var installationDocs = await db.InstallationDocuments
                    .AsNoTracking()
                    .Select(x => x.DocumentUrl)
                    .ToListAsync(cancellationToken);

                foreach (var url in installationDocs)
                {
                    AddNames(url, referenced);
                }
            }
            catch (Exception ex)
            {
                // Tek bir firma okunamadıysa BÜTÜN tur "eksik" sayılır: o firmanın dosyaları
                // yetim görüneceği için silme yapılmamalı.
                report.ReferenceSetComplete = false;
                report.Warnings.Add($"'{dbName}' veritabanı okunamadı, silme durduruldu: {ex.Message}");
                _logger.LogWarning(ex, "[OrphanUploadScanner] Tenant {DbName} okunamadı.", dbName);
            }
        }

        return referenced;
    }

    /// <summary>
    /// Bir kayıt alanının içinde geçen dosya adları. Silmeme kararının tamamı buna dayandığı
    /// için ayrı ve sınanabilir duruyor: burada kaçırılan bir ad, hâlâ kullanılan bir dosyanın
    /// silinmesi demektir.
    /// </summary>
    public static IReadOnlyCollection<string> ExtractFileNames(string? raw)
    {
        var sink = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        AddNames(raw, sink);
        return sink;
    }

    private static void AddNames(string? raw, HashSet<string> sink)
    {
        if (string.IsNullOrWhiteSpace(raw)) return;

        foreach (Match match in FileNamePattern.Matches(raw))
        {
            if (match.Value.Length > 0) sink.Add(match.Value);
        }
    }
}
