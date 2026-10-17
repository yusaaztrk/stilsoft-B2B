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
[AuthorizePage("users", "calisan")]
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

        [StringLength(100)]
        public string? FirstName { get; set; }

        [StringLength(100)]
        public string? LastName { get; set; }

        [StringLength(200)]
        public string? Mail { get; set; }

        [StringLength(20)]
        public string? Tc { get; set; }

        [StringLength(30)]
        public string? Phone { get; set; }

        [StringLength(30)]
        public string? TaxNo { get; set; }

        [StringLength(100)]
        public string? TaxOffice { get; set; }

        [StringLength(120)]
        public string? BankName { get; set; }

        [StringLength(34)]
        public string? Iban { get; set; }

        [StringLength(50)]
        public string? BankAccountNo { get; set; }

        [StringLength(50)]
        public string? CustomerNo { get; set; }

        public DateTime? HireDate { get; set; }

        public DateTime? WorkPermitDay { get; set; }

        public decimal? WorkPermitRenewalFee { get; set; }

        /// <summary>Maas KURUS tasir (denetim md. A6) — `int` degil.</summary>
        public decimal? Salary { get; set; }

        public int? SalaryDay { get; set; } = 1;

        public decimal? MealAmount { get; set; }

        [StringLength(80)]
        public string? WorkType { get; set; }

        /// <summary>Bagli oldugu isyeri / sirket.</summary>
        [StringLength(120)]
        public string? Workplace { get; set; }

        /// <summary>Mesai başlatabileceği konum. NULL ise aktif konumların herhangi biri.</summary>
        public int? LocationSettingId { get; set; }

        /// <summary>Bu personele yemek veriliyor mu? Kapalıysa yemek hakedişi hesaplanmaz.</summary>
        public bool HasMealAllowance { get; set; } = true;

        public bool IsActive { get; set; } = true;

        /// <summary>Bagli oldugu is gunu (mesai) tanimi. Bos ise varsayilan tanim uygulanir.</summary>
        public int? WorkScheduleSettingId { get; set; }

        /// <summary>Isten cikis tarihi. Doluysa personel pasife alinir.</summary>
        public DateTime? TerminationDate { get; set; }

        [StringLength(200)]
        public string? TerminationReason { get; set; }

        /// <summary>Yillik izin hakkinin elle belirlenmesi; bos ise kanuni kidem kademesi uygulanir.</summary>
        [Range(0, 365)]
        public int? AnnualLeaveOverrideDays { get; set; }

        [StringLength(30)]
        public string? PassportNo { get; set; }

        [StringLength(60)]
        public string? Nationality { get; set; }

        public DateTime? BirthDate { get; set; }

        [StringLength(120)]
        public string? BirthPlace { get; set; }

        [StringLength(40)]
        public string? ProvidentFundNo { get; set; }

        [StringLength(40)]
        public string? SocialSecurityNo { get; set; }

        [StringLength(40)]
        public string? SsdNo { get; set; }

        [StringLength(500)]
        public string? Address { get; set; }

        [StringLength(200)]
        public string? AddressDetail { get; set; }

        /// <summary>Calisma izni baslangic tarihi; bitis tarihi WorkPermitDay alanidir.</summary>
        public DateTime? WorkPermitStartDate { get; set; }
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
            .Where(x => x.EmployeeCode != null && x.EmployeeCode.StartsWith(EmployeeCodePrefix))
            .Select(x => x.EmployeeCode!)
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
        var seriesKey = $"employee:{EmployeeCodePrefix.TrimEnd('-')}";
        var seriesLast = await _dbContext.NumberSeries
            .AsNoTracking()
            .Where(x => x.Key == seriesKey)
            .Select(x => (long?)x.LastValue)
            .FirstOrDefaultAsync(cancellationToken);

        var existingCodes = await _dbContext.Set<Employee>()
            .AsNoTracking()
            .Where(x => x.EmployeeCode != null && x.EmployeeCode.StartsWith(EmployeeCodePrefix))
            .Select(x => x.EmployeeCode!)
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
                bankAccountNo = x.BankAccountNo,
                customerNo = x.CustomerNo,
                hireDate = x.HireDate,
                workPermitDay = x.WorkPermitDay,
                workPermitStartDate = x.WorkPermitStartDate,
                passportNo = x.PassportNo,
                nationality = x.Nationality,
                birthDate = x.BirthDate,
                birthPlace = x.BirthPlace,
                providentFundNo = x.ProvidentFundNo,
                socialSecurityNo = x.SocialSecurityNo,
                ssdNo = x.SsdNo,
                address = x.Address,
                addressDetail = x.AddressDetail,
                workPermitRenewalFee = x.WorkPermitRenewalFee,
                salary = x.Salary,
                salaryDay = x.SalaryDay,
                mealAmount = x.MealAmount,
                workType = x.WorkType,
                workplace = x.Workplace,
                locationSettingId = x.LocationSettingId,
            hasMealAllowance = x.HasMealAllowance,
                isActive = x.IsActive,
                workScheduleSettingId = x.WorkScheduleSettingId,
                terminationDate = x.TerminationDate,
                terminationReason = x.TerminationReason,
                annualLeaveOverrideDays = x.AnnualLeaveOverrideDays,
                createTime = x.CreateTime,
                createUser = x.CreateUser,
                editTime = x.EditTime,
                editUser = x.EditUser
            })
            .ToListAsync(cancellationToken);

        return Ok(data);
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById([FromRoute] int id, CancellationToken cancellationToken)
    {
        var x = await _dbContext.Set<Employee>()
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == id, cancellationToken);

        if (x is null) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        return Ok(new
        {
            id = x.Id,
            employeeCode = x.EmployeeCode,
            username = x.Username,
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
            bankAccountNo = x.BankAccountNo,
            customerNo = x.CustomerNo,
            hireDate = x.HireDate,
            workPermitDay = x.WorkPermitDay,
            workPermitStartDate = x.WorkPermitStartDate,
            passportNo = x.PassportNo,
            nationality = x.Nationality,
            birthDate = x.BirthDate,
            birthPlace = x.BirthPlace,
            providentFundNo = x.ProvidentFundNo,
            socialSecurityNo = x.SocialSecurityNo,
            ssdNo = x.SsdNo,
            address = x.Address,
            addressDetail = x.AddressDetail,
            workPermitRenewalFee = x.WorkPermitRenewalFee,
            salary = x.Salary,
            salaryDay = x.SalaryDay,
            mealAmount = x.MealAmount,
            workType = x.WorkType,
            workplace = x.Workplace,
            locationSettingId = x.LocationSettingId,
            hasMealAllowance = x.HasMealAllowance,
            isActive = x.IsActive,
            workScheduleSettingId = x.WorkScheduleSettingId,
            terminationDate = x.TerminationDate,
            terminationReason = x.TerminationReason,
            annualLeaveOverrideDays = x.AnnualLeaveOverrideDays,
            createTime = x.CreateTime,
            createUser = x.CreateUser,
            editTime = x.EditTime,
            editUser = x.EditUser
        });
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

    /// <summary>Kayitli isyerleri; formdaki isyeri kutusuna oneri listesi olarak verilir.</summary>
    [HttpGet("workplaces")]
    public async Task<IActionResult> GetWorkplaces(CancellationToken cancellationToken = default)
    {
        var values = await _dbContext.Set<Employee>()
            .AsNoTracking()
            .Select(x => x.Workplace)
            .Where(x => x != null && x != "")
            .Distinct()
            .OrderBy(x => x)
            .ToListAsync(cancellationToken);

        var data = values
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
        var firstName = string.IsNullOrWhiteSpace(request.FirstName) ? null : request.FirstName.Trim();
        var lastName = string.IsNullOrWhiteSpace(request.LastName) ? null : request.LastName.Trim();
        var mail = string.IsNullOrWhiteSpace(request.Mail) ? null : request.Mail.Trim();
        var tc = string.IsNullOrWhiteSpace(request.Tc) ? null : request.Tc.Trim();
        var phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
        var taxNo = string.IsNullOrWhiteSpace(request.TaxNo) ? null : request.TaxNo.Trim();
        var taxOffice = string.IsNullOrWhiteSpace(request.TaxOffice) ? null : request.TaxOffice.Trim();
        var bankName = string.IsNullOrWhiteSpace(request.BankName) ? null : request.BankName.Trim();
        var iban = string.IsNullOrWhiteSpace(request.Iban) ? null : request.Iban.Trim();
        var username = string.IsNullOrWhiteSpace(request.Username) ? null : request.Username.Trim();
        var password = string.IsNullOrWhiteSpace(request.Password) ? null : request.Password.Trim();
        var hireDate = request.HireDate;
        var workPermitDay = request.WorkPermitDay;
        var workPermitRenewalFee = request.WorkPermitRenewalFee ?? 0m;
        // Kolon numeric(18,2): 2 basamaktan fazlasi VERITABANINDA yuvarlanirdi. Burada
        // yuvarlanir ki dogrulanan tutar ile yazilan tutar ayni olsun.
        var salary = Math.Round(request.Salary ?? 0m, 2, MidpointRounding.AwayFromZero);
        var salaryDay = request.SalaryDay is >= 1 and <= 31 ? request.SalaryDay.Value : 1;
        var mealAmount = request.MealAmount ?? 0m;
        var workType = string.IsNullOrWhiteSpace(request.WorkType) ? null : request.WorkType.Trim();

        if (salary < 0) ModelState.AddModelError(nameof(request.Salary), "Salary must be >= 0.");
        if (mealAmount < 0) ModelState.AddModelError(nameof(request.MealAmount), "MealAmount must be >= 0.");
        if (workPermitRenewalFee < 0) ModelState.AddModelError(nameof(request.WorkPermitRenewalFee), "WorkPermitRenewalFee must be >= 0.");
        if (workType?.Length > 80) ModelState.AddModelError(nameof(request.WorkType), "WorkType is too long.");

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

        if (!string.IsNullOrWhiteSpace(tc))
        {
            var exists = await _dbContext.Set<Employee>()
                .AsNoTracking()
                .AnyAsync(x => x.Tc != null && x.Tc == tc, cancellationToken);

            if (exists)
            {
                return Conflict(new { success = false, message = "TC zaten mevcut" });
            }
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
            Username = username,
            Password = string.IsNullOrWhiteSpace(password) ? null : PasswordHasher.HashPassword(password),
            FirstName = firstName,
            LastName = lastName,
            Mail = mail,
            Tc = tc,
            Phone = phone,
            TaxNo = taxNo,
            TaxOffice = taxOffice,
            BankName = bankName,
            Iban = iban,
            BankAccountNo = string.IsNullOrWhiteSpace(request.BankAccountNo) ? null : request.BankAccountNo.Trim(),
            CustomerNo = string.IsNullOrWhiteSpace(request.CustomerNo) ? null : request.CustomerNo.Trim(),
            HireDate = hireDate.HasValue ? DateTime.SpecifyKind(hireDate.Value.Date, DateTimeKind.Utc) : null,
            WorkPermitDay = workPermitDay.HasValue ? DateTime.SpecifyKind(workPermitDay.Value.Date, DateTimeKind.Utc) : null,
            WorkPermitRenewalFee = Math.Max(0m, workPermitRenewalFee),
            Salary = salary,
            SalaryDay = salaryDay,
            MealAmount = mealAmount,
            WorkType = workType,
            Workplace = string.IsNullOrWhiteSpace(request.Workplace) ? null : request.Workplace.Trim(),
            LocationSettingId = request.LocationSettingId is > 0 ? request.LocationSettingId : null,
            HasMealAllowance = request.HasMealAllowance,
            IsActive = request.IsActive,
            WorkScheduleSettingId = request.WorkScheduleSettingId is > 0 ? request.WorkScheduleSettingId : null,
            TerminationDate = request.TerminationDate.HasValue
                ? DateTime.SpecifyKind(request.TerminationDate.Value.Date, DateTimeKind.Utc)
                : null,
            TerminationReason = string.IsNullOrWhiteSpace(request.TerminationReason) ? null : request.TerminationReason.Trim(),
            AnnualLeaveOverrideDays = request.AnnualLeaveOverrideDays,
            PassportNo = string.IsNullOrWhiteSpace(request.PassportNo) ? null : request.PassportNo.Trim(),
            Nationality = string.IsNullOrWhiteSpace(request.Nationality) ? null : request.Nationality.Trim(),
            BirthDate = request.BirthDate.HasValue
                ? DateTime.SpecifyKind(request.BirthDate.Value.Date, DateTimeKind.Utc)
                : null,
            BirthPlace = string.IsNullOrWhiteSpace(request.BirthPlace) ? null : request.BirthPlace.Trim(),
            ProvidentFundNo = string.IsNullOrWhiteSpace(request.ProvidentFundNo) ? null : request.ProvidentFundNo.Trim(),
            SocialSecurityNo = string.IsNullOrWhiteSpace(request.SocialSecurityNo) ? null : request.SocialSecurityNo.Trim(),
            SsdNo = string.IsNullOrWhiteSpace(request.SsdNo) ? null : request.SsdNo.Trim(),
            Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim(),
            AddressDetail = string.IsNullOrWhiteSpace(request.AddressDetail) ? null : request.AddressDetail.Trim(),
            WorkPermitStartDate = request.WorkPermitStartDate.HasValue
                ? DateTime.SpecifyKind(request.WorkPermitStartDate.Value.Date, DateTimeKind.Utc)
                : null,
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
        var firstName = string.IsNullOrWhiteSpace(request.FirstName) ? null : request.FirstName.Trim();
        var lastName = string.IsNullOrWhiteSpace(request.LastName) ? null : request.LastName.Trim();
        var mail = string.IsNullOrWhiteSpace(request.Mail) ? null : request.Mail.Trim();
        var tc = string.IsNullOrWhiteSpace(request.Tc) ? null : request.Tc.Trim();
        var phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
        var taxNo = string.IsNullOrWhiteSpace(request.TaxNo) ? null : request.TaxNo.Trim();
        var taxOffice = string.IsNullOrWhiteSpace(request.TaxOffice) ? null : request.TaxOffice.Trim();
        var bankName = string.IsNullOrWhiteSpace(request.BankName) ? null : request.BankName.Trim();
        var iban = string.IsNullOrWhiteSpace(request.Iban) ? null : request.Iban.Trim();
        var username = string.IsNullOrWhiteSpace(request.Username) ? null : request.Username.Trim();
        var password = string.IsNullOrWhiteSpace(request.Password) ? null : request.Password.Trim();
        var hireDate = request.HireDate;
        var workPermitDay = request.WorkPermitDay;
        var workPermitRenewalFee = request.WorkPermitRenewalFee ?? 0m;
        // Kolon numeric(18,2): 2 basamaktan fazlasi VERITABANINDA yuvarlanirdi. Burada
        // yuvarlanir ki dogrulanan tutar ile yazilan tutar ayni olsun.
        var salary = Math.Round(request.Salary ?? 0m, 2, MidpointRounding.AwayFromZero);
        var salaryDay = request.SalaryDay is >= 1 and <= 31 ? request.SalaryDay.Value : 1;
        var mealAmount = request.MealAmount ?? 0m;
        var workType = string.IsNullOrWhiteSpace(request.WorkType) ? null : request.WorkType.Trim();

        if (salary < 0) ModelState.AddModelError(nameof(request.Salary), "Salary must be >= 0.");
        if (mealAmount < 0) ModelState.AddModelError(nameof(request.MealAmount), "MealAmount must be >= 0.");
        if (workPermitRenewalFee < 0) ModelState.AddModelError(nameof(request.WorkPermitRenewalFee), "WorkPermitRenewalFee must be >= 0.");
        if (workType?.Length > 80) ModelState.AddModelError(nameof(request.WorkType), "WorkType is too long.");

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

        if (!string.IsNullOrWhiteSpace(tc))
        {
            var tcExists = await _dbContext.Set<Employee>()
                .AsNoTracking()
                .AnyAsync(x => x.Id != id && x.Tc != null && x.Tc == tc, cancellationToken);

            if (tcExists)
            {
                return Conflict(new { success = false, message = "TC zaten mevcut" });
            }
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
        entity.Username = username;

        // Sifre bos geldiyse MEVCUT sifreye dokunulmaz.
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
        entity.BankName = bankName;
        entity.Iban = iban;
        entity.BankAccountNo = string.IsNullOrWhiteSpace(request.BankAccountNo) ? null : request.BankAccountNo.Trim();
        entity.CustomerNo = string.IsNullOrWhiteSpace(request.CustomerNo) ? null : request.CustomerNo.Trim();
        entity.Salary = salary;
        entity.SalaryDay = salaryDay;
        entity.MealAmount = mealAmount;
        entity.WorkType = workType;
        entity.Workplace = string.IsNullOrWhiteSpace(request.Workplace) ? null : request.Workplace.Trim();
        entity.LocationSettingId = request.LocationSettingId is > 0 ? request.LocationSettingId : null;
        entity.HasMealAllowance = request.HasMealAllowance;
        entity.WorkScheduleSettingId = request.WorkScheduleSettingId is > 0 ? request.WorkScheduleSettingId : null;
        entity.TerminationReason = string.IsNullOrWhiteSpace(request.TerminationReason) ? null : request.TerminationReason.Trim();
        entity.AnnualLeaveOverrideDays = request.AnnualLeaveOverrideDays;
        entity.PassportNo = string.IsNullOrWhiteSpace(request.PassportNo) ? null : request.PassportNo.Trim();
        entity.Nationality = string.IsNullOrWhiteSpace(request.Nationality) ? null : request.Nationality.Trim();
        entity.BirthDate = request.BirthDate.HasValue
            ? DateTime.SpecifyKind(request.BirthDate.Value.Date, DateTimeKind.Utc)
            : null;
        entity.BirthPlace = string.IsNullOrWhiteSpace(request.BirthPlace) ? null : request.BirthPlace.Trim();
        entity.ProvidentFundNo = string.IsNullOrWhiteSpace(request.ProvidentFundNo) ? null : request.ProvidentFundNo.Trim();
        entity.SocialSecurityNo = string.IsNullOrWhiteSpace(request.SocialSecurityNo) ? null : request.SocialSecurityNo.Trim();
        entity.SsdNo = string.IsNullOrWhiteSpace(request.SsdNo) ? null : request.SsdNo.Trim();
        entity.Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim();
        entity.AddressDetail = string.IsNullOrWhiteSpace(request.AddressDetail) ? null : request.AddressDetail.Trim();
        entity.WorkPermitStartDate = request.WorkPermitStartDate.HasValue
            ? DateTime.SpecifyKind(request.WorkPermitStartDate.Value.Date, DateTimeKind.Utc)
            : null;
        entity.TerminationDate = request.TerminationDate.HasValue
            ? DateTime.SpecifyKind(request.TerminationDate.Value.Date, DateTimeKind.Utc)
            : null;

        // Cikis tarihi girilen personel otomatik pasife duser
        entity.IsActive = entity.TerminationDate.HasValue ? false : request.IsActive;
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

    [HttpPost("sync-bank-details")]
    public async Task<IActionResult> SyncBankDetails(CancellationToken cancellationToken)
    {
        var updatedCount = await Core.Services.ExcelEmployeeSeedService.SyncBankDetailsAsync(_dbContext, cancellationToken);
        return Ok(new { success = true, updatedCount });
    }
}
