using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations;

[DbContext(typeof(B2B.Erp.Api.Data.AppDbContext))]
[Migration("20260626100000_AddEmployeeCheckInCheckOutLatLng")]
public partial class AddEmployeeCheckInCheckOutLatLng : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(@"
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutTime"" timestamp with time zone NULL;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutLatitude"" numeric(9,6) NOT NULL DEFAULT 0.0;
ALTER TABLE ""EmployeeCheckIns"" ADD COLUMN IF NOT EXISTS ""CheckOutLongitude"" numeric(9,6) NOT NULL DEFAULT 0.0;
");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(@"
ALTER TABLE ""EmployeeCheckIns"" DROP COLUMN IF EXISTS ""CheckOutLongitude"";
ALTER TABLE ""EmployeeCheckIns"" DROP COLUMN IF EXISTS ""CheckOutLatitude"";
ALTER TABLE ""EmployeeCheckIns"" DROP COLUMN IF EXISTS ""CheckOutTime"";
");
    }
}
