using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Servis numarası üretimini "en büyüğü bul + 1" yerine veritabanı dizisine (sequence) taşır.
    ///
    /// Eski yöntemde oku-ve-yaz arası açıktı: aynı anda iki kayıt açılırsa ikisi de aynı max'ı
    /// okuyup aynı numarayı istiyordu ve biri `IX_ServiceRecords_ServiceNumber` benzersizlik
    /// kısıtına takılıp 500 dönüyordu. `nextval` atomiktir, asla aynı değeri iki kez vermez.
    ///
    /// Diziler mevcut EN BÜYÜK numaranın üstüne çekilir; sayım silinmiş kayıtları da kapsar
    /// çünkü benzersizlik kısıtı onları da kapsıyor. "MNT-0000003-1" gibi son ekli numaralarda
    /// yalnızca baştaki sayı okunur.
    ///
    /// SQL elle yazıldı: her firma ayrı veritabanı, bir kısmı zincirin farklı noktalarında.
    /// IF NOT EXISTS ile adım tekrar çalıştırılabilir kalıyor.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260807140000_AddServiceNumberSequences")]
    public partial class AddServiceNumberSequences : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DO $do$
DECLARE
    p    text;
    seq  text;
    mx   bigint;
BEGIN
    FOREACH p IN ARRAY ARRAY['MNT', 'AT', 'SH'] LOOP
        seq := 'ServiceNumberSeq_' || p;

        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I AS bigint START 1 MINVALUE 1', seq);

        EXECUTE format(
            'SELECT COALESCE(MAX(SUBSTRING(""ServiceNumber"" FROM %L)::bigint), 0) FROM ""ServiceRecords"" WHERE ""ServiceNumber"" ~ %L',
            '^' || p || '-(\d+)',
            '^' || p || '-\d+'
        ) INTO mx;

        -- mx = 0 ise: setval(seq, 1, false) → ilk nextval 1 verir.
        -- mx > 0 ise: setval(seq, mx, true) → ilk nextval mx + 1 verir.
        -- quote_ident ŞART: setval metni regclass'a çevirirken tırnaksız adı küçük harfe
        -- katlar, büyük harf içeren dizi adı bulunamaz.
        PERFORM setval(quote_ident(seq), GREATEST(mx, 1), mx > 0);
    END LOOP;
END
$do$;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP SEQUENCE IF EXISTS ""ServiceNumberSeq_MNT"";
DROP SEQUENCE IF EXISTS ""ServiceNumberSeq_AT"";
DROP SEQUENCE IF EXISTS ""ServiceNumberSeq_SH"";
");
        }
    }
}
