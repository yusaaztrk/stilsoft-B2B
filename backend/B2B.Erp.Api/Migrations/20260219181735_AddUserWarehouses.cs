using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddUserWarehouses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UserWarehouses",
                columns: table => new
                {
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    WarehouseCode = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserWarehouses", x => new { x.UserId, x.WarehouseCode });
                    table.ForeignKey(
                        name: "FK_UserWarehouses_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserWarehouses_Warehouses_WarehouseCode",
                        column: x => x.WarehouseCode,
                        principalTable: "Warehouses",
                        principalColumn: "WarehouseCode",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserWarehouses_WarehouseCode",
                table: "UserWarehouses",
                column: "WarehouseCode");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserWarehouses");
        }
    }
}
