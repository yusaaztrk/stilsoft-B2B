import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL } from '../config/api'
import Modal from '../components/Modal'

type TenantRef = { code: string; name: string }

type GlobalUserItem = {
  id: number
  username: string
  mail: string
  isSuperSuperAdmin: boolean
  isActive: boolean
  tenants: TenantRef[]
}

type CreateForm = {
  username: string
  mail: string
  password: string
  tenantCodes: string
}

export default function GlobalUsersAdminPage() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<GlobalUserItem[]>([])

  const [tenants, setTenants] = useState<Array<{ code: string; name: string }>>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>({ username: '', mail: '', password: '', tenantCodes: '' })

  /**
   * `background`: liste EKRANDA KALARAK tazelenir.
   *
   * `loading` bayrağı tabloyu iskelet ekranla değiştiriyor, yani bileşeni söküp yeniden
   * kuruyordu. Silme ya da kayıttan sonra sütun süzgeçleri, sıralama ve kaydırma konumu
   * sıfırlanıyor; kullanıcı bunu "sayfa yenileniyor" diye görüyordu. İlk açılışta iskelet
   * doğru — gösterilecek bir şey yok; ama dolu bir listeyi tazelemek için boşaltmak gerekmez.
   */
  const load = async (options?: { background?: boolean }) => {
    const background = options?.background ?? false
    if (!background) setLoading(true)
    setError(null)
    try {
      const [usersRes, tenantsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/globalusers`),
        fetch(`${API_BASE_URL}/api/tenants`)
      ])

      if (!usersRes.ok) throw new Error((await usersRes.text().catch(() => '')) || `Kullanıcılar alınamadı (${usersRes.status})`)
      if (!tenantsRes.ok) throw new Error((await tenantsRes.text().catch(() => '')) || `Firmalar alınamadı (${tenantsRes.status})`)

      const usersJson = await usersRes.json().catch(() => null)
      const tenantsJson = await tenantsRes.json().catch(() => null)

      setItems((usersJson?.data ?? []) as GlobalUserItem[])
      setTenants(((tenantsJson?.data ?? []) as any[]).map((x) => ({ code: String(x?.code ?? ''), name: String(x?.name ?? '') })))
    } catch (e: any) {
      setError(String(e?.message ?? 'Yükleme hatası'))
    } finally {
      if (!background) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const tenantOptions = useMemo(() => {
    return tenants
      .map((t) => ({ code: String(t.code ?? '').trim(), name: String(t.name ?? '').trim() }))
      .filter((t) => t.code)
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [tenants])

  const saveAssignments = async (globalUserId: number, tenantCodes: string[]) => {
    const res = await fetch(`${API_BASE_URL}/api/globalusers/assign-tenants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ globalUserId, tenantCodes })
    })
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Firma atama başarısız (${res.status})`)
  }

  /**
   * Silme artık firma içindeki eşleri de pasife alıyor (denetim md. C2). Bir firmaya
   * ulaşılamazsa silme yine tamamlanır ama sunucu uyarı geçirir: o firmada erişim açık
   * kalmış olabilir ve bunun sessizce yutulması "sildim" sanmakla sonuçlanır.
   */
  const deleteUser = async (id: number): Promise<string[]> => {
    const res = await fetch(`${API_BASE_URL}/api/globalusers/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Silme başarısız (${res.status})`)
    const body = await res.json().catch(() => null)
    return Array.isArray(body?.warnings) ? body.warnings : []
  }

  const createUser = async () => {
    const username = createForm.username.trim()
    const mail = createForm.mail.trim()
    if (!username || !mail || !createForm.password) {
      setError('Kullanıcı adı, mail ve şifre zorunlu')
      return
    }

    const tenantCodes = createForm.tenantCodes
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean)

    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/globalusers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, mail, password: createForm.password, tenantCodes, isSuperSuperAdmin: false })
      })
      if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Oluşturma başarısız (${res.status})`)

      setCreateOpen(false)
      setCreateForm({ username: '', mail: '', password: '', tenantCodes: '' })
      await load({ background: true })
    } catch (e: any) {
      setError(String(e?.message ?? 'Kaydetme hatası'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Kullanıcı Listesi</h2>
          <p className="text-sm text-gray-500 mt-1">Tüm firmalardaki global kullanıcılar. Bir kullanıcıya birden fazla firma atanabilir.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (window.location.assign('/users/projeYonetimi'))}
            className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-semibold hover:bg-gray-50 transition"
          >
            Proje Yönetimi
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="h-10 px-4 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-black transition"
          >
            Yeni Kullanıcı
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>
      )}

      <div className="border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Yükleniyor...</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">Kullanıcı yok</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((u) => {
              const selected = new Set((u.tenants ?? []).map((t) => String(t.code ?? '').toUpperCase()))
              const isSsa = Boolean(u.isSuperSuperAdmin)

              return (
                <div key={u.id} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-gray-900">{u.username}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{u.mail}</div>
                    </div>
                    <button
                      type="button"
                      disabled={isSsa}
                      onClick={async () => {
                        if (!confirm('Silmek istediğinize emin misiniz?')) return
                        try {
                          setSaving(true)
                          setError(null)
                          const uyarilar = await deleteUser(u.id)
                          await load({ background: true })
                          if (uyarilar.length > 0) {
                            setError('Kullanıcı silindi, ancak:\n' + uyarilar.map(w => '• ' + w).join('\n'))
                          }
                        } catch (e: any) {
                          setError(String(e?.message ?? 'Silme hatası'))
                        } finally {
                          setSaving(false)
                        }
                      }}
                      className={
                        'h-9 px-3 rounded-xl border text-sm font-semibold ' +
                        (isSsa ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed' : 'border-red-200 bg-white text-red-600 hover:bg-red-50')
                      }
                    >
                      Sil
                    </button>
                  </div>

                  {!isSsa && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {tenantOptions.map((t) => {
                        const checked = selected.has(String(t.code).toUpperCase())
                        return (
                          <label key={t.code} className="flex items-center gap-2 p-2 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={async () => {
                                const next = new Set(selected)
                                const code = String(t.code).toUpperCase()
                                if (next.has(code)) next.delete(code)
                                else next.add(code)

                                try {
                                  setSaving(true)
                                  setError(null)
                                  await saveAssignments(u.id, Array.from(next))
                                  await load({ background: true })
                                } catch (e: any) {
                                  setError(String(e?.message ?? 'Atama hatası'))
                                } finally {
                                  setSaving(false)
                                }
                              }}
                            />
                            <div className="text-xs font-semibold text-gray-800">{t.name} ({t.code})</div>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal isOpen={createOpen} onClose={() => (saving ? undefined : setCreateOpen(false))} title="Yeni Kullanıcı Oluştur">
        <div className="space-y-3">
          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Kullanıcı Adı</div>
            <input
              value={createForm.username}
              onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
              placeholder="kullanici"
            />
          </div>
          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Mail</div>
            <input
              value={createForm.mail}
              onChange={(e) => setCreateForm((p) => ({ ...p, mail: e.target.value }))}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
              placeholder="kullanici@firma.com"
            />
          </div>
          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Şifre</div>
            <input
              value={createForm.password}
              onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
              placeholder="123"
            />
          </div>
          <div>
            <div className="text-xs font-bold text-gray-600 mb-1">Firma Kodları (opsiyonel)</div>
            <input
              value={createForm.tenantCodes}
              onChange={(e) => setCreateForm((p) => ({ ...p, tenantCodes: e.target.value }))}
              className="w-full h-10 px-3 rounded-xl border border-gray-200"
              placeholder="DEMO, DENEME"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setCreateOpen(false)}
              className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void createUser()}
              className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? 'Kaydediliyor...' : 'Oluştur'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
