import React, { useState } from 'react'
import { CheckCircle2, Trash2, Users, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import type { TargetOptionsData } from '../../api/notifications'

interface SelectedTargetsCardProps {
  selectedTargets: string[]
  includeAllActiveUsers: boolean
  uniqueRecipientCount: number
  isCalculatingRecipients: boolean
  data: TargetOptionsData | null
  onRemoveTarget: (key: string) => void
  onClearAll: () => void
}

export default function SelectedTargetsCard({
  selectedTargets,
  includeAllActiveUsers,
  uniqueRecipientCount,
  isCalculatingRecipients,
  data,
  onRemoveTarget,
  onClearAll,
}: SelectedTargetsCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Map target keys to human readable labels
  const chipItems = React.useMemo(() => {
    const items: Array<{ key: string; label: string; badge: string; color: string }> = []

    if (includeAllActiveUsers) {
      items.push({
        key: 'all',
        label: `Tüm Aktif Kullanıcılar (${data?.totalActiveUsers ?? 0})`,
        badge: 'Tümü',
        color: 'bg-orange-50 text-orange-700 border-orange-200',
      })
    }

    selectedTargets.forEach((key) => {
      if (key === 'all') return

      if (key.startsWith('user:')) {
        const id = parseInt(key.replace('user:', ''), 10)
        const u = data?.users.find((user) => user.id === id)
        items.push({
          key,
          label: u ? `${u.unvan} (@${u.username})` : `Kullanıcı #${id}`,
          badge: 'Kullanıcı',
          color: 'bg-blue-50 text-blue-700 border-blue-200',
        })
      } else if (key.startsWith('role:')) {
        const id = parseInt(key.replace('role:', ''), 10)
        const r = data?.roles.find((role) => role.id === id)
        items.push({
          key,
          label: r ? `Rol: ${r.displayName || r.name}` : `Rol #${id}`,
          badge: 'Rol',
          color: 'bg-purple-50 text-purple-700 border-purple-200',
        })
      } else if (key.startsWith('priceGroup:')) {
        const id = key.replace('priceGroup:', '')
        const pg = data?.priceGroups.find((g) => String(g.id) === id)
        items.push({
          key,
          label: pg ? `Fiyat Grubu: ${pg.name}` : `Fiyat Grubu #${id}`,
          badge: 'Fiyat Grubu',
          color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        })
      }
    })

    return items
  }, [selectedTargets, includeAllActiveUsers, data])

  const totalSelectedCount = chipItems.length
  const visibleChips = isExpanded ? chipItems : chipItems.slice(0, 6)
  const remainingCount = chipItems.length - visibleChips.length

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-4 sm:p-5 space-y-4">
      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Seçilen Hedefler Özeti
          </h3>
          <span className="text-xs text-slate-500 mt-0.5 block font-medium">
            {totalSelectedCount === 0
              ? 'Henüz hedef seçilmedi'
              : `${totalSelectedCount} hedef seçildi`}
          </span>
        </div>

        {totalSelectedCount > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2.5 py-1 rounded-lg transition cursor-pointer flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Temizle
          </button>
        )}
      </div>

      {/* Recipient Counter Box */}
      <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/60 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-orange-100 text-orange-700 rounded-lg">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
              Benzersiz Alıcı Sayısı
            </div>
            <div className="text-xs text-slate-700 font-semibold">
              Bildirim bu kişilere ULAŞACAK
            </div>
          </div>
        </div>

        <div className="text-right">
          {isCalculatingRecipients ? (
            <div className="flex items-center gap-1.5 text-xs text-orange-600 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Hesaplanıyor...</span>
            </div>
          ) : (
            <div className="text-lg font-black font-mono text-orange-600">
              {uniqueRecipientCount}{' '}
              <span className="text-xs font-normal text-slate-500 font-sans">kullanıcı</span>
            </div>
          )}
        </div>
      </div>

      {/* Selected Target Chips */}
      {chipItems.length === 0 ? (
        <div className="text-xs text-slate-400 italic py-2 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
          Sol listeden kullanıcı, rol veya fiyat grubu seçin.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5 max-h-[160px] overflow-y-auto">
            {visibleChips.map((chip) => (
              <span
                key={chip.key}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border shadow-2xs ${chip.color}`}
              >
                <span className="text-[10px] uppercase font-bold opacity-75 font-mono">
                  {chip.badge}:
                </span>
                <span className="truncate max-w-[180px]">{chip.label}</span>
                <button
                  type="button"
                  onClick={() => onRemoveTarget(chip.key)}
                  className="hover:opacity-80 p-0.5 rounded-full text-current font-bold text-xs leading-none cursor-pointer"
                  title="Kaldır"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          {remainingCount > 0 && !isExpanded && (
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1 cursor-pointer pt-1"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              +{remainingCount} hedef daha göster
            </button>
          )}

          {isExpanded && chipItems.length > 6 && (
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1 cursor-pointer pt-1"
            >
              <ChevronUp className="w-3.5 h-3.5" />
              Daralt
            </button>
          )}
        </div>
      )}
    </div>
  )
}
