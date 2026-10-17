using System;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

/// <summary>
/// Bankaya verilen sipariş numarası.
///
/// Callback ucu herkese açık, dolayısıyla bu numara TAHMİN EDİLEBİLİR OLMAMALI. Eskiden
/// "DEMOK" + zaman damgası kullanılıyordu: sırayla denenerek bekleyen gerçek bir ödemenin
/// numarası bulunabiliyordu.
///
/// Üretici burada duruyor çünkü ödemeyi başlatan iki yol var — bayi paneli ve mağaza — ve
/// ikisi de aynı biçimi kullanmalı. Mağaza tarafı numarayı ÖNCEDEN üretmek zorunda: siparişle
/// ödeme arasındaki bağı bankaya gitmeden önce yazması gerekiyor.
/// </summary>
public static class MerchantOrderId
{
    public static string New() => "SP" + Guid.NewGuid().ToString("N").ToUpperInvariant();
}
