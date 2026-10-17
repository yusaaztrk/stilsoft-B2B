using System;
using B2B.Erp.Api.Core.Http;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Core.Security;

namespace B2B.Erp.Api.Controllers
{
    [ApiController]
    [Route("api/service-ops/technicians")]
    [Authorize]
    public sealed class ServiceOpsTechniciansController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly AppDbContext _dbContext;

        public ServiceOpsTechniciansController(IHttpClientFactory httpClientFactory, IConfiguration configuration, AppDbContext dbContext)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _dbContext = dbContext;
        }

        public sealed class TechnicianPayload
        {
            public string FirstName { get; set; } = string.Empty;
            public string LastName { get; set; } = string.Empty;
            public string Phone { get; set; } = string.Empty;
            public string? Email { get; set; }
            public string Username { get; set; } = string.Empty;
            public string Password { get; set; } = string.Empty;
            public List<string> Roles { get; set; } = new();
            public string? CariKodu { get; set; }
            /// <summary>Gorebilecegi cariler (virgullu liste, '*' = hepsi). CariKodu ile ayni sey degil.</summary>
            public string? CariScope { get; set; }
            public int? RoleId { get; set; }
            public int? WarehouseCode { get; set; }
            public string? WarehouseName { get; set; }
            public int? CashAccountId { get; set; }
            public string? CashAccountName { get; set; }
            public int? BankAccountId { get; set; }
            public string? BankAccountName { get; set; }
            public int? PosAccountId { get; set; }
            public string? PosAccountName { get; set; }
            public string? PrimaryRegionId { get; set; }

            /// <summary>
            /// B2B erisim yetkileri. WarehouseCode/CashAccountId ile karistirilmamali: onlar
            /// teknisyenin kendi araci ve kasasi, bunlar B2B'de neye erisebildigi.
            /// ServiceOps bu alanlari yok sayar.
            /// </summary>
            public List<int> WarehouseCodes { get; set; } = new();
            public List<int> CashAccountIds { get; set; } = new();
            public List<int> BankAccountIds { get; set; } = new();

            /// <summary>
            /// WhatsApp Asistanı'na giriş (Users.AsistanAccess). 2026-10-11: teknisyenler Kullanıcılar
            /// listesinde görünmediği (servis personeli rolleri orada gizli) ve bu formda kutu olmadığı
            /// için asistana HİÇ açılamıyordu. null = dokunma (eski ekranlar alanı göndermez).
            /// </summary>
            public bool? AsistanAccess { get; set; }
        }

        public sealed class UpdateTechnicianPayload
        {
            public string FirstName { get; set; } = string.Empty;
            public string LastName { get; set; } = string.Empty;
            public string Phone { get; set; } = string.Empty;
            public string? Email { get; set; }
            public string? Username { get; set; }
            public List<string> Roles { get; set; } = new();
            public List<string> ExpertiseAreas { get; set; } = new();
            public string? CariKodu { get; set; }
            /// <summary>Gorebilecegi cariler (virgullu liste, '*' = hepsi). CariKodu ile ayni sey degil.</summary>
            public string? CariScope { get; set; }
            public int? RoleId { get; set; }
            public int? WarehouseCode { get; set; }
            public string? WarehouseName { get; set; }
            public int? CashAccountId { get; set; }
            public string? CashAccountName { get; set; }
            public int? BankAccountId { get; set; }
            public string? BankAccountName { get; set; }
            public int? PosAccountId { get; set; }
            public string? PosAccountName { get; set; }
            public string? PrimaryRegionId { get; set; }

            /// <summary>Bkz. CreateTechnicianPayload.WarehouseCodes.</summary>
            public List<int> WarehouseCodes { get; set; } = new();
            public List<int> CashAccountIds { get; set; } = new();
            public List<int> BankAccountIds { get; set; } = new();

            /// <summary>
            /// WhatsApp Asistanı'na giriş (Users.AsistanAccess). 2026-10-11: teknisyenler Kullanıcılar
            /// listesinde görünmediği (servis personeli rolleri orada gizli) ve bu formda kutu olmadığı
            /// için asistana HİÇ açılamıyordu. null = dokunma (eski ekranlar alanı göndermez).
            /// </summary>
            public bool? AsistanAccess { get; set; }
        }

        /// <summary>
        /// Teknisyen kaydiyla birlikte yaratilan B2B kullanicisinin depo / kasa / banka yetkilerini
        /// yazar. UsersController'daki create/update ile ayni kurallar: liste tamamen degistirilir,
        /// teknisyenin kendi araci/kasasi listede yoksa eklenir (yoksa kendi kasasina erisemezdi).
        ///
        /// Bu listeler daha once hic yazilmiyordu; teknisyen B2B'de tek bir depo yetkisi bile
        /// olmadan olusuyordu.
        /// </summary>
        private async Task SyncUserAccessAsync(
            User user,
            List<int> warehouseCodes,
            List<int> cashAccountIds,
            List<int> bankAccountIds,
            int? ownWarehouseCode,
            int? ownCashAccountId,
            int? ownBankAccountId,
            CancellationToken cancellationToken)
        {
            var warehouses = Normalise(warehouseCodes, ownWarehouseCode);
            var cash = Normalise(cashAccountIds, ownCashAccountId);
            var banks = Normalise(bankAccountIds, ownBankAccountId);

            var existingWarehouses = await _dbContext.UserWarehouses.Where(x => x.UserId == user.Id).ToListAsync(cancellationToken);
            _dbContext.UserWarehouses.RemoveRange(existingWarehouses);
            _dbContext.UserWarehouses.AddRange(warehouses.Select(code => new UserWarehouse { UserId = user.Id, WarehouseCode = code }));

            var existingCash = await _dbContext.UserCashAccounts.Where(x => x.UserId == user.Id).ToListAsync(cancellationToken);
            _dbContext.UserCashAccounts.RemoveRange(existingCash);
            _dbContext.UserCashAccounts.AddRange(cash.Select(id => new UserCashAccount { UserId = user.Id, CashAccountId = id }));

            var existingBanks = await _dbContext.UserBankAccounts.Where(x => x.UserId == user.Id).ToListAsync(cancellationToken);
            _dbContext.UserBankAccounts.RemoveRange(existingBanks);
            _dbContext.UserBankAccounts.AddRange(banks.Select(id => new UserBankAccount { UserId = user.Id, BankAccountId = id }));

            // VARSAYILAN DEPO = TEKNISYENIN ARAC DEPOSU (kullanici kurali, 2026-08-14).
            //
            // Satis faturasi ekrani, kalemi giren kisinin `DefaultWarehouseCode` alanini o kalemin
            // ontanimli cikis deposu yapiyor. Teknisyen icin bu her zaman kendi aracidir; ayrica
            // sorulmasinin anlami yok, o yuzden teknisyen formunda varsayilan depo secici kapali.
            // Arac deposu yoksa tek depo yetkisine dusulur; birden fazlaysa TAHMIN EDILMEZ.
            if (ownWarehouseCode.HasValue && ownWarehouseCode.Value != 0)
            {
                user.DefaultWarehouseCode = ownWarehouseCode.Value;
            }
            else if (warehouses.Count == 1)
            {
                user.DefaultWarehouseCode = warehouses[0];
            }

            static List<int> Normalise(List<int>? ids, int? own)
            {
                // NEGATIF DEPO KODU GECERLIDIR (or. -21 YP SIPARIS); filtre `!= 0`.
                var list = (ids ?? new List<int>()).Where(x => x != 0).Distinct().ToList();
                if (own.HasValue && own.Value != 0 && !list.Contains(own.Value))
                {
                    list.Add(own.Value);
                }
                return list;
            }
        }

        public sealed class UpdatePasswordPayload
        {
            public string Password { get; set; } = string.Empty;
            /// <summary>Ekrandaki teknisyen kullanıcı adı — kimlik eşleşmezse bununla bulunur.</summary>
            public string? Username { get; set; }
        }

        /// <summary>
        /// Teknisyenin YEDEK kimliği — firma kodunu da içerir (denetim md. E1).
        ///
        /// <para>
        /// Kimlik yalnız kullanıcı adından türetiliyordu: iki ayrı firmadaki "ahmet" AYNI
        /// GUID'i alıyordu. Bu kimlik ServiceOps'a gönderilmiyor (ServiceOps teknisyene kendi
        /// <c>Guid.NewGuid()</c>'ini verir) — ama ServiceOps ULAŞILAMAZKEN oluşturulan
        /// teknisyene ekrana dönen kimlik budur ve sonraki güncelleme/şifre/silme çağrıları
        /// kullanıcıyı bununla buluyor. Firma kodu girmeyince aynı adlı iki teknisyen tek
        /// kimlik paylaşıyordu.
        /// </para>
        ///
        /// <para>
        /// Firma kodu boş gelemez (uçların hepsi başta <c>X-Tenant-Code</c> çözülmezse
        /// isteği reddediyor), yine de boşsa eski davranışa düşülür — kimliksiz kalmaktansa.
        /// </para>
        /// </summary>
        private Guid GetDeterministicGuid(string username, string? tenantCode)
        {
            var user = (username ?? string.Empty).Trim().ToLowerInvariant();
            var firma = (tenantCode ?? string.Empty).Trim().ToLowerInvariant();

            // Ayraç ŞART: ayraçsız birleştirmede ("ab"+"c") ile ("a"+"bc") aynı diziyi verir,
            // yani firma kodu eklemek çakışmayı kapatmak yerine yerini değiştirirdi.
            var material = firma.Length == 0 ? user : $"{firma}|{user}";

            using var md5 = System.Security.Cryptography.MD5.Create();
            var hash = md5.ComputeHash(Encoding.UTF8.GetBytes(material));
            return new Guid(hash);
        }

        /// <summary>
        /// Firma kodu eklenmeden ÖNCE dağıtılmış kimlikler. Yalnızca EŞLEŞTİRMEDE kullanılır,
        /// yeni kimlik üretmede asla.
        ///
        /// <para>
        /// Değişiklikten önce açılmış bir ekran elindeki eski kimlikle şifre değiştirme ya da
        /// silme çağırabilir; onu tanımamak, çalışan bir işi hata olarak geri çevirmek olurdu.
        /// Eski kimlik firma bilgisi taşımıyor ama arama HER ZAMAN o firmanın kendi
        /// veritabanında yapıldığı için başka firmanın kaydına ulaşmaya yaramaz.
        /// </para>
        /// </summary>
        private Guid GetLegacyDeterministicGuid(string username)
            => GetDeterministicGuid(username, null);

        private async Task<string> GenerateNextTechnicianCariKoduAsync(CancellationToken cancellationToken)
        {
            // Kendi kodu artık kendi alanında; eski satırlarda Carikodu'nun başında duruyor olabilir.
            var existingCodes = await _dbContext.Users
                .AsNoTracking()
                .Where(u => u.ServiceOpsCariKodu != null || (u.Carikodu != null && u.Carikodu.StartsWith("TEK-")))
                .Select(u => u.ServiceOpsCariKodu ?? u.Carikodu!)
                .ToListAsync(cancellationToken);

            int maxSeq = 0;
            foreach (var code in existingCodes)
            {
                var parts = code.Split("TEK-");
                if (parts.Length <= 1) continue;

                // Alan teknisyenin kendi kodunun yanında görebileceği carilerin listesini de
                // taşıyabiliyor ("TEK-00001,BAYI-42"), o yüzden yalnızca baştaki rakamlar okunur.
                // Tamamı sayıya çevrilmeye çalışıldığında böyle kayıtlar sessizce atlanır ve bir
                // sonraki teknisyene zaten kullanılmış bir kod verilirdi.
                var digits = new string(parts[1].TakeWhile(char.IsDigit).ToArray());
                if (int.TryParse(digits, out var seq) && seq > maxSeq) maxSeq = seq;
            }

            return $"TEK-{(maxSeq + 1):D5}";
        }

        [AtomicRequest]
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] TechnicianPayload payload, CancellationToken cancellationToken)
        {
            // BCRYPT 72 BAYT SINIRI (denetim md. C3). Bu uc hem yeni kullanici acar hem
            // varolanin sifresini gunceller; ikisi de asagida ayni payload'dan gectigi icin
            // kontrol en basta. BCrypt fazlasini SESSIZCE atar: sinir asilirsa teknisyen
            // parolasinin sonunu yanlis yazsa bile giris acilir.
            if (PasswordHasher.ExceedsBcryptLimit(payload?.Password))
            {
                return BadRequest(new
                {
                    success = false,
                    message = $"Sifre en fazla {PasswordHasher.MaxPasswordBytes} bayt olabilir (Turkce karakterler 2 bayt sayilir)."
                });
            }

            var baseUrl = (_configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").Trim();
            if (!baseUrl.EndsWith("/", StringComparison.Ordinal)) baseUrl += "/";

            var tenantCode = Request.Headers["X-Tenant-Code"].FirstOrDefault()
                ?? User.FindFirst("TenantCode")?.Value
                ?? User.FindFirst("tenantCode")?.Value;

            if (string.IsNullOrWhiteSpace(tenantCode))
            {
                // Sabit "DEMO" varsayilani KALDIRILDI: firma kodu cozulemediginde istek sessizce
                // BASKA BIR FIRMANIN veritabanina gidiyordu. Teknisyen eklendigi firmada gorunmuyordu.
                return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) cozulemedi." });
            }

            var cariKodu = payload.CariKodu?.Trim();
            if (string.IsNullOrWhiteSpace(cariKodu))
            {
                cariKodu = await GenerateNextTechnicianCariKoduAsync(cancellationToken);
            }
            payload.CariKodu = cariKodu;

            // Kapsam ayrı bir alan ama '*' ile boş bırakmak GÜVENLİ DEĞİL: Carikodu aynı zamanda
            // B2B'nin cari kısıtlamasının okunduğu yer ve orada hem '*' hem boş "kısıtlama yok"
            // demek (bkz. CustomerScope.IsUnrestricted). Teknisyen rollerinin B2B sayfaları da
            // olduğu için, cari atanmamış bir teknisyen böylece bütün carilere açılırdı.
            //
            // Cari seçilmediğinde teknisyenin kendi kodu yazılır: hiçbir müşteriyle eşleşmeyen,
            // dolayısıyla hiçbir şey açmayan bir değer — teknisyenlerin bugüne kadarki davranışı.
            var cariScope = string.IsNullOrWhiteSpace(payload.CariScope) ? cariKodu : payload.CariScope.Trim();
            payload.CariScope = cariScope;

            // 1. Ensure Role exists and create/update User in B2B database
            try
            {
                Role? selectedRole = null;
                if (payload.RoleId.HasValue && payload.RoleId.Value > 0)
                {
                    selectedRole = await _dbContext.Roles.FirstOrDefaultAsync(r => r.Id == payload.RoleId.Value, cancellationToken);
                }

                if (selectedRole == null)
                {
                    selectedRole = await _dbContext.Roles.FirstOrDefaultAsync(r => r.Code == "ServisPersonel", cancellationToken);
                    if (selectedRole == null)
                    {
                        selectedRole = new Role
                        {
                            Code = "ServisPersonel",
                            Name = "Teknisyen",
                            DisplayName = "Teknisyen",
                            Description = "Teknisyen Rolü",
                            IsActive = true,
                            CreatedAt = DateTime.UtcNow
                        };
                        _dbContext.Roles.Add(selectedRole);
                        await _dbContext.SaveChangesAsync(cancellationToken);
                    }
                }

                var existingUser = await _dbContext.Users.FirstOrDefaultAsync(u => u.Username.ToLower() == payload.Username.Trim().ToLower(), cancellationToken);
                if (existingUser == null)
                {
                    var newUser = new User
                    {
                        Username = payload.Username.Trim(),
                        Password = PasswordHasher.HashPassword(payload.Password),
                        Mail = payload.Email ?? "",
                        Gsm = payload.Phone,
                        Unvan = $"{payload.FirstName} {payload.LastName}".Trim(),
                        ServiceOpsCariKodu = cariKodu,
                        Carikodu = cariScope,
                        RoleId = selectedRole.Id,
                        DefaultCashAccountId = payload.CashAccountId,
                        DefaultBankAccountId = payload.BankAccountId,
                        IsActive = true,
                        ServiceOpsAccess = true,
                        AsistanAccess = payload.AsistanAccess ?? false
                    };
                    _dbContext.Users.Add(newUser);
                    await _dbContext.SaveChangesAsync(cancellationToken);
                    await SyncUserAccessAsync(newUser, payload.WarehouseCodes, payload.CashAccountIds, payload.BankAccountIds, payload.WarehouseCode, payload.CashAccountId, payload.BankAccountId, cancellationToken);
                }
                else
                {
                    existingUser.Mail = payload.Email ?? "";
                    existingUser.Gsm = payload.Phone;
                    existingUser.Unvan = $"{payload.FirstName} {payload.LastName}".Trim();
                    existingUser.ServiceOpsCariKodu = cariKodu;
                    existingUser.Carikodu = cariScope;
                    existingUser.RoleId = selectedRole.Id;
                    existingUser.DefaultCashAccountId = payload.CashAccountId;
                    existingUser.DefaultBankAccountId = payload.BankAccountId;
                    existingUser.IsActive = true;
                    existingUser.ServiceOpsAccess = true;
                    if (payload.AsistanAccess.HasValue) existingUser.AsistanAccess = payload.AsistanAccess.Value;
                    if (!string.IsNullOrWhiteSpace(payload.Password))
                    {
                        existingUser.Password = PasswordHasher.HashPassword(payload.Password);
                    }
                    _dbContext.Users.Update(existingUser);
                    await SyncUserAccessAsync(existingUser, payload.WarehouseCodes, payload.CashAccountIds, payload.BankAccountIds, payload.WarehouseCode, payload.CashAccountId, payload.BankAccountId, cancellationToken);
                }
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ServiceOps Proxy - B2B user creation failed]: {ex.Message}");
            }

            // 2. Proxy request to ServiceOps API
            try
            {
                var serviceOpsJwt = GenerateServiceOpsToken(tenantCode);

                var client = _httpClientFactory.CreateClient();
                client.BaseAddress = new Uri(baseUrl);
                client.Timeout = TimeSpan.FromSeconds(3);

                client.DefaultRequestHeaders.Remove("Authorization");
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", serviceOpsJwt);
                client.DefaultRequestHeaders.Remove("X-Tenant-Code");
                client.DefaultRequestHeaders.Add("X-Tenant-Code", tenantCode);

                using var req = new HttpRequestMessage(HttpMethod.Post, "api/technicians")
                {
                    Content = new StringContent(
                        System.Text.Json.JsonSerializer.Serialize(payload),
                        System.Text.Encoding.UTF8,
                        "application/json"
                    )
                };

                var res = await client.SendAsync(req, cancellationToken);
                var body = await res.Content.ReadAsStringAsync(cancellationToken);

                if (res.IsSuccessStatusCode)
                {
                    return Content(body, "application/json");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ServiceOps proxy Create failed, falling back]: {ex.Message}");
            }

            // Fallback success response if ServiceOps is down
            return Ok(new
            {
                id = GetDeterministicGuid(payload.Username, tenantCode).ToString(),
                employeeNumber = $"TECH-B2B-{payload.Username}",
                firstName = payload.FirstName,
                lastName = payload.LastName,
                username = payload.Username,
                email = payload.Email,
                phone = payload.Phone,
                cariKodu = cariKodu,
                roleId = payload.RoleId,
                status = 0,
                roles = payload.Roles,
                expertiseAreas = new string[] {},
                isActive = true,
                tenantCode = tenantCode,
                warehouseCode = payload.WarehouseCode,
                warehouseName = payload.WarehouseName,
                cashAccountId = payload.CashAccountId,
                cashAccountName = payload.CashAccountName,
                bankAccountId = payload.BankAccountId,
                bankAccountName = payload.BankAccountName,
                posAccountId = payload.PosAccountId,
                posAccountName = payload.PosAccountName,
                primaryRegionId = payload.PrimaryRegionId
            });
        }

        [HttpGet("regions")]
        public async Task<IActionResult> GetRegions(CancellationToken cancellationToken)
        {
            var baseUrl = (_configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").Trim();
            if (!baseUrl.EndsWith("/", StringComparison.Ordinal)) baseUrl += "/";

            var tenantCode = Request.Headers["X-Tenant-Code"].FirstOrDefault()
                ?? User.FindFirst("TenantCode")?.Value
                ?? User.FindFirst("tenantCode")?.Value;

            if (string.IsNullOrWhiteSpace(tenantCode))
            {
                // Sabit "DEMO" varsayilani KALDIRILDI: firma kodu cozulemediginde istek sessizce
                // BASKA BIR FIRMANIN veritabanina gidiyordu. Teknisyen eklendigi firmada gorunmuyordu.
                return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) cozulemedi." });
            }

            try
            {
                var serviceOpsJwt = GenerateServiceOpsToken(tenantCode);

                var client = _httpClientFactory.CreateClient();
                client.BaseAddress = new Uri(baseUrl);
                client.Timeout = TimeSpan.FromSeconds(3);

                client.DefaultRequestHeaders.Remove("Authorization");
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", serviceOpsJwt);
                client.DefaultRequestHeaders.Remove("X-Tenant-Code");
                client.DefaultRequestHeaders.Add("X-Tenant-Code", tenantCode);

                var res = await client.GetAsync("api/Regions", cancellationToken);
                if (res.IsSuccessStatusCode)
                {
                    var body = await res.Content.ReadAsStringAsync(cancellationToken);
                    return Content(body, "application/json");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ServiceOps proxy GetRegions failed]: {ex.Message}");
            }

            return Ok(Array.Empty<object>());
        }

        [HttpGet]
        public async Task<IActionResult> GetAll(CancellationToken cancellationToken)
        {
            var baseUrl = (_configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").Trim();
            if (!baseUrl.EndsWith("/", StringComparison.Ordinal)) baseUrl += "/";

            var tenantCode = Request.Headers["X-Tenant-Code"].FirstOrDefault()
                ?? User.FindFirst("TenantCode")?.Value
                ?? User.FindFirst("tenantCode")?.Value;

            if (string.IsNullOrWhiteSpace(tenantCode))
            {
                // Sabit "DEMO" varsayilani KALDIRILDI: firma kodu cozulemediginde istek sessizce
                // BASKA BIR FIRMANIN veritabanina gidiyordu. Teknisyen eklendigi firmada gorunmuyordu.
                return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) cozulemedi." });
            }

            try
            {
                var serviceOpsJwt = GenerateServiceOpsToken(tenantCode);

                var client = _httpClientFactory.CreateClient();
                client.BaseAddress = new Uri(baseUrl);
                client.Timeout = TimeSpan.FromSeconds(3);

                client.DefaultRequestHeaders.Remove("Authorization");
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", serviceOpsJwt);
                client.DefaultRequestHeaders.Remove("X-Tenant-Code");
                client.DefaultRequestHeaders.Add("X-Tenant-Code", tenantCode);

                var path = "api/technicians" + Request.QueryString.Value;
                var res = await client.GetAsync(path, cancellationToken);
                if (res.IsSuccessStatusCode)
                {
                    var body = await res.Content.ReadAsStringAsync(cancellationToken);
                    try
                    {
                        using var doc = System.Text.Json.JsonDocument.Parse(body);
                        if (doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Array)
                        {
                            var usersMap = (await _dbContext.Users
                                .Include(u => u.Role)
                                .Include(u => u.UserWarehouses)
                                .Include(u => u.UserCashAccounts)
                                .Include(u => u.UserBankAccounts)
                                .AsNoTracking()
                                .ToListAsync(cancellationToken))
                                .ToDictionary(u => u.Username.Trim().ToLowerInvariant(), u => u);

                            var list = new List<Dictionary<string, object?>>();
                            foreach (var item in doc.RootElement.EnumerateArray())
                            {
                                var dict = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object?>>(item.GetRawText()) ?? new();
                                string usernameKey = "";
                                if (dict.TryGetValue("username", out var unObj) && unObj != null)
                                {
                                    usernameKey = unObj.ToString()?.Trim().ToLowerInvariant() ?? "";
                                }

                                if (usersMap.TryGetValue(usernameKey, out var b2bUser))
                                {
                                    dict["cariKodu"] = b2bUser.ServiceOpsCariKodu ?? $"TEK-{b2bUser.Id:D5}";
                                    // '*' DEGIL: bos kapsam B2B'de "kisitlama yok" demek ve bunu
                                    // varsayilan gostermek, kaydedildiginde teknisyeni butun
                                    // carilere aciyordu.
                                    dict["cariScope"] = b2bUser.Carikodu ?? "";
                                    dict["roleId"] = b2bUser.RoleId;
                                    dict["roleName"] = b2bUser.Role?.DisplayName ?? b2bUser.Role?.Name;
                                    dict["roleCode"] = b2bUser.Role?.Code;
                                    dict["warehouseCodes"] = b2bUser.UserWarehouses.Select(x => x.WarehouseCode).ToList();
                                    dict["cashAccountIds"] = b2bUser.UserCashAccounts.Select(x => x.CashAccountId).ToList();
                                    dict["bankAccountIds"] = b2bUser.UserBankAccounts.Select(x => x.BankAccountId).ToList();
                                    dict["asistanAccess"] = b2bUser.AsistanAccess;
                                }
                                else
                                {
                                    if (!dict.ContainsKey("cariKodu")) dict["cariKodu"] = null;
                                    if (!dict.ContainsKey("roleId")) dict["roleId"] = null;
                                }
                                list.Add(dict);
                            }
                            return Ok(list);
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[Enrich technician list failed]: {ex.Message}");
                    }
                    return Content(body, "application/json");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ServiceOps proxy GetAll failed, falling back to B2B DB]: {ex.Message}");
            }

            // Fallback: ServiceOps'a ulasilamadiginda liste B2B kullanicilarindan kurulur.
            //
            // Rol listesi EKSIKTI: yalnizca ServisPersonel/Technician/Teknisyen vardi. Klima Ekibi,
            // Saha Montaj Ekibi ve Servis Muduru eklendikleri halde teknisyen listesinde hic
            // gorunmuyordu -- "kullanicilara dusuyor, teknisyenlere dusmuyor" sikayeti buydu.
            //
            // NOT: bu liste PERSONEL LISTESIDIR. "Saha teknisyeni mi" sorusu ayri bir karardir ve
            // ServiceOps tarafinda FieldTechnicianRoleCodes ile veriliyor -- ServisMudur oraya
            // EKLENMEMELI, yoksa mudur saha teknisyeni sayilip is atanabilir hale gelir.
            var personnelRoleCodes = new[]
            {
                "ServisPersonel", "Technician", "Teknisyen",
                "KlimaEkibi", "SahaMontajEkibi", "ServisMudur", "MontajMudur"
            };

            var techUsers = await _dbContext.Users
                .Include(u => u.Role)
                .Include(u => u.UserWarehouses)
                .Include(u => u.UserCashAccounts)
                .Include(u => u.UserBankAccounts)
                .Where(u => u.IsActive &&
                            (personnelRoleCodes.Contains(u.Role.Code) || personnelRoleCodes.Contains(u.Role.Name)))
                .ToListAsync(cancellationToken);

            var fallbackList = techUsers.Select(u => {
                var parts = u.Unvan.Split(' ', 2);
                var firstName = parts.Length > 0 ? parts[0] : u.Username;
                var lastName = parts.Length > 1 ? parts[1] : "";
                
                return new {
                    id = GetDeterministicGuid(u.Username, tenantCode).ToString(),
                    employeeNumber = $"TECH-B2B-{u.Id}",
                    firstName = firstName,
                    lastName = lastName,
                    username = u.Username,
                    email = u.Mail,
                    phone = u.Gsm ?? "",
                    cariKodu = u.ServiceOpsCariKodu ?? $"TEK-{u.Id:D5}",
                    // Bkz. yukarisi: '*' varsayilani teknisyeni butun carilere aciyordu.
                    cariScope = u.Carikodu ?? "",
                    roleId = u.RoleId,
                    roleName = u.Role?.DisplayName ?? u.Role?.Name,
                    roleCode = u.Role?.Code,
                    status = 0, // Available
                    roles = new[] { "Montaj" }, // Default
                    expertiseAreas = new string[] {},
                    isActive = u.IsActive,
                    tenantCode = tenantCode,
                    warehouseCode = (int?)null,
                    warehouseName = (string?)null,
                    cashAccountId = (int?)null,
                    cashAccountName = (string?)null,
                    bankAccountId = (int?)null,
                    bankAccountName = (string?)null,
                    posAccountId = (int?)null,
                    posAccountName = (string?)null,
                    primaryRegionId = (string?)null,
                    warehouseCodes = u.UserWarehouses.Select(x => x.WarehouseCode).ToList(),
                    cashAccountIds = u.UserCashAccounts.Select(x => x.CashAccountId).ToList(),
                    bankAccountIds = u.UserBankAccounts.Select(x => x.BankAccountId).ToList(),
                    asistanAccess = u.AsistanAccess
                };
            }).ToList();

            return Ok(fallbackList);
        }

        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] UpdateTechnicianPayload payload, CancellationToken cancellationToken)
        {
            var baseUrl = (_configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").Trim();
            if (!baseUrl.EndsWith("/", StringComparison.Ordinal)) baseUrl += "/";

            var tenantCode = Request.Headers["X-Tenant-Code"].FirstOrDefault()
                ?? User.FindFirst("TenantCode")?.Value
                ?? User.FindFirst("tenantCode")?.Value;

            if (string.IsNullOrWhiteSpace(tenantCode))
            {
                // Sabit "DEMO" varsayilani KALDIRILDI: firma kodu cozulemediginde istek sessizce
                // BASKA BIR FIRMANIN veritabanina gidiyordu. Teknisyen eklendigi firmada gorunmuyordu.
                return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) cozulemedi." });
            }

            // Sync local B2B user record if exists
            var allUsers = await _dbContext.Users.Include(u => u.Role).ToListAsync(cancellationToken);
            var targetUser = allUsers.FirstOrDefault(u => 
                GetDeterministicGuid(u.Username, tenantCode) == id ||
                GetLegacyDeterministicGuid(u.Username) == id ||
                (!string.IsNullOrWhiteSpace(payload.Username) && string.Equals(u.Username, payload.Username, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(payload.CariKodu) && string.Equals(u.ServiceOpsCariKodu, payload.CariKodu, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(payload.Email) && string.Equals(u.Mail, payload.Email, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrWhiteSpace(payload.Phone) && string.Equals(u.Gsm, payload.Phone, StringComparison.OrdinalIgnoreCase))
            );

            if (targetUser != null)
            {
                targetUser.Unvan = $"{payload.FirstName} {payload.LastName}".Trim();
                targetUser.Gsm = payload.Phone;
                if (!string.IsNullOrWhiteSpace(payload.Email)) targetUser.Mail = payload.Email;
                if (!string.IsNullOrWhiteSpace(payload.CariKodu)) targetUser.ServiceOpsCariKodu = payload.CariKodu.Trim();
                if (!string.IsNullOrWhiteSpace(payload.CariScope)) targetUser.Carikodu = payload.CariScope.Trim();
                if (payload.RoleId.HasValue && payload.RoleId.Value > 0)
                {
                    targetUser.RoleId = payload.RoleId.Value;
                }
                targetUser.DefaultCashAccountId = payload.CashAccountId;
                targetUser.DefaultBankAccountId = payload.BankAccountId;
                if (payload.AsistanAccess.HasValue) targetUser.AsistanAccess = payload.AsistanAccess.Value;
                _dbContext.Users.Update(targetUser);
                await SyncUserAccessAsync(targetUser, payload.WarehouseCodes, payload.CashAccountIds, payload.BankAccountIds, payload.WarehouseCode, payload.CashAccountId, payload.BankAccountId, cancellationToken);
                await _dbContext.SaveChangesAsync(cancellationToken);
            }

            // 1. Try proxy to ServiceOps
            try
            {
                var serviceOpsJwt = GenerateServiceOpsToken(tenantCode);

                var client = _httpClientFactory.CreateClient();
                client.BaseAddress = new Uri(baseUrl);
                client.Timeout = TimeSpan.FromSeconds(3);

                client.DefaultRequestHeaders.Remove("Authorization");
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", serviceOpsJwt);
                client.DefaultRequestHeaders.Remove("X-Tenant-Code");
                client.DefaultRequestHeaders.Add("X-Tenant-Code", tenantCode);

                using var req = new HttpRequestMessage(HttpMethod.Put, $"api/technicians/{id}")
                {
                    Content = new StringContent(
                        System.Text.Json.JsonSerializer.Serialize(payload),
                        System.Text.Encoding.UTF8,
                        "application/json"
                    )
                };

                var res = await client.SendAsync(req, cancellationToken);
                var body = await res.Content.ReadAsStringAsync(cancellationToken);

                if (res.IsSuccessStatusCode)
                {
                    return Content(body, "application/json");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ServiceOps proxy Update failed, falling back to local B2B update]: {ex.Message}");
            }

            if (targetUser != null)
            {
                return Ok(new
                {
                    id = id.ToString(),
                    employeeNumber = $"TECH-B2B-{targetUser.Username}",
                    firstName = payload.FirstName,
                    lastName = payload.LastName,
                    username = targetUser.Username,
                    email = payload.Email,
                    phone = payload.Phone,
                    cariKodu = targetUser.ServiceOpsCariKodu,
                    cariScope = targetUser.Carikodu,
                    roleId = targetUser.RoleId,
                    roleName = targetUser.Role?.DisplayName ?? targetUser.Role?.Name,
                    roleCode = targetUser.Role?.Code,
                    status = 0,
                    roles = payload.Roles,
                    expertiseAreas = payload.ExpertiseAreas,
                    isActive = targetUser.IsActive,
                    tenantCode = tenantCode,
                    warehouseCode = payload.WarehouseCode,
                    warehouseName = payload.WarehouseName,
                    cashAccountId = payload.CashAccountId,
                    cashAccountName = payload.CashAccountName,
                    bankAccountId = payload.BankAccountId,
                    bankAccountName = payload.BankAccountName,
                    posAccountId = payload.PosAccountId,
                    posAccountName = payload.PosAccountName,
                    primaryRegionId = payload.PrimaryRegionId
                });
            }

            return NotFound(new { success = false, message = "Teknisyen bulunamadı" });
        }

        [HttpPut("{id:guid}/password")]
        public async Task<IActionResult> UpdatePassword(Guid id, [FromBody] UpdatePasswordPayload payload, CancellationToken cancellationToken)
        {
            var baseUrl = (_configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").Trim();
            if (!baseUrl.EndsWith("/", StringComparison.Ordinal)) baseUrl += "/";

            var tenantCode = Request.Headers["X-Tenant-Code"].FirstOrDefault()
                ?? User.FindFirst("TenantCode")?.Value
                ?? User.FindFirst("tenantCode")?.Value;

            if (string.IsNullOrWhiteSpace(tenantCode))
            {
                // Sabit "DEMO" varsayilani KALDIRILDI: firma kodu cozulemediginde istek sessizce
                // BASKA BIR FIRMANIN veritabanina gidiyordu. Teknisyen eklendigi firmada gorunmuyordu.
                return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) cozulemedi." });
            }

            // Sifre YALNIZCA B2B "Users" tablosunda tutuluyor; ServiceOps tarafinda sifre yok.
            //
            // Burada once ServiceOps'a proxy yapiliyordu ve proxy BASARILI olursa metot oracikta
            // return ediyordu -- yani B2B'deki gercek sifre HIC guncellenmiyordu. Proxy hata
            // verirse de yalnizca B2B guncelleniyordu. Sonuc: iki taraftaki sifre kalici olarak
            // birbirinden ayrisiyor, kullanicinin hangi sifreyle girecegi belirsizlesiyordu.
            // ServiceOps'taki sifre kolonu kaldirildigi icin proxy tamamen gereksiz.
            if (string.IsNullOrWhiteSpace(payload.Password) || payload.Password.Length < 6)
            {
                return BadRequest(new { success = false, message = "Sifre en az 6 karakter olmalidir" });
            }

            // Alt sinir vardi, UST SINIR YOKTU (denetim md. C3). BCrypt parolanin ilk 72
            // baytini hesaba katip gerisini SESSIZCE atar: 80 karakterlik bir sifrede son
            // karakterler hicbir sey ifade etmez, teknisyen onlari yanlis yazsa bile girer.
            if (PasswordHasher.ExceedsBcryptLimit(payload.Password))
            {
                return BadRequest(new
                {
                    success = false,
                    message = $"Sifre en fazla {PasswordHasher.MaxPasswordBytes} bayt olabilir (Turkce karakterler 2 bayt sayilir)."
                });
            }

            /*
              KİMLİK EŞLEŞMİYORDU → 404 → ŞİFRE HİÇ DEĞİŞMİYORDU (2026-09-18 canlı: "bu
              teknisyenin adına giriş yapamıyorum").

              Listedeki teknisyen kimliği ServiceOps'un KENDİ id'sidir (`Guid.NewGuid()`);
              buradaki türetilmiş GUID yalnız ServiceOps'a ulaşılamadığında ekrana döner. Bu uç
              ise yalnız türetilmiş GUID'le arıyordu: canlıda proxy hep ayakta olduğu için hiçbir
              teknisyen eşleşmiyor, kullanıcı "Teknisyen bulunamadı" alıyor, eski şifre kalıyordu.
              Güncelleme ucu (PUT {id}) kullanıcı adı/cari kodu/e-posta ile de eşleştirdiği için
              o çalışıyordu — fark buydu.

              Sıra: türetilmiş GUID → ekrandan gelen kullanıcı adı → ServiceOps'tan id ile
              teknisyeni çekip kullanıcı adı / cari kodu / e-posta.
            */
            var allUsers = await _dbContext.Users.ToListAsync(cancellationToken);
            var targetUser = allUsers.FirstOrDefault(u =>
                GetDeterministicGuid(u.Username, tenantCode) == id
                || GetLegacyDeterministicGuid(u.Username) == id);

            var hintUsername = (payload.Username ?? string.Empty).Trim();
            if (targetUser == null && hintUsername.Length > 0)
            {
                targetUser = allUsers.FirstOrDefault(u => string.Equals(u.Username, hintUsername, StringComparison.OrdinalIgnoreCase));
            }

            if (targetUser == null)
            {
                var remote = await TryGetServiceOpsTechnicianAsync(baseUrl, tenantCode, id, cancellationToken);
                if (remote is not null)
                {
                    targetUser = allUsers.FirstOrDefault(u =>
                        (!string.IsNullOrWhiteSpace(remote.Value.Username) && string.Equals(u.Username, remote.Value.Username, StringComparison.OrdinalIgnoreCase))
                        || (!string.IsNullOrWhiteSpace(remote.Value.CariKodu) && string.Equals(u.ServiceOpsCariKodu, remote.Value.CariKodu, StringComparison.OrdinalIgnoreCase))
                        || (!string.IsNullOrWhiteSpace(remote.Value.Email) && string.Equals(u.Mail, remote.Value.Email, StringComparison.OrdinalIgnoreCase)));
                }
            }

            if (targetUser != null)
            {
                targetUser.Password = PasswordHasher.HashPassword(payload.Password);
                _dbContext.Users.Update(targetUser);
                await _dbContext.SaveChangesAsync(cancellationToken);

                return Ok(new { success = true, message = "Sifre guncellendi" });
            }

            return NotFound(new { success = false, message = "Teknisyenin B2B kullanıcı kaydı bulunamadı; kullanıcı adını kontrol edin." });
        }

        /// <summary>
        /// ServiceOps'tan teknisyeni id ile çeker; ulaşılamazsa <c>null</c>. Yalnız B2B kullanıcısını
        /// bulmak için kullanılır (kullanıcı adı / cari kodu / e-posta).
        /// </summary>
        private async Task<(string? Username, string? CariKodu, string? Email)?> TryGetServiceOpsTechnicianAsync(
            string baseUrl, string tenantCode, Guid id, CancellationToken cancellationToken)
        {
            try
            {
                var serviceOpsJwt = GenerateServiceOpsToken(tenantCode);
                var client = _httpClientFactory.CreateClient();
                client.BaseAddress = new Uri(baseUrl);
                client.Timeout = TimeSpan.FromSeconds(3);
                client.DefaultRequestHeaders.Remove("Authorization");
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", serviceOpsJwt);
                client.DefaultRequestHeaders.Remove("X-Tenant-Code");
                client.DefaultRequestHeaders.Add("X-Tenant-Code", tenantCode);

                var res = await client.GetAsync($"api/technicians/{id}", cancellationToken);
                if (!res.IsSuccessStatusCode) return null;

                var body = await res.Content.ReadAsStringAsync(cancellationToken);
                using var doc = System.Text.Json.JsonDocument.Parse(body);
                var root = doc.RootElement;
                if (root.ValueKind == System.Text.Json.JsonValueKind.Object && root.TryGetProperty("data", out var data) && data.ValueKind == System.Text.Json.JsonValueKind.Object)
                {
                    root = data;
                }
                if (root.ValueKind != System.Text.Json.JsonValueKind.Object) return null;

                static string? Str(System.Text.Json.JsonElement e, string name)
                    => e.TryGetProperty(name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;

                return (Str(root, "username"), Str(root, "cariKodu"), Str(root, "email"));
            }
            catch
            {
                return null;
            }
        }

        [HttpDelete("{id:guid}")]
        public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
        {
            var baseUrl = (_configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").Trim();
            if (!baseUrl.EndsWith("/", StringComparison.Ordinal)) baseUrl += "/";

            var tenantCode = Request.Headers["X-Tenant-Code"].FirstOrDefault()
                ?? User.FindFirst("TenantCode")?.Value
                ?? User.FindFirst("tenantCode")?.Value;

            if (string.IsNullOrWhiteSpace(tenantCode))
            {
                // Sabit "DEMO" varsayilani KALDIRILDI: firma kodu cozulemediginde istek sessizce
                // BASKA BIR FIRMANIN veritabanina gidiyordu. Teknisyen eklendigi firmada gorunmuyordu.
                return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) cozulemedi." });
            }

            // 1. Try proxy to ServiceOps
            try
            {
                var serviceOpsJwt = GenerateServiceOpsToken(tenantCode);

                var client = _httpClientFactory.CreateClient();
                client.BaseAddress = new Uri(baseUrl);
                client.Timeout = TimeSpan.FromSeconds(3);

                client.DefaultRequestHeaders.Remove("Authorization");
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", serviceOpsJwt);
                client.DefaultRequestHeaders.Remove("X-Tenant-Code");
                client.DefaultRequestHeaders.Add("X-Tenant-Code", tenantCode);

                var res = await client.DeleteAsync($"api/technicians/{id}", cancellationToken);
                var body = await res.Content.ReadAsStringAsync(cancellationToken);

                if (res.IsSuccessStatusCode)
                {
                    return Content(body, "application/json");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ServiceOps proxy Delete failed, falling back to local B2B update]: {ex.Message}");
            }

            // 2. Fallback delete locally
            var allUsers = await _dbContext.Users.ToListAsync(cancellationToken);
            var targetUser = allUsers.FirstOrDefault(u =>
                GetDeterministicGuid(u.Username, tenantCode) == id
                || GetLegacyDeterministicGuid(u.Username) == id);
            if (targetUser != null)
            {
                targetUser.IsActive = false;
                _dbContext.Users.Update(targetUser);
                await _dbContext.SaveChangesAsync(cancellationToken);

                return Ok(new { success = true, message = "Teknisyen silindi" });
            }

            return NotFound(new { success = false, message = "Teknisyen bulunamadı" });
        }

        /// <summary>
        /// B2B backend'inin KENDİSİNİN service-ops-api'ye yaptığı sunucu-sunucu çağrıları için
        /// kısa ömürlü (15 dk) bir servis kimliği — gerçek bir kullanıcıya bağlı değil. Süper
        /// admin bypass'ı artık service-ops-api'de rol ADI stringine ("Admin") değil yalnızca
        /// isSuperAdmin/IsSuperSuperAdmin claim'ine bakıyor; bu yüzden burada da rol stringi
        /// yerine doğrudan o claim'ler yazılıyor — güvenilir bir makine kimlik bilgisi olduğu
        /// için, kim olduğuna bakılmaksızın "Admin" adında bir rolü taklit etmeye gerek yok.
        /// </summary>
        private string GenerateServiceOpsToken(string tenantCode)
            => ServiceOpsProxyToken.Create(_configuration, tenantCode);
    }
}
