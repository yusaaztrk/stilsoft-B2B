using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPaymentCurrencyToCustomerLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Columns are already applied via SQL (migration failed on Pages seed but column DDL succeeded)
            // This migration only marks completion in __EFMigrationsHistory
            migrationBuilder.Sql(
                "ALTER TABLE \"CustomerLedgerEntries\" ADD COLUMN IF NOT EXISTS \"PaymentCurrencyAmount\" numeric NOT NULL DEFAULT 0;" +
                " ALTER TABLE \"CustomerLedgerEntries\" ADD COLUMN IF NOT EXISTS \"PaymentCurrencyRate\" numeric NOT NULL DEFAULT 0;" +
                " ALTER TABLE \"CustomerLedgerEntries\" ADD COLUMN IF NOT EXISTS \"PaymentCurrencyTypeId\" integer NOT NULL DEFAULT 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PaymentCurrencyAmount",
                table: "CustomerLedgerEntries");

            migrationBuilder.DropColumn(
                name: "PaymentCurrencyRate",
                table: "CustomerLedgerEntries");

            migrationBuilder.DropColumn(
                name: "PaymentCurrencyTypeId",
                table: "CustomerLedgerEntries");
        }
    }
}
