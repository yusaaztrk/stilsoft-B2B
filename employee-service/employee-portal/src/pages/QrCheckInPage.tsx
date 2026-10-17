import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Modal from '../components/Modal'
import Layout from '../components/Layout'
import { fetchEmployeeSelfDashboard, fetchEmployeeSelfLastCheckIn, employeeSelfCheckOut, type EmployeeSelfDashboardDto, type EmployeeSelfLastCheckInDto } from '../api/employeeSelf'
import { useTenantBranding } from '../hooks/useTenantBranding'
import { Camera, QrCode, Calendar, DollarSign, Award, Coffee, Clock, ArrowRight, Smile, UserCheck, Activity, Info, LogOut } from 'lucide-react'
import { getPosition } from '../utils/geo'


export default function QrCheckInPage() {
  const [sp] = useSearchParams()
  const tenant = useMemo(() => {
    const urlTenant = String(sp.get('tenant') ?? '').trim()
    if (urlTenant) {
      localStorage.setItem('employee_portal_tenant', urlTenant)
      localStorage.setItem('tenantCode', urlTenant)
      return urlTenant
    }
    const stored = localStorage.getItem('employee_portal_tenant') || localStorage.getItem('tenantCode')
    if (stored) {
      const val = String(stored).trim()
      localStorage.setItem('employee_portal_tenant', val)
      localStorage.setItem('tenantCode', val)
      return val
    }
    return ''
  }, [sp])

  const navigate = useNavigate()

  const [msgOpen, setMsgOpen] = useState(false)
  const [msgTitle, setMsgTitle] = useState('')
  const [msgText, setMsgText] = useState('')

  const [dashBusy, setDashBusy] = useState(false)
  const [dashError, setDashError] = useState<string | null>(null)
  const [dashMonth, setDashMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [dash, setDash] = useState<EmployeeSelfDashboardDto | null>(null)

  const [lastBusy, setLastBusy] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [last, setLast] = useState<EmployeeSelfLastCheckInDto | null>(null)

  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  const [panelModalOpen, setPanelModalOpen] = useState(false)
  const [panelModalTitle, setPanelModalTitle] = useState('')
  const [panelModalKind, setPanelModalKind] = useState<null | 'calendar' | 'times' | 'advance' | 'bonus' | 'salary'>(null)

  const [qrShowOpen, setQrShowOpen] = useState(false)
  const [qrShowTitle, setQrShowTitle] = useState('')
  const [qrShowText, setQrShowText] = useState('')
  const [qrShowDataUrl, setQrShowDataUrl] = useState('')

  const { branding } = useTenantBranding(tenant)

  const tenantName = useMemo(() => {
    try { return String(localStorage.getItem('tenantName') ?? '').trim() } catch { return '' }
  }, [])

  const employeeName = useMemo(() => {
    try {
      return String(localStorage.getItem('userName') ?? sessionStorage.getItem('userName') ?? '').trim()
    } catch {
      return ''
    }
  }, [])

  const headerGradient = useMemo(() => {
    const from = branding?.headerGradientFrom || '#4f46e5'
    const to = branding?.headerGradientTo || '#7c3aed'
    return `linear-gradient(135deg, ${from}, ${to})`
  }, [branding])

  const openPanelModal = (kind: 'calendar' | 'times' | 'advance' | 'bonus' | 'salary') => {
    setPanelModalKind(kind)
    setPanelModalTitle(
      kind === 'calendar'
        ? 'Durum / Takvim'
        : kind === 'times'
          ? 'Giriş / Çıkış Saatleri'
          : kind === 'advance'
            ? 'Nakit Avans Bilgileri'
            : kind === 'bonus'
              ? 'Prim Bilgileri'
              : 'Maaş Ödemeleri'
    )
    setPanelModalOpen(true)
  }

  const showMsg = (title: string, text: string) => {
    setMsgTitle(title)
    setMsgText(text)
    setMsgOpen(true)
  }

  const openQrToScan = async (mode: 'checkin' | 'checkout') => {
    try {
      if (!tenant) {
        showMsg('Hata', 'Tenant bulunamadı')
        return
      }

      const url = `${window.location.origin}/qr-attendance?tenant=${encodeURIComponent(tenant)}&mode=${mode}`
      const QRCode = (await import('qrcode')).default
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' })

      setQrShowTitle(mode === 'checkin' ? 'QR ile Giriş' : 'QR ile Çıkış')
      setQrShowText(url)
      setQrShowDataUrl(dataUrl)
      setQrShowOpen(true)
    } catch {
      showMsg('Hata', 'QR oluşturulamadı')
    }
  }

  const formatTrDateTime = (iso?: string | null) => {
    if (!iso) return '-'
    const d = new Date(String(iso))
    if (Number.isNaN(d.getTime())) return '-'
    return d.toLocaleString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const formatTrDate = (iso?: string | null) => {
    if (!iso) return '-'
    const d = new Date(String(iso))
    if (Number.isNaN(d.getTime())) return '-'
    return d.toLocaleDateString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  const moneyTRY = (v: number) => {
    const n = Number(v || 0) || 0
    return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const dashPayments = useMemo(() => (dash?.payments ?? []) as any[], [dash])
  const dashCashAdvances = useMemo(() => dashPayments.filter((p) => Number(p?.type ?? 0) === 3), [dashPayments])
  const dashBonuses = useMemo(() => dashPayments.filter((p) => Number(p?.type ?? 0) === 2), [dashPayments])
  const dashSalaries = useMemo(() => dashPayments.filter((p) => Number(p?.type ?? 0) === 1), [dashPayments])

  const ymd = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const monthDays = useMemo(() => {
    const parts = String(dashMonth || '').split('-')
    const y = Number(parts[0])
    const m = Number(parts[1])
    if (!y || !m) return [] as string[]
    const start = new Date(y, m - 1, 1)
    const end = new Date(y, m, 0)
    const out: string[] = []
    for (let cur = new Date(start); cur.getTime() <= end.getTime(); cur.setDate(cur.getDate() + 1)) {
      out.push(ymd(cur))
    }
    return out
  }, [dashMonth])
  const workedDaysSet = useMemo(() => new Set(dash?.calendar?.workedDays ?? []), [dash])
  const leaveDaysSet = useMemo(() => new Set(dash?.calendar?.leaveDays ?? []), [dash])
  const greeting = useMemo(() => {
    const hr = new Date().getHours()
    if (hr < 12) return 'Günaydın'
    if (hr < 18) return 'İyi Günler'
    return 'İyi Akşamlar'
  }, [])

  const loadDashboard = async () => {
    try {
      setDashBusy(true)
      setDashError(null)
      const res = await fetchEmployeeSelfDashboard({ month: dashMonth })
      setDash(res)
    } catch (e: any) {
      setDash(null)
      setDashError(String(e?.message ?? 'Bilgiler alınamadı'))
    } finally {
      setDashBusy(false)
    }
  }

  const loadLast = async () => {
    try {
      setLastBusy(true)
      setLastError(null)
      const res = await fetchEmployeeSelfLastCheckIn()
      setLast(res)
    } catch (e: any) {
      setLast(null)
      setLastError(String(e?.message ?? 'Son kayıt alınamadı'))
    } finally {
      setLastBusy(false)
    }
  }

  useEffect(() => {
    void loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashMonth])

  useEffect(() => {
    void loadLast()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Konum zorunlu (2026-10-16): alınamazsa sebebi (izin kapalı / GPS kapalı / zaman aşımı)
   * personele söylenir ve istek gönderilmez. Eskiden 0,0 gönderiliyordu.
   */
  const getLocation = async (): Promise<{ latitude: number; longitude: number; accuracy: number }> => {
    const pos = await getPosition()
    if (!pos.ok) throw new Error(pos.message)
    return { latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy }
  }

  const needsCheckOut = useMemo(() => {
    if (!last) return false
    const out = (last as any)?.checkOutTime
    return !out
  }, [last])

  const visibleAction = useMemo(() => {
    return needsCheckOut ? 'checkout' : 'checkin'
  }, [needsCheckOut])

  const handleSelfCheckOut = async () => {
    try {
      setCheckoutBusy(true)
      setCheckoutError(null)
      const loc = await getLocation()

      await employeeSelfCheckOut({
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy
      })

      showMsg('Başarılı', 'Mesai çıkış işleminiz başarıyla kaydedilmiştir. İyi günler dileriz.')
      await Promise.all([loadLast(), loadDashboard()])
    } catch (err: any) {
      setCheckoutError(err.message || 'Çıkış işlemi sırasında bir hata oluştu.')
    } finally {
      setCheckoutBusy(false)
    }
  }

  const logout = () => {
    try {
      localStorage.removeItem('employee_portal_auth')
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userName')
      sessionStorage.removeItem('userName')
    } catch {
    }
    navigate('/login', { replace: true })
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Modals */}
        <Modal isOpen={msgOpen} onClose={() => setMsgOpen(false)} title={msgTitle || 'Bilgi'}>
          <div className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{msgText}</div>
        </Modal>


        <Modal isOpen={qrShowOpen} onClose={() => setQrShowOpen(false)} title={qrShowTitle}>
          <div className="flex flex-col items-center justify-center p-6 text-center">
            {qrShowDataUrl ? (
              <img src={qrShowDataUrl} alt="Mesai QR Kodu" className="w-64 h-64 border border-slate-100 rounded-2xl p-2 shadow-sm bg-white" />
            ) : (
              <div className="w-64 h-64 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">Yükleniyor...</div>
            )}
            <div className="mt-4 text-xs font-bold text-slate-500 max-w-xs">{qrShowText}</div>
            <div className="mt-2 text-[11px] text-slate-400 leading-normal">
              Bu QR kodu ekranı açık kaldığı sürece geçerlidir. Başka bir telefondan okutarak mesai kaydı yapabilirsiniz.
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={panelModalOpen}
          onClose={() => setPanelModalOpen(false)}
          title={panelModalTitle}
        >
          {panelModalKind === 'calendar' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold text-slate-600">Aylık Görünüm</div>
                <input
                  type="month"
                  value={dashMonth}
                  onChange={(e) => setDashMonth(String(e.target.value))}
                  className="h-9 rounded-xl border border-slate-200 px-3 text-xs bg-white text-slate-800 focus:outline-none"
                />
              </div>

              {dashBusy ? (
                <div className="text-xs text-slate-400">Yükleniyor...</div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-7 gap-1.5">
                    {monthDays.map((k) => {
                      const isLeave = leaveDaysSet.has(k)
                      const isWorked = workedDaysSet.has(k)
                      const cls =
                        'h-10 rounded-xl border text-[11px] font-extrabold flex flex-col items-center justify-center ' +
                        (isLeave
                          ? 'bg-amber-50 border-amber-200 text-amber-900 shadow-sm shadow-amber-100'
                          : isWorked
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900 shadow-sm shadow-emerald-100'
                            : 'bg-slate-50 border-slate-200 text-slate-500')
                      return (
                        <div key={k} className={cls} title={k}>
                          {Number(String(k).slice(8, 10))}
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-2 text-[10px] text-slate-500 flex items-center gap-4">
                    <div className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded bg-emerald-200 border border-emerald-300" /> Çalıştı</div>
                    <div className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded bg-amber-200 border border-amber-300" /> İzinli</div>
                    <div className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded bg-slate-100 border border-slate-200" /> Tatil / Boş</div>
                  </div>
                </div>
              )}
            </div>
          ) : panelModalKind === 'times' ? (
            <div className="space-y-2 max-h-[60vh] overflow-auto scrollbar-thin-dark pr-1">
              {(dash?.checkIns ?? []).map((x) => (
                <div key={String(x.id)} className="rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 flex items-center justify-between gap-4 hover:bg-slate-100/70 transition">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Giriş: {formatTrDateTime((x as any)?.checkInTime)}
                    </div>
                    {((x as any)?.checkOutTime) && (
                      <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                        Çıkış: {formatTrDateTime((x as any)?.checkOutTime)}
                      </div>
                    )}
                  </div>
                  <Clock size={16} className="text-slate-400 shrink-0" />
                </div>
              ))}
              {(dash?.checkIns ?? []).length === 0 && <div className="text-xs text-slate-500 text-center py-4">Kayıt yok</div>}
            </div>
          ) : panelModalKind === 'advance' ? (
            <div className="space-y-2 max-h-[60vh] overflow-auto scrollbar-thin-dark pr-1">
              {dashCashAdvances.map((p) => (
                <div key={String(p.id)} className="rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 flex justify-between items-start hover:bg-slate-100/70 transition">
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-bold text-slate-500">{formatTrDate(String(p?.paymentDate ?? ''))}</div>
                    <div className="text-[11px] text-slate-600">{String(p?.description ?? 'Nakit Avans Ödemesi')}</div>
                  </div>
                  <div className="text-sm font-extrabold text-slate-800">{moneyTRY(Number(p?.amount ?? 0))} ₺</div>
                </div>
              ))}
              {dashCashAdvances.length === 0 && <div className="text-xs text-slate-500 text-center py-4">Kayıt yok</div>}
            </div>
          ) : panelModalKind === 'bonus' ? (
            <div className="space-y-2 max-h-[60vh] overflow-auto scrollbar-thin-dark pr-1">
              {dashBonuses.map((p) => (
                <div key={String(p.id)} className="rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 flex justify-between items-start hover:bg-slate-100/70 transition">
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-bold text-slate-500">{formatTrDate(String(p?.paymentDate ?? ''))}</div>
                    <div className="text-[11px] text-slate-600">{String(p?.description ?? 'Prim Hak Edişi')}</div>
                  </div>
                  <div className="text-sm font-extrabold text-emerald-600">+{moneyTRY(Number(p?.amount ?? 0))} ₺</div>
                </div>
              ))}
              {dashBonuses.length === 0 && <div className="text-xs text-slate-500 text-center py-4">Kayıt yok</div>}
            </div>
          ) : panelModalKind === 'salary' ? (
            <div className="space-y-2 max-h-[60vh] overflow-auto scrollbar-thin-dark pr-1">
              {dashSalaries.map((p) => (
                <div key={String(p.id)} className="rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 flex justify-between items-start hover:bg-slate-100/70 transition">
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-bold text-slate-500">{formatTrDate(String(p?.paymentDate ?? ''))}</div>
                    <div className="text-[11px] text-slate-600">{String(p?.description ?? 'Maaş Ödemesi')}</div>
                  </div>
                  <div className="text-sm font-extrabold text-slate-900">{moneyTRY(Number(p?.amount ?? 0))} ₺</div>
                </div>
              ))}
              {dashSalaries.length === 0 && <div className="text-xs text-slate-500 text-center py-4">Kayıt yok</div>}
            </div>
          ) : null}
        </Modal>

        {/* --- Top Welcome & Branding Header --- */}
        <div className="bg-[#141414] rounded-xl p-6 md:p-8 text-white relative overflow-hidden border border-[#2a2a2a] shadow-sm">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium tracking-[0.2em] text-[#c5a059] uppercase">{greeting}</span>
              </div>
              <h1 className="font-serif text-2xl md:text-3xl font-normal tracking-tight text-white">
                {employeeName || 'Değerli Çalışanımız'}
              </h1>
              <p className="text-neutral-400 text-xs md:text-sm max-w-md font-normal leading-relaxed">
                Çalışma günlerinizi, mesai kayıtlarınızı, izin ve hakediş durumlarınızı anlık izleyin.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-[#1f1f1f] rounded-lg px-4 py-2 border border-[#333333] flex flex-col text-right">
                <span className="text-[10px] font-medium text-neutral-400 tracking-wider">AKTİF DÖNEM</span>
                <span className="text-xs font-serif font-normal mt-0.5 text-white">{dashMonth}</span>
              </div>
            </div>
          </div>
        </div>

        {!tenant ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center max-w-md mx-auto">
            <Info className="text-rose-500 w-8 h-8 mx-auto mb-2" />
            <div className="text-sm font-medium text-rose-900">Geçersiz Erişim Parametresi</div>
            <div className="mt-1 text-xs text-rose-600 font-normal">
              Firma kodu bulunamadı. Lütfen size iletilen orijinal bağlantı üzerinden tekrar giriş yapınız.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* --- LEFT SIDE: Mesai Giriş/Çıkış & QR --- */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Shift status banner */}
              <div className="bg-white border border-[#eae6dd] rounded-xl p-5 shadow-card flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 border border-[#eae6dd] bg-[#faf9f6] text-[#8c6538]">
                    <Activity size={18} className={visibleAction === 'checkout' ? 'animate-pulse' : ''} />
                  </div>
                  <div>
                    <div className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider">MESAİ DURUMUNUZ</div>
                    <div className="text-sm font-medium text-[#1a1a1a] mt-0.5 font-serif">
                      {visibleAction === 'checkin' ? 'Henüz Mesai Başlatılmadı' : 'Aktif Çalışma Sürüyor'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${visibleAction === 'checkin' ? 'bg-[#c5a059]' : 'bg-emerald-500'}`} />
                  <span className="text-[11px] font-medium tracking-wide uppercase text-neutral-600">
                    {visibleAction === 'checkin' ? 'GİRİŞ BEKLENİYOR' : 'ÇIKIŞ YAPABİLİRSİNİZ'}
                  </span>
                </div>
              </div>

              {visibleAction === 'checkout' ? (
                <div className="bg-white border border-[#eae6dd] rounded-xl p-8 shadow-card flex flex-col items-center justify-center text-center space-y-4">
                  <div className="h-12 w-12 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                    <LogOut size={24} />
                  </div>
                  <div className="space-y-1">
                    <h2 className="font-serif text-xl text-[#1a1a1a] font-normal tracking-tight">Mesaiyi Sonlandır</h2>
                    <p className="text-xs text-neutral-500 max-w-sm leading-relaxed font-normal">
                      Bugünkü mesainizi bitirmek için aşağıdaki butona tıklayın. Sistem anlık GPS konumunuzu kaydedecektir.
                    </p>
                  </div>

                  {checkoutError && (
                    <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 px-4 py-2 rounded-lg">
                      {checkoutError}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSelfCheckOut}
                    disabled={checkoutBusy}
                    className="btn-danger w-full max-w-md h-11 text-xs font-medium"
                  >
                    <LogOut size={16} className={checkoutBusy ? 'animate-spin' : ''} />
                    <span>{checkoutBusy ? 'Çıkış Yapılıyor...' : 'Mesaiyi Bitir / Çıkış Yap'}</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* 1. Yüz Tanıma Kartı */}
                  <a
                    href={`/face-checkin?tenant=${encodeURIComponent(tenant)}`}
                    className="group relative overflow-hidden rounded-xl border border-[#2b2b2b] p-6 flex flex-col justify-between h-44 transition-all duration-200 hover:border-[#c5a059] bg-[#141414] text-white shadow-card"
                  >
                    <div className="flex items-start justify-between">
                      <div className="h-9 w-9 rounded-lg bg-[#222222] flex items-center justify-center border border-[#333333]">
                        <Camera size={18} className="text-[#c5a059]" />
                      </div>
                      <ArrowRight size={15} className="text-neutral-500 group-hover:translate-x-1 transition-transform" />
                    </div>

                    <div className="space-y-1 mt-auto">
                      <h3 className="font-serif text-base text-white font-normal">
                        Yüz Tanıma ile Giriş
                      </h3>
                      <p className="text-[11px] text-neutral-400 leading-normal font-normal">
                        Cihaz kamerasını açarak yüz analizi ile anında mesai kaydı yapın.
                      </p>
                    </div>
                  </a>

                  {/* 2. QR Kod Kartı */}
                  <button
                    type="button"
                    onClick={() => { void openQrToScan('checkin') }}
                    className="group text-left relative overflow-hidden rounded-xl border border-[#eae6dd] bg-white p-6 flex flex-col justify-between h-44 transition-all duration-200 hover:border-[#c5a059] shadow-card"
                  >
                    <div className="flex items-start justify-between">
                      <div className="h-9 w-9 rounded-lg bg-[#faf7f2] border border-[#dcd8cd] flex items-center justify-center">
                        <QrCode size={18} className="text-[#8c6538]" />
                      </div>
                      <ArrowRight size={15} className="text-neutral-400 group-hover:translate-x-1 transition-transform" />
                    </div>

                    <div className="space-y-1 mt-auto">
                      <h3 className="font-serif text-base text-[#1a1a1a] font-normal">
                        QR Kod ile Giriş
                      </h3>
                      <p className="text-[11px] text-neutral-500 leading-normal font-normal">
                        Telefonunuzdan okutarak konum doğrulama ile işlem başlatın.
                      </p>
                    </div>
                  </button>
                </div>
              )}



              {/* Warnings / Notes */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Info size={16} className="text-slate-400 mt-0.5 shrink-0" />
                  <div className="text-[11px] text-slate-500 leading-relaxed font-medium">
                    <strong>Sistem Notu:</strong> Giriş ve çıkış işlemlerinin onaylanabilmesi için tarayıcınızın kamera ve GPS konum erişim izinlerinin açık olması gerekmektedir.
                  </div>
                </div>
              </div>
            </div>

            {/* --- RIGHT SIDE: İstatistikler & Modül Kısayolları --- */}
            <div className="space-y-6">
              {/* QUICK LINKS SECTION */}
              <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-card">
                <div className="px-5 py-4 border-b border-slate-100">
                  <span className="text-xs font-black text-slate-900 tracking-wider uppercase">BİLGİ PANELLERİ</span>
                </div>

                <div className="divide-y divide-slate-100">
                  {([
                    { kind: 'calendar' as const, label: 'Takvim & Çalışma Günleri', icon: Calendar, color: 'text-blue-700 bg-blue-50' },
                    { kind: 'times' as const, label: 'Mesai Giriş / Çıkış Saatleri', icon: Clock, color: 'text-sky-600 bg-sky-50' },
                    { kind: 'advance' as const, label: 'Avans Ödemeleri & Borç', icon: DollarSign, color: 'text-amber-600 bg-amber-50' },
                    { kind: 'bonus' as const, label: 'Prim Dağılım Listesi', icon: Award, color: 'text-emerald-600 bg-emerald-50' },
                    { kind: 'salary' as const, label: 'Maaş Dekont Kayıtları', icon: Coffee, color: 'text-slate-900 bg-slate-100' },
                  ]).map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.kind}
                        type="button"
                        onClick={() => openPanelModal(item.kind)}
                        className="w-full flex items-center gap-3.5 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left group"
                      >
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${item.color} shadow-sm`}>
                          <Icon size={16} />
                        </div>
                        <span className="text-xs font-bold text-slate-700 group-hover:text-blue-700 transition-colors">{item.label}</span>
                        <ArrowRight size={13} className="text-slate-300 ml-auto group-hover:translate-x-1 transition-all" />
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </Layout>
  )
}

