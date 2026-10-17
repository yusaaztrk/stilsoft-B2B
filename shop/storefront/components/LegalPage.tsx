import { getStorefront } from '@/lib/api'

/**
 * Yasal metinlerin ortak çerçevesi.
 *
 * Satıcı bilgileri (unvan, adres, vergi) MAĞAZA AYARLARINDAN geliyor, metinlerin içine
 * yazılmıyor: bu bilgiler değişebilir ve dört ayrı dosyada tekrarlanırsa biri güncellenmeden
 * kalır — yasal bir belgede yanlış adres, olmayan adresten kötüdür.
 *
 * Eksik bilgi SESSİZCE GEÇİLMİYOR: doldurulmamış alan yerine görünür bir uyarı basılıyor.
 * Sözleşmenin satıcı kısmının boş görünmesi, sayfanın hazır sanılmasına yol açardı.
 */
export type SellerInfo = {
  name: string
  address: string
  email: string
  taxInfo: string
  phone: string
  missing: string[]
}

export async function loadSeller(): Promise<SellerInfo> {
  const settings = await getStorefront().catch(() => ({} as any))

  // Alan boşsa gerçekmiş gibi görünen bir örnek metinle DOLDURULMAZ — bu, yorumdaki sözü
  // (görünür uyarı) tutmuyordu: ziyaretçi var olmayan bir firmayla sözleşme imzalamış
  // sayılıyordu ve kimse fark etmiyordu. Boş alan "—" gösterir, eksik listeye düşer.
  const missing: string[] = []
  const value = (raw: string | undefined | null, label: string) => {
    const text = (raw ?? '').trim()
    if (text.length > 0) return text
    missing.push(label)
    return '—'
  }

  const seller = {
    name: value(settings?.companyName, 'Firma unvanı'),
    address: value(settings?.companyAddress, 'Adres'),
    email: value(settings?.companyEmail, 'E-posta'),
    taxInfo: value(settings?.companyTaxInfo, 'Vergi dairesi/no'),
    phone: value(settings?.phoneNumber, 'Telefon'),
  }

  return { ...seller, missing }
}

export function SellerTable({ seller }: { seller: SellerInfo }) {
  return (
    <table className="legal-table">
      <tbody>
        <tr><th>Satıcı unvanı</th><td>{seller.name}</td></tr>
        <tr><th>Adres</th><td>{seller.address}</td></tr>
        <tr><th>Telefon</th><td>{seller.phone}</td></tr>
        <tr><th>E-posta</th><td>{seller.email}</td></tr>
        <tr><th>Vergi bilgisi</th><td>{seller.taxInfo}</td></tr>
      </tbody>
    </table>
  )
}

export default function LegalPage({
  title,
  lede,
  updated,
  seller,
  children,
}: {
  title: string
  lede?: string
  updated?: string
  seller?: SellerInfo
  children: React.ReactNode
}) {
  return (
    <div className="wrap legal">
      <h1>{title}</h1>
      {lede && <p className="legal-lede">{lede}</p>}
      {updated && <p className="legal-updated">Son güncelleme: {updated}</p>}

      {seller && seller.missing.length > 0 && (
        <div className="legal-warning">
          <b>Bu sayfa henüz yayına hazır değil.</b> Eksik firma bilgileri:{' '}
          {seller.missing.join(', ')}. Bayi panelinde <em>E-Ticaret → Vitrin Yönetimi</em>
          {' '}altından doldurulmalı.
        </div>
      )}

      {children}
    </div>
  )
}
