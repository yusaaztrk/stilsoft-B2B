import { Eye, EyeOff } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, serviceOpsBaseUrl } from '../config/api'
import { isNativeShell, requestCredentialsNative, saveCredentialsNative } from '../native/credentials'
import { useLocation, useNavigate } from 'react-router-dom'
import { consumeHandover, readHandover } from '../auth/handover'

export default function LoginPage() {
  const navigate = useNavigate()

  /**
   * GİRİŞ EKRANI DA DEVRİ TÜKETİR.
   *
   * Devri yalnızca `RequireAuth` tüketiyordu; adres herhangi bir sebeple `/login`'e yönlenirse
   * (yer imi, eski bağlantı, korumalı sayfaya gitmeden gelen yönlendirme) parametreler burada
   * ölüyor ve serviste oturumu AÇIK olan kullanıcıya şifre soruluyordu. ServiceOps tarafı bunu
   * zaten yapıyordu, bayi tarafı yapmıyordu — kullanıcının bildirdiği "her seferinde şifre
   * istiyor" şikâyetinin ikinci yarısı buydu.
   */
  const [handover] = useState(() => readHandover())
  const [handingOver, setHandingOver] = useState(() => Boolean(readHandover()))
  const [handoverError, setHandoverError] = useState<string | null>(null)
  const serviceOpsUrl = `${serviceOpsBaseUrl()}/login`
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [tenants, setTenants] = useState<Array<{ code: string; name: string }>>([])
  const [tenantCode, setTenantCode] = useState<string>('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [logoOk, setLogoOk] = useState(true)

  const isHsaRoute = useMemo(() => {
    const p = location.pathname.toLowerCase()
    return p.includes('hsa') || p.includes('ssa') || p.includes('admin')
  }, [location.pathname])

  const [mode, setMode] = useState<'select' | 'tenant' | 'admin'>(() => {
    const p = (typeof window !== 'undefined' ? window.location.pathname : '').toLowerCase()
    return p.includes('hsa') || p.includes('ssa') || p.includes('admin') ? 'admin' : 'select'
  })

  useEffect(() => {
    if (isHsaRoute) {
      setMode('admin')
    } else {
      setMode((m) => (m === 'admin' ? 'select' : m))
    }
  }, [isHsaRoute])

  useEffect(() => {
    if (!handingOver || !handover) return

    const controller = new AbortController()

    void (async () => {
      try {
        const ok = await consumeHandover(handover, controller.signal)
        if (!ok) {
          setHandoverError('Servis oturumu aktarılamadı. Lütfen tekrar giriş yapın.')
          return
        }
        // replace: devir adresi geri tuşunun arkasında durmasın.
        navigate(LANDING_PATH, { replace: true })
      } catch {
        if (controller.signal.aborted) return
        setHandoverError('Servis oturumu aktarılamadı. Lütfen tekrar giriş yapın.')
      } finally {
        setHandingOver(false)
      }
    })()

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canSubmit = useMemo(() => username.trim().length > 0 && password.length > 0, [username, password])

  // Giriş sonrası HER ROL doğrudan /home'a gider.
  //
  // Eskiden `location.state.from` varsa oraya dönülüyordu: oturumu bir iç sayfada (ör. ayarlar)
  // düşen kullanıcı, giriş yapar yapmaz kendini o sayfada buluyordu. İstenmiyor — giriş her
  // zaman ana sayfada başlar.
  const LANDING_PATH = '/home'

  useEffect(() => {
    const authed = Boolean(localStorage.getItem('accessToken'))
    if (authed) {
      navigate('/home', { replace: true })
    }
  }, [navigate])

  const selectedTenant = useMemo(() => {
    const code = tenantCode.trim()
    if (!code) return null
    return tenants.find((t) => t.code === code) ?? null
  }, [tenantCode, tenants])

  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false)
  // Sabit numara kaldırıldı: sunucu OTP numarasını zaten kullanıcı kaydından alıyor,
  // buradaki değer yalnızca ekranda görünüyordu ve bir kişinin numarasını ifşa ediyordu.
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [otpError, setOtpError] = useState<string | null>(null)
  const [otpSuccessMsg, setOtpSuccessMsg] = useState<string | null>(null)

  const handleSendWhatsappOtp = async () => {
    try {
      setOtpLoading(true)
      setOtpError(null)
      setOtpSuccessMsg(null)
      const selectedTenantCode = mode === 'tenant' ? tenantCode.trim() : ''

      const res = await fetch(`${API_BASE_URL}/api/auth/send-whatsapp-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          tenantCode: selectedTenantCode || undefined,
          phone: whatsappPhone.trim()
        })
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'WhatsApp doğrulama kodu gönderilemedi.')
      }

      if (json?.phone) {
        setWhatsappPhone(String(json.phone))
      }

      setOtpSuccessMsg('WhatsApp doğrulama kodu telefonunuza başarıyla gönderildi!')
      setWhatsappModalOpen(true)
    } catch (err: any) {
      setError(getFriendlyError(err?.message))
    } finally {
      setOtpLoading(false)
    }
  }

  const handleVerifyWhatsappOtp = async () => {
    try {
      setOtpLoading(true)
      setOtpError(null)
      const selectedTenantCode = mode === 'tenant' ? tenantCode.trim() : ''

      const res = await fetch(`${API_BASE_URL}/api/auth/verify-whatsapp-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          tenantCode: selectedTenantCode || undefined,
          code: otpCode.trim()
        })
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Girdiğiniz WhatsApp doğrulama kodu hatalı.')
      }

      const data = json?.data
      const accessToken = String(data?.accessToken ?? '')
      const refreshToken = String(data?.refreshToken ?? '')
      const currentCode = String(data?.currentCode ?? data?.CurrentCode ?? '')
      const maybeName = String(data?.userName ?? data?.username ?? data?.fullName ?? data?.name ?? '')

      if (!accessToken) throw new Error('Access token alınamadı')

      localStorage.setItem('accessToken', accessToken)
      if (refreshToken) localStorage.setItem('refreshToken', refreshToken)
      if (currentCode.trim()) localStorage.setItem('currentCode', currentCode.trim())
      // "Personele Geç" düğmesi buna bakıyor. Yalnızca düğmenin GÖRÜNÜRLÜĞÜ için:
      // portalın kapısı kendi sunucusunda, bu değeri değiştirmek kimseyi içeri sokmaz.
      localStorage.setItem('employeeAccess', data?.employeeAccess ? '1' : '0')
      localStorage.setItem('asistanAccess', data?.asistanAccess ? '1' : '0')
      if (maybeName.trim()) {
        localStorage.setItem('userName', maybeName.trim())
        sessionStorage.setItem('userName', maybeName.trim())
      }

      if (selectedTenantCode) {
        localStorage.setItem('tenantCode', selectedTenantCode)
        if (selectedTenant?.name) localStorage.setItem('tenantName', selectedTenant.name)
      }

      setWhatsappModalOpen(false)
      navigate(LANDING_PATH, { replace: true })
    } catch (err: any) {
      setOtpError(getFriendlyError(err?.message))
    } finally {
      setOtpLoading(false)
    }
  }

  const canSubmitTenant = useMemo(() => {
    return username.trim().length > 0 && password.length > 0 && tenantCode.trim().length > 0
  }, [username, password, tenantCode])

  const canSubmitAdmin = useMemo(() => {
    return username.trim().length > 0 && password.length > 0
  }, [username, password])

  /*
    OTOMATİK GİRİŞ (yalnızca telefon uygulamasında).

    Teknisyen servisten "BAYİ'YE GEÇ" ile buraya geldiğinde parola soruluyordu; iki panel ayrı
    alan adı olduğu için servisteki oturum buraya taşınmıyor. Kabuk ilk girişteki bilgileri
    şifreli saklıyor ve burada geri veriyor.

    `denendi` işareti ŞART: giriş başarısız olursa ya da kabuk cevabı tekrar gönderirse
    sonsuz döngüye girer, kullanıcı yanlış parolayla sürekli deneyen bir ekranda kalırdı.
  */
  useEffect(() => {
    if (!isNativeShell()) return

    let denendi = false

    const onCredentials = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { tenantCode: string | null; username: string; password: string }
        | undefined
      if (!detail?.username || !detail?.password || denendi) return
      denendi = true

      setUsername(detail.username)
      setPassword(detail.password)
      if (detail.tenantCode) setTenantCode(detail.tenantCode)

      // Alanlar React durumuna yazılıyor; `submit` onları okuduğu için bir sonraki
      // boyamada çalıştırılmalı, yoksa eski (boş) değerlerle gönderilir.
      window.setTimeout(() => { void submit(detail) }, 0)
    }

    window.addEventListener('native:credentials', onCredentials)
    requestCredentialsNative()
    return () => window.removeEventListener('native:credentials', onCredentials)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (otomatik?: { tenantCode: string | null; username: string; password: string }) => {
    try {
      setLoading(true)
      setError(null)
      // Otomatik girişte değerler React durumuna daha yazılmamış olabilir; kabuktan gelenler
      // doğrudan kullanılır.
      const girisKullanici = (otomatik?.username ?? username).trim()
      const girisParola = otomatik?.password ?? password
      const selectedTenantCode = otomatik
        ? (otomatik.tenantCode ?? '').trim()
        : (mode === 'tenant' ? tenantCode.trim() : '')

      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: girisKullanici,
          password: girisParola,
          tenantCode: selectedTenantCode || undefined
        })
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Giriş başarısız.')
      }

      const data = json?.data
      const accessToken = String(data?.accessToken ?? '')
      const refreshToken = String(data?.refreshToken ?? '')
      const currentCode = String(data?.currentCode ?? data?.CurrentCode ?? '')
      const maybeName = String(data?.userName ?? data?.username ?? data?.title ?? data?.fullName ?? data?.name ?? '')

      if (!accessToken) throw new Error('Access token alınamadı')

      localStorage.setItem('accessToken', accessToken)
      if (refreshToken) localStorage.setItem('refreshToken', refreshToken)
      if (currentCode.trim()) localStorage.setItem('currentCode', currentCode.trim())
      // "Personele Geç" düğmesi buna bakıyor. Yalnızca düğmenin GÖRÜNÜRLÜĞÜ için:
      // portalın kapısı kendi sunucusunda, bu değeri değiştirmek kimseyi içeri sokmaz.
      localStorage.setItem('employeeAccess', data?.employeeAccess ? '1' : '0')
      localStorage.setItem('asistanAccess', data?.asistanAccess ? '1' : '0')
      if (maybeName.trim()) {
        localStorage.setItem('userName', maybeName.trim())
        sessionStorage.setItem('userName', maybeName.trim())
      }

      if (selectedTenantCode) {
        localStorage.setItem('tenantCode', selectedTenantCode)
        if (selectedTenant?.name) localStorage.setItem('tenantName', selectedTenant.name)
      }

      /*
        Telefon kabuğuna bilgileri BAŞARILI giriş sonrası veriyoruz; bir dahaki giriş
        ekranında (burada ya da serviste) kendisi dolduruyor. Tarayıcıda bu çağrı hiçbir şey
        yapmaz, parola hiçbir yere yazılmaz.
      */
      saveCredentialsNative({
        tenantCode: selectedTenantCode || null,
        username: girisKullanici,
        password: girisParola,
      })

      navigate(LANDING_PATH, { replace: true })
    } catch (err: any) {
      setError(getFriendlyError(err?.message))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
      ; (async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/api/tenants/public`, { signal: controller.signal })
          if (!res.ok) return
          const json = await res.json().catch(() => null)
          const data = Array.isArray(json?.data) ? json.data : []
          const mapped = data
            .map((x: any) => ({
              code: String(x?.code ?? '').trim(),
              name: String(x?.name ?? '').trim()
            }))
            .filter((x: any) => x.code)
          setTenants(mapped)
        } catch {
        }
      })()
    return () => controller.abort()
  }, [])

  const getFriendlyError = (input: unknown) => {
    const msg = typeof input === 'string' ? input : ''
    const trimmed = msg.trim()
    if (!trimmed) return 'Giriş sırasında hata oluştu'
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const j = JSON.parse(trimmed)
        const m = j?.message || j?.error || j?.title
        if (typeof m === 'string' && m.trim()) return m.trim()
      } catch {
        return 'Giriş başarısız'
      }
      return 'Giriş başarısız'
    }
    return trimmed
  }

  // Devir sürerken form GÖSTERİLMEZ: bir kare bile olsa giriş ekranını görmek, kullanıcıya
  // oturumunun düştüğünü düşündürüyor ve şifresini yazmaya başlıyor.
  if (handingOver && !handoverError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm font-medium text-slate-500">Oturum aktarılıyor…</div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black flex items-center justify-center font-outfit">
      <style dangerouslySetInnerHTML={{
        __html: `
        @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Dancing+Script:wght@700&family=Montserrat:wght@400;500;600;700&family=Outfit:wght@400;500;700;900&family=Space+Grotesk:wght@700;900&display=swap');
        .font-outfit { font-family: 'Outfit', sans-serif; }
        .font-montserrat { font-family: 'Montserrat', sans-serif; }
        .font-stilsoft { font-family: 'Space Grotesk', 'Outfit', sans-serif; }
        .loading-handwriting { font-family: 'Caveat', 'Dancing Script', cursive; }
        @keyframes organicBlob1 {
          0% { transform: translate(-5vw, -5vh) scale(1) rotate(0deg); }
          25% { transform: translate(45vw, 10vh) scale(1.3) rotate(90deg); }
          50% { transform: translate(40vw, 45vh) scale(0.85) rotate(180deg); }
          75% { transform: translate(-2vw, 50vh) scale(1.2) rotate(270deg); }
          100% { transform: translate(-5vw, -5vh) scale(1) rotate(360deg); }
        }
        @keyframes organicBlob2 {
          0% { transform: translate(50vw, 45vh) scale(1.1); }
          30% { transform: translate(5vw, 40vh) scale(0.9); }
          65% { transform: translate(25vw, 2vh) scale(1.25); }
          100% { transform: translate(50vw, 45vh) scale(1.1); }
        }
        .animate-organic-orb-1 {
          animation: organicBlob1 12s ease-in-out infinite alternate;
        }
        .animate-organic-orb-2 {
          animation: organicBlob2 9s ease-in-out infinite alternate;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.2s ease-in-out 0s 2; }
      `}} />

      {/* Organic Roaming Red Glow Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none z-0">
        {/* Main Roaming Red Creature Orb */}
        <div className="absolute top-0 left-0 w-[550px] h-[550px] rounded-full bg-gradient-to-tr from-red-500/45 via-red-600/35 to-red-500/25 blur-[95px] animate-organic-orb-1 opacity-95" />
        {/* Secondary Roaming Counter Orb */}
        <div className="absolute top-0 left-0 w-[450px] h-[450px] rounded-full bg-gradient-to-br from-red-600/40 via-red-500/30 to-red-600/20 blur-[80px] animate-organic-orb-2 opacity-90" />
        {/* Ambient Pure Red Radial Base Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[750px] h-[750px] rounded-full bg-red-600/20 blur-[140px]" />
      </div>

      <div className="relative z-10 w-full max-w-[1100px] flex items-center justify-between px-6 lg:px-12">
        {/* Left Side: Brand Identity */}
        <div className="hidden lg:flex flex-col w-1/2 pr-12">
          <div className="flex items-baseline gap-2 mb-6 select-none">
            <span className="text-white text-6xl font-black tracking-tighter leading-none italic uppercase">STILSOFT</span>
            <span className="loading-handwriting text-white text-5xl font-extrabold tracking-wide transform -rotate-3 select-none">
              bayi
            </span>
          </div>
          <p className="text-white/40 text-lg font-medium max-w-sm leading-relaxed">
            Kurumsal B2B Platformuna hoş geldiniz. Siparişlerinizi, ödemelerinizi ve cari ekstrelerinizi yönetin.
          </p>
        </div>

        {/* Right Side: Glassmorphic Login Form */}
        <div className="w-full lg:w-[460px]">
          <div className="backdrop-blur-2xl bg-white/[0.03] border border-white/10 rounded-[32px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] p-8 sm:p-10 flex flex-col">

            {/* Mobile Header Branding */}
            <div className="lg:hidden flex items-baseline justify-center gap-1.5 mb-10 select-none">
              <span className="text-white text-3xl font-black tracking-tighter leading-none italic uppercase">STILSOFT</span>
              <span className="loading-handwriting text-white text-3xl font-extrabold tracking-wide transform -rotate-3">
                bayi
              </span>
            </div>

            <div className="mb-6">
              <h2 className="text-xl font-bold text-white mb-1.5">
                {mode === 'admin' ? 'Yönetim Girişi' : mode === 'tenant' ? 'Giriş Yap' : 'Firma Seçin'}
              </h2>
              <p className="text-white/40 text-xs">
                {mode === 'select' ? 'Devam etmek için firmanızı seçin.' : 'Hesabınıza erişmek için bilgilerinizi girin.'}
              </p>
            </div>

            {mode === 'select' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[220px] overflow-y-auto pr-1 no-scrollbar">
                  {tenants.map((t) => (
                    <button
                      key={t.code}
                      type="button"
                      onClick={() => {
                        setTenantCode(t.code)
                        setMode('tenant')
                        setError(null)
                        setUsername('')
                        setPassword('')
                      }}
                      className="text-left group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] transition duration-200"
                    >
                      <div className="p-3.5 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-white font-extrabold text-sm flex-shrink-0">
                          {String(t.name || t.code).trim().slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{t.name}</div>
                          <div className="text-[10px] font-medium text-white/40 truncate mt-0.5">{t.code}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {tenants.length === 0 && (
                  <div className="text-xs text-white/40">Firma listesi yükleniyor...</div>
                )}
              </div>
            )}

            {(mode === 'tenant' || mode === 'admin') && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const ok = mode === 'tenant' ? canSubmitTenant : canSubmitAdmin
                  if (!ok) return
                  void submit()
                }}
                className="space-y-5"
              >
                {mode === 'tenant' && (
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('select')
                        setError(null)
                        setUsername('')
                        setPassword('')
                      }}
                      className="text-[10px] font-bold text-white/60 hover:text-white transition"
                    >
                      ← Firma değiştir
                    </button>
                    <div className="text-[10px] font-medium text-white/40 truncate max-w-[200px]">
                      {selectedTenant?.name} ({tenantCode})
                    </div>
                  </div>
                )}

                {mode === 'admin' && (
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('select')
                        setError(null)
                        setUsername('')
                        setPassword('')
                      }}
                      className="text-[10px] font-bold text-white/60 hover:text-white transition"
                    >
                      ← Firma Girişine Dön
                    </button>
                    <div className="text-[10px] font-bold text-red-400 tracking-wider uppercase">
                      Global SSA
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-white/50 uppercase tracking-[0.1em] ml-1">Kullanıcı Adı</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-2xl h-12 px-5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20 transition-all placeholder:text-white/20"
                    data-no-capitalize="true"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Kullanıcı adınızı girin"
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-white/50 uppercase tracking-[0.1em] ml-1">Şifre</label>
                  <div className="relative">
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyUp={(e) => {
                        const caps = e.getModifierState?.('CapsLock')
                        setCapsLockOn(Boolean(caps))
                      }}
                      type={showPassword ? 'text' : 'password'}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-2xl h-12 px-5 pr-12 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20 transition-all placeholder:text-white/20"
                      data-no-capitalize="true"
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="pt-2 space-y-2.5">
                  <button
                    type="submit"
                    disabled={(mode === 'tenant' ? !canSubmitTenant : !canSubmitAdmin) || loading}
                    className={
                      'w-full h-12 rounded-2xl font-bold text-sm transition-all duration-300 ' +
                      (((mode === 'tenant' ? canSubmitTenant : canSubmitAdmin) && !loading)
                        ? 'bg-white text-black hover:bg-white/90 shadow-[0_8px_30px_rgba(255,255,255,0.15)] hover:scale-[1.01] active:scale-[0.99]'
                        : 'bg-white/5 text-white/30 cursor-not-allowed border border-white/5')
                    }
                  >
                    {loading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
                  </button>

                  <button
                    type="button"
                    onClick={handleSendWhatsappOtp}
                    disabled={(mode === 'tenant' ? !canSubmitTenant : !canSubmitAdmin) || otpLoading}
                    className={
                      'w-full h-11 rounded-2xl font-bold text-xs transition-all duration-300 flex items-center justify-center gap-2 border ' +
                      (((mode === 'tenant' ? canSubmitTenant : canSubmitAdmin) && !otpLoading)
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 active:scale-[0.99]'
                        : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed')
                    }
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    {otpLoading ? 'WhatsApp Kodu Gönderiliyor...' : 'WhatsApp ile Kodu Gönder & Giriş Yap'}
                  </button>
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 text-xs font-semibold text-red-400 text-center animate-shake">
                    {error}
                  </div>
                )}
              </form>
            )}
            <div className="mt-6 pt-4 border-t border-white/5 text-center">
              <a
                href={serviceOpsUrl}
                className="text-[11px] font-bold text-white/50 hover:text-white transition-colors"
              >
                Servis Girişi →
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* WhatsApp OTP Modal */}
      {whatsappModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-md bg-slate-900 border border-emerald-500/30 rounded-3xl p-6 sm:p-8 text-white shadow-[0_0_50px_rgba(16,185,129,0.2)]">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-xl font-bold">
                  💬
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-white">WhatsApp Doğrulama Kodu</h3>
                  <p className="text-xs text-white/50">+{whatsappPhone} numarasına gönderildi</p>
                </div>
              </div>
              <button
                onClick={() => setWhatsappModalOpen(false)}
                className="text-white/40 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            {otpSuccessMsg && (
              <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5 text-xs font-semibold text-emerald-300 text-center">
                {otpSuccessMsg}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1.5 ml-1">6 Haneli WhatsApp Kodu</label>
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="• • • • • •"
                  autoFocus
                  className="w-full bg-white/[0.05] border border-emerald-500/40 rounded-2xl h-14 text-center text-2xl font-black tracking-[0.4em] text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>

              {otpError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 text-xs font-semibold text-red-400 text-center">
                  {otpError}
                </div>
              )}

              <button
                type="button"
                onClick={handleVerifyWhatsappOtp}
                disabled={otpCode.trim().length === 0 || otpLoading}
                className="w-full h-12 rounded-2xl font-extrabold text-sm bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all disabled:opacity-50"
              >
                {otpLoading ? 'Doğrulanıyor...' : 'Kodu Doğrula ve Giriş Yap'}
              </button>

              <button
                type="button"
                onClick={handleSendWhatsappOtp}
                disabled={otpLoading}
                className="w-full text-center text-xs font-bold text-white/40 hover:text-white transition py-1"
              >
                Kodu Tekrar Gönder
              </button>
            </div>
          </div>
        </div>
      )}

      {capsLockOn && (
        <div className="fixed bottom-6 left-6 backdrop-blur-md bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-xs font-bold text-white/80 shadow-2xl animate-bounce">
          ⚠️ Caps Lock Açık
        </div>
      )}

      {/* Bottom Footer Signature aligned with main content width */}
      <div className="fixed bottom-0 left-0 right-0 w-full flex justify-center z-30 select-none pointer-events-none">
        <div className="w-full max-w-[1100px] px-6 lg:px-12 flex justify-end">
          <a
            href="https://stilsoft.com.tr"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white border-t border-x border-gray-200 py-1.5 px-6 rounded-t-2xl shadow-[0_-4px_25px_rgba(0,0,0,0.15)] pointer-events-auto flex flex-col items-end leading-none transition-all hover:bg-slate-50 hover:shadow-[0_-6px_30px_rgba(0,0,0,0.2)] active:scale-95 group cursor-pointer"
          >
            <div className="flex items-baseline gap-1">
              <span className="font-montserrat font-semibold text-xs sm:text-sm text-gray-900 tracking-tight">made</span>
              <span className="loading-handwriting text-xl sm:text-2xl text-red-600 font-extrabold italic transition-transform group-hover:scale-110">by</span>
            </div>
            <span className="font-stilsoft font-black text-sm sm:text-base text-black tracking-widest uppercase -mt-1 sm:-mt-1.5">
              STILSOFT
            </span>
          </a>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />
    </div>
  )
}
