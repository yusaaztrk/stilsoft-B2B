import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { faceCheckIn } from '../api/faceAuth'

type ResultState = { type: 'idle' } | { type: 'loading' } | { type: 'success'; name: string; time: string; distance?: number } | { type: 'error'; message: string }

export default function FaceCheckInPage() {
  const [sp] = useSearchParams()
  const tenant = String(sp.get('tenant') ?? '').trim()
  const navigate = useNavigate()

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [cameraReady, setCameraReady] = useState(false)
  /**
   * Akisin gercek en/boy orani. Video'ya `minHeight: 320` verilmisti; dar ekranda
   * dogal yukseklik bunun altina dusunce tarayici goruntuyu dikey olarak ESNETIYOR
   * (object-fit varsayilani `fill`). Kutuya akisin kendi oranini verip videoyu
   * `object-fit: cover` ile yerlestirince ne esneme ne kirpma kaliyor.
   */
  const [videoAspect, setVideoAspect] = useState(4 / 3)
  const [cameraError, setCameraError] = useState('')
  const [result, setResult] = useState<ResultState>({ type: 'idle' })
  const [countdown, setCountdown] = useState<number | null>(null)

  // Start camera
  useEffect(() => {
    let cancelled = false

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          const video = videoRef.current
          video.srcObject = stream
          video.play().catch(() => {})
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
      } catch (e: any) {
        if (!cancelled) {
          setCameraError(e?.message || 'Kamera açılamadı. Lütfen kamera izni verin.')
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Capture frame as base64
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return null

    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.85)
  }, [])

  // Get location
  // KONUM ALINAMAZSA İŞLEM DURUR — 0,0 GÖNDERİLMEZ.
  //
  // Önceden hem "tarayıcı desteklemiyor" hem "kullanıcı izni reddetti" durumunda
  // `{ latitude: 0, longitude: 0 }` dönülüyordu. Sunucudaki geofence (mesafe) kontrolü
  // gerçek bir koordinat bekliyor; 0,0 ile gönderilen istek konum doğrulamasını fiilen
  // atlıyordu. Sonuç: konum iznini kapatan çalışan evinden yüz okutup mesaide görünebiliyordu.
  const getLocation = (): Promise<{ latitude: number; longitude: number }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Bu cihaz konum bilgisi sağlamıyor. Giriş yapılamaz.'))
        return
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => reject(new Error('Konum izni verilmedi. Giriş için konum erişimine izin vermelisiniz.')),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      )
    })
  }

  // Handle check-in with countdown
  const handleCheckIn = useCallback(async () => {
    if (result.type === 'loading') return

    // 3-2-1 countdown
    for (let i = 3; i >= 1; i--) {
      setCountdown(i)
      await new Promise((r) => setTimeout(r, 700))
    }
    setCountdown(null)

    const frame = captureFrame()
    if (!frame) {
      setResult({ type: 'error', message: 'Kamera görüntüsü yakalanamadı' })
      return
    }

    setResult({ type: 'loading' })

    try {
      const loc = await getLocation()
      const res = await faceCheckIn(frame, tenant, loc)

      if (res.success) {
        setResult({
          type: 'success',
          name: res.employeeName ?? 'Çalışan',
          time: res.checkInTime ? new Date(res.checkInTime).toLocaleString('tr-TR') : new Date().toLocaleString('tr-TR'),
          distance: res.distance
        })
      } else {
        setResult({ type: 'error', message: res.message || 'Yüz eşleşmedi' })
      }
    } catch (e: any) {
      setResult({ type: 'error', message: e?.message || 'Bir hata oluştu' })
    }
  }, [captureFrame, result.type, tenant])

  // Auto-reset only error state (success should stay locked until user closes)
  useEffect(() => {
    if (result.type !== 'error') return
    const timer = setTimeout(() => setResult({ type: 'idle' }), 6000)
    return () => clearTimeout(timer)
  }, [result])

  const handleClose = useCallback(() => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    } catch {
      // ignore
    }

    setCameraReady(false)

    // Attempt to close the window (works if opened by script), otherwise navigate back.
    try {
      window.close()
    } catch {
      // ignore
    }
    const qrUrl = tenant ? `/qr-checkin?tenant=${encodeURIComponent(tenant)}` : '/qr-checkin'
    navigate(qrUrl)
  }, [navigate, tenant])

  const fmtTime = () => {
    return new Date().toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      fontFamily: "'Inter', 'Segoe UI', sans-serif"
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          fontSize: 28,
          fontWeight: 800,
          color: '#f1f5f9',
          letterSpacing: '-0.02em'
        }}>
          🔐 Yüz ile Giriş
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
          Tenant: {tenant || '—'} • {fmtTime()}
        </div>
      </div>

      {/* Camera Container */}
      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: 480,
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        border: '2px solid rgba(255,255,255,0.1)',
        background: '#000',
        aspectRatio: String(videoAspect)
      }}>
        {/* Video */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'cover',
            transform: 'scaleX(-1)'
          }}
        />

        {/* Face Guide Overlay */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none'
        }}>
          <div style={{
            // Oval yuz orani (~0.72 en/boy) korunacak sekilde kutuya gore olceklenir.
            width: `${Math.min(80, 56.2 / videoAspect)}%`,
            height: '78%',
            borderRadius: '50%',
            border: `3px solid ${result.type === 'success' ? '#22c55e' : result.type === 'error' ? '#ef4444' : 'rgba(255,255,255,0.4)'}`,
            boxShadow: result.type === 'success'
              ? '0 0 30px rgba(34,197,94,0.4)'
              : result.type === 'error'
                ? '0 0 30px rgba(239,68,68,0.4)'
                : '0 0 20px rgba(255,255,255,0.1)',
            transition: 'all 0.3s ease'
          }} />
        </div>

        {/* Countdown Overlay */}
        {countdown !== null && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.3)',
            pointerEvents: 'none'
          }}>
            <div style={{
              fontSize: 96,
              fontWeight: 900,
              color: '#fff',
              textShadow: '0 4px 20px rgba(0,0,0,0.5)',
              animation: 'pulse 0.7s ease-in-out'
            }}>
              {countdown}
            </div>
          </div>
        )}

        {/* Result Overlay */}
        {result.type === 'success' && (
          <div style={{
            position: 'absolute',
            bottom: 0, left: 0, right: 0,
            background: 'linear-gradient(transparent, rgba(22,163,74,0.95))',
            padding: '40px 20px 20px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Giriş Başarılı</div>
            <div style={{ fontSize: 15, color: '#dcfce7', marginTop: 4 }}>{result.name}</div>
            <div style={{ fontSize: 12, color: '#bbf7d0', marginTop: 2 }}>{result.time}</div>
          </div>
        )}

        {result.type === 'error' && (
          <div style={{
            position: 'absolute',
            bottom: 0, left: 0, right: 0,
            background: 'linear-gradient(transparent, rgba(220,38,38,0.95))',
            padding: '40px 20px 20px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>❌</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Giriş Başarısız</div>
            <div style={{ fontSize: 13, color: '#fecaca', marginTop: 4 }}>{result.message}</div>
          </div>
        )}

        {/* Camera error */}
        {cameraError && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.85)',
            padding: 24,
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
            <div style={{ fontSize: 14, color: '#f87171', fontWeight: 600 }}>Kamera Hatası</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, maxWidth: 280 }}>{cameraError}</div>
          </div>
        )}
      </div>

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Action button */}
      <button
        type="button"
        disabled={!cameraReady || !tenant || result.type === 'loading' || countdown !== null || result.type === 'success'}
        onClick={() => void handleCheckIn()}
        style={{
          marginTop: 24,
          width: '100%',
          maxWidth: 480,
          height: 56,
          borderRadius: 14,
          border: 'none',
          fontSize: 16,
          fontWeight: 700,
          cursor: (!cameraReady || !tenant || result.type === 'loading' || result.type === 'success') ? 'not-allowed' : 'pointer',
          color: '#fff',
          background: result.type === 'loading'
            ? 'linear-gradient(135deg, #4b5563 0%, #374151 100%)'
            : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          boxShadow: result.type === 'loading'
            ? 'none'
            : '0 10px 25px -5px rgba(37,99,235,0.4)',
          transition: 'all 0.2s ease',
          opacity: (!cameraReady || !tenant) ? 0.5 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8
        }}
      >
        {result.type === 'loading' ? (
          <>
            <span style={{
              width: 20, height: 20,
              border: '3px solid rgba(255,255,255,0.3)',
              borderTopColor: '#fff',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block'
            }} />
            Yüz tanınıyor...
          </>
        ) : (
          <>📸 Yüz ile Giriş Yap</>
        )}
      </button>

      {result.type === 'success' && (
        <button
          type="button"
          onClick={handleClose}
          style={{
            marginTop: 12,
            width: '100%',
            maxWidth: 480,
            height: 44,
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.18)',
            fontSize: 14,
            fontWeight: 800,
            cursor: 'pointer',
            color: '#e2e8f0',
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(6px)'
          }}
        >
          Kapat
        </button>
      )}

      {/* Tenant missing warning */}
      {!tenant && (
        <div style={{
          marginTop: 12,
          fontSize: 12,
          fontWeight: 600,
          color: '#f87171',
          textAlign: 'center'
        }}>
          Link hatalı: tenant bulunamadı.
        </div>
      )}

      {/* Info note */}
      <div style={{
        marginTop: 16,
        fontSize: 11,
        color: '#64748b',
        textAlign: 'center',
        maxWidth: 400
      }}>
        Yüzünüzü ekrandaki çerçeveye hizalayın ve "Yüz ile Giriş Yap" butonuna basın.
        <br />
        Konum izni vererek giriş kaydınıza konum bilgisi eklenebilir.
      </div>

      {/* KVKK Notice */}
      <div style={{
        marginTop: 20,
        padding: '10px 16px',
        borderRadius: 10,
        background: 'rgba(251, 191, 36, 0.1)',
        border: '1px solid rgba(251, 191, 36, 0.2)',
        maxWidth: 480,
        width: '100%'
      }}>
        <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 600, marginBottom: 4 }}>
          🔒 KVKK Bilgilendirme
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
          Yüz tanıma verileri biyometrik veri kapsamındadır. Fotoğrafınız saklanmaz, yalnızca matematiksel
          vektör (embedding) kullanılır. Yüz kaydınızı istediğiniz zaman sildirebilirsiniz.
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
