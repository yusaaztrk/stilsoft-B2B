using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWarehouseTransfers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WarehouseTransfers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TransferNo = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    DeliveryAddress = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    FromWarehouseCode = table.Column<int>(type: "integer", nullable: false),
                    ToWarehouseCode = table.Column<int>(type: "integer", nullable: false),
                    IsConsignment = table.Column<bool>(type: "boolean", nullable: false),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WarehouseTransfers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WarehouseTransfers_Warehouses_FromWarehouseCode",
                        column: x => x.FromWarehouseCode,
                        principalTable: "Warehouses",
                        principalColumn: "WarehouseCode",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WarehouseTransfers_Warehouses_ToWarehouseCode",
                        column: x => x.ToWarehouseCode,
                        principalTable: "Warehouses",
                        principalColumn: "WarehouseCode",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WarehouseTransferLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    WarehouseTransferId = table.Column<int>(type: "integer", nullable: false),
                    StockCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    LineNo = table.Column<int>(type: "integer", nullable: false),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WarehouseTransferLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WarehouseTransferLines_WarehouseTransfers_WarehouseTransfer~",
                        column: x => x.WarehouseTransferId,
                        principalTable: "WarehouseTransfers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WarehouseTransferLines_StockCode",
                table: "WarehouseTransferLines",
                column: "StockCode");

            migrationBuilder.CreateIndex(
                name: "IX_WarehouseTransferLines_WarehouseTransferId",
                table: "WarehouseTransferLines",
                column: "WarehouseTransferId");

            migrationBuilder.CreateIndex(
                name: "IX_WarehouseTransfers_FromWarehouseCode",
                table: "WarehouseTransfers",
                column: "FromWarehouseCode");

            migrationBuilder.CreateIndex(
                name: "IX_WarehouseTransfers_ToWarehouseCode",
                table: "WarehouseTransfers",
                column: "ToWarehouseCode");

            migrationBuilder.CreateIndex(
                name: "IX_WarehouseTransfers_TransferNo",
                table: "WarehouseTransfers",
                column: "TransferNo",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WarehouseTransferLines");

            migrationBuilder.DropTable(
                name: "WarehouseTransfers");
        }
    }
}
