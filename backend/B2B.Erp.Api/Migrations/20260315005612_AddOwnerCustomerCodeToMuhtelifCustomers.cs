using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddOwnerCustomerCodeToMuhtelifCustomers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OwnerCustomerCode",
                table: "MuhtelifCustomers",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_MuhtelifCustomers_OwnerCustomerCode",
                table: "MuhtelifCustomers",
                column: "OwnerCustomerCode");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_MuhtelifCustomers_OwnerCustomerCode",
                table: "MuhtelifCustomers");

            migrationBuilder.DropColumn(
                name: "OwnerCustomerCode",
                table: "MuhtelifCustomers");
        }
    }
}
