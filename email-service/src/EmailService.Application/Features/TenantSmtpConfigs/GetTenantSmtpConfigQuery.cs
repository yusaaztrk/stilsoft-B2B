using System;
using System.Threading;
using System.Threading.Tasks;
using EmailService.Domain.Repositories;
using MediatR;

namespace EmailService.Application.Features.TenantSmtpConfigs;

public record GetTenantSmtpConfigQuery(string TenantId) : IRequest<TenantSmtpConfigQueryResult?>;

public record TenantSmtpConfigQueryResult(
    Guid Id,
    string TenantId,
    string Host,
    int Port,
    string Username,
    bool EnableSsl,
    string SenderName,
    string SenderEmail,
    DateTime CreatedAt,
    DateTime? UpdatedAt
);

public class GetTenantSmtpConfigQueryHandler : IRequestHandler<GetTenantSmtpConfigQuery, TenantSmtpConfigQueryResult?>
{
    private readonly ITenantSmtpConfigRepository _repository;

    public GetTenantSmtpConfigQueryHandler(ITenantSmtpConfigRepository repository)
    {
        _repository = repository;
    }

    public async Task<TenantSmtpConfigQueryResult?> Handle(GetTenantSmtpConfigQuery request, CancellationToken cancellationToken)
    {
        var config = await _repository.GetByTenantIdAsync(request.TenantId);
        if (config == null) return null;

        return new TenantSmtpConfigQueryResult(
            config.Id,
            config.TenantId,
            config.Host,
            config.Port,
            config.Username,
            config.EnableSsl,
            config.SenderName,
            config.SenderEmail,
            config.CreatedAt,
            config.UpdatedAt
        );
    }
}
