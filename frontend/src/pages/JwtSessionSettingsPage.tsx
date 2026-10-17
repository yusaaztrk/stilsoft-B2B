import { fetchActiveSessions, revokeAllSessions, revokeUserSession, type ActiveSessionDto } from '../api/auth'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import NotificationPopup from '../components/NotificationPopup'
import Table, { type TableColumn } from '../components/Table'
import { retryPendingAccounting } from '../api/virtualPos'
import { API_BASE_URL } from '../config/api'

type SettingsDto = {
  accessTokenExpirationMinutes: number
  alertBeforeMinutes: number
  invoiceDeleteLockDate?: string | null
  invoiceTrackingStartDate?: string | null
}

type BrandingDto = {
  logoUrl?: string | null
  headerGradientFrom?: string | null
  headerGradientTo?: string | null
}

export default function JwtSessionSettingsPage() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsDto>({ accessTokenExpirationMinutes: 60, alertBeforeMinutes: 3 })
  const [invoiceDeleteLockDate, setInvoiceDeleteLockDate] = useState<string>('')
  const [invoiceTrackingStartDate, setInvoiceTrackingStartDate] = useState<string>('')

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupTitle, setPopupTitle] = useState('')
  const [popupMessage, setPopupMessage] = useState('')
  const [popupVariant, setPopupVariant] = useState<'success' | 'error' | 'info'>('info')

  const [brandingLoading, setBrandingLoading] = useState(false)

  const [brandingSaving, setBrandingSaving] = useState(false)
  const [systemTimeOverride, setSystemTimeOverride] = useState<string>('')

  const [branding, setBranding] = useState<BrandingDto>({
    logoUrl: null,
    headerGradientFrom: null,
    headerGradientTo: null
  })

  const [brandingLogoFile, setBrandingLogoFile] = useState<File | null>(null)

  const [campaignGradientFrom, setCampaignGradientFrom] = useState<string>(
    () => localStorage.getItem('campaignBannerGradientFrom') || localStorage.getItem('campaignBannerBgColor') || '#ffffff'
  )
  const [campaignGradientTo, setCampaignGradientTo] = useState<string>(
    () => localStorage.getItem('campaignBannerGradientTo') || localStorage.getItem('campaignBannerBgColor') || '#ffffff'
  )
  const [campaignTextColor, setCampaignTextColor] = useState<string>(
    () => localStorage.getItem('campaignBannerTextColor') || '#0f172a'
  )

  const tenantCode = useMemo(() => String(localStorage.getItem('tenantCode') ?? '').trim(), [])

  const buildHeaders = (includeJson: boolean) => {
    const headers: Record<string, string> = {}
    if (includeJson) headers['Content-Type'] = 'application/json'
    const token = localStorage.getItem('accessToken')
    if (token) headers.Authorization = `Bearer ${token}`
    if (tenantCode) headers['X-Tenant-Code'] = tenantCode
    return headers
  }

  const showPopup = (variant: 'success' | 'error' | 'info', title: string, message: string) => {
    setPopupVariant(variant)
    setPopupTitle(title)
    setPopupMessage(message)
    setPopupOpen(true)
  }

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${API_BASE_URL}/api/SessionSettings`, { headers: buildHeaders(false) })
        if (!res.ok) {
          const t = await res.text().catch(() => '')
          throw new Error(t || `Ayarlar alınamadı (${res.status})`)
        }
        const json = await res.json().catch(() => null)
        const data = json?.data
        setSettings({
          accessTokenExpirationMinutes: Number(data?.accessTokenExpirationMinutes ?? 60),
          alertBeforeMinutes: Number(data?.alertBeforeMinutes ?? 3),
          invoiceDeleteLockDate: data?.invoiceDeleteLockDate ?? null
        })
        setInvoiceDeleteLockDate(data?.invoiceDeleteLockDate ? String(data.invoiceDeleteLockDate).slice(0, 10) : '')
        setInvoiceTrackingStartDate(data?.invoiceTrackingStartDate ? String(data.invoiceTrackingStartDate).slice(0, 10) : '')

        // Fetch System Time Override
        const timeRes = await fetch(`${API_BASE_URL}/api/SessionSettings/system-time`, { headers: buildHeaders(false) })
        if (timeRes.ok) {
          const timeJson = await timeRes.json().catch(() => null)
          if (timeJson?.overrideTimeUtc) {
            const utcDate = new Date(timeJson.overrideTimeUtc)
            const localStr = new Date(utcDate.getTime() - utcDate.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16)
            setSystemTimeOverride(localStr)
          } else {
            setSystemTimeOverride('')
          }
        }
      } catch (e: any) {
        setError(String(e?.message ?? 'Yükleme hatası'))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!tenantCode) return

    void (async () => {
      setBrandingLoading(true)
      try {
        const res = await fetch(`${API_BASE_URL}/api/tenants/branding`, { headers: buildHeaders(false) })
        if (!res.ok) {
          setBranding({ logoUrl: null, headerGradientFrom: null, headerGradientTo: null })
          return
        }
        const json = await res.json().catch(() => null)
        const data = json?.data
        setBranding({
          logoUrl: String(data?.logoUrl ?? '').trim() || null,
          headerGradientFrom: String(data?.headerGradientFrom ?? '').trim() || null,
          headerGradientTo: String(data?.headerGradientTo ?? '').trim() || null
        })
        if (data?.campaignGradientFrom) setCampaignGradientFrom(String(data.campaignGradientFrom))
        if (data?.campaignGradientTo) setCampaignGradientTo(String(data.campaignGradientTo))
        if (data?.campaignTextColor) setCampaignTextColor(String(data.campaignTextColor))
      } catch {
        setBranding({ logoUrl: null, headerGradientFrom: null, headerGradientTo: null })
      } finally {
        setBrandingLoading(false)
      }
    })()
  }, [tenantCode])

  /**
   * SANAL POS — MUHASEBESI BEKLEYEN TAHSILATLAR.
   *
   * Burada duruyor, POS Cekim Raporu'nda DEGIL: o rapor bayilere de acik ve bu bir mutabakat
   * islemi. Bayinin kendi tahsilatini muhasebelestirebilmesi dogru olmaz. Genel Ayarlar
   * `users/genelAyarlar` yetkisine bagli; ucun kendisi de ayni anahtarla korunuyor, yani
   * dugmeyi gizlemek tek basina birakilmadi.
   *
   * Ne yapar: 3D geri cagrisi musterinin tarayicisindan teslim edilmediginde tahsilat
   * `AccountingPending`de bekliyor ve kimse fark etmiyor. Bu dugme yalnizca BANKANIN
   * ONAYLADIGI (IsSuccess) kayitlari isler; onaylanmamis bir odemeyi asla muhasebelestirmez.
   */
  const [posPosting, setPosPosting] = useState(false)
  const [posResult, setPosResult] = useState<string | null>(null)

  const runPendingPosAccounting = async () => {
    try {
      setPosPosting(true)
      setPosResult(null)
      const r = await retryPendingAccounting()
      if (r.examined === 0) {
        setPosResult('Muhasebesi bekleyen tahsilat yok.')
      } else {
        setPosResult(
          `${r.examined} kayıt incelendi, ${r.posted} tanesi muhasebeleştirildi.` +
          (r.stillPending > 0 ? ` ${r.stillPending} kayıt hâlâ bekliyor.` : '')
        )
      }
    } catch (e: any) {
      setPosResult(null)
      showPopup('error', 'Hata', e?.message || 'Muhasebeleştirme başarısız.')
    } finally {
      setPosPosting(false)
    }
  }

  const saveBranding = async () => {
    if (!tenantCode) {
      showPopup('error', 'Hata', 'Tenant seçimi zorunlu')
      return
    }

    setBrandingSaving(true)
    try {
      const fd = new FormData()
      if (brandingLogoFile) fd.append('Logo', brandingLogoFile)
      if ((branding.headerGradientFrom ?? '').trim()) fd.append('HeaderGradientFrom', String(branding.headerGradientFrom))
      if ((branding.headerGradientTo ?? '').trim()) fd.append('HeaderGradientTo', String(branding.headerGradientTo))
      if ((campaignGradientFrom ?? '').trim()) fd.append('CampaignGradientFrom', String(campaignGradientFrom))
      if ((campaignGradientTo ?? '').trim()) fd.append('CampaignGradientTo', String(campaignGradientTo))
      if ((campaignTextColor ?? '').trim()) fd.append('CampaignTextColor', String(campaignTextColor))

      const token = localStorage.getItem('accessToken')
      const res = await fetch(`${API_BASE_URL}/api/tenants/branding`, {
        method: 'PUT',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {})
        },
        body: fd
      })

      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(t || `Kaydetme başarısız (${res.status})`)
      }

      setBrandingLogoFile(null)
      localStorage.setItem('campaignBannerGradientFrom', campaignGradientFrom)
      localStorage.setItem('campaignBannerGradientTo', campaignGradientTo)
      localStorage.setItem('campaignBannerBgColor', campaignGradientFrom)
      localStorage.setItem('campaignBannerTextColor', campaignTextColor)

      window.dispatchEvent(new Event('tenant-branding-changed'))
      showPopup('success', 'Kaydedildi', 'Firma logo, header ve kampanya slider renkleri güncellendi.')
    } catch (e: any) {
      const msg = String(e?.message ?? 'Kaydetme hatası')
      showPopup('error', 'Hata', msg)
    } finally {
      setBrandingSaving(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...settings,
        invoiceDeleteLockDate: invoiceDeleteLockDate ? new Date(invoiceDeleteLockDate + 'T00:00:00Z').toISOString() : null,
        // Kilidi KALDIRMAK artık açık bir bayrakla bildiriliyor. Sunucu tarafında boş tarih
        // "dokunma" anlamına geliyor: ayarların bir bölümünü gönderen başka ekranlar
        // (kampanya ayarları) kilidi farkında olmadan siliyordu. Kilidi asıl yöneten ekran
        // burası olduğu için niyeti burası söylüyor.
        clearInvoiceDeleteLockDate: !invoiceDeleteLockDate,
        invoiceTrackingStartDate: invoiceTrackingStartDate ? new Date(invoiceTrackingStartDate + 'T00:00:00Z').toISOString() : null,
        clearInvoiceTrackingStartDate: !invoiceTrackingStartDate
      }
      const res = await fetch(`${API_BASE_URL}/api/SessionSettings`, {
        method: 'PUT',
        headers: buildHeaders(true),
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(t || `Kaydetme başarısız (${res.status})`)
      }

      // Save System Time Override
      const overrideTimeUtc = systemTimeOverride ? new Date(systemTimeOverride).toISOString() : null
      const timeRes = await fetch(`${API_BASE_URL}/api/SessionSettings/system-time`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({ overrideTimeUtc })
      })

      if (!timeRes.ok) {
        const t = await timeRes.text().catch(() => '')
        throw new Error(t || `Sistem saati kaydedilemedi (${timeRes.status})`)
      }

      try {
        const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
        const extRes = await fetch(`${API_BASE_URL}/api/auth/extend-session`, {
          method: 'POST',
          headers: {
            ...buildHeaders(false),
            ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {})
          }
        })
        if (extRes.ok) {
          const extJson = await extRes.json().catch(() => null)
          const token = String(extJson?.data?.accessToken ?? '').trim()
          if (token) localStorage.setItem('accessToken', token)
        }
      } catch {
      }

      window.dispatchEvent(new Event('jwt-session-settings-changed'))
      showPopup('success', 'Kaydedildi', 'Ayarlar ve sistem saati güncellendi.')
    } catch (e: any) {
      const msg = String(e?.message ?? 'Kaydetme hatası')
      setError(msg)
      showPopup('error', 'Hata', msg)
    } finally {
      setSaving(false)
    }
  }

  /*
    AÇIK OTURUMLAR PANELİ (2026-08-30 kullanıcı isteği).

    Sayfanın sol sütunu ayarlarla doluydu, sağı bomboştu; panel oraya kondu. 30 saniyede bir
    kendini tazeliyor — oturumlar dakikalar içinde değiştiği için elle yenilemek zorunda
    kalmayasın diye. Sekme arkadayken de dönüyor ama maliyeti tek küçük istek.
  */
  const [oturumlar, setOturumlar] = useState<ActiveSessionDto[]>([])
  const [oturumYukleniyor, setOturumYukleniyor] = useState(false)
  const [dusurulen, setDusurulen] = useState<string | null>(null)
  const [herkesiDusurOnay, setHerkesiDusurOnay] = useState(false)
  const [herkesiDusuruyor, setHerkesiDusuruyor] = useState(false)

  const oturumlariYukle = useCallback(async (signal?: AbortSignal) => {
    setOturumYukleniyor(true)
    try {
      setOturumlar(await fetchActiveSessions(signal))
    } catch {
      // Açık-başarısız: panel boş kalır, ayarlar sayfası çalışmaya devam eder.
      setOturumlar([])
    } finally {
      setOturumYukleniyor(false)
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void oturumlariYukle(ac.signal)
    const t = window.setInterval(() => void oturumlariYukle(), 30000)
    return () => { ac.abort(); window.clearInterval(t) }
  }, [oturumlariYukle])

  const oturumDusur = async (kullanici: string) => {
    setDusurulen(kullanici)
    try {
      const mesaj = await revokeUserSession(kullanici)
      setPopupVariant('success'); setPopupTitle('Tamam'); setPopupMessage(mesaj); setPopupOpen(true)
      await oturumlariYukle()
    } catch (e: any) {
      setPopupVariant('error'); setPopupTitle('Hata')
      setPopupMessage(String(e?.message ?? 'Oturum kapatılamadı')); setPopupOpen(true)
    } finally {
      setDusurulen(null)
    }
  }

  const herkesiDusur = async () => {
    setHerkesiDusuruyor(true)
    setHerkesiDusurOnay(false)
    try {
      const sonuc = await revokeAllSessions()
      setPopupVariant('success'); setPopupTitle('Tamam')
      setPopupMessage(sonuc.message); setPopupOpen(true)
      // Liste hemen tazelenmez: kapanma birkaç saniye sonrası için damgalandı, kullanıcılar
      // o ana kadar hâlâ açık. Kapanma anından biraz sonra tazelenince liste boşalmış olur.
      window.setTimeout(() => void oturumlariYukle(), (sonuc.leadSeconds + 2) * 1000)
    } catch (e: any) {
      setPopupVariant('error'); setPopupTitle('Hata')
      setPopupMessage(String(e?.message ?? 'Oturumlar kapatılamadı')); setPopupOpen(true)
    } finally {
      setHerkesiDusuruyor(false)
    }
  }

  const saatBicimi = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    } catch { return '-' }
  }

  /** Rol süzgeci seçenekleri VERİDEN üretilir; o an bağlı olmayan rol listelenmez. */
  const rolSecenekleri = useMemo(
    () =>
      Array.from(new Set((oturumlar ?? []).map((o) => String(o.roleName ?? '').trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'tr-TR'))
        .map((v) => ({ label: v, value: v })),
    [oturumlar]
  )

  /*
    ORTAK TABLO BİLEŞENİ (2026-09-02 kullanıcı isteği).

    Panel elle yazılmış bir `<table>` idi: arama yok, süzgeç yok, sıralama yok,
    sayfalama yok. Otuz kişi bağlıyken aranan kişiyi gözle bulmak gerekiyordu.
    Ortak bileşene geçince hepsi hazır geliyor.

    TARİH SÜZGECİ KULLANILMADI: "Son Hareket" ve "Bitiş" birer SAAT (09:49), gün değil.
    `filterType: 'date'` verilseydi ortak bileşen kolonu açılışta BUGÜNE sabitler ve
    liste boş gelirdi (bkz. AppDataTable tarih tohumlaması).
  */
  const oturumKolonlari: TableColumn<ActiveSessionDto>[] = useMemo(
    () => [
      {
        key: 'username',
        label: 'Kullanıcı',
        searchable: true,
        // Ad, kullanıcı adı ve e-posta birlikte aranabilsin: kullanıcı hangisini
        // hatırlıyorsa onunla bulur.
        filterValue: (o) => [o.displayName, o.username, o.email].filter(Boolean).join(' '),
        render: (_v, o) => (
          <div>
            <div className="font-bold text-gray-900">
              {o.displayName || o.username}
              {o.isSelf ? <span className="ml-1.5 text-[10px] font-normal text-emerald-700">(siz)</span> : null}
            </div>
            <div className="text-[10px] text-gray-400 font-mono">{o.username}</div>
            {o.email ? <div className="text-[10px] text-gray-400">{o.email}</div> : null}
          </div>
        )
      },
      {
        key: 'roleName',
        label: 'Rol',
        searchable: true,
        filter: { type: 'select', options: rolSecenekleri },
        render: (v) =>
          v ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-semibold border border-slate-200">{String(v)}</span>
          ) : (
            <span className="text-gray-300">—</span>
          )
      },
      {
        key: 'lastActivityUtc',
        label: 'Son Hareket',
        searchable: true,
        filterValue: (o) => saatBicimi(o.lastActivityUtc),
        render: (_v, o) => (
          <div className="text-gray-600">
            {saatBicimi(o.lastActivityUtc)}
            {o.idleMinutes >= 5 ? (
              <div className="text-[10px] text-amber-600 font-semibold">{o.idleMinutes} dk boşta</div>
            ) : null}
          </div>
        )
      },
      {
        key: 'expiresAtUtc',
        label: 'Bitiş',
        searchable: true,
        filterValue: (o) => saatBicimi(o.expiresAtUtc),
        render: (_v, o) => <span className="text-gray-600">{saatBicimi(o.expiresAtUtc)}</span>
      },
      {
        key: 'remainingMinutes',
        label: 'Kalan (dk)',
        searchable: true,
        filter: { type: 'number' },
        render: (_v, o) => (
          <span className={`font-semibold ${o.remainingMinutes <= 5 ? 'text-red-600' : 'text-gray-700'}`}>
            {o.remainingMinutes} dk
          </span>
        )
      },
      {
        key: 'actions',
        label: '',
        sortable: false,
        width: '90px',
        render: (_v, o) => (
          // Kendi oturumunu düşürmek engelli: sunucu da reddediyor, düğme de kapalı.
          <button
            type="button"
            disabled={o.isSelf || dusurulen === o.username}
            onClick={() => void oturumDusur(o.username)}
            title={o.isSelf ? 'Kendi oturumunuzu buradan kapatamazsınız' : 'Bu kullanıcıyı oturumdan düşür'}
            className="h-7 px-2.5 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-700 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
          >
            {dusurulen === o.username ? '...' : 'Düşür'}
          </button>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rolSecenekleri, dusurulen]
  )

  return (
    <div className="p-4">
      <NotificationPopup isOpen={popupOpen} onClose={() => setPopupOpen(false)} variant={popupVariant} title={popupTitle} message={popupMessage} />

      {/*
        HERKESİ DÜŞÜR — ONAY.
        Tek tıkla çalışan, herkesi işinden eden bir düğme olmasın diye araya onay konuldu;
        kaç kişinin etkileneceği de yazıyor.
      */}
      {herkesiDusurOnay && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-black text-gray-900">Herkesi oturumdan düşür</h3>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              Kendi oturumun hariç <b>{oturumlar.filter((o) => !o.isSelf).length} kişi</b> programdan
              düşürülecek. Herkese önce geri sayımlı bir uyarı gösterilir, kapanma yaklaşık{' '}
              <b>30 saniye</b> sonra gerçekleşir.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Kaydedilmemiş işi olan kullanıcılar bu süre içinde kaydedebilir.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setHerkesiDusurOnay(false)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => void herkesiDusur()}
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-700"
              >
                Evet, herkesi düşür
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-5 gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Ayarlar</div>
          <h2 className="text-xl font-black text-gray-900 tracking-tight mt-1 truncate">Genel Ayarlar & Güvenlik</h2>
          <p className="text-sm text-gray-500 mt-1">Oturum süresi, sistem saati ve fatura silme güvenlik kilidi ayarlarını yönetin.</p>
        </div>
      </div>

      {/*
        SOL SÜTUN İÇERİĞİ KADAR YER KAPLAR (2026-09-02 kullanıcı isteği).

        Ölçüler `3fr / 2fr` idi ama soldaki kartların kendi `max-w-3xl` sınırı var:
        3fr'lik alanın sağ yarısı boş kalıyor, tablo ekranın ta sağında başlıyor ve
        arada koca bir boşluk duruyordu. Sol iz kart genişliğine sabitlendi (48rem =
        `max-w-3xl`), kalan genişliğin tamamı tabloya verildi — hem boşluk kapandı hem
        de süzgeç satırının ihtiyacı olan yer çıktı.
      */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,48rem)_minmax(0,1fr)] gap-5 items-start">
      <div className="max-w-3xl space-y-5">
        {/* Oturum & Sistem Saati Kartı */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)] overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Oturum</div>
                <div className="text-sm font-extrabold text-gray-900 mt-1">Süre ve Sistem Ayarları</div>
              </div>
              <div className="text-[11px] font-bold text-gray-500">Tenant: {tenantCode || '-'}</div>
            </div>
          </div>

          <div className="p-5">
            {loading ? (
              <div className="text-sm text-gray-500">Yükleniyor...</div>
            ) : error ? (
              <div className="text-sm text-red-600 whitespace-pre-line">{error}</div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1">
              <div>
                <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">JWT Süresi (dk)</div>
                <input
                  type="number"
                  value={settings.accessTokenExpirationMinutes}
                  onChange={(e) =>
                    setSettings((p) => ({ ...p, accessTokenExpirationMinutes: Number(e.target.value || 0) }))
                  }
                  className="mt-1 w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"
                  min={1}
                  max={1440}
                />
                <div className="text-[11px] text-gray-500 mt-1 ml-1">1 - 1440 dakika arası.</div>
              </div>

              <div>
                <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Uyarı (dk kala)</div>
                <input
                  type="number"
                  value={settings.alertBeforeMinutes}
                  onChange={(e) => setSettings((p) => ({ ...p, alertBeforeMinutes: Number(e.target.value || 0) }))}
                  className="mt-1 w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"
                  min={0}
                  max={1440}
                />
                <div className="text-[11px] text-gray-500 mt-1 ml-1">Örn: 3 dk kala uyar.</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 mt-4 border-t border-gray-100 pt-4">
              <div>
                <div className="text-[11px] font-bold text-red-600 uppercase tracking-[0.14em] ml-1 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-600 animate-pulse"></span>
                  Sistem Tarihi Test Ayarı (Sanal Pos & Aktarımlar İçin)
                </div>
                <div className="flex gap-2 items-center mt-1">
                  <input
                    type="datetime-local"
                    value={systemTimeOverride}
                    onChange={(e) => setSystemTimeOverride(e.target.value)}
                    className="w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"
                  />
                  {systemTimeOverride && (
                    <button
                      type="button"
                      onClick={() => setSystemTimeOverride('')}
                      className="h-11 px-4 rounded-2xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-600 hover:bg-gray-100 transition whitespace-nowrap"
                    >
                      Sıfırla (Gerçek Saat)
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 mt-1 ml-1">
                  Sistem saatini değiştirmek için bir tarih/saat seçin ve Kaydet butonuna basın. Gerçek zamana dönmek için Sıfırla butonunu kullanın.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Fatura Dökümü Silme Kilit Tarihi Kartı */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)] overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Fatura Güvenliği</div>
                <div className="text-sm font-extrabold text-gray-900 mt-1">Fatura Dökümü Silme Kilidi</div>
              </div>
              <div>
                {invoiceDeleteLockDate ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 shadow-xs">
                    🔒 Kilit Aktif ({new Date(invoiceDeleteLockDate + 'T00:00:00').toLocaleDateString('tr-TR')} Öncesi)
                  </span>
                ) : (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Kilit Kapalı (Sınırlama Yok)
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="p-5">
            <p className="text-xs text-gray-600 mb-4 leading-relaxed">
              Buradan bir tarih belirlediğinizde, <strong>Fatura Dökümü</strong> ekranında bu tarihten <strong>önceki</strong> tarihe sahip tüm faturaların ve kalemlerin sistemden silinmesi kesin olarak engellenir. Bu kural tüm kullanıcı ve roller için geçerlidir.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div>
                <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Kilit Başlangıç Tarihi</div>
                <div className="flex gap-2 items-center mt-1">
                  <input
                    type="date"
                    value={invoiceDeleteLockDate}
                    onChange={(e) => setInvoiceDeleteLockDate(e.target.value)}
                    className="w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"
                  />
                  {invoiceDeleteLockDate && (
                    <button
                      type="button"
                      onClick={() => setInvoiceDeleteLockDate('')}
                      className="h-11 px-4 rounded-2xl border border-rose-200 bg-rose-50 text-xs font-bold text-rose-700 hover:bg-rose-100 transition whitespace-nowrap shadow-xs"
                      title="Kilidi kaldır / Tarihi temizle"
                    >
                      Kilidi Kaldır
                    </button>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-xl border border-gray-100 bg-gray-50/70 text-xs">
                {invoiceDeleteLockDate ? (
                  <div className="text-amber-800 font-semibold flex items-start gap-2">
                    <span className="text-base leading-none">⚠️</span>
                    <span>
                      <strong>{new Date(invoiceDeleteLockDate + 'T00:00:00').toLocaleDateString('tr-TR')}</strong> tarihinden önceki faturalar hiç kimse tarafından silinemeyecektir.
                    </span>
                  </div>
                ) : (
                  <div className="text-gray-500">
                    Herhangi bir kilit tarihi seçilmedi. Fatura dökümünde mevcut yetki kurallarına göre silme yapılabilir.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Fatura Takip başlangıç günü: bundan önce kaydedilen faturalar otomatik tamamlandı sayılır. */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)] overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Fatura Takip</div>
            <div className="text-sm font-extrabold text-gray-900 mt-1">Takip Başlangıç Tarihi</div>
          </div>
          <div className="p-5">
            <p className="text-xs text-gray-600 mb-4 leading-relaxed">
              Bu tarihten <strong>önce kaydedilen</strong> faturalar Fatura Takip ekranında <strong>otomatik tamamlandı</strong> sayılır ve planlama listesine düşmez.
              Tarih seçilmezse <strong>15.09.2026</strong> kullanılır. Ölçüt faturanın kayıt zamanıdır; elle geriye alınmış fatura tarihi değildir.
            </p>
            <div className="flex gap-2 items-center max-w-md">
              <input
                type="date"
                value={invoiceTrackingStartDate}
                onChange={(e) => setInvoiceTrackingStartDate(e.target.value)}
                className="w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"
              />
              {invoiceTrackingStartDate && (
                <button
                  type="button"
                  onClick={() => setInvoiceTrackingStartDate('')}
                  className="h-11 px-4 rounded-2xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-700 hover:bg-gray-100 transition whitespace-nowrap"
                >
                  Varsayılana Dön
                </button>
              )}
            </div>
          </div>
        </div>

        {/*
          MARKA KARTI — 2026-08-23'te GERİ GETİRİLDİ.

          Durum, yükleme (`GET /api/tenants/branding`) ve kaydetme (`saveBranding`) mantığı
          dosyada hep duruyordu; silinmiş olan yalnızca BU KART'tı. Yani `saveBranding` hiçbir
          yerden çağrılmıyordu ve firma logosu/header rengi ekrandan güncellenemiyordu.
          Arka uç ucu hiç kaldırılmamıştı.

          Yetki: uç yalnızca SSA ve firmanın kendi süper admini'ne açık; başkası kaydederse
          403 döner ve aşağıdaki hata baloncuğu görünür.
        */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)] overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Görünüm</div>
            <div className="text-sm font-extrabold text-gray-900 mt-1">Firma Logosu ve Header Rengi</div>
          </div>

          <div className="p-5 space-y-5">
            {brandingLoading ? (
              <div className="text-sm text-gray-500">Yükleniyor...</div>
            ) : (
              <>
                {/* Logo */}
                <div>
                  <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Firma Logosu</div>
                  <div className="mt-2 flex items-center gap-4">
                    <div className="h-16 w-40 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
                      {brandingLogoFile ? (
                        <img src={URL.createObjectURL(brandingLogoFile)} alt="" className="max-h-full max-w-full object-contain" />
                      ) : branding.logoUrl ? (
                        <img src={branding.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-[11px] font-semibold text-gray-400">Logo yok</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setBrandingLogoFile(e.target.files?.[0] ?? null)}
                        className="block w-full text-sm text-gray-600 file:mr-3 file:h-9 file:px-4 file:rounded-lg file:border-0 file:bg-gray-900 file:text-white file:text-xs file:font-bold file:cursor-pointer hover:file:bg-black cursor-pointer"
                      />
                      <div className="text-[11px] text-gray-500 mt-1.5">
                        Yeni dosya seçilmezse mevcut logo korunur.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Header rengi */}
                <div>
                  <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Header Rengi (Gradient)</div>
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <input
                        type="color"
                        value={branding.headerGradientFrom ?? '#8F2500'}
                        onChange={(e) => setBranding((p) => ({ ...p, headerGradientFrom: e.target.value }))}
                        className="h-10 w-12 rounded border border-gray-200 cursor-pointer"
                      />
                      Sol
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <input
                        type="color"
                        value={branding.headerGradientTo ?? '#BD390C'}
                        onChange={(e) => setBranding((p) => ({ ...p, headerGradientTo: e.target.value }))}
                        className="h-10 w-12 rounded border border-gray-200 cursor-pointer"
                      />
                      Sağ
                    </label>

                    {/* Canli onizleme: kaydetmeden once nasil gorunecegi belli olsun. */}
                    <div
                      className="h-10 flex-1 min-w-[160px] rounded-lg border border-gray-200"
                      style={{
                        backgroundImage: `linear-gradient(to right, ${branding.headerGradientFrom ?? '#8F2500'}, ${branding.headerGradientTo ?? '#BD390C'})`
                      }}
                    />
                  </div>
                  <div className="text-[11px] text-gray-500 mt-2 ml-1">
                    Kaydettikten sonra üst bar bu renklere geçer.
                  </div>
                </div>

                <div className="flex items-center justify-end pt-1">
                  <button
                    type="button"
                    disabled={brandingSaving}
                    onClick={() => void saveBranding()}
                    className="h-11 px-6 rounded-2xl bg-gray-900 text-white text-sm font-bold hover:bg-black disabled:opacity-60 shadow-[0_18px_35px_-22px_rgba(17,24,39,0.65)] transition-all cursor-pointer"
                  >
                    {brandingSaving ? 'Kaydediliyor...' : 'Görünümü Kaydet'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Sanal POS mutabakat kartı */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)] overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Sanal POS</div>
            <div className="text-sm font-extrabold text-gray-900 mt-1">Muhasebesi Bekleyen Tahsilatlar</div>
          </div>

          <div className="p-5">
            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              Bankanın onayladığı ama 3D dönüşü tamamlanmadığı için muhasebeleşmemiş kredi kartı
              tahsilatlarını işler. Geri dönüşü müşterinin tarayıcısı taşıdığı için, müşteri pencereyi
              kapattığında tahsilat beklemede kalabiliyor. Yalnızca bankanın onayladığı kayıtlar
              işlenir; onaylanmamış bir ödeme hiçbir koşulda muhasebeleştirilmez.
            </p>

            {posResult && (
              <div className="mb-4 p-3 rounded-xl border border-emerald-100 bg-emerald-50 text-xs font-semibold text-emerald-800">
                {posResult}
              </div>
            )}

            <div className="flex items-center justify-end">
              <button
                type="button"
                disabled={posPosting}
                onClick={() => void runPendingPosAccounting()}
                className="h-11 px-6 rounded-2xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-60 shadow-[0_18px_35px_-22px_rgba(5,150,105,0.65)] transition-all cursor-pointer"
              >
                {posPosting ? 'İşleniyor…' : 'Bekleyenleri Muhasebeleştir'}
              </button>
            </div>
          </div>
        </div>

        {/* Kaydet Butonu */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="h-11 px-6 rounded-2xl bg-gray-900 text-white text-sm font-bold hover:bg-black disabled:opacity-60 shadow-[0_18px_35px_-22px_rgba(17,24,39,0.65)] transition-all cursor-pointer"
          >
            {saving ? 'Kaydediliyor...' : 'Ayarları Kaydet'}
          </button>
        </div>
      </div>

      {/* ───────────────── AÇIK OTURUMLAR (sağ sütun) ───────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Oturum</div>
            <h3 className="text-base font-black text-gray-900 mt-0.5">Programda Aktif Kişiler</h3>
          </div>
          <button
            type="button"
            onClick={() => setHerkesiDusurOnay(true)}
            disabled={herkesiDusuruyor || oturumlar.filter((o) => !o.isSelf).length === 0}
            className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            title="Kendi oturumun hariç herkesi düşürür"
          >
            {herkesiDusuruyor ? 'Kapatılıyor...' : 'Herkesi Düşür'}
          </button>
        </div>

        <p className="text-[11px] text-gray-500 mb-3 leading-snug">
          Bayi ve servis aynı oturumu paylaşır; listede servis tarafında çalışanlar da görünür.
          30 saniyede bir kendiliğinden tazelenir.
        </p>

        <Table
          columns={oturumKolonlari}
          data={oturumlar}
          rowKey={(o) => o.username}
          rowClassName={(o) => (o.isSelf ? 'bg-emerald-50/40' : '')}
          showColumnFilters
          initialPageSize={20}
          loading={oturumYukleniyor}
          onRefresh={() => void oturumlariYukle()}
          refreshing={oturumYukleniyor}
        />

      </div>
      </div>
    </div>
  )
}

