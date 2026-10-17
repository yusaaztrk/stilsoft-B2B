import { API_BASE_URL } from '../config/api'

export interface AccountingPeriod {
  id: number
  code: string
  name: string
  fiscalYear: number
  startDate: string
  endDate: string
  status: number
  statusName: string
  isActive: boolean
  isClosed: boolean
  closedAt?: string
  closedByUserId?: string
  reopenedAt?: string
  reopenedByUserId?: string
}

export interface PeriodCurrencySummary {
  currencyTypeId: number
  currencyCode: string
  totalDebit: number
  totalCredit: number
  netBalance: number
}

export interface PeriodClosingValidationReport {
  canClose: boolean
  totalCustomers: number
  totalEntriesInPeriod: number
  criticalErrors: string[]
  warnings: string[]
  currencySummaries: PeriodCurrencySummary[]
}

export interface ClosePeriodResult {
  success: boolean
  message: string
  closedPeriodId: number
  targetPeriodId: number
  generatedOpeningEntriesCount: number
  /**
   * Kapatma engellenmedi ama dikkat edilmesi gereken durumlar (ör. dönem içinde kalmış
   * ONAYSIZ alış faturaları). Boş dizi = temiz kapanış.
   */
  warnings?: string[]
}

async function parseResponse<T = any>(res: Response, defaultErrorMsg: string): Promise<T> {
  let json: any = null
  try {
    const text = await res.text()
    if (text) json = JSON.parse(text)
  } catch {}

  if (!res.ok || (json && json.success === false)) {
    const msg = json?.message || defaultErrorMsg
    throw new Error(msg)
  }
  return json?.data ?? json
}

export async function fetchAccountingPeriods(): Promise<AccountingPeriod[]> {
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_BASE_URL}/api/accounting-periods`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  const data = await parseResponse(res, 'Mali dönemler yüklenemedi')
  return Array.isArray(data) ? data : []
}

export async function fetchActiveAccountingPeriod(): Promise<AccountingPeriod | null> {
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_BASE_URL}/api/accounting-periods/active`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  if (!res.ok) return null
  return await parseResponse(res, 'Aktif dönem yüklenemedi')
}

export async function createAccountingPeriod(data: {
  code: string
  name: string
  fiscalYear: number
  startDate: string
  endDate: string
}): Promise<AccountingPeriod> {
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_BASE_URL}/api/accounting-periods`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(data)
  })
  return await parseResponse<AccountingPeriod>(res, 'Mali dönem oluşturulamadı')
}

export async function validateCloseAccountingPeriod(periodId: number): Promise<PeriodClosingValidationReport> {
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_BASE_URL}/api/accounting-periods/${periodId}/validate-close`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  return await parseResponse<PeriodClosingValidationReport>(res, 'Ön kontrol gerçekleştirilemedi')
}

export async function closeAccountingPeriod(periodId: number, customTransferName?: string): Promise<ClosePeriodResult> {
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_BASE_URL}/api/accounting-periods/${periodId}/close`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ customTransferName: customTransferName?.trim() || undefined })
  })
  return await parseResponse<ClosePeriodResult>(res, 'Mali dönem kapatılamadı')
}

export async function reopenAccountingPeriod(periodId: number): Promise<boolean> {
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_BASE_URL}/api/accounting-periods/${periodId}/reopen`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  await parseResponse(res, 'Mali dönem yeniden açılamadı')
  return true
}

export async function deleteAccountingPeriod(periodId: number): Promise<boolean> {
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_BASE_URL}/api/accounting-periods/${periodId}`, {
    method: 'DELETE',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  await parseResponse(res, 'Mali dönem silinemedi')
  return true
}
