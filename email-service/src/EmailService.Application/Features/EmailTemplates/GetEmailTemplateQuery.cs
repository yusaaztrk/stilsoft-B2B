using System;
using System.Threading;
using System.Threading.Tasks;
using EmailService.Domain.Repositories;
using MediatR;

namespace EmailService.Application.Features.EmailTemplates;

public record GetEmailTemplateQuery(string TenantId, string TemplateName) : IRequest<EmailTemplateQueryResult?>;

public record EmailTemplateQueryResult(
    Guid Id,
    string TenantId,
    string Name,
    string SubjectTemplate,
    string BodyTemplate,
    DateTime CreatedAt,
    DateTime? UpdatedAt
);

public class GetEmailTemplateQueryHandler : IRequestHandler<GetEmailTemplateQuery, EmailTemplateQueryResult?>
{
    private readonly IEmailTemplateRepository _repository;

    public GetEmailTemplateQueryHandler(IEmailTemplateRepository repository)
    {
        _repository = repository;
    }

    public async Task<EmailTemplateQueryResult?> Handle(GetEmailTemplateQuery request, CancellationToken cancellationToken)
    {
        var template = await _repository.GetByNameAsync(request.TenantId, request.TemplateName);
        if (template == null) return null;

        return new EmailTemplateQueryResult(
            template.Id,
            template.TenantId,
            template.Name,
            template.SubjectTemplate,
            template.BodyTemplate,
            template.CreatedAt,
            template.UpdatedAt
        );
    }
}
