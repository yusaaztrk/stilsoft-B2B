using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddUserActivityLogs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UserActivityLogs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Username = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    UserDisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ModuleKey = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    PageKey = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ActionType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    RecordId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    DetailsJson = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserActivityLogs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserActivityLogs_ActionType",
                table: "UserActivityLogs",
                column: "ActionType");

            migrationBuilder.CreateIndex(
                name: "IX_UserActivityLogs_CreateTime",
                table: "UserActivityLogs",
                column: "CreateTime");

            migrationBuilder.CreateIndex(
                name: "IX_UserActivityLogs_ModuleKey_PageKey_CreateTime",
                table: "UserActivityLogs",
                columns: new[] { "ModuleKey", "PageKey", "CreateTime" });

            migrationBuilder.CreateIndex(
                name: "IX_UserActivityLogs_Username_CreateTime",
                table: "UserActivityLogs",
                columns: new[] { "Username", "CreateTime" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserActivityLogs");
        }
    }
}
