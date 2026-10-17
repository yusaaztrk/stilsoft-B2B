using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInstallmentRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "InstallmentRules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BankName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    InstallmentText = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    MinAmountText = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    DescriptionText = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InstallmentRules", x => x.Id);
                });

            migrationBuilder.InsertData(
                table: "InstallmentRules",
                columns: new[] { "Id", "BankName", "DescriptionText", "InstallmentText", "IsActive", "MinAmountText", "SortOrder" },
                values: new object[,]
                {
                    { new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"), "CREDITWEST BANK LTD.", "1 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.\n250 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.", "0 TAKSİT\n3 TAKSİT", true, "1\n250", 1 },
                    { new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2"), "HALK BANKASI", "\n1500 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.", "TEK ÇEKİM\n3 TAKSİT", true, "1\n1500", 2 },
                    { new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3"), "K.T.KOOPMERKEZ BANKASI LTD.", "", "TEK ÇEKİM", true, "1", 3 },
                    { new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4"), "T. GARANTİ BANKASI A.Ş.", "1500 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.\n", "3 TAKSİT\nTEK ÇEKİM", true, "1500\n1", 4 },
                    { new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5"), "T.C. ZİRAAT BANKASI A.Ş.", "\n250 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.", "TEK ÇEKİM\n3 TAKSİT", true, "1\n250", 5 },
                    { new Guid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6"), "TÜRKİYE İŞ BANKASI A.Ş.", "\n1000 TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.", "TEK ÇEKİM\n3 TAKSİT", true, "1\n1000", 6 }
                });

            migrationBuilder.InsertData(
                table: "Pages",
                columns: new[] { "Id", "DisplayName", "IsActive", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { 51, "Taksit Bilgileri", true, "installmentRules", "users", 9 });

            migrationBuilder.CreateIndex(
                name: "IX_InstallmentRules_IsActive_SortOrder",
                table: "InstallmentRules",
                columns: new[] { "IsActive", "SortOrder" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InstallmentRules");

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 51);
        }
    }
}
