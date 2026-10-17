using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTenantCodeToInventory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Inventories_PartNumber",
                table: "Inventories");

            migrationBuilder.AddColumn<string>(
                name: "TenantCode",
                table: "Inventories",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Inventories_TenantCode",
                table: "Inventories",
                column: "TenantCode");

            migrationBuilder.CreateIndex(
                name: "IX_Inventories_TenantCode_PartNumber",
                table: "Inventories",
                columns: new[] { "TenantCode", "PartNumber" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Inventories_TenantCode",
                table: "Inventories");

            migrationBuilder.DropIndex(
                name: "IX_Inventories_TenantCode_PartNumber",
                table: "Inventories");

            migrationBuilder.DropColumn(
                name: "TenantCode",
                table: "Inventories");

            migrationBuilder.CreateIndex(
                name: "IX_Inventories_PartNumber",
                table: "Inventories",
                column: "PartNumber",
                unique: true);
        }
    }
}
