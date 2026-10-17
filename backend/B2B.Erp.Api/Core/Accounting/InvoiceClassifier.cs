using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Core.Accounting;

/// <summary>
/// Bir faturanın muhasebe açısından NE OLDUĞU.
/// </summary>
public enum InvoiceNature
{
    /// <summary>Sınıflandırılamadı — aktarımda "Hatalı" durumuna düşer.</summary>
    Unknown = 0,

    /// <summary>Mal satışı. 600 Yurtiçi Satışlar.</summary>
    SalesRevenue = 1,

    /// <summary>Servis/tamir geliri. 600.20 Yurtiçi Hizmet Satışları.</summary>
    ServiceRevenue = 2,

    /// <summary>Mal alışı. 153 Ticari Mallar.</summary>
    GoodsPurchase = 3,

    /// <summary>Gider/hizmet alışı. 7xx gider hesapları — hangisi olduğu ServiceCode'a bağlı.</summary>
    ExpensePurchase = 4,

    /// <summary>Satıştan iade. 610 Satıştan İadeler.</summary>
    SalesReturn = 5,

    /// <summary>Alıştan iade. 153.90 Mal Alış İadeleri.</summary>
    PurchaseReturn = 6,

    /// <summary>Teklif, proforma, depo transferi — deftere GİRMEZ.</summary>
    NonAccounting = 7
}

/// <summary>
/// Sınıflandırma sonucu. <see cref="SourceMissing"/> doğruysa fatura bir alış belgesine
/// işaret ediyor ama o belge SİLİNMİŞ demektir; muhasebe tarafında "Kaynakta Silinenler"
/// akışına düşmesi gerekir, tahminle defterlenmemelidir.
/// </summary>
public sealed record InvoiceClassification(
    InvoiceNature Nature,
    bool SourceMissing,
    PurchaseInvoiceKind? SourceKind,
    string? ExpenseServiceCode)
{
    /// <summary>Deftere girer mi? Teklif/proforma/depo transferi girmez.</summary>
    public bool IsAccountingDocument =>
        Nature is not (InvoiceNature.NonAccounting or InvoiceNature.Unknown);

    /// <summary>Gelir tarafı mı (alacak yazan satış belgesi)?</summary>
    public bool IsRevenue =>
        Nature is InvoiceNature.SalesRevenue or InvoiceNature.ServiceRevenue;

    /// <summary>Alış tarafı mı (borç yazan alış belgesi)?</summary>
    public bool IsPurchase =>
        Nature is InvoiceNature.GoodsPurchase or InvoiceNature.ExpensePurchase;
}

/// <summary>
/// FATURA SINIFLANDIRICI — muhasebe aktarımının tek kapısı.
///
/// <para>
/// <b>Neden var:</b> <c>Invoice.Type</c> tek başına faturanın ne olduğunu SÖYLEMİYOR.
/// 2026-08-14'te veride bulundu: <c>Type='H'</c> taşıyan 9 faturanın <b>5'i gider alışı</b>
/// (<c>PurchaseInvoices.Kind=1</c>'den üretilmiş), yalnızca 3'ü gerçek servis geliriydi.
/// Yalnızca <c>Type</c>'a bakan bir eşleme o 5 gideri <b>gelir</b> olarak defterler;
/// kâr şişer, vergi yanlış çıkar. Aynı belirsizlik <c>Type='I'</c> için de var
/// (satış iadesi mi, alış iadesi mi).
/// </para>
///
/// <para>
/// <b>Ayırt edici alan <c>Type</c> değil, <c>SourcePurchaseInvoiceId</c>:</b>
/// doluysa belge bir ALIŞ belgesinden üretilmiştir ve gerçek niteliğini kaynağın
/// <c>Kind</c> alanı belirler.
/// </para>
///
/// <para>
/// Doğrulanmış eşleme (DEMO, 2026-08-14 — 1:1, istisnasız):
/// <c>Kind=0 → Type '2'</c>, <c>Kind=1 → Type 'H'</c>, <c>Kind=2 → Type 'I'</c>.
/// </para>
/// </summary>
public static class InvoiceClassifier
{
    /// <summary>
    /// Faturayı sınıflandırır.
    /// </summary>
    /// <param name="type">Faturanın kendi tipi.</param>
    /// <param name="sourcePurchaseInvoiceId">Alış belgesi bağı; null ise satış tarafı belgesidir.</param>
    /// <param name="sourceKind">
    /// Kaynak alış belgesinin türü. <paramref name="sourcePurchaseInvoiceId"/> DOLU ama bu
    /// NULL ise kaynak silinmiştir — sonuçta <see cref="InvoiceClassification.SourceMissing"/>
    /// işaretlenir.
    /// </param>
    /// <param name="sourceServiceCode">Gider alışında <c>ServiceCatalogItems.Code</c> (ör. HIZ-KIRA).</param>
    public static InvoiceClassification Classify(
        InvoiceType type,
        int? sourcePurchaseInvoiceId,
        PurchaseInvoiceKind? sourceKind,
        string? sourceServiceCode = null)
    {
        // Deftere hiç girmeyenler: teklif, proforma, depo transferi.
        if (type is InvoiceType.Proforma or InvoiceType.Quotation or InvoiceType.WarehouseTransfer)
        {
            return new InvoiceClassification(InvoiceNature.NonAccounting, false, null, null);
        }

        var hasSourceLink = sourcePurchaseInvoiceId.HasValue && sourcePurchaseInvoiceId.Value > 0;

        // ---- ALIŞ TARAFI: nitelik kaynağın Kind'ından okunur, Type'tan DEĞİL ----
        if (hasSourceLink && sourceKind.HasValue)
        {
            var nature = sourceKind.Value switch
            {
                PurchaseInvoiceKind.Purchase => InvoiceNature.GoodsPurchase,
                PurchaseInvoiceKind.Service => InvoiceNature.ExpensePurchase,
                PurchaseInvoiceKind.Return => InvoiceNature.PurchaseReturn,
                _ => InvoiceNature.Unknown
            };

            return new InvoiceClassification(
                nature,
                SourceMissing: false,
                SourceKind: sourceKind,
                ExpenseServiceCode: nature == InvoiceNature.ExpensePurchase ? sourceServiceCode : null);
        }

        // ---- KAYNAK SİLİNMİŞ ----
        // Tahmin YAPILMAZ. Veride bugün bir örneği var (Type='H', kaynağı yok edilmiş).
        // Muhasebe bunu "Kaynakta Silinenler" akışına almalı; körlemesine gelir yazmak
        // tam da bu sınıflandırıcının önlemek için yazıldığı hata olurdu.
        if (hasSourceLink)
        {
            return new InvoiceClassification(InvoiceNature.Unknown, SourceMissing: true, null, null);
        }

        // ---- SATIŞ TARAFI: kaynak bağı yok ----
        return type switch
        {
            InvoiceType.SalesInvoice or InvoiceType.OpenInvoice
                => new InvoiceClassification(InvoiceNature.SalesRevenue, false, null, null),

            // Kaynak bağı olmayan 'H' GERÇEK servis/tamir faturasıdır.
            InvoiceType.ServiceInvoice
                => new InvoiceClassification(InvoiceNature.ServiceRevenue, false, null, null),

            // Kaynak bağı olmayan 'I' SATIŞ iadesidir (alış iadesi kaynaktan gelir).
            InvoiceType.ReturnInvoice
                => new InvoiceClassification(InvoiceNature.SalesReturn, false, null, null),

            // Kaynaksız '2' beklenmez ama veri bozulmasına karşı mal alışı sayılır.
            InvoiceType.PurchaseInvoice
                => new InvoiceClassification(InvoiceNature.GoodsPurchase, false, null, null),

            _ => new InvoiceClassification(InvoiceNature.Unknown, false, null, null)
        };
    }

    /// <summary>Ekranda gösterilecek Türkçe ad.</summary>
    public static string DisplayName(InvoiceNature nature) => nature switch
    {
        InvoiceNature.SalesRevenue => "Satış Faturası",
        InvoiceNature.ServiceRevenue => "Servis Faturası",
        InvoiceNature.GoodsPurchase => "Mal Alışı",
        InvoiceNature.ExpensePurchase => "Gider Alışı",
        InvoiceNature.SalesReturn => "Satış İadesi",
        InvoiceNature.PurchaseReturn => "Alış İadesi",
        InvoiceNature.NonAccounting => "Muhasebe Dışı",
        _ => "Sınıflandırılamadı"
    };
}
