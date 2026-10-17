using System;
using System.Threading;
using System.Threading.Tasks;
using EmailService.Domain.Entities;
using EmailService.Domain.Repositories;
using MediatR;

namespace EmailService.Application.Features.EmailTemplates;

public record SaveEmailTemplateCommand(
    string TenantId,
    string Name,
    string SubjectTemplate,
    string BodyTemplate
) : IRequest<Guid>;

public class SaveEmailTemplateCommandHandler : IRequestHandler<SaveEmailTemplateCommand, Guid>
{
    private readonly IEmailTemplateRepository _repository;
    private readonly IUnitOfWork _unitOfWork;

    public SaveEmailTemplateCommandHandler(
        IEmailTemplateRepository repository,
        IUnitOfWork unitOfWork)
    {
        _repository = repository;
        _unitOfWork = unitOfWork;
    }

    public async Task<Guid> Handle(SaveEmailTemplateCommand request, CancellationToken cancellationToken)
    {
        var existing = await _repository.GetByNameAsync(request.TenantId, request.Name);

        if (existing == null)
        {
            var template = new EmailTemplate(
                request.TenantId,
                request.Name,
                request.SubjectTemplate,
                request.BodyTemplate
            );

            await _repository.AddAsync(template);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            return template.Id;
        }
        else
        {
            existing.Update(request.SubjectTemplate, request.BodyTemplate);
            _repository.Update(existing);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            return existing.Id;
        }
    }
}
