using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddLinkedBankAccountTransactionIdToCashAccountTransactions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CustomerChecks_VBordroNo",
                table: "CustomerChecks");

            migrationBuilder.Sql("ALTER TABLE \"Installations\" ADD COLUMN IF NOT EXISTS \"DealerCode\" character varying(50);");
            migrationBuilder.Sql("ALTER TABLE \"Installations\" ADD COLUMN IF NOT EXISTS \"PlannedDateUtc\" timestamp with time zone;");
            migrationBuilder.Sql("ALTER TABLE \"Installations\" ADD COLUMN IF NOT EXISTS \"Status\" character varying(30) NOT NULL DEFAULT '';");
            migrationBuilder.Sql("ALTER TABLE \"Installations\" ADD COLUMN IF NOT EXISTS \"Technician\" character varying(100);");
            migrationBuilder.Sql("ALTER TABLE \"Installations\" ADD COLUMN IF NOT EXISTS \"Type\" character varying(20) NOT NULL DEFAULT '';");

            migrationBuilder.Sql("ALTER TABLE \"Employees\" ADD COLUMN IF NOT EXISTS \"MealAmount\" numeric(18,2) NOT NULL DEFAULT 0.0;");

            migrationBuilder.Sql("ALTER TABLE \"Employees\" ADD COLUMN IF NOT EXISTS \"Password\" text;");
            migrationBuilder.Sql("ALTER TABLE \"Employees\" ADD COLUMN IF NOT EXISTS \"Username\" text;");
            migrationBuilder.Sql("ALTER TABLE \"EmployeePayments\" ADD COLUMN IF NOT EXISTS \"DeductFromSalary\" boolean NOT NULL DEFAULT FALSE;");
            migrationBuilder.Sql("ALTER TABLE \"EmployeePayments\" ADD COLUMN IF NOT EXISTS \"SalaryDeductedAt\" timestamp with time zone;");
            migrationBuilder.Sql("ALTER TABLE \"CashAccountTransactions\" ADD COLUMN IF NOT EXISTS \"LinkedBankAccountTransactionId\" integer;");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerChecks_VBordroNo",
                table: "CustomerChecks",
                column: "VBordroNo");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CustomerChecks_VBordroNo",
                table: "CustomerChecks");

            migrationBuilder.DropColumn(
                name: "DealerCode",
                table: "Installations");

            migrationBuilder.DropColumn(
                name: "PlannedDateUtc",
                table: "Installations");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "Installations");

            migrationBuilder.DropColumn(
                name: "Technician",
                table: "Installations");

            migrationBuilder.DropColumn(
                name: "Type",
                table: "Installations");

            migrationBuilder.DropColumn(
                name: "MealAmount",
                table: "Employees");

            migrationBuilder.DropColumn(
                name: "Password",
                table: "Employees");

            migrationBuilder.DropColumn(
                name: "Username",
                table: "Employees");

            migrationBuilder.DropColumn(
                name: "DeductFromSalary",
                table: "EmployeePayments");

            migrationBuilder.DropColumn(
                name: "SalaryDeductedAt",
                table: "EmployeePayments");

            migrationBuilder.DropColumn(
                name: "LinkedBankAccountTransactionId",
                table: "CashAccountTransactions");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerChecks_VBordroNo",
                table: "CustomerChecks",
                column: "VBordroNo",
                unique: true);
        }
    }
}
