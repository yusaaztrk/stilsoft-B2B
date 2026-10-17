using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations;

[DbContext(typeof(B2B.Erp.Api.Data.AppDbContext))]
[Migration("20260412180000_AddEmployeeMealAmount")]
public partial class AddEmployeeMealAmount : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(@"
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""MealAmount"" numeric(18,2) NOT NULL DEFAULT 0.0;
");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(@"
ALTER TABLE ""Employees"" DROP COLUMN IF EXISTS ""MealAmount"";
");
    }
}
