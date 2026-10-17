'use client'

import React, { useState, useEffect } from 'react'
import { isWithinCyprus } from '@/lib/cyprusLocation'

type LocationState = {
  status: 'idle' | 'checking' | 'verified_kktc' | 'blocked_outside' | 'manual_declared' | 'error'
  lat?: number
  lng?: number
  message?: string
}

export default function LocationVerifier({
  onStatusChange,
}: {
  onStatusChange?: (isValid: boolean) => void
}) {
  const [state, setState] = useState<LocationState>({ status: 'idle' })
  const [manualConfirm, setManualConfirm] = useState(false)

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setState({
        status: 'error',
        message: 'Tarayıcınız konum servisini desteklemiyor. Lütfen aşağıdaki beyan kutusunu onaylayın.',
      })
      return
    }

    setState({ status: 'checking', message: 'Konumunuz tespit ediliyor...' })

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        const inCyprus = isWithinCyprus(latitude, longitude)

        if (inCyprus) {
          setState({
            status: 'verified_kktc',
            lat: latitude,
            lng: longitude,
            message: 'Konumunuz başarıyla doğrulandı: Kuzey Kıbrıs (KKTC) sınırları içerisindesiniz.',
          })
          onStatusChange?.(true)
        } else {
          setState({
            status: 'blocked_outside',
            lat: latitude,
            lng: longitude,
            message:
              'Konumunuz Kıbrıs (KKTC) sınırları dışında (Türkiye veya diğer ülke) tespit edildi. Mağazamız yalnızca Kuzey Kıbrıs Türk Cumhuriyeti sınırları içerisine satış ve teslimat yapmaktadır.',
          })
          onStatusChange?.(false)
        }
      },
      (err) => {
        let msg = 'Konum izni alınamadı.'
        if (err.code === err.PERMISSION_DENIED) {
          msg = 'Konum erişimine izin verilmedi. Teslimat için lütfen aşağıdaki KKTC onay kutusunu işaretleyin.'
        }
        setState({
          status: 'error',
          message: msg,
        })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  const handleManualCheck = (checked: boolean) => {
    setManualConfirm(checked)
    if (checked) {
      setState((prev) => (prev.status === 'blocked_outside' ? prev : { status: 'manual_declared' }))
      if (state.status !== 'blocked_outside') {
        onStatusChange?.(true)
      }
    } else {
      if (state.status === 'manual_declared') {
        setState({ status: 'idle' })
        onStatusChange?.(false)
      }
    }
  }

  useEffect(() => {
    // Notify parent initial status
    if (state.status === 'verified_kktc' || (state.status === 'manual_declared' && manualConfirm)) {
      onStatusChange?.(true)
    }
  }, [state.status, manualConfirm, onStatusChange])

  return (
    <div className={`location-verifier-card ${state.status}`}>
      <div className="loc-head">
        <div className="loc-icon-wrapper">
          {state.status === 'verified_kktc' && <span className="loc-badge-icon ok">✅</span>}
          {state.status === 'blocked_outside' && <span className="loc-badge-icon error">🚫</span>}
          {state.status === 'checking' && <span className="loc-badge-icon spin">🧭</span>}
          {(state.status === 'idle' || state.status === 'manual_declared' || state.status === 'error') && (
            <span className="loc-badge-icon default">📍</span>
          )}
        </div>
        <div className="loc-titles">
          <h4 className="loc-title">Teslimat Konumu &amp; KKTC Satış Şartı</h4>
          <p className="loc-desc">
            Mağazamız sadece <b>Kuzey Kıbrıs Türk Cumhuriyeti (KKTC)</b> içi adrese teslimat yapmaktadır.
          </p>
        </div>
      </div>

      {state.status === 'blocked_outside' ? (
        <div className="loc-alert-box loc-alert-danger">
          <div className="loc-alert-icon">⚠️</div>
          <div>
            <strong>Sipariş Oluşturulamaz (Bölge Dışı)</strong>
            <p>{state.message}</p>
            <p className="loc-sub-note">
              Türkiye veya yurt dışı adreslere gönderim yapılmamaktadır. Sipariş verebilmek için teslimatınızın KKTC sınırları içerisinde olması gerekmektedir.
            </p>
          </div>
        </div>
      ) : state.status === 'verified_kktc' ? (
        <div className="loc-alert-box loc-alert-success">
          <div className="loc-alert-icon">✓</div>
          <div>
            <strong>KKTC Konumu Doğrulandı</strong>
            <p>{state.message}</p>
          </div>
        </div>
      ) : (
        <div className="loc-action-box">
          {state.message && <p className="loc-info-msg">{state.message}</p>}

          <div className="loc-buttons-row">
            <button
              type="button"
              className="btn-loc-verify"
              onClick={handleGetLocation}
              disabled={state.status === 'checking'}
            >
              {state.status === 'checking' ? 'Konum Alınıyor…' : '📡 Teslimat Konumumu Doğrula (GPS)'}
            </button>
          </div>

          <label className="loc-checkbox-label">
            <input
              type="checkbox"
              checked={manualConfirm}
              onChange={(e) => handleManualCheck(e.target.checked)}
            />
            <span>
              Teslimat adresimin ve alıcının <b>Kuzey Kıbrıs Türk Cumhuriyeti (KKTC)</b> sınırları içerisinde olduğunu beyan ve taahhüt ediyorum.
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
