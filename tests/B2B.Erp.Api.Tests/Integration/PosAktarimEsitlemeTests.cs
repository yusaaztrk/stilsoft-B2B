using System;
using System.Linq;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace B2B.Erp.Api.Tests.Integration;

/// <summary>
/// Aktarılmış POS tahsilatı silinince / değişince aktarımın da düzelmesi (2026-10-03,
/// <c>AppDbContext.SyncPosSweepsWithMovementChangesAsync</c>). Canlı olay: silinip doğru
/// bilgiyle yeniden girilen tahsilatlar eski aktarımda kalmış, POS hesabı 11.300 TL eksik
/// görünüyordu. Her test kendi POS/vadesiz hesap çiftini kurar, birbirini etkilemez.
/// </summary>
[Collection("postgres")]
public sealed class PosAktarimEsitlemeTests
{
    private readonly PostgresTestFixture _fixture;

    public PosAktarimEsitlemeTests(PostgresTestFixture fixture) => _fixture = fixture;

    // Firma günü 01.10.2026 (UTC+3): 30.09 21:00Z – 01.10 21:00Z
    private static readonly DateTime Gun = new(2026, 9, 30, 21, 0, 0, DateTimeKind.Utc);

    private sealed record Kurulum(int PosId, int VadesizId, int AktarimId, int CikisId, int GirisId, int[] Tahsilatlar);

    private static BankAccountTransaction Hareket(int hesap, DateTime tarih, BankAccountTransactionDirection yon, decimal tutar, string aciklama)
        => new()
        {
            BankAccountDefinitionId = hesap,
            Date = tarih,
            Direction = yon,
            Amount = tutar,
            CurrencyTypeId = 1,
            CurrencyRate = 1m,
            CurrencyAmount = tutar,
            CounterpartyType = BankAccountTransactionCounterpartyType.Bank,
            CounterpartyCode = "X",
            CounterpartyName = aciklama,
            Description = aciklama,
            CreateUser = "TEST",
            CreateTime = DateTime.UtcNow
        };

    /// <summary>01.10'da 1.000 + 2.000 + 3.000 + 4.000 tahsilat, 02.10'da 10.000'lik aktarım (iki bacak).</summary>
    private async Task<Kurulum> KurAsync()
    {
        var ek = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        await using var db = _fixture.CreateContext();

        var detay = await db.Set<BankDetail>().FirstOrDefaultAsync();
        if (detay == null)
        {
            detay = new BankDetail { Name = "TEST BANKASI", BankDetailCode = "T" + ek, IsActive = true };
            db.Set<BankDetail>().Add(detay);
            await db.SaveChangesAsync();
        }

        BankAccountDefinition Hesap(string ad) => new()
        {
            BankDetailId = detay.Id, AccountCode = ad + ek, AccountName = ad + " " + ek, AccountNo = ek,
            AccountType = 1, CurrencyTypeId = 1, CreateUser = "TEST", CreateTime = DateTime.UtcNow
        };

        var pos = Hesap("POS");
        var vadesiz = Hesap("VDS");
        db.BankAccountDefinitions.AddRange(pos, vadesiz);
        await db.SaveChangesAsync();

        var tahsilatlar = new[] { 1000m, 2000m, 3000m, 4000m }
            .Select((t, i) => Hareket(pos.Id, Gun.AddHours(10 + i), BankAccountTransactionDirection.In, t, "TAHSILAT"))
            .ToList();
        var cikis = Hareket(pos.Id, Gun.AddDays(1), BankAccountTransactionDirection.Out, 10000m, "AKTARIM");
        var giris = Hareket(vadesiz.Id, Gun.AddDays(1), BankAccountTransactionDirection.In, 10000m, "AKTARIM");
        db.BankAccountTransactions.AddRange(tahsilatlar);
        db.BankAccountTransactions.AddRange(cikis, giris);
        await db.SaveChangesAsync();

        var aktarim = new PosAccountTransfer
        {
            PosBankAccountDefinitionId = pos.Id,
            TargetBankAccountDefinitionId = vadesiz.Id,
            TransferDate = Gun,
            Amount = 10000m,
            OutBankAccountTransactionId = cikis.Id,
            InBankAccountTransactionId = giris.Id,
            IsAutomatic = true,
            CreateUser = "TEST",
            CreateTime = DateTime.UtcNow
        };
        db.PosAccountTransfers.Add(aktarim);
        await db.SaveChangesAsync();

        db.PosAccountTransferItems.AddRange(tahsilatlar.Select(t => new PosAccountTransferItem
        {
            PosAccountTransferId = aktarim.Id, BankAccountTransactionId = t.Id, Amount = t.Amount,
            CreateUser = "TEST", CreateTime = DateTime.UtcNow
        }));
        await db.SaveChangesAsync();

        return new Kurulum(pos.Id, vadesiz.Id, aktarim.Id, cikis.Id, giris.Id, tahsilatlar.Select(t => t.Id).ToArray());
    }

    private async Task<(decimal? Aktarim, decimal? Cikis, decimal? Giris, int Kalem, decimal KalemToplami)> DurumAsync(Kurulum k)
    {
        await using var db = _fixture.CreateContext();
        var a = await db.PosAccountTransfers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == k.AktarimId);
        var c = await db.BankAccountTransactions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == k.CikisId);
        var g = await db.BankAccountTransactions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == k.GirisId);
        var kalemler = await db.PosAccountTransferItems.AsNoTracking().Where(x => x.PosAccountTransferId == k.AktarimId).ToListAsync();
        return (a?.Amount, c?.Amount, g?.Amount, kalemler.Count, kalemler.Sum(x => x.Amount));
    }

    [SkippableFact]
    public async Task Silinen_tahsilat_aktarimdan_ve_iki_bacaktan_duser()
    {
        Skip.If(!_fixture.IsAvailable, "PostgreSQL unavailable");
        var k = await KurAsync();

        await using (var db = _fixture.CreateContext())
        {
            db.BankAccountTransactions.Remove(await db.BankAccountTransactions.FirstAsync(x => x.Id == k.Tahsilatlar[0]));
            await db.SaveChangesAsync();
        }

        var d = await DurumAsync(k);
        Assert.Equal(9000m, d.Aktarim);
        Assert.Equal(9000m, d.Cikis);
        Assert.Equal(9000m, d.Giris);
        Assert.Equal(3, d.Kalem);
        Assert.Equal(9000m, d.KalemToplami);
    }

    [SkippableFact]
    public async Task Tutari_degisen_tahsilat_aktarimi_fark_kadar_oynatir()
    {
        Skip.If(!_fixture.IsAvailable, "PostgreSQL unavailable");
        var k = await KurAsync();

        await using (var db = _fixture.CreateContext())
        {
            var h = await db.BankAccountTransactions.FirstAsync(x => x.Id == k.Tahsilatlar[1]);
            h.Amount = 1500m;
            h.CurrencyAmount = 1500m;
            await db.SaveChangesAsync();
        }

        var d = await DurumAsync(k);
        Assert.Equal(9500m, d.Aktarim);
        Assert.Equal(9500m, d.Cikis);
        Assert.Equal(9500m, d.Giris);
        Assert.Equal(4, d.Kalem);
        Assert.Equal(9500m, d.KalemToplami);
    }

    [SkippableFact]
    public async Task Baska_gune_tasinan_tahsilat_aktarimdan_cikar()
    {
        Skip.If(!_fixture.IsAvailable, "PostgreSQL unavailable");
        var k = await KurAsync();

        await using (var db = _fixture.CreateContext())
        {
            var h = await db.BankAccountTransactions.FirstAsync(x => x.Id == k.Tahsilatlar[2]);
            h.Date = Gun.AddDays(-2).AddHours(10); // 29.09'a taşındı
            await db.SaveChangesAsync();
        }

        var d = await DurumAsync(k);
        Assert.Equal(7000m, d.Aktarim);
        Assert.Equal(7000m, d.Cikis);
        Assert.Equal(7000m, d.Giris);
        Assert.Equal(3, d.Kalem);

        // Taşınan hareket artık hiçbir aktarımda değil — geç gelen tahsilat mantığı kendi gününe ekler.
        await using var check = _fixture.CreateContext();
        Assert.False(await check.PosAccountTransferItems.AnyAsync(x => x.BankAccountTransactionId == k.Tahsilatlar[2]));
    }

    [SkippableFact]
    public async Task Butun_tahsilatlar_silinince_aktarim_ve_bacaklari_kalkar()
    {
        Skip.If(!_fixture.IsAvailable, "PostgreSQL unavailable");
        var k = await KurAsync();

        await using (var db = _fixture.CreateContext())
        {
            db.BankAccountTransactions.RemoveRange(await db.BankAccountTransactions.Where(x => k.Tahsilatlar.Contains(x.Id)).ToListAsync());
            await db.SaveChangesAsync();
        }

        var d = await DurumAsync(k);
        Assert.Null(d.Aktarim);
        Assert.Null(d.Cikis);
        Assert.Null(d.Giris);
        Assert.Equal(0, d.Kalem);
    }

    [SkippableFact]
    public async Task Aktarimla_ilgisiz_hareket_silinince_aktarima_dokunulmaz()
    {
        Skip.If(!_fixture.IsAvailable, "PostgreSQL unavailable");
        var k = await KurAsync();

        int ilgisizId;
        await using (var db = _fixture.CreateContext())
        {
            var ilgisiz = Hareket(k.PosId, Gun.AddHours(15), BankAccountTransactionDirection.In, 777m, "AKTARILMAMIS");
            db.BankAccountTransactions.Add(ilgisiz);
            await db.SaveChangesAsync();
            ilgisizId = ilgisiz.Id;
        }

        await using (var db = _fixture.CreateContext())
        {
            db.BankAccountTransactions.Remove(await db.BankAccountTransactions.FirstAsync(x => x.Id == ilgisizId));
            await db.SaveChangesAsync();
        }

        var d = await DurumAsync(k);
        Assert.Equal(10000m, d.Aktarim);
        Assert.Equal(10000m, d.Cikis);
        Assert.Equal(10000m, d.Giris);
        Assert.Equal(4, d.Kalem);
    }

    [SkippableFact]
    public async Task Aktarimin_kendi_bacagi_silinince_tutar_degismez()
    {
        Skip.If(!_fixture.IsAvailable, "PostgreSQL unavailable");
        var k = await KurAsync();

        await using (var db = _fixture.CreateContext())
        {
            db.BankAccountTransactions.Remove(await db.BankAccountTransactions.FirstAsync(x => x.Id == k.GirisId));
            await db.SaveChangesAsync();
        }

        var d = await DurumAsync(k);
        Assert.Equal(10000m, d.Aktarim);
        Assert.Equal(10000m, d.Cikis);
        Assert.Null(d.Giris);
        Assert.Equal(4, d.Kalem);
    }
}
