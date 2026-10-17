using System;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace B2B.Erp.Api.Tests.Integration;

/// <summary>
/// A disposable PostgreSQL database for the accounting integration tests.
///
/// The relational guarantees this suite exists to prove — partial unique indexes, real
/// transaction rollback, concurrent conditional updates — cannot be observed on an in-memory
/// or SQLite provider, so these tests run against the same engine production uses.
///
/// The database is created fresh, used, and dropped. It is never one of the real databases:
/// <see cref="AssertSafeTarget"/> refuses to touch anything that is not an obvious test
/// target, so a mistyped connection string cannot destroy tenant data.
/// </summary>
public sealed class PostgresTestFixture : IAsyncLifetime
{
    private const string TestDatabaseName = "b2b_erp_virtualpos_tests";

    /// <summary>Databases this fixture must never create, migrate or drop.</summary>
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

    public string ConnectionString { get; private set; } = string.Empty;

    /// <summary>True when a PostgreSQL server was reachable and the suite can run.</summary>
    public bool IsAvailable { get; private set; }

    public string? SkipReason { get; private set; }

    /// <summary>
    /// Fail-safe. Destructive setup only ever runs against a name that is unmistakably a
    /// test database and is not on the protected list.
    /// </summary>
    private static void AssertSafeTarget(string databaseName)
    {
        var name = (databaseName ?? string.Empty).Trim().ToLowerInvariant();

        if (name.Length == 0)
            throw new InvalidOperationException("Test database name is empty.");

        if (Array.IndexOf(ProtectedDatabases, name) >= 0)
            throw new InvalidOperationException($"Refusing to use protected database '{name}' for tests.");

        if (!name.Contains("test"))
            throw new InvalidOperationException($"Refusing destructive setup on '{name}': the name must identify a test database.");
    }

    public async Task InitializeAsync()
    {
        AssertSafeTarget(TestDatabaseName);

        var builder = new NpgsqlConnectionStringBuilder(AdminConnectionString);

        try
        {
            await using (var admin = new NpgsqlConnection(builder.ConnectionString))
            {
                await admin.OpenAsync();
                await DropDatabaseAsync(admin);

                await using var create = new NpgsqlCommand($"CREATE DATABASE \"{TestDatabaseName}\";", admin);
                await create.ExecuteNonQueryAsync();
            }
        }
        catch (Exception ex)
        {
            // A developer without the local database still gets a green build; the report
            // states plainly that these tests did not execute.
            IsAvailable = false;
            SkipReason = "PostgreSQL not reachable: " + ex.GetType().Name;
            return;
        }

        builder.Database = TestDatabaseName;
        ConnectionString = builder.ConnectionString;

        await using (var db = CreateContext())
        {
            await CreateSchemaWithoutSeedDataAsync(db);
            await ApplyVirtualPosAccountingIndexesAsync(db);
        }

        IsAvailable = true;
    }

    /// <summary>
    /// Builds the schema from the EF model but without its HasData seed rows.
    ///
    /// EnsureCreated() would also insert the seed data, and that currently fails on a
    /// RolePagePermissions row pointing at a Page the model does not seed — the same Pages
    /// drift already reported for the tenant databases. The accounting tests need tables,
    /// not seed content, so the generated script is replayed with the INSERTs filtered out.
    /// Deriving the DDL from the model keeps it in step with the entities.
    /// </summary>
    private static async Task CreateSchemaWithoutSeedDataAsync(AppDbContext db)
    {
        var script = db.Database.GenerateCreateScript();

        // Filtering by line would tear multi-line INSERTs apart and leave orphan fragments,
        // so statements are reassembled first and dropped as a whole.
        var kept = new System.Text.StringBuilder();
        var statement = new System.Text.StringBuilder();

        foreach (var line in script.Split('\n'))
        {
            statement.Append(line).Append('\n');

            if (!line.TrimEnd().EndsWith(";", StringComparison.Ordinal)) continue;

            var text = statement.ToString();
            statement.Clear();

            if (!text.TrimStart().StartsWith("INSERT INTO", StringComparison.OrdinalIgnoreCase))
            {
                kept.Append(text);
            }
        }

        kept.Append(statement); // trailing statement without a terminator, if any

        await db.Database.ExecuteSqlRawAsync(kept.ToString());
    }

    /// <summary>
    /// Applies the index SQL from migration 20260804220000_FixVirtualPosPersistenceAndAccountingIndexes.
    ///
    /// Executed directly rather than through Database.Migrate() because this schema is built
    /// from the EF model, and the migration chain produces a different, older shape: several
    /// columns the model uses — CustomerLedgerEntries.Balance among them — are created by the
    /// tenant provisioning SQL rather than by a migration, so a migration-built database
    /// cannot satisfy these tests. That the migration itself applies cleanly on both a fresh
    /// and a production-shaped database is proven separately by
    /// <see cref="MigrationPipelineTests"/>.
    /// </summary>
    private static async Task ApplyVirtualPosAccountingIndexesAsync(AppDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync(@"
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_CustomerLedgerEntries_VirtualPosReference""
    ON ""CustomerLedgerEntries"" (""DocumentNo"")
    WHERE ""TransactionType"" = 'Sanal POS Tahsilat' AND ""DocumentNo"" IS NOT NULL;");

        await db.Database.ExecuteSqlRawAsync(@"
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_BankAccountTransactions_VirtualPosReference""
    ON ""BankAccountTransactions"" (""DocumentNo"")
    WHERE ""DocumentNo"" LIKE 'VP-%';");
    }

    /// <summary>Each caller gets its own context — required for the concurrency tests.</summary>
    public AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(ConnectionString)
            .EnableSensitiveDataLogging(false) // never echo parameter values into test output
            .Options;

        return new AppDbContext(options);
    }

    private static async Task DropDatabaseAsync(NpgsqlConnection admin)
    {
        await using var terminate = new NpgsqlCommand(
            $"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{TestDatabaseName}' AND pid <> pg_backend_pid();",
            admin);
        await terminate.ExecuteNonQueryAsync();

        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{TestDatabaseName}\";", admin);
        await drop.ExecuteNonQueryAsync();
    }

    public async Task DisposeAsync()
    {
        if (!IsAvailable) return;

        AssertSafeTarget(TestDatabaseName);

        try
        {
            var builder = new NpgsqlConnectionStringBuilder(AdminConnectionString);
            await using var admin = new NpgsqlConnection(builder.ConnectionString);
            await admin.OpenAsync();
            await DropDatabaseAsync(admin);
        }
        catch
        {
            // Leaving the throwaway database behind is not worth failing the run over
        }
    }
}

[CollectionDefinition("postgres")]
public sealed class PostgresCollection : ICollectionFixture<PostgresTestFixture> { }
