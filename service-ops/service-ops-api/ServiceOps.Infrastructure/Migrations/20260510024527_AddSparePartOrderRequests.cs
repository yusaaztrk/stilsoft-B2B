using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSparePartOrderRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SparePartOrderRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantCode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TechnicianName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ErpProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    StockCode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PartName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    QuantityRequested = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SparePartOrderRequests", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SparePartOrderRequests_TenantCode_ErpProductId_Status",
                table: "SparePartOrderRequests",
                columns: new[] { "TenantCode", "ErpProductId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_SparePartOrderRequests_TenantCode_Status_CreatedAt",
                table: "SparePartOrderRequests",
                columns: new[] { "TenantCode", "Status", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SparePartOrderRequests");
        }
    }
}
