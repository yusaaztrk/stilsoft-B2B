using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class FixBankHavaleEftPageKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- Ensure the bank page key exists
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 20001, 'Banka Havale/EFT', TRUE, 'bankaHavaleEft', 'bank', 1
WHERE NOT EXISTS (
    SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='bank' AND ""Key""='bankaHavaleEft'
);

-- Try to reuse legacy page rows if they exist
UPDATE ""Pages""
SET ""DisplayName""='Banka Havale/EFT', ""Key""='bankaHavaleEft', ""ModuleKey""='bank', ""SortOrder""=1, ""IsActive""=TRUE
WHERE ""ModuleKey""='bank' AND ""Key""='havaleEft'
  AND NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='bank' AND ""Key""='bankaHavaleEft');

-- Deactivate legacy bank pages (if present)
UPDATE ""Pages"" SET ""IsActive""=FALSE
WHERE ""ModuleKey""='bank' AND ""Key"" IN ('havaleEft','bankaHesaplari','bankaMaasBordrosu');

-- Grant access to common roles if not already granted
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", TRUE
FROM ""Roles"" r
CROSS JOIN (
  SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='bank' AND ""Key""='bankaHavaleEft'
) p
WHERE r.""Id"" IN (2,3,6,8,9,10,12)
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // No-op: drift fix migration
        }
    }
}
