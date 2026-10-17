using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <summary>
    /// Teknisyenin kendi cari koduna ayrı bir alan açar.
    ///
    /// Kod ile cari yetkisi aynı sütunda (Users.Carikodu) tutuluyordu ve bu iki farklı şey:
    /// biri teknisyenin kimliği, diğeri hangi carilerin kayıtlarını görebildiği. Aynı yerde
    /// durdukları için alan "TECH-2026-003,*" gibi okunamaz bir hale geliyordu ve kapsamı
    /// okuyan taraf teknisyenin kendi kodunu da bir cariymiş gibi süzmeye çalışıyordu.
    ///
    /// Carikodu bundan sonra yalnızca yetki listesi — sıradan kullanıcılarda zaten öyle.
    ///
    /// Elle yazıldı. Bu modele karşı migration üretmek, başlangıç SQL'inin sürdürdüğü şemadan
    /// uzaklaşmış snapshot yüzünden alakasız bir sürü işlem de üretiyor.
    /// </summary>
    public partial class AddUserServiceOpsCariKodu : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ServiceOpsCariKodu",
                table: "Users",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            // Mevcut teknisyenlerin kendi kodu listenin başında duruyor ("TECH-2026-003,*" ya da
            // tek başına "TEK-00001"). Baştaki parça yeni alana taşınır, geri kalanı yetki listesi
            // olarak kalır. Yalnızca teknisyen kodu taşıyan satırlara dokunulur; sıradan bir
            // kullanıcının cari listesi bu desene uymaz ve olduğu gibi bırakılır.
            migrationBuilder.Sql(@"
UPDATE ""Users""
SET ""ServiceOpsCariKodu"" = split_part(""Carikodu"", ',', 1),
    ""Carikodu"" = CASE
        -- position(',' in x) virgül yoksa 0 döner ve substring(x from 1) alanın tamamını verir,
        -- yani virgülsüz satırlar hiç temizlenmez. Virgül var mı diye ayrıca bakılıyor.
        WHEN position(',' in ""Carikodu"") > 0
            THEN NULLIF(btrim(substring(""Carikodu"" from position(',' in ""Carikodu"") + 1)), '')
        ELSE NULL
    END
WHERE ""Carikodu"" IS NOT NULL
  AND (""Carikodu"" LIKE 'TEK-%' OR ""Carikodu"" LIKE 'TECH-%');

-- Cari atanmamış teknisyende yetki listesi kendi koduna eşitlenir. BOŞ BIRAKILAMAZ: bu alan
-- B2B'nin cari kısıtlamasının da okunduğu yer ve orada boş da '*' da ""kısıtlama yok"" demektir
-- (CustomerScope.IsUnrestricted). Kendi kodu hiçbir müşteriyle eşleşmediği için teknisyen,
-- bugüne kadar olduğu gibi kısıtlı kalır.
UPDATE ""Users""
SET ""Carikodu"" = ""ServiceOpsCariKodu""
WHERE ""ServiceOpsCariKodu"" IS NOT NULL
  AND (""Carikodu"" IS NULL OR btrim(""Carikodu"") = '');
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Geri alırken kodu listenin başına iade et ki eski okuma biçimi çalışsın.
            //
            // Up, cari atanmamış teknisyende kapsamı kendi koduna eşitliyor. Bunu düz birleştirmek
            // "TEK-00001,TEK-00001" üretirdi; kapsam kodun kendisiyse yalnızca kod yazılır.
            migrationBuilder.Sql(@"
UPDATE ""Users""
SET ""Carikodu"" = CASE
        WHEN ""Carikodu"" IS NULL OR btrim(""Carikodu"") = '' OR ""Carikodu"" = ""ServiceOpsCariKodu""
            THEN ""ServiceOpsCariKodu""
        ELSE ""ServiceOpsCariKodu"" || ',' || ""Carikodu""
    END
WHERE ""ServiceOpsCariKodu"" IS NOT NULL;
");

            migrationBuilder.DropColumn(
                name: "ServiceOpsCariKodu",
                table: "Users");
        }
    }
}
