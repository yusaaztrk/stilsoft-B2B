import { apiJson } from './client'

export type EarningStatus = 'Pending' | 'Approved' | 'PostedToLedger' | 'Cancelled'
export type EarningSourceType = 'ServiceRecord' | 'InstallationTask' | 'CargoTrackingTask'

export type TechnicianEarning = {
  id: string
  tenantCode?: string | null
  technicianId: string
  technicianName: string
  technicianCariCode?: string | null
  sourceType: EarningSourceType
  sourceId: string
  sourceNumber?: string | null
  customerName?: string | null
  productName?: string | null
  completedAt: string
  amount: number
  /** Tutarın KENDİ para birimi. Tutar asla TL varsayılmaz. */
  currency: string
  /** Onay anında girilen kur (1 birim döviz = kaç TL). Yoksa TL karşılığı hesaplanamaz. */
  exchangeRate?: number | null
  /** Sunucuda saklanan TL karşılığı. Ekranda tutar buna göre gösterilir, yeniden bölünmez. */
  localAmount?: number | null
  exchangeRateDate?: string | null
  status: EarningStatus
  postedLedgerReference?: string | null
  notes?: string | null
  createdAt: string
  approvedAt?: string | null
  approvedBy?: string | null
  postedAt?: string | null
  postedBy?: string | null
}

export async function fetchEarnings(filter: {
  technicianId?: string
  status?: EarningStatus | ''
  sourceType?: EarningSourceType | ''
  from?: string
  to?: string
} = {}) {
  const params = new URLSearchParams()
  if (filter.technicianId) params.set('technicianId', filter.technicianId)
  if (filter.status) params.set('status', filter.status)
  if (filter.sourceType) params.set('sourceType', filter.sourceType)
  if (filter.from) params.set('from', filter.from)
  if (filter.to) params.set('to', filter.to)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return apiJson<{
    success: boolean
    data: TechnicianEarning[]
    totals: {
      count: number
      /** Yalnızca TRY satırlarının toplamı. Karışık dövizli genel toplam ANLAMSIZDIR. */
      amount: number
      byCurrency: { currency: string; count: number; amount: number; localAmount: number; missingRate: number }[]
      /** Kuru girilmiş satırların TL karşılığı toplamı. */
      localAmount: number
      /** Kuru girilmediği için TL toplamına giremeyen satır sayısı. */
      missingRate: number
    }
  }>(`/api/earnings${qs}`)
}

export async function syncEarnings() {
  return apiJson<{ success: boolean; created: number }>('/api/earnings/sync', { method: 'POST' })
}

export async function updateEarningStatus(
  id: string,
  status: EarningStatus,
  amount?: number,
  currency?: string,
  opts?: { postedLedgerReference?: string; notes?: string; exchangeRate?: number }
) {
  return apiJson<{ success: boolean }>(`/api/earnings/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      amount,
      currency,
      exchangeRate: opts?.exchangeRate,
      postedLedgerReference: opts?.postedLedgerReference,
      notes: opts?.notes,
    }),
  })
}

/** Hak ediş tarafında desteklenen para birimleri. Sunucu bu listenin dışını TRY'ye çeker. */
export const EARNING_CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP'] as const
export type EarningCurrency = (typeof EARNING_CURRENCIES)[number]

export const CURRENCY_SYMBOLS: Record<string, string> = {
  TRY: '₺',
  USD: '$',
  EUR: '€',
  GBP: '£',
}

export function formatMoney(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? ''
  const value = Number(amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return symbol ? `${value} ${symbol}` : `${value} ${currency}`
}

export type LedgerEntryType = 'Earning' | 'Payment' | 'Adjustment'

export type TechnicianLedgerRow = {
  id: string
  technicianId: string
  technicianName: string
  entryDate: string
  description: string
  referenceNumber?: string | null
  debit: number
  credit: number
  currency: string
  exchangeRate?: number | null
  localAmount?: number | null
  entryType: LedgerEntryType
  sourceId?: string | null
  createdAt: string
  createdBy?: string | null
  /** Yürüyen bakiye — sunucu para birimi başına ayrı hesaplar. */
  balance: number
}

export async function fetchTechnicianLedger(filter: {
  technicianId?: string
  currency?: string
  from?: string
  to?: string
} = {}) {
  const params = new URLSearchParams()
  if (filter.technicianId) params.set('technicianId', filter.technicianId)
  if (filter.currency) params.set('currency', filter.currency)
  if (filter.from) params.set('from', filter.from)
  if (filter.to) params.set('to', filter.to)
  const qs = params.toString() ? `?${params.toString()}` : ''

  return apiJson<{
    success: boolean
    data: TechnicianLedgerRow[]
    /** Dönem SONU bakiyesi (devir dahil), para birimi başına. Listeden değil, veritabanından. */
    balances: { currency: string; balance: number }[]
    /** DEVİR: seçilen tarih aralığından ÖNCEKİ net bakiye. */
    openingBalances: { currency: string; balance: number }[]
    /** Yalnızca dönem içindeki borç/alacak toplamı — bakiye ile karıştırılmamalı. */
    periodTotals: { currency: string; debit: number; credit: number }[]
    /** Satır sınırına takıldıysa ekran uyarır. */
    truncated: boolean
  }>(`/api/earnings/ledger${qs}`)
}

export async function createLedgerPayment(payload: {
  technicianId: string
  amount: number
  currency: string
  entryDate?: string
  description?: string
  referenceNumber?: string
  exchangeRate?: number
  isAdjustment?: boolean
}) {
  return apiJson<{ success: boolean; id: string }>('/api/earnings/ledger/payment', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function deleteLedgerEntry(id: string) {
  return apiJson<void>(`/api/earnings/ledger/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
