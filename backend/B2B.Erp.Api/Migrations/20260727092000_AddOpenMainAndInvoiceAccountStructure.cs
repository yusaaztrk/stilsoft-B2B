using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddOpenMainAndInvoiceAccountStructure : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AccountRole",
                table: "Customers",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "NORMAL");

            migrationBuilder.AddColumn<string>(
                name: "MainCustomerCode",
                table: "Customers",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Customers_MainCustomerCode",
                table: "Customers",
                column: "MainCustomerCode",
                unique: true,
                filter: "\"MainCustomerCode\" IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_Customers_Customers_MainCustomerCode",
                table: "Customers",
                column: "MainCustomerCode",
                principalTable: "Customers",
                principalColumn: "CustomerCode",
                onDelete: ReferentialAction.Restrict);

            // Backfill Data Script
            migrationBuilder.Sql(@"
                -- 1. Classify existing open main customers
                UPDATE ""Customers""
                SET ""AccountRole"" = 'OPEN_MAIN', ""InvoiceType"" = 'ACIK'
                WHERE ""InvoiceType"" = 'ACIK' OR ""PriceGroupId"" IN (
                    SELECT ""Id"" FROM ""PriceGroups"" WHERE ""Code"" IN (4, 5, 6)
                );

                -- 2. Create linked invoice accounts for existing OPEN_MAIN customers
                INSERT INTO ""Customers"" (
                    ""CustomerCode"", ""Name"", ""Address"", ""City"", ""District"", ""Phone"", ""Fax"", ""Email"",
                    ""TaxOffice"", ""TaxNumber"", ""IdentityNumber"", ""CustomerType"", ""InvoiceType"", ""AccountRole"",
                    ""MainCustomerCode"", ""ProductCategory"", ""IsActive"", ""PriceGroupId"", ""DiscountRate"",
                    ""SalesmanCode"", ""CreditLimit"", ""ParentCustomerCode"", ""CurrencyTypeId"", ""CreateUser"", ""CreateTime""
                )
                SELECT 
                    c.""CustomerCode"" || '-1',
                    c.""Name"" || ' (Fatura Hesabı)',
                    c.""Address"", c.""City"", c.""District"", c.""Phone"", c.""Fax"", c.""Email"",
                    c.""TaxOffice"", c.""TaxNumber"", c.""IdentityNumber"", c.""CustomerType"", 'FATURA', 'INVOICE_ACCOUNT',
                    c.""CustomerCode"", c.""ProductCategory"", c.""IsActive"",
                    (
                        SELECT pg_target.""Id"" 
                        FROM ""PriceGroups"" pg_src
                        JOIN ""PriceGroups"" pg_target ON (
                            (pg_src.""Code"" = 4 AND pg_target.""Code"" = 1) OR
                            (pg_src.""Code"" = 5 AND pg_target.""Code"" = 2) OR
                            (pg_src.""Code"" = 6 AND pg_target.""Code"" = 3)
                        )
                        WHERE pg_src.""Id"" = c.""PriceGroupId"" AND pg_target.""IsActive"" = true
                        LIMIT 1
                    ),
                    c.""DiscountRate"", c.""SalesmanCode"", c.""CreditLimit"", c.""ParentCustomerCode"", c.""CurrencyTypeId"",
                    c.""CreateUser"", NOW()
                FROM ""Customers"" c
                WHERE c.""AccountRole"" = 'OPEN_MAIN'
                ON CONFLICT (""CustomerCode"") DO NOTHING;

                -- 3. Migrate past invoiced sales of OPEN_MAIN customers to their linked invoice accounts
                UPDATE ""Invoices"" i
                SET ""CustomerCode"" = i.""CustomerCode"" || '-1'
                FROM ""Customers"" c
                WHERE i.""CustomerCode"" = c.""CustomerCode""
                  AND c.""AccountRole"" = 'OPEN_MAIN'
                  AND i.""CustomerInvoiceTypeOverride"" = 'FATURA';

                -- 4. Sync StockMovements for migrated invoices
                UPDATE ""StockMovements"" sm
                SET ""CustomerCode"" = i.""CustomerCode""
                FROM ""Invoices"" i
                WHERE sm.""InvoiceNo"" = i.""InvoiceNo""
                  AND i.""CustomerInvoiceTypeOverride"" = 'FATURA'
                  AND i.""CustomerCode"" LIKE '%-1';

                -- 5. Sync CustomerLedgerEntries for migrated invoices
                UPDATE ""CustomerLedgerEntries"" cle
                SET ""CustomerCode"" = i.""CustomerCode""
                FROM ""Invoices"" i
                WHERE cle.""ReferenceType"" = 0 -- Invoice reference
                  AND cle.""ReferenceId"" = i.""Id""
                  AND i.""CustomerInvoiceTypeOverride"" = 'FATURA'
                  AND i.""CustomerCode"" LIKE '%-1';
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Customers_Customers_MainCustomerCode",
                table: "Customers");

            migrationBuilder.DropIndex(
                name: "IX_Customers_MainCustomerCode",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "AccountRole",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "MainCustomerCode",
                table: "Customers");
        }
    }
}
