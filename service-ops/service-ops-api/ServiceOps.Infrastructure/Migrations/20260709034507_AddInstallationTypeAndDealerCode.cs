using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddInstallationTypeAndDealerCode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DealerCode",
                table: "ServiceUsers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InstallationType",
                table: "ServiceRecords",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DealerCode",
                table: "ServiceUsers");

            migrationBuilder.DropColumn(
                name: "InstallationType",
                table: "ServiceRecords");
        }
    }
}
