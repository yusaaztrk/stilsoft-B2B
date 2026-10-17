using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class UpdateBankBinSeed : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.UpdateData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc2"),
                column: "BankId",
                value: new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"));

            migrationBuilder.UpdateData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc3"),
                column: "BankId",
                value: new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"));

            migrationBuilder.UpdateData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc5"),
                column: "BankId",
                value: new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"));

            migrationBuilder.UpdateData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc6"),
                columns: new[] { "BankId", "Bin6" },
                values: new object[] { new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "658767" });

            migrationBuilder.InsertData(
                table: "BankBins",
                columns: new[] { "Id", "BankId", "Bin6", "IsActive", "Priority" },
                values: new object[,]
                {
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc10"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "444677", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc11"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "444678", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc12"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "454672", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc13"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "454673", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc14"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "534981", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc15"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "540130", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc16"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "540134", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc17"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "541001", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc18"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "541033", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc19"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "542374", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc20"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "547287", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc21"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "418342", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc22"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "418343", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc23"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "418344", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc24"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "418345", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc25"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "454314", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc26"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "454318", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc27"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "454358", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc28"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "454359", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc29"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "510152", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc30"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "540667", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc31"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "540668", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc32"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "543771", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc33"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"), "552096", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc34"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "415514", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc35"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "421030", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc36"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "492094", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc37"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "492095", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc38"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "498852", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc39"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "510056", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc40"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "521378", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc41"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "528208", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc42"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "540284", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc43"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "540435", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc44"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "543039", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc45"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4"), "543081", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc46"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3"), "403280", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc47"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3"), "426886", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc48"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3"), "448472", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc49"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3"), "520097", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-cccccccccc50"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3"), "540036", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc7"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "658768", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc8"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "413226", true, 1 },
                    { new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc9"), new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"), "444676", true, 1 }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc10"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc11"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc12"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc13"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc14"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc15"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc16"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc17"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc18"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc19"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc20"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc21"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc22"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc23"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc24"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc25"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc26"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc27"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc28"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc29"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc30"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc31"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc32"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc33"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc34"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc35"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc36"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc37"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc38"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc39"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc40"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc41"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc42"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc43"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc44"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc45"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc46"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc47"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc48"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc49"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-cccccccccc50"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc7"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc8"));

            migrationBuilder.DeleteData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc9"));

            migrationBuilder.UpdateData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc2"),
                column: "BankId",
                value: new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"));

            migrationBuilder.UpdateData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc3"),
                column: "BankId",
                value: new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3"));

            migrationBuilder.UpdateData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc5"),
                column: "BankId",
                value: new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5"));

            migrationBuilder.UpdateData(
                table: "BankBins",
                keyColumn: "Id",
                keyValue: new Guid("cccccccc-cccc-cccc-cccc-ccccccccccc6"),
                columns: new[] { "BankId", "Bin6" },
                values: new object[] { new Guid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6"), "409070" });
        }
    }
}
