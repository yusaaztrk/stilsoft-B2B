import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { login } from '../api/auth'
import { setSession } from '../auth/storage'
import { API_BASE_URL, b2bBaseUrl } from '../config'
import { isNativeShell, requestCredentialsNative, saveCredentialsNative } from '../native/bridge'

/**
 * The firm chosen last time. Coming back from B2B put every user through the firm picker again
 * even though they had just signed in, so the choice is remembered and pre-selected; the picker
 * is still one click away via "Firma değiştir".
 */
const LAST_TENANT_KEY = 'serviceOpsLastTenant'

type LoginPageProps = {
  /**
   * Renders the management (SSA) entry served at /yonetim: no firm picker, since a super admin
   * signs in above the firms rather than into one. Reaching it by typing 'ssa' into the normal
   * form still works — this only gives it an address of its own instead of leaving it as
   * undiscoverable knowledge.
   */
  managementEntry?: boolean
}

export default function LoginPage({ managementEntry = false }: LoginPageProps) {
  const navigate = useNavigate()
  const erpUrl = `${b2bBaseUrl()}/login`

  // Whether this page was reached carrying a B2B session. Read once, synchronously, before
  // the first paint: deciding this in an effect let the firm picker render for a frame and
  // the user saw a login screen they should never have been shown.
  // Ölçüt token + firma; `sync_username` aranmıyor — sebebi RequireAuth'ta yazılı (kullanıcı
  // adı bazı giriş yollarında hiç yazılmıyor ve devir sessizce iptal oluyordu).
  const [handingOver] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return Boolean((p.get('sync_token') ?? '').trim() && (p.get('sync_tenant') ?? '').trim())
  })

  // RequireAuth consumes the handover on protected routes, but anything that lands here
  // first — a redirect, a bookmarked /login, a link that kept the params — reached the form
  // instead and asked a signed-in user to sign in again.
  const [handoverError, setHandoverError] = useState<string | null>(null)

  useEffect(() => {
    if (!handingOver) return

    const params = new URLSearchParams(window.location.search)
    const controller = new AbortController()

    void (async () => {
      try {
        // The B2B token is never stored as a session here: the two APIs sign with different
        // keys, so it would be rejected on the first request and bounce the user straight
        // back to this screen. It is exchanged for a token this API issued itself.
        const res = await fetch(`${API_BASE_URL}/api/auth/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: params.get('sync_token'),
            tenantCode: params.get('sync_tenant')
          }),
          signal: controller.signal
        })

        const json = await res.json().catch(() => null)

        if (!res.ok || !json?.accessToken) {
          setHandoverError(json?.message || 'Oturum aktarılamadı. Lütfen tekrar giriş yapın.')
          return
        }

        setSession(json.accessToken, json.tenantCode, json.username, {
          role: json.role || undefined,
          technicianId: params.get('sync_technicianId') || undefined,
          dealerCode: params.get('sync_dealerCode') || undefined
        })

        // "Personele Geç" düğmesinin görünürlüğü. Devirle GELEN bayrak yazılır; devirsiz
        // (şifreyle) giren teknisyende bu anahtar hiç oluşmaz ve düğme çıkmaz. Bayrak yalnızca
        // GÖSTERİM içindir — gerçek kapı portalın kendi `EmployeeAccess` denetimi.
        try {
          localStorage.setItem('employeeAccess', params.get('sync_employeeAccess') === '1' ? '1' : '0')
        } catch {
          // localStorage kapali: dugme gizli kalir, islev kaybi yok.
        }

        // replace, not push: the handover URL must not sit in history behind a Back press.
        navigate('/', { replace: true })
      } catch (e) {
        if (controller.signal.aborted) return
        setHandoverError('Oturum aktarılamadı. Lütfen tekrar giriş yapın.')
      }
    })()

    return () => controller.abort()
  }, [handingOver, navigate])

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [tenants, setTenants] = useState<Array<{ code: string; name: string }>>([])
  const [tenantCode, setTenantCode] = useState<string>(() =>
    managementEntry ? '' : localStorage.getItem(LAST_TENANT_KEY) || ''
  )
  const [tenantQuery, setTenantQuery] = useState('')
  const [tenantsLoading, setTenantsLoading] = useState(false)
  const [tenantsError, setTenantsError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)

  // Management skips the picker outright; a returning user resumes at the firm they last used.
  const [mode, setMode] = useState<'select' | 'tenant'>(() => {
    if (managementEntry) return 'tenant'
    return localStorage.getItem(LAST_TENANT_KEY) ? 'tenant' : 'select'
  })

  /**
   * GİRİŞİ YAPAN TEK YOL.
   *
   * Form da otomatik giriş de burayı çağırıyor. Ayrı iki kopya olsaydı biri değişip diğeri
   * kalınca telefon ile tarayıcı farklı davranırdı.
   */
  const performLogin = async (creds: { tenantCode: string; username: string; password: string }) => {
    setLoading(true)
    setError(null)
    try {
      const result = await login(creds)

      setSession(result.accessToken, result.tenantCode, result.username, {
        userId: result.user.id,
        role: result.user.role,
        technicianId: result.user.technicianId,
        dealerCode: result.user.dealerCode,
      })

      if (!managementEntry && result.tenantCode) {
        localStorage.setItem(LAST_TENANT_KEY, result.tenantCode)
      }

      /*
        Telefon kabuğuna bilgileri BAŞARILI giriş sonrası veriyoruz.

        Teknisyen servisten bayiye geçtiğinde bayi alan adının kendi oturumu olmadığı için
        parola soruluyordu; kabuk bilgiyi şifreli saklayıp bir dahaki giriş ekranında geri
        veriyor. Tarayıcıda bu çağrı hiçbir şey yapmaz (kabuk yok), yani masaüstünde parola
        hiçbir yere yazılmaz.
      */
      saveCredentialsNative({
        tenantCode: creds.tenantCode || null,
        username: creds.username,
        password: creds.password,
      })

      navigate('/', { replace: true })
    } catch (err: any) {
      setError(String(err?.message ?? 'Giriş başarısız'))
      // Kayıtlı bilgiyle denenip başarısız olduysa alanlar dolu kalır ve kullanıcı parolayı
      // düzeltip gönderebilir. Kaydı burada SİLMİYORUZ: hata ağ kaynaklı da olabilir.
    } finally {
      setLoading(false)
    }
  }

  /*
    OTOMATİK GİRİŞ (yalnızca telefon uygulamasında).

    Kabuk kayıtlı bilgiyi gönderiyor; alanlar doldurulup giriş bir kez deneniyor.
    `denendi` işareti ŞART: cevap birden fazla gelirse (kabuk yeniden enjekte ederse) ya da
    giriş başarısız olursa sonsuz döngüye girerdi — kullanıcı yanlış parolayla sonsuza kadar
    denenen bir ekranda kalırdı.
  */
  useEffect(() => {
    if (!isNativeShell() || handingOver) return

    let denendi = false

    const onCredentials = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { tenantCode: string | null; username: string; password: string }
        | undefined
      if (!detail?.username || !detail?.password || denendi) return
      denendi = true

      setUsername(detail.username)
      setPassword(detail.password)
      if (detail.tenantCode) {
        setTenantCode(detail.tenantCode)
        setMode('tenant')
      }

      void performLogin({
        tenantCode: detail.tenantCode || '',
        username: detail.username,
        password: detail.password,
      })
    }

    window.addEventListener('native:credentials', onCredentials)
    requestCredentialsNative()
    return () => window.removeEventListener('native:credentials', onCredentials)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handingOver])

  const canSubmit = useMemo(() => {
    // A super admin authenticates above the firms, so no firm has been picked to require.
    if (managementEntry || username.trim().toLowerCase() === 'ssa') {
      return Boolean(username.trim() && password)
    }
    return Boolean(tenantCode.trim() && username.trim() && password)
  }, [managementEntry, tenantCode, username, password])

  const selectedTenant = useMemo(() => {
    const code = tenantCode.trim()
    if (!code) return null
    return tenants.find((t) => t.code === code) ?? null
  }, [tenantCode, tenants])

  const filteredTenants = useMemo(() => {
    const q = tenantQuery.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter((t) => `${t.code} ${t.name}`.toLowerCase().includes(q))
  }, [tenantQuery, tenants])

  const loadTenants = async (signal?: AbortSignal) => {
    setTenantsLoading(true)
    setTenantsError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/tenants/public`, { signal })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(t || `Firma listesi alınamadı (${res.status})`)
      }
      const json = await res.json().catch(() => null)
      const data = Array.isArray(json?.data) ? json.data : []
      const mapped = data
        .map((x: any) => ({
          code: String(x?.code ?? '').trim(),
          name: String(x?.name ?? '').trim()
        }))
        .filter((x: any) => x.code)
      setTenants(mapped)
    } catch (e: any) {
      if (String(e?.name ?? '') === 'AbortError') return
      setTenantsError(String(e?.message ?? 'Firma listesi alınamadı'))
    } finally {
      setTenantsLoading(false)
    }
  }

  useEffect(() => {
    // The firm list only exists to be chosen from, so a handover in flight does not need it.
    // Once a handover has failed the form is what the user sees, and it is useless without
    // the list — skipping it there left them staring at "Firma bulunamadı".
    if (handingOver && !handoverError) return
    // Management never picks a firm, so the list is dead weight on that screen.
    if (managementEntry) return

    const controller = new AbortController()
    void loadTenants(controller.signal)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handingOver, handoverError, managementEntry])

  // A handover is in flight: the session is already known, so the firm picker and the login
  // form are both wrong answers. Nothing here waits on the tenant list — that request is what
  // made the picker appear "slow", and it is not needed to sign this user in.
  // A failed handover falls through to the normal form rather than stranding the user on a
  // spinner: signing in by hand still works.
  if (handingOver && !handoverError) {
    return (
      <div className="relative min-h-[100dvh] w-full overflow-hidden bg-black flex items-center justify-center font-outfit">
        <style dangerouslySetInnerHTML={{
          __html: `
          @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Dancing+Script:wght@700&family=Outfit:wght@400;500;700;900&display=swap');
          .font-outfit { font-family: 'Outfit', sans-serif; }
          @keyframes floatingGlow {
            0%, 100% { transform: translate(0px, 0px) scale(1); }
            33% { transform: translate(120px, 80px) scale(1.15); }
            66% { transform: translate(-80px, 120px) scale(0.9); }
          }
          .animate-floating-glow {
            animation: floatingGlow 12s infinite ease-in-out;
          }
        `}} />
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/3 w-[30rem] h-[30rem] bg-red-600/10 rounded-full blur-[130px] animate-floating-glow" />
        </div>
        <div className="relative z-10 flex flex-col items-center gap-5">
          <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-white animate-spin" />
          <div className="text-center">
            <div className="text-white/90 text-sm font-semibold">Oturum aktarılıyor</div>
            <div className="text-white/40 text-xs mt-1">Servis portalına yönlendiriliyorsunuz…</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-black flex items-center justify-center font-outfit login-page">
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
          <div className="flex items-baseline gap-2 mb-6">
            <span className="text-white text-6xl font-black tracking-tighter leading-none italic uppercase">STILSOFT</span>
            <span className="loading-handwriting text-white text-5xl font-extrabold tracking-wide transform -rotate-3 select-none">
              servis
            </span>
          </div>
          <p className="text-white/40 text-lg font-medium max-w-sm leading-relaxed">
            Servis portalına hoş geldiniz. İşlerinizi, montaj ve atölye kayıtlarınızı yönetin.
          </p>
        </div>

        {/* Right Side: Glassmorphic Login Form */}
        <div className="w-full lg:w-[460px]">
          <div className="backdrop-blur-2xl bg-white/[0.03] border border-white/10 rounded-[32px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] p-8 sm:p-10 flex flex-col">

            {/* Mobile Header Branding */}
            <div className="lg:hidden flex items-baseline justify-center gap-1.5 mb-10 select-none">
              <span className="text-white text-3xl font-black tracking-tighter leading-none italic uppercase">STILSOFT</span>
              <span className="loading-handwriting text-white text-3xl font-extrabold tracking-wide transform -rotate-3">
                servis
              </span>
            </div>

            <div className="mb-6">
              <h2 className="text-xl font-bold text-white mb-1.5">
                {managementEntry ? 'Yönetim Girişi' : mode === 'tenant' ? 'Giriş Yap' : 'Firma Seçin'}
              </h2>
              <p className="text-white/40 text-xs">
                {managementEntry
                  ? 'Sistem yöneticisi bilgilerinizle devam edin.'
                  : mode === 'tenant'
                    ? 'Hesabınıza erişmek için bilgilerinizi girin.'
                    : 'Devam etmek için firmanızı seçin.'}
              </p>
            </div>

            {mode === 'select' && (
              <div className="space-y-4">
                <div>
                  <input
                    value={tenantQuery}
                    onChange={(e) => setTenantQuery(e.target.value)}
                    placeholder="Firma ara (kod / isim)"
                    className="w-full bg-white/[0.04] border border-white/10 rounded-2xl h-12 px-5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20 transition-all placeholder:text-white/20"
                  />
                </div>

                {tenantsError ? (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3 text-xs font-semibold text-red-300">
                    <div>{tenantsError}</div>
                    <button
                      type="button"
                      onClick={() => void loadTenants()}
                      className="mt-2 inline-flex h-9 items-center justify-center px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white text-xs font-extrabold transition"
                    >
                      Tekrar Dene
                    </button>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[220px] overflow-y-auto pr-1 no-scrollbar">
                  {filteredTenants.map((t) => (
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

                {tenantsLoading ? (
                  <div className="text-xs text-white/40">Firma listesi yükleniyor...</div>
                ) : tenants.length === 0 && !tenantsError ? (
                  <div className="text-xs text-white/40">Firma bulunamadı.</div>
                ) : filteredTenants.length === 0 && !tenantsError ? (
                  <div className="text-xs text-white/40">Firma bulunamadı.</div>
                ) : null}

                {/*
                  Yönetim girişinin görünür tek yolu bu. Adres (/yonetim) tek başına keşfedilebilir
                  değil: bağlantı olmadan oraya yalnızca URL'yi ezbere bilen ulaşır. Firma
                  kartlarının yanında durmasın diye bilinçli olarak sessiz bırakıldı.
                */}
                <div className="pt-2 text-center">
                  <Link
                    to="/yonetim"
                    className="text-[10px] font-bold text-white/30 hover:text-white/70 transition"
                  >
                    Yönetim Girişi →
                  </Link>
                </div>
              </div>
            )}

            {mode === 'tenant' && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!canSubmit) return
                  // Tek giriş yolu `performLogin`. Eskiden bu gövde login()'i kendisi
                  // çağırıyordu; otomatik giriş eklenince iki kopya olacaktı.
                  await performLogin({ tenantCode, username, password })
                }}
                className="space-y-5"
              >
                <div className="flex items-center justify-between gap-3">
                  {managementEntry ? (
                    <Link to="/login" className="text-[10px] font-bold text-white/60 hover:text-white transition">
                      ← Normal giriş
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        // Forget the remembered firm too, otherwise the next visit would drop
                        // the user straight back into the one they just asked to leave.
                        localStorage.removeItem(LAST_TENANT_KEY)
                        setTenantCode('')
                        setMode('select')
                        setError(null)
                        setUsername('')
                        setPassword('')
                      }}
                      className="text-[10px] font-bold text-white/60 hover:text-white transition"
                    >
                      ← Firma değiştir
                    </button>
                  )}
                  <div className="text-[10px] font-medium text-white/40 truncate max-w-[200px]">
                    {/*
                      Yalnızca /yonetim adresinde yazar. Normal girişte kullanıcı adına bakılmaz:
                      'ssa' yazan herkese "böyle bir hesap var" demek oluyordu.
                    */}
                    {managementEntry ? 'Süper Sistem Yöneticisi' : `${selectedTenant?.name || ''} (${tenantCode})`}
                  </div>
                </div>

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

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={!canSubmit || loading}
                    className={
                      'w-full h-12 rounded-2xl font-bold text-sm transition-all duration-300 ' +
                      ((canSubmit && !loading)
                        ? 'bg-white text-black hover:bg-white/90 shadow-[0_8px_30px_rgba(255,255,255,0.15)] hover:scale-[1.01] active:scale-[0.99]'
                        : 'bg-white/5 text-white/30 cursor-not-allowed border border-white/5')
                    }
                  >
                    {loading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
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
                href={erpUrl}
                className="text-[11px] font-bold text-white/50 hover:text-white transition-colors"
              >
                Bayi Girişi →
              </a>
            </div>
          </div>
        </div>
      </div>

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
