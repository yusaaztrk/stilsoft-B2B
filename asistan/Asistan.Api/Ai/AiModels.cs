namespace Asistan.Api.Ai;

/// <summary>
/// "Ai" bölümü (appsettings). Anahtar GİZLİ: yalnız sunucudaki appsettings.Local.json'a yazılır,
/// git'e ve pakete girmez.
/// </summary>
public sealed class AiOptions
{
    /// <summary>
    /// Hangi yapay zekâ: "" (kapalı — gelen kutusu yine çalışır), "claude", "fake" (yalnız deneme).
    /// Model kararı henüz verilmedi; ileride başka sağlayıcı (ör. OpenAI) eklenirse yalnız bu değer değişir.
    /// Development'ta boş bırakılırsa "fake" sayılır.
    /// </summary>
    public string Provider { get; set; } = string.Empty;
    public string ApiKey { get; set; } = string.Empty;
    /// <summary>Sağlayıcının model adı. OpenAI: gpt-5.6-luna (varsayılan) / gpt-5.6-terra. Claude seçilirse claude-… adı yazılmalı.</summary>
    public string Model { get; set; } = "gpt-5.6-luna";
    /// <summary>low | medium | high. Sınıflandırma + kısa taslak için low yeterli; kalite düşük gelirse medium.</summary>
    public string Effort { get; set; } = "low";
    /// <summary>Müşteri art arda yazınca her mesaja ayrı çağrı yapılmasın: son mesajdan sonra bu kadar beklenir.</summary>
    public int DebounceSeconds { get; set; } = 4;
    /// <summary>Asistana gösterilen son mesaj sayısı.</summary>
    public int HistoryMessages { get; set; } = 20;
    /// <summary>Aynı anda en fazla kaç konuşma işlenir.</summary>
    public int MaxParallel { get; set; } = 3;
    /// <summary>Firma saati (taslakta "şimdi" ve mesaj saatleri bu dilimde gösterilir).</summary>
    public string TimeZone { get; set; } = "Europe/Istanbul";

    public bool HasKey => !string.IsNullOrWhiteSpace(ApiKey);
}

/// <param name="ToolsEnabled">Asistan ERP/Servis kayıtlarına (bakiye, sipariş, fatura, servis/montaj) baksın mı (3. aşama).</param>
public sealed record AiSettings(bool Enabled, bool AutoRoute, string? Instructions, string? InitiativeTopics, bool ToolsEnabled = true);

public sealed record AiDepartment(int Id, string Code, string Name, string? Description);

public sealed record AiTranscriptLine(DateTimeOffset At, string Direction, string? SentBy, string Text);

/// <summary>Asistana giden her şey. Müşteri metni VERİDİR, talimat değil — istem bunu ayrıca söyler.</summary>
public sealed record AiInput(
    string TenantCode,
    string? ContactName,
    string Phone,
    string? CustomerCode,
    string? CustomerName,
    string? CurrentDepartmentName,
    IReadOnlyList<AiTranscriptLine> Transcript,
    IReadOnlyList<AiDepartment> Departments,
    AiSettings Settings,
    DateTimeOffset Now,
    IReadOnlyList<Tools.AiCustomer>? Customers = null,
    Tools.IAiToolSession? Tools = null);

/// <summary>Asistanın kararı. DepartmentCode boş = "henüz belli değil" (ör. yalnız selam).</summary>
public sealed record AiDecision(
    string? DepartmentCode,
    bool Important,
    bool NeedsHuman,
    string Topic,
    string Summary,
    string Reason,
    string Reply,
    string Model,
    int? InputTokens,
    int? OutputTokens)
{
    /// <summary>Asistanın bu kararı verirken baktığı kayıtlar (taslağın yanında personele gösterilir).</summary>
    public IReadOnlyList<Tools.AiToolCall> ToolCalls { get; init; } = Array.Empty<Tools.AiToolCall>();
}

public sealed class AiException : Exception
{
    public AiException(string message, Exception? inner = null) : base(message, inner) { }
}

public interface IAiClassifier
{
    /// <summary>"claude" | "fake" | … ; null = yapılandırılmamış (asistan çalışmaz, gelen kutusu yine çalışır).</summary>
    string? Provider { get; }
    string Model { get; }
    Task<AiDecision> ClassifyAsync(AiInput input, CancellationToken ct);
}
