using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace B2B.Erp.Api.Data.Services;

public static class VirtualPosSeeder
{
    public static async Task EnsurePosDataSeededAsync(AppDbContext dbContext, CancellationToken cancellationToken = default)
    {
        try
        {
            if (!await dbContext.VirtualPosDefinitions.AnyAsync(cancellationToken))
            {
                await SeedPosDataAsync(dbContext, null, cancellationToken);
            }
        }
        catch { }
    }

    public static async Task SeedPosDataAsync(AppDbContext dbContext, ILogger? logger = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var createTablesSql = @"
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

-- The merchant order number identifies a payment towards the bank and is the key a 3D
-- callback arrives with. A unique index makes duplicate finalization impossible even when
-- two callbacks are processed in parallel: the second write loses on the constraint
-- instead of producing a second transaction.
CREATE UNIQUE INDEX IF NOT EXISTS ""IX_VirtualPosTransactions_OrderNo""
    ON ""VirtualPosTransactions"" (""OrderNo"");

ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""ServiceOpsCariKodu"" text NULL;";

            await dbContext.Database.ExecuteSqlRawAsync(createTablesSql, cancellationToken);
            Console.WriteLine("[VirtualPosSeeder] SQL Tables ensured in database.");

            var posDir = @"C:\Users\Admin\Desktop\POS";
            if (!Directory.Exists(posDir))
            {
                Console.WriteLine($"[VirtualPosSeeder] POS directory {posDir} does not exist.");
                return;
            }

            // 1. Seed VirtualPosDefinitions
            if (!await dbContext.VirtualPosDefinitions.AnyAsync(cancellationToken))
            {
                var bankaBilgiFile = Path.Combine(posDir, "TBLBANKABILGI.csv");
                var posBankaFile = Path.Combine(posDir, "TBLPOSBANKA.csv");

                if (File.Exists(bankaBilgiFile))
                {
                    var lines = await File.ReadAllLinesAsync(bankaBilgiFile, cancellationToken);
                    var defaultBankCode = 10; // Ziraat default
                    if (File.Exists(posBankaFile))
                    {
                        var posBankaLines = await File.ReadAllLinesAsync(posBankaFile, cancellationToken);
                        foreach (var l in posBankaLines.Skip(1))
                        {
                            var parts = l.Split(';');
                            if (parts.Length >= 4 && int.TryParse(parts[1], out var bc) && parts[3].Trim() == "1")
                            {
                                defaultBankCode = bc;
                                break;
                            }
                        }
                    }

                    foreach (var line in lines.Skip(1))
                    {
                        if (string.IsNullOrWhiteSpace(line)) continue;
                        var parts = line.Split(';');
                        if (parts.Length < 21) continue;

                        if (!int.TryParse(parts[1], out var bankCode)) continue;

                        var def = new VirtualPosDefinition
                        {
                            BankCode = bankCode,
                            BankName = GetBankNameByCode(bankCode),
                            UserCode = parts[2].Trim(),
                            Password = parts[3].Trim(),
                            ClientId = parts[5].Trim(),
                            Key3D = parts[6].Trim(),
                            ApprovedUrl = parts[11].Trim(),
                            GatewayUrl = parts[12].Trim(),
                            NethesCode = parts[13].Trim(),
                            PosnetId = parts[14].Trim(),
                            PosType = parts[15].Trim().ToUpperInvariant(),
                            ProvisionPassword = parts[16].Trim(),
                            TerminalId = parts[18].Trim(),
                            XmlUrl = parts[20].Trim(),
                            IsDefault = bankCode == defaultBankCode,
                            IsActive = true
                        };

                        if (string.IsNullOrEmpty(def.PosType))
                        {
                            def.PosType = "NESTPAY";
                        }

                        dbContext.VirtualPosDefinitions.Add(def);
                    }

                    await dbContext.SaveChangesAsync(cancellationToken);
                    logger?.LogInformation("[VirtualPosSeeder] VirtualPosDefinitions seeded successfully.");
                }
            }

            // 2. Seed VirtualPosInstallmentRules
            if (!await dbContext.VirtualPosInstallmentRules.AnyAsync(cancellationToken))
            {
                var taksitFile = Path.Combine(posDir, "TBLPOSTAKSIT.csv");
                if (File.Exists(taksitFile))
                {
                    var lines = await File.ReadAllLinesAsync(taksitFile, cancellationToken);
                    foreach (var line in lines.Skip(1))
                    {
                        if (string.IsNullOrWhiteSpace(line)) continue;
                        var parts = line.Split(';');
                        if (parts.Length < 10) continue;

                        if (!int.TryParse(parts[1], out var bankCode)) continue;
                        _ = int.TryParse(parts[2], out var merchInst);
                        _ = int.TryParse(parts[3], out var bankInst);
                        _ = decimal.TryParse(parts[4], out var minAmt);
                        _ = decimal.TryParse(parts[5], out var maxAmt);
                        var active = parts[8].Trim() == "1";

                        var rule = new VirtualPosInstallmentRule
                        {
                            BankCode = bankCode,
                            MerchantInstallment = merchInst,
                            BankInstallment = bankInst,
                            MinAmount = minAmt > 0 ? minAmt : 1m,
                            MaxAmount = maxAmt > 0 ? maxAmt : 999999999m,
                            Description = parts[6].Trim(),
                            InstallmentText = parts[7].Trim(),
                            IsActive = active
                        };

                        dbContext.VirtualPosInstallmentRules.Add(rule);
                    }

                    await dbContext.SaveChangesAsync(cancellationToken);
                    logger?.LogInformation("[VirtualPosSeeder] VirtualPosInstallmentRules seeded successfully.");
                }
            }

            // 3. Seed VirtualPosBins
            if (!await dbContext.VirtualPosBins.AnyAsync(cancellationToken))
            {
                var binFile = Path.Combine(posDir, "TBLPOSBIN.csv");
                if (File.Exists(binFile))
                {
                    var lines = await File.ReadAllLinesAsync(binFile, cancellationToken);
                    foreach (var line in lines.Skip(1))
                    {
                        if (string.IsNullOrWhiteSpace(line)) continue;
                        var parts = line.Split(';');
                        if (parts.Length < 7) continue;

                        if (!int.TryParse(parts[1], out var bankCode)) continue;
                        var binNo = parts[2].Trim();
                        if (string.IsNullOrEmpty(binNo)) continue;

                        _ = int.TryParse(parts[6], out var targetBankCode);

                        var bin = new VirtualPosBin
                        {
                            BankCode = bankCode,
                            BinNo = binNo,
                            CardType1 = parts[3].Trim(),
                            CardType2 = parts[4].Trim(),
                            InstallmentBankCode = targetBankCode > 0 ? targetBankCode : bankCode
                        };

                        dbContext.VirtualPosBins.Add(bin);
                    }

                    await dbContext.SaveChangesAsync(cancellationToken);
                    logger?.LogInformation("[VirtualPosSeeder] VirtualPosBins seeded successfully ({Count} items).", dbContext.VirtualPosBins.Local.Count);
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[VirtualPosSeeder] ERROR: {ex.Message} \n {ex.StackTrace}");
            logger?.LogError(ex, "[VirtualPosSeeder] Exception while seeding POS data.");
        }
    }

    private static string GetBankNameByCode(int code)
    {
        return code switch
        {
            10 => "ZİRAAT BANKASI",
            12 => "HALKBANK",
            62 => "GARANTİ BBVA",
            64 => "İŞ BANKASI",
            120 => "KOOPBANK",
            136 => "CREDITWEST CARDPLUS",
            _ => $"BANKA ({code})"
        };
    }
}
