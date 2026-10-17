using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class RemoveSeedSuperadmin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "Users",
                keyColumn: "Id",
                keyValue: 1);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.InsertData(
                table: "Users",
                columns: new[] { "Id", "Carikodu", "CreateTime", "CreateUser", "DefaultWarehouseCode", "EditTime", "EditUser", "Gsm", "IsActive", "LastLoginAt", "Mail", "Password", "RoleId", "SalesmanCode", "Unvan", "UpdatedAt", "Username" },
                values: new object[] { 1, null, new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "System", null, null, null, "+905551234567", true, null, "superadmin@b2berp.com", "password123", 1, null, "Sistem Yöneticisi", null, "superadmin" });
        }
    }
}
