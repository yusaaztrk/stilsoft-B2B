using System;

namespace B2B.Erp.Api.Entities;

public sealed class VirtualPosDefinition
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public int BankCode { get; set; }

    public string BankName { get; set; } = string.Empty;

    public string PosType { get; set; } = string.Empty; // NESTPAY, GARANTI, KOOP

    /// <summary>
    /// NestPay `storetype` — uye isyerinin hangi 3D modelinde tanimli oldugu
    /// (3D_PAY_HOSTING / 3D_PAY / 3D / 3D_HOST). Kodda sabit degil TANIMDA duruyor:
    /// yanlis model, bankadan "Isyeri kullanim tipi desteklenmiyor" reddi getiriyor ve
    /// dogru degeri yalnizca banka soyleyebiliyor. Bos birakilirsa 3D_PAY_HOSTING.
    /// NestPay disindaki saglayicilar bu alani kullanmaz.
    /// </summary>
    public string StoreType { get; set; } = "3D_PAY_HOSTING";

    public string ClientId { get; set; } = string.Empty;

    public string TerminalId { get; set; } = string.Empty;

    public string UserCode { get; set; } = string.Empty;

    public string Password { get; set; } = string.Empty;

    public string Key3D { get; set; } = string.Empty;

    public string ProvisionPassword { get; set; } = string.Empty;

    public string GatewayUrl { get; set; } = string.Empty;

    public string ApprovedUrl { get; set; } = string.Empty;

    public string XmlUrl { get; set; } = string.Empty;

    public string NethesCode { get; set; } = string.Empty;

    public string PosnetId { get; set; } = string.Empty;

    public bool IsDefault { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreateTime { get; set; } = DateTime.UtcNow;

    public string CreateUser { get; set; } = "SYSTEM";
}
