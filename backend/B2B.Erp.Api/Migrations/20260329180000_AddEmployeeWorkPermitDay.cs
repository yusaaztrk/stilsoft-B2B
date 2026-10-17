using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;
using B2B.Erp.Api.Data;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260329180000_AddEmployeeWorkPermitDay")]
    public partial class AddEmployeeWorkPermitDay : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""WorkPermitDay"" timestamp with time zone NULL;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""Employees"" DROP COLUMN IF EXISTS ""WorkPermitDay"";
");
        }
    }
}
