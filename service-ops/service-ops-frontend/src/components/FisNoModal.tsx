import { useEffect, useState } from 'react'
import { Receipt, X } from 'lucide-react'
import { apiJson } from '../api/client'

/**
 * KAĞIT FİŞ NUMARASI giriş/düzenleme modalı.
 *
 * Serviste ürünle birlikte basılı bir fiş dolduruluyor ve o fişin numarası bugüne kadar
 * hiçbir yerde tutulmuyordu: müşteri elindeki kağıtla arayınca kaydı bulmanın yolu yoktu.
 * Sistemin ürettiği servis numarası (AT-/SH-) ile KARIŞTIRILMAMALI — o değiştirilemez,
 * bu elle girilir.
 *
 * Neden `PUT /api/servicerecords/{id}` değil: o uç düzenleme formunun TAMAMINI taşır ve
 * gönderilmeyen alanları null'lar; sırf fiş numarası için oradan geçmek müşteri/ürün
 * bilgisini silerdi. Bu yüzden yalnız bu alana dokunan ayrı uç kullanılıyor.
 *
 * Alan boş bırakılıp kaydedilirse numara TEMİZLENİR (yanlış girilen numara silinebilmeli).
 * Numara TEKİL DEĞİL: eski defterlerde tekrar eden numaralar var, tekillik dayatılmıyor.
 */
export type FisNoModalProps = {
  open: boolean
  onClose: () => void
  /** Kaydın id'si — PATCH bu id'ye gider. */
  recordId: string
  /** Sistemin ürettiği servis numarası; modalda hangi kayıt olduğu görünsün diye. */
  serviceNumber?: string
  productName?: string
  customerName?: string
  /** Mevcut kağıt fiş numarası (varsa) — düzenleme olarak açılır. */
  currentValue?: string | null
  /** Kaydetme başarılıysa çağrılır; sayfa listesini tazelemek için. */
  onSaved?: (manualReceiptNo: string | null) => void | Promise<void>
}

export default function FisNoModal({
  open,
  onClose,
  recordId,
  serviceNumber,
  productName,
  customerName,
  currentValue,
  onSaved,
}: FisNoModalProps) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal her açılışta o kaydın kendi değeriyle başlar: önceki kaydın numarası taşınmamalı.
  useEffect(() => {
    if (open) {
      setValue(currentValue ?? '')
      setError(null)
      setSaving(false)
    }
  }, [open, currentValue, recordId])

  if (!open) return null

  const trimmed = value.trim()
  const willClear = !trimmed && !!currentValue

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      await apiJson(`/api/servicerecords/${recordId}/manual-receipt-no`, {
        method: 'PATCH',
        body: JSON.stringify({ manualReceiptNo: trimmed }),
      })
      await onSaved?.(trimmed || null)
      onClose()
    } catch (e: any) {
      setError(String(e?.message ?? 'Fiş numarası kaydedilemedi.'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 rounded-t-xl border-b border-gray-200 bg-gray-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#B91C1C]/10">
              <Receipt className="h-5 w-5 text-[#B91C1C]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {currentValue ? 'Kağıt Fiş No Düzenle' : 'Kağıt Fiş No Gir'}
              </h3>
              <p className="text-xs text-gray-500">
                Müşterinin elindeki basılı fişin numarası. Sistem numarasından ayrıdır.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-500">KAYIT</span>
              {serviceNumber && <span className="font-mono font-bold text-gray-700">{serviceNumber}</span>}
            </div>
            <div className="font-bold text-gray-900">{productName || '-'}</div>
            {customerName && <div className="mt-0.5 text-gray-600">{customerName}</div>}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-gray-600">Kağıt Fiş No</label>
            <input
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saving) void submit()
              }}
              disabled={saving}
              autoFocus
              maxLength={50}
              placeholder="Örn. 37893"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-[#B91C1C] focus:outline-none focus:ring-2 focus:ring-red-100 disabled:bg-gray-50"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Aynı numara birden fazla kayıtta olabilir; tekillik aranmaz. Numara aramada da
              kullanılır.
            </p>
            {willClear && (
              <p className="mt-1 text-[11px] font-semibold text-amber-700">
                Alan boş — kaydedilirse mevcut numara ({currentValue}) silinir.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 rounded-b-xl border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="rounded-lg bg-[#B91C1C] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#991B1B] disabled:opacity-50"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  )
}
