using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBsyPermissionsPages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
VALUES (300, 'BSY(H): Ürünü Gösterme', TRUE, 'bsyHHide', 'invoice', 102)
ON CONFLICT (""Id"") DO NOTHING;

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
VALUES (301, 'BSY(H): ComingSoon ile Göster', TRUE, 'bsyHComingSoon', 'invoice', 103)
ON CONFLICT (""Id"") DO NOTHING;
" );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DELETE FROM ""Pages"" WHERE ""Id"" IN (300, 301);
" );
        }
    }
}
