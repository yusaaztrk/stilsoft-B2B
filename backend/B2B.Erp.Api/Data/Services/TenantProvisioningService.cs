using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Core.Security;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Data.Services;

public sealed class TenantProvisioningService : ITenantProvisioningService
{
    private static readonly Regex TenantCodeRegex = new("^[A-Z0-9_]+$", RegexOptions.Compiled);

    private const int InvoiceKonsinyePageId = 55;
    private const int KonsinyeQtyEditPageId = 10450;
    private const int KonsinyeSevkQtyEditPageId = 10451;
    private const int KonsinyeStatusOnaylandiPageId = 10452;
    private const int KonsinyeStatusSevkEdildiPageId = 10453;
    private const int BayiTeklifleriPageId = 10454;
    private const int CariTeklifleriPageId = 10455;
    private const int CalisanPageId = 400;

    private readonly MasterDbContext _masterDb;
    private readonly IConfiguration _configuration;
    private readonly AppDbContext _dbContext;

    public TenantProvisioningService(MasterDbContext masterDb, IConfiguration configuration, AppDbContext dbContext)
    {
        _masterDb = masterDb;
        _configuration = configuration;
        _dbContext = dbContext;
    }

    public async Task<int> CreateTenantAsync(
        string tenantCode,
        string tenantName,
        bool isEcommerceEnabled,
        IEnumerable<int> enabledPageIds,
        string superAdminUsername,
        string superAdminMail,
        string superAdminPassword,
        bool serviceOpsEnabled,
        string? serviceOpsSuperAdminUsername,
        string? serviceOpsSuperAdminMail,
        string? serviceOpsSuperAdminPassword,
        CancellationToken cancellationToken = default)
    {
        await _masterDb.Database.ExecuteSqlRawAsync(@"
ALTER TABLE IF EXISTS ""Tenants"" ADD COLUMN IF NOT EXISTS ""LogoPath"" character varying(512) NULL;
ALTER TABLE IF EXISTS ""Tenants"" ADD COLUMN IF NOT EXISTS ""HeaderGradientFrom"" character varying(32) NULL;
ALTER TABLE IF EXISTS ""Tenants"" ADD COLUMN IF NOT EXISTS ""HeaderGradientTo"" character varying(32) NULL;
ALTER TABLE IF EXISTS ""Tenants"" ADD COLUMN IF NOT EXISTS ""IsEcommerceEnabled"" boolean NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS ""Tenants"" ADD COLUMN IF NOT EXISTS ""ServiceOpsEnabled"" boolean NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS ""Tenants"" ADD COLUMN IF NOT EXISTS ""ServiceOpsDbName"" character varying(128) NULL;

-- KURULUM DAMGASI (denetim md. E2). Geriye dönük damgalama YALNIZCA kolonun ilk
-- eklendiği anda çalışır: koşulsuz bir UPDATE, önceki denemeden kalan YARIM bir firmayı
-- da ""tamamlandı"" diye işaretlerdi. Mevcut firmalar kullanımda olduğu için tamam sayılır.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Tenants' AND column_name = 'SetupCompletedAt'
  ) THEN
    ALTER TABLE ""Tenants"" ADD COLUMN ""SetupCompletedAt"" timestamp with time zone NULL;
    UPDATE ""Tenants"" SET ""SetupCompletedAt"" = now();
  END IF;
END $$;
", cancellationToken);

        tenantCode = NormalizeTenantCode(tenantCode);
        tenantName = (tenantName ?? string.Empty).Trim();
        superAdminUsername = (superAdminUsername ?? string.Empty).Trim();
        superAdminMail = (superAdminMail ?? string.Empty).Trim();

        serviceOpsSuperAdminUsername = (serviceOpsSuperAdminUsername ?? string.Empty).Trim();
        serviceOpsSuperAdminMail = (serviceOpsSuperAdminMail ?? string.Empty).Trim();
        serviceOpsSuperAdminPassword = (serviceOpsSuperAdminPassword ?? string.Empty);

        if (string.IsNullOrWhiteSpace(tenantCode)) throw new InvalidOperationException("Tenant code boş olamaz");
        if (!TenantCodeRegex.IsMatch(tenantCode)) throw new InvalidOperationException("Tenant code sadece harf/rakam/_ içerebilir");
        if (string.IsNullOrWhiteSpace(tenantName)) throw new InvalidOperationException("Tenant name boş olamaz");
        if (string.IsNullOrWhiteSpace(superAdminUsername)) throw new InvalidOperationException("SuperAdmin username boş olamaz");
        if (string.IsNullOrWhiteSpace(superAdminMail)) throw new InvalidOperationException("SuperAdmin mail boş olamaz");
        if (string.IsNullOrWhiteSpace(superAdminPassword)) throw new InvalidOperationException("SuperAdmin password boş olamaz");

        if (serviceOpsEnabled)
        {
            if (string.IsNullOrWhiteSpace(serviceOpsSuperAdminUsername)) throw new InvalidOperationException("Servis SuperAdmin username boş olamaz");
            if (string.IsNullOrWhiteSpace(serviceOpsSuperAdminMail)) throw new InvalidOperationException("Servis SuperAdmin mail boş olamaz");
            if (string.IsNullOrWhiteSpace(serviceOpsSuperAdminPassword)) throw new InvalidOperationException("Servis SuperAdmin password boş olamaz");
        }

        var dbName = $"b2b_erp_tenant_{tenantCode}";
        var serviceDbName = $"b2b_serviceops_tenant_{tenantCode}";

        var exists = await _masterDb.Tenants.AsNoTracking().AnyAsync(x => x.Code == tenantCode, cancellationToken);
        if (exists) throw new InvalidOperationException("Bu tenant code zaten var");

        var tenant = new Tenant
        {
            Code = tenantCode,
            Name = tenantName,
            DbName = dbName,
            IsActive = true,
            IsEcommerceEnabled = isEcommerceEnabled,
            ServiceOpsEnabled = serviceOpsEnabled,
            ServiceOpsDbName = serviceOpsEnabled ? serviceDbName : null
        };

        _masterDb.Tenants.Add(tenant);
        await _masterDb.SaveChangesAsync(cancellationToken);

        var enabledSet = new HashSet<int>(enabledPageIds.Distinct());
        var dbPages = await _dbContext.Pages.AsNoTracking().ToListAsync(cancellationToken);

        // Ensure newly added permission pages exist for new tenants when invoice module is enabled.
        // This keeps Role Yetkileri / Proje Yönetimi screens consistent across all new firms.
        var invoiceModuleSelected = enabledSet.Any(x => {
            var p = dbPages.FirstOrDefault(page => page.Id == x);
            return p != null && string.Equals(p.ModuleKey, "invoice", StringComparison.OrdinalIgnoreCase);
        });

        if (invoiceModuleSelected)
        {
            var invoiceKeys = new List<(string ModuleKey, string Key)>
            {
                ("invoice", "irsaliye"),
                ("invoice", "irsaliyeQuantityEdit"),
                ("invoice", "irsaliyeShippedQuantityEdit"),
                ("invoice", "irsaliyeStatusOnaylandi"),
                ("invoice", "irsaliyeStatusSevkEdildi"),
                ("invoice", "bayiTeklifleri"),
                ("invoice", "cariTeklifleri"),
                ("invoice", "cariTeklifleriDuzenle"),
                ("invoice", "cariTeklifleriSil"),
                ("invoice", "cariTeklifleriProformaAktar"),
                ("invoice", "cariTeklifleriBasim"),
                ("invoice", "termin")
            };

            foreach (var kp in invoiceKeys)
            {
                var p = dbPages.FirstOrDefault(page => string.Equals(page.ModuleKey, kp.ModuleKey, StringComparison.OrdinalIgnoreCase) &&
                                                      string.Equals(page.Key, kp.Key, StringComparison.OrdinalIgnoreCase));
                if (p != null)
                {
                    enabledSet.Add(p.Id);
                }
            }
        }

        // Auto-enable newly added system pages
        var systemKeys = new List<(string ModuleKey, string Key)>
        {
            // Bildirimler kendi modülünde (Ayarlar'ın altında değil).
            ("bildirimler", "bildirimler"),
            ("bildirimler", "bildirimlerGelen"),
            ("bildirimler", "bildirimlerGonder"),
            ("reports", "aktifSepetRaporu"),
            ("reports", "muhasebeStokGirisCikisRaporu"),
            ("reports", "cariBorcAlacak"),
            ("users", "kampanya"),
            ("reports", "accountingSalesReport"),
            ("deleteRule", "deleteRule/faturaDokum"),
            ("deleteRule", "deleteRule/musteriTeklifi"),
            ("deleteRule", "deleteRule/proforma"),
            ("deleteRule", "deleteRule/alis"),
            ("invoice", "faturaDokumUstBilgiGuncelle"),
            ("invoice", "proformaFaturaDokumeAktar"),
            ("invoice", "proformaBasim"),
            ("invoice", "proformaSil"),
            ("invoice", "alisUstBilgiGuncelle"),
            ("invoice", "faturaDokumOdemeAlindi"),
            ("invoice", "faturaDokumNakitMiktar"),
            ("invoice", "faturaDokumBarkod"),
            ("invoice", "faturaDokumBasim"),
            ("invoice", "faturaDokumSil"),
            ("invoice", "faturaDokumTipSatis"),
            ("invoice", "faturaDokumTipTamir"),
            ("invoice", "faturaDokumTipIade"),
            ("invoice", "faturaDokumTipAlis"),
            ("invoice", "faturaDokumTipHizmet"),
            ("invoice", "musteriTeklifiDuzenle"),
            ("invoice", "musteriTeklifiSil"),
            ("invoice", "musteriTeklifiProformaAktar"),
            ("invoice", "musteriTeklifiBasim"),
            ("invoice", "cariTeklifleriDuzenle"),
            ("invoice", "cariTeklifleriSil"),
            ("invoice", "cariTeklifleriProformaAktar"),
            ("invoice", "cariTeklifleriBasim"),
            ("invoice", "alisDuzenle"),
            ("invoice", "alisTermin"),
            ("invoice", "alisSil"),
            ("invoice", "terminDurumDegistir"),
            ("invoice", "alisTipAlis"),
            ("invoice", "alisTipHizmet"),
            ("invoice", "alisTipIade"),
            ("invoice", "garantiDegisim"),
            ("invoice", "garantiDegisimSil")
        };

        foreach (var kp in systemKeys)
        {
            var p = dbPages.FirstOrDefault(page => string.Equals(page.ModuleKey, kp.ModuleKey, StringComparison.OrdinalIgnoreCase) &&
                                                  string.Equals(page.Key, kp.Key, StringComparison.OrdinalIgnoreCase));
            if (p != null)
            {
                enabledSet.Add(p.Id);
            }
        }

        foreach (var pageId in enabledSet)
        {
            _masterDb.TenantEnabledPages.Add(new TenantEnabledPage
            {
                TenantId = tenant.Id,
                PageId = pageId,
                IsEnabled = true
            });
        }

        var existingGlobalUser = await _masterDb.GlobalUsers
            .FirstOrDefaultAsync(x => EF.Functions.ILike(x.Username, superAdminUsername), cancellationToken);

        GlobalUser globalUser;
        if (existingGlobalUser is null)
        {
            globalUser = new GlobalUser
            {
                Username = superAdminUsername,
                Mail = superAdminMail,
                PasswordHash = PasswordHasher.HashPassword(superAdminPassword),
                IsSuperSuperAdmin = false,
                IsActive = true
            };

            _masterDb.GlobalUsers.Add(globalUser);
            await _masterDb.SaveChangesAsync(cancellationToken);
        }
        else
        {
            globalUser = existingGlobalUser;
            if (!globalUser.IsActive)
            {
                globalUser.IsActive = true;
            }

            // GlobalUsers.Username is unique. If the same username is reused for a different tenant,
            // we must not silently change the master password because it would break logins for other tenants.
            if (!PasswordHasher.VerifyPassword(superAdminPassword, globalUser.PasswordHash))
            {
                throw new InvalidOperationException(
                    "Bu SuperAdmin kullanıcı adı zaten mevcut. Bu firmaya özel SuperAdmin için farklı kullanıcı adı seçin (veya mevcut kullanıcı ile aynı şifreyi kullanın)."
                );
            }

            // Keep existing mail as-is to avoid mail unique conflicts; caller can manage it via Global Users admin if needed.
            await _masterDb.SaveChangesAsync(cancellationToken);
        }

        var linkExists = await _masterDb.GlobalUserTenants
            .AnyAsync(x => x.GlobalUserId == globalUser.Id && x.TenantId == tenant.Id, cancellationToken);

        if (!linkExists)
        {
            _masterDb.GlobalUserTenants.Add(new GlobalUserTenant
            {
                GlobalUserId = globalUser.Id,
                TenantId = tenant.Id,
                IsActive = true
            });
            await _masterDb.SaveChangesAsync(cancellationToken);
        }
        else
        {
            var link = await _masterDb.GlobalUserTenants
                .FirstAsync(x => x.GlobalUserId == globalUser.Id && x.TenantId == tenant.Id, cancellationToken);
            if (!link.IsActive)
            {
                link.IsActive = true;
                await _masterDb.SaveChangesAsync(cancellationToken);
            }
        }

        // 2026-08-21 kararı: yeni firma, yapılandırmada şablon tanımlıysa o şablonun BİREBİR
        // kopyası olarak doğar (ürün, cari, kullanıcı ve şifre hashleri dahil). Şablon tanımlı
        // değilse ya da sunucuda yoksa eski yola düşülür: boş veritabanı + migration + örnek veri.
        var erpTemplateDb = await ResolveTemplateDbAsync("Tenants:TemplateDb:Erp", cancellationToken);
        await CreateDatabaseAsync(dbName, cancellationToken, erpTemplateDb);
        var erpClonedFromTemplate = !string.IsNullOrWhiteSpace(erpTemplateDb);
        if (erpClonedFromTemplate)
        {
            await RestampClonedTenantAsync(dbName, tenantCode, cancellationToken);
        }

        if (serviceOpsEnabled)
        {
            var serviceTemplateDb = await ResolveTemplateDbAsync("Tenants:TemplateDb:ServiceOps", cancellationToken);
            await CreateDatabaseAsync(serviceDbName, cancellationToken, serviceTemplateDb);
            if (!string.IsNullOrWhiteSpace(serviceTemplateDb))
            {
                await RestampClonedTenantAsync(serviceDbName, tenantCode, cancellationToken);
            }
        }
        
        // AYRI PERSONEL VERITABANI ARTIK YARATILMIYOR (2026-08-23).
        //
        // Burasi her yeni firma icin b2b_employee_tenant_{KOD} adinda ayri bir veritabani
        // aciyordu. Ama IK servisi 2026-08-18 de o modelden VAZGECTI ve ERP nin kiraci
        // veritabanini kullanmaya basladi (bkz. TenantConnectionStringResolver ustundeki
        // not): ayri tabandayken QR mesailer puantajda gorunmuyor, eklenen personel ERP de
        // cikmiyor ve yetki tablolari bos kaldigi icin SSA disinda herkes 403 aliyordu.
        //
        // Provizyon o karara uymadigi icin YENI acilan firma canlidakinden FARKLI bir yapiya
        // sahip oluyordu: personel portali ERP tabanina bakarken ortada bos bir personel
        // veritabani duruyordu. Kaldirildi.
        //
        // Employees ve diger Employee* tablolari ERP kiraci tabanina zaten kuruluyor:
        // TenantConnectionStringResolver icindeki sema kurucusu her kiraci veritabani icin
        // calisiyor (ayrica Program.cs acilis dongusu de ayni DDL yi uyguluyor).

        await MigrateAndSeedTenantDbAsync(dbName, tenantCode, superAdminUsername, superAdminMail, superAdminPassword, erpClonedFromTemplate, cancellationToken);
        if (serviceOpsEnabled)
        {
            await MigrateAndSeedServiceOpsDbAsync(
                serviceDbName,
                tenantCode,
                serviceOpsSuperAdminUsername!,
                serviceOpsSuperAdminMail!,
                serviceOpsSuperAdminPassword!,
                cancellationToken);
        }


        // BURAYA GELİNDİYSE kurulum gerçekten bitti: master satırı, global kullanıcı, gerekli
        // veritabanı ve tabloları hazır. Damga en sonda vurulur; yukarıdaki adımlardan biri
        // patlarsa metot buraya hiç ulaşmaz ve firma "yarım" olarak işaretli kalır.
        tenant.SetupCompletedAt = DateTime.UtcNow;
        await _masterDb.SaveChangesAsync(cancellationToken);

        return tenant.Id;
    }

    public async Task EnsureServiceOpsTenantAsync(
        string tenantCode,
        string serviceOpsSuperAdminUsername,
        string serviceOpsSuperAdminMail,
        string serviceOpsSuperAdminPassword,
        CancellationToken cancellationToken = default)
    {
        tenantCode = NormalizeTenantCode(tenantCode);
        serviceOpsSuperAdminUsername = (serviceOpsSuperAdminUsername ?? string.Empty).Trim();
        serviceOpsSuperAdminMail = (serviceOpsSuperAdminMail ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(tenantCode)) throw new InvalidOperationException("Tenant code boş olamaz");
        if (!TenantCodeRegex.IsMatch(tenantCode)) throw new InvalidOperationException("Tenant code sadece harf/rakam/_ içerebilir");

        if (string.IsNullOrWhiteSpace(serviceOpsSuperAdminUsername)) throw new InvalidOperationException("Servis SuperAdmin username boş olamaz");
        if (string.IsNullOrWhiteSpace(serviceOpsSuperAdminMail)) throw new InvalidOperationException("Servis SuperAdmin mail boş olamaz");
        if (string.IsNullOrWhiteSpace(serviceOpsSuperAdminPassword)) throw new InvalidOperationException("Servis SuperAdmin password boş olamaz");

        var serviceDbName = $"b2b_serviceops_tenant_{tenantCode}";

        // Ensure master row exists
        var tenant = await _masterDb.Tenants.FirstOrDefaultAsync(x => x.Code == tenantCode, cancellationToken);
        if (tenant is null) throw new InvalidOperationException("Firma bulunamadı");

        tenant.ServiceOpsEnabled = true;
        tenant.ServiceOpsDbName = serviceDbName;
        await _masterDb.SaveChangesAsync(cancellationToken);

        // Sonradan ServiceOps açılan firma da yeni firmalarla aynı içerikle başlasın; aksi halde
        // servis veritabanının içeriği firmanın ne zaman açıldığına göre değişirdi.
        var serviceOpsTemplateDb = await ResolveTemplateDbAsync("Tenants:TemplateDb:ServiceOps", cancellationToken);
        await CreateDatabaseAsync(serviceDbName, cancellationToken, serviceOpsTemplateDb);
        if (!string.IsNullOrWhiteSpace(serviceOpsTemplateDb))
        {
            await RestampClonedTenantAsync(serviceDbName, tenantCode, cancellationToken);
        }

        await MigrateAndSeedServiceOpsDbAsync(
            serviceDbName,
            tenantCode,
            serviceOpsSuperAdminUsername,
            serviceOpsSuperAdminMail,
            serviceOpsSuperAdminPassword,
            cancellationToken);
    }

    private static string NormalizeTenantCode(string? tenantCode)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim();
        if (tenantCode.Length == 0) return string.Empty;

        // Remove diacritics (ÇĞİÖŞÜ etc.)
        var normalized = tenantCode.Normalize(NormalizationForm.FormD);
        var noMarks = string.Concat(normalized.Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark));
        var upper = noMarks.ToUpperInvariant();

        // Replace non [A-Z0-9_] with underscore and collapse repeats
        upper = Regex.Replace(upper, "[^A-Z0-9_]", "_");
        upper = Regex.Replace(upper, "_+", "_");
        upper = upper.Trim('_');

        return upper;
    }

    /// <summary>
    /// Yeni kiracı veritabanını oluşturur. <paramref name="templateDbName"/> verilirse veritabanı boş
    /// doğmaz; o şablonun BİREBİR KOPYASI olur (PostgreSQL <c>CREATE DATABASE ... TEMPLATE</c>).
    ///
    /// <para>DİKKAT: PostgreSQL kopyalama sırasında şablon veritabanına başka hiçbir bağlantı kabul
    /// etmez. Canlı bir kiracıyı doğrudan şablon yaparsan, biri sisteme girdiği anda firma açma
    /// <c>source database is being accessed by other users</c> ile patlar. Şablon olarak kimsenin
    /// bağlanmadığı ayrı bir kopya kullanılmalı (bkz. Tenants:TemplateDb yapılandırması).</para>
    /// </summary>
    private async Task CreateDatabaseAsync(string dbName, CancellationToken cancellationToken, string? templateDbName = null)
    {
        var masterConnStr = _configuration.GetConnectionString("MasterConnection");
        if (string.IsNullOrWhiteSpace(masterConnStr)) throw new InvalidOperationException("MasterConnection bulunamadı");

        var csb = new NpgsqlConnectionStringBuilder(masterConnStr)
        {
            Database = "postgres"
        };

        await using var conn = new NpgsqlConnection(csb.ConnectionString);
        await conn.OpenAsync(cancellationToken);

        // database name cannot be parameterized, validate + quote
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = string.IsNullOrWhiteSpace(templateDbName)
            ? $"CREATE DATABASE \"{dbName}\""
            : $"CREATE DATABASE \"{dbName}\" TEMPLATE \"{templateDbName}\"";

        try
        {
            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (PostgresException ex) when (ex.SqlState == "42P04")
        {
            // duplicate_database
        }
    }

    // Veritabanı/tablo/kolon adları SQL'e parametre olarak geçirilemiyor, doğrudan gömülüyor.
    // Gömülen her ad önce bu denetimden geçmeli.
    private static readonly Regex SafeIdentifierRegex = new("^[A-Za-z0-9_]+$", RegexOptions.Compiled);

    /// <summary>
    /// Yapılandırmadaki şablon veritabanı adını çözer ve sunucuda gerçekten var olduğunu doğrular.
    /// Ayarlı değilse ya da yoksa <c>null</c> döner; çağıran taraf eski davranışa (boş veritabanı +
    /// migration + örnek veri) düşer. Böylece şablon kurulmamış ortamlarda firma açma bozulmaz.
    /// </summary>
    private async Task<string?> ResolveTemplateDbAsync(string configKey, CancellationToken cancellationToken)
    {
        var templateDbName = (_configuration[configKey] ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(templateDbName)) return null;

        if (!SafeIdentifierRegex.IsMatch(templateDbName))
        {
            Console.WriteLine($"[tenant-template] '{configKey}' gecersiz veritabani adi: {templateDbName}. Sablon yok sayildi.");
            return null;
        }

        var masterConnStr = _configuration.GetConnectionString("MasterConnection");
        if (string.IsNullOrWhiteSpace(masterConnStr)) return null;

        var csb = new NpgsqlConnectionStringBuilder(masterConnStr) { Database = "postgres" };
        await using var conn = new NpgsqlConnection(csb.ConnectionString);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM pg_database WHERE datname = @name;";
        cmd.Parameters.AddWithValue("name", templateDbName);

        if (await cmd.ExecuteScalarAsync(cancellationToken) is null)
        {
            Console.WriteLine($"[tenant-template] sablon bulunamadi: {templateDbName}. Bos veritabani olusturulacak.");
            return null;
        }

        return templateDbName;
    }

    /// <summary>
    /// Şablondan kopyalanan veritabanında firma kodu taşıyan alanları yeni kiracıya damgalar.
    /// Kopya, şablonun kodunu (ör. DEMOTEST) taşıyarak doğar; damgalanmazsa yeni firma kendi
    /// verisini GÖREMEZ — ServiceOps tarafında sorgular <c>TenantCode</c>'a göre süzüyor.
    /// Kolonlar sabit liste yerine şemadan bulunuyor ki ileride eklenen tablolar da kendiliğinden
    /// kapsansın. Boş/NULL değerlere dokunulmuyor: onlar firmadan bağımsız satırlar.
    /// </summary>
    private async Task RestampClonedTenantAsync(string dbName, string tenantCode, CancellationToken cancellationToken)
    {
        var baseConnStr = _configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(baseConnStr)) return;

        var csb = new NpgsqlConnectionStringBuilder(baseConnStr) { Database = dbName };
        await using var conn = new NpgsqlConnection(csb.ConnectionString);
        await conn.OpenAsync(cancellationToken);

        var targets = new List<(string Table, string Column)>();
        await using (var findCmd = conn.CreateCommand())
        {
            findCmd.CommandText = @"
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('TenantCode', 'FirmaCode')
  AND data_type IN ('character varying', 'text', 'character');";

            await using var reader = await findCmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                targets.Add((reader.GetString(0), reader.GetString(1)));
            }
        }

        foreach (var (table, column) in targets)
        {
            if (!SafeIdentifierRegex.IsMatch(table) || !SafeIdentifierRegex.IsMatch(column)) continue;

            try
            {
                await using var updateCmd = conn.CreateCommand();
                updateCmd.CommandText =
                    $"UPDATE public.\"{table}\" SET \"{column}\" = @code " +
                    $"WHERE \"{column}\" IS NOT NULL AND \"{column}\" <> '' AND \"{column}\" <> @code;";
                updateCmd.Parameters.AddWithValue("code", tenantCode);

                var affected = await updateCmd.ExecuteNonQueryAsync(cancellationToken);
                if (affected > 0)
                {
                    Console.WriteLine($"[tenant-template] {dbName}.{table}.{column} -> {tenantCode} ({affected} satir)");
                }
            }
            catch (PostgresException ex)
            {
                Console.WriteLine($"[tenant-template] {dbName}.{table}.{column} damgalanamadi: {ex.MessageText}");
            }
        }
    }

    // ARTIK CAGRILMIYOR (2026-08-23) — ayri personel veritabani modeli terk edildi.
    // Silinmedi ki o modele donmek gerekirse DDL elde olsun; ama yeniden baglamadan once
    // yukaridaki gerekceyi oku, IK servisi ERP nin kiraci tabanina bakiyor.
    private async Task InitializeEmployeeDbAsync(string dbName, CancellationToken cancellationToken)
    {
        var defaultConn = _configuration.GetConnectionString("DefaultConnection") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(defaultConn)) return;

        var csb = new NpgsqlConnectionStringBuilder(defaultConn)
        {
            Database = dbName
        };

        try
        {
            using var conn = new NpgsqlConnection(csb.ConnectionString);
            await conn.OpenAsync(cancellationToken);

            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS ""Employees"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeCode"" character varying(20) NOT NULL DEFAULT '',
    ""FirstName"" character varying(100) NOT NULL,
    ""LastName"" character varying(100) NOT NULL,
    ""Mail"" character varying(200) NOT NULL,
    ""Tc"" character varying(20) NOT NULL,
    ""Phone"" character varying(30) NOT NULL,
    ""TaxNo"" character varying(30) NOT NULL,
    ""TaxOffice"" character varying(100) NOT NULL,
    ""BankName"" character varying(120) NULL,
    ""Iban"" character varying(34) NULL,
    ""HireDate"" timestamp with time zone NULL,
    ""WorkPermitDay"" timestamp with time zone NULL,
    ""Salary"" numeric(18,2) NOT NULL DEFAULT 0,
    ""SalaryDay"" integer NOT NULL DEFAULT 1,
    ""IsActive"" boolean NOT NULL DEFAULT TRUE,
    ""CreateUser"" character varying(50) NOT NULL,
    ""CreateTime"" timestamp with time zone NOT NULL,
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL,
    ""Username"" character varying(100) NULL,
    ""Password"" character varying(100) NULL,
    ""MealAmount"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""WorkType"" character varying(80) NULL,
    ""WorkPermitRenewalFee"" numeric(18,2) NOT NULL DEFAULT 0.0
);

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_Tc"" ON ""Employees"" (""Tc"");
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_EmployeeCode"" ON ""Employees"" (""EmployeeCode"");

CREATE TABLE IF NOT EXISTS ""EmployeePayments"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""PaymentDate"" timestamp with time zone NOT NULL,
    ""Amount"" numeric(18,2) NOT NULL,
    ""Description"" character varying(2000) NULL,
    ""CreateUser"" character varying(50) NOT NULL,
    ""CreateTime"" timestamp with time zone NOT NULL,
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL,
    ""DeductFromSalary"" boolean NOT NULL DEFAULT FALSE,
    ""SalaryDeductedAt"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeeBonusPlans"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""Date"" timestamp with time zone NOT NULL,
    ""Amount"" numeric(18,2) NOT NULL,
    ""Description"" character varying(2000) NULL,
    ""CreateUser"" character varying(50) NOT NULL,
    ""CreateTime"" timestamp with time zone NOT NULL,
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL,
    ""DeductFromSalary"" boolean NOT NULL DEFAULT FALSE,
    ""PaidPaymentId"" integer NULL,
    ""BankAccountDefinitionId"" integer NULL,
    ""CashAccountId"" integer NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeeMealPlans"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""PlannedDate"" timestamp with time zone NOT NULL,
    ""Amount"" numeric(18,2) NOT NULL,
    ""Description"" character varying(2000) NULL,
    ""Status"" integer NOT NULL,
    ""PaidPaymentId"" integer NULL,
    ""CreateUser"" character varying(50) NOT NULL,
    ""CreateTime"" timestamp with time zone NOT NULL,
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeeCheckIns"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""CheckInTime"" timestamp with time zone NOT NULL,
    ""Latitude"" numeric(9,6) NOT NULL DEFAULT 0.0,
    ""Longitude"" numeric(9,6) NOT NULL DEFAULT 0.0,
    ""City"" character varying(120) NULL,
    ""District"" character varying(120) NULL,
    ""CreateUser"" character varying(50) NOT NULL,
    ""CreateTime"" timestamp with time zone NOT NULL,
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL,
    ""CheckOutTime"" timestamp with time zone NULL,
    ""CheckOutLatitude"" numeric(9,6) NULL,
    ""CheckOutLongitude"" numeric(9,6) NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeeLeaves"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""LeaveStartTime"" timestamp with time zone NOT NULL,
    ""ReturnTime"" timestamp with time zone NOT NULL,
    ""Description"" character varying(2000) NULL,
    ""CreateUser"" character varying(50) NOT NULL,
    ""CreateTime"" timestamp with time zone NOT NULL,
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeeLocationSettings"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""Latitude"" numeric(18,9) NOT NULL,
    ""Longitude"" numeric(18,9) NOT NULL,
    ""MaxDistanceInMeters"" double precision NOT NULL,
    ""IsActive"" boolean NOT NULL DEFAULT TRUE,
    ""CreateUser"" character varying(50) NOT NULL,
    ""CreateTime"" timestamp with time zone NOT NULL,
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""Pages"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""DisplayName"" character varying(100) NOT NULL,
    ""IsActive"" boolean NOT NULL,
    ""Key"" character varying(100) NOT NULL,
    ""ModuleKey"" character varying(100) NOT NULL,
    ""SortOrder"" integer NOT NULL
);

CREATE TABLE IF NOT EXISTS ""RolePagePermissions"" (
    ""RoleId"" integer NOT NULL,
    ""PageId"" integer NOT NULL,
    ""CanAccess"" boolean NOT NULL,
    PRIMARY KEY (""RoleId"", ""PageId"")
);

CREATE TABLE IF NOT EXISTS ""NumberSeries"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""Code"" character varying(50) NOT NULL,
    ""Description"" character varying(255) NULL,
    ""Prefix"" character varying(10) NULL,
    ""LastNo"" integer NOT NULL,
    ""Year"" integer NOT NULL,
    ""IsActive"" boolean NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS ""ReverseGeocodeCaches"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""RoundedLatitude"" numeric(9,2) NOT NULL,
    ""RoundedLongitude"" numeric(9,2) NOT NULL,
    ""City"" character varying(120) NULL,
    ""District"" character varying(120) NULL,
    ""LastFetchedUtc"" timestamp with time zone NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_ReverseGeocodeCaches_RoundedLatitude_RoundedLongitude"" ON ""ReverseGeocodeCaches"" (""RoundedLatitude"", ""RoundedLongitude"");
";
            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Employee DB Provisioning] Failed to initialize tables: {ex.Message}");
        }
    }

    private async Task MigrateAndSeedTenantDbAsync(
        string dbName,
        string tenantCode,
        string superAdminUsername,
        string superAdminMail,
        string superAdminPassword,
        bool clonedFromTemplate,
        CancellationToken cancellationToken)
    {
        var baseConnStr = _configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(baseConnStr)) throw new InvalidOperationException("DefaultConnection bulunamadı");

        var csb = new NpgsqlConnectionStringBuilder(baseConnStr)
        {
            Database = dbName
        };

        // Defensive: some migrations assume Employees exists (FKs/ALTERs). Ensure the base table exists
        // before applying migrations to avoid 42P01 in brand-new tenant DBs.
        try
        {
            await using var preConn = new NpgsqlConnection(csb.ConnectionString);
            await preConn.OpenAsync(cancellationToken);
            await using var preCmd = preConn.CreateCommand();
            preCmd.CommandText = @"
CREATE SCHEMA IF NOT EXISTS public;

CREATE TABLE IF NOT EXISTS public.""Employees"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""EmployeeCode"" character varying(20) NOT NULL DEFAULT '',
  ""FirstName"" character varying(100) NOT NULL,
  ""LastName"" character varying(100) NOT NULL,
  ""Mail"" character varying(200) NOT NULL,
  ""Tc"" character varying(20) NOT NULL,
  ""Phone"" character varying(30) NOT NULL,
  ""TaxNo"" character varying(30) NOT NULL,
  ""TaxOffice"" character varying(100) NOT NULL,
  ""BankName"" character varying(120) NULL,
  ""Iban"" character varying(34) NULL,
  ""HireDate"" timestamp with time zone NULL,
  ""WorkPermitDay"" timestamp with time zone NULL,
  ""Salary"" numeric(18,2) NOT NULL DEFAULT 0,
  ""SalaryDay"" integer NOT NULL DEFAULT 1,
  ""IsActive"" boolean NOT NULL DEFAULT TRUE,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_Employees"" PRIMARY KEY (""Id"")
);

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_Tc"" ON public.""Employees"" (""Tc"");
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_EmployeeCode"" ON public.""Employees"" (""EmployeeCode"");

CREATE TABLE IF NOT EXISTS public.""EmployeeMealPlans"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""EmployeeId"" integer NOT NULL,
  ""PlannedDate"" timestamp with time zone NOT NULL,
  ""Amount"" numeric(18,2) NOT NULL,
  ""Description"" character varying(2000) NULL,
  ""Status"" integer NOT NULL,
  ""PaidPaymentId"" integer NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_EmployeeMealPlans"" PRIMARY KEY (""Id"")
);

CREATE INDEX IF NOT EXISTS ""IX_EmployeeMealPlans_EmployeeId_PlannedDate"" ON public.""EmployeeMealPlans"" (""EmployeeId"", ""PlannedDate"");
CREATE INDEX IF NOT EXISTS ""IX_EmployeeMealPlans_PaidPaymentId"" ON public.""EmployeeMealPlans"" (""PaidPaymentId"");
";
            await preCmd.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Tenant DB migration öncesi Employees tablosu hazırlanamadı: {ex.Message}", ex);
        }

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(csb.ConnectionString)
            .Options;

        await using var db = new AppDbContext(options);

        // Temporarily drop unique index on Pages to avoid unique constraint violations during EF Core's sequential seed data updates/shifts
        try
        {
            await db.Database.ExecuteSqlRawAsync(@"DROP INDEX IF EXISTS ""IX_Pages_ModuleKey_Key"";", cancellationToken);
        }
        catch {}

        await db.Database.MigrateAsync(cancellationToken);

        try
        {
            await db.Database.ExecuteSqlRawAsync(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Pages_ModuleKey_Key"" ON ""Pages"" (""ModuleKey"", ""Key"");", cancellationToken);
        }
        catch {}

        // MODELDE OLUP TAZE VERİTABANINDA OLMAYAN KOLON/TABLOLAR (2026-10-14).
        // Yeni firma açma, ilk kayıtta "column UserActivityLogs.CorrelationId does not exist"
        // ile yarıda kalıyordu: o kolon migration'da yok, yalnız açılıştaki drift bloklarında ve
        // ilk istekteki tenant tamamlamasında ekleniyor — ikisi de bu yeni veritabanına henüz
        // uğramamış oluyor. Açılıştaki model eşitlemesinin aynısı burada çalışır; veritabanı
        // yeni olduğu için yalnız EKSİK olan eklenir, var olana dokunulmaz.
        try
        {
            var schemaReport = await SchemaChecker.InspectAsync(db, cancellationToken);
            var schemaFix = SchemaChecker.BuildFixScript(schemaReport);
            if (schemaFix.Length > 0) await db.Database.ExecuteSqlRawAsync(schemaFix, cancellationToken);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Firma] Model-şema eşitlemesi yapılamadı ({dbName}): {ex.Message}");
        }

        // Migrations'ta olmayan, Program.cs açılışındaki "ensure" ile eklenen Users sütunları yeni tenant DB'de
        // de olsun; yoksa aşağıdaki db.Users sorgusu "column u.EmployeeAccess does not exist" ile patlıyor ve
        // firma yarım kalıyor (satır var, kullanıcı/seed/SetupCompletedAt yok). 2026-09-21
        // Ayrıca Migrations/ altında [Migration] özniteliği olmayan (Designer'sız) dosyalar EF tarafından
        // hiç uygulanmıyor: 20260806* (Carikodu genişletme, ServiceOpsCariKodu, ProductDetails). Canlı
        // kiracılarda elle eklenmişti; yeni firma da aynı şemayla doğsun.
        await db.Database.ExecuteSqlRawAsync(@"
ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""DefaultCashAccountId"" integer NULL;
ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""DefaultBankAccountId"" integer NULL;
ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""EmployeeAccess"" boolean NOT NULL DEFAULT FALSE;
ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""AsistanAccess"" boolean NOT NULL DEFAULT FALSE;
ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""CariEkstreTipleri"" character varying(200) NULL;
ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""ServiceOpsCariKodu"" character varying(50) NULL;
ALTER TABLE ""Users"" ALTER COLUMN ""Carikodu"" TYPE character varying(8000);
UPDATE ""Users"" SET ""Carikodu"" = '*' WHERE ""Carikodu"" IS NULL OR btrim(""Carikodu"") = '';
CREATE TABLE IF NOT EXISTS ""ProductDetails"" (
    ""Id""          serial PRIMARY KEY,
    ""StockCode""   character varying(50)   NOT NULL,
    ""Description"" character varying(4000),
    ""Features""    character varying(4000),
    ""CreateUser""  character varying(100) NOT NULL DEFAULT '',
    ""CreateTime""  timestamp with time zone NOT NULL DEFAULT now(),
    ""EditUser""    character varying(100),
    ""EditTime""    timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_ProductDetails_StockCode"" ON ""ProductDetails"" (""StockCode"");
", cancellationToken);

        // Pages drift fix: ensure required permission pages exist in BRAND NEW tenant DBs too.
        await db.Database.ExecuteSqlRawAsync(@"
UPDATE ""Pages""
SET ""ModuleKey"" = 'invoice',
    ""DisplayName"" = 'Konsinye',
    ""SortOrder"" = 12
WHERE ""ModuleKey"" = 'users' AND ""Key"" = 'irsaliye';

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10450, 'Konsinye: Kaç Adet Düzenle', TRUE, 'irsaliyeQuantityEdit', 'invoice', 200
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='irsaliyeQuantityEdit');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10451, 'Konsinye: Sevk Adedi Düzenle', TRUE, 'irsaliyeShippedQuantityEdit', 'invoice', 201
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='irsaliyeShippedQuantityEdit');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10452, 'Konsinye: Durum Onaylandı', TRUE, 'irsaliyeStatusOnaylandi', 'invoice', 202
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='irsaliyeStatusOnaylandi');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10453, 'Konsinye: Durum Sevk Edildi', TRUE, 'irsaliyeStatusSevkEdildi', 'invoice', 203
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='irsaliyeStatusSevkEdildi');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10454, 'Cari Proforma', TRUE, 'bayiTeklifleri', 'invoice', 204
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='bayiTeklifleri');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10455, 'Cari Müşteri Teklifi', TRUE, 'cariTeklifleri', 'invoice', 205
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleri');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10456, 'Düzenle', TRUE, 'cariTeklifleriDuzenle', 'invoice', 10456
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleriDuzenle');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10457, 'Sil', TRUE, 'cariTeklifleriSil', 'invoice', 10457
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleriSil');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10458, 'Proforma Aktar', TRUE, 'cariTeklifleriProformaAktar', 'invoice', 10458
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleriProformaAktar');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 10459, 'Basım', TRUE, 'cariTeklifleriBasim', 'invoice', 10459
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleriBasim');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 105, 'Termin', TRUE, 'termin', 'invoice', 14
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='termin');

UPDATE ""Pages""
SET ""DisplayName"" = 'Cari Müşteri Teklifi'
WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleri';

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r, p.""Id"", TRUE
FROM unnest(ARRAY[6,9,8,12,3,10,2]) AS r
CROSS JOIN (
  SELECT ""Id""
  FROM ""Pages""
  WHERE ""ModuleKey""='invoice'
    AND ""Key"" IN ('irsaliye','irsaliyeQuantityEdit','irsaliyeShippedQuantityEdit','irsaliyeStatusOnaylandi','irsaliyeStatusSevkEdildi','bayiTeklifleri','cariTeklifleri','cariTeklifleriDuzenle','cariTeklifleriSil','cariTeklifleriProformaAktar','cariTeklifleriBasim','termin')
) AS p
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
", cancellationToken);

        await db.Database.ExecuteSqlRawAsync(@"
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r, p.""Id"", TRUE
FROM unnest(ARRAY[6,7,3,2]) AS r
CROSS JOIN (
  SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='employee' AND ""Key""='calisan'
) AS p
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
", cancellationToken);

            await db.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS public.""Employees"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""EmployeeCode"" character varying(20) NOT NULL DEFAULT '',
  ""FirstName"" character varying(100) NOT NULL,
  ""LastName"" character varying(100) NOT NULL,
  ""Mail"" character varying(200) NOT NULL,
  ""Tc"" character varying(20) NOT NULL,
  ""Phone"" character varying(30) NOT NULL,
  ""TaxNo"" character varying(30) NOT NULL,
  ""TaxOffice"" character varying(100) NOT NULL,
  ""BankName"" character varying(120) NULL,
  ""Iban"" character varying(34) NULL,
  ""HireDate"" timestamp with time zone NULL,
  ""WorkPermitDay"" timestamp with time zone NULL,
  ""Salary"" numeric(18,2) NOT NULL DEFAULT 0,
  ""SalaryDay"" integer NOT NULL DEFAULT 1,
  ""IsActive"" boolean NOT NULL DEFAULT TRUE,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_Employees"" PRIMARY KEY (""Id"")
);

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_Tc"" ON public.""Employees"" (""Tc"");
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_EmployeeCode"" ON public.""Employees"" (""EmployeeCode"");
", cancellationToken);

        await db.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS public.""EmployeeMealPlans"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""EmployeeId"" integer NOT NULL,
  ""PlannedDate"" timestamp with time zone NOT NULL,
  ""Amount"" numeric(18,2) NOT NULL,
  ""Description"" character varying(2000) NULL,
  ""Status"" integer NOT NULL,
  ""PaidPaymentId"" integer NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_EmployeeMealPlans"" PRIMARY KEY (""Id"")
);

CREATE INDEX IF NOT EXISTS ""IX_EmployeeMealPlans_EmployeeId_PlannedDate"" ON public.""EmployeeMealPlans"" (""EmployeeId"", ""PlannedDate"");
CREATE INDEX IF NOT EXISTS ""IX_EmployeeMealPlans_PaidPaymentId"" ON public.""EmployeeMealPlans"" (""PaidPaymentId"");
", cancellationToken);

        await db.Database.ExecuteSqlRawAsync(@"
INSERT INTO ""Pages"" (""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 'Genel Ayarlar', TRUE, 'genelAyarlar', 'users', 14
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='genelAyarlar');

-- Bildirim sayfaları kendi modülünde açılır; Ayarlar'ın altı değil.
INSERT INTO ""Pages"" (""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 'Bildirimler', TRUE, 'bildirimler', 'bildirimler', 1
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimler');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 403, 'Gelen Bildirimler', TRUE, 'bildirimlerGelen', 'bildirimler', 2
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimlerGelen' OR ""Id""=403);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 404, 'Bildirim Gönder', TRUE, 'bildirimlerGonder', 'bildirimler', 3
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimlerGonder' OR ""Id""=404);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 405, 'Kullanıcı Hareketleri', TRUE, 'userActivities', 'users', 20
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='userActivities' OR ""Id""=405);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 406, 'Hata Logları', TRUE, 'systemErrorLogs', 'users', 21
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='systemErrorLogs' OR ""Id""=406);

-- Bildirim ALMA: her role açık. Sabit 1..12 dizisi değil tenant'ın KENDİ rolleri, ki
-- firmaya özel roller de kapsansın.
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT role.""Id"", 403, TRUE FROM ""Roles"" role
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

-- Bildirim GÖNDERME: yeni firmada da kapalı başlar; Rol Yetkileri ekranından açılır.
-- SSA'nın hakkı bu tablodan değil, koddaki süper admin kontrolünden gelir.

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r, 405, TRUE
FROM unnest(ARRAY[1,2,6]) AS r
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r, 406, TRUE
FROM unnest(ARRAY[1,2,6]) AS r
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
", cancellationToken);

        var hasFirmaCode = await TenantHasFirmaCodeColumnAsync(csb.ConnectionString, cancellationToken);

        var superAdminRoleId = await db.Roles
            .AsNoTracking()
            .Where(x => x.IsSuperAdmin)
            .OrderBy(x => x.Id)
            .Select(x => x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (superAdminRoleId == 0)
        {
            throw new InvalidOperationException("Tenant DB seed sonrası SuperAdmin rolü bulunamadı");
        }

        // Şablondan kopyalanan veritabanı, şablonun kullanıcılarını da taşır; istenen SuperAdmin
        // kullanıcı adı orada zaten olabilir. Eskiden bu durumda kayıt hiç dokunulmadan bırakılıyordu
        // ve firma sahibi kendi belirlediği şifreyle giremiyordu (şablonun şifresi geçerli kalıyordu).
        var existingSuperAdmin = await db.Users.FirstOrDefaultAsync(x => x.Username == superAdminUsername, cancellationToken);
        if (existingSuperAdmin is null)
        {
            db.Users.Add(new User
            {
                Username = superAdminUsername,
                Mail = superAdminMail,
                Password = PasswordHasher.HashPassword(superAdminPassword),
                FirmaCode = (hasFirmaCode ? tenantCode : null),
                Unvan = "Super Admin",
                RoleId = superAdminRoleId,
                IsActive = true
            });
        }
        else
        {
            existingSuperAdmin.Mail = superAdminMail;
            existingSuperAdmin.Password = PasswordHasher.HashPassword(superAdminPassword);
            if (hasFirmaCode) existingSuperAdmin.FirmaCode = tenantCode;
            existingSuperAdmin.RoleId = superAdminRoleId;
            existingSuperAdmin.IsActive = true;
        }

        await db.SaveChangesAsync(cancellationToken);

        await SeedSampleDataAsync(db, tenantCode, cancellationToken);

        // Şablondan kopyalandıysa yetkiler ZATEN şablondan geliyor. Aşağıdaki eşitleme yetkileri
        // DEMO'dan çekip üzerine yazıyor; klonda çağrılırsa "yeni firma şablonun aynısı olsun"
        // kuralını bozar. Onun için yalnızca sıfırdan kurulan veritabanlarında çalışır.
        if (!clonedFromTemplate)
        {
            await SyncPermissionsFromDemoAsync(dbName, cancellationToken);
        }
    }

    private async Task MigrateAndSeedServiceOpsDbAsync(
        string dbName,
        string tenantCode,
        string superAdminUsername,
        string superAdminMail,
        string superAdminPassword,
        CancellationToken cancellationToken)
    {
        var baseConnStr = _configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(baseConnStr)) throw new InvalidOperationException("DefaultConnection bulunamadı");

        var csb = new NpgsqlConnectionStringBuilder(baseConnStr)
        {
            Database = dbName
        };

        await using var conn = new NpgsqlConnection(csb.ConnectionString);
        await conn.OpenAsync(cancellationToken);

        // Minimal ServiceOps schema. This will later be replaced/extended by the dedicated service-ops-api migrations.
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS public.""ServiceRoles"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""Code"" character varying(50) NOT NULL,
  ""Name"" character varying(120) NOT NULL,
  ""IsSuperAdmin"" boolean NOT NULL DEFAULT FALSE,
  CONSTRAINT ""PK_ServiceRoles"" PRIMARY KEY (""Id""),
  CONSTRAINT ""UX_ServiceRoles_Code"" UNIQUE (""Code"")
);

CREATE TABLE IF NOT EXISTS public.""ServiceUsers"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""TenantCode"" character varying(50) NOT NULL DEFAULT '',
  ""Username"" character varying(80) NOT NULL,
  ""Mail"" character varying(200) NOT NULL DEFAULT '',
  ""Password"" character varying(200) NOT NULL DEFAULT '',
  ""IsActive"" boolean NOT NULL DEFAULT TRUE,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(80) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_ServiceUsers"" PRIMARY KEY (""Id""),
  CONSTRAINT ""UX_ServiceUsers_Username"" UNIQUE (""Username"")
);

CREATE TABLE IF NOT EXISTS public.""ServiceUserRoles"" (
  ""UserId"" integer NOT NULL,
  ""RoleId"" integer NOT NULL,
  CONSTRAINT ""PK_ServiceUserRoles"" PRIMARY KEY (""UserId"", ""RoleId""),
  CONSTRAINT ""FK_ServiceUserRoles_User"" FOREIGN KEY (""UserId"") REFERENCES public.""ServiceUsers""(""Id"") ON DELETE CASCADE,
  CONSTRAINT ""FK_ServiceUserRoles_Role"" FOREIGN KEY (""RoleId"") REFERENCES public.""ServiceRoles""(""Id"") ON DELETE CASCADE
);
";
            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }

        int superAdminRoleId;
        await using (var roleCmd = conn.CreateCommand())
        {
            roleCmd.CommandText = @"
INSERT INTO public.""ServiceRoles"" (""Code"", ""Name"", ""IsSuperAdmin"")
SELECT 'SUPERADMIN', 'Super Admin', TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.""ServiceRoles"" WHERE ""Code""='SUPERADMIN');

SELECT ""Id"" FROM public.""ServiceRoles"" WHERE ""Code""='SUPERADMIN' LIMIT 1;
";
            var obj = await roleCmd.ExecuteScalarAsync(cancellationToken);
            superAdminRoleId = obj is null ? 0 : Convert.ToInt32(obj, CultureInfo.InvariantCulture);
        }

        if (superAdminRoleId <= 0)
        {
            throw new InvalidOperationException("Servis DB seed sonrası SUPERADMIN rolü bulunamadı");
        }

        int userId;
        await using (var userCmd = conn.CreateCommand())
        {
            userCmd.CommandText = @"
INSERT INTO public.""ServiceUsers"" (""TenantCode"", ""Username"", ""Mail"", ""Password"", ""IsActive"", ""CreateTime"")
VALUES (@tenantCode, @username, @mail, @password, TRUE, now())
ON CONFLICT (""Username"") DO UPDATE
SET ""Mail"" = EXCLUDED.""Mail"",
    ""Password"" = EXCLUDED.""Password"",
    ""IsActive"" = TRUE;

SELECT ""Id"" FROM public.""ServiceUsers"" WHERE lower(""Username"")=lower(@username) LIMIT 1;
";
            userCmd.Parameters.AddWithValue("tenantCode", tenantCode);
            userCmd.Parameters.AddWithValue("username", superAdminUsername);
            userCmd.Parameters.AddWithValue("mail", superAdminMail);
            userCmd.Parameters.AddWithValue("password", superAdminPassword);

            var obj = await userCmd.ExecuteScalarAsync(cancellationToken);
            userId = obj is null ? 0 : Convert.ToInt32(obj, CultureInfo.InvariantCulture);
        }

        if (userId <= 0)
        {
            throw new InvalidOperationException("Servis DB seed sonrası SuperAdmin kullanıcı oluşturulamadı");
        }

        await using (var linkCmd = conn.CreateCommand())
        {
            linkCmd.CommandText = @"
INSERT INTO public.""ServiceUserRoles"" (""UserId"", ""RoleId"")
SELECT @uid, @rid
WHERE NOT EXISTS (SELECT 1 FROM public.""ServiceUserRoles"" WHERE ""UserId""=@uid AND ""RoleId""=@rid);
";
            linkCmd.Parameters.AddWithValue("uid", userId);
            linkCmd.Parameters.AddWithValue("rid", superAdminRoleId);
            await linkCmd.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task SeedSampleDataAsync(AppDbContext db, string tenantCode, CancellationToken cancellationToken)
    {
        // Warehouse
        var hasWarehouse = await db.Warehouses.AsNoTracking().AnyAsync(cancellationToken);
        if (!hasWarehouse)
        {
            db.Warehouses.Add(new Warehouse
            {
                WarehouseCode = 1,
                Name = "Merkez Depo",
                SalesmanCode = null,
                IsVehicle = false,
                NegativeBalanceControl = false,
                IsActive = true,
                CreateUser = "System",
                CreateTime = DateTime.UtcNow
            });
        }

        // Salesman (Plasiyer)
        var hasSalesman = await db.Salesmen.AsNoTracking().AnyAsync(cancellationToken);
        if (!hasSalesman)
        {
            db.Salesmen.Add(new Salesman
            {
                SalesmanCode = "P001",
                Description = "Örnek Plasiyer",
                CustomerCode = null,
                CreateUser = "System",
                CreateTime = DateTime.UtcNow
            });
        }

        // Supplier
        var hasSupplier = await db.Suppliers.AsNoTracking().AnyAsync(cancellationToken);
        if (!hasSupplier)
        {
            db.Suppliers.Add(new Supplier
            {
                SupplierCode = "TED001",
                FullName = "Örnek Tedarikçi",
                PhoneNumber = "05320000000",
                Region = "İstanbul",
                Address = "Merkez",
                CreateUser = "System",
                CreateTime = DateTime.UtcNow
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        var supplierId = await db.Suppliers.AsNoTracking().OrderBy(x => x.Id).Select(x => x.Id).FirstOrDefaultAsync(cancellationToken);

        // Product
        var hasProduct = await db.Products.AsNoTracking().AnyAsync(cancellationToken);
        if (!hasProduct)
        {
            db.Products.Add(new Product
            {
                CreatedAt = DateTimeOffset.UtcNow,
                StockCode = "URUN001",
                Name = "Örnek Ürün",
                Unit = "ADET",
                TaxRate = 20,
                DiscountRate = 0,
                SupplierId = supplierId > 0 ? supplierId : null,
                BoxQuantity = 1,
                PurchasePrice = 100,
                ContainerQuantity = 1,
                Freight = 0,
                CurrencyCode = 0,
                IsOfficial = true,
                Stock = 10,
                MinStock = 0,
                IsActive = true,
                BsyVisibleFlag = "E"
            });
        }

    }

    private static async Task<bool> TenantHasFirmaCodeColumnAsync(string tenantConnectionString, CancellationToken cancellationToken)
    {
        try
        {
            await using var conn = new NpgsqlConnection(tenantConnectionString);
            await conn.OpenAsync(cancellationToken);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
SELECT 1
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Users'
  AND column_name = 'FirmaCode'
LIMIT 1;";

            var result = await cmd.ExecuteScalarAsync(cancellationToken);
            return result is not null && result != DBNull.Value;
        }
        catch
        {
            return false;
        }
    }

    private async Task SyncPermissionsFromDemoAsync(string targetDbName, CancellationToken cancellationToken)
    {
        try
        {
            // 1. Find the DEMO/DEMO tenant in the Master DB to verify it exists and get its connection string
            var sourceTenant = await _masterDb.Tenants
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Code == "DEMO" || t.Code == "DEMO", cancellationToken);

            if (sourceTenant == null)
            {
                // If template tenant doesn't exist, skip copying and fall back to default migrations seeding
                return;
            }

            var baseConnStr = _configuration.GetConnectionString("DefaultConnection");
            if (string.IsNullOrWhiteSpace(baseConnStr)) return;

            var sourceCsb = new NpgsqlConnectionStringBuilder(baseConnStr) { Database = sourceTenant.DbName };
            var targetCsb = new NpgsqlConnectionStringBuilder(baseConnStr) { Database = targetDbName };

            // 2. Fetch Roles, Pages, and Permissions from the source database (DEMO)
            var sourceRoles = new List<(int Id, string Code, string Name, string DisplayName, string Description, bool IsActive, bool IsSuperAdmin)>();
            var sourcePages = new Dictionary<int, (string ModuleKey, string Key)>();
            var sourcePermissions = new List<(string RoleCode, string ModuleKey, string Key, bool CanAccess)>();

            await using (var srcConn = new NpgsqlConnection(sourceCsb.ConnectionString))
            {
                await srcConn.OpenAsync(cancellationToken);

                // Read Roles
                await using (var cmd = srcConn.CreateCommand())
                {
                    cmd.CommandText = "SELECT \"Id\", \"Code\", \"Name\", \"DisplayName\", \"Description\", \"IsActive\", \"IsSuperAdmin\" FROM public.\"Roles\"";
                    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                    {
                        sourceRoles.Add((
                            reader.GetInt32(0),
                            reader.GetString(1),
                            reader.GetString(2),
                            reader.GetString(3),
                            reader.GetString(4),
                            reader.GetBoolean(5),
                            reader.GetBoolean(6)
                        ));
                    }
                }

                // Read Pages
                await using (var cmd = srcConn.CreateCommand())
                {
                    cmd.CommandText = "SELECT \"Id\", \"ModuleKey\", \"Key\" FROM public.\"Pages\"";
                    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                    {
                        var id = reader.GetInt32(0);
                        var mKey = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
                        var key = reader.IsDBNull(2) ? string.Empty : reader.GetString(2);
                        sourcePages[id] = (mKey, key);
                    }
                }

                // Read Permissions
                await using (var cmd = srcConn.CreateCommand())
                {
                    cmd.CommandText = "SELECT \"RoleId\", \"PageId\", \"CanAccess\" FROM public.\"RolePagePermissions\"";
                    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                    {
                        var roleId = reader.GetInt32(0);
                        var pageId = reader.GetInt32(1);
                        var canAccess = reader.GetBoolean(2);

                        var matchedRole = sourceRoles.FirstOrDefault(r => r.Id == roleId);
                        if (string.IsNullOrEmpty(matchedRole.Code)) continue;

                        if (sourcePages.TryGetValue(pageId, out var pageKey))
                        {
                            sourcePermissions.Add((matchedRole.Code, pageKey.ModuleKey, pageKey.Key, canAccess));
                        }
                    }
                }
            }

            if (sourceRoles.Count == 0) return;

            // 3. Update Roles and Upsert RolePagePermissions in the target database
            await using (var targetConn = new NpgsqlConnection(targetCsb.ConnectionString))
            {
                await targetConn.OpenAsync(cancellationToken);

                // Update existing roles or insert missing ones
                foreach (var role in sourceRoles)
                {
                    await using var cmd = targetConn.CreateCommand();
                    cmd.CommandText = @"
INSERT INTO public.""Roles"" (""Code"", ""Name"", ""DisplayName"", ""Description"", ""IsActive"", ""IsSuperAdmin"", ""CreatedAt"")
VALUES (@code, @name, @displayName, @description, @isActive, @isSuperAdmin, @createdAt)
ON CONFLICT (""Code"") DO UPDATE
SET ""Name"" = EXCLUDED.""Name"",
    ""DisplayName"" = EXCLUDED.""DisplayName"",
    ""Description"" = EXCLUDED.""Description"",
    ""IsActive"" = EXCLUDED.""IsActive"",
    ""IsSuperAdmin"" = EXCLUDED.""IsSuperAdmin"";";
                    cmd.Parameters.AddWithValue("code", role.Code);
                    cmd.Parameters.AddWithValue("name", role.Name);
                    cmd.Parameters.AddWithValue("displayName", role.DisplayName);
                    cmd.Parameters.AddWithValue("description", role.Description);
                    cmd.Parameters.AddWithValue("isActive", role.IsActive);
                    cmd.Parameters.AddWithValue("isSuperAdmin", role.IsSuperAdmin);
                    cmd.Parameters.AddWithValue("createdAt", DateTime.UtcNow);
                    await cmd.ExecuteNonQueryAsync(cancellationToken);
                }

                // Fetch new target Roles map Code -> Id
                var targetRoles = new Dictionary<string, int>();
                await using (var cmd = targetConn.CreateCommand())
                {
                    cmd.CommandText = "SELECT \"Id\", \"Code\" FROM public.\"Roles\"";
                    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                    {
                        targetRoles[reader.GetString(1)] = reader.GetInt32(0);
                    }
                }

                // Fetch new target Pages map (ModuleKey, Key) -> Id
                var targetPages = new Dictionary<(string ModuleKey, string Key), int>();
                await using (var cmd = targetConn.CreateCommand())
                {
                    cmd.CommandText = "SELECT \"Id\", \"ModuleKey\", \"Key\" FROM public.\"Pages\"";
                    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                    {
                        var id = reader.GetInt32(0);
                        var mKey = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
                        var key = reader.IsDBNull(2) ? string.Empty : reader.GetString(2);
                        targetPages[(mKey, key)] = id;
                    }
                }

                // Upsert permissions
                foreach (var perm in sourcePermissions)
                {
                    if (!targetRoles.TryGetValue(perm.RoleCode, out var roleId)) continue;
                    if (!targetPages.TryGetValue((perm.ModuleKey, perm.Key), out var pageId)) continue;

                    await using var cmd = targetConn.CreateCommand();
                    cmd.CommandText = @"
INSERT INTO public.""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
VALUES (@roleId, @pageId, @canAccess)
ON CONFLICT (""RoleId"", ""PageId"") DO UPDATE
SET ""CanAccess"" = EXCLUDED.""CanAccess"";";
                    cmd.Parameters.AddWithValue("roleId", roleId);
                    cmd.Parameters.AddWithValue("pageId", pageId);
                    cmd.Parameters.AddWithValue("canAccess", perm.CanAccess);
                    await cmd.ExecuteNonQueryAsync(cancellationToken);
                }
            }
        }
        catch (Exception ex)
        {
            // Log/fail gracefully so it does not block the entire provisioning process
            Console.WriteLine($"DEMO/DEMO tenant role permissions sync failed: {ex.Message}");
        }
    }
}
