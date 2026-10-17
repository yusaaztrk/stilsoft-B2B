using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddProforma : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ProformaDocumentNo",
                table: "CustomerOffers",
                type: "character varying(15)",
                maxLength: 15,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "NumberSeries",
                columns: table => new
                {
                    Key = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    LastValue = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NumberSeries", x => x.Key);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerOffers_ProformaDocumentNo",
                table: "CustomerOffers",
                column: "ProformaDocumentNo",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NumberSeries");

            migrationBuilder.DropIndex(
                name: "IX_CustomerOffers_ProformaDocumentNo",
                table: "CustomerOffers");

            migrationBuilder.DropColumn(
                name: "ProformaDocumentNo",
                table: "CustomerOffers");
        }
    }
}
