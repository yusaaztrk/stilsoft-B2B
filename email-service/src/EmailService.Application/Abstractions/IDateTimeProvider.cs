using System;

namespace EmailService.Application.Abstractions;

public interface IDateTimeProvider
{
    DateTime UtcNow { get; }
}
