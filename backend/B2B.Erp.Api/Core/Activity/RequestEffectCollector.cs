namespace B2B.Erp.Api.Core.Activity;

/// <summary>
/// BİR İSTEK BOYUNCA GERÇEKLEŞEN SONUÇLAR — kullanıcıya geri bildirilmek üzere toplanır.
///
/// <para>
/// <b>Neden var.</b> Kullanıcı "faturayı sildim" diyor ama stoğun geri dönüp dönmediğini,
/// cari ekstrenin düşüp düşmediğini göremiyordu. Elektrik ya da bağlantı kesildiğinde
/// işlemin nereye kadar geldiği de belirsizdi: ekran "başarılı" der, arkada bir şey eksik
/// kalır ve kimse fark etmezdi. Artık her yazma işleminden sonra NE OLDUĞU geri dönüyor.
/// </para>
///
/// <para>
/// Aynı cümleler hareket kaydına da yazılıyor (<see cref="ActivityEffectSummary"/>): ekranda
/// anlık görülen ile kayda geçen AYNI metin. İki ayrı yerde iki ayrı cümle üretilseydi,
/// biri değiştiğinde diğeri sessizce eskir ve "ekranda şöyle yazıyordu ama kayıtta böyle"
/// tartışması çıkardı.
/// </para>
///
/// <para>
/// İstek kapsamlı (scoped) kayıtlıdır: bir istekteki bütün <c>SaveChanges</c> çağrılarının
/// sonuçları burada birikir, yanıt yazılırken tek başlıkta gönderilir.
/// </para>
/// </summary>
public sealed class RequestEffectCollector
{
    /// <summary>
    /// Bir yanıtta taşınacak en fazla sonuç sayısı. Başlık boyutu sunucu ve vekil
    /// sunucularda sınırlıdır (tipik 8-16 KB); 200 kalemlik bir faturanın bütün stok
    /// satırları başlığa sığmaz ve isteğin tamamı 431 ile reddedilirdi.
    /// </summary>
    public const int MaxEffects = 25;

    private readonly List<string> _actions = new();
    private readonly List<string> _effects = new();

    /// <summary>Kullanıcının YAPTIĞI iş ("Satış Faturası … silindi").</summary>
    public IReadOnlyList<string> Actions => _actions;

    /// <summary>İşin TETİKLEDİKLERİ ("Stok: … +1 adet — Merkez Depo").</summary>
    public IReadOnlyList<string> Effects => _effects;

    public bool HasAnything => _actions.Count > 0 || _effects.Count > 0;

    /// <summary>Kırpma yüzünden atlanan satır sayısı — ekranda "ve N sonuç daha" demek için.</summary>
    public int OverflowCount { get; private set; }

    /// <summary>
    /// İkisi AYRI tutulur, tek listede birleştirilmez.
    ///
    /// <para>
    /// Ekranda "ne yaptım" ile "arkasında ne oldu" farklı ağırlıkta okunmalı: kullanıcı önce
    /// işleminin geçtiğini görmek ister, sonuçlar onun altında durur. Tek listede karışsalardı
    /// hangisinin asıl iş olduğu kaybolurdu.
    /// </para>
    /// </summary>
    public void AddActions(IEnumerable<string> actions) => Append(_actions, actions);

    public void AddEffects(IEnumerable<string> effects) => Append(_effects, effects);

    private void Append(List<string> target, IEnumerable<string> lines)
    {
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            if (_actions.Count + _effects.Count >= MaxEffects)
            {
                OverflowCount++;
                continue;
            }

            target.Add(line);
        }
    }
}
