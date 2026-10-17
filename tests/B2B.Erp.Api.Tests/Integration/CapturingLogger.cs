using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Microsoft.Extensions.Logging;

namespace B2B.Erp.Api.Tests.Integration;

/// <summary>
/// Keeps the last log entries so a test can assert on — or report — why the accounting
/// service deferred a posting. The service is designed to swallow database errors and leave
/// the payment successful, which is the right production behaviour but hides the cause;
/// this makes the structured detail it logs visible to the test run.
/// </summary>
public sealed class CapturingLogger<T> : ILogger<T>
{
    private readonly ConcurrentQueue<string> _entries = new();

    public IReadOnlyCollection<string> Entries => _entries;

    public string LastError { get; private set; } = string.Empty;

    public void Clear()
    {
        while (_entries.TryDequeue(out _)) { }
        LastError = string.Empty;
    }

    public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        var message = formatter(state, exception);
        if (exception != null) message += " | " + exception.GetType().Name + ": " + exception.Message;

        _entries.Enqueue($"[{logLevel}] {message}");

        if (logLevel >= LogLevel.Error) LastError = message;
    }

    private sealed class NullScope : IDisposable
    {
        public static readonly NullScope Instance = new();
        public void Dispose() { }
    }
}
