using System;
using EmailService.Application.Abstractions;

namespace EmailService.Infrastructure.Providers;

public class DateTimeProvider : IDateTimeProvider
{
    public DateTime UtcNow => DateTime.UtcNow;
}
