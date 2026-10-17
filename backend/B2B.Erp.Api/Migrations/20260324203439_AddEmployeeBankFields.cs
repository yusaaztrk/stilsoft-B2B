using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddEmployeeBankFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""BankName"" character varying(120) NULL;
ALTER TABLE ""Employees"" ADD COLUMN IF NOT EXISTS ""Iban"" character varying(34) NULL;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""Employees"" DROP COLUMN IF EXISTS ""BankName"";
ALTER TABLE ""Employees"" DROP COLUMN IF EXISTS ""Iban"";
");
        }
    }
}
