using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class PurchaseToInnovice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "DeliveryCompletedDate",
                table: "PurchaseInvoiceLines",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeliveryDispatchDate",
                table: "PurchaseInvoiceLines",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DeliveryStatus",
                table: "PurchaseInvoiceLines",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeliveryTeam",
                table: "PurchaseInvoiceLines",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeliveryCompletedDate",
                table: "PurchaseInvoiceLines");

            migrationBuilder.DropColumn(
                name: "DeliveryDispatchDate",
                table: "PurchaseInvoiceLines");

            migrationBuilder.DropColumn(
                name: "DeliveryStatus",
                table: "PurchaseInvoiceLines");

            migrationBuilder.DropColumn(
                name: "DeliveryTeam",
                table: "PurchaseInvoiceLines");
        }
    }
}
