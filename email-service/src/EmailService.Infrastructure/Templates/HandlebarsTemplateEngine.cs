using EmailService.Application.Abstractions;
using HandlebarsDotNet;

namespace EmailService.Infrastructure.Templates;

public class HandlebarsTemplateEngine : ITemplateEngine
{
    public string Render(string templateContent, object context)
    {
        if (string.IsNullOrEmpty(templateContent)) return string.Empty;

        var template = Handlebars.Compile(templateContent);
        return template(context);
    }
}
