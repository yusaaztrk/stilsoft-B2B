using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTerminStatusToPurchaseInvoices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Use raw SQL with IF NOT EXISTS so this migration is idempotent for tenant DBs
            // that may already have some of these columns created via raw SQL provisioning.
            migrationBuilder.Sql(@"
ALTER TABLE ""PurchaseInvoices"" ADD COLUMN IF NOT EXISTS ""TerminStatus"" integer NOT NULL DEFAULT 0;

ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkPermitRenewalFee"" numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkType"" character varying(80) NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'EmployeeCheckIns'
  ) THEN
    ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutLatitude"" numeric(9,6) NOT NULL DEFAULT 0;
    ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutLongitude"" numeric(9,6) NOT NULL DEFAULT 0;
    ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutTime"" timestamp with time zone NULL;
  END IF;
END $$;

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 105, 'Termin', TRUE, 'termin', 'invoice', 14
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 105);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM ""Pages"" WHERE ""Id"" = 105;

ALTER TABLE ""PurchaseInvoices"" DROP COLUMN IF EXISTS ""TerminStatus"";
ALTER TABLE ""Employees"" DROP COLUMN IF EXISTS ""WorkPermitRenewalFee"";
ALTER TABLE ""Employees"" DROP COLUMN IF EXISTS ""WorkType"";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'EmployeeCheckIns'
  ) THEN
    ALTER TABLE ""EmployeeCheckIns"" DROP COLUMN IF EXISTS ""CheckOutLatitude"";
    ALTER TABLE ""EmployeeCheckIns"" DROP COLUMN IF EXISTS ""CheckOutLongitude"";
    ALTER TABLE ""EmployeeCheckIns"" DROP COLUMN IF EXISTS ""CheckOutTime"";
  END IF;
END $$;
");
        }
    }
}
