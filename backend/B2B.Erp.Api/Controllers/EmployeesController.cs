using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Core.Security;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("employee", "calisan")]
public sealed class EmployeesController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    private const string EmployeeCodePrefix = "335-01-";

    public EmployeesController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public sealed class UpsertEmployeeRequest
    {
        public string? EmployeeCode { get; set; }

        [StringLength(100)]
        public string? Username { get; set; }

        [StringLength(100)]
        public string? Password { get; set; }

        [Required]
        [StringLength(100)]
        public string FirstName { get; set; } = string.Empty;

        [Required]
        [StringLength(100)]
        public string LastName { get; set; } = string.Empty;

        [Required]
        [StringLength(200)]
        public string Mail { get; set; } = string.Empty;

        [Required]
        [StringLength(20)]
        public string Tc { get; set; } = string.Empty;

        [Required]
        [StringLength(30)]
        public string Phone { get; set; } = string.Empty;

        [Required]
        [StringLength(30)]
        public string TaxNo { get; set; } = string.Empty;

        [Required]
        [StringLength(100)]
        public string TaxOffice { get; set; } = string.Empty;

        [StringLength(120)]
        public string? BankName { get; set; }

        [StringLength(34)]
        public string? Iban { get; set; }

        public DateTime? HireDate { get; set; }

        public DateTime? WorkPermitDay { get; set; }

        public decimal WorkPermitRenewalFee { get; set; }

        /// <summary>Maas KURUS tasir (denetim md. A6) — `int` degil.</summary>
        public decimal Salary { get; set; }

        public int SalaryDay { get; set; } = 1;

        public decimal MealAmount { get; set; }

        [StringLength(80)]
        public string? WorkType { get; set; }

        public bool IsActive { get; set; } = true;
    }

    public sealed class NextEmployeeCodeResponse
    {
        public string EmployeeCode { get; set; } = string.Empty;
    }

    private static long ParseLast6DigitsOrZero(string code, string prefix)
    {
        var s = (code ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(prefix) || !s.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return 0;
        var suffix = s.Substring(prefix.Length);
        if (suffix.Length != 6) return 0;
        return long.TryParse(suffix, out var n) ? n : 0;
    }

    private async Task<string> ReserveNextEmployeeCode(CancellationToken cancellationToken)
    {
        await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

        var seriesKey = $"employee:{EmployeeCodePrefix.TrimEnd('-')}";
        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        var existingCodes = await _dbContext.Set<Employee>()
            .AsNoTracking()
            .Where(x => x.EmployeeCode.StartsWith(EmployeeCodePrefix))
            .Select(x => x.EmployeeCode)
            .ToListAsync(cancellationToken);

        var maxExisting = existingCodes.Count == 0 ? 0 : existingCodes.Max(c => ParseLast6DigitsOrZero(c, EmployeeCodePrefix));

        if (series is null)
        {
            series = new NumberSeries
            {
                Key = seriesKey,
                LastValue = maxExisting
            };

            _dbContext.NumberSeries.Add(series);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        else if (series.LastValue < maxExisting)
        {
            series.LastValue = maxExisting;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        series.LastValue += 1;
        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return EmployeeCodePrefix + series.LastValue.ToString("D6");
    }

    [HttpGet("next-code")]
    public async Task<IActionResult> GetNextCode(CancellationToken cancellationToken = default)
    {
        // Preview only: do NOT increment series here (modal open should not consume numbers).
        var seriesKey = $"employee:{EmployeeCodePrefix.TrimEnd('-')}";
        var seriesLast = await _dbContext.NumberSeries
            .AsNoTracking()
            .Where(x => x.Key == seriesKey)
            .Select(x => (long?)x.LastValue)
            .FirstOrDefaultAsync(cancellationToken);

        var existingCodes = await _dbContext.Set<Employee>()
            .AsNoTracking()
            .Where(x => x.EmployeeCode.StartsWith(EmployeeCodePrefix))
            .Select(x => x.EmployeeCode)
            .ToListAsync(cancellationToken);

        var maxExisting = existingCodes.Count == 0 ? 0 : existingCodes.Max(c => ParseLast6DigitsOrZero(c, EmployeeCodePrefix));
        var last = Math.Max(seriesLast ?? 0, maxExisting);
        var nextCode = EmployeeCodePrefix + (last + 1).ToString("D6");

        return Ok(new { success = true, data = new NextEmployeeCodeResponse { EmployeeCode = nextCode } });
    }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] bool includeInactive = false, CancellationToken cancellationToken = default)
    {
        var q = _dbContext.Set<Employee>()
            .AsNoTracking();

        if (!includeInactive)
        {
            q = q.Where(x => x.IsActive);
        }

        var data = await q
            .OrderByDescending(x => x.Id)
            .Select(x => new
            {
                id = x.Id,
                employeeCode = x.EmployeeCode,
                username = x.Username,
                // Sifre HASH'i istemciye gonderilmez. Liste ucu hash'i JSON icinde disari
                // veriyordu; tarayici konsolundan ya da aradaki her katmandan okunabiliyordu.
                password = (string?)null,
                firstName = x.FirstName,
                lastName = x.LastName,
                mail = x.Mail,
                tc = x.Tc,
                phone = x.Phone,
                taxNo = x.TaxNo,
                taxOffice = x.TaxOffice,
                bankName = x.BankName,
                iban = x.Iban,
                hireDate = x.HireDate,
                workPermitDay = x.WorkPermitDay,
                workPermitRenewalFee = x.WorkPermitRenewalFee,
                salary = x.Salary,
                salaryDay = x.SalaryDay,
                mealAmount = x.MealAmount,
                workType = x.WorkType,
                isActive = x.IsActive,
                createTime = x.CreateTime,
                createUser = x.CreateUser,
                editTime = x.EditTime,
                editUser = x.EditUser
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpGet("work-types")]
    public async Task<IActionResult> GetWorkTypes(CancellationToken cancellationToken = default)
    {
        var types = await _dbContext.Set<Employee>()
            .AsNoTracking()
            .Select(x => x.WorkType)
            .Where(x => x != null && x != "")
            .Distinct()
            .OrderBy(x => x)
            .ToListAsync(cancellationToken);

        var data = types
            .Select(x => x!.Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        return Ok(new { success = true, data });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] UpsertEmployeeRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var employeeCode = (request.EmployeeCode ?? string.Empty).Trim();
        var firstName = (request.FirstName ?? string.Empty).Trim();
        var lastName = (request.LastName ?? string.Empty).Trim();
        var mail = (request.Mail ?? string.Empty).Trim();
        var tc = (request.Tc ?? string.Empty).Trim();
        var phone = (request.Phone ?? string.Empty).Trim();
        var taxNo = (request.TaxNo ?? string.Empty).Trim();
        var taxOffice = (request.TaxOffice ?? string.Empty).Trim();
        var bankName = (request.BankName ?? string.Empty).Trim();
        var iban = (request.Iban ?? string.Empty).Trim();
        var username = (request.Username ?? string.Empty).Trim();
        var password = (request.Password ?? string.Empty).Trim();
        var hireDate = request.HireDate;
        var workPermitDay = request.WorkPermitDay;
        var workPermitRenewalFee = request.WorkPermitRenewalFee;
        // Kolon numeric(18,2): 2 basamaktan fazlasi VERITABANINDA yuvarlanirdi. Burada
        // yuvarlanir ki dogrulanan tutar ile yazilan tutar ayni olsun.
        var salary = Math.Round(request.Salary, 2, MidpointRounding.AwayFromZero);
        var salaryDay = request.SalaryDay;
        var mealAmount = request.MealAmount;
        var workType = (request.WorkType ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(firstName)) ModelState.AddModelError(nameof(request.FirstName), "FirstName is required.");
        if (string.IsNullOrWhiteSpace(lastName)) ModelState.AddModelError(nameof(request.LastName), "LastName is required.");
        if (string.IsNullOrWhiteSpace(mail)) ModelState.AddModelError(nameof(request.Mail), "Mail is required.");
        if (string.IsNullOrWhiteSpace(tc)) ModelState.AddModelError(nameof(request.Tc), "Tc is required.");
        if (string.IsNullOrWhiteSpace(phone)) ModelState.AddModelError(nameof(request.Phone), "Phone is required.");
        if (string.IsNullOrWhiteSpace(taxNo)) ModelState.AddModelError(nameof(request.TaxNo), "TaxNo is required.");
        if (string.IsNullOrWhiteSpace(taxOffice)) ModelState.AddModelError(nameof(request.TaxOffice), "TaxOffice is required.");

        if (salary < 0) ModelState.AddModelError(nameof(request.Salary), "Salary must be >= 0.");
        if (salaryDay < 1 || salaryDay > 31) ModelState.AddModelError(nameof(request.SalaryDay), "SalaryDay must be between 1 and 31.");
        if (mealAmount < 0) ModelState.AddModelError(nameof(request.MealAmount), "MealAmount must be >= 0.");
        if (workPermitRenewalFee < 0) ModelState.AddModelError(nameof(request.WorkPermitRenewalFee), "WorkPermitRenewalFee must be >= 0.");

        if (workType.Length > 80) ModelState.AddModelError(nameof(request.WorkType), "WorkType is too long.");

        // BCRYPT 72 BAYT SINIRI (denetim md. C3). BCrypt fazlasını SESSİZCE atar: uzun bir
        // parolanın sonundaki karakterler hiçbir şey ifade etmez ve personel onları yanlış
        // yazsa bile portala girer. Sessiz kırpma yerine açık hata. Düzenlemede parola boş
        // gelirse mevcut parolaya dokunulmuyor, o yüzden yalnız dolu geldiğinde bakılır.
        if (PasswordHasher.ExceedsBcryptLimit(password))
        {
            ModelState.AddModelError(
                nameof(request.Password),
                $"Parola en fazla {PasswordHasher.MaxPasswordBytes} bayt olabilir (Türkçe karakterler 2 bayt sayılır).");
        }

        if (!string.IsNullOrWhiteSpace(username))
        {
            var usernameExists = await _dbContext.Set<Employee>()
                .AsNoTracking()
                .AnyAsync(x => x.Username != null && x.Username == username, cancellationToken);

            if (usernameExists)
            {
                ModelState.AddModelError(nameof(request.Username), "Username zaten mevcut");
            }
        }

        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var exists = await _dbContext.Set<Employee>()
            .AsNoTracking()
            .AnyAsync(x => x.Tc == tc, cancellationToken);

        if (exists)
        {
            return Conflict(new { success = false, message = "TC zaten mevcut" });
        }

        if (string.IsNullOrWhiteSpace(employeeCode))
        {
            employeeCode = await ReserveNextEmployeeCode(cancellationToken);
        }

        var employeeCodeExists = await _dbContext.Set<Employee>()
            .AsNoTracking()
            .AnyAsync(x => x.EmployeeCode == employeeCode, cancellationToken);

        if (employeeCodeExists)
        {
            employeeCode = await ReserveNextEmployeeCode(cancellationToken);
        }

        var now = DateTime.UtcNow;
        var entity = new Employee
        {
            EmployeeCode = employeeCode,
            Username = string.IsNullOrWhiteSpace(username) ? null : username,
            Password = string.IsNullOrWhiteSpace(password) ? null : PasswordHasher.HashPassword(password),
            FirstName = firstName,
            LastName = lastName,
            Mail = mail,
            Tc = tc,
            Phone = phone,
            TaxNo = taxNo,
            TaxOffice = taxOffice,
            BankName = string.IsNullOrWhiteSpace(bankName) ? null : bankName,
            Iban = string.IsNullOrWhiteSpace(iban) ? null : iban,
            HireDate = hireDate.HasValue ? DateTime.SpecifyKind(hireDate.Value.Date, DateTimeKind.Utc) : null,
            WorkPermitDay = workPermitDay.HasValue ? DateTime.SpecifyKind(workPermitDay.Value.Date, DateTimeKind.Utc) : null,
            WorkPermitRenewalFee = Math.Max(0m, workPermitRenewalFee),
            Salary = salary,
            SalaryDay = salaryDay,
            MealAmount = mealAmount,
            WorkType = string.IsNullOrWhiteSpace(workType) ? null : workType,
            IsActive = request.IsActive,
            CreateUser = User.Identity?.Name ?? "System",
            CreateTime = now
        };

        _dbContext.Set<Employee>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = entity.Id } });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] UpsertEmployeeRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var entity = await _dbContext.Set<Employee>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        var employeeCode = (request.EmployeeCode ?? string.Empty).Trim();
        var firstName = (request.FirstName ?? string.Empty).Trim();
        var lastName = (request.LastName ?? string.Empty).Trim();
        var mail = (request.Mail ?? string.Empty).Trim();
        var tc = (request.Tc ?? string.Empty).Trim();
        var phone = (request.Phone ?? string.Empty).Trim();
        var taxNo = (request.TaxNo ?? string.Empty).Trim();
        var taxOffice = (request.TaxOffice ?? string.Empty).Trim();
        var bankName = (request.BankName ?? string.Empty).Trim();
        var iban = (request.Iban ?? string.Empty).Trim();
        var username = (request.Username ?? string.Empty).Trim();
        var password = (request.Password ?? string.Empty).Trim();
        var hireDate = request.HireDate;
        var workPermitDay = request.WorkPermitDay;
        var workPermitRenewalFee = request.WorkPermitRenewalFee;
        // Kolon numeric(18,2): 2 basamaktan fazlasi VERITABANINDA yuvarlanirdi. Burada
        // yuvarlanir ki dogrulanan tutar ile yazilan tutar ayni olsun.
        var salary = Math.Round(request.Salary, 2, MidpointRounding.AwayFromZero);
        var salaryDay = request.SalaryDay;
        var mealAmount = request.MealAmount;
        var workType = (request.WorkType ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(firstName)) ModelState.AddModelError(nameof(request.FirstName), "FirstName is required.");
        if (string.IsNullOrWhiteSpace(lastName)) ModelState.AddModelError(nameof(request.LastName), "LastName is required.");
        if (string.IsNullOrWhiteSpace(mail)) ModelState.AddModelError(nameof(request.Mail), "Mail is required.");
        if (string.IsNullOrWhiteSpace(tc)) ModelState.AddModelError(nameof(request.Tc), "Tc is required.");
        if (string.IsNullOrWhiteSpace(phone)) ModelState.AddModelError(nameof(request.Phone), "Phone is required.");
        if (string.IsNullOrWhiteSpace(taxNo)) ModelState.AddModelError(nameof(request.TaxNo), "TaxNo is required.");
        if (string.IsNullOrWhiteSpace(taxOffice)) ModelState.AddModelError(nameof(request.TaxOffice), "TaxOffice is required.");

        if (salary < 0) ModelState.AddModelError(nameof(request.Salary), "Salary must be >= 0.");
        if (salaryDay < 1 || salaryDay > 31) ModelState.AddModelError(nameof(request.SalaryDay), "SalaryDay must be between 1 and 31.");
        if (mealAmount < 0) ModelState.AddModelError(nameof(request.MealAmount), "MealAmount must be >= 0.");
        if (workPermitRenewalFee < 0) ModelState.AddModelError(nameof(request.WorkPermitRenewalFee), "WorkPermitRenewalFee must be >= 0.");

        if (workType.Length > 80) ModelState.AddModelError(nameof(request.WorkType), "WorkType is too long.");

        // BCRYPT 72 BAYT SINIRI (denetim md. C3). BCrypt fazlasını SESSİZCE atar: uzun bir
        // parolanın sonundaki karakterler hiçbir şey ifade etmez ve personel onları yanlış
        // yazsa bile portala girer. Sessiz kırpma yerine açık hata. Düzenlemede parola boş
        // gelirse mevcut parolaya dokunulmuyor, o yüzden yalnız dolu geldiğinde bakılır.
        if (PasswordHasher.ExceedsBcryptLimit(password))
        {
            ModelState.AddModelError(
                nameof(request.Password),
                $"Parola en fazla {PasswordHasher.MaxPasswordBytes} bayt olabilir (Türkçe karakterler 2 bayt sayılır).");
        }

        if (!string.IsNullOrWhiteSpace(username))
        {
            var usernameExists = await _dbContext.Set<Employee>()
                .AsNoTracking()
                .AnyAsync(x => x.Id != id && x.Username != null && x.Username == username, cancellationToken);

            if (usernameExists)
            {
                ModelState.AddModelError(nameof(request.Username), "Username zaten mevcut");
            }
        }

        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var tcExists = await _dbContext.Set<Employee>()
            .AsNoTracking()
            .AnyAsync(x => x.Id != id && x.Tc == tc, cancellationToken);

        if (tcExists)
        {
            return Conflict(new { success = false, message = "TC zaten mevcut" });
        }

        // employeeCode: if empty on update, keep existing
        if (!string.IsNullOrWhiteSpace(employeeCode) && !string.Equals(employeeCode, entity.EmployeeCode, StringComparison.OrdinalIgnoreCase))
        {
            var codeExists = await _dbContext.Set<Employee>()
                .AsNoTracking()
                .AnyAsync(x => x.Id != id && x.EmployeeCode == employeeCode, cancellationToken);

            if (codeExists)
            {
                return Conflict(new { success = false, message = "Çalışan kodu zaten mevcut" });
            }

            entity.EmployeeCode = employeeCode;
        }

        entity.FirstName = firstName;
        entity.LastName = lastName;
        entity.Mail = mail;
        entity.Tc = tc;
        entity.Username = string.IsNullOrWhiteSpace(username) ? null : username;
        // Sifre bos geldiyse MEVCUT sifreye dokunulmaz.
        //
        // Duzenleme ekrani sifre kutusunu her zaman bos actigi icin bu satir personelin
        // telefonunu duzeltirken sifresini de siliyordu; personel portala giremez ve QR ile
        // mesai baslatamaz hale geliyordu (giris, Password bossa 401 doner).
        if (!string.IsNullOrWhiteSpace(password))
        {
            entity.Password = PasswordHasher.HashPassword(password);
        }
        entity.HireDate = hireDate.HasValue ? DateTime.SpecifyKind(hireDate.Value.Date, DateTimeKind.Utc) : null;
        entity.WorkPermitDay = workPermitDay.HasValue ? DateTime.SpecifyKind(workPermitDay.Value.Date, DateTimeKind.Utc) : null;
        entity.WorkPermitRenewalFee = Math.Max(0m, workPermitRenewalFee);
        entity.Phone = phone;
        entity.TaxNo = taxNo;
        entity.TaxOffice = taxOffice;
        entity.BankName = string.IsNullOrWhiteSpace(bankName) ? null : bankName;
        entity.Iban = string.IsNullOrWhiteSpace(iban) ? null : iban;
        entity.Salary = salary;
        entity.SalaryDay = salaryDay;
        entity.MealAmount = mealAmount;
        entity.WorkType = string.IsNullOrWhiteSpace(workType) ? null : workType;
        entity.IsActive = request.IsActive;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Set<Employee>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        entity.IsActive = false;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPut("{id:int}/activate")]
    public async Task<IActionResult> Activate([FromRoute] int id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Set<Employee>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        entity.IsActive = true;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("{id:int}/hard")]
    public async Task<IActionResult> HardDelete([FromRoute] int id, CancellationToken cancellationToken)
    {
        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var employee = await _dbContext.Set<Employee>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (employee is null) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        // Delete dependent rows first
        await _dbContext.Set<EmployeeFaceEmbedding>().Where(x => x.EmployeeId == id).ExecuteDeleteAsync(cancellationToken);
        await _dbContext.Set<EmployeePayment>().Where(x => x.EmployeeId == id).ExecuteDeleteAsync(cancellationToken);
        await _dbContext.Set<EmployeeLeave>().Where(x => x.EmployeeId == id).ExecuteDeleteAsync(cancellationToken);
        await _dbContext.Set<EmployeeCheckIn>().Where(x => x.EmployeeId == id).ExecuteDeleteAsync(cancellationToken);
        await _dbContext.Set<EmployeeBonusPlan>().Where(x => x.EmployeeId == id).ExecuteDeleteAsync(cancellationToken);
        await _dbContext.Set<EmployeeMealPlan>().Where(x => x.EmployeeId == id).ExecuteDeleteAsync(cancellationToken);

        _dbContext.Set<Employee>().Remove(employee);
        await _dbContext.SaveChangesAsync(cancellationToken);

        await tx.CommitAsync(cancellationToken);
        return Ok(new { success = true });
    }
}
