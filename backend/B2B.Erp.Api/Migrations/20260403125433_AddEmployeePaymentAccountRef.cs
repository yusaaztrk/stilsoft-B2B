using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddEmployeePaymentAccountRef : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"EmployeePayments\" ADD COLUMN IF NOT EXISTS \"BankAccountDefinitionId\" integer;");
            migrationBuilder.Sql("ALTER TABLE \"EmployeePayments\" ADD COLUMN IF NOT EXISTS \"CashAccountId\" integer;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "BankAccountDefinitionId", table: "EmployeePayments");
            migrationBuilder.DropColumn(name: "CashAccountId", table: "EmployeePayments");
        }
    }
}
