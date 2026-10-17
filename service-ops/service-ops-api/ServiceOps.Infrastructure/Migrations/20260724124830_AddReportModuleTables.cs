using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    // BU ADIM BİLEREK KEŞFEDİLEMEZ DURUMDA: ne [Migration] özniteliği ne de .Designer.cs var,
    // dolayısıyla EF onu görmez ve çalıştırmaz.
    //
    // Öznitelik EKLEMEYİN. Karşılığı olan Report* entity sınıfları silindi (modül geri çekildi)
    // ama tablolar bir kısım veritabanında duruyor; adım keşfedilir hale gelirse o veritabanlarında
    // "already exists" ile patlar ve zinciri kilitler. Modül geri gelirse yeni bir migration yazılmalı.
    /// <inheritdoc />
    public partial class AddReportModuleTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ProductStockCode",
                table: "ServiceRecords",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ReportExportLogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ReportInstanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExportType = table.Column<string>(type: "text", nullable: false),
                    FileName = table.Column<string>(type: "text", nullable: false),
                    FileSize = table.Column<long>(type: "bigint", nullable: false),
                    ExportedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExportedBy = table.Column<string>(type: "text", nullable: true),
                    IsSuccessful = table.Column<bool>(type: "boolean", nullable: false),
                    ErrorMessage = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReportExportLogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReportTemplates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Module = table.Column<string>(type: "text", nullable: false),
                    ReportType = table.Column<string>(type: "text", nullable: false),
                    PageSize = table.Column<string>(type: "text", nullable: false),
                    Orientation = table.Column<string>(type: "text", nullable: false),
                    DefinitionJson = table.Column<string>(type: "text", nullable: false),
                    DataSourceDefinitionJson = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    IsSystemTemplate = table.Column<bool>(type: "boolean", nullable: false),
                    CurrentVersion = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true),
                    TenantId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReportTemplates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReportInstances",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ReportTemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateVersion = table.Column<int>(type: "integer", nullable: false),
                    RelatedEntityType = table.Column<string>(type: "text", nullable: false),
                    RelatedEntityId = table.Column<string>(type: "text", nullable: false),
                    SnapshotDataJson = table.Column<string>(type: "text", nullable: true),
                    OverrideDataJson = table.Column<string>(type: "text", nullable: true),
                    FinalDefinitionJson = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true),
                    TenantId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReportInstances", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReportInstances_ReportTemplates_ReportTemplateId",
                        column: x => x.ReportTemplateId,
                        principalTable: "ReportTemplates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ReportTemplateVersions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ReportTemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    VersionNumber = table.Column<int>(type: "integer", nullable: false),
                    DefinitionJson = table.Column<string>(type: "text", nullable: false),
                    DataSourceDefinitionJson = table.Column<string>(type: "text", nullable: true),
                    ChangeDescription = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReportTemplateVersions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReportTemplateVersions_ReportTemplates_ReportTemplateId",
                        column: x => x.ReportTemplateId,
                        principalTable: "ReportTemplates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReportInstances_ReportTemplateId",
                table: "ReportInstances",
                column: "ReportTemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_ReportTemplateVersions_ReportTemplateId",
                table: "ReportTemplateVersions",
                column: "ReportTemplateId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReportExportLogs");

            migrationBuilder.DropTable(
                name: "ReportInstances");

            migrationBuilder.DropTable(
                name: "ReportTemplateVersions");

            migrationBuilder.DropTable(
                name: "ReportTemplates");

            migrationBuilder.DropColumn(
                name: "ProductStockCode",
                table: "ServiceRecords");
        }
    }
}
