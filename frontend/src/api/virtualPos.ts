import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export interface BinLookupResponseDto {
  success: boolean
  binNo: string
  bankCode: number
  bankName: string
  cardType1: string
  cardType2: string
  installments: InstallmentOptionDto[]
}

export interface InstallmentOptionDto {
  merchantInstallment: number
  bankInstallment: number
  installmentText: string
  minAmount: number
  totalAmount: number
  monthlyAmount: number
  description: string
}

export interface VirtualPos3DPayResponseDto {
  success: boolean
  message?: string
  htmlForm?: string
  gatewayUrl?: string
  orderNo?: string
}

export interface VirtualPosTransactionDto {
  id: string
  orderNo: string
  bankDocumentNo: string
  customerCode: string
  bankCode: number
  bankName: string
  installmentCount: number
  amount: number
  /** Islemin para birimi; ekran sabit "TL" yaziyordu. */
  currencyCode?: string
  transactionDate: string
  isSuccess: boolean
  authCode: string
  errorCode: string
  errorDescription: string
  is3D: boolean
  cardHolderName: string
  maskedCardNumber: string
  email: string
  phone: string
  status: number
  receiptNo: string
  customerName: string
}

/**
 * ÖDEMENİN SONUCU ÜÇ DEĞİL DÖRT HALDE — "başarılı değil" ≠ "başarısız" (2026-08-20).
 *
 * Rapor `isSuccess ? 'Başarılı' : 'Başarısız'` yazıyordu. Bu, sonucu HENÜZ BELLİ OLMAYAN
 * her ödemeyi kesin başarısız gösteriyor:
 *  - banka 3D sonucunu geri gönderemediyse kayıt `RedirectPrepared`de kalır,
 *  - imza/tutar doğrulanamadıysa `ProviderError` olur (kart çekilmiş OLABİLİR),
 *  - CardPlus provizyonu zaman aşımına uğradıysa `AuthorizationPending` olur.
 * Üçünde de para bankada çekilmiş olabilir; ekranda "Başarısız" yazması, kimsenin
 * mutabakat yapmadığı bir tahsilatın kaybolması demek.
 *
 * Sunucudaki `VirtualPosPaymentStatus` ile birebir; sayı olarak tutuluyor çünkü uç bu alanı
 * (enum değil) sayı gönderiyor.
 */
export const POS_STATUS = {
  Created: 0,
  RedirectPrepared: 1,
  Redirected: 2,
  ThreeDSecurePending: 3,
  Authorized: 4,
  Failed: 5,
  Cancelled: 6,
  Refunded: 7,
  PartiallyRefunded: 8,
  Unknown: 9,
  ThreeDVerified: 10,
  AuthorizationPending: 11,
  ProviderError: 12,
  AccountingPending: 13,
  AccountingPosted: 14
} as const

export type PosOutcome = 'success' | 'failed' | 'attention' | 'pending'

export function posOutcomeOf(tx: Pick<VirtualPosTransactionDto, 'isSuccess' | 'status'>): PosOutcome {
  const st = Number(tx?.status ?? 0)

  if (tx?.isSuccess === true) return 'success'
  if (st === POS_STATUS.Authorized || st === POS_STATUS.AccountingPending || st === POS_STATUS.AccountingPosted) {
    return 'success'
  }

  // Banka "hayır" dedi ya da işlem iptal/iade edildi — karar kesin.
  if (st === POS_STATUS.Failed || st === POS_STATUS.Cancelled
      || st === POS_STATUS.Refunded || st === POS_STATUS.PartiallyRefunded) {
    return 'failed'
  }

  // Sonuç var ama güvenilmiyor / provizyon havada kaldı: insan bakmalı.
  if (st === POS_STATUS.ProviderError || st === POS_STATUS.AuthorizationPending || st === POS_STATUS.Unknown) {
    return 'attention'
  }

  // Banka hiç dönmedi (kullanıcı vazgeçmiş de olabilir, callback kaybolmuş da).
  return 'pending'
}

/**
 * "SONUÇ BEKLİYOR" YANILTIYORDU (2026-09-16 kullanıcı isteği).
 *
 * Etiket, birazdan bir sonuç gelecekmiş izlenimi veriyordu; oysa bu kayıtların neredeyse
 * tamamı müşterinin banka ekranını hiç bitirmediği işlemler ve bankadan TEK bir cevap bile
 * gelmiyor.
 *
 * 2026-09-19: "Bankada bekliyor" da kaldırıldı (kullanıcı: "işlem tamamlanmadı olarak
 * yazsın"). 15 dakikalık eşik yanıltıyordu — işlem saati saat dilimi bilgisi olmadan
 * geldiğinde tarayıcı onu ileri bir saat sayıyor, eşik hiç dolmuyor ve kayıt saatlerce
 * "bekliyor" görünüyordu. Bankadan cevap gelmemiş her kayıt için tek bir söz var:
 * tahsilat yapılmadı.
 */
export function posOutcomeLabel(outcome: PosOutcome, _tx?: Pick<VirtualPosTransactionDto, 'transactionDate'>): string {
  if (outcome === 'success') return 'Başarılı'
  if (outcome === 'failed') return 'Başarısız'
  if (outcome === 'attention') return 'Doğrulanamadı'
  return 'İşlem tamamlanmadı'
}

/** Satırın ipucu metni: etiketin ne anlama geldiğini açıkça yazar. */
export function posOutcomeHint(outcome: PosOutcome, tx?: Pick<VirtualPosTransactionDto, 'transactionDate' | 'errorDescription'>): string {
  if (outcome === 'success') return 'Banka onayladı, tahsilat yapıldı.'
  if (outcome === 'failed') return tx?.errorDescription || 'Banka işlemi reddetti, tahsilat yapılmadı.'
  if (outcome === 'attention') {
    return (tx?.errorDescription ? tx.errorDescription + ' ' : '')
      + 'Bankadan kesin sonuç alınamadı; tahsilat yapılmış saymayın, banka ekstresiyle karşılaştırın.'
  }

  return 'Müşteri banka ekranını tamamlamadı; bankadan cevap gelmedi, tahsilat yapılmadı.'
}

/** Rapor satırının rengi; `attention` kırmızı DEĞİL — kesin bir olumsuzluk değil. */
export function posOutcomeToneClass(outcome: PosOutcome): string {
  if (outcome === 'success') return 'text-emerald-600'
  if (outcome === 'failed') return 'text-red-600'
  if (outcome === 'attention') return 'text-amber-600'
  return 'text-slate-500'
}

function getToken() {
  return localStorage.getItem('accessToken')
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function request(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...buildHeaders(Boolean((init?.headers as any)?.['Content-Type'] || init?.body))
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
    const trimmed = String(text ?? '').trim()
    const fallback = `İşlem gerçekleştirilemedi (${res.status})`
    if (!trimmed) throw new Error(fallback)

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const j = JSON.parse(trimmed)
        const msg = j?.message || j?.error || j?.title
        if (typeof msg === 'string' && msg.trim()) throw new Error(msg.trim())
      } catch (e) {
        if (e instanceof Error && e.message.trim()) throw e
      }
    }

    throw new Error(trimmed || fallback)
  }

  return res
}

export async function lookupBin(binNumber: string, amount: number = 100): Promise<BinLookupResponseDto> {
  const res = await request(`/api/virtual-pos/bins/${encodeURIComponent(binNumber)}?amount=${amount}`)
  const json = await res.json()
  return json?.data
}

export async function getInstallments(bankCode: number = 10, amount: number = 100): Promise<InstallmentOptionDto[]> {
  const res = await request(`/api/virtual-pos/installments?bankCode=${bankCode}&amount=${amount}`)
  const json = await res.json()
  return json?.data ?? []
}

export async function initiate3DPayment(payload: {
  customerCode: string
  amount: number
  cardHolderName: string
  cardNumber: string
  expMonth: string
  expYear: string
  cvc: string
  installmentCount: number
  bankCode?: number
  email?: string
  phone?: string
}): Promise<VirtualPos3DPayResponseDto> {
  const res = await request('/api/virtual-pos/pay-3d', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
  return await res.json()
}

/**
 * ÖDEMENİN SONUCU SUNUCUDAN SORULUR (2026-09-16).
 *
 * Ekran sonucu 3D penceresinden gelen mesajla öğreniyordu; o mesaj hem başarıda hem
 * başarısızlıkta gidiyor ve bayi ekranında yanlışlıkla "Ödeme Başarılı" çıkabiliyordu.
 * Karar artık yalnız bu uçtan okunur.
 */
export type PosPaymentStatusDto = {
  orderNo: string
  /** basarili | basarisiz | dogrulanamadi | bekliyor */
  durum: 'basarili' | 'basarisiz' | 'dogrulanamadi' | 'bekliyor'
  status: number
  isSuccess: boolean
  amount: number
  authCode: string
  message: string
  createTime: string
}

export async function fetchPaymentStatus(orderNo: string): Promise<PosPaymentStatusDto | null> {
  const no = String(orderNo ?? '').trim()
  if (!no) return null
  const res = await request(`/api/virtual-pos/payment-status/${encodeURIComponent(no)}`)
  const json = await res.json()
  return (json?.data ?? null) as PosPaymentStatusDto | null
}

export async function fetchPosTransactions(customerCode?: string): Promise<VirtualPosTransactionDto[]> {
  const q = customerCode ? `?customerCode=${encodeURIComponent(customerCode)}` : ''
  const res = await request(`/api/virtual-pos/transactions${q}`)
  const json = await res.json()
  return json?.data ?? []
}

export async function saveReceiptNo(id: string, receiptNo: string): Promise<string> {
  const res = await request(`/api/virtual-pos/transactions/${encodeURIComponent(id)}/receipt`, {
    method: 'PUT',
    body: JSON.stringify({ receiptNo })
  })
  const json = await res.json()
  return json?.data?.receiptNo ?? ''
}

/**
 * Muhasebesi bekleyen POS tahsilatlarını işler.
 *
 * NEDEN GEREKLİ: 3D geri çağrısı geldiğinde muhasebe kaydı hemen atılıyor. Ama geri çağrıyı
 * müşterinin tarayıcısı taşıyor; pencere kapanırsa çağrı hiç doğmuyor ve tahsilat
 * `AccountingPending` durumunda sonsuza kadar bekliyor. Uç en baştan vardı ama arayüzde onu
 * çağıran hiçbir şey yoktu, arka planda çalışan bir iş de değildi — yani hiç çalışmıyordu.
 *
 * Yalnızca `IsSuccess` olan ve `AccountingPending`de bekleyen kayıtları işler; bankanın
 * onaylamadığı bir ödemeyi asla muhasebeleştirmez.
 */
export async function retryPendingAccounting(): Promise<{ examined: number; posted: number; stillPending: number }> {
  const res = await fetch(`${API_BASE_URL}/api/virtual-pos/accounting/retry-pending`, {
    method: 'POST',
    headers: buildHeaders(true)
  })
  if (!res.ok) throw new Error(await res.text())
  const json = await res.json()
  const d = json?.data ?? {}
  return {
    examined: Number(d.examined ?? 0),
    posted: Number(d.posted ?? 0),
    stillPending: Number(d.stillPending ?? 0)
  }
}
