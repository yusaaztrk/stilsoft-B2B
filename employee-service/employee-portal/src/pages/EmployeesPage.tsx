import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { API_BASE_URL, buildAuthHeaders } from '../config/api'
import Table, { type TableColumn } from '../components/Table'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import Modal from '../components/Modal'
import FormInput from '../components/forms/FormInput'
import ActionDropdown from '../components/ActionDropdown'
import { activateEmployee, createEmployee, deleteEmployee, fetchEmployees, fetchEmployeeWorkplaces, fetchEmployeeWorkTypes, fetchNextEmployeeCode, hardDeleteEmployee, updateEmployee, type EmployeeDto } from '../api/employees'
import { bulkMealPayment, bulkSalaryPayment, createEmployeePayment, deleteEmployeePayment, fetchEmployeePayments, fetchPaymentSettings } from '../api/employeePayments'
import ErpSourcePicker, { erpSourceError } from '../components/ErpSourcePicker'
import type { ErpPaymentSource } from '../api/employeePayments'
import { bulkPayPlannedBonusPlans, createEmployeeBonusPlan, deleteEmployeeBonusPlan, fetchEmployeeBonusPlans, undoPayEmployeeBonusPlan } from '../api/employeeBonusPlans'
import { deleteEmployeeMealPlan, fetchEmployeeMealPlans, undoPayEmployeeMealPlan } from '../api/employeeMealPlans'
import { createEmployeeLeave, deleteEmployeeLeave, fetchLeaveBalance, LEAVE_TYPES, type LeaveBalanceDto } from '../api/employeeLeaves'
import { fetchSchedules, type WorkScheduleDto } from '../api/workCalendar'
import { generateDemoEmployee } from '../utils/demoEmployee'
import { createEmployeeCheckIn, deleteEmployeeCheckIn, fetchEmployeeCheckInsByEmployee, updateEmployeeCheckIn, updateEmployeeCheckOut } from '../api/employeeCheckIns'
import { fetchEmployeeLeavesByEmployee } from '../api/employeeLeaves'
import { fetchAccrualDetail, type AccrualDayDto } from '../api/employeeAccruals'
import { enrollFace, hasFaceEnrollment, deleteFaceEnrollment } from '../api/faceAuth'
import { fetchEmployeePhotoIds } from '../api/employeePhotos'
import PersonelFotoDuzenle, { PersonelAvatar } from '../components/PersonelFoto'
import { ChevronDown, ChevronRight, TrendingUp, Users, UserCheck, DollarSign, Coffee, Award, Calendar, Clock, Activity, HelpCircle, MapPin, LogIn, LogOut, Camera, Upload, AlertCircle } from 'lucide-react'


type Row = EmployeeDto & { actions: string }

/** Uzun formu okunur tutmak icin bolum basligi. */
function FormSection({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="md:col-span-2 pt-2 first:pt-0">
      <div className="flex items-baseline gap-2 border-b border-[#eae6dd] pb-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8c6538]">{title}</h4>
        {hint ? <span className="text-[10px] text-neutral-400">{hint}</span> : null}
      </div>
    </div>
  )
}

type FormState = {
  employeeCode: string
  username: string
  password: string
  confirmPassword: string
  firstName: string
  lastName: string
  mail: string
  tc: string
  phone: string
  taxNo: string
  taxOffice: string
  bankName: string
  iban: string
  bankAccountNo: string
  customerNo: string
  hireDate: string

  workPermitDay: string
  workPermitStartDate: string
  workPermitRenewalFee: string
  passportNo: string
  nationality: string
  birthDate: string
  birthPlace: string
  providentFundNo: string
  socialSecurityNo: string
  ssdNo: string
  address: string
  addressDetail: string
  salary: string
  salaryDay: string
  mealAmount: string
  workType: string
  workplace: string
  locationSettingId: string
  hasMealAllowance: boolean
  workScheduleSettingId: string
  annualLeaveOverrideDays: string
  isActive: boolean
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
  /** Maaş ödemesinin dönemi (YYYY-MM). Ödeme tarihi değil, hangi ayın maaşı olduğu. */
  salaryPeriod?: string | null
  isCancelled?: boolean
  createdAt: string
  createUser: string
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
  return raw
}


const ResolvedLocation: React.FC<{
  latitude: number
  longitude: number
  dbCity?: string | null
  dbDistrict?: string | null
}> = ({ latitude, longitude, dbCity, dbDistrict }) => {
  const [address, setAddress] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    if (dbCity || dbDistrict) {
      const cityStr = String(dbCity ?? '').trim()
      const distStr = String(dbDistrict ?? '').trim()
      const combined = [cityStr, distStr].filter(Boolean).join(' / ')
      if (combined) {
        setAddress(combined)
        return
      }
    }

    if (!latitude || !longitude || (latitude === 0 && longitude === 0)) {
      setAddress('Konum Bilgisi Yok')
      return
    }

    const latFixed = Number(latitude).toFixed(4)
    const lngFixed = Number(longitude).toFixed(4)
    const cacheKey = `addr_${latFixed}_${lngFixed}`
    const cached = sessionStorage.getItem(cacheKey)

    if (cached) {
      setAddress(cached)
      return
    }

    let active = true
    const fetchAddress = async () => {
      try {
        setLoading(true)
        await new Promise((r) => setTimeout(r, Math.random() * 500))
        if (!active) return

        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`
        const res = await fetch(url, {
          headers: {
            'Accept-Language': 'tr,en'
          }
        })
        if (!res.ok) throw new Error()
        const json = await res.json()
        
        const addr = json?.address
        let resolved = ''
        if (addr) {
          // Sunucudaki çözümle aynı kural (ReverseGeocoder): KKTC'de il yalnız `state_district`te
          // ("Lefkoşa ilçesi"), ilçe yerine köy adı belediyeden önce gelir.
          const city =
            addr.province || addr.city || addr.town || addr.state || addr.county ||
            String(addr.state_district || '').replace(/\s+(ilçesi|İlçesi|District)$/, '') || ''
          const district = addr.suburb || addr.district || addr.city_district || addr.township || addr.county || addr.village || addr.municipality || ''
          resolved = [city, district].filter(Boolean).join(' / ')
        }
        if (!resolved) {
          resolved = `${latFixed}, ${lngFixed}`
        }

        if (active) {
          sessionStorage.setItem(cacheKey, resolved)
          setAddress(resolved)
        }
      } catch {
        if (active) {
          setAddress(`Konum (${latFixed}, ${lngFixed})`)
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void fetchAddress()
    return () => {
      active = false
    }
  }, [latitude, longitude, dbCity, dbDistrict])

  if (loading) {
    return <span className="text-[10px] text-gray-400 italic">Konum çözümleniyor...</span>
  }

  return <span className="font-semibold text-gray-700">{address || 'Bilinmeyen Konum'}</span>
}


export default function EmployeesPage() {
  const navigate = useNavigate()

  const logout = () => {
    try {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userName')
      localStorage.removeItem('currentCode')
      localStorage.removeItem('tenantCode')
      localStorage.removeItem('tenantName')
      sessionStorage.removeItem('userName')
    } catch {
    }
    navigate('/login', { replace: true })
  }

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
    confirmPassword: '',
    firstName: '',
    lastName: '',
    mail: '',
    tc: '',
    phone: '',
    taxNo: '',
    taxOffice: '',
    bankName: '',
    iban: '',
    bankAccountNo: '',
    customerNo: '',
    hireDate: '',

    workPermitDay: '',
    workPermitStartDate: '',
    workPermitRenewalFee: '0',
    passportNo: '',
    nationality: '',
    birthDate: '',
    birthPlace: '',
    providentFundNo: '',
    socialSecurityNo: '',
    ssdNo: '',
    address: '',
    addressDetail: '',
    salary: '50000',
    salaryDay: '1',
    mealAmount: '7000',
    workType: '',
    workplace: '',
    locationSettingId: '',
    hasMealAllowance: true,
    workScheduleSettingId: '',
    annualLeaveOverrideDays: '',
    isActive: true
  }

  const [workTypes, setWorkTypes] = useState<string[]>([])
  const [workplaces, setWorkplaces] = useState<string[]>([])
  const [schedules, setSchedules] = useState<WorkScheduleDto[]>([])
  const [workTypeMode, setWorkTypeMode] = useState<'select' | 'new'>('select')
  const [workTypeSelected, setWorkTypeSelected] = useState('')
  const [workTypeNew, setWorkTypeNew] = useState('')

  const getLeaveTypeLabel = (typeNum?: number | string | null) => {
    const num = Number(typeNum) || 1
    const found = LEAVE_TYPES.find((t) => t.value === num)
    return found ? found.label : 'Yıllık İzin'
  }

  const printLeaveFormFromItem = (item: { employeeName: string; startIso: string; returnIso: string; description: string; leaveType?: number | string }) => {
    const printedAt = new Date().toLocaleString('tr-TR')
    const name = item.employeeName || '-'
    const startText = fmtDateTime(item.startIso)
    const returnText = fmtDateTime(item.returnIso)
    const desc = item.description || '-'
    const leaveTypeLabel = getLeaveTypeLabel(item.leaveType)

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
      .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 12px; background: #EEF2FF; color: #4338CA; border: 1px solid #C7D2FE; }
      .line { height: 1px; background: #E5E7EB; margin: 16px 0; }
      .note { font-size: 12px; color: #374151; white-space: pre-wrap; margin-top: 12px; }
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
        <div class="row"><div class="label">Çalışan</div><div class="value"><strong>${escapeHtml(name)}</strong></div></div>
        <div class="row"><div class="label">İzin Türü</div><div class="value"><span class="badge">${escapeHtml(leaveTypeLabel)}</span></div></div>
        <div class="row"><div class="label">İzin Başlangıç Tarihi/Saati</div><div class="value">${escapeHtml(startText)}</div></div>
        <div class="row"><div class="label">Dönüş Tarihi/Saati</div><div class="value">${escapeHtml(returnText)}</div></div>
        <div class="line"></div>
        <div class="row"><div class="label">Açıklama</div><div class="value">${escapeHtml(desc)}</div></div>
        <div class="line"></div>
        <div class="note">${escapeHtml(name)} personeli ${escapeHtml(startText)} - ${escapeHtml(returnText)} tarih aralığında <strong>${escapeHtml(leaveTypeLabel)}</strong> kullanacaktır.</div>
        <div class="sign">
          <div class="signBox">Onaylayan (Yetkili) İmza</div>
          <div class="signBox">Talep Eden (Çalışan) İmza</div>
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
    const leaveTypeLabel = getLeaveTypeLabel(leaveFormLeaveType)
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
      .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 12px; background: #EEF2FF; color: #4338CA; border: 1px solid #C7D2FE; }
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
        <div class="row"><div class="label">Çalışan</div><div class="value"><strong>${escapeHtml(name)}</strong></div></div>
        <div class="row"><div class="label">İzin Türü</div><div class="value"><span class="badge">${escapeHtml(leaveTypeLabel)}</span></div></div>
        <div class="row"><div class="label">İzin Çıkış Tarihi/Saati</div><div class="value">${escapeHtml(fmtDateTime(startIso))}</div></div>
        <div class="row"><div class="label">Dönüş Tarihi/Saati</div><div class="value">${escapeHtml(fmtDateTime(returnIso))}</div></div>
        <div class="line"></div>
        <div class="row"><div class="label">Açıklama</div><div class="value">${escapeHtml(desc)}</div></div>
        <div class="line"></div>
        <div class="note">${escapeHtml(name)} personeli ${escapeHtml(fmtDateTime(startIso))} - ${escapeHtml(fmtDateTime(returnIso))} tarih aralığında <strong>${escapeHtml(leaveTypeLabel)}</strong> izinlidir.</div>
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
  /** Mesai konumları — personel karti bir konuma bağlanır, boşsa hepsinden giriş yapabilir. */
  const [locations, setLocations] = useState<Array<{ id: number; name: string }>>([])
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
  // Fotoğrafı olan personeller (2026-10-16) — liste yalnız bunlar için görsel ister.
  const [photoIds, setPhotoIds] = useState<Set<number>>(new Set())
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
          salaryPeriod: x?.salaryPeriod ? String(x.salaryPeriod) : null,
          isCancelled: Boolean(x?.isCancelled ?? false),
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

    const compact = cleaned.slice(0, 26)
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

    return cleaned.slice(0, 26)
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
  // Avansın çıkacağı B2B kasa/bankası (son seçim hatırlanır).
  const [cashAdvanceErpSource, setCashAdvanceErpSource] = useState<ErpPaymentSource | null>(null)


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
  const [leaveType, setLeaveType] = useState<number>(1)
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalanceDto | null>(null)

  // Mesai tanımları personel kartındaki seçim listesi için bir kez yüklenir.
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        setSchedules(await fetchSchedules(controller.signal))
      } catch {
        setSchedules([])
      }
    })()
    return () => controller.abort()
  }, [])

  // İzin ekranı açıldığında yıllık izin bakiyesi getirilir. Bakiye kıdeme göre hesaplanır
  // (4857/53: 1-5 yıl 14, 5-15 yıl 20, 15+ yıl 26 gün) ve sunucu bakiyeyi aşan talebi reddeder.
  useEffect(() => {
    if (!leaveOpen || !leaveEmployeeId) {
      setLeaveBalance(null)
      return
    }

    const controller = new AbortController()
    void (async () => {
      try {
        const balance = await fetchLeaveBalance(leaveEmployeeId, undefined, controller.signal)
        setLeaveBalance(balance)
      } catch {
        setLeaveBalance(null)
      }
    })()

    return () => controller.abort()
  }, [leaveOpen, leaveEmployeeId])

  const [leaveFormOpen, setLeaveFormOpen] = useState(false)
  const [leaveFormEmployeeName, setLeaveFormEmployeeName] = useState('')
  const [leaveFormStart, setLeaveFormStart] = useState('')
  const [leaveFormReturn, setLeaveFormReturn] = useState('')
  const [leaveFormDescription, setLeaveFormDescription] = useState('')
  const [leaveFormLeaveType, setLeaveFormLeaveType] = useState<number>(1)

  const [checkInsByEmployeeId, setCheckInsByEmployeeId] = useState<Record<string, any[]>>({})

  const [leavesByEmployeeId, setLeavesByEmployeeId] = useState<Record<string, any[]>>({})
  const [gocLoadingByEmployeeId, setGocLoadingByEmployeeId] = useState<Record<string, boolean>>({})

  // ── Face enrollment state ──
  // ── Face enrollment state ──
  const [faceModalOpen, setFaceModalOpen] = useState(false)
  const [faceEmployeeId, setFaceEmployeeId] = useState<number | null>(null)
  const [faceEmployeeName, setFaceEmployeeName] = useState('')
  const [faceCapturedImages, setFaceCapturedImages] = useState<string[]>([])
  const [faceHasExisting, setFaceHasExisting] = useState(false)
  const [faceExistingCount, setFaceExistingCount] = useState(0)
  const [faceSaving, setFaceSaving] = useState(false)
  const [faceConsentGiven, setFaceConsentGiven] = useState(true)
  const faceVideoRef = React.useRef<HTMLVideoElement>(null)
  const faceCanvasRef = React.useRef<HTMLCanvasElement>(null)
  const faceStreamRef = React.useRef<MediaStream | null>(null)
  const [faceCameraReady, setFaceCameraReady] = useState(false)
  /**
   * Canli akisin GERCEK en/boy orani (videoWidth/videoHeight).
   * Sahneyi sabit bir yukseklikle kirpmak goruntuyu bozuyordu: kaynak 4:3 iken kutu
   * 660x280 oluyor ve `object-cover` basi/ceneyi kesiyordu. Kutuya akisin kendi oranini
   * verince ne kirpma ne de esneme kaliyor; ustelik `captureFaceFrame` TUM kareyi
   * kaydettigi icin ekranda gorunen sey ile kaydedilen sey birebir ayni oluyor.
   */
  const [faceVideoAspect, setFaceVideoAspect] = useState(4 / 3)
  /**
   * "Yeni Çalışan" formunda canlı kamera açık mı?
   *
   * "Kameradan Çek" bir dosya seçiciydi (input capture="user"); masaüstü tarayıcılar
   * `capture`'ı yok saydığı için galeri açılıyordu. Artık gerçek kamerayı açar.
   */
  const [inlineFaceCamOpen, setInlineFaceCamOpen] = useState(false)
  const [faceCameraError, setFaceCameraError] = useState('')

  const openFaceModal = async (empId: number, empName: string) => {
    setFaceEmployeeId(empId)
    setFaceEmployeeName(empName)
    setFaceCapturedImages([])
    setFaceConsentGiven(true)
    setFaceSaving(false)
    setFaceCameraReady(false)
    setFaceCameraError('')
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

  const closeFaceModal = () => {
    faceStreamRef.current?.getTracks().forEach((t) => t.stop())
    faceStreamRef.current = null
    setFaceCameraReady(false)
    setFaceCameraError('')
    setFaceCapturedImages([])
    setFaceModalOpen(false)
  }

  /**
   * Akışı <video> elementine bağlar.
   *
   * Bağlama işi kamerayı açan effect'in içindeydi; ama form içindeki video yalnızca
   * `faceCameraReady` true olunca mount ediliyordu ve o an henüz false olduğu için
   * `faceVideoRef.current` NULL'du — srcObject hiç atanmıyor, kamera izni verilmiş olsa
   * bile görüntü siyah kalıyordu. Element mount edildikten SONRA çalışan ayrı bir effect
   * bu sırayı garanti eder.
   */
  useEffect(() => {
    const video = faceVideoRef.current
    const stream = faceStreamRef.current
    if (!video || !stream) return
    if (video.srcObject === stream) return

    video.srcObject = stream
    void video.play().catch(() => {
      // Otomatik oynatma engellenirse kullanici etkilesimi zaten var; sessiz gec.
    })

    const syncAspect = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setFaceVideoAspect(video.videoWidth / video.videoHeight)
      }
    }
    syncAspect()
    video.addEventListener('loadedmetadata', syncAspect)
    video.addEventListener('resize', syncAspect)
    return () => {
      video.removeEventListener('loadedmetadata', syncAspect)
      video.removeEventListener('resize', syncAspect)
    }
  }, [faceCameraReady, inlineFaceCamOpen, faceModalOpen])

  // Camera start/stop — hem "Yüz Kaydı" modali hem "Yeni Çalışan" formundaki canlı kamera
  useEffect(() => {
    const wantCamera = faceModalOpen || inlineFaceCamOpen
    if (!wantCamera) {
      faceStreamRef.current?.getTracks().forEach((t) => t.stop())
      faceStreamRef.current = null
      setFaceCameraReady(false)
      return
    }

    let cancelled = false
    const startCam = async () => {
      try {
        setFaceCameraError('')
        setFaceCameraReady(false)

        const nav = navigator as any
        const getUserMedia =
          navigator?.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices) ||
          nav.getUserMedia?.bind(nav) ||
          nav.webkitGetUserMedia?.bind(nav) ||
          nav.mozGetUserMedia?.bind(nav)

        if (!getUserMedia) {
          setFaceCameraReady(false)
          setFaceCameraError('Mobil tarayıcınız HTTP üzerinden canlı video akışını kısıtlıyor. Aşağıdaki butonları kullanarak doğrudan fotoğraf çekebilir veya yükleyebilirsiniz.')
          return
        }

        const stream = await getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        })

        if (cancelled) {
          stream.getTracks().forEach((t: any) => t.stop())
          return
        }

        faceStreamRef.current = stream

        if (faceVideoRef.current) {
          faceVideoRef.current.srcObject = stream
          try {
            await faceVideoRef.current.play()
          } catch {
            // ignore
          }
        }
        setFaceCameraReady(true)
      } catch (err: any) {
        if (!cancelled) {
          setFaceCameraReady(false)
          setFaceCameraError(err?.message || 'Kamera açılamadı. Aşağıdaki butonları kullanarak doğrudan telefon kamerasını açabilir veya galeriden fotoğraf seçebilirsiniz.')
        }
      }
    }

    const timer = setTimeout(() => {
      void startCam()
    }, 60)

    return () => {
      cancelled = true
      clearTimeout(timer)
      faceStreamRef.current?.getTracks().forEach((t) => t.stop())
      faceStreamRef.current = null
      setFaceCameraReady(false)
    }
  }, [faceModalOpen, inlineFaceCamOpen])


  const captureFaceFrame = () => {
    const video = faceVideoRef.current
    const canvas = faceCanvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth || 480
    canvas.height = video.videoHeight || 360
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    const b64 = canvas.toDataURL('image/jpeg', 0.82)
    setFaceCapturedImages((prev) => {
      if (prev.length >= 5) return prev
      return [...prev, b64]
    })
  }

  const processImageFile = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Dosya okunamadı'))
      reader.onload = (ev) => {
        const src = ev.target?.result as string
        if (!src) return reject(new Error('Görsel yüklenemedi'))
        const img = new Image()
        img.onerror = () => reject(new Error('Görsel formatı okunamadı'))
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            const maxDim = 640
            let w = img.width
            let h = img.height
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round((h * maxDim) / w)
                w = maxDim
              } else {
                w = Math.round((w * maxDim) / h)
                h = maxDim
              }
            }
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')
            if (!ctx) return reject(new Error('Canvas oluşturulamadı'))
            ctx.drawImage(img, 0, 0, w, h)
            const b64 = canvas.toDataURL('image/jpeg', 0.82)
            resolve(b64)
          } catch (err) {
            reject(err)
          }
        }
        img.src = src
      }
      reader.readAsDataURL(file)
    })
  }

  const handleFaceFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const fileList = Array.from(files).slice(0, 5)
    e.target.value = ''

    try {
      const processed: string[] = []
      for (const f of fileList) {
        if (processed.length + faceCapturedImages.length >= 5) break
        const b64 = await processImageFile(f)
        if (b64) processed.push(b64)
      }
      if (processed.length > 0) {
        setFaceCapturedImages((prev) => {
          const combined = [...prev, ...processed]
          return combined.slice(0, 5)
        })
      }
    } catch (err: any) {
      showPopup('error', 'Hata', 'Fotoğraf işlenirken hata oluştu: ' + (err?.message || ''))
    }
  }



  const handleFaceEnroll = async () => {
    if (!faceEmployeeId || faceCapturedImages.length < 1 || !faceConsentGiven) return
    try {
      setFaceSaving(true)
      const res = await enrollFace(faceEmployeeId, faceCapturedImages)
      // Cekilen kare sayisini degil, GERCEKTEN kaydedilen sayiyi soyle: bir kare yuz
      // bulunamadigi icin elenmis olabilir.
      const note = res.failures.length > 0 ? ` (${res.failures.length} fotoğrafta yüz bulunamadı, atlandı)` : ''
      showPopup('success', 'Başarılı', `${faceEmployeeName} için ${res.count} yüz kaydı oluşturuldu${note}`)
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

  const loadRows = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchEmployees({ includeInactive: true })
      setRows((data ?? []).map((x) => ({ ...x, actions: '' })))
      void fetchEmployeePhotoIds().then(setPhotoIds).catch(() => undefined)
    } catch (e: any) {
      const msg = String(e?.message ?? '')
      if (msg === 'FORBIDDEN_EMPLOYEES_PAGE') {
        const as = String(localStorage.getItem('portalLoginAs') ?? '').trim().toLowerCase() === 'employee' ? 'employee' : 'admin'
        if (as === 'employee') {
          const tenant = String(localStorage.getItem('tenantCode') ?? '').trim()
          navigate(tenant ? `/qr-checkin?tenant=${encodeURIComponent(tenant)}` : '/qr-checkin', { replace: true })
          return
        }

        setError('Bu sayfaya erişim yetkiniz yok.')
        setRows([])
        return
      }
      setError(String(e?.message ?? 'Bir hata oluştu'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRows()
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/EmployeeLocationSettings`, {
          headers: buildAuthHeaders(false),
          signal: ac.signal
        })
        if (!res.ok) return
        const json = await res.json()
        setLocations(Array.isArray(json?.data) ? json.data : [])
      } catch {
        setLocations([])
      }
    })()
    return () => ac.abort()
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

  /**
   * BU AYIN MAAŞI ÖDENDİ Mİ — DÖNEMDEN (2026-10-16 kullanıcı bildirimi: "bu ayı ödemedik ama yeşil yandı").
   *
   * Eskiden ödeme TARİHİNE bakılıyordu: Eylül maaşı 1 Ekim'de ödenince satır bütün Ekim boyunca yeşil
   * yanıyor, Ekim maaşı ödenmiş gibi görünüyordu. Artık ödemenin DÖNEMİNE bakılır: yeşil = bu ayın
   * dönemine (YYYY-MM) maaş ödemesi var. Dönemi olmayan eski kayıtlarda ödeme tarihi kullanılır.
   */
  const currentPeriod = () => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }

  const isPaidThisMonth = (employeeId: number) => {
    const period = currentPeriod()
    return getPaymentsForEmployee(employeeId).some((p) => {
      if (p.kind !== 'salary' || p.isCancelled) return false
      if (p.salaryPeriod) return p.salaryPeriod === period
      const d = new Date(p.paymentDate)
      return !Number.isNaN(d.getTime()) && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === period
    })
  }

  const isGreenRow = (row: Row) => isPaidThisMonth(row.id)

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
    setWorkTypeMode('select')
    setWorkTypeSelected('')
    setWorkTypeNew('')
    setFaceCapturedImages([])
    setFaceConsentGiven(false)
    setInlineFaceCamOpen(false)
    // Yeni kayitta mevcut yuz verisi olamaz; onceki duzenlemeden kalan durum temizlenir.
    setFaceEmployeeId(null)
    setFaceHasExisting(false)
    setFaceExistingCount(0)
    setModalOpen(true)
  }

  /**
   * Formu ornek (test) verisiyle doldurur.
   *
   * Uretilen TC gercek algoritmaya uygun, telefon 11 hane, kullanici adi ve e-posta
   * benzersiz; boylece kayit sunucu dogrulamalarina takilmadan gecer.
   */
  const fillWithDemoData = () => {
    const demo = generateDemoEmployee()

    setForm((p) => ({
      ...p,
      username: demo.username,
      password: demo.password,
      confirmPassword: demo.password,
      firstName: demo.firstName,
      lastName: demo.lastName,
      mail: demo.mail,
      tc: demo.tc,
      phone: demo.phone,
      taxNo: demo.taxNo,
      taxOffice: demo.taxOffice,
      bankName: demo.bankName,
      iban: formatIbanInput(demo.iban),
      hireDate: demo.hireDate,
      workPermitDay: demo.workPermitDay,
      workPermitStartDate: demo.workPermitStartDate,
      passportNo: demo.passportNo,
      nationality: demo.nationality,
      birthDate: demo.birthDate,
      birthPlace: demo.birthPlace,
      providentFundNo: demo.providentFundNo,
      socialSecurityNo: demo.socialSecurityNo,
      ssdNo: demo.ssdNo,
      address: demo.address,
      addressDetail: demo.addressDetail,
      workPermitRenewalFee: '0',
      salary: demo.salary,
      salaryDay: demo.salaryDay,
      mealAmount: demo.mealAmount,
      workType: demo.workType,
      isActive: true
    }))

    setWorkTypeMode('new')
    setWorkTypeNew(demo.workType)
    setWorkTypeSelected('')
    setModalError(null)
  }

  /** Ornek veriyle dolu "Yeni Calisan" ekranini acar; tek tusla kaydedilebilir. */
  const openAutoCreateModal = () => {
    openCreateModal()
    fillWithDemoData()
  }

  const openEditModal = (row: Row) => {
    setModalError(null)
    setModalMode('edit')
    setEditId(row.id)
    const currentWorkType = String((row as any)?.workType ?? '').trim()
    setForm({
      employeeCode: String(row.employeeCode ?? ''),
      username: String((row as any).username ?? ''),
      password: '',
      confirmPassword: '',
      firstName: String(row.firstName ?? ''),
      lastName: String(row.lastName ?? ''),
      mail: String(row.mail ?? ''),
      tc: String(row.tc ?? ''),
      phone: String(row.phone ?? ''),
      taxNo: String(row.taxNo ?? ''),
      taxOffice: String(row.taxOffice ?? ''),
      bankName: String((row as any).bankName ?? ''),
      iban: formatIbanInput(String((row as any).iban ?? '')),
      bankAccountNo: String((row as any).bankAccountNo ?? ''),
      customerNo: String((row as any).customerNo ?? ''),
      hireDate: fmtYmd((row as any).hireDate ?? null),

      workPermitDay: fmtYmd((row as any).workPermitDay ?? null),
      workPermitStartDate: fmtYmd((row as any).workPermitStartDate ?? null),
      workPermitRenewalFee: String((row as any).workPermitRenewalFee ?? 0),
      passportNo: String((row as any).passportNo ?? ''),
      nationality: String((row as any).nationality ?? ''),
      birthDate: fmtYmd((row as any).birthDate ?? null),
      birthPlace: String((row as any).birthPlace ?? ''),
      providentFundNo: String((row as any).providentFundNo ?? ''),
      socialSecurityNo: String((row as any).socialSecurityNo ?? ''),
      ssdNo: String((row as any).ssdNo ?? ''),
      address: String((row as any).address ?? ''),
      addressDetail: String((row as any).addressDetail ?? ''),
      salary: String(row.salary ?? 0),
      salaryDay: String(row.salaryDay ?? 1),
      mealAmount: String((row as any).mealAmount ?? 0),
      workType: currentWorkType,
      workplace: String((row as any).workplace ?? ''),
      locationSettingId: (row as any).locationSettingId != null ? String((row as any).locationSettingId) : '',
      hasMealAllowance: (row as any).hasMealAllowance !== false,
      workScheduleSettingId: (row as any).workScheduleSettingId ? String((row as any).workScheduleSettingId) : '',
      annualLeaveOverrideDays:
        (row as any).annualLeaveOverrideDays != null ? String((row as any).annualLeaveOverrideDays) : '',
      isActive: Boolean(row.isActive)
    })
    setWorkTypeMode('select')
    setWorkTypeSelected(currentWorkType)
    setWorkTypeNew('')
    setFaceCapturedImages([])
    setFaceConsentGiven(false)
    setInlineFaceCamOpen(false)
    setModalOpen(true)

    /*
     * Mevcut yuz kaydi bilgisi BURADA da yukleniyor.
     *
     * Yuz kaydi iki ayri yerden yapilabiliyor: satirdaki "Yuz Kaydi" menusu ve bu duzenleme
     * formu. Bilgi yalnizca menudeki modalda gosteriliyordu; formdan bakan kullanici kaydin
     * olup olmadigini goremiyor, silemiyor ve ustune yeni kayit ekliyordu.
     */
    setFaceEmployeeId(row.id)
    setFaceHasExisting(false)
    setFaceExistingCount(0)
    void (async () => {
      try {
        const res = await hasFaceEnrollment(row.id)
        setFaceHasExisting(res.hasFace)
        setFaceExistingCount(res.count)
      } catch {
        setFaceHasExisting(false)
        setFaceExistingCount(0)
      }
    })()

    void (async () => {
      try {
        const list = await fetchEmployeeWorkTypes()
        setWorkTypes(list ?? [])
      } catch {
        setWorkTypes([])
      }
    })()
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
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchEmployeeWorkTypes({ signal: ac.signal })
        setWorkTypes(list ?? [])
      } catch {
        setWorkTypes([])
      }
      try {
        const places = await fetchEmployeeWorkplaces({ signal: ac.signal })
        setWorkplaces(places ?? [])
      } catch {
        setWorkplaces([])
      }
    })()
    return () => ac.abort()
  }, [modalOpen])

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
        workScheduleSettingId: form.workScheduleSettingId ? Number(form.workScheduleSettingId) : null,
        annualLeaveOverrideDays: form.annualLeaveOverrideDays ? Number(form.annualLeaveOverrideDays) : null,
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        mail: form.mail.trim() || null,
        tc: form.tc.trim() || null,
        phone: form.phone.trim() || null,
        taxNo: form.taxNo.trim() || null,
        taxOffice: form.taxOffice.trim() || null,
        bankName: form.bankName.trim() || null,
        iban: form.iban && form.iban.trim() ? normalizeIbanForApi(form.iban) : null,
        bankAccountNo: form.bankAccountNo.trim() || null,
        customerNo: form.customerNo.trim() || null,
        hireDate: form.hireDate && form.hireDate.trim() ? new Date(`${form.hireDate.trim()}T00:00:00`).toISOString() : null,

        workPermitDay: form.workPermitDay && form.workPermitDay.trim() ? new Date(`${form.workPermitDay.trim()}T00:00:00`).toISOString() : null,
        workPermitStartDate: form.workPermitStartDate && form.workPermitStartDate.trim() ? new Date(`${form.workPermitStartDate.trim()}T00:00:00`).toISOString() : null,
        birthDate: form.birthDate && form.birthDate.trim() ? new Date(`${form.birthDate.trim()}T00:00:00`).toISOString() : null,
        passportNo: form.passportNo.trim() || null,
        nationality: form.nationality.trim() || null,
        birthPlace: form.birthPlace.trim() || null,
        providentFundNo: form.providentFundNo.trim() || null,
        socialSecurityNo: form.socialSecurityNo.trim() || null,
        ssdNo: form.ssdNo.trim() || null,
        address: form.address.trim() || null,
        addressDetail: form.addressDetail.trim() || null,
        workPermitRenewalFee: Math.max(0, Number(String(form.workPermitRenewalFee ?? '0').trim().replace(',', '.')) || 0),
        salary: Math.max(0, parseMoneyInput(form.salary)),
        salaryDay: Math.min(31, Math.max(1, Math.trunc(Number(String(form.salaryDay ?? '1').trim()) || 1))),
        mealAmount: Math.max(0, parseMoneyInput(form.mealAmount)),
        workType: (() => {
          if (workTypeMode === 'new') return workTypeNew.trim() || null
          return workTypeSelected.trim() || null
        })(),
        workplace: form.workplace.trim() || null,
        locationSettingId: form.locationSettingId ? Number(form.locationSettingId) : null,
        hasMealAllowance: form.hasMealAllowance,
        isActive: form.isActive
      }

      if (payload.mail && !payload.mail.includes('@')) {
        setModalError('Geçerli bir email adresi giriniz')
        return
      }

      if (form.password || form.confirmPassword) {
        if (form.password !== form.confirmPassword) {
          setModalError('Şifreler eşleşmiyor!')
          return
        }
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
      // Yuz kaydi calisan olusturmayi engellemez ama SESSIZ de gecilmez: eskiden hata
      // yutuluyor, buna ragmen basari mesaji "+5 yuz kaydi" diyordu. Kullanici kaydin
      // olustugunu saniyor, sonra tanima calismiyordu.
      let faceEnrolled = 0
      let faceError: string | null = null
      if (faceConsentGiven && faceCapturedImages.length > 0 && createdEmployeeId) {
        try {
          const res = await enrollFace(createdEmployeeId, faceCapturedImages)
          faceEnrolled = res.count
        } catch (faceErr: any) {
          faceError = String(faceErr?.message ?? 'Yüz kaydı oluşturulamadı')
        }
      }

      setModalOpen(false)
      await loadRows()
      const base = modalMode === 'create' ? 'Çalışan oluşturuldu' : 'Çalışan güncellendi'
      if (faceError) {
        showPopup('error', 'Çalışan kaydedildi, yüz kaydı olmadı', `${base}. Yüz kaydı yapılamadı: ${faceError} — satırdaki "Yüz Kaydı" ile tekrar deneyebilirsiniz.`)
      } else {
        showPopup('success', 'Başarılı', base + (faceEnrolled > 0 ? ` + ${faceEnrolled} yüz kaydı` : ''))
      }
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
      {
        key: 'firstName',
        label: 'İsim',
        searchable: true,
        render: (v: any, row: any) => (
          <span className="inline-flex items-center gap-2">
            <PersonelAvatar
              employeeId={Number(row?.id ?? 0)}
              hasPhoto={photoIds.has(Number(row?.id ?? 0))}
              name={`${String(row?.firstName ?? '')} ${String(row?.lastName ?? '')}`}
              size={26}
            />
            <span>{String(v ?? '')}</span>
          </span>
        )
      },
      { key: 'lastName', label: 'Soyisim', searchable: true },
      { key: 'mail', label: 'Mail', searchable: true },
      { key: 'tc', label: 'TC', searchable: true },
      { key: 'phone', label: 'Telefon', searchable: true },
      { key: 'taxNo', label: 'Vergi No', searchable: true },
      { key: 'taxOffice', label: 'Vergi Dairesi', searchable: true },
      { key: 'bankName', label: 'Banka Adı', searchable: true },
      { key: 'iban', label: 'IBAN', searchable: true },
      { key: 'workplace', label: 'İşyeri', searchable: true },
      { key: 'nationality', label: 'Uyruk', searchable: true },
      { key: 'passportNo', label: 'Pasaport No', searchable: true },
      { key: 'socialSecurityNo', label: 'Sigorta No', searchable: true },
      { key: 'providentFundNo', label: 'İhtiyat No', searchable: true },
      {
        key: 'hireDate',
        label: 'İşe Başlangıç',
        searchable: true,
        render: (v) => {
          const s = String(v ?? '').trim()
          if (!s) return ''
          return fmtDateOnly(s)
        }
      },
      {
        key: 'workPermitDay',
        label: 'İzin Bitiş',
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
                      <span className="truncate">Avans / Prim</span>
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
    [expandedById, selectedIds, photoIds]
  )

  const allSelected = useMemo(() => {
    if (!visibleRows.length) return false
    return visibleRows.every((r) => selectedIds.has(r.id))
  }, [selectedIds, visibleRows])


  // Kasa/banka bağlantısı şimdilik pasif (sunucudaki EmployeePayments:WriteAccountMovements).
  // Pasifken ödeme kaynağı hiç sorulmaz. Ayar okunana kadar pasif varsayılır.
  const [accountMovementsEnabled, setAccountMovementsEnabled] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetchPaymentSettings({ signal: controller.signal })
      .then((s) => setAccountMovementsEnabled(s.accountMovementsEnabled))
      .catch(() => setAccountMovementsEnabled(false))
    return () => controller.abort()
  }, [])

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

  /*
    DURUM TAKVİMİ HAKEDİŞ MOTORUNDAN OKUNUR (2026-10-04 kullanıcı bildirimi: "izin alıp erken
    gelince yine izinli gösteriyordu", "çoğu yer hatalı").

    Takvim günleri kendi başına sınıflandırıyordu: giriş yoksa ve izin yoksa "çalışmadı" — pazar,
    resmî tatil ve henüz gelmemiş günler de kırmızı sayılıyordu; izinliyken gelinen gün hem
    "çalıştı" hem "izinli" sayılıyordu. Gün durumu artık puantajla AYNI kaynaktan (hakediş
    motorunun gün dökümü) gelir; döküm alınamazsa eski kural yedek olarak kalır.
  */
  const [statusAccrualDays, setStatusAccrualDays] = useState<Record<string, AccrualDayDto>>({})
  // Takvimden giriş/çıkış ya da izin düzenlenince liste yenilenir; döküm de onunla tazelensin.
  const statusCheckInsKey = statusEmployeeId ? checkInsByEmployeeId[String(statusEmployeeId)] : undefined
  const statusLeavesKey = statusEmployeeId ? leavesByEmployeeId[String(statusEmployeeId)] : undefined
  useEffect(() => {
    if (!statusOpen || !statusEmployeeId || !/^\d{4}-\d{2}$/.test(String(statusMonth))) {
      setStatusAccrualDays({})
      return
    }
    const ctrl = new AbortController()
    void fetchAccrualDetail(statusEmployeeId, String(statusMonth), { signal: ctrl.signal })
      .then((detail) => {
        const map: Record<string, AccrualDayDto> = {}
        for (const d of detail?.days ?? []) map[String(d.date).slice(0, 10)] = d
        setStatusAccrualDays(map)
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setStatusAccrualDays({})
      })
    return () => ctrl.abort()
  }, [statusOpen, statusEmployeeId, statusMonth, statusCheckInsKey, statusLeavesKey])

  const [statusTimeModalOpen, setStatusTimeModalOpen] = useState(false)
  const [statusTimeModalKind, setStatusTimeModalKind] = useState<null | 'addEntry' | 'addExit' | 'editEntry' | 'editExit'>(null)
  const [statusTimeModalTime, setStatusTimeModalTime] = useState('08:00')
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
        const inTime = new Date(String(x?.checkInTime ?? ''))
        const outTimeRaw = x?.checkOutTime
        const outTime = outTimeRaw ? new Date(String(outTimeRaw)) : null

        const inOk = !Number.isNaN(inTime.getTime()) && inTime.getTime() >= start.getTime() && inTime.getTime() <= end.getTime()
        const outOk = outTime && !Number.isNaN(outTime.getTime()) && outTime.getTime() >= start.getTime() && outTime.getTime() <= end.getTime()

        return Boolean(inOk || outOk)
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
    const key = String(employeeId)
    const list = (checkInsByEmployeeId[key] ?? []) as any[]
    if (list.length === 0) return false

    // Employee is considered "at work" if their latest check-in has no check-out time yet.
    const sortedList = list
      .slice()
      .sort(
        (a, b) =>
          String(a?.checkInTime ?? '').localeCompare(String(b?.checkInTime ?? '')) ||
          Number(a?.id ?? 0) - Number(b?.id ?? 0)
      )
    const latest = sortedList[sortedList.length - 1]

    if (!latest) return false
    return !String(latest?.checkOutTime ?? '').trim()
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

  const workNowByType = useMemo(() => {
    const list = (rows ?? []).filter((r) => Boolean((r as any)?.isActive))
    const by: Record<string, number> = {}
    let notAt = 0

    for (const r of list) {
      if (!isAtWorkNow(r.id)) {
        notAt++
        continue
      }
      const t = String((r as any)?.workType ?? '').trim() || 'Belirsiz'
      by[t] = (by[t] ?? 0) + 1
    }

    const items = Object.entries(by)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type, count]) => ({ type, count }))

    return { items, notAt }
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
        // A day counts as "worked" if there is any check-in record whose check-in time is inside that day.
        const key = String(employeeId)
        const list = (checkInsByEmployeeId[key] ?? []) as any[]
        const dayStart = new Date(`${ymd}T00:00:00`)
        const dayEnd = new Date(`${ymd}T23:59:59`)
        const hasAnyEntry = list.some((x) => {
          const t = new Date(String(x?.checkInTime ?? ''))
          if (Number.isNaN(t.getTime())) return false
          return t.getTime() >= dayStart.getTime() && t.getTime() <= dayEnd.getTime()
        })
        if (hasAnyEntry) worked++
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
        await loadRows()
        showPopup('success', 'Başarılı', 'Çalışan işten çıkarıldı')
      }

      if (confirmAction.kind === 'activateEmployee') {
        await activateEmployee(confirmAction.employeeId)
        await loadRows()
        showPopup('success', 'Başarılı', 'Çalışan işe geri alındı')
      }

      if (confirmAction.kind === 'hardDeleteEmployee') {
        await hardDeleteEmployee(confirmAction.employeeId)
        await loadRows()
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

  // --- DASHBOARD DATA CALCULATIONS ---
  const activeCount = useMemo(() => rows.filter((r) => r.isActive).length, [rows])
  const inactiveCount = useMemo(() => rows.filter((r) => !r.isActive).length, [rows])
  
  const presentRate = useMemo(() => {
    if (activeCount === 0) return 0
    return Math.round((workNowCounts.at / activeCount) * 100)
  }, [workNowCounts.at, activeCount])

  const totalSalaryExpense = useMemo(() => {
    return rows.filter((r) => r.isActive).reduce((sum, r) => sum + Number(r.salary ?? 0), 0)
  }, [rows])

  const workDaysInCurrentMonth = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    let workDaysCount = 0
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day)
      if (date.getDay() !== 0) {
        workDaysCount++
      }
    }
    return workDaysCount
  }, [])

  const totalMealExpense = useMemo(() => {
    // Yemek AYLIK bir tutardir; is gunu sayisiyla carpmak gideri ~22 katina cikariyordu.
    return rows.filter((r) => r.isActive).reduce((sum, r) => sum + Number(r.mealAmount ?? 0), 0)
  }, [rows])

  const totalExpenseOverhead = useMemo(() => totalSalaryExpense + totalMealExpense, [totalSalaryExpense, totalMealExpense])

  const financialPercentages = useMemo(() => {
    if (totalExpenseOverhead === 0) {
      return { salary: 100, meal: 0 }
    }
    const salary = Math.round((totalSalaryExpense / totalExpenseOverhead) * 100)
    const meal = Math.round((totalMealExpense / totalExpenseOverhead) * 100)
    return { salary, meal }
  }, [totalSalaryExpense, totalMealExpense, totalExpenseOverhead])

  const workTypeChartData = useMemo(() => {
    const list = rows.filter((r) => r.isActive)
    const counts: Record<string, number> = {}
    for (const r of list) {
      const t = String(r.workType ?? '').trim() || 'Belirtilmemiş'
      counts[t] = (counts[t] ?? 0) + 1
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [rows])

  return (
    <Layout>
      {/*
        Banka/kasa kaynak secim modali kaldirildi: odemeler bayi programina baglanmiyor,
        maas/prim/yemek/avans kendi sayfalarindan yapiliyor.
      */}

      <Modal
        isOpen={statusTimeModalOpen}
        onClose={() => {
          setStatusTimeModalOpen(false)
          setStatusTimeModalKind(null)
          setStatusTimeModalCheckInId(null)
        }}
        title="Saat"
        theme="dark"
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

                if (statusTimeModalKind === 'addEntry') {
                  await createEmployeeCheckIn(statusEmployeeId, { checkInTime: iso })
                  await loadGoCForEmployee(statusEmployeeId)
                  setStatusTimeModalOpen(false)
                  setStatusTimeModalKind(null)
                  setStatusTimeModalCheckInId(null)
                  return
                }

                if (statusTimeModalKind === 'addExit') {
                  // Add exit = set check-out time on the latest open record.
                  const key = String(statusEmployeeId)
                  const list = ((checkInsByEmployeeId as any)[key] ?? []) as any[]
                  // ÇIKIŞ SEÇİLİ GÜNÜN AÇIK KAYDINA YAZILIR (2026-10-04). Eskiden personelin EN SON
                  // açık kaydı seçiliyordu: önceki bir gün çıkışı unutulmuşsa bugünün çıkışı o eski
                  // girişe yazılıyor, günlerce süren bir mesai doğuyordu. Gece vardiyası için önceki
                  // akşamın (12 saat geriye kadar) açık kaydı da kabul edilir.
                  const dayStartMs = new Date(`${statusSelectedYmd}T00:00:00`).getTime()
                  const dayEndMs = new Date(`${statusSelectedYmd}T23:59:59`).getTime()
                  const sortedOpen = list
                    .filter((x) => !String(x?.checkOutTime ?? '').trim())
                    .filter((x) => {
                      const t = new Date(String(x?.checkInTime ?? '')).getTime()
                      return Number.isFinite(t) && t >= dayStartMs - 12 * 3600_000 && t <= dayEndMs
                    })
                    .slice()
                    .sort(
                      (a, b) =>
                        String(a?.checkInTime ?? '').localeCompare(String(b?.checkInTime ?? '')) ||
                        Number(a?.id ?? 0) - Number(b?.id ?? 0)
                    )
                  const open = sortedOpen[sortedOpen.length - 1]

                  if (!open) throw new Error('Bu günde açık giriş kaydı yok; önce giriş ekleyin.')
                  await updateEmployeeCheckOut(Number(open?.id ?? 0), { checkOutTime: iso })
                  await loadGoCForEmployee(statusEmployeeId)
                  setStatusTimeModalOpen(false)
                  setStatusTimeModalKind(null)
                  setStatusTimeModalCheckInId(null)
                  return
                }

                if (!statusTimeModalCheckInId) return

                if (statusTimeModalKind === 'editEntry') {
                  await updateEmployeeCheckIn(statusTimeModalCheckInId, { checkInTime: iso })
                  await loadGoCForEmployee(statusEmployeeId)
                  setStatusTimeModalOpen(false)
                  setStatusTimeModalKind(null)
                  setStatusTimeModalCheckInId(null)
                  return
                }

                if (statusTimeModalKind === 'editExit') {
                  await updateEmployeeCheckOut(statusTimeModalCheckInId, { checkOutTime: iso })
                  await loadGoCForEmployee(statusEmployeeId)
                  setStatusTimeModalOpen(false)
                  setStatusTimeModalKind(null)
                  setStatusTimeModalCheckInId(null)
                  return
                }
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
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
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
        theme="dark"
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
                            'shrink-0 h-[26px] px-3 rounded-full text-[11px] font-bold border ' +
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
        theme="dark"
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

                  <div className="md:col-span-2">
                    <ErpSourcePicker
                      value={cashAdvanceErpSource}
                      onChange={setCashAdvanceErpSource}
                      amountTry={Number(cashAdvanceAmount || '0') || 0}
                    />
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

                        const d = bonusPlanDate && bonusPlanDate.trim() ? new Date(`${bonusPlanDate}T00:00:00`) : new Date()
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
                      const erpHata = erpSourceError(cashAdvanceErpSource)
                      if (erpHata) {
                        showPopup('warning', 'Uyarı', erpHata)
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
                        deductFromSalary: cashAdvanceDeductFromSalary,
                        erpSource: cashAdvanceErpSource
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
        containerClassName="sm:max-w-5xl w-full"
        theme="dark"
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
                  const inTime = new Date(String(x?.checkInTime ?? ''))
                  const outTimeRaw = x?.checkOutTime
                  const outTime = outTimeRaw ? new Date(String(outTimeRaw)) : null

                  const inOk = !Number.isNaN(inTime.getTime()) && inTime.getTime() >= start.getTime() && inTime.getTime() <= end.getTime()
                  const outOk = outTime && !Number.isNaN(outTime.getTime()) && outTime.getTime() >= start.getTime() && outTime.getTime() <= end.getTime()

                  return Boolean(inOk || outOk)
                })
                .sort((a, b) => String(a?.checkInTime ?? '').localeCompare(String(b?.checkInTime ?? '')))
            }

            const hasAnyCheckIn = (ymd: string) => {
              const start = new Date(`${ymd}T00:00:00`)
              const end = new Date(`${ymd}T23:59:59`)
              return items.some((x) => {
                const t = new Date(String(x?.checkInTime ?? ''))
                if (Number.isNaN(t.getTime())) return false
                return t.getTime() >= start.getTime() && t.getTime() <= end.getTime()
              })
            }

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

            // Gün durumu: hakediş motorunun döküm satırı varsa O esas; yoksa eski yaklaşık kural.
            const todayYmd = ymdFromDate(new Date())
            /*
              ÇALIŞTI = O GÜN GİRİŞİ YA DA ÇIKIŞI OLAN KAYIT (2026-10-16 kullanıcı bildirimi: "kırmızı oluyor
              ama giriş çıkışı var"). Yalnız GİRİŞE bakılıyordu; önceki gün giriş yapıp çıkışı ertesi gün basan
              personelde ikinci gün kırmızı görünürken sağdaki detay o günün kaydını gösteriyordu. Ölçüt artık
              detay paneliyle aynı (checkInsForYmd).
            */
            const dayStatus = (ymd: string) => {
              const info = statusAccrualDays[ymd]
              const dayRecords = checkInsForYmd(ymd)
              const ok = hasAnyCheckIn(ymd) || dayRecords.length > 0
              // Gece otomatik kapatılan çıkış (personel basmadı) — ayrı tonda yeşil.
              const auto = ok && dayRecords.some((x: any) => Boolean(x?.checkOutAuto))
              const future = ymd > todayYmd
              if (info) {
                const offDay = Number(info.expectedMinutes ?? 0) <= 0
                return {
                  ok,
                  auto,
                  lv: Boolean(info.isLeave),
                  workOnLeave: Boolean(info.workedDuringLeave),
                  absent: Boolean(info.isAbsent),
                  offDay: offDay && !ok,
                  future
                }
              }
              const anyLeave = hasAnyLeave(ymd)
              return {
                ok,
                auto,
                lv: anyLeave && !ok,
                workOnLeave: ok && anyLeave,
                absent: !ok && !anyLeave && !future,
                offDay: false,
                future
              }
            }

            const { workedDays, leaveDays, absentDays } = (() => {
              let worked = 0
              let leave = 0
              let absent = 0
              for (const c of cells) {
                const st = dayStatus(c.ymd)
                if (st.ok) worked++
                else if (st.lv) leave++
                else if (st.absent) absent++
              }
              return { workedDays: worked, leaveDays: leave, absentDays: absent }
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
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded border border-teal-300 bg-teal-100" />
                      <div>Turkuaz: Otomatik çıkış (18:00)</div>
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

                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  {/* Left Column: Calendar (5 cols) */}
                  <div className="md:col-span-5 border border-slate-200 rounded-2xl bg-white p-4 shadow-sm flex flex-col space-y-4">
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
                        const st = dayStatus(c.ymd)
                        const ok = st.ok
                        const auto = st.auto
                        const lv = st.lv
                        const workOnLeave = st.workOnLeave
                        const absent = st.absent
                        const offDay = st.offDay
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
                                      ? auto
                                        ? 'border-teal-700 bg-teal-600 text-white'
                                        : 'border-emerald-600 bg-emerald-600 text-white'
                                      : absent
                                        ? 'border-rose-600 bg-rose-600 text-white'
                                        : 'border-slate-700 bg-slate-700 text-white'
                                : workOnLeave
                                  ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
                                  : lv
                                    ? 'border-yellow-200 bg-yellow-100 text-yellow-950 hover:bg-yellow-200'
                                    : ok
                                      ? auto
                                        ? 'border-teal-300 bg-teal-100 text-teal-900 hover:bg-teal-200'
                                        : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                      : absent
                                        ? 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
                                        : offDay
                                          ? 'border-gray-200 bg-gray-100 text-gray-400 hover:bg-gray-200'
                                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50')
                            }
                          >
                            {c.day}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Right Column: Details (7 cols) */}
                  <div className="md:col-span-7 border border-slate-200 rounded-2xl bg-white p-4 shadow-sm flex flex-col space-y-4">
                    <div className="text-xs font-black text-slate-800 tracking-wider uppercase">Gün Detayları</div>
                    {statusShowLeaveDays ? (
                      <div className="mt-2 space-y-2">
                        <div className="text-xs font-bold text-gray-900">İzinli Günler</div>
                        {(() => {
                          const monthStart = new Date(year, monthIndex, 1)
                          const monthEnd = new Date(year, monthIndex + 1, 0)
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
                                        description: String(x?.description ?? ''),
                                        leaveType: x?.leaveType
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
                                      description: String(x?.description ?? ''),
                                      leaveType: x?.leaveType
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
                          const hasEntry = Boolean(entry)
                          const hasExit = Boolean(String(entry?.checkOutTime ?? '').trim())

                          // Elle giriş saati sabah 08:00'den başlar (2026-10-16 kullanıcı isteği).
                          const openAddEntry = () => {
                            setStatusTimeModalTime('08:00')
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
                            setStatusTimeModalTime('08:00')
                            setStatusTimeModalKind('editEntry')
                            setStatusTimeModalCheckInId(Number(entry?.id ?? 0))
                            setStatusTimeModalOpen(true)
                          }

                          const openEditExit = () => {
                            if (!entry) return
                            const d = new Date(String(entry?.checkOutTime ?? ''))
                            const time = Number.isNaN(d.getTime()) ? '18:00' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                            setStatusTimeModalTime(time)
                            setStatusTimeModalKind('editExit')
                            setStatusTimeModalCheckInId(Number(entry?.id ?? 0))
                            setStatusTimeModalOpen(true)
                          }

                          return (
                            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-4">
                              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                <div className="text-xs font-black text-slate-800 tracking-wider uppercase">GÜNLÜK HAREKET KONTROLÜ</div>
                                {selected.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!statusEmployeeId || !statusSelectedYmd) return
                                      setConfirmText('Bu günün giriş/çıkış kayıtları silinecek. Emin misiniz?')
                                      setConfirmAction({ kind: 'deleteEmployeeCheckInDay', employeeId: statusEmployeeId, ymd: statusSelectedYmd })
                                      setConfirmOpen(true)
                                    }}
                                    className="h-7 px-3 rounded-lg text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-100 hover:bg-rose-100 hover:text-rose-800 transition"
                                  >
                                    Girilmedi Yap
                                  </button>
                                )}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Giriş Kontrolü */}
                                <div className="bg-white border border-slate-100 rounded-xl p-3 flex items-center justify-between gap-3 shadow-sm">
                                  <div className="space-y-0.5">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Giriş Saati</span>
                                    <div className="text-xs font-black text-slate-800">
                                      {hasEntry ? fmtDateTime(String(entry?.checkInTime ?? '')) : 'Kayıt Yok'}
                                    </div>
                                  </div>
                                  <div>
                                    {hasEntry ? (
                                      <button
                                        type="button"
                                        onClick={openEditEntry}
                                        className="h-8 px-3 rounded-lg text-xs font-bold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 hover:text-slate-800 transition"
                                      >
                                        Düzenle
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={openAddEntry}
                                        className="h-8 px-3 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
                                      >
                                        Ekle
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Çıkış Kontrolü */}
                                <div className="bg-white border border-slate-100 rounded-xl p-3 flex items-center justify-between gap-3 shadow-sm">
                                  <div className="space-y-0.5">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Çıkış Saati</span>
                                    <div className="text-xs font-black text-slate-800">
                                      {hasExit ? fmtDateTime(String(entry?.checkOutTime ?? '')) : 'Kayıt Yok'}
                                    </div>
                                    {hasExit && (entry as any)?.checkOutAuto ? (
                                      <span className="inline-flex w-fit rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-teal-800">
                                        Otomatik çıkış — personel basmadı
                                      </span>
                                    ) : null}
                                  </div>
                                  <div>
                                    {hasExit ? (
                                      <button
                                        type="button"
                                        onClick={openEditExit}
                                        className="h-8 px-3 rounded-lg text-xs font-bold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 hover:text-slate-800 transition"
                                      >
                                        Düzenle
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={openAddExit}
                                        className="h-8 px-3 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition"
                                      >
                                        Ekle
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })()}

                        {selected.map((x) => {
                          const hasExit = Boolean(x?.checkOutTime && String(x.checkOutTime).trim())
                          const fmtTime = (iso?: string | null) => {
                            if (!iso) return '-'
                            const d = new Date(String(iso))
                            if (Number.isNaN(d.getTime())) return '-'
                            return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
                          }

                          return (
                            <div key={`ci-${x.id}`} className="border border-slate-200 rounded-xl bg-slate-50/50 p-3 space-y-3 shadow-sm hover:shadow-md transition">
                              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></span>
                                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Kayıt #{x.id}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!statusEmployeeId) return
                                    setConfirmText('Giriş/Çıkış kaydı silinecek. Emin misiniz?')
                                    setConfirmAction({ kind: 'deleteEmployeeCheckIn', employeeId: statusEmployeeId, checkInId: Number(x.id) })
                                    setConfirmOpen(true)
                                  }}
                                  className="h-[26px] px-2.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition"
                                >
                                  Kaydı Sil
                                </button>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {/* Giriş Card */}
                                <div className="border border-emerald-200 bg-emerald-50/40 rounded-xl p-3 flex flex-col justify-between space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                      <div className="p-1 rounded bg-emerald-100 text-emerald-800">
                                        <LogIn className="w-3.5 h-3.5" />
                                      </div>
                                      <span className="text-[10px] font-extrabold text-emerald-950 uppercase tracking-wider">GİRİŞ</span>
                                    </div>
                                    <span className="text-xs font-black text-emerald-900 bg-emerald-100/60 px-2 py-0.5 rounded-full">
                                      {fmtTime(x?.checkInTime)}
                                    </span>
                                  </div>
                                  <div className="flex items-start gap-1.5 mt-1">
                                    <MapPin className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                                    <div className="text-[11px] flex flex-col">
                                      <span className="text-slate-400 font-medium text-[9px] uppercase tracking-wider">Giriş Konumu</span>
                                      <ResolvedLocation
                                        latitude={Number(x?.latitude ?? 0)}
                                        longitude={Number(x?.longitude ?? 0)}
                                        dbCity={x?.city}
                                        dbDistrict={x?.district}
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* Çıkış Card */}
                                <div className={`border rounded-xl p-3 flex flex-col justify-between space-y-2 ${
                                  hasExit 
                                    ? 'border-blue-200 bg-blue-50/40' 
                                    : 'border-slate-200 bg-slate-100/40'
                                }`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                      <div className={`p-1 rounded ${hasExit ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-500'}`}>
                                        <LogOut className="w-3.5 h-3.5" />
                                      </div>
                                      <span className={`text-[10px] font-extrabold uppercase tracking-wider ${hasExit ? 'text-blue-950' : 'text-slate-500'}`}>ÇIKIŞ</span>
                                    </div>
                                    <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                                      hasExit ? 'text-blue-900 bg-blue-100/60' : 'text-slate-500 bg-slate-200/60'
                                    }`}>
                                      {hasExit ? fmtTime(x?.checkOutTime) : '-'}
                                    </span>
                                  </div>
                                  <div className="flex items-start gap-1.5 mt-1">
                                    <MapPin className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${hasExit ? 'text-blue-600' : 'text-slate-400'}`} />
                                    <div className="text-[11px] flex flex-col">
                                      <span className="text-slate-400 font-medium text-[9px] uppercase tracking-wider">Çıkış Konumu</span>
                                      {hasExit ? (
                                        <ResolvedLocation
                                          latitude={Number(x?.checkOutLatitude ?? 0)}
                                          longitude={Number(x?.checkOutLongitude ?? 0)}
                                          dbCity={x?.checkOutCity}
                                          dbDistrict={x?.checkOutDistrict}
                                        />
                                      ) : (
                                        <span className="font-semibold text-slate-500 italic">Çıkış yapılmadı</span>
                                      )}
                                      {hasExit && x?.checkOutOffsite ? (
                                        <span className="mt-1 inline-flex w-fit rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-sky-800">
                                          Konum dışı çıkış
                                        </span>
                                      ) : null}
                                      {Number(x?.suspicionCount ?? 0) > 0 ? (
                                        <span
                                          className="mt-1 inline-flex w-fit rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rose-700"
                                          title="Sahte konum izi — ayrıntı: Konum Ayarları → Şüpheli İşlemler"
                                        >
                                          Şüpheli konum ({x.suspicionCount})
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
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
        theme="dark"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={confirmBusy}
              onClick={() => {
                setConfirmOpen(false)
                setConfirmAction(null)
              }}
              className="px-3 py-2 text-xs font-semibold bg-white text-slate-700 rounded-lg hover:bg-slate-50 border border-slate-200 disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={confirmBusy || !confirmAction}
              onClick={() => void doConfirm()}
              className="px-3 py-2 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60"
            >
              {confirmBusy ? 'İşleniyor...' : 'Onayla'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-slate-700 whitespace-pre-line">{confirmText}</div>
      </Modal>


      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setActiveFilter('active')
              setSelectedIds(new Set())
            }}
            className={
              'h-[34px] px-3.5 rounded text-xs transition-all ' +
              (activeFilter === 'active'
                ? 'bg-[#141414] text-white font-medium border border-[#141414]'
                : 'bg-white text-neutral-600 font-normal border border-[#eae6dd] hover:bg-[#faf7f2]')
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
              'h-[34px] px-3.5 rounded text-xs transition-all ' +
              (activeFilter === 'inactive'
                ? 'bg-[#141414] text-white font-medium border border-[#141414]'
                : 'bg-white text-neutral-600 font-normal border border-[#eae6dd] hover:bg-[#faf7f2]')
            }
          >
            İşten Çıkarılanlar
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="btn-editorial-primary h-[34px] text-xs px-3.5"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            <span>Yeni Çalışan</span>
          </button>

          <button
            type="button"
            onClick={openAutoCreateModal}
            className="btn-editorial-bronze h-[34px] text-xs px-3.5"
            title="Formu geçerli örnek verilerle doldurup açar; Kaydet'e basmanız yeterli."
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1m0-12.8l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>
            <span>Otomatik Çalışan</span>
          </button>

          {/*
            Odeme dugmeleri buradan kaldirildi. Maas/prim/yemek/avans artik kendi
            sayfalarinda: odeme yapmak ve gecmisini gormek ayni ekranda.
            Bkz. /payments/salary, /payments/advance, /payments/bonus, /payments/meal
          */}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="h-[34px] px-3.5 rounded-lg border border-[#eae6dd] bg-white flex items-center gap-3 shadow-card">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
              <div className="text-[11px] text-neutral-700 font-normal truncate">
                {(workNowByType.items ?? []).length === 0
                  ? `${workNowCounts.at} işte`
                  : (workNowByType.items ?? []).map((x) => `${x.count} ${x.type}`).join('  |  ')}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
              <div className="text-[11px] text-neutral-500 font-normal">{workNowByType.notAt} çalışmıyor</div>
            </div>
            <div className="w-px h-3.5 bg-[#eae6dd]"></div>
            <button
              type="button"
              onClick={async () => {
                const activeIds = (rows ?? []).filter((r) => Boolean((r as any)?.isActive)).map((r) => r.id)
                await ensureGoCLoadedForEmployees(activeIds)
                setWorkNowOpen(true)
              }}
              className="text-[11px] font-medium text-[#8c6538] hover:text-[#5e432a] transition"
            >
              Detay
            </button>
          </div>

          <div className="relative flex items-center min-w-[200px] sm:min-w-[220px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Çalışanlarda ara..."
              className="h-[34px] pl-8 pr-3 text-xs border border-[#eae6dd] rounded-lg bg-white text-[#1a1a1a] placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-[#c5a059] focus:border-[#c5a059] transition w-full shadow-card font-normal"
            />
          </div>


          <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setTopFilterDropdownOpen((p) => !p)}
              className={
                'h-[36px] px-3.5 rounded-xl text-xs font-bold border transition ' +
                (topFilterDropdownOpen
                  ? 'bg-slate-100 text-slate-900 border-slate-300'
                  : 'bg-white text-slate-700 border-slate-200/90 hover:bg-slate-50')
              }
            >
              Filtreler
              {topQuickFilters.size > 0 ? ` (${topQuickFilters.size})` : ''}
            </button>

            {topFilterDropdownOpen && (
              <div
                className="absolute right-0 top-full mt-2 z-50 w-[320px] bg-white border border-slate-200 rounded-2xl shadow-xl p-3"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="text-[11px] font-bold text-slate-700 px-1 uppercase tracking-wider">Durum Filtreleri (AND)</div>
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
                    <label key={it.key} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer select-none">
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
                      <span className="text-xs font-semibold text-slate-700">{it.label}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-2 border-t border-slate-200 pt-2">
                  <div className="text-[11px] font-bold text-slate-500 px-1">Tarih Aralığı</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={topFilterFrom}
                      onChange={(e) => setTopFilterFrom(String(e.target.value ?? ''))}
                      className="h-[34px] px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition"
                    />
                    <input
                      type="date"
                      value={topFilterTo}
                      onChange={(e) => setTopFilterTo(String(e.target.value ?? ''))}
                      className="h-[34px] px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition"
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
                      className="h-[32px] px-3 rounded-lg text-xs font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition"
                    >
                      Temizle
                    </button>
                    <button
                      type="button"
                      onClick={() => setTopFilterDropdownOpen(false)}
                      className="h-[32px] px-3 rounded-lg text-xs font-bold bg-gradient-to-r from-orange-500 to-amber-600 text-white hover:from-orange-600 hover:to-amber-700 transition shadow-md shadow-orange-500/20"
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


      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-xs font-semibold text-red-600 whitespace-pre-line">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-visible relative">
        <div className="px-4 pt-4">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 select-none cursor-pointer">
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
          <div className="p-4 text-xs text-slate-400">Yükleniyor...</div>
        ) : (
          <Table<Row>
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
              if (green) return '!bg-emerald-600/20'
              if (selected) return '!bg-red-600/10'
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
                    <div className="text-sm font-bold text-slate-800">Detay</div>
                    <div className="relative">
                      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      <input
                        value={String(expandedSearchById[String(row.id)] ?? '')}
                        onChange={(e) => setExpandedSearch(row.id, e.target.value)}
                        className="h-[32px] w-[220px] pl-8 pr-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition"
                        placeholder="Detay içinde ara..."
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                      <div className="px-3 py-2 text-xs font-extrabold text-slate-800 bg-slate-50 border-b border-slate-200">Ödeme Geçmişi</div>
                      <div className="max-h-[280px] overflow-auto">
                        {grouped.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-slate-500">Henüz ödeme yok</div>
                        ) : (
                          grouped.map(([key, items]) => (
                            <div key={key} className="border-b border-slate-100 last:border-b-0">
                              <div className="px-3 py-2 text-[11px] font-extrabold text-slate-700 bg-slate-50">{key}</div>
                              {items.map((p) => (
                                <div key={p.id} className="px-3 py-2 border-t border-slate-100">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs font-bold text-slate-800">
                                      {p.kind === 'salary' ? 'Maaş' : p.kind === 'bonus' ? 'Prim' : p.kind === 'meal' ? 'Yemek' : 'Nakit Avans'}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <div className="text-xs font-extrabold text-emerald-600">{Number(p.amount ?? 0).toLocaleString('tr-TR')} ₺</div>
                                      {p.kind === 'salary' ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setConfirmText('Maaş ödemesi geri alınacak (silinecek). Devam edilsin mi?')
                                            setConfirmAction({ kind: 'undoSalaryPayment', paymentId: p.id })
                                            setConfirmOpen(true)
                                          }}
                                          className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100"
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
                                          className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100"
                                        >
                                          Geri Al
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                  {p.description ? <div className="mt-1 text-[11px] text-slate-500 whitespace-pre-line">{p.description}</div> : null}
                                  <div className="mt-1 text-[11px] text-slate-400">Tarih: {fmtDateOnly(p.paymentDate)} | Kaydeden: {p.createUser || '-'}</div>
                                </div>
                              ))}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                      <div className="px-3 py-2 text-xs font-extrabold text-slate-800 bg-slate-50 border-b border-slate-200">Prim Planları</div>
                      <div className="max-h-[280px] overflow-auto">
                        {plans.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-slate-500">Henüz prim planı yok</div>
                        ) : (
                          plans.map((p) => (
                            <div key={p.id} className="px-3 py-2 border-b border-slate-100 last:border-b-0">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-xs font-bold text-slate-800">{fmtDateOnly(p.plannedDate)}</div>
                                <div className="flex items-center gap-2">
                                  <div className="text-xs font-extrabold text-emerald-600">{Number(p.amount ?? 0).toLocaleString('tr-TR')} ₺</div>
                                  {p.status === 1 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmText('Prim planı iptal edilecek. Devam edilsin mi?')
                                        setConfirmAction({ kind: 'cancelBonusPlan', planId: p.id })
                                        setConfirmOpen(true)
                                      }}
                                      className="h-[24px] px-2 rounded text-[11px] font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100"
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
                                      className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100"
                                    >
                                      Geri Al
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              {p.description ? <div className="mt-1 text-[11px] text-slate-500 whitespace-pre-line">{p.description}</div> : null}
                              <div className="mt-1 text-[11px] text-slate-400">Durum: {p.status === 1 ? 'Planlandı' : p.status === 2 ? 'Ödendi' : 'İptal'}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                      <div className="px-3 py-2 text-xs font-extrabold text-slate-800 bg-slate-50 border-b border-slate-200">Yemek</div>
                      <div className="max-h-[280px] overflow-auto">
                        {meals.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-slate-500">Henüz yemek kaydı yok</div>
                        ) : (
                          meals.map((p) => (
                            <div key={`meal-${p.id}`} className="px-3 py-2 border-t border-slate-100">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <div className="text-xs font-bold text-slate-800">Yemek</div>
                                  {p.status === 2 ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      <span className="text-emerald-600">✓</span>
                                      Ödendi
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
                                      <span className="text-slate-400">●</span>
                                      Planlandı
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <div className="text-xs font-extrabold text-emerald-600">{Number(p.amount ?? 0).toLocaleString('tr-TR')} ₺</div>
                                  {p.status === 1 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmText('Yemek planı iptal edilecek. Devam edilsin mi?')
                                        setConfirmAction({ kind: 'cancelMealPlan', planId: p.id })
                                        setConfirmOpen(true)
                                      }}
                                      className="h-[24px] px-2 rounded text-[11px] font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100"
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
                                      className="h-[24px] px-2 rounded text-[11px] font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100"
                                    >
                                      Geri Al
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">{fmtDateOnly(p.plannedDate)}</div>
                              {p.description ? <div className="mt-1 text-[11px] text-slate-500 whitespace-pre-line">{p.description}</div> : null}
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
        theme="dark"
      >
        {!infoEmployeeId ? (
          <div className="text-xs text-gray-500">Çalışan seçilemedi</div>
        ) : (
          <div className="space-y-2">
            {(() => {
              const empId = infoEmployeeId
              const years = getInfoYearsForEmployee(empId)
              const months = buildMonthKeysForEmployee(empId)
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
                    const salaryPayment = getSalaryPaymentForEmployeeMonth(empId, m.year as number, m.monthIndex)
                    const monthPayments = getPaymentsForEmployeeMonth(empId, m.year as number, m.monthIndex)
                    const others = monthPayments.filter((p) => p.kind !== 'salary')
                    const monthPlans = getPlansForEmployeeMonth(empId, m.year as number, m.monthIndex)
                    const monthMealPayments = getPaymentsForEmployeeMonth(empId, m.year as number, m.monthIndex).filter(p => p.kind === 'meal')
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

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={modalMode === 'create' ? 'Yeni Çalışan' : 'Çalışan Düzenle'}
        theme="dark"
      >
        {modalError && (
          <div ref={employeeModalErrorRef} className="mb-3 text-xs font-semibold text-red-600 whitespace-pre-line">
            {modalError}
          </div>
        )}

        {modalMode === 'create' && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[#eae6dd] bg-[#faf9f6] px-3 py-2">
            <span className="text-[11px] text-neutral-500">
              Test kaydı mı oluşturuyorsunuz? Formu geçerli örnek verilerle doldurabilirsiniz.
            </span>
            <button type="button" onClick={fillWithDemoData} className="btn-editorial h-[28px] text-[11px] px-2.5 shrink-0">
              Örnek veriyle doldur
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormSection title="Hesap" hint="portal girişi için" />

          <FormInput label="Kodu" value={form.employeeCode} disabled placeholder="Otomatik" />
          <FormInput label="Username" value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: String(e.target.value ?? '') }))} placeholder="username" />
          <FormInput
            label={modalMode === 'create' ? 'Şifre' : 'Yeni Şifre'}
            type="password"
            value={form.password}
            onChange={(e) => setForm((p) => ({ ...p, password: String(e.target.value ?? '') }))}
            placeholder={modalMode === 'create' ? 'Şifre' : 'Yeni Şifre'}
          />
          <FormInput
            label={modalMode === 'create' ? 'Şifre Tekrar' : 'Yeni Şifre Tekrar'}
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm((p) => ({ ...p, confirmPassword: String(e.target.value ?? '') }))}
            placeholder={modalMode === 'create' ? 'Şifre Tekrar' : 'Yeni Şifre Tekrar'}
          />
          <FormSection title="Kimlik Bilgileri" />

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
          <FormInput label="Pasaport No" value={form.passportNo} onChange={(e) => setForm((p) => ({ ...p, passportNo: e.target.value }))} placeholder="U1234567" />
          <FormInput label="Uyruk" value={form.nationality} onChange={(e) => setForm((p) => ({ ...p, nationality: e.target.value }))} placeholder="KKTC / TC" />

          <FormInput
            label="Doğum Tarihi"
            type="date"
            value={form.birthDate}
            onChange={(e) => setForm((p) => ({ ...p, birthDate: e.target.value }))}
            placeholder=""
          />
          <FormInput label="Doğum Yeri" value={form.birthPlace} onChange={(e) => setForm((p) => ({ ...p, birthPlace: e.target.value }))} placeholder="Lefkoşa" />

          <FormSection title="İletişim ve Adres" />

          <FormInput
            label="Telefon"
            value={form.phone}
            inputMode="numeric"
            placeholder="05XXXXXXXXX / 0049XXXXXXXXXX"
            onChange={(e) => {
              // 11 HANEYE KIRPILMIYOR (2026-08-20). Modulde pasaport ve uyruk alanlari var,
              // yani yurt disindan personel acikca destekleniyor; numarasinin sonu kesiliyordu.
              // 17 hane = E.164 (15) + Turkiye'de yurt disi numarasinin "00" oneki.
              const val = e.target.value.replace(/\D/g, '').slice(0, 17)
              setForm((p) => ({ ...p, phone: val }))
            }}
          />
          <FormInput label="Vergi No" value={form.taxNo} onChange={(e) => setForm((p) => ({ ...p, taxNo: e.target.value }))} placeholder="1234567890" />
          <FormInput label="Vergi Dairesi" value={form.taxOffice} onChange={(e) => setForm((p) => ({ ...p, taxOffice: e.target.value }))} placeholder="Çankaya" />

          <div className="space-y-2 md:col-span-2">
            <label htmlFor="employee-address" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Adres</label>
            <textarea
              id="employee-address"
              className="input-base h-auto py-2 leading-relaxed"
              rows={2}
              value={form.address}
              onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
              placeholder="Mahalle, sokak, no, daire / şehir"
            />
          </div>

          <FormInput
            label="Adres Mahiyeti"
            value={form.addressDetail}
            onChange={(e) => setForm((p) => ({ ...p, addressDetail: e.target.value }))}
            placeholder="Örn: İkametgâh / Şirket lojmanı"
          />
          <div />

          <FormSection title="Resmî Kayıt Numaraları" />

          <FormInput label="İhtiyat Sandığı No" value={form.providentFundNo} onChange={(e) => setForm((p) => ({ ...p, providentFundNo: e.target.value }))} placeholder="0000000" />
          <FormInput label="Sosyal Sigorta No" value={form.socialSecurityNo} onChange={(e) => setForm((p) => ({ ...p, socialSecurityNo: e.target.value }))} placeholder="0000000" />
          <FormInput label="SSD No" value={form.ssdNo} onChange={(e) => setForm((p) => ({ ...p, ssdNo: e.target.value }))} placeholder="0000000" />
          <div />

          <FormSection title="Banka" />

          <FormInput label="Banka Adı" value={form.bankName} onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))} placeholder="Near East Bank / Ziraat / vb." />
          <FormInput
            label="IBAN"
            value={form.iban}
            onChange={(e) => setForm((p) => ({ ...p, iban: formatIbanInput(e.target.value) }))}
            placeholder="TR00 0000 0000 0000 0000 0000 00"
          />
          <FormInput
            label="Banka Hesap No"
            value={form.bankAccountNo}
            onChange={(e) => setForm((p) => ({ ...p, bankAccountNo: e.target.value }))}
            placeholder="Örn: 601625227"
          />
          <FormInput
            label="Müşteri No"
            value={form.customerNo}
            onChange={(e) => setForm((p) => ({ ...p, customerNo: e.target.value }))}
            placeholder="Örn: 176143"
          />


          <FormSection title="Çalışma Bilgileri" />

          <FormInput
            label="İşe Başlangıç Tarihi"
            type="date"
            value={form.hireDate}
            onChange={(e) => setForm((p) => ({ ...p, hireDate: e.target.value }))}
            placeholder=""
          />
          <div />

          <FormInput
            label="Çalışma İzni Başlangıç"
            type="date"
            value={form.workPermitStartDate}
            onChange={(e) => setForm((p) => ({ ...p, workPermitStartDate: e.target.value }))}
            placeholder=""
          />

          <FormInput
            label="Çalışma İzni Bitiş"
            type="date"
            value={form.workPermitDay}
            onChange={(e) => setForm((p) => ({ ...p, workPermitDay: e.target.value }))}
            placeholder=""
          />

          <FormInput
            label="Çalışma Yenileme Ücreti"
            value={form.workPermitRenewalFee}
            inputMode="decimal"
            placeholder="0"
            onChange={(e) => {
              const raw = String(e.target.value ?? '')
              const cleaned = raw.replace(/[^0-9.,]/g, '')
              setForm((p) => ({ ...p, workPermitRenewalFee: cleaned.length ? cleaned : '0' }))
            }}
          />

          <FormSection title="Ücret ve Mesai" />

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

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Yemek Veriliyor mu?
            </label>
            {/* Bazı personele yemek verilir, bazısına verilmez. Kapalıyken tutar dolu olsa
                bile yemek hakedişi hesaplanmaz. */}
            <label className="h-[38px] flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={form.hasMealAllowance}
                onChange={(e) => setForm((p) => ({ ...p, hasMealAllowance: e.target.checked }))}
              />
              {form.hasMealAllowance ? 'Yemek veriliyor' : 'Yemek verilmiyor'}
            </label>
          </div>

          <FormInput
            label="Aylık Yemek Tutarı (₺/ay)"
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
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Tip</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWorkTypeMode('select')}
                className={
                  'h-[34px] px-4 rounded-lg text-xs font-semibold border transition ' +
                  (workTypeMode === 'select'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                }
              >
                Seç
              </button>
              <button
                type="button"
                onClick={() => setWorkTypeMode('new')}
                className={
                  'h-[34px] px-4 rounded-lg text-xs font-semibold border transition ' +
                  (workTypeMode === 'new'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                }
              >
                Yeni Tip
              </button>
            </div>
          </div>

          {workTypeMode === 'select' ? (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Mevcut Tipler</label>
              <select
                value={workTypeSelected}
                onChange={(e) => {
                  setWorkTypeSelected(e.target.value)
                  setForm((p) => ({ ...p, workType: e.target.value }))
                }}
                className="input-base"
              >
                <option value="">Seçiniz...</option>
                {(workTypes ?? []).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <FormInput
              label="Yeni Tip"
              value={workTypeNew}
              onChange={(e) => {
                setWorkTypeNew(String(e.target.value ?? ''))
                setForm((p) => ({ ...p, workType: String(e.target.value ?? '') }))
              }}
              placeholder="Örn: Sahada / Atölyede"
            />
          )}

          <div className="space-y-2">
            <label htmlFor="employee-workplace" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
              İşyeri
            </label>
            {/* Serbest metin; kayıtlı işyerleri öneri olarak sunulur (aynı tenant altında
                birden fazla şirket çalışabiliyor). */}
            <input
              id="employee-workplace"
              list="employee-workplace-options"
              value={form.workplace}
              onChange={(e) => setForm((p) => ({ ...p, workplace: String(e.target.value ?? '') }))}
              className="input-base"
              placeholder="Örn: DEMO TİCARET LTD"
            />
            <datalist id="employee-workplace-options">
              {(workplaces ?? []).map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <label htmlFor="employee-location" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Mesai Konumu
            </label>
            {/* Boş bırakılırsa personel aktif konumların HERHANGİ birinden giriş yapabilir. */}
            <select
              id="employee-location"
              value={form.locationSettingId}
              onChange={(e) => setForm((p) => ({ ...p, locationSettingId: e.target.value }))}
              className="input-base"
            >
              <option value="">Tüm konumlar</option>
              {locations.map((l) => (
                <option key={l.id} value={String(l.id)}>{l.name || `Konum #${l.id}`}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="employee-schedule" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Mesai Tanımı
            </label>
            <select
              id="employee-schedule"
              value={form.workScheduleSettingId}
              onChange={(e) => setForm((p) => ({ ...p, workScheduleSettingId: e.target.value }))}
              className="input-base"
            >
              {/*
                Boş seçenek "personele özel tanım atama" demek; o zaman varsayılan işaretli
                kayıt uygulanır. Metni listedeki kaydın adıyla aynı olmamalı — ikisi de
                "Varsayılan mesai" yazınca aynı satır iki kez görünüyormuş gibi duruyordu.
              */}
              <option value="">— Tanım atama (varsayılan uygulanır) —</option>
              {schedules.map((sch) => (
                <option key={sch.id} value={String(sch.id)}>
                  {sch.name}
                  {sch.isDefault ? ' (varsayılan)' : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-neutral-400">Puantaj ve hakediş bu tanıma göre hesaplanır.</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="employee-annual-leave" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Yıllık İzin Hakkı (gün)
            </label>
            <input
              id="employee-annual-leave"
              className="input-base"
              inputMode="numeric"
              placeholder="Kıdeme göre otomatik"
              value={form.annualLeaveOverrideDays}
              onChange={(e) =>
                setForm((p) => ({ ...p, annualLeaveOverrideDays: String(e.target.value ?? '').replace(/[^0-9]/g, '') }))
              }
            />
            <p className="text-[10px] text-neutral-400">Boş bırakılırsa 1-5 yıl 14, 5-15 yıl 20, 15+ yıl 26 gün.</p>
          </div>

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

          {/* ── Personel fotoğrafı (2026-10-16) — yalnız kayıtlı personelde ── */}
          {editId ? (
            <div className="md:col-span-2">
              <PersonelFotoDuzenle
                employeeId={editId}
                hasPhoto={photoIds.has(editId)}
                name={`${String((form as any).firstName ?? '')} ${String((form as any).lastName ?? '')}`}
                onChanged={(has) =>
                  setPhotoIds((prev) => {
                    const next = new Set(prev)
                    if (has) next.add(editId)
                    else next.delete(editId)
                    return next
                  })
                }
              />
            </div>
          ) : null}

          {/* ── Face Photo Capture (inline in create/edit modal) ── */}
          <div className="md:col-span-2 border-t border-gray-100 pt-4 mt-2">
            <div className="text-xs font-bold text-gray-700 mb-2">📷 Yüz Tanıma Kaydı (Opsiyonel)</div>

            {/*
              Mevcut kayit uyarisi. Satirdaki "Yuz Kaydi" modalinda vardi, burada yoktu:
              formdan bakan kullanici kaydin varligini goremiyor, silemiyor ve ustune yeni
              kayit ekliyordu. Iki ekran artik ayni bilgiyi ve ayni silme yolunu sunuyor.
            */}
            {faceHasExisting && (
              <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 mb-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-blue-800">Mevcut yüz kaydı var</div>
                  <div className="text-[10px] text-blue-600">{faceExistingCount} embedding kayıtlı</div>
                </div>
                <button
                  type="button"
                  disabled={faceSaving}
                  onClick={() => void handleFaceDelete()}
                  className="shrink-0 h-[28px] px-2.5 rounded-lg text-[10px] font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition disabled:opacity-50"
                >
                  Yüz Verilerini Sil
                </button>
              </div>
            )}

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
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInlineFaceCamOpen((v) => !v)}
                    disabled={faceCapturedImages.length >= 5}
                    className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg bg-[#c5a059] hover:bg-[#b88e53] text-[#141414] font-bold text-[11px] shadow-sm transition active:scale-[0.99] disabled:opacity-50"
                  >
                    <Camera size={14} />
                    <span>{inlineFaceCamOpen ? '✕ Kamerayı Kapat' : '📷 Kamerayı Aç'}</span>
                  </button>

                  <label className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-[11px] cursor-pointer border border-slate-300 transition active:scale-[0.99]">
                    <Upload size={14} />
                    <span>🖼️ Galeriden Seç</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleFaceFileInput}
                      className="hidden"
                      disabled={faceCapturedImages.length >= 5}
                    />
                  </label>
                </div>

                {inlineFaceCamOpen && !faceCameraReady && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800">
                    {faceCameraError || 'Kamera açılıyor... Tarayıcı izin isterse onaylayın.'}
                  </div>
                )}

                {/*
                  VIDEO, kamera ACILIR ACILMAZ mount edilir — `faceCameraReady` beklenmez.
                  Akis elemente atanirken element henuz DOM'da olmadigi icin srcObject hic
                  baglanmiyordu ve goruntu siyah kaliyordu. Baglama isi ayri bir effect'te.
                */}
                {inlineFaceCamOpen && (
                  <div>
                    <div
                      className="relative mx-auto w-full max-w-[340px] rounded-lg overflow-hidden bg-black mb-2"
                      style={{ aspectRatio: String(faceVideoAspect) }}
                    >
                      <video
                        ref={faceVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)]"
                      />

                      {/* Yuzu ortalamak icin hedef cerceve */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div
                          className={`rounded-[50%] border-[3px] border-dashed transition-colors ${
                            faceCameraReady ? 'border-emerald-400/90' : 'border-white/40'
                          }`}
                          style={{ width: `${Math.min(80, 57.6 / faceVideoAspect)}%`, height: '80%' }}
                        />
                      </div>
                      <div className="pointer-events-none absolute bottom-1 left-0 right-0 text-center text-[10px] font-semibold text-white/90 drop-shadow">
                        Yüzünüzü oval alana oturtun
                      </div>
                    </div>

                    <canvas ref={faceCanvasRef} style={{ display: 'none' }} />
                    <button
                      type="button"
                      disabled={!faceCameraReady || faceCapturedImages.length >= 5}
                      onClick={captureFaceFrame}
                      className="w-full h-[30px] rounded-lg text-[11px] font-semibold bg-gray-800 hover:bg-gray-700 text-white transition disabled:opacity-40 mb-2"
                    >
                      📸 Canlı Kare Yakala ({faceCapturedImages.length}/5)
                    </button>
                  </div>
                )}

                {/* Preview */}
                {faceCapturedImages.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap pt-1">
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
              </div>
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
        theme="dark"
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
        theme="dark"
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

          <div className="space-y-2">
            <label htmlFor="leave-type" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">İzin Türü</label>
            <select
              id="leave-type"
              className="input-base"
              value={leaveType}
              onChange={(e) => {
                setLeaveType(Number(e.target.value) || 1)
                setLeaveInlineError('')
              }}
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                  {t.paid ? '' : ' (ücretsiz)'}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Yıllık İzin Bakiyesi</span>
            {leaveBalance ? (
              <div className="h-[38px] flex items-center gap-2 text-xs">
                <span className={leaveBalance.remainingDays <= 0 ? 'text-rose-600 font-semibold' : 'text-emerald-700 font-semibold'}>
                  {leaveBalance.remainingDays} gün
                </span>
                <span className="text-neutral-400">
                  / {leaveBalance.totalEntitlementDays ?? leaveBalance.entitlementDays} gün hak
                  {leaveBalance.carryOverDays > 0
                    ? ` (${leaveBalance.entitlementDays} + ${leaveBalance.carryOverDays} devir)`
                    : ''} · {leaveBalance.seniorityYears} yıl kıdem
                </span>
              </div>
            ) : (
              <div className="h-[38px] flex items-center text-xs text-neutral-400">hesaplanıyor…</div>
            )}
          </div>

          {leaveType === 1 && (
            <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 md:col-span-2">
              ℹ <strong>Yıllık İzin:</strong> İzin onaylandığında gün sayısı personelin yıllık izin bakiyesinden düşülecektir.
            </div>
          )}

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
                    const ls = new Date(String(lv?.leaveStartTime ?? ''))
                    const le = new Date(String(lv?.returnTime ?? ''))
                    const lsMs = ls.getTime()
                    const leMs = le.getTime()
                    if (!Number.isFinite(lsMs) || !Number.isFinite(leMs)) return false
                    return s <= leMs && e >= lsMs
                  })

                  if (hasOverlap) {
                    setLeaveInlineError('Bu tarihler arasında mevcut izin bulunmaktadır')
                    return
                  }

                  await createEmployeeLeave({
                    employeeId: leaveEmployeeId,
                    leaveStartTime: startIso,
                    returnTime: returnIso,
                    description: leaveDescription.trim() || undefined,
                    leaveType
                  })
                  setLeaveOpen(false)
                  showPopup('success', 'Başarılı', 'İzin kaydı oluşturuldu')

                  setLeaveFormEmployeeName(leaveEmployeeName || '-')
                  setLeaveFormStart(leaveStart)
                  setLeaveFormReturn(leaveReturn)
                  setLeaveFormDescription(leaveDescription.trim())
                  setLeaveFormLeaveType(leaveType)
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
        theme="dark"
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
      <Modal
        isOpen={faceModalOpen}
        onClose={closeFaceModal}
        title={`📷 Yüz Kaydı – ${faceEmployeeName}`}
        theme="dark"
        containerClassName="sm:max-w-4xl"
      >
        <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
          {/* KVKK Consent */}
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
            <div className="text-xs font-bold text-amber-900">KVKK Onayı</div>
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

          {/* Camera & Capture Section */}
          <div className="space-y-3">
            <div className="text-xs font-bold text-gray-700 flex items-center justify-between">
              <span>Kamera & Fotoğraf ({faceCapturedImages.length}/5)</span>
              {faceCameraReady ? (
                <span className="text-[11px] text-emerald-600 font-bold flex items-center gap-1.5 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  Canlı Kamera Aktif
                </span>
              ) : null}
            </div>

            {/* Live Camera View (Always mounted so videoRef is always valid) */}
            <div
              className="relative mx-auto w-full max-w-[400px] rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-xl flex items-center justify-center"
              style={{ aspectRatio: faceCameraReady ? String(faceVideoAspect) : '4 / 3' }}
            >
              <video
                ref={faceVideoRef}
                autoPlay
                playsInline
                muted
                className={`absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)] ${faceCameraReady ? 'block' : 'hidden'}`}
              />

              {/* Yüzü ortalamak için hedef çerçeve — kare yakalarken hizalamayı kolaylaştırır */}
              {faceCameraReady && (
                <>
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div
                      className="rounded-[50%] border-[3px] border-dashed border-emerald-400/90"
                      style={{ width: `${Math.min(80, 57.6 / faceVideoAspect)}%`, height: '80%' }}
                    />
                  </div>
                  <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[11px] font-bold text-white/90 drop-shadow">
                    Yüzünüzü oval alana oturtun
                  </div>
                </>
              )}
              <canvas ref={faceCanvasRef} className="hidden" />

              {!faceCameraReady && (
                <div className="p-6 flex flex-col items-center justify-center text-center space-y-2.5">
                  <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-amber-400">
                    <Camera size={22} />
                  </div>
                  <div className="text-xs font-bold text-white">
                    {faceCameraError ? 'Canlı Akış Kapalı' : 'Kamera Açılıyor...'}
                  </div>
                  <div className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
                    {faceCameraError
                      ? faceCameraError
                      : 'Tarayıcınızdan kamera erişimi başlatılıyor...'}
                  </div>
                </div>
              )}
            </div>

            {/* Live Camera Snapshot Button (When stream is active) */}
            {faceCameraReady && (
              <button
                type="button"
                disabled={faceCapturedImages.length >= 5}
                onClick={captureFaceFrame}
                className="w-full h-[42px] rounded-xl text-xs font-extrabold bg-slate-900 hover:bg-slate-800 text-white border border-slate-700 transition flex items-center justify-center gap-2 shadow-md disabled:opacity-40"
              >
                <Camera size={16} />
                <span>📸 Canlı Kameradan Kare Yakala ({faceCapturedImages.length}/5)</span>
              </button>
            )}

            {/*
              Dosya tabanli yollar YALNIZCA canli kamera calismadiginda gorunur.
              "Telefon Kamerasini Ac" bir dosya secicidir (capture="user"); telefonda kamerayi
              acar ama masaustunde tarayici bunu yok sayip GALERI aciyor. Canli akis varken
              ikisini yan yana gostermek "kamera dedim galeri acildi" sikayetini uretiyordu.
            */}
            {!faceCameraReady && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <label className="flex items-center justify-center gap-2 w-full h-11 rounded-xl bg-[#c5a059] hover:bg-[#b88e53] text-[#141414] font-bold text-xs cursor-pointer shadow-md transition active:scale-[0.99]">
                <Camera size={16} />
                <span>📱 Telefon Kamerasını Aç</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handleFaceFileInput}
                  className="hidden"
                  disabled={faceCapturedImages.length >= 5}
                />
              </label>

              <label className="flex items-center justify-center gap-2 w-full h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs cursor-pointer border border-slate-300 transition active:scale-[0.99]">
                <Upload size={16} />
                <span>🖼️ Galeriden / Dosyadan Seç</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFaceFileInput}
                  className="hidden"
                  disabled={faceCapturedImages.length >= 5}
                />
              </label>
            </div>
            )}
          </div>


          {/* Captured images preview */}
          {faceCapturedImages.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-2">Çekilen Fotoğraflar ({faceCapturedImages.length}/5)</div>
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
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={closeFaceModal}
              className="h-[36px] px-4 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition"
            >
              İptal
            </button>
            <button
              type="button"
              disabled={faceSaving || faceCapturedImages.length < 1 || !faceConsentGiven}
              onClick={() => void handleFaceEnroll()}
              className="h-[36px] px-5 rounded-lg text-xs font-bold bg-[#c5a059] text-[#141414] hover:bg-[#b88e53] shadow-md transition disabled:opacity-50"
            >
              {faceSaving ? 'Kaydediliyor...' : `Yüz Kaydını Tamamla (${faceCapturedImages.length} foto)`}
            </button>
          </div>
        </div>
      </Modal>

    </Layout>
  )
}

