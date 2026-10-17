using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInvoiceDepoStockPage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Previous attempt of this migration could have partially updated RolePagePermissions by Id.
            // Revert those two rows back to their original PageIds if needed.
            migrationBuilder.Sql(@"
UPDATE ""RolePagePermissions"" SET ""PageId"" = 14
WHERE ""Id"" = 15 AND ""RoleId"" = 1 AND ""PageId"" = 102
  AND NOT EXISTS (SELECT 1 FROM ""RolePagePermissions"" x WHERE x.""RoleId"" = 1 AND x.""PageId"" = 14);

UPDATE ""RolePagePermissions"" SET ""PageId"" = 15
WHERE ""Id"" = 16 AND ""RoleId"" = 1 AND ""PageId"" = 14
  AND NOT EXISTS (SELECT 1 FROM ""RolePagePermissions"" x WHERE x.""RoleId"" = 1 AND x.""PageId"" = 15);
" );

            // Ensure page exists (idempotent)
            migrationBuilder.Sql(@"
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
VALUES (102, 'Depo Stok Durumu', TRUE, 'depoStock', 'invoice', 11)
ON CONFLICT (""Id"") DO NOTHING;
" );

            // Seed default permissions for the new page (idempotent)
            migrationBuilder.Sql(@"
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""RoleId"", 102, TRUE
FROM (
  SELECT unnest(ARRAY[1,2,3,6,8,9,10,12])::int AS ""RoleId""
) r
WHERE NOT EXISTS (
  SELECT 1 FROM ""RolePagePermissions"" rp
  WHERE rp.""RoleId"" = r.""RoleId"" AND rp.""PageId"" = 102
);
" );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM ""RolePagePermissions"" WHERE ""PageId"" = 102;
DELETE FROM ""Pages"" WHERE ""Id"" = 102;
" );
        }
    }
}
