namespace B2B.Erp.Api.Data.Services;

/// <summary>
/// BANKA MASRAFLARI — kolon + sayfa kurulum SQL'i (2026-08-20).
///
/// <para>
/// <b>Neden yeni tablo yok.</b> Masraf gerçekten hesaptan çıkan paradır; ayrı bir tabloya
/// yazılsaydı banka bakiyesi ile masraf listesi iki ayrı kaynaktan gelir ve er ya da geç
/// ayrışırdı. Satır bugün de olduğu gibi <c>BankAccountTransactions</c> içinde bir ÇIKIŞ
/// hareketidir; eklenen tek şey satırın hangi masraf hesabına ait olduğudur.
/// </para>
///
/// <para>
/// Bu depoda tablo/kolon eklemenin yolu <c>dotnet ef migrations add</c> DEĞİL: snapshot
/// kayması yüzünden alakasız onlarca işlem üretiyor. Yerleşik yöntem açılışta çalışan
/// <c>IF NOT EXISTS</c> SQL'i — aynı desen <see cref="LoanSchema"/> ve
/// <see cref="EcommerceSchema"/>'da da var.
/// </para>
///
/// <para>
/// Metin TEK YERDE duruyor çünkü iki yerden çalıştırılıyor: varsayılan veritabanı için
/// <c>Program.cs</c>, her firma veritabanı için <c>TenantConnectionStringResolver</c>.
/// Drift-fix SQL'ini iki bloğa elle kopyalamak bu depoda tekrarlayan bir hata kaynağı.
/// </para>
/// </summary>
public static class BankExpenseSchema
{
    public const string BankExpenseDdl = @"
DO $$
BEGIN

IF EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema='public' AND table_name='BankAccountTransactions'
) THEN

  -- MASRAF TURU. 0 = bu satir masraf degil (normal para hareketi).
  -- 1 POS, 2 Kredi kullanim masrafi, 3 Havale/EFT masrafi, 4 Hesap isletim, 9 Diger.
  ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""ExpenseType"" integer NOT NULL DEFAULT 0;

  -- Kredi kullanim masrafinda ilgili kredi. FK YOK: masraf odenmis paradir, kredinin
  -- silinmesini engellememeli. Kredi silinirse alan oksuz kalir, satir kaybolmaz.
  ALTER TABLE ""BankAccountTransactions"" ADD COLUMN IF NOT EXISTS ""ExpenseLoanId"" integer NULL;

  -- ESKI POS MASRAFLARININ DAMGALANMASI.
  --
  -- Bugune kadar yazilmis butun masraf satirlari IsPosFee=true ile isaretli; tur alani
  -- eklendiginde hepsi 0 (=masraf degil) kalirdi ve yeni ekran BOS acilirdi -- yani
  -- kullanicinin sikayet ettigi ""masraflar gozukmuyor"" durumu aynen surerdi.
  --
  -- IDEMPOTENS: kosul ""ExpenseType"" = 0 uzerinden yurur, guncellenen satir 1 olur ve
  -- ikinci calistirma hicbir seyi degistirmez.
  UPDATE ""BankAccountTransactions"" SET ""ExpenseType"" = 1
  WHERE ""IsPosFee"" = TRUE AND ""ExpenseType"" = 0;

  -- Masraf ekrani ""bu hesabin, bu tarih araligindaki masraflari"" diye soruyor.
  CREATE INDEX IF NOT EXISTS ""IX_BankAccountTransactions_ExpenseType_Bank_Date""
    ON ""BankAccountTransactions"" (""ExpenseType"", ""BankAccountDefinitionId"", ""Date"")
    WHERE ""ExpenseType"" > 0;

END IF;

-- Banka Masraflari sayfasi (Banka Islemleri altinda). Sayfa anahtari olmadan rol
-- yetkilerinde gorunmez ve AuthorizePage her istegi reddeder.
IF EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema='public' AND table_name='Pages'
) THEN

  -- SAYFA KIMLIGI SABIT YAZILAMAZ: ayni kimlik her veritabaninda BASKA bir sayfaya ait.
  -- Sabit kimlik PK_Pages'i ihlal eder ve hata BU BLOGUN TAMAMINI dusurur
  -- (bir kez yasandi, 2026-08-12 -- bkz. LoanSchema).
  INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
  SELECT (SELECT COALESCE(MAX(""Id""), 0) + 1 FROM ""Pages""), 'Banka Masrafları', TRUE, 'bankaMasraflari', 'bank', 4
  WHERE NOT EXISTS (
    SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='bank' AND ""Key""='bankaMasraflari'
  );

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='RolePagePermissions'
  ) THEN
    -- YALNIZCA YONETIM VE SUPERADMIN (kullanici karari, 2026-08-20).
    -- 1 SuperAdmin, 2 Yonetim. SSA'nin kendi claim'i zaten butun sayfa kontrollerini
    -- gecer (PageAuthorizationFilter), o yuzden burada satiri yok.
    -- Mudur/Admin/Muhasebe BILEREK disarida: masraf tablosu firmanin gider tablosudur.
    -- Gerekirse Rol Yetkileri ekranindan acilir.
    INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
    SELECT r.""Id"", p.""Id"", TRUE
    FROM ""Roles"" r
    CROSS JOIN (
      SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='bank' AND ""Key""='bankaMasraflari'
    ) p
    WHERE r.""Id"" IN (1,2)
    ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
  END IF;

END IF;
END $$;
";
}
