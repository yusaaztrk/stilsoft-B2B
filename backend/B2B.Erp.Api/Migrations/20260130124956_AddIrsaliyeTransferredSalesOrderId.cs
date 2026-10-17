using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddIrsaliyeTransferredSalesOrderId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "TransferredSalesOrderId",
                table: "Irsaliye",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Irsaliye_TransferredSalesOrderId",
                table: "Irsaliye",
                column: "TransferredSalesOrderId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Irsaliye_TransferredSalesOrderId",
                table: "Irsaliye");

            migrationBuilder.DropColumn(
                name: "TransferredSalesOrderId",
                table: "Irsaliye");
        }
    }
}
