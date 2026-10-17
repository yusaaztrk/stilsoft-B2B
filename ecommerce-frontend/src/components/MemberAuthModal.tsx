import { useEffect, useMemo, useState } from 'react'
import { readApiResponse } from '../lib/api'
import { useToast } from './ui/ToastContext'

declare global {
  interface Window {
    google?: any;
  }
}

export function MemberAuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showToast } = useToast()
  const [tab, setTab] = useState<'login' | 'register' | 'forgot-password'>('login')
  const [loginMail, setLoginMail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [forgotEmail, setForgotEmail] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [regFirstName, setRegFirstName] = useState('')
  const [regLastName, setRegLastName] = useState('')
  const [regMail, setRegMail] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regPassword2, setRegPassword2] = useState('')

  const [verifyingEmail, setVerifyingEmail] = useState<string | null>(null)
  const [verificationCode, setVerificationCode] = useState('')

  const loginHint = useMemo(() => {
    const email = loginMail.trim()
    if (!email) return 'E-posta zorunludur.'
    if (!email.includes('@')) return 'E-posta formatı geçerli değil.'
    if (!loginPassword) return 'Şifre zorunludur.'
    if (loginPassword.length < 8) return 'Şifre en az 8 karakter olmalı.'
    return null
  }, [loginMail, loginPassword])

  const registerHint = useMemo(() => {
    const missing: string[] = []
    if (!regFirstName.trim()) missing.push('Ad')
    if (!regLastName.trim()) missing.push('Soyad')
    const mail = regMail.trim()
    if (!mail) missing.push('E-posta')
    const phone = regPhone.trim()
    if (!phone) missing.push('Telefon')
    if (!regPassword) missing.push('Şifre')
    if (!regPassword2) missing.push('Şifre (tekrar)')
    if (missing.length > 0) return `Eksik alanlar: ${missing.join(', ')}`
    if (!mail.includes('@')) return 'E-posta formatı geçerli değil.'
    if (phone.length !== 11) return 'Telefon numarası 11 haneli olmalıdır.'
    if (regPassword.length < 8) return 'Şifre en az 8 karakter olmalı.'
    if (regPassword !== regPassword2) return 'Şifreler eşleşmiyor.'
    return null
  }, [regFirstName, regLastName, regMail, regPhone, regPassword, regPassword2])

  const canLogin = useMemo(() => {
    const email = loginMail.trim()
    if (!email || !email.includes('@')) return false
    if (!loginPassword || loginPassword.length < 8) return false
    return true
  }, [loginMail, loginPassword])

  const canRegister = useMemo(() => {
    if (!regFirstName.trim() || !regLastName.trim()) return false
    const mail = regMail.trim()
    if (!mail || !mail.includes('@')) return false
    const phone = regPhone.trim()
    if (!phone || phone.length !== 11) return false
    if (!regPassword || regPassword.length < 8) return false
    if (regPassword !== regPassword2) return false
    return true
  }, [regFirstName, regLastName, regMail, regPhone, regPassword, regPassword2])

  const [googleClientId, setGoogleClientId] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    const fetchClientId = async () => {
      try {
        const res = await fetch('/api/auth/google-client-id')
        const data = await readApiResponse(res)
        if (active && res.ok && data?.clientId) {
          setGoogleClientId(data.clientId)
          loadGoogleScript(data.clientId)
        }
      } catch (e) {
        console.error('Failed to load Google Client ID', e)
      }
    }
    fetchClientId()
    return () => { active = false }
  }, [open])

  const loadGoogleScript = (clientId: string) => {
    if (document.getElementById('google-jssdk')) {
      initializeGoogleSignIn(clientId)
      return
    }
    const script = document.createElement('script')
    script.id = 'google-jssdk'
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => initializeGoogleSignIn(clientId)
    document.head.appendChild(script)
  }

  const initializeGoogleSignIn = (clientId: string) => {
    try {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredentialResponse,
        cancel_on_tap_outside: false
      })
      renderGoogleButtons()
    } catch (err) {
      console.error('Failed to initialize Google Sign In', err)
    }
  }

  const renderGoogleButtons = () => {
    if (!window.google) return
    const loginButtonDiv = document.getElementById('google-signin-btn-modal')
    if (loginButtonDiv) {
      try {
        window.google.accounts.id.renderButton(loginButtonDiv, {
          theme: 'outline',
          size: 'medium',
          width: loginButtonDiv.clientWidth || 180,
          text: 'continue_with',
          locale: 'tr',
          shape: 'rectangular'
        })
      } catch (err) {
        console.error('Error rendering login Google button:', err)
      }
    }
    const signupButtonDiv = document.getElementById('google-signup-btn-modal')
    if (signupButtonDiv) {
      try {
        window.google.accounts.id.renderButton(signupButtonDiv, {
          theme: 'outline',
          size: 'medium',
          width: signupButtonDiv.clientWidth || 180,
          text: 'continue_with',
          locale: 'tr',
          shape: 'rectangular'
        })
      } catch (err) {
        console.error('Error rendering signup Google button:', err)
      }
    }
  }

  useEffect(() => {
    if (!open || !googleClientId || verifyingEmail) return
    const timer = setTimeout(() => { renderGoogleButtons() }, 150)
    return () => clearTimeout(timer)
  }, [open, googleClientId, tab, verifyingEmail])

  const handleGoogleCredentialResponse = async (response: any) => {
    if (!response.credential) return
    setError(null)
    setSuccess(null)
    setBusy(true)
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: response.credential })
      })
      const data = await readApiResponse(res)
      if (!res.ok || !data?.success) {
        setError(data?.message || 'Google ile giriş başarısız.')
        return
      }
      localStorage.setItem('ecom_member_token', data.data.accessToken)
      localStorage.setItem('ecom_member_user', JSON.stringify(data.data.user))
      showToast('Giriş işleminiz başarıyla tamamlandı. Hoş geldiniz!', 'success', 2000)
      window.dispatchEvent(new Event('member-login-success'))
      closeAndReset()
    } catch (err) {
      setError('Ağ hatası oluştu. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  const closeAndReset = () => {
    setBusy(false)
    setError(null)
    setSuccess(null)
    setLoginPassword('')
    setRegPassword('')
    setRegPassword2('')
    setVerifyingEmail(null)
    setVerificationCode('')
    setForgotEmail('')
    setTab('login')
    onClose()
  }

  const handleVerifyCode = async () => {
    if (!verifyingEmail || verificationCode.length !== 6) return
    try {
      setBusy(true)
      const res = await fetch('/api/auth/verify-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verifyingEmail, code: verificationCode }),
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Doğrulama başarısız')
      localStorage.setItem('ecom_member_token', json.data.accessToken)
      if (json.data.user) localStorage.setItem('ecom_member_user', JSON.stringify(json.data.user))
      showToast('Kayıt işleminiz başarıyla tamamlandı.', 'success', 2000)
      window.dispatchEvent(new Event('member-login-success'))
      closeAndReset()
    } catch (e: any) { setError(String(e?.message ?? 'Doğrulama başarısız')) } finally { setBusy(false) }
  }

  const handleLogin = async () => {
    if (!canLogin) return
    try {
      setBusy(true)
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginMail.trim(), password: loginPassword }),
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Giriş başarısız')
      localStorage.setItem('ecom_member_token', json.data.accessToken)
      if (json.data.user) localStorage.setItem('ecom_member_user', JSON.stringify(json.data.user))
      showToast('Giriş işleminiz başarıyla tamamlandı.', 'success', 2000)
      window.dispatchEvent(new Event('member-login-success'))
      closeAndReset()
    } catch (e: any) { setError(String(e?.message ?? 'Giriş başarısız')) } finally { setBusy(false) }
  }

  const handleRegister = async () => {
    if (!canRegister) return
    try {
      setBusy(true)
      const fullName = `${regFirstName.trim()} ${regLastName.trim()}`.trim()
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email: regMail.trim(), phone: regPhone.trim(), password: regPassword }),
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Kayıt başarısız')
      if (json.verificationRequired) {
        setVerifyingEmail(regMail.trim())
        setSuccess('E-posta adresinize 6 haneli onay kodu gönderildi.')
        return
      }
      localStorage.setItem('ecom_member_token', json.data.accessToken)
      if (json.data.user) localStorage.setItem('ecom_member_user', JSON.stringify(json.data.user))
      showToast('Kayıt işleminiz başarıyla tamamlandı.', 'success', 2000)
      window.dispatchEvent(new Event('member-login-success'))
      closeAndReset()
    } catch (e: any) { setError(String(e?.message ?? 'Kayıt başarısız')) } finally { setBusy(false) }
  }

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim().includes('@')) return
    setError(null)
    setSuccess(null)
    try {
      setBusy(true)
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      })
      const json = await readApiResponse(res)
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'İşlem başarısız.')
      }
      setSuccess(json.message || 'Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.')
    } catch (e: any) {
      setError(String(e?.message ?? 'İşlem başarısız.'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-md transition-opacity duration-300" onClick={closeAndReset} />
      
      {/* Background Floating Ambient Glow Circles for visual depth */}
      <div className="ambient-glow-circle-1" />
      <div className="ambient-glow-circle-2" />

      {/* Modal Container */}
      <div className="absolute inset-0 flex items-center justify-center p-4 z-10">
        <div className="w-full max-w-md overflow-hidden rounded-[32px] bg-white shadow-[0_32px_64px_-16px_rgba(0,0,0,0.18),0_16px_32px_-8px_rgba(0,0,0,0.08)] border border-zinc-150/40 animate-modal-spring relative p-6 md:p-8">
          
          {/* Ambient Glow Bar at the very top (perfectly clipped by overflow-hidden) */}
          <div className="animated-glow-bar" />
          
          {/* Decorative Glowing Accent Splash */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-56 h-28 bg-gradient-to-b from-primary/10 to-transparent blur-3xl pointer-events-none z-0" />
          
          {/* Close button */}
          <button
            type="button"
            onClick={closeAndReset}
            className="absolute top-6 right-6 z-20 grid h-9 w-9 place-items-center rounded-full bg-zinc-100/50 hover:bg-zinc-100 text-zinc-400 hover:text-zinc-655 hover:scale-105 active:scale-95 transition-all duration-200"
            aria-label="Kapat"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>

          {/* Title and Subtitle */}
          <div className="text-center mb-6 relative z-10 pt-4">
            <div className="mx-auto w-14 h-14 bg-gradient-to-tr from-primary/15 to-rose-600/5 rounded-2xl flex items-center justify-center text-primary mb-3.5 shadow-[0_8px_20px_-6px_rgba(223,0,0,0.15)] border border-primary/10">
              <span className="material-symbols-outlined text-2xl font-light">
                {tab === 'forgot-password' ? 'lock_reset' : 'local_mall'}
              </span>
            </div>
            <h2 className="text-xl font-black text-zinc-900 tracking-tight">
              {tab === 'forgot-password' ? 'Şifremi Unuttum' : tab === 'login' ? 'Hoş Geldiniz' : 'Yeni Hesap Oluştur'}
            </h2>
            <p className="text-xs text-zinc-400 font-semibold mt-1">
              {tab === 'forgot-password' ? 'Şifrenizi yenilemek için e-posta adresinizi girin' : tab === 'login' ? 'Ayrıcalıklı alışveriş dünyasına giriş yapın' : 'Hemen üye olun, fırsatlardan yararlanın'}
            </p>
          </div>

          <div className="relative z-10">
            {/* Tabs */}
            {!verifyingEmail && tab !== 'forgot-password' && (
              <div className="relative grid grid-cols-2 rounded-2xl bg-zinc-100/60 p-1 text-xs font-bold mb-6 select-none">
                <div 
                  className="absolute top-1 bottom-1 left-1 bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{
                    width: 'calc(50% - 4px)',
                    transform: tab === 'login' ? 'translateX(0)' : 'translateX(100%)'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setTab('login')}
                  className={`relative z-10 rounded-xl py-2.5 transition-all duration-300 ${tab === 'login' ? 'text-zinc-950' : 'text-zinc-450 hover:text-zinc-850'}`}
                >
                  Üye Girişi
                </button>
                <button
                  type="button"
                  onClick={() => setTab('register')}
                  className={`relative z-10 rounded-xl py-2.5 transition-all duration-300 ${tab === 'register' ? 'text-zinc-950' : 'text-zinc-450 hover:text-zinc-850'}`}
                >
                  Üye Ol
                </button>
              </div>
            )}

            {error ? (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50/50 px-4 py-3 text-xs font-bold text-rose-700 animate-in">
                {error}
              </div>
            ) : null}

            {success ? (
              <div className="mb-4 rounded-2xl border border-green-200 bg-green-50/50 px-4 py-3 text-xs font-bold text-green-700 animate-in">
                {success}
              </div>
            ) : null}

            {verifyingEmail ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleVerifyCode()
                }}
                className="min-h-[460px] flex flex-col justify-between animate-in"
              >
                <div className="space-y-5 text-center">
                  <div className="mx-auto w-14 h-14 bg-gradient-to-tr from-primary/15 to-rose-600/5 rounded-2xl flex items-center justify-center text-primary mb-3.5 shadow-[0_8px_20px_-6px_rgba(223,0,0,0.15)] border border-primary/10">
                    <span className="material-symbols-outlined text-2xl font-light animate-bounce">mark_email_read</span>
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-lg font-black text-zinc-900">E-Posta Onay Kodu</h3>
                    <p className="text-xs text-zinc-500 leading-relaxed font-semibold px-4">
                      <strong className="text-zinc-800 font-bold">{verifyingEmail}</strong> adresine 6 haneli bir onay kodu gönderdik. Üyeliğinizi tamamlamak için lütfen bu kodu girin.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1 text-left mb-1">Onay Kodu</label>
                    <input
                      value={verificationCode}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                        setVerificationCode(val)
                      }}
                      placeholder="000000"
                      maxLength={6}
                      required
                      className="w-full text-center py-3 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-2xl font-bold font-mono tracking-[0.3em] outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all text-zinc-800 placeholder:text-zinc-300 shadow-inner-sm"
                    />
                  </div>
                </div>

                <div className="space-y-3 pt-4">
                  <button
                    type="submit"
                    disabled={verificationCode.length !== 6 || busy}
                    className="w-full bg-gradient-to-r from-primary via-rose-600 to-primary bg-[length:200%_auto] hover:bg-right hover:scale-[1.01] active:scale-[0.99] text-white py-3.5 rounded-2xl font-extrabold text-sm shadow-[0_8px_24px_rgba(223,0,0,0.2)] hover:shadow-[0_12px_28px_rgba(223,0,0,0.35)] transition-all duration-300 flex items-center justify-center gap-2"
                  >
                    {busy ? 'Doğrulanıyor...' : 'Onayla ve Üye Ol'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setVerifyingEmail(null)
                      setError(null)
                      setSuccess(null)
                    }}
                    className="w-full py-2.5 border border-zinc-200 rounded-2xl text-xs font-bold text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-all active:scale-[0.98]"
                  >
                    Geri Dön
                  </button>
                </div>
              </form>
            ) : tab === 'forgot-password' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleForgotPassword()
                }}
                className="min-h-[460px] flex flex-col justify-between animate-in"
              >
                <div className="space-y-5">
                  <div className="text-center px-2">
                    <p className="text-xs text-zinc-500 font-semibold leading-relaxed">
                      Lütfen kayıtlı e-posta adresinizi girin. Size şifrenizi sıfırlamanız için bir bağlantı göndereceğiz.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">E-Posta Adresi</label>
                    <div className="relative group/input">
                      <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-lg group-focus-within/input:text-primary transition-colors">mail</span>
                      <input
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all font-semibold text-zinc-800 placeholder:text-zinc-300"
                        placeholder="ornek@example.com"
                        autoComplete="email"
                        type="email"
                        required
                      />
                    </div>
                  </div>


                </div>

                <div className="space-y-3 pt-4">
                  <button
                    type="submit"
                    disabled={!forgotEmail.includes('@') || busy}
                    className="w-full bg-gradient-to-r from-primary via-rose-600 to-primary bg-[length:200%_auto] hover:bg-right hover:scale-[1.01] active:scale-[0.99] text-white py-3.5 rounded-2xl font-extrabold text-sm shadow-[0_8px_24px_rgba(223,0,0,0.2)] hover:shadow-[0_12px_28px_rgba(223,0,0,0.35)] transition-all duration-300 flex items-center justify-center gap-2"
                  >
                    {busy ? 'Gönderiliyor...' : 'Bağlantı Gönder'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTab('login')
                      setError(null)
                      setSuccess(null)
                    }}
                    className="w-full py-2.5 border border-zinc-200 rounded-2xl text-xs font-bold text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-all active:scale-[0.98]"
                  >
                    Geri Dön
                  </button>
                </div>
              </form>
            ) : (
              /* Sliding Container for login/register tabs */
              <div className="overflow-hidden w-full relative">
                <div 
                  className="flex" 
                  style={{ 
                    transform: tab === 'login' ? 'translateX(0)' : 'translateX(-50%)', 
                    width: '200%',
                    transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                >
                  {/* Login Form Column */}
                  <div className="w-1/2 shrink-0 pr-3">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        void handleLogin()
                      }}
                      className="min-h-[460px] flex flex-col justify-between"
                    >
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">E-Posta Adresi</label>
                          <div className="relative group/input">
                            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-lg group-focus-within/input:text-primary transition-colors">mail</span>
                            <input
                              value={loginMail}
                              onChange={(e) => setLoginMail(e.target.value)}
                              className="w-full pl-11 pr-4 py-3 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all font-semibold text-zinc-800 placeholder:text-zinc-300"
                              placeholder="ornek@example.com"
                              autoComplete="email"
                              type="email"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center pl-1">
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Şifre</label>
                            <button
                              type="button"
                              onClick={() => {
                                setTab('forgot-password')
                                setError(null)
                                setSuccess(null)
                              }}
                              className="text-[11px] font-extrabold text-primary hover:underline"
                            >
                              Şifremi Unuttum?
                            </button>
                          </div>
                          <div className="relative group/input">
                            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-lg group-focus-within/input:text-primary transition-colors">lock</span>
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={loginPassword}
                              onChange={(e) => setLoginPassword(e.target.value)}
                              className="w-full pl-11 pr-12 py-3 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all font-semibold text-zinc-800 placeholder:text-zinc-300"
                              placeholder="••••••••"
                              autoComplete="current-password"
                            />
                            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-655 transition-colors">
                              <span className="material-symbols-outlined text-lg">{showPassword ? 'visibility_off' : 'visibility'}</span>
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center pl-1">
                          <input className="w-4.5 h-4.5 text-primary border-zinc-300 rounded focus:ring-primary/20 cursor-pointer accent-primary" id="remember-modal" type="checkbox" />
                          <label className="ml-2 text-xs font-bold text-zinc-500 cursor-pointer select-none" htmlFor="remember-modal">Beni hatırla</label>
                        </div>

                        <button
                          type="submit"
                          disabled={!canLogin || busy}
                          className="w-full bg-gradient-to-r from-primary via-rose-600 to-primary bg-[length:200%_auto] hover:bg-right hover:scale-[1.01] active:scale-[0.99] text-white py-3.5 rounded-2xl font-extrabold text-sm shadow-[0_8px_24px_rgba(223,0,0,0.2)] hover:shadow-[0_12px_28px_rgba(223,0,0,0.35)] transition-all duration-300 flex items-center justify-center gap-1.5 group"
                        >
                          {busy ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
                          <span className="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">arrow_forward</span>
                        </button>
                      </div>

                      {/* Social logins at the bottom */}
                      <div className="space-y-3.5 pt-4">
                        <div className="relative flex items-center pt-2">
                          <div className="flex-grow border-t border-zinc-200/60" />
                          <span className="flex-shrink mx-3 text-zinc-400 text-[10px] font-bold uppercase tracking-wider">veya</span>
                          <div className="flex-grow border-t border-zinc-200/60" />
                        </div>

                        <div className="grid grid-cols-2 gap-3 items-center">
                          <div id="google-signin-btn-modal" className="w-full flex justify-center min-h-[44px]" />
                          <button type="button" className="flex items-center justify-center gap-2 py-2 px-3 border border-zinc-200/80 rounded-2xl font-bold text-xs text-zinc-700 hover:bg-zinc-50/50 hover:border-zinc-300 transition-all active:scale-95 h-[44px] w-full bg-white shadow-sm">
                            <svg className="w-5 h-5 text-[#1877F2] fill-current shrink-0" viewBox="0 0 24 24">
                              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                            </svg>
                            Facebook
                          </button>
                        </div>
                        {!error && loginHint ? <div className="text-[10px] font-bold text-zinc-400 text-center leading-none mt-1 animate-in">{loginHint}</div> : null}
                      </div>
                    </form>
                  </div>

                  {/* Register Form Column */}
                  <div className="w-1/2 shrink-0 pl-3">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        void handleRegister()
                      }}
                      className="min-h-[460px] flex flex-col justify-between"
                    >
                      <div className="space-y-3.5">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">Ad</label>
                            <input
                              value={regFirstName}
                              onChange={(e) => setRegFirstName(e.target.value)}
                              className="w-full px-4 py-2.5 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all font-semibold text-zinc-800 placeholder:text-zinc-300"
                              placeholder="Ahmet"
                              autoComplete="given-name"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">Soyad</label>
                            <input
                              value={regLastName}
                              onChange={(e) => setRegLastName(e.target.value)}
                              className="w-full px-4 py-2.5 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all font-semibold text-zinc-800 placeholder:text-zinc-300"
                              placeholder="Yılmaz"
                              autoComplete="family-name"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">E-Posta</label>
                            <input
                              value={regMail}
                              onChange={(e) => setRegMail(e.target.value)}
                              className="w-full px-4 py-2.5 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all font-semibold text-zinc-800 placeholder:text-zinc-300"
                              placeholder="isim@adres.com"
                              autoComplete="email"
                              type="email"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">Telefon</label>
                            <input
                              value={regPhone}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '')
                                const next = raw.replace(/\D/g, '').slice(0, 11)
                                setRegPhone(next)
                              }}
                              className="w-full px-4 py-2.5 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all font-semibold text-zinc-800 placeholder:text-zinc-300"
                              placeholder="05xx xxx xx xx"
                              autoComplete="tel"
                              type="tel"
                              maxLength={11}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider pl-1">Şifre</label>
                            <input
                              type="password"
                              value={regPassword}
                              onChange={(e) => setRegPassword(e.target.value)}
                              className="w-full px-4 py-2.5 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all font-semibold text-zinc-800 placeholder:text-zinc-300"
                              placeholder="••••••••"
                              autoComplete="new-password"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wide pl-1">Şifre (Tekrar)</label>
                            <input
                              type="password"
                              value={regPassword2}
                              onChange={(e) => setRegPassword2(e.target.value)}
                              className="w-full px-4 py-2.5 bg-zinc-50/50 border border-zinc-200/80 rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-zinc-800 transition-all font-semibold text-zinc-800 placeholder:text-zinc-300"
                              placeholder="••••••••"
                              autoComplete="new-password"
                            />
                          </div>
                        </div>

                        <button
                          disabled={!canRegister || busy}
                          type="submit"
                          className="w-full bg-gradient-to-r from-primary via-rose-600 to-primary bg-[length:200%_auto] hover:bg-right hover:scale-[1.01] active:scale-[0.99] text-white py-3.5 rounded-2xl font-extrabold text-sm shadow-[0_8px_24px_rgba(223,0,0,0.2)] hover:shadow-[0_12px_28px_rgba(223,0,0,0.35)] transition-all duration-300 disabled:opacity-60 flex items-center justify-center gap-1.5 group"
                        >
                          {busy ? 'Kayıt Yapılıyor...' : 'Kayıt Ol'}
                          <span className="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">arrow_forward</span>
                        </button>
                        <div className="text-[10px] font-bold text-zinc-400 text-center leading-relaxed px-2">
                          Kişisel verilerimin işlenmesine dair <a className="text-primary font-black hover:underline" href="#">KVKK metnini</a> okudum ve onaylıyorum.
                        </div>
                      </div>

                      {/* Social logins at the bottom */}
                      <div className="space-y-3 pt-3">
                        <div className="relative flex items-center">
                          <div className="flex-grow border-t border-zinc-200/60" />
                          <span className="flex-shrink mx-3 text-zinc-400 text-[10px] font-bold uppercase tracking-wider">veya</span>
                          <div className="flex-grow border-t border-zinc-200/60" />
                        </div>

                        <div className="grid grid-cols-2 gap-3 items-center">
                          <div id="google-signup-btn-modal" className="w-full flex justify-center min-h-[44px]" />
                          <button type="button" className="flex items-center justify-center gap-2 py-2 px-3 border border-zinc-200/80 rounded-2xl font-bold text-xs text-zinc-700 hover:bg-zinc-50/50 hover:border-zinc-300 transition-all active:scale-95 h-[44px] w-full bg-white shadow-sm">
                            <svg className="w-5 h-5 text-[#1877F2] fill-current shrink-0" viewBox="0 0 24 24">
                              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                            </svg>
                            Facebook
                          </button>
                        </div>
                        {!error && registerHint ? <div className="text-[10px] font-bold text-zinc-400 text-center leading-none mt-1 animate-in">{registerHint}</div> : null}
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
