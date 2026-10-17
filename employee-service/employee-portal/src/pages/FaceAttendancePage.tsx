import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Camera, CheckCircle2, Info, Loader2, LogIn, LogOut, MapPin, ShieldCheck } from 'lucide-react'
import { faceCheckIn, faceCheckOut } from '../api/faceAuth'
import { getPosition, LOCATION_ERROR_CODES } from '../utils/geo'

type AttendanceMode = 'check-in' | 'check-out'

type ResultState =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'success'; name: string; time: string; distance?: number; offsite?: boolean }
  | { type: 'error'; message: string }
  /** Kişi tanındı ama işlem gerekmiyor/yapılamaz: "çıkışınız zaten yapıldı" gibi. */
  | { type: 'notice'; name?: string; message: string }

/**
 * Konum durumu (2026-10-16): konum alınamazsa tarama BAŞLAMAZ. Eskiden 0,0 gönderilip
 * yüz okunsa da sunucu reddediyor, ekran ise "Yüz aranıyor…" diye sonsuza dönüyordu.
 */
type LocationState =
  | { type: 'pending' }
  | { type: 'ok'; latitude: number; longitude: number; accuracy: number; at: number }
  | { type: 'error'; message: string }

/** Konum bu kadar eskiyse bir sonraki denemeden önce yeniden alınır. */
const LOCATION_MAX_AGE_MS = 60_000

/** Sunucunun "kişi tanındı ama işlem yapılmadı" kodları — sessizce yeniden denenmez. */
const NOTICE_CODES = new Set(['already_checked_in', 'already_checked_out', 'no_open_checkin'])

type FaceAttendancePageProps = {
  mode: AttendanceMode
}

const modeConfig = {
  'check-in': {
    title: 'Yüz ile Giriş',
    actionLabel: 'Giriş Yap',
    loadingLabel: 'Giriş doğrulanıyor...',
    successLabel: 'Giriş başarılı',
    timeLabel: 'Giriş',
    buttonClass: 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500/30',
    ringClass: 'border-emerald-400 shadow-emerald-400/25',
    Icon: LogIn
  },
  'check-out': {
    title: 'Yüz ile Çıkış',
    actionLabel: 'Çıkış Yap',
    loadingLabel: 'Çıkış doğrulanıyor...',
    successLabel: 'Çıkış başarılı',
    timeLabel: 'Çıkış',
    buttonClass: 'bg-sky-600 hover:bg-sky-700 focus:ring-sky-500/30',
    ringClass: 'border-sky-400 shadow-sky-400/25',
    Icon: LogOut
  }
} satisfies Record<AttendanceMode, {
  title: string
  actionLabel: string
  loadingLabel: string
  successLabel: string
  timeLabel: string
  buttonClass: string
  ringClass: string
  Icon: React.ComponentType<{ className?: string }>
}>

function formatDateTime(value?: string) {
  const date = value ? new Date(value) : new Date()
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function FaceAttendancePage({ mode }: FaceAttendancePageProps) {
  const [sp] = useSearchParams()
  const tenant = String(sp.get('tenant') ?? '').trim()
  const navigate = useNavigate()
  const config = modeConfig[mode]
  const ModeIcon = config.Icon

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [cameraReady, setCameraReady] = useState(false)
  /**
   * Akisin gercek en/boy orani. Sahne sabit 4:5'e zorlaniyordu; kaynak 4:3 oldugu icin
   * `object-cover` goruntunun sagini solunu kirpiyor, hedef ovali de yuz oranindan
   * daha dar gosteriyordu. Kutuya akisin kendi oranini vererek kirpmayi kaldiriyoruz;
   * boylece ekranda gorunen kare, gonderilen kare ile ayni.
   */
  const [videoAspect, setVideoAspect] = useState(4 / 3)
  const [cameraError, setCameraError] = useState('')
  const [result, setResult] = useState<ResultState>({ type: 'idle' })
  const [countdown, setCountdown] = useState<number | null>(null)
  /** Kamera açık kaldığı sürece kendiliğinden tarar; okuyana kadar durmaz. */
  const [autoScan, setAutoScan] = useState(true)
  const [attempts, setAttempts] = useState(0)
  const scanningRef = useRef(false)
  /**
   * Hiz sinirina takildiginda taramanin duraklatilacagi ana kadar olan zaman damgasi.
   *
   * 429 yaniti bos govdeyle geliyor ve akista "yuz eslesmedi" gibi gorunuyordu: ekran
   * sonsuza kadar "Yuz araniyor..." yazip duruyor, hicbir istek sunucuya ulasmiyordu.
   * Artik takilinca birkac saniye geri cekiliyoruz; hem kota kendini yeniliyor hem de
   * kullaniciya ne oldugu yaziliyor.
   */
  const backoffUntilRef = useRef(0)

  const [location, setLocation] = useState<LocationState>({ type: 'pending' })
  const locationRef = useRef<LocationState>({ type: 'pending' })
  locationRef.current = location

  /** Konumu alır; alınamazsa sebebini yazar ve otomatik taramayı durdurur. */
  const refreshLocation = useCallback(async (): Promise<{ latitude: number; longitude: number; accuracy: number } | null> => {
    setLocation((prev) => (prev.type === 'ok' ? prev : { type: 'pending' }))
    const pos = await getPosition()
    if (pos.ok) {
      const next: LocationState = { type: 'ok', latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy, at: Date.now() }
      setLocation(next)
      return { latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy }
    }
    setLocation({ type: 'error', message: pos.message })
    setAutoScan(false)
    return null
  }, [])

  useEffect(() => {
    void refreshLocation()
  }, [refreshLocation])

  /** Gönderimden hemen önce: konum tazeyse onu, eskiyse yenisini kullanır. */
  const currentLocation = useCallback(async () => {
    const loc = locationRef.current
    if (loc.type === 'ok' && Date.now() - loc.at < LOCATION_MAX_AGE_MS) {
      return { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy }
    }
    return refreshLocation()
  }, [refreshLocation])

  const locationOk = location.type === 'ok'
  const isBusy = result.type === 'loading' || countdown !== null
  const canSubmit = Boolean(cameraReady && tenant && locationOk && !isBusy && result.type !== 'success' && result.type !== 'notice')

  useEffect(() => {
    let cancelled = false

    async function startCamera() {
      try {
        setCameraError('')
        const nav = navigator as any
        const getUserMedia =
          navigator?.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices) ||
          nav.getUserMedia?.bind(nav) ||
          nav.webkitGetUserMedia?.bind(nav) ||
          nav.mozGetUserMedia?.bind(nav)

        if (!getUserMedia) {
          setCameraReady(false)
          setCameraError('Mobil tarayıcınız HTTP üzerinden canlı video akışını güvenlik nedeniyle kısıtlıyor. Lütfen aşağıdaki sarı butona basarak doğrudan telefon kamerasını kullanın.')
          return
        }

        const stream = await getUserMedia({
          video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 540 } },
          audio: false
        })

        if (cancelled) {
          stream.getTracks().forEach((track: any) => track.stop())
          return
        }

        streamRef.current = stream
        if (videoRef.current) {
          const video = videoRef.current
          video.srcObject = stream
          await video.play().catch(() => undefined)
          const syncAspect = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              setVideoAspect(video.videoWidth / video.videoHeight)
            }
          }
          syncAspect()
          video.addEventListener('loadedmetadata', syncAspect)
          video.addEventListener('resize', syncAspect)
        }
        setCameraReady(true)
      } catch (error: any) {
        if (!cancelled) {
          setCameraReady(false)
          setCameraError(error?.message || 'Kamera açılamadı. Aşağıdaki butonu kullanarak telefon kameranızla fotoğraf çekebilirsiniz.')
        }
      }
    }

    void startCamera()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])


  useEffect(() => {
    if (result.type !== 'error') return
    const timer = window.setTimeout(() => setResult({ type: 'idle' }), 7000)
    return () => window.clearTimeout(timer)
  }, [result])

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return null

    canvas.width = video.videoWidth || 720
    canvas.height = video.videoHeight || 540
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
  }, [])

  const stopAndLeave = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraReady(false)

    const qrUrl = tenant ? `/qr-checkin?tenant=${encodeURIComponent(tenant)}` : '/qr-checkin'
    navigate(qrUrl)
  }, [navigate, tenant])

  const submitWithFrame = useCallback(async (frame: string, silent = false) => {
    if (!tenant) return
    // Otomatik taramada her denemede "yüz eşleşmedi" basmak ekranı kullanılamaz kılıyordu;
    // sessiz modda yalnızca BAŞARI ve gerçek hatalar gösterilir, eşleşmeme sessizce yutulur.
    if (!silent) setResult({ type: 'loading' })

    try {
      const location = await currentLocation()
      if (!location) {
        // Konum yok: yüz gönderilmez, ekranda "konumu açın" kutusu duruyor.
        if (!silent) setResult({ type: 'idle' })
        return
      }
      const response = mode === 'check-in'
        ? await faceCheckIn(frame, tenant, location)
        : await faceCheckOut(frame, tenant, location)

      if (response.success) {
        setResult({
          type: 'success',
          name: response.employeeName ?? 'Çalışan',
          time: formatDateTime(mode === 'check-in' ? (response as any).checkInTime : (response as any).checkOutTime),
          distance: response.distance,
          offsite: Boolean((response as any).offsite)
        })
        return
      }

      // Hiz siniri: otomatik taramayi KAPATMIYORUZ, yalnizca birkac saniye duraklatiyoruz.
      // Kapatsaydik kullanicinin sayfayi yenilemesi gerekirdi; oysa kota kendiliginden
      // yenileniyor ve tarama kaldigi yerden devam edebiliyor.
      if (response.rateLimited) {
        backoffUntilRef.current = Date.now() + 6000
        setResult({ type: 'error', message: response.message || 'Sunucu yoğun, birazdan yeniden denenecek.' })
        return
      }

      const code = String(response.code ?? '')

      // Kişi tanındı ama giriş/çıkış gerekmiyor ("çıkışınız zaten yapıldı"): adıyla gösterilir,
      // tarama durur — yoksa aynı yüz her 1,2 sn'de yeniden okunup aynı cevabı alırdı.
      if (NOTICE_CODES.has(code)) {
        setAutoScan(false)
        setResult({ type: 'notice', name: response.employeeName, message: response.message || 'İşlem gerekmiyor.' })
        return
      }

      // Konum reddi: konum kapalıysa kutu "konumu açın" der; bölge dışındaysa hata gösterilir.
      // İkisinde de tarama durur, kullanıcı "Tekrar Dene" ile yeniden başlatır.
      if (LOCATION_ERROR_CODES.has(code)) {
        setAutoScan(false)
        if (code === 'location_required') {
          setLocation({ type: 'error', message: response.message || 'Konumunuz alınamadı. Lütfen konumu açın.' })
          setResult({ type: 'idle' })
        } else {
          setResult({ type: 'error', message: response.message || 'Mesai bölgesi dışındasınız.' })
        }
        return
      }

      // Sunucu hatası sessiz modda da gösterilir; yoksa ekran sonsuza dek "Yüz aranıyor…" der.
      if (code === 'server_error') {
        setAutoScan(false)
        setResult({ type: 'error', message: response.message || 'Sunucu hatası. Lütfen biraz sonra tekrar deneyin.' })
        return
      }

      if (!silent) setResult({ type: 'error', message: response.message || 'Yüz eşleşmedi.' })
    } catch (error: any) {
      // Ağ/servis hatası sessiz modda da gösterilir: sessizce denemeye devam etmek,
      // face-service kapalıyken kullanıcıyı sonsuza kadar bekletirdi.
      setResult({ type: 'error', message: error?.message || 'İşlem sırasında bir hata oluştu.' })
      setAutoScan(false)
    }
  }, [mode, tenant, currentLocation])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const src = ev.target?.result as string
      if (!src) return
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const maxDim = 800
        let w = img.width
        let h = img.height
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w)
            w = maxDim
          } else {
            w = Math.round((w * maxDim) / h)
            h = maxDim
          }
        }
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h)
          const b64 = canvas.toDataURL('image/jpeg', 0.86)
          void submitWithFrame(b64)
        }
      }
      img.src = src
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  /**
   * Kamera açıldığı andan itibaren kendiliğinden tarar.
   *
   * Eskiden kullanıcı butona basıyor, 3 saniye geri sayım sonrası TEK kare gönderiliyordu;
   * o an göz kırpma, ışık ya da açı bozuksa "yüz eşleşmedi" alıp baştan başlamak gerekiyordu.
   * Artık görüntü canlı kalır ve okuyana kadar arka planda denemeye devam eder.
   *
   * Aynı anda tek istek uçar (scanningRef); yoksa yavaş yanıtlarda istekler üst üste binip
   * servisi kilitliyordu.
   */
  useEffect(() => {
    if (!autoScan || !cameraReady || !tenant || !locationOk) return
    if (result.type === 'success' || result.type === 'notice' || countdown !== null) return

    let cancelled = false
    const timer = window.setInterval(async () => {
      if (cancelled || scanningRef.current) return
      if (Date.now() < backoffUntilRef.current) return
      scanningRef.current = true
      try {
        const frame = captureFrame()
        if (frame) {
          setAttempts((n) => n + 1)
          await submitWithFrame(frame, true)
        }
      } finally {
        scanningRef.current = false
      }
    }, 1200)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [autoScan, cameraReady, tenant, locationOk, result.type, countdown, captureFrame, submitWithFrame])

  /** "Tekrar Dene": konumu yeniden alır, mesajı temizler ve taramayı yeniden başlatır. */
  const retry = useCallback(async () => {
    setResult({ type: 'idle' })
    const loc = await refreshLocation()
    if (loc) setAutoScan(true)
  }, [refreshLocation])

  const submit = useCallback(async () => {
    if (!canSubmit) return

    for (let i = 3; i >= 1; i -= 1) {
      setCountdown(i)
      await new Promise((resolve) => window.setTimeout(resolve, 650))
    }
    setCountdown(null)

    const frame = captureFrame()
    if (!frame) {
      setResult({ type: 'error', message: 'Kamera görüntüsü yakalanamadı.' })
      return
    }

    await submitWithFrame(frame)
  }, [canSubmit, captureFrame, submitWithFrame])

  const frameClass = useMemo(() => {
    if (result.type === 'success') return config.ringClass
    if (result.type === 'error') return 'border-rose-400 shadow-rose-400/25'
    return 'border-white/70 shadow-white/10'
  }, [config.ringClass, result.type])

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-[520px] flex-col justify-center px-4 py-6 sm:py-8">
        <section className="space-y-4">
          <header className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={stopAndLeave}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
              aria-label="Geri"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Personel doğrulama</div>
              <h1 className="mt-1 truncate text-2xl font-extrabold text-white">{config.title}</h1>
            </div>

            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-950">
              <ModeIcon className="h-5 w-5" />
            </div>
          </header>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-center text-xs font-medium text-slate-300">
            Firma kodu: <span className="text-white">{tenant || '-'}</span>
          </div>

          {/* Native Mobile Camera Button */}
          <label className="flex items-center justify-center gap-2.5 w-full h-12 rounded-xl bg-[#c5a059] hover:bg-[#b88e53] text-[#141414] font-bold text-xs cursor-pointer shadow-lg transition active:scale-[0.99]">
            <Camera size={18} />
            <span>📱 Telefon Kamerasını Aç / Yüz Tara</span>
            <input
              type="file"
              accept="image/*"
              capture="user"
              onChange={handleFileInput}
              className="hidden"
              disabled={isBusy || result.type === 'success' || !locationOk}
            />
          </label>

          <div
            className="relative overflow-hidden rounded-lg border border-white/10 bg-black shadow-2xl"
            style={{ aspectRatio: String(videoAspect) }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)]"
            />
            <canvas ref={canvasRef} className="hidden" />

            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`rounded-[50%] border-2 shadow-[0_0_34px] transition ${frameClass}`}
                style={{ height: '78%', width: `${Math.min(80, 56.2 / videoAspect)}%` }}
              />
            </div>

            <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-[11px] font-semibold text-slate-200 backdrop-blur">
              {cameraReady ? 'Kamera hazır' : 'Kamera bekleniyor'}
            </div>

            {countdown !== null ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px]">
                <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white text-6xl font-black text-slate-950 shadow-2xl">
                  {countdown}
                </div>
              </div>
            ) : null}

            {cameraError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 p-6 text-center">
                <Camera className="h-10 w-10 text-rose-300" />
                <div className="mt-3 text-sm font-bold text-white">Canlı Kamera Akışı Kapalı</div>
                <div className="mt-2 max-w-xs text-xs leading-5 text-slate-300">{cameraError}</div>
                <div className="mt-4 text-[11px] text-[#c5a059] font-medium">Yukarıdaki sarı "📱 Telefon Kamerasını Aç" butonunu kullanabilirsiniz.</div>
              </div>
            ) : null}
          </div>

          {location.type === 'error' ? (
            <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-extrabold text-white">Lütfen konumunuzu açın</div>
                  <div className="mt-1 text-xs leading-5 text-amber-50">{location.message}</div>
                  <button
                    type="button"
                    onClick={() => void retry()}
                    className="mt-3 h-9 rounded-lg bg-amber-400 px-4 text-xs font-extrabold text-slate-950 transition hover:bg-amber-300"
                  >
                    Tekrar Dene
                  </button>
                </div>
              </div>
            </div>
          ) : location.type === 'pending' ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Konumunuz alınıyor…
            </div>
          ) : null}

          {result.type === 'notice' ? (
            <div className="rounded-lg border border-sky-400/30 bg-sky-500/10 p-4">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
                <div className="min-w-0 flex-1">
                  {result.name ? <div className="text-sm font-extrabold text-white">{result.name}</div> : null}
                  <div className="mt-1 whitespace-pre-line text-xs leading-5 text-sky-50">{result.message}</div>
                  <button
                    type="button"
                    onClick={() => void retry()}
                    className="mt-3 h-9 rounded-lg border border-white/15 bg-white/10 px-4 text-xs font-bold text-white transition hover:bg-white/15"
                  >
                    Tamam
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {result.type === 'success' ? (
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                <div className="min-w-0">
                  <div className="text-sm font-extrabold text-white">{config.successLabel}</div>
                  <div className="mt-1 text-sm text-emerald-50">{result.name}</div>
                  <div className="mt-1 text-xs text-emerald-100">{config.timeLabel}: {result.time}</div>
                  {result.offsite ? (
                    <div className="mt-1 text-xs font-semibold text-amber-200">Konum dışı çıkış olarak kaydedildi.</div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {result.type === 'error' ? (
            <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
                <div className="min-w-0">
                  <div className="text-sm font-extrabold text-white">İşlem tamamlanamadı</div>
                  <div className="mt-1 whitespace-pre-line text-xs leading-5 text-rose-50">{result.message}</div>
                </div>
              </div>
            </div>
          ) : null}

          {cameraReady && locationOk && result.type !== 'success' && result.type !== 'notice' ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs">
              {autoScan ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
                  <span className="font-bold text-emerald-200">Yüz aranıyor…</span>
                  <span className="text-slate-400">kameraya bakmanız yeterli</span>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void retry()}
                  className="font-bold text-emerald-300 underline"
                >
                  Otomatik taramayı yeniden başlat
                </button>
              )}
            </div>
          ) : null}

          {cameraReady && (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void submit()}
              className={`flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm font-extrabold text-white shadow-lg transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300 disabled:shadow-none ${config.buttonClass}`}
            >
              {result.type === 'loading' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {config.loadingLabel}
                </>
              ) : (
                <>
                  <Camera className="h-5 w-5" />
                  {config.actionLabel}
                </>
              )}
            </button>
          )}


          {result.type === 'success' ? (
            <button
              type="button"
              onClick={stopAndLeave}
              className="h-11 w-full rounded-lg border border-white/10 bg-white/5 text-sm font-bold text-slate-100 transition hover:bg-white/10"
            >
              Kapat
            </button>
          ) : null}

          {!tenant ? (
            <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-center text-xs font-semibold text-rose-100">
              Link hatalı: tenant bulunamadı.
            </div>
          ) : null}

          <footer className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
            <p className="text-[11px] leading-5 text-slate-400">
              Yüzünüzü çerçevenin içine hizalayın. Fotoğraf saklanmaz; doğrulama için yalnızca yüz vektörü kullanılır.
            </p>
          </footer>
        </section>
      </div>
    </main>
  )
}
