using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// AÇIK HESAP FATURA NUMARASI — ATOMİK ÜRETİM.
///
/// <para>
/// Resmi faturanın numarası kullanıcı tarafından el ile girilir; açık hesap faturasının
/// numarasını ise sistem üretir. Bu üretim iki ayrı yolda (satış faturası ve proformadan
/// aktarım) <c>"1" ile başlayan bütün fatura numaralarını RAM'e çek → en büyüğünü bul → +1</c>
/// şeklinde yapılıyordu. İki sorun birden vardı:
/// </para>
///
/// <list type="number">
///   <item>
///     <b>Yarış durumu.</b> Aynı anda fatura kesen iki kullanıcı aynı en büyük değeri okuyup
///     AYNI numarayı üretiyordu. <c>Invoices.InvoiceNo</c> üzerinde tekil indeks olduğu için
///     ikincisi <c>23505 unique violation</c> ile düşüyordu: veri bozulmuyor ama kasiyer
///     anlamsız bir hatayla karşılaşıyor ve faturayı yeniden kesmek zorunda kalıyordu.
///   </item>
///   <item>
///     <b>O(N) bellek.</b> Fatura sayısı arttıkça her fatura kesiminde bütün numaralar
///     belleğe yükleniyordu.
///   </item>
/// </list>
///
/// <para>
/// Çözüm, bu kod tabanında zaten kullanılan desenin aynısı (kasa/banka belge numarası,
/// irsaliye numarası): tek bir <c>INSERT ... ON CONFLICT ... RETURNING</c> ifadesiyle sayaç
/// veritabanı seviyesinde kilitlenir. Sayaç ilk kullanımda mevcut en büyük numaradan
/// başlatılır ki eski faturalarla çakışmasın; en büyük değer de SQL tarafında hesaplanır.
/// </para>
/// </summary>
public static class OpenInvoiceNumberAllocator
{
    /// <summary>Toplam fatura numarası uzunluğu (seri dahil).</summary>
    private const int TotalLength = 15;

    /// <summary>
    /// Verilen seri için bir sonraki açık hesap fatura numarasını üretir (ör. <c>1</c> → 15 haneli).
    /// Üretilen numara kullanımdaysa (eski veriden kaynaklı boşluk/çakışma) bir sonrakine geçilir.
    /// </summary>
    public static async Task<string> NextAsync(
        AppDbContext dbContext,
        string openSerie,
        CancellationToken cancellationToken = default)
    {
        var serie = string.IsNullOrWhiteSpace(openSerie) ? "1" : openSerie.Trim();
        var digits = TotalLength - serie.Length;
        var seriesKey = $"invoice:open:{serie}";

        var currentMax = await CurrentMaxAsync(dbContext, serie, cancellationToken);

        // Sayaç YOKSA mevcut en büyükten başlat; varsa dokunma.
        try
        {
            await dbContext.Database.ExecuteSqlRawAsync(
                @"INSERT INTO ""NumberSeries"" (""Key"", ""LastValue"") VALUES ({0}, {1})
                  ON CONFLICT (""Key"") DO NOTHING",
                seriesKey, currentMax);
        }
        catch
        {
            // Sayaç tablosuna erişilemiyorsa aşağıdaki yedek yola düşülür.
        }

        // En fazla birkaç deneme: sayaçtan alınan numara eski veride kullanılmışsa ilerlenir.
        for (var attempt = 0; attempt < 25; attempt++)
        {
            long next;
            try
            {
                var rows = await dbContext.Database
                    .SqlQueryRaw<long>(
                        @"INSERT INTO ""NumberSeries"" (""Key"", ""LastValue"") VALUES ({0}, 1)
                          ON CONFLICT (""Key"") DO UPDATE SET ""LastValue"" = ""NumberSeries"".""LastValue"" + 1
                          RETURNING ""LastValue"" AS ""Value""", seriesKey)
                    .ToListAsync(cancellationToken);

                if (rows.Count == 0 || rows[0] <= 0) break;
                next = rows[0];
            }
            catch
            {
                break;
            }

            var candidate = serie + next.ToString().PadLeft(digits, '0');

            var exists = await dbContext.Set<Invoice>()
                .AsNoTracking()
                .AnyAsync(x => x.InvoiceNo == candidate, cancellationToken);

            if (!exists) return candidate;
        }

        // YEDEK YOL: sayaç kullanılamadıysa eski davranış (en büyük + 1). Faturayı hiç
        // kesememektense küçük bir yarış riskini kabul etmek daha iyidir.
        return serie + (currentMax + 1).ToString().PadLeft(digits, '0');
    }

    /// <summary>
    /// Seriye ait en büyük numarayı SQL tarafında hesaplar (bütün numaraları belleğe
    /// yüklemeden). Sayısal olmayan kuyruklar süzülür.
    /// </summary>
    private static async Task<long> CurrentMaxAsync(
        AppDbContext dbContext,
        string serie,
        CancellationToken cancellationToken)
    {
        try
        {
            var rows = await dbContext.Database
                .SqlQueryRaw<long>(
                    @"SELECT COALESCE(MAX(CAST(SUBSTRING(""InvoiceNo"" FROM {0} + 1) AS bigint)), 0) AS ""Value""
                      FROM ""Invoices""
                      WHERE LENGTH(""InvoiceNo"") = {1}
                        AND LEFT(""InvoiceNo"", {0}) = {2}
                        AND SUBSTRING(""InvoiceNo"" FROM {0} + 1) ~ '^[0-9]+$'",
                    serie.Length, TotalLength, serie)
                .ToListAsync(cancellationToken);

            if (rows.Count > 0) return rows[0];
        }
        catch
        {
            // Ham SQL çalışmazsa (sağlayıcı farkı) aşağıdaki taşınabilir yola düşülür.
        }

        var numbers = await dbContext.Set<Invoice>()
            .AsNoTracking()
            .Where(x => x.InvoiceNo.StartsWith(serie) && x.InvoiceNo.Length == TotalLength)
            .Select(x => x.InvoiceNo)
            .ToListAsync(cancellationToken);

        long max = 0;
        foreach (var no in numbers)
        {
            if (string.IsNullOrWhiteSpace(no) || no.Length != TotalLength) continue;
            if (long.TryParse(no.Substring(serie.Length), out var n) && n > max) max = n;
        }

        return max;
    }
}
