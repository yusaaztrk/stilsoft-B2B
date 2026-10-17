using System.Collections.Concurrent;
using System.Security.Claims;
using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Data.Services;

/// <summary>
/// Firma (tenant) veritabanını çözer.
///
/// <para>ÖNEMLİ — 2026-08-18: Bu servis eskiden <c>b2b_employee_tenant_{KOD}</c> adında AYRI bir
/// veritabanına bağlanıyordu. Ana ERP ise <c>Tenants.DbName</c> (varsayılan
/// <c>b2b_erp_tenant_{KOD}</c>) kullanıyor. İki ayrı veritabanı olduğu için:
/// QR ile atılan mesai kayıtları portalın puantaj sekmesinde görünmüyor, buradan kaydedilen
/// konum ayarı QR geofence'ini etkilemiyor, buradan eklenen personel ERP'de çıkmıyor ve
/// yetki tabloları (<c>Pages</c>/<c>RolePagePermissions</c>) boş kaldığı için SSA dışında
/// herkes 403 alıyordu ("Konum ayarları yüklenemedi" hatasının kaynağı).
/// Artık tek veritabanı kullanılıyor; personel, mesai, ödeme ve yetki tek yerde.</para>
/// </summary>
public sealed class TenantConnectionStringResolver
{
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IConfiguration _configuration;
    private readonly MasterDbContext _masterDbContext;

    private static readonly ConcurrentDictionary<string, bool> EnsuredDatabases = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, string> TenantDbNames = new(StringComparer.OrdinalIgnoreCase);

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

        var tenantCode = GetTenantCodeFromRequest();
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            if (_httpContextAccessor.HttpContext != null)
            {
                throw new InvalidOperationException("Firma kodu çözümlenemedi. Lütfen giriş yapın.");
            }
            return defaultConn;
        }

        tenantCode = tenantCode.Trim().ToUpperInvariant();

        if (!TenantDbNames.TryGetValue(tenantCode, out var tenantDbName))
        {
            var code = tenantCode;
            tenantDbName = _masterDbContext.Tenants
                .AsNoTracking()
                .Where(x => x.Code.ToUpper() == code)
                .Select(x => x.DbName)
                .FirstOrDefault();

            if (string.IsNullOrWhiteSpace(tenantDbName))
            {
                tenantDbName = $"b2b_erp_tenant_{tenantCode}";
            }

            TenantDbNames[tenantCode] = tenantDbName;
        }

        var csb = new NpgsqlConnectionStringBuilder(defaultConn)
        {
            Database = tenantDbName
        };

        EnsureSchema(csb.ConnectionString, tenantDbName);

        return csb.ConnectionString;
    }

    /// <summary>
    /// Şema uyumlama. Tablolar ana ERP tarafından da yönetildiği için burada YALNIZCA
    /// bu servisin sahiplendiği İK tabloları ve kolonları oluşturulur; hepsi
    /// <c>IF NOT EXISTS</c> olduğu için var olan kurulumlara dokunmaz.
    ///
    /// <para>Eski sürümde yalnızca <c>CREATE TABLE IF NOT EXISTS</c> vardı ve DDL entity'lerle
    /// uyuşmuyordu (<c>EmployeePayments.Type</c>, <c>EmployeeBonusPlans.PlannedDate</c>,
    /// <c>NumberSeries.Key</c> kolonları eksikti). Mevcut veritabanlarına yeni kolon eklemenin
    /// hiçbir yolu yoktu. Ana API'deki yaklaşımın aynısı uygulanıyor:
    /// ALTER ... ADD COLUMN IF NOT EXISTS.</para>
    /// </summary>
    private static void EnsureSchema(string tenantConn, string tenantDbName)
    {
        if (EnsuredDatabases.ContainsKey(tenantDbName))
            return;

        lock (EnsuredDatabases)
        {
            if (EnsuredDatabases.ContainsKey(tenantDbName))
                return;

            try
            {
                using var conn = new NpgsqlConnection(tenantConn);
                conn.Open();

                // Komutlar TEK TEK calistirilir.
                //
                // Hepsi tek bir CommandText olarak gonderilirse PostgreSQL bunlari ortuk bir
                // islemde calistirir: tek bir ifade patlarsa (ornegin mevcut veride mukerrer
                var cleanSql = string.Join("\n", SchemaSql
                    .Split('\n')
                    .Select(line => line.TrimStart().StartsWith("--") ? "" : line));

                var statements = cleanSql
                    .Split(';', StringSplitOptions.RemoveEmptyEntries)
                    .Select(x => x.Trim())
                    .Where(x => x.Length > 0)
                    .ToList();


                foreach (var statement in statements)
                {
                    try
                    {
                        using var cmd = conn.CreateCommand();
                        cmd.CommandText = statement;
                        cmd.ExecuteNonQuery();
                    }
                    catch (Exception ex)
                    {
                        var head = statement.Length > 90 ? statement[..90] : statement;
                        Console.WriteLine($"[Employee DB Auto-Heal] Atlandi ({tenantDbName}): {head.ReplaceLineEndings(" ")} -> {ex.Message}");
                    }
                }

                EnsuredDatabases.TryAdd(tenantDbName, true);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Employee DB Auto-Heal] Şema güncellenemedi ({tenantDbName}): {ex.Message}");
            }
        }
    }

    private const string SchemaSql = @"
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
    ""IsActive"" boolean NOT NULL DEFAULT TRUE,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeePayments"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""PaymentDate"" timestamp with time zone NOT NULL,
    ""Amount"" numeric(18,2) NOT NULL DEFAULT 0,
    ""Description"" character varying(2000) NULL,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeeBonusPlans"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""Amount"" numeric(18,2) NOT NULL DEFAULT 0,
    ""Description"" character varying(2000) NULL,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeeMealPlans"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""Amount"" numeric(18,2) NOT NULL DEFAULT 0,
    ""Description"" character varying(2000) NULL,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeeCheckIns"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""CheckInTime"" timestamp with time zone NOT NULL,
    ""Latitude"" numeric(9,6) NOT NULL DEFAULT 0.0,
    ""Longitude"" numeric(9,6) NOT NULL DEFAULT 0.0,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeeLeaves"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""LeaveStartTime"" timestamp with time zone NOT NULL,
    ""ReturnTime"" timestamp with time zone NOT NULL,
    ""Description"" character varying(2000) NULL,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeeLocationSettings"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""Latitude"" numeric(18,9) NOT NULL DEFAULT 0,
    ""Longitude"" numeric(18,9) NOT NULL DEFAULT 0,
    ""MaxDistanceInMeters"" double precision NOT NULL DEFAULT 100,
    ""IsActive"" boolean NOT NULL DEFAULT FALSE,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""ReverseGeocodeCaches"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""RoundedLatitude"" numeric(9,2) NOT NULL,
    ""RoundedLongitude"" numeric(9,2) NOT NULL,
    ""City"" character varying(120) NULL,
    ""District"" character varying(120) NULL,
    ""LastFetchedUtc"" timestamp with time zone NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_ReverseGeocodeCaches_RoundedLatitude_RoundedLongitude""
    ON ""ReverseGeocodeCaches"" (""RoundedLatitude"", ""RoundedLongitude"");

CREATE TABLE IF NOT EXISTS ""WorkScheduleSettings"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""Name"" character varying(100) NOT NULL DEFAULT 'Varsayılan Mesai',
    ""MondayMinutes"" integer NOT NULL DEFAULT 540,
    ""TuesdayMinutes"" integer NOT NULL DEFAULT 540,
    ""WednesdayMinutes"" integer NOT NULL DEFAULT 540,
    ""ThursdayMinutes"" integer NOT NULL DEFAULT 540,
    ""FridayMinutes"" integer NOT NULL DEFAULT 540,
    ""SaturdayMinutes"" integer NOT NULL DEFAULT 0,
    ""SundayMinutes"" integer NOT NULL DEFAULT 0,
    ""BreakMinutes"" integer NOT NULL DEFAULT 60,
    ""StartTimeMinutes"" integer NOT NULL DEFAULT 540,
    ""LateToleranceMinutes"" integer NOT NULL DEFAULT 15,
    ""OvertimeMultiplier"" numeric(5,2) NOT NULL DEFAULT 1.50,
    ""CountHolidaysAsWorkDay"" boolean NOT NULL DEFAULT FALSE,
    ""IsDefault"" boolean NOT NULL DEFAULT FALSE,
    ""IsActive"" boolean NOT NULL DEFAULT TRUE,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""WorkShiftBlocks"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""WorkScheduleSettingId"" integer NOT NULL,
    ""DayOfWeek"" integer NOT NULL,
    ""StartMinute"" integer NOT NULL DEFAULT 0,
    ""EndMinute"" integer NOT NULL DEFAULT 0,
    ""PayMultiplier"" numeric(5,2) NOT NULL DEFAULT 1.00,
    ""Label"" character varying(80) NULL,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);
CREATE INDEX IF NOT EXISTS ""IX_WorkShiftBlocks_Schedule_Day_Start""
    ON ""WorkShiftBlocks"" (""WorkScheduleSettingId"", ""DayOfWeek"", ""StartMinute"");

CREATE TABLE IF NOT EXISTS ""Holidays"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""Date"" date NOT NULL,
    ""Name"" character varying(150) NOT NULL DEFAULT '',
    ""IsHalfDay"" boolean NOT NULL DEFAULT FALSE,
    ""IsRecurringYearly"" boolean NOT NULL DEFAULT FALSE,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Holidays_Date"" ON ""Holidays"" (""Date"");

ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""BankName"" character varying(120) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Iban"" character varying(34) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Username"" character varying(100) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Password"" character varying(100) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""HireDate"" timestamp with time zone NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkPermitDay"" timestamp with time zone NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkPermitRenewalFee"" numeric(18,2) NOT NULL DEFAULT 0.0;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Salary"" numeric(18,2) NOT NULL DEFAULT 0;

-- MAAS KURUS TASIR (denetim md. A6): eskiden acilmis veritabaninda kolon `integer` kaldi.
-- Varlik artik `decimal`, kolon numeric degilse her personel yazimi tip hatasiyla duser.
-- Tablo ERP ile ORTAK; donusum hangi servis once acilirsa orada olur, integer -> numeric
-- kayipsiz ve tekrari zararsiz. DO blogu KULLANILAMAZ: bu metin `;` ile bolunup tek tek
-- calistiriliyor, blogun icindeki noktali virguller cumleyi ortadan ikiye bolerdi.
ALTER TABLE ""Employees"" ALTER COLUMN ""Salary"" TYPE numeric(18,2);
ALTER TABLE ""Employees"" ALTER COLUMN ""Salary"" SET DEFAULT 0;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""SalaryDay"" integer NOT NULL DEFAULT 1;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""MealAmount"" numeric(18,2) NOT NULL DEFAULT 0.0;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkType"" character varying(80) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""TerminationDate"" timestamp with time zone NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""TerminationReason"" character varying(200) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkScheduleSettingId"" integer NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""AnnualLeaveOverrideDays"" integer NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""PassportNo"" character varying(30) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Nationality"" character varying(60) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""BirthDate"" timestamp with time zone NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""BirthPlace"" character varying(120) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""ProvidentFundNo"" character varying(40) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""SocialSecurityNo"" character varying(40) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""SsdNo"" character varying(40) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Address"" character varying(500) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""AddressDetail"" character varying(200) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkPermitStartDate"" timestamp with time zone NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Workplace"" character varying(120) NULL;

ALTER TABLE ""Employees"" ALTER COLUMN ""FirstName"" DROP NOT NULL;
ALTER TABLE ""Employees"" ALTER COLUMN ""LastName"" DROP NOT NULL;
ALTER TABLE ""Employees"" ALTER COLUMN ""Mail"" DROP NOT NULL;
ALTER TABLE ""Employees"" ALTER COLUMN ""Tc"" DROP NOT NULL;
ALTER TABLE ""Employees"" ALTER COLUMN ""Phone"" DROP NOT NULL;
ALTER TABLE ""Employees"" ALTER COLUMN ""TaxNo"" DROP NOT NULL;
ALTER TABLE ""Employees"" ALTER COLUMN ""TaxOffice"" DROP NOT NULL;
ALTER TABLE ""Employees"" ALTER COLUMN ""Salary"" DROP NOT NULL;
ALTER TABLE ""Employees"" ALTER COLUMN ""SalaryDay"" DROP NOT NULL;
ALTER TABLE ""Employees"" ALTER COLUMN ""MealAmount"" DROP NOT NULL;
ALTER TABLE ""Employees"" ALTER COLUMN ""WorkPermitRenewalFee"" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_Tc"" ON ""Employees"" (""Tc"");
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_EmployeeCode"" ON ""Employees"" (""EmployeeCode"");

ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""Type"" integer NOT NULL DEFAULT 1;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""DeductFromSalary"" boolean NOT NULL DEFAULT FALSE;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""SalaryDeductedAt"" timestamp with time zone NULL;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""BankAccountDefinitionId"" integer NULL;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""CashAccountId"" integer NULL;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""SalaryPeriod"" character varying(7) NULL;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""MovementCurrencyTypeId"" integer NULL;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""MovementCurrencyRate"" numeric(18,6) NULL;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""MovementCurrencyAmount"" numeric(18,2) NULL;
CREATE INDEX IF NOT EXISTS ""IX_EmployeePayments_EmployeeId_PaymentDate""
    ON ""EmployeePayments"" (""EmployeeId"", ""PaymentDate"");

ALTER TABLE ""EmployeeBonusPlans"" ADD COLUMN IF NOT EXISTS ""PlannedDate"" timestamp with time zone NOT NULL DEFAULT NOW();
ALTER TABLE ""EmployeeBonusPlans"" ADD COLUMN IF NOT EXISTS ""Status"" integer NOT NULL DEFAULT 1;
ALTER TABLE ""EmployeeBonusPlans"" ADD COLUMN IF NOT EXISTS ""PaidPaymentId"" integer NULL;
ALTER TABLE ""EmployeeBonusPlans"" ADD COLUMN IF NOT EXISTS ""BankAccountDefinitionId"" integer NULL;
ALTER TABLE ""EmployeeBonusPlans"" ADD COLUMN IF NOT EXISTS ""CashAccountId"" integer NULL;

ALTER TABLE ""EmployeeMealPlans"" ADD COLUMN IF NOT EXISTS ""PlannedDate"" timestamp with time zone NOT NULL DEFAULT NOW();
ALTER TABLE ""EmployeeMealPlans"" ADD COLUMN IF NOT EXISTS ""Status"" integer NOT NULL DEFAULT 1;
ALTER TABLE ""EmployeeMealPlans"" ADD COLUMN IF NOT EXISTS ""PaidPaymentId"" integer NULL;

ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutTime"" timestamp with time zone NULL;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutLatitude"" numeric(9,6) NOT NULL DEFAULT 0.0;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutLongitude"" numeric(9,6) NOT NULL DEFAULT 0.0;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""City"" character varying(120) NULL;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""District"" character varying(120) NULL;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutCity"" character varying(120) NULL;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutDistrict"" character varying(120) NULL;
-- Konum dışı çıkış + sahte konum tespiti (2026-10-16).
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutOffsite"" boolean NOT NULL DEFAULT FALSE;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutAuto"" boolean NOT NULL DEFAULT FALSE;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckInAccuracy"" double precision NULL;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutAccuracy"" double precision NULL;
CREATE TABLE IF NOT EXISTS ""EmployeeAttendanceSuspicions"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""CheckInId"" integer NULL,
    ""EventKind"" character varying(10) NOT NULL,
    ""RuleCode"" character varying(40) NOT NULL,
    ""Detail"" character varying(500) NOT NULL,
    ""Source"" character varying(20) NOT NULL,
    ""Latitude"" numeric(9,6) NOT NULL DEFAULT 0,
    ""Longitude"" numeric(9,6) NOT NULL DEFAULT 0,
    ""Accuracy"" double precision NULL,
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""ReviewedBy"" character varying(50) NULL,
    ""ReviewedAt"" timestamp with time zone NULL,
    ""ReviewNote"" character varying(500) NULL
);
CREATE INDEX IF NOT EXISTS ""IX_EmployeeAttendanceSuspicions_EmployeeId_CreateTime""
    ON ""EmployeeAttendanceSuspicions"" (""EmployeeId"", ""CreateTime"");
CREATE INDEX IF NOT EXISTS ""IX_EmployeeAttendanceSuspicions_CreateTime""
    ON ""EmployeeAttendanceSuspicions"" (""CreateTime"");
-- Personel fotoğrafı (2026-10-16): ayrı tablo, Employees ERP ile ortak ve her listede okunuyor.
CREATE TABLE IF NOT EXISTS ""EmployeePhotos"" (
    ""EmployeeId"" integer PRIMARY KEY,
    ""Data"" bytea NOT NULL,
    ""ContentType"" character varying(50) NOT NULL DEFAULT 'image/jpeg',
    ""UpdatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""UpdatedBy"" character varying(50) NULL
);
CREATE INDEX IF NOT EXISTS ""IX_EmployeeCheckIns_EmployeeId_CheckInTime""
    ON ""EmployeeCheckIns"" (""EmployeeId"", ""CheckInTime"");

ALTER TABLE ""WorkScheduleSettings"" ADD COLUMN IF NOT EXISTS ""StartTimeMinutes"" integer NOT NULL DEFAULT 540;
ALTER TABLE ""WorkScheduleSettings"" ADD COLUMN IF NOT EXISTS ""EarlyLeaveToleranceMinutes"" integer NOT NULL DEFAULT 15;

ALTER TABLE ""EmployeeLeaves"" ADD COLUMN IF NOT EXISTS ""LeaveType"" integer NOT NULL DEFAULT 1;
ALTER TABLE ""EmployeeLeaves"" ADD COLUMN IF NOT EXISTS ""Status"" integer NOT NULL DEFAULT 2;
ALTER TABLE ""EmployeeLeaves"" ADD COLUMN IF NOT EXISTS ""IsPaid"" boolean NOT NULL DEFAULT TRUE;
ALTER TABLE ""EmployeeLeaves"" ADD COLUMN IF NOT EXISTS ""DayCount"" numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE ""EmployeeLeaves"" ADD COLUMN IF NOT EXISTS ""DecidedBy"" character varying(50) NULL;
ALTER TABLE ""EmployeeLeaves"" ADD COLUMN IF NOT EXISTS ""DecidedAt"" timestamp with time zone NULL;
ALTER TABLE ""EmployeeLeaves"" ADD COLUMN IF NOT EXISTS ""RejectReason"" character varying(500) NULL;
CREATE INDEX IF NOT EXISTS ""IX_EmployeeLeaves_EmployeeId_LeaveStartTime""
    ON ""EmployeeLeaves"" (""EmployeeId"", ""LeaveStartTime"");

ALTER TABLE ""EmployeeLocationSettings"" ADD COLUMN IF NOT EXISTS ""Name"" character varying(100) NOT NULL DEFAULT '';
ALTER TABLE ""EmployeeLocationSettings"" ADD COLUMN IF NOT EXISTS ""AllowOffsiteCheckOut"" boolean NOT NULL DEFAULT FALSE;
UPDATE ""EmployeeLocationSettings"" SET ""Name"" = 'Merkez' WHERE ""Name"" IS NULL OR ""Name"" = '';

-- Personelin mesai baslatabilecegi konum. NULL = aktif konumlarin herhangi biri.
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""LocationSettingId"" integer NULL;

-- Yemek verilip verilmedigi kisiye gore degisir; varsayilan VERILIR (mevcut davranis korunur).
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""HasMealAllowance"" boolean NOT NULL DEFAULT TRUE;

ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""BankAccountNo"" character varying(50) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""CustomerNo"" character varying(50) NULL;

-- Personel kasasi ERP'nin ""CashAccounts"" / ""CashAccountTransactions"" tablolarindan AYRIDIR.
-- employee-service ana ERP ile ayni tenant veritabanini kullaniyor; bir sure personel maas
-- cikislari ERP'nin gercek kasasina yaziliyordu ve bayinin kasa bakiyesi bozuluyordu.
-- Kullanici karari (2026-08-18): personel kasasi kendi tablosunda dursun, ERP kasa/banka
-- tablolarina employee-service HIC dokunmasin (ne CREATE, ne ALTER, ne INSERT).
CREATE TABLE IF NOT EXISTS ""EmployeeCashAccounts"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""Code"" character varying(50) NOT NULL DEFAULT 'PERSONEL-KASA-01',
    ""Name"" character varying(100) NOT NULL DEFAULT 'Personel Ana Kasa',
    ""CurrencyTypeId"" integer NOT NULL DEFAULT 1,
    ""IsActive"" boolean NOT NULL DEFAULT TRUE,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS ""EmployeeCashTransactions"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeCashAccountId"" integer NOT NULL,
    ""Date"" timestamp with time zone NOT NULL,
    ""Direction"" integer NOT NULL DEFAULT 2,
    ""Amount"" numeric(18,2) NOT NULL DEFAULT 0,
    ""EmployeeId"" integer NULL,
    ""PaymentId"" integer NULL,
    ""PaymentType"" integer NULL,
    ""SalaryPeriod"" character varying(10) NULL,
    ""ReferenceNo"" character varying(50) NULL,
    ""ParentTransactionId"" integer NULL,
    ""IsBulk"" boolean NOT NULL DEFAULT FALSE,
    ""CounterpartyName"" character varying(150) NULL,
    ""Description"" character varying(2000) NULL,
    ""CreateUser"" character varying(50) NOT NULL DEFAULT 'System',
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(50) NULL,
    ""EditTime"" timestamp with time zone NULL
);

CREATE INDEX IF NOT EXISTS ""IX_EmployeeCashTransactions_Account_Date""
    ON ""EmployeeCashTransactions"" (""EmployeeCashAccountId"", ""Date"");
CREATE INDEX IF NOT EXISTS ""IX_EmployeeCashTransactions_Payment""
    ON ""EmployeeCashTransactions"" (""PaymentId"");
CREATE INDEX IF NOT EXISTS ""IX_EmployeeCashTransactions_Parent""
    ON ""EmployeeCashTransactions"" (""ParentTransactionId"");

INSERT INTO ""EmployeeCashAccounts"" (""Code"", ""Name"", ""CurrencyTypeId"", ""IsActive"", ""CreateUser"", ""CreateTime"")
SELECT 'PERSONEL-KASA-01', 'Personel Ana Kasa', 1, TRUE, 'System', NOW()
WHERE NOT EXISTS (SELECT 1 FROM ""EmployeeCashAccounts"");

ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""ReferenceNo"" character varying(50) NULL;
ALTER TABLE ""EmployeeCashTransactions"" ADD COLUMN IF NOT EXISTS ""ErpAccountKind"" integer NULL;
ALTER TABLE ""EmployeeCashTransactions"" ADD COLUMN IF NOT EXISTS ""ErpAccountId"" integer NULL;
ALTER TABLE ""EmployeeCashTransactions"" ADD COLUMN IF NOT EXISTS ""ErpAccountName"" character varying(200) NULL;
ALTER TABLE ""EmployeeCashTransactions"" ADD COLUMN IF NOT EXISTS ""ErpTransactionId"" integer NULL;
ALTER TABLE ""EmployeeCashTransactions"" ADD COLUMN IF NOT EXISTS ""ErpCurrencyTypeId"" integer NULL;
ALTER TABLE ""EmployeeCashTransactions"" ADD COLUMN IF NOT EXISTS ""ErpRate"" numeric(18,6) NULL;
ALTER TABLE ""EmployeeCashTransactions"" ADD COLUMN IF NOT EXISTS ""ErpCurrencyAmount"" numeric(18,2) NULL;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""ParentPaymentId"" integer NULL;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""IsCancelled"" boolean NOT NULL DEFAULT FALSE;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""CancelledAt"" timestamp with time zone NULL;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""CancelledBy"" character varying(100) NULL;
ALTER TABLE ""EmployeePayments"" ADD COLUMN IF NOT EXISTS ""CancellationReason"" character varying(500) NULL;

CREATE TABLE IF NOT EXISTS ""EmployeeAccrualSnapshots"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""Period"" character varying(10) NOT NULL,
    ""LastCalculatedDate"" character varying(15) NOT NULL,
    ""LastCalculatedAt"" timestamp with time zone NOT NULL,
    ""MonthlySalary"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""DailyWage"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""GrossAccrual"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""MealAccrual"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""AttendedDays"" integer NOT NULL DEFAULT 0,
    ""WorkedMinutes"" integer NOT NULL DEFAULT 0,
    ""MissingMinutes"" integer NOT NULL DEFAULT 0,
    ""OvertimeMinutes"" integer NOT NULL DEFAULT 0,
    ""AbsenceDeduction"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""OvertimePay"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""ShiftPremium"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""DeductibleAdvances"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""AlreadyPaid"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""NetPayable"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""IsLive"" boolean NOT NULL DEFAULT FALSE,
    ""CreateUser"" character varying(100) NULL,
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(100) NULL,
    ""EditTime"" timestamp with time zone NULL
);
CREATE INDEX IF NOT EXISTS ""IX_EmployeeAccrualSnapshots_Emp_Period"" ON ""EmployeeAccrualSnapshots"" (""EmployeeId"", ""Period"");

CREATE TABLE IF NOT EXISTS ""EmployeeMonthlyOverrides"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""Period"" character varying(10) NOT NULL,
    ""OverrideType"" integer NOT NULL,
    ""OriginalAmount"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""OverrideAmount"" numeric(18,2) NOT NULL DEFAULT 0.0,
    ""Description"" character varying(500) NULL,
    ""CreateUser"" character varying(100) NULL,
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(100) NULL,
    ""EditTime"" timestamp with time zone NULL
);
CREATE INDEX IF NOT EXISTS ""IX_EmployeeMonthlyOverrides_Emp_Period"" ON ""EmployeeMonthlyOverrides"" (""EmployeeId"", ""Period"", ""OverrideType"");

CREATE TABLE IF NOT EXISTS ""EmployeeSalaryAccruals"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""Period"" character varying(10) NOT NULL,
    ""Amount"" numeric(18,2) NOT NULL DEFAULT 0,
    ""CalculatedAmount"" numeric(18,2) NOT NULL DEFAULT 0,
    ""DeductedAdvances"" numeric(18,2) NOT NULL DEFAULT 0,
    ""Description"" character varying(500) NULL,
    ""ReferenceNo"" character varying(50) NULL,
    ""CreateUser"" character varying(100) NULL,
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(100) NULL,
    ""EditTime"" timestamp with time zone NULL
);

-- Donem basina personel basina TEK hakedis: ayni ay ikinci kez tanimlanirsa tutar guncellenir,
-- ikinci bir alacak satiri dogmaz.
CREATE UNIQUE INDEX IF NOT EXISTS ""UX_EmployeeSalaryAccruals_Emp_Period""
    ON ""EmployeeSalaryAccruals"" (""EmployeeId"", ""Period"");

CREATE TABLE IF NOT EXISTS ""EmployeeDailyAccrualOverrides"" (
    ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    ""EmployeeId"" integer NOT NULL,
    ""Date"" character varying(15) NOT NULL,
    ""Kind"" integer NOT NULL DEFAULT 1,
    ""OverrideMinutes"" integer NULL,
    ""OverrideAmount"" numeric(18,2) NULL,
    ""Description"" character varying(500) NULL,
    ""CreateUser"" character varying(100) NULL,
    ""CreateTime"" timestamp with time zone NOT NULL DEFAULT NOW(),
    ""EditUser"" character varying(100) NULL,
    ""EditTime"" timestamp with time zone NULL
);

-- Gun + personel + tur basina TEK duzeltme; ayni gun yeniden duzeltilirse uzerine yazilir.
CREATE UNIQUE INDEX IF NOT EXISTS ""UX_EmployeeDailyAccrualOverrides_Emp_Date_Kind""
    ON ""EmployeeDailyAccrualOverrides"" (""EmployeeId"", ""Date"", ""Kind"");

-- (ERP'nin ""BankAccountDefinitions"" tablosuna tohum kayit YAZILMAZ - bayinin banka tanimi bizim isimiz degil.)

INSERT INTO ""WorkScheduleSettings"" (""Name"", ""MondayMinutes"", ""TuesdayMinutes"", ""WednesdayMinutes"", ""ThursdayMinutes"", ""FridayMinutes"", ""SaturdayMinutes"", ""SundayMinutes"", ""BreakMinutes"", ""StartTimeMinutes"", ""LateToleranceMinutes"", ""OvertimeMultiplier"", ""CountHolidaysAsWorkDay"", ""IsDefault"", ""IsActive"", ""CreateUser"", ""CreateTime"")
SELECT 'Varsayılan Mesai', 600, 600, 600, 600, 600, 420, 0, 60, 480, 15, 1.50, FALSE, TRUE, TRUE, 'System', NOW()
WHERE NOT EXISTS (SELECT 1 FROM ""WorkScheduleSettings"");

UPDATE ""WorkScheduleSettings"" 
SET ""Name"" = 'Varsayılan Mesai',
    ""MondayMinutes"" = 600,
    ""TuesdayMinutes"" = 600,
    ""WednesdayMinutes"" = 600,
    ""ThursdayMinutes"" = 600,
    ""FridayMinutes"" = 600,
    ""SaturdayMinutes"" = 420,
    ""SundayMinutes"" = 0,
    ""StartTimeMinutes"" = 480,
    ""IsDefault"" = TRUE,
    ""IsActive"" = TRUE
WHERE ""IsDefault"" = TRUE;

DELETE FROM ""WorkShiftBlocks"" 
WHERE ""WorkScheduleSettingId"" IN (SELECT ""Id"" FROM ""WorkScheduleSettings"" WHERE ""IsDefault"" = TRUE);

INSERT INTO ""WorkShiftBlocks"" (""WorkScheduleSettingId"", ""DayOfWeek"", ""StartMinute"", ""EndMinute"", ""PayMultiplier"", ""Label"", ""CreateUser"", ""CreateTime"")
SELECT s.""Id"", d.day, 480, 1080, 1.00, 'Hafta İçi Mesai (08:00–18:00)', 'System', NOW()
FROM ""WorkScheduleSettings"" s
CROSS JOIN (VALUES (1), (2), (3), (4), (5)) AS d(day)
WHERE s.""IsDefault"" = TRUE;

INSERT INTO ""WorkShiftBlocks"" (""WorkScheduleSettingId"", ""DayOfWeek"", ""StartMinute"", ""EndMinute"", ""PayMultiplier"", ""Label"", ""CreateUser"", ""CreateTime"")
SELECT s.""Id"", 6, 480, 900, 1.00, 'Cumartesi Mesaisi (08:00–15:00)', 'System', NOW()
FROM ""WorkScheduleSettings"" s
WHERE s.""IsDefault"" = TRUE;

UPDATE ""Employees"" 
SET ""WorkScheduleSettingId"" = (SELECT ""Id"" FROM ""WorkScheduleSettings"" WHERE ""IsDefault"" = TRUE LIMIT 1)
WHERE ""WorkScheduleSettingId"" IS NULL OR ""WorkScheduleSettingId"" NOT IN (SELECT ""Id"" FROM ""WorkScheduleSettings"");

UPDATE ""Employees"" SET ""BankAccountNo"" = '601625227', ""CustomerNo"" = '176143', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MEHMET%HAYR%DEM%RC%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625228', ""CustomerNo"" = '176214', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MESUT%DEM%R%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625076', ""CustomerNo"" = '196071', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MESUT%KARAKU%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625085', ""CustomerNo"" = '196059', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%E%REF%DEM%R%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625074', ""CustomerNo"" = '196072', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%AL%Y%CETA%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625096', ""CustomerNo"" = '196025', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%JORA%ALLABER%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625079', ""CustomerNo"" = '196067', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%SEY%T%DEN%Z%AV%AR%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625094', ""CustomerNo"" = '165833', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%SHATLYK%SERDAR%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625099', ""CustomerNo"" = '196020', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%G%LER%ZEN%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625105', ""CustomerNo"" = '75526', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%S%MEY%G%LERY%Z%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601624111', ""CustomerNo"" = '155555', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%OKAY%L%MONCU%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601608392', ""CustomerNo"" = '195055', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%ESRA%A%IKSES%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625101', ""CustomerNo"" = '196019', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%ESRA%ZG%N%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625089', ""CustomerNo"" = '196045', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MEHMET%MER%A%KARO%LU%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625084', ""CustomerNo"" = '196062', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%TAR%K%DEM%R%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625098', ""CustomerNo"" = '196023', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MER%KAYNAR%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625107', ""CustomerNo"" = '84516', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MEHMET%AL%TUGAY%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625102', ""CustomerNo"" = '196016', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MELTEM%TOZMAZ%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625082', ""CustomerNo"" = '196063', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MAHMUT%ERLALE%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625093', ""CustomerNo"" = '196031', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%UMYT%BAYNAZAR%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625081', ""CustomerNo"" = '196064', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MD%EAMIN%BISWAS%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625144', ""CustomerNo"" = '195930', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MD%HAB%BUR%RHAMAN%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625111', ""CustomerNo"" = '195935', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MD%NAHID%ULLAH%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625149', ""CustomerNo"" = '195922', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MD%ROYAL%HYOSSAIN%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625146', ""CustomerNo"" = '195928', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MD%SHOHEL%RANA%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625112', ""CustomerNo"" = '195933', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%NIL%RATAN%RAZBONG%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625087', ""CustomerNo"" = '196050', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%HAN%DEM%RC%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601630911', ""CustomerNo"" = '71205', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MEHMET%SARI%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625092', ""CustomerNo"" = '196043', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MUSA%TOKTAY%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625106', ""CustomerNo"" = '196013', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%PALVAN%JORAYEV%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625108', ""CustomerNo"" = '196006', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%YUSUP%JORAYEV%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625078', ""CustomerNo"" = '196069', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%EZG%KO%ER%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601630910', ""CustomerNo"" = '196173', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%TU%BA%S%DAL%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625168', ""CustomerNo"" = '144201', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%ZEHRA%AS%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625086', ""CustomerNo"" = '181411', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%CEM%FENER%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625141', ""CustomerNo"" = '195931', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%KARIM%PARVAZ%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601625110', ""CustomerNo"" = '195941', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%MD%RUMON%HOSSAIN%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');
UPDATE ""Employees"" SET ""BankAccountNo"" = '601582695', ""CustomerNo"" = '193810', ""BankName"" = 'Near East Bank' WHERE (""FirstName"" || ' ' || ""LastName"") ILIKE '%SUBRATO%RAJBONGSHI%' AND (""BankAccountNo"" IS NULL OR ""BankAccountNo"" = '');

UPDATE ""Employees"" SET ""Salary"" = 50000, ""MealAmount"" = 7000;

";


    /// <summary>
    /// Firma kodunu belirler.
    ///
    /// <para>GÜVENLİK: Sıra kasıtlı. Token'da <c>TenantId</c> varsa istemciden gelen
    /// <c>?tenant=</c> / <c>X-Tenant-Code</c> YOK SAYILIR. Eskiden istemci değeri önce
    /// geliyordu; A firmasının kullanıcısı localStorage'daki firma kodunu değiştirerek
    /// B firmasının verisine bağlanabiliyordu (rol kimlikleri firmadan firmaya değiştiği
    /// için yetki filtresi de yanlış eşleşiyordu). Serbestlik yalnızca giriş yapmamış
    /// isteklere (login) ve süper yöneticiye tanınır.</para>
    /// </summary>
    private string? GetTenantCodeFromRequest()
    {
        var ctx = _httpContextAccessor.HttpContext;
        if (ctx is null) return null;

        // Sunucunun kendi koyduğu değer (login akışı) — güvenilir.
        if (ctx.Items.TryGetValue("TenantCode", out var obj) && obj is string itemCode && !string.IsNullOrWhiteSpace(itemCode))
        {
            return itemCode;
        }

        var isAuthenticated = ctx.User?.Identity?.IsAuthenticated == true;
        var isSsa = ctx.User?.FindFirst("IsSuperSuperAdmin")?.Value == "1";

        if (isAuthenticated && !isSsa)
        {
            var claimCode = ResolveTenantCodeFromClaims(ctx.User);
            if (!string.IsNullOrWhiteSpace(claimCode)) return claimCode;
        }

        if (ctx.Request.Query.TryGetValue("tenant", out var tenantValues))
        {
            var tenant = tenantValues.ToString();
            if (!string.IsNullOrWhiteSpace(tenant)) return tenant;
        }

        if (ctx.Request.Headers.TryGetValue("X-Tenant-Code", out var codeValues))
        {
            var code = codeValues.ToString();
            if (!string.IsNullOrWhiteSpace(code)) return code;
        }

        return isSsa ? ResolveTenantCodeFromClaims(ctx.User) : null;
    }

    private string? ResolveTenantCodeFromClaims(ClaimsPrincipal? user)
    {
        var tenantCodeClaim = user?.FindFirst("TenantCode")?.Value;
        if (!string.IsNullOrWhiteSpace(tenantCodeClaim)) return tenantCodeClaim;

        var tenantIdStr = user?.FindFirst("TenantId")?.Value;
        if (!int.TryParse(tenantIdStr, out var tenantId) || tenantId <= 0) return null;

        var tenantCode = _masterDbContext.Tenants
            .AsNoTracking()
            .Where(x => x.Id == tenantId)
            .Select(x => x.Code)
            .FirstOrDefault();

        return string.IsNullOrWhiteSpace(tenantCode) ? null : tenantCode;
    }
}
