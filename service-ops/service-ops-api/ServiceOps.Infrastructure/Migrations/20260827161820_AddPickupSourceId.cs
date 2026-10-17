using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPickupSourceId : Migration
    {
        /// <inheritdoc />
        /// <summary>
        /// TEK GERÇEK YENİLİK: <c>PickupSourceId</c> (2026-08-27).
        ///
        /// EF bu göçe <c>ManualReceiptNo</c> ve <c>PreInvoiceStatus</c> kolonlarını da koydu:
        /// ikisi de varlıkta var ama hiçbir göçte yok — canlı veritabanlarına başka yoldan
        /// eklenmişler. Üretilen hâli çalıştırılsaydı "kolon zaten var" hatası verip GÖÇÜN
        /// TAMAMINI düşürürdü; `PickupSourceId` de eklenemez, üstelik açılışta
        /// `Database.Migrate()` patlardı.
        ///
        /// Bu yüzden üçü de <c>IF NOT EXISTS</c> ile yazılıyor: kolonun olduğu veritabanında
        /// sessizce geçer, olmayanda ekler. Aynı göç her iki durumda da güvenli.
        /// </summary>
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""PickupSourceId"" integer NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""ManualReceiptNo"" text NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""PreInvoiceStatus"" integer NULL;");
        }

        /// <summary>
        /// Yalnızca bu göçün GERÇEKTEN getirdiği kolon geri alınır. Diğer ikisi buradan
        /// önce de vardı; onları silmek bu göçü geri almanın yan etkisi olmamalı.
        /// </summary>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""ServiceRecords"" DROP COLUMN IF EXISTS ""PickupSourceId"";");
        }
    }
}
