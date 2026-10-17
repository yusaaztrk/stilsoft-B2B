import React, { useEffect, useMemo, useState } from 'react'
import { PHONE_FORMAT_MESSAGE, PHONE_PATTERN, formatPhoneNumber } from '../utils/phone'

import { API_BASE_URL } from '../config/api'

import Modal from '../components/Modal'
import SsaDashboardHeader from '../components/SsaDashboardHeader'
import { Building2, CircleCheck, CircleX, Copy, Eye, EyeOff, Pencil, RefreshCw, Trash2, UserPlus, Users, LogOut, Plus, Search, X, Check } from 'lucide-react'
import { redirectToLogin } from '../auth/redirectToLogin'



type TenantListItem = {

  tenantId: number

  code: string

  name: string

  dbName: string

  isActive: boolean

  isEcommerceEnabled?: boolean

  /**
   * Kurulum tamamlandı damgası (denetim md. E2). `true` ise firma kurulumu yarım kalmış:
   * master'a satır yazılmış ama veritabanı/tablo kurulumu bitmemiş. Silme önerilmez —
   * yarım da olsa veri olabilir; önce bakılması gerekir.
   */
  setupIncomplete?: boolean

}

type RoleItem = { id: number; name: string; displayName: string; isSuperAdmin?: boolean; isActive?: boolean }

type WarehouseDropdownItem = { warehouseCode: number; name?: string | null }



type PageItem = {

  id: number

  moduleKey: string

  key: string

  displayName: string

  sortOrder: number

  isActive: boolean

}



type CreateTenantPayload = {

  code: string

  name: string

  enabledPageIds: number[]

  superAdminUsername: string

  superAdminMail: string

  superAdminPassword: string

  isEcommerceEnabled: boolean

  serviceOpsEnabled: boolean

  serviceOpsSuperAdminUsername: string

  serviceOpsSuperAdminMail: string

  serviceOpsSuperAdminPassword: string

}



export default function ProjeYonetimiPage() {

  const normalizeTenantCode = (value: string) => {

    const trimmed = String(value ?? '').trim()

    if (!trimmed) return ''

    const upper = trimmed.toUpperCase()

    const replaced = upper.replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')

    return replaced

  }

  const [purgeOpen, setPurgeOpen] = useState(false)
  const [purgeTenant, setPurgeTenant] = useState<TenantListItem | null>(null)
  const [purgeText, setPurgeText] = useState('')
  const [purgeBusy, setPurgeBusy] = useState(false)

  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false)
  const [statusConfirmTenant, setStatusConfirmTenant] = useState<TenantListItem | null>(null)
  const [statusConfirmNextActive, setStatusConfirmNextActive] = useState<boolean | null>(null)
  const [statusConfirmBusy, setStatusConfirmBusy] = useState(false)
  const [copiedTenantCode, setCopiedTenantCode] = useState<string | null>(null)

  const normalizeConfirmText = (v: string) => {
    const s = String(v ?? '').trim()
    if (!s) return ''
    const upper = s.toLocaleUpperCase('tr-TR')
    // tolerate dotted/dotless i differences
    return upper.replace(/İ/g, 'I').replace(/İ/g, 'I')
  }

  const confirmOk = normalizeConfirmText(purgeText) === normalizeConfirmText('Kabul ediyorum')

  const buildTenantHeaders = (tenantCode: string, includeJson: boolean) => {
    const headers = buildHeaders(includeJson)
    const code = String(tenantCode ?? '').trim().toUpperCase()
    if (code) headers['X-Tenant-Code'] = code
    return headers
  }

  const readErrorText = async (res: Response, fallback: string) => {
    const raw = await res.text().catch(() => '')
    const t = String(raw ?? '').trim()
    if (!t) return `${fallback} (${res.status})`
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const j = JSON.parse(t)
        const msg = j?.message || j?.error || j?.title
        if (typeof msg === 'string' && msg.trim()) return msg.trim()
      } catch {
      }
    }
    return t
  }

  const ensureTenantMetaLoaded = (tenantCode: string) => {
    const code = String(tenantCode ?? '').trim().toUpperCase()
    if (!code) return
    if (brandingByTenantCode[code] && statsByTenantCode[code]) return

    setInFlightTenantCodes((prev) => {
      if (prev.has(code)) return prev
      const next = new Set(prev)
      next.add(code)
      return next
    })

    void (async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const tenantHeaders = buildTenantHeaders(code, false)

        const brandingPromise = brandingByTenantCode[code]
          ? Promise.resolve(null)
          : fetch(`${API_BASE_URL}/api/tenants/branding`, {
              headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(code ? { 'X-Tenant-Code': code } : {})
              }
            })

        const statsPromise = statsByTenantCode[code]
          ? Promise.resolve(null)
          : Promise.all([
              fetch(`${API_BASE_URL}/api/invoices/list?${new URLSearchParams({ page: '1', pageSize: '1', query: '' }).toString()}`, {
                headers: { ...tenantHeaders }
              }).catch(() => null),
              fetch(`${API_BASE_URL}/api/users`, { headers: { ...tenantHeaders } }).catch(() => null),
              fetch(`${API_BASE_URL}/api/warehouses?${new URLSearchParams({ includeInactive: 'true' }).toString()}`, {
                headers: { ...tenantHeaders }
              }).catch(() => null),
              fetch(`${API_BASE_URL}/api/employees?${new URLSearchParams({ includeInactive: 'true' }).toString()}`, {
                headers: { ...tenantHeaders }
              }).catch(() => null)
            ])

        const [brandingRes, statsRes] = await Promise.all([brandingPromise, statsPromise])

        if (brandingRes && (brandingRes as Response).ok) {
          const json = await (brandingRes as Response).json().catch(() => null)
          const data = json?.data
          const logoUrl = String(data?.logoUrl ?? '').trim() || null
          setBrandingByTenantCode((prev) => ({ ...prev, [code]: { logoUrl } }))
        } else if (!brandingByTenantCode[code]) {
          setBrandingByTenantCode((prev) => ({ ...prev, [code]: { logoUrl: null } }))
        }

        if (statsRes && Array.isArray(statsRes)) {
          const [invRes, usersRes, whRes, empRes] = statsRes as Array<Response | null>

          const invoiceCount = await (async () => {
            if (!invRes || !invRes.ok) return null
            const j = await invRes.json().catch(() => null)
            const data = j?.data
            const totalRaw = Number(data?.total ?? data?.count)
            if (Number.isFinite(totalRaw)) return totalRaw
            if (Array.isArray(data?.items)) return Number(data.items.length)
            if (Array.isArray(data)) return Number(data.length)
            return null
          })()

          const userCount = await (async () => {
            if (!usersRes || !usersRes.ok) return null
            const j = await usersRes.json().catch(() => null)
            const data = j?.data
            if (Array.isArray(data)) return data.length
            if (Array.isArray(data?.items)) return data.items.length
            return null
          })()

          const warehouseCount = await (async () => {
            if (!whRes || !whRes.ok) return null
            const j = await whRes.json().catch(() => null)
            const data = j?.data
            if (Array.isArray(data)) return data.length
            if (Array.isArray(data?.items)) return data.items.length
            return null
          })()

          const employeeCount = await (async () => {
            if (!empRes || !empRes.ok) return null
            const j = await empRes.json().catch(() => null)
            const data = j?.data
            if (Array.isArray(data)) return data.length
            if (Array.isArray(data?.items)) return data.items.length
            return null
          })()

          setStatsByTenantCode((prev) => ({
            ...prev,
            [code]: {
              invoiceCount,
              userCount,
              warehouseCount,
              employeeCount
            }
          }))
        } else if (!statsByTenantCode[code]) {
          setStatsByTenantCode((prev) => ({
            ...prev,
            [code]: { invoiceCount: null, userCount: null, warehouseCount: null, employeeCount: null }
          }))
        }
      } finally {
        setInFlightTenantCodes((prev) => {
          if (!prev.has(code)) return prev
          const next = new Set(prev)
          next.delete(code)
          return next
        })
      }
    })()
  }



  const buildHeaders = (includeJson: boolean) => {

    const headers: Record<string, string> = {}

    if (includeJson) headers['Content-Type'] = 'application/json'

    const token = localStorage.getItem('accessToken')

    if (token) headers.Authorization = `Bearer ${token}`

    return headers

  }

  const handleLogout = () => {

    localStorage.removeItem('accessToken')

    localStorage.removeItem('refreshToken')

    localStorage.removeItem('userName')

    localStorage.removeItem('tenantCode')

    localStorage.removeItem('tenantName')

    localStorage.removeItem('ssaViewMode')

    sessionStorage.removeItem('userName')

    redirectToLogin()

  }



  const [loading, setLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [tenants, setTenants] = useState<TenantListItem[]>([])



  const [tenantQuery, setTenantQuery] = useState('')

  const [showInactive, setShowInactive] = useState(false)



  const [pages, setPages] = useState<PageItem[]>([])

  const allPageIds = useMemo(() => pages.filter((p) => p.moduleKey !== 'service').map((p) => p.id), [pages])

  const pagesByModule = useMemo(() => {

    const map = new Map<string, PageItem[]>()

    pages.filter((p) => p.moduleKey !== 'service').forEach((p) => {

      const k = String(p.moduleKey ?? '')

      if (!map.has(k)) map.set(k, [])

      map.get(k)!.push(p)

    })

    for (const [, arr] of map) arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  }, [pages])

  const [createBrandingLogoFile, setCreateBrandingLogoFile] = useState<File | null>(null)

  const [createHeaderGradientFrom, setCreateHeaderGradientFrom] = useState<string>('#8F2500')

  const [createHeaderGradientTo, setCreateHeaderGradientTo] = useState<string>('#FF4B1F')



  const [createOpen, setCreateOpen] = useState(false)

  const [form, setForm] = useState<CreateTenantPayload>({
    code: '',
    name: '',
    enabledPageIds: [],
    superAdminUsername: '',
    superAdminMail: '',
    superAdminPassword: '',
    isEcommerceEnabled: false,

    serviceOpsEnabled: false,

    serviceOpsSuperAdminUsername: '',

    serviceOpsSuperAdminMail: '',

    serviceOpsSuperAdminPassword: ''
  })

  const [saving, setSaving] = useState(false)



  const [editOpen, setEditOpen] = useState(false)

  const [editSaving, setEditSaving] = useState(false)

  const [editTenant, setEditTenant] = useState<TenantListItem | null>(null)

  const [editName, setEditName] = useState('')

  const [editIsActive, setEditIsActive] = useState(true)

  const [editIsEcommerceEnabled, setEditIsEcommerceEnabled] = useState(false)

  const [editEnabledPageIds, setEditEnabledPageIds] = useState<number[]>([])

  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [createUserSaving, setCreateUserSaving] = useState(false)
  const [createUserTenant, setCreateUserTenant] = useState<TenantListItem | null>(null)
  const [createUserRoles, setCreateUserRoles] = useState<RoleItem[]>([])
  const [createUserRoleEnabledMap, setCreateUserRoleEnabledMap] = useState<Record<number, boolean>>({})
  const [createUserWarehouses, setCreateUserWarehouses] = useState<WarehouseDropdownItem[]>([])
  const [createUserWarehouseCodes, setCreateUserWarehouseCodes] = useState<Set<number>>(new Set())
  const [createUserUsername, setCreateUserUsername] = useState('')
  const [createUserMail, setCreateUserMail] = useState('')
  const [createUserPhone, setCreateUserPhone] = useState('')
  const [createUserCariCode, setCreateUserCariCode] = useState('')
  const [createUserUnvan, setCreateUserUnvan] = useState('')
  const [createUserPassword, setCreateUserPassword] = useState('')
  const [createUserRoleId, setCreateUserRoleId] = useState<number>(1)
  const [createUserIsActive, setCreateUserIsActive] = useState(true)
  const [showCreateUserPassword, setShowCreateUserPassword] = useState(false)

  type CustomerOption = { customerCode: string; name: string; parentCustomerCode?: string | null }
  const [createUserCustomers, setCreateUserCustomers] = useState<CustomerOption[]>([])

  type SsaGroupedUser = {
    userKey: string
    username: string
    mail: string
    unvan: string
    isActive: boolean
    tenants: Array<{ tenantCode: string; tenantName: string; userId: number; roleId: number; roleCode: string; roleName: string; isActive: boolean }>
  }

  const [assignExistingOpen, setAssignExistingOpen] = useState(false)
  const [assignExistingSaving, setAssignExistingSaving] = useState(false)
  const [assignExistingTenant, setAssignExistingTenant] = useState<TenantListItem | null>(null)
  const [assignExistingQuery, setAssignExistingQuery] = useState('')
  const [ssaUsers, setSsaUsers] = useState<SsaGroupedUser[]>([])
  const [selectedInstanceKey, setSelectedInstanceKey] = useState<string>('')

  const [assignExistingRoles, setAssignExistingRoles] = useState<RoleItem[]>([])
  const [assignExistingRoleEnabledMap, setAssignExistingRoleEnabledMap] = useState<Record<number, boolean>>({})
  const [assignExistingRoleId, setAssignExistingRoleId] = useState<number>(1)
  const [assignExistingWarehouses, setAssignExistingWarehouses] = useState<WarehouseDropdownItem[]>([])
  const [assignExistingWarehouseCodes, setAssignExistingWarehouseCodes] = useState<Set<number>>(new Set())

  const openAssignExisting = (tenant: TenantListItem) => {
    void (async () => {
      try {
        setLoading(true)
        setError(null)

        setAssignExistingTenant(tenant)
        setAssignExistingOpen(true)
        setAssignExistingSaving(false)
        setAssignExistingQuery('')
        setSelectedInstanceKey('')

        setAssignExistingRoles([])
        setAssignExistingRoleEnabledMap({})
        setAssignExistingRoleId(1)
        setAssignExistingWarehouses([])
        setAssignExistingWarehouseCodes(new Set())

        const tenantCode = String(tenant.code ?? '').trim().toUpperCase()
        const tenantId = Number(tenant.tenantId ?? 0)
        if (!tenantCode || !tenantId) throw new Error('Firma bilgisi eksik')

        const [usersRes, rolesRes, whRes, enabledRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/ssa-users/grouped`, { headers: { ...buildHeaders(false) } }),
          fetch(`${API_BASE_URL}/api/roles`, { headers: { ...buildTenantHeaders(tenantCode, false) } }),
          fetch(`${API_BASE_URL}/api/warehouses/dropdown`, { headers: { ...buildTenantHeaders(tenantCode, false) } }),
          fetch(`${API_BASE_URL}/api/tenants/${tenantId}/enabled-pages`, { headers: { ...buildHeaders(false) } })
        ])

        if (!usersRes.ok) throw new Error(await readErrorText(usersRes, 'Kullanıcılar alınamadı'))
        if (!rolesRes.ok) throw new Error(await readErrorText(rolesRes, 'Roller alınamadı'))
        if (!whRes.ok) throw new Error(await readErrorText(whRes, 'Depolar alınamadı'))
        if (!enabledRes.ok) throw new Error(await readErrorText(enabledRes, 'Tenant sayfaları alınamadı'))

        const usersJson = await usersRes.json().catch(() => null)
        setSsaUsers((usersJson?.data ?? []) as SsaGroupedUser[])

        const rolesJson = await rolesRes.json().catch(() => null)
        const rolesRaw = (rolesJson?.data ?? []) as any[]
        const roles: RoleItem[] = rolesRaw
          .map((r) => ({
            id: Number(r.id),
            name: String(r.name ?? ''),
            displayName: String(r.displayName ?? r.name ?? ''),
            isSuperAdmin: Boolean(r.isSuperAdmin),
            isActive: Boolean(r.isActive ?? true)
          }))
          .filter((x) => Number.isFinite(x.id) && x.id > 0)

        setAssignExistingRoles(roles)

        const whJson = await whRes.json().catch(() => null)
        setAssignExistingWarehouses(
          ((whJson?.data ?? []) as any[])
            .map((x) => ({ warehouseCode: Number(x.warehouseCode ?? x.warehouse_code ?? x.code ?? 0), name: x.name ?? null }))
            .filter((x) => Number.isFinite(x.warehouseCode) && x.warehouseCode > 0)
            .sort((a, b) => a.warehouseCode - b.warehouseCode)
        )

        const enabledJson = await enabledRes.json().catch(() => null)
        const enabledIdList: number[] = (Array.isArray(enabledJson?.data) ? (enabledJson.data as any[]) : [])
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isFinite(n) && n > 0)
        const enabledSet = new Set<number>(enabledIdList)

        const enabledMapEntries = await Promise.all(
          roles.map(async (role) => {
            try {
              if (!role.isActive) return [role.id, false] as const
              if (role.isSuperAdmin) return [role.id, true] as const
              if (enabledSet.size === 0) return [role.id, true] as const

              const res = await fetch(`${API_BASE_URL}/api/roles/${role.id}/permissions`, {
                headers: { ...buildTenantHeaders(tenantCode, false) }
              })
              if (!res.ok) return [role.id, true] as const

              const j = await res.json().catch(() => null)
              const permItems = Array.isArray(j?.data) ? (j.data as any[]) : []
              const anyEnabled = permItems.some((p) => {
                const pageId = Number(p?.pageId)
                if (!Number.isFinite(pageId) || pageId <= 0) return false
                if (!enabledSet.has(pageId)) return false
                return Boolean(p?.canAccess)
              })
              return [role.id, anyEnabled] as const
            } catch {
              return [role.id, true] as const
            }
          })
        )

        const enabledMap = Object.fromEntries(enabledMapEntries)
        setAssignExistingRoleEnabledMap(enabledMap)

        const firstVisible = roles
          .filter((r) => Boolean(r.isActive))
          .filter((r) => {
            const v = enabledMap[r.id]
            return v === undefined ? true : Boolean(v)
          })[0]
        if (firstVisible) setAssignExistingRoleId(firstVisible.id)
      } catch (e: any) {
        setError(String(e?.message ?? 'Mevcut kullanıcı yükleme hatası'))
      } finally {
        setLoading(false)
      }
    })()
  }

  const openCreateUser = (tenant: TenantListItem) => {
    void (async () => {
      try {
        setLoading(true)
        setError(null)

        setCreateUserTenant(tenant)
        setCreateUserOpen(true)
        setCreateUserSaving(false)
        setCreateUserRoles([])
        setCreateUserRoleEnabledMap({})
        setCreateUserWarehouses([])
        setCreateUserWarehouseCodes(new Set())
        setCreateUserUsername('')
        setCreateUserMail('')
        setCreateUserPhone('')
        setCreateUserCariCode('')
        setCreateUserCustomers([])
        setCreateUserUnvan('')
        setCreateUserPassword('')
        setCreateUserRoleId(1)
        setCreateUserIsActive(true)
        setShowCreateUserPassword(false)

        const tenantCode = String(tenant.code ?? '').trim().toUpperCase()
        const tenantId = Number(tenant.tenantId ?? 0)
        if (!tenantCode || !tenantId) throw new Error('Firma bilgisi eksik')

        const [rolesRes, whRes, enabledRes, customersRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/roles`, { headers: { ...buildTenantHeaders(tenantCode, false) } }),
          fetch(`${API_BASE_URL}/api/warehouses/dropdown`, { headers: { ...buildTenantHeaders(tenantCode, false) } }),
          fetch(`${API_BASE_URL}/api/tenants/${tenantId}/enabled-pages`, { headers: { ...buildHeaders(false) } }),
          fetch(`${API_BASE_URL}/api/customers?includeInactive=true`, { headers: { ...buildTenantHeaders(tenantCode, false) } })
        ])

        if (!rolesRes.ok) throw new Error(await readErrorText(rolesRes, 'Roller alınamadı'))
        if (!whRes.ok) throw new Error(await readErrorText(whRes, 'Depolar alınamadı'))
        if (!enabledRes.ok) throw new Error(await readErrorText(enabledRes, 'Tenant sayfaları alınamadı'))
        if (!customersRes.ok) throw new Error(await readErrorText(customersRes, 'Cariler alınamadı'))

        const rolesJson = await rolesRes.json().catch(() => null)
        const rolesRaw = (rolesJson?.data ?? []) as any[]
        const roles: RoleItem[] = rolesRaw
          .map((r) => ({
            id: Number(r.id),
            name: String(r.name ?? ''),
            displayName: String(r.displayName ?? r.name ?? ''),
            isSuperAdmin: Boolean(r.isSuperAdmin),
            isActive: Boolean(r.isActive ?? true)
          }))
          .filter((x) => Number.isFinite(x.id) && x.id > 0)

        setCreateUserRoles(roles)

        const customersJson = await customersRes.json().catch(() => null)
        const customersRaw = (customersJson?.data ?? []) as any[]
        setCreateUserCustomers(
          customersRaw
            .map(
              (x): CustomerOption => ({
                customerCode: String(x.customerCode ?? ''),
                name: String(x.name ?? ''),
                parentCustomerCode: x.parentCustomerCode ?? null
              })
            )
            .filter((x) => Boolean(String(x.customerCode ?? '').trim()))
        )

        const whJson = await whRes.json().catch(() => null)
        setCreateUserWarehouses(
          ((whJson?.data ?? []) as any[])
            .map((x) => ({ warehouseCode: Number(x.warehouseCode ?? x.warehouse_code ?? x.code ?? 0), name: x.name ?? null }))
            .filter((x) => Number.isFinite(x.warehouseCode) && x.warehouseCode > 0)
            .sort((a, b) => a.warehouseCode - b.warehouseCode)
        )

        const enabledJson = await enabledRes.json().catch(() => null)
        const enabledIdList: number[] = (Array.isArray(enabledJson?.data) ? (enabledJson.data as any[]) : [])
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isFinite(n) && n > 0)
        const enabledSet = new Set<number>(enabledIdList)

        const enabledMapEntries = await Promise.all(
          roles.map(async (role) => {
            try {
              if (!role.isActive) return [role.id, false] as const
              if (role.isSuperAdmin) return [role.id, true] as const
              if (enabledSet.size === 0) return [role.id, true] as const

              const res = await fetch(`${API_BASE_URL}/api/roles/${role.id}/permissions`, {
                headers: { ...buildTenantHeaders(tenantCode, false) }
              })
              if (!res.ok) return [role.id, true] as const

              const j = await res.json().catch(() => null)
              const permItems = Array.isArray(j?.data) ? (j.data as any[]) : []
              const anyEnabled = permItems.some((p) => {
                const pageId = Number(p?.pageId)
                if (!Number.isFinite(pageId) || pageId <= 0) return false
                if (!enabledSet.has(pageId)) return false
                return Boolean(p?.canAccess)
              })
              return [role.id, anyEnabled] as const
            } catch {
              return [role.id, true] as const
            }
          })
        )

        const enabledMap = Object.fromEntries(enabledMapEntries)
        setCreateUserRoleEnabledMap(enabledMap)

        const firstVisible = roles
          .filter((r) => Boolean(r.isActive))
          .filter((r) => {
            const v = enabledMap[r.id]
            return v === undefined ? true : Boolean(v)
          })[0]
        if (firstVisible) setCreateUserRoleId(firstVisible.id)
      } catch (e: any) {
        setError(String(e?.message ?? 'Kullanıcı ekleme hazırlık hatası'))
      } finally {
        setLoading(false)
      }
    })()
  }

  const visibleCreateUserRoles = useMemo(() => {
    const list = createUserRoles ?? []
    return list
      .filter((r) => Boolean(r.isActive))
      .filter((r) => {
        const enabled = createUserRoleEnabledMap[Number(r.id)]
        return enabled === undefined ? true : Boolean(enabled)
      })
      .slice()
      .sort((a, b) => Number(a.id) - Number(b.id))
  }, [createUserRoles, createUserRoleEnabledMap])

  const submitCreateUser = async () => {
    const tenant = createUserTenant
    if (!tenant) return
    const tenantCode = String(tenant.code ?? '').trim().toUpperCase()
    if (!tenantCode) return

    const username = createUserUsername.trim()
    const mail = createUserMail.trim()
    const phoneRaw = String(createUserPhone ?? '').trim()
    const cariKodu = String(createUserCariCode ?? '').trim()
    const unvan = createUserUnvan.trim()
    const password = createUserPassword
    const roleId = Number(createUserRoleId)

    if (!username || !mail || !unvan) {
      setError('Lütfen zorunlu alanları doldurun')
      return
    }

    if (!password.trim()) {
      setError('Şifre zorunludur')
      return
    }

    if (!Number.isFinite(roleId) || roleId <= 0) {
      setError('RoleId geçersiz')
      return
    }

    if (createUserPhone && !PHONE_PATTERN.test(createUserPhone)) {
      setError(PHONE_FORMAT_MESSAGE)
      return
    }
    const normalizedPhone = createUserPhone

    const selectedRole = (createUserRoles ?? []).find((r) => Number(r.id) === roleId)
    const roleIsSuperAdmin = Boolean(selectedRole?.isSuperAdmin)
    const warehouseCodes = roleIsSuperAdmin
      ? []
      : Array.from(createUserWarehouseCodes)
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0)
          .filter((n, idx, arr) => arr.indexOf(n) === idx)

    if (!roleIsSuperAdmin && warehouseCodes.length === 0) {
      setError('En az 1 depo seçmelisiniz')
      return
    }

    setCreateUserSaving(true)
    setError(null)
    try {
      const payload: any = {
        username,
        mail,
        password,
        unvan,
        gsm: normalizedPhone || undefined,
        carikodu: cariKodu || undefined,
        isActive: createUserIsActive,
        roleId,
        warehouseCodes
      }

      const res = await fetch(`${API_BASE_URL}/api/users`, {
        method: 'POST',
        headers: { ...buildTenantHeaders(tenantCode, true) },
        body: JSON.stringify(payload)
      })

      if (!res.ok) throw new Error(await readErrorText(res, 'Kullanıcı oluşturulamadı'))

      setCreateUserOpen(false)
      setCreateUserTenant(null)
    } catch (e: any) {
      setError(String(e?.message ?? 'Kullanıcı oluşturma hatası'))
    } finally {
      setCreateUserSaving(false)
    }
  }

  const assignExistingInstances = useMemo(() => {
    const q = assignExistingQuery.trim().toLowerCase()
    const tenantCode = String(assignExistingTenant?.code ?? '').trim().toUpperCase()
    const rows = (ssaUsers ?? []).flatMap((u) =>
      (u.tenants ?? []).map((t) => ({
        key: `${u.userKey}::${t.tenantCode}::${t.userId}`,
        username: String(u.username ?? ''),
        mail: String(u.mail ?? ''),
        unvan: String(u.unvan ?? ''),
        sourceTenantCode: String(t.tenantCode ?? '').trim().toUpperCase(),
        sourceTenantName: String(t.tenantName ?? ''),
        sourceUserId: Number(t.userId ?? 0),
        roleName: String(t.roleName ?? ''),
        roleCode: String(t.roleCode ?? ''),
        isActive: Boolean(t.isActive)
      }))
    )

    return rows
      .filter((x) => x.sourceTenantCode && x.sourceUserId > 0)
      .filter((x) => x.sourceTenantCode !== tenantCode)
      .filter((x) => {
        if (!q) return true
        return (
          x.username.toLowerCase().includes(q) ||
          x.mail.toLowerCase().includes(q) ||
          x.unvan.toLowerCase().includes(q) ||
          x.sourceTenantCode.toLowerCase().includes(q) ||
          x.sourceTenantName.toLowerCase().includes(q) ||
          x.roleName.toLowerCase().includes(q)
        )
      })
      .slice()
      .sort((a, b) => a.username.localeCompare(b.username))
  }, [assignExistingQuery, assignExistingTenant, ssaUsers])

  const submitAssignExisting = async () => {
    const targetTenant = assignExistingTenant
    if (!targetTenant) return
    const targetTenantCode = String(targetTenant.code ?? '').trim().toUpperCase()
    if (!targetTenantCode) return
    const picked = (assignExistingInstances ?? []).find((x) => x.key === selectedInstanceKey)
    if (!picked) {
      setError('Kaynak kullanıcı seçiniz')
      return
    }

    const roleId = Number(assignExistingRoleId)
    if (!Number.isFinite(roleId) || roleId <= 0) {
      setError('Rol seçiniz')
      return
    }

    const selectedRole = (assignExistingRoles ?? []).find((r) => Number(r.id) === roleId)
    const roleIsSuperAdmin = Boolean(selectedRole?.isSuperAdmin)
    const warehouseCodes = roleIsSuperAdmin
      ? []
      : Array.from(assignExistingWarehouseCodes)
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0)
          .filter((n, idx, arr) => arr.indexOf(n) === idx)

    if (!roleIsSuperAdmin && warehouseCodes.length === 0) {
      setError('En az 1 depo seçmelisiniz')
      return
    }

    setAssignExistingSaving(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/ssa-users/assign`, {
        method: 'POST',
        headers: { ...buildHeaders(true) },
        body: JSON.stringify({
          sourceTenantCode: picked.sourceTenantCode,
          sourceUserId: picked.sourceUserId,
          targetTenantCodes: [targetTenantCode]
        })
      })

      if (!res.ok) throw new Error(await readErrorText(res, 'Firma atama başarısız'))

      // After assign, update target user's role/warehouses in the target tenant.
      const usersRes = await fetch(`${API_BASE_URL}/api/users`, { headers: { ...buildTenantHeaders(targetTenantCode, false) } })
      if (!usersRes.ok) throw new Error(await readErrorText(usersRes, 'Hedef firma kullanıcıları alınamadı'))
      const usersJson = await usersRes.json().catch(() => null)
      const list = (usersJson?.data ?? []) as any[]
      const u = list.find((x) => String(x?.username ?? '').trim().toLowerCase() === String(picked.username ?? '').trim().toLowerCase())
      const targetUserId = Number(u?.id ?? 0)
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) throw new Error('Hedef kullanıcı bulunamadı')

      const payload: any = {
        username: String(u?.username ?? picked.username ?? '').trim(),
        mail: String(u?.mail ?? picked.mail ?? '').trim(),
        unvan: String(u?.unvan ?? picked.unvan ?? '').trim(),
        isActive: Boolean(u?.isActive ?? true),
        roleId,
        warehouseCodes,
        gsm: String(u?.gsm ?? '').trim() || null,
        carikodu: String(u?.carikodu ?? '').trim() || null,
        salesmanCode: String(u?.salesmanCode ?? '').trim() || null
      }

      const updRes = await fetch(`${API_BASE_URL}/api/users/${targetUserId}`, {
        method: 'PUT',
        headers: { ...buildTenantHeaders(targetTenantCode, true) },
        body: JSON.stringify(payload)
      })
      if (!updRes.ok) throw new Error(await readErrorText(updRes, 'Hedef kullanıcı rolü güncellenemedi'))

      setAssignExistingOpen(false)
      setAssignExistingTenant(null)
    } catch (e: any) {
      setError(String(e?.message ?? 'Atama hatası'))
    } finally {
      setAssignExistingSaving(false)
    }
  }

  const visibleAssignExistingRoles = useMemo(() => {
    const list = assignExistingRoles ?? []
    const currentRoleId = Number(assignExistingRoleId)
    const filtered = list.filter((r) => {
      const rid = Number(r.id)
      if (rid === currentRoleId) return true
      if (!r.isActive) return false
      const enabled = assignExistingRoleEnabledMap[rid]
      return enabled === undefined ? true : Boolean(enabled)
    })
    return filtered.slice().sort((a, b) => Number(a.id) - Number(b.id))
  }, [assignExistingRoleEnabledMap, assignExistingRoleId, assignExistingRoles])

  type TenantBrandingInfo = { logoUrl: string | null }
  type TenantStats = {
    invoiceCount: number | null
    userCount: number | null
    warehouseCount: number | null
    employeeCount: number | null
  }

  const [brandingByTenantCode, setBrandingByTenantCode] = useState<Record<string, TenantBrandingInfo | undefined>>({})
  const [statsByTenantCode, setStatsByTenantCode] = useState<Record<string, TenantStats | undefined>>({})
  const [inFlightTenantCodes, setInFlightTenantCodes] = useState<Set<string>>(new Set())



  const load = async () => {

    setLoading(true)

    setError(null)

    try {

      const [tenantRes, pagesRes] = await Promise.all([

        fetch(`${API_BASE_URL}/api/tenants`, { headers: { ...buildHeaders(false) } }),

        fetch(`${API_BASE_URL}/api/pages/all`, { headers: { ...buildHeaders(false) } })

      ])



      if (!tenantRes.ok) {

        const t = await tenantRes.text().catch(() => '')

        throw new Error(t || `Tenant listesi alınamadı (${tenantRes.status})`)

      }

      if (!pagesRes.ok) {

        const t = await pagesRes.text().catch(() => '')

        throw new Error(t || `Sayfalar alınamadı (${pagesRes.status})`)

      }



      const tenantJson = await tenantRes.json()

      const pagesJson = await pagesRes.json()



      setTenants((tenantJson?.data ?? []) as TenantListItem[])

      setPages((pagesJson?.data ?? []) as PageItem[])

    } catch (e: any) {

      setError(String(e?.message ?? 'Yükleme hatası'))

    } finally {

      setLoading(false)

    }

  }



  useEffect(() => {

    void load()

  }, [])



  const filteredTenants = useMemo(() => {

    const q = tenantQuery.trim().toLowerCase()

    return (tenants ?? [])

      .filter((t) => (showInactive ? true : Boolean(t.isActive)))

      .filter((t) => {

        if (!q) return true

        return String(t.name ?? '').toLowerCase().includes(q) || String(t.code ?? '').toLowerCase().includes(q) || String(t.dbName ?? '').toLowerCase().includes(q)

      })

      .slice()

      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))

  }, [showInactive, tenantQuery, tenants])



  const stats = useMemo(() => {

    const list = tenants ?? []

    const total = list.length

    const active = list.filter((x) => Boolean(x.isActive)).length

    const inactive = total - active

    return { total, active, inactive }

  }, [tenants])



  const togglePage = (id: number) => {

    setForm((prev) => {

      const set = new Set(prev.enabledPageIds)

      if (set.has(id)) set.delete(id)

      else set.add(id)

      return { ...prev, enabledPageIds: Array.from(set) }

    })

  }



  const submit = async () => {

    const code = normalizeTenantCode(form.code)

    const name = form.name.trim()

    if (!code) {

      setError('Firma kodu zorunlu')

      return

    }

    if (!name) {

      setError('Firma adı zorunlu')

      return

    }

    if (!form.superAdminUsername.trim() || !form.superAdminMail.trim() || !form.superAdminPassword) {

      setError('SuperAdmin bilgileri zorunlu')

      return

    }

    if (form.serviceOpsEnabled) {

      if (!form.serviceOpsSuperAdminUsername.trim() || !form.serviceOpsSuperAdminMail.trim() || !form.serviceOpsSuperAdminPassword) {

        setError('Servis SuperAdmin bilgileri zorunlu')

        return

      }

    }



    setSaving(true)

    setError(null)

    try {

      const res = await fetch(`${API_BASE_URL}/api/tenants`, {

        method: 'POST',

        headers: { ...buildHeaders(true) },

        body: JSON.stringify({

          code,

          name,

          enabledPageIds: form.enabledPageIds,

          superAdminUsername: form.superAdminUsername.trim(),

          superAdminMail: form.superAdminMail.trim(),

          superAdminPassword: form.superAdminPassword,

          serviceOpsEnabled: Boolean(form.serviceOpsEnabled),

          serviceOpsSuperAdminUsername: form.serviceOpsEnabled ? form.serviceOpsSuperAdminUsername.trim() : null,

          serviceOpsSuperAdminMail: form.serviceOpsEnabled ? form.serviceOpsSuperAdminMail.trim() : null,

          serviceOpsSuperAdminPassword: form.serviceOpsEnabled ? form.serviceOpsSuperAdminPassword : null

          ,

          isEcommerceEnabled: Boolean(form.isEcommerceEnabled)

        })

      })



      if (!res.ok) {

        const raw = await res.text().catch(() => '')

        try {

          const j = raw ? JSON.parse(raw) : null

          const msg = String(j?.message ?? '').trim()

          if (msg) throw new Error(msg)

        } catch {

          // ignore

        }

        throw new Error(raw || `Firma oluşturulamadı (${res.status})`)

      }

      const createdJson = await res.json().catch(() => null)
      const createdCode = String(createdJson?.data?.code ?? code).trim()

      try {

        const token = localStorage.getItem('accessToken')

        const hasBranding = Boolean(createBrandingLogoFile) || Boolean((createHeaderGradientFrom ?? '').trim()) || Boolean((createHeaderGradientTo ?? '').trim())

        if (token && hasBranding) {

          const fd = new FormData()

          if (createBrandingLogoFile) fd.append('Logo', createBrandingLogoFile)

          if ((createHeaderGradientFrom ?? '').trim()) fd.append('HeaderGradientFrom', String(createHeaderGradientFrom))

          if ((createHeaderGradientTo ?? '').trim()) fd.append('HeaderGradientTo', String(createHeaderGradientTo))

          const brRes = await fetch(`${API_BASE_URL}/api/tenants/branding`, {

            method: 'PUT',

            headers: {

              Authorization: `Bearer ${token}`,

              'X-Tenant-Code': createdCode

            },

            body: fd

          })

          if (!brRes.ok) {

            const t = await brRes.text().catch(() => '')

            setError(t || 'Firma oluşturuldu ancak logo/renk kaydedilemedi')

          }

        }

      } catch {

        setError('Firma oluşturuldu ancak logo/renk kaydedilemedi')

      }



      setCreateOpen(false)

      setForm({

        code: '',

        name: '',

        enabledPageIds: [],

        superAdminUsername: '',

        superAdminMail: '',

        superAdminPassword: '',

        isEcommerceEnabled: false,

        serviceOpsEnabled: false,

        serviceOpsSuperAdminUsername: '',

        serviceOpsSuperAdminMail: '',

        serviceOpsSuperAdminPassword: ''

      })

      setCreateBrandingLogoFile(null)

      setCreateHeaderGradientFrom('#8F2500')

      setCreateHeaderGradientTo('#FF4B1F')



      await load()

    } catch (e: any) {

      setError(String(e?.message ?? 'Kaydetme hatası'))

    } finally {

      setSaving(false)

    }

  }



  return (

    <div className="space-y-6 min-h-[calc(100vh-64px)] px-3 sm:px-6 py-6 bg-slate-50/70">

      <SsaDashboardHeader
        title="Proje Yönetimi"
        subtitle="Firma ekle, modülleri/sayfaları seç ve tek tıkla firmaya geç."
        searchValue={tenantQuery}
        onSearchChange={setTenantQuery}
        tertiaryLabel="Onboard"
        onTertiaryClick={() => {
          localStorage.setItem('ssaViewMode', 'global')
          window.location.assign('/users/onboard')
        }}
        secondaryLabel="Tüm Kullanıcılar"
        onSecondaryClick={() => {
          localStorage.setItem('ssaViewMode', 'global')
          window.location.assign('/users/allUsers')
        }}
        primaryLabel="Yeni Firma"
        onPrimaryClick={() => setCreateOpen(true)}
        onLogout={handleLogout}
      />

      {/* STATS & FILTER CONTAINER */}
      <div className="rounded-3xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
        <div className="p-4 sm:p-6 space-y-5">
          {/* TOP METRIC CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {/* Total Tenants */}
            <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-slate-50 to-white p-4 flex items-center justify-between shadow-2xs hover:border-slate-300 transition-all">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Toplam Firma</div>
                <div className="text-2xl font-black text-slate-900 mt-0.5">{stats.total}</div>
                <div className="text-[11px] font-semibold text-slate-500 mt-1">Tanımlı sistem firmaları</div>
              </div>
              <div className="h-11 w-11 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs shrink-0">
                <Building2 size={20} />
              </div>
            </div>

            {/* Active Tenants */}
            <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/30 to-white p-4 flex items-center justify-between shadow-2xs hover:border-emerald-200 transition-all">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wider text-emerald-600">Aktif Firmalar</div>
                <div className="text-2xl font-black text-emerald-950 mt-0.5">{stats.active}</div>
                <div className="text-[11px] font-semibold text-emerald-700/80 mt-1">
                  %{stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0} aktiflik oranı
                </div>
              </div>
              <div className="h-11 w-11 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-2xs shrink-0">
                <CircleCheck size={20} />
              </div>
            </div>

            {/* Inactive Tenants */}
            <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50/30 to-white p-4 flex items-center justify-between shadow-2xs hover:border-amber-200 transition-all">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wider text-amber-600">Pasif Firmalar</div>
                <div className="text-2xl font-black text-amber-950 mt-0.5">{stats.inactive}</div>
                <div className="text-[11px] font-semibold text-amber-700/80 mt-1">Duraklatılmış firmalar</div>
              </div>
              <div className="h-11 w-11 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-2xs shrink-0">
                <CircleX size={20} />
              </div>
            </div>
          </div>

          {/* SEARCH & CONTROLS BAR */}
          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={tenantQuery}
                onChange={(e) => setTenantQuery(e.target.value)}
                placeholder="Firma adı, kodu veya veritabanı adıyla hızlı ara..."
                className="w-full pl-10 pr-9 py-2.5 text-xs sm:text-sm border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 bg-white text-slate-800 shadow-2xs transition-all"
              />
              {tenantQuery && (
                <button
                  type="button"
                  onClick={() => setTenantQuery('')}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-100 transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <label className="shrink-0 inline-flex items-center gap-2.5 h-11 px-4 rounded-2xl border border-slate-200 bg-slate-50/50 text-xs sm:text-sm font-semibold text-slate-700 select-none cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                Pasifleri göster
              </label>

              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="shrink-0 h-11 px-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-xs sm:text-sm font-bold text-slate-700 transition flex items-center gap-2 cursor-pointer shadow-2xs disabled:opacity-60"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin text-rose-600' : 'text-slate-500'} />
                <span>Yenile</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="text-xs sm:text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 shadow-2xs flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* TENANT CARDS SECTION */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Firmalar ({filteredTenants.length})
          </div>
          {tenantQuery && (
            <div className="text-xs text-slate-400 font-medium">
              "{tenantQuery}" araması için filtrelendi
            </div>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-3xl border border-slate-200/80 bg-white p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-slate-100 animate-pulse" />
                  <div className="h-6 w-16 rounded-full bg-slate-100 animate-pulse" />
                </div>
                <div className="h-4 bg-slate-100 rounded-lg animate-pulse w-2/3" />
                <div className="h-3 bg-slate-100 rounded-lg animate-pulse w-1/2" />
                <div className="grid grid-cols-4 gap-2 pt-2">
                  <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                  <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                  <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                  <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                </div>
                <div className="h-11 bg-slate-100 rounded-2xl animate-pulse w-full pt-2" />
              </div>
            ))}
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-3xl border border-slate-200/80 shadow-2xs space-y-3">
            <div className="w-14 h-14 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto">
              <Building2 size={26} />
            </div>
            <div className="text-base font-extrabold text-slate-800">Firma Bulunamadı</div>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Arama kriterlerinize uygun firma bulunamadı veya henüz firma tanımlanmadı.
            </p>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-2 inline-flex items-center gap-2 h-11 px-5 rounded-2xl bg-gradient-to-r from-red-700 via-rose-600 to-red-700 text-white hover:from-red-800 hover:to-red-800 text-xs font-bold uppercase tracking-wider shadow-md transition-all cursor-pointer"
            >
              <Plus size={16} />
              Yeni Firma Oluştur
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredTenants.map((t) => (
              <div
                key={t.tenantId}
                onMouseEnter={() => ensureTenantMetaLoaded(t.code)}
                className="group relative rounded-3xl border border-slate-200/90 bg-white shadow-xs hover:shadow-xl hover:border-rose-200 hover:ring-2 hover:ring-rose-100/60 transition-all duration-300 flex flex-col justify-between overflow-hidden"
              >
                <div className="p-5 space-y-4">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="h-12 w-12 rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden grid place-items-center shrink-0 shadow-2xs">
                        {(() => {
                          const code = String(t.code ?? '').trim().toUpperCase()
                          const logo = brandingByTenantCode[code]?.logoUrl
                          if (logo) {
                            return (
                              <img
                                src={logo}
                                alt="Logo"
                                className="h-full w-full object-contain"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none'
                                }}
                              />
                            )
                          }
                          return (
                            <span className="text-[11px] font-black tracking-wider text-slate-500 uppercase">
                              {code.substring(0, 3)}
                            </span>
                          )
                        })()}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <h3 className="text-sm sm:text-base font-extrabold text-slate-900 truncate" title={t.name}>
                            {t.name}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-mono font-bold text-slate-600 uppercase">
                            {t.code}
                          </span>
                          {t.isEcommerceEnabled && (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700">
                              E-Ticaret
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Active/Inactive Status Toggle */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                          t.isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {t.isActive ? 'Aktif' : 'Pasif'}
                      </span>

                      {/* YARIM KURULUM UYARISI (denetim md. E2). Bu firma listede sağlam
                          görünüyordu ama veritabanı eksik olabilir. */}
                      {t.setupIncomplete && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border bg-rose-50 text-rose-700 border-rose-200"
                          title="Kurulum yarım kalmış: master kaydı var ama veritabanı kurulumu tamamlanmamış. Firmayı kullanmadan önce kontrol edin."
                        >
                          Kurulum Yarım
                        </span>
                      )}

                      <label
                        className="relative inline-flex h-6 w-11 cursor-pointer items-center"
                        onClick={(e) => e.stopPropagation()}
                        title={t.isActive ? 'Pasife al' : 'Aktife al'}
                        aria-label={t.isActive ? 'Pasife al' : 'Aktife al'}
                      >
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={Boolean(t.isActive)}
                          onChange={() => {
                            setStatusConfirmTenant(t)
                            setStatusConfirmNextActive(!Boolean(t.isActive))
                            setStatusConfirmOpen(true)
                          }}
                        />
                        <span className="absolute inset-0 rounded-full bg-slate-200 border border-slate-300 transition-colors peer-checked:bg-emerald-500 peer-checked:border-emerald-500" />
                        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-5" />
                      </label>
                    </div>
                  </div>

                  {/* Stat Tiles Grid */}
                  {(() => {
                    const code = String(t.code ?? '').trim().toUpperCase()
                    const s = statsByTenantCode[code]
                    const loadingStats = inFlightTenantCodes.has(code) && !s
                    const v = (n: number | null | undefined) => (n == null ? '-' : String(n))
                    return (
                      <div className="grid grid-cols-4 gap-2 pt-1">
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-2.5 text-center">
                          <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Fatura</div>
                          <div className="text-xs sm:text-sm font-extrabold text-slate-800 mt-0.5 truncate">
                            {loadingStats ? '...' : v(s?.invoiceCount)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-2.5 text-center">
                          <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Kullanıcı</div>
                          <div className="text-xs sm:text-sm font-extrabold text-slate-800 mt-0.5 truncate">
                            {loadingStats ? '...' : v(s?.userCount)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-2.5 text-center">
                          <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Depo</div>
                          <div className="text-xs sm:text-sm font-extrabold text-slate-800 mt-0.5 truncate">
                            {loadingStats ? '...' : v(s?.warehouseCount)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-2.5 text-center">
                          <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Çalışan</div>
                          <div className="text-xs sm:text-sm font-extrabold text-slate-800 mt-0.5 truncate">
                            {loadingStats ? '...' : v(s?.employeeCount)}
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  {/* DB Info Banner */}
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/40 p-2.5 flex items-center justify-between text-xs">
                    <span className="text-[11px] font-medium text-slate-500">Veritabanı:</span>
                    <span className="font-mono font-bold text-slate-700 truncate max-w-[180px]">
                      {String(t.dbName ?? '').trim() || '-'}
                    </span>
                  </div>
                </div>

                {/* Card Actions Footer (Mobile Optimized!) */}
                <div className="p-4 bg-slate-50/80 border-t border-slate-100 space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.setItem('tenantCode', t.code)
                      localStorage.setItem('tenantName', t.name)
                      localStorage.setItem('ssaViewMode', 'tenant')
                      window.location.assign('/users/kullaniciListesi')
                    }}
                    className="w-full h-11 rounded-2xl bg-gradient-to-r from-red-700 via-rose-600 to-red-700 text-white hover:from-red-800 hover:via-rose-700 hover:to-red-800 text-xs font-black uppercase tracking-wider shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Sisteme Bağlan</span>
                  </button>

                  <div className="flex items-center justify-between sm:justify-end gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => openCreateUser(t)}
                      className="flex-1 sm:flex-none h-9 sm:h-10 px-2 sm:w-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition flex items-center justify-center gap-1 cursor-pointer"
                      aria-label="Kullanıcı ekle"
                      title="Yeni Kullanıcı Ekle"
                    >
                      <UserPlus size={14} />
                      <span className="sm:hidden text-[10px] font-bold">Ekle</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openAssignExisting(t)}
                      className="flex-1 sm:flex-none h-9 sm:h-10 px-2 sm:w-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition flex items-center justify-center gap-1 cursor-pointer"
                      aria-label="Mevcut kullanıcı ata"
                      title="Mevcut Kullanıcı Ata"
                    >
                      <Users size={14} />
                      <span className="sm:hidden text-[10px] font-bold">Ata</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          try {
                            setLoading(true)
                            setError(null)
                            setEditTenant(t)
                            setEditName(t.name)
                            setEditIsActive(Boolean(t.isActive))
                            setEditIsEcommerceEnabled(Boolean((t as any)?.isEcommerceEnabled))

                            const res = await fetch(`${API_BASE_URL}/api/tenants/${t.tenantId}/enabled-pages`, {
                              headers: { ...buildHeaders(false) }
                            })

                            if (!res.ok) {
                              const text = await res.text().catch(() => '')
                              throw new Error(text || `Yetkili sayfalar alınamadı (${res.status})`)
                            }

                            const json = await res.json().catch(() => null)
                            const ids = Array.isArray(json?.data) ? (json!.data as any[]) : []
                            setEditEnabledPageIds(ids.map((x) => Number(x)).filter((n) => Number.isFinite(n)))
                            setEditOpen(true)
                          } catch (e: any) {
                            setError(String(e?.message ?? 'Düzenleme yükleme hatası'))
                          } finally {
                            setLoading(false)
                          }
                        })()
                      }}
                      className="flex-1 sm:flex-none h-9 sm:h-10 px-2 sm:w-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition flex items-center justify-center gap-1 cursor-pointer"
                      aria-label="Düzenle"
                      title="Firmayı Düzenle"
                    >
                      <Pencil size={14} />
                      <span className="sm:hidden text-[10px] font-bold">Düzenle</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          try {
                            await navigator.clipboard.writeText(String(t.code ?? '').trim())
                            setCopiedTenantCode(t.code)
                            setTimeout(() => setCopiedTenantCode(null), 2000)
                          } catch {}
                        })()
                      }}
                      className="flex-1 sm:flex-none h-9 sm:h-10 px-2 sm:w-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition flex items-center justify-center gap-1 cursor-pointer"
                      aria-label="Kodu kopyala"
                      title="Firma Kodunu Kopyala"
                    >
                      {copiedTenantCode === t.code ? (
                        <Check size={14} className="text-emerald-600" />
                      ) : (
                        <Copy size={14} />
                      )}
                      <span className="sm:hidden text-[10px] font-bold">
                        {copiedTenantCode === t.code ? 'Kopyalandı' : 'Kodu Kopyala'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPurgeTenant(t)
                        setPurgeText('')
                        setPurgeOpen(true)
                      }}
                      className="flex-1 sm:flex-none h-9 sm:h-10 px-2 sm:w-10 rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-700 transition flex items-center justify-center gap-1 cursor-pointer"
                      aria-label="Sil"
                      title="Firmayı Sil"
                    >
                      <Trash2 size={14} />
                      <span className="sm:hidden text-[10px] font-bold">Sil</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={purgeOpen}
        onClose={() => {
          if (purgeBusy) return
          setPurgeOpen(false)
          setPurgeTenant(null)
          setPurgeText('')
        }}
        title="Firma Silme Onayı"
        containerClassName="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={purgeBusy}
              onClick={() => {
                setPurgeOpen(false)
                setPurgeTenant(null)
                setPurgeText('')
              }}
              className="h-10 px-4 text-xs font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={purgeBusy || !confirmOk || !purgeTenant}
              onClick={() => {
                if (!purgeTenant) return
                void (async () => {
                  try {
                    setPurgeBusy(true)
                    setError(null)
                    const res = await fetch(`${API_BASE_URL}/api/tenants/${purgeTenant.tenantId}/purge`, {
                      method: 'DELETE',
                      headers: { ...buildHeaders(false) }
                    })
                    if (!res.ok) {
                      const text = await res.text().catch(() => '')
                      throw new Error(text || `Silme başarısız (${res.status})`)
                    }
                    setPurgeOpen(false)
                    setPurgeTenant(null)
                    setPurgeText('')
                    await load()
                  } catch (e: any) {
                    setError(String(e?.message ?? 'Silme hatası'))
                  } finally {
                    setPurgeBusy(false)
                  }
                })()
              }}
              className="h-10 px-4 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white transition disabled:opacity-60"
            >
              {purgeBusy ? 'Siliniyor...' : 'Firmayı Sil'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="text-sm text-gray-800">
            <div className="font-bold">Dikkat: Bu işlem geri alınamaz.</div>
            <div className="mt-1">
              <span className="font-semibold">{String(purgeTenant?.name ?? '')}</span> firması ve bu firmaya ait <span className="font-semibold">tüm veriler</span> kalıcı olarak silinecektir.
            </div>
            <div className="mt-2">
              Onaylıyorsanız aşağıdaki alana <span className="font-bold">KABUL EDİYORUM</span> yazın.
            </div>
          </div>

          <input
            value={purgeText}
            onChange={(e) => setPurgeText(e.target.value)}
            className="w-full h-10 px-3 rounded-xl border border-gray-200 input-base"
            placeholder="Kabul ediyorum"
            disabled={purgeBusy}
          />

          <div className="text-[11px] text-gray-500">Silme butonu sadece tam olarak "Kabul ediyorum" yazınca aktif olur.</div>
        </div>
      </Modal>

      <Modal
        isOpen={statusConfirmOpen}
        onClose={() => {
          if (statusConfirmBusy) return
          setStatusConfirmOpen(false)
          setStatusConfirmTenant(null)
          setStatusConfirmNextActive(null)
        }}
        title="Firma Durumu"
        containerClassName="max-w-md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={statusConfirmBusy}
              onClick={() => {
                setStatusConfirmOpen(false)
                setStatusConfirmTenant(null)
                setStatusConfirmNextActive(null)
              }}
              className="h-10 px-4 text-xs font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={statusConfirmBusy || !statusConfirmTenant || statusConfirmNextActive == null}
              onClick={() => {
                if (!statusConfirmTenant || statusConfirmNextActive == null) return
                void (async () => {
                  try {
                    setStatusConfirmBusy(true)
                    setError(null)
                    const res = await fetch(`${API_BASE_URL}/api/tenants/${statusConfirmTenant.tenantId}`, {
                      method: 'PUT',
                      headers: { ...buildHeaders(true) },
                      body: JSON.stringify({ name: String(statusConfirmTenant.name ?? '').trim(), isActive: statusConfirmNextActive })
                    })
                    if (!res.ok) {
                      const text = await res.text().catch(() => '')
                      throw new Error(text || `Güncelleme başarısız (${res.status})`)
                    }
                    setStatusConfirmOpen(false)
                    setStatusConfirmTenant(null)
                    setStatusConfirmNextActive(null)
                    await load()
                  } catch (e: any) {
                    setError(String(e?.message ?? 'Güncelleme hatası'))
                  } finally {
                    setStatusConfirmBusy(false)
                  }
                })()
              }}
              className={
                'h-10 px-4 text-xs font-semibold rounded-xl text-white transition disabled:opacity-60 ' +
                (statusConfirmNextActive ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700')
              }
            >
              {statusConfirmBusy
                ? 'Kaydediliyor...'
                : statusConfirmNextActive
                  ? 'Aktife Al'
                  : 'Pasife Al'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-gray-800">
          {statusConfirmNextActive ? (
            <div>
              <span className="font-semibold">{String(statusConfirmTenant?.name ?? '')}</span> firmasını <span className="font-bold">aktife</span> almak istiyor musunuz?
            </div>
          ) : (
            <div>
              <span className="font-semibold">{String(statusConfirmTenant?.name ?? '')}</span> firmasını <span className="font-bold">pasife</span> almak istiyor musunuz?
            </div>
          )}
        </div>
      </Modal>



      <Modal isOpen={editOpen} onClose={() => (editSaving ? undefined : setEditOpen(false))} title="Firma Düzenle">

        <div className="space-y-4">

          <div>

            <div className="text-xs font-bold text-gray-600 mb-1">Firma Adı</div>

            <input

              value={editName}

              onChange={(e) => setEditName(e.target.value)}

              className="w-full h-10 px-3 rounded-xl border border-gray-200"

              placeholder="Örn: Stilsoft Bayi"

            />

          </div>

          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">

            <input type="checkbox" checked={editIsActive} onChange={(e) => setEditIsActive(e.target.checked)} />

            Aktif

          </label>

          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">

            <input

              type="checkbox"

              checked={editIsEcommerceEnabled}

              onChange={(e) => setEditIsEcommerceEnabled(e.target.checked)}

            />

            Eticaret bağlantısı

          </label>



          <div>

            <div className="text-xs font-bold text-gray-600 mb-2">Açılacak Modüller / Sayfalar</div>

            <div className="max-h-[340px] overflow-auto border border-gray-200 rounded-xl p-3 space-y-3">

              {pagesByModule.map(([moduleKey, items]) => (

                <div key={moduleKey} className="border border-gray-100 rounded-xl overflow-hidden">

                  <div className="px-3 py-2 bg-gray-50 text-xs font-bold text-gray-700">
                    {moduleKey === 'invoice' ? 'Fatura İşlemleri' :
                     moduleKey === 'cash' ? 'Kasa İşlemleri' :
                     moduleKey === 'virman' ? 'Virman' :
                     moduleKey === 'bank' ? 'Banka İşlemleri' :
                     moduleKey === 'check' ? 'Çek / Senet' :
                     moduleKey === 'employee' ? 'Çalışan Yönetimi' :
                     moduleKey === 'users' ? 'Sistem Ayarları' :
                     moduleKey === 'deleteRule' ? 'Silme Ayarları' : moduleKey}
                  </div>

                  <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-2">

                    {items.map((p) => (

                      <label key={p.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">

                        <input

                          type="checkbox"

                          checked={editEnabledPageIds.includes(p.id)}

                          onChange={() => {

                            setEditEnabledPageIds((prev) => {

                              const set = new Set(prev)

                              if (set.has(p.id)) set.delete(p.id)

                              else set.add(p.id)

                              return Array.from(set)

                            })

                          }}

                          className="mt-0.5"

                        />

                        <div>

                          <div className="text-xs font-semibold text-gray-900">{p.displayName}</div>

                          <div className="text-[11px] text-gray-500">{p.moduleKey}/{p.key}</div>

                        </div>

                      </label>

                    ))}

                  </div>

                </div>

              ))}

            </div>

          </div>



          <div className="flex items-center justify-end gap-2 pt-2">

            <button

              type="button"

              disabled={editSaving}

              onClick={() => setEditOpen(false)}

              className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"

            >

              Vazgeç

            </button>

            <button

              type="button"

              disabled={editSaving || !editTenant}

              onClick={() => {

                if (!editTenant) return

                void (async () => {

                  try {

                    setEditSaving(true)

                    setError(null)

                    const res = await fetch(`${API_BASE_URL}/api/tenants/${editTenant.tenantId}`, {

                      method: 'PUT',

                      headers: { ...buildHeaders(true) },

                      body: JSON.stringify({ name: editName.trim(), isActive: editIsActive, isEcommerceEnabled: editIsEcommerceEnabled })

                    })

                    if (!res.ok) {

                      const text = await res.text().catch(() => '')

                      throw new Error(text || `Güncelleme başarısız (${res.status})`)

                    }



                    const pagesRes = await fetch(`${API_BASE_URL}/api/tenants/${editTenant.tenantId}/enabled-pages`, {

                      method: 'PUT',

                      headers: { ...buildHeaders(true) },

                      body: JSON.stringify({ enabledPageIds: editEnabledPageIds })

                    })

                    if (!pagesRes.ok) {

                      const text = await pagesRes.text().catch(() => '')

                      throw new Error(text || `Modül/Sayfa güncelleme başarısız (${pagesRes.status})`)

                    }



                    setEditOpen(false)

                    await load()

                  } catch (e: any) {

                    setError(String(e?.message ?? 'Güncelleme hatası'))

                  } finally {

                    setEditSaving(false)

                  }

                })()

              }}

              className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"

            >

              {editSaving ? 'Kaydediliyor...' : 'Güncelle'}

            </button>

          </div>

        </div>

      </Modal>

      <Modal isOpen={assignExistingOpen} onClose={() => (assignExistingSaving ? undefined : setAssignExistingOpen(false))} title="Mevcut Kullanıcı Ata">
        <div className="space-y-3">
          <div className="text-xs text-gray-500">
            Hedef Firma: <span className="font-bold text-gray-800">{assignExistingTenant?.code}</span>
          </div>

          <input
            value={assignExistingQuery}
            onChange={(e) => setAssignExistingQuery(e.target.value)}
            className="w-full h-10 px-3 rounded-xl border border-gray-200"
            placeholder="Kullanıcı / email / firma / rol ara..."
          />

          <select
            value={selectedInstanceKey}
            onChange={(e) => setSelectedInstanceKey(e.target.value)}
            className="w-full h-10 px-3 rounded-xl border border-gray-200"
          >
            <option value="">Kaynak kullanıcı seçiniz...</option>
            {assignExistingInstances.slice(0, 200).map((x) => (
              <option key={x.key} value={x.key}>
                {x.username} — {x.sourceTenantCode} — {x.roleName}
              </option>
            ))}
          </select>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Hedef Rol</div>
            <select
              value={String(assignExistingRoleId)}
              onChange={(e) => {
                const nextRoleId = Number(e.target.value)
                setAssignExistingRoleId(nextRoleId)
                const nextRole = visibleAssignExistingRoles.find((r) => Number(r.id) === Number(nextRoleId))
                if (Boolean(nextRole?.isSuperAdmin)) setAssignExistingWarehouseCodes(new Set())
              }}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
            >
              {visibleAssignExistingRoles.length === 0 ? (
                <option value={String(assignExistingRoleId)}>Rol yükleniyor...</option>
              ) : (
                visibleAssignExistingRoles.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.displayName || r.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {(() => {
            const selectedRole = (assignExistingRoles ?? []).find((r) => Number(r.id) === Number(assignExistingRoleId))
            const roleIsSuperAdmin = Boolean(selectedRole?.isSuperAdmin)
            if (roleIsSuperAdmin) return null
            return (
              <div>
                <div className="text-xs font-bold text-gray-600 mb-1">Depolar</div>
                <div className="max-h-[220px] overflow-auto border border-gray-200 rounded-xl">
                  <div className="divide-y divide-gray-100">
                    {assignExistingWarehouses.length === 0 ? (
                      <div className="p-3 text-xs text-gray-500">Depo bulunamadı</div>
                    ) : (
                      assignExistingWarehouses.map((w) => {
                        const code = Number(w.warehouseCode)
                        const checked = assignExistingWarehouseCodes.has(code)
                        return (
                          <label key={String(code)} className="flex items-center gap-2 p-3 text-sm text-gray-700 cursor-pointer hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const on = e.target.checked
                                setAssignExistingWarehouseCodes((prev) => {
                                  const next = new Set(prev)
                                  if (on) next.add(code)
                                  else next.delete(code)
                                  return next
                                })
                              }}
                            />
                            <span className="font-semibold text-gray-800">[{code}]</span>
                            <span className="text-gray-600">{String(w.name ?? '').trim()}</span>
                          </label>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            )
          })()}

          <div className="text-[11px] font-bold text-gray-500">
            Liste: <span className="text-gray-900">{assignExistingInstances.length}</span> (ilk 200 gösteriliyor)
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={assignExistingSaving}
              onClick={() => setAssignExistingOpen(false)}
              className="h-10 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={assignExistingSaving}
              onClick={() => void submitAssignExisting()}
              className="h-10 px-4 rounded-xl bg-gradient-to-r from-red-700 via-rose-600 to-red-700 text-white hover:from-red-800 hover:via-rose-700 hover:to-red-800 text-sm font-semibold"
            >
              {assignExistingSaving ? 'Atanıyor...' : 'Ata'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={createUserOpen} onClose={() => (createUserSaving ? undefined : setCreateUserOpen(false))} title="Kullanıcı Ekle">
        <div className="space-y-3">
          <div className="text-xs text-gray-500">
            Firma: <span className="font-bold text-gray-800">{createUserTenant?.code}</span>
          </div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Kullanıcı Adı</div>
            <input value={createUserUsername} onChange={(e) => setCreateUserUsername(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200" />
          </div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Email</div>
            <input value={createUserMail} onChange={(e) => setCreateUserMail(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200" />
          </div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Telefon</div>
            <input
              inputMode="numeric"
              value={createUserPhone}
              onChange={(e) => {
                const formatted = formatPhoneNumber(e.target.value)
                setCreateUserPhone(formatted)
              }}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
              placeholder="0555 555 5555 555"
            />
          </div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Cari Listesi</div>
            <select
              value={createUserCariCode}
              onChange={(e) => setCreateUserCariCode(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
            >
              <option value="">Seçiniz...</option>
              {createUserCustomers.map((c) => (
                <option key={c.customerCode} value={c.customerCode}>
                  [{c.customerCode}] {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Ünvan</div>
            <input value={createUserUnvan} onChange={(e) => setCreateUserUnvan(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200" />
          </div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Şifre</div>
            <div className="relative">
              <input
                value={createUserPassword}
                onChange={(e) => setCreateUserPassword(e.target.value)}
                type={showCreateUserPassword ? 'text' : 'password'}
                className="w-full h-10 px-3 pr-10 rounded-xl border border-gray-200"
              />
              <button
                type="button"
                onClick={() => setShowCreateUserPassword((p) => !p)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                aria-label={showCreateUserPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                title={showCreateUserPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
              >
                {showCreateUserPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Rol</div>
            <select
              value={String(createUserRoleId)}
              onChange={(e) => {
                const nextRoleId = Number(e.target.value)
                setCreateUserRoleId(nextRoleId)
                const nextRole = (createUserRoles ?? []).find((r) => Number(r.id) === nextRoleId)
                if (Boolean(nextRole?.isSuperAdmin)) setCreateUserWarehouseCodes(new Set())
              }}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
            >
              {visibleCreateUserRoles.length === 0 ? (
                <option value={String(createUserRoleId)}>Rol yükleniyor...</option>
              ) : (
                visibleCreateUserRoles.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.displayName || r.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {(() => {
            const selectedRole = (createUserRoles ?? []).find((r) => Number(r.id) === Number(createUserRoleId))
            const roleIsSuperAdmin = Boolean(selectedRole?.isSuperAdmin)
            if (roleIsSuperAdmin) return null
            return (
              <div>
                <div className="text-xs font-bold text-gray-600 mb-1">Depolar</div>
                <div className="max-h-[220px] overflow-auto border border-gray-200 rounded-xl">
                  <div className="divide-y divide-gray-100">
                    {createUserWarehouses.length === 0 ? (
                      <div className="p-3 text-xs text-gray-500">Depo bulunamadı</div>
                    ) : (
                      createUserWarehouses.map((w) => {
                        const code = Number(w.warehouseCode)
                        const checked = createUserWarehouseCodes.has(code)
                        return (
                          <label key={String(code)} className="flex items-center gap-2 p-3 text-sm text-gray-700 cursor-pointer hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const on = e.target.checked
                                setCreateUserWarehouseCodes((prev) => {
                                  const next = new Set(prev)
                                  if (on) next.add(code)
                                  else next.delete(code)
                                  return next
                                })
                              }}
                            />
                            <span className="font-semibold text-gray-800">[{code}]</span>
                            <span className="text-gray-600">{String(w.name ?? '').trim()}</span>
                          </label>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            )
          })()}

          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <input type="checkbox" checked={createUserIsActive} onChange={(e) => setCreateUserIsActive(e.target.checked)} />
            Aktif
          </label>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={createUserSaving}
              onClick={() => setCreateUserOpen(false)}
              className="h-10 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={createUserSaving}
              onClick={() => void submitCreateUser()}
              className="h-10 px-4 rounded-xl bg-gradient-to-r from-red-700 via-rose-600 to-red-700 text-white hover:from-red-800 hover:via-rose-700 hover:to-red-800 text-sm font-semibold"
            >
              {createUserSaving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      </Modal>



      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (saving) return
          setCreateOpen(false)
          setCreateBrandingLogoFile(null)
          setCreateHeaderGradientFrom('#8F2500')
          setCreateHeaderGradientTo('#FF4B1F')
          setForm({
            code: '',
            name: '',
            enabledPageIds: [],
            superAdminUsername: '',
            superAdminMail: '',
            superAdminPassword: '',
            isEcommerceEnabled: false,
            serviceOpsEnabled: false,
            serviceOpsSuperAdminUsername: '',
            serviceOpsSuperAdminMail: '',
            serviceOpsSuperAdminPassword: ''
          })
        }}
        title="Yeni Firma Oluştur"
      >

        <div className="space-y-4">

          <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">

            <div className="flex items-start justify-between gap-3">

              <div>

                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Firma Bilgileri</div>

                <div className="text-sm font-extrabold text-gray-900 mt-1">Temel bilgiler</div>

              </div>

              <div className="text-[11px] font-bold text-gray-500">Seçili sayfa: {form.enabledPageIds.length}</div>

            </div>



            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">

              <div>

                <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Firma Kodu</div>

                <input

                  value={form.code}

                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}

                  className="mt-1 w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"

                  placeholder="Örn: AFIRMASI"

                />

                <div className="text-[11px] text-gray-500 mt-1 ml-1">Otomatik normalize edilir (A-Z, 0-9, _).</div>

              </div>

              <div>

                <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Firma Adı</div>

                <input

                  value={form.name}

                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}

                  className="mt-1 w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"

                  placeholder="Örn: Stilsoft Bayi"

                />

              </div>

            </div>

          </div>



          <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">

            <div>

              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Firma</div>

              <div className="text-sm font-extrabold text-gray-900 mt-1">Logo & Header Renkleri</div>

            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">

              <div>

                <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Logo (png/jpg/jpeg/webp)</div>

                <input

                  type="file"

                  accept="image/png,image/jpeg,image/webp"

                  onChange={(e) => {

                    const f = e.target.files?.[0] ?? null

                    setCreateBrandingLogoFile(f)

                  }}

                  className="mt-1 w-full h-11 px-4 py-2 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"

                />

                <div className="text-[11px] text-gray-500 mt-1 ml-1">Maks: 2MB.</div>

              </div>

              <div>

                <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Header Gradient</div>

                <div className="mt-2 flex items-center gap-3">

                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">

                    <input

                      type="color"

                      value={createHeaderGradientFrom}

                      onChange={(e) => setCreateHeaderGradientFrom(e.target.value)}

                      className="h-10 w-12 rounded border border-gray-200"

                    />

                    Sol

                  </label>

                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">

                    <input

                      type="color"

                      value={createHeaderGradientTo}

                      onChange={(e) => setCreateHeaderGradientTo(e.target.value)}

                      className="h-10 w-12 rounded border border-gray-200"

                    />

                    Sağ

                  </label>

                </div>

                <div

                  className="mt-3 h-10 rounded-2xl border border-gray-200"

                  style={{ background: `linear-gradient(90deg, ${createHeaderGradientFrom}, ${createHeaderGradientTo})` }}

                />

              </div>

            </div>

          </div>



          <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">

            <div>

              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">SuperAdmin</div>

              <div className="text-sm font-extrabold text-gray-900 mt-1">İlk yönetici hesabı</div>

            </div>



            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">

              <div>

                <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Kullanıcı Adı</div>

                <input

                  value={form.superAdminUsername}

                  onChange={(e) => setForm((p) => ({ ...p, superAdminUsername: e.target.value }))}

                  className="mt-1 w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"

                  placeholder="admin"

                />

              </div>

              <div>

                <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Mail</div>

                <input

                  value={form.superAdminMail}

                  onChange={(e) => setForm((p) => ({ ...p, superAdminMail: e.target.value }))}

                  className="mt-1 w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"

                  placeholder="admin@firma.com"

                />

              </div>

              <div className="md:col-span-2">

                <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Şifre</div>

                <input

                  value={form.superAdminPassword}

                  onChange={(e) => setForm((p) => ({ ...p, superAdminPassword: e.target.value }))}

                  className="mt-1 w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"

                  placeholder="••••••••"

                />

              </div>

            </div>

          </div>



          <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">

            <div className="flex items-start justify-between gap-3">

              <div>

                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Servis Portalı</div>

                <div className="text-sm font-extrabold text-gray-900 mt-1">Ayrı giriş (microservice)</div>

              </div>

              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 select-none">

                <input

                  type="checkbox"

                  checked={Boolean(form.serviceOpsEnabled)}

                  onChange={(e) => setForm((p) => ({ ...p, serviceOpsEnabled: e.target.checked }))}

                  className="h-4 w-4"

                />

                Aktif

              </label>

            </div>



            {form.serviceOpsEnabled ? (

              <div className="mt-4">

                <div className="flex items-center justify-end">

                  <button

                    type="button"

                    onClick={() =>

                      setForm((p) => ({

                        ...p,

                        serviceOpsSuperAdminUsername: p.superAdminUsername,

                        serviceOpsSuperAdminMail: p.superAdminMail,

                        serviceOpsSuperAdminPassword: p.superAdminPassword

                      }))

                    }

                    className="h-8 px-3 rounded-xl border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 hover:bg-gray-50"

                  >

                    ERP SuperAdmin ile aynı

                  </button>

                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">

                  <div>

                    <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Kullanıcı Adı</div>

                    <input

                      value={form.serviceOpsSuperAdminUsername}

                      onChange={(e) => setForm((p) => ({ ...p, serviceOpsSuperAdminUsername: e.target.value }))}

                      className="mt-1 w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"

                      placeholder="serviceadmin"

                    />

                  </div>

                  <div>

                    <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Mail</div>

                    <input

                      value={form.serviceOpsSuperAdminMail}

                      onChange={(e) => setForm((p) => ({ ...p, serviceOpsSuperAdminMail: e.target.value }))}

                      className="mt-1 w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"

                      placeholder="serviceadmin@firma.com"

                    />

                  </div>

                  <div className="md:col-span-2">

                    <div className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1">Şifre</div>

                    <input

                      value={form.serviceOpsSuperAdminPassword}

                      onChange={(e) => setForm((p) => ({ ...p, serviceOpsSuperAdminPassword: e.target.value }))}

                      className="mt-1 w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition"

                      placeholder="••••••••"

                    />

                  </div>

                </div>

              </div>

            ) : null}

          </div>



          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">

            <div className="px-4 sm:px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white">

              <div className="flex items-start justify-between gap-3">

                <div>

                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Yetkiler</div>

                  <div className="text-sm font-extrabold text-gray-900 mt-1">Açılacak Modüller / Sayfalar</div>

                </div>

                <div className="flex items-center gap-2">

                  <div className="text-[11px] font-bold text-gray-500">Toplam seçili: {form.enabledPageIds.length}</div>

                  <button

                    type="button"

                    onClick={() => setForm((p) => ({ ...p, enabledPageIds: allPageIds }))}

                    className="h-8 px-3 rounded-xl border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 hover:bg-gray-50"

                  >

                    Hepsini Seç

                  </button>

                  <button

                    type="button"

                    onClick={() => setForm((p) => ({ ...p, enabledPageIds: [] }))}

                    className="h-8 px-3 rounded-xl border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 hover:bg-gray-50"

                  >

                    Temizle

                  </button>

                </div>

              </div>

            </div>

            <div className="max-h-[380px] overflow-auto p-3 sm:p-4 space-y-3">

              {pagesByModule.map(([moduleKey, items]) => {
                const moduleIds = items.map((x) => x.id)
                const selectedCount = moduleIds.reduce((acc, id) => acc + (form.enabledPageIds.includes(id) ? 1 : 0), 0)
                const moduleChecked = moduleIds.length > 0 && selectedCount === moduleIds.length
                const moduleIndeterminate = selectedCount > 0 && selectedCount < moduleIds.length

                const toggleModule = () => {
                  setForm((prev) => {
                    const set = new Set(prev.enabledPageIds)
                    if (moduleChecked) moduleIds.forEach((id) => set.delete(id))
                    else moduleIds.forEach((id) => set.add(id))
                    return { ...prev, enabledPageIds: Array.from(set) }
                  })
                }

                return (
                  <div key={moduleKey} className="border border-gray-100 rounded-2xl overflow-hidden">
                    <div className="px-3 py-2.5 bg-gray-50 text-[11px] font-black uppercase tracking-[0.14em] text-gray-700">
                      <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
                        <span className="truncate">
                          {moduleKey === 'invoice' ? 'Fatura İşlemleri' :
                           moduleKey === 'cash' ? 'Kasa İşlemleri' :
                           moduleKey === 'virman' ? 'Virman' :
                           moduleKey === 'bank' ? 'Banka İşlemleri' :
                           moduleKey === 'check' ? 'Çek / Senet' :
                           moduleKey === 'employee' ? 'Çalışan Yönetimi' :
                           moduleKey === 'users' ? 'Sistem Ayarları' :
                           moduleKey === 'deleteRule' ? 'Silme Ayarları' : moduleKey}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-gray-500 normal-case tracking-normal">
                            {selectedCount}/{moduleIds.length}
                          </span>
                          <input
                            type="checkbox"
                            checked={moduleChecked}
                            ref={(el) => {
                              if (el) el.indeterminate = moduleIndeterminate
                            }}
                            onChange={toggleModule}
                            className="h-4 w-4"
                          />
                        </span>
                      </label>
                    </div>

                    <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                      {items.map((p) => {
                        const checked = form.enabledPageIds.includes(p.id)
                        return (
                          <label
                            key={p.id}
                            className={
                              'group flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer border transition ' +
                              (checked ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-transparent hover:bg-gray-50 hover:border-gray-100')
                            }
                          >
                            <input type="checkbox" checked={checked} onChange={() => togglePage(p.id)} className="mt-0.5" />
                            <div className="min-w-0">
                              <div className="text-xs font-extrabold text-gray-900 truncate">{p.displayName}</div>
                              <div className="text-[11px] text-gray-500 truncate">
                                {p.moduleKey}/{p.key}
                              </div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

            </div>

          </div>



          <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">

            <div>

              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">E-Ticaret</div>

              <div className="text-sm font-extrabold text-gray-900 mt-1">Eticaret bağlantısı</div>

            </div>

            <label className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-gray-700 select-none">

              <input

                type="checkbox"

                checked={Boolean(form.isEcommerceEnabled)}

                onChange={(e) => setForm((p) => ({ ...p, isEcommerceEnabled: e.target.checked }))}

                className="h-4 w-4"

              />

              Eticaret bağlantısı

            </label>

          </div>



          <div className="flex items-center justify-end gap-2 pt-1">

            <button

              type="button"

              disabled={saving}

              onClick={() => setCreateOpen(false)}

              className="h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"

            >

              Vazgeç

            </button>

            <button

              type="button"

              disabled={saving}

              onClick={() => void submit()}

              className="h-11 px-5 rounded-2xl bg-gradient-to-r from-red-700 via-rose-600 to-red-700 text-white hover:from-red-800 hover:via-rose-700 hover:to-red-800 text-sm font-semibold disabled:opacity-60 shadow-[0_18px_35px_-22px_rgba(244,63,94,0.55)]"

            >

              {saving ? 'Oluşturuluyor...' : 'Firmayı Oluştur'}

            </button>

          </div>

        </div>

      </Modal>

    </div>

  )

}

