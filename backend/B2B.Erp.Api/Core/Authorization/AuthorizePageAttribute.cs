using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Core.Authorization;

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true, Inherited = true)]
public sealed class AuthorizePageAttribute : TypeFilterAttribute
{
    public string ModuleKey { get; }
    public string PageKey { get; }

    public AuthorizePageAttribute(string moduleKey, string pageKey) : base(typeof(B2B.Erp.Api.Core.Authorization.PageAuthorizationFilter))
    {
        ModuleKey = moduleKey;
        PageKey = pageKey;
        Arguments = new object[] { moduleKey, pageKey };
    }
}
