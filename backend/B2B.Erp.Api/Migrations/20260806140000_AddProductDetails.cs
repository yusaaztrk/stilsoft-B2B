using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <summary>
    /// Offer copy per product: the description paragraph and the feature list.
    ///
    /// A separate table joined on stock code, so the product record itself is untouched — the
    /// catalogue is operational data, this is copy that gets rewritten, and plenty of products
    /// have none.
    /// </summary>
    public partial class AddProductDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ""ProductDetails"" (
                    ""Id""          serial PRIMARY KEY,
                    ""StockCode""   character varying(50)   NOT NULL,
                    ""Description"" character varying(4000),
                    ""Features""    character varying(4000),
                    ""CreateUser""  character varying(100) NOT NULL DEFAULT '',
                    ""CreateTime""  timestamp with time zone NOT NULL DEFAULT now(),
                    ""EditUser""    character varying(100),
                    ""EditTime""    timestamp with time zone
                );

                CREATE UNIQUE INDEX IF NOT EXISTS ""IX_ProductDetails_StockCode""
                    ON ""ProductDetails"" (""StockCode"");
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP TABLE IF EXISTS ""ProductDetails"";");
        }
    }
}
