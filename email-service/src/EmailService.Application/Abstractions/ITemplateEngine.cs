namespace EmailService.Application.Abstractions;

public interface ITemplateEngine
{
    string Render(string templateContent, object context);
}
