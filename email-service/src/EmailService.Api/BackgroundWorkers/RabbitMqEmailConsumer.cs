using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using EmailService.Application.Events;
using EmailService.Application.Features.Emails;
using MediatR;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace EmailService.Api.BackgroundWorkers;

public class RabbitMqEmailConsumer : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IConfiguration _configuration;
    private readonly ILogger<RabbitMqEmailConsumer> _logger;

    private readonly string _hostName;
    private readonly string _userName;
    private readonly string _password;
    private readonly int _port;
    private readonly string _queueName = "email.send-request";

    private IConnection? _connection;
    private IChannel? _channel;

    public RabbitMqEmailConsumer(
        IServiceProvider serviceProvider, 
        IConfiguration configuration,
        ILogger<RabbitMqEmailConsumer> logger)
    {
        _serviceProvider = serviceProvider;
        _configuration = configuration;
        _logger = logger;

        _hostName = configuration["RabbitMq:Host"] ?? "localhost";
        _userName = configuration["RabbitMq:Username"] ?? "guest";
        _password = configuration["RabbitMq:Password"] ?? "guest";
        _port = int.TryParse(configuration["RabbitMq:Port"], out var port) ? port : 5672;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("RabbitMQ Email Consumer Background Service starting...");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var factory = new ConnectionFactory
                {
                    HostName = _hostName,
                    UserName = _userName,
                    Password = _password,
                    Port = _port
                };

                _connection = await factory.CreateConnectionAsync(stoppingToken);
                _channel = await _connection.CreateChannelAsync(cancellationToken: stoppingToken);

                var dlxExchange = "email.dlx";
                var dlqName = "email.send-request.dlq";
                var dlqRoutingKey = "email.send.failed";
                
                await _channel.ExchangeDeclareAsync(dlxExchange, ExchangeType.Direct, durable: true, autoDelete: false, cancellationToken: stoppingToken);
                await _channel.QueueDeclareAsync(dlqName, durable: true, exclusive: false, autoDelete: false, cancellationToken: stoppingToken);
                await _channel.QueueBindAsync(dlqName, dlxExchange, dlqRoutingKey, cancellationToken: stoppingToken);

                var exchangeName = "email.exchange";
                var routingKey = "email.send";
                await _channel.ExchangeDeclareAsync(exchangeName, ExchangeType.Direct, durable: true, autoDelete: false, cancellationToken: stoppingToken);

                var arguments = new Dictionary<string, object?>
                {
                    { "x-dead-letter-exchange", dlxExchange },
                    { "x-dead-letter-routing-key", dlqRoutingKey }
                };

                await _channel.QueueDeclareAsync(_queueName, durable: true, exclusive: false, autoDelete: false, arguments: arguments, cancellationToken: stoppingToken);
                await _channel.QueueBindAsync(_queueName, exchangeName, routingKey, cancellationToken: stoppingToken);

                var consumer = new AsyncEventingBasicConsumer(_channel);
                consumer.ReceivedAsync += async (sender, eventArgs) =>
                {
                    var deliveryTag = eventArgs.DeliveryTag;
                    try
                    {
                        var body = eventArgs.Body.ToArray();
                        var json = Encoding.UTF8.GetString(body);
                        var emailEvent = JsonSerializer.Deserialize<SendEmailEvent>(json);

                        if (emailEvent != null)
                        {
                            using var scope = _serviceProvider.CreateScope();
                            var mediator = scope.ServiceProvider.GetRequiredService<IMediator>();

                            Guid emailMessageId;
                            if (emailEvent.EmailMessageId.HasValue)
                            {
                                emailMessageId = emailEvent.EmailMessageId.Value;
                            }
                            else
                            {
                                var queueCommand = new QueueEmailCommand(
                                    emailEvent.TenantId,
                                    emailEvent.Recipient,
                                    emailEvent.Subject,
                                    emailEvent.Body,
                                    TemplateName: null,
                                    TemplateData: null,
                                    Attachments: emailEvent.Attachments,
                                    ScheduledFor: emailEvent.ScheduledFor,
                                    PublishEvent: false
                                );
                                emailMessageId = await mediator.Send(queueCommand, CancellationToken.None);
                            }

                            var success = await mediator.Send(new ProcessEmailSendingCommand(emailMessageId), CancellationToken.None);

                            if (success)
                            {
                                await _channel.BasicAckAsync(deliveryTag, multiple: false);
                            }
                            else
                            {
                                _logger.LogWarning("Email sending failed for ID {EmailMessageId}. Routing message to Dead Letter Queue.", emailMessageId);
                                await _channel.BasicNackAsync(deliveryTag, multiple: false, requeue: false);
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error occurred while processing message with delivery tag {DeliveryTag}.", deliveryTag);
                        await _channel.BasicNackAsync(deliveryTag, multiple: false, requeue: false);
                    }
                };

                await _channel.BasicConsumeAsync(
                    queue: _queueName,
                    autoAck: false,
                    consumer: consumer,
                    cancellationToken: stoppingToken
                );

                _logger.LogInformation("RabbitMQ Email Consumer is actively listening on queue '{QueueName}'.", _queueName);

                await Task.Delay(Timeout.Infinite, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "RabbitMQ connection lost. Retrying in 10 seconds...");
                await Task.Delay(10000, stoppingToken);
            }
            finally
            {
                await CleanupAsync();
            }
        }
    }

    private async Task CleanupAsync()
    {
        try
        {
            if (_channel != null) await _channel.CloseAsync();
            if (_connection != null) await _connection.CloseAsync();
        }
        catch
        {
            // Suppress cleanup errors
        }
        _channel = null;
        _connection = null;
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("RabbitMQ Email Consumer Background Service stopping...");
        await CleanupAsync();
        await base.StopAsync(cancellationToken);
    }
}
