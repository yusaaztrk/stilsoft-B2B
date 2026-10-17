export type InvoiceTabId =
  | 'siparis'
  | 'satisFatura'

  | 'musteriTeklifi'
  | 'cariTeklifleri'
  | 'bayiTeklifleri'
  | 'faturaDokum'
  | 'etiketFiyatli'
  | 'etiketFiyatsiz'
  | 'proforma'
  | 'magaza'
  | 'alis'
  | 'depoTransfer'
  | 'stokHareket'
  | 'depoStock'
  | 'irsaliye'
  | 'kampanya'
  | 'termin'
  // Garanti değişim (2026-08-14). Fatura kesmez: arızalı ürün garanti deposuna girer,
  // sağlam ürün seçilen depodan çıkar.
  | 'garantiDegisim'
  // Fatura takip (2026-09-15): faturanın teknisyenle müşteriye imzalatılıp geri getirilmesi.
  | 'faturaTakip'

export const invoiceTabLabels: Record<InvoiceTabId, string> = {
  siparis: 'Sipariş',
  satisFatura: 'Satış Faturası',

  musteriTeklifi: 'Müşteri Teklifi',
  cariTeklifleri: 'Cari Müşteri Teklifi',
  bayiTeklifleri: 'Cari Proforma',
  faturaDokum: 'Fatura Dökümü',
  etiketFiyatli: 'Etiket Basım\nFiyatlı',
  etiketFiyatsiz: 'Etiket Basım\nFiyatsız',
  proforma: 'Proforma',
  magaza: 'Mağaza\nSipariş',
  alis: 'Alış Siparişleri',
  depoTransfer: 'Depo Transfer',
  stokHareket: 'Stok Hareket Dökümü',
  depoStock: 'Depo Stok Durumu',
  irsaliye: 'Konsinye',
  kampanya: 'Kampanyalar',
  termin: 'Termin',
  garantiDegisim: 'Garanti Değişim',
  faturaTakip: 'Fatura Takip'
}

export const invoiceTabIdToPath: Record<InvoiceTabId, string> = {
  siparis: '/invoice/siparis',
  satisFatura: '/invoice/satis-faturasi',

  musteriTeklifi: '/invoice/musteri-teklifi',
  cariTeklifleri: '/invoice/cari-teklifleri',
  bayiTeklifleri: '/invoice/bayi-teklifleri',
  faturaDokum: '/invoice/fatura-dokumu',
  etiketFiyatli: '/invoice/etiket-basim-fiyatli',
  etiketFiyatsiz: '/invoice/etiket-basim-fiyatsiz',
  proforma: '/invoice/proforma',
  magaza: '/invoice/magaza-siparis',
  alis: '/invoice/alis-faturalari',
  depoTransfer: '/invoice/depo-transfer',
  stokHareket: '/invoice/stok-hareket',
  depoStock: '/invoice/depo-stok',
  irsaliye: '/invoice/konsinye',
  kampanya: '/invoice/kampanya',
  termin: '/invoice/termin',
  garantiDegisim: '/invoice/garanti-degisim',
  faturaTakip: '/invoice/fatura-takip'
}

export function pathToInvoiceTabId(pathname: string): InvoiceTabId | null {
  const p = pathname.toLowerCase()
  const found = (Object.entries(invoiceTabIdToPath) as Array<[InvoiceTabId, string]>).find(([, path]) => p.startsWith(path))
  return found?.[0] ?? null
}
