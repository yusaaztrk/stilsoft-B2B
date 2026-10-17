import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

/**
 * Montaj kalemi iptal modalı.
 *
 * Eskiden `window.prompt` ile soruluyordu: neyin iptal edildiği (hangi ürün, kaç adet, hangi
 * müşteri) görünmüyordu ve tarayıcı iptalleri sessizce boş metin geçebiliyordu. İptal geri
 * alınamayan bir işlem — ne olacağı ekranda yazmalı.
 *
 * Neden zorunlu bir sebep: sebep kalemin BÜTÜN görev satırlarının geçmişine yazılıyor, sahadaki
 * teknisyen işin neden düştüğünü oradan okuyor.
 */

const PRESET_REASONS = [
  'Müşteri talebi',
  'Yanlış fatura',
  'Ürün iade edildi',
  'Adres / müşteri hatalı',
  'Stok yok',
]

export type MontajIptalModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<void> | void
  /** İptal edilecek kalem — modalda ne olacağı yazsın diye. */
  productName?: string
  quantity?: number
  customerName?: string
  serviceNumber?: string
  /** Bu kalemde hâlihazırda sahaya aktarılmış / gerçekleşmiş adet varsa uyarı çıkar. */
  transferredQuantity?: number
  completedQuantity?: number
}

export default function MontajIptalModal({
  open,
  onClose,
  onConfirm,
  productName,
  quantity,
  customerName,
  serviceNumber,
  transferredQuantity = 0,
  completedQuantity = 0,
}: MontajIptalModalProps) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal her açılışta temiz başlar: önceki kalemin sebebi yeni kaleme taşınmamalı.
  useEffect(() => {
    if (open) {
      setReason('')
      setError(null)
      setSaving(false)
    }
  }, [open])

  if (!open) return null

  const trimmed = reason.trim()

  const submit = async () => {
    if (!trimmed) {
      setError('İptal nedeni zorunludur.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onConfirm(trimmed)
    } catch (e: any) {
      setError(String(e?.message ?? 'Kalem iptal edilemedi.'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 rounded-t-xl border-b border-red-100 bg-red-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-red-800">Montaj Kalemini İptal Et</h3>
              <p className="text-xs text-red-700/80">
                Yalnızca bu kalem iptal edilir; kaydın diğer kalemleri işlemeye devam eder.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full p-1 text-red-400 transition-colors hover:bg-red-100 hover:text-red-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-500">İPTAL EDİLECEK KALEM</span>
              {serviceNumber && <span className="font-mono font-bold text-gray-700">{serviceNumber}</span>}
            </div>
            <div className="font-bold text-gray-900">{productName || '-'}</div>
            <div className="mt-0.5 text-gray-600">
              {typeof quantity === 'number' && <span className="font-semibold">{quantity} adet</span>}
              {customerName && <span> · {customerName}</span>}
            </div>
          </div>

          {/* Sahaya çıkmış veya bitmiş adet varsa iptal geçmişi de siler gibi görünmesin. */}
          {(transferredQuantity > 0 || completedQuantity > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
              Bu kalemin {completedQuantity > 0 && <b>{completedQuantity} adedi gerçekleşmiş</b>}
              {completedQuantity > 0 && transferredQuantity > 0 && ', '}
              {transferredQuantity > 0 && <b>{transferredQuantity} adedi sahada</b>}. İptal, bu
              satırların durumunu da "İptal" yapar — yapılan iş geçmişte kalır ama kalem kapanır.
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-bold text-gray-600">
              İptal Nedeni <span className="text-red-500">*</span>
            </label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PRESET_REASONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason(preset)}
                  disabled={saving}
                  className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  {preset}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                if (error) setError(null)
              }}
              disabled={saving}
              rows={3}
              autoFocus
              placeholder="Bu montaj neden iptal ediliyor?"
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 disabled:bg-gray-50"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Bu neden, kalemin <b>her planlama satırının</b> işlem adımlarına yazılır.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 rounded-b-xl border-t border-gray-100 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !trimmed}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'İptal ediliyor...' : 'Kalemi İptal Et'}
          </button>
        </div>
      </div>
    </div>
  )
}
