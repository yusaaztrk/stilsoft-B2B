using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCampaignDiscountToSalesOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CampaignDetailsJson",
                table: "SalesOrders",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CampaignDiscount",
                table: "SalesOrders",
                type: "numeric",
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CampaignDetailsJson",
                table: "SalesOrders");

            migrationBuilder.DropColumn(
                name: "CampaignDiscount",
                table: "SalesOrders");
        }
    }
}
