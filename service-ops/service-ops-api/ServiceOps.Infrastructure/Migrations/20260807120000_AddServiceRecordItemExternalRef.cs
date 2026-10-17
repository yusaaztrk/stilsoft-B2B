using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Montaj kalemine dış kimlik (B2B fatura montaj kaydı) bağlar.
    ///
    /// Webhook aynı montajı iki kez gönderdiğinde kalem çoğalmasın, fatura ya da fatura kalemi
    /// silindiğinde hangi kalemin düşeceği ürün adı eşleştirmesine bakmadan bulunabilsin diye.
    /// Eskiden silme "ProblemDescription LIKE '%Fatura No: X%'" + ürün adı ile yapılıyordu;
    /// aynı üründen iki montaj olan faturada yanlış kaydı siliyordu.
    ///
    /// SQL elle yazıldı: her firma ayrı veritabanı, bir kısmı zincirin farklı noktalarında.
    /// IF NOT EXISTS ile adım tekrar çalıştırılabilir kalıyor.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260807120000_AddServiceRecordItemExternalRef")]
    public partial class AddServiceRecordItemExternalRef : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""ServiceRecordItems"" ADD COLUMN IF NOT EXISTS ""ExternalRef"" character varying(64) NULL;
                CREATE INDEX IF NOT EXISTS ""IX_ServiceRecordItems_ExternalRef""
                    ON ""ServiceRecordItems"" (""ExternalRef"");
            ");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                DROP INDEX IF EXISTS ""IX_ServiceRecordItems_ExternalRef"";
                ALTER TABLE ""ServiceRecordItems"" DROP COLUMN IF EXISTS ""ExternalRef"";
            ");
        }
    }
}
