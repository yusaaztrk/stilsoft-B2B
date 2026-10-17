using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddInstallationsAndActivity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CanInstall",
                table: "Technicians",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "Activities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ServiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActorUserName = table.Column<string>(type: "text", nullable: true),
                    ActorTechnicianId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActorTechnicianName = table.Column<string>(type: "text", nullable: true),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: false),
                    CorrelationId = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Activities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Activities_ServiceRecords_ServiceId",
                        column: x => x.ServiceId,
                        principalTable: "ServiceRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "InstallationTasks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ServiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssignedTechnicianId = table.Column<Guid>(type: "uuid", nullable: true),
                    PlannedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    EstimatedDurationMinutes = table.Column<int>(type: "integer", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    Priority = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InstallationTasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InstallationTasks_ServiceRecords_ServiceId",
                        column: x => x.ServiceId,
                        principalTable: "ServiceRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_InstallationTasks_Technicians_AssignedTechnicianId",
                        column: x => x.AssignedTechnicianId,
                        principalTable: "Technicians",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Activities_CorrelationId",
                table: "Activities",
                column: "CorrelationId");

            migrationBuilder.CreateIndex(
                name: "IX_Activities_CreatedAt",
                table: "Activities",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Activities_ServiceId",
                table: "Activities",
                column: "ServiceId");

            migrationBuilder.CreateIndex(
                name: "IX_Activities_Type",
                table: "Activities",
                column: "Type");

            migrationBuilder.CreateIndex(
                name: "IX_InstallationTasks_AssignedTechnicianId",
                table: "InstallationTasks",
                column: "AssignedTechnicianId");

            migrationBuilder.CreateIndex(
                name: "IX_InstallationTasks_PlannedAt",
                table: "InstallationTasks",
                column: "PlannedAt");

            migrationBuilder.CreateIndex(
                name: "IX_InstallationTasks_ServiceId",
                table: "InstallationTasks",
                column: "ServiceId");

            migrationBuilder.CreateIndex(
                name: "IX_InstallationTasks_Status",
                table: "InstallationTasks",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Activities");

            migrationBuilder.DropTable(
                name: "InstallationTasks");

            migrationBuilder.DropColumn(
                name: "CanInstall",
                table: "Technicians");
        }
    }
}
