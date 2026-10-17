namespace B2B.Erp.Api.Entities;

/// <summary>
/// Personel ödemelerinin çıktığı kasa.
///
/// <para>ERP'nin <c>CashAccounts</c> tablosundan AYRI bir tablodur. employee-service ana ERP ile
/// aynı tenant veritabanını kullandığı için personel maaş çıkışları bir süre ERP'nin gerçek
/// kasasına (<c>SELECT Id FROM "CashAccounts" LIMIT 1</c>) yazılıyordu; bayinin gerçek kasa
/// bakiyesi personel ödemeleriyle karışıyordu. Kullanıcı kararı (2026-08-18): personel kasası
/// kendi tablosunda dursun, ERP kasa/banka tablolarına employee-service hiç dokunmasın.</para>
///
/// <para>Bakiye EKSİYE düşebilir — kasaya para girişi yapmak zorunlu değil. İleride gerçek
/// bayi kasa/banka yapısına bağlanacağı için hareketler <see cref="EmployeeCashTransaction"/>
/// üzerinde kendi referans numarasıyla saklanır.</para>
/// </summary>
public sealed class EmployeeCashAccount : AuditableEntity
{
    public int Id { get; set; }

    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public int CurrencyTypeId { get; set; } = 1;

    public bool IsActive { get; set; } = true;
}
