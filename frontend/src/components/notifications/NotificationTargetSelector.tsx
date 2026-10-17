import React, { useState, useMemo, useEffect } from 'react'
import {
  Users,
  Shield,
  Tag,
  Search,
  CheckSquare,
  Square,
  AlertCircle,
  Megaphone,
  X,
  RotateCcw,
} from 'lucide-react'
import type { TargetOptionsData } from '../../api/notifications'

export type SegmentType = 'users' | 'roles' | 'priceGroups'

interface NotificationTargetSelectorProps {
  data: TargetOptionsData | null
  isLoading: boolean
  selectedTargets: string[] // e.g. ["all"], ["user:1", "role:2"]
  includeAllActiveUsers: boolean
  onToggleTarget: (targetKey: string) => void
  onSelectAllFiltered: (targetKeys: string[]) => void
  onClearTargetKeys: (targetKeys: string[]) => void
  onToggleAllActiveUsers: (value: boolean) => void
}

export default function NotificationTargetSelector({
  data,
  isLoading,
  selectedTargets,
  includeAllActiveUsers,
  onToggleTarget,
  onSelectAllFiltered,
  onClearTargetKeys,
  onToggleAllActiveUsers,
}: NotificationTargetSelectorProps) {
  const [activeSegment, setActiveSegment] = useState<SegmentType>('users')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [showAllConfirmModal, setShowAllConfirmModal] = useState(false)

  // 300ms Search Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim().toLowerCase())
    }, 300)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // Filtered Users List
  const filteredUsers = useMemo(() => {
    if (!data?.users) return []
    return data.users.filter((u) => {
      const q = debouncedSearch
      const name = String(u.unvan || '').toLowerCase()
      const uname = String(u.username || '').toLowerCase()
      const cari = String(u.carikodu || '').toLowerCase()
      const matchSearch = !q || name.includes(q) || uname.includes(q) || cari.includes(q)
      const matchRole = !roleFilter || String(u.roleId) === roleFilter
      return matchSearch && matchRole
    })
  }, [data?.users, debouncedSearch, roleFilter])

  // Filtered Roles List
  const filteredRoles = useMemo(() => {
    if (!data?.roles) return []
    return data.roles.filter((r) => {
      const q = debouncedSearch
      const name = String(r.name || '').toLowerCase()
      const dName = String(r.displayName || '').toLowerCase()
      const code = String(r.code || '').toLowerCase()
      return !q || name.includes(q) || dName.includes(q) || code.includes(q)
    })
  }, [data?.roles, debouncedSearch])

  // Filtered Price Groups List
  const filteredPriceGroups = useMemo(() => {
    if (!data?.priceGroups) return []
    return data.priceGroups.filter((pg) => {
      const q = debouncedSearch
      const name = String(pg.name || '').toLowerCase()
      const code = String(pg.code || '').toLowerCase()
      return !q || name.includes(q) || code.includes(q)
    })
  }, [data?.priceGroups, debouncedSearch])

  const selectedSet = useMemo(() => new Set(selectedTargets), [selectedTargets])

  // Current segment targets keys
  const currentFilteredKeys = useMemo(() => {
    if (activeSegment === 'users') return filteredUsers.map((u) => `user:${u.id}`)
    if (activeSegment === 'roles') return filteredRoles.map((r) => `role:${r.id}`)
    if (activeSegment === 'priceGroups') return filteredPriceGroups.map((pg) => `priceGroup:${pg.id}`)
    return []
  }, [activeSegment, filteredUsers, filteredRoles, filteredPriceGroups])

  const isAllCurrentSelected =
    currentFilteredKeys.length > 0 && currentFilteredKeys.every((k) => selectedSet.has(k))

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col h-full">
      {/* Header & Main Bulk Button */}
      <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <Users className="w-4 h-4 text-orange-600" />
            Hedefleri Seç
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Bildirimin gönderileceği kullanıcı, rol veya fiyat gruplarını seçin
          </p>
        </div>

        {/* All Active Users Trigger Button */}
        <button
          type="button"
          onClick={() => {
            if (includeAllActiveUsers) {
              onToggleAllActiveUsers(false)
            } else {
              setShowAllConfirmModal(true)
            }
          }}
          className={`flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs ${
            includeAllActiveUsers
              ? 'bg-orange-600 text-white hover:bg-orange-700 ring-2 ring-orange-500/40'
              : 'bg-white text-slate-700 border border-slate-200 hover:border-orange-500 hover:text-orange-600'
          }`}
        >
          <Megaphone className="w-4 h-4" />
          <span>
            {includeAllActiveUsers
              ? '✓ Tüm Aktif Kullanıcılar Seçildi'
              : `Tüm Aktif Kullanıcıları Seç (${data?.totalActiveUsers ?? 0})`}
          </span>
        </button>
      </div>

      {/* Segmented Control Tabs */}
      <div className="flex border-b border-slate-200 bg-slate-100/60 p-1.5 gap-1.5 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveSegment('users')}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeSegment === 'users'
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-3.5 h-3.5 text-blue-600" />
          <span>Kullanıcılar</span>
          <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded-full font-mono text-[10px]">
            {data?.users.length ?? 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSegment('roles')}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeSegment === 'roles'
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Shield className="w-3.5 h-3.5 text-purple-600" />
          <span>Roller</span>
          <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded-full font-mono text-[10px]">
            {data?.roles.length ?? 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSegment('priceGroups')}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeSegment === 'priceGroups'
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Tag className="w-3.5 h-3.5 text-emerald-600" />
          <span>Fiyat Grupları</span>
          <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded-full font-mono text-[10px]">
            {data?.priceGroups.length ?? 0}
          </span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-3 bg-slate-50/40 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2.5">
        <div className="relative w-full sm:flex-1">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder={
              activeSegment === 'users'
                ? 'Ad, kullanıcı adı veya cari kodu ara...'
                : activeSegment === 'roles'
                ? 'Rol adı veya kod ara...'
                : 'Fiyat grubu adı ara...'
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-700"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {activeSegment === 'users' && data?.roles && (
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full sm:w-44 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 text-slate-700 font-medium cursor-pointer"
          >
            <option value="">Tüm Roller</option>
            {data.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.displayName || r.name}
              </option>
            ))}
          </select>
        )}

        {(searchTerm || roleFilter) && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm('')
              setRoleFilter('')
            }}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 shrink-0 px-2 py-1"
          >
            <RotateCcw className="w-3 h-3" />
            Temizle
          </button>
        )}
      </div>

      {/* Target Table View */}
      <div className="flex-1 overflow-y-auto min-h-[360px] max-h-[500px]">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 text-xs">Hedef verileri yükleniyor...</div>
        ) : activeSegment === 'users' ? (
          filteredUsers.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <AlertCircle className="w-6 h-6 text-slate-300" />
              <span>Aramanızla eşleşen kullanıcı bulunamadı.</span>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs select-none">
              <thead className="sticky top-0 bg-slate-100/90 backdrop-blur-xs text-slate-600 border-b border-slate-200 font-bold uppercase tracking-wider text-[11px] z-10">
                <tr>
                  <th className="px-3.5 py-2.5 w-10 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (isAllCurrentSelected) {
                          onClearTargetKeys(currentFilteredKeys)
                        } else {
                          onSelectAllFiltered(currentFilteredKeys)
                        }
                      }}
                      className="cursor-pointer text-slate-500 hover:text-orange-600"
                      title={isAllCurrentSelected ? 'Tüm Seçimleri Kaldır' : 'Tüm Sonuçları Seç'}
                    >
                      {isAllCurrentSelected ? (
                        <CheckSquare className="w-4 h-4 text-orange-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5">Ad Soyad</th>
                  <th className="px-3.5 py-2.5">Kullanıcı Adı</th>
                  <th className="px-3.5 py-2.5">Rol</th>
                  <th className="px-3.5 py-2.5">Cari Kodu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => {
                  const key = `user:${u.id}`
                  const isSelected = selectedSet.has(key)
                  return (
                    <tr
                      key={u.id}
                      onClick={() => onToggleTarget(key)}
                      className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                        isSelected ? 'bg-orange-50/60 font-semibold' : ''
                      }`}
                    >
                      <td className="px-3.5 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // Handled by tr onClick
                          className="rounded text-orange-600 focus:ring-orange-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3.5 py-2 text-slate-800 font-medium">{u.unvan}</td>
                      <td className="px-3.5 py-2 text-slate-500 font-mono text-[11px]">{u.username}</td>
                      <td className="px-3.5 py-2">
                        <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-semibold text-[10px] border border-purple-100">
                          {u.roleName || 'Standart'}
                        </span>
                      </td>
                      <td className="px-3.5 py-2 text-slate-400 font-mono text-[11px]">
                        {u.carikodu || '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : activeSegment === 'roles' ? (
          filteredRoles.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <AlertCircle className="w-6 h-6 text-slate-300" />
              <span>Aramanızla eşleşen rol bulunamadı.</span>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs select-none">
              <thead className="sticky top-0 bg-slate-100/90 backdrop-blur-xs text-slate-600 border-b border-slate-200 font-bold uppercase tracking-wider text-[11px] z-10">
                <tr>
                  <th className="px-3.5 py-2.5 w-10 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (isAllCurrentSelected) {
                          onClearTargetKeys(currentFilteredKeys)
                        } else {
                          onSelectAllFiltered(currentFilteredKeys)
                        }
                      }}
                      className="cursor-pointer text-slate-500 hover:text-orange-600"
                    >
                      {isAllCurrentSelected ? (
                        <CheckSquare className="w-4 h-4 text-orange-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5">Rol Adı</th>
                  <th className="px-3.5 py-2.5">Rol Kodu</th>
                  <th className="px-3.5 py-2.5 text-right">Aktif Kullanıcı Sayısı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRoles.map((r) => {
                  const key = `role:${r.id}`
                  const isSelected = selectedSet.has(key)
                  return (
                    <tr
                      key={r.id}
                      onClick={() => onToggleTarget(key)}
                      className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                        isSelected ? 'bg-purple-50/60 font-semibold' : ''
                      }`}
                    >
                      <td className="px-3.5 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3.5 py-2 text-slate-800 font-medium">{r.displayName || r.name}</td>
                      <td className="px-3.5 py-2 text-slate-500 font-mono text-[11px]">{r.code}</td>
                      <td className="px-3.5 py-2 text-right">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-mono font-bold rounded text-[11px]">
                          {r.userCount} kullanıcı
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : (
          filteredPriceGroups.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <AlertCircle className="w-6 h-6 text-slate-300" />
              <span>Aramanızla eşleşen fiyat grubu bulunamadı.</span>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs select-none">
              <thead className="sticky top-0 bg-slate-100/90 backdrop-blur-xs text-slate-600 border-b border-slate-200 font-bold uppercase tracking-wider text-[11px] z-10">
                <tr>
                  <th className="px-3.5 py-2.5 w-10 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (isAllCurrentSelected) {
                          onClearTargetKeys(currentFilteredKeys)
                        } else {
                          onSelectAllFiltered(currentFilteredKeys)
                        }
                      }}
                      className="cursor-pointer text-slate-500 hover:text-orange-600"
                    >
                      {isAllCurrentSelected ? (
                        <CheckSquare className="w-4 h-4 text-orange-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5">Fiyat Grubu Adı</th>
                  <th className="px-3.5 py-2.5">Grup Kodu</th>
                  <th className="px-3.5 py-2.5 text-right">Cari/Kullanıcı Sayısı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPriceGroups.map((pg) => {
                  const key = `priceGroup:${pg.id}`
                  const isSelected = selectedSet.has(key)
                  return (
                    <tr
                      key={pg.id}
                      onClick={() => onToggleTarget(key)}
                      className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                        isSelected ? 'bg-emerald-50/60 font-semibold' : ''
                      }`}
                    >
                      <td className="px-3.5 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3.5 py-2 text-slate-800 font-medium">{pg.name}</td>
                      <td className="px-3.5 py-2 text-slate-500 font-mono text-[11px]">{pg.code}</td>
                      <td className="px-3.5 py-2 text-right">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-mono font-bold rounded text-[11px]">
                          {pg.userCount} kullanıcı
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        )}
      </div>

      {/* Confirmation Modal for All Active Users */}
      {showAllConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-center gap-3 text-orange-600 mb-3">
              <Megaphone className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900">Tüm Aktif Kullanıcıları Seç</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Bu bildirim sistemdeki toplam <strong className="text-orange-600 font-mono">{data?.totalActiveUsers ?? 0}</strong> aktif kullanıcının tamamına gönderilecektir.
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowAllConfirmModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => {
                  onToggleAllActiveUsers(true)
                  setShowAllConfirmModal(false)
                }}
                className="px-4 py-2 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-lg shadow-xs cursor-pointer"
              >
                Tüm Aktif Kullanıcıları Seç
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
