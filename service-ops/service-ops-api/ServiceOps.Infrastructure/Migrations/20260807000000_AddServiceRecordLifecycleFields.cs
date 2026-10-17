using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Servis yaşam döngüsü alanları: cari kodu, ürün kategorisi (büyük/küçük), aşama bazlı
    /// teknisyen alanları ve fatura izi.
    ///
    /// SQL ELLE YAZILDI (MigrationBuilder.AddColumn yerine): bu kurulumda her firma ayrı bir
    /// veritabanı ve bir kısmı zincirin farklı noktalarında takılı kalmış durumda. Sabit AddColumn,
    /// kolon herhangi bir sebeple zaten varsa bütün migration'ı kilitliyor ve o firmayı bir daha
    /// ilerletemiyorsunuz. "IF NOT EXISTS" ile adım tekrar çalıştırılabilir kalıyor.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260807000000_AddServiceRecordLifecycleFields")]
    public partial class AddServiceRecordLifecycleFields : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""DealerCode"" text NULL;
                ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""ProductCategory"" integer NOT NULL DEFAULT 0;
                ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""WorkshopTechnicianId"" uuid NULL;
                ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""DeliveryTechnicianId"" uuid NULL;
                ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""CompletedByTechnicianId"" uuid NULL;
                ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""InvoiceReference"" text NULL;
                ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""IsInvoiced"" boolean NOT NULL DEFAULT FALSE;
            ");

            // ProductCategory'nin varsayılanı Large (0); eski atölye kayıtlarının backfill'i
            // ayrı bir adımda (20260807010000_BackfillProductCategory). Sebebi: bu adım bazı
            // firmalarda ZATEN uygulanmış olarak kayıtlı, yani buraya eklenen SQL o firmalarda
            // hiç çalışmazdı.

            // İndeks EKLENMEDİ: iki kolon da düşük kardinaliteli (2 ve 5 değer) ve model
            // snapshot'ında karşılığı olmayan her indeks bir sonraki "migrations add"te yeniden
            // üretilmeye çalışılıyor.
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""ServiceRecords"" DROP COLUMN IF EXISTS ""DealerCode"";
                ALTER TABLE ""ServiceRecords"" DROP COLUMN IF EXISTS ""ProductCategory"";
                ALTER TABLE ""ServiceRecords"" DROP COLUMN IF EXISTS ""WorkshopTechnicianId"";
                ALTER TABLE ""ServiceRecords"" DROP COLUMN IF EXISTS ""DeliveryTechnicianId"";
                ALTER TABLE ""ServiceRecords"" DROP COLUMN IF EXISTS ""CompletedByTechnicianId"";
                ALTER TABLE ""ServiceRecords"" DROP COLUMN IF EXISTS ""InvoiceReference"";
                ALTER TABLE ""ServiceRecords"" DROP COLUMN IF EXISTS ""IsInvoiced"";
            ");
        }
    }
}
