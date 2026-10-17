import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { 
  RefreshCw, 
  MapPin, 
  Compass, 
  AlertCircle, 
  Search
} from 'lucide-react'

import { isSuperAdminSession } from '../auth/storage'
import { useTechnicianLocations } from '../hooks/useTechnicians'
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})
L.Marker.prototype.options.icon = DefaultIcon

// Helper to center the map when a technician is selected
function MapController({ center }: { center: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (center) {
      map.setView(center, 15, { animate: true })
    }
  }, [center, map])
  return null
}

/**
 * "Son görülme" metni.
 *
 * Yalnızca saat gösteriliyordu ("14:32"). Şarjı iki gün önce biten bir telefonda bu, bugün
 * 14:32'de oradaymış gibi okunuyor — haritadaki iğne zaten son bilinen noktada duruyor, yani
 * yanlış okuma doğrudan yanlış karara dönüşüyor. Bir günü geçtiyse tarih de yazılır.
 */
function formatLastSeen(iso?: string | null): string {
  if (!iso) return 'hiç konum gelmedi'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'bilinmiyor'

  const dakika = Math.floor((Date.now() - t) / 60000)
  if (dakika < 1) return 'az önce'
  if (dakika < 60) return `${dakika} dk önce`

  const saat = Math.floor(dakika / 60)
  if (saat < 24) return `${saat} sa önce`

  const gun = Math.floor(saat / 24)
  const tarih = new Date(t).toLocaleString('tr-TR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  return `${gun} gün önce (${tarih})`
}

const createLiveTechIcon = (initials: string, isSelected: boolean, status: string, isOnline: boolean) => {
  const ring = isSelected 
    ? 'ring-4 ring-rose-500/50 scale-110 shadow-[0_0_15px_rgba(244,63,94,0.6)]' 
    : 'border-2 border-white'
  
  let statusColor = 'bg-gradient-to-tr from-slate-500 to-slate-600' // Default Gray (Offline)
  if (isOnline) {
    if (status === 'OnField') {
      statusColor = 'bg-gradient-to-tr from-blue-500 to-indigo-500' // Blue for OnField
    } else if (status === 'OnBreak') {
      statusColor = 'bg-gradient-to-tr from-amber-500 to-orange-500' // Amber for OnBreak
    } else {
      statusColor = 'bg-gradient-to-tr from-emerald-500 to-teal-500' // Green for Available/Online
    }
  }

  return L.divIcon({
    className: 'custom-live-tech-marker',
    html: `<div class="w-10 h-10 rounded-full flex items-center justify-center shadow-lg font-bold text-sm text-white transition-all ${statusColor} ${ring}">${initials}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
  })
}

export default function TeknisyenTakipPage() {
  // Kendi kopyası yerine ortak tanım. Buradaki liste 'admin'i de süper admin sayıyordu ve
  // B2B'den gelen teknisyen olmayan HERKES varsayılan olarak "Admin" etiketiyle geliyor —
  // yani bu sayfa fiilen herkese açıktı. Bkz. auth/storage.ts:isSuperAdminSession.
  const isSuperAdmin = isSuperAdminSession()

  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [selectedTechCoords, setSelectedTechCoords] = useState<[number, number] | null>(null)
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)

  // Listen to dark mode changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const { locations, isLoading, refetch } = useTechnicianLocations()

  // Redirect unauthorized users
  if (!isSuperAdmin) {
    return <Navigate to="/" replace />
  }

  const isWithinCyprus = (la: number, ln: number) => {
    return la >= 34.0 && la <= 36.0 && ln >= 32.0 && ln <= 35.0
  }

  const resolvedLocations = useMemo(() => {
    return locations.map((loc, idx) => {
      let lat = loc.latitude != null ? Number(loc.latitude) : null
      let lng = loc.longitude != null ? Number(loc.longitude) : null
      let hasValidCoords = lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && isWithinCyprus(lat, lng)

      if (!hasValidCoords) {
        // Fallback to Nicosia with a small deterministic offset based on index so markers don't overlap
        lat = 35.1856 + (idx * 0.006 - 0.003)
        lng = 33.3823 + (idx * 0.006 - 0.003)
      }

      return {
        ...loc,
        latitude: lat!,
        longitude: lng!,
        hasRealGps: hasValidCoords
      }
    })
  }, [locations])

  const filteredLocations = useMemo(() => {
    return resolvedLocations.filter(loc => 
      loc.fullName?.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [resolvedLocations, searchQuery])

  // Count active / inactive online statuses
  const stats = useMemo(() => {
    const total = resolvedLocations.length
    const active = resolvedLocations.filter(l => l.isOnline).length
    const idle = total - active
    return { total, active, idle }
  }, [resolvedLocations])

  const handleSelectTechnician = (id: string, lat: number, lng: number) => {
    setSelectedTechId(id)
    setSelectedTechCoords([lat, lng])
  }

  const handleManualRefresh = async () => {
    setIsManualRefreshing(true)
    try {
      await refetch()
    } finally {
      setIsManualRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-[#0F172A] text-slate-800 dark:text-slate-100 lg:overflow-hidden select-none animate-fadeIn">
      
      {/* Header Bar */}
      <div className="bg-white/80 dark:bg-[#1E293B]/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 p-4 flex flex-wrap items-center justify-between gap-4 z-10 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-rose-500 to-pink-500 p-2.5 rounded-xl shadow-md shadow-rose-500/10">
            <Compass className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              Teknisyen Canlı Takip (GPS)
              <span className="bg-gradient-to-r from-red-500/15 to-rose-500/15 text-rose-600 dark:text-rose-400 text-[10px] px-2.5 py-0.5 rounded-full font-bold border border-rose-500/20">
                Süper Admin Yetkisi
              </span>
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Saha teknisyenlerinin en son bildirdiği coğrafi konumları harita üzerinden anlık izleyin.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Stats Badges */}
          <div className="hidden sm:flex items-center gap-3 mr-2">
            <div className="text-right text-xs">
              <span className="text-slate-400">Haritada: </span>
              <span className="font-extrabold font-mono text-slate-900 dark:text-white">{stats.total} Kişi</span>
            </div>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />
            <div className="text-right text-xs">
              <span className="text-emerald-500 font-bold">Aktif: </span>
              <span className="font-extrabold font-mono text-emerald-500">{stats.active}</span>
            </div>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />
            <div className="text-right text-xs">
              <span className="text-slate-400 font-bold">Beklemede: </span>
              <span className="font-extrabold font-mono text-slate-500">{stats.idle}</span>
            </div>
          </div>

          <button 
            onClick={handleManualRefresh} 
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-95"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(isLoading || isManualRefreshing) ? 'animate-spin text-rose-500' : 'text-slate-400'}`} />
            Konumları Güncelle
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-10 overflow-hidden min-h-0">
        
        {/* Left Map Panel (70%) */}
        <div className="lg:col-span-7 relative border-r border-slate-200 dark:border-slate-800 h-full flex flex-col min-h-0">
          <div className="flex-1 relative z-0 min-h-0">
            <MapContainer 
              center={[35.1856, 33.3823]} 
              zoom={10}
              style={{ height: '100%', width: '100%', background: isDark ? '#0b0f19' : '#e5e7eb' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapController center={selectedTechCoords} />

              {filteredLocations.map(loc => {
                const coords: [number, number] = [loc.latitude, loc.longitude]
                const isSelected = loc.id === selectedTechId
                const initials = loc.initials || loc.fullName?.split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]).join('') || 'T'
                
                return (
                  <Marker 
                    key={loc.id} 
                    position={coords}
                    icon={createLiveTechIcon(initials, isSelected, loc.status, loc.isOnline)}
                    eventHandlers={{ click: () => handleSelectTechnician(loc.id, loc.latitude, loc.longitude) }}
                  >
                    <Popup className="dark-popup">
                      <div className="text-slate-900 p-2 min-w-[200px] font-sans">
                        <p className="font-bold text-sm text-slate-900">{loc.fullName}</p>
                        <p className="text-xs text-slate-500 mt-1">&#128222; {loc.phone || 'Telefon Belirtilmemiş'}</p>
                        <p className="text-xs text-slate-500 mt-0.5">&#128205; Konum: {coords[0].toFixed(5)}, {coords[1].toFixed(5)}</p>
                        <p className={`text-[10px] font-bold mt-1 ${loc.hasRealGps ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {loc.hasRealGps ? '● Canlı GPS Konumu' : '▲ Varsayılan Konum (GPS Yok)'}
                        </p>
                        
                        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px]">
                          <span className={`px-2 py-0.5 rounded font-bold ${
                            loc.isOnline 
                              ? (loc.status === 'OnField' ? 'bg-blue-100 text-blue-800' : loc.status === 'OnBreak' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800') 
                              : 'bg-slate-100 text-slate-800'
                          }`}>
                            {loc.isOnline 
                              ? (loc.status === 'OnField' ? 'Çevrimiçi / Sahada' : loc.status === 'OnBreak' ? 'Çevrimiçi / Molada' : 'Çevrimiçi / Müsait') 
                              : (loc.status === 'OffDuty' ? 'Çevrimdışı / Mesai Dışı' : 'Çevrimdışı')
                            }
                          </span>
                          <span className={loc.isOnline ? 'text-slate-400' : 'text-amber-600 font-semibold'}>
                            {loc.isOnline
                              ? (loc.lastUpdate ? new Date(loc.lastUpdate).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '')
                              : `Son görülme: ${formatLastSeen(loc.lastUpdate)}`}
                          </span>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                )
              })}
            </MapContainer>
          </div>
        </div>

        {/* Right Info Sidebar (30%) */}
        <div className="lg:col-span-3 flex flex-col h-full overflow-hidden min-h-0 bg-white dark:bg-[#1E293B]">
          {/* Sidebar Search */}
          <div className="p-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-2 shadow-sm focus-within:ring-2 focus-within:ring-rose-500/25 transition-all">
              <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <input 
                type="text" 
                placeholder="Teknisyen Ara..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none text-xs text-slate-800 dark:text-slate-200 focus:outline-none placeholder-slate-400 dark:placeholder-slate-500 w-full font-medium"
              />
            </div>
          </div>

          {/* List of Technicians */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 p-2 space-y-1">
            {isLoading && filteredLocations.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs italic flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-rose-500" />
                Güncel konumlar alınıyor...
              </div>
            ) : filteredLocations.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs flex flex-col items-center gap-2">
                <AlertCircle className="w-6 h-6 text-slate-300 dark:text-slate-700" />
                {searchQuery ? 'Aramayla eşleşen konum bulunamadı.' : 'Aktif konumu olan teknisyen bulunamadı.'}
              </div>
            ) : (
              filteredLocations.map(loc => {
                const isSelected = loc.id === selectedTechId
                const initials = loc.initials || loc.fullName?.split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]).join('') || 'T'
                
                let avatarColorClass = 'bg-gradient-to-tr from-slate-500 to-slate-600'
                let pulseColorClass = 'bg-slate-300 dark:bg-slate-600'
                if (loc.isOnline) {
                  if (loc.status === 'OnField') {
                    avatarColorClass = 'bg-gradient-to-tr from-blue-500 to-indigo-500'
                    pulseColorClass = 'bg-blue-500 animate-pulse'
                  } else if (loc.status === 'OnBreak') {
                    avatarColorClass = 'bg-gradient-to-tr from-amber-500 to-orange-500'
                    pulseColorClass = 'bg-amber-500 animate-pulse'
                  } else {
                    avatarColorClass = 'bg-gradient-to-tr from-emerald-500 to-teal-500'
                    pulseColorClass = 'bg-emerald-500 animate-pulse'
                  }
                }

                return (
                  <div 
                    key={loc.id}
                    onClick={() => handleSelectTechnician(loc.id, loc.latitude, loc.longitude)}
                    className={`rounded-xl p-3 flex items-center justify-between border cursor-pointer transition-all ${
                      isSelected 
                        ? 'bg-rose-500/5 dark:bg-rose-500/10 border-rose-400 dark:border-rose-500/50 shadow-sm' 
                        : 'bg-white dark:bg-slate-800/40 border-slate-100 dark:border-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs text-white flex-shrink-0 ${avatarColorClass}`}>
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-xs truncate text-slate-900 dark:text-white">{loc.fullName}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-550 mt-0.5 flex items-center gap-1 font-mono truncate">
                          <MapPin className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                        </p>
                        <span className={`text-[8px] font-extrabold ${loc.hasRealGps ? 'text-emerald-500' : 'text-amber-500/80 dark:text-amber-500'}`}>
                          {loc.hasRealGps ? '● CANLI GPS' : '▲ VARSAYILAN (KONUM YOK)'}
                        </span>
                      </div>
                    </div>
 
                    <div className="text-right flex-shrink-0 flex flex-col items-end gap-1.5 ml-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${pulseColorClass}`} />
                      <span className="text-[8px] font-bold text-slate-400 dark:text-slate-550 uppercase font-mono">
                        {loc.lastUpdate ? new Date(loc.lastUpdate).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

      </div>

    </div>
  )
}
