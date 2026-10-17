import { printHtmlNative } from '../native/bridge'

/**
 * KARGO / TESLİMAT FİŞİ (2026-09-10 kullanıcı isteği: "burada da fiş yazdırma olması
 * lazımdı tıpkı montajdaki gibi").
 *
 * <b>Neden servis fişinden ayrı bir modül:</b> `serviceSlip.ts` montaj/arıza kaydının
 * alanlarına göre kurulmuş (teknisyen, arıza tanımı, kalem satırları, iki nüsha kuralı).
 * Kargo kaydının alanları bambaşka: sipariş no, paket dökümü, teslim adresi, kurye.
 * O dosyaya ikinci bir belge tipi daha eklemek onu okunamaz hâle getirirdi; basım
 * ZİNCİRİ ise ortak (`printHtmlNative` + yeni sekme + gizli iframe yedeği).
 *
 * <b>Neden iki nüsha:</b> biri müşteride kalır, biri imzalı olarak kuryede döner. Montaj
 * fişindeki kural aynı; tek sayfaya sığması için ölçüler ona göre.
 *
 * <b>Logo yok — bilerek:</b> arayüzdeki logo beyaz zeminli değil, basımda kararıyor
 * (montaj fişinde de aynı sebeple kullanılmıyor). Başlık düz metin.
 */

type Kargo = {
  orderNumber?: string | null
  customerName?: string | null
  customerPhone?: string | null
  deliveryAddress?: string | null
  productDetails?: string | null
  orderDate?: string | null
  plannedDate?: string | null
  assignedTechnicianName?: string | null
  statusLabel?: string | null
}

/** HTML'e gömülen her değer buradan geçer; sipariş verisi kullanıcı girdisidir. */
function kacir(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function tarih(value?: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('tr-TR')
}

/** Paket dökümü satır satır geliyor; her satır ayrı `<li>` olarak basılıyor. */
function urunSatirlari(details?: string | null): string {
  const satirlar = String(details ?? '')
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)

  if (satirlar.length === 0) return '<li>Ürün dökümü yok</li>'
  return satirlar.map((x) => `<li>${kacir(x)}</li>`).join('')
}

function nusha(k: Kargo, etiket: string): string {
  return `
  <section class="nusha">
    <header class="ust">
      <div class="marka">STILSOFT DEMO</div>
      <div class="tip">TESLİMAT FİŞİ<span class="etiket">${kacir(etiket)}</span></div>
    </header>

    <table class="bilgi">
      <tr><th>Sipariş No</th><td class="mono">${kacir(k.orderNumber ?? '-')}</td>
          <th>Sipariş Tarihi</th><td>${tarih(k.orderDate)}</td></tr>
      <tr><th>Müşteri</th><td>${kacir(k.customerName ?? '-')}</td>
          <th>Telefon</th><td class="mono">${kacir(k.customerPhone ?? '-')}</td></tr>
      <tr><th>Adres</th><td colspan="3">${kacir(k.deliveryAddress ?? '-')}</td></tr>
      <tr><th>Kurye</th><td>${kacir(k.assignedTechnicianName ?? 'Atanmadı')}</td>
          <th>Planlanan</th><td>${tarih(k.plannedDate)}</td></tr>
    </table>

    <div class="baslik">Paket Dökümü</div>
    <ul class="urunler">${urunSatirlari(k.productDetails)}</ul>

    <table class="imza">
      <tr>
        <td>Teslim Eden<div class="cizgi"></div></td>
        <td>Teslim Alan<div class="cizgi"></div></td>
      </tr>
    </table>
  </section>`
}

function belge(k: Kargo): string {
  /*
    CSS ŞABLON DİZESİ TUZAĞI: bu dize `${}` ile veri gömüyor, dolayısıyla CSS içindeki
    süslü parantezler sorun değil ama `${` ile başlayan bir CSS değeri OLMAMALI.
    (Servis fişinde bir kez bu yüzden stil bozulmuştu.)
  */
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Teslimat Fişi</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 11.5px; }
  .nusha { border: 1px solid #111; padding: 10px 12px; margin-bottom: 8px; }
  /* İki nüsha tek A4'e sığmalı; ikincisinden sonra sayfa kırılmıyor. */
  .nusha:last-child { margin-bottom: 0; }
  .ust { display: flex; justify-content: space-between; align-items: flex-end;
         border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
  .marka { font-size: 17px; font-weight: 800; letter-spacing: 0.5px; }
  .tip { font-size: 12px; font-weight: 700; text-align: right; }
  .etiket { display: block; font-size: 10px; font-weight: 600; color: #444; margin-top: 2px; }
  table.bilgi { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  table.bilgi th, table.bilgi td { border: 1px solid #999; padding: 4px 6px; text-align: left;
                                   vertical-align: top; }
  table.bilgi th { background: #eee; width: 78px; font-size: 10.5px; text-transform: uppercase; }
  .mono { font-family: "Courier New", monospace; }
  .baslik { font-weight: 800; font-size: 11px; text-transform: uppercase;
            border-bottom: 1px solid #111; padding-bottom: 3px; margin-bottom: 5px; }
  ul.urunler { margin: 0 0 10px; padding-left: 18px; }
  ul.urunler li { margin-bottom: 2px; }
  table.imza { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.imza td { width: 50%; padding: 4px 8px 0; font-size: 10.5px; font-weight: 700; }
  .cizgi { border-bottom: 1px solid #111; height: 30px; }
</style></head>
<body onload="try{window.print()}catch(e){}">
${nusha(k, 'MÜŞTERİ NÜSHASI')}
${nusha(k, 'FİRMA NÜSHASI')}
</body></html>`
}

/**
 * Fişi basar. Basım zinciri servis fişiyle AYNI sırada:
 *   1. Native köprü (telefon uygulaması) — WebView `window.open`ı yutuyor, `window.print` yok.
 *   2. Yeni sekme (blob URL).
 *   3. Gizli iframe — açılır pencere engelliyse tek çalışan yol.
 */
export function printCargoSlip(kargo: Kargo | null | undefined): void {
  if (!kargo) return
  const html = belge(kargo)

  if (printHtmlNative(html)) return

  let win: Window | null = null
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    win = window.open(URL.createObjectURL(blob), '_blank')
  } catch {
    win = null
  }
  if (win) return

  const id = 'cargo-slip-print-iframe'
  let iframe = document.getElementById(id) as HTMLIFrameElement | null
  if (!iframe) {
    iframe = document.createElement('iframe')
    iframe.id = id
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)
  }

  const doc = iframe.contentWindow?.document || iframe.contentDocument
  if (!doc) return
  doc.open()
  doc.write(html)
  doc.close()
}
