using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Planlama satırına "sahaya aktarıldı" damgası ekler.
    ///
    /// Kısmi aktarım eskiden kaydı MNT-xxxxxxx-N diye bölüyordu: aktarılan satırlar yeni bir
    /// kayda taşınıyor, kalanlar orijinalde kalıyordu. Kullanıcı bu bölmeyi kaldırmak istedi
    /// (2026-08-10) — bir fatura tek kayıt kalacak, kalemler birbirinden bağımsız ilerleyecek.
    /// Bunun için aktarımın kayıtta değil SATIRDA işaretlenmesi gerekiyor.
    ///
    /// GERİ DOLDURMA ŞART. Sekme ayrımı artık bu damgadan çıkıyor; damgasız bırakılan geçmiş
    /// veri "hiç aktarılmamış" sayılır ve HÂLEN SAHADA OLAN işler Teslimattakiler sekmesinden
    /// tamamen kaybolurdu. Zaten aktarılmış olmanın geçmişteki karşılığı kaydın durumuydu
    /// (Workshop / InRepair / WaitingForParts = sahaya çıkmış), o yüzden damga oradan üretiliyor.
    /// Zaman olarak kaydın son güncellenme anı yazılıyor — aktarımın gerçek anına en yakın
    /// elimizdeki değer bu.
    ///
    /// Planlanmamış (Deferred) ve iptal satırlar dışarıda: onlar sahaya hiç çıkmadı.
    ///
    /// SQL elle yazıldı: her firma ayrı veritabanı, bir kısmı zincirin farklı noktalarında.
    /// IF NOT EXISTS ile adım tekrar çalıştırılabilir kalıyor; geri doldurma da yalnızca boş
    /// damgaları yazdığı için tekrar çalıştırılabilir.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260810120000_AddInstallationTaskTransferredAt")]
    public partial class AddInstallationTaskTransferredAt : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""InstallationTasks"" ADD COLUMN IF NOT EXISTS ""TransferredAt"" timestamp with time zone NULL;

                UPDATE ""InstallationTasks"" t
                SET ""TransferredAt"" = COALESCE(s.""UpdatedAt"", s.""CreatedAt"", NOW())
                FROM ""ServiceRecords"" s
                WHERE s.""Id"" = t.""ServiceId""
                  AND t.""TransferredAt"" IS NULL
                  AND s.""Type"" = 1
                  AND s.""Status"" IN (1, 2, 3)
                  AND t.""Status"" IN (0, 1, 2);
            ");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""InstallationTasks"" DROP COLUMN IF EXISTS ""TransferredAt"";
            ");
        }
    }
}
