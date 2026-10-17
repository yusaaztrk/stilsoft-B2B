import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PHONE_FORMAT_MESSAGE, PHONE_PATTERN, formatPhoneNumber } from '../utils/phone'
import { useNavigate } from 'react-router-dom'
import Table, { type TableColumn } from '../components/Table'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import Modal from '../components/Modal'
import FormInput from '../components/forms/FormInput'
import ActionDropdown from '../components/ActionDropdown'
import { activateEmployee, createEmployee, deleteEmployee, fetchEmployees, fetchNextEmployeeCode, hardDeleteEmployee, updateEmployee, type EmployeeDto } from '../api/employees'
import { bulkMealPayment, bulkSalaryPayment, createEmployeePayment, deleteEmployeePayment, fetchEmployeePayments } from '../api/employeePayments'
import { bulkPayPlannedBonusPlans, createEmployeeBonusPlan, deleteEmployeeBonusPlan, fetchEmployeeBonusPlans, undoPayEmployeeBonusPlan } from '../api/employeeBonusPlans'
import { deleteEmployeeMealPlan, fetchEmployeeMealPlans, undoPayEmployeeMealPlan } from '../api/employeeMealPlans'
import { createEmployeeLeave, deleteEmployeeLeave } from '../api/employeeLeaves'
import { createEmployeeCheckIn, deleteEmployeeCheckIn, fetchEmployeeCheckInsByEmployee, updateEmployeeCheckIn } from '../api/employeeCheckIns'
import { fetchEmployeeLeavesByEmployee } from '../api/employeeLeaves'
import { enrollFace, hasFaceEnrollment, deleteFaceEnrollment } from '../api/faceAuth'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { fetchBankAccountDefinitions, type BankAccountDefinitionDto } from '../api/bankAccountDefinitions'
import { fetchCashAccounts, type CashAccountDto } from '../api/cashAccounts'

type Row = EmployeeDto & { actions: string }

type FormState = {
  employeeCode: string
  username: string
  password: string
  firstName: string
  lastName: string
  mail: string
  tc: string
  phone: string
  taxNo: string
  taxOffice: string
  bankName: string
  iban: string
  hireDate: string
  workPermitDay: string
  salary: string
  salaryDay: string
  mealAmount: string
  isActive: boolean
}

type PaymentKind = 'salary' | 'bonus' | 'cashAdvance' | 'meal'

type PaymentEntry = {
  id: number
  employeeId: number
  kind: PaymentKind
  amount: number
  description: string
  paymentDate: string
  deductFromSalary?: boolean
  salaryDeductedAt?: string | null
  createdAt: string
  createUser: string
}

/**
 * Kurusla para girisini sayiya cevirir.
 *
 * `Number("2500,50")` NaN doner; cagiran yerlerdeki `|| 0` bunu SESSIZCE 0 yapiyordu —
 * kusuratli maas girildiginde alan sifirlaniyordu. Virgul varsa deger Turkce bicimde
 * kabul edilir (noktalar binlik ayraci, virgul ondalik); virgul yoksa nokta ondalik sayilir.
 */
const parseMoneyInput = (text: unknown): number => {
  const raw = String(text ?? '').trim()
  if (!raw) return 0
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
}

type BonusPlanEntry = {
  id: number
  employeeId: number
  plannedDate: string
  amount: number
  description: string
  status: number
  createdAt: string
  createUser: string
}

type MealPlanEntry = {
  id: number
  employeeId: number
  plannedDate: string
  amount: number
  description: string
  status: number
  createdAt: string
  createUser: string
}

function employeeFriendlyValidationMessage(key: string, message: string) {
  const k = String(key ?? '').toLowerCase()
  const m = String(message ?? '').trim()

  const label =
    k === 'employeecode'
      ? 'Kodu'
      : k === 'firstname'
        ? 'İsim'
        : k === 'lastname'
          ? 'Soyisim'
          : k === 'mail'
            ? 'Mail'
            : k === 'tc'
              ? 'TC'
              : k === 'phone'
                ? 'Telefon'
                : k === 'iban'
                  ? 'IBAN'
                  : key

  const lowered = m.toLowerCase()
  if (lowered.includes('must be unique') || lowered.includes('already') || lowered.includes('zaten')) {
    return `${label}: Bu değer zaten kayıtlı.`
  }
  if (lowered.includes('is required') || lowered.includes('zorunlu')) {
    return `${label}: Zorunlu alan.`
  }
  if (lowered.includes('not a valid e-mail address') || lowered.includes('valid e-mail')) {
    return `${label}: Geçerli bir email adresi giriniz.`
  }

  return `${label}: ${m}`
}

function employeeFriendlyApiErrorMessage(e: any, fallback: string) {
  const raw = String(e?.message ?? '').trim()
  if (!raw) return fallback

  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const j = JSON.parse(raw)
      const errors = j?.errors
      if (errors && typeof errors === 'object') {
        const parts: string[] = []
        Object.entries(errors).forEach(([k, v]) => {
          if (Array.isArray(v)) v.forEach((x) => parts.push(employeeFriendlyValidationMessage(k, String(x))))
          else if (typeof v === 'string') parts.push(employeeFriendlyValidationMessage(k, v))
        })
        if (parts.length) return parts.join('\n')
      }
    } catch {
      return raw
    }
  }

  if (raw === 'One or more validation errors occurred.') return fallback
  return raw
}

export default function EmployeesPage() {
  const navigate = useNavigate()

  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive'>('active')

  type TopQuickFilter = 'salaryPaid' | 'mealPaid' | 'bonusPaid' | 'bonusPlanned' | 'cashAdvancePaid'
  const [topQuickFilters, setTopQuickFilters] = useState<Set<TopQuickFilter>>(new Set())
  const [topFilterFrom, setTopFilterFrom] = useState('')
  const [topFilterTo, setTopFilterTo] = useState('')
  const [topFilterDropdownOpen, setTopFilterDropdownOpen] = useState(false)

  useEffect(() => {
    if (!topFilterDropdownOpen) return
    const onDocClick = () => setTopFilterDropdownOpen(false)
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [topFilterDropdownOpen])

  const emptyForm: FormState = {
    employeeCode: '',
    username: '',
    password: '',
    firstName: '',
    lastName: '',
    mail: '',
    tc: '',
    phone: '',
    taxNo: '',
    taxOffice: '',
    bankName: '',
    iban: '',
    hireDate: '',
    workPermitDay: '',
    salary: '0',
    salaryDay: '1',
    mealAmount: '0',
    isActive: true
  }

  const printLeaveFormFromItem = (item: { employeeName: string; startIso: string; returnIso: string; description: string }) => {
    const printedAt = new Date().toLocaleString('tr-TR')
    const name = item.employeeName || '-'
    const startText = fmtDateTime(item.startIso)
    const returnText = fmtDateTime(item.returnIso)
    const desc = item.description || '-'

    const html = `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>İzin Formu</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; padding: 32px; color: #111827; }
      .wrap { max-width: 760px; margin: 0 auto; }
      .title { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
      .subtitle { font-size: 12px; color: #6B7280; margin-bottom: 20px; }
      .card { border: 1px solid #E5E7EB; border-radius: 12px; padding: 18px; }
      .row { display: flex; gap: 12px; margin-bottom: 10px; }
      .label { width: 180px; font-size: 12px; font-weight: 700; color: #374151; }
      .value { flex: 1; font-size: 13px; color: #111827; }
      .line { height: 1px; background: #E5E7EB; margin: 16px 0; }
      .sign { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
      .signBox { border-top: 1px solid #9CA3AF; padding-top: 10px; font-size: 12px; color: #374151; }
      @media print { body { padding: 0; } .card { border: none; padding: 0; } }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="title">İzin Formu</div>
      <div class="subtitle">Yazdırma Tarihi: ${escapeHtml(printedAt)}</div>
      <div class="card">
        <div class="row"><div class="label">Çalışan</div><div class="value">${escapeHtml(name)}</div></div>
        <div class="row"><div class="label">İzin Başlangıç</div><div class="value">${escapeHtml(startText)}</div></div>
        <div class="row"><div class="label">İzin Bitiş</div><div class="value">${escapeHtml(returnText)}</div></div>
        <div class="line"></div>
        <div class="row"><div class="label">Açıklama</div><div class="value">${escapeHtml(desc)}</div></div>
        <div class="sign">
          <div class="signBox">Çalışan İmza</div>
          <div class="signBox">Yetkili İmza</div>
        </div>
      </div>
    </div>
    <script>window.onload = () => { window.print(); };</script>
  </body>
</html>`

    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) {
      showPopup('error', 'Hata', 'Pop-up engellendi. Lütfen pop-up izinlerini kontrol edin.')
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
  }

  const fmtLocalDateTimeInput = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${day}T${hh}:${mm}`
  }

  const isoToLocalDateTimeInput = (iso: string) => {
    const d = new Date(String(iso ?? ''))
    if (Number.isNaN(d.getTime())) return ''
    return fmtLocalDateTimeInput(d)
  }

  const printLeaveFormFromState = () => {
    const name = leaveFormEmployeeName || '-'
    const startIso = leaveFormStart || ''
    const returnIso = leaveFormReturn || ''
    const desc = leaveFormDescription || ''
    const now = new Date()
    const printedAt = now.toLocaleString('tr-TR')

    const html = `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>İzin Formu</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; padding: 32px; color: #111827; }
      .wrap { max-width: 760px; margin: 0 auto; }
      .title { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
      .subtitle { font-size: 12px; color: #6B7280; margin-bottom: 20px; }
      .card { border: 1px solid #E5E7EB; border-radius: 12px; padding: 18px; }
      .row { display: flex; gap: 12px; margin-bottom: 10px; }
      .label { width: 200px; font-size: 12px; font-weight: 700; color: #374151; }
      .value { flex: 1; font-size: 13px; color: #111827; }
      .line { height: 1px; background: #E5E7EB; margin: 16px 0; }
      .note { font-size: 12px; color: #374151; white-space: pre-wrap; }
      .sign { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
      .signBox { border-top: 1px solid #9CA3AF; padding-top: 10px; font-size: 12px; color: #374151; }
      @media print {
        body { padding: 0; }
        .card { border: none; padding: 0; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="title">İzin Formu</div>
      <div class="subtitle">Yazdırma Tarihi: ${escapeHtml(printedAt)}</div>
      <div class="card">
        <div class="row"><div class="label">Çalışan</div><div class="value">${escapeHtml(name)}</div></div>
        <div class="row"><div class="label">İzin Çıkış Tarihi/Saati</div><div class="value">${escapeHtml(fmtDateTime(startIso))}</div></div>
        <div class="row"><div class="label">Dönüş Tarihi/Saati</div><div class="value">${escapeHtml(fmtDateTime(returnIso))}</div></div>
        <div class="line"></div>
        <div class="row"><div class="label">Açıklama</div><div class="value">${escapeHtml(desc)}</div></div>
        <div class="line"></div>
        <div class="note">${escapeHtml(name)} kullanıcısı ${escapeHtml(fmtDateTime(startIso))} - ${escapeHtml(fmtDateTime(returnIso))} tarih aralığında izinlidir.</div>
        <div class="sign">
          <div class="signBox">Onaylayan (Yetkili) İmza</div>
          <div class="signBox">Talep Eden (Çalışan) İmza</div>
        </div>
      </div>
    </div>
    <script>
      window.onload = () => { setTimeout(() => window.print(), 250) }
    </script>
  </body>
</html>`

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.setAttribute('aria-hidden', 'true')
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (!doc || !iframe.contentWindow) {
      document.body.removeChild(iframe)
      showPopup('error', 'Hata', 'PDF oluşturulamadı')
      return
    }

    doc.open()
    doc.write(html)
    doc.close()

    const cleanup = () => {
      try {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
      } catch {
      }
    }

    const w = iframe.contentWindow
    w.onafterprint = () => {
      cleanup()
    }

    setTimeout(() => {
      try {
        w.focus()
        w.print()
      } catch {
        cleanup()
        showPopup('error', 'Hata', 'PDF oluşturulamadı')
      }
    }, 250)
  }

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')

  const employeeModalErrorRef = useRef<HTMLDivElement | null>(null)

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

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({})

  const [expandedSearchById, setExpandedSearchById] = useState<Record<string, string>>({})

  const [payments, setPayments] = useState<PaymentEntry[]>([])
  const [bonusPlans, setBonusPlans] = useState<BonusPlanEntry[]>([])
  const [mealPlans, setMealPlans] = useState<MealPlanEntry[]>([])

  const loadPaymentsAndPlans = async () => {
    try {
      const [p, plans, meals] = await Promise.all([fetchEmployeePayments({ take: 1000 }), fetchEmployeeBonusPlans({ take: 1000 }), fetchEmployeeMealPlans({ take: 1000 })])

      const mappedPayments: PaymentEntry[] = (p ?? []).map((x: any) => {
        const typeNum = Number(x?.type ?? 0)
        const kind: PaymentKind = typeNum === 1 ? 'salary' : typeNum === 2 ? 'bonus' : typeNum === 4 ? 'meal' : 'cashAdvance'
        return {
          id: Number(x?.id ?? 0),
          employeeId: Number(x?.employeeId ?? 0),
          kind,
          amount: Number(x?.amount ?? 0),
          description: String(x?.description ?? ''),
          paymentDate: String(x?.paymentDate ?? ''),
          deductFromSalary: Boolean(x?.deductFromSalary ?? false),
          salaryDeductedAt: x?.salaryDeductedAt ? String(x.salaryDeductedAt) : null,
          createdAt: String(x?.createTime ?? ''),
          createUser: String(x?.createUser ?? '')
        }
      })

      const mappedPlans: BonusPlanEntry[] = (plans ?? []).map((x: any) => ({
        id: Number(x?.id ?? 0),
        employeeId: Number(x?.employeeId ?? 0),
        plannedDate: String(x?.plannedDate ?? ''),
        amount: Number(x?.amount ?? 0),
        description: String(x?.description ?? ''),
        status: Number(x?.status ?? 0),
        createdAt: String(x?.createTime ?? ''),
        createUser: String(x?.createUser ?? '')
      }))

      const mappedMeals: MealPlanEntry[] = (meals ?? []).map((x: any) => ({
        id: Number(x?.id ?? 0),
        employeeId: Number(x?.employeeId ?? 0),
        plannedDate: String(x?.plannedDate ?? ''),
        amount: Number(x?.amount ?? 0),
        description: String(x?.description ?? ''),
        status: Number(x?.status ?? 0),
        createdAt: String(x?.createTime ?? ''),
        createUser: String(x?.createUser ?? '')
      }))

      setPayments(mappedPayments)
      setBonusPlans(mappedPlans)
      setMealPlans(mappedMeals)
    } catch {
      setPayments([])
      setBonusPlans([])
      setMealPlans([])
    }
  }

  const getPaymentsForEmployee = (employeeId: number) => {
    return payments
      .filter((p) => p.employeeId === employeeId)
      .slice()
      .sort((a, b) => String(b.paymentDate).localeCompare(String(a.paymentDate)) || Number(b.id) - Number(a.id))
  }

  const getPlansForEmployee = (employeeId: number) => {
    return bonusPlans
      .filter((p) => p.employeeId === employeeId)
      .slice()
      .sort((a, b) => String(b.plannedDate).localeCompare(String(a.plannedDate)) || Number(b.id) - Number(a.id))
  }

  const getMealPlansForEmployee = (employeeId: number) => {
    return mealPlans
      .filter((p) => p.employeeId === employeeId)
      .slice()
      .sort((a, b) => String(b.plannedDate).localeCompare(String(a.plannedDate)) || Number(b.id) - Number(a.id))
  }

  const fmtDateTime = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const date = d.toLocaleDateString('tr-TR')
    const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    return `${date} - ${time}`
  }

  const fmtDateOnly = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('tr-TR')
  }

  const fmtYmd = (iso?: string | null) => {
    const s = String(iso ?? '').trim()
    if (!s) return ''
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const formatIbanInput = (raw: string) => {
    const cleaned = String(raw ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')

    // IBAN uzunluğu ülkeye göre değişir: TR (ve KKTC'de kullanılan TR hesapları) 26 hane,
    // uluslararası IBAN 34 haneye kadar çıkabiliyor. 26'da kesmek yabancı bir IBAN'ı sessizce
    // bozuyordu — sınır standardın üst değerine çekildi, TR IBAN'da davranış değişmiyor.
    const compact = cleaned.slice(0, 34)
    const groups: string[] = []
    for (let i = 0; i < compact.length; i += 4) {
      groups.push(compact.slice(i, i + 4))
    }
    return groups.join(' ').trim()
  }

  const normalizeIbanForApi = (v: string) => {
    const cleaned = String(v ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')

    // IBAN 34 KARAKTERE KADAR OLABİLİR (denetim md. 10).
    //
    // Kırpma 26'daydı — Türkiye IBAN'ının uzunluğu. Yabancı IBAN'lar daha uzun (Fransa 27,
    // Malta 31) ve son haneleri sessizce kesiliyordu; yurt dışı bankası olan personelin maaş
    // transferi geçersiz IBAN yüzünden başarısız oluyordu. Veritabanı kolonu zaten 34.
    return cleaned.slice(0, 34)
  }

  const todayYmd = () => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const ymdFromDate = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const [cashAdvanceAmount, setCashAdvanceAmount] = useState('')
  const [cashAdvanceReason, setCashAdvanceReason] = useState('')
  const [cashAdvanceDate, setCashAdvanceDate] = useState(todayYmd())
  const [cashAdvanceDeductFromSalary, setCashAdvanceDeductFromSalary] = useState(true)

  const [advanceFormOpen, setAdvanceFormOpen] = useState(false)
  const [advanceFormEmployeeId, setAdvanceFormEmployeeId] = useState<number | null>(null)
  const [advanceFormEmployeeName, setAdvanceFormEmployeeName] = useState('')
  const [advanceFormAmount, setAdvanceFormAmount] = useState('')
  const [advanceFormReason, setAdvanceFormReason] = useState('')
  const [advanceFormDate, setAdvanceFormDate] = useState(todayYmd())
  const [advanceFormItems, setAdvanceFormItems] = useState<PaymentEntry[]>([])

  const [bonusPlanAmount, setBonusPlanAmount] = useState('')
  const [bonusPlanReason, setBonusPlanReason] = useState('')
  const [bonusPlanDate, setBonusPlanDate] = useState(todayYmd())

  const [mealPlanAmount, setMealPlanAmount] = useState('')
  const [mealPlanReason, setMealPlanReason] = useState('')
  const [mealPlanDate, setMealPlanDate] = useState(todayYmd())

  const [payEntryOpen, setPayEntryOpen] = useState(false)
  const [payEntryEmployeeId, setPayEntryEmployeeId] = useState<number | null>(null)
  const [payEntryEmployeeName, setPayEntryEmployeeName] = useState('')
  const [payEntryTab, setPayEntryTab] = useState<'bonus' | 'cashAdvance'>('cashAdvance')

  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaveEmployeeId, setLeaveEmployeeId] = useState<number | null>(null)
  const [leaveEmployeeName, setLeaveEmployeeName] = useState('')
  const [leaveStart, setLeaveStart] = useState('')
  const [leaveReturn, setLeaveReturn] = useState('')
  const [leaveDescription, setLeaveDescription] = useState('')
  const [leaveInlineError, setLeaveInlineError] = useState('')

  const [leaveFormOpen, setLeaveFormOpen] = useState(false)
  const [leaveFormEmployeeName, setLeaveFormEmployeeName] = useState('')
  const [leaveFormStart, setLeaveFormStart] = useState('')
  const [leaveFormReturn, setLeaveFormReturn] = useState('')
  const [leaveFormDescription, setLeaveFormDescription] = useState('')

  const [checkInsByEmployeeId, setCheckInsByEmployeeId] = useState<Record<string, any[]>>({})
  const [leavesByEmployeeId, setLeavesByEmployeeId] = useState<Record<string, any[]>>({})
  const [gocLoadingByEmployeeId, setGocLoadingByEmployeeId] = useState<Record<string, boolean>>({})

  // ── Face enrollment state ──
  const [faceModalOpen, setFaceModalOpen] = useState(false)
  const [faceEmployeeId, setFaceEmployeeId] = useState<number | null>(null)
  const [faceEmployeeName, setFaceEmployeeName] = useState('')
  const [faceCapturedImages, setFaceCapturedImages] = useState<string[]>([])
  const [faceHasExisting, setFaceHasExisting] = useState(false)
  const [faceExistingCount, setFaceExistingCount] = useState(0)
  const [faceSaving, setFaceSaving] = useState(false)
  const [faceConsentGiven, setFaceConsentGiven] = useState(false)
  const faceVideoRef = React.useRef<HTMLVideoElement>(null)
  const faceCanvasRef = React.useRef<HTMLCanvasElement>(null)
  const faceStreamRef = React.useRef<MediaStream | null>(null)
  const [faceCameraReady, setFaceCameraReady] = useState(false)
  /**
   * Akisin gercek en/boy orani. Kamera kutusuna sabit `maxHeight` verilmisti; kaynak
   * 4:3 iken kutu tasan kismi kirpiyor ve goruntunun alti (cene/omuz) kesiliyordu.
   * Kutuya akisin kendi oranini verince kirpma da esneme de kalkiyor.
   */
  const [faceVideoAspect, setFaceVideoAspect] = useState(4 / 3)

  const openFaceModal = async (empId: number, empName: string) => {
    setFaceEmployeeId(empId)
    setFaceEmployeeName(empName)
    setFaceCapturedImages([])
    setFaceConsentGiven(false)
    setFaceSaving(false)
    setFaceCameraReady(false)
    setFaceModalOpen(true)
    try {
      const res = await hasFaceEnrollment(empId)
      setFaceHasExisting(res.hasFace)
      setFaceExistingCount(res.count)
    } catch {
      setFaceHasExisting(false)
      setFaceExistingCount(0)
    }
  }

  // Camera start/stop for both face modal AND inline employee modal
  const shouldStartCamera = faceModalOpen || (modalOpen && faceConsentGiven)

  useEffect(() => {
    if (!shouldStartCamera) {
      faceStreamRef.current?.getTracks().forEach((t) => t.stop())
      faceStreamRef.current = null
      setFaceCameraReady(false)
      return
    }
    let cancelled = false
    /*
      DİNLEYİCİ TEMİZLİĞİ (denetim md. 11).

      `loadedmetadata` ve `resize` dinleyicileri ekleniyor ama kaldırılmıyordu; temizlik
      yalnız kamera akışını durduruyordu. Modal her açılıp kapandığında dinleyici birikiyor
      ve kapandıktan sonra tetiklenen çağrı sökülmüş bileşenin state'ini güncellemeye
      çalışıyordu. Sökülen dinleyiciler burada tutuluyor ve temizlikte kaldırılıyor.
    */
    const attachedListeners: Array<() => void> = []

    const startCam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        faceStreamRef.current = stream
        // Small delay to ensure video element is in DOM
        setTimeout(() => {
          if (faceVideoRef.current && !cancelled) {
            const video = faceVideoRef.current
            video.srcObject = stream
            video.play().catch(() => {})
            const syncAspect = () => {
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                setFaceVideoAspect(video.videoWidth / video.videoHeight)
              }
            }
            syncAspect()
            video.addEventListener('loadedmetadata', syncAspect)
            video.addEventListener('resize', syncAspect)
            attachedListeners.push(() => {
              video.removeEventListener('loadedmetadata', syncAspect)
              video.removeEventListener('resize', syncAspect)
            })
          }
        }, 100)
        setFaceCameraReady(true)
      } catch {
        setFaceCameraReady(false)
      }
    }
    void startCam()
    return () => {
      cancelled = true
      attachedListeners.forEach((remove) => remove())
      faceStreamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [shouldStartCamera])

  useEffect(() => {
    if (!faceConsentGiven) return
    const stream = faceStreamRef.current
    const video = faceVideoRef.current
    if (!stream || !video) return
    if (video.srcObject !== stream) {
      video.srcObject = stream
      video.play().catch(() => {})
    }
    setFaceCameraReady(true)
  }, [faceConsentGiven, faceModalOpen, modalOpen])

  const captureFaceFrame = () => {
    const video = faceVideoRef.current
    const canvas = faceCanvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth || 480
    canvas.height = video.videoHeight || 360
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    const b64 = canvas.toDataURL('image/jpeg', 0.85)
    setFaceCapturedImages((prev) => {
      if (prev.length >= 5) return prev
      return [...prev, b64]
    })
  }

  const handleFaceEnroll = async () => {
    if (!faceEmployeeId || faceCapturedImages.length < 1 || !faceConsentGiven) return
    try {
      setFaceSaving(true)
      await enrollFace(faceEmployeeId, faceCapturedImages)
      showPopup('success', 'Başarılı', `${faceEmployeeName} için ${faceCapturedImages.length} yüz kaydı oluşturuldu`)
      setFaceModalOpen(false)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Yüz kaydı oluşturulamadı'))
    } finally {
      setFaceSaving(false)
    }
  }

  const handleFaceDelete = async () => {
    if (!faceEmployeeId) return
    try {
      setFaceSaving(true)
      const res = await deleteFaceEnrollment(faceEmployeeId)
      showPopup('success', 'Başarılı', `${res.deletedCount} yüz kaydı silindi`)
      setFaceHasExisting(false)
      setFaceExistingCount(0)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Yüz kaydı silinemedi'))
    } finally {
      setFaceSaving(false)
    }
  }

  const loadGoCForEmployee = async (employeeId: number) => {
    const key = String(employeeId)
    try {
      setGocLoadingByEmployeeId((p) => ({ ...p, [key]: true }))
      const [ci, lv] = await Promise.all([fetchEmployeeCheckInsByEmployee(employeeId, { take: 2000 }), fetchEmployeeLeavesByEmployee(employeeId, { take: 2000 })])
      setCheckInsByEmployeeId((p) => ({ ...p, [key]: ci ?? [] }))
      setLeavesByEmployeeId((p) => ({ ...p, [key]: lv ?? [] }))
    } catch {
      setCheckInsByEmployeeId((p) => ({ ...p, [key]: [] }))
      setLeavesByEmployeeId((p) => ({ ...p, [key]: [] }))
    } finally {
      setGocLoadingByEmployeeId((p) => ({ ...p, [key]: false }))
    }
  }

  const buildGoCDays = (employeeId: number) => {
    const key = String(employeeId)
    const checkIns = (checkInsByEmployeeId[key] ?? []) as any[]
    const leaves = (leavesByEmployeeId[key] ?? []) as any[]

    const days = new Set<string>()

    for (const c of checkIns) {
      const d = new Date(String(c?.checkInTime ?? ''))
      if (!Number.isNaN(d.getTime())) days.add(ymdFromDate(d))
    }

    for (const l of leaves) {
      const s = new Date(String(l?.leaveStartTime ?? ''))
      const e = new Date(String(l?.returnTime ?? ''))
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue
      const cur = new Date(s)
      cur.setHours(0, 0, 0, 0)
      const end = new Date(e)
      end.setHours(0, 0, 0, 0)
      while (cur.getTime() <= end.getTime()) {
        days.add(ymdFromDate(cur))
        cur.setDate(cur.getDate() + 1)
      }
    }

    return Array.from(days).sort((a, b) => b.localeCompare(a))
  }

  const openAdvanceFormFromLatestPayment = (employeeId: number) => {
    const emp = rows.find((r) => r.id === employeeId)
    const employeeName = emp ? `${String(emp.firstName ?? '').trim()} ${String(emp.lastName ?? '').trim()}`.trim() : ''
    const items = getPaymentsForEmployee(employeeId).filter((p) => p.kind === 'cashAdvance')
    if (items.length === 0) {
      showPopup('info', 'Bilgi', 'Bu çalışan için avans kaydı bulunamadı')
      return
    }

    setAdvanceFormEmployeeId(employeeId)
    setAdvanceFormEmployeeName(employeeName || '-')
    setAdvanceFormItems(items)
    setAdvanceFormOpen(true)
  }

  const openAdvanceFormFromInputs = (employeeId: number, amount: number, reason: string, plannedYmd: string) => {
    const emp = rows.find((r) => r.id === employeeId)
    const employeeName = emp ? `${String(emp.firstName ?? '').trim()} ${String(emp.lastName ?? '').trim()}`.trim() : ''
    setAdvanceFormEmployeeId(employeeId)
    setAdvanceFormEmployeeName(employeeName || '-')
    setAdvanceFormAmount(String(amount))
    setAdvanceFormReason(String(reason ?? ''))
    setAdvanceFormDate(plannedYmd || todayYmd())
    setAdvanceFormOpen(true)
  }

  const escapeHtml = (s: string) => {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  const printAdvanceForm = (item: { employeeName: string; amount: number; dateYmd: string; reason: string }) => {
    const name = item.employeeName || '-'
    const amount = Math.max(0, Math.trunc(Number(item.amount || 0) || 0))
    const date = item.dateYmd || todayYmd()
    const reason = item.reason || ''
    const now = new Date()
    const printedAt = now.toLocaleString('tr-TR')

    const html = `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Avans Formu</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; padding: 32px; color: #111827; }
      .wrap { max-width: 760px; margin: 0 auto; }
      .title { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
      .subtitle { font-size: 12px; color: #6B7280; margin-bottom: 20px; }
      .card { border: 1px solid #E5E7EB; border-radius: 12px; padding: 18px; }
      .row { display: flex; gap: 12px; margin-bottom: 10px; }
      .label { width: 160px; font-size: 12px; font-weight: 700; color: #374151; }
      .value { flex: 1; font-size: 13px; color: #111827; }
      .line { height: 1px; background: #E5E7EB; margin: 16px 0; }
      .note { font-size: 12px; color: #374151; white-space: pre-wrap; }
      .sign { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
      .signBox { border-top: 1px solid #9CA3AF; padding-top: 10px; font-size: 12px; color: #374151; }
      @media print {
        body { padding: 0; }
        .card { border: none; padding: 0; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="title">Avans Formu</div>
      <div class="subtitle">Yazdırma Tarihi: ${escapeHtml(printedAt)}</div>
      <div class="card">
        <div class="row"><div class="label">Çalışan</div><div class="value">${escapeHtml(name)}</div></div>
        <div class="row"><div class="label">Tarih</div><div class="value">${escapeHtml(date)}</div></div>
        <div class="row"><div class="label">Tutar</div><div class="value">${escapeHtml(amount.toLocaleString('tr-TR'))} ₺</div></div>
        <div class="line"></div>
        <div class="row"><div class="label">Açıklama</div><div class="value">${escapeHtml(reason)}</div></div>
        <div class="line"></div>
        <div class="note">${escapeHtml(name)} kullanıcısı ${escapeHtml(date)} tarihinde ${escapeHtml(amount.toLocaleString('tr-TR'))} ₺ tutarında avans almıştır.</div>
        <div class="sign">
          <div class="signBox">Teslim Eden (Yetkili) İmza</div>
          <div class="signBox">Teslim Alan (Çalışan) İmza</div>
        </div>
      </div>
    </div>
    <script>
      window.onload = () => { setTimeout(() => window.print(), 250) }
    </script>
  </body>
</html>`

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.setAttribute('aria-hidden', 'true')
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (!doc || !iframe.contentWindow) {
      document.body.removeChild(iframe)
      showPopup('error', 'Hata', 'PDF oluşturulamadı')
      return
    }

    doc.open()
    doc.write(html)
    doc.close()

    const cleanup = () => {
      try {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
      } catch {
        // ignore
      }
    }

    const w = iframe.contentWindow
    w.onafterprint = () => {
      cleanup()
    }

    setTimeout(() => {
      try {
        w.focus()
        w.print()
      } catch {
        cleanup()
        showPopup('error', 'Hata', 'PDF oluşturulamadı')
      }
    }, 250)
  }

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
      const data = await fetchEmployees({ includeInactive: true })
      setRows((data ?? []).map((x) => ({ ...x, actions: '' })))
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

  useEffect(() => {
    void loadPaymentsAndPlans()
  }, [])

  const toggleExpand = (employeeId: number) => {
    const k = String(employeeId)
    setExpandedById((p) => ({ ...p, [k]: !p[k] }))
  }

  const setExpandedSearch = (employeeId: number, value: string) => {
    const k = String(employeeId)
    setExpandedSearchById((p) => ({ ...p, [k]: value }))
  }

  const clampSalaryDay = (salaryDay: number, year: number, monthIndex: number) => {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate()
    return Math.min(Math.max(1, salaryDay || 1), lastDay)
  }

  const computeNextDueFromLastPayment = (lastPaymentIso: string, salaryDay: number) => {
    const last = new Date(lastPaymentIso)
    if (Number.isNaN(last.getTime())) return null
    const y = last.getFullYear()
    const m = last.getMonth()
    const nextMonth = new Date(y, m + 1, 1)
    const day = clampSalaryDay(Number(salaryDay || 1), nextMonth.getFullYear(), nextMonth.getMonth())
    return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), day, 0, 0, 0)
  }

  const getLastSalaryPaymentIso = (employeeId: number) => {
    const list = getPaymentsForEmployee(employeeId)
    const last = list.find((p) => p.kind === 'salary')
    return last ? String(last.paymentDate) : ''
  }

  const isPaidThisMonth = (employeeId: number) => {
    const iso = getLastSalaryPaymentIso(employeeId)
    if (!iso) return false
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return false
    const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }

  const isGreenRow = (row: Row) => {
    const lastIso = getLastSalaryPaymentIso(row.id)
    if (!lastIso) return false
    const last = new Date(lastIso)
    if (Number.isNaN(last.getTime())) return false
    const nextDue = computeNextDueFromLastPayment(lastIso, Number(row.salaryDay ?? 1))
    if (!nextDue) return false

    const start = new Date(last)
    start.setHours(0, 0, 0, 0)

    const end = new Date(nextDue)
    end.setDate(end.getDate() - 1)
    end.setHours(23, 59, 59, 999)

    const now = new Date()
    return now.getTime() >= start.getTime() && now.getTime() <= end.getTime()
  }

  const groupPaymentsByMonthYear = (list: PaymentEntry[]) => {
    const groups: Record<string, PaymentEntry[]> = {}
    for (const p of list) {
      const d = new Date(p.paymentDate)
      const key = Number.isNaN(d.getTime()) ? 'Geçersiz Tarih' : `${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
      if (!groups[key]) groups[key] = []
      groups[key].push(p)
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
  }

  const fmtMonthYearLabel = (year: number, monthIndex: number) => {
    const d = new Date(year, monthIndex, 1)
    return d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
  }

  const filteredRows = useMemo(() => {
    const wantActive = activeFilter === 'active'
    const q = globalSearch.trim().toLowerCase()
    const list = (rows ?? []).filter((r) => Boolean((r as any)?.isActive) === wantActive)

    const start = topFilterFrom ? new Date(`${topFilterFrom}T00:00:00`) : null
    const end = topFilterTo ? new Date(`${topFilterTo}T23:59:59`) : null

    const inRange = (iso: string) => {
      const d = new Date(String(iso ?? ''))
      if (Number.isNaN(d.getTime())) return false
      if (start && d.getTime() < start.getTime()) return false
      if (end && d.getTime() > end.getTime()) return false
      return true
    }

    const matchOneFilter = (filter: TopQuickFilter, employeeId: number) => {
      if (filter === 'bonusPlanned') {
        return getPlansForEmployee(employeeId).some((p) => p.status === 1 && inRange(p.plannedDate))
      }

      const kinds: PaymentKind[] =
        filter === 'salaryPaid'
          ? ['salary']
          : filter === 'mealPaid'
            ? ['meal']
            : filter === 'bonusPaid'
              ? ['bonus']
              : ['cashAdvance']

      return getPaymentsForEmployee(employeeId).some((p) => kinds.includes(p.kind) && inRange(p.paymentDate))
    }

    const matchesQuickFilters = (employeeId: number) => {
      if (topQuickFilters.size === 0) return true
      for (const f of topQuickFilters) {
        if (!matchOneFilter(f, employeeId)) return false
      }
      return true
    }

    const withQuick = list.filter((r) => matchesQuickFilters(r.id))
    if (!q) return withQuick
    return withQuick.filter((r) => {
      return (
        String(r.firstName ?? '').toLowerCase().includes(q) ||
        String(r.lastName ?? '').toLowerCase().includes(q) ||
        String(r.mail ?? '').toLowerCase().includes(q) ||
        String(r.tc ?? '').toLowerCase().includes(q) ||
        String(r.phone ?? '').toLowerCase().includes(q) ||
        String(r.taxNo ?? '').toLowerCase().includes(q) ||
        String(r.taxOffice ?? '').toLowerCase().includes(q)
      )
    })
  }, [activeFilter, globalSearch, rows, topFilterFrom, topFilterTo, topQuickFilters, payments, bonusPlans])

  const quickFilterCounts = useMemo(() => {
    const wantActive = activeFilter === 'active'
    const list = (rows ?? []).filter((r) => Boolean((r as any)?.isActive) === wantActive)

    const start = topFilterFrom ? new Date(`${topFilterFrom}T00:00:00`) : null
    const end = topFilterTo ? new Date(`${topFilterTo}T23:59:59`) : null
    const inRange = (iso: string) => {
      const d = new Date(String(iso ?? ''))
      if (Number.isNaN(d.getTime())) return false
      if (start && d.getTime() < start.getTime()) return false
      if (end && d.getTime() > end.getTime()) return false
      return true
    }

    const out = {
      salaryPaid: 0,
      mealPaid: 0,
      bonusPaid: 0,
      bonusPlanned: 0,
      cashAdvancePaid: 0
    }

    for (const r of list) {
      const id = r.id
      const pay = getPaymentsForEmployee(id)
      if (pay.some((p) => p.kind === 'salary' && inRange(p.paymentDate))) out.salaryPaid++
      if (pay.some((p) => p.kind === 'meal' && inRange(p.paymentDate))) out.mealPaid++
      if (pay.some((p) => p.kind === 'bonus' && inRange(p.paymentDate))) out.bonusPaid++
      if (pay.some((p) => p.kind === 'cashAdvance' && inRange(p.paymentDate))) out.cashAdvancePaid++
      if (getPlansForEmployee(id).some((p) => p.status === 1 && inRange(p.plannedDate))) out.bonusPlanned++
    }

    return out
  }, [activeFilter, rows, topFilterFrom, topFilterTo, payments, bonusPlans])

  const [visibleRows, setVisibleRows] = useState<Row[]>([])

  const openCreateModal = () => {
    setModalError(null)
    setModalMode('create')
    setEditId(null)
    const today = todayYmd()
    setForm({ ...emptyForm, hireDate: today, workPermitDay: today })
    setFaceCapturedImages([])
    setFaceConsentGiven(false)
    setModalOpen(true)
  }

  const openEditModal = (row: Row) => {
    setModalError(null)
    setModalMode('edit')
    setEditId(row.id)
    setForm({
      employeeCode: String(row.employeeCode ?? ''),
      username: String((row as any).username ?? ''),
      // Sifre alani duzenlemede DAIMA bos acilir.
      //
      // Burasi listeden gelen degeri dolduruyordu; liste ucu da sifre HASH'ini donduruyordu.
      // Sonuc: kaydete basinca hash'in hash'i yaziliyor ve personel bir daha giris yapamiyordu.
      // Bos birakilan sifre sunucu tarafinda "degistirme" anlamina gelir.
      password: '',
      firstName: String(row.firstName ?? ''),
      lastName: String(row.lastName ?? ''),
      mail: String(row.mail ?? ''),
      tc: String(row.tc ?? ''),
      phone: String(row.phone ?? ''),
      taxNo: String(row.taxNo ?? ''),
      taxOffice: String(row.taxOffice ?? ''),
      bankName: String((row as any).bankName ?? ''),
      iban: formatIbanInput(String((row as any).iban ?? '')),
      hireDate: fmtYmd((row as any).hireDate ?? null),
      workPermitDay: fmtYmd((row as any).workPermitDay ?? null),
      salary: String(row.salary ?? 0),
      salaryDay: String(row.salaryDay ?? 1),
      mealAmount: String((row as any).mealAmount ?? 0),
      isActive: Boolean(row.isActive)
    })
    setFaceCapturedImages([])
    setFaceConsentGiven(false)
    setModalOpen(true)
  }

  useEffect(() => {
    if (!modalOpen) return
    if (modalMode !== 'create') return

    const ac = new AbortController()
    void (async () => {
      try {
        const code = await fetchNextEmployeeCode({ signal: ac.signal })
        setForm((p) => ({ ...p, employeeCode: code }))
      } catch {
      }
    })()
    return () => ac.abort()
  }, [modalMode, modalOpen])

  useEffect(() => {
    if (!modalOpen) return
    if (!modalError) return
    employeeModalErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [modalError, modalOpen])

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
  }

  const submitModal = async () => {
    try {
      setSaving(true)
      setModalError(null)

      const payload = {
        employeeCode: form.employeeCode.trim() || undefined,
        username: form.username.trim() || null,
        password: form.password.trim() || null,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        mail: form.mail.trim(),
        tc: form.tc.trim(),
        phone: form.phone.trim(),
        taxNo: form.taxNo.trim(),
        taxOffice: form.taxOffice.trim(),
        bankName: form.bankName.trim(),
        iban: form.iban && form.iban.trim() ? normalizeIbanForApi(form.iban) : undefined,
        hireDate: form.hireDate && form.hireDate.trim() ? new Date(`${form.hireDate.trim()}T00:00:00`).toISOString() : null,
        workPermitDay: form.workPermitDay && form.workPermitDay.trim() ? new Date(`${form.workPermitDay.trim()}T00:00:00`).toISOString() : null,
        salary: Math.max(0, parseMoneyInput(form.salary)),
        salaryDay: Math.min(31, Math.max(1, Math.trunc(Number(String(form.salaryDay ?? '1').trim()) || 1))),
        mealAmount: Math.max(0, parseMoneyInput(form.mealAmount)),
        isActive: form.isActive
      }

      if (!payload.firstName || !payload.lastName || !payload.mail || !payload.tc) {
        setModalError('Lütfen zorunlu alanları doldurun')
        return
      }

      if (payload.mail && !payload.mail.includes('@')) {
        setModalError('Geçerli bir email adresi giriniz')
        return
      }

      if (payload.tc.length !== 11) {
        setModalError('TC Kimlik Numarası 11 haneli olmalıdır.')
        return
      }

      if (payload.phone && !PHONE_PATTERN.test(payload.phone)) {
        setModalError(PHONE_FORMAT_MESSAGE)
        return
      }

      let createdEmployeeId: number | null = null

      if (modalMode === 'create') {
        const result = await createEmployee(payload as any)
        createdEmployeeId = result?.data?.id ?? null
      } else {
        if (!editId) {
          setModalError('Çalışan id bulunamadı')
          return
        }
        await updateEmployee(editId, payload as any)
        createdEmployeeId = editId
      }

      // Auto-enroll face if photos were captured with consent
      if (faceConsentGiven && faceCapturedImages.length > 0 && createdEmployeeId) {
        try {
          await enrollFace(createdEmployeeId, faceCapturedImages)
        } catch (faceErr: any) {
          console.warn('Face enrollment failed:', faceErr)
          // Don't block employee creation, just warn
        }
      }

      setModalOpen(false)
      await loadRows({ background: true })
      const faceMsg = (faceConsentGiven && faceCapturedImages.length > 0) ? ` + ${faceCapturedImages.length} yüz kaydı` : ''
      showPopup('success', 'Başarılı', (modalMode === 'create' ? 'Çalışan oluşturuldu' : 'Çalışan güncellendi') + faceMsg)
    } catch (e: any) {
      const msg = employeeFriendlyApiErrorMessage(e, 'Bir hata oluştu')
      setModalError(msg)
      showPopup('error', 'Hata', msg)
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (row: Row) => {
    setConfirmText(`${row.firstName} ${row.lastName} çalışanını işten çıkarmak istediğinize emin misiniz?`)
    setConfirmAction({ kind: 'deleteEmployee', employeeId: row.id })
    setConfirmOpen(true)
  }

  const onActivate = async (row: Row) => {
    setConfirmText(`${row.firstName} ${row.lastName} çalışanını işe geri almak istediğinize emin misiniz?`)
    setConfirmAction({ kind: 'activateEmployee', employeeId: row.id })
    setConfirmOpen(true)
  }

  const onHardDelete = async (row: Row) => {
    setConfirmText(`${row.firstName} ${row.lastName} çalışanını ve tüm kayıtlarını kalıcı olarak silmek istediğinize emin misiniz?`)
    setConfirmAction({ kind: 'hardDeleteEmployee', employeeId: row.id })
    setConfirmOpen(true)
  }

  const columns: TableColumn<Row>[] = useMemo(
    () => [
      {
        key: 'id',
        label: '',
        render: (_v, row) => (
          <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => toggleExpand(row.id)}
              className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-gray-100 text-gray-700 mr-1"
              title={expandedById[String(row.id)] ? 'Kapat' : 'Detay'}
            >
              {expandedById[String(row.id)] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            <input
              type="checkbox"
              checked={selectedIds.has(row.id)}
              onChange={(e) => {
                const checked = e.target.checked
                setSelectedIds((prev) => {
                  const next = new Set(prev)
                  if (checked) next.add(row.id)
                  else next.delete(row.id)
                  return next
                })
              }}
            />
          </div>
        )
      },
      { key: 'employeeCode', label: 'Kodu', searchable: true },
      { key: 'firstName', label: 'İsim', searchable: true },
      { key: 'lastName', label: 'Soyisim', searchable: true },
      { key: 'mail', label: 'Mail', searchable: true },
      { key: 'tc', label: 'TC', searchable: true },
      { key: 'phone', label: 'Telefon', searchable: true },
      { key: 'taxNo', label: 'Vergi No', searchable: true },
      { key: 'taxOffice', label: 'Vergi Dairesi', searchable: true },
      { key: 'bankName', label: 'Banka Adı', searchable: true },
      { key: 'iban', label: 'IBAN', searchable: true },
      {
        key: 'hireDate',
        label: 'Giriş Tarihi',
        searchable: true,
        render: (v) => {
          const s = String(v ?? '').trim()
          if (!s) return ''
          return fmtDateOnly(s)
        }
      },
      { key: 'salary', label: 'Maaşı', searchable: true },
      { key: 'salaryDay', label: 'Maaş Günü', searchable: true },
      {
        key: 'isActive',
        label: 'Aktif',
        searchable: true,
        render: (v) => (Boolean(v) ? 'Evet' : 'Hayır')
      },
      {
        key: 'actions',
        label: '',
        render: (_value, row) => (
          <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
            <ActionDropdown>
              <div className="py-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    openEditModal(row)
                  }}
                  className="w-full px-3 py-2 text-left text-[12px] font-normal rounded-md transition flex items-center justify-between text-gray-700 hover:bg-gray-50"
                >
                  <span className="truncate">Düzenle</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setInfoEmployeeId(row.id)
                    setInfoYear(null)
                    setInfoOpenMonths({})
                    setInfoOpen(true)
                  }}
                  className="w-full px-3 py-2 text-left text-[12px] font-semibold rounded-md transition flex items-center justify-between text-gray-700 hover:bg-gray-50"
                >
                  <span className="truncate">Bilgi</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const employeeName = `${String(row.firstName ?? '').trim()} ${String(row.lastName ?? '').trim()}`.trim()
                    setStatusEmployeeId(row.id)
                    setStatusEmployeeName(employeeName)
                    const now = new Date()
                    setStatusMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
                    setStatusSelectedYmd('')
                    setStatusShowLeaveDays(false)
                    setStatusOpen(true)
                    void loadGoCForEmployee(row.id)
                  }}
                  className="w-full px-3 py-2 text-left text-[12px] font-semibold rounded-md transition flex items-center justify-between text-gray-700 hover:bg-gray-50"
                >
                  <span className="truncate">Durum / Takvim</span>
                </button>

                {Boolean((row as any)?.isActive) ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const employeeName = `${String(row.firstName ?? '').trim()} ${String(row.lastName ?? '').trim()}`.trim()
                        setPayEntryEmployeeId(row.id)
                        setPayEntryEmployeeName(employeeName)
                        setPayEntryTab('cashAdvance')
                        setCashAdvanceAmount('')
                        setCashAdvanceReason('')
                        setCashAdvanceDate(todayYmd())
                        setCashAdvanceDeductFromSalary(true)
                        setBonusPlanAmount('')
                        setBonusPlanReason('')
                        setBonusPlanDate(todayYmd())
                        setPayEntryOpen(true)
                      }}
                      className="w-full px-3 py-2 text-left text-[12px] font-semibold rounded-md transition flex items-center justify-between text-gray-700 hover:bg-gray-50"
                    >
                      <span className="truncate">Ödeme</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openAdvanceFormFromLatestPayment(row.id)
                      }}
                      className="w-full px-3 py-2 text-left text-[12px] font-semibold rounded-md transition flex items-center justify-between text-gray-700 hover:bg-gray-50"
                    >
                      <span className="truncate">Avans Formu</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const employeeName = `${String(row.firstName ?? '').trim()} ${String(row.lastName ?? '').trim()}`.trim()
                        const now = new Date()
                        const start = fmtLocalDateTimeInput(now)
                        const ret = fmtLocalDateTimeInput(new Date(now.getTime() + 60 * 60 * 1000))
                        setLeaveEmployeeId(row.id)
                        setLeaveEmployeeName(employeeName)
                        setLeaveStart(start)
                        setLeaveReturn(ret)
                        setLeaveDescription('')
                        setLeaveInlineError('')
                        setLeaveOpen(true)
                      }}
                      className="w-full px-3 py-2 text-left text-[12px] font-semibold rounded-md transition flex items-center justify-between text-gray-700 hover:bg-gray-50"
                    >
                      <span className="truncate">İzin İste</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const employeeName = `${String(row.firstName ?? '').trim()} ${String(row.lastName ?? '').trim()}`.trim()
                        void openFaceModal(row.id, employeeName)
                      }}
                      className="w-full px-3 py-2 text-left text-[12px] font-semibold rounded-md transition flex items-center justify-between text-blue-700 hover:bg-blue-50"
                    >
                      <span className="truncate">📷 Yüz Kaydı</span>
                    </button>
                  </>
                ) : null}

                {Boolean((row as any)?.isActive) ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void onDelete(row)
                    }}
                    className="w-full px-3 py-2 text-left text-[12px] font-semibold rounded-md transition flex items-center justify-between text-rose-700 hover:bg-rose-50"
                  >
                    <span className="truncate">İşten Çıkar</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onActivate(row)
                      }}
                      className="w-full px-3 py-2 text-left text-[12px] font-semibold rounded-md transition flex items-center justify-between text-emerald-700 hover:bg-emerald-50"
                    >
                      <span className="truncate">İşe Geri Al</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onHardDelete(row)
                      }}
                      className="w-full px-3 py-2 text-left text-[12px] font-semibold rounded-md transition flex items-center justify-between text-red-700 hover:bg-red-50"
                    >
                      <span className="truncate">Sil</span>
                    </button>
                  </>
                )}
              </div>
            </ActionDropdown>
          </div>
        )
      }
    ],
    [expandedById, selectedIds]
  )

  const allSelected = useMemo(() => {
    if (!visibleRows.length) return false
    return visibleRows.every((r) => selectedIds.has(r.id))
  }, [selectedIds, visibleRows])

  const [paySourceOpen, setPaySourceOpen] = useState(false)
  const [paySourceBusy, setPaySourceBusy] = useState(false)
  const [paySourceType, setPaySourceType] = useState<'bank' | 'cash'>('bank')
  const [paySourceAccountId, setPaySourceAccountId] = useState('')
  const [paySourceKind, setPaySourceKind] = useState<'bulkSalary' | 'bulkAll' | 'bulkBonus' | 'bulkMeal'>('bulkAll')
  const [paySourceBanks, setPaySourceBanks] = useState<BankAccountDefinitionDto[]>([])
  const [paySourceCashes, setPaySourceCashes] = useState<CashAccountDto[]>([])
  const [paySourceWarning, setPaySourceWarning] = useState('')

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [confirmAction, setConfirmAction] = useState<
    | null
    | { kind: 'bulkSalary' }
    | { kind: 'bulkBonus' }
    | { kind: 'bulkMeal' }
    | { kind: 'bulkAll' }
    | { kind: 'undoSalaryPayment'; paymentId: number }
    | { kind: 'undoCashAdvancePayment'; paymentId: number }
    | { kind: 'undoMealPayment'; paymentId: number }
    | { kind: 'cancelBonusPlan'; planId: number }
    | { kind: 'undoPaidBonusPlan'; planId: number }
    | { kind: 'cancelMealPlan'; planId: number }
    | { kind: 'undoPaidMealPlan'; planId: number }
    | { kind: 'deleteEmployeeLeave'; employeeId: number; leaveId: number }
    | { kind: 'deleteEmployee'; employeeId: number }
    | { kind: 'activateEmployee'; employeeId: number }
    | { kind: 'hardDeleteEmployee'; employeeId: number }
    | { kind: 'deleteEmployeeCheckIn'; employeeId: number; checkInId: number }
    | { kind: 'deleteEmployeeCheckInDay'; employeeId: number; ymd: string }
  >(null)

  const [infoOpen, setInfoOpen] = useState(false)
  const [infoEmployeeId, setInfoEmployeeId] = useState<number | null>(null)
  const [infoOpenMonths, setInfoOpenMonths] = useState<Record<string, boolean>>({})
  const [infoYear, setInfoYear] = useState<number | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [statusEmployeeId, setStatusEmployeeId] = useState<number | null>(null)
  const [statusEmployeeName, setStatusEmployeeName] = useState('')
  const [statusMonth, setStatusMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [statusSelectedYmd, setStatusSelectedYmd] = useState<string>('')
  const [statusShowLeaveDays, setStatusShowLeaveDays] = useState(false)

  const [statusTimeModalOpen, setStatusTimeModalOpen] = useState(false)
  const [statusTimeModalKind, setStatusTimeModalKind] = useState<null | 'addEntry' | 'addExit' | 'editEntry' | 'editExit'>(null)
  const [statusTimeModalTime, setStatusTimeModalTime] = useState('09:00')
  const [statusTimeModalCheckInId, setStatusTimeModalCheckInId] = useState<number | null>(null)

  const [workNowOpen, setWorkNowOpen] = useState(false)
  const [workNowBusy, setWorkNowBusy] = useState(false)
  const [workNowFrom, setWorkNowFrom] = useState('')
  const [workNowTo, setWorkNowTo] = useState('')
  const [workNowTab, setWorkNowTab] = useState<'now' | 'range'>('now')
  const [workNowNowFilter, setWorkNowNowFilter] = useState<'all' | 'at' | 'notAt'>('all')
  const [workNowSearchNow, setWorkNowSearchNow] = useState('')
  const [workNowSearchRange, setWorkNowSearchRange] = useState('')

  const getDayItemsForEmployee = (employeeId: number, ymd: string) => {
    const key = String(employeeId)
    const list = (checkInsByEmployeeId[key] ?? []) as any[]
    const start = new Date(`${ymd}T00:00:00`)
    const end = new Date(`${ymd}T23:59:59`)
    return list
      .filter((x) => {
        const t = new Date(String(x?.checkInTime ?? ''))
        if (Number.isNaN(t.getTime())) return false
        return t.getTime() >= start.getTime() && t.getTime() <= end.getTime()
      })
      .slice()
      .sort((a, b) => String(a?.checkInTime ?? '').localeCompare(String(b?.checkInTime ?? '')) || Number(a?.id ?? 0) - Number(b?.id ?? 0))
  }

  const getLeavesForEmployeeInDay = (employeeId: number, ymd: string) => {
    const key = String(employeeId)
    const list = (leavesByEmployeeId[key] ?? []) as any[]
    const start = new Date(`${ymd}T00:00:00`)
    const end = new Date(`${ymd}T23:59:59`)
    return list.filter((x) => {
      const s = new Date(String(x?.leaveStartTime ?? ''))
      const e = new Date(String(x?.returnTime ?? ''))
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return false
      return s.getTime() <= end.getTime() && e.getTime() >= start.getTime()
    })
  }

  const isAtWorkNow = (employeeId: number) => {
    const items = getDayItemsForEmployee(employeeId, todayYmd())
    if (items.length === 0) return false
    return items.length % 2 === 1
  }

  const workNowCounts = useMemo(() => {
    const list = (rows ?? []).filter((r) => Boolean((r as any)?.isActive))
    let at = 0
    let notAt = 0
    for (const r of list) {
      if (isAtWorkNow(r.id)) at++
      else notAt++
    }
    return { at, notAt }
  }, [rows, checkInsByEmployeeId])

  const ensureGoCLoadedForEmployees = async (employeeIds: number[]) => {
    const missing = employeeIds.filter((id) => !Array.isArray(checkInsByEmployeeId[String(id)]) || !Array.isArray(leavesByEmployeeId[String(id)]))
    if (missing.length === 0) return
    setWorkNowBusy(true)
    try {
      await Promise.allSettled(missing.map((id) => loadGoCForEmployee(id)))
    } finally {
      setWorkNowBusy(false)
    }
  }

  useEffect(() => {
    const activeIds = (rows ?? []).filter((r) => Boolean((r as any)?.isActive)).map((r) => r.id)
    if (activeIds.length === 0) return
    void ensureGoCLoadedForEmployees(activeIds)
  }, [rows])

  const getRangeStatsForEmployee = (employeeId: number) => {
    if (!workNowFrom || !workNowTo) return null
    const start = new Date(`${workNowFrom}T00:00:00`)
    const end = new Date(`${workNowTo}T23:59:59`)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
    if (start.getTime() > end.getTime()) return null

    let worked = 0
    let notWorked = 0
    let leave = 0

    const d = new Date(start)
    while (d.getTime() <= end.getTime()) {
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const leaves = getLeavesForEmployeeInDay(employeeId, ymd)
      if (leaves.length > 0) {
        leave++
      } else {
        const items = getDayItemsForEmployee(employeeId, ymd)
        if (items.length > 0) worked++
        else notWorked++
      }
      d.setDate(d.getDate() + 1)
    }

    return { worked, notWorked, leave }
  }

  const buildMonthKeysForEmployee = (employeeId: number) => {
    const out: Array<{ key: string; year: number; monthIndex: number; label: string }> = []

    const now = new Date()
    const employee = rows.find((r) => r.id === employeeId)

    const createTimeIso = String(employee?.createTime ?? '')
    const createdAt = createTimeIso ? new Date(createTimeIso) : null
    const createdMonthStart = createdAt && !Number.isNaN(createdAt.getTime()) ? new Date(createdAt.getFullYear(), createdAt.getMonth(), 1) : null

    const latestPlan = getPlansForEmployee(employeeId)
      .slice()
      .sort((a, b) => String(b.plannedDate).localeCompare(String(a.plannedDate)) || Number(b.id) - Number(a.id))[0]

    const latestPlanDate = latestPlan?.plannedDate ? new Date(latestPlan.plannedDate) : null

    const endMonthStart = (() => {
      const base = new Date(now.getFullYear(), now.getMonth(), 1)
      if (!latestPlanDate || Number.isNaN(latestPlanDate.getTime())) return base
      const planMonth = new Date(latestPlanDate.getFullYear(), latestPlanDate.getMonth(), 1)
      return planMonth.getTime() > base.getTime() ? planMonth : base
    })()

    for (let i = 0; i < 12; i++) {
      const d = new Date(endMonthStart.getFullYear(), endMonthStart.getMonth() - i, 1)
      if (createdMonthStart && d.getTime() < createdMonthStart.getTime()) break
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      out.push({ key, year: d.getFullYear(), monthIndex: d.getMonth(), label: fmtMonthYearLabel(d.getFullYear(), d.getMonth()) })
    }

    return out
  }

  const getInfoYearsForEmployee = (employeeId: number) => {
    const yearSet = new Set<number>()

    for (const p of getPaymentsForEmployee(employeeId)) {
      const d = new Date(p.paymentDate)
      if (Number.isNaN(d.getTime())) continue
      yearSet.add(d.getFullYear())
    }

    for (const plan of getPlansForEmployee(employeeId)) {
      const d = new Date(plan.plannedDate)
      if (Number.isNaN(d.getTime())) continue
      yearSet.add(d.getFullYear())
    }

    return Array.from(yearSet).sort((a, b) => b - a)
  }

  const getPaymentsForEmployeeMonth = (employeeId: number, year: number, monthIndex: number) => {
    return getPaymentsForEmployee(employeeId).filter((p) => {
      const d = new Date(p.paymentDate)
      if (Number.isNaN(d.getTime())) return false
      return d.getFullYear() === year && d.getMonth() === monthIndex
    })
  }

  const getPlansForEmployeeMonth = (employeeId: number, year: number, monthIndex: number) => {
    return getPlansForEmployee(employeeId).filter((p) => {
      const d = new Date(p.plannedDate)
      if (Number.isNaN(d.getTime())) return false
      return d.getFullYear() === year && d.getMonth() === monthIndex
    })
  }

  const getMealPlansForEmployeeMonth = (employeeId: number, year: number, monthIndex: number) => {
    return getMealPlansForEmployee(employeeId).filter((p) => {
      const d = new Date(p.plannedDate)
      if (Number.isNaN(d.getTime())) return false
      return d.getFullYear() === year && d.getMonth() === monthIndex
    })
  }

  const getSalaryPaymentForEmployeeMonth = (employeeId: number, year: number, monthIndex: number) => {
    const list = getPaymentsForEmployeeMonth(employeeId, year, monthIndex)
      .filter((p) => p.kind === 'salary')
      .slice()
      .sort((a, b) => String(b.paymentDate).localeCompare(String(a.paymentDate)) || Number(b.id) - Number(a.id))
    return list[0] ?? null
  }

  const getUndeductedCashAdvancesForEmployeeMonth = (employeeId: number, year: number, monthIndex: number) => {
    return getPaymentsForEmployeeMonth(employeeId, year, monthIndex)
      .filter((p) => p.kind === 'cashAdvance')
      .filter((p) => Boolean(p.deductFromSalary))
      .filter((p) => !p.salaryDeductedAt)
  }

  const openPaySource = async (kind: 'bulkSalary' | 'bulkAll' | 'bulkBonus' | 'bulkMeal') => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) {
      showPopup('info', 'Bilgi', 'Lütfen en az 1 çalışan seçin')
      return
    }

    const selectedRows = rows.filter((r) => selectedIds.has(r.id))
    const alreadyPaid = (kind === 'bulkSalary' || kind === 'bulkAll') ? selectedRows.filter((r) => isPaidThisMonth(r.id)) : []
    let warning = ''
    if (alreadyPaid.length > 0) {
      const now = new Date()
      const monthLabel = fmtMonthYearLabel(now.getFullYear(), now.getMonth())
      const lines = alreadyPaid.map((r) => `${r.firstName} ${r.lastName} (${monthLabel})`)
      warning = `Uyarı: ${lines.join(', ')} için bu ay maaş ödemesi zaten yapılmış.`
    }

    setPaySourceKind(kind)
    setPaySourceType('bank')
    setPaySourceAccountId('')
    setPaySourceWarning(warning)
    setPaySourceBusy(true)

    try {
      const [banks, cashes] = await Promise.all([
        fetchBankAccountDefinitions(),
        fetchCashAccounts()
      ])
      setPaySourceBanks(banks ?? [])
      setPaySourceCashes(cashes ?? [])
      if ((banks ?? []).length > 0) setPaySourceAccountId(String((banks ?? [])[0].id))
      setPaySourceOpen(true)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Hesaplar alınamadı'))
    } finally {
      setPaySourceBusy(false)
    }
  }

  const submitPaySource = async () => {
    const ids = Array.from(selectedIds)
    if (!paySourceAccountId) {
      showPopup('error', 'Hata', 'Lütfen bir hesap seçin')
      return
    }

    const bankId = paySourceType === 'bank' ? Number(paySourceAccountId) : null
    const cashId = paySourceType === 'cash' ? Number(paySourceAccountId) : null

    try {
      setPaySourceBusy(true)
      if (paySourceKind === 'bulkBonus') {
        const paidCount = await bulkPayPlannedBonusPlans({
          employeeIds: ids,
          description: 'Prim Ödemesi',
          bankAccountDefinitionId: bankId,
          cashAccountId: cashId
        })
        await loadPaymentsAndPlans()
        setSelectedIds(new Set())
        setPaySourceOpen(false)
        showPopup('success', 'Başarılı', `${paidCount} prim planı ödendi`)
        return
      }

      if (paySourceKind === 'bulkMeal') {
        await bulkMealPayment({
          employeeIds: ids,
          description: 'Yemek Ödemesi',
          bankAccountDefinitionId: bankId,
          cashAccountId: cashId
        })
        await loadPaymentsAndPlans()
        setSelectedIds(new Set())
        setPaySourceOpen(false)
        showPopup('success', 'Başarılı', `${ids.length} çalışan için yemek yatırıldı`)
        return
      }

      await bulkSalaryPayment({
        employeeIds: ids,
        description: 'Maaş Ödemesi',
        bankAccountDefinitionId: bankId,
        cashAccountId: cashId
      })

      if (paySourceKind === 'bulkAll') {
        await bulkPayPlannedBonusPlans({
          employeeIds: ids,
          description: 'Prim Ödemesi',
          bankAccountDefinitionId: bankId,
          cashAccountId: cashId
        })
        await bulkMealPayment({
          employeeIds: ids,
          description: 'Yemek Ödemesi',
          bankAccountDefinitionId: bankId,
          cashAccountId: cashId
        })
      }

      await loadPaymentsAndPlans()
      setSelectedIds(new Set())
      setPaySourceOpen(false)
      const msg = paySourceKind === 'bulkAll'
        ? 'Maaş + prim + yemek işlemleri tamamlandı'
        : `${ids.length} çalışan için maaş yatırıldı`
      showPopup('success', 'Başarılı', msg)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'İşlem başarısız'))
    } finally {
      setPaySourceBusy(false)
    }
  }

  const doConfirm = async () => {
    if (!confirmAction) return
    try {
      setConfirmBusy(true)
      setError(null)

      if (confirmAction.kind === 'bulkSalary') {
        const ids = Array.from(selectedIds)
        await bulkSalaryPayment({ employeeIds: ids, description: 'Maaş Ödemesi' })
        await loadPaymentsAndPlans()
        setSelectedIds(new Set())
        showPopup('success', 'Başarılı', `${ids.length} çalışan için maaş yatırıldı`)
      }

      if (confirmAction.kind === 'bulkBonus') {
        const ids = Array.from(selectedIds)
        const paidCount = await bulkPayPlannedBonusPlans({ employeeIds: ids, description: 'Prim Ödemesi' })
        await loadPaymentsAndPlans()
        setSelectedIds(new Set())
        showPopup('success', 'Başarılı', `${paidCount} prim planı ödendi`)
      }

      if (confirmAction.kind === 'bulkMeal') {
        const ids = Array.from(selectedIds)
        await bulkMealPayment({ employeeIds: ids, description: 'Yemek Ödemesi' })
        await loadPaymentsAndPlans()
        setSelectedIds(new Set())
        showPopup('success', 'Başarılı', `${ids.length} çalışan için yemek yatırıldı`)
      }

      if (confirmAction.kind === 'bulkAll') {
        const ids = Array.from(selectedIds)
        await bulkSalaryPayment({ employeeIds: ids, description: 'Maaş Ödemesi' })
        const paidCount = await bulkPayPlannedBonusPlans({ employeeIds: ids, description: 'Prim Ödemesi' })
        await bulkMealPayment({ employeeIds: ids, description: 'Yemek Ödemesi' })
        await loadPaymentsAndPlans()
        setSelectedIds(new Set())
        showPopup('success', 'Başarılı', `Maaş + prim + yemek işlemleri tamamlandı (Prim: ${paidCount})`)
      }
      // Note: bulkSalary and bulkAll go through paySource modal now; fallback kept for safety

      if (confirmAction.kind === 'undoSalaryPayment') {
        await deleteEmployeePayment(confirmAction.paymentId)
        await loadPaymentsAndPlans()
        showPopup('success', 'Başarılı', 'Maaş ödemesi geri alındı')
      }

      if (confirmAction.kind === 'undoCashAdvancePayment') {
        await deleteEmployeePayment(confirmAction.paymentId)
        await loadPaymentsAndPlans()
        showPopup('success', 'Başarılı', 'Nakit avans geri alındı')
      }

      if (confirmAction.kind === 'undoMealPayment') {
        await deleteEmployeePayment(confirmAction.paymentId)
        await loadPaymentsAndPlans()
        showPopup('success', 'Başarılı', 'Yemek ödemesi geri alındı')
      }

      if (confirmAction.kind === 'cancelBonusPlan') {
        await deleteEmployeeBonusPlan(confirmAction.planId)
        await loadPaymentsAndPlans()
        showPopup('success', 'Başarılı', 'Prim planı iptal edildi')
      }

      if (confirmAction.kind === 'undoPaidBonusPlan') {
        await undoPayEmployeeBonusPlan(confirmAction.planId)
        await loadPaymentsAndPlans()
        showPopup('success', 'Başarılı', 'Prim ödemesi geri alındı')
      }

      if (confirmAction.kind === 'cancelMealPlan') {
        await deleteEmployeeMealPlan(confirmAction.planId)
        await loadPaymentsAndPlans()
        showPopup('success', 'Başarılı', 'Yemek planı iptal edildi')
      }

      if (confirmAction.kind === 'undoPaidMealPlan') {
        await undoPayEmployeeMealPlan(confirmAction.planId)
        await loadPaymentsAndPlans()
        showPopup('success', 'Başarılı', 'Yemek ödemesi geri alındı')
      }

      if (confirmAction.kind === 'deleteEmployee') {
        await deleteEmployee(confirmAction.employeeId)
        await loadRows({ background: true })
        showPopup('success', 'Başarılı', 'Çalışan işten çıkarıldı')
      }

      if (confirmAction.kind === 'activateEmployee') {
        await activateEmployee(confirmAction.employeeId)
        await loadRows({ background: true })
        showPopup('success', 'Başarılı', 'Çalışan işe geri alındı')
      }

      if (confirmAction.kind === 'hardDeleteEmployee') {
        await hardDeleteEmployee(confirmAction.employeeId)
        await loadRows({ background: true })
        showPopup('success', 'Başarılı', 'Çalışan kalıcı olarak silindi')
      }

      if (confirmAction.kind === 'deleteEmployeeCheckIn') {
        await deleteEmployeeCheckIn(confirmAction.checkInId)
        await loadGoCForEmployee(confirmAction.employeeId)
        showPopup('success', 'Başarılı', 'G/Ç kaydı silindi')
      }

      if (confirmAction.kind === 'deleteEmployeeCheckInDay') {
        const key = String(confirmAction.employeeId)
        const list = (checkInsByEmployeeId[key] ?? []) as any[]
        const start = new Date(`${confirmAction.ymd}T00:00:00`)
        const end = new Date(`${confirmAction.ymd}T23:59:59`)
        const dayItems = list.filter((x) => {
          const t = new Date(String(x?.checkInTime ?? ''))
          if (Number.isNaN(t.getTime())) return false
          return t.getTime() >= start.getTime() && t.getTime() <= end.getTime()
        })

        for (const x of dayItems) {
          const id = Number(x?.id ?? 0)
          if (id > 0) {
            await deleteEmployeeCheckIn(id)
          }
        }

        await loadGoCForEmployee(confirmAction.employeeId)
        showPopup('success', 'Başarılı', 'Gün giriş/çıkış kayıtları silindi')
      }

      if (confirmAction.kind === 'deleteEmployeeLeave') {
        await deleteEmployeeLeave(confirmAction.leaveId)
        await loadGoCForEmployee(confirmAction.employeeId)
        showPopup('success', 'Başarılı', 'İzin kaydı silindi')
      }
    } catch (e: any) {
      const msg = String(e?.message ?? 'Bir hata oluştu')
      setError(msg)
      showPopup('error', 'Hata', msg)
    } finally {
      setConfirmBusy(false)
      setConfirmOpen(false)
      setConfirmAction(null)
    }
  }

  return (
    <div className="p-4">
      {/* Banka / Kasa seçim modalı */}
      <Modal
        isOpen={paySourceOpen}
        onClose={() => { if (paySourceBusy) return; setPaySourceOpen(false) }}
        title={paySourceKind === 'bulkAll' ? 'Toplu Ödeme – Kaynak Seçin' : paySourceKind === 'bulkBonus' ? 'Prim Ödemesi – Kaynak Seçin' : paySourceKind === 'bulkMeal' ? 'Yemek Ödemesi – Kaynak Seçin' : 'Maaş Ödemesi – Kaynak Seçin'}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={paySourceBusy}
              className="px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
              onClick={() => setPaySourceOpen(false)}
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={paySourceBusy || !paySourceAccountId}
              className="px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60"
              onClick={() => void submitPaySource()}
            >
              {paySourceBusy ? 'İşleniyor...' : 'Öde'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {paySourceWarning && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 whitespace-pre-line">
              {paySourceWarning}
            </div>
          )}

          <div className="text-xs text-gray-600">
            {(() => {
              const selected = rows.filter((r) => selectedIds.has(r.id))
              const isMeal = paySourceKind === 'bulkMeal'
              const now = new Date()
              const year = now.getFullYear()
              const monthIndex = now.getMonth()

              const grossTotal = isMeal
                ? selected.reduce((sum, r) => sum + Number((r as any)?.mealAmount ?? 0), 0)
                : selected.reduce((sum, r) => sum + Number(r.salary ?? 0), 0)

              const advanceTotal = isMeal
                ? 0
                : selected.reduce((sum, r) => {
                    const advances = getUndeductedCashAdvancesForEmployeeMonth(r.id, year, monthIndex)
                    const s = advances.reduce((s2, a) => s2 + Number(a.amount ?? 0), 0)
                    return sum + s
                  }, 0)

              const label = isMeal ? 'toplam yemek tutarı' : advanceTotal > 0 ? 'net maaşı' : 'toplam maaşı'

              const total = isMeal ? grossTotal : Math.max(0, grossTotal - advanceTotal)
              return (
                <>
                  Seçili <span className="font-semibold">{selectedIds.size}</span> çalışanın {label}:{' '}
                  <span className="font-extrabold text-gray-900">
                    {Number(total).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL
                  </span>
                </>
              )
            })()}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition ${
                paySourceType === 'bank'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => {
                setPaySourceType('bank')
                const firstBank = (paySourceBanks ?? [])[0]
                setPaySourceAccountId(firstBank ? String(firstBank.id) : '')
              }}
            >
              Banka
            </button>
            <button
              type="button"
              className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition ${
                paySourceType === 'cash'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => {
                setPaySourceType('cash')
                const firstCash = (paySourceCashes ?? [])[0]
                setPaySourceAccountId(firstCash ? String(firstCash.id) : '')
              }}
            >
              Kasa
            </button>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1">
              {paySourceType === 'bank' ? 'Banka Hesabı' : 'Kasa'}
            </label>
            <select
              className="w-full h-[34px] px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
              value={paySourceAccountId}
              onChange={(e) => setPaySourceAccountId(e.target.value)}
            >
              <option value="">Seçiniz...</option>
              {paySourceType === 'bank'
                ? (paySourceBanks ?? []).map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.accountCode}{b.accountName ? ` - ${b.accountName}` : ''}
                    </option>
                  ))
                : (paySourceCashes ?? []).map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.code}{c.name ? ` - ${c.name}` : ''}
                    </option>
                  ))
              }
            </select>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={statusTimeModalOpen}
        onClose={() => {
          setStatusTimeModalOpen(false)
          setStatusTimeModalKind(null)
          setStatusTimeModalCheckInId(null)
        }}
        title="Saat"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setStatusTimeModalOpen(false)
                setStatusTimeModalKind(null)
                setStatusTimeModalCheckInId(null)
              }}
              className="h-[34px] px-4 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!statusEmployeeId) return
                if (!statusSelectedYmd) return
                if (!statusTimeModalKind) return

                const time = String(statusTimeModalTime || '').trim()
                if (!time) return

                const iso = new Date(`${statusSelectedYmd}T${time}:00`).toISOString()

                if (statusTimeModalKind === 'addEntry' || statusTimeModalKind === 'addExit') {
                  await createEmployeeCheckIn(statusEmployeeId, { checkInTime: iso })
                  await loadGoCForEmployee(statusEmployeeId)
                  setStatusTimeModalOpen(false)
                  setStatusTimeModalKind(null)
                  setStatusTimeModalCheckInId(null)
                  return
                }

                const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL ?? ''
                setStatusTimeModalCheckInId(null)
              }}
              className="h-[34px] px-4 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
            >
              Kaydet
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-700">Saat</div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <input
              type="time"
              value={statusTimeModalTime}
              onChange={(e) => setStatusTimeModalTime(String(e.target.value ?? ''))}
              className="h-[38px] w-full pl-10 pr-3 text-sm font-bold border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={workNowOpen}
        onClose={() => {
          if (workNowBusy) return
          setWorkNowOpen(false)
        }}
        title="Şu An / Tarihler Arası Bilgi"
        containerClassName="max-w-5xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={workNowBusy}
              onClick={() => setWorkNowOpen(false)}
              className="h-[34px] px-4 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition disabled:opacity-60"
            >
              Kapat
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWorkNowTab('now')}
              className={
                'h-[34px] px-4 rounded-lg text-xs font-semibold border transition ' +
                (workNowTab === 'now'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
              }
            >
              Şuan
            </button>
            <button
              type="button"
              onClick={() => setWorkNowTab('range')}
              className={
                'h-[34px] px-4 rounded-lg text-xs font-semibold border transition ' +
                (workNowTab === 'range'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
              }
            >
              Tarihler Arası Bilgi
            </button>
          </div>

          {workNowTab === 'now' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setWorkNowNowFilter('all')}
                    className={
                      'h-[32px] px-3 rounded-lg text-xs font-semibold border transition ' +
                      (workNowNowFilter === 'all'
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                    }
                  >
                    Hepsi
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkNowNowFilter('at')}
                    className={
                      'h-[32px] px-3 rounded-lg text-xs font-semibold border transition ' +
                      (workNowNowFilter === 'at'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                    }
                  >
                    İşte
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkNowNowFilter('notAt')}
                    className={
                      'h-[32px] px-3 rounded-lg text-xs font-semibold border transition ' +
                      (workNowNowFilter === 'notAt'
                        ? 'bg-rose-600 text-white border-rose-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                    }
                  >
                    Değil
                  </button>
                </div>

                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <input
                    value={workNowSearchNow}
                    onChange={(e) => setWorkNowSearchNow(String(e.target.value ?? ''))}
                    className="h-[34px] w-[260px] pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
                    placeholder="İsme göre ara..."
                  />
                </div>
              </div>

              {workNowBusy ? (
                <div className="text-xs text-gray-500">Yükleniyor...</div>
              ) : (
                <div className="space-y-2">
                  {((rows ?? [])
                    .filter((r) => Boolean((r as any)?.isActive))
                    .filter((r) => {
                      const at = isAtWorkNow(r.id)
                      if (workNowNowFilter === 'at') return at
                      if (workNowNowFilter === 'notAt') return !at
                      return true
                    })
                    .filter((r) => {
                      const q = String(workNowSearchNow ?? '').trim().toLowerCase()
                      if (!q) return true
                      const t = `${r.firstName} ${r.lastName}`.toLowerCase()
                      return t.includes(q)
                    })
                  ).map((r) => {
                    const at = isAtWorkNow(r.id)
                    return (
                      <div
                        key={`wn-n-${r.id}`}
                        className={
                          'flex items-center justify-between gap-3 border rounded-lg px-3 py-2 ' +
                          (at
                            ? 'bg-emerald-50 border-emerald-100'
                            : 'bg-rose-50 border-rose-100')
                        }
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-gray-900 truncate">{r.firstName} {r.lastName}</div>
                        </div>
                        <div
                          className={
                            'shrink-0 h-[26px] px-3 rounded-full text-[11px] font-extrabold border ' +
                            (at ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200')
                          }
                        >
                          {at ? 'İŞTE' : 'DEĞİL'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={workNowFrom}
                    onChange={(e) => setWorkNowFrom(String(e.target.value ?? ''))}
                    className="h-[34px] px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
                  />
                  <input
                    type="date"
                    value={workNowTo}
                    onChange={(e) => setWorkNowTo(String(e.target.value ?? ''))}
                    className="h-[34px] px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setWorkNowFrom('')
                      setWorkNowTo('')
                    }}
                    className="h-[34px] px-3 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 transition"
                  >
                    Temizle
                  </button>
                  <div className="relative">
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    <input
                      value={workNowSearchRange}
                      onChange={(e) => setWorkNowSearchRange(String(e.target.value ?? ''))}
                      className="h-[34px] w-[260px] pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
                      placeholder="İsme göre ara..."
                    />
                  </div>
                </div>
              </div>

              {workNowBusy ? (
                <div className="text-xs text-gray-500">Yükleniyor...</div>
              ) : (
                <div className="space-y-2">
                  {((rows ?? [])
                    .filter((r) => Boolean((r as any)?.isActive))
                    .filter((r) => {
                      const q = String(workNowSearchRange ?? '').trim().toLowerCase()
                      if (!q) return true
                      const t = `${r.firstName} ${r.lastName}`.toLowerCase()
                      return t.includes(q)
                    })
                  ).map((r) => {
                    const stats = getRangeStatsForEmployee(r.id)
                    return (
                      <div key={`wn-r-${r.id}`} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-gray-900 truncate">{r.firstName} {r.lastName}</div>
                        </div>
                        <div className="shrink-0 text-[11px] font-semibold text-gray-700">
                          {stats ? (
                            <span>
                              {stats.worked} gün çalıştı, {stats.notWorked} gün çalışmadı, {stats.leave} gün izinli
                            </span>
                          ) : (
                            <span className="text-gray-400">Tarih aralığı seçin</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={payEntryOpen}
        onClose={() => {
          setPayEntryOpen(false)
          setPayEntryEmployeeId(null)
          setPayEntryEmployeeName('')
        }}
        title={payEntryTab === 'bonus' ? 'Prim' : 'Nakit Avans'}
        containerClassName="max-w-xl"
      >
        {!payEntryEmployeeId ? (
          <div className="text-xs text-gray-500">Çalışan seçilemedi</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPayEntryTab('cashAdvance')}
                className={
                  'h-[34px] flex-1 rounded-lg text-xs font-semibold border transition ' +
                  (payEntryTab === 'cashAdvance'
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                }
              >
                Nakit Avans
              </button>
              <button
                type="button"
                onClick={() => setPayEntryTab('bonus')}
                className={
                  'h-[34px] flex-1 rounded-lg text-xs font-semibold border transition ' +
                  (payEntryTab === 'bonus'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                }
              >
                Prim
              </button>
            </div>

            <div className="text-xs font-semibold text-gray-800">{payEntryEmployeeName}</div>

            <div className="h-[248px] overflow-auto">
              {payEntryTab === 'bonus' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormInput
                    label="Tutar"
                    value={bonusPlanAmount}
                    inputMode="numeric"
                    placeholder="0"
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '')
                      setBonusPlanAmount(v)
                    }}
                  />

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Tarih</label>
                    <input className="input-base" type="date" value={bonusPlanDate} onChange={(e) => setBonusPlanDate(e.target.value)} />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Açıklama</label>
                    <input className="input-base" value={bonusPlanReason} onChange={(e) => setBonusPlanReason(e.target.value)} placeholder="Prim plan notu" />
                  </div>

                  <div className="md:col-span-2">
                    <div className="h-[66px] px-3 rounded-lg border border-gray-200 bg-gray-50 flex items-center text-[11px] text-gray-600">
                      Prim planları daha sonra Toplu Ödeme / Prim Ödemesi üzerinden ödenir.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormInput
                    label="Tutar"
                    value={cashAdvanceAmount}
                    inputMode="numeric"
                    placeholder="0"
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '')
                      setCashAdvanceAmount(v)
                    }}
                  />

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Tarih</label>
                    <input className="input-base" type="date" value={cashAdvanceDate} onChange={(e) => setCashAdvanceDate(e.target.value)} />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Açıklama</label>
                    <input className="input-base" value={cashAdvanceReason} onChange={(e) => setCashAdvanceReason(e.target.value)} placeholder="Açıklama" />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Maaş Durumu</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCashAdvanceDeductFromSalary(true)}
                        className={
                          'h-[34px] px-4 rounded-lg text-xs font-semibold border transition ' +
                          (cashAdvanceDeductFromSalary
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                        }
                      >
                        Maaştan Düş
                      </button>
                      <button
                        type="button"
                        onClick={() => setCashAdvanceDeductFromSalary(false)}
                        className={
                          'h-[34px] px-4 rounded-lg text-xs font-semibold border transition ' +
                          (!cashAdvanceDeductFromSalary
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                        }
                      >
                        Maaştan Düşme
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayEntryOpen(false)}
                className="h-[34px] px-4 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!payEntryEmployeeId) return
                  void (async () => {
                    try {
                      setSaving(true)

                      if (payEntryTab === 'bonus') {
                        const amount = Math.max(0, Math.trunc(Number(bonusPlanAmount || '0') || 0))
                        if (amount <= 0) {
                          showPopup('info', 'Bilgi', 'Lütfen tutar girin')
                          return
                        }
                        if (!bonusPlanDate || !bonusPlanDate.trim()) {
                          showPopup('info', 'Bilgi', 'Lütfen tarih seçin')
                          return
                        }
                        const d = new Date(`${bonusPlanDate}T00:00:00`)
                        const plannedDate = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
                        await createEmployeeBonusPlan({
                          employeeId: payEntryEmployeeId,
                          plannedDate,
                          amount,
                          description: bonusPlanReason.trim() || 'Prim'
                        })
                        await loadPaymentsAndPlans()
                        setPayEntryOpen(false)
                        showPopup('success', 'Başarılı', 'Prim planı oluşturuldu')
                        return
                      }

                      const amount = Math.max(0, Math.trunc(Number(cashAdvanceAmount || '0') || 0))
                      if (amount <= 0) {
                        showPopup('info', 'Bilgi', 'Lütfen tutar girin')
                        return
                      }
                      const d = cashAdvanceDate && cashAdvanceDate.trim() ? new Date(`${cashAdvanceDate}T00:00:00`) : new Date()
                      const paymentDate = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
                      await createEmployeePayment({
                        employeeId: payEntryEmployeeId,
                        type: 3,
                        amount,
                        paymentDate,
                        description: cashAdvanceReason.trim() || 'Nakit Avans',
                        deductFromSalary: cashAdvanceDeductFromSalary
                      })
                      await loadPaymentsAndPlans()
                      setPayEntryOpen(false)
                      showPopup('success', 'Başarılı', 'Nakit avans kaydedildi')
                    } catch (e: any) {
                      const msg = String(e?.message ?? 'Bir hata oluştu')
                      setError(msg)
                      showPopup('error', 'Hata', msg)
                    } finally {
                      setSaving(false)
                    }
                  })()
                }}
                className="h-[34px] px-4 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
                disabled={saving}
              >
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={statusOpen}
        onClose={() => {
          setStatusOpen(false)
          setStatusEmployeeId(null)
          setStatusEmployeeName('')
          setStatusSelectedYmd('')
          setStatusShowLeaveDays(false)
          setStatusTimeModalOpen(false)
          setStatusTimeModalKind(null)
          setStatusTimeModalCheckInId(null)
        }}
        title="Durum / Takvim"
        containerClassName="max-w-6xl"
      >
        {!statusEmployeeId ? (
          <div className="text-xs text-gray-500">Çalışan seçilemedi</div>
        ) : (
          (() => {
            const empKey = String(statusEmployeeId)
            const items = (checkInsByEmployeeId[empKey] ?? []) as any[]
            const leaves = (leavesByEmployeeId[empKey] ?? []) as any[]
            const busy = Boolean(gocLoadingByEmployeeId[empKey])

            const [yy, mm] = String(statusMonth).split('-')
            const year = Number(yy)
            const monthIndex = Math.max(0, Math.min(11, (Number(mm) || 1) - 1))
            const first = new Date(year, monthIndex, 1)
            const firstDay = (first.getDay() + 6) % 7
            const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

            const ymdFromDate = (d: Date) => {
              const y = d.getFullYear()
              const m = String(d.getMonth() + 1).padStart(2, '0')
              const day = String(d.getDate()).padStart(2, '0')
              return `${y}-${m}-${day}`
            }

            const checkInsForYmd = (ymd: string) => {
              const start = new Date(`${ymd}T00:00:00`)
              const end = new Date(`${ymd}T23:59:59`)
              return items
                .filter((x) => {
                  const t = new Date(String(x?.checkInTime ?? ''))
                  if (Number.isNaN(t.getTime())) return false
                  return t.getTime() >= start.getTime() && t.getTime() <= end.getTime()
                })
                .sort((a, b) => String(a?.checkInTime ?? '').localeCompare(String(b?.checkInTime ?? '')))
            }

            const hasAnyCheckIn = (ymd: string) => checkInsForYmd(ymd).length > 0

            const leavesForYmd = (ymd: string) => {
              const start = new Date(`${ymd}T00:00:00`)
              const end = new Date(`${ymd}T23:59:59`)
              return leaves
                .filter((x) => {
                  const s = new Date(String(x?.leaveStartTime ?? ''))
                  const e = new Date(String(x?.returnTime ?? ''))
                  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return false
                  return s.getTime() <= end.getTime() && e.getTime() >= start.getTime()
                })
                .sort((a, b) => String(a?.leaveStartTime ?? '').localeCompare(String(b?.leaveStartTime ?? '')))
            }

            const hasAnyLeave = (ymd: string) => leavesForYmd(ymd).length > 0

            const pad: Array<null> = Array.from({ length: firstDay }, () => null)
            const cells = Array.from({ length: daysInMonth }, (_x, i) => {
              const d = new Date(year, monthIndex, i + 1)
              const ymd = ymdFromDate(d)
              return { day: i + 1, ymd }
            })
            const allCells = [...pad.map(() => ({ day: 0, ymd: '' })), ...cells]

            const selected = statusSelectedYmd ? checkInsForYmd(statusSelectedYmd) : []
            const selectedLeaves = statusSelectedYmd ? leavesForYmd(statusSelectedYmd) : []

            const monthLabel = (() => {
              try {
                return `${first.getFullYear()} ${first.toLocaleString('tr-TR', { month: 'long' })}`
              } catch {
                return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`
              }
            })()

            const { workedDays, leaveDays, absentDays } = (() => {
              const workedSet = new Set<string>()
              const leaveSet = new Set<string>()

              for (const c of cells) {
                if (hasAnyCheckIn(c.ymd)) workedSet.add(c.ymd)
                if (hasAnyLeave(c.ymd)) leaveSet.add(c.ymd)
              }

              const union = new Set<string>([...workedSet, ...leaveSet])
              const absent = Math.max(0, cells.length - union.size)

              return { workedDays: workedSet.size, leaveDays: leaveSet.size, absentDays: absent }
            })()

            return (
              <div className="space-y-4">
                <div className="border border-gray-200 rounded-xl bg-white p-3">
                  <div className="text-xs font-bold text-gray-900">Renkler</div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px] font-semibold text-gray-900">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded border border-emerald-300 bg-emerald-100" />
                      <div>Yeşil: Çalıştı</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded border border-yellow-300 bg-yellow-100" />
                      <div>Sarı: İzinli</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded border border-blue-300 bg-blue-100" />
                      <div>Mavi: İzinliyken giriş yaptı</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded border border-rose-300 bg-rose-100" />
                      <div>Kırmızı: Çalışmadı</div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-gray-900">{statusEmployeeName}</div>
                    <div className="text-[11px] font-semibold text-gray-900">
                      {monthLabel} {workedDays} gün çalıştı {leaveDays} gün izinli {absentDays} gün çalışmadı
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="month"
                      value={statusMonth}
                      onChange={(e) => {
                        setStatusMonth(String(e.target.value ?? ''))
                        setStatusSelectedYmd('')
                        setStatusShowLeaveDays(false)
                      }}
                      className="h-[34px] px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
                    />
                    <button
                      type="button"
                      onClick={() => void loadGoCForEmployee(statusEmployeeId)}
                      className="h-[34px] px-3 rounded-lg text-xs font-semibold bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                    >
                      {busy ? 'Yükleniyor...' : 'Yenile'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusShowLeaveDays((p) => !p)}
                      className={
                        'h-[34px] px-3 rounded-lg text-xs font-semibold border transition ' +
                        (statusShowLeaveDays
                          ? 'bg-yellow-500 text-yellow-950 border-yellow-600'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                      }
                    >
                      İzinli Günler
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-gray-200 rounded-xl bg-white p-3">
                    <div className="grid grid-cols-7 gap-1 text-[11px] font-bold text-gray-600 mb-2">
                      <div className="text-center">Pzt</div>
                      <div className="text-center">Sal</div>
                      <div className="text-center">Çar</div>
                      <div className="text-center">Per</div>
                      <div className="text-center">Cum</div>
                      <div className="text-center">Cmt</div>
                      <div className="text-center">Paz</div>
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {allCells.map((c, idx) => {
                        if (!c.ymd) return <div key={`empty-${idx}`} className="h-9" />
                        const active = c.ymd === statusSelectedYmd
                        const ok = hasAnyCheckIn(c.ymd)
                        const lv = hasAnyLeave(c.ymd)
                        const workOnLeave = ok && lv
                        const absent = !ok && !lv
                        return (
                          <button
                            key={c.ymd}
                            type="button"
                            onClick={() => {
                              setStatusSelectedYmd(c.ymd)
                              setStatusShowLeaveDays(false)
                            }}
                            className={
                              'h-9 rounded-lg text-xs font-bold border transition ' +
                              (active
                                ? workOnLeave
                                  ? 'border-blue-600 bg-blue-600 text-white'
                                  : lv
                                    ? 'border-yellow-600 bg-yellow-500 text-yellow-950'
                                    : ok
                                      ? 'border-emerald-600 bg-emerald-600 text-white'
                                      : 'border-rose-600 bg-rose-600 text-white'
                                : workOnLeave
                                  ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
                                  : lv
                                    ? 'border-yellow-200 bg-yellow-100 text-yellow-950 hover:bg-yellow-200'
                                    : ok
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                      : absent
                                        ? 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
                                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50')
                            }
                          >
                            {c.day}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-xl bg-white p-3">
                    <div className="text-xs font-semibold text-gray-700">Detay</div>
                    {statusShowLeaveDays ? (
                      <div className="mt-2 space-y-2">
                        <div className="text-xs font-bold text-gray-900">İzinli Günler</div>
                        {(() => {
                          const monthStart = new Date(year, monthIndex, 1, 0, 0, 0)
                          const monthEnd = new Date(year, monthIndex + 1, 0, 23, 59, 59)
                          const monthLeaves = (leavesByEmployeeId[empKey] ?? []).filter((x: any) => {
                            const s = new Date(String(x?.leaveStartTime ?? ''))
                            const e = new Date(String(x?.returnTime ?? ''))
                            if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return false
                            return s.getTime() <= monthEnd.getTime() && e.getTime() >= monthStart.getTime()
                          })

                          if (monthLeaves.length === 0) {
                            return <div className="text-xs text-gray-500">Bu ay izin kaydı yok</div>
                          }

                          return monthLeaves.map((x: any) => (
                            <div key={`lv-${x.id}`} className="border border-yellow-200 bg-yellow-50 rounded-lg p-2">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-xs font-bold text-gray-900">{fmtDateTime(String(x?.leaveStartTime ?? ''))} → {fmtDateTime(String(x?.returnTime ?? ''))}</div>
                                  {x?.description ? <div className="mt-1 text-[11px] text-gray-700 whitespace-pre-line">{String(x.description)}</div> : null}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      printLeaveFormFromItem({
                                        employeeName: statusEmployeeName,
                                        startIso: String(x?.leaveStartTime ?? ''),
                                        returnIso: String(x?.returnTime ?? ''),
                                        description: String(x?.description ?? '')
                                      })
                                    }
                                    className="h-[28px] px-3 rounded text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition"
                                  >
                                    PDF Oluştur
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmText('İzin kaydı silinecek. Devam edilsin mi?')
                                      setConfirmAction({ kind: 'deleteEmployeeLeave', employeeId: statusEmployeeId, leaveId: Number(x?.id ?? 0) })
                                      setConfirmOpen(true)
                                    }}
                                    className="h-[28px] w-[28px] rounded text-[12px] font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                                  >
                                    X
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))
                        })()}
                      </div>
                    ) : !statusSelectedYmd ? (
                      <div className="mt-2 text-xs text-gray-500">Takvimden gün seçin</div>
                    ) : selected.length === 0 && selectedLeaves.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        <div className="text-xs font-bold text-gray-900">{statusSelectedYmd}</div>
                        <div className="text-xs font-semibold text-yellow-700">İzinli</div>
                        {selectedLeaves.map((x) => (
                          <div key={`lv-${x.id}`} className="border border-yellow-200 bg-yellow-50 rounded-lg p-2">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-xs font-bold text-gray-900">{fmtDateTime(String(x?.leaveStartTime ?? ''))} → {fmtDateTime(String(x?.returnTime ?? ''))}</div>
                                {x?.description ? <div className="mt-1 text-[11px] text-gray-700 whitespace-pre-line">{String(x.description)}</div> : null}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    printLeaveFormFromItem({
                                      employeeName: statusEmployeeName,
                                      startIso: String(x?.leaveStartTime ?? ''),
                                      returnIso: String(x?.returnTime ?? ''),
                                      description: String(x?.description ?? '')
                                    })
                                  }
                                  className="h-[28px] px-3 rounded text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition"
                                >
                                  PDF Oluştur
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!statusEmployeeId) return
                                    setConfirmText('İzin kaydı silinecek. Devam edilsin mi?')
                                    setConfirmAction({ kind: 'deleteEmployeeLeave', employeeId: statusEmployeeId, leaveId: Number(x?.id ?? 0) })
                                    setConfirmOpen(true)
                                  }}
                                  className="h-[28px] w-[28px] rounded text-[12px] font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                                >
                                  X
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <div className="text-xs font-bold text-gray-900">{statusSelectedYmd}</div>

                        {(() => {
                          const entry = selected.length > 0 ? selected[0] : null
                          const exit = selected.length > 1 ? selected[selected.length - 1] : null
                          const hasEntry = Boolean(entry)
                          const hasExit = Boolean(exit)

                          const openAddEntry = () => {
                            setStatusTimeModalTime('09:00')
                            setStatusTimeModalKind('addEntry')
                            setStatusTimeModalCheckInId(null)
                            setStatusTimeModalOpen(true)
                          }

                          const openAddExit = () => {
                            setStatusTimeModalTime('18:00')
                            setStatusTimeModalKind('addExit')
                            setStatusTimeModalCheckInId(null)
                            setStatusTimeModalOpen(true)
                          }

                          const openEditEntry = () => {
                            if (!entry) return
                            const d = new Date(String(entry?.checkInTime ?? ''))
                            const time = Number.isNaN(d.getTime()) ? '09:00' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                            setStatusTimeModalTime(time)
                            setStatusTimeModalKind('editEntry')
                            setStatusTimeModalCheckInId(Number(entry?.id ?? 0))
                            setStatusTimeModalOpen(true)
                          }

                          const openEditExit = () => {
                            if (!exit) return
                            const d = new Date(String(exit?.checkInTime ?? ''))
                            const time = Number.isNaN(d.getTime()) ? '18:00' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                            setStatusTimeModalTime(time)
                            setStatusTimeModalKind('editExit')
                            setStatusTimeModalCheckInId(Number(exit?.id ?? 0))
                            setStatusTimeModalOpen(true)
                          }

                          return (
                            <div className="border border-gray-100 rounded-lg p-2 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="text-[11px] font-semibold text-gray-700">Giriş</div>
                                  <div className="text-xs font-bold text-gray-900">{hasEntry ? fmtDateTime(String(entry?.checkInTime ?? '')) : '-'}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {hasEntry ? (
                                    <button
                                      type="button"
                                      onClick={openEditEntry}
                                      className="h-[30px] px-3 rounded text-[11px] font-semibold bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100"
                                    >
                                      Düzenle
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={openAddEntry}
                                      className="h-[30px] px-3 rounded text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                                    >
                                      Giriş Ekle
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="text-[11px] font-semibold text-gray-700">Çıkış</div>
                                  <div className="text-xs font-bold text-gray-900">{hasExit ? fmtDateTime(String(exit?.checkInTime ?? '')) : '-'}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {hasExit ? (
                                    <button
                                      type="button"
                                      onClick={openEditExit}
                                      className="h-[30px] px-3 rounded text-[11px] font-semibold bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100"
                                    >
                                      Düzenle
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={openAddExit}
                                      className="h-[30px] px-3 rounded text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
                                    >
                                      Çıkış Ekle
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center justify-end">
                                {selected.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!statusEmployeeId || !statusSelectedYmd) return
                                      setConfirmText('Bu günün giriş/çıkış kayıtları silinecek. Emin misiniz?')
                                      setConfirmAction({ kind: 'deleteEmployeeCheckInDay', employeeId: statusEmployeeId, ymd: statusSelectedYmd })
                                      setConfirmOpen(true)
                                    }}
                                    className="h-[30px] px-3 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                                  >
                                    Girilmedi Yap
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          )
                        })()}

                        {selected.map((x) => (
                          <div key={`ci-${x.id}`} className="border border-gray-100 rounded-lg p-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-bold text-gray-900">{fmtDateTime(String(x?.checkInTime ?? ''))}</div>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!statusEmployeeId) return
                                  setConfirmText('G/Ç kaydı silinecek. Emin misiniz?')
                                  setConfirmAction({ kind: 'deleteEmployeeCheckIn', employeeId: statusEmployeeId, checkInId: Number(x.id) })
                                  setConfirmOpen(true)
                                }}
                                className="h-[28px] px-3 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                              >
                                Sil
                              </button>
                            </div>
                            {(String(x?.city ?? '').trim() || String(x?.district ?? '').trim()) && (
                              <div className="mt-1 text-[11px] text-gray-700">
                                {String(x?.city ?? '').trim()}
                                {String(x?.city ?? '').trim() && String(x?.district ?? '').trim() ? ' / ' : ''}
                                {String(x?.district ?? '').trim()}
                              </div>
                            )}
                            <div className="mt-1 text-[11px] text-gray-600">Latitude: {String(x?.latitude ?? '')}</div>
                            <div className="text-[11px] text-gray-600">Longitude: {String(x?.longitude ?? '')}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })()
        )}
      </Modal>

      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (confirmBusy) {
            return
          }
          setConfirmOpen(false)
          setConfirmAction(null)
        }}
        title="Onay"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={confirmBusy}
              onClick={() => {
                setConfirmOpen(false)
                setConfirmAction(null)
              }}
              className="px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={confirmBusy || !confirmAction}
              onClick={() => void doConfirm()}
              className="px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60"
            >
              {confirmBusy ? 'İşleniyor...' : 'Onayla'}
            </button>
          </div>
        }
      >
        <div className="text-xs text-gray-700 whitespace-pre-line">{confirmText}</div>
      </Modal>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setActiveFilter('active')
              setSelectedIds(new Set())
            }}
            className={
              'h-[34px] px-4 rounded-lg text-xs font-semibold border transition ' +
              (activeFilter === 'active'
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
            }
          >
            Çalışanlar
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveFilter('inactive')
              setSelectedIds(new Set())
            }}
            className={
              'h-[34px] px-4 rounded-lg text-xs font-semibold border transition ' +
              (activeFilter === 'inactive'
                ? 'bg-rose-600 text-white border-rose-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
            }
          >
            İşten Çıkarılanlar
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Yeni Çalışan
          </button>

          <button
            type="button"
            onClick={() => navigate('/qr-test')}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition"
          >
            QR Oluştur
          </button>

          <button
            type="button"
            onClick={() => void openPaySource('bulkSalary')}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition"
          >
            Maaş Yatır
          </button>

          <button
            type="button"
            onClick={() => void openPaySource('bulkMeal')}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition"
          >
            Yemek Yatır
          </button>

          <button
            type="button"
            onClick={() => void openPaySource('bulkBonus')}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition"
          >
            Prim Yatır
          </button>

          <button
            type="button"
            onClick={() => void openPaySource('bulkAll')}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm transition"
          >
            Toplu Yatır
          </button>

          <div className="h-[34px] px-3 rounded-lg border border-gray-200 bg-white flex items-center gap-2">
            <div className="text-[11px] font-bold text-emerald-700">{workNowCounts.at} kişi şu an işte</div>
            <div className="text-[11px] font-bold text-rose-700">{workNowCounts.notAt} kişi şu an işte değil</div>
            <button
              type="button"
              onClick={async () => {
                const activeIds = (rows ?? []).filter((r) => Boolean((r as any)?.isActive)).map((r) => r.id)
                await ensureGoCLoadedForEmployees(activeIds)
                setWorkNowOpen(true)
              }}
              className="h-[26px] px-3 rounded-md text-[11px] font-bold bg-gray-100 text-gray-800 border border-gray-200 hover:bg-gray-200 transition"
            >
              Detay
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="h-[34px] w-[220px] sm:w-[280px] pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
            placeholder="Genel ara..."
          />

          <div
            className="relative"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setTopFilterDropdownOpen((p) => !p)}
              className={
                'h-[34px] px-3 rounded-lg text-xs font-semibold border transition ' +
                (topFilterDropdownOpen
                  ? 'bg-gray-100 text-gray-900 border-gray-300'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
              }
            >
              Filtreler
              {topQuickFilters.size > 0 ? ` (${topQuickFilters.size})` : ''}
            </button>

            {topFilterDropdownOpen && (
              <div
                className="absolute right-0 top-full mt-2 z-50 w-[320px] bg-white border border-gray-200 rounded-xl shadow-[0_14px_40px_-20px_rgba(0,0,0,0.35)] p-2"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="text-[11px] font-bold text-gray-900 px-1">Durum Filtreleri (AND)</div>
                <div className="mt-2 space-y-1">
                  {(
                    [
                      { key: 'salaryPaid', label: `Maaşı Yatırılanlar (${quickFilterCounts.salaryPaid})` },
                      { key: 'mealPaid', label: `Yemek Yatırılanlar (${quickFilterCounts.mealPaid})` },
                      { key: 'bonusPaid', label: `Primi Yatırılanlar (${quickFilterCounts.bonusPaid})` },
                      { key: 'bonusPlanned', label: `Prim Planlananlar (${quickFilterCounts.bonusPlanned})` },
                      { key: 'cashAdvancePaid', label: `Nakit Avans Verilenler (${quickFilterCounts.cashAdvancePaid})` }
                    ] as Array<{ key: TopQuickFilter; label: string }>
                  ).map((it) => (
                    <label key={it.key} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={topQuickFilters.has(it.key)}
                        onChange={(e) => {
                          const checked = e.target.checked
                          setTopQuickFilters((prev) => {
                            const next = new Set(prev)
                            if (checked) next.add(it.key)
                            else next.delete(it.key)
                            return next
                          })
                        }}
                      />
                      <span className="text-xs font-semibold text-gray-800">{it.label}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-2 border-t border-gray-100 pt-2">
                  <div className="text-[11px] font-bold text-gray-900 px-1">Tarih Aralığı</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={topFilterFrom}
                      onChange={(e) => setTopFilterFrom(String(e.target.value ?? ''))}
                      className="h-[34px] px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
                    />
                    <input
                      type="date"
                      value={topFilterTo}
                      onChange={(e) => setTopFilterTo(String(e.target.value ?? ''))}
                      className="h-[34px] px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTopQuickFilters(new Set())
                        setTopFilterFrom('')
                        setTopFilterTo('')
                      }}
                      className="h-[32px] px-3 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 transition"
                    >
                      Temizle
                    </button>
                    <button
                      type="button"
                      onClick={() => setTopFilterDropdownOpen(false)}
                      className="h-[32px] px-3 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
                    >
                      Uygula
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600 whitespace-pre-line">{error}</div>}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
        <div className="px-3 pt-3">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700 select-none">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => {
                const checked = e.target.checked
                setSelectedIds(() => {
                  if (!checked) return new Set()
                  return new Set(visibleRows.map((r) => r.id))
                })
              }}
            />
            Hepsini Seç
          </label>
        </div>
        {loading ? (
          <div className="p-4 text-xs text-gray-500">Yükleniyor...</div>
        ) : (
          <Table<Row>
          onRefresh={() => void loadRows()}
            columns={columns}
            data={filteredRows}
            rowKey={(r) => r.id}
            showColumnFilters
            globalSearch={globalSearch}
            onFilteredDataChange={(r) => setVisibleRows(r)}
            onRowClick={(row) => toggleExpand(row.id)}
            rowClassName={(row) => {
              const green = isGreenRow(row)
              const selected = selectedIds.has(row.id)
              if (green) return '!bg-green-200'
              if (selected) return '!bg-emerald-50'
              return ''
            }}
            isRowExpanded={(row) => Boolean(expandedById[String(row.id)])}
            renderExpandedRow={(row) => {
              const q = String(expandedSearchById[String(row.id)] ?? '').trim().toLowerCase()
              const listAll = getPaymentsForEmployee(row.id)
              const plansAll = getPlansForEmployee(row.id)
              const mealsAll = getMealPlansForEmployee(row.id)

              const list = !q
                ? listAll
                : listAll.filter((p) => {
                    const t = `${p.kind} ${p.amount} ${p.description} ${p.paymentDate} ${fmtDateOnly(p.paymentDate)} ${p.createUser}`.toLowerCase()
                    return t.includes(q)
                  })

              const plans = !q
                ? plansAll
                : plansAll.filter((p) => {
                    const t = `${p.amount} ${p.description} ${p.plannedDate} ${fmtDateOnly(p.plannedDate)} ${p.status}`.toLowerCase()
                    return t.includes(q)
                  })

              const meals = !q
                ? mealsAll
                : mealsAll.filter((p) => {
                    const t = `${p.amount} ${p.description} ${p.plannedDate} ${fmtDateOnly(p.plannedDate)} ${p.status}`.toLowerCase()
                    return t.includes(q)
                  })

              const grouped = groupPaymentsByMonthYear(list)

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-bold text-gray-800">Detay</div>
                    <div className="relative">
                      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      <input
                        value={String(expandedSearchById[String(row.id)] ?? '')}
                        onChange={(e) => setExpandedSearch(row.id, e.target.value)}
                        className="h-[32px] w-[220px] pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
                        placeholder="Detay içinde ara..."
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 text-xs font-bold text-gray-800 bg-gray-50">Ödeme Geçmişi</div>
                      <div className="max-h-[280px] overflow-auto">
                        {grouped.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-gray-500">Henüz ödeme yok</div>
                        ) : (
                          grouped.map(([key, items]) => (
                            <div key={key} className="border-b border-gray-100 last:border-b-0">
                              <div className="px-3 py-2 text-[11px] font-bold text-gray-700 bg-white">{key}</div>
                              {items.map((p) => (
                                <div key={p.id} className="px-3 py-2 border-t border-gray-100">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs font-bold text-gray-900">
                                      {p.kind === 'salary' ? 'Maaş' : p.kind === 'bonus' ? 'Prim' : p.kind === 'meal' ? 'Yemek' : 'Nakit Avans'}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <div className="text-xs font-bold text-emerald-700">{Number(p.amount ?? 0).toLocaleString('tr-TR')} ₺</div>
                                      {p.kind === 'salary' ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setConfirmText('Maaş ödemesi geri alınacak (silinecek). Devam edilsin mi?')
                                            setConfirmAction({ kind: 'undoSalaryPayment', paymentId: p.id })
                                            setConfirmOpen(true)
                                          }}
                                          className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                                        >
                                          Geri Al
                                        </button>
                                      ) : p.kind === 'cashAdvance' ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setConfirmText('Nakit avans geri alınacak (silinecek). Devam edilsin mi?')
                                            setConfirmAction({ kind: 'undoCashAdvancePayment', paymentId: p.id })
                                            setConfirmOpen(true)
                                          }}
                                          className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                                        >
                                          Geri Al
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                  {p.description ? <div className="mt-1 text-[11px] text-gray-600 whitespace-pre-line">{p.description}</div> : null}
                                  <div className="mt-1 text-[11px] text-gray-500">Tarih: {fmtDateOnly(p.paymentDate)} | Kaydeden: {p.createUser || '-'}</div>
                                </div>
                              ))}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 text-xs font-bold text-gray-800 bg-gray-50">Prim Planları</div>
                      <div className="max-h-[280px] overflow-auto">
                        {plans.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-gray-500">Henüz prim planı yok</div>
                        ) : (
                          plans.map((p) => (
                            <div key={p.id} className="px-3 py-2 border-b border-gray-100 last:border-b-0">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-xs font-bold text-gray-900">{fmtDateOnly(p.plannedDate)}</div>
                                <div className="flex items-center gap-2">
                                  <div className="text-xs font-bold text-blue-700">{Number(p.amount ?? 0).toLocaleString('tr-TR')} ₺</div>
                                  {p.status === 1 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmText('Prim planı iptal edilecek. Devam edilsin mi?')
                                        setConfirmAction({ kind: 'cancelBonusPlan', planId: p.id })
                                        setConfirmOpen(true)
                                      }}
                                      className="h-[24px] px-2 rounded text-[11px] font-semibold bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100"
                                    >
                                      İptal
                                    </button>
                                  ) : p.status === 2 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmText('Ödenen prim geri alınacak. Devam edilsin mi?')
                                        setConfirmAction({ kind: 'undoPaidBonusPlan', planId: p.id })
                                        setConfirmOpen(true)
                                      }}
                                      className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                                    >
                                      Geri Al
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              {p.description ? <div className="mt-1 text-[11px] text-gray-600 whitespace-pre-line">{p.description}</div> : null}
                              <div className="mt-1 text-[11px] text-gray-500">Durum: {p.status === 1 ? 'Planlandı' : p.status === 2 ? 'Ödendi' : 'İptal'}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 text-xs font-bold text-gray-800 bg-gray-50">Yemek</div>
                      <div className="max-h-[280px] overflow-auto">
                        {meals.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-gray-500">Henüz yemek kaydı yok</div>
                        ) : (
                          meals.map((p) => (
                            <div key={`meal-${p.id}`} className="px-3 py-2 border-t border-gray-100">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <div className="text-xs font-bold text-gray-900">Yemek</div>
                                  {p.status === 2 ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      <span className="text-emerald-600">✓</span>
                                      Ödendi
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                                      <span className="text-gray-400">●</span>
                                      Planlandı
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <div className="text-xs font-bold text-amber-700">{Number(p.amount ?? 0).toLocaleString('tr-TR')} ₺</div>
                                  {p.status === 1 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmText('Yemek planı iptal edilecek. Devam edilsin mi?')
                                        setConfirmAction({ kind: 'cancelMealPlan', planId: p.id })
                                        setConfirmOpen(true)
                                      }}
                                      className="h-[24px] px-2 rounded text-[11px] font-semibold bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100"
                                    >
                                      İptal
                                    </button>
                                  ) : p.status === 2 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmText('Ödenen yemek geri alınacak. Devam edilsin mi?')
                                        setConfirmAction({ kind: 'undoPaidMealPlan', planId: p.id })
                                        setConfirmOpen(true)
                                      }}
                                      className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                                    >
                                      Geri Al
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              <div className="mt-1 text-[11px] text-gray-500">{fmtDateOnly(p.plannedDate)}</div>
                              {p.description ? <div className="mt-1 text-[11px] text-gray-600 whitespace-pre-line">{p.description}</div> : null}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              )
            }}
          />
        )}
      </div>

      <Modal
        isOpen={infoOpen}
        onClose={() => {
          setInfoOpen(false)
          setInfoEmployeeId(null)
          setInfoYear(null)
        }}
        title="Bilgi"
        containerClassName="max-w-3xl"
      >
        {!infoEmployeeId ? (
          <div className="text-xs text-gray-500">Çalışan seçilemedi</div>
        ) : (
          <div className="space-y-2">
            {(() => {
              const years = getInfoYearsForEmployee(infoEmployeeId)
              const months = buildMonthKeysForEmployee(infoEmployeeId)
              const selected = infoYear ?? years[0] ?? null
              const filteredMonths = selected
                ? Array.from({ length: 12 }, (_x, monthIndex) => {
                    const key = `${selected}-${String(monthIndex + 1).padStart(2, '0')}`
                    return { key, year: selected, monthIndex, label: fmtMonthYearLabel(selected, monthIndex) }
                  })
                : months
              return (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    {years.map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => setInfoYear(y)}
                        className={`h-[28px] px-3 rounded text-xs font-semibold border transition ${selected === y ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                      >
                        {y}
                      </button>
                    ))}
                  </div>

                  {filteredMonths.map((m) => {
              const open = Boolean(infoOpenMonths[m.key])
              const salaryPayment = getSalaryPaymentForEmployeeMonth(infoEmployeeId, m.year, m.monthIndex)
              const monthPayments = getPaymentsForEmployeeMonth(infoEmployeeId, m.year, m.monthIndex)
              const others = monthPayments.filter((p) => p.kind !== 'salary')
              const monthPlans = getPlansForEmployeeMonth(infoEmployeeId, m.year, m.monthIndex)
              const monthMealPayments = getPaymentsForEmployeeMonth(infoEmployeeId, m.year, m.monthIndex).filter(p => p.kind === 'meal')
              const hasData = Boolean(salaryPayment) || others.length > 0 || monthPlans.length > 0 || monthMealPayments.length > 0
              return (
                <div key={m.key} className="border border-gray-100 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    className={`w-full px-3 py-2 flex items-center justify-between ${hasData ? 'bg-emerald-200' : 'bg-gray-50'}`}
                    onClick={() => setInfoOpenMonths((p) => ({ ...p, [m.key]: !p[m.key] }))}
                  >
                    <div className="text-xs font-bold text-gray-800 capitalize">{m.label}</div>
                    <div className="text-xs font-semibold text-gray-600">{open ? 'Kapat' : 'Aç'}</div>
                  </button>

                  {open ? (
                    <div className="px-3 py-3 space-y-3">
                      <div className="border border-gray-100 rounded-md overflow-hidden">
                        <div className="px-3 py-2 text-xs font-bold text-gray-800 bg-white">Maaş</div>
                        <div className="px-3 py-2 text-xs text-gray-700">
                          {salaryPayment ? (
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-semibold">{fmtDateOnly(salaryPayment.paymentDate)}</div>
                              <div className="flex items-center gap-2">
                                <div className="font-bold text-emerald-700">{Number(salaryPayment.amount ?? 0).toLocaleString('tr-TR')} ₺</div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmText('Maaş ödemesi geri alınacak (silinecek). Devam edilsin mi?')
                                    setConfirmAction({ kind: 'undoSalaryPayment', paymentId: salaryPayment.id })
                                    setConfirmOpen(true)
                                  }}
                                  className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                                >
                                  Geri Al
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="text-gray-500">Yapılmadı</div>
                          )}
                        </div>
                      </div>

                      <div className="border border-gray-100 rounded-md overflow-hidden">
                        <div className="px-3 py-2 text-xs font-bold text-gray-800 bg-white">Prim / Yemek / Nakit Avans</div>
                        {others.length === 0 && monthPlans.length === 0 && monthMealPayments.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-gray-500">Kayıt yok</div>
                        ) : (
                          <>
                            {monthPlans.map((p) => (
                              <div key={`plan-${p.id}`} className="px-3 py-2 border-t border-gray-100">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <div className="text-xs font-bold text-gray-900">Prim</div>
                                    {p.status === 2 ? (
                                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        <span className="text-emerald-600">✓</span>
                                        Ödendi
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                                        <span className="text-gray-400">●</span>
                                        Planlandı
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="text-xs font-bold text-blue-700">{Number(p.amount ?? 0).toLocaleString('tr-TR')} ₺</div>
                                    {p.status === 1 ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setConfirmText('Prim planı iptal edilecek. Devam edilsin mi?')
                                          setConfirmAction({ kind: 'cancelBonusPlan', planId: p.id })
                                          setConfirmOpen(true)
                                        }}
                                        className="h-[24px] px-2 rounded text-[11px] font-semibold bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100"
                                      >
                                        İptal
                                      </button>
                                    ) : p.status === 2 ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setConfirmText('Ödenen prim geri alınacak. Devam edilsin mi?')
                                          setConfirmAction({ kind: 'undoPaidBonusPlan', planId: p.id })
                                          setConfirmOpen(true)
                                        }}
                                        className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                                      >
                                        Geri Al
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="mt-1 text-[11px] text-gray-500">{fmtDateOnly(p.plannedDate)}</div>
                                {p.description ? <div className="mt-1 text-[11px] text-gray-600 whitespace-pre-line">{p.description}</div> : null}
                              </div>
                            ))}

                            {monthMealPayments.map((p) => (
                              <div key={`meal-${p.id}`} className="px-3 py-2 border-t border-gray-100">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-xs font-bold text-gray-900">Yemek</div>
                                  <div className="flex items-center gap-2">
                                    <div className="text-xs font-bold text-amber-700">{Number(p.amount ?? 0).toLocaleString('tr-TR')} ₺</div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmText('Yemek ödemesi geri alınacak (silinecek). Devam edilsin mi?')
                                        setConfirmAction({ kind: 'undoMealPayment', paymentId: p.id })
                                        setConfirmOpen(true)
                                      }}
                                      className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                                    >
                                      Geri Al
                                    </button>
                                  </div>
                                </div>
                                <div className="mt-1 text-[11px] text-gray-500">{fmtDateOnly(p.paymentDate)}</div>
                                {p.description ? <div className="mt-1 text-[11px] text-gray-600 whitespace-pre-line">{p.description}</div> : null}
                              </div>
                            ))}

                            {others.map((p) => (
                              <div key={p.id} className="px-3 py-2 border-t border-gray-100">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-xs font-bold text-gray-900">{p.kind === 'bonus' ? 'Prim' : p.kind === 'meal' ? 'Yemek' : 'Nakit Avans'}</div>
                                  <div className="flex items-center gap-2">
                                    <div className="text-xs font-bold text-blue-700">{Number(p.amount ?? 0).toLocaleString('tr-TR')} ₺</div>
                                    {p.kind === 'cashAdvance' ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setConfirmText('Nakit avans geri alınacak (silinecek). Devam edilsin mi?')
                                          setConfirmAction({ kind: 'undoCashAdvancePayment', paymentId: p.id })
                                          setConfirmOpen(true)
                                        }}
                                        className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                                      >
                                        Geri Al
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="mt-1 text-[11px] text-gray-500">{fmtDateOnly(p.paymentDate)}</div>
                                {p.description ? <div className="mt-1 text-[11px] text-gray-600 whitespace-pre-line">{p.description}</div> : null}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
                  })}
                </>
              )
            })()}
          </div>
        )}
      </Modal>

      <Modal isOpen={modalOpen} onClose={closeModal} title={modalMode === 'create' ? 'Yeni Çalışan' : 'Çalışan Düzenle'}>
        {modalError && (
          <div ref={employeeModalErrorRef} className="mb-3 text-xs font-semibold text-red-600 whitespace-pre-line">
            {modalError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput label="Kodu" value={form.employeeCode} disabled placeholder="Otomatik" />
          <FormInput label="Username" value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: String(e.target.value ?? '') }))} placeholder="username" />
          <FormInput label="Password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: String(e.target.value ?? '') }))} placeholder="password" />
          <FormInput label="İsim" value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} placeholder="Ali" />
          <FormInput label="Soyisim" value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} placeholder="Yılmaz" />
          <FormInput label="Mail" value={form.mail} onChange={(e) => setForm((p) => ({ ...p, mail: e.target.value }))} placeholder="ali.yilmaz@firma.com" />
          <FormInput
            label="TC"
            value={form.tc}
            inputMode="numeric"
            placeholder="11111111111"
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 11)
              setForm((p) => ({ ...p, tc: val }))
            }}
          />
          <FormInput
            label="Telefon"
            value={form.phone}
            inputMode="numeric"
            placeholder="0555 555 5555 555"
            onChange={(e) => {
              const val = formatPhoneNumber(e.target.value)
              setForm((p) => ({ ...p, phone: val }))
            }}
          />
          <FormInput label="Vergi No" value={form.taxNo} onChange={(e) => setForm((p) => ({ ...p, taxNo: e.target.value }))} placeholder="1234567890" />
          <FormInput label="Vergi Dairesi" value={form.taxOffice} onChange={(e) => setForm((p) => ({ ...p, taxOffice: e.target.value }))} placeholder="Çankaya" />

          <FormInput label="Banka Adı" value={form.bankName} onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))} placeholder="Ziraat / Garanti / İş Bankası" />
          <FormInput
            label="IBAN"
            value={form.iban}
            onChange={(e) => setForm((p) => ({ ...p, iban: formatIbanInput(e.target.value) }))}
            placeholder="TR00 0000 0000 0000 0000 0000 00"
          />

          <FormInput
            label="Giriş Tarihi"
            type="date"
            value={form.hireDate}
            onChange={(e) => setForm((p) => ({ ...p, hireDate: e.target.value }))}
            placeholder=""
          />

          <FormInput
            label="Çalışma Yenileme Günü"
            type="date"
            value={form.workPermitDay}
            onChange={(e) => setForm((p) => ({ ...p, workPermitDay: e.target.value }))}
            placeholder=""
          />

          <FormInput
            label="Maaşı"
            value={form.salary}
            inputMode="decimal"
            placeholder="0"
            onChange={(e) => {
              // Alan KURUS tasir (denetim md. A6). Eskiden `\D` suzgeci ondalik ayracini da
              // yiyordu: kullanici virgulu yazamiyor, maas tam sayiya yuvarlaniyordu.
              const cleaned = String(e.target.value ?? '').replace(/[^0-9.,]/g, '')
              setForm((p) => ({ ...p, salary: cleaned.length ? cleaned : '0' }))
            }}
          />

          <FormInput
            label="Yemek Tutarı"
            value={form.mealAmount}
            inputMode="decimal"
            placeholder="0"
            onChange={(e) => {
              const raw = String(e.target.value ?? '')
              const cleaned = raw.replace(/[^0-9.,]/g, '')
              setForm((p) => ({ ...p, mealAmount: cleaned.length ? cleaned : '0' }))
            }}
          />

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Maaş Günü</label>
            <select
              value={form.salaryDay}
              onChange={(e) => setForm((p) => ({ ...p, salaryDay: e.target.value }))}
              className="input-base"
            >
              {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 select-none md:col-span-2">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
            />
            Aktif
          </label>

          {/* ── Face Photo Capture (inline in create/edit modal) ── */}
          <div className="md:col-span-2 border-t border-gray-100 pt-4 mt-2">
            <div className="text-xs font-bold text-gray-700 mb-2">📷 Yüz Tanıma Kaydı (Opsiyonel)</div>

            {/* KVKK Consent */}
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 mb-3">
              <div className="text-[10px] text-amber-700 leading-relaxed">
                Yüz verisi biyometrik veri kapsamındadır (KVKK m.6). Fotoğraf saklanmaz, yalnızca
                matematiksel vektör kaydedilir.
              </div>
              <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={faceConsentGiven}
                  onChange={(e) => setFaceConsentGiven(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-amber-300"
                />
                <span className="text-[10px] font-semibold text-amber-800">
                  Açık rıza veriyorum
                </span>
              </label>
            </div>

            {faceConsentGiven && (
              <>
                {/* Camera */}
                <div
                  className="relative mx-auto w-full max-w-[340px] rounded-lg overflow-hidden bg-black mb-2"
                  style={{ aspectRatio: String(faceVideoAspect) }}
                >
                  <video
                    ref={faceVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  {!faceCameraReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                      <span className="text-[10px] text-gray-400">Kamera açılıyor...</span>
                    </div>
                  )}
                </div>
                <canvas ref={faceCanvasRef} style={{ display: 'none' }} />
                <button
                  type="button"
                  disabled={!faceCameraReady || faceCapturedImages.length >= 5}
                  onClick={captureFaceFrame}
                  className="w-full h-[30px] rounded-lg text-[11px] font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 transition disabled:opacity-40 mb-2"
                >
                  📸 Fotoğraf Çek ({faceCapturedImages.length}/5)
                </button>

                {/* Preview */}
                {faceCapturedImages.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {faceCapturedImages.map((img, idx) => (
                      <div key={idx} className="relative">
                        <img
                          src={img}
                          alt={`Foto ${idx + 1}`}
                          className="w-14 h-14 object-cover rounded-lg border border-gray-200"
                          style={{ transform: 'scaleX(-1)' }}
                        />
                        <button
                          type="button"
                          onClick={() => setFaceCapturedImages((prev) => prev.filter((_, i) => i !== idx))}
                          className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center hover:bg-red-600"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={closeModal}
            className="h-[34px] px-4 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition disabled:opacity-60"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submitModal()}
            className="h-[34px] px-4 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
          >
            {saving ? 'Kaydediliyor...' : modalMode === 'create' ? 'Oluştur' : 'Güncelle'}
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={leaveFormOpen}
        onClose={() => {
          setLeaveFormOpen(false)
        }}
        title="İzin Formu"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput label="Çalışan" value={leaveFormEmployeeName} disabled placeholder="-" />
          <div />

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">İzin Çıkış Tarihi/Saati</label>
            <input className="input-base" type="datetime-local" value={leaveFormStart} onChange={(e) => setLeaveFormStart(e.target.value)} />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Dönüş Tarihi/Saati</label>
            <input className="input-base" type="datetime-local" value={leaveFormReturn} onChange={(e) => setLeaveFormReturn(e.target.value)} />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Açıklama</label>
            <input className="input-base" value={leaveFormDescription} onChange={(e) => setLeaveFormDescription(e.target.value)} placeholder="Açıklama" />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={() => setLeaveFormOpen(false)} className="h-[34px] px-4 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition">
            Kapat
          </button>
          <button type="button" onClick={() => printLeaveFormFromState()} className="h-[34px] px-4 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition">
            PDF Oluştur
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={leaveOpen}
        onClose={() => {
          setLeaveOpen(false)
          setLeaveInlineError('')
        }}
        title="İzin İste"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput label="Çalışan" value={leaveEmployeeName} disabled placeholder="-" />
          <div />

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">İzin Çıkış Tarihi/Saati</label>
            <input
              className="input-base"
              type="datetime-local"
              value={leaveStart}
              onChange={(e) => {
                setLeaveStart(e.target.value)
                setLeaveInlineError('')
              }}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Dönüş Tarihi/Saati</label>
            <input
              className="input-base"
              type="datetime-local"
              value={leaveReturn}
              onChange={(e) => {
                setLeaveReturn(e.target.value)
                setLeaveInlineError('')
              }}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Açıklama</label>
            <input
              className="input-base"
              value={leaveDescription}
              onChange={(e) => {
                setLeaveDescription(e.target.value)
                setLeaveInlineError('')
              }}
              placeholder="Açıklama"
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          {leaveInlineError ? <div className="mr-auto text-xs font-semibold text-rose-700">{leaveInlineError}</div> : null}
          <button type="button" disabled={saving} onClick={() => setLeaveOpen(false)} className="h-[34px] px-4 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition disabled:opacity-60">
            Vazgeç
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (!leaveEmployeeId) {
                showPopup('error', 'Hata', 'Çalışan seçilemedi')
                return
              }
              if (!leaveStart || !leaveStart.trim() || !leaveReturn || !leaveReturn.trim()) {
                showPopup('info', 'Bilgi', 'Lütfen tarih ve saat seçin')
                return
              }

              const startIso = new Date(leaveStart).toISOString()
              const returnIso = new Date(leaveReturn).toISOString()
              if (Number.isNaN(new Date(startIso).getTime()) || Number.isNaN(new Date(returnIso).getTime())) {
                showPopup('error', 'Hata', 'Tarih formatı geçersiz')
                return
              }
              if (new Date(returnIso).getTime() <= new Date(startIso).getTime()) {
                showPopup('info', 'Bilgi', 'Dönüş tarihi çıkış tarihinden büyük olmalıdır')
                return
              }

              void (async () => {
                try {
                  setSaving(true)

                  const key = String(leaveEmployeeId)
                  const fetched = await fetchEmployeeLeavesByEmployee(leaveEmployeeId, { take: 2000 }).catch(() => [])
                  setLeavesByEmployeeId((p) => ({ ...p, [key]: fetched }))

                  const s = new Date(startIso).getTime()
                  const e = new Date(returnIso).getTime()
                  const hasOverlap = (fetched ?? []).some((lv: any) => {
                    const ls = new Date(String(lv?.leaveStartTime ?? '')).getTime()
                    const le = new Date(String(lv?.returnTime ?? '')).getTime()
                    if (!Number.isFinite(ls) || !Number.isFinite(le)) return false
                    return s <= le && e >= ls
                  })

                  if (hasOverlap) {
                    setLeaveInlineError('Bu tarihler arasında mevcut izin bulunmaktadır')
                    return
                  }

                  await createEmployeeLeave({
                    employeeId: leaveEmployeeId,
                    leaveStartTime: startIso,
                    returnTime: returnIso,
                    description: leaveDescription.trim() || undefined
                  })
                  setLeaveOpen(false)
                  showPopup('success', 'Başarılı', 'İzin kaydı oluşturuldu')

                  setLeaveFormEmployeeName(leaveEmployeeName || '-')
                  setLeaveFormStart(leaveStart)
                  setLeaveFormReturn(leaveReturn)
                  setLeaveFormDescription(leaveDescription.trim())
                  setLeaveFormOpen(true)
                } catch (e: any) {
                  const msg = String(e?.message ?? 'Bir hata oluştu')
                  setError(msg)
                  showPopup('error', 'Hata', msg)
                } finally {
                  setSaving(false)
                }
              })()
            }}
            className="h-[34px] px-4 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </Modal>


      <Modal
        isOpen={advanceFormOpen}
        onClose={() => {
          setAdvanceFormOpen(false)
        }}
        title="Avans Formu"
      >
        <div className="space-y-3">
          <div className="text-xs font-semibold text-gray-800">{advanceFormEmployeeName || '-'}</div>

          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <div className="px-3 py-2 text-xs font-bold text-gray-800 bg-gray-50">Geçmiş Avanslar</div>
            <div className="max-h-[360px] overflow-auto">
              {(advanceFormItems ?? []).length === 0 ? (
                <div className="px-3 py-3 text-xs text-gray-500">Avans kaydı yok</div>
              ) : (
                (advanceFormItems ?? []).map((p) => (
                  <div key={`adv-${p.id}`} className="px-3 py-2 border-t border-gray-100 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-gray-900">{Number(p.amount ?? 0).toLocaleString('tr-TR')} ₺</div>
                      <div className="mt-0.5 text-[11px] text-gray-500">{fmtDateOnly(String(p.paymentDate ?? ''))}</div>
                      {p.description ? <div className="mt-1 text-[11px] text-gray-600 whitespace-pre-line">{String(p.description)}</div> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const dateYmd = String(p.paymentDate ?? '').slice(0, 10)
                        printAdvanceForm({
                          employeeName: advanceFormEmployeeName || '-',
                          amount: Number(p.amount ?? 0),
                          dateYmd: dateYmd || todayYmd(),
                          reason: String(p.description ?? '')
                        })
                      }}
                      className="h-[28px] px-3 rounded text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition"
                    >
                      PDF Oluştur
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setAdvanceFormOpen(false)}
            className="h-[34px] px-4 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition"
          >
            Kapat
          </button>
        </div>
      </Modal>

      {/* ── Face Enrollment Modal ── */}
      <Modal isOpen={faceModalOpen} onClose={() => setFaceModalOpen(false)} title={`📷 Yüz Kaydı – ${faceEmployeeName}`}>
        <div className="space-y-4">
          {/* KVKK Consent */}
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
            <div className="text-xs font-semibold text-amber-800 mb-1">🔒 KVKK Bilgilendirme</div>
            <div className="text-[11px] text-amber-700 leading-relaxed">
              Yüz verisi biyometrik veri kapsamındadır (KVKK m.6). Fotoğrafınız saklanmaz, yalnızca
              matematiksel vektör (embedding) kaydedilir. Embedding'den yüz geri oluşturulamaz.
              Kaydınızı istediğiniz zaman sildirebilirsiniz.
            </div>
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={faceConsentGiven}
                onChange={(e) => setFaceConsentGiven(e.target.checked)}
                className="w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-[11px] font-semibold text-amber-800">
                Açık rıza veriyorum – biyometrik verimin işlenmesini kabul ediyorum.
              </span>
            </label>
          </div>

          {/* Existing enrollment info */}
          {faceHasExisting && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-blue-800">Mevcut yüz kaydı var</div>
                <div className="text-[11px] text-blue-600">{faceExistingCount} embedding kayıtlı</div>
              </div>
              <button
                type="button"
                disabled={faceSaving}
                onClick={() => void handleFaceDelete()}
                className="h-[30px] px-3 rounded-lg text-[11px] font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition disabled:opacity-50"
              >
                Yüz Verilerini Sil
              </button>
            </div>
          )}

          {/* Camera */}
          {faceConsentGiven && (
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-2">Kamera (farklı açılardan 3-5 fotoğraf çekin)</div>
              <div
                className="relative mx-auto w-full max-w-[400px] rounded-lg overflow-hidden bg-black"
                style={{ aspectRatio: String(faceVideoAspect) }}
              >
                <video
                  ref={faceVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                />
                {!faceCameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                    <span className="text-xs text-gray-400">Kamera açılıyor...</span>
                  </div>
                )}
              </div>
              <canvas ref={faceCanvasRef} style={{ display: 'none' }} />
              <button
                type="button"
                disabled={!faceCameraReady || faceCapturedImages.length >= 5}
                onClick={captureFaceFrame}
                className="mt-2 w-full h-[34px] rounded-lg text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 transition disabled:opacity-40"
              >
                📸 Fotoğraf Çek ({faceCapturedImages.length}/5)
              </button>
            </div>
          )}

          {/* Captured images preview */}
          {faceCapturedImages.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-2">Çekilen Fotoğraflar</div>
              <div className="flex gap-2 flex-wrap">
                {faceCapturedImages.map((img, idx) => (
                  <div key={idx} className="relative">
                    <img
                      src={img}
                      alt={`Fotoğraf ${idx + 1}`}
                      className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                      style={{ transform: 'scaleX(-1)' }}
                    />
                    <button
                      type="button"
                      onClick={() => setFaceCapturedImages((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center hover:bg-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setFaceModalOpen(false)}
              className="h-[34px] px-4 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition"
            >
              İptal
            </button>
            <button
              type="button"
              disabled={faceSaving || faceCapturedImages.length < 1 || !faceConsentGiven}
              onClick={() => void handleFaceEnroll()}
              className="h-[34px] px-4 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50"
            >
              {faceSaving ? 'Kaydediliyor...' : `Yüz Kaydı Oluştur (${faceCapturedImages.length} foto)`}
            </button>
          </div>
        </div>
      </Modal>

      
    </div>
  )
}
