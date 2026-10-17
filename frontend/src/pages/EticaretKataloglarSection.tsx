import React, { useCallback, useEffect, useState } from 'react'
import { FileText, Plus, Trash2, UploadCloud, X } from 'lucide-react'

const SHOP_API =
  (import.meta as any).env?.VITE_SHOP_API_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:5150`

function authHeaders(json = true): Record<string, string> {
  const token = localStorage.getItem('accessToken')
  const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {})
  }
}

type Catalog = {
  id: string
  title: string
  pdfUrl: string
  coverImageUrl?: string | null
  sortOrder: number
  isActive: boolean
}

const emptyForm = { id: '', title: '', fileName: '', pdfUrl: '', sortOrder: 0, isActive: true }

export default function EticaretKataloglarSection() {
  const [items, setItems] = useState<Catalog[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [form, setForm] = useState<typeof emptyForm | null>(null)

  const notify = (kind: 'ok' | 'err', text: string) => {
    setMessage({ kind, text })
    window.setTimeout(() => setMessage(null), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${SHOP_API}/api/admin/catalogs`, { headers: authHeaders(false) })
      if (!res.ok) throw new Error()
      setItems(await res.json())
    } catch {
      notify('err', 'Katalog listesi alınamadı. Mağaza servisi çalışıyor mu?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openNew = () => setForm({ ...emptyForm, sortOrder: items.length })
  const openEdit = (c: Catalog) =>
    setForm({ id: c.id, title: c.title, fileName: '', pdfUrl: c.pdfUrl, sortOrder: c.sortOrder, isActive: c.isActive })

  const uploadPdf = async (file: File) => {
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`${SHOP_API}/api/admin/catalogs/pdf`, { method: 'POST', headers: authHeaders(false), body })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        notify('err', data?.message ?? 'PDF yüklenemedi.')
        return
      }
      setForm((prev) => (prev ? { ...prev, fileName: data.fileName, pdfUrl: data.url } : prev))
      notify('ok', 'PDF yüklendi. Kaydetmeyi unutma.')
    } catch {
      notify('err', 'PDF yüklenemedi.')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!form) return
    if (form.title.trim().length === 0) {
      notify('err', 'Başlık zorunludur.')
      return
    }
    // Düzenlemede yeni PDF yüklenmediyse, mevcut dosya adını URL'den geri çıkar.
    const fileName = form.fileName || form.pdfUrl.split('/').pop() || ''
    if (!fileName) {
      notify('err', 'Önce PDF yükleyin.')
      return
    }

    setSaving(true)
    try {
      const payload = { title: form.title.trim(), fileName, sortOrder: form.sortOrder, isActive: form.isActive }
      const res = await fetch(
        form.id ? `${SHOP_API}/api/admin/catalogs/${form.id}` : `${SHOP_API}/api/admin/catalogs`,
        { method: form.id ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(payload) }
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        notify('err', data?.message ?? 'Kaydedilemedi.')
        return
      }
      notify('ok', 'Katalog kaydedildi.')
      setForm(null)
      void load()
    } catch {
      notify('err', 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (c: Catalog) => {
    if (!window.confirm(`"${c.title}" kataloğu silinsin mi?`)) return
    try {
      const res = await fetch(`${SHOP_API}/api/admin/catalogs/${c.id}`, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok) throw new Error()
      notify('ok', 'Katalog silindi.')
      void load()
    } catch {
      notify('err', 'Silinemedi.')
    }
  }

  const toggleActive = async (c: Catalog) => {
    try {
      const fileName = c.pdfUrl.split('/').pop() || ''
      const res = await fetch(`${SHOP_API}/api/admin/catalogs/${c.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ title: c.title, fileName, sortOrder: c.sortOrder, isActive: !c.isActive })
      })
      if (!res.ok) throw new Error()
      void load()
    } catch {
      notify('err', 'Durum değiştirilemedi.')
    }
  }

  return (
    <div className="max-w-4xl">
      {message && (
        <div
          className={`mb-4 px-4 py-2.5 rounded-xl text-sm font-semibold ${
            message.kind === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-gray-500" />
            <div className="text-sm font-extrabold text-gray-900">Kataloglarımız</div>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="h-9 px-4 rounded-xl bg-gray-900 text-white text-xs font-bold hover:bg-black inline-flex items-center gap-1.5"
          >
            <Plus size={14} /> Yeni Katalog
          </button>
        </div>

        <div className="p-5">
          <p className="text-[11px] text-gray-500 mb-4">
            Buraya eklenen PDF'ler vitrin ana sayfasındaki "Kataloglarımız" bölümünde listelenir.
            Pasif olanlar vitrine çıkmaz, listede kalır.
          </p>

          {loading ? (
            <div className="text-sm text-gray-400 py-6 text-center">Yükleniyor…</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-gray-400 py-6 text-center">Henüz katalog eklenmedi.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {items.map((c) => (
                <div key={c.id} className="py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                    <FileText size={16} className="text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 text-sm truncate">{c.title}</div>
                    <a
                      href={`${SHOP_API}${c.pdfUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-blue-600 hover:underline"
                    >
                      PDF'i görüntüle
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleActive(c)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition shrink-0 ${
                      c.isActive
                        ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                        : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {c.isActive ? 'Yayında' : 'Pasif'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(c)}
                    className="h-9 px-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 shrink-0"
                  >
                    Düzenle
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    className="w-9 h-9 rounded-xl border border-gray-200 text-red-500 hover:bg-red-50 inline-flex items-center justify-center shrink-0"
                    aria-label="Sil"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {form && (
        <div
          className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-[2px] flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setForm(null)}
        >
          <div
            className="bg-white rounded-3xl border border-gray-200 shadow-xl w-full max-w-lg my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <div className="text-base font-extrabold text-gray-900">
                {form.id ? 'Katalogu Düzenle' : 'Yeni Katalog'}
              </div>
              <button
                type="button"
                onClick={() => setForm(null)}
                className="w-9 h-9 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 inline-flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <label className="block">
                <span className="text-xs font-bold text-gray-600">Başlık</span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((p) => (p ? { ...p, title: e.target.value } : p))}
                  placeholder="Örn: 2026 Ürün Kataloğu"
                  className="mt-1 w-full h-11 px-3 rounded-xl border border-gray-200 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-xs font-bold text-gray-600">PDF</span>
                <div className="mt-1 flex items-center gap-3">
                  <label className="h-11 px-4 rounded-xl border border-dashed border-gray-300 text-xs font-bold text-gray-600 hover:bg-gray-50 inline-flex items-center gap-2 cursor-pointer">
                    <UploadCloud size={14} />
                    {uploading ? 'Yükleniyor…' : 'PDF Seç'}
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void uploadPdf(file)
                        e.target.value = ''
                      }}
                    />
                  </label>
                  {form.pdfUrl && (
                    <a href={`${SHOP_API}${form.pdfUrl}`} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline truncate">
                      Yüklenen PDF'i gör
                    </a>
                  )}
                </div>
                <span className="text-[11px] text-gray-500 block mt-1">En fazla 30 MB.</span>
              </label>

              <label className="block">
                <span className="text-xs font-bold text-gray-600">Sıra</span>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm((p) => (p ? { ...p, sortOrder: Number(e.target.value) || 0 } : p))}
                  className="mt-1 w-28 h-11 px-3 rounded-xl border border-gray-200 text-sm"
                />
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((p) => (p ? { ...p, isActive: e.target.checked } : p))}
                />
                <span className="text-sm text-gray-700">Vitrinde yayında</span>
              </label>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="h-11 px-5 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || uploading}
                className="h-11 px-5 rounded-2xl bg-gray-900 text-white text-sm font-semibold hover:bg-black disabled:opacity-60"
              >
                {saving ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
