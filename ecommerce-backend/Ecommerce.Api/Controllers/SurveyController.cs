using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
public sealed class SurveyController : ControllerBase
{
    private readonly SurveyRepository _repo;

    public SurveyController(SurveyRepository repo)
    {
        _repo = repo;
    }

    [HttpGet("api/survey/questions")]
    public async Task<IActionResult> GetQuestions(CancellationToken cancellationToken)
    {
        var questions = await _repo.GetQuestionsAsync(cancellationToken);
        return Ok(new { success = true, data = questions });
    }

    public sealed class SubmitResponseRequest
    {
        public string Name { get; set; } = "";
        public string Email { get; set; } = "";
        public string Phone { get; set; } = "";
        public string AnswersJson { get; set; } = ""; // JSON string containing mapped answers
    }

    [HttpPost("api/survey/responses")]
    public async Task<IActionResult> SubmitResponse([FromBody] SubmitResponseRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { success = false, message = "Ad soyad alanı zorunludur." });
        if (string.IsNullOrWhiteSpace(request.Email))
            return BadRequest(new { success = false, message = "E-posta alanı zorunludur." });
        if (string.IsNullOrWhiteSpace(request.Phone))
            return BadRequest(new { success = false, message = "Telefon numarası alanı zorunludur." });
        if (string.IsNullOrWhiteSpace(request.AnswersJson))
            return BadRequest(new { success = false, message = "Cevaplar boş olamaz." });

        var responseDto = new SurveyResponseDto
        {
            Name = request.Name,
            Email = request.Email,
            Phone = request.Phone,
            AnswersJson = request.AnswersJson
        };

        await _repo.SaveResponseAsync(responseDto, cancellationToken);
        return Ok(new { success = true, message = "Memnuniyet anketiniz başarıyla gönderildi. Katılımınız için teşekkür ederiz." });
    }

    [HttpGet("api/admin/survey/responses")]
    [Authorize(Roles = "Owner,Admin")]
    public async Task<IActionResult> GetResponses(CancellationToken cancellationToken)
    {
        var responses = await _repo.GetResponsesAsync(cancellationToken);
        var allQuestions = await _repo.GetAllQuestionsAsync(cancellationToken);
        return Ok(new { success = true, data = responses, allQuestions = allQuestions });
    }

    [HttpPut("api/admin/survey/questions")]
    [Authorize(Roles = "Owner,Admin")]
    public async Task<IActionResult> SaveQuestions([FromBody] List<SurveyQuestion> questions, CancellationToken cancellationToken)
    {
        await _repo.SaveQuestionsAsync(questions, cancellationToken);
        return Ok(new { success = true, message = "Anket soruları başarıyla kaydedildi.", data = questions });
    }
}
