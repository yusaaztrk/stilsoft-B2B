using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

public sealed class SubmitContactMessageDto
{
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}

[ApiController]
[Route("api/storefront/contact")]
public sealed class StorefrontContactController : ControllerBase
{
    private readonly ContactMessagesRepository _repo;

    public StorefrontContactController(ContactMessagesRepository repo)
    {
        _repo = repo;
    }

    [HttpPost]
    public async Task<IActionResult> Submit([FromBody] SubmitContactMessageDto dto, CancellationToken cancellationToken)
    {
        if (dto == null)
            return BadRequest(new { success = false, message = "Geçersiz veri." });

        if (string.IsNullOrWhiteSpace(dto.FullName))
            return BadRequest(new { success = false, message = "Ad Soyad alanı zorunludur." });

        if (string.IsNullOrWhiteSpace(dto.Email))
            return BadRequest(new { success = false, message = "E-posta alanı zorunludur." });

        if (string.IsNullOrWhiteSpace(dto.Subject))
            return BadRequest(new { success = false, message = "Konu seçimi zorunludur." });

        if (string.IsNullOrWhiteSpace(dto.Phone))
            return BadRequest(new { success = false, message = "Telefon numarası alanı zorunludur." });

        var cleanedPhone = new string(dto.Phone.Where(char.IsDigit).ToArray());
        if (cleanedPhone.Length != 11)
            return BadRequest(new { success = false, message = "Telefon numarası tam olarak 11 haneli olmalıdır." });

        if (string.IsNullOrWhiteSpace(dto.Message))
            return BadRequest(new { success = false, message = "Mesaj alanı zorunludur." });

        try
        {
            var entity = new ContactMessageEntity
            {
                Id = Guid.NewGuid(),
                FullName = dto.FullName.Trim(),
                Email = dto.Email.Trim().ToLowerInvariant(),
                Phone = cleanedPhone,
                Subject = dto.Subject.Trim(),
                Message = dto.Message.Trim(),
                CreatedAt = DateTime.UtcNow,
                IsRead = false
            };

            await _repo.AddAsync(entity, cancellationToken);

            return Ok(new { success = true, message = "Mesajınız başarıyla iletildi. En kısa sürede dönüş yapacağız." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, message = "Mesaj gönderilirken bir hata oluştu.", error = ex.Message });
        }
    }
}
