using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Data.Configurations;
using Microsoft.EntityFrameworkCore;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;

namespace B2B.Erp.Api.Data;

public class AppDbContext : DbContext
{
    private readonly IServiceProvider? _serviceProvider;

    public AppDbContext(DbContextOptions<AppDbContext> options, IServiceProvider? serviceProvider = null) : base(options)
    {
        _serviceProvider = serviceProvider;
    }
    public DbSet<Product> Products => Set<Product>();

    /// <summary>Offer copy per product; see ProductDetail.</summary>
    public DbSet<ProductDetail> ProductDetails => Set<ProductDetail>();

    public DbSet<ProductCategory> ProductCategories => Set<ProductCategory>();

    public DbSet<PriceGroup> PriceGroups => Set<PriceGroup>();

    public DbSet<ProductPrice> ProductPrices => Set<ProductPrice>();
    public DbSet<User> Users { get; set; }
    public DbSet<JwtSessionSetting> JwtSessionSettings => Set<JwtSessionSetting>();
    public DbSet<UserWarehouse> UserWarehouses => Set<UserWarehouse>();
    public DbSet<Role> Roles { get; set; }
    public DbSet<Page> Pages { get; set; }
    public DbSet<RolePagePermission> RolePagePermissions { get; set; }
    public DbSet<Customer> Customers { get; set; }
    public DbSet<AccountingPeriod> AccountingPeriods => Set<AccountingPeriod>();
    public DbSet<CustomerAuthorizedContact> CustomerAuthorizedContacts => Set<CustomerAuthorizedContact>();

    public DbSet<CustomerProductPriceOverride> CustomerProductPriceOverrides => Set<CustomerProductPriceOverride>();

    public DbSet<CustomerProductCategory> CustomerProductCategories { get; set; }

    public DbSet<Salesman> Salesmen { get; set; }

    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<EmployeePayment> EmployeePayments => Set<EmployeePayment>();
    public DbSet<EmployeeBonusPlan> EmployeeBonusPlans => Set<EmployeeBonusPlan>();
    public DbSet<EmployeeMealPlan> EmployeeMealPlans => Set<EmployeeMealPlan>();
    public DbSet<EmployeeCheckIn> EmployeeCheckIns => Set<EmployeeCheckIn>();
    public DbSet<EmployeeFaceEmbedding> EmployeeFaceEmbeddings => Set<EmployeeFaceEmbedding>();
    public DbSet<EmployeeLeave> EmployeeLeaves => Set<EmployeeLeave>();
    public DbSet<EmployeeLocationSetting> EmployeeLocationSettings => Set<EmployeeLocationSetting>();
    public DbSet<ReverseGeocodeCache> ReverseGeocodeCaches => Set<ReverseGeocodeCache>();
    public DbSet<CashAccount> CashAccounts { get; set; }
    public DbSet<CashAccountTransfer> CashAccountTransfers => Set<CashAccountTransfer>();
    public DbSet<CashAccountTransaction> CashAccountTransactions => Set<CashAccountTransaction>();
    public DbSet<Warehouse> Warehouses { get; set; }
    public DbSet<StockGroup> StockGroups { get; set; }
    public DbSet<RefreshToken> RefreshTokens { get; set; }

    public DbSet<SalesOrder> SalesOrders => Set<SalesOrder>();
    public DbSet<SalesOrderLine> SalesOrderLines => Set<SalesOrderLine>();
    public DbSet<UserBasketItem> UserBasketItems => Set<UserBasketItem>();

    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceLine> InvoiceLines => Set<InvoiceLine>();
    public DbSet<Installation> Installations => Set<Installation>();
    public DbSet<InstallationDocument> InstallationDocuments => Set<InstallationDocument>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();

    public DbSet<CustomerOffer> CustomerOffers => Set<CustomerOffer>();
    public DbSet<CustomerOfferLine> CustomerOfferLines => Set<CustomerOfferLine>();
    public DbSet<MuhtelifCustomer> MuhtelifCustomers => Set<MuhtelifCustomer>();

    public DbSet<CariOffer> CariOffers => Set<CariOffer>();
    public DbSet<CariOfferLine> CariOfferLines => Set<CariOfferLine>();
    public DbSet<BayiMuhtelifCustomer> BayiMuhtelifCustomers => Set<BayiMuhtelifCustomer>();

    public DbSet<PurchaseInvoice> PurchaseInvoices => Set<PurchaseInvoice>();
    public DbSet<PurchaseInvoiceLine> PurchaseInvoiceLines => Set<PurchaseInvoiceLine>();

    public DbSet<ServiceCatalogItem> ServiceCatalogItems => Set<ServiceCatalogItem>();

    public DbSet<NumberSeries> NumberSeries => Set<NumberSeries>();

    public DbSet<Campaign> Campaigns => Set<Campaign>();
    public DbSet<CampaignCondition> CampaignConditions => Set<CampaignCondition>();
    public DbSet<CampaignAction> CampaignActions => Set<CampaignAction>();
    public DbSet<CampaignTarget> CampaignTargets => Set<CampaignTarget>();
    public DbSet<CampaignDiscount> CampaignDiscounts => Set<CampaignDiscount>();
    public DbSet<CampaignDiscountPriceGroup> CampaignDiscountPriceGroups => Set<CampaignDiscountPriceGroup>();
    public DbSet<ProductPriceHistory> ProductPriceHistories => Set<ProductPriceHistory>();
    public DbSet<CampaignBuyRule> CampaignBuyRules => Set<CampaignBuyRule>();
    public DbSet<Notification> Notifications => Set<Notification>();


    public DbSet<DeletionLog> DeletionLogs => Set<DeletionLog>();
    public DbSet<UserActivityLog> UserActivityLogs => Set<UserActivityLog>();
    public DbSet<SystemErrorLog> SystemErrorLogs => Set<SystemErrorLog>();

    public DbSet<InstallmentRule> InstallmentRules { get; set; }

    public DbSet<Bank> Banks { get; set; }

    public DbSet<BankBin> BankBins { get; set; }

    public DbSet<BankDetail> BankDetails { get; set; }

    public DbSet<BankAccountDefinition> BankAccountDefinitions { get; set; }

    public DbSet<BankAccountTransaction> BankAccountTransactions { get; set; }

    // Taksitli banka kredileri (BİZİM borcumuz). Sanal POS'taki taksit kurallarıyla
    // ilgisi yok — onlar müşterinin kredi kartı taksitleri.
    public DbSet<Loan> Loans => Set<Loan>();

    public DbSet<LoanInstallment> LoanInstallments => Set<LoanInstallment>();

    public DbSet<LoanPayment> LoanPayments => Set<LoanPayment>();

    public DbSet<PosAccountSetting> PosAccountSettings { get; set; }

    public DbSet<PosAccountTransfer> PosAccountTransfers { get; set; }

    public DbSet<PosAccountTransferItem> PosAccountTransferItems { get; set; }

    public DbSet<CustomerLedgerEntry> CustomerLedgerEntries { get; set; }

    public DbSet<Virman> Virmans => Set<Virman>();

    public DbSet<SupplierLedgerEntry> SupplierLedgerEntries { get; set; }

    public DbSet<CustomerCheck> CustomerChecks { get; set; }

    public DbSet<PayableCheck> PayableChecks { get; set; }

    public DbSet<PayableNote> PayableNotes { get; set; }

    public DbSet<CheckOperation> CheckOperations { get; set; }

    public DbSet<Irsaliye> Irsaliye { get; set; }

    public DbSet<Supplier> Suppliers => Set<Supplier>();

    public DbSet<WarehouseTransfer> WarehouseTransfers => Set<WarehouseTransfer>();
    public DbSet<WarehouseTransferLine> WarehouseTransferLines => Set<WarehouseTransferLine>();

    // GARANTİ DEĞİŞİM — WarrantyRecords ile KARIŞTIRILMAMALI.
    // WarrantyRecords: ürünün garanti kaydı/servis takibi.
    // WarrantyExchanges: arızalı ürünün yerine başka ürün verilmesi (stok + isteğe bağlı cari fark).
    public DbSet<WarrantyExchange> WarrantyExchanges => Set<WarrantyExchange>();
    public DbSet<WarrantyExchangeSetting> WarrantyExchangeSettings => Set<WarrantyExchangeSetting>();

    // Fatura Takip: kesilen faturanın imzalatılıp geri getirilmesi (bkz. InvoiceTrackingSchema).
    public DbSet<InvoiceTracking> InvoiceTrackings => Set<InvoiceTracking>();
    public DbSet<InvoiceTrackingEvent> InvoiceTrackingEvents => Set<InvoiceTrackingEvent>();
    public DbSet<InvoiceTrackingPhoto> InvoiceTrackingPhotos => Set<InvoiceTrackingPhoto>();

    public DbSet<WarrantyRecord> WarrantyRecords => Set<WarrantyRecord>();
    public DbSet<WarrantyHistory> WarrantyHistories => Set<WarrantyHistory>();
    public DbSet<ProductWarrantyRegistration> ProductWarrantyRegistrations => Set<ProductWarrantyRegistration>();

    public DbSet<VirtualPosDefinition> VirtualPosDefinitions { get; set; }
    public DbSet<VirtualPosConfiguration> VirtualPosConfigurations => Set<VirtualPosConfiguration>();
    public DbSet<VirtualPosInstallmentRule> VirtualPosInstallmentRules { get; set; }
    public DbSet<VirtualPosBin> VirtualPosBins { get; set; }
    public DbSet<VirtualPosTransaction> VirtualPosTransactions { get; set; }

    /// <summary>E-ticaret siparişi ↔ sanal POS tahsilatı bağı. Bkz. <see cref="EcommerceOrderPayment"/>.</summary>
    public DbSet<EcommerceOrderPayment> EcommerceOrderPayments => Set<EcommerceOrderPayment>();

    public DbSet<CheckBranch> CheckBranches { get; set; }
    public DbSet<UserCashAccount> UserCashAccounts { get; set; }
    public DbSet<UserBankAccount> UserBankAccounts { get; set; }




    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        modelBuilder.Entity<SystemErrorLog>().ToTable("SystemErrorLogs");
        base.OnModelCreating(modelBuilder);
    }


    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        StampDeletionReasons();
        await ProcessBranchRedirectionAsync(cancellationToken);
        await ProcessCustomerLedgerEntriesAsync(cancellationToken);
        await ProcessUserActivityLogsAsync(cancellationToken);
        await SyncShadowSuppliersAsync(cancellationToken);
        await SyncSubAccountCategoryPermissionsAsync(cancellationToken);
        await AssignCashBankDocumentNumbersAsync(cancellationToken);
        await StampInvoiceLineNaturesAsync(cancellationToken);
        await StampPurchaseInvoiceLineNaturesAsync(cancellationToken);
        // EN SONDA: yukarıdaki adımların sildiği/değiştirdiği banka hareketlerini de görsün.
        await SyncPosSweepsWithMovementChangesAsync(cancellationToken);
        return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <summary>Ekranın silme isteğine eklediği neden başlığı (Base64'lenmiş UTF-8 metin).</summary>
    public const string DeleteReasonHeader = "X-Delete-Reason";

    /// <summary>
    /// SİLME NEDENİ TEK KAPIDAN YAZILIR (2026-10-04).
    ///
    /// <para>
    /// <c>DeletionLogs</c>'a yirmiden fazla yerden kayıt ekleniyor (fatura, sipariş, kasa/banka,
    /// çek, irsaliye…). Nedeni her birine ayrı ayrı taşımak yirmi dokunuş ve yirmi birincisinde
    /// unutmak demekti. Ekran nedeni isteğin başlığına koyuyor; bu istekte eklenen ve nedeni boş
    /// olan HER silme kaydına buradan yazılır.
    /// </para>
    ///
    /// <para>
    /// Başlık Base64: HTTP başlığı ASCII taşır, Türkçe metin doğrudan konsaydı bozulurdu.
    /// Çözülemezse ya da başlık yoksa kayıt nedensiz yazılır — silmenin kendisi ASLA bu yüzden
    /// düşmez (servis programının vekil silmeleri ve otomatik işler başlık göndermiyor).
    /// </para>
    /// </summary>
    private void StampDeletionReasons()
    {
        if (_serviceProvider is null) return;

        var eklenenler = ChangeTracker.Entries<DeletionLog>()
            .Where(e => e.State == EntityState.Added && string.IsNullOrWhiteSpace(e.Entity.Reason))
            .ToList();
        if (eklenenler.Count == 0) return;

        string? neden = null;
        try
        {
            using var scope = _serviceProvider.CreateScope();
            var accessor = scope.ServiceProvider.GetService<Microsoft.AspNetCore.Http.IHttpContextAccessor>();
            var ham = accessor?.HttpContext?.Request?.Headers[DeleteReasonHeader].ToString();
            if (!string.IsNullOrWhiteSpace(ham))
            {
                neden = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(ham.Trim())).Trim();
            }
        }
        catch
        {
            neden = null;
        }

        if (string.IsNullOrWhiteSpace(neden)) return;
        if (neden.Length > 1000) neden = neden[..1000];

        foreach (var e in eklenenler)
        {
            e.Entity.Reason = neden;
        }
    }

    /// <summary>
    /// AKTARILMIŞ POS TAHSİLATI SİLİNİNCE / DEĞİŞİNCE AKTARIM DA DÜZELİR (2026-10-03).
    ///
    /// <para>
    /// POS süpürmesi günün girişlerini toplayıp tek aktarım yazar ve her girişi
    /// <c>PosAccountTransferItems</c>'a o anki tutarıyla kaydeder. Aktarılmış bir tahsilat
    /// sonradan silinince ya da tutarı/tarihi/hesabı değişince aktarım güncellenmiyordu: aynı
    /// para POS'tan iki kez çıkmış görünüyordu (canlı: 5 kayıt, Near East POS 11.300 TL —
    /// silinip doğru bilgiyle yeniden girilen tahsilat yeni gününün aktarımına da eklenmişti).
    /// </para>
    ///
    /// <para>
    /// <b>Neden burada?</b> Banka hareketi yirmiden fazla yoldan silinebiliyor (banka ekranı,
    /// fatura ödemesi, tahsilat iptali, çek, kasa bağlantısı, sanal POS iadesi…). Tek kapı
    /// hiçbirini kaçırmaz. Kural:
    ///  • hareket silindi / başka hesaba ya da güne taşındı / çıkışa çevrildi → kalem aktarımdan
    ///    çıkar, aktarım onun tutarı kadar düşer (başka güne taşınan hareketi
    ///    <c>PosAccountTransferService.SettleLateArrivalsAsync</c> kendi gününün aktarımına ekler);
    ///  • yalnız tutarı değişti → aktarım farkı kadar oynar.
    /// Aktarım kaydı ile iki bacağı (POS çıkışı, vadesiz girişi) AYNI kayıtta düzelir —
    /// <c>RaiseMovementAmountAsync</c>'in (geç gelen tahsilat) tersi. Aktarımın kendi
    /// bacakları kalem değildir; onları silmek aktarımı silme yoludur, burası karışmaz.
    /// </para>
    /// </summary>
    private async Task SyncPosSweepsWithMovementChangesAsync(CancellationToken cancellationToken)
    {
        var degisen = ChangeTracker.Entries<BankAccountTransaction>()
            .Where(e => e.Entity.Id > 0 && (e.State == EntityState.Deleted
                || (e.State == EntityState.Modified
                    && (e.Property(x => x.Amount).IsModified
                        || e.Property(x => x.Date).IsModified
                        || e.Property(x => x.BankAccountDefinitionId).IsModified
                        || e.Property(x => x.Direction).IsModified))))
            .ToList();

        if (degisen.Count == 0) return;

        var hareketIdleri = degisen.Select(e => e.Entity.Id).ToList();
        var kalemler = await PosAccountTransferItems
            .Where(i => hareketIdleri.Contains(i.BankAccountTransactionId))
            .ToListAsync(cancellationToken);

        if (kalemler.Count == 0) return;

        var aktarimIdleri = kalemler.Select(i => i.PosAccountTransferId).Distinct().ToList();
        var aktarimlar = await PosAccountTransfers
            .Where(t => aktarimIdleri.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id, cancellationToken);

        const string kullanici = "pos-aktarim-esitleme";
        var simdi = Core.Helpers.SystemTime.UtcNow;
        var farklar = new Dictionary<int, decimal>();
        var cikarilan = new HashSet<int>();

        foreach (var kalem in kalemler)
        {
            if (!aktarimlar.TryGetValue(kalem.PosAccountTransferId, out var aktarim)) continue;

            var giris = degisen.First(e => e.Entity.Id == kalem.BankAccountTransactionId);
            var hareket = giris.Entity;
            var hala = giris.State != EntityState.Deleted
                       && hareket.BankAccountDefinitionId == aktarim.PosBankAccountDefinitionId
                       && hareket.Direction == BankAccountTransactionDirection.In
                       && hareket.Date >= aktarim.TransferDate
                       && hareket.Date < aktarim.TransferDate.AddDays(1);

            decimal fark;
            if (hala)
            {
                fark = hareket.Amount - kalem.Amount;
                if (fark == 0m) continue;
                kalem.Amount = hareket.Amount;
                kalem.EditUser = kullanici;
                kalem.EditTime = simdi;
            }
            else
            {
                fark = -kalem.Amount;
                PosAccountTransferItems.Remove(kalem);
                cikarilan.Add(kalem.Id);
            }

            farklar[aktarim.Id] = (farklar.TryGetValue(aktarim.Id, out var f) ? f : 0m) + fark;
        }

        foreach (var (aktarimId, fark) in farklar)
        {
            if (fark == 0m) continue;
            var aktarim = aktarimlar[aktarimId];
            aktarim.Amount += fark;
            aktarim.EditUser = kullanici;
            aktarim.EditTime = simdi;

            var bacakIdleri = new[] { aktarim.OutBankAccountTransactionId, aktarim.InBankAccountTransactionId }
                .Where(x => x.HasValue).Select(x => x!.Value).ToList();
            var bacaklar = await BankAccountTransactions
                .Where(x => bacakIdleri.Contains(x.Id))
                .ToListAsync(cancellationToken);

            // Aktarımda hiç kalem kalmadıysa aktarılacak para da kalmamıştır: kayıt ve iki
            // bacağı kalkar (aktarım silmenin aynısı). Kalem varsa tutar düzeltilir.
            var kalanKalem = await PosAccountTransferItems
                .CountAsync(i => i.PosAccountTransferId == aktarimId && !cikarilan.Contains(i.Id), cancellationToken);

            if (kalanKalem == 0 && aktarim.Amount <= 0.005m)
            {
                BankAccountTransactions.RemoveRange(bacaklar.Where(x => Entry(x).State != EntityState.Deleted));
                PosAccountTransfers.Remove(aktarim);
                continue;
            }

            foreach (var bacak in bacaklar)
            {
                if (Entry(bacak).State == EntityState.Deleted) continue;
                var kur = bacak.CurrencyRate > 0m ? bacak.CurrencyRate : 1m;
                bacak.Amount += fark;
                bacak.CurrencyAmount += Core.Helpers.CurrencyTypeHelper.IsTry(bacak.CurrencyTypeId)
                    ? fark
                    : Math.Round(fark / kur, 2, MidpointRounding.AwayFromZero);
                bacak.EditUser = kullanici;
                bacak.EditTime = simdi;
            }
        }
    }

    /// <summary>
    /// Yeni fatura satırlarına MAL/HİZMET niteliğini damgalar (denetim md. E3).
    ///
    /// <para>
    /// <b>Neden burada, satırı kuran beş ayrı yerde değil?</b> <c>InvoiceLine</c> beş ayrı
    /// yolda üretiliyor (satış faturası, sipariş→fatura, teklif→fatura, irsaliye→fatura,
    /// alış→satış). Damgayı her birine ayrı eklemek, bugün birini atlamak ya da yarın altıncı
    /// bir yol eklendiğinde damgasız satır üretmek demekti — ve damgasız satır muhasebe
    /// aktarımında sessizce yanlış hesaba düşerdi. Tek kapı, kaçak bırakmıyor.
    /// </para>
    ///
    /// <para>
    /// Yalnız <b>yeni</b> ve <b>henüz damgalanmamış</b> satırlara dokunulur: mevcut bir
    /// faturanın niteliği sonradan değişmez (ürün kartı silinse bile geçmiş hesap kaymasın).
    /// Ürün kartı tek sorguda toplu okunur; satır başına sorgu fatura kesmeyi yavaşlatırdı.
    /// </para>
    /// </summary>
    private async Task StampInvoiceLineNaturesAsync(CancellationToken cancellationToken)
    {
        var pending = ChangeTracker.Entries<InvoiceLine>()
            .Where(e => e.State == EntityState.Added
                        && e.Entity.Nature == Core.Accounting.InvoiceLineNature.Unspecified)
            .Select(e => e.Entity)
            .ToList();

        if (pending.Count == 0) return;

        var stockCodes = pending
            .Select(x => (x.StockCode ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        // Ürün tipleri: kartı OLMAYAN stok kodu sözlükte hiç yer almaz ve çözücü onu
        // hizmet sayar (serbest metin işçilik satırı). Bu ayrımı korumak için sözlüğe
        // "bulunamadı" diye bir değer yazılmıyor.
        var productTypes = stockCodes.Count == 0
            ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            : (await Products
                    .AsNoTracking()
                    .Where(p => stockCodes.Contains(p.StockCode))
                    .Select(p => new { p.StockCode, p.ProductType })
                    .ToListAsync(cancellationToken))
                .GroupBy(x => x.StockCode, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().ProductType, StringComparer.OrdinalIgnoreCase);

        foreach (var line in pending)
        {
            var code = (line.StockCode ?? string.Empty).Trim();
            var type = productTypes.TryGetValue(code, out var t) ? t : null;
            line.Nature = Core.Accounting.InvoiceLineNatureResolver.Resolve(code, type);
        }
    }

    /// <summary>
    /// ALIS faturasi satirlarina MAL/HIZMET niteligini damgalar — satis kardesinin
    /// (<see cref="StampInvoiceLineNaturesAsync"/>) birebir aynisi, ayni gerekceyle.
    ///
    /// <para>
    /// 2026-09-18'de eklendi: alis faturasina nakliye/hizmet bedeli satiri girilebiliyor.
    /// Damga iki yerde kullaniliyor: hizmet satirina STOK HAREKETI yazilmamasi ve hizmet
    /// harcama raporunun gruplamasi. Alis satiri da birden fazla yolda uretiliyor (elle
    /// kalem, siparis bolme/kismi teslimat, Excel aktarimi); damgayi her birine ayri
    /// eklemek yarin bir yolu atlamak demekti.
    /// </para>
    /// </summary>
    private async Task StampPurchaseInvoiceLineNaturesAsync(CancellationToken cancellationToken)
    {
        var pending = ChangeTracker.Entries<PurchaseInvoiceLine>()
            .Where(e => e.State == EntityState.Added
                        && e.Entity.Nature == Core.Accounting.InvoiceLineNature.Unspecified)
            .Select(e => e.Entity)
            .ToList();

        if (pending.Count == 0) return;

        var stockCodes = pending
            .Select(x => (x.StockCode ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var productTypes = stockCodes.Count == 0
            ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            : (await Products
                    .AsNoTracking()
                    .Where(p => stockCodes.Contains(p.StockCode))
                    .Select(p => new { p.StockCode, p.ProductType })
                    .ToListAsync(cancellationToken))
                .GroupBy(x => x.StockCode, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().ProductType, StringComparer.OrdinalIgnoreCase);

        /*
          HIZMET KATALOGU DA HIZMET SAYILIR (2026-09-18).

          Alis faturasindaki "Hizmet Ekle" penceresi HIZMET KATALOGUNDAN (ServiceCatalogItems:
          HIZ-NAKLIYE, HIZ-ELEKTRIK...) secim yaptiriyor ve o kodlarin `Products` tablosunda
          karsiligi YOK. Yalnizca urun kartinin tipine bakilsaydi bu satirlar "kart yok" diye
          MAL damgalanir, stok girisi yazilir ve hizmet harcama raporunda hic gorunmezlerdi.
        */
        var catalogCodes = stockCodes.Count == 0
            ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            : (await Set<ServiceCatalogItem>()
                    .AsNoTracking()
                    .Where(x => stockCodes.Contains(x.Code))
                    .Select(x => x.Code)
                    .ToListAsync(cancellationToken))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var line in pending)
        {
            var code = (line.StockCode ?? string.Empty).Trim();
            var type = productTypes.TryGetValue(code, out var t) ? t : null;

            /*
              ALIS TARAFINDA "KART YOK = HIZMET" KURALI UYGULANMAZ.

              Satista kartsiz satir serbest metinle girilen iscilik bedelidir. Alista ise
              kartsiz satir cogu zaman henuz acilmamis bir MAL kartidir (Excel aktarimi,
              eski belge). Hepsini hizmet saymak, stok girisini sessizce durdurur ve
              harcama raporunu sisirirdi. Bu yuzden hizmet sayilmak icin iki yoldan biri
              gerekir: ACIKCA hizmet tipli urun karti (HIZMET/SERVIS) ya da hizmet katalogu
              kaydi. Gerisi MAL.
            */
            var hizmet = Core.Accounting.InvoiceLineNatureResolver.IsServiceProductType(type)
                         || (code.Length > 0 && catalogCodes.Contains(code));

            line.Nature = hizmet
                ? Core.Accounting.InvoiceLineNature.Service
                : Core.Accounting.InvoiceLineNature.Goods;
        }
    }

    /// <summary>
    /// Kasa ve banka hareketlerine belge numarası verir.
    ///
    /// <para>
    /// Yevmiye defterinde her satırın belge numarası olmak zorundadır; veritabanı
    /// <c>Id</c>'si bunun yerine geçmez (kullanıcıya gösterilmez, seri/dönem taşımaz,
    /// kayıt silinip yeniden oluşturulursa değişir).
    /// </para>
    ///
    /// <para>
    /// Numaralandırma <b>burada</b> yapılır çünkü kasa hareketi 10'dan fazla yerde
    /// oluşturuluyor (tahsilat, virman, personel ödemesi, yemek planı, prim...) ve her çağrı
    /// noktasına elle eklemek er geç birini atlamak demekti.
    /// </para>
    ///
    /// <para>
    /// <b>Boş olanı doldurur, doluya DOKUNMAZ.</b> Banka tarafındaki <c>DocumentNo</c> bugün
    /// kaynak belge referansı taşıyor (fatura no, sanal POS <c>VP-</c> anahtarı); onlar korunur.
    /// </para>
    /// </summary>
    private async Task AssignCashBankDocumentNumbersAsync(CancellationToken cancellationToken)
    {
        var cashPending = ChangeTracker.Entries<CashAccountTransaction>()
            .Where(e => e.State == EntityState.Added && string.IsNullOrWhiteSpace(e.Entity.DocumentNo))
            .Select(e => e.Entity)
            .ToList();

        var bankPending = ChangeTracker.Entries<BankAccountTransaction>()
            .Where(e => e.State == EntityState.Added && string.IsNullOrWhiteSpace(e.Entity.DocumentNo))
            .Select(e => e.Entity)
            .ToList();

        if (cashPending.Count == 0 && bankPending.Count == 0) return;

        foreach (var t in cashPending)
        {
            var year = (t.Date == default ? DateTime.UtcNow : t.Date).Year;
            var next = await NextDocumentSequenceAsync($"cashdoc:{year}", cancellationToken);
            if (next > 0) t.DocumentNo = $"KAS-{year}-{next:D6}";
        }

        foreach (var t in bankPending)
        {
            var year = (t.Date == default ? DateTime.UtcNow : t.Date).Year;
            var next = await NextDocumentSequenceAsync($"bankdoc:{year}", cancellationToken);
            if (next > 0) t.DocumentNo = $"BNK-{year}-{next:D6}";
        }
    }

    /// <summary>
    /// Sıradaki numarayı ATOMİK olarak alır.
    ///
    /// "Önce oku, sonra artır, sonra yaz" kullanılmıyor: iki istek aynı anda gelirse ikisi de
    /// aynı değeri okur ve aynı belge numarası iki kez üretilir. Tek <c>INSERT ... ON CONFLICT
    /// ... RETURNING</c> ifadesi bunu veritabanı seviyesinde engeller ve mevcut transaction'ın
    /// içinde çalışır.
    /// </summary>
    private async Task<long> NextDocumentSequenceAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            var rows = await Database
                .SqlQueryRaw<long>(
                    @"INSERT INTO ""NumberSeries"" (""Key"", ""LastValue"") VALUES ({0}, 1)
                      ON CONFLICT (""Key"") DO UPDATE SET ""LastValue"" = ""NumberSeries"".""LastValue"" + 1
                      RETURNING ""LastValue"" AS ""Value""", key)
                .ToListAsync(cancellationToken);

            return rows.Count > 0 ? rows[0] : 0L;
        }
        catch
        {
            // Numara üretilemezse kaydı DÜŞÜRME — belge numarası boş kalır, hareket kaydedilir.
            return 0L;
        }
    }

    private async Task SyncShadowSuppliersAsync(CancellationToken cancellationToken)
    {
        var customerEntries = ChangeTracker.Entries<Customer>()
            .Where(e => e.State == EntityState.Added || e.State == EntityState.Modified || e.State == EntityState.Deleted)
            .ToList();

        if (!customerEntries.Any()) return;

        foreach (var entry in customerEntries)
        {
            var customer = entry.Entity;
            var code = (customer.CustomerCode ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(code)) continue;

            // Gölge tedarikçi YALNIZCA ana cariler için açılır. Dışlanacak iki durum var ve
            // ŞUBELER ikisinden de kaçıyordu:
            //
            //   1. Alt hesap eki `-1/-2/-3`. Şube kodu `01-000949-001` biçiminde; son iki
            //      karakteri "01", yani `EndsWith("-1")` tutmuyor.
            //   2. `MainCustomerCode` dolu olanlar. Şubede bu alan BOŞ kalıyor; şubenin ana
            //      cariye bağı `ParentCustomerCode`'da duruyor ve buraya hiç bakılmıyordu.
            //
            // Sonuç: her şube "ana cari" sanılıp Tedarikçiler listesine düşüyordu
            // (`01-000949-001 AAAAAAA (MERKEZ)` gibi). Şube bir satın alma kaynağı değil,
            // ana carinin bir adresi — tedarikçi karşılığı olmamalı.
            var isBranch = !string.IsNullOrWhiteSpace(customer.ParentCustomerCode)
                && customer.ParentCustomerCode != code;

            var isSubAccount = code.EndsWith("-1") || code.EndsWith("-2") || code.EndsWith("-3") ||
                isBranch ||
                (!string.IsNullOrEmpty(customer.MainCustomerCode) && customer.MainCustomerCode != code);

            // HİZMET CARİSİ TEDARİKÇİ DEĞİLDİR (2026-08-20, kullanıcı kararı).
            //
            // `770-01-…` bir GİDER kalemidir: elektrik/su, kırtasiye, vergi dairesi, ihtiyat
            // sandığı… Bunlardan mal satın alınmaz, hiçbirinin alış faturası ya da borç senedi
            // olmaz. Gölge tedarikçi açıldığı için hepsi Tedarikçiler listesine düşüyor, gerçek
            // tedarikçilerin (`320-01-…`) arasında gürültü yapıyordu.
            //
            // Ölçüt KOD ÖN EKİ: `CustomerType` serbest metin ("Hizmet"/"hizmet") ve sonradan
            // elle değiştirilebiliyor; hesap kodu ise carinin muhasebedeki yerini söylüyor.
            // Tip yine de okunuyor — kodu elle başka biçimde girilmiş kayıtlar için.
            var isServiceExpense = code.StartsWith("770-", StringComparison.OrdinalIgnoreCase)
                || string.Equals((customer.CustomerType ?? string.Empty).Trim(), "hizmet", StringComparison.OrdinalIgnoreCase);

            // Bu dal aynı zamanda TEMİZLİK kapısı: daha önce açılmış bir gölge tedarikçi varsa
            // cari her kaydedildiğinde siliniyor.
            if (isSubAccount || isServiceExpense || entry.State == EntityState.Deleted)
            {
                var existingSupplier = await Set<Supplier>()
                    .FirstOrDefaultAsync(x => x.SupplierCode == code, cancellationToken);
                if (existingSupplier != null)
                {
                    Set<Supplier>().Remove(existingSupplier);
                }
                continue;
            }

            if (entry.State == EntityState.Added)
            {
                var existingSupplier = await Set<Supplier>()
                    .FirstOrDefaultAsync(x => x.SupplierCode == code, cancellationToken);
                if (existingSupplier == null)
                {
                    Set<Supplier>().Add(new Supplier
                    {
                        SupplierCode = code,
                        FullName = customer.Name,
                        PhoneNumber = customer.Phone,
                        Region = customer.City,
                        Address = customer.Address,
                        CreateUser = customer.CreateUser ?? "SystemSync",
                        CreateTime = DateTime.UtcNow
                    });
                }
            }
            else if (entry.State == EntityState.Modified)
            {
                var existingSupplier = await Set<Supplier>()
                    .FirstOrDefaultAsync(x => x.SupplierCode == code, cancellationToken);
                if (existingSupplier != null)
                {
                    existingSupplier.FullName = customer.Name;
                    existingSupplier.PhoneNumber = customer.Phone;
                    existingSupplier.Region = customer.City;
                    existingSupplier.Address = customer.Address;
                    existingSupplier.EditUser = customer.EditUser ?? "SystemSync";
                    existingSupplier.EditTime = DateTime.UtcNow;
                    Set<Supplier>().Update(existingSupplier);
                }
                else
                {
                    Set<Supplier>().Add(new Supplier
                    {
                        SupplierCode = code,
                        FullName = customer.Name,
                        PhoneNumber = customer.Phone,
                        Region = customer.City,
                        Address = customer.Address,
                        CreateUser = customer.CreateUser ?? "SystemSync",
                        CreateTime = DateTime.UtcNow
                    });
                }
            }
        }
    }

    private async Task SyncSubAccountCategoryPermissionsAsync(CancellationToken cancellationToken)
    {
        var categoryEntries = ChangeTracker.Entries<CustomerProductCategory>()
            .Where(e => e.State == EntityState.Added || e.State == EntityState.Deleted)
            .ToList();

        if (!categoryEntries.Any()) return;

        foreach (var entry in categoryEntries)
        {
            var rel = entry.Entity;
            var code = (rel.CustomerCode ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(code)) continue;

            // Only sync from main accounts (which do not end with -1, -2, -3)
            if (code.EndsWith("-1") || code.EndsWith("-2") || code.EndsWith("-3")) continue;

            var subCodes = new[] { code + "-1", code + "-2", code + "-3" };

            if (entry.State == EntityState.Added)
            {
                foreach (var subCode in subCodes)
                {
                    // Check if sub-account exists in database to prevent foreign key issues
                    var subCustExists = await Set<Customer>().AnyAsync(x => x.CustomerCode == subCode, cancellationToken);
                    if (!subCustExists) continue;

                    var exists = await Set<CustomerProductCategory>()
                        .AnyAsync(x => x.CustomerCode == subCode && x.ProductCategoryId == rel.ProductCategoryId, cancellationToken);
                    if (!exists)
                    {
                        Set<CustomerProductCategory>().Add(new CustomerProductCategory
                        {
                            CustomerCode = subCode,
                            ProductCategoryId = rel.ProductCategoryId
                        });
                    }
                }
            }
            else if (entry.State == EntityState.Deleted)
            {
                foreach (var subCode in subCodes)
                {
                    var existing = await Set<CustomerProductCategory>()
                        .FirstOrDefaultAsync(x => x.CustomerCode == subCode && x.ProductCategoryId == rel.ProductCategoryId, cancellationToken);
                    if (existing != null)
                    {
                        Set<CustomerProductCategory>().Remove(existing);
                    }
                }
            }
        }
    }

    private async Task ProcessBranchRedirectionAsync(CancellationToken cancellationToken)
    {
        var entries = ChangeTracker.Entries()
            .Where(e => e.State == EntityState.Added || e.State == EntityState.Modified)
            .ToList();

        if (!entries.Any()) return;

        var candidateCodes = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in entries)
        {
            var entity = entry.Entity;
            /*
              SEPET ŞUBE YÖNLENDİRMESİNİN DIŞINDA (2026-08-26, kullanıcı: "şubelerin sepeti
              çalışmıyor, şube seçince sepet boş geliyor").

              Bu yönlendirme MUHASEBE BELGELERİ için doğru ve gerekli: şubeye kesilen fatura
              ana cariye yazılır, şube `DeliveryCustomerCode`'a taşınır. Cari ekstredeki
              "Cari Adı = ana bayi / Teslim Cari Adı = şube" ayrımı buradan geliyor.

              `UserBasketItem` ise bir belge değil, sipariş ekranının çalışma alanı. Üstelik
              `DeliveryCustomerCode` alanı YOK: yönlendirme şube kodunu ana cariyle değiştirip
              şubeyi hiçbir yere yazmıyor, yani bilgi tamamen kayboluyordu. Sonuç: sepet ana
              cari koduyla saklanıyor, ekran şube koduyla arıyor ve sepet boş görünüyordu.
              Şube kimliği yalnızca istemcinin ürettiği `Key` alanında hayatta kalıyordu.

              Sepet dışarıda bırakıldı; belge tarafına DOKUNULMADI.
            */
            if (entity is Customer || entity is Supplier || entity is UserBasketItem) continue;

            var t = entity.GetType();

            var pCustomerCode = t.GetProperty("CustomerCode");
            if (pCustomerCode != null && pCustomerCode.PropertyType == typeof(string))
            {
                var val = pCustomerCode.GetValue(entity) as string;
                if (!string.IsNullOrWhiteSpace(val)) candidateCodes.Add(val.Trim());
            }

            var pSourceCustomerCode = t.GetProperty("SourceCustomerCode");
            if (pSourceCustomerCode != null && pSourceCustomerCode.PropertyType == typeof(string))
            {
                var val = pSourceCustomerCode.GetValue(entity) as string;
                if (!string.IsNullOrWhiteSpace(val)) candidateCodes.Add(val.Trim());
            }

            var pTargetCustomerCode = t.GetProperty("TargetCustomerCode");
            if (pTargetCustomerCode != null && pTargetCustomerCode.PropertyType == typeof(string))
            {
                var val = pTargetCustomerCode.GetValue(entity) as string;
                if (!string.IsNullOrWhiteSpace(val)) candidateCodes.Add(val.Trim());
            }

            var pCurrentCustomerCode = t.GetProperty("CurrentCustomerCode");
            if (pCurrentCustomerCode != null && pCurrentCustomerCode.PropertyType == typeof(string))
            {
                var val = pCurrentCustomerCode.GetValue(entity) as string;
                if (!string.IsNullOrWhiteSpace(val)) candidateCodes.Add(val.Trim());
            }
        }

        if (!candidateCodes.Any()) return;

        var customersList = await Customers
            .AsNoTracking()
            .Where(c => candidateCodes.Contains(c.CustomerCode))
            .Select(c => new { c.CustomerCode, c.ParentCustomerCode, c.CustomerType, c.Name })
            .ToListAsync(cancellationToken);

        var branchMap = customersList
            .Where(c => !string.IsNullOrWhiteSpace(c.ParentCustomerCode) &&
                        ((c.CustomerType ?? "").Trim().ToLowerInvariant() == "sube" ||
                         (c.CustomerType ?? "").Trim().ToLowerInvariant() == "şube" ||
                         c.CustomerCode.StartsWith("01-")))
            .ToDictionary(
                c => c.CustomerCode.Trim(),
                c => new { ParentCode = c.ParentCustomerCode.Trim(), Name = c.Name.Trim() },
                StringComparer.OrdinalIgnoreCase);

        if (!branchMap.Any()) return;

        foreach (var entry in entries)
        {
            var entity = entry.Entity;
            /*
              SEPET ŞUBE YÖNLENDİRMESİNİN DIŞINDA (2026-08-26, kullanıcı: "şubelerin sepeti
              çalışmıyor, şube seçince sepet boş geliyor").

              Bu yönlendirme MUHASEBE BELGELERİ için doğru ve gerekli: şubeye kesilen fatura
              ana cariye yazılır, şube `DeliveryCustomerCode`'a taşınır. Cari ekstredeki
              "Cari Adı = ana bayi / Teslim Cari Adı = şube" ayrımı buradan geliyor.

              `UserBasketItem` ise bir belge değil, sipariş ekranının çalışma alanı. Üstelik
              `DeliveryCustomerCode` alanı YOK: yönlendirme şube kodunu ana cariyle değiştirip
              şubeyi hiçbir yere yazmıyor, yani bilgi tamamen kayboluyordu. Sonuç: sepet ana
              cari koduyla saklanıyor, ekran şube koduyla arıyor ve sepet boş görünüyordu.
              Şube kimliği yalnızca istemcinin ürettiği `Key` alanında hayatta kalıyordu.

              Sepet dışarıda bırakıldı; belge tarafına DOKUNULMADI.
            */
            if (entity is Customer || entity is Supplier || entity is UserBasketItem) continue;

            var t = entity.GetType();

            var pCustomerCode = t.GetProperty("CustomerCode");
            if (pCustomerCode != null && pCustomerCode.PropertyType == typeof(string) && pCustomerCode.CanWrite)
            {
                var val = pCustomerCode.GetValue(entity) as string;
                if (!string.IsNullOrWhiteSpace(val) && branchMap.TryGetValue(val.Trim(), out var branchInfo))
                {
                    pCustomerCode.SetValue(entity, branchInfo.ParentCode);

                    var pDeliveryCustomerCode = t.GetProperty("DeliveryCustomerCode");
                    if (pDeliveryCustomerCode != null && pDeliveryCustomerCode.PropertyType == typeof(string) && pDeliveryCustomerCode.CanWrite)
                    {
                        pDeliveryCustomerCode.SetValue(entity, val.Trim());
                    }

                    if (entity is CustomerLedgerEntry ledger)
                    {
                        var suffix = $" (Şube: {branchInfo.Name})";
                        if (string.IsNullOrWhiteSpace(ledger.Description))
                        {
                            ledger.Description = suffix.Trim();
                        }
                        else if (!ledger.Description.Contains(suffix))
                        {
                            ledger.Description += suffix;
                        }
                    }
                    else if (entity is Invoice inv)
                    {
                        var suffix = $" (Şube: {branchInfo.Name})";
                        if (string.IsNullOrWhiteSpace(inv.Description))
                        {
                            inv.Description = suffix.Trim();
                        }
                        else if (!inv.Description.Contains(suffix))
                        {
                            inv.Description += suffix;
                        }
                    }
                    else if (entity is CustomerOffer co)
                    {
                        var suffix = $" (Şube: {branchInfo.Name})";
                        if (string.IsNullOrWhiteSpace(co.Description))
                        {
                            co.Description = suffix.Trim();
                        }
                        else if (!co.Description.Contains(suffix))
                        {
                            co.Description += suffix;
                        }
                    }
                    else if (entity is CariOffer cario)
                    {
                        var suffix = $" (Şube: {branchInfo.Name})";
                        if (string.IsNullOrWhiteSpace(cario.Description))
                        {
                            cario.Description = suffix.Trim();
                        }
                        else if (!cario.Description.Contains(suffix))
                        {
                            cario.Description += suffix;
                        }
                    }
                }
            }

            var pSourceCustomerCode = t.GetProperty("SourceCustomerCode");
            if (pSourceCustomerCode != null && pSourceCustomerCode.PropertyType == typeof(string) && pSourceCustomerCode.CanWrite)
            {
                var val = pSourceCustomerCode.GetValue(entity) as string;
                if (!string.IsNullOrWhiteSpace(val) && branchMap.TryGetValue(val.Trim(), out var branchInfo))
                {
                    pSourceCustomerCode.SetValue(entity, branchInfo.ParentCode);
                }
            }

            var pTargetCustomerCode = t.GetProperty("TargetCustomerCode");
            if (pTargetCustomerCode != null && pTargetCustomerCode.PropertyType == typeof(string) && pTargetCustomerCode.CanWrite)
            {
                var val = pTargetCustomerCode.GetValue(entity) as string;
                if (!string.IsNullOrWhiteSpace(val) && branchMap.TryGetValue(val.Trim(), out var branchInfo))
                {
                    pTargetCustomerCode.SetValue(entity, branchInfo.ParentCode);
                }
            }

            var pCurrentCustomerCode = t.GetProperty("CurrentCustomerCode");
            if (pCurrentCustomerCode != null && pCurrentCustomerCode.PropertyType == typeof(string) && pCurrentCustomerCode.CanWrite)
            {
                var val = pCurrentCustomerCode.GetValue(entity) as string;
                if (!string.IsNullOrWhiteSpace(val) && branchMap.TryGetValue(val.Trim(), out var branchInfo))
                {
                    pCurrentCustomerCode.SetValue(entity, branchInfo.ParentCode);
                }
            }
        }
    }

    /// <summary>
    /// Bir kullanıcı işleminin TETİKLEDİĞİ ikincil kayıtların Türkçe adları.
    ///
    /// <para>
    /// Burada listelenmeyen türler özete hiç girmez. Kasıtlı: özet insanın okuyacağı bir
    /// cümle, kayıt türlerinin dökümü değil. Tanınmayan bir tür eklendiğinde de özet
    /// bozulmaz, yalnız o tür görünmez.
    /// </para>
    /// </summary>
    private static readonly System.Collections.Generic.Dictionary<string, string> EffectEntityNames = new()
    {
        ["InvoiceLine"] = "Fatura kalemi",
        ["SalesOrderLine"] = "Sipariş kalemi",
        ["CustomerOfferLine"] = "Teklif kalemi",
        ["CariOfferLine"] = "Cari teklif kalemi",
        ["PurchaseInvoiceLine"] = "Alış faturası kalemi",
        ["WarehouseTransferLine"] = "Depo transfer kalemi",
        ["SupplierLedgerEntry"] = "Tedarikçi ekstre satırı",
        ["ProductWarrantyRegistration"] = "Garanti kaydı",
        ["WarrantyExchange"] = "Garanti değişim kaydı",
        ["EcommerceOrderPayment"] = "E-ticaret tahsilat bağı",
        ["VirtualPosTransaction"] = "Sanal POS işlemi",

        // Toplu üretilen satırlar. Ana kayıt olsalardı tek bir rol kaydı 200 ayrı hareket
        // satırı yazardı; burada tek cümlede sayılıyorlar.
        ["RolePagePermission"] = "Rol sayfa yetkisi",
        ["ProductPrice"] = "Ürün fiyatı",
        ["ProductDetail"] = "Ürün detayı",
        ["CustomerProductPriceOverride"] = "Cariye özel fiyat",
        ["CustomerAuthorizedContact"] = "Cari yetkili kişi",
        ["UserWarehouse"] = "Kullanıcı depo yetkisi",
        ["UserCashAccount"] = "Kullanıcı kasa yetkisi",
        ["UserBankAccount"] = "Kullanıcı banka yetkisi",
        ["LoanInstallment"] = "Kredi taksiti",
        ["EmployeeBonusPlan"] = "Personel prim planı",
        ["EmployeeMealPlan"] = "Personel yemek planı",
        ["EmployeeLeave"] = "Personel izni",
        ["CampaignCondition"] = "Kampanya koşulu",
        ["CampaignAction"] = "Kampanya aksiyonu",
        ["CampaignTarget"] = "Kampanya hedefi",
        ["CampaignBuyRule"] = "Kampanya alım kuralı",
        ["CampaignDiscount"] = "Kampanya indirimi",
        ["CampaignDiscountPriceGroup"] = "Kampanya fiyat grubu",
        ["CheckBranch"] = "Çek şubesi",
        ["WarrantyHistory"] = "Garanti geçmişi",
        ["InstallationDocument"] = "Montaj belgesi",
        ["PosAccountTransfer"] = "POS aktarımı",
        ["PosAccountTransferItem"] = "POS aktarım kalemi",
        ["VirtualPosConfiguration"] = "Sanal POS ayarı",
        ["VirtualPosInstallmentRule"] = "Sanal POS taksit kuralı",
        ["VirtualPosBin"] = "Sanal POS BIN kaydı",
        ["BankBin"] = "Banka BIN kaydı",

        // NOT: `DeletionLog` bilerek burada YOK — "1 kayıt eklendi" kalıbı silme işleminin
        // ortasında anlamsız duruyordu. Kendi cümlesini kuruyor (ActivityEffectSummary).
        //
        // Bilerek DIŞARIDA bırakılanlar (gürültü ya da sistem kaydı): RefreshToken,
        // ReverseGeocodeCache, Notification, SystemErrorLog, UserActivityLog, UserBasketItem,
        // ProductPriceHistory, Page, EmployeeCheckIn, EmployeeFaceEmbedding,
        // EmployeeLocationSetting. Bunlar kullanıcının yaptığı bir işi değil, sistemin kendi
        // iç işleyişini anlatır; kayda girseler her istekte satır üretirlerdi.
    };

    /// <summary>
    /// Cari ekstre satırının BELGENİN parasındaki tutarı.
    ///
    /// <para>
    /// TL satırda <c>Amount</c> zaten belgenin parasıdır. Dövizli satırda <c>CurrencyAmount</c>
    /// kullanılır; o boş kalmışsa (eski kayıtlar) donmuş kurdan geri hesaplanır. Kur da yoksa
    /// TL tutar aynen döner — yanlış bir sayı üretmektense çevirmemek doğrudur.
    /// </para>
    /// </summary>
    private static decimal ResolveDocumentAmount(CustomerLedgerEntry entry)
    {
        if (Core.Helpers.CurrencyTypeHelper.IsTry(entry.CurrencyTypeId)) return entry.Amount;
        if (entry.CurrencyAmount != 0m) return entry.CurrencyAmount;
        if (entry.CurrencyRate > 0m) return entry.Amount / entry.CurrencyRate;
        return entry.Amount;
    }

    /// <summary>
    /// Sonuçları, isteğin sonunda kullanıcıya dönecek toplayıcıya ekler.
    ///
    /// <para>
    /// Toplayıcı istek kapsamlıdır ve arka plan işlerinde (zamanlanmış görevler, göç
    /// kodları) HİÇ YOKTUR — bu yüzden bulunamaması hata değil, olağan durumdur. Sessizce
    /// atlanır: hareket kaydı yine yazılır, yalnız ekrana anlık bildirim gitmez.
    /// </para>
    /// </summary>
    private void TryCollectRequestEffects(
        System.Collections.Generic.List<string> actions,
        System.Collections.Generic.List<string> effects)
    {
        if (_serviceProvider is null) return;

        try
        {
            using var scope = _serviceProvider.CreateScope();
            var accessor = scope.ServiceProvider.GetService<Microsoft.AspNetCore.Http.IHttpContextAccessor>();
            var collector = accessor?.HttpContext?.RequestServices?.GetService<Core.Activity.RequestEffectCollector>();
            if (collector is null) return;

            collector.AddActions(actions);
            collector.AddEffects(effects);
        }
        catch
        {
            // Geri bildirim işi, işin kendisini düşüremez.
        }
    }

    /// <summary>
    /// Özette geçen depoların adları. Yalnız BU işlemde dokunulan depolar okunur.
    /// </summary>
    private async Task<System.Collections.Generic.Dictionary<int, string>> LoadWarehouseNamesForEffectsAsync(
        CancellationToken cancellationToken)
    {
        var codes = ChangeTracker.Entries()
            .Where(e => e.Entity is StockMovement)
            .Select(e => ((StockMovement)e.Entity).WarehouseCode)
            .Distinct()
            .ToList();

        if (codes.Count == 0) return new System.Collections.Generic.Dictionary<int, string>();

        try
        {
            return await Warehouses
                .AsNoTracking()
                .Where(w => codes.Contains(w.WarehouseCode))
                .ToDictionaryAsync(w => w.WarehouseCode, w => w.Name ?? string.Empty, cancellationToken);
        }
        catch
        {
            // Ad okunamazsa özet depo KODUYLA yazılır — bilgisiz kalmaktan iyidir.
            return new System.Collections.Generic.Dictionary<int, string>();
        }
    }

    private static Core.Activity.ActivityChangeState ToChangeState(EntityState state) => state switch
    {
        EntityState.Added => Core.Activity.ActivityChangeState.Added,
        EntityState.Deleted => Core.Activity.ActivityChangeState.Deleted,
        _ => Core.Activity.ActivityChangeState.Modified
    };

    /// <summary>
    /// Aynı <c>SaveChanges</c> içinde değişen İKİNCİL kayıtları toplayıp insan diline çevirir.
    ///
    /// <para>
    /// Veri zaten elimizde: hareket kaydı <c>SaveChanges</c> içinden yazılıyor, yani aynı
    /// işlemde değişen HER kayıt <c>ChangeTracker</c>'da duruyor. Ayrı bir sorgu ya da ayrı
    /// bir kanca yok — bu yüzden yeni bir işlem yolu eklendiğinde de kendiliğinden çalışır.
    /// </para>
    ///
    /// <para>
    /// Burası yalnızca OKUMA ve dönüştürme yapar; cümleyi kuran ve stok işaretini hesaplayan
    /// kural <see cref="Core.Activity.ActivityEffectSummary"/> içinde, doğrudan test edilebilir
    /// biçimde durur.
    /// </para>
    /// </summary>
    private System.Collections.Generic.List<string> BuildActivityEffects(
        System.Collections.Generic.HashSet<string> headlineTypes,
        System.Collections.Generic.IReadOnlyDictionary<int, string> warehouseNames)
    {
        var entries = ChangeTracker.Entries()
            .Where(e => e.State == EntityState.Added
                     || e.State == EntityState.Deleted
                     || e.State == EntityState.Modified)
            .Where(e => !headlineTypes.Contains(e.Metadata.ClrType.Name))
            .Where(e => e.Entity is not UserActivityLog)
            .ToList();

        if (entries.Count == 0) return new System.Collections.Generic.List<string>();

        var stockChanges = entries
            .Where(x => x.Entity is StockMovement)
            .Select(x => new { Movement = (StockMovement)x.Entity, x.State })
            .Select(x => new Core.Activity.StockChange(
                x.Movement.StockCode,
                warehouseNames.TryGetValue(x.Movement.WarehouseCode, out var name) && !string.IsNullOrWhiteSpace(name)
                    ? name
                    : $"{x.Movement.WarehouseCode} nolu depo",
                x.Movement.Direction == StockMovementDirection.In,
                x.Movement.Quantity,
                ToChangeState(x.State)))
            .ToList();

        // `Amount` TL ÇAPASIDIR, `CurrencyAmount` belgenin kendi parasındaki değeri. İkisi de
        // taşınır: özet başa belgenin parasını yazar, TL karşılığını parantezde bırakır.
        // Dövizli satırda `CurrencyAmount` boş kalmışsa TL tutardan kurla geri hesaplanır —
        // sıfır yazmak, girilen belgeyi kayıttan tamamen silmek olurdu.
        var ledgerChanges = entries
            .Where(x => x.Entity is CustomerLedgerEntry)
            .Select(x => new { Entry = (CustomerLedgerEntry)x.Entity, x.State })
            .Select(x => new Core.Activity.LedgerChange(
                x.Entry.CustomerCode,
                x.Entry.Direction == CustomerLedgerEntryDirection.Debit,
                Core.Helpers.CurrencyTypeHelper.ToCodeOrTry(x.Entry.CurrencyTypeId),
                ResolveDocumentAmount(x.Entry),
                x.Entry.Amount,
                ToChangeState(x.State)))
            .ToList();

        var installationChanges = entries
            .Where(x => x.Entity is Installation)
            .Select(x => new Core.Activity.InstallationChange(
                (x.CurrentValues[nameof(Installation.Status)] as string) ?? string.Empty,
                ToChangeState(x.State)))
            .ToList();

        // Yalnız gerçekten DEĞİŞEN alan raporlanır: ürünün adı düzeltildiği için "stok
        // güncellendi" yazmak yanlış olurdu.
        var productStockChanges = new System.Collections.Generic.List<Core.Activity.ProductStockChange>();
        foreach (var e in entries.Where(x => x.Entity is Product && x.State == EntityState.Modified))
        {
            var prop = e.Property(nameof(Product.Stock));
            if (prop is null || !prop.IsModified) continue;

            var before = prop.OriginalValue is int ov ? ov : 0;
            var after = prop.CurrentValue is int cv ? cv : 0;
            if (before == after) continue;

            productStockChanges.Add(new Core.Activity.ProductStockChange(((Product)e.Entity).StockCode, before, after));
        }

        var genericChanges = entries
            .Where(x => EffectEntityNames.ContainsKey(x.Metadata.ClrType.Name))
            .Select(x => new Core.Activity.GenericChange(
                EffectEntityNames[x.Metadata.ClrType.Name],
                ToChangeState(x.State)))
            .ToList();

        var backupCount = entries.Count(x => x.Entity is DeletionLog && x.State == EntityState.Added);
        var deletionBackup = backupCount > 0 ? new Core.Activity.DeletionBackupChange(backupCount) : null;

        return Core.Activity.ActivityEffectSummary.Build(
            stockChanges,
            ledgerChanges,
            installationChanges,
            productStockChanges,
            genericChanges,
            deletionBackup);
    }

    private async Task ProcessUserActivityLogsAsync(CancellationToken cancellationToken)
    {
        string username = "System";
        string displayName = "System";
        if (_serviceProvider != null)
        {
            using var scope = _serviceProvider.CreateScope();
            var httpContextAccessor = scope.ServiceProvider.GetService<Microsoft.AspNetCore.Http.IHttpContextAccessor>();
            var httpContext = httpContextAccessor?.HttpContext;
            if (httpContext?.User != null)
            {
                username = httpContext.User.FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value ?? "System";
                displayName = httpContext.User.FindFirst("Unvan")?.Value ?? username;
                if (string.IsNullOrWhiteSpace(displayName))
                {
                    displayName = username;
                }
            }
        }

        var allowedTypes = new System.Collections.Generic.HashSet<string>
        {
            "SalesOrder",
            "CustomerOffer",
            "CariOffer",
            "Invoice",
            "PurchaseInvoice",
            "WarehouseTransfer",
            "Irsaliye",
            "User",
            "Customer",
            "Supplier",
            "BankAccountDefinition",
            "CashAccount",
            "CustomerCheck",
            "PayableCheck",
            "PayableNote",
            "CashAccountTransaction",
            "CashAccountTransfer",
            "BankAccountTransaction",
            // NOT: "BankAccountTransfer" böyle bir VARLIK YOK — banka transferi iki ayrı
            // `BankAccountTransaction` satırı olarak yazılıyor ve kaydı oradan düşüyor.
            // Liste doğrulandığında ortaya çıktı; kaldırmak yerine sebebi yazıldı ki
            // bir sonraki okuyan "eksik kalmış" diye geri eklemesin.
            "Virman",

            // ---- 2026-08-20'de EKLENENLER ----
            //
            // Kayıt yalnız fatura/kasa/banka/çek eksenini tutuyordu: ürün kartı açmak, fiyat
            // grubu değiştirmek, ROL YETKİSİ VERMEK, depo tanımlamak, mali dönem kapatmak,
            // kredi açmak, personel ödemesi yapmak — hiçbiri iz bırakmıyordu. Denetim kaydının
            // en çok arandığı yer olan yetki değişikliği bile kayıtsızdı.
            //
            // Buraya yalnız "bir kayıt = bir kullanıcı işlemi" olan türler girer. Toplu üretilen
            // satırlar (rol sayfa yetkileri, ürün fiyatları, kredi taksitleri) aşağıdaki
            // `EffectEntityNames` listesine girer: tek bir rol kaydında 200 satır değişebiliyor
            // ve her biri ayrı kayıt satırı olsaydı ekran kullanılmaz hâle gelirdi.
            "Product",
            "ProductCategory",
            "StockGroup",
            "PriceGroup",
            "Warehouse",
            "Role",
            "AccountingPeriod",
            "JwtSessionSetting",
            "Campaign",
            "Loan",
            "LoanPayment",
            "Employee",
            "EmployeePayment",
            "WarrantyRecord",
            "WarrantyExchange",
            "Salesman",
            "Bank",
            "BankDetail",
            "MuhtelifCustomer",
            "BayiMuhtelifCustomer",
            "CheckOperation",
            "PosAccountSetting",
            "NumberSeries",
            "InstallmentRule",
            "VirtualPosDefinition",
            "ServiceCatalogItem",
            "WarrantyExchangeSetting",
            "CustomerProductCategory"
        };

        var deletedEntries = ChangeTracker.Entries()
            .Where(e => e.State == EntityState.Deleted && allowedTypes.Contains(e.Metadata.ClrType.Name))
            .ToList();

        var addedEntries = ChangeTracker.Entries()
            .Where(e => e.State == EntityState.Added && allowedTypes.Contains(e.Metadata.ClrType.Name))
            .ToList();

        var modifiedEntries = ChangeTracker.Entries()
            .Where(e => e.State == EntityState.Modified && allowedTypes.Contains(e.Metadata.ClrType.Name))
            .ToList();

        var logsToAdd = new System.Collections.Generic.List<UserActivityLog>();

        // Depo adları ÖNDEN çekilir: özet kurulurken sorgu çalıştırmak, `SaveChanges`in
        // ortasında ikinci bir okuma açar. Kasa/banka adları için de aynı desen kullanılıyor.
        var warehouseNameMap = await LoadWarehouseNamesForEffectsAsync(cancellationToken);

        // TETİKLENENLER (2026-08-20 kullanıcı isteği).
        //
        // Etki özeti satırlar kurulmadan ÖNCE hesaplanır: aşağıda `logsToAdd` içeriği
        // `UserActivityLogs`'a eklenince kendisi de ChangeTracker'a `Added` olarak düşer ve
        // sonradan hesaplansaydı "Kullanıcı hareketi: N kayıt eklendi" diye kendini raporlardı.
        //
        // `correlationId` aynı işlemden doğan bütün satırlara aynı damgayı vurur: tek bir
        // fatura silme hem faturayı hem cariyi hem kasayı ilgilendirdiğinde ekranda üç ayrı
        // işlem gibi görünüyorlardı.
        // ÖZET HESABI İŞLEMİ DÜŞÜRMEZ. Burası bir KAYIT işi; beklenmedik bir kayıt türü ya da
        // eksik bir alan yüzünden atılan istisna, kullanıcının faturasının kaydedilmesini
        // engellemiş olurdu. Özet kurulamazsa satır özetsiz yazılır — kayıt tutmanın
        // başarısızlığı, iş yapmanın başarısızlığına dönüşmemeli.
        string? effectsJson = null;
        var collectedEffects = new System.Collections.Generic.List<string>();
        try
        {
            var effects = BuildActivityEffects(allowedTypes, warehouseNameMap);
            if (effects.Count > 0)
            {
                collectedEffects = effects;
                effectsJson = System.Text.Json.JsonSerializer.Serialize(new { effects });
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[UserActivity] Etki özeti kurulamadı: {ex.Message}");
        }

        var correlationId = Guid.NewGuid();

        // Pre-fetch CashAccount names for all CashAccountTransaction entries (to avoid lazy-load issues)
        var allTxEntries = deletedEntries.Concat(addedEntries).Concat(modifiedEntries)
            .Where(e => e.Entity is CashAccountTransaction)
            .ToList();
        var cashAccountIdSet = allTxEntries
            .Select(e => ((CashAccountTransaction)e.Entity).CashAccountId)
            .Distinct()
            .ToList();
        System.Collections.Generic.Dictionary<int, string> cashAccountNameMap;
        if (cashAccountIdSet.Count > 0)
        {
            var cashAccounts = await CashAccounts
                .AsNoTracking()
                .Where(ca => cashAccountIdSet.Contains(ca.Id))
                .Select(ca => new { ca.Id, ca.Name })
                .ToListAsync(cancellationToken);
            cashAccountNameMap = cashAccounts.ToDictionary(ca => ca.Id, ca => ca.Name ?? string.Empty);
        }
        else
        {
            cashAccountNameMap = new System.Collections.Generic.Dictionary<int, string>();
        }

        // Pre-fetch BankAccountDefinition names for BankAccountTransaction entries
        var allBankTxEntries = deletedEntries.Concat(addedEntries).Concat(modifiedEntries)
            .Where(e => e.Entity is BankAccountTransaction)
            .ToList();
        var bankAccountIdSet = allBankTxEntries
            .Select(e => ((BankAccountTransaction)e.Entity).BankAccountDefinitionId)
            .Distinct()
            .ToList();
        System.Collections.Generic.Dictionary<int, string> bankAccountNameMap;
        if (bankAccountIdSet.Count > 0)
        {
            var bankAccounts = await BankAccountDefinitions
                .AsNoTracking()
                .Where(b => bankAccountIdSet.Contains(b.Id))
                .Select(b => new { b.Id, b.AccountName })
                .ToListAsync(cancellationToken);
            bankAccountNameMap = bankAccounts.ToDictionary(b => b.Id, b => b.AccountName ?? string.Empty);
        }
        else
        {
            bankAccountNameMap = new System.Collections.Generic.Dictionary<int, string>();
        }

        foreach (var entry in deletedEntries)
        {
            var entityType = entry.Metadata.ClrType.Name;
            var recordId = string.Empty;
            try
            {
                var idProp = entry.Property("Id");
                if (idProp != null)
                {
                    recordId = idProp.CurrentValue?.ToString() ?? string.Empty;
                }
            }
            catch {}

            var (moduleKey, pageKey) = MapEntityTypeToKeys(entityType, entry.Entity);
            var cashName = entry.Entity is CashAccountTransaction cat && cashAccountNameMap.TryGetValue(cat.CashAccountId, out var cn) ? cn : null;
            var bankName = entry.Entity is BankAccountTransaction bat && bankAccountNameMap.TryGetValue(bat.BankAccountDefinitionId, out var bn) ? bn : null;
            var detailDescription = GetEntityDetailDescription(entityType, entry.Entity, cashName, bankName);

            logsToAdd.Add(new UserActivityLog
            {
                Username = username,
                UserDisplayName = displayName,
                ModuleKey = moduleKey,
                PageKey = pageKey,
                ActionType = "Silme",
                Description = $"{detailDescription} silindi.",
                RecordId = recordId,
                DetailsJson = effectsJson,
                CorrelationId = correlationId,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });
        }

        foreach (var entry in addedEntries)
        {
            var entityType = entry.Metadata.ClrType.Name;
            var recordId = string.Empty;
            try
            {
                var idProp = entry.Property("Id");
                if (idProp != null)
                {
                    recordId = idProp.CurrentValue?.ToString() ?? string.Empty;
                }
            }
            catch {}

            var (moduleKey, pageKey) = MapEntityTypeToKeys(entityType, entry.Entity);
            var cashName = entry.Entity is CashAccountTransaction cat && cashAccountNameMap.TryGetValue(cat.CashAccountId, out var cn) ? cn : null;
            var bankName = entry.Entity is BankAccountTransaction bat && bankAccountNameMap.TryGetValue(bat.BankAccountDefinitionId, out var bn) ? bn : null;
            var detailDescription = GetEntityDetailDescription(entityType, entry.Entity, cashName, bankName);

            logsToAdd.Add(new UserActivityLog
            {
                Username = username,
                UserDisplayName = displayName,
                ModuleKey = moduleKey,
                PageKey = pageKey,
                ActionType = "Oluşturma",
                Description = $"{detailDescription} oluşturuldu.",
                RecordId = recordId,
                DetailsJson = effectsJson,
                CorrelationId = correlationId,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });
        }

        foreach (var entry in modifiedEntries)
        {
            var entityType = entry.Metadata.ClrType.Name;
            var recordId = string.Empty;
            try
            {
                var idProp = entry.Property("Id");
                if (idProp != null)
                {
                    recordId = idProp.CurrentValue?.ToString() ?? string.Empty;
                }
            }
            catch {}

            var (moduleKey, pageKey) = MapEntityTypeToKeys(entityType, entry.Entity);
            var cashName = entry.Entity is CashAccountTransaction cat && cashAccountNameMap.TryGetValue(cat.CashAccountId, out var cn) ? cn : null;
            var bankName = entry.Entity is BankAccountTransaction bat && bankAccountNameMap.TryGetValue(bat.BankAccountDefinitionId, out var bn) ? bn : null;
            var detailDescription = GetEntityDetailDescription(entityType, entry.Entity, cashName, bankName);

            logsToAdd.Add(new UserActivityLog
            {
                Username = username,
                UserDisplayName = displayName,
                ModuleKey = moduleKey,
                PageKey = pageKey,
                ActionType = "Güncelleme",
                Description = $"{detailDescription} güncellendi.",
                RecordId = recordId,
                DetailsJson = effectsJson,
                CorrelationId = correlationId,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });
        }

        // BAŞSIZ İŞLEMLER DE KAYDA DÜŞER (2026-09-03 kullanıcı isteği: "kayda düşmeyen bir şey
        // kalmasın").
        //
        // Kayıt satırı bugüne kadar YALNIZCA `allowedTypes` içindeki bir ANA kayıt
        // değiştiğinde yazılıyordu. Oysa bazı işlemler ana kayda hiç dokunmaz: rol sayfa
        // yetkisi güncellemek yalnız `RolePagePermission` satırlarını, kullanıcıya depo
        // yetkisi vermek yalnız `UserWarehouse` satırlarını, montaj durumu değiştirmek yalnız
        // `Installation` satırını değiştirir. Bu işlemlerin "tetiklenenler" özeti
        // hesaplanıyor, sonra `logsToAdd` boş olduğu için SESSİZCE ÇÖPE ATILIYORDU — yetki
        // değişikliği hiçbir yerde görünmüyordu.
        //
        // Ana kayıt yoksa özetin kendisi TEK satır olarak yazılır. Gürültü riski yok: özet
        // yalnız `EffectEntityNames` (ve stok/ekstre/montaj/silme yedeği) için kuruluyor.
        // `RefreshToken`, `Notification`, `UserBasketItem`, `EmployeeCheckIn` gibi her istekte
        // yazılan türler o sözlükte BİLEREK yok, dolayısıyla burayı hiç tetiklemezler.
        if (logsToAdd.Count == 0 && collectedEffects.Count > 0)
        {
            var (headlessModule, headlessPage) = ResolveHeadlessActivityKeys(allowedTypes);
            logsToAdd.Add(new UserActivityLog
            {
                Username = username,
                UserDisplayName = displayName,
                ModuleKey = headlessModule,
                PageKey = headlessPage,
                ActionType = "Güncelleme",
                Description = collectedEffects.Count == 1
                    ? collectedEffects[0]
                    : $"{collectedEffects.Count} kayıt değişti",
                DetailsJson = effectsJson,
                CorrelationId = correlationId,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });
        }

        if (logsToAdd.Count > 0)
        {
            UserActivityLogs.AddRange(logsToAdd);
        }

        // KULLANICIYA ÖNCE NE YAPTIĞI, SONRA NE TETİKLENDİĞİ GİDER.
        //
        // Yalnız tetiklenenler gönderildiğinde bildirim yarım kalıyordu: kasaya tahsilat
        // girildiğinde ekranda sadece "cari ekstre arttı" görünüyor, paranın kasaya girdiği
        // görünmüyordu — oysa kullanıcının doğrulamak istediği ilk şey o. Ana işlemin
        // açıklaması hareket kaydına yazılan cümlenin AYNISIDIR; ekranda görülen ile kayda
        // geçen ayrışmasın.
        TryCollectRequestEffects(
            logsToAdd.Select(x => x.Description).ToList(),
            collectedEffects);
    }

    /// <summary>
    /// Silme/denetim kaydına yazılacak para birimi kodu.
    ///
    /// <para>
    /// Burada dört ayrı yerde hata vardı. Kasa hareketi, banka hareketi ve borç çeki
    /// <b>ESKİ kodlamayı</b> kullanıyordu (<c>1=USD 2=EUR 3=GBP</c>): TL hareketi denetim
    /// kaydına "USD", dolar hareketi "GBP" olarak yazılıyor, sterlin ise hiç görünmüyordu.
    /// Müşteri çeki ile borç senedi ise para birimi taşıdıkları hâlde sabit "TL" yazıyordu.
    /// </para>
    ///
    /// <para>
    /// Para bozulmuyordu ama <b>denetim kaydı</b> bozuluyordu — yani para kaybolduğunda
    /// bakılacak yer. Artık tek kanonik kaynak: <see cref="Core.Helpers.CurrencyTypeHelper"/>.
    /// </para>
    /// </summary>
    private static string AuditCurrencyCode(int currencyTypeId)
        => Core.Helpers.CurrencyTypeHelper.ToCodeOrTry(currencyTypeId);

    private static string MapEntityTypeToTurkishName(string entityType, object entity)
    {
        if (entityType == "Invoice" && entity is Invoice inv)
        {
            return inv.Type switch
            {
                InvoiceType.Proforma => "Proforma Fatura",
                InvoiceType.OpenInvoice => "Fatura Dökümü",
                InvoiceType.SalesInvoice => "Satış Faturası",
                _ => "Fatura"
            };
        }
        if (entityType == "PurchaseInvoice" && entity is PurchaseInvoice pinv)
        {
            return pinv.Kind == PurchaseInvoiceKind.Purchase ? "Termin" : "Alış Faturası";
        }
        if (entityType == "CariOffer" && entity is CariOffer co && !string.IsNullOrEmpty(co.ProformaDocumentNo))
        {
            return "Cari Proforma";
        }
        return entityType switch
        {
            "SalesOrder" => "Sipariş",
            "CustomerOffer" => "Müşteri Teklifi",
            "CariOffer" => "Cari Müşteri Teklifi",
            "WarehouseTransfer" => "Depo Transferi",
            "Irsaliye" => "Konsinye Belgesi",
            "User" => "Kullanıcı",
            "Customer" => "Cari Müşteri",
            "Supplier" => "Tedarikçi",
            "BankAccountDefinition" => "Banka Hesabı",
            "CashAccount" => "Kasa Hesabı",
            "CustomerCheck" => "Müşteri Çeki",
            "PayableCheck" => "Borç Çeki",
            "PayableNote" => "Borç Senedi",
            "CashAccountTransaction" => "Kasa Hareketi",
            "CashAccountTransfer" => "Kasa Transferi",
            "BankAccountTransaction" => "Banka Hareketi",
            "BankAccountTransfer" => "Banka Transferi",
            "Virman" => "Virman",

            "Product" => "Ürün Kartı",
            "ProductCategory" => "Ürün Kategorisi",
            "StockGroup" => "Stok Grubu",
            "PriceGroup" => "Fiyat Grubu",
            "Warehouse" => "Depo",
            "Role" => "Rol",
            "AccountingPeriod" => "Mali Dönem",
            "JwtSessionSetting" => "Genel Ayarlar",
            "Campaign" => "Kampanya",
            "Loan" => "Kredi",
            "LoanPayment" => "Kredi Ödemesi",
            "Employee" => "Personel",
            "EmployeePayment" => "Personel Ödemesi",
            "WarrantyRecord" => "Garanti Kaydı",
            "WarrantyExchange" => "Garanti Değişimi",
            "Salesman" => "Plasiyer",
            "Bank" => "Banka",
            "BankDetail" => "Banka Şubesi",
            "MuhtelifCustomer" => "Muhtelif Cari",
            "BayiMuhtelifCustomer" => "Bayi Muhtelif Cari",
            "CheckOperation" => "Çek İşlemi",
            "PosAccountSetting" => "POS Hesap Ayarı",
            "NumberSeries" => "Numaratör",
            "InstallmentRule" => "Taksit Kuralı",
            "VirtualPosDefinition" => "Sanal POS Tanımı",
            "ServiceCatalogItem" => "Servis Kataloğu",
            "WarrantyExchangeSetting" => "Garanti Değişim Ayarı",
            "CustomerProductCategory" => "Cari Ürün Kategorisi",

            _ => entityType
        };
    }

    private static string GetEntityDetailDescription(string entityType, object entity, string? cashAccountName = null, string? bankAccountName = null)
    {
        try
        {
            string? docNo = null;
            if (entity is CariOffer co && !string.IsNullOrEmpty(co.ProformaDocumentNo)) docNo = co.ProformaDocumentNo;
            else if (entity is WarehouseTransfer wt) docNo = wt.TransferNo;
            else if (entity is Irsaliye irs) docNo = irs.IrsaliyeNo;
            else if (entity is CustomerCheck cc) docNo = cc.CheckNo;
            else if (entity is PayableCheck pc) docNo = pc.CheckNo;
            else if (entity is PayableNote pn) docNo = pn.NoteNo;
            else docNo = entity.GetType().GetProperty("DocumentNo")?.GetValue(entity)?.ToString() ?? entity.GetType().GetProperty("InvoiceNo")?.GetValue(entity)?.ToString() ?? entity.GetType().GetProperty("OrderNo")?.GetValue(entity)?.ToString();

            var trName = MapEntityTypeToTurkishName(entityType, entity);
            
            var details = new System.Collections.Generic.List<string>();
            if (!string.IsNullOrWhiteSpace(docNo))
            {
                details.Add($"No: {docNo}");
            }

            if (entity is CashAccountTransaction cashTx)
            {
                if (!string.IsNullOrWhiteSpace(cashAccountName))
                    details.Add($"Kasa: {cashAccountName}");
                var direction = cashTx.Direction == CashAccountTransactionDirection.In ? "Giriş" : "Çıkış";
                details.Add($"Yön: {direction}");
                details.Add($"Tutar: {cashTx.Amount:N2} {AuditCurrencyCode(cashTx.CurrencyTypeId)}");
                if (!string.IsNullOrWhiteSpace(cashTx.CounterpartyName))
                    details.Add($"Cari: {cashTx.CounterpartyName}");
                if (!string.IsNullOrWhiteSpace(cashTx.Description))
                    details.Add($"Açıklama: {cashTx.Description}");
            }
            else if (entity is BankAccountTransaction bankTx)
            {
                if (!string.IsNullOrWhiteSpace(bankAccountName))
                    details.Add($"Banka: {bankAccountName}");
                var directionBank = bankTx.Direction == BankAccountTransactionDirection.In ? "Giriş" : "Çıkış";
                details.Add($"Yön: {directionBank}");
                details.Add($"Tutar: {bankTx.Amount:N2} {AuditCurrencyCode(bankTx.CurrencyTypeId)}");
                if (!string.IsNullOrWhiteSpace(bankTx.CounterpartyName))
                    details.Add($"Cari: {bankTx.CounterpartyName}");
                if (!string.IsNullOrWhiteSpace(bankTx.Description))
                    details.Add($"Açıklama: {bankTx.Description}");
            }
            else if (entity is Customer c)
            {
                details.Add($"Müşteri: [{c.CustomerCode}] {c.Name}");
            }
            else if (entity is Supplier s)
            {
                details.Add($"Tedarikçi: [{s.SupplierCode}] {s.FullName}");
            }
            else if (entity is User u)
            {
                details.Add($"Kullanıcı Adı: {u.Username}");
            }
            else if (entity is CashAccount ca)
            {
                details.Add($"Kasa Adı: {ca.Name}");
            }
            else if (entity is BankAccountDefinition ba)
            {
                details.Add($"Hesap Adı: {ba.AccountName} ({ba.AccountCode})");
            }
            else if (entity is CustomerCheck check)
            {
                details.Add($"Tutar: {check.Amount:N2} {AuditCurrencyCode(check.CurrencyTypeId)}, Borçlu: {check.OriginalDebtorName}");
            }
            else if (entity is PayableCheck pCheck)
            {
                details.Add($"Tutar: {pCheck.Amount:N2} {AuditCurrencyCode(pCheck.CurrencyTypeId)}, Cari: {pCheck.CustomerCode}");
            }
            else if (entity is PayableNote pNote)
            {
                details.Add($"Tutar: {pNote.Amount:N2} {AuditCurrencyCode(pNote.CurrencyTypeId)}, Cari: {pNote.CustomerCode}");
            }
            else
            {
                var amountVal = entity.GetType().GetProperty("Amount")?.GetValue(entity) ?? entity.GetType().GetProperty("GrandTotal")?.GetValue(entity);
                if (amountVal != null)
                {
                    details.Add(amountVal is decimal dec ? $"Tutar: {dec:N2}" : $"Tutar: {amountVal}");
                }

                // BELGENİN PARASI VE KURU AYRI ALANLAR OLARAK YAZILIR.
                //
                // Dövizli fatura kayıtta çıplak bir sayı olarak duruyordu ("Tutar: 1200,00"):
                // 1.200 $ mı, 1.200 ₺ mi, yoksa kurla çarpılmış TL karşılığı mı — kayda bakan
                // kişi ayırt edemiyordu.
                //
                // Kod tutarın SONUNA eklenmiyor, bilerek. `Invoice` başlığının kuralı TL çapasıdır
                // ama sahada her iki konvansiyonda da yazılmış kayıtlar var; sayının yanına "USD"
                // yapıştırmak, TL yazılmış bir başlığı dolar diye etiketlemek olurdu. Ayrı alan
                // ise iki durumda da doğru: belgenin parası ve donmuş kuru bunlar.
                var currencyTypeVal = entity.GetType().GetProperty("CurrencyTypeId")?.GetValue(entity);
                if (currencyTypeVal is int currencyTypeId && !Core.Helpers.CurrencyTypeHelper.IsTry(currencyTypeId))
                {
                    details.Add($"Döviz: {AuditCurrencyCode(currencyTypeId)}");

                    var rateVal = entity.GetType().GetProperty("ExchangeRate")?.GetValue(entity)
                                  ?? entity.GetType().GetProperty("CurrencyRate")?.GetValue(entity);
                    if (rateVal is decimal rate && rate > 0m && rate != 1m)
                    {
                        details.Add($"Kur: {rate:N4}");
                    }
                }

                var customerCodeVal = entity.GetType().GetProperty("CustomerCode")?.GetValue(entity)?.ToString();
                if (!string.IsNullOrWhiteSpace(customerCodeVal))
                {
                    details.Add($"Cari Kod: {customerCodeVal}");
                }

                var nameVal = entity.GetType().GetProperty("Name")?.GetValue(entity)?.ToString() ?? entity.GetType().GetProperty("FullName")?.GetValue(entity)?.ToString();
                if (!string.IsNullOrWhiteSpace(nameVal))
                {
                    details.Add($"Adı: {nameVal}");
                }
            }

            var detailStr = details.Count > 0 ? " (" + string.Join(", ", details) + ")" : "";
            return $"{trName}{detailStr}";
        }
        catch
        {
            return MapEntityTypeToTurkishName(entityType, entity);
        }
    }

    /// <summary>
    /// ANA KAYDA DOKUNMAYAN bir işlemin hangi modül/sayfa altında listeleneceği.
    ///
    /// <para>
    /// <see cref="MapEntityTypeToKeys"/> yalnız ana kayıt türlerini tanır. Başsız işlemde
    /// (yalnız yan tablo değişmiş) elde ana kayıt yoktur; satır bu sözlükle en yakın ekrana
    /// bağlanır, böylece "Kullanıcı Hareketleri" ekranındaki modül sekmesi ve sayfa süzgeci
    /// onu da yakalar. Sözlükte olmayan tür <c>digerIslemler</c> altında toplanır — kayıt
    /// KAYBOLMAZ, yalnız adı ham görünür.
    /// </para>
    /// </summary>
    private static readonly System.Collections.Generic.Dictionary<string, (string ModuleKey, string PageKey)> HeadlessActivityKeys = new()
    {
        ["RolePagePermission"] = ("ayarlar", "roller"),
        ["UserWarehouse"] = ("ayarlar", "kullanicilar"),
        ["UserCashAccount"] = ("ayarlar", "kullanicilar"),
        ["UserBankAccount"] = ("ayarlar", "kullanicilar"),
        ["CustomerAuthorizedContact"] = ("ayarlar", "cariEkle"),
        ["CustomerProductPriceOverride"] = ("ayarlar", "atiliFiyatlandirma"),
        ["ProductPrice"] = ("ayarlar", "atiliFiyatlandirma"),
        ["ProductDetail"] = ("ayarlar", "urunYonetimi"),
        ["EmployeeBonusPlan"] = ("ayarlar", "calisan"),
        ["EmployeeMealPlan"] = ("ayarlar", "calisan"),
        ["EmployeeLeave"] = ("ayarlar", "calisan"),
        ["CampaignCondition"] = ("ayarlar", "kampanya"),
        ["CampaignAction"] = ("ayarlar", "kampanya"),
        ["CampaignTarget"] = ("ayarlar", "kampanya"),
        ["CampaignBuyRule"] = ("ayarlar", "kampanya"),
        ["CampaignDiscount"] = ("ayarlar", "kampanya"),
        ["CampaignDiscountPriceGroup"] = ("ayarlar", "kampanya"),
        ["VirtualPosConfiguration"] = ("ayarlar", "sanalPosTanim"),
        ["VirtualPosInstallmentRule"] = ("ayarlar", "sanalPosTanim"),
        ["VirtualPosBin"] = ("ayarlar", "sanalPosTanim"),
        ["BankBin"] = ("ayarlar", "sanalPosTanim"),

        ["CustomerLedgerEntry"] = ("fatura", "cariEkstre"),
        ["SupplierLedgerEntry"] = ("fatura", "cariEkstre"),
        ["StockMovement"] = ("fatura", "stokHareket"),
        ["Installation"] = ("fatura", "montaj"),
        ["InstallationDocument"] = ("fatura", "montaj"),
        ["ProductWarrantyRegistration"] = ("fatura", "garantiKayitlari"),
        ["WarrantyHistory"] = ("fatura", "garantiKayitlari"),
        ["EcommerceOrderPayment"] = ("fatura", "siparis"),
        ["InvoiceLine"] = ("fatura", "satisFatura"),
        ["SalesOrderLine"] = ("fatura", "siparis"),
        ["CustomerOfferLine"] = ("fatura", "musteriTeklifi"),
        ["CariOfferLine"] = ("fatura", "cariTeklifleri"),
        ["PurchaseInvoiceLine"] = ("fatura", "alis"),
        ["WarehouseTransferLine"] = ("fatura", "depoTransfer"),

        ["LoanInstallment"] = ("banka", "krediler"),
        ["PosAccountTransfer"] = ("banka", "posAktarim"),
        ["PosAccountTransferItem"] = ("banka", "posAktarim"),
        ["VirtualPosTransaction"] = ("banka", "sanalPosIslemleri"),

        ["CheckBranch"] = ("cekSenet", "musteriCeki"),
    };

    private (string ModuleKey, string PageKey) ResolveHeadlessActivityKeys(
        System.Collections.Generic.HashSet<string> headlineTypes)
    {
        // Kalem türleri (`...Line`) SONA atılır: bir işlemde hem "Cariye özel fiyat" hem
        // "Fatura kalemi" değişmişse satırı kalem değil, asıl konu adlandırmalı.
        var typeName = ChangeTracker.Entries()
            .Where(e => e.State == EntityState.Added
                     || e.State == EntityState.Deleted
                     || e.State == EntityState.Modified)
            .Select(e => e.Metadata.ClrType.Name)
            .Where(n => !headlineTypes.Contains(n)
                     && n != nameof(UserActivityLog)
                     && HeadlessActivityKeys.ContainsKey(n))
            .Distinct()
            .OrderBy(n => n.EndsWith("Line", StringComparison.Ordinal) ? 1 : 0)
            .ThenBy(n => n, StringComparer.Ordinal)
            .FirstOrDefault();

        return typeName is not null && HeadlessActivityKeys.TryGetValue(typeName, out var keys)
            ? keys
            : ("ayarlar", "digerIslemler");
    }

    private (string ModuleKey, string PageKey) MapEntityTypeToKeys(string entityType, object entity)
    {
        return entityType switch
        {
            "SalesOrder" => ("fatura", "siparis"),
            "CustomerOffer" => ("fatura", "musteriTeklifi"),
            "CariOffer" => entity is CariOffer co && !string.IsNullOrEmpty(co.ProformaDocumentNo) ? ("fatura", "bayiTeklifleri") : ("fatura", "cariTeklifleri"),
            "Invoice" => entity is Invoice inv && inv.Type == InvoiceType.Proforma ? ("fatura", "proforma") : entity is Invoice inv2 && inv2.Type == InvoiceType.OpenInvoice ? ("fatura", "faturaDokum") : ("fatura", "satisFatura"),
            "PurchaseInvoice" => entity is PurchaseInvoice pinv && pinv.Kind == PurchaseInvoiceKind.Purchase ? ("fatura", "termin") : ("fatura", "alis"),
            "WarehouseTransfer" => ("fatura", "depoTransfer"),
            "Irsaliye" => ("fatura", "irsaliye"),
            
            "CashAccount" => ("kasa", "kasalarim"),
            "CashAccountTransaction" => ("kasa", "kasaIslemleri"),
            "CashAccountTransfer" => ("kasa", "kasaIslemleri"),

            "CustomerCheck" => ("cekSenet", "musteriCeki"),
            "PayableCheck" => ("cekSenet", "debtCheck"),
            "PayableNote" => ("cekSenet", "debtNote"),

            "BankAccountDefinition" => ("banka", "bankaHesapTanim"),
            "BankAccountTransaction" => ("banka", "bankaIslemleri"),
            "BankAccountTransfer" => ("banka", "bankaIslemleri"),

            "User" => entity is User u && !string.IsNullOrWhiteSpace(u.Carikodu) ? ("ayarlar", "cariEkle") : ("ayarlar", "calisan"),
            "Customer" => ("ayarlar", "cariEkle"),
            "Supplier" => ("ayarlar", "tedarikciEkle"),
            "Product" => ("ayarlar", "urunYonetimi"),
            "ProductPrice" => ("ayarlar", "atiliFiyatlandirma"),
            "CustomerProductPriceOverride" => ("ayarlar", "atiliFiyatlandirma"),
            "ProductCategory" => ("ayarlar", "kategoriYonetimi"),
            "CustomerProductCategory" => ("ayarlar", "kategoriYonetimi"),
            "StockGroup" => ("ayarlar", "kategoriYonetimi"),
            "PriceGroup" => ("ayarlar", "fiyatKategorileri"),
            "Warehouse" => ("ayarlar", "depolar"),
            "Role" => ("ayarlar", "rolYetkileri"),
            "JwtSessionSetting" => ("ayarlar", "genelAyarlar"),
            "Campaign" => ("ayarlar", "kampanya"),
            "Salesman" => ("ayarlar", "plasiyerler"),
            "NumberSeries" => ("ayarlar", "numarator"),
            "MuhtelifCustomer" => ("ayarlar", "cariEkle"),
            "BayiMuhtelifCustomer" => ("ayarlar", "cariEkle"),
            "Employee" => ("ayarlar", "calisan"),
            "EmployeePayment" => ("ayarlar", "calisan"),
            "PosAccountSetting" => ("ayarlar", "posHesapAyar"),
            "InstallmentRule" => ("ayarlar", "installmentRules"),
            "VirtualPosDefinition" => ("ayarlar", "sanalPosTanim"),
            "ServiceCatalogItem" => ("ayarlar", "servisKatalogu"),
            "WarrantyExchangeSetting" => ("ayarlar", "garantiDegisim"),

            "AccountingPeriod" => ("fatura", "maliDonemler"),
            "WarrantyRecord" => ("fatura", "garantiKayitlari"),
            "WarrantyExchange" => ("fatura", "garantiDegisim"),

            "Loan" => ("banka", "krediler"),
            "LoanPayment" => ("banka", "krediler"),
            "Bank" => ("banka", "bankaHesapTanim"),
            "BankDetail" => ("banka", "bankaHesapTanim"),

            "CheckOperation" => ("cekSenet", "musteriCeki"),

            _ => ("ayarlar", entityType.ToLower())
        };
    }

    private async Task ProcessCustomerLedgerEntriesAsync(CancellationToken cancellationToken)
    {
        var entries = ChangeTracker.Entries<CustomerLedgerEntry>()
            .Where(e => e.State == EntityState.Added || e.State == EntityState.Modified)
            .ToList();

        foreach (var entry in entries)
        {
            var ledger = entry.Entity;

            // HER HAREKET KENDİ PARA BİRİMİNDE YÜRÜR (2026-08-17).
            //
            // Burada eskiden her cari hareketi CARİNİN kartındaki para birimine çevriliyordu:
            // satırın dövizi farklıysa CurrencyTypeId cariye çekiliyor, kur O ANKİ CANLI kurla
            // yeniden alınıyor ve CurrencyAmount = Amount / kur ile yeniden yazılıyordu.
            // Sonuçları:
            //   • 10.000 USD'lik çek, EUR cariye 8.654,58 EUR olarak düşüyordu (borcun kaynağı kayboluyor).
            //   • Cari kartı TL ise dövizli HER hareket koşulsuz TL damgalanıyordu.
            //   • Belgenin donmuş kuru (fatura kuru) canlı kurla eziliyordu.
            // Cari kartındaki döviz alanı da kaldırıldı; bir cariye her para biriminde satış yapılır.
            //
            // Yeni davranış: satırın para birimine DOKUNULMAZ, yalnız eksik alanlar tamamlanır.
            if (ledger.CurrencyTypeId <= 0)
            {
                ledger.CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try;
            }

            if (ledger.CurrencyRate <= 0m)
            {
                ledger.CurrencyRate = 1m;
            }

            if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(ledger.CurrencyTypeId))
            {
                // TL satırında kur 1'dir; döviz tutarı TL tutarının aynısıdır.
                ledger.CurrencyRate = 1m;
                ledger.CurrencyAmount = ledger.Amount;
            }
            else if (ledger.CurrencyAmount == 0m && ledger.Amount != 0m)
            {
                // Yazan taraf döviz tutarını vermemiş: TL çapasından KENDİ kuruyla üret.
                // Kur burada canlı kurdan ÇEKİLMEZ — belgenin donmuş kuru korunur.
                ledger.CurrencyAmount = Math.Round(ledger.Amount / ledger.CurrencyRate, 4);
            }

            // Ensure Date has a time component if it's date-only midnight
            if (ledger.Date.Hour == 0 && ledger.Date.Minute == 0 && ledger.Date.Second == 0)
            {
                ledger.Date = ledger.Date.Date.Add(DateTime.UtcNow.TimeOfDay);
            }

            // Calculate active balance if State is Added or Balance is 0
            if (entry.State == EntityState.Added || ledger.Balance == 0m)
            {
                try
                {
                    var mainCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(ledger.CustomerCode);
                    var prevBal = await CustomerLedgerEntries
                        .AsNoTracking()
                        .Where(x => x.Id != ledger.Id)
                        .Where(x => x.CustomerCode == mainCode || x.CustomerCode.StartsWith(mainCode + "-"))
                        .SumAsync(x => x.Direction == CustomerLedgerEntryDirection.Debit ? x.Amount : -x.Amount, cancellationToken);

                    var change = ledger.Direction == CustomerLedgerEntryDirection.Debit ? ledger.Amount : -ledger.Amount;
                    ledger.Balance = prevBal + change;
                }
                catch {}
            }
        }
    }

    private string MapCurrencyTypeIdToCode(int typeId)
    {
        return typeId switch
        {
            1 => "TRY",
            2 => "EUR",
            3 => "USD",
            4 => "GBP",
            _ => "TRY"
        };
    }
}
