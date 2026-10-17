using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations;

public partial class AddCashAdvanceSalaryDeduction : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>(
            name: "DeductFromSalary",
            table: "EmployeePayments",
            type: "boolean",
            nullable: false,
            defaultValue: false);

        migrationBuilder.AddColumn<DateTime>(
            name: "SalaryDeductedAt",
            table: "EmployeePayments",
            type: "timestamp with time zone",
            nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "DeductFromSalary",
            table: "EmployeePayments");

        migrationBuilder.DropColumn(
            name: "SalaryDeductedAt",
            table: "EmployeePayments");
    }
}
