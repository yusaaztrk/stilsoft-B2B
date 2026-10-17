using B2B.Erp.Api.Core.Activity;

namespace B2B.Erp.Api.Tests;

/// <summary>
/// Hareket kaydındaki "bu işlem neyi tetikledi" özetini çiviler.
///
/// <para>
/// Korunan şey denetim izinin DÜRÜSTLÜĞÜ. Buradaki bir hata gürültü çıkarmaz: kayıtta "stok
/// arttı" yerine "azaldı" yazar ve kimse fark etmez. Faturasını silip stoğunun geri dönüp
/// dönmediğini kayıttan okuyan kişi tam tersini öğrenir.
/// </para>
/// </summary>
public sealed class ActivityEffectSummaryTests
{
    // ---------------------------------------------------------------- stok işareti

    [Fact]
    public void Cikis_Hareketi_SILINIRSE_Stok_GERI_GELIR()
    {
        // Kullanıcının sorduğu asıl senaryo: satış faturası silindi, mal depoya döndü.
        Assert.Equal(5m, ActivityEffectSummary.StockDelta(isInbound: false, 5m, ActivityChangeState.Deleted));
    }

    [Fact]
    public void Cikis_Hareketi_EKLENIRSE_Stok_DUSER()
    {
        Assert.Equal(-5m, ActivityEffectSummary.StockDelta(isInbound: false, 5m, ActivityChangeState.Added));
    }

    [Fact]
    public void Giris_Hareketi_EKLENIRSE_Stok_ARTAR()
    {
        Assert.Equal(5m, ActivityEffectSummary.StockDelta(isInbound: true, 5m, ActivityChangeState.Added));
    }

    [Fact]
    public void Giris_Hareketi_SILINIRSE_Stok_DUSER()
    {
        Assert.Equal(-5m, ActivityEffectSummary.StockDelta(isInbound: true, 5m, ActivityChangeState.Deleted));
    }

    [Fact]
    public void Guncelleme_Stok_Etkisi_URETMEZ()
    {
        // Eski adet elimizde yok; uydurulmuş bir sayı yazmaktansa hiç yazmamak doğru.
        Assert.Equal(0m, ActivityEffectSummary.StockDelta(isInbound: false, 5m, ActivityChangeState.Modified));
    }

    // ---------------------------------------------------------------- cümleler

    [Fact]
    public void Fatura_Silindiginde_Stok_Artisi_Yazilir()
    {
        var effects = Build(stock: new[]
        {
            new StockChange("SEG53031", "Merkez Depo", IsInbound: false, 3m, ActivityChangeState.Deleted),
            new StockChange("SEG53031", "Merkez Depo", IsInbound: false, 2m, ActivityChangeState.Deleted),
        });

        var line = Assert.Single(effects);
        Assert.Contains("SEG53031", line);
        Assert.Contains("girdi", line);
        Assert.Contains("+5", line);
    }

    [Fact]
    public void Depo_Transferi_IKI_SATIR_Yazar_Sifirlanmaz()
    {
        // Kullanıcının istediği tam olarak bu: "+1 bir depo, -1 diğer depo". Özet yalnız ürün
        // koduna göre toplasaydı transfer sıfıra iner ve kayda "net stok etkisi yok" düşerdi —
        // oysa mal gerçekten yer değiştirmiş olurdu.
        var effects = Build(stock: new[]
        {
            new StockChange("SBE92002", "Merkez Depo", IsInbound: false, 1m, ActivityChangeState.Added),
            new StockChange("SBE92002", "HASPOLAT", IsInbound: true, 1m, ActivityChangeState.Added),
        });

        Assert.Equal(2, effects.Count);
        Assert.Contains(effects, x => x.Contains("Merkez Depo") && x.Contains("-1") && x.Contains("çıktı"));
        Assert.Contains(effects, x => x.Contains("HASPOLAT") && x.Contains("+1") && x.Contains("girdi"));
        Assert.DoesNotContain(effects, x => x.Contains("net stok etkisi yok"));
    }

    [Fact]
    public void Ayni_Depoda_Birbirini_Goturen_Hareketler_Net_Etki_Yok_Der()
    {
        // Fatura güncellemesi eski hareketi silip yenisini yazar. Depodaki mal aynı kalır ama
        // "hiç etki yok" demek de yanlış olur — hareket gerçekten değişti.
        var effects = Build(stock: new[]
        {
            new StockChange("ABC", "Merkez Depo", IsInbound: false, 4m, ActivityChangeState.Deleted),
            new StockChange("ABC", "Merkez Depo", IsInbound: false, 4m, ActivityChangeState.Added),
        });

        var line = Assert.Single(effects);
        Assert.Contains("net stok etkisi yok", line);
        Assert.Contains("2 hareket", line);
    }

    [Fact]
    public void Cari_Ekstre_Hesap_Bazinda_Ozetlenir()
    {
        var effects = Build(ledger: new[]
        {
            new LedgerChange("120-01-000493-1", IsDebit: true, "TRY", 3720m, 3720m, ActivityChangeState.Deleted),
        });

        var line = Assert.Single(effects);
        Assert.Contains("120-01-000493-1", line);
        Assert.Contains("silindi", line);
        Assert.Contains("borç", line);
    }

    [Fact]
    public void Dovizli_Satirda_ONCE_BELGENIN_PARASI_Yazilir()
    {
        // Kullanıcının şikâyeti buydu: 1.200 $'lık fatura kayda "120.000,00" diye düşüyordu.
        // Doğru bir sayı, ama girilen belgeyle uzaktan yakından benzemiyor.
        var effects = Build(ledger: new[]
        {
            new LedgerChange("120-01-000493-1", IsDebit: true, "USD", 1200m, 120000m, ActivityChangeState.Deleted),
        });

        var line = Assert.Single(effects);
        Assert.Contains("1.200,00 USD", line);
        Assert.Contains("120.000,00 TRY karşılığı", line);
        Assert.True(line.IndexOf("1.200,00 USD", StringComparison.Ordinal) < line.IndexOf("120.000,00", StringComparison.Ordinal));
    }

    [Fact]
    public void Farkli_Dovizler_Tek_Sayida_TOPLANMAZ()
    {
        // 1.000 $ ile 1.000 ₺ toplanıp "2.000" olsaydı kayıt anlamsız bir sayı gösterirdi.
        var effects = Build(ledger: new[]
        {
            new LedgerChange("120-01", IsDebit: true, "USD", 1000m, 47915m, ActivityChangeState.Added),
            new LedgerChange("120-01", IsDebit: true, "TRY", 1000m, 1000m, ActivityChangeState.Added),
        });

        var line = Assert.Single(effects);
        Assert.Contains("1.000,00 USD", line);
        Assert.Contains("1.000,00 TRY", line);
        Assert.DoesNotContain("2.000,00", line);
    }

    [Fact]
    public void TL_Satirda_TL_Karsiligi_TEKRAR_YAZILMAZ()
    {
        var effects = Build(ledger: new[]
        {
            new LedgerChange("120-01", IsDebit: false, "TRY", 500m, 500m, ActivityChangeState.Added),
        });

        var line = Assert.Single(effects);
        Assert.Contains("alacak 500,00 TRY", line);
        Assert.DoesNotContain("karşılığı", line);
    }

    [Fact]
    public void Silme_Yedegi_GERI_YUKLENEBILIR_Der()
    {
        // Eski cümle "Silme yedeği: 1 kayıt eklendi." idi — silme işleminin ortasında
        // "ne eklendi?" diye düşündürüyordu. Söylediği şey aslında iyi haber.
        var effects = Build(deletionBackup: new DeletionBackupChange(1));

        var line = Assert.Single(effects);
        Assert.Contains("geri yüklenebilir", line);
        Assert.DoesNotContain("kayıt eklendi", line);
    }

    [Fact]
    public void Silme_Yedegi_EN_SONDA_Durur()
    {
        var effects = Build(
            stock: new[] { new StockChange("ABC", "Merkez Depo", IsInbound: false, 1m, ActivityChangeState.Deleted) },
            deletionBackup: new DeletionBackupChange(1));

        Assert.StartsWith("Stok:", effects[0]);
        Assert.Contains("geri yüklenebilir", effects[^1]);
    }

    [Fact]
    public void Montaj_Kaydinin_YENI_DURUMU_Yazilir()
    {
        // "güncellendi" demek yetmez: faturası silinen montajın hangi duruma döndüğü aranıyor.
        var effects = Build(installations: new[]
        {
            new InstallationChange("Pasif / Geri Alındı", ActivityChangeState.Modified),
            new InstallationChange("Pasif / Geri Alındı", ActivityChangeState.Modified),
        });

        var line = Assert.Single(effects);
        Assert.Contains("Pasif / Geri Alındı", line);
        Assert.Contains("2 kayıt", line);
    }

    [Fact]
    public void Urun_Stok_Alani_Degismediyse_Yazilmaz()
    {
        var effects = Build(productStock: new[] { new ProductStockChange("ABC", 12, 12) });
        Assert.Empty(effects);
    }

    [Fact]
    public void Urun_Stok_Alani_Degistiyse_Onceki_Ve_Sonraki_Yazilir()
    {
        var effects = Build(productStock: new[] { new ProductStockChange("ABC", 12, 17) });

        var line = Assert.Single(effects);
        Assert.Contains("12", line);
        Assert.Contains("17", line);
        Assert.Contains("+5", line);
    }

    [Fact]
    public void Cok_Sayida_Urun_Kirpilir_Ve_Kalani_Sayilir()
    {
        var many = Enumerable.Range(1, ActivityEffectSummary.MaxStockLines + 3)
            .Select(i => new StockChange($"URUN{i}", "Merkez Depo", IsInbound: false, i, ActivityChangeState.Deleted))
            .ToArray();

        var effects = Build(stock: many);

        Assert.Equal(ActivityEffectSummary.MaxStockLines + 1, effects.Count);
        Assert.Contains("3 depo/ürün satırı daha", effects[^1]);
    }

    [Fact]
    public void Stok_Ve_Para_Teknik_Kayitlarin_USTUNDE_Gorunur()
    {
        // Listeye bakan kişi önce "malım ve param ne oldu" cevabını görmeli.
        var effects = Build(
            stock: new[] { new StockChange("ABC", "Merkez Depo", IsInbound: false, 1m, ActivityChangeState.Deleted) },
            ledger: new[] { new LedgerChange("120-01", IsDebit: true, "TRY", 100m, 100m, ActivityChangeState.Deleted) },
            generic: new[] { new GenericChange("Fatura kalemi", ActivityChangeState.Deleted) });

        Assert.StartsWith("Stok:", effects[0]);
        Assert.StartsWith("Cari ekstre:", effects[1]);
        Assert.StartsWith("Fatura kalemi:", effects[2]);
    }

    [Fact]
    public void Hicbir_Ikincil_Degisiklik_Yoksa_Ozet_Bostur()
    {
        Assert.Empty(Build());
    }

    private static List<string> Build(
        StockChange[]? stock = null,
        LedgerChange[]? ledger = null,
        InstallationChange[]? installations = null,
        ProductStockChange[]? productStock = null,
        GenericChange[]? generic = null,
        DeletionBackupChange? deletionBackup = null)
        => ActivityEffectSummary.Build(
            stock ?? Array.Empty<StockChange>(),
            ledger ?? Array.Empty<LedgerChange>(),
            installations ?? Array.Empty<InstallationChange>(),
            productStock ?? Array.Empty<ProductStockChange>(),
            generic ?? Array.Empty<GenericChange>(),
            deletionBackup);
}
