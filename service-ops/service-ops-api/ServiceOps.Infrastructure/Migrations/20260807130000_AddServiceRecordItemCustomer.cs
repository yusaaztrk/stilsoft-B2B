using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Montaj kalemine son müşteri / adres alanları ekler.
    ///
    /// Bir fatura artık tek montaj kaydına düşüyor, ama aynı faturada farklı adreslere montaj
    /// olabiliyor. Müşteri bilgisi yalnızca kayıt düzeyinde durursa ikinci kalemin adresi
    /// kaybolur ve teknisyen yanlış adrese gider. Boş bırakılan kalemlerde kaydın kendi
    /// müşteri bilgisi geçerli kalır, o yüzden geri doldurma gerekmiyor.
    ///
    /// SQL elle yazıldı: her firma ayrı veritabanı, bir kısmı zincirin farklı noktalarında.
    /// IF NOT EXISTS ile adım tekrar çalıştırılabilir kalıyor.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260807130000_AddServiceRecordItemCustomer")]
    public partial class AddServiceRecordItemCustomer : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""ServiceRecordItems"" ADD COLUMN IF NOT EXISTS ""CustomerName"" character varying(256) NULL;
                ALTER TABLE ""ServiceRecordItems"" ADD COLUMN IF NOT EXISTS ""CustomerPhone"" character varying(64) NULL;
                ALTER TABLE ""ServiceRecordItems"" ADD COLUMN IF NOT EXISTS ""CustomerAddress"" character varying(1024) NULL;
            ");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""ServiceRecordItems"" DROP COLUMN IF EXISTS ""CustomerAddress"";
                ALTER TABLE ""ServiceRecordItems"" DROP COLUMN IF EXISTS ""CustomerPhone"";
                ALTER TABLE ""ServiceRecordItems"" DROP COLUMN IF EXISTS ""CustomerName"";
            ");
        }
    }
}
