using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceCatalogAndPurchaseKinds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Kind",
                table: "PurchaseInvoices",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "ServiceCode",
                table: "PurchaseInvoices",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SupplierCode",
                table: "PurchaseInvoices",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "ProductId",
                table: "PurchaseInvoiceLines",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "CustomerInvoiceTypeOverride",
                table: "Invoices",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CustomerNameOverride",
                table: "Invoices",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SourcePurchaseInvoiceId",
                table: "Invoices",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SourcePurchaseInvoiceLineId",
                table: "InvoiceLines",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ServiceCatalogItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceCatalogItems", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_SourcePurchaseInvoiceId",
                table: "Invoices",
                column: "SourcePurchaseInvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceLines_SourcePurchaseInvoiceLineId",
                table: "InvoiceLines",
                column: "SourcePurchaseInvoiceLineId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceCatalogItems_Code",
                table: "ServiceCatalogItems",
                column: "Code",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ServiceCatalogItems");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_SourcePurchaseInvoiceId",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_InvoiceLines_SourcePurchaseInvoiceLineId",
                table: "InvoiceLines");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "PurchaseInvoices");

            migrationBuilder.DropColumn(
                name: "ServiceCode",
                table: "PurchaseInvoices");

            migrationBuilder.DropColumn(
                name: "SupplierCode",
                table: "PurchaseInvoices");

            migrationBuilder.DropColumn(
                name: "CustomerInvoiceTypeOverride",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "CustomerNameOverride",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "SourcePurchaseInvoiceId",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "SourcePurchaseInvoiceLineId",
                table: "InvoiceLines");

            migrationBuilder.AlterColumn<Guid>(
                name: "ProductId",
                table: "PurchaseInvoiceLines",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
