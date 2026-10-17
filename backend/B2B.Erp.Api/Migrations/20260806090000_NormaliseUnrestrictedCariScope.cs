using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <summary>
    /// Makes "this user may see every customer" a single, explicit value.
    ///
    /// The scope lived in Users.Carikodu, where three states meant two things: '*' was
    /// unrestricted, a customer code restricted the user to that customer and its branches, and
    /// NULL or empty also meant unrestricted — the API skips the filter when there is no code.
    /// The user dialog surfaced the last one as a separate entry called "Sistem Varsayılanı",
    /// so the list appeared to offer two different permissions that behaved identically.
    ///
    /// This rewrites the implicit form to the explicit one. It is behaviour-preserving: both
    /// values already resolved to the same unfiltered query in CustomersController, so no user
    /// gains or loses access here.
    /// </summary>
    public partial class NormaliseUnrestrictedCariScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE ""Users""
                SET ""Carikodu"" = '*'
                WHERE ""Carikodu"" IS NULL OR btrim(""Carikodu"") = '';
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Deliberately not reversed. Going back would have to turn every '*' into NULL,
            // including the ones set explicitly before this ran, which loses the distinction
            // rather than restoring it — and both forms mean the same thing to the API anyway.
        }
    }
}
