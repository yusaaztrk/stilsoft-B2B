namespace B2B.Erp.Api.Entities;

public sealed class EmployeeFaceEmbedding : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    public Employee? Employee { get; set; }

    /// <summary>
    /// 128-dimensional face embedding stored as JSON array of floats.
    /// No photograph is stored – only the mathematical vector (KVKK compliant).
    /// </summary>
    public string EmbeddingJson { get; set; } = "[]";
}
