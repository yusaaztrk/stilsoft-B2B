using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddOrderAndInvoiceLineCurrencyFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"SalesOrderLines\" ADD COLUMN IF NOT EXISTS \"CurrencyTypeId\" integer NOT NULL DEFAULT 0;");
            migrationBuilder.Sql("ALTER TABLE \"SalesOrderLines\" ADD COLUMN IF NOT EXISTS \"CurrencyRate\" numeric(18,6) NOT NULL DEFAULT 1.0;");
            migrationBuilder.Sql("ALTER TABLE \"SalesOrderLines\" ADD COLUMN IF NOT EXISTS \"CurrencyUnitPrice\" numeric(18,2) NOT NULL DEFAULT 0.0;");

            migrationBuilder.Sql("ALTER TABLE \"InvoiceLines\" ADD COLUMN IF NOT EXISTS \"CurrencyTypeId\" integer NOT NULL DEFAULT 0;");
            migrationBuilder.Sql("ALTER TABLE \"InvoiceLines\" ADD COLUMN IF NOT EXISTS \"CurrencyRate\" numeric(18,6) NOT NULL DEFAULT 1.0;");
            migrationBuilder.Sql("ALTER TABLE \"InvoiceLines\" ADD COLUMN IF NOT EXISTS \"CurrencyUnitPrice\" numeric(18,2) NOT NULL DEFAULT 0.0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CurrencyRate",
                table: "SalesOrderLines");

            migrationBuilder.DropColumn(
                name: "CurrencyTypeId",
                table: "SalesOrderLines");

            migrationBuilder.DropColumn(
                name: "CurrencyUnitPrice",
                table: "SalesOrderLines");

            migrationBuilder.DropColumn(
                name: "CurrencyRate",
                table: "InvoiceLines");

            migrationBuilder.DropColumn(
                name: "CurrencyTypeId",
                table: "InvoiceLines");

            migrationBuilder.DropColumn(
                name: "CurrencyUnitPrice",
                table: "InvoiceLines");
        }
    }
}
