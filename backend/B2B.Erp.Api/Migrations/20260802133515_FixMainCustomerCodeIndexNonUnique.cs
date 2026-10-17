using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class FixMainCustomerCodeIndexNonUnique : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Customers_MainCustomerCode",
                table: "Customers");

            migrationBuilder.CreateIndex(
                name: "IX_Customers_MainCustomerCode",
                table: "Customers",
                column: "MainCustomerCode",
                unique: false,
                filter: "\"MainCustomerCode\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Customers_MainCustomerCode",
                table: "Customers");

            migrationBuilder.CreateIndex(
                name: "IX_Customers_MainCustomerCode",
                table: "Customers",
                column: "MainCustomerCode",
                unique: true,
                filter: "\"MainCustomerCode\" IS NOT NULL");
        }
    }
}
