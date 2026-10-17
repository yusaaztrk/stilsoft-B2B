export type CampaignBackground = {
  id: string
  name: string
  style: string
  textColor: string
  textShadow: string
}

export const CAMPAIGN_BACKGROUNDS: CampaignBackground[] = [
  {
    id: 'bg-red-silk',
    name: 'Kırmızı İpek (Premium Red)',
    style: 'url("data:image/svg+xml,%3Csvg width=\'400\' height=\'100\' viewBox=\'0 0 400 100\' preserveAspectRatio=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3ClinearGradient id=\'g\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%237f1d1d\'/%3E%3Cstop offset=\'50%25\' stop-color=\'%23dc2626\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%23991b1b\'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=\'400\' height=\'100\' fill=\'url(%23g)\'/%3E%3Cpath d=\'M-20 80 C 100 120, 200 40, 420 80 L 420 100 L -20 100 Z\' fill=\'%23ffffff\' fill-opacity=\'0.08\'/%3E%3Cpath d=\'M-20 40 C 120 10, 250 90, 420 30 L 420 100 L -20 100 Z\' fill=\'%23ffffff\' fill-opacity=\'0.05\'/%3E%3Cpath d=\'M-20 60 C 80 20, 300 100, 420 50 L 420 100 L -20 100 Z\' fill=\'%23ffffff\' fill-opacity=\'0.04\'/%3E%3C/svg%3E") center/cover no-repeat',
    textColor: '#ffffff',
    textShadow: '0 1px 3px rgba(0,0,0,0.3)'
  },
  {
    id: 'bg-red-cyber',
    name: 'Siber Kırmızı (Cyber Red)',
    style: 'url("data:image/svg+xml,%3Csvg width=\'400\' height=\'100\' viewBox=\'0 0 400 100\' preserveAspectRatio=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3ClinearGradient id=\'bg\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%2309050d\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%231a0515\'/%3E%3C/linearGradient%3E%3ClinearGradient id=\'grid\' x1=\'0%25\' y1=\'0%25\' x2=\'0%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%23ef4444\' stop-opacity=\'0.15\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%23ef4444\' stop-opacity=\'0.0\'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=\'400\' height=\'100\' fill=\'url(%23bg)\'/%3E%3Cpath d=\'M0 10 H400 M0 20 H400 M0 30 H400 M0 40 H400 M0 50 H400 M0 60 H400 M0 70 H400 M0 80 H400 M0 90 H400\' stroke=\'url(%23grid)\' stroke-width=\'0.5\'/%3E%3Cpath d=\'M20 0 L50 100 M60 0 L80 100 M100 0 L110 100 M140 0 L140 100 M180 0 L170 100 M220 0 L200 100 M260 0 L240 100 M300 0 L290 100 M340 0 L330 100 M380 0 L370 100\' stroke=\'url(%23grid)\' stroke-width=\'0.5\'/%3E%3Cpath d=\'M 10 10 L 50 10 L 60 20 L 120 20\' stroke=\'%23ef4444\' stroke-width=\'1\' fill=\'none\' stroke-opacity=\'0.3\'/%3E%3Ccircle cx=\'120\' cy=\'20\' r=\'2\' fill=\'%23ef4444\' fill-opacity=\'0.8\'/%3E%3Cpath d=\'M 390 90 L 350 90 L 340 80 L 280 80\' stroke=\'%23ef4444\' stroke-width=\'1\' fill=\'none\' stroke-opacity=\'0.3\'/%3E%3Ccircle cx=\'280\' cy=\'80\' r=\'2\' fill=\'%23ef4444\' fill-opacity=\'0.8\'/%3E%3Crect x=\'1.5\' y=\'1.5\' width=\'397\' height=\'97\' rx=\'4\' fill=\'none\' stroke=\'%23ef4444\' stroke-width=\'1\' stroke-opacity=\'0.25\'/%3E%3C/svg%3E") center/cover no-repeat',
    textColor: '#fecdd3',
    textShadow: '0 0 10px rgba(239, 68, 68, 0.6)'
  },
  {
    id: 'bg-black-gold',
    name: 'Altın Mermer (Obsidian Gold)',
    style: 'url("data:image/svg+xml,%3Csvg width=\'400\' height=\'100\' viewBox=\'0 0 400 100\' preserveAspectRatio=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3ClinearGradient id=\'bg\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%2318181b\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%2309090b\'/%3E%3C/linearGradient%3E%3ClinearGradient id=\'gold\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%23d97706\'/%3E%3Cstop offset=\'50%25\' stop-color=\'%23f59e0b\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%23fbbf24\'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=\'400\' height=\'100\' fill=\'url(%23bg)\'/%3E%3Cpath d=\'M-10 30 C 150 10, 200 80, 410 40 L 410 100 L -10 100 Z\' fill=\'%2327272a\' fill-opacity=\'0.3\'/%3E%3Cpath d=\'M -20 20 Q 80 -10, 160 50 T 320 20 T 420 80\' fill=\'none\' stroke=\'url(%23gold)\' stroke-width=\'2.5\' stroke-opacity=\'0.6\'/%3E%3Cpath d=\'M -20 50 Q 120 90, 220 30 T 360 80 T 420 40\' fill=\'none\' stroke=\'url(%23gold)\' stroke-width=\'1.5\' stroke-opacity=\'0.4\'/%3E%3Ccircle cx=\'50\' cy=\'35\' r=\'1.5\' fill=\'%23fbbf24\' fill-opacity=\'0.7\'/%3E%3Ccircle cx=\'180\' cy=\'75\' r=\'2\' fill=\'%23fbbf24\' fill-opacity=\'0.5\'/%3E%3Ccircle cx=\'340\' cy=\'25\' r=\'1\' fill=\'%23fbbf24\' fill-opacity=\'0.6\'/%3E%3Ccircle cx=\'280\' cy=\'65\' r=\'1.5\' fill=\'%23fbbf24\' fill-opacity=\'0.8\'/%3E%3C/svg%3E") center/cover no-repeat',
    textColor: '#fef08a',
    textShadow: '0 1px 4px rgba(0,0,0,0.6)'
  },
  {
    id: 'bg-black-carbon',
    name: 'Karbon Fiber (Charter Black)',
    style: 'url("data:image/svg+xml,%3Csvg width=\'400\' height=\'100\' viewBox=\'0 0 400 100\' preserveAspectRatio=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3ClinearGradient id=\'bg\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%230f172a\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%23020617\'/%3E%3C/linearGradient%3E%3Cpattern id=\'carbon\' width=\'6\' height=\'6\' patternUnits=\'userSpaceOnUse\'%3E%3Crect width=\'6\' height=\'6\' fill=\'%231e293b\'/%3E%3Cpolygon points=\'0,0 3,0 0,3\' fill=\'%23334155\'/%3E%3Cpolygon points=\'3,3 6,3 3,6\' fill=\'%23334155\'/%3E%3Cpolygon points=\'3,3 6,3 6,6\' fill=\'%23475569\'/%3E%3Cpolygon points=\'0,0 3,0 3,3\' fill=\'%23475569\'/%3E%3C/pattern%3E%3ClinearGradient id=\'neon\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'0%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%230ea5e9\' stop-opacity=\'0.8\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%232563eb\' stop-opacity=\'0.1\'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=\'400\' height=\'100\' fill=\'url(%23bg)\'/%3E%3Crect width=\'400\' height=\'100\' fill=\'url(%23carbon)\' fill-opacity=\'0.45\'/%3E%3Cpath d=\'M-10 100 L120 0 L150 0 L20 100 Z\' fill=\'url(%23neon)\'/%3E%3Cpath d=\'M300 100 L380 0 L395 0 L315 100 Z\' fill=\'url(%23neon)\' fill-opacity=\'0.5\'/%3E%3Ccircle cx=\'380\' cy=\'20\' r=\'1\' fill=\'%230ea5e9\' fill-opacity=\'0.8\'/%3E%3Ccircle cx=\'370\' cy=\'20\' r=\'1\' fill=\'%230ea5e9\' fill-opacity=\'0.5\'/%3E%3Ccircle cx=\'360\' cy=\'20\' r=\'1\' fill=\'%230ea5e9\' fill-opacity=\'0.3\'/%3E%3C/svg%3E") center/cover no-repeat',
    textColor: '#e0f2fe',
    textShadow: '0 1px 3px rgba(0,0,0,0.5)'
  },
  {
    id: 'bg-grey-metallic',
    name: 'Metalik Gri (Platinum Club)',
    style: 'url("data:image/svg+xml,%3Csvg width=\'400\' height=\'100\' viewBox=\'0 0 400 100\' preserveAspectRatio=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3ClinearGradient id=\'bg\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%23cbd5e1\'/%3E%3Cstop offset=\'30%25\' stop-color=\'%23f1f5f9\'/%3E%3Cstop offset=\'70%25\' stop-color=\'%23e2e8f0\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%23cbd5e1\'/%3E%3C/linearGradient%3E%3ClinearGradient id=\'refl\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'0%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%23ffffff\' stop-opacity=\'0.5\'/%3E%3Cstop offset=\'30%25\' stop-color=\'%23ffffff\' stop-opacity=\'0.0\'/%3E%3Cstop offset=\'70%25\' stop-color=\'%23ffffff\' stop-opacity=\'0.0\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%23ffffff\' stop-opacity=\'0.5\'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=\'400\' height=\'100\' fill=\'url(%23bg)\'/%3E%3Cpath d=\'M0 10 L400 15 M0 30 L400 35 M0 50 L400 55 M0 70 L400 75 M0 90 L400 95\' stroke=\'%23ffffff\' stroke-width=\'0.5\' stroke-opacity=\'0.4\'/%3E%3Cpath d=\'M0 25 L400 20 M0 45 L400 40 M0 65 L400 60 M0 85 L400 80\' stroke=\'%2394a3b8\' stroke-width=\'0.5\' stroke-opacity=\'0.25\'/%3E%3Crect width=\'400\' height=\'100\' fill=\'url(%23refl)\'/%3E%3Cpath d=\'M-50 100 L100 0 L150 0 L0 100 Z\' fill=\'%23ffffff\' fill-opacity=\'0.3\'/%3E%3C/svg%3E") center/cover no-repeat',
    textColor: '#1e293b',
    textShadow: 'none'
  },
  {
    id: 'bg-green-emerald',
    name: 'Zümrüt Yeşil (Mint Emerald)',
    style: 'url("data:image/svg+xml,%3Csvg width=\'400\' height=\'100\' viewBox=\'0 0 400 100\' preserveAspectRatio=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3ClinearGradient id=\'bg\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%23064e3b\'/%3E%3Cstop offset=\'50%25\' stop-color=\'%23047857\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%23065f46\'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=\'400\' height=\'100\' fill=\'url(%23bg)\'/%3E%3Ccircle cx=\'50\' cy=\'100\' r=\'80\' fill=\'%2310b981\' fill-opacity=\'0.15\'/%3E%3Ccircle cx=\'380\' cy=\'0\' r=\'70\' fill=\'%2334d399\' fill-opacity=\'0.1\'/%3E%3Ccircle cx=\'200\' cy=\'50\' r=\'40\' fill=\'%23059669\' fill-opacity=\'0.15\'/%3E%3Cpath d=\'M-20 80 C 120 110, 280 60, 420 90 L 420 100 L -20 100 Z\' fill=\'%23ffffff\' fill-opacity=\'0.04\'/%3E%3C/svg%3E") center/cover no-repeat',
    textColor: '#d1fae5',
    textShadow: '0 1px 3px rgba(0,0,0,0.3)'
  },
  {
    id: 'bg-blue-sapphire',
    name: 'Safir Mavi (Royal Sapphire)',
    style: 'url("data:image/svg+xml,%3Csvg width=\'400\' height=\'100\' viewBox=\'0 0 400 100\' preserveAspectRatio=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3ClinearGradient id=\'bg\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%2303071e\'/%3E%3Cstop offset=\'50%25\' stop-color=\'%230f4c81\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%231e3a8a\'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=\'400\' height=\'100\' fill=\'url(%23bg)\'/%3E%3Cpath d=\'M-20 30 C 120 90, 260 -10, 420 40 L 420 100 L -20 100 Z\' fill=\'%2338bdf8\' fill-opacity=\'0.12\'/%3E%3Cpath d=\'M-20 70 C 100 10, 280 90, 420 20 L 420 100 L -20 100 Z\' fill=\'%2360a5fa\' fill-opacity=\'0.08\'/%3E%3Ccircle cx=\'340\' cy=\'30\' r=\'45\' fill=\'%230284c7\' fill-opacity=\'0.2\'/%3E%3C/svg%3E") center/cover no-repeat',
    textColor: '#e0f2fe',
    textShadow: '0 1px 3px rgba(0,0,0,0.5)'
  },
  {
    id: 'bg-purple-galaxy',
    name: 'Galaksi Mor (Cosmic Violet)',
    style: 'url("data:image/svg+xml,%3Csvg width=\'400\' height=\'100\' viewBox=\'0 0 400 100\' preserveAspectRatio=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3ClinearGradient id=\'bg\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%231e1b4b\'/%3E%3Cstop offset=\'50%25\' stop-color=\'%234c1d95\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%23581c87\'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=\'400\' height=\'100\' fill=\'url(%23bg)\'/%3E%3Ccircle cx=\'70\' cy=\'20\' r=\'50\' fill=\'%23c084fc\' fill-opacity=\'0.15\'/%3E%3Ccircle cx=\'320\' cy=\'80\' r=\'60\' fill=\'%23e879f9\' fill-opacity=\'0.12\'/%3E%3Cpath d=\'M-10 50 Q 150 0, 250 80 T 410 30\' stroke=\'%23f472b6\' stroke-width=\'1.5\' fill=\'none\' stroke-opacity=\'0.35\'/%3E%3Ccircle cx=\'120\' cy=\'35\' r=\'1.5\' fill=\'%23ffffff\' fill-opacity=\'0.9\'/%3E%3Ccircle cx=\'280\' cy=\'60\' r=\'2\' fill=\'%23ffffff\' fill-opacity=\'0.8\'/%3E%3Ccircle cx=\'210\' cy=\'25\' r=\'1\' fill=\'%23ffffff\' fill-opacity=\'0.7\'/%3E%3C/svg%3E") center/cover no-repeat',
    textColor: '#f3e8ff',
    textShadow: '0 0 10px rgba(168,85,247,0.6)'
  },
  {
    id: 'bg-copper-bronze',
    name: 'Bakır Bronz (Sunset Bronze)',
    style: 'url("data:image/svg+xml,%3Csvg width=\'400\' height=\'100\' viewBox=\'0 0 400 100\' preserveAspectRatio=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3ClinearGradient id=\'bg\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%23451a03\'/%3E%3Cstop offset=\'50%25\' stop-color=\'%2378350f\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%239a3412\'/%3E%3C/linearGradient%3E%3ClinearGradient id=\'shine\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'0%25\'%3E%3Cstop offset=\'0%25\' stop-color=\'%23fbbf24\' stop-opacity=\'0.3\'/%3E%3Cstop offset=\'50%25\' stop-color=\'%23f97316\' stop-opacity=\'0.1\'/%3E%3Cstop offset=\'100%25\' stop-color=\'%23fbbf24\' stop-opacity=\'0.3\'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=\'400\' height=\'100\' fill=\'url(%23bg)\'/%3E%3Cpath d=\'M-20 90 L180 -10 L230 -10 L30 90 Z\' fill=\'url(%23shine)\'/%3E%3Cpath d=\'M150 110 L330 -10 L370 -10 L190 110 Z\' fill=\'url(%23shine)\' fill-opacity=\'0.7\'/%3E%3Ccircle cx=\'80\' cy=\'70\' r=\'2\' fill=\'%23fde68a\' fill-opacity=\'0.8\'/%3E%3Ccircle cx=\'310\' cy=\'30\' r=\'1.5\' fill=\'%23fde68a\' fill-opacity=\'0.7\'/%3E%3C/svg%3E") center/cover no-repeat',
    textColor: '#ffedd5',
    textShadow: '0 1px 4px rgba(0,0,0,0.6)'
  }
]

export type TextColorOption = {
  id: string
  name: string
  color: string
}

export const TEXT_COLOR_OPTIONS: TextColorOption[] = [
  { id: 'default', name: 'Varsayılan', color: '' },
  { id: 'white', name: 'Beyaz', color: '#ffffff' },
  { id: 'black', name: 'Koyu Siyah', color: '#0f172a' },
  { id: 'gold', name: 'Altın Sarı', color: '#fbbf24' },
  { id: 'amber', name: 'Açık Turuncu', color: '#ffedd5' },
  { id: 'red', name: 'Açık Kırmızı', color: '#fecdd3' },
  { id: 'green', name: 'Açık Yeşil', color: '#d1fae5' },
  { id: 'sky', name: 'Gökyüzü Mavi', color: '#e0f2fe' },
  { id: 'purple', name: 'Açık Mor', color: '#f3e8ff' }
]

export function parseCampaignDescription(rawDesc: string | null | undefined): {
  description: string
  bgId: string
  textColor?: string
} {
  const text = String(rawDesc ?? '').trim()
  let bgId = 'bg-red-silk'
  let textColor: string | undefined = undefined

  const bgMatch = text.match(/\[bg:([^\]]+)\]/)
  if (bgMatch) {
    bgId = bgMatch[1]
  }

  const colorMatch = text.match(/\[color:([^\]]+)\]/)
  if (colorMatch) {
    textColor = colorMatch[1]
  }

  const description = text
    .replace(/\[bg:[^\]]+\]/g, '')
    .replace(/\[color:[^\]]+\]/g, '')
    .trim()

  return { description, bgId, textColor }
}

export function formatCampaignDescription(description: string, bgId: string, textColor?: string): string {
  let cleanDesc = description
    .replace(/\[bg:[^\]]+\]/g, '')
    .replace(/\[color:[^\]]+\]/g, '')
    .trim()

  if (bgId) cleanDesc += ` [bg:${bgId}]`
  if (textColor) cleanDesc += ` [color:${textColor}]`

  return cleanDesc.trim()
}
