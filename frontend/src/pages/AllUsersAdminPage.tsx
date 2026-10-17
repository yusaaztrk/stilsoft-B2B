import React, { useEffect, useMemo, useState } from 'react'
import { PHONE_MAX_LENGTH, formatPhoneNumber } from '../utils/phone'
import { API_BASE_URL } from '../config/api'
import Modal from '../components/Modal'
import ActionDropdown from '../components/ActionDropdown'
import SsaDashboardHeader from '../components/SsaDashboardHeader'
import { CircleCheck, CircleX, Copy, Pencil, RefreshCw, Shield, UserPlus, Users as UsersIcon } from 'lucide-react'
import { redirectToLogin } from '../auth/redirectToLogin'

type TenantListItem = {
  tenantId: number
  code: string
  name: string
  dbName?: string
  isActive?: boolean
}

type SsaUserRow = {
  username: string
  mail: string
  unvan: string
  isActive: boolean
  userKey: string
  tenants: Array<{
    tenantId: number
    tenantCode: string
    tenantName: string
    userId: number
    roleId: number
    roleCode: string
    roleName: string
    isActive: boolean
    firmaCode?: string | null
  }>
}

type RoleItem = { id: number; displayName: string; name: string; isSuperAdmin?: boolean; isActive?: boolean }

type PageItem = {
  id: number
  moduleKey: string
  key: string
  displayName: string
  sortOrder: number
  isActive: boolean
}

type PermissionItem = {
  pageId: number
  moduleKey: string
  pageKey: string
  displayName: string
  canAccess: boolean
  isTenantEnabled: boolean
}

type WarehouseDropdownItem = {
  warehouseCode: number
  name?: string | null
}

export default function AllUsersAdminPage() {
  const buildHeaders = (includeJson: boolean) => {
    const headers: Record<string, string> = {}
    if (includeJson) headers['Content-Type'] = 'application/json'
    const token = localStorage.getItem('accessToken')
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }

  const buildTenantHeaders = (tenantCode: string, includeJson: boolean) => {
    const headers = buildHeaders(includeJson)
    const code = String(tenantCode ?? '').trim().toUpperCase()
    if (code) headers['X-Tenant-Code'] = code
    return headers
  }

  const readError = async (res: Response, fallback: string) => {
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

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<SsaUserRow[]>([])
  const [tenants, setTenants] = useState<TenantListItem[]>([])

  const [query, setQuery] = useState('')
  const [tenantFilter, setTenantFilter] = useState('')
  const [showInactiveUsers, setShowInactiveUsers] = useState(false)

  const [selectedUserKeys, setSelectedUserKeys] = useState<Set<string>>(new Set())

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailUser, setDetailUser] = useState<SsaUserRow | null>(null)

  const [assignOpen, setAssignOpen] = useState(false)
  const [assignSaving, setAssignSaving] = useState(false)
  const [sourceRow, setSourceRow] = useState<SsaUserRow | null>(null)

  const [assignTargetTenantCode, setAssignTargetTenantCode] = useState('')
  const [assignTargetTenantId, setAssignTargetTenantId] = useState<number>(0)
  const [assignTargetRoles, setAssignTargetRoles] = useState<RoleItem[]>([])
  const [assignTargetRoleEnabledMap, setAssignTargetRoleEnabledMap] = useState<Record<number, boolean>>({})
  const [assignTargetRoleId, setAssignTargetRoleId] = useState<number>(1)
  const [assignTargetWarehouses, setAssignTargetWarehouses] = useState<WarehouseDropdownItem[]>([])
  const [assignTargetWarehouseCodes, setAssignTargetWarehouseCodes] = useState<Set<number>>(new Set())

  const [editOpen, setEditOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editTenantCode, setEditTenantCode] = useState('')
  const [editTenantId, setEditTenantId] = useState<number>(0)
  const [editUserId, setEditUserId] = useState<number>(0)
  const [editRoles, setEditRoles] = useState<RoleItem[]>([])
  const [editRoleEnabledMap, setEditRoleEnabledMap] = useState<Record<number, boolean>>({})
  const [editWarehouses, setEditWarehouses] = useState<WarehouseDropdownItem[]>([])
  const [editMail, setEditMail] = useState('')
  const [editUnvan, setEditUnvan] = useState('')
  const [editGsm, setEditGsm] = useState('')
  const [editCarikodu, setEditCarikodu] = useState('')
  const [editSalesmanCode, setEditSalesmanCode] = useState('')
  const [showEditGsm, setShowEditGsm] = useState(false)
  const [showEditCarikodu, setShowEditCarikodu] = useState(false)
  const [showEditSalesmanCode, setShowEditSalesmanCode] = useState(false)
  const [editIsActive, setEditIsActive] = useState(true)
  const [editRoleId, setEditRoleId] = useState<number>(1)
  const [editPassword, setEditPassword] = useState('')
  const [editWarehouseCodes, setEditWarehouseCodes] = useState<Set<number>>(new Set())

  const [permOpen, setPermOpen] = useState(false)
  const [permSaving, setPermSaving] = useState(false)
  const [allPages, setAllPages] = useState<PageItem[]>([])
  const [tenantEnabledPageIds, setTenantEnabledPageIds] = useState<Set<number>>(new Set())
  const [permissions, setPermissions] = useState<PermissionItem[]>([])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [usersRes, tenantsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/ssa-users/grouped`, { headers: { ...buildHeaders(false) } }),
        fetch(`${API_BASE_URL}/api/tenants`, { headers: { ...buildHeaders(false) } })
      ])

      if (!usersRes.ok) throw new Error((await usersRes.text().catch(() => '')) || `Kullanıcılar alınamadı (${usersRes.status})`)
      if (!tenantsRes.ok) throw new Error((await tenantsRes.text().catch(() => '')) || `Firmalar alınamadı (${tenantsRes.status})`)

      const usersJson = await usersRes.json().catch(() => null)
      const tenantsJson = await tenantsRes.json().catch(() => null)

      setRows((usersJson?.data ?? []) as SsaUserRow[])
      setTenants((tenantsJson?.data ?? []) as TenantListItem[])
    } catch (e: any) {
      setError(String(e?.message ?? 'Yükleme hatası'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const tenantOptions = useMemo(() => {
    return (tenants ?? [])
      .map((t) => ({ code: String(t.code ?? '').trim().toUpperCase(), name: String(t.name ?? '').trim() }))
      .filter((t) => t.code)
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [tenants])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      return (
        String(r.username ?? '').toLowerCase().includes(q) ||
        String(r.mail ?? '').toLowerCase().includes(q) ||
        String(r.unvan ?? '').toLowerCase().includes(q) ||
        (r.tenants ?? []).some((t) => String(t.tenantCode ?? '').toLowerCase().includes(q) || String(t.tenantName ?? '').toLowerCase().includes(q))
      )
    })
  }, [rows, query])

  const filteredRows = useMemo(() => {
    const tf = String(tenantFilter ?? '').trim().toUpperCase()
    return (filtered ?? [])
      .filter((r) => (showInactiveUsers ? true : Boolean(r.isActive)))
      .filter((r) => {
        if (!tf) return true
        return (r.tenants ?? []).some((t) => String(t.tenantCode ?? '').trim().toUpperCase() === tf)
      })
  }, [filtered, showInactiveUsers, tenantFilter])

  const stats = useMemo(() => {
    const list = rows ?? []
    const total = list.length
    const active = list.filter((x) => Boolean(x.isActive)).length
    const inactive = total - active
    const tenantCount = new Set(
      list
        .flatMap((r) => (r.tenants ?? []).map((t) => String(t.tenantCode ?? '').trim().toUpperCase()).filter(Boolean))
        .filter(Boolean)
    ).size
    return { total, active, inactive, tenantCount }
  }, [rows])

  const selectedRows = useMemo(() => {
    if (!selectedUserKeys || selectedUserKeys.size === 0) return [] as SsaUserRow[]
    const keys = selectedUserKeys
    return (filteredRows ?? []).filter((r) => keys.has(String(r.userKey)))
  }, [filteredRows, selectedUserKeys])

  const toggleSelect = (key: string, checked: boolean) => {
    const k = String(key ?? '')
    if (!k) return
    setSelectedUserKeys((prev) => {
      const next = new Set(prev)
      if (checked) next.add(k)
      else next.delete(k)
      return next
    })
  }

  const clearSelection = () => setSelectedUserKeys(new Set())

  const openDetail = (row: SsaUserRow) => {
    setDetailUser(row)
    setDetailOpen(true)
  }

  const exportCsv = (list: SsaUserRow[], fileName: string) => {
    const rows = list ?? []
    const escape = (v: any) => {
      const s = String(v ?? '')
      const needs = /[\n\r,\"]/g.test(s)
      const out = s.replace(/\"/g, '""')
      return needs ? `"${out}"` : out
    }
    const header = ['username', 'mail', 'unvan', 'isActive', 'tenants']
    const lines = [header.join(',')]
    rows.forEach((r) => {
      const tenantCodes = (r.tenants ?? []).map((t) => String(t.tenantCode ?? '').trim().toUpperCase()).filter(Boolean).join(' | ')
      lines.push(
        [
          escape(r.username),
          escape(r.mail),
          escape(r.unvan),
          escape(Boolean(r.isActive) ? 'true' : 'false'),
          escape(tenantCodes)
        ].join(',')
      )
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const [sourceTenantCode, setSourceTenantCode] = useState('')
  const [sourceUserId, setSourceUserId] = useState<number>(0)

  const openAssign = (row: SsaUserRow) => {
    setSourceRow(row)
    const first = (row.tenants ?? [])[0]
    const code = String(first?.tenantCode ?? '').toUpperCase()
    setSourceTenantCode(code)
    setSourceUserId(Number(first?.userId ?? 0))

    setAssignTargetTenantCode('')
    setAssignTargetTenantId(0)
    setAssignTargetRoles([])
    setAssignTargetRoleEnabledMap({})
    setAssignTargetRoleId(1)
    setAssignTargetWarehouses([])
    setAssignTargetWarehouseCodes(new Set())

    setAssignOpen(true)
  }

  const openEdit = (row: SsaUserRow) => {
    void (async () => {
      try {
        setLoading(true)
        setError(null)
        setSourceRow(row)
        const first = (row.tenants ?? [])[0]
        const tenantCode = String(first?.tenantCode ?? '').toUpperCase()
        const tenantId = Number(first?.tenantId ?? 0)
        const userId = Number(first?.userId ?? 0)

        if (!tenantCode || !tenantId || !userId) {
          throw new Error('Kullanıcı için firma seçimi bulunamadı')
        }

        setEditTenantCode(tenantCode)
        setEditTenantId(tenantId)
        setEditUserId(userId)
        setEditRoleEnabledMap({})

        const [rolesRes, usersRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/roles`, { headers: { ...buildTenantHeaders(tenantCode, false) } }),
          fetch(`${API_BASE_URL}/api/users`, { headers: { ...buildTenantHeaders(tenantCode, false) } })
        ])

        const whRes = await fetch(`${API_BASE_URL}/api/warehouses/dropdown`, {
          headers: { ...buildTenantHeaders(tenantCode, false) }
        })

        if (!rolesRes.ok) throw new Error(await readError(rolesRes, 'Roller alınamadı'))
        if (!usersRes.ok) throw new Error(await readError(usersRes, 'Kullanıcılar alınamadı'))
        if (!whRes.ok) throw new Error(await readError(whRes, 'Depolar alınamadı'))

        const rolesJson = await rolesRes.json().catch(() => null)
        const roles = (rolesJson?.data ?? []) as any[]
        setEditRoles(
          roles
            .map((r) => ({
              id: Number(r.id),
              name: String(r.name ?? ''),
              displayName: String(r.displayName ?? r.name ?? ''),
              isSuperAdmin: Boolean(r.isSuperAdmin),
              isActive: Boolean(r.isActive ?? true)
            }))
            .filter((x) => Number.isFinite(x.id) && x.id > 0)
        )

        const enabledRes = await fetch(`${API_BASE_URL}/api/tenants/${tenantId}/enabled-pages`, { headers: { ...buildHeaders(false) } })
        if (!enabledRes.ok) throw new Error(await readError(enabledRes, 'Tenant sayfaları alınamadı'))
        const enabledJson = await enabledRes.json().catch(() => null)
        const enabledIdList: number[] = (Array.isArray(enabledJson?.data) ? (enabledJson.data as any[]) : [])
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isFinite(n) && n > 0)
        const enabledSet = new Set<number>(enabledIdList)

        const whJson = await whRes.json().catch(() => null)
        setEditWarehouses(
          ((whJson?.data ?? []) as any[])
            .map((x) => ({ warehouseCode: Number(x.warehouseCode ?? x.warehouse_code ?? x.code ?? 0), name: x.name ?? null }))
            .filter((x) => Number.isFinite(x.warehouseCode) && x.warehouseCode > 0)
            .sort((a, b) => a.warehouseCode - b.warehouseCode)
        )

        const usersJson = await usersRes.json().catch(() => null)
        const list = (usersJson?.data ?? []) as any[]
        const u = list.find((x) => Number(x?.id) === userId)
        if (!u) throw new Error('Kullanıcı bulunamadı')

        setEditMail(String(u.mail ?? '').trim())
        setEditUnvan(String(u.unvan ?? '').trim())
        const gsm = String(u.gsm ?? '').trim()
        const carikodu = String(u.carikodu ?? '').trim()
        const salesmanCode = String(u.salesmanCode ?? '').trim()
        setEditGsm(gsm)
        setEditCarikodu(carikodu)
        setEditSalesmanCode(salesmanCode)
        setShowEditGsm(Boolean(gsm))
        setShowEditCarikodu(Boolean(carikodu))
        setShowEditSalesmanCode(Boolean(salesmanCode))
        setEditIsActive(Boolean(u.isActive ?? true))
        setEditRoleId(Number(u.roleId ?? 1))
        setEditPassword('')
        setEditWarehouseCodes(
          new Set<number>(
            (Array.isArray(u.warehouseCodes) ? (u.warehouseCodes as any[]) : [])
              .map((n) => Number(n))
              .filter((n) => Number.isFinite(n) && n > 0)
          )
        )

        const roleList: RoleItem[] = roles
          .map((r) => ({
            id: Number(r.id),
            name: String(r.name ?? ''),
            displayName: String(r.displayName ?? r.name ?? ''),
            isSuperAdmin: Boolean(r.isSuperAdmin),
            isActive: Boolean(r.isActive ?? true)
          }))
          .filter((x) => Number.isFinite(x.id) && x.id > 0)

        const enabledMapEntries = await Promise.all(
          roleList.map(async (role) => {
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

        setEditRoleEnabledMap(Object.fromEntries(enabledMapEntries))

        setEditOpen(true)
      } catch (e: any) {
        setError(String(e?.message ?? 'Düzenleme açma hatası'))
      } finally {
        setLoading(false)
      }
    })()
  }

  const visibleEditRoles = useMemo(() => {
    const list = editRoles ?? []
    const currentRoleId = Number(editRoleId)
    const filtered = list.filter((r) => {
      const rid = Number(r.id)
      if (rid === currentRoleId) return true
      if (!r.isActive) return false
      const enabled = editRoleEnabledMap[rid]
      return enabled === undefined ? true : Boolean(enabled)
    })
    return filtered.slice().sort((a, b) => Number(a.id) - Number(b.id))
  }, [editRoles, editRoleEnabledMap, editRoleId])

  const saveEdit = async () => {
    if (!sourceRow || !editTenantCode || !editUserId) return
    try {
      setEditSaving(true)
      setError(null)

      const selectedRole = editRoles.find((r) => Number(r.id) === Number(editRoleId))
      const roleIsSuperAdmin = Boolean(selectedRole?.isSuperAdmin)

      const warehouseCodes = roleIsSuperAdmin
        ? []
        : Array.from(editWarehouseCodes)
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
            .filter((n, idx, arr) => arr.indexOf(n) === idx)



      const payload: any = {
        username: String(sourceRow.username ?? '').trim(),
        mail: editMail.trim(),
        unvan: editUnvan.trim(),
        isActive: editIsActive,
        roleId: editRoleId,
        warehouseCodes
      }

      if (showEditGsm) {
        const raw = editGsm.trim()
        if (!raw) {
          payload.gsm = null
        } else {
          payload.gsm = raw
        }
      }

      if (showEditCarikodu) {
        const raw = editCarikodu.trim()
        payload.carikodu = raw || null
      }

      if (showEditSalesmanCode) {
        const raw = editSalesmanCode.trim()
        payload.salesmanCode = raw || null
      }

      if (editPassword.trim()) payload.password = editPassword

      const res = await fetch(`${API_BASE_URL}/api/users/${editUserId}`, {
        method: 'PUT',
        headers: { ...buildTenantHeaders(editTenantCode, true) },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error(await readError(res, 'Kullanıcı güncellenemedi'))

      setEditOpen(false)
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? 'Güncelleme hatası'))
    } finally {
      setEditSaving(false)
    }
  }

  const openRolePermissions = () => {
    if (!editTenantCode || !editTenantId || !editRoleId) return
    void (async () => {
      try {
        setPermSaving(true)
        setError(null)

        const [pagesRes, enabledRes, permRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/pages/all`, { headers: { ...buildHeaders(false) } }),
          fetch(`${API_BASE_URL}/api/tenants/${editTenantId}/enabled-pages`, { headers: { ...buildHeaders(false) } }),
          fetch(`${API_BASE_URL}/api/roles/${editRoleId}/permissions`, { headers: { ...buildTenantHeaders(editTenantCode, false) } })
        ])

        if (!pagesRes.ok) throw new Error(await readError(pagesRes, 'Sayfalar alınamadı'))
        if (!enabledRes.ok) throw new Error(await readError(enabledRes, 'Tenant sayfaları alınamadı'))
        if (!permRes.ok) throw new Error(await readError(permRes, 'Rol yetkileri alınamadı'))

        const pagesJson = await pagesRes.json().catch(() => null)
        const enabledJson = await enabledRes.json().catch(() => null)
        const permJson = await permRes.json().catch(() => null)

        const pages = ((pagesJson?.data ?? []) as any[])
          .map((p) => ({
            id: Number(p.id),
            moduleKey: String(p.moduleKey ?? ''),
            key: String(p.key ?? ''),
            displayName: String(p.displayName ?? ''),
            sortOrder: Number(p.sortOrder ?? 0),
            isActive: Boolean(p.isActive ?? true)
          }))
          .filter((p) => Number.isFinite(p.id) && p.id > 0)
        setAllPages(pages)

        const enabledIdList: number[] = (Array.isArray(enabledJson?.data) ? (enabledJson.data as any[]) : [])
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isFinite(n) && n > 0)

        const enabledIds = new Set<number>(enabledIdList)
        setTenantEnabledPageIds(enabledIds)

        const permItems = Array.isArray(permJson?.data) ? (permJson.data as any[]) : []
        const permMap = new Map<number, boolean>()
        permItems.forEach((x) => {
          const pid = Number(x?.pageId)
          if (!Number.isFinite(pid) || pid <= 0) return
          permMap.set(pid, Boolean(x?.canAccess))
        })

        const items: PermissionItem[] = pages
          .slice()
          .sort((a, b) => {
            const mk = a.moduleKey.localeCompare(b.moduleKey)
            if (mk !== 0) return mk
            return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
          })
          .map((p) => {
            const isTenantEnabled = enabledIds.has(p.id)
            const canAccess = isTenantEnabled ? Boolean(permMap.get(p.id) ?? false) : false
            return {
              pageId: p.id,
              moduleKey: p.moduleKey,
              pageKey: p.key,
              displayName: p.displayName,
              canAccess,
              isTenantEnabled
            }
          })

        setPermissions(items)
        setPermOpen(true)
      } catch (e: any) {
        setError(String(e?.message ?? 'Yetki yükleme hatası'))
      } finally {
        setPermSaving(false)
      }
    })()
  }

  const saveRolePermissions = async () => {
    if (!editTenantCode || !editRoleId) return
    try {
      setPermSaving(true)
      setError(null)

      const payload = {
        permissions: (permissions ?? [])
          .filter((p) => p.isTenantEnabled)
          .map((p) => ({ pageId: p.pageId, canAccess: Boolean(p.canAccess) }))
      }

      const res = await fetch(`${API_BASE_URL}/api/roles/${editRoleId}/permissions`, {
        method: 'PUT',
        headers: { ...buildTenantHeaders(editTenantCode, true) },
        body: JSON.stringify(payload)
      })

      if (!res.ok) throw new Error(await readError(res, 'Rol yetkileri güncellenemedi'))
      setPermOpen(false)
    } catch (e: any) {
      setError(String(e?.message ?? 'Yetki kaydetme hatası'))
    } finally {
      setPermSaving(false)
    }
  }

  const loadAssignTargetMeta = async (tenantCodeRaw: string) => {
    const tenantCode = String(tenantCodeRaw ?? '').trim().toUpperCase()
    if (!tenantCode) return
    const tenant = (tenants ?? []).find((t) => String(t.code ?? '').trim().toUpperCase() === tenantCode)
    const tenantId = Number(tenant?.tenantId ?? 0)
    if (!Number.isFinite(tenantId) || tenantId <= 0) throw new Error('Hedef firma bulunamadı')

    setAssignTargetTenantId(tenantId)
    setAssignTargetRoles([])
    setAssignTargetRoleEnabledMap({})
    setAssignTargetRoleId(1)
    setAssignTargetWarehouses([])
    setAssignTargetWarehouseCodes(new Set())

    const [rolesRes, whRes, enabledRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/roles`, { headers: { ...buildTenantHeaders(tenantCode, false) } }),
      fetch(`${API_BASE_URL}/api/warehouses/dropdown`, { headers: { ...buildTenantHeaders(tenantCode, false) } }),
      fetch(`${API_BASE_URL}/api/tenants/${tenantId}/enabled-pages`, { headers: { ...buildHeaders(false) } })
    ])

    if (!rolesRes.ok) throw new Error(await readError(rolesRes, 'Roller alınamadı'))
    if (!whRes.ok) throw new Error(await readError(whRes, 'Depolar alınamadı'))
    if (!enabledRes.ok) throw new Error(await readError(enabledRes, 'Tenant sayfaları alınamadı'))

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

    setAssignTargetRoles(roles)

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
    setAssignTargetRoleEnabledMap(enabledMap)

    const firstVisible = roles
      .filter((r) => Boolean(r.isActive))
      .filter((r) => {
        const v = enabledMap[r.id]
        return v === undefined ? true : Boolean(v)
      })[0]
    if (firstVisible) setAssignTargetRoleId(firstVisible.id)

    const whJson = await whRes.json().catch(() => null)
    setAssignTargetWarehouses(
      ((whJson?.data ?? []) as any[])
        .map((x) => ({ warehouseCode: Number(x.warehouseCode ?? x.warehouse_code ?? x.code ?? 0), name: x.name ?? null }))
        .filter((x) => Number.isFinite(x.warehouseCode) && x.warehouseCode > 0)
        .sort((a, b) => a.warehouseCode - b.warehouseCode)
    )
  }

  const submitAssign = async () => {
    if (!sourceRow) return
    if (!sourceTenantCode || !sourceUserId) {
      setError('Kaynak firma seçiniz')
      return
    }

    const targetTenantCode = String(assignTargetTenantCode ?? '').trim().toUpperCase()
    if (!targetTenantCode) {
      setError('Hedef firma seçiniz')
      return
    }

    const roleId = Number(assignTargetRoleId)
    if (!Number.isFinite(roleId) || roleId <= 0) {
      setError('Rol seçiniz')
      return
    }

    const selectedRole = (assignTargetRoles ?? []).find((r) => Number(r.id) === roleId)
    const roleIsSuperAdmin = Boolean(selectedRole?.isSuperAdmin)
    const warehouseCodes = roleIsSuperAdmin
      ? []
      : Array.from(assignTargetWarehouseCodes)
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0)
          .filter((n, idx, arr) => arr.indexOf(n) === idx)



    setAssignSaving(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/ssa-users/assign`, {
        method: 'POST',
        headers: { ...buildHeaders(true) },
        body: JSON.stringify({
          sourceTenantCode,
          sourceUserId,
          targetTenantCodes: [targetTenantCode]
        })
      })

      if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Firma atama başarısız (${res.status})`)

      const usersRes = await fetch(`${API_BASE_URL}/api/users`, { headers: { ...buildTenantHeaders(targetTenantCode, false) } })
      if (!usersRes.ok) throw new Error(await readError(usersRes, 'Hedef firma kullanıcıları alınamadı'))
      const usersJson = await usersRes.json().catch(() => null)
      const list = (usersJson?.data ?? []) as any[]
      const u = list.find((x) => String(x?.username ?? '').trim().toLowerCase() === String(sourceRow?.username ?? '').trim().toLowerCase())
      const targetUserId = Number(u?.id ?? 0)
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) throw new Error('Hedef kullanıcı bulunamadı')

      const payload: any = {
        username: String(u?.username ?? sourceRow?.username ?? '').trim(),
        mail: String(u?.mail ?? sourceRow?.mail ?? '').trim(),
        unvan: String(u?.unvan ?? sourceRow?.unvan ?? '').trim(),
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
      if (!updRes.ok) throw new Error(await readError(updRes, 'Hedef kullanıcı rolü güncellenemedi'))

      setAssignOpen(false)
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? 'Atama hatası'))
    } finally {
      setAssignSaving(false)
    }
  }

  const visibleAssignTargetRoles = useMemo(() => {
    const list = assignTargetRoles ?? []
    const currentRoleId = Number(assignTargetRoleId)
    const filtered = list.filter((r) => {
      const rid = Number(r.id)
      if (rid === currentRoleId) return true
      if (!r.isActive) return false
      const enabled = assignTargetRoleEnabledMap[rid]
      return enabled === undefined ? true : Boolean(enabled)
    })
    return filtered.slice().sort((a, b) => Number(a.id) - Number(b.id))
  }, [assignTargetRoleEnabledMap, assignTargetRoleId, assignTargetRoles])

  return (
    <div className="space-y-4 min-h-[calc(100vh-64px)] px-4 py-6 bg-gradient-to-b from-gray-50 via-white to-white">
      <SsaDashboardHeader
        title="Tüm Kullanıcılar"
        subtitle="Tüm firmaların kullanıcılarını tek ekranda yönet. Toplu e‑posta kopyala ve CSV dışa aktar."
        searchValue={query}
        onSearchChange={setQuery}
        tertiaryLabel="Onboard"
        onTertiaryClick={() => window.location.assign('/users/onboard')}
        secondaryLabel="Proje Yönetimi"
        onSecondaryClick={() => window.location.assign('/users/projeYonetimi')}
        primaryLabel="Yenile"
        onPrimaryClick={() => void load()}
        onLogout={() => {
          localStorage.removeItem('accessToken')
          localStorage.removeItem('refreshToken')
          localStorage.removeItem('userName')
          localStorage.removeItem('tenantCode')
          localStorage.removeItem('tenantName')
          localStorage.removeItem('ssaViewMode')
          sessionStorage.removeItem('userName')
          redirectToLogin()
        }}
      />

      <div className="rounded-3xl border border-gray-200 bg-white shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">
        <div className="p-5 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Kullanıcı</div>
                  <div className="text-2xl font-black text-gray-900 mt-1">{stats.total}</div>
                </div>
                <div className="h-10 w-10 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center">
                  <UsersIcon size={18} className="text-gray-700" />
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Aktif</div>
                  <div className="text-2xl font-black text-gray-900 mt-1">{stats.active}</div>
                </div>
                <div className="h-10 w-10 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                  <CircleCheck size={18} className="text-emerald-700" />
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Pasif</div>
                  <div className="text-2xl font-black text-gray-900 mt-1">{stats.inactive}</div>
                </div>
                <div className="h-10 w-10 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                  <CircleX size={18} className="text-amber-700" />
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">Firma</div>
                  <div className="text-2xl font-black text-gray-900 mt-1">{stats.tenantCount}</div>
                </div>
                <div className="h-10 w-10 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center">
                  <Shield size={18} className="text-sky-700" />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 mt-4">
            <div className="lg:col-span-3">
              <select
                value={tenantFilter}
                onChange={(e) => setTenantFilter(e.target.value)}
                className="w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/20 transition"
              >
                <option value="">Tüm Firmalar</option>
                {tenantOptions.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.code} — {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-9 flex flex-wrap gap-2 justify-end">
              <label className="flex-1 inline-flex items-center justify-center gap-2 h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 select-none">
                <input type="checkbox" checked={showInactiveUsers} onChange={(e) => setShowInactiveUsers(e.target.checked)} />
                Pasifleri göster
              </label>
              <ActionDropdown
                items={[
                  {
                    key: 'copyMails',
                    label: 'Seçili e‑postaları kopyala',
                    disabled: selectedUserKeys.size === 0,
                    onClick: () => {
                      void (async () => {
                        const mails = selectedRows
                          .map((r) => String(r.mail ?? '').trim())
                          .filter(Boolean)
                          .join('; ')
                        if (!mails) return
                        try {
                          await navigator.clipboard.writeText(mails)
                        } catch {
                        }
                      })()
                    }
                  },
                  {
                    key: 'exportCsv',
                    label: 'CSV dışa aktar',
                    onClick: () => exportCsv(selectedRows.length > 0 ? selectedRows : filteredRows, selectedRows.length > 0 ? 'ssa-users-selected.csv' : 'ssa-users.csv')
                  },
                  {
                    key: 'clearSel',
                    label: 'Seçimi temizle',
                    disabled: selectedUserKeys.size === 0,
                    onClick: () => clearSelection()
                  }
                ]}
              />
            </div>
          </div>

          <div className="mt-3 text-[11px] font-bold text-gray-500">
            Gösterilen: <span className="text-gray-900">{filteredRows.length}</span> — Seçili: <span className="text-gray-900">{selectedUserKeys.size}</span>
          </div>
        </div>
      </div>

      {error && <div className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{error}</div>}

      <Modal isOpen={detailOpen} onClose={() => setDetailOpen(false)} title="Kullanıcı Detayı">
        <div className="space-y-3">
          <div className="text-sm font-extrabold text-gray-900">{detailUser?.username}</div>
          <div className="text-xs text-gray-500">{String(detailUser?.mail ?? '').trim()} — {String(detailUser?.unvan ?? '').trim()}</div>

          <div className="rounded-2xl border border-gray-200 overflow-hidden">
            <div className="grid grid-cols-12 gap-0 bg-gray-50 text-[10px] font-black uppercase tracking-[0.22em] text-gray-500 border-b border-gray-200">
              <div className="col-span-4 px-3 py-2">Firma</div>
              <div className="col-span-5 px-3 py-2">Rol</div>
              <div className="col-span-3 px-3 py-2">Durum</div>
            </div>

            {(detailUser?.tenants ?? []).length === 0 ? (
              <div className="px-3 py-6 text-sm text-gray-500">Firma kaydı yok</div>
            ) : (
              (detailUser?.tenants ?? [])
                .slice()
                .sort((a, b) => String(a.tenantCode ?? '').localeCompare(String(b.tenantCode ?? '')))
                .map((t) => {
                  const active = Boolean(t.isActive)
                  return (
                    <div key={`${detailUser?.userKey}-${t.tenantCode}-${t.userId}`} className="grid grid-cols-12 gap-0 items-center border-b border-gray-100 last:border-b-0">
                      <div className="col-span-4 px-3 py-3">
                        <div className="text-sm font-extrabold text-gray-900 truncate">{String(t.tenantCode ?? '').toUpperCase()}</div>
                        <div className="text-xs text-gray-500 truncate">{String(t.tenantName ?? '').trim()}</div>
                      </div>
                      <div className="col-span-5 px-3 py-3">
                        <div className="text-sm font-extrabold text-gray-900 truncate">{String(t.roleName ?? '').trim() || '-'}</div>
                        <div className="text-xs text-gray-500 truncate">{String(t.roleCode ?? '').trim()}</div>
                      </div>
                      <div className="col-span-3 px-3 py-3">
                        <span className={`inline-flex items-center h-7 px-3 rounded-full text-[11px] font-black border ${active ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                          {active ? 'aktif' : 'pasif'}
                        </span>
                      </div>
                    </div>
                  )
                })
            )}
          </div>

          <div className="pt-2 flex items-center justify-end">
            <button
              type="button"
              onClick={() => setDetailOpen(false)}
              className="h-10 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold"
            >
              Kapat
            </button>
          </div>
        </div>
      </Modal>

      <div className="rounded-3xl border border-gray-200 bg-white shadow-[0_18px_45px_-32px_rgba(17,24,39,0.35)]">
        {loading ? (
          <div className="p-5 text-sm text-gray-500">Yükleniyor...</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">Kullanıcı yok</div>
        ) : (
          <div className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredRows.map((r) => {
              const isSelected = selectedUserKeys.has(String(r.userKey))
              const initials = String(r.username ?? '').trim().slice(0, 2).toUpperCase()
              const tenantBadges = (r.tenants ?? []).slice(0, 10)
              const rest = Math.max(0, (r.tenants ?? []).length - tenantBadges.length)
              return (
                <button
                  key={r.userKey}
                  type="button"
                  onClick={() => openDetail(r)}
                  className="text-left w-full group relative rounded-3xl border border-gray-200 bg-white shadow-sm hover:-translate-y-0.5 hover:border-rose-200 hover:ring-2 hover:ring-rose-100/70 hover:shadow-[0_26px_70px_-28px_rgba(17,24,39,0.22)] transition-all duration-200 p-4"
                >
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-b from-gray-50 to-white" />
                  <div className="relative">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <label className="mt-1 inline-flex items-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation()
                              toggleSelect(String(r.userKey), e.target.checked)
                            }}
                          />
                        </label>
                        <div className="h-11 w-11 rounded-2xl bg-gray-50 border border-gray-200 text-gray-900 grid place-items-center font-black text-sm shrink-0">
                          {initials || 'U'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-extrabold text-gray-900 truncate">{r.username}</div>
                            <span
                              className={
                                'inline-flex items-center h-6 px-2 rounded-full text-[11px] font-black uppercase tracking-[0.12em] border ' +
                                (r.isActive ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-amber-50 text-amber-800 border-amber-100')
                              }
                            >
                              {r.isActive ? 'Aktif' : 'Pasif'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1 truncate">{r.mail} — {r.unvan}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {tenantBadges.map((t) => (
                              <span key={`${r.userKey}-${t.tenantCode}-${t.userId}`} className="inline-flex items-center h-6 px-2 rounded-full bg-gray-50 border border-gray-200 text-[11px] font-bold text-gray-700">
                                {String(t.tenantCode ?? '').trim().toUpperCase()}
                              </span>
                            ))}
                            {rest > 0 ? (
                              <span className="inline-flex items-center h-6 px-2 rounded-full bg-white border border-gray-200 text-[11px] font-bold text-gray-500">+{rest}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openAssign(r)
                          }}
                          className="h-11 w-11 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 transition grid place-items-center"
                          aria-label="Firma ata"
                          title="Firma ata"
                        >
                          <UserPlus size={16} className="text-gray-700" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void (async () => {
                              const mail = String(r.mail ?? '').trim()
                              if (!mail) return
                              try {
                                await navigator.clipboard.writeText(mail)
                              } catch {
                              }
                            })()
                          }}
                          className="h-11 w-11 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 transition grid place-items-center"
                          aria-label="Email kopyala"
                          title="Email kopyala"
                        >
                          <Copy size={16} className="text-gray-700" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openEdit(r)
                          }}
                          className="h-11 w-11 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 transition grid place-items-center"
                          aria-label="Düzenle"
                          title="Düzenle"
                        >
                          <Pencil size={16} className="text-gray-700" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <div className="rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 p-3">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Email</div>
                        <div className="text-sm font-extrabold text-gray-900 mt-1 truncate">{String(r.mail ?? '').trim() || '-'}</div>
                      </div>
                      <div className="rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 p-3">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Firma</div>
                        <div className="text-sm font-extrabold text-gray-900 mt-1 truncate">{(r.tenants ?? []).length}</div>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <Modal isOpen={editOpen} onClose={() => (editSaving ? undefined : setEditOpen(false))} title="Kullanıcı Düzenle">
        <div className="space-y-3">
          <div className="text-sm font-semibold text-gray-800">{sourceRow?.username}</div>
          <div className="text-xs text-gray-500">Firma: {editTenantCode}</div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Email</div>
            <input value={editMail} onChange={(e) => setEditMail(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200" />
          </div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Ünvan</div>
            <input value={editUnvan} onChange={(e) => setEditUnvan(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-gray-200" />
          </div>

          {showEditGsm ? (
            <div>
              <div className="text-xs font-bold text-gray-600 mb-1">Telefon</div>
              <input
                value={editGsm}
                onChange={(e) => setEditGsm(formatPhoneNumber(e.target.value))}
                className="w-full h-10 px-3 rounded-xl border border-gray-200"
                placeholder="0555 555 5555 555"
                maxLength={PHONE_MAX_LENGTH}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowEditGsm(true)}
              className="h-10 px-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold"
            >
              Telefon ekle
            </button>
          )}

          {showEditCarikodu ? (
            <div>
              <div className="text-xs font-bold text-gray-600 mb-1">Cari Kodu</div>
              <input
                value={editCarikodu}
                onChange={(e) => setEditCarikodu(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-gray-200"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowEditCarikodu(true)}
              className="h-10 px-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold"
            >
              Cari kodu ekle
            </button>
          )}

          {showEditSalesmanCode ? (
            <div>
              <div className="text-xs font-bold text-gray-600 mb-1">Plasiyer Kodu</div>
              <input
                value={editSalesmanCode}
                onChange={(e) => setEditSalesmanCode(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-gray-200"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowEditSalesmanCode(true)}
              className="h-10 px-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold"
            >
              Plasiyer kodu ekle
            </button>
          )}

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Rol</div>
            <select
              value={String(editRoleId)}
              onChange={(e) => {
                const nextRoleId = Number(e.target.value)
                setEditRoleId(nextRoleId)
                const nextRole = visibleEditRoles.find((r) => Number(r.id) === Number(nextRoleId))
                const nextIsSuperAdmin = Boolean(nextRole?.isSuperAdmin)
                if (nextIsSuperAdmin) {
                  setEditWarehouseCodes(new Set())
                }
              }}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
            >
              {visibleEditRoles.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {(r.displayName || r.name) + (r.isActive ? '' : ' (Pasif)')}
                </option>
              ))}
            </select>
          </div>

          {(() => {
            const selectedRole = visibleEditRoles.find((r) => Number(r.id) === Number(editRoleId))
            const roleIsSuperAdmin = Boolean(selectedRole?.isSuperAdmin)
            if (roleIsSuperAdmin) return null

            return (
              <div>
                <div className="text-xs font-bold text-gray-600 mb-1">Depolar</div>
                <div className="max-h-[180px] overflow-auto border border-gray-200 rounded-xl">
                  <div className="divide-y divide-gray-100">
                    {editWarehouses.length === 0 ? (
                      <div className="p-3 text-xs text-gray-500">Depo bulunamadı</div>
                    ) : (
                      editWarehouses.map((w) => {
                        const code = Number(w.warehouseCode)
                        const checked = editWarehouseCodes.has(code)
                        return (
                          <label key={code} className="flex items-center gap-2 p-3 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                setEditWarehouseCodes((prev) => {
                                  const set = new Set(prev)
                                  if (next) set.add(code)
                                  else set.delete(code)
                                  return set
                                })
                              }}
                            />
                            <div className="flex-1">
                              <div className="text-xs font-semibold text-gray-900">{String(w.name ?? '').trim() || `Depo ${code}`}</div>
                              <div className="text-[11px] text-gray-500">{code}</div>
                            </div>
                          </label>
                        )
                      })
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-gray-500 mt-1">SuperAdmin olmayan roller için depo yetkisi tanımlayabilirsiniz.</div>
              </div>
            )
          })()}

          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <input type="checkbox" checked={editIsActive} onChange={(e) => setEditIsActive(e.target.checked)} />
            Aktif
          </label>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Yeni Şifre (opsiyonel)</div>
            <input
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
              placeholder="Boş bırakırsanız değişmez"
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            <button
              type="button"
              disabled={editSaving}
              onClick={() => openRolePermissions()}
              className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
            >
              Rol Yetkileri
            </button>

            <div className="flex items-center gap-2">
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
                disabled={editSaving}
                onClick={() => void saveEdit()}
                className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
              >
                {editSaving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={permOpen} onClose={() => (permSaving ? undefined : setPermOpen(false))} title="Rol Yetkileri">
        <div className="space-y-3">
          <div className="text-xs text-gray-500">
            Enabled olmayan sayfalar kilitlidir ve kullanıcıya/role verilemez.
          </div>

          <div className="max-h-[420px] overflow-auto border border-gray-200 rounded-xl">
            <div className="divide-y divide-gray-100">
              {(permissions ?? []).map((p) => {
                const disabled = !p.isTenantEnabled
                return (
                  <label
                    key={p.pageId}
                    className={
                      'flex items-start gap-2 p-3 cursor-pointer ' +
                      (disabled ? 'bg-gray-50 opacity-70 cursor-not-allowed' : 'hover:bg-gray-50')
                    }
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={Boolean(p.canAccess)}
                      onChange={() => {
                        if (disabled) return
                        setPermissions((prev) => prev.map((x) => (x.pageId === p.pageId ? { ...x, canAccess: !x.canAccess } : x)))
                      }}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-xs font-semibold text-gray-900">{p.displayName}</div>
                      <div className="text-[11px] text-gray-500">
                        {p.moduleKey}/{p.pageKey}
                        {!p.isTenantEnabled ? ' (projede kapalı)' : ''}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={permSaving}
              onClick={() => setPermOpen(false)}
              className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={permSaving}
              onClick={() => void saveRolePermissions()}
              className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
            >
              {permSaving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={assignOpen} onClose={() => (assignSaving ? undefined : setAssignOpen(false))} title="Firma Ata">
        <div className="space-y-3">
          <div className="text-sm font-semibold text-gray-800">
            Kaynak: {sourceRow?.username}
          </div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Kaynak Firma</div>
            <select
              value={sourceTenantCode}
              onChange={(e) => {
                const code = String(e.target.value ?? '').toUpperCase()
                setSourceTenantCode(code)
                const inst = (sourceRow?.tenants ?? []).find((x) => String(x.tenantCode).toUpperCase() === code)
                setSourceUserId(Number(inst?.userId ?? 0))
              }}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
            >
              {(sourceRow?.tenants ?? []).map((t) => (
                <option key={t.tenantCode} value={String(t.tenantCode).toUpperCase()}>
                  {t.tenantName} ({t.tenantCode}) — {t.roleName} ({t.roleCode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Hedef Firma</div>
            <select
              value={assignTargetTenantCode}
              onChange={(e) => {
                const code = String(e.target.value ?? '').toUpperCase()
                setAssignTargetTenantCode(code)
                void (async () => {
                  try {
                    setError(null)
                    await loadAssignTargetMeta(code)
                  } catch (err: any) {
                    setError(String(err?.message ?? 'Hedef firma bilgileri alınamadı'))
                  }
                })()
              }}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
            >
              <option value="">Seçiniz...</option>
              {tenantOptions
                .filter((t) => String(t.code ?? '').trim().toUpperCase() !== String(sourceTenantCode ?? '').trim().toUpperCase())
                .map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name} ({t.code})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Hedef Rol</div>
            <select
              value={String(assignTargetRoleId)}
              onChange={(e) => {
                const nextRoleId = Number(e.target.value)
                setAssignTargetRoleId(nextRoleId)
                const nextRole = visibleAssignTargetRoles.find((r) => Number(r.id) === Number(nextRoleId))
                if (Boolean(nextRole?.isSuperAdmin)) setAssignTargetWarehouseCodes(new Set())
              }}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
              disabled={!assignTargetTenantCode}
            >
              {visibleAssignTargetRoles.length === 0 ? (
                <option value={String(assignTargetRoleId)}>{assignTargetTenantCode ? 'Rol yükleniyor...' : 'Önce hedef firma seçiniz'}</option>
              ) : (
                visibleAssignTargetRoles.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.displayName || r.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {(() => {
            const selectedRole = (assignTargetRoles ?? []).find((r) => Number(r.id) === Number(assignTargetRoleId))
            const roleIsSuperAdmin = Boolean(selectedRole?.isSuperAdmin)
            if (!assignTargetTenantCode) return null
            if (roleIsSuperAdmin) return null

            return (
              <div>
                <div className="text-xs font-bold text-gray-600 mb-1">Depolar</div>
                <div className="max-h-[220px] overflow-auto border border-gray-200 rounded-xl">
                  <div className="divide-y divide-gray-100">
                    {assignTargetWarehouses.length === 0 ? (
                      <div className="p-3 text-xs text-gray-500">Depo bulunamadı</div>
                    ) : (
                      assignTargetWarehouses.map((w) => {
                        const code = Number(w.warehouseCode)
                        const checked = assignTargetWarehouseCodes.has(code)
                        return (
                          <label key={String(code)} className="flex items-center gap-2 p-3 text-sm text-gray-700 cursor-pointer hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const on = e.target.checked
                                setAssignTargetWarehouseCodes((prev) => {
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

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={assignSaving}
              onClick={() => setAssignOpen(false)}
              className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={assignSaving || !sourceRow}
              onClick={() => void submitAssign()}
              className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
            >
              {assignSaving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
