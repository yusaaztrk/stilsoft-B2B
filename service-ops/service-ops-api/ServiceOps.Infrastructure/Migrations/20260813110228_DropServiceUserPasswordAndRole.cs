using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DropServiceUserPasswordAndRole : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ServiceUsers_Role",
                table: "ServiceUsers");

            migrationBuilder.DropColumn(
                name: "PasswordHash",
                table: "ServiceUsers");

            migrationBuilder.DropColumn(
                name: "Role",
                table: "ServiceUsers");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PasswordHash",
                table: "ServiceUsers",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Role",
                table: "ServiceUsers",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceUsers_Role",
                table: "ServiceUsers",
                column: "Role");
        }
    }
}
