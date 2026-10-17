using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomerProductPriceOverrides : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CustomerProductPriceOverrides",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    PriceGroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    Price = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerProductPriceOverrides", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CustomerProductPriceOverrides_Customers_CustomerCode",
                        column: x => x.CustomerCode,
                        principalTable: "Customers",
                        principalColumn: "CustomerCode",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CustomerProductPriceOverrides_PriceGroups_PriceGroupId",
                        column: x => x.PriceGroupId,
                        principalTable: "PriceGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CustomerProductPriceOverrides_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerProductPriceOverrides_CustomerCode_ProductId_PriceG~",
                table: "CustomerProductPriceOverrides",
                columns: new[] { "CustomerCode", "ProductId", "PriceGroupId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CustomerProductPriceOverrides_PriceGroupId",
                table: "CustomerProductPriceOverrides",
                column: "PriceGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerProductPriceOverrides_ProductId",
                table: "CustomerProductPriceOverrides",
                column: "ProductId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CustomerProductPriceOverrides");
        }
    }
}
