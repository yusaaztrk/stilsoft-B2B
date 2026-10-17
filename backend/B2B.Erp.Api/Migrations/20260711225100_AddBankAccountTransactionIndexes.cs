using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBankAccountTransactionIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_Pages_ModuleKey_Key\";");

            migrationBuilder.DropIndex(
                name: "IX_BankAccountTransactions_BankAccountDefinitionId_Date",
                table: "BankAccountTransactions");

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 57);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 102);

            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'PurchaseInvoices' AND column_name = 'CashAccountId'
                    ) THEN
                        ALTER TABLE ""PurchaseInvoices"" ADD ""CashAccountId"" integer;
                    END IF;
                END
                $$;
            ");

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 5,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Etiket Basım Fiyatları", "etiket", 6 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 6,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Proforma", "proforma", 7 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 7,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Mağaza Sipariş", "magaza", 8 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 8,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Alış Faturaları", "alis", 9 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 9,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Depo Transfer", "depoTransfer", 10 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 10,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Stok Hareket Dökümü", "stokHareket", 11 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 11,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Satış Faturaları", "satis", 12 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 12,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Depo Bakiye Listesi", "depoBakiye", 13 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 13,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Kasa Giriş/Çıkış", "kasaGirisCikis", "cash", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 14,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kasalar Arası Transfer", "kasalarArasiTransfer", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 15,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Kredi Kartı ile Ödeme", "posPayment", "pos", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 16,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kredi Kartı Çekim Raporu", "posReport", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 17,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Müşteri Çeki", "customerCheck", "check", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 18,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Borç Çeki", "debtCheck", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 19,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Borç Seneti", "debtNote", 3 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 20,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Banka Havale/EFT", "bankaHavaleEft", "bank", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 21,
                columns: new[] { "DisplayName", "Key", "ModuleKey" },
                values: new object[] { "Kabul Listesi", "kabulListesi", "service" });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 22,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Montaj Listesi", "montajListesi", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 23,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Montaj Rapor", "montajRapor", 3 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 24,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Montaj Analiz", "montajAnaliz", 4 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 25,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Cari Ekstre", "cariEkstre", "reports", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 26,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Cari Borç Alacak", "cariBorcAlacak", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 27,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Yaşlandırma", "yaslandirma", 3 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 28,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Yaşlandırma (2024)", "yaslandirma2024", 4 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 29,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Cari Satış Raporu", "cariSatisRaporu", 5 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 30,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Banka Raporları", "bankaRaporlari", 6 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 31,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kasa Raporları", "kasaRaporlari", 7 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 32,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Ürün Satış Raporu Detaylı", "urunSatisRaporuDetayli", 8 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 33,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Ürün Satış Raporu (Aylık)", "urunSatisRaporuAylik", 9 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 34,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Sipariş Raporu", "siparisRaporu", 10 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 35,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Aktif Sepet Raporu", "aktifSepetRaporu", 11 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 36,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Limit Risk Satış Raporu", "limitRiskSatisRaporu", 12 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 37,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Stok Giriş/Çıkış Raporu", "muhasebeStokGirisCikisRaporu", 13 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 38,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Satış Pazarlama Raporu", "satisPazarlamaRaporu", 14 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 39,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Fiyat Listesi", "fiyatListesi", 15 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 40,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Kullanıcı Listesi", "kullaniciListesi", "users", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 41,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kampanya Tanım", "kampanya", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 42,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Stok Listesi", "stokListesi", 3 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 43,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Depolar", "depolar", 4 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 44,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Banka Hesap Tanım", "bankaHesapTanim", 5 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 45,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Rol Yetkileri", "rolYetkileri", 6 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 46,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kategori Yönetimi", "kategoriYonetimi", 7 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 47,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Ürün Yönetimi", "urunYonetimi", 8 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 48,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Fiyat Atama", "atiliFiyatlandirma", 9 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 49,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Fiyat Kategorileri", "fiyatKategorileri", 10 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 50,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Cari Ekle", "cariEkle", 11 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 51,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Tedarikçi Ekle", "tedarikciEkle", 12 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 52,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Konsinye", "irsaliye", 13 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 53,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Silinen Kayıtlar", "silinenKayitlar", 14 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 54,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Taksit Bilgileri", "installmentRules", 15 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 55,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Bildirimler", "bildirimler", 18 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 56,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Virman", "virmanListesi", "virman", 1 });

            migrationBuilder.InsertData(
                table: "Pages",
                columns: new[] { "Id", "DisplayName", "IsActive", "Key", "ModuleKey", "SortOrder" },
                values: new object[,]
                {
                    { 133, "Alış Tipi", true, "alisTipAlis", "invoice", 133 },
                    { 134, "Hizmet Tipi", true, "alisTipHizmet", "invoice", 134 },
                    { 135, "İade Tipi", true, "alisTipIade", "invoice", 135 },
                    { 150, "Fatura Döküme Aktar", true, "proformaFaturaDokumeAktar", "invoice", 150 },
                    { 151, "Basım", true, "proformaBasim", "invoice", 151 },
                    { 152, "Sil", true, "proformaSil", "invoice", 152 },
                    { 303, "Satış Faturası: Ödemeyi Hemen Al", true, "satisFaturaOdemeAl", "invoice", 105 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_BankAccountTransactions_BankAccountDefinitionId_Date_Create~",
                table: "BankAccountTransactions",
                columns: new[] { "BankAccountDefinitionId", "Date", "CreateTime", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_BankAccountTransactions_Date_CreateTime_Id",
                table: "BankAccountTransactions",
                columns: new[] { "Date", "CreateTime", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_BankAccountTransactions_BankAccountDefinitionId_Date_Create~",
                table: "BankAccountTransactions");

            migrationBuilder.DropIndex(
                name: "IX_BankAccountTransactions_Date_CreateTime_Id",
                table: "BankAccountTransactions");

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 133);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 134);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 135);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 150);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 151);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 152);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 303);

            migrationBuilder.DropColumn(
                name: "CashAccountId",
                table: "PurchaseInvoices");

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 5,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Fatura Dökümü (2024)", "faturaDokum2024", 5 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 6,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Etiket Basım Fiyatları", "etiket", 6 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 7,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Proforma", "proforma", 7 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 8,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Mağaza Sipariş", "magaza", 8 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 9,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Alış Faturaları", "alis", 9 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 10,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Depo Transfer", "depoTransfer", 10 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 11,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Stok Hareket Dökümü", "stokHareket", 11 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 12,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Satış Faturaları", "satis", 12 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 13,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Depo Bakiye Listesi", "depoBakiye", "invoice", 13 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 14,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kasa Giriş/Çıkış", "kasaGirisCikis", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 15,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Kasalar Arası Transfer", "kasalarArasiTransfer", "cash", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 16,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kredi Kartı ile Ödeme", "posPayment", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 17,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Kredi Kartı Çekim Raporu", "posReport", "pos", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 18,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Müşteri Çeki", "customerCheck", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 19,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Borç Çeki", "debtCheck", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 20,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Borç Seneti", "debtNote", "check", 3 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 21,
                columns: new[] { "DisplayName", "Key", "ModuleKey" },
                values: new object[] { "Banka Havale/EFT", "bankaHavaleEft", "bank" });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 22,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kabul Listesi", "kabulListesi", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 23,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Montaj Listesi", "montajListesi", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 24,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Montaj Rapor", "montajRapor", 3 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 25,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Montaj Analiz", "montajAnaliz", "service", 4 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 26,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Cari Ekstre", "cariEkstre", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 27,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Cari Borç Alacak", "cariBorcAlacak", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 28,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Yaşlandırma", "yaslandirma", 3 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 29,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Yaşlandırma (2024)", "yaslandirma2024", 4 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 30,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Cari Satış Raporu", "cariSatisRaporu", 5 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 31,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Banka Raporları", "bankaRaporlari", 6 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 32,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kasa Raporları", "kasaRaporlari", 7 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 33,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Ürün Satış Raporu Detaylı", "urunSatisRaporuDetayli", 8 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 34,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Ürün Satış Raporu (Aylık)", "urunSatisRaporuAylik", 9 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 35,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Sipariş Raporu", "siparisRaporu", 10 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 36,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Aktif Sepet Raporu", "aktifSepetRaporu", 11 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 37,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Limit Risk Satış Raporu", "limitRiskSatisRaporu", 12 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 38,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Stok Giriş/Çıkış Raporu", "muhasebeStokGirisCikisRaporu", 13 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 39,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Satış Pazarlama Raporu", "satisPazarlamaRaporu", 14 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 40,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Fiyat Listesi", "fiyatListesi", "reports", 15 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 41,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kullanıcı Listesi", "kullaniciListesi", 1 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 42,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kampanya Tanım", "kampanya", 2 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 43,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Stok Listesi", "stokListesi", 3 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 44,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Depolar", "depolar", 4 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 45,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Banka Hesap Tanım", "bankaHesapTanim", 5 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 46,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Rol Yetkileri", "rolYetkileri", 6 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 47,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Kategori Yönetimi", "kategoriYonetimi", 7 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 48,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Ürün Yönetimi", "urunYonetimi", 8 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 49,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Fiyat Atama", "atiliFiyatlandirma", 9 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 50,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Fiyat Kategorileri", "fiyatKategorileri", 10 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 51,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Cari Ekle", "cariEkle", 11 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 52,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Tedarikçi Ekle", "tedarikciEkle", 12 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 53,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Konsinye", "irsaliye", 13 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 54,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Silinen Kayıtlar", "silinenKayitlar", 14 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 55,
                columns: new[] { "DisplayName", "Key", "SortOrder" },
                values: new object[] { "Taksit Bilgileri", "installmentRules", 15 });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 56,
                columns: new[] { "DisplayName", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { "Bildirimler", "bildirimler", "users", 18 });

            migrationBuilder.InsertData(
                table: "Pages",
                columns: new[] { "Id", "DisplayName", "IsActive", "Key", "ModuleKey", "SortOrder" },
                values: new object[,]
                {
                    { 57, "Virman", true, "virmanListesi", "virman", 1 },
                    { 102, "Üst Bilgi Güncelle (Proforma)", true, "proformaUstBilgiGuncelle", "invoice", 105 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_BankAccountTransactions_BankAccountDefinitionId_Date",
                table: "BankAccountTransactions",
                columns: new[] { "BankAccountDefinitionId", "Date" });

            migrationBuilder.Sql("CREATE UNIQUE INDEX IF NOT EXISTS \"IX_Pages_ModuleKey_Key\" ON \"Pages\" (\"ModuleKey\", \"Key\");");
        }
    }
}
