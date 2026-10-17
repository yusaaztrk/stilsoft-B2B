using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.CustomerOffers;

public sealed class UpdateProformaHeaderRequest
{
    [MaxLength(15)]
    public string? ProformaDocumentNo { get; set; }

    [MaxLength(50)]
    public string? CustomerCode { get; set; }
}
