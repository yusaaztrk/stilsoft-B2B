import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'

declare global {
  interface Window {
    google?: any;
  }
}

export function LoginPage() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [isRegister, setIsRegister] = useState(false)
  
  // Form fields
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [verifyingEmail, setVerifyingEmail] = useState<string | null>(null)
  const [verificationCode, setVerificationCode] = useState('')

  const [googleClientId, setGoogleClientId] = useState('')

  // Fetch Google Client ID and initialize Google Identity Services
  useEffect(() => {
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
    return () => {
      active = false
    }
  }, [])

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

      // Initial render
      renderGoogleButton()
    } catch (err) {
      console.error('Failed to initialize Google Sign In', err)
    }
  }

  const renderGoogleButton = () => {
    const buttonDiv = document.getElementById('google-login-btn')
    if (buttonDiv && window.google) {
      try {
        window.google.accounts.id.renderButton(buttonDiv, {
          theme: 'outline',
          size: 'large',
          width: buttonDiv.clientWidth || 380,
          text: 'continue_with',
          locale: 'tr',
          shape: 'rectangular'
        })
      } catch (err) {
        console.error('Error rendering Google button:', err)
      }
    }
  }

  // Re-render Google Button when Client ID is ready or when isRegister state / verifyingEmail state changes
  useEffect(() => {
    if (!googleClientId || verifyingEmail) return

    const timer = setTimeout(() => {
      renderGoogleButton()
    }, 150)

    return () => clearTimeout(timer)
  }, [googleClientId, isRegister, verifyingEmail])

  // Handle Google Token response
  const handleGoogleCredentialResponse = async (response: any) => {
    if (!response.credential) return
    
    setError('')
    setSuccess('')
    setLoading(true)

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
      setTimeout(() => {
        navigate('/')
      }, 1500)
    } catch (err) {
      setError('Ağ hatası oluştu. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      if (isRegister) {
        // Validation: phone must be 11 digits
        const digits = phone.replace(/\D/g, '')
        if (digits.length !== 11) {
          setError('Telefon numarası 11 haneli olmalıdır (örn: 05XXXXXXXXX)')
          setLoading(false)
          return
        }
        if (password.length < 8) {
          setError('Şifre en az 8 karakter olmalıdır')
          setLoading(false)
          return
        }

        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: fullName.trim(),
            email: email.trim(),
            phone: digits,
            password
          }),
        })
        const data = await readApiResponse(res)
        if (!res.ok) {
          setError(data?.message || 'Kayıt başarısız. Lütfen bilgilerinizi kontrol edin.')
          return
        }

        if (data.verificationRequired) {
          setVerifyingEmail(email.trim())
          setSuccess('E-posta adresinize 6 haneli onay kodu gönderildi. Üyeliği tamamlamak için lütfen kodu girin.')
          return
        }

        localStorage.setItem('ecom_member_token', data.data.accessToken)
        localStorage.setItem('ecom_member_user', JSON.stringify(data.data.user))
        showToast('Kayıt işleminiz başarıyla tamamlandı. Hoş geldiniz!', 'success', 2000)
        window.dispatchEvent(new Event('member-login-success'))
        setTimeout(() => {
          navigate('/')
        }, 1800)
      } else {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
        })
        const data = await readApiResponse(res)
        if (!res.ok) {
          setError(data?.message || 'Giriş başarısız. Lütfen bilgilerinizi kontrol edin.')
          return
        }
        localStorage.setItem('ecom_member_token', data.data.accessToken)
        localStorage.setItem('ecom_member_user', JSON.stringify(data.data.user))
        showToast('Giriş işleminiz başarıyla tamamlandı. Hoş geldiniz!', 'success', 2000)
        window.dispatchEvent(new Event('member-login-success'))
        setTimeout(() => {
          navigate('/')
        }, 1800)
      }
    } catch {
      setError('Bağlantı hatası. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!verifyingEmail || verificationCode.length !== 6) return
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/verify-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verifyingEmail, code: verificationCode }),
      })

      const data = await readApiResponse(res)
      if (!res.ok || !data?.success) {
        setError(data?.message || 'Doğrulama başarısız.')
        return
      }

      localStorage.setItem('ecom_member_token', data.data.accessToken)
      localStorage.setItem('ecom_member_user', JSON.stringify(data.data.user))
      showToast('Kayıt işleminiz başarıyla tamamlandı. Hoş geldiniz!', 'success', 2000)
      window.dispatchEvent(new Event('member-login-success'))
      setVerifyingEmail(null)
      setVerificationCode('')
      setTimeout(() => {
        navigate('/')
      }, 1800)
    } catch {
      setError('Bağlantı hatası. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  const toggleMode = () => {
    setIsRegister(!isRegister)
    setError('')
    setSuccess('')
    setFullName('')
    setPhone('')
    setEmail('')
    setPassword('')
    setVerifyingEmail(null)
    setVerificationCode('')
  }

  return (
    <div className="min-h-[calc(100vh-200px)] flex flex-col md:flex-row">
      {/* Left Side: Product Visual */}
      <section className="hidden md:flex md:w-1/2 lg:w-3/5 bg-on-surface relative items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            className="w-full h-full object-cover opacity-40"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuB5gVxB21yOhwwcudN_EypIHBSsyjj2wlpGP6EHraoeZV1bzlygPCzEj6VvY9Os8eMl_BhGjPyT1vjWQfizP3MhlSySwFmQju8yM3W1phbyv2tXM7U6xsK9nzC5nhO5TxOuKEws_XWeddi7TcYatLzEv5J46NSCoKO3DiTuJhPCEeHt2ub1kf-tMk3vjpfCT1kBFHgF1i-Z9qMjrNtqrhyy_bGf5B1zvPu1UkPccC4xp2AHPk1Jbrm1ZEO9mBTEaA3QoqIW55ASS68"
            alt="Stilsoft ürün"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-on-surface/80 via-on-surface/40 to-transparent" />
        </div>
        <div className="relative z-10 p-12 text-center max-w-xl">
          <div className="text-3xl font-black text-white tracking-[-0.04em] mb-8">STILSOFT</div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4 leading-tight">
            Teknolojinin Kalbi, <br />
            <span className="text-primary-fixed">Evinizin Ruhu</span>
          </h1>
          <p className="text-lg text-zinc-400 leading-relaxed">
            Stilsoft dünyasına hoş geldiniz. Akıllı ev teknolojileri ve üstün performanslı gereçlerle yaşam kalitenizi artırın.
          </p>
        </div>
        {/* Floating Badges */}
        <div className="absolute bottom-10 left-10 bg-white/10 backdrop-blur-xl p-4 rounded-xl border border-white/10 flex items-center gap-3 animate-fade-up">
          <span className="material-symbols-outlined text-primary-fixed text-2xl">bolt</span>
          <div>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em]">Performans</p>
            <p className="font-bold text-white">2200W Güç</p>
          </div>
        </div>
        <div className="absolute top-40 right-10 bg-white/10 backdrop-blur-xl p-4 rounded-xl border border-white/10 flex items-center gap-3 animate-fade-up" style={{ animationDelay: '0.2s' }}>
          <span className="material-symbols-outlined text-green-400 text-2xl">eco</span>
          <div>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em]">Verimlilik</p>
            <p className="font-bold text-white">A+++ Enerji Sınıfı</p>
          </div>
        </div>
      </section>

      {/* Right Side: Form */}
      <section className="w-full md:w-1/2 lg:w-2/5 flex items-center justify-center p-6 md:p-12 bg-white">
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-10">
            <h2 className="text-3xl font-bold text-on-surface mb-2">
              {verifyingEmail ? 'E-posta Onayı' : isRegister ? 'Hesap Oluştur' : 'Giriş Yap'}
            </h2>
            <p className="text-zinc-500 text-sm">
              {verifyingEmail 
                ? 'Onay kodunu girerek üyeliğinizi tamamlayın.' 
                : isRegister 
                  ? 'Stilsoft dünyasına katılarak avantajlardan yararlanın.' 
                  : 'Kullanıcı bilgilerinizle güvenli erişim sağlayın.'}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-medium flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">error</span>
              {error}
            </div>
          )}

          {success && (
            <div className="mb-6 p-4 bg-emerald-50 border border-emerald-250 rounded-xl text-sm text-emerald-800 font-medium flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">check_circle</span>
              {success}
            </div>
          )}

          {verifyingEmail ? (
            <form className="space-y-5" onSubmit={handleVerifyCode}>
              <div className="text-center space-y-2 py-4">
                <span className="material-symbols-outlined text-primary text-5xl animate-bounce">mark_email_read</span>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  <strong>{verifyingEmail}</strong> adresine 6 haneli bir onay kodu gönderdik. Üyeliğinizi tamamlamak için lütfen bu kodu girin.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-zinc-700 text-center" htmlFor="verificationCode">Onay Kodu</label>
                <input
                  className="w-full text-center py-3 bg-white border border-zinc-200 rounded-xl text-lg font-bold font-mono tracking-[0.5em] outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  id="verificationCode"
                  placeholder="000000"
                  type="text"
                  maxLength={6}
                  value={verificationCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                    setVerificationCode(val)
                  }}
                  required
                  disabled={loading}
                />
              </div>

              <button
                className="w-full bg-primary text-white py-3.5 rounded-xl font-bold shadow-lg shadow-primary/20 hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                type="submit"
                disabled={verificationCode.length !== 6 || loading}
              >
                {loading ? (
                  <>
                    <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                    Doğrulanıyor...
                  </>
                ) : (
                  <>
                    Onayla ve Üye Ol
                    <span className="material-symbols-outlined text-lg">arrow_forward</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setVerifyingEmail(null)
                  setError('')
                  setSuccess('')
                }}
                className="w-full py-3 border-2 border-zinc-200 rounded-xl font-bold text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 active:scale-[0.98] transition-all text-sm"
              >
                Geri Dön
              </button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              {isRegister && (
                <>
                  {/* Ad Soyad */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-zinc-700" htmlFor="fullName">Ad Soyad</label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xl">person</span>
                      <input
                        className="w-full pl-11 pr-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
                        id="fullName"
                        placeholder="Ahmet Yılmaz"
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        disabled={loading}
                      />
                    </div>
                  </div>

                  {/* Telefon Numarası */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-zinc-700" htmlFor="phone">Telefon Numarası</label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xl">phone_iphone</span>
                      <input
                        className="w-full pl-11 pr-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm font-mono"
                        id="phone"
                        placeholder="05XXXXXXXXX"
                        type="tel"
                        value={phone}
                        maxLength={11}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 11)
                          setPhone(val)
                        }}
                        required
                        disabled={loading}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* E-posta Adresi */}
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-zinc-700" htmlFor="email">E-posta Adresi</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xl">mail</span>
                  <input
                    className="w-full pl-11 pr-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
                    id="email"
                    placeholder="ornek@example.com"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Şifre */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="block text-sm font-semibold text-zinc-700" htmlFor="password">Şifre</label>
                  {!isRegister && (
                    <a className="text-xs font-medium text-primary hover:underline" href="#">Şifremi Unuttum</a>
                  )}
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xl">lock</span>
                  <input
                    className="w-full pl-11 pr-12 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
                    id="password"
                    placeholder="••••••••"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors">
                    <span className="material-symbols-outlined text-xl">{showPassword ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </div>
              </div>

              {!isRegister && (
                <div className="flex items-center">
                  <input className="w-4 h-4 text-primary border-zinc-300 rounded focus:ring-primary" id="remember" type="checkbox" />
                  <label className="ml-2 text-sm text-zinc-600" htmlFor="remember">Beni hatırla</label>
                </div>
              )}

              <button
                className="w-full bg-primary text-white py-3.5 rounded-xl font-bold shadow-lg shadow-primary/20 hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                type="submit"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                    {isRegister ? 'Kayıt Yapılıyor...' : 'Giriş Yapılıyor...'}
                  </>
                ) : (
                  <>
                    {isRegister ? 'Kayıt Ol' : 'Giriş Yap'}
                    <span className="material-symbols-outlined text-lg">arrow_forward</span>
                  </>
                )}
              </button>

              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-zinc-200"></div>
                <span className="flex-shrink mx-4 text-zinc-400 text-xs font-bold uppercase tracking-wider">veya</span>
                <div className="flex-grow border-t border-zinc-200"></div>
              </div>

              <div id="google-login-btn" className="w-full flex justify-center min-h-[44px]"></div>
            </form>
          )}

          <div className="mt-10 pt-8 border-t border-zinc-100 text-center">
            <p className="text-zinc-500 text-sm">
              {isRegister ? 'Zaten hesabınız var mı?' : "Stilsoft'ta yeni misiniz?"}
            </p>
            <button
              onClick={toggleMode}
              className="mt-4 w-full py-3 border-2 border-zinc-200 rounded-xl font-bold text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 active:scale-[0.98] transition-all text-sm"
              disabled={loading}
            >
              {isRegister ? 'Giriş Yap' : 'Yeni Hesap Oluştur'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
