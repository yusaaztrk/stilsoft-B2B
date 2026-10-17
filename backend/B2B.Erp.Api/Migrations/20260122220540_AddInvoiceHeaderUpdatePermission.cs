using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInvoiceHeaderUpdatePermission : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "INSERT INTO \"Pages\" (\"Id\", \"DisplayName\", \"IsActive\", \"Key\", \"ModuleKey\", \"SortOrder\") " +
                "VALUES (100, 'Üst Bilgi Güncelle', TRUE, 'faturaDokumUstBilgiGuncelle', 'invoice', 100) " +
                "ON CONFLICT (\"ModuleKey\", \"Key\") DO NOTHING;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "DELETE FROM \"Pages\" WHERE \"ModuleKey\" = 'invoice' AND \"Key\" = 'faturaDokumUstBilgiGuncelle';");
        }
    }
}
