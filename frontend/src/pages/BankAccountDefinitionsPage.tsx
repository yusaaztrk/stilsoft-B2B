import React, { useEffect, useMemo, useState } from 'react'
import Table, { type TableColumn } from '../components/Table'
import Modal from '../components/Modal'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import { createBankDetail, deleteBankDetail, fetchBankDetailsDropdown, type BankDetailDropdownDto } from '../api/bankDetails'
import { formatMoneyTr, handleCurrencyInputChange, parseMoneyTr } from '../utils/formatters'
import {
  createBankAccountDefinition,
  deleteBankAccountDefinition,
  fetchBankAccountDefinitions,
  updateBankAccountDefinition,
  type BankAccountDefinitionDto
} from '../api/bankAccountDefinitions'

type Row = BankAccountDefinitionDto & { actions: string }

type FormState = {
  bankDetailId: string
  accountCode: string
  accountName: string
  accountNo: string
  accountType: string
  currencyTypeId: string
  /** Açılış bakiyesi, tr-TR biçiminde metin ("1.125,00"). Kaydederken `parseMoneyTr` ile çözülür. */
  budget: string
  /** Hesap kesim tarihi, 'yyyy-MM-dd'. Boş = tarih yok (NULL gider). */
  statementDate: string
}

type BankFormState = {
  bankCode: string
  name: string
  isActive: boolean
}

const accountTypeOptions: Array<{ value: number; label: string }> = [
  { value: 0, label: '0 vadesiz hesap' },
  { value: 3, label: '3 teminat hesabı' },
  { value: 7, label: '7 kredi hesabı' },
  { value: 20, label: '20 taksitli kredi hesabı' },
  { value: 14, label: '14 pos hesabı' },
  { value: 300, label: '300 şirket kredi kartı' }
]

const currencyOptions: Array<{ value: number; label: string }> = [
  { value: 1, label: 'TL' },
  { value: 2, label: 'EURO' },
  { value: 3, label: 'DOLAR' },
  { value: 4, label: 'STERLİN' }
]

function normalizeCurrencyTypeId(v: number) {
  const n = Number(v ?? 1)
  return n > 0 ? n : 1
}

function formatDateTime(s: string) {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s ?? '')
  return d.toLocaleString('tr-TR')
}

function accountTypeLabel(v: number) {
  return accountTypeOptions.find((x) => x.value === v)?.label ?? String(v)
}

function currencyLabel(v: number) {
  const n = Number(v ?? 1)
  if (n === 2) return 'EURO'
  if (n === 3) return 'DOLAR'
  if (n === 4) return 'STERLİN'
  return 'TL'
}

function parseIntStrict(s: string) {
  const n = Number(String(s ?? '').trim())
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

function formatBankAccountNoInput(value: string) {
  const raw = String(value ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '')

  const capped = raw.slice(0, 26)
  return capped.replace(/(.{4})/g, '$1 ').trim()
}

function friendlyApiErrorMessage(e: any, fallback: string) {
  const msg = String(e?.message ?? '').trim()
  if (!msg) return fallback
  if (msg.startsWith('{') || msg.startsWith('[')) {
    try {
      const j = JSON.parse(msg)
      const title = String(j?.title ?? '').trim()
      const message = String(j?.message ?? j?.error ?? '').trim()
      const errors = j?.errors
      if (errors && typeof errors === 'object') {
        const parts: string[] = []
        Object.entries(errors).forEach(([k, v]) => {
          if (Array.isArray(v)) v.forEach((x) => parts.push(`${k}: ${x}`))
          else if (typeof v === 'string') parts.push(`${k}: ${v}`)
        })
        if (parts.length) return parts.join('\n')
      }
      if (message) return message
      if (title) return title
    } catch {
      return msg
    }
  }
  return msg
}

export default function BankAccountDefinitionsPage() {
  const emptyForm: FormState = {
    bankDetailId: '',
    accountCode: '',
    accountName: '',
    accountNo: '',
    accountType: String(accountTypeOptions[0].value),
    currencyTypeId: String(currencyOptions[0].value),
    budget: '0,00',
    statementDate: ''
  }

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [globalSearch, setGlobalSearch] = useState('')

  const [banks, setBanks] = useState<BankDetailDropdownDto[]>([])

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

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [confirmMessage, setConfirmMessage] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)

  const [bankModalOpen, setBankModalOpen] = useState(false)
  const [bankSaving, setBankSaving] = useState(false)
  const [bankForm, setBankForm] = useState<BankFormState>({ bankCode: '', name: '', isActive: true })

  const [bankSearchTerm, setBankSearchTerm] = useState('')
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false)
  const [selectedBankForEdit, setSelectedBankForEdit] = useState<BankDetailDropdownDto | null>(null)

  // Bank search for modal
  const [bankModalSearchTerm, setBankModalSearchTerm] = useState('')

  // Bank delete confirmation
  const [bankDeleteConfirmOpen, setBankDeleteConfirmOpen] = useState(false)
  const [bankToDeleteId, setBankToDeleteId] = useState<number | null>(null)
  const [bankToDeleteName, setBankToDeleteName] = useState('')

  const filteredBanks = useMemo(() => {
    if (!bankSearchTerm) return banks
    const searchLower = bankSearchTerm.toLowerCase()
    return banks.filter(bank => 
      bank.bankCode.toLowerCase().includes(searchLower) ||
      bank.name.toLowerCase().includes(searchLower)
    )
  }, [banks, bankSearchTerm])

  // Filtered banks for modal
  const filteredBanksForModal = useMemo(() => {
    if (!bankModalSearchTerm) return banks
    const searchLower = bankModalSearchTerm.toLowerCase()
    return banks.filter(bank => 
      bank.bankCode.toLowerCase().includes(searchLower) ||
      bank.name.toLowerCase().includes(searchLower)
    )
  }, [banks, bankModalSearchTerm])

  const selectedBank = useMemo(() => {
    return banks.find(b => String(b.id) === form.bankDetailId)
  }, [banks, form.bankDetailId])

  const loadBanks = async () => {
    try {
      const data = await fetchBankDetailsDropdown({ includeInactive: false })
      setBanks(data)
    } catch {
      setBanks([])
    }
  }

  const loadRows = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchBankAccountDefinitions()
      setRows(data.map((x) => ({ ...x, actions: '' })))
    } catch (e: any) {
      setError(String(e?.message ?? 'Bir hata oluştu'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadBanks()
    void loadRows()
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (!target.closest('.bank-search-container')) {
        setBankDropdownOpen(false)
      }
    }

    if (bankDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [bankDropdownOpen])

  const columns: TableColumn<Row>[] = useMemo(
    () => [
      { key: 'bankCode', label: 'Banka Kodu', searchable: true },
      { key: 'bankName', label: 'Banka Adı', searchable: true },
      { key: 'accountCode', label: 'Hesap Kodu', searchable: true },
      { key: 'accountName', label: 'Hesap Adı', searchable: true },
      { key: 'accountNo', label: 'Hesap No', searchable: true },
      {
        key: 'budget',
        label: 'Açılış Bakiyesi',
        searchable: true,
        render: (v) => formatMoneyTr(v as any)
      },
      {
        key: 'statementDate',
        label: 'Hesap Kesim Tarihi',
        searchable: true,
        render: (v) => {
          const raw = String(v ?? '').slice(0, 10)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '-'
          const [y, m, d] = raw.split('-')
          return `${d}.${m}.${y}`
        }
      },
      {
        key: 'accountType',
        label: 'Hesap Tip',
        searchable: true,
        filter: {
          type: 'select',
          options: accountTypeOptions.map((o) => ({ label: o.label, value: String(o.value) }))
        },
        render: (v) => accountTypeLabel(Number(v ?? 0))
      },
      {
        key: 'currencyTypeId',
        label: 'Döviz Tip',
        searchable: true,
        filter: {
          type: 'select',
          options: currencyOptions.map((o) => ({ label: o.label, value: String(o.value) }))
        },
        render: (v) => currencyLabel(Number(v ?? 0))
      },
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
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              onClick={(e) => {
                e.stopPropagation()
                setModalMode('edit')
                setEditId(row.id)
                setForm({
                  bankDetailId: String(row.bankDetailId ?? ''),
                  accountCode: String(row.accountCode ?? ''),
                  accountName: String(row.accountName ?? ''),
                  accountNo: String(row.accountNo ?? ''),
                  accountType: String(row.accountType ?? accountTypeOptions[0].value),
                  currencyTypeId: String(normalizeCurrencyTypeId(Number(row.currencyTypeId ?? currencyOptions[0].value))),
                  budget: formatMoneyTr(row.budget ?? 0),
                  statementDate: String(row.statementDate ?? '').slice(0, 10)
                })
                setModalOpen(true)
              }}
            >
              Düzenle
            </button>
            <button
              type="button"
              className="text-xs font-semibold text-red-500 hover:text-red-600"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmId(row.id)
                setConfirmMessage(`Silmek istediğinize emin misiniz? (${row.bankName} / ${row.accountCode})`)
                setConfirmOpen(true)
              }}
            >
              Sil
            </button>
          </div>
        )
      }
    ],
    []
  )

  const openCreate = () => {
    setModalMode('create')
    setEditId(null)
    setForm({ ...emptyForm })
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditId(null)
    setForm({ ...emptyForm })
    setBankSearchTerm('')
    setBankDropdownOpen(false)
  }

  const openCreateBank = () => {
    setBankForm({ bankCode: '', name: '', isActive: true })
    setSelectedBankForEdit(null)
    setBankModalSearchTerm('')
    setBankModalOpen(true)
  }

  const openEditBank = (bank: BankDetailDropdownDto) => {
    setBankForm({ 
      bankCode: bank.bankCode, 
      name: bank.name, 
      isActive: bank.isActive 
    })
    setSelectedBankForEdit(bank)
    setBankModalOpen(true)
  }

  const deleteBank = async (id: number, bankName: string) => {
    setBankToDeleteId(id)
    setBankToDeleteName(bankName)
    setBankDeleteConfirmOpen(true)
  }

  const confirmDeleteBank = async () => {
    if (!bankToDeleteId) return

    try {
      setBankSaving(true)
      const res = await deleteBankDetail(bankToDeleteId)
      showPopup('success', 'Başarılı', res.message || 'Banka silindi')
      await loadBanks()
      // If we were editing this bank, close the modal
      if (selectedBankForEdit?.id === bankToDeleteId) {
        setBankModalOpen(false)
        setSelectedBankForEdit(null)
      }
      setBankDeleteConfirmOpen(false)
      setBankToDeleteId(null)
      setBankToDeleteName('')
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Banka silinemedi'))
    } finally {
      setBankSaving(false)
    }
  }

  const submitBank = async () => {
    const bankCode = String(bankForm.bankCode ?? '').trim()
    const name = String(bankForm.name ?? '').trim()

    if (!bankCode) {
      showPopup('error', 'Hata', 'Banka kodu zorunlu')
      return
    }
    if (!name) {
      showPopup('error', 'Hata', 'Banka adı zorunlu')
      return
    }

    // For new bank, check for duplicates
    if (!selectedBankForEdit) {
      // Check for duplicate bank code
      const existingBankByCode = banks.find(b => 
        b.bankCode.toLowerCase() === bankCode.toLowerCase()
      )
      if (existingBankByCode) {
        showPopup('error', 'Hata', `Aynı banka koduna sahip bir banka zaten mevcut: ${existingBankByCode.name}`)
        return
      }

      // Check for duplicate bank name
      const existingBankByName = banks.find(b => 
        b.name.toLowerCase() === name.toLowerCase()
      )
      if (existingBankByName) {
        showPopup('error', 'Hata', `Aynı banka adına sahip bir banka zaten mevcut: ${existingBankByName.bankCode}`)
        return
      }
    }

    try {
      setBankSaving(true)
      const created = await createBankDetail({ bankCode, name, isActive: bankForm.isActive })
      showPopup('success', 'Başarılı', selectedBankForEdit ? 'Banka güncellendi' : 'Banka oluşturuldu')
      setBankModalOpen(false)
      setSelectedBankForEdit(null)
      await loadBanks()

      // If account modal is open, select the newly created bank automatically
      if (modalOpen && created?.id) {
        setForm((p) => ({ ...p, bankDetailId: String(created.id) }))
      }
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Banka işlemi başarısız'))
    } finally {
      setBankSaving(false)
    }
  }

  const submit = async () => {
    const bankDetailId = parseIntStrict(form.bankDetailId)
    const accountType = parseIntStrict(form.accountType)
    const currencyTypeId = parseIntStrict(form.currencyTypeId)
    // tr-TR biçimli metni çöz ("1.125,00" -> 1125). Eski `replace(',', '.')` binlik
    // ayracını görmezden geliyordu: "1.125,00" -> 1.125 olarak okunuyordu.
    const budget = parseMoneyTr(form.budget)
    const statementDateRaw = String(form.statementDate ?? '').trim()
    const statementDate = /^\d{4}-\d{2}-\d{2}$/.test(statementDateRaw) ? statementDateRaw : null

    const accountCode = String(form.accountCode ?? '').trim()
    const accountName = String(form.accountName ?? '').trim()
    const accountNo = String(form.accountNo ?? '').trim()

    if (!bankDetailId || bankDetailId <= 0) {
      showPopup('error', 'Hata', 'Banka seçiniz')
      return
    }
    if (!accountCode) {
      showPopup('error', 'Hata', 'Hesap Kodu zorunlu')
      return
    }
    if (!accountName) {
      showPopup('error', 'Hata', 'Hesap Adı zorunlu')
      return
    }
    if (!accountNo) {
      showPopup('error', 'Hata', 'Banka Hesap No zorunlu')
      return
    }
    if (accountType === null) {
      showPopup('error', 'Hata', 'Hesap Tipi seçiniz')
      return
    }
    if (currencyTypeId === null) {
      showPopup('error', 'Hata', 'Döviz Tipi seçiniz')
      return
    }

    try {
      setSaving(true)
      if (modalMode === 'create') {
        const res = await createBankAccountDefinition({
          bankDetailId,
          accountCode,
          accountName,
          accountNo,
          accountType,
          currencyTypeId,
          budget,
          statementDate
        })
        showPopup('success', 'Başarılı', res.message || 'Kayıt oluşturuldu')
      } else {
        if (!editId) return
        const res = await updateBankAccountDefinition(editId, {
          bankDetailId,
          accountCode,
          accountName,
          accountNo,
          accountType,
          currencyTypeId,
          budget,
          statementDate
        })
        showPopup('success', 'Başarılı', res.message || 'Kayıt güncellendi')
      }

      closeModal()
      await loadRows()
    } catch (e: any) {
      showPopup('error', 'Hata', friendlyApiErrorMessage(e, 'İşlem başarısız'))
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (id: number) => {
    try {
      setSaving(true)
      const res = await deleteBankAccountDefinition(id)
      showPopup('success', 'Başarılı', res.message || 'Silme tamamlandı')
      await loadRows()
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Silme başarısız'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <NotificationPopup isOpen={popupOpen} variant={popupVariant} title={popupTitle} message={popupMessage} onClose={() => setPopupOpen(false)} />

      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (saving) return
          setConfirmOpen(false)
          setConfirmId(null)
        }}
        title="Onay"
        footer={
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setConfirmOpen(false)
                setConfirmId(null)
              }}
              className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Hayır
            </button>
            <button
              type="button"
              disabled={saving || !confirmId}
              onClick={() => {
                const id = confirmId
                if (!id) return
                setConfirmOpen(false)
                setConfirmId(null)
                void onDelete(id)
              }}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-red-500 text-white hover:bg-red-600"
            >
              Evet
            </button>
          </>
        }
      >
        <div className="text-sm text-gray-700 whitespace-pre-line">{confirmMessage}</div>
      </Modal>

      <Modal
        isOpen={bankModalOpen}
        onClose={() => {
          if (bankSaving) return
          setBankModalOpen(false)
          setSelectedBankForEdit(null)
        }}
        title={selectedBankForEdit ? 'Banka Güncelle' : 'Yeni Banka Tanım'}
        footer={
          <>
            <button
              type="button"
              disabled={bankSaving}
              onClick={() => {
                setBankModalOpen(false)
                setSelectedBankForEdit(null)
              }}
              className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={bankSaving}
              onClick={() => void submitBank()}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-brand-blue text-white hover:opacity-95"
            >
              {bankSaving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        <div className="space-y-6 min-h-[400px]">
          {/* Existing Banks List */}
          <div>
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-3">Mevcut Bankalar</div>
            
            {/* Search Bar */}
            <div className="mb-3">
              <input
                type="text"
                value={bankModalSearchTerm}
                onChange={(e) => setBankModalSearchTerm(e.target.value)}
                placeholder="Banka kodu veya adıyla ara..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md min-h-[200px]">
              {filteredBanksForModal.length === 0 ? (
                <div className="p-3 text-sm text-gray-500">
                  {bankModalSearchTerm ? 'Arama kriterine uygun banka bulunamadı' : 'Henüz banka tanımlanmamış'}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredBanksForModal.map((bank) => (
                    <div
                      key={bank.id}
                      className={`p-3 flex items-center justify-between hover:bg-gray-50 ${
                        selectedBankForEdit?.id === bank.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">[{bank.bankCode}] {bank.name}</div>
                        <div className="text-xs text-gray-500">
                          {bank.isActive ? 'Aktif' : 'Pasif'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditBank(bank)}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                        >
                          Düzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteBank(bank.id, bank.name)}
                          disabled={bankSaving}
                          className="text-xs font-semibold text-red-500 hover:text-red-600 disabled:opacity-50"
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bank Form */}
          <div className="border-t pt-4">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-3">
              {selectedBankForEdit ? 'Banka Bilgilerini Güncelle' : 'Yeni Banka Ekle'}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Banka Kodu</div>
                <input 
                  value={bankForm.bankCode} 
                  onChange={(e) => setBankForm((p) => ({ ...p, bankCode: e.target.value }))} 
                  className="input-base h-9 text-sm" 
                  disabled={!!selectedBankForEdit}
                />
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Banka Adı</div>
                <input 
                  value={bankForm.name} 
                  onChange={(e) => setBankForm((p) => ({ ...p, name: e.target.value }))} 
                  className="input-base h-9 text-sm" 
                />
              </div>

              <div className="space-y-1 flex items-end md:col-span-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
                  <input 
                    type="checkbox" 
                    checked={bankForm.isActive} 
                    onChange={(e) => setBankForm((p) => ({ ...p, isActive: e.target.checked }))} 
                  />
                  Aktif
                </label>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={bankDeleteConfirmOpen}
        onClose={() => {
          if (bankSaving) return
          setBankDeleteConfirmOpen(false)
          setBankToDeleteId(null)
          setBankToDeleteName('')
        }}
        title="Banka Silme Onayı"
        footer={
          <>
            <button
              type="button"
              disabled={bankSaving}
              onClick={() => {
                setBankDeleteConfirmOpen(false)
                setBankToDeleteId(null)
                setBankToDeleteName('')
              }}
              className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              İptal
            </button>
            <button
              type="button"
              disabled={bankSaving || !bankToDeleteId}
              onClick={() => void confirmDeleteBank()}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-red-500 text-white hover:bg-red-600"
            >
              {bankSaving ? 'Siliniyor...' : 'Sil'}
            </button>
          </>
        }
      >
        <div className="text-sm text-gray-700">
          <p className="mb-3">
            <strong>{bankToDeleteName}</strong> adlı bankayı silmek istediğinizden emin misiniz?
          </p>
          <p className="text-red-600 font-semibold">
            Bu işlem geri alınamaz!
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={modalMode === 'create' ? 'Yeni Hesap' : 'Hesap Güncelle'}
        footer={
          <>
            <button
              type="button"
              disabled={saving}
              onClick={closeModal}
              className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-brand-blue text-white hover:opacity-95"
            >
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1 md:col-span-2">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Banka</div>
            <div className="relative bank-search-container">
              <input
                type="text"
                value={bankSearchTerm || (selectedBank ? `[${selectedBank.bankCode}] ${selectedBank.name}` : '')}
                onChange={(e) => {
                  setBankSearchTerm(e.target.value)
                  setBankDropdownOpen(true)
                }}
                onFocus={() => setBankDropdownOpen(true)}
                placeholder="Banka ara veya seç..."
                className="input-base h-9 text-sm w-full"
              />
              {bankDropdownOpen && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {filteredBanks.length === 0 ? (
                    <div className="p-2 text-sm text-gray-500">Banka bulunamadı</div>
                  ) : (
                    filteredBanks.map((b) => (
                      <div
                        key={b.id}
                        className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-100"
                        onClick={() => {
                          setForm((p) => ({ ...p, bankDetailId: String(b.id) }))
                          setBankSearchTerm('')
                          setBankDropdownOpen(false)
                        }}
                      >
                        [{b.bankCode}] {b.name}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Hesap Kodu</div>
            <input value={form.accountCode} onChange={(e) => setForm((p) => ({ ...p, accountCode: e.target.value }))} className="input-base h-9 text-sm" placeholder="102.01" />
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Hesap Adı</div>
            <input value={form.accountName} onChange={(e) => setForm((p) => ({ ...p, accountName: e.target.value }))} className="input-base h-9 text-sm" placeholder="Ziraat TL Hesabı" />
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Banka Hesap No</div>
            <input
              value={form.accountNo}
              onChange={(e) => setForm((p) => ({ ...p, accountNo: formatBankAccountNoInput(String(e.target.value ?? '')) }))}
              className="input-base h-9 text-sm"
              placeholder="TR00 0000 0000 0000 0000 0000 00"
            />
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Hesap Tipi</div>
            <select value={form.accountType} onChange={(e) => setForm((p) => ({ ...p, accountType: e.target.value }))} className="input-base h-9 text-sm">
              {accountTypeOptions.map((o) => (
                <option key={o.value} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Döviz Tipi</div>
            <select value={form.currencyTypeId} onChange={(e) => setForm((p) => ({ ...p, currencyTypeId: e.target.value }))} className="input-base h-9 text-sm">
              {currencyOptions.map((o) => (
                <option key={o.value} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            {/*
              "Bütçe" değil AÇILIŞ BAKİYESİ: bu değer hiçbir yerde bütçe/limit olarak
              kullanılmıyor, bakiye hesabının başlangıç tutarı olarak toplanıyor
              (BankAccountTransactionsController.Balance → Budget + (giren - çıkan)).
              DB kolonu tarihsel nedenle hâlâ "Budget".
            */}
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Açılış Bakiyesi</div>
            <input
              value={form.budget}
              onChange={(e) => setForm((p) => ({ ...p, budget: handleCurrencyInputChange(e.target.value, { allowNegative: true }) }))}
              className="input-base h-9 text-sm text-right"
              placeholder="0,00"
            />
            <p className="text-[11px] text-gray-500">
              Eksi bakiye için <b>-</b> yazın (kredi kartı borcu gibi). İşareti kaldırmak için alanı temizleyin.
            </p>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Hesap Kesim Tarihi</div>
            <input
              type="date"
              value={form.statementDate}
              onChange={(e) => setForm((p) => ({ ...p, statementDate: e.target.value }))}
              className="input-base h-9 text-sm"
            />
            <p className="text-[11px] text-gray-500">Kredi kartı hesapları için. Boş bırakılabilir.</p>
          </div>
        </div>
      </Modal>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Banka Hesap Tanımları</h1>
          <p className="text-xs text-gray-400 mt-0.5">Banka / Hesap Yönetimi</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Genel ara..."
              className="h-[34px] w-full sm:w-56 pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            />
          </div>
          <button type="button" onClick={openCreateBank} className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Yeni Banka Tanım
          </button>
          <button type="button" onClick={openCreate} className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Yeni Hesap Girişi
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}

      <Table
          onRefresh={() => void loadRows()} columns={columns} data={rows} showColumnFilters globalSearch={globalSearch} />

      {loading && <div className="mt-2 text-xs text-gray-500">Yükleniyor...</div>}
    </div>
  )
}
