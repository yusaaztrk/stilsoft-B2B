import { useEffect, useMemo, useState } from 'react'
import type { ErpProductListItem } from '../../lib/api'
import {
  fetchAdminProductImages,
  setAdminProductCoverImage,
  uploadAdminProductImage,
  addProductImageByUrl,
  removeProductImage,
  reorderProductImages,
  type ProductImagesDto,
} from '../../lib/productImagesApi'
import { MediaLibraryModal } from '../ui/MediaLibraryModal'
import { useConfirm } from '../ui/ConfirmContext'


export function ProductImagesModal({
  open,
  onClose,
  authHeader,
  product,
  onUpdated,
}: {
  open: boolean
  onClose: () => void
  authHeader: Record<string, string> | null
  product: ErpProductListItem | null
  onUpdated?: (dto: ProductImagesDto) => void
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ProductImagesDto>({ imageUrl: null, imageUrls: [] })
  const [isMediaOpen, setIsMediaOpen] = useState(false)
  const confirm = useConfirm()

  const productTenantCode = useMemo(() => String(product?.tenantCode ?? '').trim().toUpperCase(), [product])
  const productId = useMemo(() => String(product?.id ?? '').trim(), [product])

  // Lock body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!authHeader) return
    if (!productId || !productTenantCode) return

    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const dto = await fetchAdminProductImages(authHeader, productId, productTenantCode)
        if (!cancelled) setData(dto)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Görseller alınamadı')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, authHeader, productId, productTenantCode])

  const handleSelectFromMedia = async (url: string) => {
    if (!authHeader || !productId || !productTenantCode) return
    try {
      setSaving(true)
      setError(null)
      const next = await addProductImageByUrl(authHeader, productId, productTenantCode, url)
      setData(next)
      onUpdated?.(next)
      setIsMediaOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Görsel eklenemedi')
    } finally {
      setSaving(false)
    }
  }

  const handleMoveImage = async (url: string, direction: 'left' | 'right') => {
    if (!authHeader || !productId || !productTenantCode) return
    const idx = data.imageUrls.indexOf(url)
    if (idx === -1) return
    const newIdx = direction === 'left' ? idx - 1 : idx + 1
    if (newIdx < 0 || newIdx >= data.imageUrls.length) return

    const list = [...data.imageUrls]
    const temp = list[idx]
    list[idx] = list[newIdx]
    list[newIdx] = temp

    try {
      setSaving(true)
      setError(null)
      const next = await reorderProductImages(authHeader, productId, productTenantCode, list)
      setData(next)
      onUpdated?.(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sıralama değiştirilemedi')
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveImage = async (url: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!authHeader || !productId || !productTenantCode) return
    const ok = await confirm('Bu görseli üründen kaldırmak istediğinizden emin misiniz?', { type: 'danger', confirmText: 'Evet, Kaldır', title: 'Görseli Kaldır' })
    if (!ok) return

    try {
      setSaving(true)
      setError(null)
      const next = await removeProductImage(authHeader, productId, productTenantCode, url)
      setData(next)
      onUpdated?.(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Görsel kaldırılamadı')
    } finally {
      setSaving(false)
    }
  }


  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[80]">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
              <div>
                <div className="text-[11px] font-semibold tracking-widest text-zinc-500">ÜRÜN GÖRSELLERİ</div>
                <div className="mt-1 text-lg font-extrabold text-zinc-900">{product?.name ?? 'Ürün'}</div>
                <div className="mt-1 text-[11px] text-zinc-500">Kapak görseli: ürün listelerinde gösterilir.</div>
              </div>
              <button type="button" onClick={onClose} className="h-10 w-10 rounded-full hover:bg-zinc-100 text-zinc-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-6">
              {error ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div> : null}

              <div className="flex flex-col gap-6 lg:flex-row">
                <div className="flex-1">
                  <div className="rounded-3xl border border-zinc-200 bg-white p-4">
                    <div className="text-xs font-bold text-zinc-700">Kapak</div>
                    <div className="mt-3 aspect-square overflow-hidden rounded-2xl bg-zinc-50 flex items-center justify-center">
                      {data.imageUrl ? <img src={data.imageUrl} className="h-full w-full object-contain p-6" /> : <span className="text-zinc-400 text-xs">Görsel Yok</span>}
                    </div>
                  </div>

                  <div className="mt-4 rounded-3xl border border-zinc-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-zinc-700">Görsel Yükle</div>
                      <div className="text-[11px] text-zinc-500">jpg/png/webp önerilir</div>
                    </div>

                    <div className="mt-3">
                      <input
                        type="file"
                        accept="image/*"
                        disabled={!authHeader || !productId || !productTenantCode || loading || saving}
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          if (!file) return
                          if (!authHeader) return
                          if (!productId || !productTenantCode) return

                          try {
                            setSaving(true)
                            setError(null)
                            const next = await uploadAdminProductImage(authHeader, productId, productTenantCode, file)
                            setData(next)
                            onUpdated?.(next)
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Yüklenemedi')
                          } finally {
                            setSaving(false)
                          }
                        }}
                        className="block w-full text-sm text-zinc-700 file:mr-4 file:rounded-xl file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-extrabold file:text-white hover:file:bg-primary"
                      />
                    </div>
                  </div>

                  <div className="mt-4 rounded-3xl border border-zinc-200 bg-white p-4 flex items-center justify-between">
                    <div className="text-xs font-bold text-zinc-700">Medya Kütüphanesinden Seç</div>
                    <button
                      type="button"
                      disabled={!authHeader || !productId || !productTenantCode || loading || saving}
                      onClick={() => setIsMediaOpen(true)}
                      className="px-4 py-2 bg-zinc-900 text-white font-bold text-xs rounded-xl hover:bg-zinc-800 transition disabled:opacity-50"
                    >
                      Kütüphaneyi Aç
                    </button>
                  </div>
                </div>

                <div className="w-full lg:w-[360px]">
                  <div className="rounded-3xl border border-zinc-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-zinc-700">Tüm Görseller</div>
                      <div className="text-[11px] text-zinc-500">{data.imageUrls.length} adet</div>
                    </div>

                    {loading ? <div className="mt-4 text-sm text-zinc-400">Yükleniyor…</div> : null}

                    <div className="mt-4 grid grid-cols-3 gap-3">
                      {data.imageUrls.map((url, idx) => {
                        const active = url === data.imageUrl
                        return (
                          <div key={url} className="relative group aspect-square">
                            <button
                              type="button"
                              className={`w-full h-full overflow-hidden rounded-2xl border transition ${active ? 'border-primary ring-2 ring-primary/20' : 'border-zinc-200 hover:border-zinc-300'}`}
                              onClick={async () => {
                                if (!authHeader) return
                                if (!productId || !productTenantCode) return
                                try {
                                  setSaving(true)
                                  setError(null)
                                  const next = await setAdminProductCoverImage(authHeader, productId, productTenantCode, url)
                                  setData(next)
                                  onUpdated?.(next)
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : 'Kapak seçilemedi')
                                } finally {
                                  setSaving(false)
                                }
                              }}
                            >
                              <img src={url} className="h-full w-full object-cover" />
                              {active ? (
                                <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[9px] font-extrabold text-white">KAPAK</span>
                              ) : null}
                            </button>

                            <button
                              type="button"
                              onClick={(e) => handleRemoveImage(url, e)}
                              className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition shadow-md flex items-center justify-center hover:bg-red-700 z-10"
                              title="Sil"
                            >
                              <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>

                            <div className="absolute inset-x-0 bottom-0 bg-black/70 py-1 px-1.5 flex justify-between opacity-0 group-hover:opacity-100 transition-opacity rounded-b-2xl z-10">
                              <button
                                type="button"
                                disabled={saving || idx === 0}
                                onClick={(e) => { e.stopPropagation(); handleMoveImage(url, 'left'); }}
                                className="text-white hover:text-primary disabled:opacity-30"
                                title="Sola Taşı"
                              >
                                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                              </button>
                              <span className="text-[9px] text-zinc-400 font-semibold self-center">Sırala</span>
                              <button
                                type="button"
                                disabled={saving || idx === data.imageUrls.length - 1}
                                onClick={(e) => { e.stopPropagation(); handleMoveImage(url, 'right'); }}
                                className="text-white hover:text-primary disabled:opacity-30"
                                title="Sağa Taşı"
                              >
                                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {data.imageUrls.length === 0 && !loading ? (
                      <div className="mt-4 text-sm text-zinc-500">Henüz görsel yok.</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end">
                <button type="button" onClick={onClose} className="h-11 rounded-2xl border border-zinc-200 px-4 text-sm font-bold text-zinc-700 hover:bg-zinc-50">
                  Kapat
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <MediaLibraryModal
        isOpen={isMediaOpen}
        onClose={() => setIsMediaOpen(false)}
        onSelect={handleSelectFromMedia}
        title="Ürün Görseli Seç"
        activeFolder="Ürünler"
      />
    </>
  )
}
