using System;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using EmailService.Application.Abstractions;
using EmailService.Application.Events;
using Microsoft.Extensions.Configuration;
using RabbitMQ.Client;

namespace EmailService.Infrastructure.Messaging;

public class RabbitMqEmailEventPublisher : IEmailEventPublisher, IAsyncDisposable
{
    private readonly string _hostName;
    private readonly string _userName;
    private readonly string _password;
    private readonly int _port;
    private readonly string _exchangeName = "email.exchange";
    private readonly string _queueName = "email.send-request";
    private readonly string _routingKey = "email.send";
    
    private readonly string _dlxExchange = "email.dlx";
    private readonly string _dlqName = "email.send-request.dlq";
    private readonly string _dlqRoutingKey = "email.send.failed";

    private IConnection? _connection;
    private IChannel? _channel;
    private readonly object _lock = new();

    public RabbitMqEmailEventPublisher(IConfiguration configuration)
    {
        _hostName = configuration["RabbitMq:Host"] ?? "localhost";
        _userName = configuration["RabbitMq:Username"] ?? "guest";
        _password = configuration["RabbitMq:Password"] ?? "guest";
        _port = int.TryParse(configuration["RabbitMq:Port"], out var port) ? port : 5672;
    }

    private async Task InitializeAsync()
    {
        if (_channel != null) return;

        var factory = new ConnectionFactory
        {
            HostName = _hostName,
            UserName = _userName,
            Password = _password,
            Port = _port
        };

        _connection = await factory.CreateConnectionAsync();
        _channel = await _connection.CreateChannelAsync();

        // 1. Declare DLX (Dead Letter Exchange) and DLQ
        await _channel.ExchangeDeclareAsync(_dlxExchange, ExchangeType.Direct, durable: true, autoDelete: false);
        await _channel.QueueDeclareAsync(_dlqName, durable: true, exclusive: false, autoDelete: false);
        await _channel.QueueBindAsync(_dlqName, _dlxExchange, _dlqRoutingKey);

        // 2. Declare Main Exchange and Queue with DLX configuration
        await _channel.ExchangeDeclareAsync(_exchangeName, ExchangeType.Direct, durable: true, autoDelete: false);
        
        var arguments = new System.Collections.Generic.Dictionary<string, object?>
        {
            { "x-dead-letter-exchange", _dlxExchange },
            { "x-dead-letter-routing-key", _dlqRoutingKey }
        };

        await _channel.QueueDeclareAsync(_queueName, durable: true, exclusive: false, autoDelete: false, arguments: arguments);
        await _channel.QueueBindAsync(_queueName, _exchangeName, _routingKey);
    }

    public async Task PublishSendEmailAsync(SendEmailEvent sendEvent)
    {
        await InitializeAsync();

        var json = JsonSerializer.Serialize(sendEvent);
        var body = Encoding.UTF8.GetBytes(json);

        var properties = new BasicProperties
        {
            Persistent = true,
            ContentType = "application/json"
        };

        await _channel!.BasicPublishAsync(
            exchange: _exchangeName,
            routingKey: _routingKey,
            mandatory: true,
            basicProperties: properties,
            body: body
        );
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (_channel != null)
            {
                await _channel.CloseAsync();
            }

            if (_connection != null)
            {
                await _connection.CloseAsync();
            }
        }
        catch
        {
            // Suppress dispose errors
        }
    }
}
