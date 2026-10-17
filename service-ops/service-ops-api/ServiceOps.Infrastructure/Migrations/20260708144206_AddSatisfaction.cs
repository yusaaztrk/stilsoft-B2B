using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSatisfaction : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SatisfactionNotes",
                table: "ServiceRecords",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SatisfactionScore",
                table: "ServiceRecords",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SatisfactionNotes",
                table: "ServiceRecords");

            migrationBuilder.DropColumn(
                name: "SatisfactionScore",
                table: "ServiceRecords");
        }
    }
}
