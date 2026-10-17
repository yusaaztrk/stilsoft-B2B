using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.CariOffers;

public sealed class UpdateCariProformaHeaderRequest
{
    [StringLength(15)]
    public string? ProformaDocumentNo { get; set; }

    [StringLength(50)]
    public string? CustomerCode { get; set; }
}
