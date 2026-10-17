using Asistan.Api.Infrastructure;
using Npgsql;

namespace Asistan.Api.Messaging;

public sealed record CustomerMatch(string CustomerCode, string Name);

/// <summary>
/// WhatsApp numarasından ERP carisini bulur — YALNIZ OKUMA.
///
/// Carilerde telefon serbest metin: "0533 251 2556", "+90 533…", "5332512556". WhatsApp ise
/// numarayı ülke koduyla, yalnız rakam verir ("905332512556"). İkisi de rakamlara indirilip
/// SON 10 HANE karşılaştırılır (KKTC ve TR cep numaraları 10 hane).
///
/// Alt hesaplar (120-01-000003-1/-2/-3) ana carinin telefonunu taşıyor; sayılsalar tek kişi
/// "4 cari" görünürdü. Yalnız ana cari kodları (üç parça) eşleşir. Bkz. cari alt hesap kuralı.
///
/// Numara birden çok ana cariye kayıtlıysa (üyesiz e-ticaret siparişlerinde aynı numaraya ayrı
/// cari açılıyor) hepsi döner; ekranda "n cari" yazar, asistan ileride hepsine bakar.
/// </summary>
public sealed class ErpCustomerLookup
{
    private readonly TenantDb _db;
    private readonly ILogger<ErpCustomerLookup> _log;

    public ErpCustomerLookup(TenantDb db, ILogger<ErpCustomerLookup> log)
    {
        _db = db;
        _log = log;
    }

    public static string? Last10(string? phone)
    {
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        return digits.Length >= 10 ? digits[^10..] : null;
    }

    public async Task<List<CustomerMatch>> FindByPhoneAsync(string tenantCode, string waId, CancellationToken ct)
    {
        var key = Last10(waId);
        if (key is null) return new List<CustomerMatch>();

        try
        {
            await using var conn = new NpgsqlConnection(_db.ErpConnectionString(tenantCode));
            await conn.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand("""
                SELECT "CustomerCode", COALESCE("Name", '')
                FROM public."Customers"
                WHERE "IsActive" = true
                  AND "CustomerCode" !~ '^[^-]+-[^-]+-[^-]+-[^-]+$'
                  AND right(regexp_replace(COALESCE("Phone", ''), '\D', '', 'g'), 10) = @key
                ORDER BY "CustomerCode"
                LIMIT 20
                """, conn);
            cmd.Parameters.AddWithValue("key", key);

            var list = new List<CustomerMatch>();
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) list.Add(new CustomerMatch(r.GetString(0), r.GetString(1)));
            return list;
        }
        catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException)
        {
            // Eşleşme süs: ERP'ye ulaşılamıyorsa mesaj yine kaydedilir, cari boş kalır.
            _log.LogWarning(ex, "Cari eşleşmesi yapılamadı ({Tenant})", tenantCode);
            return new List<CustomerMatch>();
        }
    }
}
