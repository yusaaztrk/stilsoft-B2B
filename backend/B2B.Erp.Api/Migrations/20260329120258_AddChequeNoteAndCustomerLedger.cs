using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddChequeNoteAndCustomerLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CheckOperations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DocumentType = table.Column<int>(type: "integer", nullable: false),
                    DocumentId = table.Column<int>(type: "integer", nullable: false),
                    Date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrencyTypeId = table.Column<int>(type: "integer", nullable: false),
                    BankAccountDefinitionId = table.Column<int>(type: "integer", nullable: true),
                    TargetCustomerCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckOperations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CheckOperations_BankAccountDefinitions_BankAccountDefinitio~",
                        column: x => x.BankAccountDefinitionId,
                        principalTable: "BankAccountDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CheckOperations_Customers_TargetCustomerCode",
                        column: x => x.TargetCustomerCode,
                        principalTable: "Customers",
                        principalColumn: "CustomerCode",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CustomerChecks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DocumentNo = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    CustomerCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    IssueDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DueDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrencyTypeId = table.Column<int>(type: "integer", nullable: false),
                    BankName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    BranchName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    CheckNo = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    CurrentBankAccountDefinitionId = table.Column<int>(type: "integer", nullable: true),
                    CurrentCustomerCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerChecks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CustomerChecks_BankAccountDefinitions_CurrentBankAccountDef~",
                        column: x => x.CurrentBankAccountDefinitionId,
                        principalTable: "BankAccountDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CustomerChecks_Customers_CurrentCustomerCode",
                        column: x => x.CurrentCustomerCode,
                        principalTable: "Customers",
                        principalColumn: "CustomerCode",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CustomerChecks_Customers_CustomerCode",
                        column: x => x.CustomerCode,
                        principalTable: "Customers",
                        principalColumn: "CustomerCode",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CustomerLedgerEntries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CustomerCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Direction = table.Column<int>(type: "integer", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrencyTypeId = table.Column<int>(type: "integer", nullable: false),
                    DocumentNo = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ReferenceType = table.Column<int>(type: "integer", nullable: false),
                    ReferenceId = table.Column<int>(type: "integer", nullable: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerLedgerEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CustomerLedgerEntries_Customers_CustomerCode",
                        column: x => x.CustomerCode,
                        principalTable: "Customers",
                        principalColumn: "CustomerCode",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PayableChecks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DocumentNo = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    SupplierId = table.Column<int>(type: "integer", nullable: true),
                    IssueDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DueDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrencyTypeId = table.Column<int>(type: "integer", nullable: false),
                    BankName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    BranchName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    CheckNo = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    BankAccountDefinitionId = table.Column<int>(type: "integer", nullable: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayableChecks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PayableChecks_BankAccountDefinitions_BankAccountDefinitionId",
                        column: x => x.BankAccountDefinitionId,
                        principalTable: "BankAccountDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PayableChecks_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PayableNotes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DocumentNo = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    SupplierId = table.Column<int>(type: "integer", nullable: true),
                    IssueDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DueDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrencyTypeId = table.Column<int>(type: "integer", nullable: false),
                    NoteNo = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    BankAccountDefinitionId = table.Column<int>(type: "integer", nullable: true),
                    CreateUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditUser = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EditTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayableNotes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PayableNotes_BankAccountDefinitions_BankAccountDefinitionId",
                        column: x => x.BankAccountDefinitionId,
                        principalTable: "BankAccountDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PayableNotes_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CheckOperations_BankAccountDefinitionId",
                table: "CheckOperations",
                column: "BankAccountDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_CheckOperations_DocumentType_DocumentId_Date",
                table: "CheckOperations",
                columns: new[] { "DocumentType", "DocumentId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckOperations_TargetCustomerCode",
                table: "CheckOperations",
                column: "TargetCustomerCode");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerChecks_CurrentBankAccountDefinitionId",
                table: "CustomerChecks",
                column: "CurrentBankAccountDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerChecks_CurrentCustomerCode",
                table: "CustomerChecks",
                column: "CurrentCustomerCode");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerChecks_CustomerCode_DueDate",
                table: "CustomerChecks",
                columns: new[] { "CustomerCode", "DueDate" });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerChecks_DocumentNo",
                table: "CustomerChecks",
                column: "DocumentNo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CustomerLedgerEntries_CustomerCode_Date",
                table: "CustomerLedgerEntries",
                columns: new[] { "CustomerCode", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_PayableChecks_BankAccountDefinitionId",
                table: "PayableChecks",
                column: "BankAccountDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_PayableChecks_DocumentNo",
                table: "PayableChecks",
                column: "DocumentNo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayableChecks_SupplierId",
                table: "PayableChecks",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_PayableNotes_BankAccountDefinitionId",
                table: "PayableNotes",
                column: "BankAccountDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_PayableNotes_DocumentNo",
                table: "PayableNotes",
                column: "DocumentNo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayableNotes_SupplierId",
                table: "PayableNotes",
                column: "SupplierId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CheckOperations");

            migrationBuilder.DropTable(
                name: "CustomerChecks");

            migrationBuilder.DropTable(
                name: "CustomerLedgerEntries");

            migrationBuilder.DropTable(
                name: "PayableChecks");

            migrationBuilder.DropTable(
                name: "PayableNotes");
        }
    }
}
