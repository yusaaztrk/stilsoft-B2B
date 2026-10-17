using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Kaydın FATURALANMADAN ÖNCEKİ durumunu damgalar (2026-08-13, kullanıcı kuralı).
    ///
    /// Satış faturası silindiğinde servis kaydı eski durumuna dönmeli: "sahadaysa sahada,
    /// atölyedeyse atölyede". Bugüne kadar geri alma bunu TAHMİN ediyordu — `revert-to-ready`
    /// yalnızca çağıranın gönderdiği `sourcePage` metnine bakıp "SahaAriza ise FieldPlanned,
    /// değilse Ready" diyordu. Atölyede tamamlanmış bir kayıt bu yüzden "Hazır"a düşüyor,
    /// sahadan gelen ama sayfa adı farklı yazılmış bir kayıt yanlış sekmeye gidiyordu.
    ///
    /// Tahmin edilebilir tek doğru cevap yok: aynı kayıt saha, atölye, teslimat ve montaj
    /// akışlarının herhangi birinden faturaya gidebiliyor. Bu yüzden durum tahmin edilmiyor,
    /// faturalama anında SAKLANIYOR ve geri alırken aynen yazılıyor.
    ///
    /// NULL = bu alan eklenmeden önce faturalanmış kayıt; geri alma o kayıtlarda eski tahmin
    /// yoluna düşer (davranış değişmez, kötüleşmez).
    ///
    /// SQL elle yazıldı: firmalar zincirin farklı noktalarında, adım tekrar çalıştırılabilir olmalı.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260813180000_AddServiceRecordPreInvoiceStatus")]
    public partial class AddServiceRecordPreInvoiceStatus : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""ServiceRecords"" ADD COLUMN IF NOT EXISTS ""PreInvoiceStatus"" integer NULL;
            ");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""ServiceRecords"" DROP COLUMN IF EXISTS ""PreInvoiceStatus"";
            ");
        }
    }
}
