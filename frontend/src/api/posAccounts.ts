import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type PosAccountSettingDto = {
  posBankAccountDefinitionId: number
  accountCode: string
  accountName: string
  accountNo: string
  targetBankAccountDefinitionId: number | null
  virtualPosBankCode: number | null
  transferTime: string
  isAutoTransferEnabled: boolean
  isConfigured: boolean
  matchedProvider: { bankCode: number; bankName: string; posType: string } | null
  /**
   * Hangi bağ üzerinden eşleşti: 'explicit' ekrandan seçilmiş bağ, 'convention' ise eski
   * isim benzerliği (hesap kodu değişirse sessizce kopar), 'none' eşleşme yok.
   */
  matchSource: 'explicit' | 'convention' | 'none'
}

export type TargetAccountDto = {
  id: number
  accountCode: string
  accountName: string
  currencyTypeId: number
}

export type PosProviderDto = {
  bankCode: number
  bankName: string
  posType: string
}

export type PosMovementRowDto = {
  bankAccountTransactionId: number
  date: string
  description: string
  counterpartyCode: string
  counterpartyName: string
  debit: number
  credit: number
  balance: number
  isTransferRow: boolean
  isSettled: boolean
  transferId: number | null
  createUser: string
  /** Hareketin geldiği yer — sunucu izden çıkarır (bkz. PosAccountTransferService.ClassifySourcesAsync). */
  source: string
}

/** Günün girişlerinin kaynağa göre toplamı (aktarım satırı hariç). */
export type PosSourceTotal = {
  source: string
  count: number
  amount: number
}

export type PosDaySummaryDto = {
  posBankAccountDefinitionId: number
  posAccountName: string
  targetBankAccountDefinitionId: number | null
  targetAccountName: string
  date: string
  openingBalance: number
  totalIn: number
  transferredAmount: number
  unsettledAmount: number
  transferId: number | null
  rows: PosMovementRowDto[]
  bySource: PosSourceTotal[]
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function request(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...buildHeaders(Boolean(init?.body)) }
  })

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('accessToken')
      if (typeof window !== 'undefined') redirectToLogin()
      throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
    }

    const text = await res.text().catch(() => '')
    const trimmed = String(text ?? '').trim()
    if (trimmed.startsWith('{')) {
      try {
        const j = JSON.parse(trimmed)
        if (typeof j?.message === 'string' && j.message.trim()) throw new Error(j.message.trim())
      } catch (e) {
        if (e instanceof Error && e.message.trim()) throw e
      }
    }
    throw new Error(trimmed || `İşlem gerçekleştirilemedi (${res.status})`)
  }

  return res
}

export async function fetchPosAccountSettings(): Promise<{
  posAccounts: PosAccountSettingDto[]
  targetAccounts: TargetAccountDto[]
  providers: PosProviderDto[]
}> {
  const res = await request('/api/pos-accounts/settings')
  const json = await res.json()
  const data = json?.data ?? {}
  return {
    posAccounts: data.posAccounts ?? [],
    targetAccounts: data.targetAccounts ?? [],
    providers: data.providers ?? []
  }
}

export async function savePosAccountSetting(payload: {
  posBankAccountDefinitionId: number
  targetBankAccountDefinitionId: number | null
  virtualPosBankCode: number | null
  transferTime: string
  isAutoTransferEnabled: boolean
}) {
  await request('/api/pos-accounts/settings', { method: 'PUT', body: JSON.stringify(payload) })
}

export async function fetchPosDay(posAccountId: number, date: string): Promise<PosDaySummaryDto> {
  const res = await request(`/api/pos-accounts/transfers/day?posAccountId=${posAccountId}&date=${encodeURIComponent(date)}`)
  const json = await res.json()
  return json?.data
}

/** Bütün POS hesaplarının o günkü özeti. Hareket satırları dönmez, yalnızca toplamlar. */
export type PosDayAllRow = {
  posBankAccountDefinitionId: number
  posAccountName: string
  targetAccountName: string
  openingBalance: number
  totalIn: number
  transferredAmount: number
  unsettledAmount: number
  transferId: number | null
  bySource: PosSourceTotal[]
  transferUser: string | null
  transferTime: string | null
}

export async function fetchPosDayAll(date: string): Promise<PosDayAllRow[]> {
  const res = await request(`/api/pos-accounts/transfers/day-all?date=${encodeURIComponent(date)}`)
  const json = await res.json()
  return Array.isArray(json?.data) ? json.data : []
}

export async function runPosTransfer(posAccountId: number, date: string) {
  const res = await request('/api/pos-accounts/transfers/run', {
    method: 'POST',
    body: JSON.stringify({ posAccountId, date })
  })
  return await res.json()
}

export async function addToPosTransfer(transferId: number, bankAccountTransactionIds: number[]) {
  const res = await request('/api/pos-accounts/transfers/add-items', {
    method: 'POST',
    body: JSON.stringify({ transferId, bankAccountTransactionIds })
  })
  return await res.json()
}

export async function deletePosTransfer(transferId: number) {
  await request(`/api/pos-accounts/transfers/${transferId}`, { method: 'DELETE' })
}
