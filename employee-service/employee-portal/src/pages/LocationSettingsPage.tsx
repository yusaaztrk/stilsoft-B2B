import React, { useEffect, useRef, useState } from 'react'
import { MapPin, Compass, Lock, Unlock, Save, RefreshCw, AlertCircle, Search, Home } from 'lucide-react'
import SupheliIslemler from '../components/SupheliIslemler'
import Layout from '../components/Layout'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import { API_BASE_URL } from '../config/api'
import { useTenantBranding } from '../hooks/useTenantBranding'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker icon issues with Leaflet under Vite/React
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

type LocationSetting = {
  id: number
  /** Konumun adı — "Mağaza", "Depo" gibi. */
  name: string
  latitude: number
  longitude: number
  maxDistanceInMeters: number
  isActive: boolean
  /** Bölge dışından çıkışa izin (2026-10-16): konum yine zorunlu, çıkış "konum dışı" işaretlenir. */
  allowOffsiteCheckOut?: boolean
  /** Bu konuma bağlı aktif personel sayısı (sunucudan gelir). */
  employeeCount?: number
}

export default function LocationSettingsPage() {
  const { branding } = useTenantBranding()
  const primaryColor = branding?.headerGradientFrom || '#4f46e5'

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fetchingGps, setFetchingGps] = useState(false)
  const [searchingAddress, setSearchingAddress] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Firmanin birden fazla noktasi olabilir; sayfa tek kayit yerine LISTE yonetir.
  const [locations, setLocations] = useState<LocationSetting[]>([])

  const [setting, setSetting] = useState<LocationSetting>({
    id: 0,
    name: '',
    latitude: 39.92077,
    longitude: 32.85411,
    maxDistanceInMeters: 100,
    isActive: false,
  })

  const [notification, setNotification] = useState<{
    isOpen: boolean
    title: string
    message: string
    variant: NotificationVariant
  }>({
    isOpen: false,
    title: '',
    message: '',
    variant: 'info',
  })

  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const circleRef = useRef<L.Circle | null>(null)

  const showNotification = (title: string, message: string, variant: NotificationVariant) => {
    setNotification({ isOpen: true, title, message, variant })
  }

  const loadSettings = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')
      const tenantCode = localStorage.getItem('tenantCode')

      const res = await fetch(`${API_BASE_URL}/api/EmployeeLocationSettings`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {}),
        },
      })

      if (!res.ok) {
        throw new Error('Konum ayarları yüklenemedi.')
      }

      const json = await res.json()
      const list: LocationSetting[] = Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : []
      setLocations(list)

      // Duzenlenen kayit listede kaldiysa onu tazele; yoksa ilk konuma don.
      setSetting((prev) => {
        const stillThere = prev.id > 0 ? list.find((x) => x.id === prev.id) : null
        if (stillThere) return stillThere
        return list[0] ?? { id: 0, name: '', latitude: 39.92077, longitude: 32.85411, maxDistanceInMeters: 100, isActive: false }
      })
    } catch (err: any) {
      showNotification('Hata', err.message || 'Ayarlar yüklenirken bir hata oluştu.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
  }, [])

  // Initialize and destroy map
  useEffect(() => {
    if (loading) return

    const container = document.getElementById('settings-map')
    if (!container) return

    const initialLat = setting.latitude || 39.92077
    const initialLng = setting.longitude || 32.85411
    const zoomLevel = setting.latitude && setting.longitude ? 16 : 6

    if (!mapRef.current) {
      // Fix leaflet marker icon paths
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconUrl: markerIcon,
        iconRetinaUrl: markerIcon2x,
        shadowUrl: markerShadow,
      })

      const map = L.map('settings-map', {
        zoomControl: true,
      }).setView([initialLat, initialLng], zoomLevel)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map)

      const marker = L.marker([initialLat, initialLng], {
        draggable: true
      }).addTo(map)

      const circle = L.circle([initialLat, initialLng], {
        color: primaryColor,
        fillColor: primaryColor,
        fillOpacity: 0.25,
        radius: setting.maxDistanceInMeters
      }).addTo(map)

      // Handle marker drag event
      marker.on('dragend', () => {
        const latLng = marker.getLatLng()
        setSetting((prev) => ({
          ...prev,
          latitude: Number(latLng.lat.toFixed(8)),
          longitude: Number(latLng.lng.toFixed(8))
        }))
        circle.setLatLng(latLng)
      })

      // Handle map click event
      map.on('click', (e) => {
        const latLng = e.latlng
        marker.setLatLng(latLng)
        circle.setLatLng(latLng)
        setSetting((prev) => ({
          ...prev,
          latitude: Number(latLng.lat.toFixed(8)),
          longitude: Number(latLng.lng.toFixed(8))
        }))
      })

      mapRef.current = map
      markerRef.current = marker
      circleRef.current = circle
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        markerRef.current = null
        circleRef.current = null
      }
    }
  }, [loading])

  // Synchronize Map Position and Circle Radius when settings state changes
  useEffect(() => {
    if (mapRef.current && markerRef.current && circleRef.current) {
      const lat = Number(setting.latitude) || 0
      const lng = Number(setting.longitude) || 0
      if (lat && lng) {
        const currentLatLng = markerRef.current.getLatLng()
        if (Number(currentLatLng.lat.toFixed(8)) !== lat || Number(currentLatLng.lng.toFixed(8)) !== lng) {
          const newPos = L.latLng(lat, lng)
          markerRef.current.setLatLng(newPos)
          circleRef.current.setLatLng(newPos)
          mapRef.current.setView(newPos, mapRef.current.getZoom())
        }
      }
      circleRef.current.setRadius(setting.maxDistanceInMeters)
      circleRef.current.setStyle({
        color: primaryColor,
        fillColor: primaryColor
      })
    }
  }, [setting.latitude, setting.longitude, setting.maxDistanceInMeters, primaryColor])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setSaving(true)
      const token = localStorage.getItem('accessToken')
      const tenantCode = localStorage.getItem('tenantCode')

      const res = await fetch(`${API_BASE_URL}/api/EmployeeLocationSettings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {}),
        },
        body: JSON.stringify({
          latitude: Number(setting.latitude),
          longitude: Number(setting.longitude),
          id: setting.id,
          name: setting.name?.trim() || 'Konum',
          maxDistanceInMeters: Number(setting.maxDistanceInMeters),
          isActive: setting.isActive,
          allowOffsiteCheckOut: Boolean(setting.allowOffsiteCheckOut),
        }),
      })

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null)
        throw new Error(errorJson?.message || 'Ayarlar kaydedilemedi.')
      }

      const json = await res.json()
      if (json.success && json.data) {
        setSetting(json.data)
        showNotification('Başarılı', 'Konum ve mesafe ayarları başarıyla güncellendi.', 'success')
      }
    } catch (err: any) {
      showNotification('Hata', err.message || 'Ayarlar kaydedilirken bir hata oluştu.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const getBrowserLocation = () => {
    if (!navigator.geolocation) {
      showNotification('Desteklenmiyor', 'Tarayıcınız konum servislerini desteklemiyor.', 'error')
      return
    }

    setFetchingGps(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude.toFixed(8))
        const lng = Number(position.coords.longitude.toFixed(8))
        setSetting((prev) => ({
          ...prev,
          latitude: lat,
          longitude: lng,
        }))
        setFetchingGps(false)
        showNotification('Konum Alındı', 'Mevcut koordinatlarınız haritaya yansıtıldı.', 'success')
      },
      (error) => {
        setFetchingGps(false)
        let errorMsg = 'Konumunuz alınamadı. Lütfen tarayıcı konum izinlerini kontrol ediniz.'
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = 'Konum izni reddedildi. Adres çubuğundan konum erişimine izin verin.'
        }
        showNotification('Konum Hatası', errorMsg, 'error')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleSearchAddress = async (e: React.FormEvent) => {
    e.preventDefault()
    const query = searchQuery.trim()
    if (!query) return

    try {
      setSearchingAddress(true)
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`)
      if (!res.ok) throw new Error('Adres aranamadı.')
      const json = await res.json()
      if (json && json.length > 0) {
        const result = json[0]
        const lat = Number(result.lat)
        const lon = Number(result.lon)

        setSetting((prev) => ({
          ...prev,
          latitude: lat,
          longitude: lon,
        }))
        showNotification('Bulundu', `Harita aranan konuma taşındı: ${result.display_name}`, 'success')
      } else {
        showNotification('Bulunamadı', 'Aradığınız konum bulunamadı. Lütfen daha belirgin yazmayı deneyin.', 'info')
      }
    } catch (err: any) {
      showNotification('Arama Hatası', err.message || 'Adres aranırken hata oluştu.', 'error')
    } finally {
      setSearchingAddress(false)
    }
  }

  return (
    <Layout>
      <NotificationPopup
        isOpen={notification.isOpen}
        title={notification.title}
        message={notification.message}
        variant={notification.variant}
        onClose={() => setNotification((prev) => ({ ...prev, isOpen: false }))}
      />

      <div className="space-y-6">
        {/* Title Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-[#eae6dd] rounded-xl p-5 shadow-card">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-[#faf7f2] border border-[#eae6dd] rounded-lg text-[#8c6538]">
              <Compass size={20} className="text-[#8c6538]" />
            </div>
            <div>
              <h1 className="font-serif text-2xl md:text-3xl font-normal tracking-tight text-[#1a1a1a]">
                Geofence Konum Ayarları
              </h1>
              <p className="text-xs text-neutral-500 font-normal">
                Çalışanların mesai girişlerini yapabileceği fiziksel alanı harita üzerinden belirleyin.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={getBrowserLocation}
              disabled={fetchingGps}
              className="btn-editorial"
            >
              <Compass size={12} className={fetchingGps ? 'animate-spin text-[#c5a059]' : 'text-neutral-500'} />
              <span>{fetchingGps ? 'Bulunuyor...' : 'Konumumu Yakala'}</span>
            </button>

            <button
              type="button"
              onClick={() => void loadSettings()}
              disabled={loading}
              className="btn-editorial px-2.5"
              title="Yenile"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="h-96 rounded-xl border border-[#eae6dd] bg-white flex flex-col items-center justify-center space-y-3">
            <RefreshCw className="animate-spin text-[#c5a059]" size={28} />
            <div className="text-neutral-400 text-xs font-serif italic">Ayarlar Yükleniyor...</div>
          </div>
        ) : (

          <>
          {/* Tanimli konumlar: firmanin birden fazla noktasi olabilir (magaza, depo). */}
          <div className="mb-4 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                Tanımlı Konumlar ({locations.length})
              </div>
              <button
                type="button"
                onClick={() =>
                  setSetting({ id: 0, name: '', latitude: 39.92077, longitude: 32.85411, maxDistanceInMeters: 100, isActive: true })
                }
                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                + Yeni Konum
              </button>
            </div>

            {locations.length === 0 ? (
              <div className="text-xs text-neutral-400">
                Henüz konum tanımlanmadı. Aşağıdan ilk konumu ekleyin.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {locations.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setSetting(l)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                      setting.id === l.id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold">{l.name || 'İsimsiz konum'}</div>
                    <div className={setting.id === l.id ? 'text-slate-300' : 'text-neutral-400'}>
                      {l.maxDistanceInMeters} m · {l.employeeCount ?? 0} personel
                      {l.isActive ? '' : ' · pasif'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* LEFT COLUMN: Map Area (8cols) */}
            <div className="lg:col-span-8 space-y-4">
              <div className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-card flex flex-col">
                
                {/* Geocoder / Map Search bar */}
                <div className="p-4 bg-slate-50/80 border-b border-slate-200/80 flex items-center gap-3">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="Şehir, ilçe, sokak veya iş yeri ara..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void handleSearchAddress(e)
                        }
                      }}
                      className="input-base pr-10"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        void handleSearchAddress(e)
                      }}
                      disabled={searchingAddress}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center transition disabled:opacity-50"
                      title="Ara"
                    >
                      {searchingAddress ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
                    </button>
                  </div>
                </div>

                {/* Map Container */}
                <div className="relative">
                  <div
                    id="settings-map"
                    className="h-[480px] w-full z-10"
                    style={{ minHeight: '400px' }}
                  />
                  
                  {/* Floating Map Tip */}
                  <div className="absolute bottom-4 left-4 z-[400] bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2 text-[11px] text-white font-bold flex items-center gap-2 shadow-2xl backdrop-blur-sm pointer-events-none">
                    <MapPin size={13} className="text-blue-400" />
                    <span>Haritaya tıklayarak veya işaretçiyi sürükleyerek konumu belirleyin.</span>
                  </div>
                </div>
              </div>

              {/* Geo Info Note */}
              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 flex gap-3.5 items-start">
                <AlertCircle className="shrink-0 mt-0.5 text-blue-600" size={18} />
                <div className="space-y-1">
                  <h4 className="font-extrabold text-slate-900 text-xs">Konum Sınırlandırması Nedir?</h4>
                  <p className="text-[11px] text-slate-600 leading-normal font-medium">
                    Geofence kısıtlaması aktif olduğunda çalışanlar sadece harita üzerinde mavi çember ile gösterilen dairesel alanın içinde bulunduklarında mesaiye başlayabilirler. Çıkış yaparken konum bilgisi alınır ancak engelleyici bir geofence kısıtlaması uygulanmaz.
                  </p>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Settings Panel (4cols) */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* Radius & Toggle Settings */}
              <div className="rounded-2xl border border-slate-200/90 bg-white p-6 space-y-6 shadow-card">
                <div>
                  <h3 className="font-black text-slate-900 text-base">Sınırlandırma Paneli</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Konum doğrulama kurallarını ve yayınlama durumunu yönetin.</p>
                </div>

                {/* Publish Switch */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="flex items-center gap-3">
                    {setting.isActive ? (
                      <Lock className="text-emerald-600 w-5 h-5 shrink-0" />
                    ) : (
                      <Unlock className="text-amber-600 w-5 h-5 shrink-0" />
                    )}
                    <div>
                      <div className="text-xs font-black text-slate-900 tracking-wide uppercase">
                        {setting.isActive ? 'Kısıtlama Aktif' : 'Devre Dışı'}
                      </div>
                      <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                        {setting.isActive ? 'Girişte konum istenir' : 'Konum kontrolü kapalı'}
                      </div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={setting.isActive}
                      onChange={(e) => setSetting((prev) => ({ ...prev, isActive: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div 
                      className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                    ></div>
                  </label>
                </div>

                {/* Konum dışı çıkış (2026-10-16) */}
                <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="flex items-center gap-3 min-w-0">
                    <Home className={`w-5 h-5 shrink-0 ${setting.allowOffsiteCheckOut ? 'text-sky-600' : 'text-slate-400'}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-black text-slate-900 tracking-wide uppercase">Konum Dışı Çıkış</div>
                      <div className="text-[10px] text-slate-500 font-semibold mt-0.5 leading-4">
                        {setting.allowOffsiteCheckOut
                          ? 'Mesai bitince bölgeye uğramadan eve/sahaya giden personel her yerden çıkış yapabilir; konum yine alınır, çıkış "konum dışı" işaretlenir.'
                          : 'Çıkış yalnız bölge içinden yapılabilir.'}
                      </div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(setting.allowOffsiteCheckOut)}
                      onChange={(e) => setSetting((prev) => ({ ...prev, allowOffsiteCheckOut: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-600"></div>
                  </label>
                </div>

                {/* Preset Radius Buttons */}
                <div className="space-y-3">
                  <label htmlFor="loc-name" className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    Konum Adı
                  </label>
                  <input
                    id="loc-name"
                    value={setting.name ?? ''}
                    onChange={(e) => setSetting((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Örn. Mağaza, Depo"
                    className="input-base mb-4"
                  />

                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Kapsama Yarıçapı (Mesafe)</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[50, 100, 250, 500].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setSetting((prev) => ({ ...prev, maxDistanceInMeters: val }))}
                        className={`h-10 rounded-xl text-xs font-extrabold transition border ${
                          setting.maxDistanceInMeters === val
                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {val} Metre
                      </button>
                    ))}
                  </div>

                  <div className="pt-1">
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        required
                        value={setting.maxDistanceInMeters}
                        onChange={(e) => setSetting((prev) => ({ ...prev, maxDistanceInMeters: Math.max(1, Number(e.target.value)) }))}
                        className="input-base pr-14 font-bold"
                        placeholder="Özel mesafe girin..."
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">Metre</span>
                    </div>
                  </div>
                </div>

                {/* Coordinate Readonly Details */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Merkez Koordinatları</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex flex-col">
                      <span className="text-[9px] text-slate-400 font-extrabold uppercase">Enlem (Lat)</span>
                      <span className="text-xs font-black text-slate-800 mt-1 truncate">{setting.latitude.toFixed(6)}</span>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex flex-col">
                      <span className="text-[9px] text-slate-400 font-extrabold uppercase">Boylam (Lng)</span>
                      <span className="text-xs font-black text-slate-800 mt-1 truncate">{setting.longitude.toFixed(6)}</span>
                    </div>
                  </div>
                </div>

                {/* Save Button */}
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-navy w-full h-11 text-xs"
                >
                  <Save size={15} />
                  <span>{saving ? 'Kaydediliyor...' : setting.id > 0 ? 'Değişiklikleri Kaydet' : 'Konumu Ekle'}</span>
                </button>
              </div>
            </div>

          </form>

          <SupheliIslemler />
          </>
        )}
      </div>
    </Layout>
  )
}

