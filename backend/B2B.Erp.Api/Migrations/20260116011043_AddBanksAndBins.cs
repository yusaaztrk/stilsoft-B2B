using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBanksAndBins : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Banks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CountryCode = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: false, defaultValue: "TR"),
                    Priority = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Banks", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "BankBins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BankId = table.Column<Guid>(type: "uuid", nullable: false),
                    Bin6 = table.Column<string>(type: "character varying(6)", maxLength: 6, nullable: false),
                    Priority = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BankBins", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BankBins_Banks_BankId",
                        column: x => x.BankId,
                        principalTable: "Banks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "Banks",
                columns: new[] { "Id", "CountryCode", "IsActive", "Name", "Priority" },
                values: new object[,]
                {
                    { new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "TR", true, "T.C. ZİRAAT BANKASI A.Ş.", 1 },
                    { new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "TR", true, "TÜRKİYE İŞ BANKASI A.Ş.", 2 },
                    { new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3"), "TR", true, "T. GARANTİ BANKASI A.Ş.", 3 },
                    { new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "TR", true, "HALK BANKASI", 4 },
                    { new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5"), "CY", true, "CREDITWEST BANK LTD.", 5 },
                    { new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6"), "CY", true, "K.T.KOOPMERKEZ BANKASI LTD.", 6 }
                });

            migrationBuilder.InsertData(
                table: "BankBins",
                columns: new[] { "Id", "BankId", "Bin6", "IsActive", "Priority" },
                values: new object[,]
                {
                    { new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc1"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "454671", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc2"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "552879", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc3"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3"), "450803", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc4"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "979203", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc5"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5"), "454360", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc6"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6"), "409070", true, 1 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_BankBins_BankId_Bin6",
                table: "BankBins",
                columns: new[] { "BankId", "Bin6" });

            migrationBuilder.CreateIndex(
                name: "IX_BankBins_Bin6_IsActive_Priority",
                table: "BankBins",
                columns: new[] { "Bin6", "IsActive", "Priority" });

            migrationBuilder.CreateIndex(
                name: "IX_Banks_IsActive_Priority",
                table: "Banks",
                columns: new[] { "IsActive", "Priority" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BankBins");

            migrationBuilder.DropTable(
                name: "Banks");
        }
    }
}
