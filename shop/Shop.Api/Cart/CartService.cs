using Npgsql;
using Shop.Api.Catalog;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Cart;

public sealed class CartLine
{
    public string StockCode { get; init; } = string.Empty;
    public string Slug { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? ImageUrl { get; init; }

    /// <summary>
    /// Ürünün kategori adresi (2026-09-20). Sepetteki çapraz satış bunu kullanıyor: öneriler
    /// sepettekilerin KENDİ kategorilerinden geliyor. Eskiden yalnız ankastre havuzuna
    /// bakılıyordu, dolayısıyla süpürge ya da küçük ev aleti alan müşteriye hiçbir öneri
    /// çıkmıyordu.
    /// </summary>
    public string? CategorySlug { get; init; }

    public int Quantity { get; init; }

    public decimal UnitNetPrice { get; init; }
    public decimal UnitGrossPrice { get; init; }
    public int TaxRate { get; init; }
    public decimal LineNet { get; init; }
    public decimal LineVat { get; init; }
    public decimal LineGross { get; init; }
    public string Currency { get; init; } = "TRY";
    public bool IsInstallable { get; init; }

    /// <summary>
    /// Müşteri bu satır için montaj İSTEDİ Mİ.
    ///
    /// Önceden böyle bir soru yoktu: ürün montajlıysa bedel otomatik ekleniyor, montaj kaydı
    /// otomatik açılıyordu. B2B sipariş ekranında seçim baştan beri var ("Montaj istiyorum /
    /// istemiyorum") — vitrin aynı davranışa getirildi. Seçilmemişse ne bedel alınır ne
    /// montaj kaydı açılır.
    /// </summary>
    public bool WantsInstallation { get; init; }

    /// <summary>
    /// Bir adet için montaj/kurulum bedeli — <b>KDV DAHİL</b>, ERP'deki
    /// <c>Products.InstallationFee</c> ile birebir. 0 ise montaj ücretsiz.
    ///
    /// Neden KDV dahil: ERP'de bu alan böyle giriliyor ve B2B sipariş ekranı da bunu
    /// KDV dahil sabit bir tutar olarak işliyor. Mağazanın farklı yorumlaması, aynı ürünün
    /// B2B'de ve vitrinde başka toplam üretmesi demek olurdu.
    /// </summary>
    public decimal InstallationFeeUnit { get; init; }

    /// <summary>
    /// Satırın TAHSİL EDİLEN montaj bedeli (birim × adet), KDV dahil.
    /// Montaj seçilmemişse 0 — <see cref="InstallationFeeUnit"/> yine dolu kalır, çünkü
    /// ekranda "montaj eklersen şu kadar" yazabilmek için gerekiyor.
    /// </summary>
    public decimal InstallationTotal { get; init; }
}

public sealed class CartView
{
    public IReadOnlyList<CartLine> Lines { get; init; } = Array.Empty<CartLine>();
    public decimal SubTotalNet { get; init; }
    public decimal VatTotal { get; init; }
    /// <summary>Ürünlerin KDV dahil toplamı — montaj bedeli HARİÇ.</summary>
    public decimal ProductTotal { get; init; }

    /// <summary>Sepetteki bütün satırların montaj bedeli toplamı, KDV dahil.</summary>
    public decimal InstallationTotal { get; init; }

    /// <summary>Ödenecek tutar: ürün toplamı + montaj bedeli.</summary>
    public decimal GrandTotal { get; init; }
    public string Currency { get; init; } = "TRY";
    public int ItemCount { get; init; }

    /// <summary>Sepette olup artık yayında olmayan ürünler — kullanıcıya söylenmeli.</summary>
    public IReadOnlyList<string> RemovedStockCodes { get; init; } = Array.Empty<string>();
}

/// <summary>
/// Sepet.
///
/// Satırda yalnızca stok kodu ve adet duruyor; FİYAT SAKLANMIYOR. Her okumada fiyat ERP
/// verisinden yeniden çözülüyor. Sebep: sepette bir hafta bekleyen satırın eski fiyatla
/// sipariş olması, e-ticaretteki en sinsi para kaybıdır. Aynı kural ödeme anında da geçerli —
/// karttan çekilecek tutar bu hesabın sonucudur, istemciden gelen bir sayı asla değildir.
///
/// Sepette olup yayından kalkan ürün sessizce düşürülür ve kullanıcıya bildirilir; aksi halde
/// satın alınamayacak bir şeyle ödeme adımına gidilir.
/// </summary>
public sealed class CartService
{
    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;
    private readonly CatalogQueries _catalog;
    private readonly Storefront.StorefrontStore _storefront;

    public const int MaxQuantityPerLine = 99;

    public CartService(
        TenantResolver tenant,
        ShopSchema schema,
        CatalogQueries catalog,
        Storefront.StorefrontStore storefront)
    {
        _tenant = tenant;
        _schema = schema;
        _catalog = catalog;
        _storefront = storefront;
    }

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        return conn;
    }

    public async Task<CartView> GetAsync(Guid memberId, CancellationToken ct)
    {
        var stored = new List<(string StockCode, int Quantity, bool WantsInstallation)>();

        await using (var conn = await OpenAsync(ct))
        await using (var cmd = new NpgsqlCommand(
            "SELECT stock_code, quantity, COALESCE(wants_installation, false) FROM public.cart_items WHERE member_id = @m ORDER BY added_at", conn))
        {
            cmd.Parameters.AddWithValue("m", memberId);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                stored.Add((reader.GetString(0), reader.GetInt32(1), reader.GetBoolean(2)));
            }
        }

        if (stored.Count == 0) return new CartView();

        // Fiyatlar tek seferde katalogdan, AMA sepetteki kodlarla sorularak.
        //
        // Eskiden katalogun ilk sayfası çekilip (96 satır) sepet satırları onun içinde
        // aranıyordu: 163 ürünlü katalogda ilk 96'ya girmeyen her ürün "yayından kalkmış"
        // sayılıp sepetten SESSİZCE siliniyordu. Sayfa boyutu zaten 96'ya sıkıştırılıyor
        // (CatalogQueries.ListAsync), yani sınırı büyütmek de çözüm değildi.
        var byCode = await _catalog.GetByStockCodesAsync(stored.Select(x => x.StockCode), ct);

        var lines = new List<CartLine>();
        var removed = new List<string>();

        foreach (var (stockCode, quantity, wantsInstallation) in stored)
        {
            if (!byCode.TryGetValue(stockCode, out var product))
            {
                removed.Add(stockCode);
                continue;
            }

            var lineNet = Math.Round(product.NetPrice * quantity, 2, MidpointRounding.AwayFromZero);
            var lineGross = Math.Round(product.GrossPrice * quantity, 2, MidpointRounding.AwayFromZero);

            /*
             * MONTAJ BEDELİ — B2B sipariş ekranıyla AYNI KURAL.
             *
             * `InstallationFee` KDV DAHİL sabit bir tutar. B2B'de (SiparisCartSection) montaj:
             *   - KDV MATRAHINA GİRMEZ; matrah yalnızca ürün tarafıdır,
             *   - genel toplama BRÜT hâliyle eklenir.
             * Genel toplam böylece `ürün neti + ürün KDV'si + montaj brütü` olur.
             *
             * Bu iki kural 2026-08-26'da B2B'de düzeltildi: montaj bedeli önce matraha
             * katılıp sonra bir kez daha KDV'lendiği için montajın KDV'si iki kez sayılıyordu
             * (ürün 7.285,71 + montaj 300 → 7.965 çıkıyordu, doğrusu 7.950). Vitrinin aynı
             * hatayı tekrarlamaması için hesap birebir buraya taşındı.
             *
             * Bedel 0 ise montaj ÜCRETSİZ demektir (ankastre, beyaz eşya); ürün yine
             * `IsInstallable` olabilir.
             */
            var installFeeUnit = product.IsInstallable && product.InstallationFee.HasValue
                ? Math.Max(0m, product.InstallationFee.Value)
                : 0m;

            /*
             * MONTAJ ZORUNLU (2026-09-21 kullanıcı kararı: "montajlı ürünlerde montaj
             * istiyorum otomatik seçili gelecek, montajı kapatamayacak").
             *
             * 2026-09-09'da tam tersi karar verilmişti (seçime bağlı, varsayılan
             * "istemiyorum"); o karar geri alındı. Sebep sahadan: montajsız teslim edilen
             * ankastre cihaz müşteride kuruluma kadar bekliyor, sonra servis çağrısı olarak
             * geri dönüyordu — bedeli de tahsil edilmemiş oluyordu.
             *
             * KAPI SUNUCUDA, arayüzde değil: istemci `wantsInstallation: false` gönderse
             * bile montajlı ürün montajlı kalır. Yalnız arayüzde kilitlemek, isteği elle
             * değiştiren birine montajı bedava atlatırdı.
             */
            var installWanted = product.IsInstallable;
            var installCharged = installWanted
                ? Math.Round(installFeeUnit * quantity, 2, MidpointRounding.AwayFromZero)
                : 0m;

            lines.Add(new CartLine
            {
                StockCode = product.StockCode,
                Slug = product.Slug,
                Name = product.Name,
                ImageUrl = product.ImageUrl,
                CategorySlug = product.CategorySlug,
                Quantity = quantity,
                UnitNetPrice = product.NetPrice,
                UnitGrossPrice = product.GrossPrice,
                TaxRate = product.TaxRate,
                LineNet = lineNet,
                LineVat = Math.Round(lineGross - lineNet, 2, MidpointRounding.AwayFromZero),
                LineGross = lineGross,
                Currency = product.Currency,
                IsInstallable = product.IsInstallable,
                WantsInstallation = installWanted,
                InstallationFeeUnit = installFeeUnit,
                InstallationTotal = installCharged
            });
        }

        if (removed.Count > 0)
        {
            await RemoveManyAsync(memberId, removed, ct);
        }

        return new CartView
        {
            Lines = lines,
            SubTotalNet = lines.Sum(x => x.LineNet),
            VatTotal = lines.Sum(x => x.LineVat),
            ProductTotal = lines.Sum(x => x.LineGross),
            InstallationTotal = lines.Sum(x => x.InstallationTotal),
            // Montaj brütü KDV matrahına girmediği için doğrudan toplama ekleniyor
            // (B2B'deki kuralın aynısı; gerekçe satır hesabındaki nota bakın).
            GrandTotal = lines.Sum(x => x.LineGross) + lines.Sum(x => x.InstallationTotal),
            Currency = lines.FirstOrDefault()?.Currency ?? "TRY",
            ItemCount = lines.Sum(x => x.Quantity),
            RemovedStockCodes = removed
        };
    }

    /// <summary>Ürünün gerçekten yayında olduğu burada doğrulanır — istemcinin iddiasına güvenilmez.</summary>
    /// <summary>
    /// Sepete ekleme sonucu. Düz `bool` yetmiyordu: "satışta değil" ile "stokta yok" farklı
    /// cevaplar ve müşteri hangisi olduğunu bilmeli — ikisine de "Ürün şu anda satışta değil"
    /// demek, stoğu biten bir ürünü katalogdan kalkmış gibi gösterirdi.
    /// </summary>
    public enum AddResult
    {
        Ok,
        NotPublished,
        OutOfStock,
        NotEnoughStock
    }

    /// <summary>
    /// Ürünün katalogdaki güncel hâli — yayında değilse null.
    ///
    /// Eskiden burada `ListAsync(null, stockCode, ...)` çağrılıp dönen 96 satırın içinde
    /// aranıyordu. Bu, sepette veri kaybına yol açan desenin ta kendisi (bkz. sınıf başındaki
    /// not): sayfa boyutu sınırlı olduğu için arama başka ürünleri de getirdiğinde aranan
    /// satır listeye hiç girmeyebiliyor. Kodla sorup kodla cevap almak hem doğru hem tek sorgu.
    /// </summary>
    private async Task<Catalog.CatalogItem?> FindPublishedAsync(string stockCode, CancellationToken ct)
    {
        var byCode = await _catalog.GetByStockCodesAsync(new[] { stockCode }, ct);
        return byCode.TryGetValue(stockCode, out var item) ? item : null;
    }

    /// <summary>
    /// Sepete ekleme — YAYIN ve STOK kapısıyla.
    ///
    /// Stok kapısı buraya kadar hiç yoktu: kart "Tükendi" rozetini gösteriyor ama düğme
    /// çalışıyordu, ürün sepete giriyor, sipariş açılıyor ve kart çekiliyordu. Bayi teslim
    /// edemeyeceği bir siparişin parasını almış oluyordu. Rozet uyarır; engelleyen tek şey
    /// sunucudaki bu kontrol — istemcide düğmeyi gizlemek yeterli değil.
    ///
    /// Bayi bilinçli olarak stoksuz satışa izin verebilir (<c>AllowOutOfStockOrders</c>);
    /// o zaman kapı açılır.
    /// </summary>
    public async Task<AddResult> AddAsync(
        Guid memberId,
        string stockCode,
        int quantity,
        CancellationToken ct,
        bool wantsInstallation = false)
    {
        quantity = Math.Clamp(quantity, 1, MaxQuantityPerLine);

        var product = await FindPublishedAsync(stockCode, ct);
        if (product is null) return AddResult.NotPublished;

        var settings = await _storefront.GetAsync(ct);
        if (!settings.AllowOutOfStockOrders)
        {
            // `StockQuantity` bu iç yolda hep dolu (ayar yalnızca dışarı verilen yanıtı kırpar).
            var available = product.StockQuantity ?? 0;
            if (available <= 0) return AddResult.OutOfStock;

            // Sepette zaten bulunan adet de sayılır: iki ayrı "sepete ekle" tıklaması stoğu
            // aşamamalı. Tek tıklamaya bakmak, üç adetlik stoktan beş adet satmaya izin verirdi.
            var inCart = await CurrentQuantityAsync(memberId, stockCode, ct);
            if (inCart + quantity > available) return AddResult.NotEnoughStock;
        }

        /*
         * Montajlı ürün DAİMA montajlı sepete girer (2026-09-21 kararı, yukarıdaki nota bkz.).
         * Montajı olmayan üründe istek yine yok sayılır: ERP'de `IsInstallable = false` olan
         * bir ürün için montaj bedeli tahsil edilmemeli.
         *
         * `wantsInstallation` parametresi imzada KALIYOR: uç hâlâ bu alanı kabul ediyor ve
         * eski istemciler/otomasyonlar hata almıyor; değeri artık kararı değiştirmiyor.
         */
        _ = wantsInstallation;
        var wants = product.IsInstallable;

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.cart_items (member_id, stock_code, quantity, added_at, wants_installation)
            VALUES (@m, @s, @q, now(), @w)
            ON CONFLICT (member_id, stock_code)
            DO UPDATE SET quantity = LEAST(public.cart_items.quantity + @q, @max),
                          -- Aynı ürün ikinci kez montajlı eklendiyse satır montajlı olur;
                          -- montajsız eklemek var olan seçimi BOZMAZ. Müşteri montajı sepette
                          -- tek tıkla kapatabiliyor, ama "sepete ekle" tuşuna ikinci basış
                          -- sessizce montajı iptal etmemeli.
                          wants_installation = public.cart_items.wants_installation OR @w
            """, conn);

        cmd.Parameters.AddWithValue("m", memberId);
        cmd.Parameters.AddWithValue("s", stockCode);
        cmd.Parameters.AddWithValue("q", quantity);
        cmd.Parameters.AddWithValue("max", MaxQuantityPerLine);
        cmd.Parameters.AddWithValue("w", wants);

        await cmd.ExecuteNonQueryAsync(ct);
        return AddResult.Ok;
    }

    /// <summary>
    /// Sepetteki bir satırın montaj seçimini değiştirir.
    ///
    /// Ayrı bir uç olmasının sebebi: müşteri sepette fikrini değiştirdiğinde adedi ya da
    /// ürünü yeniden göndermek zorunda kalmamalı. Montajı olmayan üründe istek sessizce
    /// yok sayılır (false yazılır) — istemcinin iddiasına güvenilmiyor.
    /// </summary>
    /// <returns>Ürün montajlı değilse false; seçim uygulandıysa true.</returns>
    public async Task<bool> SetInstallationAsync(Guid memberId, string stockCode, bool wants, CancellationToken ct)
    {
        var product = await FindPublishedAsync(stockCode, ct);

        /*
         * 2026-09-21: montaj artık kapatılamıyor. Montajlı üründe uç ne gelirse gelsin true
         * yazıyor; montajsız üründe false. Uç kaldırılmadı — vitrinin eski sürümü ya da
         * yer imine alınmış bir istek 404 almasın, sessizce doğru sonucu versin.
         */
        _ = wants;
        var allowed = product is not null && product.IsInstallable;

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "UPDATE public.cart_items SET wants_installation = @w WHERE member_id = @m AND stock_code = @s", conn);

        cmd.Parameters.AddWithValue("w", allowed);
        cmd.Parameters.AddWithValue("m", memberId);
        cmd.Parameters.AddWithValue("s", stockCode);

        await cmd.ExecuteNonQueryAsync(ct);
        return !wants || allowed;
    }

    /// <summary>Bu ürün sepette şu an kaç adet — stok kapısı buna bakıyor.</summary>
    private async Task<int> CurrentQuantityAsync(Guid memberId, string stockCode, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "SELECT COALESCE(quantity, 0) FROM public.cart_items WHERE member_id = @m AND stock_code = @s", conn);

        cmd.Parameters.AddWithValue("m", memberId);
        cmd.Parameters.AddWithValue("s", stockCode);

        var value = await cmd.ExecuteScalarAsync(ct);
        return value is int q ? q : 0;
    }

    /// <summary>
    /// Sepetteki adedi doğrudan belirler (sepet sayfasındaki +/- ve adet kutusu).
    ///
    /// Stok kapısı burada da geçerli — yoksa müşteri sepete 1 adet ekleyip adedi 50 yaparak
    /// kapıyı dolaşabilirdi. Aşan istek reddedilmiyor, STOĞA ÇEKİLİYOR: adet kutusuna 50 yazan
    /// müşteriye hata vermek yerine elde olanı vermek, sepet ekranında daha az sürtünme yaratır
    /// ve sonuç yine güvenli.
    /// </summary>
    public async Task SetQuantityAsync(Guid memberId, string stockCode, int quantity, CancellationToken ct)
    {
        if (quantity <= 0)
        {
            await RemoveManyAsync(memberId, new[] { stockCode }, ct);
            return;
        }

        quantity = Math.Min(quantity, MaxQuantityPerLine);

        var settings = await _storefront.GetAsync(ct);
        if (!settings.AllowOutOfStockOrders)
        {
            var product = await FindPublishedAsync(stockCode, ct);
            var available = product?.StockQuantity ?? 0;

            if (available <= 0)
            {
                await RemoveManyAsync(memberId, new[] { stockCode }, ct);
                return;
            }

            quantity = Math.Min(quantity, available);
        }

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "UPDATE public.cart_items SET quantity = @q WHERE member_id = @m AND stock_code = @s", conn);

        cmd.Parameters.AddWithValue("q", quantity);
        cmd.Parameters.AddWithValue("m", memberId);
        cmd.Parameters.AddWithValue("s", stockCode);

        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task RemoveManyAsync(Guid memberId, IEnumerable<string> stockCodes, CancellationToken ct)
    {
        var codes = stockCodes.ToArray();
        if (codes.Length == 0) return;

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "DELETE FROM public.cart_items WHERE member_id = @m AND stock_code = ANY(@codes)", conn);

        cmd.Parameters.AddWithValue("m", memberId);
        cmd.Parameters.AddWithValue("codes", codes);

        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task ClearAsync(Guid memberId, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("DELETE FROM public.cart_items WHERE member_id = @m", conn);
        cmd.Parameters.AddWithValue("m", memberId);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Misafir sepetini yeni/mevcut üyeye taşır.
    ///
    /// Misafir ziyaretçi sepete ürün ekleyince perde arkasında bir "misafir üye" satırı
    /// açılıyor (bkz. AccountController.GuestSession); kayıt ol/giriş yap ANINDA yeni bir
    /// oturum ve dolayısıyla YENİ bir üye kimliği doğuyor. Bu taşıma yapılmazsa müşteri tam
    /// satın almaya karar verdiği anda — üye olurken — sepeti sessizce sıfırlanıyordu
    /// (2026-09-05 denetiminde bulundu, canlı testte doğrulandı).
    ///
    /// Aynı üründen iki tarafta da varsa adet TOPLANIR (üst sınır aşılmaz); istemciden gelen
    /// bir veri değil, sunucudaki iki gerçek satırın birleşimi olduğu için güvenli.
    /// </summary>
    public async Task TransferAsync(Guid fromMemberId, Guid toMemberId, CancellationToken ct)
    {
        if (fromMemberId == toMemberId) return;

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.cart_items (member_id, stock_code, quantity, added_at)
            SELECT @to, stock_code, quantity, added_at FROM public.cart_items WHERE member_id = @from
            ON CONFLICT (member_id, stock_code)
            DO UPDATE SET quantity = LEAST(public.cart_items.quantity + EXCLUDED.quantity, @max);

            DELETE FROM public.cart_items WHERE member_id = @from;
            """, conn);

        cmd.Parameters.AddWithValue("from", fromMemberId);
        cmd.Parameters.AddWithValue("to", toMemberId);
        cmd.Parameters.AddWithValue("max", MaxQuantityPerLine);

        await cmd.ExecuteNonQueryAsync(ct);
    }
}
