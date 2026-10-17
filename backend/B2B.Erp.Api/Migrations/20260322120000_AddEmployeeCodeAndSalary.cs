using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    public partial class AddEmployeeCodeAndSalary : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE IF EXISTS public.""Employees""
  ADD COLUMN IF NOT EXISTS ""EmployeeCode"" character varying(20) NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS public.""Employees""
  ADD COLUMN IF NOT EXISTS ""Salary"" integer NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.""Employees""
  ADD COLUMN IF NOT EXISTS ""SalaryDay"" integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Employees_EmployeeCode"" ON public.""Employees"" (""EmployeeCode"");
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP INDEX IF EXISTS public.""IX_Employees_EmployeeCode"";

ALTER TABLE IF EXISTS public.""Employees"" DROP COLUMN IF EXISTS ""EmployeeCode"";
ALTER TABLE IF EXISTS public.""Employees"" DROP COLUMN IF EXISTS ""Salary"";
ALTER TABLE IF EXISTS public.""Employees"" DROP COLUMN IF EXISTS ""SalaryDay"";
");
        }
    }
}
