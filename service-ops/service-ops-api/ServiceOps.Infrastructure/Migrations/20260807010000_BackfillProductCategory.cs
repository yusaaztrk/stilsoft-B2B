using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Eski kayıtlarda büyük/küçük ürün ayrımını ServiceRecords.ProductCategory kolonuna taşır.
    ///
    /// Ayrım bugüne kadar servis numarasının "AT-" önekinden okunuyordu. Kolon eklendiğinde
    /// varsayılanı Large (0) olduğu için bütün atölye kayıtları büyük ürün görünür hale geldi;
    /// liste süzgeçleri ve ekrandaki kategori etiketi bu kolondan okuyor.
    ///
    /// Kolonları ekleyen adımın (20260807000000) içine konmadı: o adım bir kısım firmada zaten
    /// uygulanmış olarak kayıtlı, dolayısıyla oraya yazılan SQL o firmalarda hiç çalışmazdı.
    ///
    /// Şema değiştirmez, yalnızca veri yazar; tekrar çalıştırılabilir.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260807010000_BackfillProductCategory")]
    public partial class BackfillProductCategory : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE ""ServiceRecords""
                   SET ""ProductCategory"" = 1
                 WHERE ""ServiceNumber"" LIKE 'AT-%'
                   AND ""ProductCategory"" <> 1;
            ");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Geri alınamaz: backfill'den önce hangi kaydın kategorisi elle değiştirilmişti
            // bilinmiyor. Kolonların kendisi 20260807000000'in Down'ında zaten düşürülüyor.
        }
    }
}
