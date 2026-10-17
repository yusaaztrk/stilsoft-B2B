import { NavLink, Outlet } from 'react-router-dom'

import { usePermissions } from '../../auth/PermissionsContext'

const TABS = [
  { to: '/raporlar', label: 'Genel Özet', key: 'raporlar', end: true },
  { to: '/raporlar/montaj', label: 'Montaj', key: 'raporlar.montaj' },
  { to: '/raporlar/buyuk-urun', label: 'Büyük Ürün', key: 'raporlar.buyukUrun' },
  { to: '/raporlar/kucuk-urun', label: 'Küçük Ürün', key: 'raporlar.kucukUrun' },
  { to: '/raporlar/kargo', label: 'Kargo', key: 'raporlar.kargo' },
  { to: '/raporlar/bayi', label: 'Bayi', key: 'raporlar.bayi' },
  { to: '/raporlar/teknisyen', label: 'Teknisyen', key: 'raporlar.teknisyen' },
  { to: '/raporlar/urun', label: 'Ürün', key: 'raporlar.urun' },
  { to: '/raporlar/sureler', label: 'Süreler', key: 'raporlar.sureler' },
  { to: '/raporlar/iptal', label: 'İptal', key: 'raporlar.iptal' },
  { to: '/raporlar/yedek-parca', label: 'Yedek Parça', key: 'raporlar.yedekParca' },
  { to: '/raporlar/trend', label: 'Trend', key: 'raporlar.trend' }
]

/**
 * Rapor sekmeleri. Görünürlük yetkiye bağlı, ama tek kapı bu değil: rota da
 * ROUTE_PAGE_KEYS üzerinden, uç da HasPageAsync ile kontrol ediliyor. Menüyü gizlemek
 * tek başına yetki kontrolü sayılmaz — adres çubuğuna yazan biri yine girer.
 */
export default function RaporlarLayout() {
  const { can, loaded } = usePermissions()

  // İzinler gelmeden sekme çizilmez: boş anahtar kümesiyle karar vermek, yetkisi olan
  // kullanıcıya bir kare boyunca "hiçbir rapor yok" göstermek olurdu.
  const visible = loaded ? TABS.filter((t) => can(t.key)) : []

  return (
    <div className="p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {visible.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              'px-3 py-1.5 rounded-xl text-[11px] font-black whitespace-nowrap transition ' +
              (isActive
                ? 'bg-gray-900 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50')
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  )
}
