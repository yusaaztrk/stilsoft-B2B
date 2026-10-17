using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace B2B.Erp.Api.Data.Migrations.Master
{
    /// <inheritdoc />
    public partial class Master_UserTenant_Link : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_GlobalUsers_Tenants_TenantId",
                table: "GlobalUsers");

            migrationBuilder.DropIndex(
                name: "IX_GlobalUsers_TenantId",
                table: "GlobalUsers");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "GlobalUsers");

            migrationBuilder.CreateTable(
                name: "GlobalUserTenants",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    GlobalUserId = table.Column<int>(type: "integer", nullable: false),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GlobalUserTenants", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GlobalUserTenants_GlobalUsers_GlobalUserId",
                        column: x => x.GlobalUserId,
                        principalTable: "GlobalUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GlobalUserTenants_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GlobalUserTenants_GlobalUserId_TenantId",
                table: "GlobalUserTenants",
                columns: new[] { "GlobalUserId", "TenantId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GlobalUserTenants_TenantId",
                table: "GlobalUserTenants",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GlobalUserTenants");

            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "GlobalUsers",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_GlobalUsers_TenantId",
                table: "GlobalUsers",
                column: "TenantId");

            migrationBuilder.AddForeignKey(
                name: "FK_GlobalUsers_Tenants_TenantId",
                table: "GlobalUsers",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
