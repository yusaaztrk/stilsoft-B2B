import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { fetchAllPages } from '../lib/fetchAllPages'
import { useOutletContext } from 'react-router-dom'
import Modal from '../components/Modal'
import Table, { type TableColumn } from '../components/Table'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import NotificationPopup from '../components/NotificationPopup'
import { CARI_SEARCH_LIMIT, buildCariSearchQuery } from '../utils/cariRemoteSearch'
import SearchableCariSelect, { type CariOption } from '../components/SearchableCariSelect'
import { fetchCustomersDropdown, type CustomerDto } from '../api/customers'
import { fetchVirmans, createVirman, deleteVirman, fetchNextVirmanDocumentNo, updateVirman, type VirmanDto, virmanCurrencySymbol } from '../api/virman'
import { Plus, Trash2, ArrowLeftRight, Info, Pencil } from 'lucide-react'

type LayoutContext = {
  activeMenuId: string
  activeTabId?: string
  setActiveTabId?: (id?: string) => void
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

/**
 * Virman tutarı KENDİ para biriminde.
 *
 * Simge sabit ₺ idi: virman kaydı para birimini taşıdığı hâlde (bkz. `VirmanController`)
 * liste ucu onu döndürmüyor, ekran da soramıyordu — dolarlı virman lira görünüyordu.
 */
function formatMoney(n: number, currencyTypeId?: number | null) {
  const v = Number(n ?? 0)
  const sym = virmanCurrencySymbol(currencyTypeId)
  return `${sym}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Uçtan gelen cari satırlarını seçim kutusu biçimine çevirir (açılış ve arama aynı yoldan). */
function buildVirmanCariOptions(customers: any[]): CariOption[] {
  return (customers ?? []).map((c) => ({
    value: String(c.customerCode ?? ''),
    label: `[${c.customerCode}] ${c.name}`,
    code: c.customerCode,
    name: c.name,
    phone: (c as any).phone ?? (c as any).gsm ?? ''
  }))
}

export default function VirmanPage() {
  const { setActiveTabId } = useOutletContext<LayoutContext>()

  useEffect(() => {
    if (setActiveTabId) {
      setActiveTabId('virmanListesi')
    }
  }, [setActiveTabId])

  const [items, setItems] = useState<VirmanDto[]>([])
  const [loading, setLoading] = useState(false)
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [customersLoading, setCustomersLoading] = useState(false)

  // Modal states
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form states
  const [formDate, setFormDate] = useState('')
  const [nextDocNo, setNextDocNo] = useState('')
  const [formSourceCode, setFormSourceCode] = useState('')
  const [formTargetCode, setFormTargetCode] = useState('')
  const [formDescription, setFormDescription] = useState('')

  // Interactive synced inputs
  const [sourceDebit, setSourceDebit] = useState('')
  const [sourceCredit, setSourceCredit] = useState('')
  const [targetDebit, setTargetDebit] = useState('')
  const [targetCredit, setTargetCredit] = useState('')

  // Popup states
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupVariant, setPopupVariant] = useState<'success' | 'error' | 'info'>('info')
  const [popupTitle, setPopupTitle] = useState('')
  const [popupMessage, setPopupMessage] = useState('')

  // Edit modal states
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<VirmanDto | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const showPopup = (variant: 'success' | 'error' | 'info', title: string, msg: string) => {
    setPopupVariant(variant)
    setPopupTitle(title)
    setPopupMessage(msg)
    setPopupOpen(true)
  }

  const loadData = async () => {
    setLoading(true)
    try {
      // Bütün kayıtlar sayfa sayfa (2026-10-08): eskiden yalnız son 500 geliyordu, eski kayıtlar
      // aramada/süzgeçte görünmüyordu. İlk sayfa hemen ekrana basılır, kalanlar arkadan eklenir.
      await fetchAllPages((skip, take) => fetchVirmans({ take, skip }), {
        key: (x) => String(x.id),
        onPage: (all, first) => {
          setItems(all)
          if (first) setLoading(false)
        }
      })
    } catch (err: any) {
      showPopup('error', 'Hata', err?.message ?? 'Veriler yüklenirken bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  /**
   * CARİ ARAMASI SUNUCUDA (2026-08-22) — Cari Ekstre'deki düzenin aynısı. Eskiden açılışta
   * bütün cari listesi indiriliyor ve kutu o gelene kadar boş duruyordu.
   * Uç parametreleri AYNEN korundu: pasifler ve muhtelif yine dışarıda.
   */
  const cariRemoteSearch = useCallback(async (query: string, typeKey: string): Promise<CariOption[]> => {
    setCustomersLoading(true)
    try {
      const data = await fetchCustomersDropdown({
        includeInactive: false,
        includeMuhtelif: false,
        q: buildCariSearchQuery(query, typeKey),
        limit: CARI_SEARCH_LIMIT
      })
      setCustomers(data ?? [])
      return buildVirmanCariOptions(data ?? [])
    } catch (err: any) {
      console.error('Cari dropdown yüklenirken hata:', err)
      return []
    } finally {
      setCustomersLoading(false)
    }
  }, [])

  const loadCustomers = async () => {
    await cariRemoteSearch('', 'all')
  }

  useEffect(() => {
    void loadData()
    void loadCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const customerOptions = useMemo(() => buildVirmanCariOptions(customers ?? []), [customers])

  const columns: TableColumn<VirmanDto>[] = useMemo(
    () => [
      {
        key: 'documentNo',
        label: 'Belge No',
        searchable: true,
        sortable: true,
        render: (v) => <span className="font-mono text-xs font-semibold text-gray-900">{String(v || '—')}</span>
      },
      {
        key: 'date',
        label: 'Tarih',
        searchable: true,
        sortable: true,
        filter: { type: 'date' },
        render: (v) => (v ? new Date(String(v)).toLocaleDateString('tr-TR') : '—')
      },
      {
        key: 'sourceCustomerName',
        label: 'Kaynak Cari',
        searchable: true,
        sortable: true,
        render: (v, row) => (
          <div className="flex flex-col">
            <span className="font-semibold text-gray-800 text-xs">{String(v || '')}</span>
            <span className="text-[10px] text-gray-400 font-mono">{row.sourceCustomerCode}</span>
          </div>
        )
      },
      {
        key: 'targetCustomerName',
        label: 'Hedef Cari',
        searchable: true,
        sortable: true,
        render: (v, row) => (
          <div className="flex flex-col">
            <span className="font-semibold text-gray-800 text-xs">{String(v || '')}</span>
            <span className="text-[10px] text-gray-400 font-mono">{row.targetCustomerCode}</span>
          </div>
        )
      },
      {
        key: 'amount',
        label: 'Tutar',
        sortable: true,
        render: (v, r) => <span className="font-bold text-gray-900 text-xs">{formatMoney(Number(v ?? 0), r.currencyTypeId)}</span>
      },
      {
        key: 'description',
        label: 'Açıklama',
        searchable: true,
        render: (v) => <span className="text-gray-500 text-xs italic">{String(v || '—')}</span>
      },
      {
        key: 'createUser',
        label: 'Kim Oluşturdu',
        searchable: true,
        sortable: true,
        render: (v) => <span className="text-gray-600 text-xs font-semibold">{String(v || '—')}</span>
      },
      {
        key: 'id',
        label: 'İşlemler',
        render: (id, row) => (
          <div className="flex items-center gap-1">
            <button
              onClick={() => openEditModal(row)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
              title="Düzenle"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDelete(Number(id))}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
              title="Sil"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const openNewModal = () => {
    setFormDate(new Date().toISOString().slice(0, 10))
    setFormSourceCode('')
    setFormTargetCode('')
    setFormDescription('')
    setSourceDebit('')
    setSourceCredit('')
    setTargetDebit('')
    setTargetCredit('')
    setNextDocNo('Yükleniyor...')
    void (async () => {
      try {
        const docNo = await fetchNextVirmanDocumentNo()
        setNextDocNo(docNo)
      } catch (err) {
        setNextDocNo('—')
      }
    })()
    setModalOpen(true)
  }

  const cleanNumericInput = (val: string) => {
    let cleaned = val.replace(/[^0-9.,]/g, '')
    cleaned = cleaned.replace(',', '.')
    const parts = cleaned.split('.')
    if (parts.length > 2) {
      cleaned = parts[0] + '.' + parts.slice(1).join('')
    }
    return cleaned
  }

  const onSourceDebitChange = (val: string) => {
    const clean = cleanNumericInput(val)
    setSourceDebit(clean)
    if (clean) {
      setSourceCredit('')
      setTargetDebit('')
      setTargetCredit(clean)
    } else {
      setTargetCredit('')
    }
  }

  const onSourceCreditChange = (val: string) => {
    const clean = cleanNumericInput(val)
    setSourceCredit(clean)
    if (clean) {
      setSourceDebit('')
      setTargetCredit('')
      setTargetDebit(clean)
    } else {
      setTargetDebit('')
    }
  }

  const onTargetDebitChange = (val: string) => {
    const clean = cleanNumericInput(val)
    setTargetDebit(clean)
    if (clean) {
      setTargetCredit('')
      setSourceDebit('')
      setSourceCredit(clean)
    } else {
      setSourceCredit('')
    }
  }

  const onTargetCreditChange = (val: string) => {
    const clean = cleanNumericInput(val)
    setTargetCredit(clean)
    if (clean) {
      setTargetDebit('')
      setSourceCredit('')
      setSourceDebit(clean)
    } else {
      setSourceDebit('')
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return

    const source = formSourceCode.trim()
    const target = formTargetCode.trim()

    if (!source || !target) {
      showPopup('error', 'Hata', 'Lütfen Kaynak Cari ve Hedef Cari seçiniz.')
      return
    }

    if (source === target) {
      showPopup('error', 'Hata', 'Kaynak Cari ve Hedef Cari aynı olamaz.')
      return
    }

    const debitAmt = Number(sourceDebit) || 0
    const creditAmt = Number(sourceCredit) || 0
    const amount = debitAmt > 0 ? debitAmt : creditAmt

    if (amount <= 0) {
      showPopup('error', 'Hata', 'Lütfen geçerli bir borç veya alacak tutarı giriniz.')
      return
    }

    const direction = debitAmt > 0 ? 'debit' : 'credit'

    setSaving(true)
    try {
      await createVirman({
        date: formDate,
        sourceCustomerCode: source,
        targetCustomerCode: target,
        amount,
        description: formDescription,
        direction
      })
      showPopup('success', 'Başarılı', 'Virman işlemi başarıyla kaydedildi.')
      setModalOpen(false)
      void loadData()
    } catch (err: any) {
      showPopup('error', 'Kaydedilemedi', err?.message ?? 'Kayıt sırasında bir hata oluştu.')
    } finally {
      setSaving(false)
    }
  }

  const openEditModal = (item: VirmanDto) => {
    setEditingItem(item)
    setEditAmount(String(item.amount ?? ''))
    setEditModalOpen(true)
  }

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editSaving || !editingItem) return

    const amount = Number(editAmount)
    if (amount <= 0) {
      showPopup('error', 'Hata', 'Lütfen geçerli bir tutar giriniz.')
      return
    }

    setEditSaving(true)
    try {
      await updateVirman(editingItem.id, { amount })
      showPopup('success', 'Başarılı', 'Virman tutarı başarıyla güncellendi.')
      setEditModalOpen(false)
      void loadData()
    } catch (err: any) {
      showPopup('error', 'Güncellenemedi', err?.message ?? 'Güncelleme sırasında bir hata oluştu.')
    } finally {
      setEditSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('Bu virman işlemini silmek istediğinize emin misiniz? İlgili cari ekstre hareketleri de silinecektir.')) {
      return
    }

    try {
      await deleteVirman(id)
      showPopup('success', 'Silindi', 'Virman kaydı başarıyla silindi.')
      void loadData()
    } catch (err: any) {
      showPopup('error', 'Silinemedi', err?.message ?? 'Silme işlemi sırasında hata oluştu.')
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
            <ArrowLeftRight className="w-6 h-6 text-emerald-600 animate-pulse" />
            <span>Virman İşlemleri</span>
          </h1>
          <p className="text-xs text-gray-400 font-medium mt-1">
            Cari hesaplar arası bakiye ve virman transfer fişlerini buradan yönetebilirsiniz.
          </p>
        </div>

        <button
          onClick={openNewModal}
          className="flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/10 hover:shadow-emerald-700/20 active:scale-95 transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
          <span>Yeni Virman</span>
        </button>
      </div>

      {/* Main Table Card */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-gray-500 flex flex-col items-center justify-center gap-2">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
            <span>Yükleniyor...</span>
          </div>
        ) : (
          <Table
          onRefresh={() => void loadData()}
            columns={columns}
            data={items}
            showColumnFilters
          />
        )}
      </div>

      {/* Create Modal */}
      <Modal isOpen={modalOpen} onClose={() => !saving && setModalOpen(false)} title="Yeni Virman Fişi">
        <form onSubmit={handleSave} className="space-y-6 p-1">
          {/* 2026-10-14: alanlar satır satır eşlendi — Belge No | Fiş Tarihi, Kaynak | Hedef Cari, Kaynak | Hedef etkisi */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput
              label="Belge No"
              value={nextDocNo}
              disabled
            />

            <FormInput
              label="Fiş Tarihi"
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Kaynak Cari</label>
              <SearchableCariSelect
                value={formSourceCode}
                onChange={(val) => setFormSourceCode(val)}
                options={customerOptions}
                remoteSearch={cariRemoteSearch}
                remoteLimit={CARI_SEARCH_LIMIT}
                showTypeFilter={false}
                placeholder="Kaynak Cari Seçiniz..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Hedef Cari</label>
              <SearchableCariSelect
                value={formTargetCode}
                onChange={(val) => setFormTargetCode(val)}
                options={customerOptions}
                remoteSearch={cariRemoteSearch}
                remoteLimit={CARI_SEARCH_LIMIT}
                showTypeFilter={false}
                placeholder="Hedef Cari Seçiniz..."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 bg-gray-50/70 border border-gray-100 rounded-xl space-y-3">
              <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Kaynak Cari Etkisi
              </span>
              <div className="grid grid-cols-2 gap-3">
                <FormInput
                  label="Borç (Çıkış)"
                  placeholder="0.00"
                  value={sourceDebit}
                  onChange={(e) => onSourceDebitChange(e.target.value)}
                  disabled={!!sourceCredit}
                />
                <FormInput
                  label="Alacak (Giriş)"
                  placeholder="0.00"
                  value={sourceCredit}
                  onChange={(e) => onSourceCreditChange(e.target.value)}
                  disabled={!!sourceDebit}
                />
              </div>
            </div>

            <div className="p-3 bg-gray-50/70 border border-gray-100 rounded-xl space-y-3">
              <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Hedef Cari Etkisi
              </span>
              <div className="grid grid-cols-2 gap-3">
                <FormInput
                  label="Borç (Çıkış)"
                  placeholder="0.00"
                  value={targetDebit}
                  onChange={(e) => onTargetDebitChange(e.target.value)}
                  disabled={!!targetCredit}
                />
                <FormInput
                  label="Alacak (Giriş)"
                  placeholder="0.00"
                  value={targetCredit}
                  onChange={(e) => onTargetCreditChange(e.target.value)}
                  disabled={!!targetDebit}
                />
              </div>
            </div>
          </div>

          <FormInput
            label="Açıklama"
            placeholder="Virman işlemine ait açıklama giriniz..."
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
          />

          <div className="flex items-center gap-2 p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl text-[11px] font-semibold text-emerald-800">
            <Info className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>
              Virman kaydı onaylandığında kaynak ve hedef carilerin hesap hareketlerine otomatik olarak borç ve alacak kayıtları eş zamanlı olarak işlenecektir.
            </span>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="h-10 px-4 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold text-xs active:scale-95 transition-all"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center justify-center gap-2 h-10 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/10 hover:shadow-emerald-700/20 active:scale-95 transition-all disabled:opacity-50"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'Kaydet'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={editModalOpen} onClose={() => !editSaving && setEditModalOpen(false)} title="Virman Fişi Düzenle">
        <form onSubmit={handleEditSave} className="space-y-6 p-1">
          {editingItem && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4">
                <FormInput
                  label="Belge No"
                  value={editingItem.documentNo}
                  disabled
                />

                <FormInput
                  label="Fiş Tarihi"
                  value={editingItem.date ? new Date(editingItem.date).toLocaleDateString('tr-TR') : '—'}
                  disabled
                />

                <FormInput
                  label="Kaynak Cari"
                  value={`[${editingItem.sourceCustomerCode}] ${editingItem.sourceCustomerName}`}
                  disabled
                />
              </div>

              <div className="space-y-4">
                <FormInput
                  label="Hedef Cari"
                  value={`[${editingItem.targetCustomerCode}] ${editingItem.targetCustomerName}`}
                  disabled
                />

                <FormInput
                  label="Tutar"
                  placeholder="0.00"
                  value={editAmount}
                  onChange={(e) => setEditAmount(cleanNumericInput(e.target.value))}
                  required
                />
                
                {editingItem.description && (
                  <FormInput
                    label="Açıklama"
                    value={editingItem.description}
                    disabled
                  />
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 p-3 bg-blue-50/50 border border-blue-100 rounded-xl text-[11px] font-semibold text-blue-800">
            <Info className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span>
              Tutar güncellendiğinde, hem bu virman fişindeki tutar hem de kaynak/hedef carilerin hesap hareketlerindeki ilgili borç/alacak tutarları otomatik olarak güncellenecektir.
            </span>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setEditModalOpen(false)}
              disabled={editSaving}
              className="h-10 px-4 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold text-xs active:scale-95 transition-all"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={editSaving}
              className="flex items-center justify-center gap-2 h-10 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/10 hover:shadow-emerald-700/20 active:scale-95 transition-all disabled:opacity-50"
            >
              {editSaving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'Kaydet'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Popup Notification */}
      <NotificationPopup
        isOpen={popupOpen}
        onClose={() => setPopupOpen(false)}
        title={popupTitle}
        message={popupMessage}
        variant={popupVariant}
      />
    </div>
  )
}
