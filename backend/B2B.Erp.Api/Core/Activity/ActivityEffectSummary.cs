namespace B2B.Erp.Api.Core.Activity;

/// <summary>Kaydın hangi yönde değiştiği. EF'in <c>EntityState</c>'inden bağımsız tutuldu ki
/// özet mantığı veritabanı katmanına bağlanmasın ve test edilebilsin.</summary>
public enum ActivityChangeState
{
    Added,
    Modified,
    Deleted
}

/// <summary>
/// Bir stok hareketinin değişimi.
///
/// <para>
/// <b>DEPO alanı şart.</b> Özet önce yalnız ürün koduna göre topluyordu ve bir depo
/// transferi — aynı üründen bir depoda eksi, diğerinde artı — toplamda sıfıra iniyor,
/// kayda "net stok etkisi yok" diye düşüyordu. Oysa mal gerçekten yer değiştirmişti;
/// görülmek istenen tam olarak buydu. Kırılım artık (ürün, depo) ikilisinde.
/// </para>
/// </summary>
/// <param name="StockCode">Ürün kodu.</param>
/// <param name="WarehouseLabel">Deponun adı (bulunamazsa kodu).</param>
/// <param name="IsInbound">Hareket GİRİŞ mi (aksi hâlde çıkış).</param>
/// <param name="Quantity">Hareketin adedi (daima pozitif tutulur; yönü <paramref name="IsInbound"/> taşır).</param>
public sealed record StockChange(
    string StockCode,
    string WarehouseLabel,
    bool IsInbound,
    decimal Quantity,
    ActivityChangeState State);

/// <summary>
/// Bir cari ekstre satırının değişimi.
///
/// <para>
/// <b>İki tutar birden taşınır ve bu şart.</b> <c>TryAmount</c> her zaman TL'dir (sistemin
/// çapası, bakiye ondan toplanır); <c>DocumentAmount</c> ise belgenin KENDİ parasındaki
/// değeridir. Özet yalnız TL'yi yazdığında 1.200 $'lık bir fatura kayda "120.000,00" diye
/// düşüyordu — doğru bir sayı, ama kayda bakan kişinin girdiği belgeyle uzaktan yakından
/// benzemiyor.
/// </para>
/// </summary>
/// <param name="CurrencyCode">Belgenin para birimi kodu (TRY/USD/EUR/GBP).</param>
/// <param name="DocumentAmount">Belgenin kendi parasındaki tutar.</param>
/// <param name="TryAmount">TL karşılığı. Belge zaten TL ise <paramref name="DocumentAmount"/> ile aynıdır.</param>
public sealed record LedgerChange(
    string CustomerCode,
    bool IsDebit,
    string CurrencyCode,
    decimal DocumentAmount,
    decimal TryAmount,
    ActivityChangeState State);

/// <summary>Bir montaj/servis kaydının değişimi. <paramref name="Status"/> yalnız güncellemede anlamlı.</summary>
public sealed record InstallationChange(string Status, ActivityChangeState State);

/// <summary>Ürün kartındaki stok alanının değişimi.</summary>
public sealed record ProductStockChange(string StockCode, int Before, int After);

/// <summary>Ayrıca ayrıştırılmayan, yalnız sayısı yazılan kayıt türleri.</summary>
public sealed record GenericChange(string TurkishName, ActivityChangeState State);

/// <summary>Silinen belgenin geri yüklenebilir yedeğinin alınıp alınmadığı.</summary>
public sealed record DeletionBackupChange(int Count);

/// <summary>
/// BİR KULLANICI İŞLEMİNİN TETİKLEDİKLERİNİ İNSAN DİLİNE ÇEVİRİR (2026-08-20 kullanıcı isteği).
///
/// <para>
/// Hareket kaydı bugüne kadar yalnız "ne yapıldığını" söylüyordu ("Satış Faturası silindi").
/// Oysa aynı işlem stok hareketini, cari ekstre satırını, montaj kaydını da değiştiriyor;
/// "faturayı sildim, stok geri döndü mü, ekstreden düştü mü?" sorusunun cevabı kayıtta hiç
/// yoktu.
/// </para>
///
/// <para>
/// <b>Neden EF'ten ayrı bir sınıf?</b> Buradaki tek ince kural stok işaretidir ve yanlış
/// olduğunda gürültü çıkarmaz — sadece kayıtta "stok arttı" yerine "azaldı" yazar, yani
/// denetim izini sessizce yalancı yapar. Kural bu yüzden <see cref="StockDelta"/> içinde tek
/// bir yerde duruyor ve doğrudan test ediliyor.
/// </para>
/// </summary>
public static class ActivityEffectSummary
{
    /// <summary>Aynı üründen en fazla kaç satır yazılacağı; gerisi tek satırda özetlenir.</summary>
    public const int MaxStockLines = 8;

    /// <summary>Cari ekstre özetinde en fazla kaç ayrı hesap yazılacağı.</summary>
    public const int MaxLedgerCustomers = 5;

    /// <summary>
    /// Bir stok hareketinin DEPODAKİ MALA net etkisi.
    ///
    /// <para>
    /// İki bilgi birlikte okunmak zorunda: hareketin YÖNÜ ve harekete NE OLDUĞU. Bir ÇIKIŞ
    /// hareketi eklenirse mal azalır; aynı hareket SİLİNİRSE mal geri gelir. Faturası silinen
    /// bir satışta olan tam olarak budur — kullanıcının görmek istediği "stok arttı" cümlesi
    /// buradan çıkar.
    /// </para>
    ///
    /// <para>
    /// Güncelleme sıfır döner: adet değişimini doğru hesaplamak için hareketin ESKİ adedi de
    /// gerekir, o bilgi burada yok. Uydurulmuş bir sayı yazmaktansa hiç yazmamak doğrudur.
    /// </para>
    /// </summary>
    public static decimal StockDelta(bool isInbound, decimal quantity, ActivityChangeState state)
    {
        if (state == ActivityChangeState.Modified) return 0m;

        var sign = isInbound ? 1m : -1m;
        if (state == ActivityChangeState.Deleted) sign = -sign;

        return sign * quantity;
    }

    /// <summary>Sıra ÖNEMLİ: stok ve para en üstte, teknik kayıtlar altta — listeye bakan kişi
    /// önce "malım ve param ne oldu" cevabını görmeli.</summary>
    public static List<string> Build(
        IReadOnlyList<StockChange> stockChanges,
        IReadOnlyList<LedgerChange> ledgerChanges,
        IReadOnlyList<InstallationChange> installationChanges,
        IReadOnlyList<ProductStockChange> productStockChanges,
        IReadOnlyList<GenericChange> genericChanges,
        DeletionBackupChange? deletionBackup = null)
    {
        var effects = new List<string>();

        AppendStock(effects, stockChanges);
        AppendLedger(effects, ledgerChanges);
        AppendInstallations(effects, installationChanges);
        AppendProductStock(effects, productStockChanges);
        AppendGeneric(effects, genericChanges);
        AppendDeletionBackup(effects, deletionBackup);

        return effects;
    }

    /// <summary>
    /// Yedek satırı EN SONA ve kendi cümlesiyle yazılır.
    ///
    /// <para>
    /// Önceden diğer teknik kayıtlarla aynı kalıptan geçiyordu: <i>"Silme yedeği: 1 kayıt
    /// eklendi."</i> Bu cümle silme işleminin ortasında okununca "ne eklendi?" diye
    /// düşündürüyor; oysa söylediği şey aslında iyi haber — <b>silinen belge geri
    /// yüklenebilir</b>. Sayı da gereksiz: yedek ya alınmıştır ya alınmamıştır.
    /// </para>
    /// </summary>
    private static void AppendDeletionBackup(List<string> effects, DeletionBackupChange? backup)
    {
        if (backup is null || backup.Count <= 0) return;

        effects.Add(backup.Count == 1
            ? "Silinen belgenin yedeği alındı — kayıt geri yüklenebilir."
            : $"Silinen {backup.Count} belgenin yedeği alındı — kayıtlar geri yüklenebilir.");
    }

    private static void AppendStock(List<string> effects, IReadOnlyList<StockChange> changes)
    {
        if (changes.Count == 0) return;

        // Kırılım (ÜRÜN, DEPO): depo transferinde aynı ürün bir depodan çıkıp diğerine
        // girdiği için yalnız ürüne göre toplayan bir özet sıfır gösterirdi.
        var net = new Dictionary<(string Stock, string Warehouse), decimal>();
        var counted = 0;

        foreach (var change in changes)
        {
            var delta = StockDelta(change.IsInbound, change.Quantity, change.State);
            var code = string.IsNullOrWhiteSpace(change.StockCode) ? "(kodsuz)" : change.StockCode.Trim();
            var warehouse = string.IsNullOrWhiteSpace(change.WarehouseLabel) ? "(depo yok)" : change.WarehouseLabel.Trim();
            var key = (code, warehouse);

            net[key] = net.TryGetValue(key, out var current) ? current + delta : delta;
            counted++;
        }

        var moved = net.Where(x => x.Value != 0m).OrderByDescending(x => Math.Abs(x.Value)).ToList();

        if (moved.Count == 0)
        {
            // Aynı işlemde hem silinip hem eklenen hareketler birbirini götürebilir (fatura
            // güncelleme bunu yapar). Sessiz kalmak yanlış olurdu: hareket değişti ama depoda
            // duran mal aynı kaldı — ikisi ayrı bilgi.
            effects.Add($"Stok: {counted} hareket değişti, net stok etkisi yok.");
            return;
        }

        foreach (var item in moved.Take(MaxStockLines))
        {
            var yon = item.Value > 0 ? "girdi" : "çıktı";
            effects.Add($"Stok: {item.Key.Stock} {item.Value:+#,##0.##;-#,##0.##} adet — {item.Key.Warehouse} ({yon}).");
        }

        if (moved.Count > MaxStockLines)
        {
            effects.Add($"Stok: ve {moved.Count - MaxStockLines} depo/ürün satırı daha etkilendi.");
        }
    }

    private static void AppendLedger(List<string> effects, IReadOnlyList<LedgerChange> changes)
    {
        foreach (var stateGroup in changes.GroupBy(x => x.State))
        {
            var fiil = Fiil(stateGroup.Key);

            foreach (var byCustomer in stateGroup.GroupBy(x => x.CustomerCode ?? string.Empty).Take(MaxLedgerCustomers))
            {
                // Para birimi başına ayrı toplanır. Farklı dövizdeki satırlar tek sayıda
                // toplansaydı 1.000 $ ile 1.000 ₺ "2.000" olurdu.
                var parts = new List<string>();
                foreach (var byCurrency in byCustomer.GroupBy(x => x.CurrencyCode).OrderBy(x => x.Key))
                {
                    var borc = byCurrency.Where(x => x.IsDebit).Sum(x => x.DocumentAmount);
                    var alacak = byCurrency.Where(x => !x.IsDebit).Sum(x => x.DocumentAmount);

                    if (borc != 0m) parts.Add(FormatMoney("borç", borc, byCurrency.Key, byCurrency.Where(x => x.IsDebit).Sum(x => x.TryAmount)));
                    if (alacak != 0m) parts.Add(FormatMoney("alacak", alacak, byCurrency.Key, byCurrency.Where(x => !x.IsDebit).Sum(x => x.TryAmount)));
                }

                var tutar = parts.Count > 0 ? " (" + string.Join(", ", parts) + ")" : string.Empty;
                var hesap = string.IsNullOrWhiteSpace(byCustomer.Key) ? "(kodsuz)" : byCustomer.Key;
                effects.Add($"Cari ekstre: {hesap} hesabından {byCustomer.Count()} satır {fiil}{tutar}.");
            }
        }
    }

    private static void AppendInstallations(List<string> effects, IReadOnlyList<InstallationChange> changes)
    {
        foreach (var stateGroup in changes.GroupBy(x => x.State))
        {
            if (stateGroup.Key == ActivityChangeState.Modified)
            {
                // Durumun DEĞERİ yazılır, yalnız "güncellendi" değil: faturası silinen montajın
                // "Pasif / Geri Alındı"ya döndüğünü görmek isteyen kişi tam olarak bunu arıyor.
                foreach (var byStatus in stateGroup.GroupBy(x => string.IsNullOrWhiteSpace(x.Status) ? "(belirsiz)" : x.Status))
                {
                    effects.Add($"Montaj kaydı: {byStatus.Count()} kayıt \"{byStatus.Key}\" durumuna alındı.");
                }
            }
            else
            {
                var fiil = stateGroup.Key == ActivityChangeState.Deleted ? "silindi" : "oluşturuldu";
                effects.Add($"Montaj kaydı: {stateGroup.Count()} kayıt {fiil}.");
            }
        }
    }

    private static void AppendProductStock(List<string> effects, IReadOnlyList<ProductStockChange> changes)
    {
        foreach (var change in changes)
        {
            if (change.Before == change.After) continue;
            effects.Add($"Ürün stoğu: {change.StockCode} {change.Before} → {change.After} ({change.After - change.Before:+#,##0;-#,##0}).");
        }
    }

    private static void AppendGeneric(List<string> effects, IReadOnlyList<GenericChange> changes)
    {
        foreach (var group in changes.GroupBy(x => new { x.TurkishName, x.State }))
        {
            effects.Add($"{group.Key.TurkishName}: {group.Count()} kayıt {Fiil(group.Key.State)}.");
        }
    }

    /// <summary>
    /// Tutarı BELGENİN parasında yazar; TL karşılığını yanına parantezle ekler.
    ///
    /// <para>
    /// TL karşılığı atılmıyor, çünkü bakiye ondan hesaplanıyor ve bir tutarsızlık arandığında
    /// bakılacak sayı odur. Ama BAŞA belgenin kendi parası yazılır: kullanıcı 1.200 $ girdiyse
    /// kayıtta önce 1.200 $ görmeli.
    /// </para>
    /// </summary>
    private static string FormatMoney(string label, decimal documentAmount, string currencyCode, decimal tryAmount)
    {
        var isTry = string.Equals(currencyCode, "TRY", StringComparison.OrdinalIgnoreCase);

        if (isTry)
        {
            return $"{label} {documentAmount:N2} TRY";
        }

        return $"{label} {documentAmount:N2} {currencyCode} ({tryAmount:N2} TRY karşılığı)";
    }

    private static string Fiil(ActivityChangeState state) => state switch
    {
        ActivityChangeState.Deleted => "silindi",
        ActivityChangeState.Added => "eklendi",
        _ => "güncellendi"
    };
}
