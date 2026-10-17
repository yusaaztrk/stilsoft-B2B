using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace B2B.Erp.Api.Middleware;

/// <summary>
/// Recovers the tenant for a 3D secure callback from the callback URL itself.
///
/// Every other request identifies its tenant with the X-Tenant-Code header or the TenantId
/// claim on the bearer token. A 3D callback has neither: the browser posts the bank's form
/// straight to an anonymous endpoint, with no header we control and no token. Without a
/// tenant, TenantConnectionStringResolver falls back to the default database, the payment row
/// written at initiation into the tenant database is not there, and the callback is rejected
/// with "Ödeme kaydı bulunamadı" — after the bank has already authorized the card.
///
/// So the tenant is placed in the URL handed to the bank as successurl/errorurl
/// (/api/virtual-pos/callback-3d/{tenantCode}) and read back off the path here. This runs as
/// middleware rather than inside the controller action because AppDbContext resolves its
/// connection string when the controller is activated, which is before any action code runs —
/// setting the header from the action would already be too late.
/// </summary>
public sealed class VirtualPosCallbackTenantMiddleware
{
    private const string CallbackPathPrefix = "/api/virtual-pos/callback-3d/";
    private const string TenantHeader = "X-Tenant-Code";

    private readonly RequestDelegate _next;

    public VirtualPosCallbackTenantMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? string.Empty;

        if (path.StartsWith(CallbackPathPrefix, StringComparison.OrdinalIgnoreCase))
        {
            // Only the segment immediately after the prefix. Anything deeper is not a shape we
            // issue, and treating it as a tenant code would let an attacker aim the callback at
            // a database of their choosing by appending segments.
            var remainder = path.Substring(CallbackPathPrefix.Length).Trim('/');

            if (remainder.Length > 0 && !remainder.Contains('/') && IsWellFormedTenantCode(remainder))
            {
                // An explicit header wins: it can only come from our own code (the bank cannot
                // set one), and overwriting it would break a caller that already knows better.
                if (!context.Request.Headers.ContainsKey(TenantHeader))
                {
                    context.Request.Headers[TenantHeader] = remainder;
                }
            }
        }

        await _next(context);
    }

    /// <summary>
    /// The value goes into a database name, so it is constrained to the characters a tenant
    /// code is actually made of rather than merely escaped. An unknown-but-well-formed code
    /// resolves to a database that does not exist and the callback fails closed; a malformed
    /// one never reaches the resolver at all.
    /// </summary>
    private static bool IsWellFormedTenantCode(string value)
        => value.Length <= 40 && value.All(c => char.IsLetterOrDigit(c) || c == '_' || c == '-');
}
