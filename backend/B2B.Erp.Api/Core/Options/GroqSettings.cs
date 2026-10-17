namespace B2B.Erp.Api.Core.Options;

public sealed class GroqSettings
{
    public string BaseUrl { get; set; } = "https://api.groq.com/openai/v1";

    public string ApiKey { get; set; } = string.Empty;

    public string Model { get; set; } = "llama-3.3-70b-versatile";
}
