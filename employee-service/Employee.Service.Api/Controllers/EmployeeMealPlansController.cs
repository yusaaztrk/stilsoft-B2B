using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Employees;
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
public sealed class EmployeeMealPlansController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly AccountMovementWriter _movements;
    private readonly EmployeeCashService _cash;
    private readonly ErpPaymentAccountService _erp;

    public EmployeeMealPlansController(AppDbContext dbContext, AccountMovementWriter movements, EmployeeCashService cash, ErpPaymentAccountService erp)
    {
        _erp = erp;
        _dbContext = dbContext;
        _movements = movements;
        _cash = cash;
    }

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt == default) return DateTime.UtcNow;
        return dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }

    private string GetUsername()
    {
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        return string.IsNullOrWhiteSpace(username) ? "System" : username;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int? employeeId, [FromQuery] int take = 200, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 1000);

        var q = _dbContext.Set<EmployeeMealPlan>().AsNoTracking().AsQueryable();
        if (employeeId.HasValue && employeeId.Value > 0)
        {
            q = q.Where(x => x.EmployeeId == employeeId.Value);
        }

        var data = await q
            .OrderByDescending(x => x.PlannedDate)
            .ThenByDescending(x => x.Id)
            .Take(take)
            .Select(x => new EmployeeMealPlanListItemResponse
            {
                Id = x.Id,
                EmployeeId = x.EmployeeId,
                PlannedDate = x.PlannedDate,
                Amount = x.Amount,
                Description = x.Description,
                Status = x.Status,
                PaidPaymentId = x.PaidPaymentId,
                CreateUser = x.CreateUser,
                CreateTime = x.CreateTime
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateEmployeeMealPlanRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (request.EmployeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz çalışan" });
        if (request.Amount <= 0) return BadRequest(new { success = false, message = "Tutar geçersiz" });

        var employeeExists = await _dbContext.Employees.AsNoTracking().AnyAsync(x => x.Id == request.EmployeeId, cancellationToken);
        if (!employeeExists) return BadRequest(new { success = false, message = "Çalışan bulunamadı" });

        var now = DateTime.UtcNow;
        var username = GetUsername();
        var plannedDate = NormalizeUtc(request.PlannedDate);

        var entity = new EmployeeMealPlan
        {
            EmployeeId = request.EmployeeId,
            PlannedDate = plannedDate,
            Amount = request.Amount,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            Status = EmployeeMealPlanStatus.Planned,
            PaidPaymentId = null,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.Set<EmployeeMealPlan>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id } });
    }

    [HttpPut("{id:int}/status")]
    public async Task<IActionResult> UpdateStatus([FromRoute] int id, [FromBody] UpdateEmployeeMealPlanStatusRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var entity = await _dbContext.Set<EmployeeMealPlan>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        entity.Status = request.Status;
        entity.EditUser = GetUsername();
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("bulk-pay")]
    public async Task<IActionResult> BulkPayPlanned([FromBody] BulkPlannedMealPaymentRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var ids = (request.EmployeeIds ?? new List<int>())
            .Where(x => x > 0)
            .Distinct()
            .ToList();

        if (ids.Count == 0) return BadRequest(new { success = false, message = "Çalışan seçilmedi" });

        var now = DateTime.UtcNow;
        var username = GetUsername();
        var description = string.IsNullOrWhiteSpace(request.Description) ? "Yemek Ödemesi" : request.Description.Trim();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var plans = await _dbContext.Set<EmployeeMealPlan>()
            .Where(x => ids.Contains(x.EmployeeId) && x.Status == EmployeeMealPlanStatus.Planned)
            .OrderBy(x => x.EmployeeId)
            .ThenBy(x => x.PlannedDate)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);

        if (plans.Count == 0)
        {
            return Ok(new { success = true, paidCount = 0 });
        }

        var payments = new List<EmployeePayment>(plans.Count);
        foreach (var p in plans)
        {
            if (p.Amount <= 0) continue;
            payments.Add(new EmployeePayment
            {
                EmployeeId = p.EmployeeId,
                Type = EmployeePaymentType.Meal,
                Amount = p.Amount,
                PaymentDate = now,
                Description = description,
                BankAccountDefinitionId = request.BankAccountDefinitionId,
                CashAccountId = request.CashAccountId,
                CreateUser = username,
                CreateTime = now
            });
        }

        if (payments.Count == 0)
        {
            return Ok(new { success = true, paidCount = 0 });
        }

        _dbContext.Set<EmployeePayment>().AddRange(payments);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var payIdx = 0;
        foreach (var plan in plans)
        {
            if (plan.Amount <= 0) continue;
            var paidPayment = payments[payIdx++];
            plan.Status = EmployeeMealPlanStatus.Paid;
            plan.PaidPaymentId = paidPayment.Id;
            plan.EditUser = username;
            plan.EditTime = now;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);


        // --- Personel kasasi ---
        // Odemenin kasa tarafi ERP hesap hareketinden BAGIMSIZDIR: ERP baglantisi kapali olsa da
        // (bkz. AccountMovementSettings) personel kasasindan para cikar. Kasaya Yemek toplu ödemesi icin tek
        // ust kayit yazilir; personel kirilimi ust kayda bagli alt satirlarda durur.
        var cashAccount = await _cash.GetOrCreateDefaultAccountAsync(null, cancellationToken);
        var cashTotal2 = payments.Sum(p => p.Amount);
        var bulkRef = await ReferenceNumberGenerator.NextAsync(_dbContext, "BULK", null, cancellationToken);
        var bulkDesc = $"{"Yemek toplu ödemesi"} ({payments.Count} personel)";

        var parentTx = _cash.AddBulkParent(
            cashAccount.Id, now, cashTotal2, (int)EmployeePaymentType.Meal, null, bulkRef, bulkDesc, username);

        if (request.ErpSource is not null)
        {
            var erpHata = await _erp.AttachAsync(parentTx, request.ErpSource, User, username, cancellationToken);
            if (erpHata is not null) return BadRequest(new { success = false, message = erpHata });
        }
        await _dbContext.SaveChangesAsync(cancellationToken);

        var nameById = await _dbContext.Employees
            .AsNoTracking()
            .Where(x => payments.Select(p => p.EmployeeId).Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => ((x.FirstName ?? "") + " " + (x.LastName ?? "")).Trim(), cancellationToken);

        foreach (var payment in payments)
        {
            _cash.AddBulkChild(
                cashAccount.Id, parentTx.Id, payment,
                nameById.TryGetValue(payment.EmployeeId, out var n) ? n : string.Empty,
                payment.Description ?? bulkDesc, username);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Kasa/banka hareketi: bu adim bir yorum satiri olarak birakilmisti. Planlar "Odendi"
        // isaretlenip odeme kayitlari olusuyor ama kasadan/bankadan hic para cikmiyordu.
        var totalAmount = payments.Sum(p => p.Amount);
        if (totalAmount > 0 && (request.BankAccountDefinitionId is > 0 || request.CashAccountId is > 0))
        {
            var movement = await _movements.WriteAsync(
                request.BankAccountDefinitionId,
                request.CashAccountId,
                totalAmount,
                now,
                direction: 2,
                description,
                username,
                now,
                knownRate: null,
                cancellationToken);

            if (!movement.Ok)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = movement.Error });
            }

            foreach (var payment in payments)
            {
                payment.MovementCurrencyTypeId = movement.CurrencyTypeId;
                payment.MovementCurrencyRate = movement.Rate;
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, paidCount = payments.Count });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.Set<EmployeeMealPlan>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != EmployeeMealPlanStatus.Planned)
        {
            return BadRequest(new { success = false, message = "Sadece planlandı durumundaki yemek planı iptal edilebilir" });
        }

        _dbContext.Set<EmployeeMealPlan>().Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/undo-pay")]
    public async Task<IActionResult> UndoPay([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var now = DateTime.UtcNow;
        var username = GetUsername();

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var entity = await _dbContext.Set<EmployeeMealPlan>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        if (entity.Status != EmployeeMealPlanStatus.Paid || !entity.PaidPaymentId.HasValue)
        {
            return BadRequest(new { success = false, message = "Sadece ödendi durumundaki yemek planı geri alınabilir" });
        }

        var paymentId = entity.PaidPaymentId.Value;
        var payment = await _dbContext.Set<EmployeePayment>().FirstOrDefaultAsync(x => x.Id == paymentId, cancellationToken);
        if (payment is not null)
        {
            // Odeme geri alinirken kasa/banka hareketi de ters kayitla iade edilir.
            //
            // Burada yalnizca odeme satiri siliniyordu; toplu odeme kasadan/bankadan parayi
            // cikardigi icin geri alma sonrasi hesap eksik kaliyordu. Ters kayit ORIJINAL
            // kurla atilir (MovementCurrencyRate), yoksa doviz hesapta bakiye sifirlanmaz.
            // Personel kasasi hareketini de kaldir (toplu odemede ust kaydin tutari duser).
            await _cash.RemoveByPaymentIdAsync(payment.Id, cancellationToken, username);

            // ERP hesap hareketinin ters kaydi yalnizca GERCEKTEN hareket yazilmis odemeler
            // icin atilir; isaret MovementCurrencyTypeId'nin dolu olmasidir. CashAccountId artik
            // personel kasasinin kimligini de tasiyabiliyor, tek basina olcut degil.
            if (payment.MovementCurrencyTypeId.HasValue &&
                (payment.BankAccountDefinitionId is > 0 || payment.CashAccountId is > 0))
            {
                (int CurrencyTypeId, decimal Rate)? knownRate = null;
                if (payment.MovementCurrencyTypeId.HasValue && payment.MovementCurrencyRate is > 0m)
                {
                    knownRate = (payment.MovementCurrencyTypeId.Value, payment.MovementCurrencyRate.Value);
                }

                var reversal = await _movements.WriteAsync(
                    payment.BankAccountDefinitionId,
                    payment.CashAccountId,
                    payment.Amount,
                    now,
                    direction: 1,
                    $"{payment.Description ?? "Yemek Odemesi"} - Iptal",
                    username,
                    now,
                    knownRate,
                    cancellationToken);

                if (!reversal.Ok)
                {
                    return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = reversal.Error });
                }
            }

            _dbContext.Set<EmployeePayment>().Remove(payment);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        entity.Status = EmployeeMealPlanStatus.Planned;
        entity.PaidPaymentId = null;
        entity.EditUser = username;
        entity.EditTime = now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
