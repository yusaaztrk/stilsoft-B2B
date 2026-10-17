using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDealerContactFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DealerAddress",
                table: "ServiceRecords",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DealerPhone",
                table: "ServiceRecords",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DealerAddress",
                table: "ServiceRecords");

            migrationBuilder.DropColumn(
                name: "DealerPhone",
                table: "ServiceRecords");
        }
    }
}
