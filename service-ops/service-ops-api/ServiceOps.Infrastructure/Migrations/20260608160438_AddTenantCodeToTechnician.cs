using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTenantCodeToTechnician : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TenantCode",
                table: "Technicians",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Technicians_TenantCode",
                table: "Technicians",
                column: "TenantCode");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Technicians_TenantCode",
                table: "Technicians");

            migrationBuilder.DropColumn(
                name: "TenantCode",
                table: "Technicians");
        }
    }
}
