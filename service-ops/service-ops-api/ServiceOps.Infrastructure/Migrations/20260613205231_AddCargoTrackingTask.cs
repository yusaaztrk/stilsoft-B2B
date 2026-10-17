using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCargoTrackingTask : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CargoTrackingTasks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderNumber = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ProductDetails = table.Column<string>(type: "text", nullable: true),
                    CustomerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DeliveryAddress = table.Column<string>(type: "text", nullable: true),
                    OrderDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AssignedTechnicianId = table.Column<Guid>(type: "uuid", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CargoTrackingTasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CargoTrackingTasks_Technicians_AssignedTechnicianId",
                        column: x => x.AssignedTechnicianId,
                        principalTable: "Technicians",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CargoTrackingTasks_AssignedTechnicianId",
                table: "CargoTrackingTasks",
                column: "AssignedTechnicianId");

            migrationBuilder.CreateIndex(
                name: "IX_CargoTrackingTasks_OrderNumber",
                table: "CargoTrackingTasks",
                column: "OrderNumber",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CargoTrackingTasks_Status",
                table: "CargoTrackingTasks",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CargoTrackingTasks");
        }
    }
}
