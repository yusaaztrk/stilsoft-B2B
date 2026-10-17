using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class SetBeyazEsyaMontajZero : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE ""Products""
                SET ""IsInstallable"" = true, ""InstallationFee"" = 0
                WHERE UPPER(TRIM(COALESCE(""GroupCode"", ''))) IN ('BYZ-ESYA', 'BEYAZ ESYA', 'BEYAZ EŞYA', 'KLIMA', 'SEBIL', 'ANKASTRE', 'CAM.MAK', 'BUZDLB', 'DRN.DON', 'BUL-MAK', 'SOLO', 'ELEKTRO')
                   OR UPPER(TRIM(COALESCE(""SubGroupCode"", ''))) IN ('BYZ-ESYA', 'BEYAZ ESYA', 'BEYAZ EŞYA', 'KLIMA', 'SEBIL', 'ANKASTRE', 'CAM.MAK', 'BUZDLB', 'DRN.DON', 'BUL-MAK', 'SOLO', 'ELEKTRO');

                UPDATE ""Products""
                SET ""IsInstallable"" = false, ""InstallationFee"" = NULL
                WHERE UPPER(TRIM(COALESCE(""GroupCode"", ''))) NOT IN ('BYZ-ESYA', 'BEYAZ ESYA', 'BEYAZ EŞYA', 'KLIMA', 'SEBIL', 'ANKASTRE', 'CAM.MAK', 'BUZDLB', 'DRN.DON', 'BUL-MAK', 'SOLO', 'ELEKTRO')
                  AND UPPER(TRIM(COALESCE(""SubGroupCode"", ''))) NOT IN ('BYZ-ESYA', 'BEYAZ ESYA', 'BEYAZ EŞYA', 'KLIMA', 'SEBIL', 'ANKASTRE', 'CAM.MAK', 'BUZDLB', 'DRN.DON', 'BUL-MAK', 'SOLO', 'ELEKTRO');
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE \"Products\" SET \"IsInstallable\" = false, \"InstallationFee\" = NULL;");
        }
    }
}
