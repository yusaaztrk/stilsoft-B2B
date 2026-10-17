namespace B2B.Erp.Api.Entities;

/// <summary>
/// Marketing copy for a product: the paragraph that describes it and the bullet list of its
/// features, as they appear on a customer offer.
///
/// Kept in its own table, joined on stock code, rather than as columns on Products. The two are
/// maintained by different people at different times — the product record is operational data
/// that comes from the catalogue, this is copy that gets rewritten — and a product may exist
/// with no copy at all.
/// </summary>
public class ProductDetail : AuditableEntity
{
    public int Id { get; set; }

    /// <summary>Joins to Products.StockCode. Unique: one set of copy per product.</summary>
    public string StockCode { get; set; } = string.Empty;

    /// <summary>
    /// Prose. Describes what the product is and who it is for — deliberately not a list of
    /// specifications, which belong in <see cref="Features"/>. The source spreadsheet had these
    /// two mixed up in almost every row.
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// One feature per line. Stored as text rather than a child table because it is always read
    /// and written whole, and the offer print renders it as a block.
    /// </summary>
    public string? Features { get; set; }
}
