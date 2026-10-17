import React, { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import Table, { type TableColumn } from '../components/Table'
import Modal from '../components/Modal'
import FormSelect from '../components/forms/FormSelect'
import FormSearchableSelect from '../components/forms/FormSearchableSelect'
import FormInput from '../components/forms/FormInput'
import { fetchCustomersDropdown, type CustomerDto } from '../api/customers'
import { fetchSuppliers, type SupplierDto } from '../api/suppliers'
import { fetchBankAccountDefinitions, type BankAccountDefinitionDto } from '../api/bankAccountDefinitions'
import { fetchBankDetailsDropdown, type BankDetailDropdownDto } from '../api/bankDetails'
import {
  createCustomerCheck,
  createCustomerChecksBulk,
  endorseCustomerCheckToBankGuarantee,
  endorseCustomerChecksToBankGuaranteeBulk,
  endorseCustomerCheckToBankCollection,
  collectCustomerCheck,
  uncollectCustomerCheck,
  endorseCustomerCheckToCustomer,
  returnCustomerCheck,
  returnCustomerCheckToPortfolio,
  dishonorCustomerCheck,
  deleteCustomerCheck,
  updateCustomerCheck,
  fetchCustomerChecks,
  type CustomerCheckDto
} from '../api/customerChecks'
import {
  createPayableCheck,
  createPayableChecksBulk,
  endorsePayableCheckToBank,
  payPayableCheck,
  cancelPayableCheck,
  revertPayableCheckToPending,
  returnPayableCheck,
  dishonorPayableCheck,
  deletePayableCheck,
  updatePayableCheck,
  fetchPayableChecks,
  unpayPayableCheck,
  type PayableCheckDto
} from '../api/payableChecks'
import {
  createPayableNote,
  createPayableNotesBulk,
  endorsePayableNoteToBank,
  payPayableNote,
  cancelPayableNote,
  revertPayableNoteToPending,
  returnPayableNote,
  dishonorPayableNote,
  deletePayableNote,
  updatePayableNote,
  fetchPayableNotes,
  unpayPayableNote,
  type PayableNoteDto
} from '../api/payableNotes'
import {
  checkStatusLabel,
  fmtDateTr,
  formatMoneyTRY,
  formatMoneyByCurrencyTypeId,
  payableStatusLabel,
  todayYmd,
  toIsoFromYmd,
  ymdFromIso
} from '../api/checksShared'
import { fetchLatestFxRate } from '../api/fx'
import { fetchCheckBranchesDropdown } from '../api/checkBranches'

/**
 * Bir çek verildi bordrosuna girebilecek en fazla çek adedi (basılı bordronun kapasitesi).
 * Sunucudaki karşılığı `CustomerChecksController.MaxChecksPerVBordro` — İKİSİ DE AYNI KALMALI.
 */
const MAX_CHECKS_PER_VBORDRO = 25

const defaultDistrictOptions = [
  { label: 'Seçiniz', value: '' },
  { label: 'Lefkoşa', value: 'Lefkoşa' },
  { label: 'Gazimağusa', value: 'Gazimağusa' },
  { label: 'Girne', value: 'Girne' },
  { label: 'Güzelyurt', value: 'Güzelyurt' },
  { label: 'İskele', value: 'İskele' },
  { label: 'Lefke', value: 'Lefke' }
]

const formatMoney = (n: number) => {
  try {
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0))
  } catch {
    return String(n ?? 0)
  }
}

const parseFormattedAmount = (val: any): number => {
  if (val === null || val === undefined) return 0
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0

  let str = String(val).trim()
  if (!str) return 0

  str = str.replace(/[^\d.,-]/g, '')
  if (!str) return 0

  const hasDot = str.includes('.')
  const hasComma = str.includes(',')

  if (hasDot && hasComma) {
    const lastDot = str.lastIndexOf('.')
    const lastComma = str.lastIndexOf(',')
    if (lastComma > lastDot) {
      str = str.replace(/\./g, '').replace(',', '.')
    } else {
      str = str.replace(/,/g, '')
    }
  } else if (hasComma) {
    const parts = str.split(',')
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      str = str.replace(',', '')
    } else {
      str = str.replace(',', '.')
    }
  } else if (hasDot) {
    const parts = str.split('.')
    if (parts.length > 2) {
      str = str.replace(/\./g, '')
    } else if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      str = str.replace('.', '')
    }
  }

  const num = parseFloat(str)
  return Number.isFinite(num) ? num : 0
}

const handleCurrencyInputChange = (val: string): string => {
  if (!val || val.trim() === '') return '0,00'
  const rawDigits = val.replace(/[^\d]/g, '')
  if (!rawDigits) return '0,00'
  const cents = parseInt(rawDigits, 10)
  const num = cents / 100
  return formatMoney(num)
}

type LayoutContext = {
  activeMenuId: string
  activeTabId?: string
  setActiveTabId?: (id?: string) => void
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

export default function CheckPage() {
  const { activeTabId, isSuperAdmin, allowedKeys } = useOutletContext<LayoutContext>()

  type CustomerCheckRow = CustomerCheckDto & { actions: string; __selected: boolean; statusLabel: string; paymentStatusLabel: string }
  type PayableCheckRow = PayableCheckDto & { actions: string; __selected?: boolean }
  type PayableNoteRow = PayableNoteDto & { actions: string; __selected?: boolean }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [globalSearch, setGlobalSearch] = useState('')

  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([])
  const [banks, setBanks] = useState<BankAccountDefinitionDto[]>([])
  const [bankDetailsList, setBankDetailsList] = useState<BankDetailDropdownDto[]>([])
  const [kktcDistrictOptions, setKktcDistrictOptions] = useState(defaultDistrictOptions)

  useEffect(() => {
    const ac = new AbortController()
    fetchCheckBranchesDropdown({ signal: ac.signal })
      .then((list) => {
        if (list && list.length > 0) {
          setKktcDistrictOptions([
            { label: 'Seçiniz', value: '' },
            ...list.map((b) => ({ label: b.name, value: b.name }))
          ])
        }
      })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  const combinedCariOptions = useMemo(() => {
    const list: Array<{ label: string; value: string }> = []
    customers.forEach((c) => {
      list.push({
        label: `[Müşteri] [${c.customerCode}] ${c.name}`,
        value: c.customerCode
      })
    })
    suppliers.forEach((s) => {
      list.push({
        label: `[Tedarikçi] [${s.supplierCode}] ${s.fullName}`,
        value: s.supplierCode
      })
    })
    return list
  }, [customers, suppliers])

  const [customerChecks, setCustomerChecks] = useState<CustomerCheckDto[]>([])
  const [payableChecks, setPayableChecks] = useState<PayableCheckDto[]>([])
  const [payableNotes, setPayableNotes] = useState<PayableNoteDto[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createSaving, setCreateSaving] = useState(false)

  // Edit modal state
  const [editTarget, setEditTarget] = useState<{ id: number; type: 'customerCheck' | 'debtCheck' | 'debtNote' } | null>(null)
  const [editForm, setEditForm] = useState<any | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Delete confirmation modal state
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    id: number
    type: 'check' | 'note'
    label: string
    checkNo?: string
  } | null>(null)
  const [deleteConfirmLoading, setDeleteConfirmLoading] = useState(false)

  const [actionOpen, setActionOpen] = useState(false)
  /**
   * Bir çek verildi bordrosuna en fazla 25 çek sığar. Sınır aşılınca işlem
   * açılmaz; kullanıcı kaç çek seçtiğini gösteren bir uyarı görür.
   * Sunucu tarafında da aynı sınır var (`MaxChecksPerVBordro`).
   */
  const [vBordroLimitCount, setVBordroLimitCount] = useState<number | null>(null)
  const [actionSaving, setActionSaving] = useState(false)
  const [actionKind, setActionKind] = useState<
    | 'cc_endorse_bank_guarantee'
    | 'cc_endorse_bank_collection'
    | 'cc_collect'
    | 'cc_uncollect'
    | 'cc_endorse_customer'
    | 'cc_return_portfolio'
    | 'cc_return'
    | 'cc_dishonor'
    | 'pc_endorse_bank'
    | 'pc_pay'
    | 'pc_return'
    | 'pc_unpay'
    | 'pc_dishonor'
    | 'pc_cancel'
    | 'pc_revert'
    | 'pn_endorse_bank'
    | 'pn_pay'
    | 'pn_return'
    | 'pn_unpay'
    | 'pn_dishonor'
    | 'pn_cancel'
    | 'pn_revert'
  >('cc_endorse_bank_guarantee')
  const [actionTargetIds, setActionTargetIds] = useState<number[]>([])

  const [actionDate, setActionDate] = useState(todayYmd())
  const [actionBankId, setActionBankId] = useState('')
  const [actionTargetCustomerCode, setActionTargetCustomerCode] = useState('')
  const [actionDescription, setActionDescription] = useState('')

  const actionBankOptions = useMemo(() => {
    const selectableBanks = actionKind === 'cc_endorse_bank_guarantee'
      ? banks.filter((b) => Number(b.accountType) === 3)
      : banks

    return [
      { label: 'Seçiniz', value: '' },
      ...selectableBanks.map((b) => ({ label: `[${b.accountCode}] ${b.bankName} - ${b.accountName}`, value: String(b.id) }))
    ]
  }, [actionKind, banks])

  const [selectedCustomerCheckIds, setSelectedCustomerCheckIds] = useState<number[]>([])
  const [selectedPayableCheckIds, setSelectedPayableCheckIds] = useState<number[]>([])
  const [selectedPayableNoteIds, setSelectedPayableNoteIds] = useState<number[]>([])

  const [prevTabId, setPrevTabId] = useState(activeTabId)
  if (activeTabId !== prevTabId) {
    setPrevTabId(activeTabId)
    setSelectedCustomerCheckIds([])
    setSelectedPayableCheckIds([])
    setSelectedPayableNoteIds([])
    setError(null)
  }

  const combinedCaris = useMemo(() => {
    const custOptions = (customers ?? []).map((c) => ({
      label: `[Müşteri] [${c.customerCode}] ${c.name}`,
      value: c.customerCode
    }))
    const supOptions = (suppliers ?? []).map((s) => ({
      label: `[Tedarikçi] [${s.supplierCode}] ${s.fullName}`,
      value: s.supplierCode
    }))
    return [...custOptions, ...supOptions].sort((a, b) => a.label.localeCompare(b.label, 'tr'))
  }, [customers, suppliers])

  const title = useMemo(() => {
    if (activeTabId === 'debtCheck') return 'Borç Çeki'
    if (activeTabId === 'debtNote') return 'Borç Seneti'
    return 'Müşteri Çeki'
  }, [activeTabId])

  const getPrefillBank = (targetIds: number[], tabName: string = activeTabId ?? '') => {
    const idSet = new Set(targetIds.map((x) => Number(x)))
    let selectedRows: any[] = []
    if (tabName === 'debtCheck') {
      selectedRows = (payableChecks ?? []).filter((r: any) => idSet.has(Number(r?.id ?? 0)))
    } else if (tabName === 'debtNote') {
      selectedRows = (payableNotes ?? []).filter((r: any) => idSet.has(Number(r?.id ?? 0)))
    } else {
      selectedRows = (customerChecks ?? []).filter((r: any) => idSet.has(Number(r?.id ?? 0)))
    }

    const bankIds = selectedRows
      .map((r: any) => Number(r?.bankAccountDefinitionId ?? r?.currentBankAccountDefinitionId ?? 0))
      .filter((x) => x > 0)

    if (bankIds.length === 0) return ''
    const firstBankId = bankIds[0]
    const allSame = bankIds.every((id) => id === firstBankId)
    if (allSame) {
      const bankAccount = banks.find((b) => b.id === firstBankId)
      return bankAccount ? String(bankAccount.id) : String(firstBankId)
    }
    return ''
  }

  const openAction = (kind: typeof actionKind, targetId: number, row?: { currentBankAccountDefinitionId?: number | null; bankAccountDefinitionId?: number | null }) => {
    setActionKind(kind)
    setActionTargetIds([targetId])
    setActionDate(todayYmd())
    
    // Auto-fill selected bank (BankAccountDefinitionId) from the check's current bank account
    const bankAccountId = row?.bankAccountDefinitionId || row?.currentBankAccountDefinitionId
    const bankAccount = bankAccountId ? banks.find(b => b.id === bankAccountId) : null
    const prefillBank = bankAccount ? String(bankAccount.id) : (bankAccountId ? String(bankAccountId) : getPrefillBank([targetId]))
    const canPrefillBank = kind !== 'cc_endorse_bank_guarantee'
      || banks.some((b) => String(b.id) === prefillBank && Number(b.accountType) === 3)
    setActionBankId(canPrefillBank ? prefillBank : '')
    setActionTargetCustomerCode('')
    setActionDescription('')
    setActionOpen(true)
  }

  const openBulkActionForSelectedPayableChecks = (kind: typeof actionKind) => {
    const ids = selectedPayableCheckIds
    if (ids.length === 0) {
      setError('Lütfen işlem yapılacak çekleri seçin')
      return
    }
    setActionKind(kind)
    setActionTargetIds([...ids])
    setActionDate(todayYmd())
    setActionBankId(getPrefillBank(ids, 'debtCheck'))
    setActionTargetCustomerCode('')
    setActionDescription('')
    setActionOpen(true)
  }

  const openBulkActionForSelectedPayableNotes = (kind: typeof actionKind) => {
    const ids = selectedPayableNoteIds
    if (ids.length === 0) {
      setError('Lütfen işlem yapılacak senetleri seçin')
      return
    }
    setActionKind(kind)
    setActionTargetIds([...ids])
    setActionDate(todayYmd())
    setActionBankId(getPrefillBank(ids, 'debtNote'))
    setActionTargetCustomerCode('')
    setActionDescription('')
    setActionOpen(true)
  }

  const deletePayableCheckRow = (id: number, checkNo?: string, label?: string) => {
    setDeleteConfirmTarget({ id, type: 'check', label: label ?? 'Borç Çeki', checkNo })
  }

  const deletePayableNoteRow = (id: number, noteNo?: string, label?: string) => {
    setDeleteConfirmTarget({ id, type: 'note', label: label ?? 'Borç Senedi', checkNo: noteNo })
  }

  const confirmDelete = async () => {
    if (!deleteConfirmTarget) return
    setDeleteConfirmLoading(true)
    try {
      setError(null)
      if (deleteConfirmTarget.type === 'check') {
        await deletePayableCheck(deleteConfirmTarget.id)
      } else {
        await deletePayableNote(deleteConfirmTarget.id)
      }
      setDeleteConfirmTarget(null)
      await loadRows()
    } catch (e: any) {
      setError(String(e?.message ?? 'Silme başarısız'))
      setDeleteConfirmTarget(null)
    } finally {
      setDeleteConfirmLoading(false)
    }
  }

  const unpayPayableCheckRow = async (id: number) => {
    if (!window.confirm('Bu borç çekinin ödendi işlemini iptal etmek ve beklemeye almak istediğinize emin misiniz?')) return
    try {
      setError(null)
      await unpayPayableCheck(id)
      await loadRows()
    } catch (e: any) {
      setError(String(e?.message ?? 'İşlem başarısız'))
    }
  }

  const unpayPayableNoteRow = async (id: number) => {
    if (!window.confirm('Bu borç senedinin ödendi işlemini iptal etmek ve beklemeye almak istediğinize emin misiniz?')) return
    try {
      setError(null)
      await unpayPayableNote(id)
      await loadRows()
    } catch (e: any) {
      setError(String(e?.message ?? 'İşlem başarısız'))
    }
  }

  const deleteSelectedCustomerCheck = async (id: number) => {
    try {
      setError(null)
      await deleteCustomerCheck(id)
      setSelectedCustomerCheckIds((prev) => prev.filter((x) => x !== id))
      await loadRows()
    } catch (e: any) {
      setError(String(e?.message ?? 'Silme başarısız'))
    }
  }

  const openBulkActionForSelectedCustomerChecks = (kind: typeof actionKind) => {
    const ids = selectedCustomerCheckIds
    if (!ids.length) {
      setError('Lütfen bir kayıt seçiniz')
      return
    }

    if (kind === 'pc_pay') {
      const rows = (payableChecks ?? []).filter((r) => ids.includes(r.id))
      const invalid = rows.filter((r) => r.status !== 1)
      if (invalid.length > 0) {
        setError('Sadece beklemedeki borç çekleri için ödeme yapılabilir.')
        return
      }
      setActionKind(kind)
      setActionTargetIds(ids)
      setActionDate(todayYmd())
      setActionBankId(getPrefillBank(ids, 'debtCheck'))
      setActionDescription('')
      setActionOpen(true)
      return
    }

    if (kind === 'pn_pay') {
      const rows = (payableNotes ?? []).filter((r) => ids.includes(r.id))
      const invalid = rows.filter((r) => r.status !== 1)
      if (invalid.length > 0) {
        setError('Sadece beklemedeki borç senetleri için ödeme yapılabilir.')
        return
      }
      setActionKind(kind)
      setActionTargetIds(ids)
      setActionDate(todayYmd())
      setActionBankId(getPrefillBank(ids, 'debtNote'))
      setActionDescription('')
      setActionOpen(true)
      return
    }

    if (kind === 'pc_cancel') {
      const rows = (payableChecks ?? []).filter((r) => ids.includes(r.id))
      const invalid = rows.filter((r) => r.status !== 1)
      if (invalid.length > 0) {
        setError('Ödenmiş veya diğer durumdaki borç çekleri doğrudan iptal edilemez. Önce beklemeye almalısınız.')
        return
      }
      setActionKind(kind)
      setActionTargetIds(ids)
      setActionDate(todayYmd())
      setActionDescription('')
      setActionOpen(true)
      return
    }

    if (kind === 'pn_cancel') {
      const rows = (payableNotes ?? []).filter((r) => ids.includes(r.id))
      const invalid = rows.filter((r) => r.status !== 1)
      if (invalid.length > 0) {
        setError('Ödenmiş veya diğer durumdaki borç senetleri doğrudan iptal edilemez. Önce beklemeye almalısınız.')
        return
      }
      setActionKind(kind)
      setActionTargetIds(ids)
      setActionDate(todayYmd())
      setActionDescription('')
      setActionOpen(true)
      return
    }

    if (kind === 'pc_revert') {
      const rows = (payableChecks ?? []).filter((r) => ids.includes(r.id))
      const invalid = rows.filter((r) => r.status !== 3 && r.status !== 6)
      if (invalid.length > 0) {
        setError('Sadece ödenmiş veya iptal edilmiş borç çekleri beklemeye alınabilir.')
        return
      }
      setActionKind(kind)
      setActionTargetIds(ids)
      setActionDate(todayYmd())
      setActionDescription('')
      setActionOpen(true)
      return
    }

    if (kind === 'pn_revert') {
      const rows = (payableNotes ?? []).filter((r) => ids.includes(r.id))
      const invalid = rows.filter((r) => r.status !== 3 && r.status !== 6)
      if (invalid.length > 0) {
        setError('Sadece ödenmiş veya iptal edilmiş borç senetleri beklemeye alınabilir.')
        return
      }
      setActionKind(kind)
      setActionTargetIds(ids)
      setActionDate(todayYmd())
      setActionDescription('')
      setActionOpen(true)
      return
    }


    if (kind === 'cc_uncollect') {
      const idSet = new Set((ids ?? []).map((x) => Number(x)).filter((x) => x > 0))
      const rows = (customerChecks ?? []).filter((r: any) => idSet.has(Number(r?.id ?? 0)))
      const validIds = rows.filter((r: any) => Number(r?.status ?? 0) === 5).map((r: any) => Number(r?.id ?? 0)).filter((x: number) => x > 0)
      const invalidCount = Math.max(0, rows.length - validIds.length)

      if (invalidCount > 0) {
        setSelectedCustomerCheckIds(validIds)
      }

      if (!validIds.length) {
        setError('Bu işlem sadece tahsil edilmiş (ödendi) durumdaki çekler için yapılabilir')
        return
      }

      setActionKind(kind)
      setActionTargetIds(validIds)
      setActionDate(todayYmd())
      // Teminat hesabı kontrolü buraya kopyalanmış ama bu dal yalnızca `cc_uncollect`
      // için çalışıyor; koşul her zaman doğruydu (ölü kod).
      setActionBankId(getPrefillBank(validIds))
      setActionTargetCustomerCode('')
      setActionDescription('')
      setActionOpen(true)
      if (invalidCount > 0) setError(`Tahsil edilmemiş ${invalidCount} adet çek seçimden çıkarıldı`)
      return
    }

    if (kind === 'cc_return_portfolio') {
      const idSet = new Set((ids ?? []).map((x) => Number(x)).filter((x) => x > 0))
      const rows = (customerChecks ?? []).filter((r: any) => idSet.has(Number(r?.id ?? 0)))
      const validIds = rows
        .filter((r: any) => {
          const status = Number(r?.status ?? 0)
          return status === 2 || status === 3 || status === 4
        })
        .map((r: any) => Number(r?.id ?? 0))
        .filter((x: number) => x > 0)
      const invalidCount = Math.max(0, rows.length - validIds.length)

      if (invalidCount > 0) {
        setSelectedCustomerCheckIds(validIds)
      }

      if (!validIds.length) {
        setError('Bu işlem sadece bankadaki veya ciro edilmiş çekler için yapılabilir')
        return
      }

      setActionKind(kind)
      setActionTargetIds(validIds)
      setActionDate(todayYmd())
      setActionBankId(getPrefillBank(validIds))
      setActionTargetCustomerCode('')
      setActionDescription('')
      setActionOpen(true)
      if (invalidCount > 0) setError(`İade edilemez durumdaki ${invalidCount} adet çek seçimden çıkarıldı`)
      return
    }

    if (
      kind === 'cc_endorse_bank_guarantee' ||
      kind === 'cc_endorse_bank_collection' ||
      kind === 'cc_endorse_customer' ||
      kind === 'cc_return' ||
      kind === 'cc_dishonor'
    ) {
      const idSet = new Set((ids ?? []).map((x) => Number(x)).filter((x) => x > 0))
      const rows = (customerChecks ?? []).filter((r: any) => idSet.has(Number(r?.id ?? 0)))
      const validIds = rows.filter((r: any) => Number(r?.status ?? 0) === 1).map((r: any) => Number(r?.id ?? 0)).filter((x: number) => x > 0)
      const invalidCount = Math.max(0, rows.length - validIds.length)

      if (invalidCount > 0) {
        setSelectedCustomerCheckIds(validIds)
      }

      if (!validIds.length) {
        setError('Bu işlem sadece portföydeki çekler için yapılabilir')
        return
      }

      // Teminata aktarım tek bir bordro üretir; bordronun kapasitesi 25 çektir.
      if (kind === 'cc_endorse_bank_guarantee' && validIds.length > MAX_CHECKS_PER_VBORDRO) {
        setVBordroLimitCount(validIds.length)
        return
      }

      setActionKind(kind)
      setActionTargetIds(validIds)
      setActionDate(todayYmd())
      setActionBankId(getPrefillBank(validIds))
      setActionTargetCustomerCode('')
      setActionDescription('')
      setActionOpen(true)
      if (invalidCount > 0) setError(`Portföyde olmayan ${invalidCount} adet çek seçimden çıkarıldı`)
      return
    }

    setActionKind(kind)
    setActionTargetIds(ids)
    setActionDate(todayYmd())
    setActionBankId(getPrefillBank(ids))
    setActionTargetCustomerCode('')
    setActionDescription('')
    setActionOpen(true)
  }

  const openBulkActionForPayable = (kind: 'pc_pay' | 'pc_return' | 'pc_unpay' | 'pn_pay' | 'pn_return' | 'pn_unpay') => {
    const targetIds = activeTabId === 'debtCheck' ? selectedPayableCheckIds : activeTabId === 'debtNote' ? selectedPayableNoteIds : selectedCustomerCheckIds
    if (!targetIds.length) {
      setError('Lütfen işlem yapılacak kayıtları seçin')
      return
    }

    let invalidCount = 0
    const validIds: number[] = []

    targetIds.forEach((id) => {
      const numericId = Number(id)
      if (activeTabId === 'debtCheck') {
        const row = payableChecks.find((x) => x.id === numericId)
        if (row) {
          const status = Number(row.status ?? 0)
          if (kind === 'pc_pay' || kind === 'pc_return') {
            if (status === 1) validIds.push(numericId)
            else invalidCount++
          } else if (kind === 'pc_unpay') {
            if (status === 3) validIds.push(numericId)
            else invalidCount++
          }
        }
      } else if (activeTabId === 'debtNote') {
        const row = payableNotes.find((x) => x.id === numericId)
        if (row) {
          const status = Number(row.status ?? 0)
          if (kind === 'pn_pay' || kind === 'pn_return') {
            if (status === 1) validIds.push(numericId)
            else invalidCount++
          } else if (kind === 'pn_unpay') {
            if (status === 3) validIds.push(numericId)
            else invalidCount++
          }
        }
      }
    })

    if (!validIds.length) {
      setError('Seçilen kayıtlar bu işlem için uygun durumda değil')
      return
    }

    setActionKind(kind)
    setActionTargetIds(validIds)
    setActionDate(todayYmd())
    setActionBankId(getPrefillBank(validIds, activeTabId))
    setActionTargetCustomerCode('')
    setActionDescription('')
    setActionOpen(true)

    if (invalidCount > 0) {
      setError(`İşleme uygun olmayan ${invalidCount} adet kayıt seçimden çıkarıldı`)
    }
  }

  const canUseBank = useMemo(() => {
    return (
      actionKind === 'cc_endorse_bank_guarantee' ||
      actionKind === 'cc_endorse_bank_collection' ||
      actionKind === 'cc_collect' ||
      actionKind === 'pc_endorse_bank' ||
      actionKind === 'pc_pay' ||
      actionKind === 'pn_endorse_bank' ||
      actionKind === 'pn_pay'
    )
  }, [actionKind])

  const canUseTargetCustomer = useMemo(() => {
    return actionKind === 'cc_endorse_customer'
  }, [actionKind])

  /**
   * YAZMA TARAFI DA DÜZELTİLDİ.
   *
   * Geçen turda yalnızca LİSTE düzeltilmişti; bu form hâlâ eski kodlamayı gönderiyordu
   * (0=TL 1=USD 2=EUR 3=GBP). Sistemin kodlaması 1=TRY 2=EUR 3=USD 4=GBP olduğu için:
   * dolar çeki `1` ile gidiyor ve veritabanına TL olarak yazılıyor, sterlin çeki `3` ile
   * gidip DOLAR oluyor — üstelik sterlin kuruyla. Liste düzeltmesi bu yanlış veriyi
   * tutarlı GÖSTERDİĞİ için hata gözle görülmüyordu.
   */
  /** Seçicide 0 (eski TL varsayılanı) 1'e düşer, yoksa liste boş görünürdü. */
  const normalizeCurrencySelectValue = (v: unknown) => {
    const s = String(v ?? '').trim()
    return s === '' || s === '0' ? '1' : s
  }

  const currencyOptions = useMemo(
    () => [
      { label: 'TL', value: '1' },
      { label: 'EUR', value: '2' },
      { label: 'USD', value: '3' },
      { label: 'GBP (Sterlin)', value: '4' }
    ],
    []
  )

  const [createForms, setCreateForms] = useState<any[]>([])

  const getEmptyCreateForm = () => {
    if (activeTabId === 'debtCheck') {
      return {
        customerCode: '',
        issueDate: todayYmd(),
        dueDate: '',
        checkNo: '',
        currencyTypeId: '1',
        currencyRate: '1',
        amount: '',
        bankAccountId: ''
      }
    }
    if (activeTabId === 'debtNote') {
      return {
        documentNo: '',
        customerCode: '',
        issueDate: todayYmd(),
        dueDate: '',
        amount: '',
        currencyTypeId: '1',
        currencyRate: '1',
        noteNo: '',
        bankAccountId: ''
      }
    }

    return {
      documentNo: '',
      customerCode: '',
      issueDate: todayYmd(),
      dueDate: '',
      endorsementType: '1',
      bankDetailId: '',
      amount: '',
      currencyTypeId: '1',
      currencyRate: '1',
      branchName: '',
      districtName: '',
      checkNo: '',
      originalDebtorName: '',
      originalIdentityNo: '',
      originalTaxNo: ''
    }
  }

  const resetCreateForms = () => {
    setCreateForms([getEmptyCreateForm()])
  }

  const loadLookups = async () => {
    try {
      const [custs, sups, bankAccs, bankDets] = await Promise.all([
        fetchCustomersDropdown({ includeInactive: false }),
        // BAYİNİN TEDARİKÇİ HESABI "VEREN ADI"NDA ÇIKMASIN (2026-08-21 kullanıcı kuralı).
        //
        // `Suppliers` tablosunda kodu "120-" ile başlayan satırlar da var: bunlar gerçek
        // tedarikçi değil, bayi/müşteri carilerinin tedarikçi tarafındaki karşılığı.
        // `includeCustomers: true` onları da getirdiği için aynı cari listede İKİ KEZ
        // çıkıyordu — "[Müşteri] [120-01-000719] AŞKAROĞLU" ve "[Tedarikçi] [120-01-000719]
        // AŞKAROĞLU" — ve hangisinin seçildiği çekin hangi hesaba yazıldığını değiştiriyor.
        // Bayrak kalkınca uç kodu "120-" ile başlayanları süzüyor; bayi zaten [Müşteri]
        // seçeneği olarak listede duruyor, yani hiçbir cari kaybolmuyor.
        fetchSuppliers(),
        fetchBankAccountDefinitions(),
        fetchBankDetailsDropdown({ includeInactive: false })
      ])
      setCustomers(custs ?? [])
      setSuppliers(sups ?? [])
      setBanks(bankAccs ?? [])
      setBankDetailsList(bankDets ?? [])
    } catch {
      setCustomers([])
      setSuppliers([])
      setBanks([])
      setBankDetailsList([])
    }
  }

  const loadRows = async () => {
    try {
      setLoading(true)
      setError(null)

      if (activeTabId === 'debtCheck') {
        const data = await fetchPayableChecks({ take: 1000 })
        setPayableChecks((data ?? []).map((x) => ({ ...x })))
        return
      }
      if (activeTabId === 'debtNote') {
        const data = await fetchPayableNotes({ take: 1000 })
        setPayableNotes((data ?? []).map((x) => ({ ...x })))
        return
      }

      const data = await fetchCustomerChecks({ take: 1000 })
      setCustomerChecks((data ?? []).map((x) => ({ ...x })))
    } catch (e: any) {
      setError(String(e?.message ?? 'Bir hata oluştu'))
      setCustomerChecks([])
      setPayableChecks([])
      setPayableNotes([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadLookups()
  }, [])

  useEffect(() => {
    resetCreateForms()
    setSelectedCustomerCheckIds([])
    void loadRows()
  }, [activeTabId])

  const addCreateRow = () => {
    setCreateForms((prev) => {
      const rows = [...(prev ?? [])]
      if (!rows.length) return [getEmptyCreateForm()]
      const last = rows[rows.length - 1] ?? getEmptyCreateForm()
      return [...rows, { ...(last ?? {}) }]
    })
  }

  const updateCreateRow = (index: number, patch: any) => {
    setCreateForms((prev) => {
      const next = [...(prev ?? [])]
      next[index] = { ...(next[index] ?? {}), ...(patch ?? {}) }
      return next
    })
  }

  const removeCreateRow = (index: number) => {
    setCreateForms((prev) => {
      const next = [...(prev ?? [])]
      next.splice(index, 1)
      return next.length ? next : [getEmptyCreateForm()]
    })
  }

  const handleCurrencyTypeChange = async (idx: number, currencyVal: string) => {
    updateCreateRow(idx, { currencyTypeId: currencyVal })

    // 0 da TL'dir (eski varsayılan); bir kaydı düzenlerken gelebilir.
    if (currencyVal === '0' || currencyVal === '1') {
      updateCreateRow(idx, { currencyRate: '1' })
      return
    }

    let code = ''
    if (currencyVal === '2') code = 'EUR'
    else if (currencyVal === '3') code = 'USD'
    else if (currencyVal === '4') code = 'GBP'

    if (code) {
      try {
        setError(null)
        const rate = await fetchLatestFxRate(code)
        updateCreateRow(idx, { currencyRate: rate > 0 ? String(rate) : '1' })
      } catch (e: any) {
        setError(`Döviz kuru alınamadı (${code}): ` + String(e?.message ?? ''))
        updateCreateRow(idx, { currencyRate: '1' })
      }
    }
  }

  const handleEditCurrencyTypeChange = async (currencyVal: string) => {
    if (!editForm) return
    setEditForm((prev: any) => ({ ...prev, currencyTypeId: currencyVal }))

    if (currencyVal === '0' || currencyVal === '1') {
      setEditForm((prev: any) => ({ ...prev, currencyRate: '1' }))
      return
    }

    let code = ''
    if (currencyVal === '2') code = 'EUR'
    else if (currencyVal === '3') code = 'USD'
    else if (currencyVal === '4') code = 'GBP'

    if (code) {
      try {
        setError(null)
        const rate = await fetchLatestFxRate(code)
        setEditForm((prev: any) => ({ ...prev, currencyRate: rate > 0 ? String(rate) : '1' }))
      } catch (e: any) {
        setError(`Döviz kuru alınamadı (${code}): ` + String(e?.message ?? ''))
      }
    }
  }

  const openEditCustomerCheck = (row: CustomerCheckRow) => {
    const bankDetail = bankDetailsList.find((b) => b.name === row.bankName)
    setEditTarget({ id: row.id, type: 'customerCheck' })
    setEditForm({
      customerCode: row.customerCode || '',
      issueDate: row.issueDate ? ymdFromIso(row.issueDate) : todayYmd(),
      dueDate: row.dueDate ? ymdFromIso(row.dueDate) : '',
      endorsementType: String(row.endorsementType || '1'),
      bankDetailId: bankDetail ? String(bankDetail.id) : '',
      bankName: row.bankName || '',
      branchName: row.branchName || '',
      districtName: row.districtName || '',
      amount: formatMoney(row.amount || 0),
      currencyTypeId: String(row.currencyTypeId || '1'),
      currencyRate: String((row as any).currencyRate || (row.currencyTypeId === 1 || !row.currencyTypeId ? '1' : '')),
      checkNo: row.checkNo || '',
      originalDebtorName: row.originalDebtorName || '',
      originalIdentityNo: row.originalIdentityNo || '',
      originalTaxNo: row.originalTaxNo || ''
    })
  }

  const openEditPayableCheck = (row: PayableCheckRow) => {
    setEditTarget({ id: row.id, type: 'debtCheck' })
    setEditForm({
      customerCode: row.customerCode || '',
      issueDate: row.issueDate ? ymdFromIso(row.issueDate) : todayYmd(),
      dueDate: row.dueDate ? ymdFromIso(row.dueDate) : '',
      checkNo: row.checkNo || '',
      currencyTypeId: String(row.currencyTypeId || '1'),
      currencyRate: String(row.currencyRate || '1'),
      amount: formatMoney(row.amount || 0),
      bankAccountId: row.bankAccountDefinitionId ? String(row.bankAccountDefinitionId) : ''
    })
  }

  const openEditPayableNote = (row: PayableNoteRow) => {
    setEditTarget({ id: row.id, type: 'debtNote' })
    setEditForm({
      documentNo: row.documentNo || '',
      customerCode: row.customerCode || '',
      issueDate: row.issueDate ? ymdFromIso(row.issueDate) : todayYmd(),
      dueDate: row.dueDate ? ymdFromIso(row.dueDate) : '',
      amount: formatMoney(row.amount || 0),
      currencyTypeId: String(row.currencyTypeId || '1'),
      noteNo: row.noteNo || '',
      bankAccountId: row.bankAccountDefinitionId ? String(row.bankAccountDefinitionId) : ''
    })
  }

  const submitEdit = async () => {
    if (!editTarget || !editForm) return
    try {
      setEditSaving(true)
      setError(null)
      if (editTarget.type === 'customerCheck') {
        const issueDate = String(editForm.issueDate ?? '').trim()
        const dueDate = String(editForm.dueDate ?? '').trim()
        const amount = parseFormattedAmount(editForm.amount)
        const currencyTypeId = Number(editForm.currencyTypeId ?? 1)
        const customerCode = String(editForm.customerCode ?? '').trim()
        const endorsementType = Number(editForm.endorsementType ?? 1)
        const bankDetailId = editForm.bankDetailId ? Number(editForm.bankDetailId) : 0

        if (!issueDate) throw new Error('Tarih zorunlu')
        if (!dueDate) throw new Error('Vade tarihi zorunlu')
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Tutar geçersiz')
        if (!customerCode) throw new Error('Cari seçmelisiniz')
        if (endorsementType !== 1 && endorsementType !== 2) throw new Error('Asıl/Ciro seçimi geçersiz')
        if (!bankDetailId || bankDetailId <= 0) throw new Error('Banka seçmelisiniz')

        if (endorsementType === 2) {
          const od = String(editForm.originalDebtorName ?? '').trim()
          if (!od) throw new Error('Ciro seçildiğinde Asıl Borçlu zorunlu')
        }

        const selectedBankDetail = bankDetailId > 0 ? bankDetailsList.find((b) => b.id === bankDetailId) : null
        await updateCustomerCheck(editTarget.id, {
          customerCode,
          issueDate: toIsoFromYmd(issueDate),
          dueDate: toIsoFromYmd(dueDate),
          amount,
          currencyTypeId,
          currencyRate: parseFormattedAmount(editForm.currencyRate) || undefined,
          endorsementType: endorsementType as any,
          bankName: selectedBankDetail ? String(selectedBankDetail.name ?? '').trim() || null : null,
          branchName: String(editForm.branchName ?? '').trim() || null,
          districtName: String(editForm.districtName ?? '').trim() || null,
          checkNo: String(editForm.checkNo ?? '').trim() || null,
          originalDebtorName: endorsementType === 2 ? (String(editForm.originalDebtorName ?? '').trim() || null) : null,
          originalIdentityNo: endorsementType === 2 ? (String(editForm.originalIdentityNo ?? '').trim() || null) : null,
          originalTaxNo: endorsementType === 2 ? (String(editForm.originalTaxNo ?? '').trim() || null) : null
        })
      } else if (editTarget.type === 'debtCheck') {
        const issueDate = String(editForm.issueDate ?? '').trim()
        const dueDate = String(editForm.dueDate ?? '').trim()
        const amount = parseFormattedAmount(editForm.amount)
        const currencyTypeId = Number(editForm.currencyTypeId ?? 1)
        const customerCode = String(editForm.customerCode ?? '').trim()
        const currencyRate = parseFormattedAmount(editForm.currencyRate) || 1
        const selectedBankAccountId = editForm.bankAccountId ? Number(editForm.bankAccountId) : 0

        if (!issueDate) throw new Error('Tarih zorunlu')
        if (!dueDate) throw new Error('Vade tarihi zorunlu')
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Tutar geçersiz')
        if (!customerCode) throw new Error('Cari seçmelisiniz')
        if (!Number.isFinite(currencyRate) || currencyRate <= 0) throw new Error('Döviz kur geçersiz')
        if (!selectedBankAccountId || selectedBankAccountId <= 0) throw new Error('Banka seçmelisiniz')

        await updatePayableCheck(editTarget.id, {
          customerCode,
          issueDate: toIsoFromYmd(issueDate),
          dueDate: toIsoFromYmd(dueDate),
          amount,
          currencyTypeId,
          currencyRate,
          bankAccountDefinitionId: selectedBankAccountId,
          checkNo: String(editForm.checkNo ?? '').trim() || null
        })
      } else if (editTarget.type === 'debtNote') {
        const issueDate = String(editForm.issueDate ?? '').trim()
        const dueDate = String(editForm.dueDate ?? '').trim()
        const amount = parseFormattedAmount(editForm.amount)
        const customerCode = String(editForm.customerCode ?? '').trim()
        const selectedBankAccountId = editForm.bankAccountId ? Number(editForm.bankAccountId) : 0

        if (!issueDate) throw new Error('Tarih zorunlu')
        if (!dueDate) throw new Error('Vade tarihi zorunlu')
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Tutar geçersiz')
        if (!customerCode) throw new Error('Cari seçmelisiniz')
        if (!selectedBankAccountId || selectedBankAccountId <= 0) throw new Error('Banka seçmelisiniz')

        const currencyTypeId = Number(editForm.currencyTypeId ?? 1)

        await updatePayableNote(editTarget.id, {
          documentNo: editForm.documentNo || undefined,
          customerCode,
          issueDate: toIsoFromYmd(issueDate),
          dueDate: toIsoFromYmd(dueDate),
          amount,
          currencyTypeId,
          noteNo: String(editForm.noteNo ?? '').trim() || null,
          bankAccountDefinitionId: selectedBankAccountId
        })
      }

      setEditTarget(null)
      setEditForm(null)
      await loadRows()
    } catch (e: any) {
      setError(String(e?.message ?? 'Güncelleme başarısız'))
    } finally {
      setEditSaving(false)
    }
  }

  const filteredRows = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    const selectedCC = new Set(selectedCustomerCheckIds)
    const selectedPC = new Set(selectedPayableCheckIds)
    const selectedPN = new Set(selectedPayableNoteIds)

    if (activeTabId === 'debtCheck') {
      const list = (payableChecks ?? []).map((x) => ({
        ...(x as any),
        actions: '',
        __selected: selectedPC.has(Number((x as any).id ?? 0))
      })) as PayableCheckRow[]
      if (!q) return list
      return list.filter((x) =>
        String(x.documentNo ?? '').toLowerCase().includes(q) ||
        String(x.customerName ?? '').toLowerCase().includes(q) ||
        String(x.customerCode ?? '').toLowerCase().includes(q)
      )
    }

    if (activeTabId === 'debtNote') {
      const list = (payableNotes ?? []).map((x) => ({
        ...(x as any),
        actions: '',
        __selected: selectedPN.has(Number((x as any).id ?? 0))
      })) as PayableNoteRow[]
      if (!q) return list
      return list.filter((x) =>
        String(x.documentNo ?? '').toLowerCase().includes(q) ||
        String(x.customerName ?? '').toLowerCase().includes(q) ||
        String(x.customerCode ?? '').toLowerCase().includes(q)
      )
    }

    const list = (customerChecks ?? []).map((x) => {
      const statusNum = Number((x as any).status ?? 0)
      const payNum = Number((x as any).paymentStatus ?? 0)
      return {
        ...(x as any),
        actions: '',
        __selected: selectedCC.has(Number((x as any).id ?? 0)),
        statusLabel: customerCheckPlaceLabel(statusNum),
        paymentStatusLabel: customerCheckPaymentLabel(payNum)
      }
    }) as CustomerCheckRow[]
    if (!q) return list
    return list.filter((x) =>
      String(x.documentNo ?? '').toLowerCase().includes(q) ||
      String(x.customerName ?? '').toLowerCase().includes(q) ||
      String(x.customerCode ?? '').toLowerCase().includes(q)
    )
  }, [activeTabId, customerChecks, payableChecks, payableNotes, globalSearch, selectedCustomerCheckIds, selectedPayableCheckIds, selectedPayableNoteIds])

  function customerCheckPlaceLabel(status: number) {
    if (status === 1) return 'Portföy'
    if (status === 2) return 'Teminat'
    if (status === 3) return 'Bankada'
    if (status === 4) return 'Ciro'
    if (status === 5) return 'Tahsil'
    if (status === 6) return 'İade'
    if (status === 7) return 'Karşılıksız'
    return '-'
  }

  function customerCheckPaymentLabel(paymentStatus: number) {
    if (paymentStatus === 2) return 'Ödendi'
    return 'Beklemede'
  }

  const customerCheckColumns: TableColumn<CustomerCheckRow>[] = useMemo(
    () => [
      {
        key: '__selected',
        label: (
          <input
            type="checkbox"
            checked={filteredRows.length > 0 && filteredRows.every((r: any) => selectedCustomerCheckIds.includes(Number(r.id)))}
            onChange={(e) => {
              if (e.target.checked) {
                setSelectedCustomerCheckIds(filteredRows.map((r: any) => Number(r.id)).filter(Boolean))
              } else {
                setSelectedCustomerCheckIds([])
              }
            }}
            onClick={(e) => e.stopPropagation()}
            title="Tümünü Seç"
            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
          />
        ),
        render: (_v, row) => (
          <input
            type="checkbox"
            checked={Boolean(row.__selected)}
            onChange={(e) => {
              const checked = e.target.checked
              setSelectedCustomerCheckIds((prev) => {
                const id = Number(row.id)
                if (!id) return prev
                const set = new Set(prev)
                if (checked) set.add(id)
                else set.delete(id)
                return Array.from(set)
              })
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )
      },
      { key: 'aBordroNo', label: 'A.Bordro No', searchable: true },
      {
        key: 'vBordroNo',
        label: 'V.Bordro No',
        searchable: true,
        render: (v) => {
          const no = String(v ?? '').trim()
          if (!no) return ''
          return (
            <button
              type="button"
              className="text-blue-700 hover:text-blue-800 underline"
              onClick={(e) => {
                e.stopPropagation()
                void openVBordroPrint(no)
              }}
            >
              {no}
            </button>
          )
        }
      },
      { key: 'currentBankAccountName', label: 'Takas Bankası', searchable: true },
      { key: 'issueDate', label: 'Giriş Tarihi', searchable: true, filter: { type: 'date' }, render: (v) => fmtDateTr(String(v ?? '')) },
      { key: 'customerName', label: 'Veren Adı', searchable: true },
      { key: 'originalDebtorName', label: 'Asıl Borçlu', searchable: true },
      { key: 'dueDate', label: 'Vade Tarihi', searchable: true, filter: { type: 'date' }, render: (v) => fmtDateTr(String(v ?? '')) },
      {
        key: 'amount',
        label: 'Tutar',
        searchable: true,
        // Tutar çekin KENDİ para birimindedir; sütun her satırı ₺ ile basıyordu.
        render: (v: any, row: any) => formatMoneyByCurrencyTypeId(Number(v ?? 0), row?.currencyTypeId)
      },
      { key: 'checkNo', label: 'Çek No', searchable: true },
      { key: 'bankName', label: 'Banka', searchable: true },
      { key: 'branchName', label: 'Şube', searchable: true },
      {
        key: 'statusLabel',
        label: 'Yeri',
        filter: {
          type: 'checkbox',
          options: [
            { label: 'Portföy', value: 'Portföy' },
            { label: 'Teminat', value: 'Teminat' },
            { label: 'Bankada', value: 'Bankada' },
            { label: 'Ciro', value: 'Ciro' },
            { label: 'Tahsil', value: 'Tahsil' },
            { label: 'İade', value: 'İade' },
            { label: 'Karşılıksız', value: 'Karşılıksız' }
          ]
        },
        render: (_v, row) => {
          const n = Number((row as any).status ?? 0)
          const label = customerCheckPlaceLabel(n)
          const cls = n === 1 ? 'bg-amber-500 text-white' : n === 7 ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
          return <span className={`inline-flex items-center justify-center h-[26px] px-3 rounded-md text-[11px] font-semibold shadow-sm ${cls}`}>{label}</span>
        }
      },
      {
        key: 'paymentStatusLabel',
        label: 'Durum',
        searchable: true,
        render: (_v, row) => {
          const n = Number((row as any).paymentStatus ?? 0)
          const label = customerCheckPaymentLabel(n)
          const cls = n === 2 ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
          return <span className={`inline-flex items-center justify-center h-[26px] px-3 rounded-md text-[11px] font-semibold shadow-sm ${cls}`}>{label}</span>
        }
      },
      { key: 'createUser', label: 'İşlem Yapan', searchable: true },
      {
        key: 'actions',
        label: 'İşlemler',
        render: (_v, row) => {
          const canEditOrDelete = Number(row.status ?? 0) === 1
          return (
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                disabled={!canEditOrDelete}
                title={!canEditOrDelete ? 'Yalnızca portföydeki çekler düzenlenebilir' : 'Düzenle'}
                className={
                  'inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium border transition-colors ' +
                  (canEditOrDelete
                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200 cursor-pointer'
                    : 'bg-transparent text-slate-300 border-slate-200 cursor-not-allowed')
                }
                onClick={(e) => {
                  e.stopPropagation()
                  if (!canEditOrDelete) return
                  openEditCustomerCheck(row)
                }}
              >
                Düzenle
              </button>
              <button
                type="button"
                disabled={!canEditOrDelete}
                title={!canEditOrDelete ? 'Yalnızca portföydeki çekler silinebilir' : 'Sil'}
                className={
                  'inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium border transition-colors ' +
                  (canEditOrDelete
                    ? 'bg-red-50 text-red-700 hover:bg-red-100 border-red-200 cursor-pointer'
                    : 'bg-transparent text-slate-300 border-slate-200 cursor-not-allowed')
                }
                onClick={(e) => {
                  e.stopPropagation()
                  if (!canEditOrDelete) return
                  void deleteSelectedCustomerCheck(Number(row.id))
                }}
              >
                Sil
              </button>
            </div>
          )
        }
      }
    ],
    [filteredRows, selectedCustomerCheckIds, isSuperAdmin, allowedKeys, bankDetailsList]
  )

  const payableCheckColumns: TableColumn<PayableCheckRow>[] = useMemo(
    () => [
      {
        key: '__selected',
        label: (
          <input
            type="checkbox"
            checked={filteredRows.length > 0 && filteredRows.every((r: any) => selectedPayableCheckIds.includes(Number(r.id)))}
            onChange={(e) => {
              if (e.target.checked) {
                setSelectedPayableCheckIds(filteredRows.map((r: any) => Number(r.id)).filter(Boolean))
              } else {
                setSelectedPayableCheckIds([])
              }
            }}
            onClick={(e) => e.stopPropagation()}
            title="Tümünü Seç"
            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
          />
        ),
        render: (_v, row) => (
          <input
            type="checkbox"
            checked={selectedPayableCheckIds.includes(Number(row.id))}
            onChange={(e) => {
              const id = Number(row.id)
              setSelectedPayableCheckIds((prev) => (e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)))
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )
      },
      { key: 'documentNo', label: 'Bordro No', searchable: true },
      {
        key: 'customerName',
        label: 'Verilen Cari',
        searchable: true,
        render: (_v, row) => {
          const code = String((row as any).customerCode ?? '').trim()
          const name = String((row as any).customerName ?? '').trim()
          if (code && name) return `[${code}] ${name}`
          if (code) return code
          return name
        }
      },
      { key: 'issueDate', label: 'Çıkış Tarihi', searchable: true, filter: { type: 'date' }, render: (v) => fmtDateTr(String(v ?? '')) },
      { key: 'dueDate', label: 'Vade Tarihi', searchable: true, filter: { type: 'date' }, render: (v) => fmtDateTr(String(v ?? '')) },
      { key: 'checkNo', label: 'Çek Seri', searchable: true },
      { key: 'currencyTypeId', label: 'Döviz Tipi', searchable: true, render: (v) => { const t = Number(v ?? 0); return t === 2 ? 'EUR' : t === 3 ? 'USD' : t === 4 ? 'GBP' : 'TL' } },
      { key: 'currencyRate', label: 'Döviz Kur', searchable: true, render: (v) => String(v ?? '') },
      {
        key: 'amount',
        label: 'Tutar',
        searchable: true,
        render: (v, row) => {
          const type = Number((row as any).currencyTypeId ?? 0)
          const symbol = type === 3 ? '$' : type === 2 ? '€' : type === 4 ? '£' : '₺'
          const formatted = formatMoneyTRY(Number(v ?? 0)).replace('₺', '').trim()
          if (type === 2 || type === 3 || type === 4) {
            return `${symbol}${formatted}`
          }
          return `${formatted} ₺`
        }
      },
      { key: 'currencyAmount', label: 'TL Karşılığı', searchable: true, render: (v) => formatMoneyTRY(Number(v ?? 0)) },
      { key: 'bankAccountName', label: 'Banka', searchable: true },
      {
        key: 'status',
        label: 'Durum',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'İlk Kayıt', value: '1' },
            { label: 'Bankaya Ciro', value: '2' },
            { label: 'Ödendi', value: '3' },
            { label: 'İade', value: '4' },
            { label: 'Karşılıksız', value: '5' },
            { label: 'İptal', value: '6' }
          ]
        },
        render: (v) => payableStatusLabel(Number(v ?? 0))
      },
      { key: 'createUser', label: 'İşlem Yapan', searchable: true },
      {
        key: 'actions',
        label: 'İşlemler',
        render: (_v, row) => {
          const canEditOrDelete = Number(row.status ?? 0) === 1
          return (
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                disabled={!canEditOrDelete}
                title={!canEditOrDelete ? "Yalnızca 'İlk Kayıt' durumundaki borç çekleri düzenlenebilir" : 'Düzenle'}
                className={
                  'inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium border transition-colors ' +
                  (canEditOrDelete
                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200 cursor-pointer'
                    : 'bg-transparent text-slate-300 border-slate-200 cursor-not-allowed')
                }
                onClick={(e) => {
                  e.stopPropagation()
                  if (!canEditOrDelete) return
                  openEditPayableCheck(row)
                }}
              >
                Düzenle
              </button>
              <button
                type="button"
                disabled={!canEditOrDelete}
                title={!canEditOrDelete ? "Yalnızca 'İlk Kayıt' durumundaki borç çekleri silinebilir" : 'Sil'}
                className={
                  'inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium border transition-colors ' +
                  (canEditOrDelete
                    ? 'bg-red-50 text-red-700 hover:bg-red-100 border-red-200 cursor-pointer'
                    : 'bg-transparent text-slate-300 border-slate-200 cursor-not-allowed')
                }
                onClick={(e) => {
                  e.stopPropagation()
                  if (!canEditOrDelete) return
                  deletePayableCheckRow(Number(row.id), String(row.checkNo ?? ''), 'Borç Çeki')
                }}
              >
                Sil
              </button>
            </div>
          )
        }
      }
    ],
    [filteredRows, selectedPayableCheckIds]
  )

  const payableNoteColumns: TableColumn<PayableNoteRow>[] = useMemo(
    () => [
      {
        key: '__selected',
        label: (
          <input
            type="checkbox"
            checked={filteredRows.length > 0 && filteredRows.every((r: any) => selectedPayableNoteIds.includes(Number(r.id)))}
            onChange={(e) => {
              if (e.target.checked) {
                setSelectedPayableNoteIds(filteredRows.map((r: any) => Number(r.id)).filter(Boolean))
              } else {
                setSelectedPayableNoteIds([])
              }
            }}
            onClick={(e) => e.stopPropagation()}
            title="Tümünü Seç"
            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
          />
        ),
        render: (_v, row) => (
          <input
            type="checkbox"
            checked={selectedPayableNoteIds.includes(Number(row.id))}
            onChange={(e) => {
              const id = Number(row.id)
              setSelectedPayableNoteIds((prev) => (e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)))
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )
      },
      { key: 'scNo', label: 'Bordro No', searchable: true },
      {
        key: 'customerName',
        label: 'Verilen Cari',
        searchable: true,
        render: (_v, row) => {
          const code = String((row as any).customerCode ?? '').trim()
          const name = String((row as any).customerName ?? '').trim()
          if (code && name) return `[${code}] ${name}`
          if (code) return code
          return name
        }
      },
      { key: 'issueDate', label: 'Çıkış Tarihi', searchable: true, filter: { type: 'date' }, render: (v) => fmtDateTr(String(v ?? '')) },
      { key: 'dueDate', label: 'Vade Tarihi', searchable: true, filter: { type: 'date' }, render: (v) => fmtDateTr(String(v ?? '')) },
      { key: 'noteNo', label: 'Senet No', searchable: true },
      {
        key: 'amount',
        label: 'Tutar',
        searchable: true,
        render: (v: any, row: any) => formatMoneyByCurrencyTypeId(Number(v ?? 0), row?.currencyTypeId)
      },
      {
        key: 'status',
        label: 'Durum',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'İlk Kayıt', value: '1' },
            { label: 'Bankaya Ciro', value: '2' },
            { label: 'Ödendi', value: '3' },
            { label: 'İade', value: '4' },
            { label: 'Karşılıksız', value: '5' },
            { label: 'İptal', value: '6' }
          ]
        },
        render: (v) => payableStatusLabel(Number(v ?? 0))
      },
      { key: 'createUser', label: 'İşlem Yapan', searchable: true },
      {
        key: 'actions',
        label: 'İşlemler',
        render: (_v, row) => {
          const canEditOrDelete = Number(row.status ?? 0) === 1
          return (
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                disabled={!canEditOrDelete}
                title={!canEditOrDelete ? "Yalnızca 'İlk Kayıt' durumundaki borç senetleri düzenlenebilir" : 'Düzenle'}
                className={
                  'inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium border transition-colors ' +
                  (canEditOrDelete
                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200 cursor-pointer'
                    : 'bg-transparent text-slate-300 border-slate-200 cursor-not-allowed')
                }
                onClick={(e) => {
                  e.stopPropagation()
                  if (!canEditOrDelete) return
                  openEditPayableNote(row)
                }}
              >
                Düzenle
              </button>
              <button
                type="button"
                disabled={!canEditOrDelete}
                title={!canEditOrDelete ? "Yalnızca 'İlk Kayıt' durumundaki borç senetleri silinebilir" : 'Sil'}
                className={
                  'inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[10px] font-medium border transition-colors ' +
                  (canEditOrDelete
                    ? 'bg-red-50 text-red-700 hover:bg-red-100 border-red-200 cursor-pointer'
                    : 'bg-transparent text-slate-300 border-slate-200 cursor-not-allowed')
                }
                onClick={(e) => {
                  e.stopPropagation()
                  if (!canEditOrDelete) return
                  deletePayableNoteRow(Number(row.id), String(row.noteNo ?? ''), 'Borç Senedi')
                }}
              >
                Sil
              </button>
            </div>
          )
        }
      }
    ],
    [selectedPayableNoteIds, isSuperAdmin, allowedKeys]
  )

  const columns = useMemo(() => {
    if (activeTabId === 'debtCheck') return payableCheckColumns as any
    if (activeTabId === 'debtNote') return payableNoteColumns as any
    return customerCheckColumns as any
  }, [activeTabId, customerCheckColumns, payableCheckColumns, payableNoteColumns])

  const data = useMemo(() => filteredRows as any[], [filteredRows])

  /*
    USTTEKI OZET, EKRANDA GORUNEN SATIRLARI ANLATIR (2026-08-23).

    Kolon suzgecleri tablonun icinde calisiyor; ozet ise `filteredRows`'tan (sayfanin ham
    verisi) hesaplaniyordu. Vade suzgeciyle tek satir kalsa bile ustte 15 cekin toplami
    yaziyordu. Tablo artik suzgecten gecen satirlari bildiriyor ve ozet onu kullaniyor.

    `null` = tablo henuz haber vermedi; o ana kadar ham veri gosterilir.
  */
  const [visibleRows, setVisibleRows] = useState<any[] | null>(null)

  // Sekme degisince onceki sekmenin satirlari ozette asili kalmasin.
  useEffect(() => { setVisibleRows(null) }, [activeTabId])

  const activeStats = useMemo(() => {
    // Tablonun bildirdigi satirlar esas; bildirim gelmediyse sayfanin ham verisi.
    const shown: any[] = visibleRows ?? (filteredRows ?? [])

    const selectedIds =
      activeTabId === 'debtCheck' ? selectedPayableCheckIds
      : activeTabId === 'debtNote' ? selectedPayableNoteIds
      : selectedCustomerCheckIds

    const set = new Set((selectedIds ?? []).map((x) => Number(x)))

    // Secim de suzgecle KESISTIRILIR: suzulup ekrandan kalkmis bir satirin tutari ustte
    // sayilirsa "0 satir, 3 secili, 4,3 milyon" gibi hicbir seye karsilik gelmeyen bir
    // ozet cikiyordu (kullanici sikayeti, 2026-08-23).
    const selectedShown = set.size > 0 ? shown.filter((r: any) => set.has(Number(r?.id ?? 0))) : []
    const selectedCount = selectedShown.length
    const rows: any[] = selectedCount > 0 ? selectedShown : shown

    const count = rows.length
    if (count === 0) {
      return { count: 0, totalAmount: 0, avgDueDate: '', avgDueDays: null, isSelection: false }
    }

    let totalAmount = 0
    let weightedTimeSum = 0
    let validDateCount = 0
    let unweightedTimeSum = 0

    const todayMs = new Date().setHours(0, 0, 0, 0)
    const dayMs = 24 * 60 * 60 * 1000

    for (const r of rows) {
      const amt = Number(r?.amount ?? 0)
      totalAmount += amt
      const dueDateStr = String(r?.dueDate ?? '').trim()
      if (dueDateStr) {
        const dueMs = new Date(dueDateStr).setHours(0, 0, 0, 0)
        if (Number.isFinite(dueMs)) {
          validDateCount++
          unweightedTimeSum += dueMs
          weightedTimeSum += amt * dueMs
        }
      }
    }

    let avgDueTime: number | null = null
    if (totalAmount > 0 && weightedTimeSum > 0) {
      avgDueTime = weightedTimeSum / totalAmount
    } else if (validDateCount > 0) {
      avgDueTime = unweightedTimeSum / validDateCount
    }

    /*
      Ortalama vade YEREL gunden okunur. `toISOString().slice(0,10)` UTC gunudur ve
      +03'te gece yarisina yakin bir ortalama bir onceki gunu yazardi — tablodaki vade
      sutunuyla ayni gunu gostermesi icin yerel alanlar kullaniliyor.
    */
    const avgDueDate = avgDueTime
      ? (() => {
          const d = new Date(avgDueTime)
          const pad = (n2: number) => String(n2).padStart(2, '0')
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        })()
      : ''
    const avgDueDays = avgDueTime ? Math.round((avgDueTime - todayMs) / dayMs) : null

    return {
      count,
      totalAmount,
      avgDueDate,
      avgDueDays,
      isSelection: selectedCount > 0
    }
  }, [activeTabId, selectedCustomerCheckIds, selectedPayableCheckIds, selectedPayableNoteIds, filteredRows, visibleRows])

  const canBulkDishonorCustomerChecks = useMemo(() => {
    if (activeTabId === 'debtCheck' || activeTabId === 'debtNote') return false
    const set = new Set((selectedCustomerCheckIds ?? []).map((x) => Number(x)))
    const rows = (customerChecks ?? []).filter((r: any) => set.has(Number(r?.id ?? 0)))
    if (!rows.length) return false
    return rows.every((r: any) => Number(r?.status ?? 0) === 1)
  }, [activeTabId, customerChecks, selectedCustomerCheckIds])

  /**
   * Bordro basımı, teklif/proforma ile AYNI önizleyiciyi kullanır
   * (`/print/preview` → araç çubuğu + yazdır + dışa aktar).
   *
   * Eskiden boş bir sekme açılıp içine `document.write` ediliyordu. O sekmenin adresi
   * `about:blank` olduğu için belgedeki `/stilsoft-logo.png` gibi kök yollar hiçbir yere
   * çözülmüyor ve sayfa boş görünüyordu; ayrıca yazdırma araç çubuğu da yoktu.
   */
  const openVBordroPrint = (vBordroNo: string) => {
    const no = String(vBordroNo ?? '').trim()
    if (!no) return
    window.open(`/print/preview?type=vBordro&no=${encodeURIComponent(no)}`, '_blank')
  }

  const submitCreate = async () => {
    try {
      setCreateSaving(true)
      setError(null)

      const forms = (createForms ?? []).filter((f) => f)
      if (!forms.length) throw new Error('Kayıt bulunamadı')

      if (activeTabId === 'debtCheck') {
        const enteredCheckNos = (forms ?? [])
          .map((f) => String((f as any)?.checkNo ?? '').trim())
          .filter((x) => x.length > 0)
        if (enteredCheckNos.length) {
          const seen = new Set<string>()
          let dup: string | null = null
          for (const n of enteredCheckNos) {
            if (seen.has(n)) {
              dup = n
              break
            }
            seen.add(n)
          }
          if (dup) throw new Error(`Aynı çek seri no birden fazla kez girilmiş: ${dup}`)
        }

        const payloads = forms.map((f) => {
          const issueDate = String(f.issueDate ?? '').trim()
          const dueDate = String(f.dueDate ?? '').trim()
          const amount = parseFormattedAmount(f.amount)
          const currencyTypeId = Number(f.currencyTypeId ?? 0)
          const customerCode = String(f.customerCode ?? '').trim()
          const currencyRate = parseFormattedAmount(f.currencyRate) || 1
          const selectedBankAccountId = f.bankAccountId ? Number(f.bankAccountId) : 0

          if (!issueDate) throw new Error('Tarih zorunlu')
          if (!dueDate) throw new Error('Vade tarihi zorunlu')
          if (!Number.isFinite(amount) || amount <= 0) throw new Error('Tutar geçersiz')
          if (!customerCode) throw new Error('Cari seçmelisiniz')
          if (!Number.isFinite(currencyRate) || currencyRate <= 0) throw new Error('Döviz kur geçersiz')
          if (!selectedBankAccountId || selectedBankAccountId <= 0) throw new Error('Banka seçmelisiniz')

          return {
            customerCode,
            issueDate: toIsoFromYmd(issueDate),
            dueDate: toIsoFromYmd(dueDate),
            amount,
            currencyTypeId,
            currencyRate,
            bankAccountDefinitionId: selectedBankAccountId,
            checkNo: String(f.checkNo ?? '').trim() || null
          }
        })

        if (payloads.length === 1) await createPayableCheck(payloads[0])
        else await createPayableChecksBulk(payloads)
      } else if (activeTabId === 'debtNote') {
        const payloads = forms.map((f) => {
          const docNo = String(f.documentNo ?? '').trim()
          const issueDate = String(f.issueDate ?? '').trim()
          const dueDate = String(f.dueDate ?? '').trim()
          const amount = parseFormattedAmount(f.amount)
          const customerCode = String(f.customerCode ?? '').trim()
          const selectedBankAccountId = f.bankAccountId ? Number(f.bankAccountId) : 0

          if (!issueDate) throw new Error('Tarih zorunlu')
          if (!dueDate) throw new Error('Vade tarihi zorunlu')
          if (!Number.isFinite(amount) || amount <= 0) throw new Error('Tutar geçersiz')
          if (!customerCode) throw new Error('Cari seçmelisiniz')
          if (!selectedBankAccountId || selectedBankAccountId <= 0) throw new Error('Banka seçmelisiniz')

          const currencyTypeId = Number(f.currencyTypeId ?? 1)

          return {
            documentNo: docNo || undefined,
            customerCode,
            issueDate: toIsoFromYmd(issueDate),
            dueDate: toIsoFromYmd(dueDate),
            amount,
            currencyTypeId,
            noteNo: String(f.noteNo ?? '').trim() || null,
            bankAccountDefinitionId: selectedBankAccountId
          }
        })

        if (payloads.length === 1) await createPayableNote(payloads[0])
        else await createPayableNotesBulk(payloads)
      } else {
        const payloads = forms.map((f) => {
          const issueDate = String(f.issueDate ?? '').trim()
          const dueDate = String(f.dueDate ?? '').trim()
          const amount = parseFormattedAmount(f.amount)
          const currencyTypeId = Number(f.currencyTypeId ?? 0)
          const customerCode = String(f.customerCode ?? '').trim()
          const endorsementType = Number(f.endorsementType ?? 1)
          const bankDetailId = f.bankDetailId ? Number(f.bankDetailId) : 0

          if (!issueDate) throw new Error('Tarih zorunlu')
          if (!dueDate) throw new Error('Vade tarihi zorunlu')
          if (!Number.isFinite(amount) || amount <= 0) throw new Error('Tutar geçersiz')
          if (!customerCode) throw new Error('Cari seçmelisiniz')
          if (endorsementType !== 1 && endorsementType !== 2) throw new Error('Asıl/Ciro seçimi geçersiz')
          if (!bankDetailId || bankDetailId <= 0) throw new Error('Banka seçmelisiniz')

          if (endorsementType === 2) {
            const od = String(f.originalDebtorName ?? '').trim()
            if (!od) throw new Error('Ciro seçildiğinde Asıl Borçlu zorunlu')
          }

          const selectedBankDetail = bankDetailId > 0 ? bankDetailsList.find((b) => b.id === bankDetailId) : null
          return {
            documentNo: undefined,
            customerCode,
            issueDate: toIsoFromYmd(issueDate),
            dueDate: toIsoFromYmd(dueDate),
            amount,
            currencyTypeId,
            // Ekranda girilen kur sunucuya GÖNDERİLİR: çekin anlaşma kuru güncel kurdan
            // farklı olabilir. Boş bırakılırsa sunucu güncel kuru kendisi çeker.
            currencyRate: parseFormattedAmount(f.currencyRate) || undefined,
            endorsementType: endorsementType as any,
            bankName: selectedBankDetail ? String(selectedBankDetail.name ?? '').trim() || null : null,
            branchName: String(f.branchName ?? '').trim() || null,
            districtName: String(f.districtName ?? '').trim() || null,
            checkNo: String(f.checkNo ?? '').trim() || null,
            originalDebtorName: endorsementType === 2 ? (String(f.originalDebtorName ?? '').trim() || null) : null,
            originalIdentityNo: endorsementType === 2 ? (String(f.originalIdentityNo ?? '').trim() || null) : null,
            originalTaxNo: endorsementType === 2 ? (String(f.originalTaxNo ?? '').trim() || null) : null
          }
        })

        if (payloads.length === 1) await createCustomerCheck(payloads[0])
        else await createCustomerChecksBulk(payloads)
      }

      setCreateOpen(false)
      resetCreateForms()
      await loadRows()
    } catch (e: any) {
      setError(String(e?.message ?? 'İşlem başarısız'))
    } finally {
      setCreateSaving(false)
    }
  }

  const submitAction = async () => {
    if (!actionTargetIds.length) return
    try {
      setActionSaving(true)
      setError(null)

      const payload: any = {
        date: toIsoFromYmd(actionDate),
        description: String(actionDescription ?? '').trim() || null
      }

      if (canUseBank) {
        const selectedBankAccountId = actionBankId ? Number(actionBankId) : null
        if (!selectedBankAccountId || selectedBankAccountId <= 0) throw new Error('Banka hesabı seçmelisiniz')
        const bankAccount = banks.find((b) => b.id === selectedBankAccountId)
        if (!bankAccount) {
          throw new Error('Seçilen banka hesabı bulunamadı')
        }
        payload.bankAccountDefinitionId = bankAccount.id
      }

      if (canUseTargetCustomer) {
        const code = String(actionTargetCustomerCode ?? '').trim()
        if (!code) throw new Error('Hedef cari seçmelisiniz')
        payload.targetCustomerCode = code
      }

      if (actionKind === 'cc_endorse_bank_guarantee' && actionTargetIds.length > 1) {
        const ids = actionTargetIds.map((x) => Number(x)).filter((x) => x > 0)
        const bankAccountDefinitionId = Number(payload.bankAccountDefinitionId ?? 0)
        const date = String(payload.date ?? '')
        const res = await endorseCustomerChecksToBankGuaranteeBulk({
          ids,
          date,
          bankAccountDefinitionId,
          description: payload.description ?? null
        })

        if (res?.vBordroNo) openVBordroPrint(String(res.vBordroNo))
      } else {
        for (const id of actionTargetIds) {
          if (actionKind === 'cc_endorse_bank_guarantee') {
            const res = await endorseCustomerCheckToBankGuarantee(id, payload)
            if (res?.vBordroNo) openVBordroPrint(String(res.vBordroNo))
          }
          else if (actionKind === 'cc_endorse_bank_collection') await endorseCustomerCheckToBankCollection(id, payload)
          else if (actionKind === 'cc_collect') await collectCustomerCheck(id, payload)
          else if (actionKind === 'cc_uncollect') await uncollectCustomerCheck(id)
          else if (actionKind === 'cc_endorse_customer') await endorseCustomerCheckToCustomer(id, payload)
          else if (actionKind === 'cc_return_portfolio') await returnCustomerCheckToPortfolio(id, payload)
          else if (actionKind === 'cc_return') await returnCustomerCheck(id, payload)
          else if (actionKind === 'cc_dishonor') await dishonorCustomerCheck(id, payload)
          else if (actionKind === 'pc_endorse_bank') await endorsePayableCheckToBank(id, payload)
          else if (actionKind === 'pc_pay') await payPayableCheck(id, payload)
          else if (actionKind === 'pc_cancel') await cancelPayableCheck(id, payload)
          else if (actionKind === 'pc_revert') await revertPayableCheckToPending(id, payload)
          else if (actionKind === 'pc_return') await returnPayableCheck(id, payload)
          else if (actionKind === 'pc_unpay') await unpayPayableCheck(id)
          else if (actionKind === 'pc_dishonor') await dishonorPayableCheck(id, payload)
          else if (actionKind === 'pn_endorse_bank') await endorsePayableNoteToBank(id, payload)
          else if (actionKind === 'pn_pay') await payPayableNote(id, payload)
          else if (actionKind === 'pn_cancel') await cancelPayableNote(id, payload)
          else if (actionKind === 'pn_revert') await revertPayableNoteToPending(id, payload)
          else if (actionKind === 'pn_return') await returnPayableNote(id, payload)
          else if (actionKind === 'pn_unpay') await unpayPayableNote(id)
          else if (actionKind === 'pn_dishonor') await dishonorPayableNote(id, payload)
        }
      }

      setActionOpen(false)
      setSelectedCustomerCheckIds([])
      setSelectedPayableCheckIds([])
      setSelectedPayableNoteIds([])
      await loadRows()
    } catch (e: any) {
      setError(String(e?.message ?? 'İşlem başarısız'))
    } finally {
      setActionSaving(false)
    }
  }

  return (
    <div className="p-4">
      {error && <div className="mb-3 text-xs font-semibold text-red-600 whitespace-pre-line">{error}</div>}

      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (createSaving) return
          setCreateOpen(false)
        }}
        title={`Yeni ${title}`}
        footer={
          <>
            <button
              type="button"
              disabled={createSaving}
              onClick={addCreateRow}
              className="px-3 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Satır Ekle
            </button>
            <button
              type="button"
              disabled={createSaving}
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={createSaving}
              onClick={() => void submitCreate()}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {createSaving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </>
        }
      >
        <div className="space-y-6">
          {error && <div className="mb-3 text-sm font-semibold text-red-600 bg-red-50 border border-red-200 p-3 rounded-lg whitespace-pre-line">{error}</div>}
          {(createForms ?? []).map((form, idx) => (
            <div key={idx} className="border border-gray-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-gray-700">Kayıt {idx + 1}</div>
                {(createForms ?? []).length > 1 && (
                  <button
                    type="button"
                    disabled={createSaving}
                    onClick={() => removeCreateRow(idx)}
                    className="text-[11px] font-semibold text-red-600 hover:text-red-700"
                  >
                    Sil
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeTabId === 'debtNote' && (
                  <div className="md:col-span-2">
                    <FormInput label="Belge No" value={form.documentNo ?? ''} onChange={(e) => updateCreateRow(idx, { documentNo: e.target.value })} />
                  </div>
                )}

                {activeTabId === 'debtCheck' || activeTabId === 'debtNote' ? (
                  <div className="md:col-span-2">
                    <FormSearchableSelect
                      label="Verilen Cari"
                      value={form.customerCode ?? ''}
                      onChange={(e: any) => updateCreateRow(idx, { customerCode: typeof e === 'object' && e?.target ? e.target.value : String(e ?? '') })}
                      options={[{ label: 'Seçiniz', value: '' }, ...combinedCaris]}
                    />
                  </div>
                ) : (
                  <div className="md:col-span-2">
                    <FormSearchableSelect
                      label="Veren Adı"
                      value={form.customerCode ?? ''}
                      onChange={(e: any) => updateCreateRow(idx, { customerCode: typeof e === 'object' && e?.target ? e.target.value : String(e ?? '') })}
                      options={[{ label: 'Seçiniz', value: '' }, ...combinedCaris]}
                    />
                  </div>
                )}

                <FormInput
                  label={activeTabId === 'debtCheck' || activeTabId === 'debtNote' ? 'Çıkış Tarihi' : 'Giriş Tarihi'}
                  type="date"
                  value={form.issueDate ?? ''}
                  onChange={(e) => updateCreateRow(idx, { issueDate: e.target.value })}
                />
                <FormInput label="Vade Tarihi" type="date" value={form.dueDate ?? ''} onChange={(e) => updateCreateRow(idx, { dueDate: e.target.value })} />

                {activeTabId !== 'debtCheck' && activeTabId !== 'debtNote' && (
                  <FormSelect
                    label="Asıl/Ciro"
                    value={form.endorsementType ?? '1'}
                    onChange={(e) => updateCreateRow(idx, { endorsementType: e.target.value })}
                    options={[
                      { label: 'Asıl', value: '1' },
                      { label: 'Ciro', value: '2' }
                    ]}
                  />
                )}

                <FormInput
                  label="Tutar"
                  type="text"
                  value={form.amount ?? ''}
                  onChange={(e) => updateCreateRow(idx, { amount: handleCurrencyInputChange(e.target.value) })}
                  onBlur={() => {
                    const num = parseFormattedAmount(form.amount)
                    if (num > 0) {
                      updateCreateRow(idx, { amount: formatMoney(num) })
                    }
                  }}
                />

                {activeTabId === 'debtCheck' ? (
                  <>
                    <FormSelect
                      label="Döviz Tipi"
                      value={normalizeCurrencySelectValue(form.currencyTypeId)}
                      onChange={(e) => void handleCurrencyTypeChange(idx, e.target.value)}
                      options={currencyOptions}
                    />

                    <FormInput label="Döviz Kur" value={form.currencyRate ?? ''} onChange={(e) => updateCreateRow(idx, { currencyRate: e.target.value })} />

                    {/* tutar × kur = TL karşılığı. Etiket "Döviz Tutar" idi; girilen tutar
                        zaten dövizin kendisi, bu alan onun TL projeksiyonu. */}
                    <FormInput
                      label="TL Karşılığı"
                      value={(() => {
                        const a = parseFormattedAmount(form.amount)
                        const r = parseFormattedAmount(form.currencyRate)
                        if (!a || !r) return ''
                        return formatMoney(a * r)
                      })()}
                      onChange={() => {}}
                      disabled
                    />

                    <FormSearchableSelect
                      label="Banka"
                      value={form.bankAccountId ?? ''}
                      onChange={(e: any) => updateCreateRow(idx, { bankAccountId: typeof e === 'object' && e?.target ? e.target.value : String(e ?? '') })}
                      options={[{ label: 'Seçiniz', value: '' }, ...banks.map((b) => ({ label: `${b.accountName} (${b.bankName})`, value: String(b.id) }))]}
                    />
                  </>
                ) : activeTabId === 'debtNote' ? (
                  <FormSearchableSelect
                    label="Banka"
                    value={form.bankAccountId ?? ''}
                    onChange={(e: any) => updateCreateRow(idx, { bankAccountId: typeof e === 'object' && e?.target ? e.target.value : String(e ?? '') })}
                    options={[{ label: 'Seçiniz', value: '' }, ...banks.map((b) => ({ label: `${b.accountName} (${b.bankName})`, value: String(b.id) }))]}
                  />
                ) : (
                  <>
                    <FormSelect
                      label="Döviz Tipi"
                      value={normalizeCurrencySelectValue(form.currencyTypeId)}
                      onChange={(e) => void handleCurrencyTypeChange(idx, e.target.value)}
                      options={currencyOptions}
                    />

                    {/* KUR VE TL KARŞILIĞI MÜŞTERİ ÇEKİNDE DE GÖRÜNÜR (2026-08-17).
                        Bu iki alan yalnız BORÇ ÇEKİ sekmesinde vardı: müşteri çekinde döviz
                        tipi seçiliyor ama kur ne soruluyor ne gösteriliyordu; kullanıcı
                        dolarlı çeki girip listede "₺" görüyordu. Kur, döviz tipi seçilince
                        `handleCurrencyTypeChange` ile güncel değerden dolduruluyor ve elle
                        değiştirilebiliyor (çekin kendi anlaşma kuru farklı olabilir). */}
                    <FormInput
                      label="Döviz Kur"
                      value={form.currencyRate ?? ''}
                      onChange={(e) => updateCreateRow(idx, { currencyRate: e.target.value })}
                    />

                    <FormInput
                      label="TL Karşılığı"
                      value={(() => {
                        const a = parseFormattedAmount(form.amount)
                        const r = parseFormattedAmount(form.currencyRate)
                        if (!a || !r) return ''
                        return formatMoney(a * r)
                      })()}
                      onChange={() => {}}
                      disabled
                    />
                  </>
                )}

                {activeTabId === 'debtNote' ? (
                  <FormInput label="Senet No" value={form.noteNo ?? ''} onChange={(e) => updateCreateRow(idx, { noteNo: e.target.value })} />
                ) : activeTabId === 'debtCheck' ? (
                  <div className="md:col-span-2">
                    <FormInput label="Çek Seri" value={form.checkNo ?? ''} onChange={(e) => updateCreateRow(idx, { checkNo: e.target.value })} />
                  </div>
                ) : (
                  <>
                    {activeTabId !== 'debtCheck' && activeTabId !== 'debtNote' ? (
                      <FormSearchableSelect
                        label="Banka"
                        value={form.bankDetailId ?? ''}
                        onChange={(e: any) => updateCreateRow(idx, { bankDetailId: typeof e === 'object' && e?.target ? e.target.value : String(e ?? '') })}
                        options={[{ label: 'Seçiniz', value: '' }, ...bankDetailsList.map((b) => ({ label: b.name, value: String(b.id) }))]}
                      />
                    ) : null}

                    <FormSearchableSelect
                      label="Şube"
                      value={form.branchName ?? ''}
                      onChange={(e: any) => updateCreateRow(idx, { branchName: typeof e === 'object' && e?.target ? e.target.value : String(e ?? '') })}
                      options={kktcDistrictOptions}
                    />
                    <div className="md:col-span-2">
                      <FormInput label="Çek Seri" value={form.checkNo ?? ''} onChange={(e) => updateCreateRow(idx, { checkNo: e.target.value })} />
                    </div>

                    {activeTabId !== 'debtCheck' && activeTabId !== 'debtNote' && String(form.endorsementType ?? '1') === '2' && (
                      <div className="md:col-span-2">
                        <FormInput label="Asıl Borçlu" value={form.originalDebtorName ?? ''} onChange={(e) => updateCreateRow(idx, { originalDebtorName: e.target.value })} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Düzenleme Modalı */}
      <Modal
        isOpen={Boolean(editTarget && editForm)}
        onClose={() => {
          if (editSaving) return
          setEditTarget(null)
          setEditForm(null)
        }}
        title={`${editTarget?.type === 'debtCheck' ? 'Borç Çeki' : editTarget?.type === 'debtNote' ? 'Borç Senedi' : 'Müşteri Çeki'} Düzenle`}
        footer={
          <>
            <button
              type="button"
              disabled={editSaving}
              onClick={() => {
                setEditTarget(null)
                setEditForm(null)
              }}
              className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={editSaving}
              onClick={() => void submitEdit()}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
            >
              {editSaving ? 'Güncelleniyor...' : 'Güncelle'}
            </button>
          </>
        }
      >
        {editForm && (
          <div className="space-y-4">
            {error && <div className="mb-3 text-sm font-semibold text-red-600 bg-red-50 border border-red-200 p-3 rounded-lg whitespace-pre-line">{error}</div>}

            <div className="border border-gray-100 rounded-xl p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {editTarget?.type === 'debtNote' && (
                  <div className="md:col-span-2">
                    <FormInput
                      label="Belge No"
                      value={editForm.documentNo ?? ''}
                      onChange={(e) => setEditForm((prev: any) => ({ ...prev, documentNo: e.target.value }))}
                    />
                  </div>
                )}

                <div className="md:col-span-2">
                  <FormSearchableSelect
                    label={editTarget?.type === 'debtCheck' || editTarget?.type === 'debtNote' ? 'Verilen Cari' : 'Veren Adı'}
                    value={editForm.customerCode ?? ''}
                    onChange={(e: any) => setEditForm((prev: any) => ({ ...prev, customerCode: typeof e === 'object' && e?.target ? e.target.value : String(e ?? '') }))}
                    options={[{ label: 'Seçiniz', value: '' }, ...combinedCaris]}
                  />
                </div>

                <FormInput
                  label={editTarget?.type === 'debtCheck' || editTarget?.type === 'debtNote' ? 'Çıkış Tarihi' : 'Giriş Tarihi'}
                  type="date"
                  value={editForm.issueDate ?? ''}
                  onChange={(e) => setEditForm((prev: any) => ({ ...prev, issueDate: e.target.value }))}
                />
                <FormInput
                  label="Vade Tarihi"
                  type="date"
                  value={editForm.dueDate ?? ''}
                  onChange={(e) => setEditForm((prev: any) => ({ ...prev, dueDate: e.target.value }))}
                />

                {editTarget?.type === 'customerCheck' && (
                  <FormSelect
                    label="Asıl/Ciro"
                    value={editForm.endorsementType ?? '1'}
                    onChange={(e) => setEditForm((prev: any) => ({ ...prev, endorsementType: e.target.value }))}
                    options={[
                      { label: 'Asıl', value: '1' },
                      { label: 'Ciro', value: '2' }
                    ]}
                  />
                )}

                <FormInput
                  label="Tutar"
                  type="text"
                  value={editForm.amount ?? ''}
                  onChange={(e) => setEditForm((prev: any) => ({ ...prev, amount: handleCurrencyInputChange(e.target.value) }))}
                  onBlur={() => {
                    const num = parseFormattedAmount(editForm.amount)
                    if (num > 0) {
                      setEditForm((prev: any) => ({ ...prev, amount: formatMoney(num) }))
                    }
                  }}
                />

                {editTarget?.type === 'debtCheck' ? (
                  <>
                    <FormSelect
                      label="Döviz Tipi"
                      value={normalizeCurrencySelectValue(editForm.currencyTypeId)}
                      onChange={(e) => void handleEditCurrencyTypeChange(e.target.value)}
                      options={currencyOptions}
                    />

                    <FormInput
                      label="Döviz Kur"
                      value={editForm.currencyRate ?? ''}
                      onChange={(e) => setEditForm((prev: any) => ({ ...prev, currencyRate: e.target.value }))}
                    />

                    <FormInput
                      label="TL Karşılığı"
                      value={(() => {
                        const a = parseFormattedAmount(editForm.amount)
                        const r = parseFormattedAmount(editForm.currencyRate)
                        if (!a || !r) return ''
                        return formatMoney(a * r)
                      })()}
                      onChange={() => {}}
                      disabled
                    />

                    <FormSearchableSelect
                      label="Banka"
                      value={editForm.bankAccountId ?? ''}
                      onChange={(e: any) => setEditForm((prev: any) => ({ ...prev, bankAccountId: typeof e === 'object' && e?.target ? e.target.value : String(e ?? '') }))}
                      options={[{ label: 'Seçiniz', value: '' }, ...banks.map((b) => ({ label: `${b.accountName} (${b.bankName})`, value: String(b.id) }))]}
                    />

                    <div className="md:col-span-2">
                      <FormInput
                        label="Çek Seri"
                        value={editForm.checkNo ?? ''}
                        onChange={(e) => setEditForm((prev: any) => ({ ...prev, checkNo: e.target.value }))}
                      />
                    </div>
                  </>
                ) : editTarget?.type === 'debtNote' ? (
                  <>
                    <FormSearchableSelect
                      label="Banka"
                      value={editForm.bankAccountId ?? ''}
                      onChange={(e: any) => setEditForm((prev: any) => ({ ...prev, bankAccountId: typeof e === 'object' && e?.target ? e.target.value : String(e ?? '') }))}
                      options={[{ label: 'Seçiniz', value: '' }, ...banks.map((b) => ({ label: `${b.accountName} (${b.bankName})`, value: String(b.id) }))]}
                    />
                    <FormInput
                      label="Senet No"
                      value={editForm.noteNo ?? ''}
                      onChange={(e) => setEditForm((prev: any) => ({ ...prev, noteNo: e.target.value }))}
                    />
                  </>
                ) : (
                  <>
                    <FormSelect
                      label="Döviz Tipi"
                      value={normalizeCurrencySelectValue(editForm.currencyTypeId)}
                      onChange={(e) => void handleEditCurrencyTypeChange(e.target.value)}
                      options={currencyOptions}
                    />

                    <FormInput
                      label="Döviz Kur"
                      value={editForm.currencyRate ?? ''}
                      onChange={(e) => setEditForm((prev: any) => ({ ...prev, currencyRate: e.target.value }))}
                    />

                    <FormInput
                      label="TL Karşılığı"
                      value={(() => {
                        const a = parseFormattedAmount(editForm.amount)
                        const r = parseFormattedAmount(editForm.currencyRate)
                        if (!a || !r) return ''
                        return formatMoney(a * r)
                      })()}
                      onChange={() => {}}
                      disabled
                    />

                    <FormSearchableSelect
                      label="Banka"
                      value={editForm.bankDetailId ?? ''}
                      onChange={(e: any) => {
                        const val = typeof e === 'object' && e?.target ? e.target.value : String(e ?? '')
                        const selectedBank = bankDetailsList.find((b) => b.id === Number(val))
                        setEditForm((prev: any) => ({
                          ...prev,
                          bankDetailId: val,
                          bankName: selectedBank ? selectedBank.name : ''
                        }))
                      }}
                      options={[{ label: 'Seçiniz', value: '' }, ...bankDetailsList.map((b) => ({ label: b.name, value: String(b.id) }))]}
                    />

                    <FormSearchableSelect
                      label="Şube"
                      value={editForm.branchName ?? ''}
                      onChange={(e: any) => setEditForm((prev: any) => ({ ...prev, branchName: typeof e === 'object' && e?.target ? e.target.value : String(e ?? '') }))}
                      options={kktcDistrictOptions}
                    />

                    <div className="md:col-span-2">
                      <FormInput
                        label="Çek Seri"
                        value={editForm.checkNo ?? ''}
                        onChange={(e) => setEditForm((prev: any) => ({ ...prev, checkNo: e.target.value }))}
                      />
                    </div>

                    {String(editForm.endorsementType ?? '1') === '2' && (
                      <div className="md:col-span-2">
                        <FormInput
                          label="Asıl Borçlu"
                          value={editForm.originalDebtorName ?? ''}
                          onChange={(e) => setEditForm((prev: any) => ({ ...prev, originalDebtorName: e.target.value }))}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={vBordroLimitCount != null}
        onClose={() => setVBordroLimitCount(null)}
        title="Bordro Sınırı Aşıldı"
        footer={
          <button
            type="button"
            onClick={() => setVBordroLimitCount(null)}
            className="px-4 py-2 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-900 text-white"
          >
            Tamam
          </button>
        }
      >
        <div className="p-4 text-sm text-slate-700">
          <p className="font-semibold text-rose-700">
            Maximum {MAX_CHECKS_PER_VBORDRO} taneyi aynı bordroda aktarabilirsiniz.
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Şu an <strong>{vBordroLimitCount}</strong> çek seçili. Seçimi en fazla{' '}
            {MAX_CHECKS_PER_VBORDRO} çeke düşürüp işlemi tekrarlayın; kalan çekleri ayrı bir
            bordro ile aktarabilirsiniz.
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={actionOpen}
        onClose={() => {
          if (actionSaving) return
          setActionOpen(false)
        }}
        title={
          actionKind === 'cc_endorse_bank_guarantee' ? 'Teminat Hesabına Ciro'
          : actionKind === 'cc_endorse_bank_collection' ? 'Bankaya Tahsilat Cirosu'
          : actionKind === 'cc_collect' ? 'Çek Tahsil'
          : actionKind === 'cc_uncollect' ? 'Ödendiyi Beklemeye Al (Tahsili İptal Et)'
          : actionKind === 'cc_endorse_customer' ? 'Cari Hesaba Ciro'
          : actionKind === 'cc_return_portfolio' ? 'Portföy İadesi'
          : actionKind === 'cc_return' ? 'Çek İadesi'
          : actionKind === 'cc_dishonor' ? 'Çek Karşılıksız'
          : actionKind === 'pc_endorse_bank' ? 'Bankaya Gönder'
          : actionKind === 'pc_pay' ? 'Borç Çeki Ödeme (Ödendi)'
          : actionKind === 'pc_cancel' ? 'Borç Çeki İptal'
          : actionKind === 'pc_revert' ? 'Borç Çekini Beklemeye Al'
          : actionKind === 'pc_return' ? 'Borç Çeki İade'
          : actionKind === 'pc_dishonor' ? 'Borç Çeki Karşılıksız'
          : actionKind === 'pn_endorse_bank' ? 'Bankaya Gönder'
          : actionKind === 'pn_pay' ? 'Borç Senedi Ödeme (Ödendi)'
          : actionKind === 'pn_cancel' ? 'Borç Senedi İptal'
          : actionKind === 'pn_revert' ? 'Borç Senedini Beklemeye Al'
          : actionKind === 'pn_return' ? 'Senet İade'
          : actionKind === 'pn_dishonor' ? 'Senet Karşılıksız'
          : 'İşlem'
        }
        footer={
          <>
            <button
              type="button"
              disabled={actionSaving}
              onClick={() => setActionOpen(false)}
              className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={actionSaving}
              onClick={() => void submitAction()}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {actionSaving ? 'Kaydediliyor...' : 'Onayla'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {actionKind === 'cc_uncollect' || actionKind === 'pc_revert' || actionKind === 'pn_revert' ? (
            <div className="md:col-span-2 text-sm text-gray-600 font-medium py-2">
              Seçili kayıtların tahsilat/ödendi/iptal işlemini geri almak ve durumu beklemeye çevirmek istediğinize emin misiniz?
              <br />
              Bu işlem sonucunda oluşan banka hareketi ve cari hesap hareketleri silinecektir.
            </div>
          ) : (
            <>
              <FormInput label="Tarih" type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />

              {canUseBank && (
                <div className="md:col-span-2">
                  <FormSearchableSelect
                    label="Banka Hesabı"
                    value={actionBankId}
                    onChange={(e: any) => setActionBankId(typeof e === 'object' && e?.target ? e.target.value : String(e ?? ''))}
                    options={actionBankOptions}
                  />
                </div>
              )}

              {canUseTargetCustomer && (
                <div className="md:col-span-2">
                  <FormSearchableSelect
                    label="Hedef Cari"
                    value={actionTargetCustomerCode}
                    onChange={(e: any) => setActionTargetCustomerCode(typeof e === 'object' && e?.target ? e.target.value : String(e ?? ''))}
                    options={[{ label: 'Seçiniz', value: '' }, ...combinedCaris]}
                  />
                </div>
              )}

              <div className="md:col-span-2">
                <FormInput label="Açıklama" value={actionDescription} onChange={(e) => setActionDescription(e.target.value)} />
              </div>
            </>
          )}
        </div>
      </Modal>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 bg-white border border-gray-200 rounded-xl p-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base font-bold text-gray-900 tracking-tight leading-none">{title}</h1>
            <p className="text-[10px] text-gray-400 mt-0.5">Çek/Senet İşlemleri</p>
          </div>

          <div className="h-4 w-[1px] bg-gray-200 mx-1" />

          {activeTabId === 'debtCheck' ? (
            <select
              value=""
              onChange={(e) => {
                const v = String(e.target.value) as any
                if (!v) return
                openBulkActionForSelectedPayableChecks(v)
              }}
              className="h-8 px-3 text-xs font-semibold bg-slate-50 border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition cursor-pointer"
            >
              <option value="">İşlemler...</option>
              <option value="pc_pay">Ödendi Yap</option>
              <option value="pc_cancel">İptal Et</option>
              <option value="pc_revert">Beklemeye Al</option>
            </select>
          ) : activeTabId === 'debtNote' ? (
            <select
              value=""
              onChange={(e) => {
                const v = String(e.target.value) as any
                if (!v) return
                openBulkActionForSelectedPayableNotes(v)
              }}
              className="h-8 px-3 text-xs font-semibold bg-slate-50 border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition cursor-pointer"
            >
              <option value="">İşlemler...</option>
              <option value="pn_pay">Ödendi Yap</option>
              <option value="pn_cancel">İptal Et</option>
              <option value="pn_revert">Beklemeye Al</option>
            </select>
          ) : (
            <select
              value=""
              onChange={(e) => {
                const v = String(e.target.value)
                if (!v) return
                if (v === 'cc_endorse_bank_guarantee') openBulkActionForSelectedCustomerChecks('cc_endorse_bank_guarantee')
                else if (v === 'cc_endorse_bank_collection') openBulkActionForSelectedCustomerChecks('cc_endorse_bank_collection')
                else if (v === 'cc_collect') openBulkActionForSelectedCustomerChecks('cc_collect')
                else if (v === 'cc_uncollect') openBulkActionForSelectedCustomerChecks('cc_uncollect')
                else if (v === 'cc_endorse_customer') openBulkActionForSelectedCustomerChecks('cc_endorse_customer')
                else if (v === 'cc_return_portfolio') openBulkActionForSelectedCustomerChecks('cc_return_portfolio')
                else if (v === 'cc_return') openBulkActionForSelectedCustomerChecks('cc_return')
                else if (v === 'cc_dishonor') {
                  if (!canBulkDishonorCustomerChecks) {
                    setError('Çek portföye alınmadan karşılıksız seçilemez')
                    return
                  }
                  openBulkActionForSelectedCustomerChecks('cc_dishonor')
                }
              }}
              className="h-8 px-3 text-xs font-semibold bg-slate-50 border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition cursor-pointer"
            >
              <option value="">İşlemler...</option>
              <option value="cc_endorse_bank_guarantee">Teminat Hesabına Ciro</option>
              <option value="cc_endorse_customer">Cari Hesaba Ciro</option>
              <option value="cc_collect">Teminattaki Çek Tahsil</option>
              <option value="cc_uncollect">Ödendiyi Beklemeye Al</option>
              <option value="cc_return_portfolio">Portföy İade</option>
              <option value="cc_return">Çek İade</option>
              <option value="cc_dishonor">Çek Karşılıksız</option>
            </select>
          )}

          <button
            type="button"
            onClick={() => {
              resetCreateForms()
              setCreateOpen(true)
            }}
            className="h-8 px-3 inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-2xs transition cursor-pointer"
          >
            <Plus size={14} />
            <span>Yeni</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 bg-slate-50 border border-gray-200 rounded-lg font-medium text-gray-600">
              {activeStats?.isSelection ? 'Seçilen Sayı:' : 'Sayısı:'} <strong className="text-gray-900 font-bold">{activeStats?.count ?? 0}</strong>
            </span>
            <span className="px-2.5 py-1 bg-slate-50 border border-gray-200 rounded-lg font-medium text-gray-600">
              {activeStats?.isSelection ? 'Seçilen Tutar:' : 'Toplam Tutar:'} <strong className="text-emerald-700 font-bold">{formatMoneyTRY(Number(activeStats?.totalAmount ?? 0))}</strong>
            </span>
            <span className="px-2.5 py-1 bg-slate-50 border border-gray-200 rounded-lg font-medium text-gray-600">
              Ort. Vade: <strong className="text-gray-900 font-bold">{activeStats?.avgDueDate ? fmtDateTr(activeStats.avgDueDate) : '-'}</strong>
              {typeof activeStats?.avgDueDays === 'number' && (
                <span className="ml-1 text-[10px] text-gray-400">({activeStats.avgDueDays} Gün)</span>
              )}
            </span>
          </div>

          <div className="relative w-52">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              type="text"
              placeholder="Ara..."
              className="w-full h-8 pl-8 pr-2.5 text-xs border border-gray-200 rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
            />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
        <Table
          onRefresh={() => void loadRows()}
          key={String(activeTabId ?? 'customerCheck')}
          rowKey={(row) => Number(row.id)}
          columns={columns}
          data={data}
          showColumnFilters
          globalSearch={globalSearch}
          initialHeaderFilters={activeTabId === 'debtCheck' || activeTabId === 'debtNote' ? undefined : { statusLabel: ['Portföy'] }}
          onFilteredDataChange={setVisibleRows}
        />
      </div>

      {loading && <div className="mt-2 text-xs text-gray-500">Yükleniyor...</div>}

      {/* Delete Confirmation Modal */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="relative bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3 bg-slate-50/60">
              <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Kaydı Sil</h3>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">{deleteConfirmTarget.label} silme işlemi</p>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                <span className="font-semibold text-slate-800">
                  {deleteConfirmTarget.checkNo ? `"${deleteConfirmTarget.checkNo}" no'lu ` : ''}
                  {deleteConfirmTarget.label}
                </span>{' '}
                kaydını silmek istediğinizden emin misiniz?
              </p>
              <div className="p-3 rounded-xl bg-red-50 border border-red-100">
                <p className="text-[11px] text-red-700 font-semibold leading-relaxed">
                  ⚠️ Bu işlem geri alınamaz. Kayıt kalıcı olarak silinecektir.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50/30">
              <button
                type="button"
                disabled={deleteConfirmLoading}
                onClick={() => setDeleteConfirmTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={deleteConfirmLoading}
                onClick={() => void confirmDelete()}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition-all shadow-sm shadow-red-600/20 disabled:opacity-60 flex items-center gap-1.5"
              >
                {deleteConfirmLoading && (
                  <svg className="w-3 h-3 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                Evet, Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
