/**
 * SERVİS FİŞİ BASIMI — tek kaynak.
 *
 * Basım, bayi programındaki (B2B) davranışın aynısı: düğmeye basınca ARAYA HİÇBİR EKRAN
 * GİRMEDEN doğrudan tarayıcının yazdırma penceresi açılır. Önceden `ReceiptPreviewModal` →
 * `ReportPrintViewer` zinciri devreye giriyordu; kendi araç çubuğu, sayfa gezinmesi, zoom ve
 * "Yazdır / PDF İndir" düğmeleri olan ayrı bir görüntüleyici ekranıydı ve istenmiyor.
 *
 * İki belge var, kayıttan seçilir:
 *
 *   Küçük ürün                 → SERVİS ARIZA FORMU  (sayfada iki nüsha)
 *   Montaj / beyaz eşya        → HİZMET FİŞİ         (tek sayfa)
 *
 * LOGO BASILMIYOR (2026-08-24, kullanıcı isteği: "fişlerdeki stilsoft logolarını kaldır").
 * Fişler antetli kağıda basıldığı için belgenin kendi logosu gereksiz kalıyordu. Firma
 * bilgileri (ad, adres, telefon) yerinde duruyor — kaldırılan yalnızca görsel.
 *       montaj + fatura no var → sağ üstte FATURA + fatura numarası
 *       montaj + fatura no yok → BAYI
 *       arıza                  → ARIZA
 */

import { printHtmlNative } from '../native/bridge'
import { apiJson } from '../api/client'

type AnyRecord = Record<string, any>

/**
 * Bilinmeyen bir değeri OKUNABİLİR metne çevirir.
 *
 * (2026-08-24, kullanıcı bildirimi: "açıklama [object Object] dönmüş".)
 *
 * `String(x)` bir nesneye uygulandığında `[object Object]` üretiyor ve bu, MÜŞTERİYE VERİLEN
 * kağıda basılıyordu. Fişteki alanların bir kısmı sunucudan metin değil NESNE geliyor —
 * örneğin `notes` bir not listesidir (`{ content, authorName, createdAt }[]`), düz metin değil.
 *
 * Kural: diziler satır satır açılır, nesnelerden bilinen metin alanları okunur, hiçbiri
 * yoksa BOŞ döner. Boş bir alan yanlış bir alandan iyidir.
 */
function metin(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    return value.map(metin).filter((x) => x.trim().length > 0).join('\n')
  }

  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    for (const alan of ['content', 'Content', 'text', 'Text', 'note', 'Note', 'value', 'Value']) {
      const v = o[alan]
      if (typeof v === 'string' && v.trim().length > 0) return v
    }
    return ''
  }

  return ''
}

/** HTML'e gömülecek serbest metin. */
function esc(value: unknown): string {
  return metin(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function trDate(value: unknown): string {
  if (!value) return new Date().toLocaleDateString('tr-TR')
  const d = new Date(String(value))
  return isNaN(d.getTime()) ? new Date().toLocaleDateString('tr-TR') : d.toLocaleDateString('tr-TR')
}

/** Kayıt açıklamasındaki teknik satırlar fişte gösterilmez. */
function cleanProblemDesc(desc?: string): string {
  if (!desc) return ''
  return desc
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return (
        !t.startsWith('Ek Açıklama:') &&
        !t.startsWith('Garanti Başlangıcı:') &&
        !t.startsWith('Müşteri Tipi:') &&
        !t.startsWith('Fatura Numarası:') &&
        !t.startsWith('Fatura No:') &&
        !t.startsWith('Fatura Tipi:') &&
        !t.startsWith('Servis Açıklaması:')
      )
    })
    .join('\n')
    .trim()
}

export function resolveDocKind(record: AnyRecord) {
  const category = String(record?.category ?? record?.productCategory ?? '').toLowerCase()
  const type = String(record?.type ?? '').toLowerCase()

  const invoiceNo =
    String(record?.invoiceReference ?? '').trim() ||
    (String(record?.problemDescription ?? '').match(/Fatura\s*(?:No|Numarası)\s*:\s*(\S+)/i)?.[1] ?? '').trim()

  const isSmall = category === 'small'
  const isInstallation = type === 'installation'

  return {
    isSmall,
    invoiceNo,
    label: isInstallation ? (invoiceNo ? 'FATURA' : 'BAYI') : 'ARIZA',
    title: isSmall ? 'Servis Arıza Formu' : 'Hizmet Fişi',
  }
}

const COMPANY_LINES = [
  'Örnek Mah. Demo Cad. No:1',
  '99010 Lefkoşa - KKTC',
  'www.example.com',
  'info@example.com',
  'Tüketi Danışma Hattı : 0 850 000 00 00',
]

function companyBlock(extraLine?: string): string {
  return `
    <div class="company">
      <div class="company-name">DEMO TİCARET LİMİTED</div>
      ${COMPANY_LINES.map((l) => `<div>${l}</div>`).join('')}
      ${extraLine ? `<div>${esc(extraLine)}</div>` : ''}
    </div>`
}

/**
 * Fişin ürün satırları.
 *
 * ÖNCELİK O FİŞİN GÖREVLERİNDE: bir servis fişi "şu kişi, şu gün, şu ürünleri götürüyor"
 * belgesidir. Kaydın bütün kalemlerini basmak, teknisyene götürmediği ürünleri imzalatmak
 * demekti (kayıtta 3 kalem varken 1 kalemlik fişte üçü birden yazıyordu).
 * Görev gelmezse kaydın kalemlerine, o da yoksa kaydın kendi ürününe düşülür.
 */
/**
 * ÜRÜNÜN SERİ NUMARASI (2026-08-27 kullanıcı isteği: "fiş yazdırmalarda ürünün varsa seri
 * nosu da olmalı").
 *
 * Fişte ürün adının ALTINDA, küçük punto ile basılır. Ayrı sütun açılmadı: fiş iki sütunlu
 * (ürün / miktar) ve sabit genişlikte; üçüncü sütun ürün adını daraltıp uzun model adlarını
 * satıra bölerdi.
 *
 * Boşsa hiç basılmaz — "SN: -" diye boş bir satır kağıtta yer kaplamasın.
 */
function seriNoSatiri(value: unknown): string {
  const sn = metin(value).trim()
  return sn ? `<div class="sn">SN: ${esc(sn)}</div>` : ''
}

/**
 * MÜŞTERİ BİLGİSİ KALEMİN KENDİSİNDEN OKUNUR (2026-09-02 canlı hata).
 *
 * Bir montaj kaydının kalemleri FARKLI adreslere gidebiliyor: MNT-0000290'da altı kalemin
 * biri "İkilavanta Sokak", beşi "Kapı No 27" adresine planlanmıştı. Liste bunu doğru
 * gösteriyordu (montajPlanRows: item.customerAddress || record.customerAddress), ama fiş
 * üç alanı da KAYITTAN okuyordu — iki ayrı kalem için basılan iki fişte aynı adres
 * çıkıyor, teknisyen yanlış eve gidiyordu.
 *
 * DEĞER NEREDE: görevin (installation task) üstünde DEĞİL, kaydın kaleminde
 * (ServiceRecordItem). Fişe gelen görev grubu yalnızca kalem KİMLİĞİNİ taşıyor
 * (groupTasks: serviceRecordItemId); ad/adres/telefon oradan kayda bakılarak bulunur.
 *
 * KURAL: fişteki bütün görevler AYNI kaleme aitse o kalemin bilgisi kullanılır; kalemler
 * ayrışıyorsa kaydınkine düşülür. Çok kalemli tek fişte bir kalemin adresini hepsine
 * yazmak, şimdiki hatanın aynısını ters yönde üretirdi.
 */
function kalemBilgisi(
  record: AnyRecord,
  tasks: AnyRecord[] | undefined,
  gorevAlanlari: string[],
  kalemAlanlari: string[]
): string {
  const gorevler = tasks ?? []

  /*
    ÖNCE GÖREVİN KENDİ TAŞIDIĞI DEĞER. Uç bu alanları kalemden çözüp gönderiyor
    (InstallationsController: ItemCustomerName / ItemCustomerPhone / ItemCustomerAddress).
    Bütün görevler aynı değerde birleşmiyorsa kullanılmaz.
  */
  const gorevDegerleri = new Set<string>()
  for (const t of gorevler) {
    for (const alan of gorevAlanlari) {
      const v = metin(t?.[alan]).trim()
      if (v) { gorevDegerleri.add(v); break }
    }
  }
  if (gorevDegerleri.size === 1) return Array.from(gorevDegerleri)[0]

  /*
    YEDEK YOL: kalem kimliğinden kaydın kalemine bakılır. Uç eski sürümdeyse (alanları
    göndermiyorsa) fiş yine doğru adresi bulur — API paketi atılmadan da çalışır.
  */
  const kimlikler = new Set<string>()
  for (const t of gorevler) {
    const kid = metin(t?.serviceRecordItemId ?? t?.ServiceRecordItemId).trim()
    if (kid) kimlikler.add(kid)
  }
  if (kimlikler.size !== 1) return ''

  const hedef = Array.from(kimlikler)[0]
  const kalemler = Array.isArray(record?.items) ? record.items : []
  const kalem = kalemler.find((k: AnyRecord) => metin(k?.id ?? k?.Id).trim() === hedef)
  if (!kalem) return ''

  for (const alan of kalemAlanlari) {
    const v = metin(kalem[alan]).trim()
    if (v) return v
  }
  return ''
}

function productRows(record: AnyRecord, tasks?: AnyRecord[]): string {
  const taskLines = (tasks ?? [])
    .flatMap((t) => (Array.isArray(t?.items) ? t.items : []))
    .filter((i) => i && (i.productName ?? i.ProductName))

  if (taskLines.length > 0) {
    /*
      Aynı ürün birden çok görevden geliyorsa tek satırda toplanır.

      SERİ NUMARASI TOPLAMAYI BÖLER: aynı model iki ayrı cihazsa iki ayrı seri numarası
      vardır ve tek satırda birleştirilirse hangi seri kaç adet belli olmaz. Bu yüzden
      anahtar "ürün + seri"; serisi olmayanlar eskisi gibi tek satırda toplanır.
    */
    const merged = new Map<string, { name: string; sn: string; qty: number }>()
    for (const line of taskLines) {
      const name = String(line.productName ?? line.ProductName)
      const sn = metin(line.serialNumber ?? line.SerialNumber).trim()
      const key = `${name}||${sn}`
      const mevcut = merged.get(key)
      const adet = Number(line.quantity ?? line.Quantity) || 1
      if (mevcut) mevcut.qty += adet
      else merged.set(key, { name, sn, qty: adet })
    }
    return Array.from(merged.values())
      .map(
        ({ name, sn, qty }) => `<tr>
          <td class="cell">${esc(name)}${seriNoSatiri(sn)}</td>
          <td class="cell center qty">${esc(qty)}</td>
        </tr>`,
      )
      .join('')
  }

  const items: AnyRecord[] = Array.isArray(record?.items) ? record.items : []
  if (items.length > 0) {
    return items
      .map(
        (i) => `<tr>
          <td class="cell">${esc(i?.productName ?? i?.name ?? '')}${seriNoSatiri(i?.serialNumber ?? i?.SerialNumber)}</td>
          <td class="cell center qty">${esc(Number(i?.quantity) || 1)}</td>
        </tr>`,
      )
      .join('')
  }

  const stockCode = record?.stockCode || record?.productStockCode || ''
  const name = String(record?.productName ?? '')
  const withCode = stockCode && !name.includes(stockCode) ? `${stockCode} ${name}` : name
  const qty = Number(record?.totalQuantity) || 1
  return `<tr>
    <td class="cell">${esc(withCode)}${seriNoSatiri(record?.serialNumber ?? record?.SerialNumber)}</td>
    <td class="cell center qty">${esc(qty)}</td>
  </tr>`
}

/**
 * KAĞIT FİŞ NO — elle tutulan fiş defterindeki numara.
 *
 * Sistem numarası (`serviceNumber`) ile karıştırılmamalı: bu, kabulde müşteriye verilen
 * BASILI fişin üzerindeki numaradır ve kayıtla kağıdı eşleştirmeye yarar. Değeri girilmemiş
 * olsa bile satır basılır — kağıt üstünde elle doldurulabilsin diye.
 */
/**
 * Arıza formundaki "Açıklama" alanı.
 *
 * Sıra önemli: kabulde yazılan serbest not (`receivingNote`) asıl açıklamadır. `notes` ise
 * kayıt boyunca eklenen not KAYITLARIDIR; metin alanı değil, nesne listesidir ve yalnızca
 * öncekiler boşsa kullanılır.
 */
function arizaAciklamasi(record: AnyRecord): string {
  const adaylar = [record?.description, record?.receivingNote, record?.notes]
  for (const aday of adaylar) {
    const t = metin(aday).trim()
    if (t.length > 0) return t
  }
  return ''
}

function kagitFisNo(record: AnyRecord): string {
  return String(record?.manualReceiptNo ?? record?.ManualReceiptNo ?? '').trim()
}

/** HİZMET FİŞİ — montaj ve beyaz eşya (tek sayfa). */
function buildHizmetFisi(record: AnyRecord, tasks?: AnyRecord[]): string {
  const { label, invoiceNo } = resolveDocKind(record)
  const slipNo = String(record?.serviceNumber ?? '').trim()
  /*
    BAYİ NOTU FİŞE BASILIR (2026-09-07 kullanıcı bildirimi: "bayi notu kağıda yazmıyor").

    Fatura üzerinden açılan montajda `problemDescription` = "Fatura üzerinden otomatik
    oluşturuldu [Fatura No: …]" oluyor; bayinin Montaj Yönetimi'nde yazdığı not
    (`dealerDescription`, ör. "1 ADET GURMEGA GİDECEK") hiç basılmıyordu — oysa teknisyenin
    sahada okuması gereken asıl bilgi o.

    Bayi notu ÖNCE yazılır; otomatik metin varsa altına eklenir, ikisi de duruyorsa
    kaybolan olmaz.
  */
  const bayiNotu = String(record?.dealerDescription ?? record?.DealerDescription ?? '').trim()
  const otomatikAciklama =
    cleanProblemDesc(record?.problemDescription) || record?.description || record?.serviceNote || ''
  const description = [bayiNotu, otomatikAciklama]
    .map((x) => String(x ?? '').trim())
    .filter((x) => x.length > 0)
    .join('\n')

  // Fişin sorumlusu, o fişteki görevlerin teknisyenidir; kaydın genel ataması değil.
  const technician =
    (tasks ?? []).map((t) => t?.technicianName ?? t?.TechnicianName).find((n) => n) ??
    record?.assignedTechnicianName

  // Tarih de fişin kendi planlama günü olmalı.
  const slipDate = (tasks ?? []).map((t) => t?.plannedAt ?? t?.PlannedAt).find((d) => d)

  return `
    <div class="sheet hizmet">
      <div class="top">
        ${companyBlock(slipNo)}
        <div class="top-right">
          <div class="date">${esc(trDate(slipDate || record?.plannedDate || record?.createdAt))}</div>
        </div>
      </div>

      <div class="doctype">
        <div class="doctype-label">${esc(label)}</div>
        ${invoiceNo ? `<div class="invoice-no">${esc(invoiceNo)}</div>` : ''}
      </div>

      <table class="grid">
        <colgroup>
          <col style="width: 22%;" />
          <col style="width: 78%;" />
        </colgroup>
        <tr><th class="cell head" colspan="2">HİZMET FİŞİ</th></tr>
        <tr><td class="cell lbl">Adı - Soyadı</td><td class="cell">${esc(kalemBilgisi(record, tasks, ['itemCustomerName', 'ItemCustomerName'], ['customerName', 'CustomerName']) || record?.customerName)}</td></tr>
        <tr><td class="cell lbl">Adres</td><td class="cell">${esc(kalemBilgisi(record, tasks, ['itemCustomerAddress', 'ItemCustomerAddress', 'customAddress', 'CustomAddress'], ['customerAddress', 'CustomerAddress']) || record?.customerAddress)}</td></tr>
        <tr><td class="cell lbl">Bölge</td><td class="cell">${esc(record?.regionName ?? record?.district)}</td></tr>
        <tr><td class="cell lbl">Telefon</td><td class="cell">${esc(kalemBilgisi(record, tasks, ['itemCustomerPhone', 'ItemCustomerPhone'], ['customerPhone', 'CustomerPhone']) || record?.customerPhone)}</td></tr>
        <tr><td class="cell lbl">Bayi Adı</td><td class="cell">${esc(record?.dealerName)}</td></tr>
        <tr><td class="cell lbl">Bayi Telefon</td><td class="cell">${esc(record?.dealerPhone)}</td></tr>
        <tr><td class="cell lbl">Kağıt Fiş No</td><td class="cell">${esc(kagitFisNo(record))}</td></tr>
      </table>

      <table class="grid products">
        <colgroup>
          <col style="width: 85%;" />
          <col style="width: 15%;" />
        </colgroup>
        <tr><th class="cell head" colspan="2">ÜRÜN BİLGİLERİ</th></tr>
        <tr><th class="cell center">ÜRÜN ADI</th><th class="cell center qty">MİKTAR</th></tr>
        ${productRows(record, tasks)}
      </table>

      <table class="grid">
        <colgroup>
          <col style="width: 50%;" />
          <col style="width: 50%;" />
        </colgroup>
        <tr><th class="cell center" colspan="2">AÇIKLAMA</th></tr>
        <tr><td class="cell desc" colspan="2">${esc(description)}</td></tr>
        <tr>
          <td class="cell center bold">SERVİS SORUMLUSU</td>
          <td class="cell center bold">MÜŞTERİ</td>
        </tr>
        <tr>
          <td class="cell center bold">${esc(technician)}</td>
          <td class="cell center bold">${esc(record?.customerName)}</td>
        </tr>
        <tr><td class="cell center bold">İMZA</td><td class="cell center bold">İMZA</td></tr>
        <tr><td class="cell sign"></td><td class="cell sign"></td></tr>
      </table>
    </div>`
}

/** SERVİS ARIZA FORMU — küçük ürün. Sayfada iki nüsha. */
function buildServisArizaFormu(record: AnyRecord): string {
  const slipNo = String(record?.serviceNumber ?? '').trim()
  const kabulTarihi = trDate(record?.createdAt || record?.plannedDate)
  const fee = Number(record?.totalCost ?? record?.processingFee ?? 0).toFixed(2).replace('.', ',')

  const stockCode = record?.stockCode || record?.productStockCode || ''
  const name = String(record?.productName ?? '')
  const productName = stockCode && !name.includes(stockCode) ? `${stockCode} ${name}` : name

  const copy = `
    <div class="ariza-copy">
      <div class="top">
        ${companyBlock()}
      </div>
      <div class="title">SERVİS ARIZA FORMU</div>

      <!--
        SATIR SIRASI KULLANICI İSTEĞİ (2026-08-27): sol blokta "Bayi Müşteri" üstte,
        "Müşteri Adı" altında; sağ blokta "Kağıt Fiş No" üstte, "Servis Fiş No" altında.
        Fişi elinde tutan kişi önce bunlara bakıyor.
      -->
      <table class="cols"><tr>
        <td class="col">
          <div class="grouplabel">Tüketici Bilgileri</div>
          <table class="grid">
            <tr><td class="cell lbl">Bayi Müşteri</td><td class="cell">${esc(record?.dealerName)}</td></tr>
            <tr><td class="cell lbl">Müşteri Adı</td><td class="cell">${esc(record?.customerName)}</td></tr>
            <tr><td class="cell lbl">Müşteri Telefon</td><td class="cell">${esc(record?.customerPhone)}</td></tr>
            <tr><td class="cell lbl">Müşteri Adres</td><td class="cell">${esc(record?.customerAddress)}</td></tr>
            <tr><td class="cell lbl">Müşteri İlçe</td><td class="cell">${esc(record?.regionName ?? record?.district)}</td></tr>
          </table>
        </td>
        <td class="col">
          <div class="grouplabel">Ürün Bilgileri</div>
          <table class="grid">
            <tr><td class="cell lbl">Ürün Adı</td><td class="cell">${esc(productName)}</td></tr>
            ${metin(record?.serialNumber).trim() ? `<tr><td class="cell lbl">Seri No</td><td class="cell">${esc(record?.serialNumber)}</td></tr>` : ''}
            <tr><td class="cell lbl">Kağıt Fiş No</td><td class="cell">${esc(kagitFisNo(record))}</td></tr>
            <tr><td class="cell lbl">Servis Fiş No</td><td class="cell">${esc(slipNo)}</td></tr>
          </table>
        </td>
      </tr></table>

      <div class="grouplabel">Arıza Bilgileri</div>
      <table class="grid wide">
        <tr><td class="cell lbl">Kabul Tarihi</td><td class="cell">${esc(kabulTarihi)}</td></tr>
        <tr><td class="cell lbl">Müşteri Şikayeti</td><td class="cell">${esc(cleanProblemDesc(record?.problemDescription))}</td></tr>
        <tr><td class="cell lbl">Açıklama</td><td class="cell desc-sm">${esc(arizaAciklamasi(record))}</td></tr>
        <tr><td class="cell lbl">İşlem Ücreti</td><td class="cell">${esc(fee)}</td></tr>
        <tr><td class="cell lbl">Müşteri İmzası</td><td class="cell sign-sm"></td></tr>
      </table>

      <div class="footnote">3 ay içerisinde alınmayan üründen meshul değiliz</div>
    </div>`

  // İki nüsha TEK sayfada, ortadan kesilmek üzere. Eskiden her nüsha kendi `.sheet`'i olduğu
  // için (ve `.sheet` bir tam A4 yüksekliğinde) çıktı iki sayfaya bölünüyordu; kağıt ortadan
  // kesilerek iki eş fiş elde edilemiyordu. Artık tek sayfa, ortada kesim çizgisi var.
  return `
    <div class="sheet ariza">
      ${copy}
      <div class="cutline"></div>
      ${copy}
    </div>`
}

function buildDocument(record: AnyRecord, tasks?: AnyRecord[]): string {
  const { isSmall, title } = resolveDocKind(record)
  const body = isSmall ? buildServisArizaFormu(record) : buildHizmetFisi(record, tasks)
  const slipNo = String(record?.serviceNumber ?? '').trim()

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>${esc(title)} ${esc(slipNo)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 12mm; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 11px; color: #000; margin: 0; }
  .sheet { page-break-inside: avoid; }

  /*
   * EKRAN GÖRÜNÜMÜ. Yazdırma penceresinde "İptal" denince belge sekmesi açık kalıyor ve o zamana
   * kadar hiçbir genişlik sınırı olmadığı için tablolar ekranın tamamına yayılıyordu — kağıt
   * gibi değil, gerilmiş bir tablo gibi görünüyordu. Basımda etkisi yok: aşağıdaki kural
   * yalnızca ekran içindir, @page ölçüleri değişmedi.
   */
  @media screen {
    body { background: #525659; padding: 16px 0; }
    .sheet {
      width: 186mm;              /* A4 (210mm) eksi @page kenar boşlukları (2 x 12mm) */
      min-height: 273mm;
      margin: 0 auto 16px;
      padding: 12mm;
      background: #fff;
      box-shadow: 0 2px 10px rgba(0,0,0,.35);
      box-sizing: content-box;
    }
  }
  .company { font-size: 10px; line-height: 1.35; }
  .company-name { font-weight: bold; font-size: 12px; margin-bottom: 1px; }

  /* HİZMET FİŞİ */
  .top { display: flex; justify-content: space-between; align-items: flex-start; }
  .top-right { text-align: right; }
  .date { font-size: 11px; }
  .doctype { text-align: right; margin: 26px 0 18px; }
  .doctype-label { font-size: 15px; font-weight: bold; letter-spacing: 1px; }
  .invoice-no { font-size: 11px; font-weight: bold; margin-top: 4px; }

  /*
   * SAĞ KENAR ÇİZGİSİ. Genişliği yüzde veren otomatik tablo yerleşiminde son sütunun kenarlığı
   * yuvarlama farkı yüzünden yazdırılabilir alanın dışına taşıp kayboluyordu — çıktıda tablonun
   * sağ tarafı açık kalıyordu. Sabit yerleşim (table-layout: fixed) genişliği kilitliyor,
   * tablonun kendi kenarlığı da kapanışı garantiye alıyor.
   */
  .grid { width: 100%; border-collapse: collapse; table-layout: fixed; border: 2px solid #000; margin-bottom: 18px; }
  .cell { border: 2px solid #000; padding: 3px 6px; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
  .cell.head { text-align: center; font-weight: bold; font-size: 12px; }
  .cell.lbl { font-weight: bold; width: 38%; white-space: nowrap; }
  /* Ürün adının altındaki seri numarası: okunur ama ürün adını bastırmayan bir punto. */
  .sn { font-size: 9px; margin-top: 1px; }
  .cell.center { text-align: center; }
  .cell.bold { font-weight: bold; }
  .cell.qty { width: 15%; }
  .cell.half { width: 50%; }
  .cell.desc { height: 38mm; white-space: pre-wrap; }
  .cell.sign { height: 18mm; }
  .products { margin-bottom: 0; }

  /* SERVİS ARIZA FORMU */
  /*
   * KÜÇÜK ÜRÜN — tek sayfada iki nüsha, ortadan kesiliyor.
   *
   * Nüshalar sayfayı ikiye bölüyor: her biri yazdırılabilir yüksekliğin yarısı kadar yer alıyor
   * (A4 297mm - 2x12mm kenar boşluğu = 273mm; yarısı ~136mm). Sabit yükseklik yerine esnek
   * kutu (flex) kullanılıyor ki alt nüsha her zaman tam ortadan başlasın — içerik biraz uzayıp
   * kısalsa da kesim çizgisi kaymasın.
   *
   * NOT: bu blok bir şablon dizesi (template literal) içinde; yorumlarda ters tırnak KULLANMA,
   * dizeyi erken kapatır ve dosya derlenmez.
   */
  .sheet.ariza { display: flex; flex-direction: column; }
  .ariza-copy { flex: 1 1 0; min-height: 0; overflow: hidden; }
  /* Nüsha yarım sayfa; hizmet fişindeki tam boy logo burada yeri gereksiz yere yiyor. */
  .cutline {
    flex: 0 0 auto;
    border-top: 1px dashed #999;
    margin: 4mm 0;
  }
  @media print {
    body { margin: 0; padding: 0; background: #fff; }
    .sheet {
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      box-shadow: none !important;
      background: #fff !important;
    }
    .grid {
      width: 99.9% !important;
    }
    /* Basımda sayfa yüksekliği @page'ten gelir; ekrandaki min-height burada geçerli değil. */
    .sheet.ariza { height: 273mm; }
  }
  .title { text-align: center; font-weight: bold; font-size: 12px; margin: 14px 0 10px; }
  .grouplabel { font-weight: bold; font-size: 10px; margin: 8px 0 4px; }
  .cols { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .cols .col { width: 50%; vertical-align: top; padding-right: 8px; }
  .cols .col + .col { padding: 0 0 0 8px; }
  .grid.wide .cell.lbl { width: 38%; }
  .cell.desc-sm { height: 12mm; white-space: pre-wrap; }
  .cell.sign-sm { height: 10mm; }
  .footnote { font-weight: bold; font-size: 15px; margin-top: 10px; }

  /*
   * HIZMET FISI PUNTOLARI BUYUTULDU (2026-09-02 kullanici istegi: yazi puntolari cok kucuk).
   *
   * KAPSAM YALNIZCA .sheet.hizmet -- govde ve tablo kurallari iki belgede ORTAK. Dogrudan
   * body puntosunu buyutmek Servis Ariza Formunu da buyuturdu; o form TEK A4'e IKI NUSHA
   * sigmak zorunda (.sheet.ariza yuksekligi 273mm sabit) ve birkac piksel tasma kesim
   * cizgisini kaydirir, iki fis esit olmaz.
   *
   * Hizmet fisinde yer var: aciklama kutusu 38mm sabit ve ciktinin alt ucte biri bos
   * kaliyordu. Artis yaklasik %27.
   *
   * NOT: bu stil blogu bir SABLON DIZESI icinde. Yorumlarda TERS TIRNAK KULLANMA --
   * dizeyi erken kapatir ve tsc bunu YAKALAMAZ, yalnizca gercek derleme yakalar.
   */
  .sheet.hizmet { font-size: 14px; }
  .sheet.hizmet .company { font-size: 12px; }
  .sheet.hizmet .company-name { font-size: 14px; }
  .sheet.hizmet .date { font-size: 13px; }
  .sheet.hizmet .doctype-label { font-size: 19px; }
  .sheet.hizmet .invoice-no { font-size: 14px; }
  .sheet.hizmet .cell { padding: 5px 8px; }
  .sheet.hizmet .cell.head { font-size: 15px; }
  .sheet.hizmet .sn { font-size: 11px; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
${body}
<script>
  /*
   * Yazdırma penceresi kapanınca (bastır ya da İPTAL) belge sekmesi de kapanır. Eskiden iptal
   * edilince sekme açık kalıyor ve kullanıcı ne bastığını sandığı belgeyle baş başa kalıyordu.
   * Kapatma başarısız olursa (tarayıcı script ile açılmayan pencereyi kapattırmaz) sekme
   * kağıt görünümünde kalır — bu yüzden ekran düzeni de ayrıca ayarlandı.
   */
  (function () {
    var closed = false
    function done() {
      if (closed) return
      closed = true
      setTimeout(function () { try { window.close() } catch (e) {} }, 150)
    }
    window.addEventListener('afterprint', done)
    window.onload = function () {
      setTimeout(function () {
        try { window.print() } catch (e) {}
        // afterprint desteklenmeyen tarayıcılar için emniyet: odak geri gelince kapat.
        window.addEventListener('focus', done, { once: true })
      }, 120)
    }
  })()
</script>
</body>
</html>`
}

/**
 * FİŞ HER ZAMAN SUNUCUDAKİ GÜNCEL KAYITTAN BASILIR (2026-10-14 kullanıcı bildirimi: "arıza kaydı
 * düzenlendiğinde basıma alınca tekrar eski halini basıyor").
 *
 * Basım, ekrandaki LİSTE SATIRINDAN besleniyordu. Saha/Atölye ekranlarında bilgi düzenlenince
 * yalnız açık detay penceresi güncelleniyor, liste yenilenmiyordu; menüdeki "Fiş Yazdır" eski
 * satırı (eski müşteri/ürün/şikayet) basıyordu. Artık basımdan hemen önce kayıt kimliğiyle
 * sunucudan okunur; okunamazsa (ağ, yetki) eldeki satırla basılır — basım hiçbir durumda düşmez.
 */
export async function printServiceSlipFresh(record: AnyRecord, tasks?: AnyRecord[]): Promise<void> {
  if (!record) return
  let current = record
  const id = record?.id ?? record?.Id
  if (id) {
    try {
      const fresh = await apiJson<AnyRecord>(`/api/servicerecords/${id}`)
      if (fresh && (fresh.id ?? fresh.Id)) current = { ...record, ...fresh }
    } catch {
      // eldeki satırla devam
    }
  }
  printServiceSlip(current, tasks)
}

/**
 * Fişi doğrudan yazdırır — önizleme ekranı açmadan.
 *
 * Önce ayrı bir sekmede açılır (kullanıcı isterse oradan PDF olarak da kaydedebilir); açılamazsa
 * (pop-up engelleyici) sayfanın içinde gizli bir iframe üzerinden basılır, yani basım hiçbir
 * durumda sessizce kaybolmaz.
 */
export function printServiceSlip(record: AnyRecord, tasks?: AnyRecord[]): void {
  if (!record) return
  const html = buildDocument(record, tasks)

  // Telefon uygulamasında yeni sekme de gizli iframe de yok: WebView `window.open`'ı sessizce
  // yutar, `window.print` ise Android'de hiç tanımlı değildir. Belge native yazdırma ekranına
  // gider; oradan yazıcıya ya da PDF'e verilir.
  if (printHtmlNative(html)) return

  let win: Window | null = null
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    win = window.open(URL.createObjectURL(blob), '_blank')
  } catch {
    win = null
  }
  if (win) return

  const id = 'service-slip-print-iframe'
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
