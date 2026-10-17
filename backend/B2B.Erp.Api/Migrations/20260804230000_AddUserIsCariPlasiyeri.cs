using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <summary>
    /// Flags the salesman that customers quote through on the customer-facing offer screen.
    ///
    /// That screen is shared by every cari, so it cannot show the internal salesman list: a
    /// customer would see every other salesman's code. Only accounts flagged here appear
    /// there, which lets one shared "cari plasiyeri" be defined per firm.
    ///
    /// Written by hand. Scaffolding a migration against this model also emits a large set of
    /// unrelated operations — including DROP COLUMN on Products.GroupCode/SubGroupCode —
    /// because the model snapshot has drifted from the schema the startup SQL maintains.
    /// </summary>
    public partial class AddUserIsCariPlasiyeri : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Existing users are not customer-facing salesmen; false is the accurate backfill.
            migrationBuilder.AddColumn<bool>(
                name: "IsCariPlasiyeri",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsCariPlasiyeri",
                table: "Users");
        }
    }
}
