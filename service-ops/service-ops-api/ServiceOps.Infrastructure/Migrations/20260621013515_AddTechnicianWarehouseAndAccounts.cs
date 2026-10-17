using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTechnicianWarehouseAndAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BankAccountId",
                table: "Technicians",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankAccountName",
                table: "Technicians",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CashAccountId",
                table: "Technicians",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CashAccountName",
                table: "Technicians",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PosAccountId",
                table: "Technicians",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PosAccountName",
                table: "Technicians",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WarehouseCode",
                table: "Technicians",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WarehouseName",
                table: "Technicians",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BankAccountId",
                table: "Technicians");

            migrationBuilder.DropColumn(
                name: "BankAccountName",
                table: "Technicians");

            migrationBuilder.DropColumn(
                name: "CashAccountId",
                table: "Technicians");

            migrationBuilder.DropColumn(
                name: "CashAccountName",
                table: "Technicians");

            migrationBuilder.DropColumn(
                name: "PosAccountId",
                table: "Technicians");

            migrationBuilder.DropColumn(
                name: "PosAccountName",
                table: "Technicians");

            migrationBuilder.DropColumn(
                name: "WarehouseCode",
                table: "Technicians");

            migrationBuilder.DropColumn(
                name: "WarehouseName",
                table: "Technicians");
        }
    }
}
