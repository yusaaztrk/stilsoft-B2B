using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPriceGroupInvoiceType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "InvoiceType",
                table: "PriceGroups",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "FATURA");

            migrationBuilder.UpdateData(
                table: "PriceGroups",
                keyColumn: "Id",
                keyValue: new Guid("11111111-1111-1111-1111-111111111111"),
                column: "InvoiceType",
                value: "ACIK");

            migrationBuilder.UpdateData(
                table: "PriceGroups",
                keyColumn: "Id",
                keyValue: new Guid("22222222-2222-2222-2222-222222222222"),
                column: "InvoiceType",
                value: "ACIK");

            migrationBuilder.UpdateData(
                table: "PriceGroups",
                keyColumn: "Id",
                keyValue: new Guid("33333333-3333-3333-3333-333333333333"),
                column: "InvoiceType",
                value: "ACIK");

            migrationBuilder.UpdateData(
                table: "PriceGroups",
                keyColumn: "Id",
                keyValue: new Guid("44444444-4444-4444-4444-444444444444"),
                column: "InvoiceType",
                value: "FATURA");

            migrationBuilder.UpdateData(
                table: "PriceGroups",
                keyColumn: "Id",
                keyValue: new Guid("55555555-5555-5555-5555-555555555555"),
                column: "InvoiceType",
                value: "FATURA");

            migrationBuilder.UpdateData(
                table: "PriceGroups",
                keyColumn: "Id",
                keyValue: new Guid("66666666-6666-6666-6666-666666666666"),
                column: "InvoiceType",
                value: "FATURA");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "InvoiceType",
                table: "PriceGroups");
        }
    }
}
