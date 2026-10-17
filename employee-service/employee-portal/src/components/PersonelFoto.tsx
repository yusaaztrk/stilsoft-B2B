import { useEffect, useRef, useState } from 'react'
import { Camera, Trash2, User } from 'lucide-react'
import { deleteEmployeePhoto, fetchEmployeePhotoUrl, uploadEmployeePhoto } from '../api/employeePhotos'

/** Personel fotoğrafı — yoksa baş harfler. `hasPhoto` false ise istek atılmaz. */
export function PersonelAvatar({
  employeeId,
  hasPhoto,
  name,
  size = 28,
  version = 0
}: {
  employeeId: number
  hasPhoto: boolean
  name?: string
  size?: number
  /** Fotoğraf değişince artırılır; görsel yeniden çekilir. */
  version?: number
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setUrl(null)
    if (!hasPhoto || !employeeId) return
    void fetchEmployeePhotoUrl(employeeId).then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [employeeId, hasPhoto, version])

  const initials = String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toLocaleUpperCase('tr'))
    .join('')

  const style = { width: size, height: size }
  if (url) return <img src={url} alt={name ?? ''} style={style} className="shrink-0 rounded-full border border-slate-200 object-cover" />
  return (
    <span style={style} className="inline-flex shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-[10px] font-black text-slate-500">
      {initials || <User size={Math.round(size * 0.55)} />}
    </span>
  )
}

/** Düzenleme penceresi: fotoğrafı göster, yükle / değiştir / kaldır. */
export default function PersonelFotoDuzenle({
  employeeId,
  hasPhoto,
  name,
  onChanged
}: {
  employeeId: number
  hasPhoto: boolean
  name?: string
  onChanged: (hasPhoto: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setBusy(true)
      setError(null)
      await uploadEmployeePhoto(employeeId, file)
      setVersion((v) => v + 1)
      onChanged(true)
    } catch (e: any) {
      setError(String(e?.message ?? 'Fotoğraf yüklenemedi'))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async () => {
    if (!window.confirm('Fotoğraf kaldırılsın mı?')) return
    try {
      setBusy(true)
      setError(null)
      await deleteEmployeePhoto(employeeId)
      setVersion((v) => v + 1)
      onChanged(false)
    } catch (e: any) {
      setError(String(e?.message ?? 'Fotoğraf kaldırılamadı'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <PersonelAvatar employeeId={employeeId} hasPhoto={hasPhoto} name={name} size={72} version={version} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold text-slate-800">Personel Fotoğrafı</div>
        <div className="text-[11px] text-slate-500">JPEG / PNG; büyük fotoğraf otomatik küçültülür.</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <Camera size={14} /> {busy ? 'Yükleniyor…' : hasPhoto ? 'Değiştir' : 'Fotoğraf Yükle'}
          </button>
          {hasPhoto ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDelete()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 size={14} /> Kaldır
            </button>
          ) : null}
        </div>
        {error ? <div className="mt-1 text-[11px] font-semibold text-rose-600">{error}</div> : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
