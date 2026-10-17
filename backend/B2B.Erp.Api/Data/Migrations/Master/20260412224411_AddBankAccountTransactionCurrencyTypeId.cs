using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Data.Migrations.Master
{
    /// <inheritdoc />
    public partial class AddBankAccountTransactionCurrencyTypeId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Columns already exist in the database, commenting out to avoid 42701 error
            /*
            migrationBuilder.AddColumn<string>(
                name: "HeaderGradientFrom",
                table: "Tenants",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HeaderGradientTo",
                table: "Tenants",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LogoPath",
                table: "Tenants",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);
            */
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HeaderGradientFrom",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "HeaderGradientTo",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "LogoPath",
                table: "Tenants");
        }
    }
}
