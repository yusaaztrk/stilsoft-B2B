import { useEffect, useMemo, useState } from 'react'
import { PHONE_FORMAT_MESSAGE, PHONE_MAX_LENGTH, PHONE_PATTERN, formatPhoneNumber } from '../utils/phone'
import { AlertTriangle, CheckCircle, Pencil, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import Table, { type TableColumn } from '../components/Table'
import {
  fetchProductWarrantyRegistrations,
  updateProductWarrantyRegistration,
  deleteProductWarrantyRegistration,
  type ProductWarrantyRegistration
} from '../api/productWarrantyRegistrations'
import { fetchProducts } from '../api/products'
import type { Product } from '../types/Product'

type Row = ProductWarrantyRegistration

function formatDate(value: string) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, 10)
  return d.toLocaleDateString('tr-TR')
}

function calculateRemainingWarrantyDays(startDateStr: string): number {
  if (!startDateStr) return 0
  const start = new Date(startDateStr)
  if (Number.isNaN(start.getTime())) return 0

  // 3 yıl statik garanti süresi
  const end = new Date(start)
  end.setFullYear(end.getFullYear() + 3)

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate())

  const diffMs = endDate.getTime() - today.getTime()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}



export default function GarantiKayitlariPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Edit Modal State
  const [editingRow, setEditingRow] = useState<Row | null>(null)
  const [editSerialNumber, setEditSerialNumber] = useState('')
  const [editCustomerFullName, setEditCustomerFullName] = useState('')
  const [editPhoneNumber, setEditPhoneNumber] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editCity, setEditCity] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [editProductQuery, setEditProductQuery] = useState('')
  const [editProductsList, setEditProductsList] = useState<Product[]>([])
  const [loadingEditProducts, setLoadingEditProducts] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Delete Modal State
  const [deletingRow, setDeletingRow] = useState<Row | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchProductWarrantyRegistrations()
      setRows(data)
    } catch (e: any) {
      setError(e?.message ?? 'Kayıtlar alınamadı.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // Search products when editing
  useEffect(() => {
    const q = editProductQuery.trim()
    if (q.length < 2) {
      setEditProductsList([])
      return
    }

    const ac = new AbortController()
    const t = window.setTimeout(() => {
      setLoadingEditProducts(true)
      fetchProducts({ q, page: 1, pageSize: 8, includeInactive: true }, { signal: ac.signal })
        .then((res) => setEditProductsList(res.items ?? []))
        .catch((e) => {
          if (e?.name !== 'AbortError') setEditError(e?.message ?? 'Ürün aranırken hata oluştu.')
        })
        .finally(() => setLoadingEditProducts(false))
    }, 250)

    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [editProductQuery])

  const openEditModal = (row: Row) => {
    setEditingRow(row)
    setEditSerialNumber(row.serialNumber)
    setEditCustomerFullName(row.customerFullName)
    setEditPhoneNumber(row.phoneNumber)
    setEditEmail(row.email || '')
    setEditCity(row.city || '')
    setEditDescription(row.description || '')
    setEditProduct(null)
    setEditProductQuery('')
    setEditProductsList([])
    setEditError(null)
  }

  const saveEdit = async () => {
    if (!editingRow) return

    if (!editSerialNumber.trim() || !editCustomerFullName.trim() || !editPhoneNumber.trim()) {
      setEditError('Seri numarası, ad soyad ve telefon zorunludur.')
      return
    }

    if (!PHONE_PATTERN.test(editPhoneNumber)) {
      setEditError(PHONE_FORMAT_MESSAGE)
      return
    }

    try {
      setSavingEdit(true)
      setEditError(null)
      await updateProductWarrantyRegistration(editingRow.id, {
        productId: editProduct ? editProduct.id : undefined,
        serialNumber: editSerialNumber.trim(),
        customerFullName: editCustomerFullName.trim(),
        phoneNumber: editPhoneNumber.trim(),
        email: editEmail.trim(),
        city: editCity.trim(),
        description: editDescription.trim()
      })
      setEditingRow(null)
      setFeedback({ type: 'success', message: 'Garanti kaydı başarıyla güncellendi.' })
      void load()
    } catch (e: any) {
      setEditError(e?.message ?? 'Güncelleme yapılamadı.')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingRow) return
    try {
      setDeleting(true)
      await deleteProductWarrantyRegistration(deletingRow.id)
      setDeletingRow(null)
      setFeedback({ type: 'success', message: 'Garanti kaydı başarıyla silindi.' })
      void load()
    } catch (e: any) {
      setFeedback({ type: 'error', message: e?.message ?? 'Silme işlemi başarısız oldu.' })
    } finally {
      setDeleting(false)
    }
  }

  const columns: TableColumn<Row>[] = useMemo(
    () => [
      {
        key: 'warrantyStartDate',
        label: 'Garanti Başlangıç',
        searchable: true,
        sortable: true,
        filter: { type: 'date' },
        render: (value) => <span className="font-semibold text-slate-900">{formatDate(String(value ?? ''))}</span>
      },
      {
        key: 'remainingDays' as any,
        label: 'Garanti Kalan Süresi',
        sortable: true,
        render: (_value, row) => {
          const days = calculateRemainingWarrantyDays(row.warrantyStartDate)
          if (days <= 0) {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
                Süresi Doldu (0 Gün)
              </span>
            )
          }
          if (days <= 60) {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                {days} Gün
              </span>
            )
          }
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              {days} Gün
            </span>
          )
        }
      },
      {
        key: 'serialNumber',
        label: 'Seri No',
        searchable: true,
        sortable: true,
        render: (value) => <span className="font-mono text-xs text-slate-700">{String(value ?? '')}</span>
      },
      {
        key: 'productName',
        label: 'Ürün',
        searchable: true,
        sortable: true,
        render: (_value, row) => (
          <div>
            <div className="font-bold text-slate-800">{row.productName}</div>
            <div className="text-xs text-slate-500">{row.productCode}</div>
          </div>
        )
      },
      { key: 'customerFullName', label: 'Ad Soyad', searchable: true, sortable: true },
      { key: 'phoneNumber', label: 'Telefon', searchable: true, sortable: true },
      { key: 'city', label: 'Şehir', searchable: true, sortable: true, render: (value) => String(value || '-') },
      { key: 'createUser', label: 'Kayıt Yapan', searchable: true, sortable: true, render: (value) => String(value || '-') },
      {
        key: 'createTime',
        label: 'Kayıt Tarihi',
        searchable: true,
        sortable: true,
        filter: { type: 'date' },
        render: (value) => formatDate(String(value ?? ''))
      },
      {
        key: 'actions' as any,
        label: 'İşlemler',
        render: (_value, row) => (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openEditModal(row)}
              title="Düzenle"
              className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition"
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              onClick={() => setDeletingRow(row)}
              title="Sil"
              className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition"
            >
              <Trash2 size={15} />
            </button>
          </div>
        )
      }
    ],
    []
  )

  return (
    <div className="p-4 max-w-[1500px] mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Garanti Kayıtları</h1>
            <p className="text-xs text-slate-500">Garanti formundan kaydedilen ürün başlangıç kayıtları (3 Yıl Garanti Süresi).</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="h-9 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Yenile
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-semibold flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
              : 'border-rose-100 bg-rose-50 text-rose-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            {feedback.message}
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[280px] flex-1 max-w-xl">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-base h-9 pl-9 text-sm"
              placeholder="Seri no, ürün, ad soyad, telefon veya kayıt yapan ara..."
            />
          </div>
          <div className="text-xs font-semibold text-slate-500">Toplam {rows.length} kayıt</div>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">{error}</div>}

      <Table
          onRefresh={() => void load()}
        columns={columns}
        data={rows}
        showColumnFilters
        globalSearch={search}
        loading={loading}
        rowKey={(row) => row.id}
        initialPageSize={20}
        disableDateDefaultToday
      />

      {/* Düzenleme Modalı */}
      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg bg-white rounded-2xl p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-base text-slate-900">Garanti Kaydını Düzenle</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingRow(null)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X size={18} />
              </button>
            </div>

            {editError && (
              <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {editError}
              </div>
            )}

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div>
                  <span className="block text-[10px] font-bold text-slate-400 uppercase">Garanti Başlangıç</span>
                  <span className="text-xs font-bold text-slate-700">{formatDate(editingRow.warrantyStartDate)}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-400 uppercase">Kalan Garanti</span>
                  <span className="text-xs font-bold text-emerald-600">
                    {calculateRemainingWarrantyDays(editingRow.warrantyStartDate)} Gün (3 Yıl)
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Ürün</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={editProduct ? `${editProduct.stockCode} - ${editProduct.name}` : editProductQuery || `${editingRow.productCode} - ${editingRow.productName}`}
                    onChange={(e) => {
                      setEditProduct(null)
                      setEditProductQuery(e.target.value)
                    }}
                    className="input-base pl-9 h-9 text-xs"
                    placeholder="Ürün değiştirmek için arayın..."
                  />
                </div>
                {editProductsList.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                    {loadingEditProducts && <div className="px-3 py-2 text-xs text-slate-500">Ürünler aranıyor...</div>}
                    {editProductsList.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setEditProduct(p)
                          setEditProductsList([])
                          setEditProductQuery('')
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b last:border-b-0 border-slate-100"
                      >
                        <div className="text-xs font-bold text-slate-800">{p.name}</div>
                        <div className="text-[10px] text-slate-500">{p.stockCode}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Seri Numarası *</label>
                  <input
                    value={editSerialNumber}
                    onChange={(e) => setEditSerialNumber(e.target.value)}
                    className="input-base h-9 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Ad Soyad *</label>
                  <input
                    value={editCustomerFullName}
                    onChange={(e) => setEditCustomerFullName(e.target.value)}
                    className="input-base h-9 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Telefon *</label>
                  <input
                    value={editPhoneNumber}
                    onChange={(e) => setEditPhoneNumber(formatPhoneNumber(e.target.value))}
                    className="input-base h-9 text-xs"
                    maxLength={PHONE_MAX_LENGTH}
                    placeholder="0555 555 5555 555"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Şehir</label>
                  <input
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    className="input-base h-9 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">E-Posta</label>
                <input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="input-base h-9 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Açıklama</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="input-base min-h-[60px] text-xs py-1.5"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingRow(null)}
                className="px-4 h-9 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void saveEdit()}
                className="px-4 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white transition disabled:opacity-50"
              >
                {savingEdit ? 'Kaydediliyor...' : 'Güncelle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Silme Onay Modalı */}
      {deletingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2.5 rounded-xl bg-rose-100 border border-rose-200">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Garanti Kaydını Sil</h3>
                <p className="text-xs text-slate-500">Bu işlem geri alınamaz.</p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-700 space-y-1">
              <div><strong className="text-slate-900">Ürün:</strong> {deletingRow.productName} ({deletingRow.productCode})</div>
              <div><strong className="text-slate-900">Seri No:</strong> {deletingRow.serialNumber}</div>
              <div><strong className="text-slate-900">Müşteri:</strong> {deletingRow.customerFullName}</div>
            </div>

            <p className="text-xs text-slate-600">
              Yukarıdaki ürün garanti kaydını sistemden silmek istediğinize emin misiniz?
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingRow(null)}
                className="px-4 h-9 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="px-4 h-9 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white transition disabled:opacity-50"
              >
                {deleting ? 'Siliniyor...' : 'Evet, Sil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
