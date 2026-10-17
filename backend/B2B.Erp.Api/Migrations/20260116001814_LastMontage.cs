using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class LastMontage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "InstallationId",
                table: "SalesOrderLines",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrderLines_InstallationId",
                table: "SalesOrderLines",
                column: "InstallationId");

            migrationBuilder.AddForeignKey(
                name: "FK_SalesOrderLines_Installations_InstallationId",
                table: "SalesOrderLines",
                column: "InstallationId",
                principalTable: "Installations",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SalesOrderLines_Installations_InstallationId",
                table: "SalesOrderLines");

            migrationBuilder.DropIndex(
                name: "IX_SalesOrderLines_InstallationId",
                table: "SalesOrderLines");

            migrationBuilder.DropColumn(
                name: "InstallationId",
                table: "SalesOrderLines");
        }
    }
}
