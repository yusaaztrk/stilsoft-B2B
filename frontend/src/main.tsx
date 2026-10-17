import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { CartProvider } from './contexts/CartContext'
import { DealerProvider } from './contexts/DealerContext'
import { installSystemErrorReporter } from './utils/systemErrorReporter'
import { installCredentialsBridge } from './native/credentials'
import { publishOperationEffects, readOperationEffects } from './utils/operationEffects'
import DeleteReasonDialog from './components/DeleteReasonDialog'
import {
  DELETE_REASON_HEADER,
  cancelledDeleteResponse,
  encodeDeleteReason,
  needsDeleteReason,
  obtainDeleteReason,
} from './utils/deleteReasonGate'

const originalFetch = window.fetch.bind(window)
installSystemErrorReporter()
/*
  Telefon kabugu giris bilgisini burada gonderiyor. Tarayicida ilk satirda doner.
  Router kurulmadan once takiliyor: giris ekrani acilir acilmaz bilgiyi isteyecek.
*/
installCredentialsBridge()

window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const token = localStorage.getItem('accessToken')
  const tenantCode = localStorage.getItem('tenantCode')

  const existingHeaders = (init?.headers ?? {}) as any
  const headers = new Headers(existingHeaders)

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (tenantCode && !headers.has('X-Tenant-Code')) {
    headers.set('X-Tenant-Code', tenantCode)
  }

  /*
    SİLME NEDENİ (2026-10-04). "Silinen Kayıtlar"a yazan bir silme isteği gönderilmeden önce
    neden sorulur ve başlığa eklenir; iptal edilirse istek HİÇ gönderilmez. Kural ve uç
    listesi: utils/deleteReasonGate.
  */
  const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String((input as Request)?.url ?? '')
  const requestMethod = init?.method ?? (input instanceof Request ? input.method : 'GET')
  if (needsDeleteReason(requestMethod, requestUrl) && !headers.has(DELETE_REASON_HEADER)) {
    return obtainDeleteReason(requestUrl).then((reason) => {
      if (!reason) return cancelledDeleteResponse()
      headers.set(DELETE_REASON_HEADER, encodeDeleteReason(reason))
      return sendWithEffects(input, init, headers)
    })
  }

  return sendWithEffects(input, init, headers)
}

function sendWithEffects(input: RequestInfo | URL, init: RequestInit | undefined, headers: Headers) {
  /*
    İŞLEM SONUÇLARI TEK KANCADAN OKUNUR.

    `src/api` altında 25 ayrı `request` sarmalayıcısı var; her birine geri bildirim eklemek
    hem yirmi beş dokunuş hem de yirmi altıncısında unutmak demekti. Burası zaten bütün
    isteklerin geçtiği tek yer.

    Okuma İSTEĞİ DEĞİŞTİRMEZ: yanıt olduğu gibi çağırana döner, başlık yalnızca okunur.
  */
  return originalFetch(input, { ...(init ?? {}), headers }).then((response) => {
    try {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD' && response.ok) {
        const path = typeof input === 'string' ? input : String((input as Request)?.url ?? input)
        const payload = readOperationEffects(response, path)
        if (payload) publishOperationEffects(payload)
      }
    } catch {
      // Geri bildirim işi, isteğin kendisini düşüremez.
    }
    return response
  })
}

function toUpperTr(value: string) {
  const s = String(value ?? '')
  if (!s) return s
  return s.toLocaleUpperCase('tr-TR')
}

function setNativeInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el)
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  const setter = desc?.set
  if (setter) setter.call(el, value)
  else (el as any).value = value
}

function isLoginRoute() {
  try {
    return String(window.location?.pathname ?? '') === '/login'
  } catch {
    return false
  }
}

function shouldUppercaseInput(el: HTMLInputElement | HTMLTextAreaElement) {
  if (!el.classList.contains('input-base')) return false
  if (el instanceof HTMLInputElement) {
    const t = (el.type ?? '').toLowerCase()
    if (['number', 'date', 'time', 'datetime-local', 'email', 'password', 'tel', 'file'].includes(t)) return false
  }
  if (isLoginRoute()) return false
  if (el.getAttribute('data-no-uppercase') === 'true') return false
  if (el.getAttribute('data-no-capitalize') === 'true') return false
  if (el.closest('[data-disable-global-uppercase="true"]')) return false
  return true
}

const rewriting = new WeakSet<EventTarget>()

document.addEventListener(
  'input',
  (ev) => {
    const target = ev.target as any
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
    if (!shouldUppercaseInput(target)) return

    if (rewriting.has(target)) return

    const prev = String(target.value ?? '')
    const next = toUpperTr(prev)
    if (next === prev) return

    rewriting.add(target)
    try {
      // Keep caret position
      const start = target.selectionStart
      const end = target.selectionEnd

      // React controlled inputs require using the native value setter
      setNativeInputValue(target, next)

      // Stop original event and dispatch a fresh input event so React picks up the new value
      try {
        ; (ev as any).stopImmediatePropagation?.()
      } catch {
        // ignore
      }

      if (typeof (ev as any).stopPropagation === 'function') ev.stopPropagation()
      if (typeof (ev as any).preventDefault === 'function') ev.preventDefault()

      const synthetic = new Event('input', { bubbles: true })
      target.dispatchEvent(synthetic)

      if (typeof start === 'number' && typeof end === 'number') {
        try {
          target.setSelectionRange(start, end)
        } catch {
          // ignore
        }
      }
    } finally {
      rewriting.delete(target)
    }
  },
  true
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <DealerProvider>
        <CartProvider>
          <App />
          {/* İşlem bildirimleri artık üst çubukta (Header → IslemBildirimleri), sol alttaki
              kutu kaldırıldı (2026-10-04 kullanıcı isteği). */}
          <DeleteReasonDialog />
        </CartProvider>
      </DealerProvider>
    </BrowserRouter>
  </React.StrictMode>
)

