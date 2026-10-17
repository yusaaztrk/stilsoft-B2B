using System;
using System.Threading;
using System.Threading.Tasks;
using EmailService.Application.Abstractions;
using EmailService.Domain.Entities;
using EmailService.Domain.Repositories;
using MediatR;

namespace EmailService.Application.Features.TenantSmtpConfigs;

public record SaveTenantSmtpConfigCommand(
    string TenantId,
    string Host,
    int Port,
    string Username,
    string Password,
    bool EnableSsl,
    string SenderName,
    string SenderEmail
) : IRequest<Guid>;

public class SaveTenantSmtpConfigCommandHandler : IRequestHandler<SaveTenantSmtpConfigCommand, Guid>
{
    private readonly ITenantSmtpConfigRepository _repository;
    private readonly IEncryptionService _encryptionService;
    private readonly IUnitOfWork _unitOfWork;

    public SaveTenantSmtpConfigCommandHandler(
        ITenantSmtpConfigRepository repository,
        IEncryptionService encryptionService,
        IUnitOfWork unitOfWork)
    {
        _repository = repository;
        _encryptionService = encryptionService;
        _unitOfWork = unitOfWork;
    }

    public async Task<Guid> Handle(SaveTenantSmtpConfigCommand request, CancellationToken cancellationToken)
    {
        var existing = await _repository.GetByTenantIdAsync(request.TenantId);
        
        string encryptedPassword = _encryptionService.Encrypt(request.Password);

        if (existing == null)
        {
            var config = new TenantSmtpConfig(
                request.TenantId,
                request.Host,
                request.Port,
                request.Username,
                encryptedPassword,
                request.EnableSsl,
                request.SenderName,
                request.SenderEmail
            );

            await _repository.AddAsync(config);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            return config.Id;
        }
        else
        {
            existing.Update(
                request.Host,
                request.Port,
                request.Username,
                encryptedPassword,
                request.EnableSsl,
                request.SenderName,
                request.SenderEmail
            );

            _repository.Update(existing);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            return existing.Id;
        }
    }
}
