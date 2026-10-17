namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// Personel ödemelerinin kasa/banka bağlantısı.
///
/// <para>2026-08-18 kullanıcı kararı: bu bağlantı ŞİMDİLİK PASİF. Ödemeler servis içinde
/// manuel yürüyor — kayıt "ödendi" olarak duruyor, ama <c>BankAccountTransactions</c> /
/// <c>CashAccountTransactions</c> tablolarına hareket YAZILMIYOR. Bağlantı sonra kurulacak.</para>
///
/// <para>Açmak için <c>appsettings.json</c> içinde
/// <c>"EmployeePayments": { "WriteAccountMovements": true }</c>. Anahtar yoksa KAPALI sayılır:
/// yanlışlıkla para hareketi yazmaktansa yazmamak tercih edilir.</para>
///
/// <para>DİKKAT — kapalıyken bile TERS KAYIT yazılır: gerçekten hareket yazılmış bir ödeme
/// (kuru kayıtlı olan) iptal edildiğinde para hesaba geri dönmek zorunda. Kapatma yalnızca
/// YENİ çıkış hareketlerini durdurur.</para>
/// </summary>
public static class AccountMovementSettings
{
    public const string ConfigKey = "EmployeePayments:WriteAccountMovements";

    public static bool IsEnabled(IConfiguration configuration)
        => configuration.GetValue(ConfigKey, false);
}
