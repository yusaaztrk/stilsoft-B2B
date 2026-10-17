using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBankDetailsSeed : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BankDetails",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BANKA_ADI = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    BANK_DETAIL_CODE = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BankDetails", x => x.Id);
                });

            migrationBuilder.InsertData(
                table: "BankDetails",
                columns: new[] { "Id", "BANK_DETAIL_CODE", "IsActive", "BANKA_ADI" },
                values: new object[,]
                {
                    { 1, "1", true, "TCMB" },
                    { 2, "3", true, "ETIBANK" },
                    { 3, "4", true, "ILLER BANKASI" },
                    { 4, "10", true, "T.C. ZİRAAT BANKASI A.Ş." },
                    { 5, "12", true, "HALK BANKASI" },
                    { 6, "14", true, "SINAI KALKINMA BANKASI" },
                    { 7, "15", true, "TÜRKİYE VAKIFLAR BANKASI T.A.O." },
                    { 8, "16", true, "EXIMBANK" },
                    { 9, "17", true, "KALKINMA BANKASI" },
                    { 10, "29", true, "BAYINDIRBANK A.S" },
                    { 11, "30", true, "IKTISAT BANKASI" },
                    { 12, "32", true, "TÜRK EKONOMI BANKASI A.S." },
                    { 13, "46", true, "AKBANK T.A.Ş." },
                    { 14, "55", true, "TARISBANK" },
                    { 15, "56", true, "PAMUKBANK" },
                    { 16, "58", true, "SINAI YATIRIM VE KREDI BANKASI" },
                    { 17, "59", true, "SEKERBANK T.A.Ş." },
                    { 18, "60", true, "TURK TICARET BANKASI" },
                    { 19, "62", true, "T. GARANTİ BANKASI A.Ş." },
                    { 20, "63", true, "IMAR BANKASI" },
                    { 21, "64", true, "TÜRKİYE İŞ BANKASI A.Ş." },
                    { 22, "67", true, "YAPI VE KREDI BANKASI A.Ş." },
                    { 23, "71", true, "FORTIS BANK" },
                    { 24, "87", true, "BANCO DI ROMA" },
                    { 25, "88", true, "ABN AMRO BANK N.V." },
                    { 26, "91", true, "TÜRKİYE FİNANS BANKASI" },
                    { 27, "92", true, "CITIBANK" },
                    { 28, "93", true, "KOÇBANK A.S." },
                    { 29, "96", true, "TURKISH BANK" },
                    { 30, "98", true, "CHASE MANHATTAN" },
                    { 31, "99", true, "ING BANK A.Ş." },
                    { 32, "100", true, "ADABANK" },
                    { 33, "101", true, "FIBABANK AS" },
                    { 34, "103", true, "FİBABANKA A.Ş." },
                    { 35, "106", true, "WESTDEUTSCHE LANDESBANK" },
                    { 36, "107", true, "BNP BANK" },
                    { 37, "108", true, "MNG BANK A.S." },
                    { 38, "109", true, "ICBC BANK TURKEY" },
                    { 39, "110", true, "CREDIT LYONNAIS" },
                    { 40, "111", true, "FINANSBANK A.S." },
                    { 41, "112", true, "T.C.ZIRAAT BANKASI-EMLAK" },
                    { 42, "115", true, "DEUTSCHE BANK AS" },
                    { 43, "116", true, "YATIRIMBANK" },
                    { 44, "118", true, "KIBRIS KREDI BANKASI LTD" },
                    { 45, "120", true, "K.T.KOOP.MERKEZ BANKASI LTD." },
                    { 46, "121", true, "CREDIT AGRICOLE INDOSUEZ TURKBANK" },
                    { 47, "122", true, "SOCIETE GENERAL" },
                    { 48, "123", true, "HSBC BANK A.S." },
                    { 49, "124", true, "ALTERNATIF BANK A.Ş." },
                    { 50, "125", true, "BURGAN BANK A.Ş." },
                    { 51, "126", true, "TOPRAKBANK" },
                    { 52, "127", true, "KENTBANK" },
                    { 53, "128", true, "PARK YATIRIM" },
                    { 54, "129", true, "TATBANK" },
                    { 55, "132", true, "TAKASBANK" },
                    { 56, "133", true, "ING BANK N.V." },
                    { 57, "134", true, "DENIZBANK A.S." },
                    { 58, "135", true, "ANADOLU BANK A.Ş." },
                    { 59, "136", true, "CREDİTWEST BANK LTD." },
                    { 60, "137", true, "RABOBANK NEDERLAND" },
                    { 61, "138", true, "DILERBANK AS" },
                    { 62, "139", true, "GSD YATIRM BANKASI A.S." },
                    { 63, "140", true, "CREDIT SUISSE FIRST BOSTON" },
                    { 64, "141", true, "NUROL YATIRIM BANKASI AS" },
                    { 65, "142", true, "TOPRAK YATIRIM BANKASI AS" },
                    { 66, "143", true, "CALIK YATIRIM BANKASI AS" },
                    { 67, "144", true, "ATLAS YATIRIM AS" },
                    { 68, "145", true, "JP MORGAN GUARANTY" },
                    { 69, "146", true, "ODEA BANK A.Ş." },
                    { 70, "203", true, "AL BARAKA TÜRK" },
                    { 71, "204", true, "FAMILY FINANS KURUMU A.S." },
                    { 72, "205", true, "KUVEYT TURK EVKAF" },
                    { 73, "206", true, "TÜRKİYE FİNANS KATILIM BANKASI A.Ş." },
                    { 74, "207", true, "IHLAS FINANS KURUMU" },
                    { 75, "208", true, "ASYA FINANS KURUMU A.S." },
                    { 76, "209", true, "ZİRAAT KATILIM BANKASI" },
                    { 77, "210", true, "VAKIF KATILIM BANKASI" },
                    { 78, "211", true, "EMLAK KATILIM" },
                    { 79, "228", true, "TÜRKİYE FİNANS KATILIM A.Ş." },
                    { 80, "997", true, "YONLENDIRICI MERKEZI" },
                    { 81, "998", true, "EMKT MERKEZI" },
                    { 82, "999", true, "-" },
                    { 83, "KBR-0019", true, "KOOPBANK" },
                    { 84, "99999999", true, "BANKMORE" },
                    { 85, "ALSCK", true, "ALSANCAK KALKINMA KOOPERATIF" },
                    { 86, "HIGH-RISE", true, "HIGH RISE BANK" },
                    { 87, "KBR-0001", true, "KIBRIS AKFINANS BANK" },
                    { 88, "KBR-0002", true, "KIBRIS ALBANK" },
                    { 89, "KBR-0003", true, "KIBRIS ASBANK" },
                    { 90, "KBR-0004", true, "KIBRIS AYDINKOY KALKINMA KOOP." },
                    { 91, "KBR-0005", true, "KIBRIS BOSTANCI KALKINMA KOOP." },
                    { 92, "KBR-0006", true, "KIBRIS CAPITALBANK" },
                    { 93, "KBR-0008", true, "KIBRIS CAYONU KALKINMA KOOP." },
                    { 94, "KBR-0009", true, "KIBRIS DIKMEN KALKINMA KOOP." },
                    { 95, "KBR-0010", true, "KIBRIS DOGANCI KOOPERATIF KREDI STI." },
                    { 96, "KBR-0012", true, "KIBRIS GUZELYURT KALKINMA KOOP." },
                    { 97, "KBR-0014", true, "İKTİSAT BANKASI" },
                    { 98, "KBR-0016", true, "KIBRIS FAISAL ISLAM BANKASI" },
                    { 99, "KBR-0017", true, "KIBRIS TURK OGRT. KOOP." },
                    { 100, "KBR-0018", true, "KIBRIS VAKIFLAR BANKASI" },
                    { 101, "KBR-0020", true, "KIBRIS LAPTA KALKINMA KOOPERATIFI" },
                    { 102, "KBR-0021", true, "KIBRIS LEFKOSA IKTISAT KOOPERATIFI" },
                    { 103, "KBR-0022", true, "KIBRIS LIMASOL TURK KOOP.BANKASI" },
                    { 104, "KBR-0023", true, "KIBRIS MAGUSA TURK KOOPERATIFI" },
                    { 105, "KBR-0024", true, "KIBRIS MEHMETCIK KOOPERATIF KREDI" },
                    { 106, "KBR-0025", true, "KIBRIS MEMURLAR KOOP." },
                    { 107, "KBR-0026", true, "KIBRIS MERKEZ BANKASI" },
                    { 108, "KBR-0027", true, "KIBRIS MEZ KOOP LTD" },
                    { 109, "KBR-0028", true, "KIBRIS NEAR EAST BANK" },
                    { 110, "KBR-0029", true, "KIBRIS NOVABANK" },
                    { 111, "KBR-0030", true, "KIBRIS OKAL KOOP" },
                    { 112, "KBR-0031", true, "KIBRIS POLIS YARDIMLASMA KOOP." },
                    { 113, "KBR-0032", true, "KIBRIS SERDARLI KREDI KOOP." },
                    { 114, "KBR-0033", true, "KIBRIS SEKERBANK" },
                    { 115, "KBR-0034", true, "KIBRIS TEB" },
                    { 116, "KBR-0035", true, "KIBRIS TURK BANKASI" },
                    { 117, "KBR-0036", true, "KIBRIS UNIVERSAL BANK" },
                    { 118, "KBR-0037", true, "KIBRIS YENI ERENKOY KOOP." }
                });

            migrationBuilder.CreateIndex(
                name: "IX_BankDetails_BANK_DETAIL_CODE",
                table: "BankDetails",
                column: "BANK_DETAIL_CODE",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BankDetails");
        }
    }
}
