import { getCustomerOffer } from '../api/customerOffers'
import { getCariOffer } from '../api/cariOffers'
import { fetchCustomerByCode } from '../api/customers'
import { normalizeDiscountType } from './discountType'

/**
 * PROFORMA FATURA basımı.
 *
 * Yerleşim, kullanıcının "olması gereken hâli" diye verdiği referans çıktıdan MİLİMETRİK olarak
 * çıkarıldı: sayfa 612x792pt (Letter), gövde 8pt Courier bold. Bu boyutta Courier'in ilerlemesi
 * tam 4,8pt olduğu için bütün sütunlar 4,8pt'lik bir karakter ızgarasına oturuyor — referanstaki
 * boşluk genişlikleri ölçülerek doğrulandı.
 *
 * Konumlar akışa BIRAKILMADI, tek tek mutlak yerleştirildi. Akışla dizmek satır yüksekliği,
 * kenar boşluğu ve font ölçüsü farklarında kayıyor; referansta ise alt blok (BRÜT TUTAR ve
 * altındakiler) sayfanın sabit bir yerinde duruyor ve kalem sayısından etkilenmiyor.
 *
 * Dikey konumlar TABAN ÇİZGİSİ (baseline) olarak tutuluyor. Referans PDF'te sıfır yükseklikli
 * boşluk glifleri tam taban çizgisinde raporlandığı için ölçüm doğrudan oradan okundu.
 *
 * Gövde SVG olarak çiziliyor, HTML kutularıyla değil. Sebep ölçü kesinliği: HTML'de mutlak
 * konumlanan bir satırın taban çizgisi, kutunun tepesinden yazı tipinin ascent'i kadar aşağıda
 * durur ve tarayıcı bu değeri tam piksele yuvarlar — 8pt'de 6,25pt, 9pt'de 6,75pt çıkıyor, yani
 * ölçüye göre değişen bir düzeltme sabiti gerekiyordu ve bu sabit başka makinede/sürümde
 * kayabilirdi. SVG'de `<text y>` DOĞRUDAN taban çizgisidir; yazı tipi ölçülerine hiç
 * bağlı değil, dolayısıyla referanstaki değerler birebir yazılabiliyor.
 */

/** Gövde yazı tipi ölçüsü. Courier'de ilerleme 0,6em → 4,8pt'lik ızgara (tarayıcıda doğrulandı). */
const FONT_PT = 8
/** GENEL TOPLAM satırı: referanstaki 64,7pt etiket genişliği 9pt'de birebir tutuyor. */
const GENEL_FONT_PT = 9
/** Başlık: referanstaki 112,9pt genişlik Times New Roman Bold 11,2pt ile tutuyor. */
const TITLE_FONT_PT = 11.2

/** Referanstan ölçülen taban çizgileri (sayfa tepesinden pt). */
const Y = {
  custLine1: 124.4,
  custLine2: 152.9,
  title: 158.2,
  custLine3: 194.1,
  docNo: 194.1,
  date: 209.9,
  taxLine: 224.1,
  tableHead: 314.1,
  firstRow: 326.9,
  brut: 616.4,
  teslimAlan: 656.1,
  vatFirst: 666.1,
  yalniz: 691.4,
  toplamKdv: 699.3,
  montaj: 707.9,
  genelToplam: 716.7,
  not: 724.5,
} as const

/** Kalem satırları arası adım (referansta başlık→ilk satır farkı). */
const ROW_STEP_PT = 12.8
/** KDV kırılım satırları arası adım. */
const VAT_STEP_PT = 16.4

/** Yatay çapalar (pt). Sol sütun ızgarasının başlangıcı 30,7. */
const X = {
  left: 30.7,
  right: 496.5,
  barcode: 30.7,
  product: 102.9,
  headStok: 184.2,
  kdvRight: 393.2,
  miktarRight: 446.4,
  birimRight: 510.8,
  tutarRight: 564.2,
  /** "VERGİ NO :" referansta sabit sütunda (ızgarada 19. karakter); daire adı uzasa da kaymaz. */
  taxNo: 121.9,
  totalLabel: 351.6,
  totalRight: 565.0,
  logoLeft: 284.32,
  logoTop: 210.79,
  logoW: 128,
  logoH: 72,
  titleCenter: 343.9,
} as const

const PAGE_W_PT = 612
const PAGE_H_PT = 792

/**
 * Belgenin para birimini adlandırır (1=TRY 2=EUR 3=USD 4=GBP; 0 da TL).
 *
 * Teklif kalemleri müşterinin para biriminde saklanır ve TL'ye ancak fatura kesilirken
 * çevrilir — dolayısıyla proforma "YALNIZ :" satırında sabit "TL" yazmak, dolar borcu için
 * lira taahhüt eden bir belge üretiyordu. TL çıktısı bilerek DEĞİŞMEZ: satır 4,8pt'lik
 * karakter ızgarasında ölçülü, TL/KR önündeki çift boşluk dahil.
 */
const currencyWordUnits = (currencyTypeId?: number): { main: string; sub: string } => {
  switch (Number(currencyTypeId ?? 1)) {
    case 2: return { main: 'EURO', sub: 'CENT' };
    case 3: return { main: 'AMERİKAN DOLARI', sub: 'CENT' };
    case 4: return { main: 'STERLİN', sub: 'PENİ' };
    // 0, 1 ve bilinmeyen kod TL'ye düşer: yazıyla satırını boş bırakmak belgeyi geçersiz kılar.
    default: return { main: 'TL', sub: 'KR' };
  }
};

const convertNumberToTurkishWords = (num: number, currencyTypeId?: number): string => {
  const { main: mainUnit, sub: subUnit } = currencyWordUnits(currencyTypeId);
  const units = ["", "BİR", "İKİ", "ÜÇ", "DÖRT", "BEŞ", "ALTI", "YEDİ", "SEKİZ", "DOKUZ"];
  const tens = ["", "ON", "YİRMİ", "OTUZ", "KIRK", "ELLİ", "ALTMIŞ", "YETMİŞ", "SEKSEN", "DOKSAN"];
  const thousands = ["", "BİN", "MİLYON", "MİLYAR", "TRİLYON"];

  const readGroup = (n: number): string => {
    let str = "";
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;

    if (h > 0) {
      if (h === 1) str += "YÜZ";
      else str += units[h] + " " + "YÜZ";
    }

    if (t > 0) {
      if (str) str += " ";
      str += tens[t];
    }

    if (u > 0) {
      if (str) str += " ";
      str += units[u];
    }

    return str;
  };

  // Referansta "…DOKUZ  TL BEŞ  KR" — TL ve KR'den ÖNCE İKİ boşluk var. Ölçüm 4,8pt'lik
  // karakter ızgarasından doğrulandı; tek boşluğa düşürülürse satırın tamamı bir hücre kayar.
  if (num === 0) return `SIFIR  ${mainUnit} SIFIR  ${subUnit}`;

  const parts = num.toFixed(2).split(".");
  const lira = parseInt(parts[0], 10);
  const kurus = parseInt(parts[1], 10);

  let liraStr = "";
  if (lira === 0) {
    liraStr = "SIFIR";
  } else {
    let temp = lira;
    let groupIdx = 0;
    const groups: string[] = [];

    while (temp > 0) {
      const groupVal = temp % 1000;
      if (groupVal > 0) {
        let groupStr = readGroup(groupVal);
        if (groupIdx === 1 && groupVal === 1) {
          groupStr = "BİN";
        } else if (thousands[groupIdx]) {
          groupStr += " " + thousands[groupIdx];
        }
        groups.unshift(groupStr);
      }
      temp = Math.floor(temp / 1000);
      groupIdx++;
    }
    liraStr = groups.join(" ");
  }

  const kurusStr = kurus > 0 ? readGroup(kurus) : "SIFIR";

  // Boşluk sadeleştirmesi kelimelerin İÇİNDE yapılır; TL/KR önündeki çift boşluk korunmalı.
  const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

  return `${tidy(liraStr)}  ${mainUnit} ${tidy(kurusStr)}  ${subUnit}`;
};

const formatNum = (v: number) =>
  Number(v ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Sola hizalı metin; `y` doğrudan taban çizgisidir. */
const lineL = (baseline: number, x: number, text: string, cls = '') =>
  `<text x="${x.toFixed(2)}" y="${baseline.toFixed(2)}"${cls ? ` class="${cls}"` : ''} xml:space="preserve">${text}</text>`;

/** Sağa hizalı metin; `x` sütunun SAĞ kenarıdır. */
const lineR = (baseline: number, xRight: number, text: string, cls = '') =>
  `<text x="${xRight.toFixed(2)}" y="${baseline.toFixed(2)}" text-anchor="end"${cls ? ` class="${cls}"` : ''} xml:space="preserve">${text}</text>`;

export async function buildProformaHtml(id: number, source: 'customer' | 'cari', onlyView?: boolean): Promise<string> {
  try {
    const detail = source === 'cari'
      ? await getCariOffer(id)
      : await getCustomerOffer(id);

    if (!detail) {
      throw new Error('Proforma detayları alınamadı');
    }

    let custName = detail.customerName || '';
    let custAddress = '';
    let custDistrict = '';
    let custCity = '';
    let custTaxOffice = '';
    let custTaxNumber = '';

    if (detail.muhtelif) {
      custName = detail.muhtelif.name || custName;
      custAddress = detail.muhtelif.address || '';
      custDistrict = detail.muhtelif.district || '';
      custCity = detail.muhtelif.city || '';
      custTaxOffice = detail.muhtelif.taxOffice || '';
      custTaxNumber = detail.muhtelif.taxNumber || '';
    } else if (detail.customerCode) {
      try {
        const cust = await fetchCustomerByCode(detail.customerCode);
        if (cust) {
          custName = cust.name || custName;
          custAddress = cust.address || '';
          custDistrict = cust.district || '';
          custCity = cust.city || '';
          custTaxOffice = cust.taxOffice || '';
          custTaxNumber = cust.taxNumber || cust.identityNumber || '';
        }

        // VERGİ BİLGİSİ ANA HESAPTA DURUR (2026-08-22 kullanıcı bildirimi).
        //
        // Proforma cari ALT HESABA yazılıyor (`-1` fatura hesabı; bkz. cari alt hesap kuralı:
        // -1 resmî, -2 açık, -3 muaf). Alt hesap satırında vergi dairesi ve vergi numarası
        // BOŞ; bu alanlar carinin ana hesabında tutuluyor. Sonuç: kâğıtta "V.D. :" ve
        // "VERGİ NO :" etiketleri boş çıkıyordu — proforma vergi bilgisi olmayan bir belge
        // olarak gidiyordu.
        //
        // Eksikse ana hesaptan tamamlanıyor. Yalnızca BOŞ alanlar dolduruluyor: alt hesapta
        // bilerek farklı bir değer varsa ezilmesin. Adres/il/ilçe de aynı sebeple kurtarılıyor.
        const altHesapEki = /-(1|2|3)$/;
        const eksikVergi = !custTaxOffice || !custTaxNumber;
        if (eksikVergi && altHesapEki.test(String(detail.customerCode))) {
          const anaKod = String(detail.customerCode).replace(altHesapEki, '');
          try {
            const ana = await fetchCustomerByCode(anaKod);
            if (ana) {
              custTaxOffice = custTaxOffice || ana.taxOffice || '';
              custTaxNumber = custTaxNumber || ana.taxNumber || ana.identityNumber || '';
              custAddress = custAddress || ana.address || '';
              custDistrict = custDistrict || ana.district || '';
              custCity = custCity || ana.city || '';
            }
          } catch {
            // Ana hesap okunamadıysa basım yine de yapılır; vergi satırı eskisi gibi boş kalır.
          }
        }
      } catch (e) {
        // HATA YUTULUYOR AMA SESSİZ DEĞİL (2026-08-22).
        //
        // Cari okunamazsa basım yine yapılır — vergi bilgisi yüzünden proformanın hiç
        // basılmaması daha kötü olurdu. Ama eskiden buradan yalnızca kuru bir `console.error`
        // çıkıyordu ve kâğıt V.D./VERGİ NO satırları BOŞ basılıyordu; kimse bir şeyin
        // başarısız olduğunu anlamıyor, sorun "veri eksik" sanılıyordu.
        //
        // Gerçek sebep genellikle YETKİ: `by-code` ucu sayfa yetkisi arıyor ve o yetkisi
        // olmayan rol 403 alıyor. Superadmin'de çalışıp kurumsal rolde çalışmaması bu yüzden.
        // Mesaj artık sebebi ve hangi cariyi okuyamadığını adıyla söylüyor.
        const durum = (e as any)?.status ?? (e as any)?.response?.status;
        console.warn(
          `[proforma-basim] Cari okunamadı (${detail.customerCode}) — V.D. ve VERGİ NO BOŞ basılacak.` +
          (durum ? ` HTTP ${durum}.` : '') +
          (durum === 403
            ? ' 403 = sayfa yetkisi: bu rolde proforma/teklif sayfa anahtarlarından biri açık olmalı.'
            : ''),
          e
        );
      }
    }

    const cleanCariAdi = custName.replace(/^\[[^\]]+\]\s*/, '').replace(/^\([^)]+\)\s*/, '');

    const lines = detail.lines || [];

    // Belgenin para birimi carinin kartından gelir (uç nokta `currencyTypeId` döndürüyor) ve
    // BÜTÜN tutarlar o paradadır. TL'de aşağıdaki etiket ekleri boş kalır, yani referans
    // ölçülerine oturtulmuş TL çıktısı bire bir korunur.
    const docCurrencyTypeId = Number((detail as any).currencyTypeId ?? 1);
    const docCurrencyCode =
      docCurrencyTypeId === 2 ? 'EUR' :
      docCurrencyTypeId === 3 ? 'USD' :
      docCurrencyTypeId === 4 ? 'GBP' : '';
    const totalLabelSuffix = docCurrencyCode ? ` (${docCurrencyCode})` : '';

    /**
     * Bir kalemin indirim tutarı. Tip uçtan METİN geliyor ("Amount"/"Percentage"), bu yüzden
     * karşılaştırma `normalizeDiscountType` üzerinden. İndirim hiçbir zaman matrahı aşamaz.
     */
    const kalemIndirimi = (l: any, base: number) => {
      const dv = Number(l.discountValue ?? 0);
      const kind = normalizeDiscountType(l.discountType);
      let d = 0;
      // Tutar indirimi ADET BAŞINA (2026-08-22) — teklif hesabıyla aynı kural.
      if (kind === 'amount') d = dv * Number(l.quantity ?? 0);
      else if (kind === 'percentage') d = (base * dv) / 100;
      return Math.min(Math.max(0, d), base);
    };

    // KDV KIRILIMI İNDİRİMDEN SONRAKİ MATRAH ÜZERİNDEN (2026-08-22 kullanıcı bildirimi).
    //
    // Matrah `qty * price` ile, yani İNDİRİMSİZ hesaplanıyordu. Toplamlar ise indirimli net
    // üzerinden geliyor; sonuçta kırılım satırı ile TOPLAM K.D.V. birbirini tutmuyordu.
    // Örnek: brüt 29.741,40 → kırılım %16 için 4.758,62 yazıyor, ama net 20.818,98 olduğu için
    // gerçek KDV 3.331,04. Kâğıtta iki farklı KDV rakamı duruyordu.
    const vatGroups: Record<number, { base: number; amount: number }> = {};
    lines.forEach((l: any) => {
      const qty = Number(l.quantity ?? 0);
      const price = Number(l.unitPrice ?? 0);
      const vatRate = Number(l.vatRate ?? 0);
      const brut = qty * price;
      const base = brut - kalemIndirimi(l, brut);
      const isVatExempt = Boolean(detail.vatExempt);
      const vatAmount = isVatExempt ? 0 : (base * vatRate) / 100;

      const rateKey = Math.round(vatRate);
      if (!vatGroups[rateKey]) vatGroups[rateKey] = { base: 0, amount: 0 };
      vatGroups[rateKey].base += base;
      vatGroups[rateKey].amount += vatAmount;
    });

    const vatRates = [16, 5];
    Object.keys(vatGroups).forEach((k) => {
      const rate = Number(k);
      if (rate !== 16 && rate !== 5 && rate > 0) vatRates.push(rate);
    });
    vatRates.sort((a, b) => b - a);

    let montajText = '';
    for (const line of lines) {
      const desc = String((line as any).stockName || line.description || '').toUpperCase();
      if (desc.includes('MONTAJ :')) {
        const parts = desc.split(':');
        if (parts.length > 1) {
          montajText = parts.slice(1).join(':').trim();
          break;
        }
      }
      if (desc.includes('MONTAJ')) {
        montajText = desc.trim();
        break;
      }
    }

    const docNo = detail.proformaDocumentNo || detail.documentNo || '';
    const dateParts = String(detail.date || '').split('T')[0].split('-');
    const dateStr = dateParts.length === 3 ? `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}` : '';

    // Montaj bilgisi bir kalem satırında taşınıyor ama basımda ÜRÜN TABLOSUNA girmiyor;
    // referansta yalnızca altta "MONTAJ : ..." satırı olarak görünüyor.
    const isMontajLine = (l: any) =>
      String(l?.stockName || l?.description || '').toUpperCase().includes('MONTAJ');

    // Kalem satırları: barkod ve ürün adı solda, sayısal sütunlar sağa hizalı.
    const rowsHtml = lines.filter((l: any) => !isMontajLine(l)).map((l: any, idx: number) => {
      const qty = Number(l.quantity ?? 0);
      const price = Number(l.unitPrice ?? 0);
      const total = qty * price;
      const baseline = Y.firstRow + idx * ROW_STEP_PT;
      const name = String(l.stockName || l.description || '').toUpperCase();
      // Miktar referansta birimiyle birlikte ("1 AD") yazılıyor.
      const qtyText = `${qty} AD`;
      return [
        lineL(baseline, X.barcode, esc(l.barcode || '')),
        lineL(baseline, X.product, esc(name)),
        // KDV referansta "% 0" — yüzde işareti önde ve arada boşluk var.
        lineR(baseline, X.kdvRight, `% ${esc(Number(l.vatRate ?? 0))}`),
        lineR(baseline, X.miktarRight, esc(qtyText)),
        lineR(baseline, X.birimRight, esc(formatNum(price))),
        lineR(baseline, X.tutarRight, esc(formatNum(total))),
      ].join('');
    }).join('');

    // İNDİRİM VE NET TOPLAM SATIRLARI (2026-08-22 kullanıcı bildirimi).
    //
    // Proforma basımında indirim HİÇ görünmüyordu: ne satırı vardı, ne hesabı. Üstelik
    // "BRÜT TUTAR" etiketinin yanına `netTotal` — yani indirim DÜŞÜLMÜŞ tutar — yazılıyordu.
    // Kalem satırlarındaki TUTAR sütunu ise indirimsiz tutarı yazdığı için indirimli bir
    // proformada satırların toplamı, altta "brüt" diye duran rakamdan büyük çıkıyordu.
    // Müşteri kendisine yapılan indirimi kâğıtta göremiyordu.
    //
    // Fatura basımındaki düzenin aynısı kuruldu: BRÜT TUTAR → İNDİRİM → NET TOPLAM.
    //
    // İndirim tipi uçtan METİN olarak geliyor ("Amount"/"Percentage"); karşılaştırma
    // `normalizeDiscountType` üzerinden yapılıyor, bkz. utils/discountType.
    const printedLines = lines.filter((l: any) => !isMontajLine(l));
    const brutHesap = printedLines.reduce((acc: number, l: any) => acc + Number(l.quantity ?? 0) * Number(l.unitPrice ?? 0), 0);
    const indirimHesap = printedLines.reduce((acc: number, l: any) => {
      const base = Number(l.quantity ?? 0) * Number(l.unitPrice ?? 0);
      const dv = Number(l.discountValue ?? 0);
      const kind = normalizeDiscountType(l.discountType);
      let d = 0;
      // Tutar indirimi ADET BAŞINA (2026-08-22) — teklif hesabıyla aynı kural.
      if (kind === 'amount') d = dv * Number(l.quantity ?? 0);
      else if (kind === 'percentage') d = (base * dv) / 100;
      return acc + Math.min(Math.max(0, d), base);
    }, 0);

    // İNDİRİM YOKSA ÇIKTI BİREBİR ESKİSİ GİBİ. Brüt yerine yine `netTotal` yazılıyor ve iki
    // ek satır hiç çizilmiyor — düzen referans PDF'e milimetrik oturtulmuş, indirimsiz
    // proformalarda hiçbir şey kaymasın.
    const indirimVar = indirimHesap > 0.005;
    const brutTutar = indirimVar ? brutHesap : Number(detail.netTotal ?? 0);

    // Adım 13 pt: BRÜT (616,4) → İNDİRİM (629,4) → NET TOPLAM (642,4). Altındaki
    // "TESLİM ALAN #" 656,1'de; 13,7 pt boşluk kalıyor, satırlar birbirine değmiyor.
    const INDIRIM_STEP_PT = 13;
    const indirimHtml = !indirimVar ? '' : [
      lineL(Y.brut + INDIRIM_STEP_PT, X.totalLabel, 'İNDİRİM'),
      lineR(Y.brut + INDIRIM_STEP_PT, X.totalRight, esc(formatNum(indirimHesap))),
      lineL(Y.brut + INDIRIM_STEP_PT * 2, X.totalLabel, 'NET TOPLAM'),
      lineR(Y.brut + INDIRIM_STEP_PT * 2, X.totalRight, esc(formatNum(brutHesap - indirimHesap))),
    ].join('');

    // SIFIR KDV SATIRI BASILMAZ (2026-08-22 kullanıcı kuralı; fatura basımında 2026-08-20'de
    // aynı karar verilmişti). Eskiden 16 ve 5 satırları her koşulda basılıyordu: tek kalemli
    // %16'lık bir proformada bile "( 0,00) K.D.V. (% 5,00) 0,00" kâğıda düşüyordu.
    //
    // ÖLÇÜT MATRAH + TUTAR: ikisi de sıfırsa satır yok. Yalnız tutara bakılsaydı KDV muaf
    // belge matrahını kaybederdi — orada matrah dolu, vergi sıfırdır ve satır BASILMALIDIR.
    const basilacakOranlar = vatRates.filter((rate) => {
      const g = vatGroups[rate];
      return g && (Math.abs(g.base) > 0.005 || Math.abs(g.amount) > 0.005);
    });

    const vatHtml = basilacakOranlar.map((rate, idx) => {
      const g = vatGroups[rate] || { base: 0, amount: 0 };
      const baseline = Y.vatFirst + idx * VAT_STEP_PT;
      // Referansta matrah parantez içinde ve önünde bir boşlukla: "( 0,00)".
      return [
        lineL(baseline, X.totalLabel, `( ${esc(formatNum(g.base))}) K.D.V. (% ${esc(rate)},00)`),
        lineR(baseline, X.totalRight, esc(formatNum(g.amount))),
      ].join('');
    }).join('');

    const districtCity = [custDistrict, custCity].filter(Boolean).join('/');

    const isCari = source === 'cari';

    // Kaşe / Stamp image (for standard customer offer, omitted for cari proforma)
    const stampHtml = !isCari ? `
  <image href="/images/stilsoft-letterhead.png" xlink:href="/images/stilsoft-letterhead.png"
         x="${X.logoLeft}" y="${X.logoTop}" width="${X.logoW}" height="${X.logoH}"
         preserveAspectRatio="xMidYMid meet" />` : '';

    // Red Stilsoft logo in TOP RIGHT for Cari Proforma
    const redLogoHtml = isCari ? `
  <image href="/stilsoft-logo.png" xlink:href="/stilsoft-logo.png"
         x="395" y="28" width="170" height="58"
         preserveAspectRatio="xMidYMid meet" />` : '';

    const html = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<title>PROFORMA FATURA - ${esc(docNo)}</title>
<style>
  @page {
    size: ${PAGE_W_PT}pt ${PAGE_H_PT}pt;
    margin: 0 !important;
  }
  @media print {
    @page {
      size: ${PAGE_W_PT}pt ${PAGE_H_PT}pt;
      margin: 0 !important;
    }
    html, body {
      width: ${PAGE_W_PT}pt !important;
      height: ${PAGE_H_PT}pt !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  svg.page {
    display: block;
    margin: 0 auto;
  }
  /* viewBox 1 birim = 1pt olacak şekilde kuruldu; ölçüler doğrudan pt. */
  svg.page text {
    font-family: "Courier New", Courier, monospace;
    font-weight: bold;
    font-size: ${FONT_PT}px;
    fill: #000;
  }
  svg.page text.genel { font-size: ${GENEL_FONT_PT}px; }
  svg.page text.title {
    font-family: "Times New Roman", Times, serif;
    font-size: ${TITLE_FONT_PT}px;
  }
</style>
</head>
<body>
<svg class="page" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${PAGE_W_PT}pt" height="${PAGE_H_PT}pt" viewBox="0 0 ${PAGE_W_PT} ${PAGE_H_PT}">
  ${redLogoHtml}
  ${lineL(Y.custLine1, X.left, esc(cleanCariAdi))}
  ${custAddress ? lineL(Y.custLine2, X.left, esc(custAddress)) : ''}
  ${lineL(Y.custLine3, X.left, esc(districtCity))}
  ${lineL(Y.taxLine, X.left, `V.D. :${custTaxOffice ? ' ' + esc(custTaxOffice) : ''}`)}
  ${lineL(Y.taxLine, X.taxNo, `VERGİ NO :${custTaxNumber ? ' ' + esc(custTaxNumber) : ''}`)}

  <text class="title" x="${X.titleCenter}" y="${Y.title}" text-anchor="middle">PROFORMA FATURA</text>

  ${lineL(Y.docNo, X.right, esc(docNo))}
  ${lineL(Y.date, X.right, esc(dateStr))}

  ${stampHtml}

  ${lineL(Y.tableHead, X.headStok, 'STOK ADI')}
  ${lineR(Y.tableHead, X.kdvRight, 'KDV')}
  ${lineR(Y.tableHead, X.miktarRight, 'MİKTAR')}
  ${lineR(Y.tableHead, X.birimRight, 'BİRİM FİYAT')}
  ${lineR(Y.tableHead, X.tutarRight, 'TUTAR')}

  ${rowsHtml}

  ${lineL(Y.brut, X.totalLabel, 'BRÜT TUTAR')}
  ${lineR(Y.brut, X.totalRight, esc(formatNum(brutTutar)))}
  ${indirimHtml}

  ${lineL(Y.teslimAlan, X.left, 'TESLİM ALAN  #')}

  ${vatHtml}

  ${lineL(Y.yalniz, X.left, `YALNIZ : ${esc(convertNumberToTurkishWords(detail.grandTotal, docCurrencyTypeId).toUpperCase())}`)}

  ${lineL(Y.toplamKdv, X.totalLabel, 'TOPLAM K.D.V.')}
  ${lineR(Y.toplamKdv, X.totalRight, esc(formatNum(detail.vatTotal)))}

  ${lineL(Y.montaj, X.left, `MONTAJ : ${esc(montajText)}`)}

  ${lineL(Y.genelToplam, X.totalLabel, esc(`GENEL TOPLAM${totalLabelSuffix}`), 'genel')}
  ${lineR(Y.genelToplam, X.totalRight, esc(formatNum(detail.grandTotal)), 'genel')}

  ${lineL(Y.not, X.left, `NOT : ${esc(detail.description || '')}`)}
</svg>
${onlyView ? '' : `
<script>
  window.onload = () => {
    // Antet görseli yüklenmeden basılırsa boş çıkıyor; SVG <image> için 'complete' yok,
    // o yüzden aynı kaynağı bir kez de Image() ile bekletiyoruz.
    const pre = new Image();
    const go = () => setTimeout(() => window.print(), 200);
    pre.onload = go;
    pre.onerror = go;
    pre.src = ${isCari ? "'/stilsoft-logo.png'" : "'/images/stilsoft-letterhead.png'"};
  };
</script>
`}
</body>
</html>`;

    return html;
  } catch (err: any) {
    console.error('Yazdırma hatası:', err);
    throw err;
  }
}

export async function printProforma(id: number, source: 'customer' | 'cari', onlyView?: boolean): Promise<void> {
  const printParam = onlyView ? '' : '&print=true';
  window.open(`/print/preview?type=proforma&source=${source}&id=${id}${printParam}`, '_blank');
}
