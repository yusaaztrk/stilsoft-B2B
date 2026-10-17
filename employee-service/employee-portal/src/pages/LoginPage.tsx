import { Eye, EyeOff } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { storeSessionPermissions } from '../utils/portalPermissions'
import { API_BASE_URL, ERP_API_BASE_URL, ERP_API_ENABLED } from '../config/api'
import { useLocation, useNavigate } from 'react-router-dom'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // Kullanıcı adı hatırlanır: personel telefonundan her vardiyada giriş yapıyor, uzun
  // kullanıcı adını tekrar tekrar yazmak zorunda kalmasın. Şifre ASLA saklanmaz.
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem('lastUsername') ?? '' } catch { return '' }
  })
  const [password, setPassword] = useState('')
  const [loginAs, setLoginAs] = useState<'employee' | 'admin'>('admin')
  const [tenants, setTenants] = useState<Array<{ code: string; name: string }>>([])
  const [tenantCode, setTenantCode] = useState<string>('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [logoOk, setLogoOk] = useState(true)

  const [mode, setMode] = useState<'select' | 'tenant'>('select')

  const canSubmit = useMemo(() => username.trim().length > 0 && password.length > 0, [username, password])
  const from = (location.state as any)?.from

  const selectedTenant = useMemo(() => {
    const code = tenantCode.trim()
    if (!code) return null
    return tenants.find((t) => t.code === code) ?? null
  }, [tenantCode, tenants])

  const canSubmitTenant = useMemo(() => {
    return username.trim().length > 0 && password.length > 0 && tenantCode.trim().length > 0
  }, [username, password, tenantCode])

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

  const [tenantsLoading, setTenantsLoading] = useState(true)
  const [manualTenantInput, setManualTenantInput] = useState(false)
  const [manualCode, setManualCode] = useState('')

  const fetchTenants = async () => {
    try {
      setTenantsLoading(true)
      // Bayi API'si yayında değilse ona ait yollar listeden düşer: ölü adrese gidip 4 sn
      // zaman aşımı beklemek giriş ekranını sebepsiz yavaşlatıyordu.
      const endpoints = [
        `${API_BASE_URL}/api/EmployeePortalAuth/tenants`,
        ...(ERP_API_ENABLED ? [`${ERP_API_BASE_URL}/api/tenants/public-employees`] : []),
        `${API_BASE_URL}/api/tenants/public-employees`,
        ...(ERP_API_ENABLED ? [`${ERP_API_BASE_URL}/api/tenants/public-dealers`] : []),
        `/api/tenants/public-employees`
      ]


      for (const endpoint of endpoints) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 4000)
          const res = await fetch(endpoint, { signal: controller.signal })
          clearTimeout(timeoutId)
          if (res.ok) {
            const json = await res.json().catch(() => null)
            const data = Array.isArray(json?.data) ? json.data : []
            const mapped = data
              .map((x: any) => ({
                code: String(x?.code ?? '').trim(),
                name: String(x?.name ?? '').trim()
              }))
              .filter((x: any) => x.code)
            if (mapped.length > 0) {
              setTenants(mapped)
              setTenantsLoading(false)
              return
            }
          }
        } catch {
          // try next endpoint
        }
      }
    } finally {
      setTenantsLoading(false)
    }
  }

  useEffect(() => {
    void fetchTenants()
  }, [])

  // ERP'deki "Personele Geç" düğmesi firma kodunu `?tenant=` ile taşır: kullanıcı zaten
  // bir firmada oturum açmışken burada aynı firmayı tekrar seçmek zorunda kalmasın.
  // Adres firmayı yalnızca SEÇER; hangi firmanın verisini göreceği girişte imzalanan
  // token'dan gelir, bu parametreden değil.
  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get('tenant')
    const code = String(fromUrl ?? '').trim().toUpperCase()
    if (!code) return
    setTenantCode(code)
    setMode('tenant')
  }, [location.search])

  /**
   * OTURUM DEVRİ (ERP → portal).
   *
   * ERP'deki "Personele Geç" düğmesi `sync_token` taşır. Token burada doğrudan KULLANILMAZ:
   * `exchange` ucunda doğrulanıp portalın kendi token'ına çevrilir ve o token ERP oturumunun
   * bitiş anını devralır. Böylece portal ayrı, sınırsız bir oturum açmaz.
   *
   * Ham ERP token'ı ayrıca saklanır: portaldaki "Servise Geç" düğmesi onu ServiceOps'a
   * aynen iletir (ServiceOps devri ERP imzası bekler, portal imzasını tanımaz).
   *
   * Devir başarısızsa giriş formu açılır ve sebep gösterilir — sessizce boş ekran değil.
   */
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const token = String(params.get('sync_token') ?? '').trim()
    if (!token) return

    const tenant = String(params.get('sync_tenant') ?? params.get('tenant') ?? '').trim().toUpperCase()
    let cancelled = false

    const stripHandover = () => {
      const url = new URL(window.location.href)
      for (const key of ['sync_token', 'sync_tenant', 'sync_username']) url.searchParams.delete(key)
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }

    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`${API_BASE_URL}/api/EmployeePortalAuth/exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(tenant ? { 'X-Tenant-Code': tenant } : {})
          },
          body: JSON.stringify({ token, tenantCode: tenant ? tenant : undefined })
        })

        const json = await res.json().catch(() => null)
        const data = json?.data
        const accessToken = String(data?.accessToken ?? '')

        if (!res.ok || !accessToken) {
          /*
            BAŞARISIZLIKTA ADRES TEMİZLENMEZ.

            İlk sürüm burada da temizliyordu; sonuç, ekranda sebebi olmayan boş bir giriş
            formuydu ve "token hiç gelmiyor" sanılıyordu — oysa token gelmiş, reddedilmişti.
            Parametreler kalınca hem durum incelenebiliyor hem sayfa yenilenince devir
            yeniden deneniyor. Token yalnızca BAŞARIDA adresten siliniyor.
          */
          const detail = String(json?.message ?? '').trim()
          console.error('[ERP_HANDOVER] basarisiz', { status: res.status, message: detail })
          if (!cancelled) {
            setError(detail
              ? `Devir reddedildi (${res.status}): ${detail}`
              : `Bayi oturumu devralınamadı (HTTP ${res.status}). Lütfen giriş yapın.`)
          }
          return
        }

        localStorage.setItem('accessToken', accessToken)
        localStorage.setItem('portalLoginAs', 'admin')
        // Bayiye/servise geri dönüş için ham ERP token'i.
        localStorage.setItem('erpHandoverToken', token)
        storeSessionPermissions(data?.allowedPages, Boolean(data?.isErpManager))

        if (tenant) {
          localStorage.setItem('tenantCode', tenant)
          localStorage.setItem('employee_portal_tenant', tenant)
        }

        const nm = String(data?.employeeName ?? '').trim() || String(params.get('sync_username') ?? '').trim()
        if (nm) {
          localStorage.setItem('userName', nm)
          sessionStorage.setItem('userName', nm)
        }

        stripHandover()
        if (!cancelled) navigate('/dashboard', { replace: true })
      } catch (e) {
        console.error('[ERP_HANDOVER] istek hatasi', e)
        if (!cancelled) setError('Personel servisine ulaşılamadı. Lütfen giriş yapın.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  const submit = async () => {

    try {
      setLoading(true)
      setError(null)

      try {
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
      } catch {
      }

      const selectedTenantCode = tenantCode.trim()

      // Yönetici girişi bir süre YALNIZCA bayi (ERP) API'sine gidiyordu; bayi yayına
      // alınmadan personel portalına yönetici olarak girilemiyordu. Artık yönetici girişi de
      // önce personel servisinin kendi kimlik doğrulamasını dener (master DB'deki süper
      // yönetici kaydı), orada tanınmazsa bayiye düşer. Böylece portal tek başına ayakta.
      let adminAuthFailed = false
      if (loginAs === 'admin') {
        try {
          const probe = await fetch(`${API_BASE_URL}/api/EmployeePortalAuth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(selectedTenantCode ? { 'X-Tenant-Code': selectedTenantCode } : {})
            },
            body: JSON.stringify({
              username: username.trim(),
              password,
              tenantCode: selectedTenantCode ? selectedTenantCode : undefined
            })
          })

          // Kimlik DOĞRU ama rolüne tek bir personel sayfası açılmamış: bu bir kimlik
          // hatası değil, yetki eksiği. Bayiye düşürüp "kullanıcı adı/şifre hatalı"
          // dedirtmek yanlış yere baktırır — sebebi olduğu gibi göster.
          if (probe.status === 403) {
            const fj = await probe.json().catch(() => null)
            throw new Error(String(fj?.message ?? '').trim() || 'Bu hesabın personel portalında yetkisi yok')
          }

          if (probe.ok) {
            const pj = await probe.json().catch(() => null)
            const pd = pj?.data
            const at = String(pd?.accessToken ?? '')
            if (at) {
              localStorage.setItem('accessToken', at)
              const rt = String(pd?.refreshToken ?? '')
              if (rt) localStorage.setItem('refreshToken', rt)
              localStorage.setItem('portalLoginAs', 'admin')
              storeSessionPermissions(pd?.allowedPages, Boolean(pd?.isErpManager))

              if (selectedTenantCode) {
                localStorage.setItem('tenantCode', selectedTenantCode)
                localStorage.setItem('employee_portal_tenant', selectedTenantCode)
                if (selectedTenant?.name) localStorage.setItem('tenantName', selectedTenant.name)
              }

              const nm = String(pd?.employeeName ?? '').trim() || username.trim()
              localStorage.setItem('userName', nm)
              sessionStorage.setItem('userName', nm)
              localStorage.setItem('username', username.trim())
              localStorage.setItem('lastUsername', username.trim())

              navigate('/dashboard', { replace: true })
              return
            }
          }
          adminAuthFailed = true
        } catch {
          // Personel servisine ulaşılamadıysa bayiye düşülür.
          adminAuthFailed = true
        }
      }

      void adminAuthFailed

      if (loginAs === 'employee' || username.trim().toLowerCase() === 'ssa') {
        try {
          localStorage.setItem('portalLoginAs', loginAs)
        } catch {
        }
        const res = await fetch(`${API_BASE_URL}/api/EmployeePortalAuth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(selectedTenantCode ? { 'X-Tenant-Code': selectedTenantCode } : {})
          },
          body: JSON.stringify({
            username: username.trim(),
            password,
            tenantCode: selectedTenantCode ? selectedTenantCode : undefined
          })
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(getFriendlyError(text || `Giriş başarısız (${res.status})`))
        }

        const json = await res.json().catch(() => null)
        const data = json?.data
        const accessToken = String(data?.accessToken ?? '')
        const refreshToken = String(data?.refreshToken ?? '')
        const empName = String(data?.employeeName ?? '').trim()
        const isSsa = Boolean(data?.isSuperSuperAdmin)

        if (!accessToken) throw new Error('Access token alınamadı')

        localStorage.setItem('accessToken', accessToken)
        try { localStorage.setItem('lastUsername', username.trim()) } catch {}
        if (refreshToken) localStorage.setItem('refreshToken', refreshToken)

        if (isSsa) {
          localStorage.setItem('portalLoginAs', 'admin')
        } else {
          localStorage.setItem('portalLoginAs', 'employee')
        }
        storeSessionPermissions(data?.allowedPages, Boolean(data?.isErpManager))

        if (selectedTenantCode) {
          localStorage.setItem('tenantCode', selectedTenantCode)
          localStorage.setItem('employee_portal_tenant', selectedTenantCode)
          if (selectedTenant?.name) localStorage.setItem('tenantName', selectedTenant.name)
        }

        if (empName) {
          localStorage.setItem('userName', empName)
          sessionStorage.setItem('userName', empName)
        }

        if (isSsa) {
          window.location.replace(from || '/employees')
        } else {
          const tenant = selectedTenantCode || String(localStorage.getItem('tenantCode') ?? '').trim()
          window.location.replace(tenant ? `/qr-checkin?tenant=${encodeURIComponent(tenant)}` : '/qr-checkin')
        }
        return
      }

      // Buraya yalnızca yönetici girişi personel servisinde tanınmadığında düşülür.
      //
      // BURADA ESKİDEN BAYİ (ERP) API'SİNE GİRİŞ DENENİYORDU — 2026-08-23'te KALDIRILDI.
      // İki servis AYNI JWT anahtarını paylaşıyor, dolayısıyla bayiden alınan token portalda
      // da geçerliydi: "Çalışan Yönetimi" kutusu işaretli OLMAYAN her ERP kullanıcısı bu
      // yoldan portala girebiliyordu. Kapının tamamını boşa çıkaran şey buydu.
      //
      // Artık gerek de yok: personel servisi ERP kullanıcısını kendisi doğruluyor
      // (EmployeePortalAuthController, `Users.EmployeeAccess` dalı). Oraya düşmediyse
      // ya kimlik yanlıştır ya da kutu işaretli değildir.
      throw new Error('Kullanıcı adı veya şifre hatalı ya da bu hesabın personel portalı yetkisi yok.')
    } catch (err: any) {
      setError(getFriendlyError(err?.message))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#111111] flex items-center justify-center font-sans text-white">
      <div className="relative z-10 w-full max-w-[1000px] flex items-center justify-between px-6 lg:px-12 py-10">
        <div className="hidden lg:flex flex-col w-1/2 pr-12">
          <div className="relative flex flex-col items-start mb-6">
            <img
              src="/s-logo-white.png"
              alt="STILSOFT"
              className="h-11 w-auto object-contain filter brightness-0 invert"
              onError={(e) => {
                e.currentTarget.src = '/stilsoft-logo.png'
              }}
            />
            <span className="loading-handwriting text-orange-400 font-extrabold text-4xl -mt-5 ml-16 transform -rotate-6 tracking-wide select-none drop-shadow-md">
              personel
            </span>
          </div>
          <p className="text-neutral-400 text-sm font-normal max-w-sm leading-relaxed">
            Kurumsal Çalışan ve Mesai Yönetim Sistemi. İnsan Kaynakları ve Çalışan Self-Servis Konsolü.
          </p>
          <div className="mt-8 flex items-center gap-2.5 text-xs text-[#c5a059] font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-[#c5a059]" />
            <span>Güvenli Kurumsal Giriş Sistemi</span>
          </div>
        </div>

        <div className="w-full lg:w-[440px]">
          <div className="bg-[#181818] border border-[#2b2b2b] rounded-2xl p-7 sm:p-9 flex flex-col shadow-2xl">
            <div className="lg:hidden flex justify-center mb-6">
              <div className="relative flex flex-col items-start">
                <img
                  src="/s-logo-white.png"
                  alt="STILSOFT"
                  className="h-9 w-auto object-contain filter brightness-0 invert"
                  onError={(e) => {
                    e.currentTarget.src = '/stilsoft-logo.png'
                  }}
                />
                <span className="loading-handwriting text-orange-400 font-extrabold text-3xl -mt-4 ml-14 transform -rotate-6 tracking-wide select-none">
                  personel
                </span>
              </div>
            </div>

            <div className="mb-6">
              <h2 className="text-xl font-serif font-normal text-white tracking-tight mb-1">{mode === 'tenant' ? 'Giriş Yap' : 'Firma Seçimi'}</h2>
              <p className="text-neutral-400 text-xs font-normal">
                {mode === 'select' ? 'Devam etmek için çalıştığınız firmayı seçin.' : 'Hesabınıza erişmek için bilgilerinizi girin.'}
              </p>
            </div>

            {mode === 'select' && (
              <div className="space-y-3">
                {tenants.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[340px] overflow-y-auto pr-1 scrollbar-thin-dark">
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
                        className="text-left group rounded-xl border border-[#2e2e2e] bg-[#222222]/50 hover:bg-[#282828] hover:border-[#c5a059]/60 transition-all p-3.5"
                      >
                        <div className="text-xs font-medium text-white truncate group-hover:text-[#c5a059] transition-colors">{t.name}</div>
                        <div className="text-[10px] text-neutral-500 font-normal truncate mt-0.5">{t.code}</div>
                      </button>
                    ))}
                  </div>
                )}

                {tenantsLoading && tenants.length === 0 && (
                  <div className="py-8 text-center space-y-2">
                    <div className="inline-block w-6 h-6 border-2 border-[#c5a059] border-t-transparent rounded-full animate-spin" />
                    <div className="text-xs text-neutral-400 font-normal">Firma listesi yükleniyor...</div>
                  </div>
                )}

                {!tenantsLoading && tenants.length === 0 && (
                  <div className="py-4 text-center space-y-3">
                    <div className="text-xs text-neutral-400">Firma listesine ulaşılamadı.</div>
                    {!manualTenantInput ? (
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => void fetchTenants()}
                          className="px-3 py-1.5 rounded-lg border border-[#333333] hover:border-[#c5a059] text-xs text-[#c5a059] font-normal transition"
                        >
                          Tekrar Dene
                        </button>
                        <button
                          type="button"
                          onClick={() => setManualTenantInput(true)}
                          className="text-[11px] text-neutral-400 hover:text-white underline"
                        >
                          Firma kodunu elle gir
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2 text-left pt-2 border-t border-[#2e2e2e]">
                        <label className="block text-[10px] text-neutral-400 uppercase tracking-wider">Firma Kodu</label>
                        <input
                          value={manualCode}
                          onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                          placeholder="Örn: DEMO"
                          className="input-dark"
                        />
                        <button
                          type="button"
                          disabled={!manualCode.trim()}
                          onClick={() => {
                            setTenantCode(manualCode.trim())
                            setMode('tenant')
                          }}
                          className="w-full h-9 rounded-lg bg-[#c5a059] text-[#141414] font-medium text-xs disabled:opacity-50 transition"
                        >
                          Devam Et
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {mode === 'tenant' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!canSubmitTenant) return
                  void submit()
                }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between gap-3 bg-[#222222] border border-[#333333] rounded-lg px-3 py-2">
                  <div className="text-xs text-neutral-300 truncate max-w-[220px]">
                    {selectedTenant?.name} <span className="text-neutral-500 font-mono text-[10px]">({tenantCode})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('select')
                      setError(null)
                      setUsername('')
                      setPassword('')
                    }}
                    className="text-[11px] text-[#c5a059] hover:underline transition"
                  >
                    Değiştir
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider">Giriş Türü</label>
                  <div className="grid grid-cols-2 gap-2 bg-[#121212] p-1 rounded-lg border border-[#2a2a2a]">
                    <button
                      type="button"
                      onClick={() => setLoginAs('employee')}
                      className={
                        'h-8 rounded text-xs transition-all ' +
                        (loginAs === 'employee'
                          ? 'bg-[#222222] text-white border border-[#383838] font-medium'
                          : 'text-neutral-400 hover:text-white')
                      }
                    >
                      Çalışan
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoginAs('admin')}
                      className={
                        'h-8 rounded text-xs transition-all ' +
                        (loginAs === 'admin'
                          ? 'bg-[#222222] text-white border border-[#383838] font-medium'
                          : 'text-neutral-400 hover:text-white')
                      }
                    >
                      Yönetici
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider">Kullanıcı Adı</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input-dark"
                    data-no-capitalize="true"
                    placeholder="Kullanıcı adınızı girin"
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider">Şifre</label>
                  <div className="relative">
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyUp={(e) => {
                        const caps = e.getModifierState?.('CapsLock')
                        setCapsLockOn(Boolean(caps))
                      }}
                      type={showPassword ? 'text' : 'password'}
                      className="input-dark pr-11"
                      data-no-capitalize="true"
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white transition-colors"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={!canSubmitTenant || loading}
                    className={
                      'w-full h-10 rounded-lg text-xs font-medium tracking-wide transition-all duration-150 ' +
                      ((canSubmitTenant && !loading)
                        ? 'bg-[#c5a059] hover:bg-[#b88e53] text-[#141414] font-semibold active:scale-[0.99]'
                        : 'bg-[#222222] text-neutral-500 cursor-not-allowed border border-[#2a2a2a]')
                    }
                  >
                    {loading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
                  </button>
                </div>

                {error && (
                  <div className="bg-rose-950/40 border border-rose-800/50 rounded-lg px-4 py-2.5 text-xs text-rose-300 text-center animate-shake">
                    {error}
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      </div>



      {capsLockOn && (
        <div className="fixed bottom-6 left-6 backdrop-blur-md bg-amber-500/20 border border-amber-500/30 rounded-xl px-4 py-2 text-xs font-bold text-amber-200 shadow-2xl">
          ⚠️ Caps Lock Açık
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.2s ease-in-out 0s 2; }
      `
        }}
      />
    </div>
  )
}

