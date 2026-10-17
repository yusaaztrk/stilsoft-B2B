using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCampaignConditionRangeModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CategoryCode",
                table: "CampaignConditions",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Maximum",
                table: "CampaignConditions",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Metric",
                table: "CampaignConditions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Minimum",
                table: "CampaignConditions",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProductStockCodesJson",
                table: "CampaignConditions",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CategoryCode",
                table: "CampaignConditions");

            migrationBuilder.DropColumn(
                name: "Maximum",
                table: "CampaignConditions");

            migrationBuilder.DropColumn(
                name: "Metric",
                table: "CampaignConditions");

            migrationBuilder.DropColumn(
                name: "Minimum",
                table: "CampaignConditions");

            migrationBuilder.DropColumn(
                name: "ProductStockCodesJson",
                table: "CampaignConditions");
        }
    }
}
