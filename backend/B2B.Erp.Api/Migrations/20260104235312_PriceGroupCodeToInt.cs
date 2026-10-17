using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class PriceGroupCodeToInt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_PriceGroups_Code\";");

            migrationBuilder.Sql(@"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ""PriceGroups""
    WHERE ""Code"" IS NULL
       OR NOT (
         ""Code"" ~ '^[0-9]+$'
         OR ""Code"" ~ '^F[0-9]+$'
       )
  ) THEN
    RAISE EXCEPTION 'PriceGroups.Code contains non-convertible values. Expected numeric or F{n} format.';
  END IF;
END $$;
");

            migrationBuilder.Sql(@"
ALTER TABLE ""PriceGroups""
  ALTER COLUMN ""Code"" TYPE integer
  USING (
    CASE
      WHEN ""Code"" ~ '^F[0-9]+$' THEN substring(""Code"" from 2)::integer
      ELSE ""Code""::integer
    END
  );
");

            migrationBuilder.CreateIndex(
                name: "IX_PriceGroups_Code",
                table: "PriceGroups",
                column: "Code",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_PriceGroups_Code\";");

            migrationBuilder.Sql(@"
ALTER TABLE ""PriceGroups""
  ALTER COLUMN ""Code"" TYPE character varying(50)
  USING ('F' || ""Code""::text);
");

            migrationBuilder.CreateIndex(
                name: "IX_PriceGroups_Code",
                table: "PriceGroups",
                column: "Code",
                unique: true);
        }
    }
}
