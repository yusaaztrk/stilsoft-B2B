using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddEmployeeFaceEmbeddings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CustomerChecks_VBordroNo",
                table: "CustomerChecks");

            migrationBuilder.CreateTable(
                name: "EmployeeFaceEmbeddings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    EmployeeId = table.Column<int>(type: "integer", nullable: false),
                    EmbeddingJson = table.Column<string>(type: "text", nullable: false),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmployeeFaceEmbeddings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EmployeeFaceEmbeddings_Employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "Employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerChecks_VBordroNo",
                table: "CustomerChecks",
                column: "VBordroNo");

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeFaceEmbeddings_EmployeeId",
                table: "EmployeeFaceEmbeddings",
                column: "EmployeeId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmployeeFaceEmbeddings");

            migrationBuilder.DropIndex(
                name: "IX_CustomerChecks_VBordroNo",
                table: "CustomerChecks");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerChecks_VBordroNo",
                table: "CustomerChecks",
                column: "VBordroNo",
                unique: true);
        }
    }
}
