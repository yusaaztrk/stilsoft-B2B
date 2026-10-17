using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ServiceOps.Infrastructure.Data;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Hak ediş tablosu.
    ///
    /// DİKKAT — [DbContext] / [Migration] ÖZNİTELİKLERİ ŞARTTIR. Bu dosya elle yazılmış ve
    /// öznitelikler unutulmuştu; EF migration'ları yalnızca MigrationAttribute taşıyan sınıflardan
    /// bulur, dolayısıyla bu adım HİÇBİR veritabanında çalışmadı. Sonuç: TechnicianEarnings
    /// tablosu hiç oluşmadı, Hakediş ekranı 2026-08-04'ten beri ölüydü ("Hakediş sayfası
    /// çalışmıyor" şikâyetinin ikinci sebebi buydu; birincisi eksik sayfa anahtarıydı).
    /// Elle migration yazarken .Designer.cs üretilmediği için öznitelikleri sınıfa koymak gerekir.
    /// </summary>
    [DbContext(typeof(ApplicationDbContext))]
    [Migration("20260804100000_AddTechnicianEarnings")]
    public partial class AddTechnicianEarnings : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TechnicianEarnings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantCode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    TechnicianId = table.Column<Guid>(type: "uuid", nullable: false),
                    TechnicianName = table.Column<string>(type: "text", nullable: false),
                    TechnicianCariCode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SourceType = table.Column<int>(type: "integer", nullable: false),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceNumber = table.Column<string>(type: "text", nullable: true),
                    CustomerName = table.Column<string>(type: "text", nullable: true),
                    ProductName = table.Column<string>(type: "text", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    PostedLedgerReference = table.Column<string>(type: "text", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    ApprovedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ApprovedBy = table.Column<string>(type: "text", nullable: true),
                    PostedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PostedBy = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TechnicianEarnings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TechnicianEarnings_Technicians_TechnicianId",
                        column: x => x.TechnicianId,
                        principalTable: "Technicians",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TechnicianEarnings_SourceType_SourceId",
                table: "TechnicianEarnings",
                columns: new[] { "SourceType", "SourceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TechnicianEarnings_Status",
                table: "TechnicianEarnings",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_TechnicianEarnings_TechnicianId_CompletedAt",
                table: "TechnicianEarnings",
                columns: new[] { "TechnicianId", "CompletedAt" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "TechnicianEarnings");
        }
    }
}
