using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Services;

public enum ServiceOpsScopeKind
{
    None = 0,
    All = 1,
    OwnAssigned = 2,
    OwnDealer = 3
}

public sealed record ServiceOpsScope(ServiceOpsScopeKind Kind, Guid? TechnicianId, string? DealerCode)
{
    public bool CanAccess => Kind != ServiceOpsScopeKind.None;
    public bool CanViewAll => Kind == ServiceOpsScopeKind.All;

    /// <summary>
    /// Cari kapsamı tek bir kod değil, bir liste.
    ///
    /// B2B tarafında `Users.Carikodu` virgülle ayrılmış bir liste tutuyor (bir plasiyerin bütün
    /// defteri tek seferde atanabildiği için sütun 8000 karaktere genişletildi) ve '*' "tüm
    /// cariler" demek. Burada tek değermiş gibi karşılaştırıldığında, birden fazla cariye bağlı
    /// bir kullanıcı hiçbir kayıtla eşleşmiyordu: "BAYI-1,BAYI-2" diye bir cari kodu yok.
    /// </summary>
    public IReadOnlyList<string> DealerCodes => ParseDealerCodes(DealerCode);

    /// <summary>
    /// Listede '*' varsa kısıtlama yok. Tek başına olması şart değil: teknisyenin kendi cari kodu
    /// (TEK-xxxxx) da aynı listede duruyor, yani "tüm cariler" seçilmiş bir teknisyende liste
    /// "TEK-00001,*" şeklinde gelir.
    /// </summary>
    public bool HasAllDealers => DealerCodes.Contains("*");

    public static IReadOnlyList<string> ParseDealerCodes(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return Array.Empty<string>();
        return raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }
}

public interface IServiceOpsPermissionService
{
    /// <summary>
    /// TEK doğru kaynak: bir oturumun sınırsız (tüm tenant'lar, tüm kayıtlar) erişimi olup
    /// olmadığı. Yalnızca IsSuperSuperAdmin/isSuperAdmin claim'lerine bakar — rol adı stringine
    /// ("Admin", "SuperAdmin") veya kullanıcı adına asla. Her controller kendi kopyasını
    /// yazmasın diye public.
    /// </summary>
    bool IsSuperAdmin(ClaimsPrincipal user);
    bool IsTechnicianUser(ClaimsPrincipal user);
    Guid? GetTechnicianId(ClaimsPrincipal user);
    string? GetDealerCode(ClaimsPrincipal user);
    Task<ServiceOpsScope> GetScopeAsync(ClaimsPrincipal user, string pageKey, CancellationToken cancellationToken = default);

    /// <summary>
    /// Sayfanın bu role AÇIK olup olmadığı — kaç kayıt görebildiğinden bağımsız.
    ///
    /// <see cref="GetScopeAsync"/> iki ayrı soruyu tek cevapta birleştiriyor: "sayfa açık mı" ve
    /// "hangi kayıtlar görünür". Sayfası açık ama kayıt kapsamı boş olan bir kullanıcıda (ör.
    /// "tümünü görme" verilmemiş, teknisyen de değil) <c>CanAccess</c> false döner. Kayıt
    /// süzmek için doğru, ama "bu işlemi yapabilir mi" sorusu için yanlış: yeni cari eklemek
    /// için kullanıcının başkalarının işlerini görebiliyor olması gerekmez.
    /// </summary>
    Task<bool> HasPageAsync(ClaimsPrincipal user, string pageKey, CancellationToken cancellationToken = default);
    Task<Dictionary<string, string>> GetPageScopesAsync(ClaimsPrincipal user, IEnumerable<string> pageKeys, CancellationToken cancellationToken = default);
    IQueryable<ServiceRecord> ApplyServiceRecordScope(IQueryable<ServiceRecord> query, ServiceOpsScope scope);
    IQueryable<InstallationTask> ApplyInstallationTaskScope(IQueryable<InstallationTask> query, ServiceOpsScope scope);
    IQueryable<CargoTrackingTask> ApplyCargoScope(IQueryable<CargoTrackingTask> query, ServiceOpsScope scope);
}

public sealed class ServiceOpsPermissionService : IServiceOpsPermissionService
{
    private readonly IConfiguration _configuration;
    private readonly ApplicationDbContext _context;

    /// <summary>
    /// İSTEK BAŞINA önbellek. Servis scoped kayıtlı, yani bu alanların ömrü bir HTTP isteği.
    ///
    /// <see cref="GetGrantedKeysAsync"/> her çağrıda master DB'ye (tenant→DbName) ve ardından
    /// firmanın DB'sine YENİ bağlantı açıyordu. Tek bir uç bunu defalarca yapıyor:
    /// <c>GetWidestScopeAsync</c> üç sayfa anahtarı için üç kez soruyor, her biri iki bağlantı —
    /// tek istekte altı bağlantı ve altı gidiş-dönüş. Cevap istek boyunca değişmediği için
    /// sonuçlar burada tutuluyor.
    /// </summary>
    private readonly Dictionary<string, HashSet<string>> _grantedKeyCache = new(StringComparer.OrdinalIgnoreCase);
    private string? _cachedConnectionString;
    private bool _connectionStringResolved;

    public ServiceOpsPermissionService(IConfiguration configuration, ApplicationDbContext context)
    {
        _configuration = configuration;
        _context = context;
    }

    public bool IsTechnicianUser(ClaimsPrincipal user)
    {
        // Callers use this to refuse an action, so a super admin must never answer true here.
        // A technicianId claim alone was enough to count as one, and an account that had once
        // been mapped to a technician keeps that id after being promoted — planning, routing
        // and deletion then came back Forbid for a user who is allowed all of it.
        if (IsSuperAdmin(user)) return false;

        var role = GetRole(user);
        return string.Equals(role, "Technician", StringComparison.OrdinalIgnoreCase) || GetTechnicianId(user).HasValue;
    }

    public Guid? GetTechnicianId(ClaimsPrincipal user)
    {
        var value = user.FindFirstValue("technicianId");
        return Guid.TryParse(value, out var id) ? id : null;
    }

    public string? GetDealerCode(ClaimsPrincipal user)
    {
        var value = user.FindFirstValue("dealerCode") ?? user.FindFirstValue("Carikodu") ?? user.FindFirstValue("currentCode");
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    /// <summary>
    /// Kabul ekranları. Bunlarda "kendi işi" kullanıcıya bağlı CARİ demektir: bayi kendi
    /// kayıtlarının nerede olduğunu görsün diye. Geri kalan her sekmede "kendi işi" kullanıcıya
    /// ATANMIŞ İŞ demektir; oralarda cariye düşmek, bir bayinin kendisine hiç atanmamış işleri de
    /// görmesi anlamına gelirdi.
    /// </summary>
    private static readonly HashSet<string> DealerScopedPages = new(StringComparer.OrdinalIgnoreCase)
    {
        "montajKabul",
        "buyukEvAletleriKabul",
        "kucukUrunKabul"
    };

    /// <summary>
    /// Bir sayfanın/sekmenin bu oturum için kapsamı.
    ///
    /// İki ayrı karar var ve karıştırılmamaları gerekiyor: sekme AÇIK MI (sayfa anahtarı) ve
    /// açıksa NE KADARI görünüyor (kapsam anahtarı). Eskiden sayfa anahtarının tek başına olması
    /// "hepsini gör" sayılıyordu, yani kapsam fiilen hiç uygulanmıyordu — bir sekmeyi birine
    /// açmak, o sekmedeki bütün işleri de açmak demekti.
    /// </summary>
    public async Task<ServiceOpsScope> GetScopeAsync(ClaimsPrincipal user, string pageKey, CancellationToken cancellationToken = default)
    {
        if (IsSuperAdmin(user))
        {
            return new ServiceOpsScope(ServiceOpsScopeKind.All, GetTechnicianId(user), GetDealerCode(user));
        }

        var techId = GetTechnicianId(user);
        var dealerCode = GetDealerCode(user);
        var keys = BuildPermissionKeys(pageKey);
        var granted = await GetGrantedKeysAsync(user, keys, cancellationToken);

        // Sekme kapalıysa kapsamın anlamı yok.
        if (!granted.Contains(pageKey))
        {
            return new ServiceOpsScope(ServiceOpsScopeKind.None, techId, dealerCode);
        }

        if (granted.Contains($"{pageKey}.tumIsleriGorme"))
        {
            return new ServiceOpsScope(ServiceOpsScopeKind.All, techId, dealerCode);
        }

        // Kapsam anahtarı yoksa varsayılan dar olan: sadece kendine ait olan. Açık kalan tarafa
        // düşmek, yetki ekranında hiçbir şey işaretlememiş bir role sessizce her şeyi vermek olurdu.
        var root = RootPageKey(pageKey);

        if (DealerScopedPages.Contains(root))
        {
            var codes = ServiceOpsScope.ParseDealerCodes(dealerCode);
            if (codes.Count == 0)
                return new ServiceOpsScope(ServiceOpsScopeKind.None, techId, dealerCode);

            // '*' B2B'de "tüm cariler" demek; kabul ekranında bu, kapsamın tamamı anlamına gelir.
            if (codes.Contains("*"))
                return new ServiceOpsScope(ServiceOpsScopeKind.All, techId, dealerCode);

            return new ServiceOpsScope(ServiceOpsScopeKind.OwnDealer, techId, dealerCode);
        }

        return techId.HasValue
            ? new ServiceOpsScope(ServiceOpsScopeKind.OwnAssigned, techId, dealerCode)
            : new ServiceOpsScope(ServiceOpsScopeKind.None, techId, dealerCode);
    }

    public async Task<bool> HasPageAsync(ClaimsPrincipal user, string pageKey, CancellationToken cancellationToken = default)
    {
        if (IsSuperAdmin(user)) return true;

        var granted = await GetGrantedKeysAsync(user, new[] { pageKey }, cancellationToken);
        return granted.Contains(pageKey);
    }

    /// <summary>'buyukUrun.sahaPlanlama' -> 'buyukUrun'. Kapsamın neye göre daraltılacağı kök sayfaya bağlı.</summary>
    private static string RootPageKey(string pageKey)
    {
        var dot = pageKey.IndexOf('.');
        return dot < 0 ? pageKey : pageKey[..dot];
    }

    public async Task<Dictionary<string, string>> GetPageScopesAsync(ClaimsPrincipal user, IEnumerable<string> pageKeys, CancellationToken cancellationToken = default)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pageKey in pageKeys.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var scope = await GetScopeAsync(user, pageKey, cancellationToken);
            if (scope.CanAccess)
            {
                result[pageKey] = scope.Kind switch
                {
                    ServiceOpsScopeKind.All => "All",
                    ServiceOpsScopeKind.OwnDealer => "OwnDealer",
                    ServiceOpsScopeKind.OwnAssigned => "OwnAssigned",
                    _ => "None"
                };
            }
        }
        return result;
    }

    public IQueryable<ServiceRecord> ApplyServiceRecordScope(IQueryable<ServiceRecord> query, ServiceOpsScope scope)
    {
        return scope.Kind switch
        {
            ServiceOpsScopeKind.All => query,
            ServiceOpsScopeKind.OwnAssigned when scope.TechnicianId.HasValue => query.Where(s =>
                s.AssignedTechnicianId == scope.TechnicianId.Value ||
                s.TechnicianId == scope.TechnicianId.Value ||
                s.WorkshopTechnicianId == scope.TechnicianId.Value ||
                s.DeliveryTechnicianId == scope.TechnicianId.Value ||
                s.CompletedByTechnicianId == scope.TechnicianId.Value ||
                s.InstallationTasks.Any(t => t.AssignedTechnicianId == scope.TechnicianId.Value)),
            ServiceOpsScopeKind.OwnDealer when !string.IsNullOrWhiteSpace(scope.DealerCode) => ApplyDealerFilter(query, scope.DealerCode),
            _ => query.Where(_ => false)
        };
    }

    public IQueryable<InstallationTask> ApplyInstallationTaskScope(IQueryable<InstallationTask> query, ServiceOpsScope scope)
    {
        return scope.Kind switch
        {
            ServiceOpsScopeKind.All => query,
            ServiceOpsScopeKind.OwnAssigned when scope.TechnicianId.HasValue => query.Where(t => t.AssignedTechnicianId == scope.TechnicianId.Value),
            ServiceOpsScopeKind.OwnDealer when scope.HasAllDealers => query,
            ServiceOpsScopeKind.OwnDealer when scope.DealerCodes.Count > 0 => ApplyInstallationDealerFilter(query, scope.DealerCodes),
            _ => query.Where(_ => false)
        };
    }

    /// <summary>
    /// Kargo kapsamı. Kardeş metotlardan (ApplyServiceRecordScope / ApplyInstallationTaskScope)
    /// ayrıştığı tek nokta OwnDealer dalıdır ve bu AYRIŞMA KASITLIDIR — hata değil.
    ///
    /// İki sebebi var:
    /// 1) İŞ KURALI: kargo takibi bayiyi ilgilendirmiyor. Bayinin gördüğü şey servis kaydı ve
    ///    montaj işidir; sevkiyatın hangi aşamada olduğu iç operasyon bilgisidir.
    /// 2) TEKNİK: CargoTrackingTask'ta cari alanı YOK (bkz. entity — OrderNumber/CustomerName
    ///    var, DealerCode ya da Service ilişkisi yok). Yani "bu bayinin kargosu" diye
    ///    süzülebilecek bir alan bulunmuyor; cari filtresi uydurulmadan yazılamaz.
    ///
    /// Buraya cari filtresi eklemek isteyen önce (1)'i kullanıcıya sormalı, sonra (2) için
    /// entity'ye cari bağı eklemeli. Boş liste dönmesi beklenen davranıştır.
    /// </summary>
    public IQueryable<CargoTrackingTask> ApplyCargoScope(IQueryable<CargoTrackingTask> query, ServiceOpsScope scope)
    {
        return scope.Kind switch
        {
            ServiceOpsScopeKind.All => query,
            ServiceOpsScopeKind.OwnAssigned when scope.TechnicianId.HasValue => query.Where(t => t.AssignedTechnicianId == scope.TechnicianId.Value),
            // Bayi: kasıtlı olarak hiçbir kayıt. Yukarıdaki özete bakmadan değiştirme.
            ServiceOpsScopeKind.OwnDealer => query.Where(_ => false),
            _ => query.Where(_ => false)
        };
    }

    /// <summary>Montaj işleri için cari filtresi; ServiceRecord tarafındaki kuralın aynısı.</summary>
    private static IQueryable<InstallationTask> ApplyInstallationDealerFilter(IQueryable<InstallationTask> query, IReadOnlyList<string> rawCodes)
    {
        var codes = rawCodes
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (codes.Length == 0) return query.Where(_ => false);
        if (codes.Contains("*")) return query;

        var predicate = PredicateBuilder.False<InstallationTask>();

        predicate = predicate.Or(t =>
            (t.Service.DealerCode != null && codes.Contains(t.Service.DealerCode)) ||
            (t.Service.Dealer != null && t.Service.Dealer.DealerCode != null && codes.Contains(t.Service.Dealer.DealerCode)) ||
            (t.Service.DealerName != null && codes.Contains(t.Service.DealerName)) ||
            (t.Service.CustomerName != null && codes.Contains(t.Service.CustomerName)));

        foreach (var code in codes)
        {
            var c = code;
            predicate = predicate.Or(t => t.Service.DealerName != null && EF.Functions.ILike(t.Service.DealerName, $"%{c}%"));
            predicate = predicate.Or(t => t.Service.CustomerName != null && EF.Functions.ILike(t.Service.CustomerName, $"%{c}%"));
        }

        return query.Where(predicate);
    }

    private IQueryable<ServiceRecord> ApplyDealerFilter(IQueryable<ServiceRecord> query, string dealerCode)
    {
        var codes = ServiceOpsScope.ParseDealerCodes(dealerCode)
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (codes.Length == 0) return query.Where(_ => false);
        if (codes.Contains("*")) return query;

        var predicate = PredicateBuilder.False<ServiceRecord>();

        predicate = predicate.Or(s =>
            (s.DealerCode != null && codes.Contains(s.DealerCode)) ||
            (s.Dealer != null && s.Dealer.DealerCode != null && codes.Contains(s.Dealer.DealerCode)) ||
            (s.DealerName != null && codes.Contains(s.DealerName)) ||
            (s.CustomerName != null && codes.Contains(s.CustomerName)));

        foreach (var code in codes)
        {
            var c = code;
            predicate = predicate.Or(s => s.DealerName != null && EF.Functions.ILike(s.DealerName, $"%{c}%"));
            predicate = predicate.Or(s => s.CustomerName != null && EF.Functions.ILike(s.CustomerName, $"%{c}%"));
        }

        return query.Where(predicate);
    }

    private async Task<HashSet<string>> GetGrantedKeysAsync(ClaimsPrincipal user, IEnumerable<string> keys, CancellationToken cancellationToken)
    {
        var requested = keys.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (requested.Count == 0) return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var username = user.FindFirstValue(ClaimTypes.Name) ?? user.Identity?.Name ?? "";
        var tenantCode = user.FindFirstValue("tenantCode") ?? "";
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(tenantCode))
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // Bu istekte daha önce sorulan anahtarlar tekrar sorulmaz. Önbellekten gelen CEVAPLAR
        // baştan sonuca konuyor; yalnızca eksik anahtarlar DB'ye gidiyor ve sonuç ikisinin
        // birleşimi oluyor. (Erken dönüp sadece yeni sorguyu döndürmek, karışık durumda
        // önceden bilinen yetkileri kaybettirirdi.)
        var result = requested
            .Where(k => _grantedKeyCache.TryGetValue(k, out var cached) && cached.Count > 0)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var uncached = requested.Where(k => !_grantedKeyCache.ContainsKey(k)).ToList();
        if (uncached.Count == 0) return result;
        requested = uncached;

        if (!_connectionStringResolved)
        {
            _cachedConnectionString = await ResolveB2BTenantConnectionStringAsync(tenantCode, cancellationToken);
            _connectionStringResolved = true;
        }
        var connString = _cachedConnectionString;
        if (string.IsNullOrWhiteSpace(connString)) return result;

        var granted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            await using var conn = new NpgsqlConnection(connString);
            await conn.OpenAsync(cancellationToken);

            var roleIds = new List<int>();
            await using (var roleCmd = new NpgsqlCommand(@"
                SELECT u.""RoleId""
                FROM public.""Users"" u
                WHERE LOWER(u.""Username"") = @username AND u.""IsActive"" = true
                LIMIT 1", conn))
            {
                roleCmd.Parameters.AddWithValue("username", username.Trim().ToLowerInvariant());
                var roleObj = await roleCmd.ExecuteScalarAsync(cancellationToken);
                if (roleObj != null && roleObj != DBNull.Value) roleIds.Add(Convert.ToInt32(roleObj));
            }

            // B2B'de kullanıcı satırı olmayan teknisyenin yetkisi, KENDİ EKİP ROLÜNDEN gelir.
            //
            // Burası sabit 'ServisPersonel' rolüne düşüyordu: Klima Ekibi, Saha Montaj Ekibi ve
            // Servis Müdürü dahil bütün teknisyenler aynı sayfa setini alıyordu. Yetkisi olmayan
            // kullanıcının üstteki geçiş sekmelerini (planlama, teslimattakiler, saha) görmesinin
            // sebebi buydu — sekme kapısı doğru çalışıyor, kendisine yanlış rol veriliyordu.
            // Roller B2B'de zaten tanımlı: KlimaEkibi, SahaMontajEkibi, ServisMudur, ServisPersonel.
            //
            // Birden fazla ekip rolü olan teknisyende yetkiler BİRLEŞİMDİR: iki ekipte birden
            // çalışan biri her iki ekibin sayfalarını görmeli.
            if (roleIds.Count == 0 && IsTechnicianUser(user))
            {
                var technicianRoleCodes = (user.FindFirstValue("technicianRoles") ?? string.Empty)
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

                // Ekip rolü hiç yazılmamış teknisyen eskisi gibi ServisPersonel sayılır: burada
                // boş küme dönmek, rolü atanmamış bir teknisyeni sistemden tamamen kilitlerdi.
                if (technicianRoleCodes.Length == 0)
                    technicianRoleCodes = new[] { "ServisPersonel" };

                await using var techRoleCmd = new NpgsqlCommand(
                    "SELECT \"Id\" FROM public.\"Roles\" WHERE \"Code\" = ANY(@codes) AND \"IsActive\" = true", conn);
                techRoleCmd.Parameters.AddWithValue("codes", technicianRoleCodes);
                await using var techReader = await techRoleCmd.ExecuteReaderAsync(cancellationToken);
                while (await techReader.ReadAsync(cancellationToken))
                {
                    roleIds.Add(techReader.GetInt32(0));
                }
            }

            if (roleIds.Count == 0) return granted;

            await using var cmd = new NpgsqlCommand(@"
                SELECT p.""Key""
                FROM public.""RolePagePermissions"" rp
                INNER JOIN public.""Pages"" p ON rp.""PageId"" = p.""Id""
                WHERE rp.""RoleId"" = ANY(@roleIds)
                  AND rp.""CanAccess"" = true
                  AND p.""ModuleKey"" = 'serviceOps'
                  AND p.""IsActive"" = true
                  AND p.""Key"" = ANY(@keys)", conn);
            cmd.Parameters.AddWithValue("roleIds", roleIds.ToArray());
            cmd.Parameters.AddWithValue("keys", requested.ToArray());

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                granted.Add(reader.GetString(0));
            }

            // Sorulan her anahtarın cevabı (verilmiş ya da verilmemiş) önbelleğe yazılır;
            // yalnızca verilenler yazılsaydı, verilmeyen anahtar her seferinde tekrar sorulurdu.
            foreach (var key in requested)
            {
                _grantedKeyCache[key] = granted.Contains(key)
                    ? new HashSet<string>(new[] { key }, StringComparer.OrdinalIgnoreCase)
                    : new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            }
        }
        catch (Exception ex)
        {
            // Sorgu patlarsa SONUÇ ÖNBELLEĞE YAZILMAZ: geçici bir ağ/DB hatası bütün istek
            // boyunca "yetkisiz" olarak çakılıp kalmasın.
            Console.WriteLine($"[ServiceOpsPermission] Permission lookup failed: {ex.Message}");
        }

        result.UnionWith(granted);
        return result;
    }

    private async Task<string?> ResolveB2BTenantConnectionStringAsync(string tenantCode, CancellationToken cancellationToken)
    {
        var baseConn = _configuration.GetConnectionString("DefaultConnection") ?? _configuration.GetConnectionString("ServiceOpsBase");
        if (string.IsNullOrWhiteSpace(baseConn)) return null;

        try
        {
            var masterBuilder = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp_master" };
            string? dbName = null;
            await using (var master = new NpgsqlConnection(masterBuilder.ConnectionString))
            {
                await master.OpenAsync(cancellationToken);
                await using var cmd = new NpgsqlCommand("SELECT \"DbName\" FROM public.\"Tenants\" WHERE LOWER(\"Code\") = @tenantCode LIMIT 1", master);
                cmd.Parameters.AddWithValue("tenantCode", tenantCode.Trim().ToLowerInvariant());
                dbName = await cmd.ExecuteScalarAsync(cancellationToken) as string;
            }

            var tenantBuilder = new NpgsqlConnectionStringBuilder(baseConn)
            {
                Database = string.IsNullOrWhiteSpace(dbName) ? "b2b_erp" : dbName
            };
            return tenantBuilder.ConnectionString;
        }
        catch
        {
            var fallback = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp" };
            return fallback.ConnectionString;
        }
    }

    private static string[] BuildPermissionKeys(string pageKey)
    {
        return new[]
        {
            pageKey,
            $"{pageKey}.tumIsleriGorme",
            $"{pageKey}.sadeceKendiIsleri"
        };
    }

    /// <summary>
    /// Süper admin kararı SADECE claim'e bakar — rol adı stringine (ör. "Admin") ya da kullanıcı
    /// adına ("ssa" yazan biri) DEĞİL. B2B tarafı bu dersi zaten öğrenmişti (AuthController.cs'te
    /// "kullanıcı adı tenant'ın düzenleyebildiği veri, yetki kararı olamaz" diye kaldırılmış bir
    /// kontrol var) — ama service-ops-api aynı deliği kendi login akışında yeniden açmıştı: B2B'den
    /// gelen "ne teknisyen ne süper admin" her kullanıcı (Bayi/AltBayi dahil) varsayılan olarak
    /// `role="Admin"` alıyordu ve bu string burada tam yetki anlamına geliyordu.
    ///
    /// Sayfa/kapsam kararı (`GetScopeAsync` → `GetGrantedKeysAsync`) bu claim'lere hiç bakmaz;
    /// kullanıcı adından B2B'deki GERÇEK RoleId'yi bulup `RolePagePermissions`'tan okur. Yani bu
    /// metodun tek işi "DB'ye hiç sormadan her şeye izin ver" kısayolunu YALNIZCA gerçekten
    /// kanıtlanmış (claim'e yazılmış) süper admin için açmak — claim'ler yalnızca B2B'nin master
    /// DB'de doğruladığı GlobalUsers.IsSuperSuperAdmin ve B2B login yanıtındaki isSuperAdmin
    /// bayrağından (CreateJwt çağrı noktalarında) set edilir, burada string karşılaştırması yok.
    /// </summary>
    public bool IsSuperAdmin(ClaimsPrincipal user)
    {
        return user.FindFirstValue("IsSuperSuperAdmin") == "1"
            || user.FindFirstValue("isSuperAdmin") == "true";
    }

    private static string GetRole(ClaimsPrincipal user)
    {
        return user.FindFirstValue(ClaimTypes.Role)
            ?? user.FindFirstValue("role")
            ?? "";
    }
}
