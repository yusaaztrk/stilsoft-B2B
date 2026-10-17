using B2B.Erp.Api.Core.Helpers;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Configuration.Memory;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Firmanın gün sınırını çiviler (denetim md. D1).
///
/// <para>
/// Somut şikâyet: KKTC (UTC+3) saatiyle gece 01:30'da alınan POS tahsilatı, UTC damgası bir
/// önceki günün 22:30'u olduğu için <b>bir önceki günün</b> süpürme havuzuna düşüyordu.
/// Aşağıdaki testler gün penceresinin firmanın 00:00'ından ertesi 00:00'a kurulduğunu
/// doğrular; ayar verilmediğinde davranışın değişmediğini de.
/// </para>
/// </summary>
public sealed class CompanyClockTests
{
    /// <summary>UTC+3, yaz saati uygulaması yok — KKTC/Türkiye'nin bugünkü durumu.</summary>
    private static readonly TimeZoneInfo Utc3 =
        TimeZoneInfo.CreateCustomTimeZone("TEST-UTC+3", TimeSpan.FromHours(3), "TEST-UTC+3", "TEST-UTC+3");

    [Fact]
    public void GunPenceresi_FirmaninGeceYarisindaBaslar()
    {
        var clock = CompanyClock.For(Utc3);

        // 2026-08-20 firmada 00:00 → UTC'de bir önceki günün 21:00'i.
        Assert.Equal(new DateTime(2026, 8, 19, 21, 0, 0, DateTimeKind.Utc),
            clock.CompanyDayStartUtc(new DateTime(2026, 8, 20)));

        Assert.Equal(new DateTime(2026, 8, 20, 21, 0, 0, DateTimeKind.Utc),
            clock.CompanyDayEndUtc(new DateTime(2026, 8, 20)));
    }

    [Fact]
    public void GeceYarisindanSonrakiTahsilat_DogruGuneDuser()
    {
        var clock = CompanyClock.For(Utc3);

        // Firmada 20 Ağustos 01:30 = UTC 19 Ağustos 22:30. Eski kural bunu 19'a yazıyordu.
        var utcDamga = new DateTime(2026, 8, 19, 22, 30, 0, DateTimeKind.Utc);

        Assert.Equal(new DateTime(2026, 8, 20), clock.CompanyDateOf(utcDamga));

        var start = clock.CompanyDayStartUtc(new DateTime(2026, 8, 20));
        var end = clock.CompanyDayEndUtc(new DateTime(2026, 8, 20));
        Assert.True(utcDamga >= start && utcDamga < end);
    }

    [Fact]
    public void GunSonundakiTahsilat_ErtesiGuneKACMAZ()
    {
        var clock = CompanyClock.For(Utc3);

        // Firmada 20 Ağustos 23:59 = UTC 20 Ağustos 20:59 — hâlâ 20 Ağustos.
        var utcDamga = new DateTime(2026, 8, 20, 20, 59, 0, DateTimeKind.Utc);

        Assert.Equal(new DateTime(2026, 8, 20), clock.CompanyDateOf(utcDamga));
    }

    [Fact]
    public void PencereBitisiDisaridadir_IkiGunAyniHareketiSaymaz()
    {
        var clock = CompanyClock.For(Utc3);

        var yirmininSonu = clock.CompanyDayEndUtc(new DateTime(2026, 8, 20));
        var yirmibirinBasi = clock.CompanyDayStartUtc(new DateTime(2026, 8, 21));

        // Bitiş ile başlangıç AYNI an olmalı: pencere [start, end) olduğu için hareket tek güne girer.
        Assert.Equal(yirmibirinBasi, yirmininSonu);
    }

    [Fact]
    public void BelgeTarihi_FirmaGununu_UtcGeceYarisiOlarakDamgalar()
    {
        // Firmada 20 Ağustos 01:30 (UTC+3) = UTC 19 Ağustos 22:30. Belge 20 Ağustos'a
        // yazılmalı: eski davranış UTC gününü aldığı için 19 Ağustos yazıyordu ve gece
        // vardiyasında kesilen fatura kapanmış bir güne düşüyordu.
        var clock = CompanyClock.For(Utc3);
        var utcDamga = new DateTime(2026, 8, 19, 22, 30, 0, DateTimeKind.Utc);

        var firmaGunu = clock.CompanyDateOf(utcDamga);

        Assert.Equal(new DateTime(2026, 8, 20), firmaGunu);

        // Saklama biçimi değişmez: gece yarısı + Kind=Utc (sistemdeki "yalnız tarih" konvansiyonu).
        var belgeTarihi = DateTime.SpecifyKind(firmaGunu, DateTimeKind.Utc);
        Assert.Equal(DateTimeKind.Utc, belgeTarihi.Kind);
        Assert.Equal(TimeSpan.Zero, belgeTarihi.TimeOfDay);
    }

    [Fact]
    public void AyarBos_SunucununYereliKullanilir_DavranisDegismez()
    {
        var clock = new CompanyClock(new ConfigurationBuilder().Build());

        Assert.Equal(TimeZoneInfo.Local, clock.TimeZone);
    }

    [Fact]
    public void TaninmayanKimlik_YereleDuser_UygulamaCokmez()
    {
        // Yanlış yazılmış bir kimlik yüzünden bütün günlük işlerin durması, sessizce eski
        // davranışa dönmekten çok daha kötüdür.
        var config = new ConfigurationBuilder()
            .Add(new MemoryConfigurationSource
            {
                InitialData = new Dictionary<string, string?> { ["Company:TimeZone"] = "Boyle/Bir/Yer/Yok" }
            })
            .Build();

        var clock = new CompanyClock(config);

        Assert.Equal(TimeZoneInfo.Local, clock.TimeZone);
    }
}
