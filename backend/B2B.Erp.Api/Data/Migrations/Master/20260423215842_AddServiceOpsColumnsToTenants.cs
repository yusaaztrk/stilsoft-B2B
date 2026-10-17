using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Data.Migrations.Master
{
    /// <inheritdoc />
    public partial class AddServiceOpsColumnsToTenants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Columns already exist in the database, commenting out to avoid 42701 error
            /*
            migrationBuilder.AddColumn<string>(
                name: "ServiceOpsDbName",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ServiceOpsEnabled",
                table: "Tenants",
                type: "boolean",
                nullable: false,
                defaultValue: false);
            */
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ServiceOpsDbName",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "ServiceOpsEnabled",
                table: "Tenants");
        }
    }
}
