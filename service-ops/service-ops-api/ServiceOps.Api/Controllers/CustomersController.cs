using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using ServiceOps.Application.Dtos;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class CustomersController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public CustomersController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<ActionResult<List<object>>> GetAll([FromQuery] string? type, [FromQuery] string? search)
    {
        var query = _context.Customers
            .Include(c => c.Region)
            .Where(c => c.IsActive)
            .AsQueryable();

        if (!string.IsNullOrEmpty(type))
            query = query.Where(c => c.Type.ToString() == type);
        if (!string.IsNullOrEmpty(search))
            query = query.Where(c => c.FullName.Contains(search) || c.Phone.Contains(search));

        var customers = await query.OrderByDescending(c => c.CreatedAt).ToListAsync();

        return Ok(customers.Select(c => new
        {
            c.Id,
            c.CustomerNumber,
            c.FullName,
            c.Type,
            TypeLabel = c.Type.ToString(),
            c.Phone,
            c.Email,
            c.Address,
            c.City,
            c.District,
            RegionName = c.Region?.Name,
            c.TotalServices,
            c.LastServiceDate,
            c.TotalRevenue,
            c.IsActive
        }));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<object>> GetById(Guid id)
    {
        var customer = await _context.Customers
            .Include(c => c.Region)
            .Include(c => c.Services)
            .FirstOrDefaultAsync(c => c.Id == id);

        if (customer == null) return NotFound();

        return Ok(new
        {
            customer.Id,
            customer.CustomerNumber,
            customer.FullName,
            customer.Type,
            TypeLabel = customer.Type.ToString(),
            customer.Phone,
            customer.Email,
            customer.Address,
            customer.City,
            customer.District,
            RegionName = customer.Region?.Name,
            customer.TotalServices,
            customer.LastServiceDate,
            customer.TotalRevenue,
            Services = customer.Services.Select(s => new { s.Id, s.ServiceNumber, s.Status, s.ProductName })
        });
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] CreateCustomerRequest request)
    {
        // `Enum.Parse` geçersiz girdide FIRLATIR: istemci tanımsız bir müşteri tipi
        // gönderdiğinde uç nokta 400 yerine yakalanmamış 500 dönüyordu. Dosyanın geri
        // kalanı zaten `TryParse` kullanıyor (satır 272, 311, 350…) — bu iki nokta atlanmış.
        if (!Enum.TryParse<CustomerType>(request.Type, out var createType))
        {
            return BadRequest(new { success = false, message = $"Geçersiz müşteri tipi: {request.Type}" });
        }

        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            CustomerNumber = await GenerateCustomerNumber(),
            FullName = request.FullName,
            Type = createType,
            Phone = request.Phone,
            Email = request.Email,
            Address = request.Address,
            City = request.City,
            District = request.District,
            RegionId = request.RegionId,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        _context.Customers.Add(customer);
        await _context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetById), new { id = customer.Id }, customer);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] CreateCustomerRequest request)
    {
        var customer = await _context.Customers.FindAsync(id);
        if (customer == null) return NotFound();

        // Bkz. Create: geçersiz tip 500 yerine 400 dönmeli.
        if (!Enum.TryParse<CustomerType>(request.Type, out var updateType))
        {
            return BadRequest(new { success = false, message = $"Geçersiz müşteri tipi: {request.Type}" });
        }

        customer.FullName = request.FullName;
        customer.Type = updateType;
        customer.Phone = request.Phone;
        customer.Email = request.Email;
        customer.Address = request.Address;
        customer.City = request.City;
        customer.District = request.District;
        customer.RegionId = request.RegionId;

        await _context.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var customer = await _context.Customers.FindAsync(id);
        if (customer == null) return NotFound();

        customer.IsActive = false;
        await _context.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("stats")]
    public async Task<ActionResult<object>> GetStats()
    {
        var total = await _context.Customers.CountAsync(c => c.IsActive);
        var byType = await _context.Customers
            .Where(c => c.IsActive)
            .GroupBy(c => c.Type)
            .Select(g => new { Type = g.Key.ToString(), Count = g.Count() })
            .ToListAsync();

        return Ok(new { total, byType });
    }

    private async Task<string> GenerateCustomerNumber()
    {
        var count = await _context.Customers.CountAsync();
        return $"CUS-{DateTime.UtcNow:yyyy}-{count + 1:D5}";
    }

    [HttpGet("/api/service-ops/customers")]
    public async Task<ActionResult<object>> GetServiceSummary(
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? sortBy = null,
        [FromQuery] string? sortDirection = "asc",
        CancellationToken cancellationToken = default)
    {
        var query = _context.Customers
            .AsNoTracking()
            .Where(c => c.IsActive);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var searchLower = search.Trim().ToLower();
            query = query.Where(c => 
                c.CustomerNumber.ToLower().Contains(searchLower) || 
                c.FullName.ToLower().Contains(searchLower) || 
                c.Phone.Contains(searchLower) ||
                (c.Email != null && c.Email.ToLower().Contains(searchLower))
            );
        }

        var projected = query.Select(c => new CustomerServiceSummaryDto
        {
            Id = c.Id,
            CustomerNumber = c.CustomerNumber,
            FullName = c.FullName,
            Phone = c.Phone,
            Email = c.Email,
            Address = c.Address,
            City = c.City,
            District = c.District,
            RegionName = c.Region != null ? c.Region.Name : null,
            IsActive = c.IsActive,
            LargeProductRepairCount = _context.ServiceRecords.Count(s => s.CustomerId == c.Id && s.Type == ServiceType.Repair && s.ProductCategory == ProductCategory.Large),
            SmallProductRepairCount = _context.ServiceRecords.Count(s => s.CustomerId == c.Id && s.Type == ServiceType.Repair && s.ProductCategory == ProductCategory.Small),
            InstallationCount = _context.ServiceRecords.Count(s => s.CustomerId == c.Id && s.Type == ServiceType.Installation),
            CargoCount = _context.CargoTrackingTasks.Count(ct => ct.CustomerName == c.FullName)
        });

        if (!string.IsNullOrWhiteSpace(sortBy))
        {
            bool isDesc = string.Equals(sortDirection, "desc", StringComparison.OrdinalIgnoreCase);
            projected = sortBy.ToLower() switch
            {
                "customername" or "fullname" => isDesc ? projected.OrderByDescending(x => x.FullName) : projected.OrderBy(x => x.FullName),
                "customernumber" => isDesc ? projected.OrderByDescending(x => x.CustomerNumber) : projected.OrderBy(x => x.CustomerNumber),
                "largeproductrepaircount" => isDesc ? projected.OrderByDescending(x => x.LargeProductRepairCount) : projected.OrderBy(x => x.LargeProductRepairCount),
                "smallproductrepaircount" => isDesc ? projected.OrderByDescending(x => x.SmallProductRepairCount) : projected.OrderBy(x => x.SmallProductRepairCount),
                "installationcount" => isDesc ? projected.OrderByDescending(x => x.InstallationCount) : projected.OrderBy(x => x.InstallationCount),
                "cargocount" => isDesc ? projected.OrderByDescending(x => x.CargoCount) : projected.OrderBy(x => x.CargoCount),
                "totalservicecount" => isDesc 
                    ? projected.OrderByDescending(x => x.SmallProductRepairCount + x.InstallationCount + x.CargoCount) 
                    : projected.OrderBy(x => x.SmallProductRepairCount + x.InstallationCount + x.CargoCount),
                _ => projected.OrderByDescending(x => x.FullName)
            };
        }
        else
        {
            projected = projected.OrderByDescending(x => x.FullName);
        }

        var totalCount = await projected.CountAsync(cancellationToken);
        var totalPages = (int)Math.Ceiling(totalCount / (double)pageSize);
        var items = await projected
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            items,
            totalCount,
            page,
            pageSize,
            totalPages
        });
    }

    [HttpGet("/api/service-ops/customers/{customerId:guid}/large-product-services")]
    public async Task<ActionResult> GetLargeProductServices(
        Guid customerId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        CancellationToken cancellationToken = default)
    {
        var query = _context.ServiceRecords
            .AsNoTracking()
            .Where(s => s.CustomerId == customerId && s.Type == ServiceType.Repair && s.ProductCategory == ProductCategory.Large)
            .OrderByDescending(s => s.CreatedAt);

        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(s => new CustomerServiceDetailDto
            {
                Id = s.Id,
                ServiceNumber = s.ServiceNumber,
                Type = "Büyük Ürün Arıza",
                Status = s.Status.ToString(),
                ProductName = s.ProductName,
                SerialNumber = s.SerialNumber,
                CreatedAt = s.CreatedAt
            })
            .ToListAsync(cancellationToken);

        foreach (var item in items)
        {
            if (Enum.TryParse<ServiceStatus>(item.Status, out var statusEnum))
            {
                item.StatusLabel = GetStatusLabel(statusEnum);
            }
        }

        return Ok(new { items, totalCount, page, pageSize });
    }

    [HttpGet("/api/service-ops/customers/{customerId:guid}/small-product-services")]
    public async Task<ActionResult> GetSmallProductServices(
        Guid customerId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        CancellationToken cancellationToken = default)
    {
        var query = _context.ServiceRecords
            .AsNoTracking()
            .Where(s => s.CustomerId == customerId && s.Type == ServiceType.Repair && s.ProductCategory == ProductCategory.Small)
            .OrderByDescending(s => s.CreatedAt);

        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(s => new CustomerServiceDetailDto
            {
                Id = s.Id,
                ServiceNumber = s.ServiceNumber,
                Type = "Küçük Ürün Arıza",
                Status = s.Status.ToString(),
                ProductName = s.ProductName,
                SerialNumber = s.SerialNumber,
                CreatedAt = s.CreatedAt
            })
            .ToListAsync(cancellationToken);

        foreach (var item in items)
        {
            if (Enum.TryParse<ServiceStatus>(item.Status, out var statusEnum))
            {
                item.StatusLabel = GetStatusLabel(statusEnum);
            }
        }

        return Ok(new { items, totalCount, page, pageSize });
    }

    [HttpGet("/api/service-ops/customers/{customerId:guid}/installations")]
    public async Task<ActionResult> GetInstallations(
        Guid customerId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        CancellationToken cancellationToken = default)
    {
        var query = _context.ServiceRecords
            .AsNoTracking()
            .Where(s => s.CustomerId == customerId && s.Type == ServiceType.Installation)
            .OrderByDescending(s => s.CreatedAt);

        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(s => new CustomerServiceDetailDto
            {
                Id = s.Id,
                ServiceNumber = s.ServiceNumber,
                Type = "Montaj",
                Status = s.Status.ToString(),
                ProductName = s.ProductName,
                SerialNumber = s.SerialNumber,
                CreatedAt = s.CreatedAt
            })
            .ToListAsync(cancellationToken);

        foreach (var item in items)
        {
            if (Enum.TryParse<ServiceStatus>(item.Status, out var statusEnum))
            {
                item.StatusLabel = GetStatusLabel(statusEnum);
            }
        }

        return Ok(new { items, totalCount, page, pageSize });
    }

    [HttpGet("/api/service-ops/customers/{customerId:guid}/cargo")]
    public async Task<ActionResult> GetCargo(
        Guid customerId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        CancellationToken cancellationToken = default)
    {
        var customer = await _context.Customers.FindAsync(customerId);
        if (customer == null) return NotFound();

        var query = _context.CargoTrackingTasks
            .AsNoTracking()
            .Where(t => t.CustomerName == customer.FullName)
            .OrderByDescending(t => t.OrderDate);

        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new CustomerCargoDetailDto
            {
                Id = t.Id,
                OrderNumber = t.OrderNumber,
                ProductDetails = t.ProductDetails ?? "Kargo Paketi",
                Status = t.Status.ToString(),
                PlannedDate = t.PlannedDate,
                CreatedAt = t.CreatedAt
            })
            .ToListAsync(cancellationToken);

        var dtoList = items.Select(x => new CustomerActivityDto
        {
            Id = x.Id,
            ReferenceNumber = x.OrderNumber,
            ActivityType = "Kargo",
            Status = x.Status,
            ProductName = x.ProductDetails,
            Date = x.CreatedAt
        }).ToList();

        foreach (var item in dtoList)
        {
            if (Enum.TryParse<CargoTrackingStatus>(item.Status, out var statusEnum))
            {
                item.StatusLabel = GetCargoStatusLabel(statusEnum);
            }
        }

        return Ok(new { items = dtoList, totalCount, page, pageSize });
    }

    [HttpGet("/api/service-ops/customers/{customerId:guid}/all-services")]
    public async Task<ActionResult> GetAllServices(
        Guid customerId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        CancellationToken cancellationToken = default)
    {
        var customer = await _context.Customers.FindAsync(customerId);
        if (customer == null) return NotFound();

        var servicesQuery = _context.ServiceRecords
            .Where(s => s.CustomerId == customerId)
            .Select(s => new CustomerActivityDto
            {
                Id = s.Id,
                ReferenceNumber = s.ServiceNumber,
                ActivityType = s.Type == ServiceType.Installation ? "Montaj" : (s.ProductCategory == ProductCategory.Large ? "Büyük Ürün Arıza" : "Küçük Ürün Arıza"),
                Status = s.Status.ToString(),
                ProductName = s.ProductName,
                Date = s.CreatedAt
            });

        var cargoQuery = _context.CargoTrackingTasks
            .Where(t => t.CustomerName == customer.FullName)
            .Select(t => new CustomerActivityDto
            {
                Id = t.Id,
                ReferenceNumber = t.OrderNumber,
                ActivityType = "Kargo",
                Status = t.Status.ToString(),
                ProductName = t.ProductDetails ?? "Kargo Paketi",
                Date = t.OrderDate
            });

        var combinedQuery = servicesQuery.Union(cargoQuery).OrderByDescending(x => x.Date);
        var totalCount = await combinedQuery.CountAsync(cancellationToken);
        var items = await combinedQuery.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);

        foreach (var item in items)
        {
            if (item.ActivityType == "Kargo")
            {
                if (Enum.TryParse<CargoTrackingStatus>(item.Status, out var cargoEnum))
                {
                    item.StatusLabel = GetCargoStatusLabel(cargoEnum);
                }
            }
            else
            {
                if (Enum.TryParse<ServiceStatus>(item.Status, out var serviceEnum))
                {
                    item.StatusLabel = GetStatusLabel(serviceEnum);
                }
            }
        }

        return Ok(new { items, totalCount, page, pageSize });
    }

    private static string GetStatusLabel(ServiceStatus status)
    {
        return status switch
        {
            ServiceStatus.New => "Yeni Kayıt",
            ServiceStatus.Workshop => "Atölyede",
            ServiceStatus.InRepair => "Tamirde",
            ServiceStatus.WaitingForParts => "Parça Bekliyor",
            ServiceStatus.Ready => "Hazır",
            ServiceStatus.Delivered => "Teslim Edildi",
            ServiceStatus.Cancelled => "İptal",
            ServiceStatus.Delayed => "Gecikti",
            ServiceStatus.Planned => "Planlandı",
            ServiceStatus.FieldPlanned => "Sahada Planlandı",
            ServiceStatus.InDelivery => "Teslimatta",
            ServiceStatus.SmallProductAcceptance => "Küçük Ürün Kabul",
            ServiceStatus.WorkshopReady => "Atölyede Hazır",
            ServiceStatus.DeliveryPlanning => "Teslimat Planlama",
            ServiceStatus.FieldCompleted => "Sahada Tamamlandı",
            ServiceStatus.LargeProductPlanning => "Büyük Ürün Planlama",
            _ => status.ToString()
        };
    }

    private static string GetCargoStatusLabel(CargoTrackingStatus status)
    {
        return status switch
        {
            CargoTrackingStatus.Received => "Alındı",
            CargoTrackingStatus.Planned => "Planlandı",
            CargoTrackingStatus.Preparing => "Hazırlanıyor",
            CargoTrackingStatus.OutForDelivery => "Dağıtımda",
            CargoTrackingStatus.Delivered => "Teslim Edildi",
            _ => status.ToString()
        };
    }
}

public class CreateCustomerRequest
{
    public string FullName { get; set; } = string.Empty;
    public string Type { get; set; } = "Individual";
    public string Phone { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? District { get; set; }
    public Guid? RegionId { get; set; }
}
