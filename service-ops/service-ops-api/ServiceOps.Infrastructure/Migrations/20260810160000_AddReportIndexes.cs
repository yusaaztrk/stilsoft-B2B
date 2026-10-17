using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Raporlama sorguları için indeksler. Yalnızca indeks ekler — hiçbir kolon, kısıt ya da
    /// veri değişmez, dolayısıyla operasyonel akışlar etkilenmez.
    ///
    /// Rapor uçlarının tamamı tarih aralığı + (bayi | teknisyen | ürün | durum) üzerinden
    /// grupluyor. Bu indeksler olmadan altı aylık bir aralıkta her kart tam tablo taraması
    /// yapıyor ve dashboard tek açılışta aynı taramayı defalarca tekrarlıyor.
    ///
    /// SQL ELLE YAZILDI ve IF NOT EXISTS kullanıldı: her firma ayrı veritabanı ve bir kısmı
    /// zincirin farklı noktalarında; sabit CreateIndex, indeks zaten varsa o firmayı kilitler.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260810160000_AddReportIndexes")]
    public partial class AddReportIndexes : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                -- Her rapor once tarih araligiyla daraliyor; durum/tip kolonlari INCLUDE ile
                -- tasindiginda gruplama tabloya hic donmuyor.
                CREATE INDEX IF NOT EXISTS ""IX_ServiceRecords_Report_CreatedAt""
                    ON ""ServiceRecords"" (""CreatedAt"")
                    INCLUDE (""Status"", ""Type"", ""ProductCategory"");

                CREATE INDEX IF NOT EXISTS ""IX_ServiceRecords_Report_Dealer""
                    ON ""ServiceRecords"" (""DealerCode"", ""CreatedAt"");

                CREATE INDEX IF NOT EXISTS ""IX_ServiceRecords_Report_Technician""
                    ON ""ServiceRecords"" (""AssignedTechnicianId"", ""CompletedAt"");

                CREATE INDEX IF NOT EXISTS ""IX_ServiceRecords_Report_StockCode""
                    ON ""ServiceRecords"" (""ProductStockCode"", ""CreatedAt"");

                -- Sure analizleri yalnizca tamamlanmis kayitlara bakiyor; kismi indeks tablonun
                -- geri kalanini indekslemeden bu sorgulari karsiliyor.
                CREATE INDEX IF NOT EXISTS ""IX_ServiceRecords_Report_Completed""
                    ON ""ServiceRecords"" (""CompletedAt"")
                    WHERE ""CompletedAt"" IS NOT NULL;

                CREATE INDEX IF NOT EXISTS ""IX_InstallationTasks_Report_Completed""
                    ON ""InstallationTasks"" (""CompletedAt"");

                CREATE INDEX IF NOT EXISTS ""IX_InstallationTasks_Report_Service""
                    ON ""InstallationTasks"" (""ServiceId"", ""Status"");

                CREATE INDEX IF NOT EXISTS ""IX_Activities_Report_Service""
                    ON ""Activities"" (""ServiceId"", ""CreatedAt"");

                CREATE INDEX IF NOT EXISTS ""IX_CargoTrackingTasks_Report""
                    ON ""CargoTrackingTasks"" (""Status"", ""OrderDate"");

                CREATE INDEX IF NOT EXISTS ""IX_SparePartOrderRequests_Report""
                    ON ""SparePartOrderRequests"" (""CreatedAt"", ""Status"");
            ");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                DROP INDEX IF EXISTS ""IX_ServiceRecords_Report_CreatedAt"";
                DROP INDEX IF EXISTS ""IX_ServiceRecords_Report_Dealer"";
                DROP INDEX IF EXISTS ""IX_ServiceRecords_Report_Technician"";
                DROP INDEX IF EXISTS ""IX_ServiceRecords_Report_StockCode"";
                DROP INDEX IF EXISTS ""IX_ServiceRecords_Report_Completed"";
                DROP INDEX IF EXISTS ""IX_InstallationTasks_Report_Completed"";
                DROP INDEX IF EXISTS ""IX_InstallationTasks_Report_Service"";
                DROP INDEX IF EXISTS ""IX_Activities_Report_Service"";
                DROP INDEX IF EXISTS ""IX_CargoTrackingTasks_Report"";
                DROP INDEX IF EXISTS ""IX_SparePartOrderRequests_Report"";
            ");
        }
    }
}
