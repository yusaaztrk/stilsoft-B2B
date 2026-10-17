using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class SeedServiceCatalogAndPurchaseKindFixes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.InsertData(
                table: "ServiceCatalogItems",
                columns: new[] { "Id", "Code", "CreateTime", "CreateUser", "EditTime", "EditUser", "IsActive", "Name" },
                values: new object[,]
                {
                    { 1, "HIZ-ELEKTRIK", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "ELEKTRIK SU MASRAF" },
                    { 2, "HIZ-GUMRUK", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "GÜMRÜK MASRAFLARI" },
                    { 3, "HIZ-IHTIYAT", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "IHTIYAT SANDIGI DAIRESI" },
                    { 4, "HIZ-KIRA", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "VAKIFLAR IDARESI KIRA" },
                    { 5, "HIZ-KLIMA", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "KLIMA MONTAJ" },
                    { 6, "HIZ-MATBAA", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "MATBAA KIRTASIYE" },
                    { 7, "HIZ-MUHASEBE", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "MUHASEBE" },
                    { 8, "HIZ-MUHTELIF", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "MUHTELIF MASRAF" },
                    { 9, "HIZ-MUTFAK", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "MUTFAK MASRAF" },
                    { 10, "HIZ-NAKLIYE", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "NAKLIYE ÖDEMELER" },
                    { 11, "HIZ-REKLAM", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "TABELA REKLAM STAND" },
                    { 12, "HIZ-SERVIS", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "SERVIS YEDEK PARCA MALZEME" },
                    { 13, "HIZ-SGK", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "SOSYAL SIGORTALAR DAIRESI" },
                    { 14, "HIZ-SIGORTA", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "SIGORTA MASRAFLARI" },
                    { 15, "HIZ-TAMIR", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "HIZ-TAMIR" },
                    { 16, "HIZ-VDAIRESI", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "VERGİ DAİRESİ" },
                    { 17, "HIZ-YEMEK", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, true, "PERSONEL YEMEK" }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 1);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 2);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 3);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 4);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 5);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 6);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 7);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 8);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 9);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 10);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 11);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 12);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 13);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 14);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 15);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 16);

            migrationBuilder.DeleteData(
                table: "ServiceCatalogItems",
                keyColumn: "Id",
                keyValue: 17);
        }
    }
}
