using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.ProductCategories;

public sealed class CreateMainCategoryRequest
{
    [Required(ErrorMessage = "Kategori adı zorunludur")]
    [MaxLength(200, ErrorMessage = "Kategori adı en fazla 200 karakter olabilir")]
    public string Name { get; set; } = string.Empty;

    [MaxLength(500, ErrorMessage = "Açıklama en fazla 500 karakter olabilir")]
    public string? Description { get; set; }
}
