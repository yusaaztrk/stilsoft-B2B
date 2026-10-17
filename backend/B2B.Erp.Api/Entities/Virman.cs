using System;

namespace B2B.Erp.Api.Entities;

public sealed class Virman : AuditableEntity
{
    public int Id { get; set; }
    public string DocumentNo { get; set; } = string.Empty;
    public DateTime Date { get; set; }
    
    public string SourceCustomerCode { get; set; } = string.Empty;
    public Customer SourceCustomer { get; set; } = null!;
    
    public string TargetCustomerCode { get; set; } = string.Empty;
    public Customer TargetCustomer { get; set; } = null!;
    
    public decimal Amount { get; set; }

    /// <summary>
    /// Virmanın para birimi. 1=TRY 2=EUR 3=USD 4=GBP (0 = TL).
    /// Bakiye artık döviz başına yürüdüğü için virmanın hangi dövizde yapıldığı ŞART:
    /// öncesinde alan yoktu ve cariden cariye aktarım zorunlu olarak TL yazılıyordu.
    /// </summary>
    public int CurrencyTypeId { get; set; }

    /// <summary>Virman anındaki kur (1 döviz = X TL).</summary>
    public decimal ExchangeRate { get; set; } = 1m;
    public string? Description { get; set; }
}
