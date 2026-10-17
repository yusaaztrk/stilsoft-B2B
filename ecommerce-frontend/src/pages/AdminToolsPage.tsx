import { useMemo, useState, useRef } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Icon } from '../components/Icon'
import { getAdminToken } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'

type ToolRow = {
  id: string
  name: string
  description: string
  status: 'Hazır' | 'Çalışıyor' | 'Kapalı'
  action?: () => void
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function AdminToolsPage() {
  const [q, setQ] = useState('')
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { showToast, dismissToast } = useToast()

  const handleExport = async () => {
    const token = getAdminToken()
    if (!token) {
      showToast('Oturum açma hatası. Lütfen tekrar giriş yapın.', 'error')
      return
    }

    try {
      setExporting(true)
      const res = await fetch('/api/admin/catalog/export', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (!res.ok) {
        throw new Error('Katalog verisi dışa aktarılamadı.')
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `urun_katalogu_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      showToast('Katalog başarıyla indirildi.', 'success')
    } catch (err: any) {
      showToast(err.message || 'Dışa aktarma hatası oluştu.', 'error')
    } finally {
      setExporting(false)
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Clean up input value
    e.target.value = ''

    const token = getAdminToken()
    if (!token) {
      showToast('Oturum açma hatası. Lütfen tekrar giriş yapın.', 'error')
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    let loadingId = ''
    try {
      setImporting(true)
      loadingId = showToast('CSV dosyası yükleniyor ve işleniyor...', 'loading', 0)

      const res = await fetch('/api/admin/catalog/import', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.message || 'İçe aktarma hatası oluştu.')
      }

      showToast(json.message || 'Katalog başarıyla güncellendi.', 'success')
    } catch (err: any) {
      showToast(err.message || 'Dosya işlenirken hata oluştu.', 'error')
    } finally {
      setImporting(false)
      if (loadingId) dismissToast(loadingId)
    }
  }

  const rows: ToolRow[] = useMemo(
    () => [
      { id: 'T-01', name: 'Stok Senkronu', description: 'ERP stoklarını güncelle', status: 'Hazır' },
      { id: 'T-02', name: 'Fiyat Güncelleme', description: 'Fiyat kurallarını uygula', status: 'Kapalı' },
      { id: 'T-03', name: 'Görsel Optimizasyon', description: 'Ürün görsellerini optimize et', status: 'Hazır' },
    ],
    [],
  )

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => `${r.id} ${r.name} ${r.description} ${r.status}`.toLowerCase().includes(s))
  }, [q, rows])

  return (
    <AdminLayout
      title="Araçlar"
      subtitle="Operasyonel araçlar ve hızlı işlemler."
      top={
        <div className="flex w-full items-center justify-end gap-2">
          <div className="hidden items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 shadow-sm focus-within:ring-2 focus-within:ring-red-400/30 md:flex md:w-[520px]">
            <Icon name="search" className="h-4 w-4 text-zinc-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Araç ara" className="w-full bg-transparent text-zinc-900 placeholder:text-zinc-400 outline-none" />
          </div>
        </div>
      }
    >
      <div className="md:hidden">
        <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 shadow-sm focus-within:ring-2 focus-within:ring-red-400/30">
          <Icon name="search" className="h-4 w-4 text-zinc-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Araç ara" className="w-full bg-transparent text-zinc-900 placeholder:text-zinc-400 outline-none" />
        </div>
      </div>

      {/* Catalog CSV Import/Export Panel */}
      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
          <span className="material-symbols-outlined text-red-600">database</span>
          Katalog Yönetimi (CSV Veri Transferi)
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Fiyatları, stokları ve kategori eşlemelerini toplu olarak dışa aktarın, düzenleyin ve geri yükleyin.
        </p>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {/* Export Box */}
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-5 flex flex-col justify-between">
            <div>
              <div className="font-semibold text-zinc-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-zinc-600">download</span>
                Katalog Dosyasını İndir
              </div>
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                Tüm ürünlerinizin tenant_code, erp_product_id, fiyat, stok ve kategori eşlemelerini içeren güncel CSV tablosunu bilgisayarınıza indirin.
              </p>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="mt-4 h-11 w-full rounded-xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 disabled:bg-zinc-400 transition flex items-center justify-center gap-2"
            >
              {exporting ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>
                  Hazırlanıyor...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">download_for_offline</span>
                  CSV Dosyası İndir (Export)
                </>
              )}
            </button>
          </div>

          {/* Import Box */}
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-5 flex flex-col justify-between">
            <div>
              <div className="font-semibold text-zinc-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-zinc-600">upload</span>
                Toplu Katalog Güncelle
              </div>
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                Düzenlediğiniz CSV dosyasını geri yükleyerek fiyat, stok ve kategorileri tek seferde güncelleyin.
                Sütun formatı: <code className="bg-zinc-200 px-1 rounded text-red-600">tenant_code</code>, <code className="bg-zinc-200 px-1 rounded text-red-600">erp_product_id</code>, <code className="bg-zinc-200 px-1 rounded">override_price</code>, <code className="bg-zinc-200 px-1 rounded">stock</code>, <code className="bg-zinc-200 px-1 rounded">category_id</code>
              </p>
            </div>
            <div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".csv"
                className="hidden"
              />
              <button
                onClick={handleImportClick}
                disabled={importing}
                className="mt-4 h-11 w-full rounded-xl bg-red-600 text-sm font-semibold text-white hover:bg-red-500 disabled:bg-red-300 transition flex items-center justify-center gap-2"
              >
                {importing ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>
                    Güncelleniyor...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">cloud_upload</span>
                    CSV Dosyası Yükle (Import)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h3 className="text-md font-bold text-zinc-900 mb-3">Diğer Sistem Araçları</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-zinc-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-zinc-900">{r.name}</div>
                  <div className="mt-1 text-sm text-zinc-500">{r.description}</div>
                </div>
                <span
                  className={cx(
                    'rounded-full border px-2.5 py-0.5 text-[10px] font-bold shrink-0',
                    r.status === 'Hazır'
                      ? 'border-primary/20 bg-primary/5 text-primary'
                      : r.status === 'Çalışıyor'
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-500',
                  )}
                >
                  {r.status}
                </span>
              </div>

              <div className="mt-4 flex gap-2">
                <button className="h-10 flex-1 rounded-xl bg-red-600 text-sm font-semibold text-white hover:bg-red-500 transition" type="button">
                  Çalıştır
                </button>
                <button
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition"
                  type="button"
                >
                  Ayrıntı
                </button>
              </div>
            </div>
          ))}

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-400 col-span-full">Sonuç bulunamadı.</div>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  )
}
