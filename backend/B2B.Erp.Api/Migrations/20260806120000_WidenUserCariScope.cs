using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <summary>
    /// Widens Users.Carikodu so it can hold a list of customer codes.
    ///
    /// The column was sized for a single code. Since the scope became a comma-separated list —
    /// so a user can be given a handful of customers, or a whole salesman's book at once — 50
    /// characters ran out after the third one. A single code is roughly fifteen characters and
    /// assigning a salesman routinely selects several hundred.
    ///
    /// Widening only; no existing value can fail to fit.
    /// </summary>
    public partial class WidenUserCariScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Carikodu",
                table: "Users",
                type: "character varying(8000)",
                maxLength: 8000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(50)",
                oldMaxLength: 50,
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Narrowing back would truncate every multi-customer scope into an invalid one, so
            // this is deliberately one-way.
        }
    }
}
