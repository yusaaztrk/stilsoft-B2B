namespace B2B.Erp.Api.Core.Audit;

/// <summary>
/// Tek bir denetim sorgusu: başlık, kategori, isteğe bağlı "yanlış alarm" notu ve salt-okuma SQL'i.
/// </summary>
public sealed record AuditCheck(string Category, string Id, string Title, string? Note, string Sql);

/// <summary>
/// 2026-09-13 denetim oturumunda elle çalıştırılan dört SQL dosyasının (genel-denetim*.sql)
/// buraya taşınmış hali. Her sorgu salt okuma, veri değiştirmez. Sonuç 0 satırsa o kontrol temizdir.
///
/// Bilinen yanlış alarm desenleri her check'in Note alanında taşınır — ekranda gösterilmeli,
/// aksi halde her denetim çalıştırmasında aynı üç-dört desen "hata" sanılıp saatler kaybedilir
/// (bkz. proje hafızası: gunluk-denetim-sorgulari).
/// </summary>
public static class SystemAuditQueries
{
    public static IReadOnlyList<AuditCheck> All { get; } = new List<AuditCheck>
    {
        // ============================ A) SATIŞ + SERVİS FATURA ============================
        new("Satış/Servis Fatura", "A1", "Net + KDV ≠ Genel Toplam",
            null,
            """
            SELECT "InvoiceNo", "Type", "CustomerCode", "Date"::date AS tarih,
                   "NetTotal", "VatTotal", "GrandTotal",
                   ("NetTotal" + "VatTotal" - "GrandTotal") AS fark
            FROM "Invoices"
            WHERE abs("NetTotal" + "VatTotal" - "GrandTotal") > 0.02
            ORDER BY abs("NetTotal" + "VatTotal" - "GrandTotal") DESC
            """),

        new("Satış/Servis Fatura", "A2", "Brüt − İskonto ≠ Net",
            null,
            """
            SELECT "InvoiceNo", "Type", "CustomerCode", "Date"::date AS tarih,
                   "Subtotal", "Discount", "NetTotal",
                   ("Subtotal" - "Discount" - "NetTotal") AS fark
            FROM "Invoices"
            WHERE abs("Subtotal" - "Discount" - "NetTotal") > 0.02
            ORDER BY abs("Subtotal" - "Discount" - "NetTotal") DESC
            """),

        new("Satış/Servis Fatura", "A3", "Başlık KDV'si kalemlerden beklenenden sapıyor",
            "İskonto oranlı hesap, tolerans %2. Gerçek KDV hatası olabilir ama iskonto dağılımı farkından da kaynaklanabilir — tek tek bak.",
            """
            WITH x AS (
              SELECT i."InvoiceNo", i."Type", i."CustomerCode", i."Date"::date AS tarih,
                     i."Subtotal", i."Discount", i."NetTotal", i."VatTotal",
                     SUM(il."Quantity" * il."UnitPrice" * il."VatRate" / 100.0) AS satir_kdv_brut,
                     MAX(il."VatRate") AS max_oran
              FROM "Invoices" i
              JOIN "InvoiceLines" il ON il."InvoiceId" = i."Id"
              GROUP BY i."Id"
            )
            SELECT "InvoiceNo", "Type", "CustomerCode", tarih,
                   "Subtotal", "Discount",
                   round((CASE WHEN "Subtotal">0 THEN satir_kdv_brut * ("NetTotal"/"Subtotal") ELSE satir_kdv_brut END)::numeric,2) AS beklenen_kdv,
                   "VatTotal" AS yazilan_kdv
            FROM x
            WHERE (max_oran > 0 AND "VatTotal" = 0 AND satir_kdv_brut > 1)
               OR ("VatTotal" > 1 AND satir_kdv_brut > 1
                   AND abs("VatTotal" - (CASE WHEN "Subtotal">0 THEN satir_kdv_brut*("NetTotal"/"Subtotal") ELSE satir_kdv_brut END))
                       > greatest(1.0, satir_kdv_brut * 0.02))
            ORDER BY tarih, "InvoiceNo"
            """),

        new("Satış/Servis Fatura", "A4", "Kalemsiz fatura", null,
            """
            SELECT i."InvoiceNo", i."Type", i."CustomerCode", i."Date"::date AS tarih, i."GrandTotal"
            FROM "Invoices" i
            WHERE NOT EXISTS (SELECT 1 FROM "InvoiceLines" il WHERE il."InvoiceId" = i."Id")
            ORDER BY i."Date"
            """),

        new("Satış/Servis Fatura", "A5", "Çift fatura numarası", null,
            """
            SELECT "InvoiceNo", count(*) AS adet, string_agg("Id"::text, ',') AS id_ler
            FROM "Invoices"
            GROUP BY "InvoiceNo" HAVING count(*) > 1
            ORDER BY count(*) DESC
            """),

        // ================================ B) ALIŞ FATURA ================================
        new("Alış Fatura", "B1", "Net + KDV ≠ Genel Toplam (VatExempt hariç)", null,
            """
            SELECT "DocumentNo", "SupplierCode", "CustomerCode", "Date"::date AS tarih,
                   "TerminStatus", "Approved", "VatExempt",
                   "NetTotal", "VatTotal", "GrandTotal",
                   ("NetTotal" + "VatTotal" - "GrandTotal") AS fark
            FROM "PurchaseInvoices"
            WHERE NOT "VatExempt"
              AND abs("NetTotal" + "VatTotal" - "GrandTotal") > 0.02
            ORDER BY abs("NetTotal" + "VatTotal" - "GrandTotal") DESC
            """),

        new("Alış Fatura", "B2", "VatExempt=true AMA VatTotal>0 (çelişki)", null,
            """
            SELECT "DocumentNo", "SupplierCode", "CustomerCode", "Date"::date AS tarih,
                   "TerminStatus", "Subtotal", "VatTotal", "GrandTotal"
            FROM "PurchaseInvoices"
            WHERE "VatExempt" AND "VatTotal" > 0.02
            ORDER BY "VatTotal" DESC
            """),

        new("Alış Fatura", "B3", "Başlık KDV'si kalem KDV toplamından sapıyor",
            "Tolerans %2. TerminStatus/Approved sütunlarına bak.",
            """
            WITH x AS (
              SELECT p."DocumentNo", p."SupplierCode", p."CustomerCode", p."Date"::date AS tarih,
                     p."TerminStatus", p."Approved", p."VatExempt",
                     p."Subtotal", p."NetTotal", p."VatTotal",
                     SUM(l."Quantity" * l."UnitPrice" * l."VatRate" / 100.0) AS satir_kdv_brut,
                     MAX(l."VatRate") AS max_oran
              FROM "PurchaseInvoices" p
              JOIN "PurchaseInvoiceLines" l ON l."PurchaseInvoiceId" = p."Id"
              GROUP BY p."Id"
            )
            SELECT "DocumentNo", "SupplierCode", "CustomerCode", tarih,
                   "TerminStatus", "Approved", "VatExempt",
                   round(satir_kdv_brut::numeric,2) AS satir_kdv, "VatTotal" AS baslik_kdv
            FROM x
            WHERE NOT "VatExempt"
              AND satir_kdv_brut > 1
              AND abs("VatTotal" - satir_kdv_brut) > greatest(1.0, satir_kdv_brut * 0.02)
            ORDER BY tarih, "DocumentNo"
            """),

        // ========================== C) EKSTRE <-> FATURA MUTABAKATI ==========================
        new("Ekstre Mutabakatı", "C1a", "Tür bazında fatura toplamı", "Bilgi amaçlı, hata listesi değil.",
            """
            SELECT "Type", count(*) AS fat_adet, round(sum("GrandTotal")::numeric,2) AS fat_toplam
            FROM "Invoices"
            GROUP BY "Type"
            ORDER BY "Type"
            """),

        new("Ekstre Mutabakatı", "C1c", "Aşırı büyük tutarlı satış/servis faturası",
            "Aynı Type medyanının 50 katından fazla — çoğu gerçek büyük iş olabilir, test verisi şüphesiyle bak.",
            """
            WITH m AS (
              SELECT "Type", percentile_cont(0.5) WITHIN GROUP (ORDER BY "GrandTotal") AS medyan
              FROM "Invoices" WHERE "GrandTotal" > 0
              GROUP BY "Type"
            )
            SELECT i."InvoiceNo", i."Type", i."CustomerCode", i."Date"::date AS tarih, i."GrandTotal", m.medyan
            FROM "Invoices" i JOIN m ON m."Type" = i."Type"
            WHERE m.medyan > 0 AND i."GrandTotal" > m.medyan * 50
            ORDER BY i."GrandTotal" DESC
            """),

        new("Ekstre Mutabakatı", "C1d", "Aşırı büyük tutarlı alış faturası", "Genelde bekleyen teslim (TerminStatus=0), hata değil — kontrol et.",
            """
            WITH m AS (
              SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "GrandTotal") AS medyan
              FROM "PurchaseInvoices" WHERE "GrandTotal" > 0
            )
            SELECT p."DocumentNo", p."SupplierCode", p."Date"::date AS tarih, p."GrandTotal", m.medyan
            FROM "PurchaseInvoices" p, m
            WHERE m.medyan > 0 AND p."GrandTotal" > m.medyan * 50
            ORDER BY p."GrandTotal" DESC
            """),

        new("Ekstre Mutabakatı", "C2", "Fatura var, ekstrede karşılığı yok (öksüz fatura)",
            "770-/320- hariç tutuldu (gider/tedarikçi carileri farklı davranır). Cari kodu değişmişse (örn. fatura sonradan düzeltildi) yine de listelenebilir — DocumentNo ile ayrıca kontrol et.",
            """
            SELECT i."InvoiceNo", i."Type", i."CustomerCode", i."Date"::date AS tarih, i."GrandTotal"
            FROM "Invoices" i
            WHERE i."Type" IN ('6','H','1')
              AND i."CustomerCode" NOT LIKE '770-%'
              AND i."CustomerCode" NOT LIKE '320-%'
              AND NOT EXISTS (
                SELECT 1 FROM "CustomerLedgerEntries" l
                WHERE l."ReferenceType" = 2
                  AND coalesce(l."IsCancelled",false) = false
                  AND regexp_replace(l."CustomerCode", '-[123]$', '') = regexp_replace(i."CustomerCode", '-[123]$', '')
                  AND ( l."ReferenceId" = i."Id"
                        OR (l."DocumentNo" IS NOT NULL AND l."DocumentNo" = i."InvoiceNo")
                        OR (l."DocumentNo" IS NOT NULL AND right(i."InvoiceNo", 8) <> '' AND l."DocumentNo" LIKE '%' || regexp_replace(i."InvoiceNo", '^[A-Z0]+', '')) )
              )
            ORDER BY i."Date", i."InvoiceNo"
            """),

        new("Ekstre Mutabakatı", "C3", "Ekstrede fatura satırı var ama fatura kaydı yok", "DEVIR% ve iptal hariç.",
            """
            SELECT l."CustomerCode", l."DocumentNo", l."Date"::date AS tarih, l."Direction", l."Amount", l."ReferenceId"
            FROM "CustomerLedgerEntries" l
            WHERE l."ReferenceType" = 2
              AND coalesce(l."IsCancelled",false) = false
              AND coalesce(l."DocumentNo",'') NOT LIKE 'DEVIR%'
              AND l."ReferenceId" IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM "Invoices" i WHERE i."Id" = l."ReferenceId")
              AND NOT EXISTS (SELECT 1 FROM "PurchaseInvoices" p WHERE p."Id" = l."ReferenceId")
            ORDER BY l."Date"
            """),

        // ====================== D/E) KASA-BANKA-EKSTRE ÖDEME ÜÇLÜSÜ ======================
        new("Kasa/Banka", "D1", "Kasa: Amount ≠ CurrencyAmount×CurrencyRate", "Tolerans 0.05.",
            """
            SELECT "Id","CashAccountId","Date"::date AS tarih,"Amount","CurrencyTypeId","CurrencyRate","CurrencyAmount",
                   round(("CurrencyAmount" * "CurrencyRate")::numeric,2) AS beklenen_amount
            FROM "CashAccountTransactions"
            WHERE "CurrencyTypeId" > 1 AND "CurrencyRate" > 0 AND NOT "IsCancelled"
              AND abs("Amount" - round(("CurrencyAmount" * "CurrencyRate")::numeric,2)) > 0.05
            ORDER BY abs("Amount" - round(("CurrencyAmount" * "CurrencyRate")::numeric,2)) DESC
            """),

        new("Kasa/Banka", "D2", "Banka: Amount ≠ CurrencyAmount×CurrencyRate", "Tolerans 0.05, birkaç kuruşluk yuvarlama farkı hata sayılmaz.",
            """
            SELECT "Id","BankAccountDefinitionId","Date"::date AS tarih,"Amount","CurrencyTypeId","CurrencyRate","CurrencyAmount",
                   round(("CurrencyAmount" * "CurrencyRate")::numeric,2) AS beklenen_amount
            FROM "BankAccountTransactions"
            WHERE "CurrencyTypeId" > 1 AND "CurrencyRate" > 0
              AND abs("Amount" - round(("CurrencyAmount" * "CurrencyRate")::numeric,2)) > 0.05
            ORDER BY abs("Amount" - round(("CurrencyAmount" * "CurrencyRate")::numeric,2)) DESC
            """),

        new("Kasa/Banka", "D3", "Kasa: TL çapası bozuk (TenderAmount×TenderRate ≠ Amount)", null,
            """
            SELECT "Id","CashAccountId","Date"::date AS tarih,"Amount","TenderCurrencyTypeId","TenderRate","TenderAmount",
                   round(("TenderAmount" * "TenderRate")::numeric,2) AS beklenen_capa
            FROM "CashAccountTransactions"
            WHERE "TenderCurrencyTypeId" > 0 AND "TenderRate" > 0 AND "TenderAmount" > 0 AND NOT "IsCancelled"
              AND abs("Amount" - round(("TenderAmount" * "TenderRate")::numeric,2)) > 0.05
            ORDER BY abs("Amount" - round(("TenderAmount" * "TenderRate")::numeric,2)) DESC
            """),

        new("Kasa/Banka", "D4", "Banka: TL çapası bozuk (aynı mantık)", null,
            """
            SELECT "Id","BankAccountDefinitionId","Date"::date AS tarih,"Amount","TenderCurrencyTypeId","TenderRate","TenderAmount",
                   round(("TenderAmount" * "TenderRate")::numeric,2) AS beklenen_capa
            FROM "BankAccountTransactions"
            WHERE "TenderCurrencyTypeId" > 0 AND "TenderRate" > 0 AND "TenderAmount" > 0
              AND abs("Amount" - round(("TenderAmount" * "TenderRate")::numeric,2)) > 0.05
            ORDER BY abs("Amount" - round(("TenderAmount" * "TenderRate")::numeric,2)) DESC
            """),

        new("Kasa/Banka", "E1", "Ekstre satırı: Amount ≠ CurrencyAmount×CurrencyRate", null,
            """
            SELECT "Id","CustomerCode","Date"::date AS tarih,"DocumentNo","Amount","CurrencyTypeId","CurrencyRate","CurrencyAmount"
            FROM "CustomerLedgerEntries"
            WHERE "CurrencyTypeId" > 1 AND "CurrencyRate" > 0 AND NOT "IsCancelled"
              AND abs("Amount" - round(("CurrencyAmount" * "CurrencyRate")::numeric,2)) > 0.05
            ORDER BY abs("Amount" - round(("CurrencyAmount" * "CurrencyRate")::numeric,2)) DESC
            """),

        new("Kasa/Banka", "G1", "Başarılı Sanal POS ama banka hareketi bulunamadı",
            "Bilinen yöntem sınırı: POS tahsilatları çoğu zaman 120-07 süpürme hesabına GÜNLÜK TOPLU aktarılır, 1:1 eşleşme aramak yanlış alarm üretir. Bu liste ipucu amaçlıdır, hata listesi DEĞİLDİR.",
            """
            SELECT v."Id", v."OrderNo", v."CustomerCode", v."Amount", v."TransactionDate"::date AS tarih
            FROM "VirtualPosTransactions" v
            WHERE v."IsSuccess" = true
              AND NOT EXISTS (
                SELECT 1 FROM "BankAccountTransactions" b
                WHERE b."DocumentNo" = v."OrderNo" OR b."DocumentNo" = v."BankDocumentNo"
              )
            ORDER BY v."TransactionDate" DESC
            LIMIT 50
            """),

        // ================================ H) STOK/DEPO ================================
        new("Stok/Depo", "H1", "Geçersiz Direction değeri (G/C dışında)", null,
            """
            SELECT "Direction", count(*) AS adet
            FROM "StockMovements"
            WHERE "Direction" NOT IN ('G','C')
            GROUP BY "Direction"
            """),

        new("Stok/Depo", "H2", "Products.Stock ↔ gerçek stok sapan ürün sayısı",
            "BİLİNEN sorun (alış faturası bu sayacı artırmıyor). ERP ekranları zaten gerçek bakiyeyi (StockMovements) okur — bu sayı azalmaz, kalıcı çözüm ayrı bir mimari karar gerektirir.",
            """
            WITH bakiye AS (
              SELECT "StockCode",
                     SUM(CASE WHEN "Direction"='G' THEN "Quantity" ELSE -"Quantity" END) AS gercek_bakiye
              FROM "StockMovements"
              GROUP BY "StockCode"
            )
            SELECT count(*) AS sapan_urun_sayisi
            FROM "Products" p
            JOIN bakiye b ON b."StockCode" = p."StockCode"
            WHERE abs(p."Stock" - b.gercek_bakiye) > 0.5
            """),

        new("Stok/Depo", "H3", "Depo transferi: G/C bacakları dengesiz", null,
            """
            WITH transfer_denge AS (
              SELECT "InvoiceNo" AS transfer_no, "StockCode",
                     SUM(CASE WHEN "Direction"='G' THEN "Quantity" ELSE 0 END) AS giris,
                     SUM(CASE WHEN "Direction"='C' THEN "Quantity" ELSE 0 END) AS cikis
              FROM "StockMovements"
              WHERE "BagNo" = 'DEPO_TRANSFER'
              GROUP BY "InvoiceNo", "StockCode"
            )
            SELECT transfer_no, "StockCode", giris, cikis, (giris - cikis) AS fark
            FROM transfer_denge
            WHERE abs(giris - cikis) > 0.001
            ORDER BY transfer_no
            """),

        new("Stok/Depo", "H4", "Transfer kalemi var ama stok hareketi yok", null,
            """
            SELECT wt."TransferNo", wtl."StockCode", wtl."Quantity"
            FROM "WarehouseTransferLines" wtl
            JOIN "WarehouseTransfers" wt ON wt."Id" = wtl."WarehouseTransferId"
            WHERE NOT EXISTS (
              SELECT 1 FROM "StockMovements" sm
              WHERE sm."InvoiceNo" = wt."TransferNo" AND sm."StockCode" = wtl."StockCode"
            )
            ORDER BY wt."TransferNo"
            """),

        new("Stok/Depo", "H5", "Negatif gerçek stoklu ürün sayısı", "HATA DEĞİL — kullanıcı kararıyla depo eksiye düşebilir, yalnız bilgi.",
            """
            SELECT count(*) AS negatif_urun_sayisi,
                   round(sum(CASE WHEN gercek_bakiye < 0 THEN gercek_bakiye ELSE 0 END)::numeric,0) AS toplam_negatif_adet
            FROM (
              SELECT "StockCode",
                     SUM(CASE WHEN "Direction"='G' THEN "Quantity" ELSE -"Quantity" END) AS gercek_bakiye
              FROM "StockMovements"
              GROUP BY "StockCode"
            ) x
            WHERE gercek_bakiye < 0
            """),

        // ============================ I/J/K) CARİ ÇAPRAZ DENETİM ============================
        new("Cari Çapraz", "I1", "Alacaklı bakiyeli cariler (aile bazında, DEVIR hariç)",
            "770-/320- (gider/tedarikçi) ve 120-07 (POS süpürme) hariç tutuldu. Bakiye DEVIR (açılış) satırları DAHİL hesaplanır ama listeleme DEVIR'in açıkladığı kısmı DIŞLAR — yalnız DEVIR'in açıklamadığı gerçek fazlalık gösterilir. Büyük/sürekli hareketli bayilerde bu liste GENELDE hata değildir — vadeli/kredili çalışmanın doğal sonucu olabilir. Tek tek değerlendir, toplu 'hata' sayma.",
            """
            WITH aile AS (
              SELECT regexp_replace("CustomerCode", '-[123]$', '') AS aile_kodu, "CustomerCode",
                     "Direction", "Amount", "DocumentNo"
              FROM "CustomerLedgerEntries"
              WHERE "CustomerCode" LIKE '120-%'
                AND "CustomerCode" NOT LIKE '120-07-%'
                AND coalesce("IsCancelled", false) = false
            ),
            bakiye AS (
              SELECT aile_kodu,
                     sum(CASE WHEN "Direction" = 1 THEN "Amount" ELSE -"Amount" END) AS net_bakiye,
                     sum(CASE WHEN coalesce("DocumentNo",'') LIKE 'DEVIR%' AND "Direction" = 1 THEN "Amount" ELSE 0 END) AS devir_borc,
                     sum(CASE WHEN coalesce("DocumentNo",'') LIKE 'DEVIR%' AND "Direction" = 2 THEN "Amount" ELSE 0 END) AS devir_alacak,
                     count(*) AS hareket_adedi
              FROM aile
              GROUP BY aile_kodu
            )
            SELECT b.aile_kodu, c."Name",
                   b.net_bakiye, b.devir_borc, b.devir_alacak,
                   (b.net_bakiye + b.devir_alacak - b.devir_borc) AS net_bakiye_devir_haric,
                   b.hareket_adedi
            FROM bakiye b
            LEFT JOIN "Customers" c ON c."CustomerCode" = b.aile_kodu
            WHERE (b.net_bakiye + b.devir_alacak - b.devir_borc) < -1.0
            ORDER BY (b.net_bakiye + b.devir_alacak - b.devir_borc) ASC
            LIMIT 100
            """),

        new("Cari Çapraz", "J1", "Olası kopya tahsilat (aynı tutar+gün+açıklama, farklı cari)",
            "Sanal POS şablon açıklamaları ('Sanal POS Tahsilatı - ...') ilk kelimesi hep aynı olduğu için yanlış alarm üretebilir — OrderNo/referans kısmı farklıysa gerçek kopya DEĞİLDİR, iki ayrı işlemdir.",
            """
            WITH tahsilat AS (
              SELECT "Id", regexp_replace("CustomerCode", '-[123]$', '') AS aile_kodu,
                     "Date"::date AS tarih, "Amount", "Description",
                     split_part(trim("Description"), ' ', 1) AS ilk_kelime
              FROM "CustomerLedgerEntries"
              WHERE "Direction" = 2
                AND "ReferenceType" IN (5,7)
                AND coalesce("IsCancelled", false) = false
                AND coalesce("DocumentNo",'') NOT LIKE 'DEVIR%'
                AND trim(coalesce("Description",'')) <> ''
            )
            SELECT a."Id" AS id1, a.aile_kodu AS aile1, b."Id" AS id2, b.aile_kodu AS aile2,
                   a.tarih, a."Amount", a."Description" AS aciklama1, b."Description" AS aciklama2
            FROM tahsilat a
            JOIN tahsilat b ON a."Id" < b."Id"
              AND a.aile_kodu <> b.aile_kodu
              AND a."Amount" = b."Amount"
              AND abs(a.tarih - b.tarih) <= 1
              AND lower(a.ilk_kelime) = lower(b.ilk_kelime)
              AND length(a.ilk_kelime) > 2
            ORDER BY a.tarih DESC
            LIMIT 60
            """),

        new("Cari Çapraz", "K1", "Düşük hacimli caride toplam alacak > toplam borç",
            "Yalnız toplam hareket ≤6 olan cariler (büyük bayide yöntem güvenilmez). DEVIR (açılış) borcu toplam borca DAHİL edildi. 'fatura_adet=0, devir_borc=0, alacak var' satırları AVANS/ön ödeme olabilir — muhasebe kararı gerekir, otomatik hata sayılmaz.",
            """
            WITH aile AS (
              SELECT regexp_replace("CustomerCode", '-[123]$', '') AS aile_kodu,
                     "ReferenceType", "Direction", "Amount", "DocumentNo"
              FROM "CustomerLedgerEntries"
              WHERE "CustomerCode" LIKE '120-%'
                AND coalesce("IsCancelled", false) = false
            ),
            ozet AS (
              SELECT aile_kodu,
                     sum(CASE WHEN "Direction" = 1 THEN "Amount" ELSE 0 END) AS toplam_borc,
                     count(*) FILTER (WHERE "ReferenceType" = 2 AND "Direction" = 1) AS fatura_adet,
                     sum(CASE WHEN coalesce("DocumentNo",'') LIKE 'DEVIR%' AND "Direction" = 1 THEN "Amount" ELSE 0 END) AS devir_borc,
                     sum(CASE WHEN coalesce("DocumentNo",'') LIKE 'DEVIR%' AND "Direction" = 2 THEN "Amount" ELSE 0 END) AS devir_alacak,
                     sum(CASE WHEN "Direction" = 2 THEN "Amount" ELSE 0 END) AS toplam_alacak,
                     count(*) AS toplam_hareket
              FROM aile
              GROUP BY aile_kodu
            )
            SELECT o.aile_kodu, c."Name", o.fatura_adet, o.devir_borc, o.devir_alacak, o.toplam_borc, o.toplam_alacak,
                   (o.toplam_borc - o.toplam_alacak) AS fark, o.toplam_hareket
            FROM ozet o
            LEFT JOIN "Customers" c ON c."CustomerCode" = o.aile_kodu
            WHERE o.toplam_hareket BETWEEN 1 AND 6
              AND abs(o.toplam_borc - o.toplam_alacak) > 1.0
              AND o.toplam_alacak > o.toplam_borc
              AND o.devir_alacak = 0
            ORDER BY fark ASC
            LIMIT 100
            """),
    };
}
