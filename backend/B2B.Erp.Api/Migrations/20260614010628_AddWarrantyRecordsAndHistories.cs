using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWarrantyRecordsAndHistories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WarrantyRecords",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TransactionType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    RecordDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    WarrantyNo = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CustomerCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CustomerName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    GrossAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    DiscountAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    NetAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    VatAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    SalesmanCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CreatedByUserName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    SerialNo = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ProductCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ProductName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    BrandModel = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    WarrantyStatus = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    LastStatusDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    FaultDescription = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    WarrantyPeriodMonths = table.Column<int>(type: "integer", nullable: false),
                    CompletedDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WarrantyRecords", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "WarrantyHistories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    WarrantyRecordId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    CreatedTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedByUser = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WarrantyHistories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WarrantyHistories_WarrantyRecords_WarrantyRecordId",
                        column: x => x.WarrantyRecordId,
                        principalTable: "WarrantyRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 38,
                column: "DisplayName",
                value: "Stok Giriş/Çıkış Raporu");

            migrationBuilder.InsertData(
                table: "Pages",
                columns: new[] { "Id", "DisplayName", "IsActive", "Key", "ModuleKey", "SortOrder" },
                values: new object[] { 501, "Garanti Raporları", true, "garantiRaporlari", "reports", 17 });

            migrationBuilder.InsertData(
                table: "RolePagePermissions",
                columns: new[] { "Id", "CanAccess", "PageId", "RoleId" },
                values: new object[,]
                {
                    { 10021, true, 501, 1 },
                    { 10022, true, 501, 6 },
                    { 10023, true, 501, 2 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_WarrantyHistories_WarrantyRecordId",
                table: "WarrantyHistories",
                column: "WarrantyRecordId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WarrantyHistories");

            migrationBuilder.DropTable(
                name: "WarrantyRecords");

            migrationBuilder.DeleteData(
                table: "RolePagePermissions",
                keyColumn: "Id",
                keyValue: 10021);

            migrationBuilder.DeleteData(
                table: "RolePagePermissions",
                keyColumn: "Id",
                keyValue: 10022);

            migrationBuilder.DeleteData(
                table: "RolePagePermissions",
                keyColumn: "Id",
                keyValue: 10023);

            migrationBuilder.DeleteData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 501);

            migrationBuilder.UpdateData(
                table: "Pages",
                keyColumn: "Id",
                keyValue: 38,
                column: "DisplayName",
                value: "Muhasebe Stok Giriş/Çıkış Raporu");
        }
    }
}
