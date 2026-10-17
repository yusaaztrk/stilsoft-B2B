import { StrictMode } from 'react'
import { surumDamgasiniYaz } from './surum'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { installNativeBridge } from './native/bridge'
import { clearSession } from './auth/storage'

/*
  Telefon uygulaması bu sayfayı bir WebView içinde açıyor. Köprü indirme, yazdırma ve oturum
  aktarımını native tarafa devrediyor. Tarayıcıda çağrı ilk satırda geri döner, hiçbir davranış
  değişmez. Router kurulmadan önce takılıyor: indirme yakalayıcısı ilk boyamadan önce yerinde
  olmalı, yoksa açılışta basılan bir düğme kaçar.
*/
installNativeBridge((message) => {
  if (message.type === 'navigate' && message.path) {
    // Router burada henüz yok; adres çubuğu üzerinden gitmek tek güvenli yol.
    window.location.assign(message.path)
    return
  }
  if (message.type === 'logout') {
    clearSession()
    window.location.assign('/login')
    return
  }
  /*
    Kabuktan gelen kayitli giris bilgisi. Router burada henuz kurulu degil, o yuzden React'e
    DOM olayiyla gecirilyor; giris ekrani `native:credentials` dinliyor.
  */
  if (message.type === 'credentials') {
    window.dispatchEvent(new CustomEvent('native:credentials', { detail: message }))
  }
})

const theme = localStorage.getItem('serviceOpsThemePref')
if (theme === 'dark') {
  document.documentElement.classList.add('dark')
} else {
  document.documentElement.classList.remove('dark')
}

// Global input uppercase converter for Turkish locale
document.addEventListener('input', (e) => {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | null
  if (!target) return

  // Skip conversion on login page
  if (window.location.pathname === '/login' || target.closest('.login-page')) return

  const isInput = target.tagName === 'INPUT'
  const isTextarea = target.tagName === 'TEXTAREA'

  if (isInput || isTextarea) {
    if (isInput) {
      const type = target.type
      if (type && !['text', 'search', 'url', 'tel', 'email'].includes(type)) {
        return
      }
    }

    const value = target.value || ''
    const upperValue = value.toLocaleUpperCase('tr-TR')

    if (value !== upperValue) {
      const start = target.selectionStart
      const end = target.selectionEnd

      const setter = Object.getOwnPropertyDescriptor(
        isInput ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        'value'
      )?.set

      if (setter) {
        setter.call(target, upperValue)
        target.dispatchEvent(new Event('input', { bubbles: true }))

        if (start !== null && end !== null) {
          try {
            target.setSelectionRange(start, end)
          } catch (err) {}
        }
      }
    }
  }
})

surumDamgasiniYaz()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
