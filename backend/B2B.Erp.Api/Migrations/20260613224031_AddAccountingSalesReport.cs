using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountingSalesReport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.InsertData(
                table: "Pages",
                columns: new[] { "Id", "DisplayName", "IsActive", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { 500, "Muhasebe Satış Raporu", true, "accountingSalesReport", "reports", 16 });

            migrationBuilder.InsertData(
                table: "RolePagePermissions",
                columns: new[] { "Id", "CanAccess", "PageId", "RoleId" },
                values: new object[,]
                {
                    { 10011, true, 500, 1 },
                    { 10012, true, 500, 6 },
                    { 10013, true, 500, 2 }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "RolePagePermissions",
                keyColumn: "Id",
                keyValue: 10011);

            migrationBuilder.DeleteData(
                table: "RolePagePermissions",
                keyColumn: "Id",
                keyValue: 10012);

            migrationBuilder.DeleteData(
                table: "RolePagePermissions",
                keyColumn: "Id",
                keyValue: 10013);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 500);
        }
    }
}
