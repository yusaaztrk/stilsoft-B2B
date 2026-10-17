using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class ProformaUpdate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SourceCustomerOfferId",
                table: "Invoices",
                type: "integer",
                nullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "SalesOrderLineId",
                table: "InvoiceLines",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_SourceCustomerOfferId",
                table: "Invoices",
                column: "SourceCustomerOfferId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Invoices_SourceCustomerOfferId",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "SourceCustomerOfferId",
                table: "Invoices");

            migrationBuilder.AlterColumn<int>(
                name: "SalesOrderLineId",
                table: "InvoiceLines",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);
        }
    }
}
