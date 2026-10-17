using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.ProductCategories;

public sealed class CreateSubCategoryRequest
{
    [Required(ErrorMessage = "Ana kategori adı zorunludur")]
    [MaxLength(200, ErrorMessage = "Ana kategori adı en fazla 200 karakter olabilir")]
    public string MainName { get; set; } = string.Empty;

    [Required(ErrorMessage = "Alt kategori adı zorunludur")]
    [MaxLength(200, ErrorMessage = "Alt kategori adı en fazla 200 karakter olabilir")]
    public string Name { get; set; } = string.Empty;

    [MaxLength(500, ErrorMessage = "Açıklama en fazla 500 karakter olabilir")]
    public string? Description { get; set; }
}
