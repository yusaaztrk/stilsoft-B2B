namespace B2B.Erp.Api.DTOs.Assistant;

public sealed class AssistantChatResponse
{
    public bool Success { get; set; }

    public string Answer { get; set; } = string.Empty;

    public string? Error { get; set; }
}
