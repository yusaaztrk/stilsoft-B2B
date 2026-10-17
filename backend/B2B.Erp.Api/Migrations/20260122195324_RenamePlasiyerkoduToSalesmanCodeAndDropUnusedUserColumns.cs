using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class RenamePlasiyerkoduToSalesmanCodeAndDropUnusedUserColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Avatar",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Bakim",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Departman",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Depokodu",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Dogumtarihi",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Durum",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "KasaKodu",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "MagazaKasa",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Stokgrup",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Stokgrup2",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Subekodu",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "UstCariKodu",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "YetkiAck",
                table: "Users");

            migrationBuilder.RenameColumn(
                name: "Plasiyerkodu",
                table: "Users",
                newName: "SalesmanCode");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "SalesmanCode",
                table: "Users",
                newName: "Plasiyerkodu");

            migrationBuilder.AddColumn<byte[]>(
                name: "Avatar",
                table: "Users",
                type: "bytea",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "Bakim",
                table: "Users",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Departman",
                table: "Users",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Depokodu",
                table: "Users",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Dogumtarihi",
                table: "Users",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "Durum",
                table: "Users",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "KasaKodu",
                table: "Users",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "MagazaKasa",
                table: "Users",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Stokgrup",
                table: "Users",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Stokgrup2",
                table: "Users",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Subekodu",
                table: "Users",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UstCariKodu",
                table: "Users",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "YetkiAck",
                table: "Users",
                type: "text",
                nullable: true);

            migrationBuilder.UpdateData(
                table: "Users",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "Avatar", "Bakim", "Departman", "Depokodu", "Dogumtarihi", "Durum", "KasaKodu", "MagazaKasa", "Stokgrup", "Stokgrup2", "Subekodu", "UstCariKodu", "YetkiAck" },
                values: new object[] { null, null, null, null, null, null, null, null, null, null, null, null, null });
        }
    }
}
