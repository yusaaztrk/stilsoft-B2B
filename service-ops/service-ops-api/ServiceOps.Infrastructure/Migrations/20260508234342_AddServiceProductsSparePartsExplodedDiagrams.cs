using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceProductsSparePartsExplodedDiagrams : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ServiceProducts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantCode = table.Column<string>(type: "text", nullable: true),
                    Name = table.Column<string>(type: "text", nullable: false),
                    StockCode = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceProducts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ExplodedDiagrams",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantCode = table.Column<string>(type: "text", nullable: true),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    FileName = table.Column<string>(type: "text", nullable: false),
                    ContentType = table.Column<string>(type: "text", nullable: false),
                    StoragePath = table.Column<string>(type: "text", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    UploadedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExplodedDiagrams", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ExplodedDiagrams_ServiceProducts_ProductId",
                        column: x => x.ProductId,
                        principalTable: "ServiceProducts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SpareParts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantCode = table.Column<string>(type: "text", nullable: true),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    PartNumber = table.Column<string>(type: "text", nullable: true),
                    StockQuantity = table.Column<int>(type: "integer", nullable: false),
                    MinStockLevel = table.Column<int>(type: "integer", nullable: false),
                    ExplodedViewPartNumber = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SpareParts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SpareParts_ServiceProducts_ProductId",
                        column: x => x.ProductId,
                        principalTable: "ServiceProducts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ExplodedDiagrams_ProductId",
                table: "ExplodedDiagrams",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "IX_ExplodedDiagrams_TenantCode",
                table: "ExplodedDiagrams",
                column: "TenantCode");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceProducts_TenantCode",
                table: "ServiceProducts",
                column: "TenantCode");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceProducts_TenantCode_Name",
                table: "ServiceProducts",
                columns: new[] { "TenantCode", "Name" });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceProducts_TenantCode_StockCode",
                table: "ServiceProducts",
                columns: new[] { "TenantCode", "StockCode" });

            migrationBuilder.CreateIndex(
                name: "IX_SpareParts_ProductId",
                table: "SpareParts",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "IX_SpareParts_TenantCode",
                table: "SpareParts",
                column: "TenantCode");

            migrationBuilder.CreateIndex(
                name: "IX_SpareParts_TenantCode_ProductId_ExplodedViewPartNumber",
                table: "SpareParts",
                columns: new[] { "TenantCode", "ProductId", "ExplodedViewPartNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_SpareParts_TenantCode_ProductId_Name",
                table: "SpareParts",
                columns: new[] { "TenantCode", "ProductId", "Name" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ExplodedDiagrams");

            migrationBuilder.DropTable(
                name: "SpareParts");

            migrationBuilder.DropTable(
                name: "ServiceProducts");
        }
    }
}
