using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// KAĞIT FİŞ NUMARASI (2026-08-23, kullanıcı isteği).
    ///
    /// Serviste ürünle birlikte basılı bir fiş dolduruluyor ve o fişin numarası sistemde
    /// hiçbir yerde tutulmuyordu. Listedeki "Fiş No" sütunu sistemin kendi sayacı
    /// (SH-0000042); elindeki kağıtla gelen müşterinin kaydını bulmanın yolu yoktu.
    ///
    /// Eski sistemden aktarılacak 834 servis kaydının fiş numarası da bu alana yazılacak.
    ///
    /// NULL = numarası girilmemiş kayıt. Tekillik dayatılmıyor: eski defterlerde tekrar eden
    /// numaralar var ve tekil indeks aktarımı durdururdu.
    ///
    /// SQL elle yazıldı ve tekrar çalıştırılabilir: firmalar zincirin farklı noktalarında.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260823210000_AddServiceRecordManualReceiptNo")]
    public partial class AddServiceRecordManualReceiptNo : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""ManualReceiptNo"" text NULL;
                CREATE INDEX IF NOT EXISTS ""IX_ServiceRecords_ManualReceiptNo"" ON ""ServiceRecords"" (""ManualReceiptNo"");
            ");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                DROP INDEX IF EXISTS ""IX_ServiceRecords_ManualReceiptNo"";
                ALTER TABLE ""ServiceRecords"" DROP COLUMN IF EXISTS ""ManualReceiptNo"";
            ");
        }
    }
}
