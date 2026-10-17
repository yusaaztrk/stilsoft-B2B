using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Personel hak ediş defteri (Personel Ekstresi) ve hak edişe kur alanları.
    ///
    /// SQL elle yazıldı: firmalar ayrı veritabanlarında ve bir kısmı zincirin farklı noktalarında,
    /// bu yüzden her adım tekrar çalıştırılabilir olmalı (bkz. 20260807000000).
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260807020000_AddTechnicianLedger")]
    public partial class AddTechnicianLedger : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ""TechnicianEarnings"" (
                    ""Id"" uuid NOT NULL,
                    ""TenantCode"" character varying(64) NULL,
                    ""TechnicianId"" uuid NOT NULL,
                    ""TechnicianName"" text NOT NULL,
                    ""TechnicianCariCode"" character varying(64) NULL,
                    ""SourceType"" integer NOT NULL,
                    ""SourceId"" uuid NOT NULL,
                    ""SourceNumber"" text NULL,
                    ""CustomerName"" text NULL,
                    ""ProductName"" text NULL,
                    ""CompletedAt"" timestamp with time zone NOT NULL,
                    ""Amount"" numeric(18,2) NOT NULL,
                    ""Currency"" character varying(8) NOT NULL,
                    ""Status"" integer NOT NULL,
                    ""PostedLedgerReference"" text NULL,
                    ""Notes"" text NULL,
                    ""CreatedAt"" timestamp with time zone NOT NULL,
                    ""CreatedBy"" text NULL,
                    ""ApprovedAt"" timestamp with time zone NULL,
                    ""ApprovedBy"" text NULL,
                    ""PostedAt"" timestamp with time zone NULL,
                    ""PostedBy"" text NULL,
                    CONSTRAINT ""PK_TechnicianEarnings"" PRIMARY KEY (""Id""),
                    CONSTRAINT ""FK_TechnicianEarnings_Technicians_TechnicianId"" FOREIGN KEY (""TechnicianId"") REFERENCES ""Technicians"" (""Id"") ON DELETE RESTRICT
                );

                CREATE UNIQUE INDEX IF NOT EXISTS ""IX_TechnicianEarnings_SourceType_SourceId""
                    ON ""TechnicianEarnings"" (""SourceType"", ""SourceId"");

                CREATE INDEX IF NOT EXISTS ""IX_TechnicianEarnings_Status""
                    ON ""TechnicianEarnings"" (""Status"");

                CREATE INDEX IF NOT EXISTS ""IX_TechnicianEarnings_TechnicianId_CompletedAt""
                    ON ""TechnicianEarnings"" (""TechnicianId"", ""CompletedAt"");
            ");

            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ""TechnicianLedgerEntries"" (
                    ""Id"" uuid NOT NULL,
                    ""TenantCode"" character varying(64) NULL,
                    ""TechnicianId"" uuid NOT NULL,
                    ""EntryDate"" timestamp with time zone NOT NULL,
                    ""Description"" character varying(512) NOT NULL DEFAULT '',
                    ""ReferenceNumber"" character varying(64) NULL,
                    ""Debit"" numeric(18,2) NOT NULL DEFAULT 0,
                    ""Credit"" numeric(18,2) NOT NULL DEFAULT 0,
                    ""Currency"" character varying(8) NOT NULL DEFAULT 'TRY',
                    ""ExchangeRate"" numeric(18,6) NULL,
                    ""LocalAmount"" numeric(18,2) NULL,
                    ""ExchangeRateDate"" timestamp with time zone NULL,
                    ""EntryType"" integer NOT NULL DEFAULT 0,
                    ""SourceId"" uuid NULL,
                    ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                    ""CreatedBy"" text NULL,
                    CONSTRAINT ""PK_TechnicianLedgerEntries"" PRIMARY KEY (""Id""),
                    CONSTRAINT ""FK_TechnicianLedgerEntries_Technicians_TechnicianId""
                        FOREIGN KEY (""TechnicianId"") REFERENCES ""Technicians"" (""Id"") ON DELETE RESTRICT
                );
            ");

            // Bir hak edişten yalnızca BİR defter satırı. Onaylama işlemi yeniden denenebilir
            // olduğu için tekilliği veritabanı garanti etmeli; koşul kontrolü yarış durumunda
            // ikinci satırı engellemiyor. Elle girilen ödeme/düzeltme satırlarının SourceId'si
            // olmadığından indeks filtreli.
            migrationBuilder.Sql(@"
                CREATE UNIQUE INDEX IF NOT EXISTS ""IX_TechnicianLedgerEntries_EntryType_SourceId""
                    ON ""TechnicianLedgerEntries"" (""EntryType"", ""SourceId"") WHERE ""SourceId"" IS NOT NULL;

                CREATE INDEX IF NOT EXISTS ""IX_TechnicianLedgerEntries_TechnicianId_EntryDate""
                    ON ""TechnicianLedgerEntries"" (""TechnicianId"", ""EntryDate"");
            ");

            // Hak edişte orijinal tutar ve para birimi zaten saklanıyor; kur bilgisi TL karşılığı
            // gerektiğinde kullanılmak üzere AYRICA tutuluyor — tutar kura çevrilip ezilmiyor.
            migrationBuilder.Sql(@"
                ALTER TABLE ""TechnicianEarnings"" ADD COLUMN IF NOT EXISTS ""ExchangeRate"" numeric(18,6) NULL;
                ALTER TABLE ""TechnicianEarnings"" ADD COLUMN IF NOT EXISTS ""LocalAmount"" numeric(18,2) NULL;
                ALTER TABLE ""TechnicianEarnings"" ADD COLUMN IF NOT EXISTS ""ExchangeRateDate"" timestamp with time zone NULL;
            ");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                DROP TABLE IF EXISTS ""TechnicianLedgerEntries"";
                ALTER TABLE ""TechnicianEarnings"" DROP COLUMN IF EXISTS ""ExchangeRate"";
                ALTER TABLE ""TechnicianEarnings"" DROP COLUMN IF EXISTS ""LocalAmount"";
                ALTER TABLE ""TechnicianEarnings"" DROP COLUMN IF EXISTS ""ExchangeRateDate"";
            ");
        }
    }
}
