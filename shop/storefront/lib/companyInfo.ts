import { getStorefront, type StorefrontSettings } from '@/lib/api'

/**
 * FİRMA BİLGİLERİNİN GÖSTERİM KAYNAĞI — tek yer.
 *
 * <b>Neden ayrı bir dosya:</b> aynı bilgi iki farklı yerde iki farklı sonuç veriyordu.
 * `SiteFooter` alanlar boşken makul yedeklere düşüyordu (info@example.com, Organize
 * Sanayi Bölgesi…), İletişim sayfası ise `LegalPage.loadSeller()` üzerinden okuduğu için
 * ekrana "—" basıyordu. Kullanıcının gördüğü tablo buydu: altbilgide dolu, iletişim
 * sayfasında boş; şikâyet "buradaki firma bilgileri güncellenmiyor" diye geldi
 * (2026-09-09). Kök sebep ayarların panelde hiç doldurulmamış olması, ama iki ekranın
 * farklı davranması sorunu görünmez kılıyordu.
 *
 * <b>`loadSeller()` neden hâlâ duruyor ve neden ona dokunmuyoruz:</b> o fonksiyon MESAFELİ
 * SATIŞ SÖZLEŞMESİ gibi hukuki metinleri besliyor. Orada boş alanı yedekle doldurmak,
 * ziyaretçiyi var olmayan bir firmayla sözleşme imzalamış saymak demek — bu bilinçli bir
 * karar ve bozulmamalı. Burası yalnızca TANITIM yüzeyleri (altbilgi, iletişim kartları)
 * içindir; oralarda "—" yazmak sadece siteyi bakımsız gösteriyor.
 *
 * Yani kural: hukuki metin → `loadSeller()` (dürüst "—"), vitrin yüzeyi → burası (yedekli).
 */
export type CompanyInfo = {
  name: string
  address: string
  email: string
  /** İletişim formunun düşeceği kutu. Firma e-postasından AYRI olabilir. */
  supportEmail: string
  phone: string
  taxInfo: string
  /** Panelde girilmiş mi — kutuları "eksik" diye işaretlemek isteyen ekranlar için. */
  isConfigured: {
    name: boolean
    address: boolean
    email: boolean
    phone: boolean
    taxInfo: boolean
  }
}

/**
 * Panel boşken kullanılan değerler.
 *
 * Bunlar uydurma değil, işletmenin bilinen ve sitede zaten basılı olan bilgileri — altbilgi
 * bugüne kadar da aynılarını gösteriyordu. Panelden bir değer girildiği anda o kazanır.
 */
export const COMPANY_FALLBACK = {
  name: 'Demo Ticaret Ltd.',
  address: 'Örnek Mah. Demo Cad. No:1, Lefkoşa - KKTC',
  email: 'info@example.com',
  supportEmail: 'support@example.com',
  phone: '0850 000 00 00',
  /*
    WhatsApp destek hattı — kullanıcı 2026-09-09'da açıkça verdi: +90 533 000 00 00.

    Bu numara daha önce BİLEREK koddan kaldırılmıştı: oradaki değer gerçek işletme hattı
    olup olmadığı belirsiz bir numaraydı ve panelden değiştirilemiyordu. İtiraz numaranın
    doğrulanmamış olmasınaydı, koda yazılmasına değil; kullanıcı numarayı kendisi verdiği
    için o itiraz ortadan kalktı.

    Yine de panel kazanır: `whatsAppNumber` ayarı doluysa o kullanılır, burası yalnız yedek.

    2026-10-11'de yeni hatta (+90 533 000 00 02, asistan) taşınmıştı; 2026-10-12 kullanıcı kararıyla
    GERİ ALINDI ("canlı destek numarası ilk hale gelsin"). Düğmeler yine bu hatta gider.
  */
  whatsApp: '+90 533 000 00 00',
} as const

/**
 * Sitedeki BÜTÜN WhatsApp düğmelerinin numarası (wa.me için yalnız rakam, 90 ile).
 * Panel ayarı (`whatsAppNumber`) kazanır; boşsa canlı destek hattı. 2026-10-11 öncesinde bazı
 * düğmeler ayar boşken SABİT HATTA (0850…) düşüyordu — o numarada WhatsApp yok.
 */
export function whatsAppDigits(settings: Partial<StorefrontSettings> | null | undefined): string {
  let d = ((settings?.whatsAppNumber ?? '').trim() || COMPANY_FALLBACK.whatsApp).replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) d = '90' + d.slice(1)
  if (d.length === 10 && d.startsWith('5')) d = '90' + d
  return d
}

const pick = (raw: string | null | undefined, fallback: string) => {
  const text = (raw ?? '').trim()
  return text.length > 0 ? text : fallback
}

const filled = (raw: string | null | undefined) => (raw ?? '').trim().length > 0

/** Ayarları elde olan çağıran için: ikinci kez ağa çıkmadan çözer. */
export function resolveCompanyInfo(settings: Partial<StorefrontSettings> | null | undefined): CompanyInfo {
  return {
    name: pick(settings?.companyName, COMPANY_FALLBACK.name),
    address: pick(settings?.companyAddress, COMPANY_FALLBACK.address),
    email: pick(settings?.companyEmail, COMPANY_FALLBACK.email),
    // Destek kutusu ayrı: müşteri mesajları kurumsal info@ yerine support@'a düşsün
    // (2026-09-09 kullanıcı isteği). Panelde firma e-postası girilmişse o kullanılır.
    supportEmail: pick(settings?.companyEmail, COMPANY_FALLBACK.supportEmail),
    phone: pick(settings?.phoneNumber, COMPANY_FALLBACK.phone),
    // Vergi bilgisinin YEDEĞİ YOK: uydurulamaz bir veri, girilmediyse boş kalır ve
    // gösteren ekran satırı hiç çizmez.
    taxInfo: (settings?.companyTaxInfo ?? '').trim(),
    isConfigured: {
      name: filled(settings?.companyName),
      address: filled(settings?.companyAddress),
      email: filled(settings?.companyEmail),
      phone: filled(settings?.phoneNumber),
      taxInfo: filled(settings?.companyTaxInfo),
    },
  }
}

/** Ayarları kendisi çeken kısayol. Ayar servisi düşerse yedeklerle döner, sayfa kapanmaz. */
export async function getCompanyInfo(): Promise<CompanyInfo> {
  const settings = await getStorefront().catch(() => null)
  return resolveCompanyInfo(settings)
}

/**
 * KURUMSAL SATIŞ DANIŞMANI (2026-10-04 kullanıcı isteği: "kurumsal satış danışmanı
 * Demo Danışman +90 533 000 00 01").
 *
 * Tek kaynak: /kurumsal-satis sayfası, üst bar bağlantısı, ürün sayfasındaki "toplu alım"
 * satırı ve sepetteki kurumsal ipucu buradan okur. Danışman değişirse yalnız burası
 * değişir. Numara aynı zamanda WhatsApp hattı olarak kullanılıyor.
 */
export const KURUMSAL_DANISMAN = {
  ad: 'Demo Danışman',
  unvan: 'Kurumsal Satış Danışmanı',
  telefon: '+90 533 000 00 01',
  /** `tel:` ve `wa.me` için yalnız rakam (başta + korunur). */
  telefonDijit: '+905330000001',
  whatsappDijit: '905330000001',
} as const
