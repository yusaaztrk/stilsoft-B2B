using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace B2B.Erp.Api.Migrations
{
    /// <summary>
    /// Makes the virtual POS payment record survive a reload, and gives the accounting
    /// posting a database-level idempotency guarantee.
    ///
    /// Three columns are added because the properties behind them were [NotMapped] while
    /// code on the money path read them back from a fresh context:
    ///
    ///   CurrencyCode         every reload silently produced "TRY", so a EUR/USD/GBP
    ///                        collection was booked as Turkish Lira and the callback's
    ///                        currency comparison ran against 949 regardless of the payment
    ///   HostReferenceNumber  the bank's own authorization reference, captured from the
    ///                        callback and then discarded — unrecoverable once lost, and the
    ///                        value a reconciliation against the bank's report is done on
    ///   CompletedAtUtc       when the payment settled, or null while still undecided; not
    ///                        derivable from CreateTime for banks that authorize after 3D
    ///
    /// The two indexes are PARTIAL and scoped to rows this feature owns:
    ///   * the ledger index only covers entries tagged 'Sanal POS Tahsilat'
    ///   * the bank index only covers documents with the 'VP-' reference prefix
    /// A DocumentNo may legitimately repeat across other document types, so a global unique
    /// index would break existing data. Nothing outside virtual POS is touched.
    ///
    /// Written by hand rather than scaffolded. 'dotnet ef migrations add' against this model
    /// also emits a large set of unrelated operations — including DROP COLUMN on
    /// Products.GroupCode/SubGroupCode — because the model snapshot has drifted from the
    /// schema that startup SQL maintains. Those operations are not part of this change and
    /// must not ship with it.
    /// </summary>
    public partial class FixVirtualPosPersistenceAndAccountingIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Existing rows predate the column. They were all taken in Turkish Lira — the
            // only currency the module could process while the code was unmapped — so TRY is
            // the accurate backfill, not merely a convenient one.
            migrationBuilder.AddColumn<string>(
                name: "CurrencyCode",
                table: "VirtualPosTransactions",
                type: "character varying(3)",
                maxLength: 3,
                nullable: false,
                defaultValue: "TRY");

            migrationBuilder.AddColumn<string>(
                name: "HostReferenceNumber",
                table: "VirtualPosTransactions",
                type: "text",
                nullable: false,
                defaultValue: "");

            // Nullable by design: null means "no settled outcome", which is a real state.
            migrationBuilder.AddColumn<DateTime>(
                name: "CompletedAtUtc",
                table: "VirtualPosTransactions",
                type: "timestamp with time zone",
                nullable: true);

            // CustomerLedgerEntries.TransactionType is part of the entity model but is created
            // by the tenant provisioning SQL in TenantConnectionStringResolver, not by any
            // migration — so on a database built purely from the migration chain the column is
            // absent and the index below cannot be created. This is the identical statement
            // that provisioning already runs, so it is a no-op everywhere the column exists and
            // does not invent a definition of its own.
            migrationBuilder.Sql(@"
ALTER TABLE ""CustomerLedgerEntries"" ADD COLUMN IF NOT EXISTS ""TransactionType"" character varying(120) NULL;");

            // Application-level "does this reference already exist?" checks lose the race when
            // two callbacks post at the same moment, so the guarantee has to come from the
            // database. IF NOT EXISTS keeps this safe on databases where the index was already
            // created by hand.
            migrationBuilder.Sql(@"
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_CustomerLedgerEntries_VirtualPosReference""
    ON ""CustomerLedgerEntries"" (""DocumentNo"")
    WHERE ""TransactionType"" = 'Sanal POS Tahsilat' AND ""DocumentNo"" IS NOT NULL;");

            migrationBuilder.Sql(@"
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_BankAccountTransactions_VirtualPosReference""
    ON ""BankAccountTransactions"" (""DocumentNo"")
    WHERE ""DocumentNo"" LIKE 'VP-%';");

            // Legacy columns on VirtualPosTransactions that the current entity no longer maps:
            // TransactionDate, ReceiptNo, RawRequest and CreateUser. On databases created by an
            // earlier version they are NOT NULL with no default, so an insert from the current
            // model — which does not mention them — fails with 23502 and no payment can start.
            //
            // Dropping the NOT NULL is the smallest change that unblocks it: existing rows keep
            // their values, nothing is deleted, and databases that never had these columns are
            // unaffected. RawRequest in particular is deliberately never written again — the
            // module does not store raw request payloads.
            migrationBuilder.Sql(@"
DO $$
DECLARE
    legacy_column text;
BEGIN
    FOREACH legacy_column IN ARRAY ARRAY['TransactionDate', 'ReceiptNo', 'RawRequest', 'CreateUser']
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'VirtualPosTransactions'
              AND column_name = legacy_column
              AND is_nullable = 'NO'
        ) THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', 'VirtualPosTransactions', legacy_column);
        END IF;
    END LOOP;
END $$;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The NOT NULL relaxation is intentionally not reversed: re-imposing it would fail
            // on any row inserted while the constraint was off, and the constraint is exactly
            // what blocked the module from working.
            migrationBuilder.Sql(@"DROP INDEX IF EXISTS ""IX_BankAccountTransactions_VirtualPosReference"";");
            migrationBuilder.Sql(@"DROP INDEX IF EXISTS ""IX_CustomerLedgerEntries_VirtualPosReference"";");

            migrationBuilder.DropColumn(
                name: "CompletedAtUtc",
                table: "VirtualPosTransactions");

            migrationBuilder.DropColumn(
                name: "HostReferenceNumber",
                table: "VirtualPosTransactions");

            migrationBuilder.DropColumn(
                name: "CurrencyCode",
                table: "VirtualPosTransactions");
        }
    }
}
