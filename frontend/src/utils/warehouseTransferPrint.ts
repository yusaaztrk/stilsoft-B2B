import type { WarehouseTransferDetail } from '../api/warehouseTransfers'

/**
 * DEPOLAR ARASI TRANSFER BELGESİ.
 *
 * Tek bir kayıt için TEK belge üretir; kayıttaki her kalem ayrı satır olarak basılır
 * (3 kalemlik bir transfer 3 satır gösterir, kalem başına ayrı belge çıkmaz).
 *
 * Belgede LOGO YOK (2026-08-23): çıktı antetli kâğıda basılıyor, logo kâğıtta zaten var.
 * Üstteki 32mm boşluk basılı anteti serbest bırakmak için.
 *
 * Çıktı `/print/preview` üzerinden açılıyor, boş bir sekmeye yazılarak değil: `about:blank`
 * sekmesinde kök yollar çözülmez ve önizleyicinin yazdır/dışa aktar çubuğu da olmaz
 * (aynı tuzağa çek bordrosunda düşülmüştü).
 */

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function qty(n: number): string {
  return Number(n ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dateTR(iso: string | null | undefined): string {
  const raw = String(iso ?? '').slice(0, 10)
  const [y, m, d] = raw.split('-')
  if (!y || !m || !d) return raw
  return `${d}.${m}.${y}`
}

export type WarehouseTransferPrintInput = {
  detail: WarehouseTransferDetail
  /** Depo kodu -> ekranda görünen ad. Belgede kod değil ad yazsın diye. */
  warehouseLabelByCode: Record<string, string>
}

export function buildWarehouseTransferHtml({ detail, warehouseLabelByCode }: WarehouseTransferPrintInput): string {
  const lines = [...(detail?.lines ?? [])].sort((a, b) => Number(a.lineNo) - Number(b.lineNo))
  const totalQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)

  const fromLabel = warehouseLabelByCode[String(detail.fromWarehouseCode)] ?? String(detail.fromWarehouseCode ?? '')
  const toLabel = warehouseLabelByCode[String(detail.toWarehouseCode)] ?? String(detail.toWarehouseCode ?? '')

  const rowsHtml = lines
    .map(
      (l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="mono">${esc(l.stockCode)}</td>
        <td>${esc((l as any).stockName ?? '')}</td>
        <td class="r b">${qty(Number(l.quantity))}</td>
      </tr>`
    )
    .join('')

  const emptyHtml = `<tr><td colspan="4" class="c muted">Bu belgede kalem yok.</td></tr>`

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>Depo Transfer Belgesi ${esc(detail.transferNo)}</title>
<style>
  /* UST BOSLUK 32mm (2026-08-23 kullanici istegi).
     Logo belgeden kaldirildi ve icerik asagi alindi: cikti antetli kagida basiliyor,
     ustteki bosluk basili anteti serbest birakiyor. Anteti daha uzun/kisa bir kagida
     gecilirse ayarlanacak TEK yer bu satirdaki ilk deger. */
  @page { size: A4; margin: 32mm 12mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Arial, Helvetica, sans-serif;
    color: #1e293b;
    font-size: 11px;
    margin: 0;
  }
  .sheet { width: 186mm; margin: 0 auto; }

  .head { /* Logo kaldirildi; baslik tek basina, tam genislik. */ }
  .title { font-size: 19px; font-weight: 800; letter-spacing: .3px; margin: 0 0 2px; }
  .subtitle { font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }

  .rule { height: 2px; background: #b91c1c; margin: 10px 0 14px; }

  .meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .meta td { padding: 4px 6px; vertical-align: top; border: 1px solid #e2e8f0; }
  .meta .k {
    width: 26mm; background: #f8fafc; font-weight: 700; font-size: 9px;
    text-transform: uppercase; letter-spacing: .5px; color: #475569;
  }

  table.items { width: 100%; border-collapse: collapse; }
  table.items th {
    background: #f1f5f9; border: 1px solid #cbd5e1; padding: 6px 7px;
    font-size: 9px; text-transform: uppercase; letter-spacing: .6px; color: #334155; text-align: left;
  }
  table.items td { border: 1px solid #e2e8f0; padding: 6px 7px; }
  table.items tfoot td { background: #f8fafc; font-weight: 800; }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 700; }
  .mono { font-family: "Consolas", "Courier New", monospace; }
  .muted { color: #94a3b8; padding: 18px 0; }
  .w-sira { width: 12mm; }
  .w-kod  { width: 34mm; }
  .w-mik  { width: 26mm; }

  /* İki imza: teslim eden ve teslim alan. */
  .signs { display: flex; gap: 24mm; margin-top: 18mm; }
  .sign { flex: 1; }
  .sign .line { border-bottom: 1px solid #94a3b8; height: 16mm; }
  .sign .lbl {
    margin-top: 5px; font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .6px; color: #475569; text-align: center;
  }

  .foot { margin-top: 10mm; font-size: 8px; color: #94a3b8; text-align: center; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="head">
      <div>
        <h1 class="title">Depolar Arası Transfer Belgesi</h1>
        <div class="subtitle">Depo İşlemleri / Transfer Yönetimi</div>
      </div>
    </div>

    <div class="rule"></div>

    <table class="meta">
      <tr>
        <td class="k">Belge No</td><td class="b">${esc(detail.transferNo)}</td>
        <td class="k">Tarih</td><td class="b">${esc(dateTR(detail.date))}</td>
      </tr>
      <tr>
        <td class="k">Çıkış Depo</td><td>${esc(fromLabel)}</td>
        <td class="k">Giriş Depo</td><td>${esc(toLabel)}</td>
      </tr>
      <tr>
        <td class="k">Konsinye</td><td>${detail.isConsignment ? 'Evet' : 'Hayır'}</td>
        <td class="k">Toplam Kalem</td><td class="b">${lines.length}</td>
      </tr>
      <tr>
        <td class="k">Açıklama</td><td colspan="3">${esc(detail.description ?? '')}</td>
      </tr>
      <tr>
        <td class="k">Teslimat Adresi</td><td colspan="3">${esc(detail.deliveryAddress ?? '')}</td>
      </tr>
    </table>

    <table class="items">
      <thead>
        <tr>
          <th class="c w-sira">Sıra</th>
          <th class="w-kod">Stok Kodu</th>
          <th>Ürün Adı</th>
          <th class="r w-mik">Miktar</th>
        </tr>
      </thead>
      <tbody>
        ${lines.length ? rowsHtml : emptyHtml}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="r">TOPLAM (${lines.length} kalem)</td>
          <td class="r">${qty(totalQty)}</td>
        </tr>
      </tfoot>
    </table>

    <div class="signs">
      <div class="sign">
        <div class="line"></div>
        <div class="lbl">Teslim Eden</div>
      </div>
      <div class="sign">
        <div class="line"></div>
        <div class="lbl">Teslim Alan</div>
      </div>
    </div>

    <div class="foot">Bu belge ${esc(dateTR(new Date().toISOString()))} tarihinde sistem tarafından üretilmiştir.</div>
  </div>
</body>
</html>`
}
