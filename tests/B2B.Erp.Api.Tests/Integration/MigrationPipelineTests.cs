using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Xunit;

namespace B2B.Erp.Api.Tests.Integration;

/// <summary>
/// Proves the virtual POS migration is real: that EF discovers it, that it applies through
/// normal migration discovery on a database built from nothing, and that it lands in the
/// migration history.
///
/// The accounting suite builds its schema from the EF model, which cannot show any of this —
/// a migration that EF never sees would leave those tests green and production unmigrated.
///
/// Each test gets its own uniquely named database, created and dropped by the test itself.
/// Sharing one would make the tests depend on each other through the connection pool: a
/// dropped and recreated database invalidates connections another test still holds.
/// <see cref="AssertSafeTarget"/> refuses any name that is not unmistakably a test target,
/// so a mistake cannot reach real data.
/// </summary>
public sealed class MigrationPipelineTests
{
    public const string VirtualPosMigrationId = "20260804220000_FixVirtualPosPersistenceAndAccountingIndexes";

    private const string TestDatabasePrefix = "b2b_erp_migration_test_";

    /// <summary>Databases these tests must never create, migrate or drop.</summary>
    private static readonly string[] ProtectedDatabases =
    {
        "b2b_erp",
        "b2b_erp_master",
        "b2b_erp_tenant_demo",
        "b2b_erp_tenant_demotest",
        "postgres"
    };

    private static string AdminConnectionString =>
        Environment.GetEnvironmentVariable("B2B_TEST_PG_ADMIN")
        ?? "Host=localhost;Port=5434;Database=postgres;Username=b2b;Password=b2b";

    private static void AssertSafeTarget(string databaseName)
    {
        var name = (databaseName ?? string.Empty).Trim().ToLowerInvariant();

        if (name.Length == 0)
            throw new InvalidOperationException("Test database name is empty.");

        if (Array.IndexOf(ProtectedDatabases, name) >= 0)
            throw new InvalidOperationException($"Refusing to use protected database '{name}' for tests.");

        if (!name.StartsWith(TestDatabasePrefix, StringComparison.Ordinal))
            throw new InvalidOperationException($"Refusing destructive setup on '{name}': the name must identify a test database.");
    }

    private static bool ServerReachable()
    {
        try
        {
            using var probe = new NpgsqlConnection(AdminConnectionString);
            probe.Open();
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Runs the body against a database of its own, then removes it. Pooling is off so no
    /// connection outlives the database it was opened against.
    /// </summary>
    private static async Task WithFreshDatabaseAsync(Func<Func<AppDbContext>, Task> body)
    {
        var name = TestDatabasePrefix + Guid.NewGuid().ToString("N").Substring(0, 12);
        AssertSafeTarget(name);

        await using (var admin = new NpgsqlConnection(AdminConnectionString))
        {
            await admin.OpenAsync();
            await DropAsync(admin, name);
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{name}\";", admin);
            await create.ExecuteNonQueryAsync();
        }

        var builder = new NpgsqlConnectionStringBuilder(AdminConnectionString)
        {
            Database = name,
            Pooling = false
        };

        AppDbContext Factory() => new(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(builder.ConnectionString)
            .EnableSensitiveDataLogging(false) // never echo parameter values into test output
            .Options);

        try
        {
            await body(Factory);
        }
        finally
        {
            AssertSafeTarget(name);
            await using var admin = new NpgsqlConnection(AdminConnectionString);
            await admin.OpenAsync();
            await DropAsync(admin, name);
        }
    }

    private static async Task DropAsync(NpgsqlConnection admin, string name)
    {
        await using var terminate = new NpgsqlCommand(
            $"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{name}' AND pid <> pg_backend_pid();",
            admin);
        await terminate.ExecuteNonQueryAsync();

        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{name}\";", admin);
        await drop.ExecuteNonQueryAsync();
    }

    private static async Task<List<string>> QueryAsync(AppDbContext db, string sql)
        => await db.Database.SqlQueryRaw<string>(sql).ToListAsync();

    // --- discovery ---------------------------------------------------------------------------

    /// <summary>
    /// A migration file without [Migration] metadata is invisible to EF and will never be
    /// applied to anything. This asserts the metadata exists, not merely that the file does.
    /// Model metadata only — no connection is opened.
    /// </summary>
    [Fact]
    public void Ef_discovers_the_virtual_pos_migration()
    {
        using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Database=unused;Username=unused;Password=unused")
            .Options);

        var migrations = db.Database.GetMigrations().ToList();

        Assert.Contains(VirtualPosMigrationId, migrations);

        // It has to be ordered after the last migration that predates it — that is what
        // proves EF read its metadata rather than merely finding a file. Deliberately not
        // asserting it is the newest overall: later migrations are expected to follow it.
        Assert.True(
            migrations.IndexOf(VirtualPosMigrationId) > migrations.IndexOf("20260802133515_FixMainCustomerCodeIndexNonUnique"),
            "Virtual POS migration must be ordered after the migration preceding it.");
    }

    // --- fresh database ----------------------------------------------------------------------

    [SkippableFact]
    public async Task Migrating_a_fresh_database_creates_the_columns_indexes_and_history_row()
    {
        Skip.If(!ServerReachable(), "PostgreSQL unavailable");

        await WithFreshDatabaseAsync(async createContext =>
        {
            await using var db = createContext();
            await db.Database.MigrateAsync();

            var applied = (await db.Database.GetAppliedMigrationsAsync()).ToList();
            Assert.Contains(VirtualPosMigrationId, applied);

            var columns = await QueryAsync(db, @"
                SELECT column_name || '|' || data_type || '|' || coalesce(character_maximum_length::text, '') || '|' || is_nullable AS ""Value""
                FROM information_schema.columns
                WHERE table_name = 'VirtualPosTransactions'
                  AND column_name IN ('CurrencyCode', 'HostReferenceNumber', 'CompletedAtUtc')");

            Assert.Contains("CurrencyCode|character varying|3|NO", columns);
            Assert.Contains("HostReferenceNumber|text||NO", columns);
            Assert.Contains("CompletedAtUtc|timestamp with time zone||YES", columns);

            var indexes = await QueryAsync(db, @"
                SELECT indexdef AS ""Value"" FROM pg_indexes
                WHERE indexname IN ('IX_CustomerLedgerEntries_VirtualPosReference',
                                    'IX_BankAccountTransactions_VirtualPosReference')");

            Assert.Equal(2, indexes.Count);
            Assert.Contains(indexes, x => x.Contains("UNIQUE") && x.Contains("Sanal POS Tahsilat"));
            Assert.Contains(indexes, x => x.Contains("UNIQUE") && x.Contains("VP-%"));

            // Scoped, not global: a global unique index on DocumentNo would reject document
            // numbers that other transaction types legitimately reuse.
            Assert.All(indexes, x => Assert.Contains("WHERE", x));
        });
    }

    // --- upgrade path ------------------------------------------------------------------------

    /// <summary>
    /// Mirrors the shape a long-lived database is actually in: the legacy virtual POS columns
    /// present and NOT NULL, left behind by an earlier version of the entity. Those constraints
    /// block every insert the current model makes, because it no longer names those columns.
    /// </summary>
    [SkippableFact]
    public async Task An_existing_database_with_the_legacy_not_null_columns_can_still_be_migrated_and_written_to()
    {
        Skip.If(!ServerReachable(), "PostgreSQL unavailable");

        await WithFreshDatabaseAsync(async createContext =>
        {
            // Bring the database up to the migration immediately before this one, then put it
            // in the drifted state a real deployment is in.
            await using (var staged = createContext())
            {
                var previous = staged.Database.GetMigrations()
                    .TakeWhile(x => x != VirtualPosMigrationId)
                    .Last();

                await staged.GetService<IMigrator>().MigrateAsync(previous);

                await staged.Database.ExecuteSqlRawAsync(@"
                    ALTER TABLE ""VirtualPosTransactions"" ADD COLUMN IF NOT EXISTS ""TransactionDate"" timestamp with time zone NOT NULL DEFAULT now();
                    ALTER TABLE ""VirtualPosTransactions"" ADD COLUMN IF NOT EXISTS ""ReceiptNo"" text NOT NULL DEFAULT '';
                    ALTER TABLE ""VirtualPosTransactions"" ADD COLUMN IF NOT EXISTS ""RawRequest"" text NOT NULL DEFAULT '';
                    ALTER TABLE ""VirtualPosTransactions"" ADD COLUMN IF NOT EXISTS ""CreateUser"" text NOT NULL DEFAULT '';
                    ALTER TABLE ""VirtualPosTransactions"" ALTER COLUMN ""TransactionDate"" DROP DEFAULT;
                    ALTER TABLE ""VirtualPosTransactions"" ALTER COLUMN ""ReceiptNo"" DROP DEFAULT;
                    ALTER TABLE ""VirtualPosTransactions"" ALTER COLUMN ""RawRequest"" DROP DEFAULT;
                    ALTER TABLE ""VirtualPosTransactions"" ALTER COLUMN ""CreateUser"" DROP DEFAULT;");
            }

            await using (var upgraded = createContext())
            {
                await upgraded.Database.MigrateAsync();

                /*
                 * GÖÇLER TEK BAŞINA ÇALIŞAN BİR ŞEMA ÜRETMİYOR (2026-09-08'de ölçüldü).
                 *
                 * Bu projede şema migration'larla değil, açılıştaki idempotent bloklarla
                 * taşınıyor; bazı model özelliklerinin ise ne migration'ı ne drift bloğu var.
                 * Taze bir veritabanında bu, HER `SaveChanges`'i düşürüyor: kaydetme
                 * kancası `UserActivityLogs`'a yazıyor ve o tablonun `CorrelationId` kolonu
                 * hiç oluşmuyor (`42703`).
                 *
                 * Uygulama açılışı bunu `BackfillModelSchemaAsync` ile kapatıyor. Test de
                 * aynı adımı atıyor, çünkü testin konusu "eski NOT NULL kolonlar göçten
                 * sonra da yazılabiliyor mu" — model/göç boşluğu ayrı bir konu ve o boşluğu
                 * burada taklit etmek, testi ilgisiz bir sebeple kırık tutmak olurdu.
                 */
                var schemaReport = await B2B.Erp.Api.Data.Services.SchemaChecker.InspectAsync(upgraded);
                var schemaScript = B2B.Erp.Api.Data.Services.SchemaChecker.BuildFixScript(schemaReport);
                if (schemaScript.Length > 0)
                {
                    await upgraded.Database.ExecuteSqlRawAsync(schemaScript);
                }

                var applied = (await upgraded.Database.GetAppliedMigrationsAsync()).ToList();
                Assert.Contains(VirtualPosMigrationId, applied);

                // No column was added twice by the two provisioning paths meeting
                var duplicates = await QueryAsync(upgraded, @"
                    SELECT column_name AS ""Value"" FROM information_schema.columns
                    WHERE table_name = 'VirtualPosTransactions'
                    GROUP BY column_name HAVING count(*) > 1");
                Assert.Empty(duplicates);

                // The point of the whole exercise: the current model can insert again. Before
                // the migration this threw 23502 on the legacy NOT NULL columns.
                upgraded.VirtualPosTransactions.Add(new VirtualPosTransaction
                {
                    OrderNo = "SP" + Guid.NewGuid().ToString("N").ToUpperInvariant(),
                    CustomerCode = "120-01-000999",
                    BankCode = 10,
                    Amount = 100m,
                    InstallmentCount = 1,
                    CurrencyCode = "EUR",
                    Status = (int)VirtualPosPaymentStatus.Authorized,
                    IsSuccess = true,
                    CreateTime = DateTime.UtcNow
                });

                await upgraded.SaveChangesAsync();
            }

            await using (var verify = createContext())
            {
                var stored = await verify.VirtualPosTransactions.AsNoTracking().SingleAsync();
                Assert.Equal("EUR", stored.CurrencyCode);
            }
        });
    }
}
