using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVirtualPosTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
CREATE TABLE IF NOT EXISTS ""VirtualPosDefinitions"" (
    ""Id"" uuid NOT NULL PRIMARY KEY,
    ""BankCode"" integer NOT NULL,
    ""BankName"" text NOT NULL,
    ""PosType"" text NOT NULL,
    ""ClientId"" text NOT NULL,
    ""TerminalId"" text NOT NULL,
    ""UserCode"" text NOT NULL,
    ""Password"" text NOT NULL,
    ""Key3D"" text NOT NULL,
    ""ProvisionPassword"" text NOT NULL,
    ""GatewayUrl"" text NOT NULL,
    ""ApprovedUrl"" text NOT NULL,
    ""XmlUrl"" text NOT NULL,
    ""NethesCode"" text NOT NULL,
    ""PosnetId"" text NOT NULL,
    ""IsDefault"" boolean NOT NULL,
    ""IsActive"" boolean NOT NULL,
    ""CreateTime"" timestamp with time zone NOT NULL,
    ""CreateUser"" text NOT NULL
);

CREATE TABLE IF NOT EXISTS ""VirtualPosInstallmentRules"" (
    ""Id"" uuid NOT NULL PRIMARY KEY,
    ""BankCode"" integer NOT NULL,
    ""MerchantInstallment"" integer NOT NULL,
    ""BankInstallment"" integer NOT NULL,
    ""MinAmount"" numeric NOT NULL,
    ""MaxAmount"" numeric NOT NULL,
    ""Description"" text NOT NULL,
    ""InstallmentText"" text NOT NULL,
    ""IsActive"" boolean NOT NULL,
    ""CreateTime"" timestamp with time zone NOT NULL,
    ""CreateUser"" text NOT NULL
);

CREATE TABLE IF NOT EXISTS ""VirtualPosBins"" (
    ""Id"" uuid NOT NULL PRIMARY KEY,
    ""BankCode"" integer NOT NULL,
    ""BinNo"" text NOT NULL,
    ""CardType1"" text NOT NULL,
    ""CardType2"" text NOT NULL,
    ""InstallmentBankCode"" integer NOT NULL,
    ""CreateTime"" timestamp with time zone NOT NULL,
    ""CreateUser"" text NOT NULL
);

CREATE TABLE IF NOT EXISTS ""VirtualPosTransactions"" (
    ""Id"" uuid NOT NULL PRIMARY KEY,
    ""OrderNo"" text NOT NULL,
    ""BankDocumentNo"" text NOT NULL,
    ""CustomerCode"" text NOT NULL,
    ""BankCode"" integer NOT NULL,
    ""InstallmentCount"" integer NOT NULL,
    ""Amount"" numeric NOT NULL,
    ""TransactionDate"" timestamp with time zone NOT NULL,
    ""IsSuccess"" boolean NOT NULL,
    ""AuthCode"" text NOT NULL,
    ""ErrorCode"" text NOT NULL,
    ""ErrorDescription"" text NOT NULL,
    ""Is3D"" boolean NOT NULL,
    ""CardHolderName"" text NOT NULL,
    ""MaskedCardNumber"" text NOT NULL,
    ""Email"" text NOT NULL,
    ""Phone"" text NOT NULL,
    ""ReceiptNo"" text NOT NULL,
    ""Status"" integer NOT NULL,
    ""RawRequest"" text NOT NULL,
    ""RawResponse"" text NOT NULL,
    ""CreateUser"" text NOT NULL,
    ""CreateTime"" timestamp with time zone NOT NULL
);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "VirtualPosTransactions");
            migrationBuilder.DropTable(name: "VirtualPosInstallmentRules");
            migrationBuilder.DropTable(name: "VirtualPosDefinitions");
            migrationBuilder.DropTable(name: "VirtualPosBins");
        }
    }
}
