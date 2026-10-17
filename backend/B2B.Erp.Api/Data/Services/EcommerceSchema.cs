namespace B2B.Erp.Api.Data.Services;

/// <summary>
/// E-ticaret ödeme tablosunun kurulum SQL'i.
///
/// Bu depoda tablo eklemenin yolu <c>dotnet ef migrations add</c> DEĞİL: snapshot kayması
/// yüzünden alakasız onlarca işlem (kolon düşürme dahil) üretiyor. Yerleşik yöntem, açılışta
/// çalışan <c>IF NOT EXISTS</c> SQL'i — aynı desen ServiceOps ve mağaza şemasında da var.
///
/// Metin tek yerde duruyor çünkü iki yerden çalıştırılıyor: varsayılan veritabanı için
/// <c>Program.cs</c>, her firma veritabanı için <c>TenantConnectionStringResolver</c>. İkisi
/// ayrışırsa bir firmada tekil indeks eksik kalır ve çift tahsilatı durduran tek yapı gider.
/// </summary>
public static class EcommerceSchema
{
    public const string EcommerceOrderPaymentsDdl = @"
CREATE TABLE IF NOT EXISTS ""EcommerceOrderPayments"" (
  ""MerchantOrderId"" character varying(100) NOT NULL,
  ""SalesOrderNo"" character varying(50) NOT NULL,
  ""CustomerCode"" character varying(50) NOT NULL,
  ""Amount"" numeric(18,2) NOT NULL,
  ""CurrencyCode"" character varying(3) NOT NULL DEFAULT 'TRY',
  ""Status"" integer NOT NULL DEFAULT 0,
  ""AuthCode"" character varying(50) NOT NULL DEFAULT '',
  ""FailureMessage"" character varying(500) NOT NULL DEFAULT '',
  ""CreatedAtUtc"" timestamp with time zone NOT NULL,
  ""SettledAtUtc"" timestamp with time zone NULL,
  CONSTRAINT ""PK_EcommerceOrderPayments"" PRIMARY KEY (""MerchantOrderId"")
);

CREATE INDEX IF NOT EXISTS ""IX_EcommerceOrderPayments_SalesOrderNo""
  ON ""EcommerceOrderPayments"" (""SalesOrderNo"");

CREATE INDEX IF NOT EXISTS ""IX_EcommerceOrderPayments_CustomerCode""
  ON ""EcommerceOrderPayments"" (""CustomerCode"");

-- Bir sipariş EN FAZLA bir kez ödenmiş olabilir.
--
-- Kod tarafındaki ""zaten ödendi mi"" kontrolü iki eşzamanlı callback'i durduramaz: ikisi de
-- ""hayır"" cevabını alıp ikisi de yazar. Kısmi tekil indeks bunu veritabanı seviyesinde
-- imkânsız kılıyor; ikinci yazma hatayla döner ve olay ""insan bakmalı"" olarak kaydedilir.
CREATE UNIQUE INDEX IF NOT EXISTS ""UX_EcommerceOrderPayments_SalesOrderNo_Paid""
  ON ""EcommerceOrderPayments"" (""SalesOrderNo"") WHERE ""Status"" = 1;
";
}
