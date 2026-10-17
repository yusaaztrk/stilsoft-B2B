using System;
using EmailService.Domain.Common;

namespace EmailService.Domain.Entities;

public class TenantSmtpConfig : Entity
{
    public string TenantId { get; private set; } = string.Empty;
    public string Host { get; private set; } = string.Empty;
    public int Port { get; private set; }
    public string Username { get; private set; } = string.Empty;
    public string EncryptedPassword { get; private set; } = string.Empty;
    public bool EnableSsl { get; private set; }
    public string SenderName { get; private set; } = string.Empty;
    public string SenderEmail { get; private set; } = string.Empty;
    public DateTime CreatedAt { get; private set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; private set; }

    // EF Core constructor
    private TenantSmtpConfig() { }

    public TenantSmtpConfig(
        string tenantId,
        string host,
        int port,
        string username,
        string encryptedPassword,
        bool enableSsl,
        string senderName,
        string senderEmail)
    {
        if (string.IsNullOrWhiteSpace(tenantId))
            throw new ArgumentException("TenantId cannot be empty.", nameof(tenantId));
        if (string.IsNullOrWhiteSpace(host))
            throw new ArgumentException("Host cannot be empty.", nameof(host));
        if (port <= 0 || port > 65535)
            throw new ArgumentOutOfRangeException(nameof(port), "Port must be a valid port number (1-65535).");
        if (string.IsNullOrWhiteSpace(senderEmail))
            throw new ArgumentException("SenderEmail cannot be empty.", nameof(senderEmail));

        TenantId = tenantId;
        Host = host;
        Port = port;
        Username = username;
        EncryptedPassword = encryptedPassword;
        EnableSsl = enableSsl;
        SenderName = senderName;
        SenderEmail = senderEmail;
        CreatedAt = DateTime.UtcNow;
    }

    public void Update(
        string host,
        int port,
        string username,
        string encryptedPassword,
        bool enableSsl,
        string senderName,
        string senderEmail)
    {
        if (string.IsNullOrWhiteSpace(host))
            throw new ArgumentException("Host cannot be empty.", nameof(host));
        if (port <= 0 || port > 65535)
            throw new ArgumentOutOfRangeException(nameof(port), "Port must be a valid port number (1-65535).");
        if (string.IsNullOrWhiteSpace(senderEmail))
            throw new ArgumentException("SenderEmail cannot be empty.", nameof(senderEmail));

        Host = host;
        Port = port;
        Username = username;
        EncryptedPassword = encryptedPassword;
        EnableSsl = enableSsl;
        SenderName = senderName;
        SenderEmail = senderEmail;
        UpdatedAt = DateTime.UtcNow;
    }
}
