using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Data.Migrations.Master
{
    /// <inheritdoc />
    public partial class AddIsEcommerceEnabledToTenants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Column already added via raw SQL
            /*
            migrationBuilder.AddColumn<bool>(
                name: "IsEcommerceEnabled",
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
                name: "IsEcommerceEnabled",
                table: "Tenants");
        }
    }
}
