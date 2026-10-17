namespace B2B.Erp.Api.DTOs.Assistant;

public sealed class AssistantChatRequest
{
    public string PageKey { get; set; } = string.Empty;

    public string PageTitle { get; set; } = string.Empty;

    public string PageDescription { get; set; } = string.Empty;

    public string Question { get; set; } = string.Empty;
}
