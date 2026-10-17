using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWarehousesSalesmanCodeAndDepolarPage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""Warehouses"" ADD COLUMN IF NOT EXISTS ""SalesmanCode"" character varying(50);
");

            migrationBuilder.Sql(@"
ALTER TABLE ""PurchaseInvoiceLines"" ADD COLUMN IF NOT EXISTS ""WarehouseCode"" integer;
");

            migrationBuilder.Sql(@"
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
VALUES (9991, 'Depolar', TRUE, 'depolar', 'users', 9)
ON CONFLICT (""ModuleKey"", ""Key"")
DO UPDATE SET ""DisplayName"" = EXCLUDED.""DisplayName"", ""IsActive"" = EXCLUDED.""IsActive"", ""SortOrder"" = EXCLUDED.""SortOrder"";
");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseInvoiceLines_WarehouseCode",
                table: "PurchaseInvoiceLines",
                column: "WarehouseCode");

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseInvoiceLines_Warehouses_WarehouseCode",
                table: "PurchaseInvoiceLines",
                column: "WarehouseCode",
                principalTable: "Warehouses",
                principalColumn: "WarehouseCode",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseInvoiceLines_Warehouses_WarehouseCode",
                table: "PurchaseInvoiceLines");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseInvoiceLines_WarehouseCode",
                table: "PurchaseInvoiceLines");

            migrationBuilder.Sql(@"
DELETE FROM ""Pages"" WHERE ""ModuleKey"" = 'users' AND ""Key"" = 'depolar';
");

            migrationBuilder.DropColumn(
                name: "SalesmanCode",
                table: "Warehouses");

            migrationBuilder.DropColumn(
                name: "WarehouseCode",
                table: "PurchaseInvoiceLines");
        }
    }
}
