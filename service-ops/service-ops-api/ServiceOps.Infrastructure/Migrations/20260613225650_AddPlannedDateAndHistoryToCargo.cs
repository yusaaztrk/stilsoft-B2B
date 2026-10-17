using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPlannedDateAndHistoryToCargo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "HistoryJson",
                table: "CargoTrackingTasks",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HistoryJson",
                table: "CargoTrackingTasks");
        }
    }
}
