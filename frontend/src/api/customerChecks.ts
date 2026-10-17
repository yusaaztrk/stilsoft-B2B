import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'
import { normalizeCustomerCheckRow } from './checksShared'

export type CustomerCheckStatus =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7

export type CustomerCheckDto = {
  id: number
  aBordroNo?: string
  vBordroNo?: string | null
  documentNo: string
  customerCode: string
  customerName: string
  issueDate: string
  dueDate: string
  amount: number
  currencyTypeId: number
  endorsementType?: 1 | 2
  bankName?: string | null
  branchName?: string | null
  districtName?: string | null
  checkNo?: string | null
  originalDebtorName?: string | null
  originalIdentityNo?: string | null
  originalTaxNo?: string | null
  paymentStatus?: 1 | 2
  status: CustomerCheckStatus
  currentBankAccountDefinitionId?: number | null
  currentBankAccountName?: string | null
  currentCustomerCode?: string | null
  currentCustomerName?: string | null
  createUser?: string | null
}

export type CreateCustomerCheckPayload = {
  documentNo?: string
  customerCode: string
  issueDate: string
  dueDate: string
  amount: number
  currencyTypeId: number
  /** Çekin giriş kuru. Gönderilmezse sunucu güncel kuru kullanır. */
  currencyRate?: number
  endorsementType: 1 | 2
  bankName?: string | null
  branchName?: string | null
  districtName?: string | null
  checkNo?: string | null
  originalDebtorName?: string | null
  originalIdentityNo?: string | null
  originalTaxNo?: string | null
}

export type CustomerCheckActionPayload = {
  date: string
  bankAccountDefinitionId?: number | null
  targetCustomerCode?: string | null
  description?: string | null
}

export type CustomerCheckBulkEndorseToBankGuaranteePayload = {
  ids: number[]
  date: string
  bankAccountDefinitionId: number
  description?: string | null
}

function getToken() {
  return localStorage.getItem('accessToken')
}

function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `Çek işlemi başarısız (${status})`

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `Çek işlemi başarısız (${status})`
    }
  }

  return t
}

async function request(path: string, init?: RequestInit) {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  })

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userName')
      sessionStorage.removeItem('userName')
      if (typeof window !== 'undefined') redirectToLogin()
      throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
    }

    const text = await res.text().catch(() => '')
    const err = new Error(getFriendlyError(text, res.status)) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  return res
}

export async function fetchCustomerChecks(opts?: { customerCode?: string; take?: number }): Promise<CustomerCheckDto[]> {
  const take = Math.max(1, Math.min(1000, Number(opts?.take ?? 200)))
  const parts: string[] = [`take=${encodeURIComponent(String(take))}`]
  if (opts?.customerCode) {
    parts.push(`customerCode=${encodeURIComponent(opts.customerCode)}`)
  }
  const qs = '?' + parts.join('&')
  const res = await request(`/api/CustomerChecks${qs}`)
  const json = await res.json()
  // Enum alanları uçtan METİN geliyor; bkz. `checksShared.normalizeCustomerCheckRow`.
  return ((json?.data ?? []) as any[]).map(normalizeCustomerCheckRow) as CustomerCheckDto[]
}

export async function createCustomerCheck(payload: CreateCustomerCheckPayload): Promise<{ id: number }> {
  const res = await request('/api/CustomerChecks', { method: 'POST', body: JSON.stringify(payload) })
  const json = await res.json()
  const id = Number(json?.data?.id ?? 0)
  return { id }
}

export async function createCustomerChecksBulk(payload: CreateCustomerCheckPayload[]): Promise<{ id: number }[]> {
  const res = await request('/api/CustomerChecks/bulk', { method: 'POST', body: JSON.stringify(payload) })
  const json = await res.json()
  return (json?.data ?? []) as Array<{ id: number }>
}

export async function endorseCustomerCheckToBankGuarantee(id: number, payload: CustomerCheckActionPayload): Promise<{ vBordroNo: string }> {
  const res = await request(`/api/CustomerChecks/${encodeURIComponent(String(id))}/endorse-to-bank-guarantee`, { method: 'POST', body: JSON.stringify(payload) })
  const json = await res.json()
  return { vBordroNo: String(json?.data?.vBordroNo ?? '') }
}

export async function endorseCustomerChecksToBankGuaranteeBulk(
  payload: CustomerCheckBulkEndorseToBankGuaranteePayload
): Promise<{ vBordroNo: string }> {
  const res = await request('/api/CustomerChecks/endorse-to-bank-guarantee/bulk', { method: 'POST', body: JSON.stringify(payload) })
  const json = await res.json()
  return { vBordroNo: String(json?.data?.vBordroNo ?? '') }
}

export async function fetchCustomerChecksVBordroPrintHtml(vBordroNo: string): Promise<string> {
  const res = await request(`/api/CustomerChecks/vbordro/${encodeURIComponent(String(vBordroNo))}/print`, {
    method: 'GET',
    headers: {
      Accept: 'text/html'
    }
  })
  return await res.text()
}

export async function endorseCustomerCheckToBankCollection(id: number, payload: CustomerCheckActionPayload): Promise<void> {
  await request(`/api/CustomerChecks/${encodeURIComponent(String(id))}/endorse-to-bank-collection`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function collectCustomerCheck(id: number, payload: CustomerCheckActionPayload): Promise<void> {
  await request(`/api/CustomerChecks/${encodeURIComponent(String(id))}/collect`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function uncollectCustomerCheck(id: number): Promise<void> {
  await request(`/api/CustomerChecks/${encodeURIComponent(String(id))}/uncollect`, { method: 'POST' })
}

export async function endorseCustomerCheckToCustomer(id: number, payload: CustomerCheckActionPayload): Promise<void> {
  await request(`/api/CustomerChecks/${encodeURIComponent(String(id))}/endorse-to-customer`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function returnCustomerCheck(id: number, payload: CustomerCheckActionPayload): Promise<void> {
  await request(`/api/CustomerChecks/${encodeURIComponent(String(id))}/return`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function returnCustomerCheckToPortfolio(id: number, payload: CustomerCheckActionPayload): Promise<void> {
  await request(`/api/CustomerChecks/${encodeURIComponent(String(id))}/return-to-portfolio`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function dishonorCustomerCheck(id: number, payload: CustomerCheckActionPayload): Promise<void> {
  await request(`/api/CustomerChecks/${encodeURIComponent(String(id))}/dishonor`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function deleteCustomerCheck(id: number): Promise<void> {
  await request(`/api/CustomerChecks/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
}

export async function updateCustomerCheck(id: number, payload: CreateCustomerCheckPayload): Promise<void> {
  await request(`/api/CustomerChecks/${encodeURIComponent(String(id))}`, { method: 'PUT', body: JSON.stringify(payload) })
}
