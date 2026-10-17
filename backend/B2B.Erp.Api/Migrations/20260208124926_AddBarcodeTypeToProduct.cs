using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBarcodeTypeToProduct : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 102);

            migrationBuilder.AddColumn<string>(
                name: "BarcodeType",
                table: "Products",
                type: "text",
                nullable: false,
                defaultValue: "CODE128");

            // Mevcut ürünlerin barcodeType'ını belirle:
            // EAN-13: 13 haneli sayısal + GS1 check digit doğrulaması
            migrationBuilder.Sql(@"
                UPDATE ""Products""
                SET ""BarcodeType"" = CASE
                    WHEN ""Barcode"" IS NOT NULL
                         AND LENGTH(TRIM(""Barcode"")) = 13
                         AND TRIM(""Barcode"") ~ '^\d{13}$'
                         AND (
                             (10 - (
                                 (CAST(SUBSTRING(TRIM(""Barcode""),  1, 1) AS INT))
                               + (CAST(SUBSTRING(TRIM(""Barcode""),  2, 1) AS INT) * 3)
                               + (CAST(SUBSTRING(TRIM(""Barcode""),  3, 1) AS INT))
                               + (CAST(SUBSTRING(TRIM(""Barcode""),  4, 1) AS INT) * 3)
                               + (CAST(SUBSTRING(TRIM(""Barcode""),  5, 1) AS INT))
                               + (CAST(SUBSTRING(TRIM(""Barcode""),  6, 1) AS INT) * 3)
                               + (CAST(SUBSTRING(TRIM(""Barcode""),  7, 1) AS INT))
                               + (CAST(SUBSTRING(TRIM(""Barcode""),  8, 1) AS INT) * 3)
                               + (CAST(SUBSTRING(TRIM(""Barcode""),  9, 1) AS INT))
                               + (CAST(SUBSTRING(TRIM(""Barcode""), 10, 1) AS INT) * 3)
                               + (CAST(SUBSTRING(TRIM(""Barcode""), 11, 1) AS INT))
                               + (CAST(SUBSTRING(TRIM(""Barcode""), 12, 1) AS INT) * 3)
                             ) % 10) % 10 = CAST(SUBSTRING(TRIM(""Barcode""), 13, 1) AS INT)
                         )
                    THEN 'EAN13'
                    ELSE 'CODE128'
                END;
            ");

            migrationBuilder.InsertData(
                table: "Pages",
                columns: new[] { "Id", "DisplayName", "IsActive", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { 104, "Depo Stok Durumu", true, "depoStock", "invoice", 11 });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 104);

            migrationBuilder.DropColumn(
                name: "BarcodeType",
                table: "Products");

            migrationBuilder.InsertData(
                table: "Pages",
                columns: new[] { "Id", "DisplayName", "IsActive", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { 102, "Depo Stok Durumu", true, "depoStock", "invoice", 11 });
        }
    }
}
