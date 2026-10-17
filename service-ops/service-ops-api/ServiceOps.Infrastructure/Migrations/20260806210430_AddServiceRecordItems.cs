using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceOps.Infrastructure.Migrations
{
    /// <summary>
    /// Montaj kabul kaydını kalemlere ayırır. Öncesinde kayıt tek üründen ibaretti ve miktar
    /// "ProblemDescription" içindeki "Miktar: N" metninden regex ile okunuyordu; planlama da
    /// bu tek satır üzerinden yapılıyordu. Artık her ürün satırı bir kalem, her planlama görevi
    /// bir keleme bağlı.
    ///
    /// NOT: Scaffold, snapshot eskimiş olduğu için Report* tablolarını düşürmek ve
    /// TechnicianEarnings kolonlarını geri almak istedi. Bu tablolar elle yazılmış
    /// migration'larla zaten doğru halde; o işlemler buradan çıkarıldı. Snapshot güncellendi,
    /// dolayısıyla sonraki migration'lar bu farkı tekrar üretmeyecek.
    /// </summary>
    public partial class AddServiceRecordItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ServiceRecordItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ServiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductName = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    ProductStockCode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SerialNumber = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceRecordItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceRecordItems_ServiceRecords_ServiceId",
                        column: x => x.ServiceId,
                        principalTable: "ServiceRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceRecordItems_ServiceId_SortOrder",
                table: "ServiceRecordItems",
                columns: new[] { "ServiceId", "SortOrder" });

            migrationBuilder.AddColumn<Guid>(
                name: "ServiceRecordItemId",
                table: "InstallationTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_InstallationTasks_ServiceRecordItemId",
                table: "InstallationTasks",
                column: "ServiceRecordItemId");

            migrationBuilder.AddForeignKey(
                name: "FK_InstallationTasks_ServiceRecordItems_ServiceRecordItemId",
                table: "InstallationTasks",
                column: "ServiceRecordItemId",
                principalTable: "ServiceRecordItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // Mevcut montaj kayıtlarının her biri tek kaleme dönüşür: ürün adı kaydın kendisinden,
            // miktar ise eski "Miktar: N" metninden okunur. Eşleşme yoksa 1 kabul edilir.
            //
            // Kolonlar dinamik seçiliyor: bazı tenant veritabanları daha eski bir taban şemadan
            // ilerliyor ve ProductStockCode / SerialNumber / ProblemDescription kolonları bu
            // migration sırasında henüz mevcut olmayabiliyor. Sabit SQL, o veritabanlarında
            // "column does not exist" ile zinciri kilitliyordu.
            migrationBuilder.Sql(@"
                DO $backfill$
                DECLARE
                    stock_expr text := 'NULL';
                    serial_expr text := 'NULL';
                    qty_expr text := '1';
                BEGIN
                    IF EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_schema = 'public' AND table_name = 'ServiceRecords'
                                 AND column_name = 'ProductStockCode') THEN
                        stock_expr := 's.""ProductStockCode""';
                    END IF;

                    IF EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_schema = 'public' AND table_name = 'ServiceRecords'
                                 AND column_name = 'SerialNumber') THEN
                        serial_expr := 's.""SerialNumber""';
                    END IF;

                    IF EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_schema = 'public' AND table_name = 'ServiceRecords'
                                 AND column_name = 'ProblemDescription') THEN
                        qty_expr := 'GREATEST(1, COALESCE((substring(s.""ProblemDescription"" from ''Miktar\s*:\s*(\d+)''))::int, 1))';
                    END IF;

                    EXECUTE format($sql$
                        INSERT INTO ""ServiceRecordItems""
                            (""Id"", ""ServiceId"", ""ProductName"", ""ProductStockCode"", ""SerialNumber"",
                             ""Quantity"", ""Notes"", ""SortOrder"", ""CreatedAt"", ""UpdatedAt"")
                        SELECT
                            gen_random_uuid(),
                            s.""Id"",
                            COALESCE(NULLIF(TRIM(s.""ProductName""), ''), '-'),
                            %s,
                            %s,
                            %s,
                            NULL,
                            0,
                            COALESCE(s.""CreatedAt"", now()),
                            now()
                        FROM ""ServiceRecords"" s
                        WHERE s.""Type"" = 1
                          AND NOT EXISTS (
                              SELECT 1 FROM ""ServiceRecordItems"" i WHERE i.""ServiceId"" = s.""Id""
                          )
                    $sql$, stock_expr, serial_expr, qty_expr);
                END
                $backfill$;
            ");

            // Var olan planlama görevleri, kaydın tek kalemine bağlanır.
            migrationBuilder.Sql(@"
                UPDATE ""InstallationTasks"" t
                SET ""ServiceRecordItemId"" = i.""Id""
                FROM ""ServiceRecordItems"" i
                WHERE i.""ServiceId"" = t.""ServiceId""
                  AND t.""ServiceRecordItemId"" IS NULL;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_InstallationTasks_ServiceRecordItems_ServiceRecordItemId",
                table: "InstallationTasks");

            migrationBuilder.DropIndex(
                name: "IX_InstallationTasks_ServiceRecordItemId",
                table: "InstallationTasks");

            migrationBuilder.DropColumn(
                name: "ServiceRecordItemId",
                table: "InstallationTasks");

            migrationBuilder.DropTable(
                name: "ServiceRecordItems");
        }
    }
}
