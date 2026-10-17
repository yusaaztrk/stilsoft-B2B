using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceRecordRoutePlanningFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PlannedEndTime",
                table: "ServiceRecords",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PlannedStartTime",
                table: "ServiceRecords",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RouteDate",
                table: "ServiceRecords",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RouteOrder",
                table: "ServiceRecords",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TechnicianId",
                table: "ServiceRecords",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UserRouteHour",
                table: "ServiceRecords",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "UserRouteSortOrder",
                table: "ServiceRecords",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "UserRouteTick",
                table: "ServiceRecords",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_ServiceRecords_TechnicianId",
                table: "ServiceRecords",
                column: "TechnicianId");

            migrationBuilder.AddForeignKey(
                name: "FK_ServiceRecords_Technicians_TechnicianId",
                table: "ServiceRecords",
                column: "TechnicianId",
                principalTable: "Technicians",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ServiceRecords_Technicians_TechnicianId",
                table: "ServiceRecords");

            migrationBuilder.DropIndex(
                name: "IX_ServiceRecords_TechnicianId",
                table: "ServiceRecords");

            migrationBuilder.DropColumn(
                name: "PlannedEndTime",
                table: "ServiceRecords");

            migrationBuilder.DropColumn(
                name: "PlannedStartTime",
                table: "ServiceRecords");

            migrationBuilder.DropColumn(
                name: "RouteDate",
                table: "ServiceRecords");

            migrationBuilder.DropColumn(
                name: "RouteOrder",
                table: "ServiceRecords");

            migrationBuilder.DropColumn(
                name: "TechnicianId",
                table: "ServiceRecords");

            migrationBuilder.DropColumn(
                name: "UserRouteHour",
                table: "ServiceRecords");

            migrationBuilder.DropColumn(
                name: "UserRouteSortOrder",
                table: "ServiceRecords");

            migrationBuilder.DropColumn(
                name: "UserRouteTick",
                table: "ServiceRecords");
        }
    }
}
