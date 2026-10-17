using System;

namespace B2B.Erp.Api.Entities;

public sealed class VirtualPosBin
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public int BankCode { get; set; }

    public string BinNo { get; set; } = string.Empty; // 6 digits e.g. 404591

    public string CardType1 { get; set; } = string.Empty; // VISA, MASTER, TROY, AMEX

    public string CardType2 { get; set; } = string.Empty; // KREDI KARTI, DEBIT KART

    public int InstallmentBankCode { get; set; } // The target bank code for routing installments

    public DateTime CreateTime { get; set; } = DateTime.UtcNow;

    public string CreateUser { get; set; } = "SYSTEM";
}
