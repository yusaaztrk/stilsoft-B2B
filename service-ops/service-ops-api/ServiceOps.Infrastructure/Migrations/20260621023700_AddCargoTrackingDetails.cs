using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCargoTrackingDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DeliveryProofPhotoUrl",
                table: "CargoTrackingTasks",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Latitude",
                table: "CargoTrackingTasks",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Longitude",
                table: "CargoTrackingTasks",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReceiverName",
                table: "CargoTrackingTasks",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeliveryProofPhotoUrl",
                table: "CargoTrackingTasks");

            migrationBuilder.DropColumn(
                name: "Latitude",
                table: "CargoTrackingTasks");

            migrationBuilder.DropColumn(
                name: "Longitude",
                table: "CargoTrackingTasks");

            migrationBuilder.DropColumn(
                name: "ReceiverName",
                table: "CargoTrackingTasks");
        }
    }
}
