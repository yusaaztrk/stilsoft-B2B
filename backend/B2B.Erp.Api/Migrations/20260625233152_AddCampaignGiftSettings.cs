using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCampaignGiftSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"Campaigns\" DROP CONSTRAINT IF EXISTS \"FK_Campaigns_Products_BuyProductId\";");
            migrationBuilder.Sql("ALTER TABLE \"Campaigns\" DROP CONSTRAINT IF EXISTS \"FK_Campaigns_Products_GiftProductId\";");
            migrationBuilder.Sql("DROP TABLE IF EXISTS \"CampaignBuyRules\";");
            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_Campaigns_BuyProductId\";");
            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_Campaigns_GiftProductId\";");
            migrationBuilder.Sql("ALTER TABLE \"Campaigns\" DROP COLUMN IF EXISTS \"BuyProductId\";");
            migrationBuilder.Sql("ALTER TABLE \"Campaigns\" DROP COLUMN IF EXISTS \"GiftProductId\";");
            migrationBuilder.Sql("ALTER TABLE \"Campaigns\" DROP COLUMN IF EXISTS \"GiftQuantity\";");
            migrationBuilder.Sql("ALTER TABLE \"Campaigns\" DROP COLUMN IF EXISTS \"IsRepeatable\";");
            migrationBuilder.Sql("ALTER TABLE \"Campaigns\" DROP COLUMN IF EXISTS \"TriggerQuantity\";");

            migrationBuilder.AddColumn<int>(
                name: "CampaignGiftAccountingMode",
                table: "JwtSessionSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<decimal>(
                name: "CampaignGiftSymbolicPrice",
                table: "JwtSessionSettings",
                type: "numeric",
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CampaignGiftAccountingMode",
                table: "JwtSessionSettings");

            migrationBuilder.DropColumn(
                name: "CampaignGiftSymbolicPrice",
                table: "JwtSessionSettings");

            migrationBuilder.AddColumn<Guid>(
                name: "BuyProductId",
                table: "Campaigns",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "GiftProductId",
                table: "Campaigns",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "GiftQuantity",
                table: "Campaigns",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<bool>(
                name: "IsRepeatable",
                table: "Campaigns",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "TriggerQuantity",
                table: "Campaigns",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateTable(
                name: "CampaignBuyRules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    RequiredQuantity = table.Column<int>(type: "integer", nullable: false, defaultValue: 1)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CampaignBuyRules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CampaignBuyRules_Campaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "Campaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CampaignBuyRules_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Campaigns_BuyProductId",
                table: "Campaigns",
                column: "BuyProductId");

            migrationBuilder.CreateIndex(
                name: "IX_Campaigns_GiftProductId",
                table: "Campaigns",
                column: "GiftProductId");

            migrationBuilder.CreateIndex(
                name: "IX_CampaignBuyRules_CampaignId",
                table: "CampaignBuyRules",
                column: "CampaignId");

            migrationBuilder.CreateIndex(
                name: "IX_CampaignBuyRules_ProductId",
                table: "CampaignBuyRules",
                column: "ProductId");

            migrationBuilder.AddForeignKey(
                name: "FK_Campaigns_Products_BuyProductId",
                table: "Campaigns",
                column: "BuyProductId",
                principalTable: "Products",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Campaigns_Products_GiftProductId",
                table: "Campaigns",
                column: "GiftProductId",
                principalTable: "Products",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
