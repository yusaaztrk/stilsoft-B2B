using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// DÖVİZ ÇEVRİM KODU (2026-08-17, kullanıcı isteği: "raporlar güzel bir kod tarzında olsun,
/// ileride genel muhasebede farklar çıkmasın").
///
/// <para>
/// Gelen para hesabın para biriminden farklıysa (1.000 $ → TL kasa) hareket iki uçlu olur:
/// kasa/banka hareketi ve onun cari ekstresindeki karşılığı. İkisi de AYNI kodu taşır
/// (<c>DVZ-2026-000001</c>), böylece muhasebeci "bu TL satırı aslında hangi dövizden geldi"
/// sorusunu tek kodla cevaplar; ekstredeki döviz kolonları da kod üzerinden eşleştirilir.
/// Çevrim yoksa kod verilmez — kodun VARLIĞI zaten "burada çevrim var" demektir.
/// </para>
///
/// <para>
/// Sayaç, kasa/banka belge numarasındaki desenin aynısı: tek
/// <c>INSERT ... ON CONFLICT ... RETURNING</c> ifadesiyle atomik. Oku-artır-yaz kullanılsaydı
/// eşzamanlı iki tahsilat aynı kodu alırdı.
/// </para>
/// </summary>
public static class ExchangeCodeGenerator
{
    /// <summary>
    /// Yıl bazlı sıradaki çevrim kodunu üretir. Sayaç tablosuna erişilemezse <c>null</c> döner:
    /// kod uğruna tahsilatı düşürmek, koda sahip olmamaktan daha kötüdür.
    /// </summary>
    public static async Task<string?> NextAsync(AppDbContext dbContext, DateTime date, CancellationToken cancellationToken)
    {
        var year = date == default ? DateTime.UtcNow.Year : date.Year;
        var seriesKey = $"exchange:{year}";

        try
        {
            var rows = await dbContext.Database
                .SqlQueryRaw<long>(
                    @"INSERT INTO ""NumberSeries"" (""Key"", ""LastValue"") VALUES ({0}, 1)
                      ON CONFLICT (""Key"") DO UPDATE SET ""LastValue"" = ""NumberSeries"".""LastValue"" + 1
                      RETURNING ""LastValue"" AS ""Value""", seriesKey)
                .ToListAsync(cancellationToken);

            if (rows.Count > 0 && rows[0] > 0)
            {
                return $"DVZ-{year}-{rows[0]:000000}";
            }
        }
        catch
        {
            // Sayaç tablosu yoksa/erişilemezse kodsuz devam edilir.
        }

        return null;
    }
}
