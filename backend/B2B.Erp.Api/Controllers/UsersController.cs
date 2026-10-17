using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Core.Security;
using B2B.Erp.Api.Core.Http;
using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Users;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("users", "kullaniciListesi")]
public sealed class UsersController : ControllerBase
{
    /// <summary>
    /// The salesman role. The number was already repeated literally throughout this
    /// controller; naming it in one place at least makes every use point at the same fact
    /// instead of five independent magic numbers.
    /// </summary>
    private const int PlasiyerRoleId = 10;

    private readonly IUserRepository _userRepository;
    private readonly AppDbContext _dbContext;
    private readonly MasterDbContext _masterDb;

    private readonly B2B.Erp.Api.Core.Sessions.ISharedSessionStore _sharedSessions;

    public UsersController(
        IUserRepository userRepository,
        AppDbContext dbContext,
        MasterDbContext masterDb,
        B2B.Erp.Api.Core.Sessions.ISharedSessionStore sharedSessions)
    {
        _userRepository = userRepository;
        _dbContext = dbContext;
        _masterDb = masterDb;
        _sharedSessions = sharedSessions;
    }

    private async Task<int?> ResolveTenantIdAsync(CancellationToken cancellationToken)
    {
        var tenantCode = ResolveTenantCodeFromRequest();
        if (string.IsNullOrWhiteSpace(tenantCode)) return null;

        var tenant = await _masterDb.Tenants
            .AsNoTracking()
            .Where(x => x.Code == tenantCode)
            .Select(x => new { x.Id })
            .FirstOrDefaultAsync(cancellationToken);

        return tenant?.Id;
    }

    private async Task EnsureSuperAdminRoleHasEnabledPagesAsync(int superAdminRoleId, int tenantId, CancellationToken cancellationToken)
    {
        if (superAdminRoleId <= 0 || tenantId <= 0) return;

        var enabledPageIds = await _masterDb.TenantEnabledPages
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.IsEnabled)
            .Select(x => x.PageId)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (enabledPageIds.Count == 0) return;

        var existingPageIdsInDb = await _dbContext.Pages
            .AsNoTracking()
            .Where(x => enabledPageIds.Contains(x.Id))
            .Select(x => x.Id)
            .ToListAsync(cancellationToken);

        var validPageIds = enabledPageIds.Intersect(existingPageIdsInDb).ToList();

        if (validPageIds.Count == 0) return;

        var existing = await _dbContext.RolePagePermissions
            .Where(x => x.RoleId == superAdminRoleId && validPageIds.Contains(x.PageId))
            .ToListAsync(cancellationToken);

        var existingPageIds = existing.Select(x => x.PageId).ToHashSet();
        foreach (var rp in existing)
        {
            rp.CanAccess = true;
        }

        foreach (var pageId in validPageIds)
        {
            if (existingPageIds.Contains(pageId)) continue;
            _dbContext.RolePagePermissions.Add(new RolePagePermission
            {
                RoleId = superAdminRoleId,
                PageId = pageId,
                CanAccess = true
            });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken cancellationToken)
    {
        var usersQuery = from u in _dbContext.Users.AsNoTracking()
                         join c in _dbContext.Customers.AsNoTracking() on u.Carikodu equals c.CustomerCode into custJoin
                         from c in custJoin.DefaultIfEmpty()
                         join r in _dbContext.Roles.AsNoTracking() on u.RoleId equals r.Id into roleJoin
                         from r in roleJoin.DefaultIfEmpty()
                         orderby u.Id
                         select new
                         {
                             User = u,
                             RoleName = r != null ? r.Name : string.Empty,
                             RoleCode = r != null ? r.Code : string.Empty,
                             CariAdi = c != null ? c.Name : null,
                             WarehouseCodes = u.UserWarehouses.Select(x => x.WarehouseCode).Distinct().ToList(),
                             CashAccountIds = u.UserCashAccounts.Select(x => x.CashAccountId).Distinct().ToList(),
                             BankAccountIds = u.UserBankAccounts.Select(x => x.BankAccountId).Distinct().ToList()
                         };

        var rawUsers = await usersQuery.ToListAsync(cancellationToken);

        // SERVİS PERSONELİ SÜZGECİ BELLEKTE UYGULANIR (2026-08-18).
        //
        // Bu koşul sorgunun `where`indeydi ve `IsPersonnel` bir C# yardımcısı olduğu için EF
        // onu SQL'e ÇEVİREMİYOR: uç nokta her çağrıda `InvalidOperationException` atıp 500
        // dönüyordu — "Users fetch failed (500)". Kullanıcı listesi zaten tamamen belleğe
        // çekiliyor (`ToListAsync`), dolayısıyla süzgeci buraya almanın maliyeti yok.
        // Anlam da birebir korunuyor: rolü olmayan kullanıcıda `RoleCode`/`RoleName` boş
        // string gelir, `IsPersonnel` false döner ve satır listede kalır.
        var data = rawUsers
            .Where(x => !B2B.Erp.Api.Core.Helpers.ServiceOpsPersonnelRoles.IsPersonnel(x.RoleCode, x.RoleName))
            .Select(x => ToResponse(x.User, x.RoleName, x.RoleCode, x.CariAdi, x.WarehouseCodes, x.CashAccountIds, x.BankAccountIds))
            .ToList();

        return Ok(new
        {
            success = true,
            data
        });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateUserRequest request, CancellationToken cancellationToken)
    {
        var tenantCode = ResolveTenantCodeFromRequest();

        var normalizedUsername = request.Username.Trim();
        if (normalizedUsername.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Username), "Username is required.");
        }

        var normalizedMail = request.Mail.Trim();
        if (normalizedMail.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Mail), "Mail is required.");
        }

        var normalizedUnvan = request.Unvan.Trim();
        if (normalizedUnvan.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Unvan), "Unvan is required.");
        }

        var normalizedCarikodu = request.Carikodu?.Trim();

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // The scope may list several customers, so every code in it is checked. It used to be
        // compared as a single code, which rejected any multi-customer selection outright.
        var scopeCodes = CustomerScope.Parse(normalizedCarikodu);
        if (scopeCodes.Count > 0)
        {
            var knownCount = await _dbContext.Customers
                .AsNoTracking()
                .CountAsync(x => scopeCodes.Contains(x.CustomerCode), cancellationToken);

            if (knownCount != scopeCodes.Count)
            {
                ModelState.AddModelError(nameof(request.Carikodu), "Carikodu is invalid.");
                return ValidationProblem(ModelState);
            }
        }

        var usernameExists = await _dbContext.Users
            .AsNoTracking()
            .AnyAsync(x => x.Username == normalizedUsername, cancellationToken);

        if (usernameExists)
        {
            ModelState.AddModelError(nameof(request.Username), "Username must be unique.");
            return ValidationProblem(ModelState);
        }

        var mailExists = await _dbContext.Users
            .AsNoTracking()
            .AnyAsync(x => x.Mail == normalizedMail, cancellationToken);

        if (mailExists)
        {
            ModelState.AddModelError(nameof(request.Mail), "Mail must be unique.");
            return ValidationProblem(ModelState);
        }

        var role = await _dbContext.Roles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == request.RoleId, cancellationToken);

        if (role is null)
        {
            ModelState.AddModelError(nameof(request.RoleId), "RoleId is invalid.");
            return ValidationProblem(ModelState);
        }

        var salesmanCode = request.SalesmanCode?.Trim();

        var isTargetSuperAdmin = role.IsSuperAdmin;
        if (isTargetSuperAdmin)
        {
            var tenantId = await ResolveTenantIdAsync(cancellationToken);
            if (tenantId.HasValue)
            {
                await EnsureSuperAdminRoleHasEnabledPagesAsync(role.Id, tenantId.Value, cancellationToken);
            }
        }
        var warehouseCodes = NormalizeWarehouseCodes(request.WarehouseCodes);

        if (!isTargetSuperAdmin)
        {


            var requestedDefault = request.DefaultWarehouseCode;
            if (requestedDefault.HasValue && requestedDefault.Value != 0 && !warehouseCodes.Contains(requestedDefault.Value))
            {
                ModelState.AddModelError(nameof(request.DefaultWarehouseCode), "Varsayılan depo, kullanıcının yetkili olduğu depolar arasından seçilmelidir");
                return ValidationProblem(ModelState);
            }

            var existing = await _dbContext.Set<Warehouse>()
                .AsNoTracking()
                .Where(x => x.IsActive && warehouseCodes.Contains(x.WarehouseCode))
                .Select(x => x.WarehouseCode)
                .ToListAsync(cancellationToken);

            if (existing.Count != warehouseCodes.Count)
            {
                ModelState.AddModelError(nameof(request.WarehouseCodes), "Depo seçimi geçersiz");
                return ValidationProblem(ModelState);
            }
        }

        // Süper adminde varsayılan depo YETKİ listesinden değil, aktif depolar arasından seçilir.
        var effectiveDefaultWarehouseCode = isTargetSuperAdmin
            ? await ResolveSuperAdminDefaultWarehouseCodeAsync(request.DefaultWarehouseCode, cancellationToken)
            : ResolveDefaultWarehouseCode(request.DefaultWarehouseCode, warehouseCodes);

        if (isTargetSuperAdmin
            && request.DefaultWarehouseCode.HasValue
            && request.DefaultWarehouseCode.Value != 0
            && !effectiveDefaultWarehouseCode.HasValue)
        {
            ModelState.AddModelError(nameof(request.DefaultWarehouseCode), "Varsayılan depo bulunamadı veya pasif");
            return ValidationProblem(ModelState);
        }

        if (request.RoleId == PlasiyerRoleId)
        {
            if (!request.DiscountRate.HasValue || request.DiscountRate.Value < 0 || request.DiscountRate.Value > 100)
            {
                ModelState.AddModelError(nameof(request.DiscountRate), "Plasiyer rolü için indirim oranı zorunludur ve 0 ile 100 arasında olmalıdır.");
                return ValidationProblem(ModelState);
            }
        }
        else
        {
            if (request.DiscountRate.HasValue && (request.DiscountRate.Value < 0 || request.DiscountRate.Value > 100))
            {
                ModelState.AddModelError(nameof(request.DiscountRate), "İndirim oranı 0 ile 100 arasında olmalıdır.");
                return ValidationProblem(ModelState);
            }
        }

        var cashAccountIds = (request.CashAccountIds ?? new List<int>())
            .Where(x => x > 0)
            .Distinct()
            .ToList();
        if (request.DefaultCashAccountId.HasValue && !cashAccountIds.Contains(request.DefaultCashAccountId.Value))
        {
            cashAccountIds.Add(request.DefaultCashAccountId.Value);
        }

        var bankAccountIds = (request.BankAccountIds ?? new List<int>())
            .Where(x => x > 0)
            .Distinct()
            .ToList();
        if (request.DefaultBankAccountId.HasValue && !bankAccountIds.Contains(request.DefaultBankAccountId.Value))
        {
            bankAccountIds.Add(request.DefaultBankAccountId.Value);
        }

        // BCRYPT SINIRI DOĞRULANIR (2026-08-20 kullanıcı kararı, denetim md. 16/C3).
        //
        // BCrypt parolanın ilk 72 BAYTINI hesaba katar, gerisini sessizce atar: 80 karakterlik
        // bir parolada son karakterler hiçbir şey ifade etmez ve kullanıcı onları yanlış yazsa
        // bile giriş açılır. Sessiz kırpma yerine açık hata veriliyor.
        if (PasswordHasher.ExceedsBcryptLimit(request.Password))
        {
            return BadRequest(new
            {
                success = false,
                message = $"Parola en fazla {PasswordHasher.MaxPasswordBytes} bayt olabilir (Türkçe karakterler 2 bayt sayılır). Lütfen daha kısa bir parola girin."
            });
        }

        var user = new User
        {
            Username = normalizedUsername,
            Mail = normalizedMail,
            Password = PasswordHasher.HashPassword(request.Password),
            FirmaCode = tenantCode,
            Unvan = normalizedUnvan,
            Gsm = request.Gsm?.Trim(),
            Carikodu = string.IsNullOrWhiteSpace(normalizedCarikodu) ? null : normalizedCarikodu,
            SalesmanCode = string.IsNullOrWhiteSpace(salesmanCode) ? null : salesmanCode,
            DefaultWarehouseCode = effectiveDefaultWarehouseCode,
            DefaultCashAccountId = cashAccountIds.FirstOrDefault(),
            DefaultBankAccountId = bankAccountIds.FirstOrDefault(),
            IsActive = request.IsActive,
            ServiceOpsAccess = request.ServiceOpsAccess,
            EmployeeAccess = request.EmployeeAccess,
            AsistanAccess = request.AsistanAccess,
            CariEkstreTipleri = B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.Serialize(request.CariEkstreTipleri),
            RoleId = request.RoleId,
            DiscountRate = request.DiscountRate,
            // Only a salesman account can be the customer-facing one. Accepting the flag on
            // any other role would put a non-salesman into the customer offer dropdown.
            IsCariPlasiyeri = request.RoleId == PlasiyerRoleId && request.IsCariPlasiyeri,
            CreateUser = User.Identity?.Name ?? "System",
            CreateTime = DateTime.UtcNow
        };

        if (request.RoleId == PlasiyerRoleId && !string.IsNullOrWhiteSpace(salesmanCode))
        {
            var exists = await _dbContext.Salesmen
                .AsNoTracking()
                .AnyAsync(x => x.SalesmanCode == salesmanCode, cancellationToken);

            if (!exists)
            {
                _dbContext.Salesmen.Add(new Salesman
                {
                    SalesmanCode = salesmanCode,
                    Description = normalizedUnvan,
                    CreateUser = User.Identity?.Name ?? "System",
                    CreateTime = DateTime.UtcNow
                });
            }
        }

        await _userRepository.AddAsync(user);

        if (!isTargetSuperAdmin && warehouseCodes.Count > 0)
        {
            var links = warehouseCodes.Select(code => new UserWarehouse { UserId = user.Id, WarehouseCode = code }).ToList();
            _dbContext.UserWarehouses.AddRange(links);
        }

        if (cashAccountIds.Count > 0)
        {
            var cashLinks = cashAccountIds.Select(cId => new UserCashAccount { UserId = user.Id, CashAccountId = cId }).ToList();
            _dbContext.UserCashAccounts.AddRange(cashLinks);
        }

        if (bankAccountIds.Count > 0)
        {
            var bankLinks = bankAccountIds.Select(bId => new UserBankAccount { UserId = user.Id, BankAccountId = bId }).ToList();
            _dbContext.UserBankAccounts.AddRange(bankLinks);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        var created = await _dbContext.Users
            .AsNoTracking()
            .Include(u => u.Role)
            .Include(u => u.UserWarehouses)
            .Include(u => u.UserCashAccounts)
            .Include(u => u.UserBankAccounts)
            .FirstOrDefaultAsync(u => u.Id == user.Id, cancellationToken);

        return Ok(new
        {
            success = true,
            message = "Kullanıcı oluşturuldu",
            data = created == null ? null : ToResponse(created, includePassword: false)
        });
    }

    [AtomicRequest]
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateUserRequest request, CancellationToken cancellationToken)
    {
        var tenantCode = ResolveTenantCodeFromRequest();

        var user = await _dbContext.Users
            .Include(u => u.Role)
            .Include(u => u.UserWarehouses)
            .Include(u => u.UserCashAccounts)
            .Include(u => u.UserBankAccounts)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (user is null)
        {
            return NotFound(new { success = false, message = "Kullanıcı bulunamadı" });
        }

        var normalizedUsername = request.Username.Trim();
        if (normalizedUsername.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Username), "Username is required.");
        }

        var normalizedMail = request.Mail.Trim();
        if (normalizedMail.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Mail), "Mail is required.");
        }

        var normalizedUnvan = request.Unvan.Trim();
        if (normalizedUnvan.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Unvan), "Unvan is required.");
        }

        var normalizedCarikodu = request.Carikodu?.Trim();

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // The scope may list several customers, so every code in it is checked. It used to be
        // compared as a single code, which rejected any multi-customer selection outright.
        var scopeCodes = CustomerScope.Parse(normalizedCarikodu);
        if (scopeCodes.Count > 0)
        {
            var knownCount = await _dbContext.Customers
                .AsNoTracking()
                .CountAsync(x => scopeCodes.Contains(x.CustomerCode), cancellationToken);

            if (knownCount != scopeCodes.Count)
            {
                ModelState.AddModelError(nameof(request.Carikodu), "Carikodu is invalid.");
                return ValidationProblem(ModelState);
            }
        }

        var usernameExists = await _dbContext.Users
            .AsNoTracking()
            .AnyAsync(x => x.Id != id && x.Username == normalizedUsername, cancellationToken);

        if (usernameExists)
        {
            ModelState.AddModelError(nameof(request.Username), "Username must be unique.");
            return ValidationProblem(ModelState);
        }

        var mailExists = await _dbContext.Users
            .AsNoTracking()
            .AnyAsync(x => x.Id != id && x.Mail == normalizedMail, cancellationToken);

        if (mailExists)
        {
            ModelState.AddModelError(nameof(request.Mail), "Mail must be unique.");
            return ValidationProblem(ModelState);
        }

        var roleExists = await _dbContext.Roles
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.RoleId, cancellationToken);

        if (!roleExists)
        {
            ModelState.AddModelError(nameof(request.RoleId), "RoleId is invalid.");
            return ValidationProblem(ModelState);
        }

        var targetRole = await _dbContext.Roles
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == request.RoleId, cancellationToken);

        if (targetRole is null)
        {
            ModelState.AddModelError(nameof(request.RoleId), "RoleId is invalid.");
            return ValidationProblem(ModelState);
        }

        var isTargetSuperAdmin = targetRole.IsSuperAdmin;
        if (isTargetSuperAdmin)
        {
            var tenantId = await ResolveTenantIdAsync(cancellationToken);
            if (tenantId.HasValue)
            {
                await EnsureSuperAdminRoleHasEnabledPagesAsync(targetRole.Id, tenantId.Value, cancellationToken);
            }
        }
        var warehouseCodes = NormalizeWarehouseCodes(request.WarehouseCodes);

        if (!isTargetSuperAdmin)
        {


            var requestedDefault = request.DefaultWarehouseCode;
            if (requestedDefault.HasValue && requestedDefault.Value != 0 && !warehouseCodes.Contains(requestedDefault.Value))
            {
                ModelState.AddModelError(nameof(request.DefaultWarehouseCode), "Varsayılan depo, kullanıcının yetkili olduğu depolar arasından seçilmelidir");
                return ValidationProblem(ModelState);
            }

            var existing = await _dbContext.Set<Warehouse>()
                .AsNoTracking()
                .Where(x => x.IsActive && warehouseCodes.Contains(x.WarehouseCode))
                .Select(x => x.WarehouseCode)
                .ToListAsync(cancellationToken);

            if (existing.Count != warehouseCodes.Count)
            {
                ModelState.AddModelError(nameof(request.WarehouseCodes), "Depo seçimi geçersiz");
                return ValidationProblem(ModelState);
            }
        }

        if (request.RoleId == PlasiyerRoleId)
        {
            if (!request.DiscountRate.HasValue || request.DiscountRate.Value < 0 || request.DiscountRate.Value > 100)
            {
                ModelState.AddModelError(nameof(request.DiscountRate), "Plasiyer rolü için indirim oranı zorunludur ve 0 ile 100 arasında olmalıdır.");
                return ValidationProblem(ModelState);
            }
        }
        else
        {
            if (request.DiscountRate.HasValue && (request.DiscountRate.Value < 0 || request.DiscountRate.Value > 100))
            {
                ModelState.AddModelError(nameof(request.DiscountRate), "İndirim oranı 0 ile 100 arasında olmalıdır.");
                return ValidationProblem(ModelState);
            }
        }

        var cashAccountIds = (request.CashAccountIds ?? new List<int>())
            .Where(x => x > 0)
            .Distinct()
            .ToList();
        if (request.DefaultCashAccountId.HasValue && !cashAccountIds.Contains(request.DefaultCashAccountId.Value))
        {
            cashAccountIds.Add(request.DefaultCashAccountId.Value);
        }

        var bankAccountIds = (request.BankAccountIds ?? new List<int>())
            .Where(x => x > 0)
            .Distinct()
            .ToList();
        if (request.DefaultBankAccountId.HasValue && !bankAccountIds.Contains(request.DefaultBankAccountId.Value))
        {
            bankAccountIds.Add(request.DefaultBankAccountId.Value);
        }

        // YETKİ/KAPSAM DEĞİŞTİYSE OTURUM DÜŞÜRÜLÜR (2026-08-19 kullanıcı kararı, denetim md. 12).
        //
        // JWT claim'leri token üretildiği andaki rolü, cari kodunu, plasiyerini ve varsayılan
        // deposunu taşır; kullanıcı başka bir cariye alınsa bile token süresi dolana kadar ESKİ
        // kapsamla çalışmaya devam ediyordu. Değişiklikten SONRA ortak oturumu iptal ediyoruz,
        // kullanıcı bir sonraki istekte yeniden giriş yapıyor ve claim'ler tazeleniyor.
        var previousUsername = user.Username;
        var previousRoleId = user.RoleId;
        var previousCarikodu = user.Carikodu;
        var previousSalesmanCode = user.SalesmanCode;
        // Süper adminde varsayılan depo YETKİ listesinden değil, aktif depolar arasından seçilir.
        var effectiveDefaultWarehouseCode = isTargetSuperAdmin
            ? await ResolveSuperAdminDefaultWarehouseCodeAsync(request.DefaultWarehouseCode, cancellationToken)
            : ResolveDefaultWarehouseCode(request.DefaultWarehouseCode, warehouseCodes);

        if (isTargetSuperAdmin
            && request.DefaultWarehouseCode.HasValue
            && request.DefaultWarehouseCode.Value != 0
            && !effectiveDefaultWarehouseCode.HasValue)
        {
            ModelState.AddModelError(nameof(request.DefaultWarehouseCode), "Varsayılan depo bulunamadı veya pasif");
            return ValidationProblem(ModelState);
        }

        var previousWarehouse = user.DefaultWarehouseCode;
        var previousIsActive = user.IsActive;

        user.Username = normalizedUsername;
        user.Mail = normalizedMail;
        if (!string.IsNullOrWhiteSpace(tenantCode))
        {
            user.FirmaCode = tenantCode;
        }
        user.Unvan = normalizedUnvan;
        user.Gsm = request.Gsm?.Trim();
        user.Carikodu = string.IsNullOrWhiteSpace(normalizedCarikodu) ? null : normalizedCarikodu;
        var salesmanCode = request.SalesmanCode?.Trim();
        user.SalesmanCode = string.IsNullOrWhiteSpace(salesmanCode) ? null : salesmanCode;
        user.DefaultWarehouseCode = effectiveDefaultWarehouseCode;
        user.DefaultCashAccountId = cashAccountIds.FirstOrDefault();
        user.DefaultBankAccountId = bankAccountIds.FirstOrDefault();
        user.IsActive = request.IsActive;
        user.ServiceOpsAccess = request.ServiceOpsAccess;
        user.EmployeeAccess = request.EmployeeAccess;
        user.AsistanAccess = request.AsistanAccess;
        // Alanı göndermeyen ekranlar (Tüm Kullanıcılar, Proje Yönetimi) kısıtlamayı silmesin: null = dokunma, [] = hepsi.
        if (request.CariEkstreTipleri is not null) user.CariEkstreTipleri = B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.Serialize(request.CariEkstreTipleri);
        user.RoleId = request.RoleId;
        user.DiscountRate = request.DiscountRate;
        user.IsCariPlasiyeri = request.RoleId == PlasiyerRoleId && request.IsCariPlasiyeri;
        user.UpdatedAt = DateTime.UtcNow;
        user.EditUser = User.Identity?.Name;
        user.EditTime = DateTime.UtcNow;

        // Replace warehouse assignments.
        _dbContext.UserWarehouses.RemoveRange(user.UserWarehouses);
        if (!isTargetSuperAdmin && warehouseCodes.Count > 0)
        {
            var links = warehouseCodes.Select(code => new UserWarehouse { UserId = user.Id, WarehouseCode = code }).ToList();
            _dbContext.UserWarehouses.AddRange(links);
        }

        // Replace cash account assignments.
        _dbContext.UserCashAccounts.RemoveRange(user.UserCashAccounts);
        if (cashAccountIds.Count > 0)
        {
            var cashLinks = cashAccountIds.Select(cId => new UserCashAccount { UserId = user.Id, CashAccountId = cId }).ToList();
            _dbContext.UserCashAccounts.AddRange(cashLinks);
        }

        // Replace bank account assignments.
        _dbContext.UserBankAccounts.RemoveRange(user.UserBankAccounts);
        if (bankAccountIds.Count > 0)
        {
            var bankLinks = bankAccountIds.Select(bId => new UserBankAccount { UserId = user.Id, BankAccountId = bId }).ToList();
            _dbContext.UserBankAccounts.AddRange(bankLinks);
        }

        if (request.RoleId == PlasiyerRoleId && !string.IsNullOrWhiteSpace(salesmanCode))
        {
            var exists = await _dbContext.Salesmen
                .AsNoTracking()
                .AnyAsync(x => x.SalesmanCode == salesmanCode, cancellationToken);

            if (!exists)
            {
                _dbContext.Salesmen.Add(new Salesman
                {
                    SalesmanCode = salesmanCode,
                    Description = normalizedUnvan,
                    CreateUser = User.Identity?.Name ?? "System",
                    CreateTime = DateTime.UtcNow
                });
            }
        }

        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            if (PasswordHasher.ExceedsBcryptLimit(request.Password))
            {
                return BadRequest(new
                {
                    success = false,
                    message = $"Parola en fazla {PasswordHasher.MaxPasswordBytes} bayt olabilir (Türkçe karakterler 2 bayt sayılır). Lütfen daha kısa bir parola girin."
                });
            }

            user.Password = PasswordHasher.HashPassword(request.Password);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Kapsamı belirleyen alanlardan biri değiştiyse (ya da kullanıcı pasife alındıysa)
        // açık oturum kapatılır. Oturum deposuna yazamamak güncellemeyi geri almamalı:
        // kullanıcı kaydı zaten doğru, en kötü ihtimalle oturum token süresi kadar yaşar.
        var scopeChanged =
            previousRoleId != user.RoleId
            || !string.Equals(previousCarikodu ?? string.Empty, user.Carikodu ?? string.Empty, StringComparison.Ordinal)
            || !string.Equals(previousSalesmanCode ?? string.Empty, user.SalesmanCode ?? string.Empty, StringComparison.Ordinal)
            || previousWarehouse != user.DefaultWarehouseCode
            || (previousIsActive && !user.IsActive);

        if (scopeChanged)
        {
            try
            {
                await _sharedSessions.RevokeAsync(tenantCode, previousUsername, cancellationToken);
                if (!string.Equals(previousUsername, user.Username, StringComparison.OrdinalIgnoreCase))
                {
                    await _sharedSessions.RevokeAsync(tenantCode, user.Username, cancellationToken);
                }
            }
            catch
            {
                // Oturum kapatma başarısız olsa bile kullanıcı güncellemesi geçerlidir.
            }
        }

        // PASİFE ALINAN KULLANICININ YENİLEME TOKEN'LARI DA İPTAL EDİLİR (denetim md. 43).
        //
        // Ortak oturumu kapatmak erişim token'ını keser ama `RefreshTokens` tablosundaki
        // kayıtlar duruyordu: işten çıkarılıp hesabı pasife alınan personel, elindeki yenileme
        // token'ıyla süresi dolana kadar (7 gün) yeni erişim token'ı üretmeye devam
        // edebiliyordu. Pasife alma anında bütün aktif yenileme token'ları damgalanıyor.
        if (previousIsActive && !user.IsActive)
        {
            try
            {
                var activeTokens = await _dbContext.RefreshTokens
                    .Where(x => x.UserId == user.Id && x.RevokedAt == null)
                    .ToListAsync(cancellationToken);

                if (activeTokens.Count > 0)
                {
                    var revokedAt = DateTime.UtcNow;
                    foreach (var t in activeTokens)
                    {
                        t.RevokedAt = revokedAt;
                        t.IsRevoked = true;
                        t.RevokedByIp = "user-deactivated";
                    }

                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
            }
            catch
            {
                // Token iptali başarısız olsa bile kullanıcı pasife alınmış durumda kalır.
            }
        }

        var updated = await _dbContext.Users
            .AsNoTracking()
            .Include(u => u.Role)
            .Include(u => u.UserWarehouses)
            .Include(u => u.UserCashAccounts)
            .Include(u => u.UserBankAccounts)
            .FirstOrDefaultAsync(u => u.Id == id, cancellationToken);

        return Ok(new
        {
            success = true,
            message = "Kullanıcı güncellendi",
            data = updated == null ? null : ToResponse(updated, includePassword: false)
        });
    }

    private string? ResolveTenantCodeFromRequest()
    {
        if (Request.Headers.TryGetValue("X-Tenant-Code", out var codeValues))
        {
            var code = codeValues.ToString();
            if (!string.IsNullOrWhiteSpace(code))
            {
                return code.Trim().ToUpperInvariant();
            }
        }

        return null;
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var user = await _dbContext.Users
            .Include(x => x.Role)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (user is null)
        {
            return NotFound(new { success = false, message = "Kullanıcı bulunamadı" });
        }

        if (id == 1 || user.Role?.IsSuperAdmin == true)
        {
            return BadRequest(new { success = false, message = "SuperAdmin kullanıcı silinemez" });
        }

        if (user.RoleId == PlasiyerRoleId && !string.IsNullOrWhiteSpace(user.SalesmanCode))
        {
            var salesman = await _dbContext.Salesmen
                .FirstOrDefaultAsync(x => x.SalesmanCode == user.SalesmanCode, cancellationToken);

            if (salesman is not null)
            {
                _dbContext.Salesmen.Remove(salesman);
            }
        }

        _dbContext.Users.Remove(user);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            message = "Kullanıcı silindi"
        });
    }

    /// <summary>
    /// NEGATİF DEPO KODU GEÇERLİDİR — filtre bu yüzden <c>!= 0</c>, <c>&gt; 0</c> değil.
    ///
    /// Kaynak ERP sipariş/sanal depolarını negatif kodla tutuyor (ör. <c>-21 YP SİPARİŞ</c>).
    /// Eski <c>&gt; 0</c> filtresi bu depoları sessizce düşürüyordu: ekran depoyu listeliyor,
    /// kullanıcı seçiyor, kaydet "başarılı" diyor ama yetki hiç yazılmıyordu. Sıfır hâlâ elenir;
    /// o "kod atanmamış" demektir.
    /// </summary>
    private static List<int> NormalizeWarehouseCodes(IEnumerable<int>? codes)
        => (codes ?? Array.Empty<int>())
            .Where(x => x != 0)
            .Distinct()
            .ToList();

    /// <summary>
    /// Kullanıcının VARSAYILAN deposu (kullanıcı kuralı, 2026-08-14).
    ///
    /// Satış faturası ekranı, kalemi giren kişinin bu deposunu kalemin öntanımlı çıkış deposu
    /// yapıyor (bkz. <c>SalesOrdersController.FillDefaultWarehousesAsync</c>). Seçim yapılmadıysa
    /// tek depo yetkisi varsa o depoya düşülür; birden fazla depo varsa TAHMİN EDİLMEZ, null
    /// kalır ve ekran sorar. Eskiden burada <c>warehouseCodes.FirstOrDefault()</c> vardı: liste
    /// koda göre sıralı geldiği için herkesin varsayılanı en küçük kodlu depo oluyordu.
    /// </summary>
    private static int? ResolveDefaultWarehouseCode(int? requested, List<int> warehouseCodes)
    {
        if (requested.HasValue && requested.Value != 0 && warehouseCodes.Contains(requested.Value))
        {
            return requested.Value;
        }

        return warehouseCodes.Count == 1 ? warehouseCodes[0] : (int?)null;
    }

    /// <summary>
    /// SÜPER ADMİNİN VARSAYILAN DEPOSU (2026-08-20, kullanıcı isteği).
    ///
    /// Süper adminin depo YETKİ listesi yoktur — zaten hepsine erişir. Bu yüzden
    /// <see cref="ResolveDefaultWarehouseCode"/> ondan boş liste alıp her seferinde null
    /// dönüyor, alan veritabanında hep boş kalıyordu; kayıt yolunda da açıkça
    /// <c>isTargetSuperAdmin ? null</c> diye siliniyordu. Sonuç: satış faturası ekranı süper
    /// adminde kalemin çıkış deposunu öntanımlayamıyor, depo her satırda elle seçiliyordu
    /// (bkz. SalesOrdersController.FillDefaultWarehousesAsync).
    ///
    /// Kural yetki listesi değil, deponun AKTİF olmasıdır. Pasif bir depoyu öntanımlı yapmak,
    /// ekranda seçili görünüp kaydederken reddedilen bir alan demek olurdu — aynı gerekçe
    /// PrivilegedDefaultWarehouse için de yazılı.
    ///
    /// SSA buraya UĞRAMAZ: onun kiracıda Users satırı yok, deposu adıyla çözülüyor.
    /// </summary>
    private async Task<int?> ResolveSuperAdminDefaultWarehouseCodeAsync(int? requested, CancellationToken cancellationToken)
    {
        if (!requested.HasValue || requested.Value == 0) return null;

        var isActiveWarehouse = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .AnyAsync(x => x.IsActive && x.WarehouseCode == requested.Value, cancellationToken);

        return isActiveWarehouse ? requested.Value : (int?)null;
    }

    private bool GetRequesterIsSuperAdmin()
    {
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        return isSuperAdmin || isSsa;
    }

    private static UserResponse ToResponse(User user, bool includePassword = false)
    {
        var warehouseCodes = user.UserWarehouses
            .Select(x => x.WarehouseCode)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        var cashAccountIds = user.UserCashAccounts
            .Select(x => x.CashAccountId)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        var bankAccountIds = user.UserBankAccounts
            .Select(x => x.BankAccountId)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        return new UserResponse
        {
            Id = user.Id,
            Username = user.Username,
            Mail = user.Mail,
            Password = null,
            Unvan = user.Unvan,
            Gsm = user.Gsm,
            Carikodu = user.Carikodu,
            CariAdi = null,
            SalesmanCode = user.SalesmanCode,
            DefaultWarehouseCode = user.DefaultWarehouseCode,
            DefaultCashAccountId = user.DefaultCashAccountId,
            DefaultBankAccountId = user.DefaultBankAccountId,
            WarehouseCodes = warehouseCodes,
            CashAccountIds = cashAccountIds,
            BankAccountIds = bankAccountIds,
            IsActive = user.IsActive,
            ServiceOpsAccess = user.ServiceOpsAccess,
            EmployeeAccess = user.EmployeeAccess,
            AsistanAccess = user.AsistanAccess,
            CariEkstreTipleri = B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.Parse(user.CariEkstreTipleri),
            RoleId = user.RoleId,
            RoleName = user.Role?.Name ?? string.Empty,
            RoleCode = user.Role?.Code ?? string.Empty,
            CreatedAt = user.CreateTime,
            UpdatedAt = user.UpdatedAt,
            LastLoginAt = user.LastLoginAt,
            DiscountRate = user.DiscountRate,
            IsCariPlasiyeri = user.IsCariPlasiyeri
        };
    }

    private static UserResponse ToResponse(User user, string? roleName, string? roleCode, string? cariAdi, List<int> warehouseCodes, List<int> cashAccountIds, List<int> bankAccountIds)
    {
        return new UserResponse
        {
            Id = user.Id,
            Username = user.Username,
            Mail = user.Mail,
            Password = null,
            Unvan = user.Unvan,
            Gsm = user.Gsm,
            Carikodu = user.Carikodu,
            CariAdi = cariAdi,
            SalesmanCode = user.SalesmanCode,
            DefaultWarehouseCode = user.DefaultWarehouseCode,
            DefaultCashAccountId = user.DefaultCashAccountId,
            DefaultBankAccountId = user.DefaultBankAccountId,
            WarehouseCodes = warehouseCodes.OrderBy(x => x).ToList(),
            CashAccountIds = cashAccountIds.OrderBy(x => x).ToList(),
            BankAccountIds = bankAccountIds.OrderBy(x => x).ToList(),
            IsActive = user.IsActive,
            ServiceOpsAccess = user.ServiceOpsAccess,
            EmployeeAccess = user.EmployeeAccess,
            AsistanAccess = user.AsistanAccess,
            CariEkstreTipleri = B2B.Erp.Api.Core.Helpers.CariEkstreKapsami.Parse(user.CariEkstreTipleri),
            RoleId = user.RoleId,
            RoleName = roleName ?? string.Empty,
            RoleCode = roleCode ?? string.Empty,
            CreatedAt = user.CreateTime,
            UpdatedAt = user.UpdatedAt,
            LastLoginAt = user.LastLoginAt,
            DiscountRate = user.DiscountRate,
            IsCariPlasiyeri = user.IsCariPlasiyeri
        };
    }
}
