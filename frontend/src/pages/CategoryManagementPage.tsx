import React, { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, Settings, Plus, Trash2, FolderPlus, HelpCircle } from 'lucide-react'
import Modal from '../components/Modal'
import { createMainCategoryWithDesc, createSubCategory, deleteCategory, updateCategory } from '../api/productCategories'
import { useProductCategories } from '../hooks/useProductCategories'

type CategoryRow = {
  id: string
  rawId?: string
  keyName: string
  displayName: string
  name: string
  description: string
  status: 'active' | 'passive'
  level: number
  type: 'main' | 'sub'
  parentId?: string
  canExpand: boolean
  expanded: boolean
}

function toKey(s: string) {
  return String(s ?? '')
    .trim()
    .toUpperCase()
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'I')
    .replace(/Ğ/g, 'G')
    .replace(/ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/ü/g, 'U')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 'S')
    .replace(/Ö/g, 'O')
    .replace(/ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'C')
    .replace(/\s+/g, ' ')
}

function categoryKeyVariants(label: string) {
  const raw = String(label ?? '').trim()
  if (!raw) return [] as string[]

  const normSpace = toKey(raw)
  const normUnderscore = normSpace.replace(/\s+/g, '_')
  const rawUpper = raw.toUpperCase()
  const rawUnderscore = raw.replace(/\s+/g, '_')
  const rawUnderscoreUpper = rawUnderscore.toUpperCase()

  return Array.from(new Set([raw, rawUpper, normSpace, normUnderscore, rawUnderscore, rawUnderscoreUpper]))
}

function mainId(mainName: string) {
  return `m:${toKey(mainName)}`
}

function subId(mainName: string, subName: string) {
  return `s:${toKey(mainName)}:${toKey(subName)}`
}

export default function CategoryManagementPage() {
  const { data: categoriesState, loading, error, refresh } = useProductCategories()

  const [expandedMain, setExpandedMain] = useState<Set<string>>(new Set())

  const getSubsForMain = (mainLabel: string) => {
    const map = categoriesState.subsByMain as Record<string, string[]>
    const keys = categoryKeyVariants(mainLabel)
    for (const k of keys) {
      const v = map[k]
      if (Array.isArray(v) && v.length) return v
    }
    return [] as string[]
  }

  const rows = useMemo(() => {
    const out: CategoryRow[] = []

    if (categoriesState.items && categoriesState.items.length > 0) {
      const mainItems = categoriesState.items.filter((i) => !i.parentId)
      const subItemsByParent = categoriesState.items.filter((i) => i.parentId)

      mainItems.forEach((main) => {
        const mid = main.id
        const mainExpanded = expandedMain.has(mid) || expandedMain.has(mainId(main.key)) || expandedMain.has(mainId(main.name))
        const subs = subItemsByParent.filter((s) => s.parentId === main.id)

        out.push({
          id: main.id,
          rawId: main.id,
          keyName: main.key,
          displayName: main.name || main.key,
          name: main.key,
          description: main.description || '',
          status: main.isActive ? 'active' : 'passive',
          level: 0,
          type: 'main',
          canExpand: true,
          expanded: mainExpanded
        })

        if (mainExpanded) {
          if (subs.length === 0) {
            out.push({
              id: `empty:${mid}`,
              keyName: '-',
              displayName: 'Alt kategori yok',
              name: 'Alt kategori yok',
              description: '',
              status: 'active',
              level: 1,
              type: 'sub',
              parentId: mid,
              canExpand: false,
              expanded: false
            })
          } else {
            subs.forEach((sub) => {
              out.push({
                id: sub.id,
                rawId: sub.id,
                keyName: sub.key,
                displayName: sub.name || sub.key,
                name: sub.key,
                description: sub.description || '',
                status: sub.isActive ? 'active' : 'passive',
                level: 1,
                type: 'sub',
                parentId: mid,
                canExpand: false,
                expanded: false
              })
            })
          }
        }
      })
      return out
    }

    const mains = categoriesState.mains
    mains.forEach((main) => {
      const mid = mainId(main)
      const mainMeta = categoriesState.meta?.[mid] ?? {}
      const mainExpanded = expandedMain.has(mid)
      const subs = getSubsForMain(main)

      out.push({
        id: mid,
        keyName: main,
        displayName: categoriesState.labels?.[main] || main,
        name: main,
        description: String(mainMeta.description ?? ''),
        status: mainMeta.status === 'passive' ? 'passive' : 'active',
        level: 0,
        type: 'main',
        canExpand: true,
        expanded: mainExpanded
      })

      if (mainExpanded) {
        if (subs.length === 0) {
          out.push({
            id: `empty:${mid}`,
            keyName: '-',
            displayName: 'Alt kategori yok',
            name: 'Alt kategori yok',
            description: '',
            status: 'active',
            level: 1,
            type: 'sub',
            parentId: mid,
            canExpand: false,
            expanded: false
          })
        } else {
          subs.forEach((sub) => {
            const sid = subId(main, sub)
            const subMeta = categoriesState.meta?.[sid] ?? {}
            out.push({
              id: sid,
              keyName: sub,
              displayName: categoriesState.labels?.[sub] || sub,
              name: sub,
              description: String(subMeta.description ?? ''),
              status: subMeta.status === 'passive' ? 'passive' : 'active',
              level: 1,
              type: 'sub',
              parentId: mid,
              canExpand: false,
              expanded: false
            })
          })
        }
      }
    })
    return out
  }, [categoriesState.items, categoriesState.mains, categoriesState.subsByMain, categoriesState.labels, categoriesState.meta, expandedMain])

  const [createRootOpen, setCreateRootOpen] = useState(false)
  const [createRootName, setCreateRootName] = useState('')
  const [createRootDesc, setCreateRootDesc] = useState('')
  const [createRootError, setCreateRootError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CategoryRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editStatus, setEditStatus] = useState<'active' | 'passive'>('active')

  const [addSubOpen, setAddSubOpen] = useState(false)
  const [addSubMain, setAddSubMain] = useState<string>('')
  const [addSubName, setAddSubName] = useState('')
  const [addSubDesc, setAddSubDesc] = useState('')

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CategoryRow | null>(null)
  // Silme reddedilirse (ör. kategoriye bağlı ürün var) kullanıcıya sebebi gösterilir;
  // öncesinde istek sessizce reddediliyor, pencere açık kalıyor ve hiçbir mesaj çıkmıyordu.
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const openEdit = (r: CategoryRow) => {
    setEditTarget(r)
    setEditName(r.displayName)
    setEditDesc(r.description)
    setEditStatus(r.status)
    setEditOpen(true)
  }

  const openAddSub = (mainName: string) => {
    setAddSubMain(mainName)
    setAddSubName('')
    setAddSubDesc('')
    setAddSubOpen(true)
  }

  const openDelete = (r: CategoryRow) => {
    setDeleteTarget(r)
    setDeleteOpen(true)
  }

  const parentLabel = useMemo(() => {
    if (!editTarget) return '-'
    if (editTarget.type === 'main') return '-'
    const mainKey = editTarget.id.split(':')[1] ?? ''
    const mainLabel = categoriesState.mains.find((m) => toKey(m) === mainKey) ?? ''
    return mainLabel || '-'
  }, [categoriesState.mains, editTarget])

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-zinc-950 tracking-tight">Kategori Yönetimi</h1>
          <p className="text-xs text-zinc-400 mt-0.5">Katalog hiyerarşisini, ana ve alt kategorileri yönetin.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateRootName('')
            setCreateRootDesc('')
            setCreateRootError(null)
            setCreateRootOpen(true)
          }}
          className="h-[38px] inline-flex items-center justify-center gap-2 px-4 text-xs font-semibold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-sm hover:shadow transition-all duration-150 hover:scale-[1.01] active:scale-[0.99] w-full sm:w-auto"
        >
          <FolderPlus size={15} />
          Ana Kategori Ekle
        </button>
      </div>

      {error ? (
        <div className="p-4 rounded-xl border border-rose-100 bg-rose-50 text-xs font-medium text-rose-700 flex items-center gap-2">
          <HelpCircle size={14} />
          {error}
        </div>
      ) : null}

      {/* Categories Grid Table */}
      <div className="bg-white border border-zinc-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/50 text-[11px] font-bold text-zinc-500 uppercase tracking-wider select-none">
                <th className="w-12 px-4 py-3.5 text-center"></th>
                <th className="w-[180px] px-4 py-3.5 text-left">Kategori ID</th>
                <th className="w-[280px] px-4 py-3.5 text-left">Kategori Adı</th>
                <th className="px-4 py-3.5 text-left">Açıklama</th>
                <th className="w-[120px] px-4 py-3.5 text-left">Durum</th>
                <th className="w-[160px] px-4 py-3.5 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-zinc-400">
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-4 w-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                      Yükleniyor...
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-zinc-400 italic">
                    Kategori bulunamadı.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isMain = r.type === 'main'
                  const isEmptyRow = r.id.startsWith('empty:')
                  const active = r.status === 'active'

                  return (
                    <tr
                      key={r.id}
                      className={`group hover:bg-zinc-50/50 transition-colors duration-150 ${
                        isMain ? 'bg-white' : 'bg-zinc-50/10'
                      }`}
                    >
                      {/* Expand Button */}
                      <td className="px-4 py-3 text-center">
                        {r.canExpand ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpandedMain((prev) => {
                                const next = new Set(prev)
                                if (next.has(r.id)) next.delete(r.id)
                                else next.add(r.id)
                                return next
                              })
                            }}
                            className={`h-7 w-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100/80 transition-all duration-200 ${
                              r.expanded ? 'rotate-90 text-emerald-600 bg-emerald-50 hover:bg-emerald-100/60' : ''
                            }`}
                          >
                            <ChevronRight size={15} />
                          </button>
                        ) : null}
                      </td>

                      {/* Category ID / Code */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold text-zinc-500 select-all group-hover:text-zinc-700 transition-colors bg-zinc-100 px-2 py-0.5 rounded">
                          {r.keyName || r.name}
                        </span>
                      </td>

                      {/* Category Name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center" style={{ paddingLeft: r.level * 20 }}>
                          {r.level > 0 && (
                            <div className="w-4 border-l border-b border-zinc-200 h-5 -mt-2.5 mr-2 rounded-bl-sm" />
                          )}
                          <span
                            className={`text-sm ${
                              isEmptyRow
                                ? 'text-zinc-400 italic font-normal'
                                : isMain
                                ? 'font-semibold text-zinc-850'
                                : 'text-zinc-700'
                            }`}
                          >
                            {isEmptyRow ? r.displayName : r.displayName}
                          </span>
                        </div>
                      </td>

                      {/* Description */}
                      <td className="px-4 py-3">
                        {!isEmptyRow && (
                          <span className="text-sm text-zinc-500 line-clamp-1 group-hover:text-zinc-700 transition-colors" title={r.description}>
                            {r.description || <span className="text-zinc-300">-</span>}
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {!isEmptyRow && (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
                              active
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-150'
                                : 'bg-zinc-100 text-zinc-650 border-zinc-200'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${active ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                            {active ? 'Aktif' : 'Pasif'}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        {!isEmptyRow && (
                          <div className="flex items-center justify-end gap-1 sm:opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            {/* Edit Button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                openEdit(r)
                              }}
                              className="h-8 w-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all duration-150"
                              title="Kategoriyi Düzenle"
                            >
                              <Settings size={15} />
                            </button>

                            {/* Add Subcategory Button */}
                            {isMain && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openAddSub(r.name)
                                }}
                                className="h-8 w-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all duration-150"
                                title="Alt Kategori Ekle"
                              >
                                <Plus size={15} />
                              </button>
                            )}

                            {/* Delete Button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                openDelete(r)
                              }}
                              className="h-8 w-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-all duration-150"
                              title="Kategoriyi Sil"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Main Category Modal */}
      <Modal
        isOpen={createRootOpen}
        onClose={() => {
          setCreateRootOpen(false)
          setCreateRootError(null)
        }}
        title="Yeni Ana Kategori Ekle"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              onClick={() => {
                setCreateRootOpen(false)
                setCreateRootError(null)
              }}
              className="h-[36px] px-4 text-xs font-semibold rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 transition active:scale-[0.98]"
            >
              İptal
            </button>
            <button
              type="button"
              onClick={async () => {
                const name = createRootName.trim()
                if (!name) {
                  setCreateRootError('Kategori adı boş bırakılamaz')
                  return
                }
                setCreateRootError(null)
                await createMainCategoryWithDesc(name, createRootDesc.trim() || undefined)
                await refresh()
                setCreateRootOpen(false)
              }}
              className="h-[36px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition active:scale-[0.98]"
            >
              Kategoriyi Kaydet
            </button>
          </div>
        }
      >
        {createRootError ? (
          <div className="mb-4 p-3 rounded-xl border border-rose-100 bg-rose-50 text-xs font-medium text-rose-700">
            {createRootError}
          </div>
        ) : null}
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-600 block mb-1">Kategori Adı *</label>
            <input
              value={createRootName}
              onChange={(e) => setCreateRootName(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition shadow-sm placeholder-zinc-400"
              placeholder="Örn: Beyaz Eşya"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-600 block mb-1">Açıklama</label>
            <textarea
              value={createRootDesc}
              onChange={(e) => setCreateRootDesc(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition shadow-sm placeholder-zinc-400 min-h-[90px] resize-y"
              placeholder="Kategori hakkında kısa açıklama..."
            />
          </div>
        </div>
      </Modal>

      {/* Edit Category Modal */}
      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title="Kategori Detaylarını Düzenle"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="h-[36px] px-4 text-xs font-semibold rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 transition active:scale-[0.98]"
            >
              İptal
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!editTarget) return
                const name = editName.trim()
                if (!name) return
                await updateCategory(editTarget.id, {
                  name,
                  description: editDesc,
                  status: editStatus
                })
                await refresh()
                setEditOpen(false)
              }}
              className="h-[36px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition active:scale-[0.98]"
            >
              Değişiklikleri Kaydet
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-500 block mb-1">Kategori Kodu (ID - Veritabanı Bağlantısı)</label>
            <div className="h-9 px-3 flex items-center rounded-xl border border-zinc-200 bg-zinc-100 font-mono text-xs text-zinc-600 font-bold select-all">
              {editTarget?.keyName || editTarget?.name}
            </div>
            <p className="text-[10px] text-zinc-400 mt-0.5">Ürün veritabanı bağlantısı için sabittir, değiştirilemez.</p>
          </div>

          {editTarget?.type === 'sub' ? (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-500 block mb-1">Üst Kategori</label>
              <div className="h-9 px-3 flex items-center rounded-xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-600 font-medium">
                {parentLabel}
              </div>
            </div>
          ) : null}
          
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-600 block mb-1">
              {editTarget?.type === 'main' ? 'Ana Kategori Adı *' : 'Kategori Adı *'}
            </label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition shadow-sm"
              placeholder="Kategori Adı"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-600 block mb-1">Açıklama</label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition shadow-sm min-h-[90px] resize-y"
              placeholder="Kategori Açıklaması"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-600 block mb-1">Kategori Durumu</label>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value === 'passive' ? 'passive' : 'active')}
              className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition shadow-sm"
            >
              <option value="active">Aktif (Katalogda Göster)</option>
              <option value="passive">Pasif (Gizle)</option>
            </select>
          </div>
        </div>
      </Modal>

      {/* Add Subcategory Modal */}
      <Modal
        isOpen={addSubOpen}
        onClose={() => setAddSubOpen(false)}
        title="Alt Kategori Ekle"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              onClick={() => setAddSubOpen(false)}
              className="h-[36px] px-4 text-xs font-semibold rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 transition active:scale-[0.98]"
            >
              İptal
            </button>
            <button
              type="button"
              onClick={async () => {
                const name = addSubName.trim()
                if (!name) return
                await createSubCategory(addSubMain, name, addSubDesc.trim() || undefined)
                await refresh()
                setExpandedMain((prev) => {
                  const next = new Set(prev)
                  next.add(mainId(addSubMain))
                  return next
                })
                setAddSubOpen(false)
              }}
              className="h-[36px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition active:scale-[0.98]"
            >
              Alt Kategoriyi Kaydet
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-500 block mb-1">Üst Ana Kategori</label>
            <div className="h-9 px-3 flex items-center rounded-xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-600 font-semibold">
              {addSubMain}
            </div>
          </div>
          
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-600 block mb-1">Alt Kategori Adı *</label>
            <input
              value={addSubName}
              onChange={(e) => setAddSubName(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition shadow-sm placeholder-zinc-450"
              placeholder="Örn: Ankastre Fırınlar"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-600 block mb-1">Açıklama</label>
            <textarea
              value={addSubDesc}
              onChange={(e) => setAddSubDesc(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition shadow-sm min-h-[90px] resize-y"
              placeholder="Alt kategori açıklaması..."
            />
          </div>
        </div>
      </Modal>

      {/* Delete Category Modal */}
      <Modal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Kategoriyi Sil"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className="h-[36px] px-4 text-xs font-semibold rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 transition active:scale-[0.98]"
            >
              İptal
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={async () => {
                if (!deleteTarget) return
                setDeleting(true)
                setDeleteError(null)
                try {
                  await deleteCategory(deleteTarget.id)
                  await refresh()
                  setDeleteOpen(false)
                } catch (e: any) {
                  setDeleteError(String(e?.message ?? 'Kategori silinemedi.'))
                } finally {
                  setDeleting(false)
                }
              }}
              className="h-[36px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition active:scale-[0.98]"
            >
              Kategoriyi Sil
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="text-sm text-zinc-700">
            Seçtiğiniz <span className="font-semibold text-zinc-900">"{deleteTarget?.name}"</span> kategorisi ve bu kategoriye bağlı tüm ilişkiler kalıcı olarak silinecektir.
          </div>
          <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-800 leading-relaxed">
            <strong>DİKKAT:</strong> Eğer bu bir ana kategori ise, altındaki tüm alt kategoriler de silinecektir. Bu işlem geri alınamaz!
          </div>
          {deleteError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 leading-relaxed">
              {deleteError}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
