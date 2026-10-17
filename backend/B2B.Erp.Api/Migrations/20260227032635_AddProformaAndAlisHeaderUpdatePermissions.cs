using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddProformaAndAlisHeaderUpdatePermissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "DELETE FROM \"Pages\" WHERE \"ModuleKey\" = 'invoice' AND \"Key\" IN ('proformaUstBilgiGuncelle', 'alisUstBilgiGuncelle');"
            );

            migrationBuilder.Sql(
                "INSERT INTO \"Pages\" (\"Id\", \"DisplayName\", \"IsActive\", \"Key\", \"ModuleKey\", \"SortOrder\") " +
                "VALUES (102, 'Üst Bilgi Güncelle (Proforma)', TRUE, 'proformaUstBilgiGuncelle', 'invoice', 105) " +
                "ON CONFLICT (\"Id\") DO UPDATE SET " +
                "\"DisplayName\" = EXCLUDED.\"DisplayName\", " +
                "\"IsActive\" = EXCLUDED.\"IsActive\", " +
                "\"SortOrder\" = EXCLUDED.\"SortOrder\";"
            );

            migrationBuilder.Sql(
                "INSERT INTO \"Pages\" (\"Id\", \"DisplayName\", \"IsActive\", \"Key\", \"ModuleKey\", \"SortOrder\") " +
                "VALUES (103, 'Üst Bilgi Güncelle (Alış)', TRUE, 'alisUstBilgiGuncelle', 'invoice', 106) " +
                "ON CONFLICT (\"Id\") DO UPDATE SET " +
                "\"DisplayName\" = EXCLUDED.\"DisplayName\", " +
                "\"IsActive\" = EXCLUDED.\"IsActive\", " +
                "\"SortOrder\" = EXCLUDED.\"SortOrder\";"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "DELETE FROM \"Pages\" WHERE \"ModuleKey\" = 'invoice' AND \"Key\" = 'proformaUstBilgiGuncelle';"
            );

            migrationBuilder.Sql(
                "DELETE FROM \"Pages\" WHERE \"ModuleKey\" = 'invoice' AND \"Key\" = 'alisUstBilgiGuncelle';"
            );
        }
    }
}
