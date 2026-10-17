import React, { useEffect, useMemo, useState } from 'react'
import Table, { type TableColumn } from '../components/Table'
import { PHONE_FORMAT_MESSAGE, PHONE_PATTERN, formatPhoneNumber } from '../utils/phone'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import { createSupplier, deleteSupplier, fetchNextSupplierCode, fetchSuppliers, updateSupplier, type SupplierDto } from '../api/suppliers'

type Row = SupplierDto & { actions: string }

type FormState = {
  supplierCode: string
  fullName: string
  phoneNumber: string
  region: string
  address: string
}

function formatDateTime(s: string) {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s ?? '')
  return d.toLocaleString('tr-TR')
}

export default function SuppliersPage() {
  const emptyForm: FormState = {
    supplierCode: '',
    fullName: '',
    phoneNumber: '',
    region: '',
    address: ''
  }

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)

  const [globalSearch, setGlobalSearch] = useState('')

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupVariant, setPopupVariant] = useState<NotificationVariant>('info')
  const [popupTitle, setPopupTitle] = useState('')
  const [popupMessage, setPopupMessage] = useState('')

  const showPopup = (variant: NotificationVariant, title: string, message: string) => {
    setPopupVariant(variant)
    setPopupTitle(title)
    setPopupMessage(message)
    setPopupOpen(true)
  }

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)

  /**
   * `background`: liste EKRANDA KALARAK tazelenir.
   *
   * `loading` bayrağı tabloyu iskelet ekranla değiştiriyor, yani bileşeni söküp yeniden
   * kuruyordu. Silme ya da kayıttan sonra sütun süzgeçleri, sıralama ve kaydırma konumu
   * sıfırlanıyor; kullanıcı bunu "sayfa yenileniyor" diye görüyordu. İlk açılışta iskelet
   * doğru — gösterilecek bir şey yok; ama dolu bir listeyi tazelemek için boşaltmak gerekmez.
   */
  const loadRows = async (options?: { background?: boolean }) => {
    const background = options?.background ?? false
    try {
      if (!background) setLoading(true)
      setError(null)
      const data = await fetchSuppliers()
      setRows(data.map((x) => ({ ...x, actions: '' })))
    } catch (e: any) {
      setError(String(e?.message ?? 'Bir hata oluştu'))
      setRows([])
    } finally {
      if (!background) setLoading(false)
    }
  }

  useEffect(() => {
    void loadRows()
  }, [])

  const filteredRows = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return rows

    return rows.filter((r) => {
      return (
        String(r.supplierCode ?? '').toLowerCase().includes(q) ||
        String(r.fullName ?? '').toLowerCase().includes(q) ||
        String(r.phoneNumber ?? '').toLowerCase().includes(q) ||
        String(r.region ?? '').toLowerCase().includes(q) ||
        String(r.address ?? '').toLowerCase().includes(q)
      )
    })
  }, [globalSearch, rows])

  const openEditModal = (row: Row) => {
    setError(null)
    setModalError(null)
    setModalMode('edit')
    setEditId(row.id)
    setForm({
      supplierCode: String(row.supplierCode ?? ''),
      fullName: String(row.fullName ?? ''),
      phoneNumber: String(row.phoneNumber ?? ''),
      region: String(row.region ?? ''),
      address: String(row.address ?? '')
    })
    setModalOpen(true)
  }

  const onDelete = async (row: Row) => {
    const ok = window.confirm(`[${row.supplierCode}] tedarikçisini silmek istediğinize emin misiniz?`)
    if (!ok) return

    try {
      // `setLoading(true)` BURADAN KALDIRILDI: tabloyu iskelete çevirip arka plan
      // tazelemesinin bütün faydasını götürüyordu. Geri bildirim zaten var — satır anında
      // kalkıyor ve ardından bildirim çıkıyor.
      await deleteSupplier(row.id)

      // Sunucu silmeyi onayladı: satır hemen listeden düşer.
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      showPopup('success', 'Başarılı', 'Tedarikçi silindi')

      await loadRows({ background: true })
    } catch (e: any) {
      const msg = String(e?.message ?? 'Bir hata oluştu')
      setError(msg)
      showPopup('error', 'Hata', msg)
    }
  }

  const columns: TableColumn<Row>[] = useMemo(
    () => [
      { key: 'supplierCode', label: 'Tedarikçi Kodu', searchable: true },
      { key: 'fullName', label: 'Tedarikçi İsim ', searchable: true },
      { key: 'phoneNumber', label: 'Telefon', searchable: true },
      { key: 'region', label: 'Bölge', searchable: true },
      { key: 'address', label: 'Adres', searchable: true },
      {
        key: 'createTime',
        label: 'Oluşturma Tarihi',
        searchable: true,
        render: (v) => formatDateTime(String(v ?? ''))
      },
      { key: 'createUser', label: 'Oluşturan Kullanıcı', searchable: true },
      {
        key: 'actions',
        label: '',
        render: (_value, row) => (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                openEditModal(row)
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              Düzenle
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium bg-red-50 text-red-700 hover:bg-red-100 border border-red-100 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                void onDelete(row)
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
              Sil
            </button>
          </div>
        )
      }
    ],
    [rows]
  )

  const openCreateModal = () => {
    setError(null)
    setModalError(null)
    setModalMode('create')
    setEditId(null)
    setForm(emptyForm)
    setModalOpen(true)
    void (async () => {
      try {
        const code = await fetchNextSupplierCode()
        setForm((p) => ({ ...p, supplierCode: code }))
      } catch {
      }
    })()
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
  }

  const submitModal = async () => {
    try {
      setSaving(true)
      setModalError(null)

      const supplierCode = form.supplierCode.trim()
      const fullName = form.fullName.trim()
      const phoneNumber = form.phoneNumber.trim()
      const region = form.region.trim()
      const address = form.address.trim()

      if (!supplierCode || !fullName) {
        setModalError('Lütfen zorunlu alanları doldurun')
        return
      }

      if (phoneNumber && !PHONE_PATTERN.test(phoneNumber)) {
        setModalError(PHONE_FORMAT_MESSAGE)
        return
      }

      if (modalMode === 'create') {
        await createSupplier({
          supplierCode,
          fullName,
          phoneNumber: phoneNumber || null,
          region: region || null,
          address: address || null
        })
      } else {
        if (!editId) {
          setError('Tedarikçi id bulunamadı')
          return
        }
        await updateSupplier(editId, {
          supplierCode,
          fullName,
          phoneNumber: phoneNumber || null,
          region: region || null,
          address: address || null
        })
      }

      setModalOpen(false)
      await loadRows({ background: true })
      showPopup('success', 'Başarılı', modalMode === 'create' ? 'Tedarikçi oluşturuldu' : 'Tedarikçi güncellendi')
    } catch (e: any) {
      const msg = String(e?.message ?? 'Bir hata oluştu')
      setModalError(msg)
      showPopup('error', 'Hata', msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4">
      <NotificationPopup isOpen={popupOpen} onClose={() => setPopupOpen(false)} variant={popupVariant} title={popupTitle} message={popupMessage} />

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Tedarikçiler</h1>
          <p className="text-xs text-gray-400 mt-0.5">Tanımlar / Tedarikçi Yönetimi</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Arama..."
              className="w-56 h-[34px] pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            />
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Yeni Tedarikçi
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600 whitespace-pre-line">{error}</div>}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onMouseDown={() => {
              closeModal()
            }}
          />

          <div className="relative z-10 w-full max-w-2xl mx-4 bg-white rounded-xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800">{modalMode === 'create' ? 'Yeni Tedarikçi' : 'Tedarikçi Güncelle'}</div>
              <button
                type="button"
                disabled={saving}
                onClick={closeModal}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700"
              >
                Kapat
              </button>
            </div>

            <div className="px-5 py-4">
              {modalError && <div className="mb-3 text-xs font-semibold text-red-600 whitespace-pre-line">{modalError}</div>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Tedarikçi Kodu</div>
                  <input
                    value={form.supplierCode}
                    readOnly
                    className="input-base h-9 text-sm bg-gray-50 text-gray-900 cursor-not-allowed font-semibold"
                    placeholder="Otomatik oluşturuluyor..."
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Tedarikçi İsim Soyisim</div>
                  <input
                    value={form.fullName}
                    onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="Örn: Ali Veli"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Telefon Numarası</div>
                  <input
                    inputMode="numeric"
                    value={form.phoneNumber}
                    onChange={(e) => {
                      const formatted = formatPhoneNumber(e.target.value)
                      setForm((p) => ({ ...p, phoneNumber: formatted }))
                    }}
                    className="input-base h-9 text-sm"
                    placeholder="0555 555 5555 555"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Bölge</div>
                  <input
                    value={form.region}
                    onChange={(e) => setForm((p) => ({ ...p, region: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="Örn: İstanbul"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Adres</div>
                  <textarea
                    value={form.address}
                    onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                    className="input-base text-sm min-h-[90px]"
                    placeholder="Adres"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={closeModal}
                className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitModal()}
                className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                {saving ? 'Kaydediliyor...' : modalMode === 'create' ? 'Ekle' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
                <div className="h-3 bg-gray-100 rounded animate-pulse flex-1" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-24" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-16" />
              </div>
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="text-gray-300 text-2xl mb-1">📦</div>
            <div className="text-xs text-gray-400 font-medium">Kayıt bulunamadı.</div>
          </div>
        ) : (
          <Table
          onRefresh={() => void loadRows()} columns={columns} data={filteredRows} showColumnFilters />
        )}
      </div>
    </div>
  )
}
