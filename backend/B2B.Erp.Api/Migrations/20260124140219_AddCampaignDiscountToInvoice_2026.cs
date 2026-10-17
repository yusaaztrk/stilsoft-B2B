using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCampaignDiscountToInvoice_2026 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CampaignDetailsJson",
                table: "Invoices",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CampaignDiscount",
                table: "Invoices",
                type: "numeric",
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CampaignDetailsJson",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "CampaignDiscount",
                table: "Invoices");
        }
    }
}
