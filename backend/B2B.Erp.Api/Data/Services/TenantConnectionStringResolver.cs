using System.Security.Claims;
using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Data.Services;

public sealed class TenantConnectionStringResolver
{
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IConfiguration _configuration;
    private readonly MasterDbContext _masterDbContext;

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, bool> _initializedDbs = new();
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, string> _tenantDbNames = new(StringComparer.OrdinalIgnoreCase);
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<int, string> _tenantCodesById = new();

    public TenantConnectionStringResolver(
        IHttpContextAccessor httpContextAccessor,
        IConfiguration configuration,
        MasterDbContext masterDbContext)
    {
        _httpContextAccessor = httpContextAccessor;
        _configuration = configuration;
        _masterDbContext = masterDbContext;
    }

    public string Resolve()
    {
        var defaultConn = _configuration.GetConnectionString("DefaultConnection") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(defaultConn))
            return defaultConn;

        var tenantCode = GetCurrentTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode))
            return defaultConn;

        tenantCode = tenantCode.Trim().ToUpperInvariant();

        if (!_tenantDbNames.TryGetValue(tenantCode, out var tenantDbName))
        {
            tenantDbName = _masterDbContext.Tenants
                .AsNoTracking()
                .Where(x => x.Code == tenantCode)
                .Select(x => x.DbName)
                .FirstOrDefault();

            if (string.IsNullOrWhiteSpace(tenantDbName))
            {
                tenantDbName = $"b2b_erp_tenant_{tenantCode}";
            }

            _tenantDbNames[tenantCode] = tenantDbName;
        }

        var csb = new NpgsqlConnectionStringBuilder(defaultConn)
        {
            Database = tenantDbName
        };

        if (!_initializedDbs.TryAdd(tenantDbName, true))
        {
            return csb.ConnectionString;
        }

        // Best-effort auto-heal: some tenant DBs may miss the Users.FirmaCode column.
        // EF model expects it, so ensure it exists to prevent 42703 errors.
        try
        {
            using var conn = new NpgsqlConnection(csb.ConnectionString);
            conn.Open();

            try
            {
                using var preCmd = conn.CreateCommand();
                preCmd.CommandText = @"ALTER TABLE ""BankAccountDefinitions"" ADD COLUMN IF NOT EXISTS ""Budget"" numeric(18,2) NOT NULL DEFAULT 0.0;

ALTER TABLE ""PayableChecks"" ADD COLUMN IF NOT EXISTS ""CustomerCode"" character varying(50) NULL;
ALTER TABLE ""PayableChecks"" ADD COLUMN IF NOT EXISTS ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1.0;
ALTER TABLE ""PayableChecks"" ADD COLUMN IF NOT EXISTS ""CurrencyAmount"" numeric(18,2) NOT NULL DEFAULT 0.0;

ALTER TABLE ""PayableNotes"" ADD COLUMN IF NOT EXISTS ""CustomerCode"" character varying(50) NULL;

ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""BankName"" character varying(120) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Iban"" character varying(34) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""HireDate"" timestamp with time zone NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkPermitDay"" timestamp with time zone NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkPermitRenewalFee"" numeric(18,2) NOT NULL DEFAULT 0.0;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Username"" character varying(100) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Password"" character varying(100) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""MealAmount"" numeric(18,2) NOT NULL DEFAULT 0.0;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkType"" character varying(80) NULL;

ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""DeductFromSalary"" boolean NOT NULL DEFAULT FALSE;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""SalaryDeductedAt"" timestamp with time zone NULL;

ALTER TABLE ""Installations"" ADD COLUMN IF NOT EXISTS ""DealerCode"" character varying(50) NULL;
ALTER TABLE ""Installations"" ADD COLUMN IF NOT EXISTS ""Type"" character varying(20) NOT NULL DEFAULT 'Montaj';
ALTER TABLE ""Installations"" ADD COLUMN IF NOT EXISTS ""Status"" character varying(30) NOT NULL DEFAULT 'Yeni Kayıt';
ALTER TABLE ""Installations"" ADD COLUMN IF NOT EXISTS ""PlannedDateUtc"" timestamp with time zone NULL;
ALTER TABLE ""Installations"" ADD COLUMN IF NOT EXISTS ""Technician"" character varying(100) NULL;
ALTER TABLE ""Installations"" ADD COLUMN IF NOT EXISTS ""LineageId"" uuid NULL;
ALTER TABLE ""Installations"" ADD COLUMN IF NOT EXISTS ""InstallationClientId"" uuid NULL;
ALTER TABLE ""Installations"" ADD COLUMN IF NOT EXISTS ""InvoiceLineId"" integer NULL;
ALTER TABLE ""Installations"" ADD COLUMN IF NOT EXISTS ""SalesOrderLineId"" integer NULL;
ALTER TABLE ""Installations"" ADD COLUMN IF NOT EXISTS ""CustomerOfferLineId"" integer NULL;

ALTER TABLE ""InvoiceLines"" ADD COLUMN IF NOT EXISTS ""LineageId"" uuid NULL;
ALTER TABLE ""SalesOrderLines"" ADD COLUMN IF NOT EXISTS ""LineageId"" uuid NULL;
ALTER TABLE ""CustomerOfferLines"" ADD COLUMN IF NOT EXISTS ""LineageId"" uuid NULL;
ALTER TABLE ""UserBasketItems"" ADD COLUMN IF NOT EXISTS ""LineageId"" uuid NULL;
ALTER TABLE ""UserBasketItems"" ADD COLUMN IF NOT EXISTS ""MontajSnapshotJson"" text NULL;

CREATE TABLE IF NOT EXISTS ""InstallationDocuments"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""InstallationId"" integer NOT NULL,
  ""DocumentUrl"" character varying(2000) NOT NULL,
  ""UploadedDateUtc"" timestamp with time zone NOT NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_InstallationDocuments"" PRIMARY KEY (""Id"")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'FK_InstallationDocuments_Installations_InstallationId'
  ) THEN
    ALTER TABLE ""InstallationDocuments""
      ADD CONSTRAINT ""FK_InstallationDocuments_Installations_InstallationId""
      FOREIGN KEY (""InstallationId"")
      REFERENCES ""Installations"" (""Id"")
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ""IX_InstallationDocuments_InstallationId"" ON ""InstallationDocuments"" (""InstallationId"");

CREATE TABLE IF NOT EXISTS ""EmployeeMealPlans"" (
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

CREATE INDEX IF NOT EXISTS ""IX_EmployeeMealPlans_EmployeeId_PlannedDate"" ON ""EmployeeMealPlans"" (""EmployeeId"", ""PlannedDate"");
CREATE INDEX IF NOT EXISTS ""IX_EmployeeMealPlans_PaidPaymentId"" ON ""EmployeeMealPlans"" (""PaidPaymentId"");

CREATE TABLE IF NOT EXISTS ""EmployeeCheckIns"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""EmployeeId"" integer NOT NULL,
  ""CheckInTime"" timestamp with time zone NOT NULL,
  ""CheckOutTime"" timestamp with time zone NULL,
  ""Latitude"" numeric(9,6) NOT NULL DEFAULT 0.0,
  ""Longitude"" numeric(9,6) NOT NULL DEFAULT 0.0,
  ""CheckOutLatitude"" numeric(9,6) NOT NULL DEFAULT 0.0,
  ""CheckOutLongitude"" numeric(9,6) NOT NULL DEFAULT 0.0,
  ""City"" character varying(120) NULL,
  ""District"" character varying(120) NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_EmployeeCheckIns"" PRIMARY KEY (""Id"")
);

ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutTime"" timestamp with time zone NULL;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutLatitude"" numeric(9,6) NOT NULL DEFAULT 0.0;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutLongitude"" numeric(9,6) NOT NULL DEFAULT 0.0;

CREATE INDEX IF NOT EXISTS ""IX_EmployeeCheckIns_EmployeeId_CheckInTime"" ON ""EmployeeCheckIns"" (""EmployeeId"", ""CheckInTime"");

CREATE TABLE IF NOT EXISTS ""ReverseGeocodeCaches"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""RoundedLatitude"" numeric(9,2) NOT NULL,
  ""RoundedLongitude"" numeric(9,2) NOT NULL,
  ""City"" character varying(120) NULL,
  ""District"" character varying(120) NULL,
  ""LastFetchedUtc"" timestamp with time zone NOT NULL,
  CONSTRAINT ""PK_ReverseGeocodeCaches"" PRIMARY KEY (""Id"")
);

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_ReverseGeocodeCaches_RoundedLatitude_RoundedLongitude"" ON ""ReverseGeocodeCaches"" (""RoundedLatitude"", ""RoundedLongitude"");

CREATE TABLE IF NOT EXISTS ""EmployeeLeaves"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""EmployeeId"" integer NOT NULL,
  ""LeaveStartTime"" timestamp with time zone NOT NULL,
  ""ReturnTime"" timestamp with time zone NOT NULL,
  ""Description"" character varying(2000) NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_EmployeeLeaves"" PRIMARY KEY (""Id"")
);

CREATE INDEX IF NOT EXISTS ""IX_EmployeeLeaves_EmployeeId_LeaveStartTime"" ON ""EmployeeLeaves"" (""EmployeeId"", ""LeaveStartTime"");

-- HİZMET CARİLERİNİN GÖLGE TEDARİKÇİ KAYITLARI TEMİZLENİR (2026-08-20, kullanıcı kararı).
--
-- `770-01-…` bir GİDER kalemidir (elektrik, kırtasiye, vergi dairesi); ondan mal alınmaz.
-- Yeni kayıt artık hiç açılmıyor (AppDbContext.SyncShadowSuppliersAsync), bu satır ise daha
-- önce açılmış olanları siler — aksi halde Tedarikçiler listesindeki gürültü kendiliğinden
-- kalkmazdı.
--
-- BAĞLI KAYDI OLANA DOKUNULMAZ: birisi 770 kodlu bir tedarikçiyi gerçekten kullanmışsa
-- (ürün, alış faturası, borç senedi/çeki, tedarikçi ekstresi) o satır yerinde bırakılır.
-- Hem veri kaybını hem de FK RESTRICT yüzünden açılışın patlamasını önler.
DELETE FROM ""Suppliers"" s
 WHERE s.""SupplierCode"" LIKE '770-%'
   AND NOT EXISTS (SELECT 1 FROM ""Products"" p WHERE p.""SupplierId"" = s.""Id"")
   AND NOT EXISTS (SELECT 1 FROM ""PayableChecks"" c WHERE c.""SupplierId"" = s.""Id"")
   AND NOT EXISTS (SELECT 1 FROM ""PayableNotes"" n WHERE n.""SupplierId"" = s.""Id"")
   AND NOT EXISTS (SELECT 1 FROM ""PurchaseInvoices"" i WHERE i.""SupplierCode"" = s.""SupplierCode"")
   AND NOT EXISTS (SELECT 1 FROM ""SupplierLedgerEntries"" l WHERE l.""SupplierCode"" = s.""SupplierCode"");
";
                preCmd.ExecuteNonQuery();
            }
            catch
            {
                // ignore
            }

            // E-ticaret ödeme kaydı AYRI çalıştırılıyor, yukarıdaki toplu partinin içinde değil.
            // O parti tek bir komut: içindeki herhangi bir ifade patlarsa geri kalanı hiç
            // çalışmaz ve hata yutuluyor. Para ile ilgili bu tablonun, alakasız bir eski
            // ifadenin başarısızlığı yüzünden sessizce eksik kalmaması gerekiyor — bu yüzden
            // kendi komutu var ve hatası log'a yazılıyor.
            try
            {
                using var ecomCmd = conn.CreateCommand();
                ecomCmd.CommandText = EcommerceSchema.EcommerceOrderPaymentsDdl;
                ecomCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] EcommerceOrderPayments hazırlanamadı ({tenantDbName}): {ex.Message}");
            }

            // Krediler de aynı sebeple AYRI komut: aşağıdaki toplu parti tek bir ifadede
            // patlarsa geri kalanı hiç çalışmaz. Para tutan tabloların, alakasız eski bir
            // ifadenin hatası yüzünden sessizce eksik kalmaması gerekiyor.
            try
            {
                using var loanCmd = conn.CreateCommand();
                loanCmd.CommandText = LoanSchema.LoansDdl;
                loanCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] Kredi tabloları hazırlanamadı ({tenantDbName}): {ex.Message}");
            }

            // Garanti değişim — aynı sebeple AYRI komut. İçinde sayfa + rol yetkisi seed'i de
            // var; toplu partiye konsaydı alakasız eski bir ifadenin hatası üç sayfayı birden
            // görünmez yapardı.
            try
            {
                using var warrantyCmd = conn.CreateCommand();
                warrantyCmd.CommandText = WarrantyExchangeSchema.WarrantyExchangeDdl;
                warrantyCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] Garanti değişim tabloları hazırlanamadı ({tenantDbName}): {ex.Message}");
            }

            // Fatura Takip — aynı sebeple AYRI komut (sayfa + rol yetkisi seed'i içinde).
            try
            {
                using var invoiceTrackingCmd = conn.CreateCommand();
                invoiceTrackingCmd.CommandText = InvoiceTrackingSchema.InvoiceTrackingDdl;
                invoiceTrackingCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] Fatura takip tabloları hazırlanamadı ({tenantDbName}): {ex.Message}");
            }

            // Silme Ayarları 24 saat düğmeleri — aynı sebeple AYRI komut.
            try
            {
                using var deleteRuleCmd = conn.CreateCommand();
                deleteRuleCmd.CommandText = DeleteRuleSchema.DeleteRuleDdl;
                deleteRuleCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] Silme ayarları sayfaları hazırlanamadı ({tenantDbName}): {ex.Message}");
            }

            // Sonradan eklenen sayfa yetkileri — aynı sebeple AYRI komut.
            try
            {
                using var offerPagesCmd = conn.CreateCommand();
                offerPagesCmd.CommandText = AddedPagesSchema.AddedPagesDdl;
                offerPagesCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] Sonradan eklenen sayfalar hazırlanamadı ({tenantDbName}): {ex.Message}");
            }

            // Banka masrafları — aynı sebeple AYRI komut. Masraf türü kolonu bu komutta
            // ekleniyor; toplu partide patlarsa masraf ekranı bütün firmalarda boş açılır.
            try
            {
                using var bankExpenseCmd = conn.CreateCommand();
                bankExpenseCmd.CommandText = BankExpenseSchema.BankExpenseDdl;
                bankExpenseCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] Banka masraf şeması hazırlanamadı ({tenantDbName}): {ex.Message}");
            }


            // KULLANICI HAREKETLERİ — kolon + bozuk metin onarımı (AYRI KOMUT).
            //
            // 1) `CorrelationId`: aynı kullanıcı işleminden doğan bütün satırların ortak
            //    kimliği. Tek bir fatura silme hem faturayı hem cariyi hem kasayı
            //    ilgilendirdiğinde ekranda üç ayrı işlem gibi görünüyordu.
            //
            // 2) Bozuk Türkçe: iki metin kaynak dosyada ÇİFT KODLANMIŞ hâlde duruyordu
            //    ("oluÅŸturuldu"), yani ekrandaki bozukluk tarayıcının değil verinin
            //    kendisiydi. Kaynak düzeltildi ama YAZILMIŞ kayıtlar bozuk kalır — bu onarım
            //    onlar için. Koşul sayesinde ikinci çalıştırma etkisiz.
            //
            // Ayrı komut, çünkü yukarıdaki toplu parti tek ifade: içindeki alakasız eski bir
            // satır patlarsa bu onarım hiç çalışmazdı.
            try
            {
                using var activityCmd = conn.CreateCommand();
                activityCmd.CommandText = @"
ALTER TABLE ""UserActivityLogs"" ADD COLUMN IF NOT EXISTS ""CorrelationId"" uuid NULL;
CREATE INDEX IF NOT EXISTS ""IX_UserActivityLogs_CorrelationId"" ON ""UserActivityLogs"" (""CorrelationId"");

UPDATE ""UserActivityLogs""
SET ""ActionType"" = 'Oluşturma'
WHERE ""ActionType"" = 'OluÅŸturma';

UPDATE ""UserActivityLogs""
SET ""Description"" = replace(""Description"", 'oluÅŸturuldu', 'oluşturuldu')
WHERE ""Description"" LIKE '%oluÅŸturuldu%';

UPDATE ""UserActivityLogs""
SET ""Description"" = replace(""Description"", 'AdÄ±:', 'Adı:')
WHERE ""Description"" LIKE '%AdÄ±:%';


-- İKİ SÖZLÜK TEK SÖZLÜĞE. Elle yazan uçlar 'invoice'/'users' ve 'Create'/'Update'/'Delete'
-- yazıyordu; merkezî kayıt 'fatura'/'ayarlar' ve Türkçe. Ekranda modül sekmesiyle süzülünce
-- kayıtların yarısı kayboluyordu. Kaynak tek kapıda düzeltildi, YAZILMIŞ satırlar burada.
UPDATE ""UserActivityLogs"" SET ""ModuleKey"" = 'fatura'   WHERE ""ModuleKey"" = 'invoice';
UPDATE ""UserActivityLogs"" SET ""ModuleKey"" = 'ayarlar'  WHERE ""ModuleKey"" IN ('users', 'settings');
UPDATE ""UserActivityLogs"" SET ""ModuleKey"" = 'kasa'     WHERE ""ModuleKey"" = 'cash';
UPDATE ""UserActivityLogs"" SET ""ModuleKey"" = 'banka'    WHERE ""ModuleKey"" = 'bank';
UPDATE ""UserActivityLogs"" SET ""ModuleKey"" = 'cekSenet' WHERE ""ModuleKey"" = 'check';

UPDATE ""UserActivityLogs"" SET ""ActionType"" = 'Oluşturma'  WHERE ""ActionType"" IN ('Create', 'Created', 'Add');
UPDATE ""UserActivityLogs"" SET ""ActionType"" = 'Güncelleme' WHERE ""ActionType"" IN ('Update', 'Updated', 'Edit');
UPDATE ""UserActivityLogs"" SET ""ActionType"" = 'Silme'      WHERE ""ActionType"" IN ('Delete', 'Deleted', 'Remove');
UPDATE ""UserActivityLogs"" SET ""ActionType"" = 'Aktarma'    WHERE ""ActionType"" = 'Transfer';
";
                activityCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] Kullanici hareketleri semasi hazirlanamadi ({tenantDbName}): {ex.Message}");
            }

            // TELEFON KOLONU GENISLETME (2026-08-20) — AYRI KOMUT.
            //
            // Yurt disi numaralari icin bicim uzadi: `0555 555 5555 555`. `Users."Gsm"` 20
            // karakterdi ve en uzun hali TAM 20 ediyordu — sifir payli. Digerleri zaten 30+.
            // Genisletme kayipsiz ve tekrari zararsiz.
            try
            {
                using var phoneCmd = conn.CreateCommand();
                phoneCmd.CommandText = @"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Users'
      AND column_name = 'Gsm' AND COALESCE(character_maximum_length, 0) < 30
  ) THEN
    ALTER TABLE ""Users"" ALTER COLUMN ""Gsm"" TYPE character varying(30);
  END IF;
END $$;";
                phoneCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] Telefon kolonu genisletilemedi ({tenantDbName}): {ex.Message}");
            }

            // HIZMET PARA BIRIMI (2026-08-20) — AYRI KOMUT.
            //
            // `ServiceCatalogItems` tablosunu migration kuruyor ve o migration bu kolonu
            // BILMIYOR; yeni acilan kiracida tablo kolonsuz doguyordu. Burasi her kiracı
            // veritabani cozumlendiginde calisir, o yuzden yeni kiracı da kolonu aliyor.
            // Tekrari zararsiz.
            try
            {
                using var serviceCurrencyCmd = conn.CreateCommand();
                serviceCurrencyCmd.CommandText = @"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ServiceCatalogItems'
  ) THEN
    ALTER TABLE ""ServiceCatalogItems"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;
  END IF;
END $$;";
                serviceCurrencyCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] Hizmet para birimi kolonu eklenemedi ({tenantDbName}): {ex.Message}");
            }

            // PARANIN ISLENDIGI CARI DOVIZ HESABI (2026-08-20) — AYRI KOMUT.
            //
            // Kasa/bankada "hangi cari hesabina yazilacagi" ekrandan secilir (varsayilan TL).
            // Yalniz HEDEF DAMGASI; tutar cevrilmez. 0 = belirtilmemis (eski satirlar).
            try
            {
                using var targetAccCmd = conn.CreateCommand();
                targetAccCmd.CommandText = @"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND lower(table_name) = 'customerledgerentries'
  ) THEN
    ALTER TABLE ""CustomerLedgerEntries""
      ADD COLUMN IF NOT EXISTS ""TargetAccountCurrencyTypeId"" integer NOT NULL DEFAULT 0;
  END IF;
END $$;";
                targetAccCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] Cari hedef hesap kolonu eklenemedi ({tenantDbName}): {ex.Message}");
            }

            // MAAS KURUS TASIR (denetim md. A6) — AYRI KOMUT.
            //
            // Kolon `integer`di: 2.500,50 maas 2.500'e yuvarlaniyordu. Varlik artik `decimal`,
            // yani kolon `numeric` degilse her personel yazimi tip hatasiyla duser. Yukaridaki
            // toplu parti TEK ifade: icindeki alakasiz eski bir satir patlarsa geri kalani hic
            // calismaz ve hata yutulur — para tutan bu donusum ona emanet edilemez.
            //
            // `Employees` tablosu ERP ile IK servisi arasinda ORTAK. Donusum hangisi once
            // acilirsa orada olur; `data_type <> 'numeric'` kosulu ikinci calistirmayi
            // etkisiz kilar, integer'dan numeric'e donusum kayipsizdir.
            try
            {
                using var salaryCmd = conn.CreateCommand();
                salaryCmd.CommandText = @"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Employees'
      AND column_name = 'Salary'
      AND data_type <> 'numeric'
  ) THEN
    ALTER TABLE ""Employees"" ALTER COLUMN ""Salary"" TYPE numeric(18,2);
    ALTER TABLE ""Employees"" ALTER COLUMN ""Salary"" SET DEFAULT 0;
  END IF;
END $$;";
                salaryCmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Tenant] Maas kolonu numeric'e cevrilemedi ({tenantDbName}): {ex.Message}");
            }

            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""FirmaCode"" character varying(50);

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

UPDATE ""Pages""
SET ""DisplayName"" = 'Cari Müşteri Teklifi'
WHERE ""ModuleKey""='invoice' AND ""Key""='cariTeklifleri';

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r, p.""Id"", TRUE
FROM unnest(ARRAY[6,9,8,12,3,10,2]) AS r
CROSS JOIN (
  SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key"" IN ('cariTeklifleri','cariTeklifleriDuzenle','cariTeklifleriSil','cariTeklifleriProformaAktar','cariTeklifleriBasim')
) AS p
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

ALTER TABLE ""BankAccountDefinitions"" ADD COLUMN IF NOT EXISTS ""Budget"" numeric(18,2) NOT NULL DEFAULT 0.0;

CREATE TABLE IF NOT EXISTS ""BankAccountTransactions"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""BankAccountDefinitionId"" integer NOT NULL,
  ""Date"" timestamp with time zone NOT NULL,
  ""Direction"" integer NOT NULL,
  ""Amount"" numeric(18,2) NOT NULL,
  ""CurrencyTypeId"" integer NOT NULL DEFAULT 0,
  ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1.0,
  ""CurrencyAmount"" numeric(18,2) NOT NULL DEFAULT 0.0,
  ""CounterpartyType"" integer NOT NULL,
  ""CounterpartyCode"" character varying(50) NOT NULL,
  ""CounterpartyName"" character varying(255) NOT NULL,
  ""DocumentNo"" character varying(30) NULL,
  ""MaturityDate"" timestamp with time zone NULL,
  ""Description"" character varying(2000) NULL,
  ""IsPosFee"" boolean NOT NULL DEFAULT FALSE,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_BankAccountTransactions"" PRIMARY KEY (""Id""),
  CONSTRAINT ""FK_BankAccountTransactions_BankAccountDefinitions_BankAccountDefinitionId"" FOREIGN KEY (""BankAccountDefinitionId"") REFERENCES ""BankAccountDefinitions"" (""Id"") ON DELETE RESTRICT
);

ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""CurrencyTypeId"" integer NOT NULL DEFAULT 0;

ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""DocumentNo"" character varying(30) NULL;
ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""MaturityDate"" timestamp with time zone NULL;

CREATE INDEX IF NOT EXISTS ""IX_BankAccountTransactions_BankAccountDefinitionId_Date"" ON ""BankAccountTransactions"" (""BankAccountDefinitionId"", ""Date"");

CREATE TABLE IF NOT EXISTS ""CustomerLedgerEntries"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""CustomerCode"" character varying(50) NOT NULL,
  ""Date"" timestamp with time zone NOT NULL,
  ""DueDate"" timestamp with time zone NULL,
  ""Direction"" integer NOT NULL,
  ""Amount"" numeric(18,2) NOT NULL,
  ""CurrencyTypeId"" integer NOT NULL,
  ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1.0,
  ""CurrencyAmount"" numeric(18,2) NOT NULL DEFAULT 0.0,
  ""DocumentNo"" character varying(30) NULL,
  ""Description"" character varying(2000) NULL,
  ""TransactionType"" character varying(120) NULL,
  ""DeliveryCustomerCode"" character varying(50) NULL,
  ""ReferenceType"" integer NOT NULL,
  ""ReferenceId"" integer NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_CustomerLedgerEntries"" PRIMARY KEY (""Id""),
  CONSTRAINT ""FK_CustomerLedgerEntries_Customers_CustomerCode"" FOREIGN KEY (""CustomerCode"") REFERENCES ""Customers"" (""CustomerCode"") ON DELETE RESTRICT
);

ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""DueDate"" timestamp with time zone NULL;
ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1.0;
ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""CurrencyAmount"" numeric(18,2) NOT NULL DEFAULT 0.0;
ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""TransactionType"" character varying(120) NULL;
ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""DeliveryCustomerCode"" character varying(50) NULL;
ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""AccountingPeriodId"" integer NULL;
ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""IsOpeningBalance"" boolean NOT NULL DEFAULT false;
ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""SourcePeriodId"" integer NULL;
ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""IsCancelled"" boolean NOT NULL DEFAULT false;
ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""ReversalTransactionId"" integer NULL;

CREATE TABLE IF NOT EXISTS ""AccountingPeriods"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""Code"" character varying(20) NOT NULL,
  ""Name"" character varying(100) NOT NULL,
  ""FiscalYear"" integer NOT NULL,
  ""StartDate"" timestamp with time zone NOT NULL,
  ""EndDate"" timestamp with time zone NOT NULL,
  ""Status"" integer NOT NULL DEFAULT 2,
  ""IsActive"" boolean NOT NULL DEFAULT true,
  ""IsClosed"" boolean NOT NULL DEFAULT false,
  ""ClosedAt"" timestamp with time zone NULL,
  ""ClosedByUserId"" character varying(100) NULL,
  ""ReopenedAt"" timestamp with time zone NULL,
  ""ReopenedByUserId"" character varying(100) NULL,
  ""RowVersion"" bytea NULL,
  ""CreateUser"" character varying(50) NOT NULL DEFAULT '',
  ""CreateTime"" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_AccountingPeriods"" PRIMARY KEY (""Id"")
);

ALTER TABLE ""AccountingPeriods"" ADD COLUMN IF NOT EXISTS ""RowVersion"" bytea NULL;

CREATE INDEX IF NOT EXISTS ""IX_CustomerLedgerEntries_CustomerCode_Date"" ON ""CustomerLedgerEntries"" (""CustomerCode"", ""Date"");
CREATE INDEX IF NOT EXISTS ""IX_CustomerLedgerEntries_CustomerCode_Period_Date"" ON ""CustomerLedgerEntries"" (""CustomerCode"", ""AccountingPeriodId"", ""Date"");
CREATE INDEX IF NOT EXISTS ""IX_CustomerLedgerEntries_CustomerCode_IsOpeningBalance"" ON ""CustomerLedgerEntries"" (""CustomerCode"", ""IsOpeningBalance"");
CREATE INDEX IF NOT EXISTS ""IX_CustomerLedgerEntries_CustomerCode_Currency_Period"" ON ""CustomerLedgerEntries"" (""CustomerCode"", ""CurrencyTypeId"", ""AccountingPeriodId"");
CREATE INDEX IF NOT EXISTS ""IX_AccountingPeriods_Code"" ON ""AccountingPeriods"" (""Code"");

CREATE TABLE IF NOT EXISTS ""CustomerChecks"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""ABordroNo"" character varying(15) NOT NULL DEFAULT '',
  ""VBordroNo"" character varying(15) NULL,
  ""DocumentNo"" character varying(30) NOT NULL,
  ""CustomerCode"" character varying(50) NOT NULL,
  ""IssueDate"" timestamp with time zone NOT NULL,
  ""DueDate"" timestamp with time zone NOT NULL,
  ""Amount"" numeric(18,2) NOT NULL,
  ""CurrencyTypeId"" integer NOT NULL,
  ""EndorsementType"" integer NOT NULL DEFAULT 1,
  ""BankName"" character varying(120) NULL,
  ""BranchName"" character varying(120) NULL,
  ""DistrictName"" character varying(120) NULL,
  ""CheckNo"" character varying(50) NULL,
  ""OriginalDebtorName"" character varying(255) NULL,
  ""OriginalIdentityNo"" character varying(30) NULL,
  ""OriginalTaxNo"" character varying(30) NULL,
  ""PaymentStatus"" integer NOT NULL DEFAULT 1,
  ""Status"" integer NOT NULL,
  ""CurrentBankAccountDefinitionId"" integer NULL,
  ""CurrentCustomerCode"" character varying(50) NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_CustomerChecks"" PRIMARY KEY (""Id""),
  CONSTRAINT ""FK_CustomerChecks_Customers_CustomerCode"" FOREIGN KEY (""CustomerCode"") REFERENCES ""Customers"" (""CustomerCode"") ON DELETE RESTRICT,
  CONSTRAINT ""FK_CustomerChecks_Customers_CurrentCustomerCode"" FOREIGN KEY (""CurrentCustomerCode"") REFERENCES ""Customers"" (""CustomerCode"") ON DELETE RESTRICT,
  CONSTRAINT ""FK_CustomerChecks_BankAccountDefinitions_CurrentBankAccountDefinitionId"" FOREIGN KEY (""CurrentBankAccountDefinitionId"") REFERENCES ""BankAccountDefinitions"" (""Id"") ON DELETE RESTRICT
);

ALTER TABLE ""CustomerChecks"" ADD COLUMN IF NOT EXISTS ""ABordroNo"" character varying(15) NOT NULL DEFAULT '';
ALTER TABLE ""CustomerChecks"" ADD COLUMN IF NOT EXISTS ""VBordroNo"" character varying(15) NULL;
ALTER TABLE ""CustomerChecks"" ADD COLUMN IF NOT EXISTS ""EndorsementType"" integer NOT NULL DEFAULT 1;
ALTER TABLE ""CustomerChecks"" ADD COLUMN IF NOT EXISTS ""DistrictName"" character varying(120) NULL;
ALTER TABLE ""CustomerChecks"" ADD COLUMN IF NOT EXISTS ""OriginalDebtorName"" character varying(255) NULL;
ALTER TABLE ""CustomerChecks"" ADD COLUMN IF NOT EXISTS ""OriginalIdentityNo"" character varying(30) NULL;
ALTER TABLE ""CustomerChecks"" ADD COLUMN IF NOT EXISTS ""OriginalTaxNo"" character varying(30) NULL;
ALTER TABLE ""CustomerChecks"" ADD COLUMN IF NOT EXISTS ""PaymentStatus"" integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_CustomerChecks_DocumentNo"" ON ""CustomerChecks"" (""DocumentNo"");
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_CustomerChecks_ABordroNo"" ON ""CustomerChecks"" (""ABordroNo"");
DROP INDEX IF EXISTS ""IX_CustomerChecks_VBordroNo"";
CREATE INDEX IF NOT EXISTS ""IX_CustomerChecks_VBordroNo"" ON ""CustomerChecks"" (""VBordroNo"");
CREATE INDEX IF NOT EXISTS ""IX_CustomerChecks_CustomerCode_DueDate"" ON ""CustomerChecks"" (""CustomerCode"", ""DueDate"");

CREATE TABLE IF NOT EXISTS ""PayableChecks"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""DocumentNo"" character varying(30) NOT NULL,
  ""CustomerCode"" character varying(50) NULL,
  ""SupplierId"" integer NULL,
  ""IssueDate"" timestamp with time zone NOT NULL,
  ""DueDate"" timestamp with time zone NOT NULL,
  ""Amount"" numeric(18,2) NOT NULL,
  ""CurrencyTypeId"" integer NOT NULL,
  ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1.0,
  ""CurrencyAmount"" numeric(18,2) NOT NULL DEFAULT 0.0,
  ""BankName"" character varying(120) NULL,
  ""BranchName"" character varying(120) NULL,
  ""CheckNo"" character varying(50) NULL,
  ""Status"" integer NOT NULL,
  ""BankAccountDefinitionId"" integer NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_PayableChecks"" PRIMARY KEY (""Id""),
  CONSTRAINT ""FK_PayableChecks_Suppliers_SupplierId"" FOREIGN KEY (""SupplierId"") REFERENCES ""Suppliers"" (""Id"") ON DELETE RESTRICT,
  CONSTRAINT ""FK_PayableChecks_BankAccountDefinitions_BankAccountDefinitionId"" FOREIGN KEY (""BankAccountDefinitionId"") REFERENCES ""BankAccountDefinitions"" (""Id"") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_PayableChecks_DocumentNo"" ON ""PayableChecks"" (""DocumentNo"");
CREATE INDEX IF NOT EXISTS ""IX_PayableChecks_CustomerCode"" ON ""PayableChecks"" (""CustomerCode"");
CREATE INDEX IF NOT EXISTS ""IX_PayableChecks_SupplierId"" ON ""PayableChecks"" (""SupplierId"");
CREATE INDEX IF NOT EXISTS ""IX_PayableChecks_BankAccountDefinitionId"" ON ""PayableChecks"" (""BankAccountDefinitionId"");

CREATE TABLE IF NOT EXISTS ""PayableNotes"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""ScNo"" character varying(20) NOT NULL DEFAULT '',
  ""DocumentNo"" character varying(30) NOT NULL,
  ""CustomerCode"" character varying(50) NULL,
  ""SupplierId"" integer NULL,
  ""IssueDate"" timestamp with time zone NOT NULL,
  ""DueDate"" timestamp with time zone NOT NULL,
  ""Amount"" numeric(18,2) NOT NULL,
  ""CurrencyTypeId"" integer NOT NULL,
  ""NoteNo"" character varying(50) NULL,
  ""Status"" integer NOT NULL,
  ""BankAccountDefinitionId"" integer NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_PayableNotes"" PRIMARY KEY (""Id""),
  CONSTRAINT ""FK_PayableNotes_Suppliers_SupplierId"" FOREIGN KEY (""SupplierId"") REFERENCES ""Suppliers"" (""Id"") ON DELETE RESTRICT,
  CONSTRAINT ""FK_PayableNotes_BankAccountDefinitions_BankAccountDefinitionId"" FOREIGN KEY (""BankAccountDefinitionId"") REFERENCES ""BankAccountDefinitions"" (""Id"") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_PayableNotes_DocumentNo"" ON ""PayableNotes"" (""DocumentNo"");
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_PayableNotes_ScNo"" ON ""PayableNotes"" (""ScNo"");
CREATE INDEX IF NOT EXISTS ""IX_PayableNotes_CustomerCode"" ON ""PayableNotes"" (""CustomerCode"");
CREATE INDEX IF NOT EXISTS ""IX_PayableNotes_SupplierId"" ON ""PayableNotes"" (""SupplierId"");
CREATE INDEX IF NOT EXISTS ""IX_PayableNotes_BankAccountDefinitionId"" ON ""PayableNotes"" (""BankAccountDefinitionId"");

ALTER TABLE ""PayableChecks"" ADD COLUMN IF NOT EXISTS ""CustomerCode"" character varying(50) NULL;
ALTER TABLE ""PayableChecks"" ADD COLUMN IF NOT EXISTS ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1.0;
ALTER TABLE ""PayableChecks"" ADD COLUMN IF NOT EXISTS ""CurrencyAmount"" numeric(18,2) NOT NULL DEFAULT 0.0;

ALTER TABLE ""PayableNotes"" ADD COLUMN IF NOT EXISTS ""CustomerCode"" character varying(50) NULL;
ALTER TABLE ""PayableNotes"" ADD COLUMN IF NOT EXISTS ""CurrencyRate"" numeric(18,6) NOT NULL DEFAULT 1.0;
ALTER TABLE ""PayableNotes"" ADD COLUMN IF NOT EXISTS ""CurrencyAmount"" numeric(18,2) NOT NULL DEFAULT 0.0;

ALTER TABLE ""PayableNotes"" ADD COLUMN IF NOT EXISTS ""ScNo"" character varying(20) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_PayableNotes_ScNo"" ON ""PayableNotes"" (""ScNo"");

CREATE TABLE IF NOT EXISTS ""CheckOperations"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""DocumentType"" integer NOT NULL,
  ""DocumentId"" integer NOT NULL,
  ""Date"" timestamp with time zone NOT NULL,
  ""Type"" integer NOT NULL,
  ""Amount"" numeric(18,2) NOT NULL,
  ""CurrencyTypeId"" integer NOT NULL,
  ""BankAccountDefinitionId"" integer NULL,
  ""TargetCustomerCode"" character varying(50) NULL,
  ""Description"" character varying(2000) NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_CheckOperations"" PRIMARY KEY (""Id""),
  CONSTRAINT ""FK_CheckOperations_BankAccountDefinitions_BankAccountDefinitionId"" FOREIGN KEY (""BankAccountDefinitionId"") REFERENCES ""BankAccountDefinitions"" (""Id"") ON DELETE RESTRICT,
  CONSTRAINT ""FK_CheckOperations_Customers_TargetCustomerCode"" FOREIGN KEY (""TargetCustomerCode"") REFERENCES ""Customers"" (""CustomerCode"") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ""IX_CheckOperations_BankAccountDefinitionId"" ON ""CheckOperations"" (""BankAccountDefinitionId"");
CREATE INDEX IF NOT EXISTS ""IX_CheckOperations_TargetCustomerCode"" ON ""CheckOperations"" (""TargetCustomerCode"");
CREATE INDEX IF NOT EXISTS ""IX_CheckOperations_DocumentType_DocumentId_Date"" ON ""CheckOperations"" (""DocumentType"", ""DocumentId"", ""Date"");

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 20001, 'Banka Havale/EFT', TRUE, 'bankaHavaleEft', 'bank', 1
WHERE NOT EXISTS (
  SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='bank' AND ""Key""='bankaHavaleEft'
);

UPDATE ""Pages""
SET ""DisplayName""='Banka Havale/EFT', ""Key""='bankaHavaleEft', ""ModuleKey""='bank', ""SortOrder""=1, ""IsActive""=TRUE
WHERE ""ModuleKey""='bank' AND ""Key""='havaleEft'
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='bank' AND ""Key""='bankaHavaleEft');

UPDATE ""Pages"" SET ""IsActive""=FALSE
WHERE ""ModuleKey""='bank' AND ""Key"" IN ('havaleEft','bankaHesaplari','bankaMaasBordrosu');

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", TRUE
FROM ""Roles"" r
CROSS JOIN (
  SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='bank' AND ""Key""='bankaHavaleEft'
) p
WHERE r.""Id"" IN (1,2,3,6,8,9,10,12)
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

CREATE TABLE IF NOT EXISTS ""Employees"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""EmployeeCode"" character varying(20) NOT NULL DEFAULT '',
  ""FirstName"" character varying(100) NOT NULL,
  ""LastName"" character varying(100) NOT NULL,
  ""Mail"" character varying(200) NOT NULL,
  ""Tc"" character varying(20) NOT NULL,
  ""Phone"" character varying(30) NOT NULL,
  ""TaxNo"" character varying(30) NOT NULL,
  ""TaxOffice"" character varying(100) NOT NULL,
  ""Salary"" numeric(18,2) NOT NULL DEFAULT 0,
  ""SalaryDay"" integer NOT NULL DEFAULT 1,
  ""IsActive"" boolean NOT NULL DEFAULT TRUE,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_Employees"" PRIMARY KEY (""Id"")
);

ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""EmployeeCode"" character varying(20) NOT NULL DEFAULT '';
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Salary"" numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""SalaryDay"" integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_Tc"" ON ""Employees"" (""Tc"");
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_EmployeeCode"" ON ""Employees"" (""EmployeeCode"");

CREATE TABLE IF NOT EXISTS ""BayiMuhtelifCustomers"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""OwnerCustomerCode"" character varying(50) NULL,
  ""CustomerCode"" character varying(50) NOT NULL,
  ""Name"" character varying(255) NOT NULL,
  ""City"" character varying(100) NULL,
  ""District"" character varying(100) NULL,
  ""Address"" character varying(500) NULL,
  ""Phone"" character varying(50) NULL,
  ""Email"" character varying(255) NULL,
  ""TaxOffice"" character varying(100) NULL,
  ""TaxNumber"" character varying(50) NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_BayiMuhtelifCustomers"" PRIMARY KEY (""Id"")
);

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_BayiMuhtelifCustomers_CustomerCode"" ON ""BayiMuhtelifCustomers"" (""CustomerCode"");
CREATE INDEX IF NOT EXISTS ""IX_BayiMuhtelifCustomers_OwnerCustomerCode"" ON ""BayiMuhtelifCustomers"" (""OwnerCustomerCode"");

CREATE TABLE IF NOT EXISTS ""CariOffers"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""DocumentNo"" character varying(15) NOT NULL,
  ""ProformaDocumentNo"" character varying(15) NULL,
  ""Date"" timestamp with time zone NOT NULL,
  ""CustomerCode"" character varying(50) NULL,
  ""BayiMuhtelifCustomerId"" integer NULL,
  ""VatExempt"" boolean NOT NULL,
  ""Subtotal"" numeric(18,2) NOT NULL,
  ""DiscountTotal"" numeric(18,2) NOT NULL,
  ""NetTotal"" numeric(18,2) NOT NULL,
  ""VatTotal"" numeric(18,2) NOT NULL,
  ""GrandTotal"" numeric(18,2) NOT NULL,
  ""InvoiceId"" integer NULL,
  ""InvoiceNo"" character varying(15) NULL,
  ""SalesmanCode"" character varying(50) NULL,
  ""Description"" character varying(2000) NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_CariOffers"" PRIMARY KEY (""Id"")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'FK_CariOffers_BayiMuhtelifCustomers_BayiMuhtelifCustomerId'
  ) THEN
    ALTER TABLE ""CariOffers""
      ADD CONSTRAINT ""FK_CariOffers_BayiMuhtelifCustomers_BayiMuhtelifCustomerId""
      FOREIGN KEY (""BayiMuhtelifCustomerId"")
      REFERENCES ""BayiMuhtelifCustomers"" (""Id"")
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_CariOffers_DocumentNo"" ON ""CariOffers"" (""DocumentNo"");
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_CariOffers_ProformaDocumentNo"" ON ""CariOffers"" (""ProformaDocumentNo"");
CREATE INDEX IF NOT EXISTS ""IX_CariOffers_BayiMuhtelifCustomerId"" ON ""CariOffers"" (""BayiMuhtelifCustomerId"");

CREATE TABLE IF NOT EXISTS ""CariOfferLines"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""CariOfferId"" integer NOT NULL,
  ""ProductId"" uuid NOT NULL,
  ""StockCode"" character varying(50) NOT NULL,
  ""Description"" character varying(2000) NULL,
  ""Quantity"" numeric(18,3) NOT NULL,
  ""UnitPrice"" numeric(18,4) NOT NULL,
  ""VatRate"" numeric(18,2) NOT NULL,
  ""DiscountType"" integer NOT NULL,
  ""DiscountValue"" numeric(18,2) NOT NULL,
  ""LineNo"" integer NOT NULL,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_CariOfferLines"" PRIMARY KEY (""Id"")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'FK_CariOfferLines_CariOffers_CariOfferId'
  ) THEN
    ALTER TABLE ""CariOfferLines""
      ADD CONSTRAINT ""FK_CariOfferLines_CariOffers_CariOfferId""
      FOREIGN KEY (""CariOfferId"")
      REFERENCES ""CariOffers"" (""Id"")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'FK_CariOfferLines_Products_ProductId'
  ) THEN
    ALTER TABLE ""CariOfferLines""
      ADD CONSTRAINT ""FK_CariOfferLines_Products_ProductId""
      FOREIGN KEY (""ProductId"")
      REFERENCES ""Products"" (""Id"")
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_CariOfferLines_CariOfferId_LineNo"" ON ""CariOfferLines"" (""CariOfferId"", ""LineNo"");
CREATE INDEX IF NOT EXISTS ""IX_CariOfferLines_ProductId"" ON ""CariOfferLines"" (""ProductId"");

CREATE TABLE IF NOT EXISTS ""EmployeeLocationSettings"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""Latitude"" numeric(18,9) NOT NULL,
  ""Longitude"" numeric(18,9) NOT NULL,
  ""MaxDistanceInMeters"" double precision NOT NULL,
  ""IsActive"" boolean NOT NULL DEFAULT TRUE,
  ""CreateUser"" character varying(50) NOT NULL,
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(50) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_EmployeeLocationSettings"" PRIMARY KEY (""Id"")
);
" + PosAccountSchema.Sql;
            cmd.ExecuteNonQuery();
        }
        catch
        {
            // ignore
        }

        return csb.ConnectionString;
    }

    /// <summary>
    /// The tenant the current request belongs to, or null when the request carries no tenant
    /// identity at all. Public because callers that hand a URL to an external system have to
    /// embed this code in it: a bank posting a 3D callback back to us presents neither the
    /// header nor the token, so unless the tenant travels inside the URL it cannot be
    /// recovered and <see cref="Resolve"/> silently falls back to the default database.
    ///
    /// FİRMA İZOLASYONU. Bu metot <see cref="Resolve"/> üzerinden AppDbContext'in HANGİ
    /// VERİTABANINA bağlanacağını belirler, dolayısıyla sistemdeki en kritik yetki kararıdır.
    ///
    /// Eskiden X-Tenant-Code başlığı koşulsuz kazanıyordu ve token'daki TenantId claim'i ancak
    /// başlık yokken okunuyordu. Başlığın oturumla uyuşup uyuşmadığı hiçbir yerde
    /// doğrulanmıyordu; JWT de tüm firmalarda AYNI anahtarla imzalandığı için A firmasının
    /// token'ı B firmasının isteğinde de geçerliydi. Sonuç: bir kullanıcı tek bir başlığı
    /// değiştirerek başka firmanın verisine geçebiliyordu. Sayfa yetkisi de aynı başlığın
    /// seçtiği veritabanından okunduğu için (PageAuthorizationFilter) kapı da onunla açılıyordu;
    /// süper admin claim'i taşıyan bir oturum ise DB'ye hiç sorulmadan her firmada süper admindi.
    ///
    /// Kural artık şu: OTURUM BİR FİRMAYA BAĞLIYSA O FİRMA GEÇERLİDİR, başlık onu ezemez.
    ///
    /// Başlığın hâlâ tek başına belirleyici olduğu durumlar bilinçli ve hepsi token'sız ya da
    /// firmasız oturumlar — yani bu kuralın kapsamı dışındalar:
    ///   - Giriş / token takası: henüz oturum yok, firma gövdeden başlığa bağlanıyor.
    ///   - [InternalApiKey] sunucu-sunucu çağrıları (mağaza, ServiceOps): kullanıcı token'ı yok.
    ///   - Bankanın 3D callback'i: VirtualPosCallbackTenantMiddleware firmayı URL'den yazıyor.
    ///   - Süper süper admin (ssa): token'ında TenantId claim'i YOKTUR, firmalar arası geçiş
    ///     zaten tasarımın parçası ve çalışmaya devam eder.
    ///
    /// Uyuşmazlıkta istek REDDEDİLMİYOR, token'daki firma kullanılıp uyarı log'a yazılıyor.
    /// Bilerek: reddetmek, gözden kaçmış meşru bir akışı sahada kırardı. Log'da bir süre
    /// uyuşmazlık görünmezse bu dal 403'e çevrilebilir.
    /// </summary>
    public string? GetCurrentTenantCode()
    {
        var ctx = _httpContextAccessor.HttpContext;
        if (ctx is null) return null;

        string? headerCode = null;
        if (ctx.Request.Headers.TryGetValue("X-Tenant-Code", out var codeValues))
        {
            var code = codeValues.ToString().Trim();
            if (!string.IsNullOrWhiteSpace(code)) headerCode = code;
        }

        var sessionCode = ResolveSessionTenantCode(ctx);

        // Oturum bir firmaya bağlı değil (anonim, servis anahtarı, banka callback'i, ssa):
        // başlık tek kaynak, eski davranış aynen sürüyor.
        if (string.IsNullOrWhiteSpace(sessionCode)) return headerCode;

        if (string.IsNullOrWhiteSpace(headerCode)) return sessionCode;

        if (string.Equals(headerCode, sessionCode, StringComparison.OrdinalIgnoreCase))
            return sessionCode;

        Console.WriteLine(
            $"[TENANT_MISMATCH] Oturum '{sessionCode}' firmasına ait ama istek 'X-Tenant-Code: {headerCode}' gönderdi. " +
            $"Oturumun firması kullanıldı. Yol: {ctx.Request.Method} {ctx.Request.Path}");

        return sessionCode;
    }

    /// <summary>
    /// Oturumun bağlı olduğu firma kodu — TenantId claim'inden. Kod eşlemesi süreç boyunca
    /// önbelleklenir: bu metot artık HER istekte çağrılıyor, her seferinde master veritabanına
    /// gitmek gereksiz bir tur olurdu.
    /// </summary>
    private string? ResolveSessionTenantCode(Microsoft.AspNetCore.Http.HttpContext ctx)
    {
        var tenantIdStr = ctx.User?.FindFirst("TenantId")?.Value;
        if (!int.TryParse(tenantIdStr, out var tenantId) || tenantId <= 0) return null;

        if (_tenantCodesById.TryGetValue(tenantId, out var cached))
            return string.IsNullOrWhiteSpace(cached) ? null : cached;

        var tenantCode = _masterDbContext.Tenants
            .AsNoTracking()
            .Where(x => x.Id == tenantId)
            .Select(x => x.Code)
            .FirstOrDefault();

        // Bulunamayan id de önbelleğe yazılıyor (boş string olarak), yoksa geçersiz bir claim
        // her istekte master'a bir sorgu attırırdı.
        _tenantCodesById[tenantId] = tenantCode ?? string.Empty;

        return string.IsNullOrWhiteSpace(tenantCode) ? null : tenantCode;
    }
}
