using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCashAccountTransfersAndTransactions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CashAccountTransactions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CashAccountId = table.Column<int>(type: "integer", nullable: false),
                    Date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Direction = table.Column<int>(type: "integer", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrencyTypeId = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    CurrencyRate = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false, defaultValue: 1m),
                    CurrencyAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false, defaultValue: 0m),
                    CounterpartyType = table.Column<int>(type: "integer", nullable: false),
                    CounterpartyCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CounterpartyName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    ReferenceType = table.Column<int>(type: "integer", nullable: false),
                    ReferenceId = table.Column<int>(type: "integer", nullable: true),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CashAccountTransactions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CashAccountTransactions_CashAccounts_CashAccountId",
                        column: x => x.CashAccountId,
                        principalTable: "CashAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CashAccountTransfers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SourceCashAccountId = table.Column<int>(type: "integer", nullable: false),
                    TargetCashAccountId = table.Column<int>(type: "integer", nullable: false),
                    Date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrencyTypeId = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CashAccountTransfers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CashAccountTransfers_CashAccounts_SourceCashAccountId",
                        column: x => x.SourceCashAccountId,
                        principalTable: "CashAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CashAccountTransfers_CashAccounts_TargetCashAccountId",
                        column: x => x.TargetCashAccountId,
                        principalTable: "CashAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.Sql(@"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Pages'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM ""Pages""
    WHERE ""Id"" = 401
  ) THEN
    INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
    VALUES (401, 'Kasalarım', TRUE, 'kasalarim', 'users', 17);
  END IF;

  -- users module default roles: SuperAdmin(1) always, plus role set in RolePagePermissionConfiguration (6,2)
  INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
  VALUES
    (1, 401, TRUE),
    (6, 401, TRUE),
    (2, 401, TRUE)
  ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
END $$;
");

            migrationBuilder.CreateIndex(
                name: "IX_CashAccountTransactions_CashAccountId_Date",
                table: "CashAccountTransactions",
                columns: new[] { "CashAccountId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_CashAccountTransfers_SourceCashAccountId_Date",
                table: "CashAccountTransfers",
                columns: new[] { "SourceCashAccountId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_CashAccountTransfers_TargetCashAccountId_Date",
                table: "CashAccountTransfers",
                columns: new[] { "TargetCashAccountId", "Date" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CashAccountTransactions");

            migrationBuilder.DropTable(
                name: "CashAccountTransfers");

            migrationBuilder.Sql(@"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'RolePagePermissions'
  ) THEN
    DELETE FROM ""RolePagePermissions"" WHERE ""PageId"" = 401;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Pages'
  ) THEN
    DELETE FROM ""Pages"" WHERE ""Id"" = 401;
  END IF;
END $$;
");
        }
    }
}
