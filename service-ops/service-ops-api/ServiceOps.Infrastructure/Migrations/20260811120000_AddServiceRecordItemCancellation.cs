using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Montaj kalemine iptal damgası ekler (2026-08-11).
    ///
    /// İptal bugüne kadar KAYIT seviyesindeydi: bir kalemi iptal etmek faturanın bütün
    /// kalemlerini "İptal" gösteriyordu. Artık iptal kalemin kendi damgası — kayıt ancak
    /// bütün kalemleri iptal olduğunda iptale düşer.
    ///
    /// Damga şart, "görevlerin hepsi Cancelled" yetmez: <c>EnsureDeferredTasksForItemsAsync</c>
    /// eksik adedi tamamlarken iptal satırlarını saymıyor, dolayısıyla damgasız bir kalem ilk
    /// liste yenilemesinde yeni "Yeni Kayıt" satırlarıyla geri dirilirdi.
    ///
    /// GERİ DOLDURMA: eskiden iptal edilmiş kayıtların (Status = 5) kalemleri damgalanır,
    /// yoksa o kayıtlar yeni kuralda "iptal edilmemiş" sayılıp planlamaya geri düşerdi.
    ///
    /// SQL elle yazıldı: her firma ayrı veritabanı ve bir kısmı zincirin farklı noktalarında.
    /// IF NOT EXISTS + yalnızca boş damgayı yazan UPDATE ile adım tekrar çalıştırılabilir.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260811120000_AddServiceRecordItemCancellation")]
    public partial class AddServiceRecordItemCancellation : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""ServiceRecordItems"" ADD COLUMN IF NOT EXISTS ""CancelledAt"" timestamp with time zone NULL;
                ALTER TABLE ""ServiceRecordItems"" ADD COLUMN IF NOT EXISTS ""CancelReason"" text NULL;

                UPDATE ""ServiceRecordItems"" i
                SET ""CancelledAt"" = COALESCE(s.""UpdatedAt"", s.""CreatedAt"", NOW()),
                    ""CancelReason"" = COALESCE(i.""CancelReason"", 'Kayıt iptal edildiği için kalem de iptal sayıldı.')
                FROM ""ServiceRecords"" s
                WHERE s.""Id"" = i.""ServiceId""
                  AND i.""CancelledAt"" IS NULL
                  AND s.""Status"" = 6;
            ");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""ServiceRecordItems"" DROP COLUMN IF EXISTS ""CancelledAt"";
                ALTER TABLE ""ServiceRecordItems"" DROP COLUMN IF EXISTS ""CancelReason"";
            ");
        }
    }
}
