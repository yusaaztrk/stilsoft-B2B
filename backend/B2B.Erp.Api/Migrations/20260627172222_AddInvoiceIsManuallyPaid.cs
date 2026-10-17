using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInvoiceIsManuallyPaid : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsManuallyPaid",
                table: "Invoices",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "EmployeeLocationSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Latitude = table.Column<decimal>(type: "numeric", nullable: false),
                    Longitude = table.Column<decimal>(type: "numeric", nullable: false),
                    MaxDistanceInMeters = table.Column<double>(type: "double precision", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreateUser = table.Column<string>(type: "text", nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "text", nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmployeeLocationSettings", x => x.Id);
                });

            migrationBuilder.InsertData(
                table: "Pages",
                columns: new[] { "Id", "DisplayName", "IsActive", "Key", "ModuleKey", "SortOrder" },
                values: new object[,]
                {
                    { 110, "Ödeme Alındı", true, "faturaDokumOdemeAlindi", "invoice", 110 },
                    { 111, "Nakit Miktar", true, "faturaDokumNakitMiktar", "invoice", 111 },
                    { 112, "Barkod", true, "faturaDokumBarkod", "invoice", 112 },
                    { 113, "Basım", true, "faturaDokumBasim", "invoice", 113 },
                    { 114, "Sil", true, "faturaDokumSil", "invoice", 114 },
                    { 120, "Düzenle", true, "musteriTeklifiDuzenle", "invoice", 120 },
                    { 121, "Sil", true, "musteriTeklifiSil", "invoice", 121 },
                    { 122, "Proforma Aktar", true, "musteriTeklifiProformaAktar", "invoice", 122 },
                    { 123, "Basım", true, "musteriTeklifiBasim", "invoice", 123 },
                    { 130, "Düzenle", true, "alisDuzenle", "invoice", 130 },
                    { 131, "Termin", true, "alisTermin", "invoice", 131 },
                    { 132, "Sil", true, "alisSil", "invoice", 132 },
                    { 140, "Durum Değiştir", true, "terminDurumDegistir", "invoice", 140 },
                    { 402, "Kampanya Tanım", true, "kampanya", "users", 19 },
                    { 600, "Fatura Dökümü", true, "deleteRule/faturaDokum", "deleteRule", 1 },
                    { 601, "Müşteri Teklifi", true, "deleteRule/musteriTeklifi", "deleteRule", 2 },
                    { 602, "Proforma", true, "deleteRule/proforma", "deleteRule", 3 },
                    { 603, "Alış Faturaları", true, "deleteRule/alis", "deleteRule", 4 }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmployeeLocationSettings");

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 110);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 111);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 112);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 113);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 114);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 120);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 121);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 122);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 123);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 130);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 131);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 132);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 140);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 402);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 600);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 601);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 602);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 603);

            migrationBuilder.DropColumn(
                name: "IsManuallyPaid",
                table: "Invoices");


        }
    }
}
