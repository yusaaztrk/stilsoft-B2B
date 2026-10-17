using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCariOffersAndBayiMuhtelif : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Employees'
  ) THEN
    ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""EmployeeCode"" character varying(20) NOT NULL DEFAULT '';
    ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Salary"" integer NOT NULL DEFAULT 0;
    ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""SalaryDay"" integer NOT NULL DEFAULT 1;

    CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_EmployeeCode"" ON ""Employees"" (""EmployeeCode"");
  END IF;
END $$;
");

            migrationBuilder.CreateTable(
                name: "BayiMuhtelifCustomers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    OwnerCustomerCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CustomerCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    City = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    District = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Address = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Phone = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    TaxOffice = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    TaxNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BayiMuhtelifCustomers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CariOffers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DocumentNo = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: false),
                    ProformaDocumentNo = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: true),
                    Date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CustomerCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    BayiMuhtelifCustomerId = table.Column<int>(type: "integer", nullable: true),
                    VatExempt = table.Column<bool>(type: "boolean", nullable: false),
                    Subtotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    DiscountTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    NetTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    VatTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    GrandTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    InvoiceId = table.Column<int>(type: "integer", nullable: true),
                    InvoiceNo = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: true),
                    SalesmanCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CariOffers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CariOffers_BayiMuhtelifCustomers_BayiMuhtelifCustomerId",
                        column: x => x.BayiMuhtelifCustomerId,
                        principalTable: "BayiMuhtelifCustomers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CariOfferLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CariOfferId = table.Column<int>(type: "integer", nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    StockCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false),
                    VatRate = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    DiscountType = table.Column<int>(type: "integer", nullable: false),
                    DiscountValue = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    LineNo = table.Column<int>(type: "integer", nullable: false),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CariOfferLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CariOfferLines_CariOffers_CariOfferId",
                        column: x => x.CariOfferId,
                        principalTable: "CariOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CariOfferLines_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BayiMuhtelifCustomers_CustomerCode",
                table: "BayiMuhtelifCustomers",
                column: "CustomerCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BayiMuhtelifCustomers_OwnerCustomerCode",
                table: "BayiMuhtelifCustomers",
                column: "OwnerCustomerCode");

            migrationBuilder.CreateIndex(
                name: "IX_CariOfferLines_CariOfferId_LineNo",
                table: "CariOfferLines",
                columns: new[] { "CariOfferId", "LineNo" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CariOfferLines_ProductId",
                table: "CariOfferLines",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "IX_CariOffers_BayiMuhtelifCustomerId",
                table: "CariOffers",
                column: "BayiMuhtelifCustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_CariOffers_DocumentNo",
                table: "CariOffers",
                column: "DocumentNo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CariOffers_ProformaDocumentNo",
                table: "CariOffers",
                column: "ProformaDocumentNo",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CariOfferLines");

            migrationBuilder.DropTable(
                name: "CariOffers");

            migrationBuilder.DropTable(
                name: "BayiMuhtelifCustomers");

            migrationBuilder.Sql(@"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Employees'
  ) THEN
    DROP INDEX IF EXISTS ""IX_Employees_EmployeeCode"";
    ALTER TABLE ""Employees"" DROP COLUMN IF EXISTS ""EmployeeCode"";
    ALTER TABLE ""Employees"" DROP COLUMN IF EXISTS ""Salary"";
    ALTER TABLE ""Employees"" DROP COLUMN IF EXISTS ""SalaryDay"";
  END IF;
END $$;
");
        }
    }
}
