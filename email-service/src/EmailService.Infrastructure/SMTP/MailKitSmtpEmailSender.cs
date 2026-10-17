using System;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;
using EmailService.Application.Abstractions;
using EmailService.Domain.Entities;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using MimeKit;
using Polly;

namespace EmailService.Infrastructure.SMTP;

public class MailKitSmtpEmailSender : ISmtpEmailSender
{
    private readonly IEncryptionService _encryptionService;
    private readonly ILogger<MailKitSmtpEmailSender> _logger;

    public MailKitSmtpEmailSender(
        IEncryptionService encryptionService,
        ILogger<MailKitSmtpEmailSender> logger)
    {
        _encryptionService = encryptionService;
        _logger = logger;
    }

    public async Task SendAsync(EmailMessage emailMessage, TenantSmtpConfig smtpConfig, CancellationToken cancellationToken = default)
    {
        var message = new MimeMessage();
        
        string senderName = string.IsNullOrWhiteSpace(smtpConfig.SenderName) ? smtpConfig.SenderEmail : smtpConfig.SenderName;
        message.From.Add(new MailboxAddress(senderName, smtpConfig.SenderEmail));
        message.To.Add(MailboxAddress.Parse(emailMessage.Recipient));
        message.Subject = emailMessage.Subject;

        var bodyBuilder = new BodyBuilder
        {
            HtmlBody = emailMessage.Body
        };

        foreach (var attachment in emailMessage.Attachments)
        {
            bodyBuilder.Attachments.Add(
                attachment.FileName, 
                attachment.Content, 
                ContentType.Parse(attachment.ContentType)
            );
        }

        message.Body = bodyBuilder.ToMessageBody();

        // Setup the Polly retry policy for transient SMTP, IO, and Socket exceptions
        var retryPolicy = Policy
            .Handle<SocketException>()
            .Or<IOException>()
            .Or<SmtpCommandException>()
            .Or<SmtpProtocolException>()
            .WaitAndRetryAsync(
                retryCount: 3,
                sleepDurationProvider: attempt => TimeSpan.FromSeconds(Math.Pow(2, attempt) * 2), // 4s, 8s, 16s
                onRetry: (exception, timeSpan, attempt, context) =>
                {
                    _logger.LogWarning(
                        exception,
                        "Transient error sending email {EmailMessageId} on attempt {Attempt}. Retrying in {Delay}s.",
                        emailMessage.Id,
                        attempt,
                        timeSpan.TotalSeconds
                    );
                }
            );

        // Execute the sending process inside the retry policy
        await retryPolicy.ExecuteAsync(async () =>
        {
            using var client = new SmtpClient();

            var socketOptions = smtpConfig.Port == 465 
                ? SecureSocketOptions.SslOnConnect 
                : smtpConfig.EnableSsl 
                    ? SecureSocketOptions.Auto 
                    : SecureSocketOptions.None;

            await client.ConnectAsync(smtpConfig.Host, smtpConfig.Port, socketOptions, cancellationToken);

            if (!string.IsNullOrWhiteSpace(smtpConfig.Username))
            {
                string decryptedPassword = _encryptionService.Decrypt(smtpConfig.EncryptedPassword);
                await client.AuthenticateAsync(smtpConfig.Username, decryptedPassword, cancellationToken);
            }

            await client.SendAsync(message, cancellationToken);
            await client.DisconnectAsync(true, cancellationToken);
        });
    }
}
