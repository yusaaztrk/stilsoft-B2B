import { useEffect, useMemo, useState } from 'react'
import { ShieldCheck, Save, Warehouse as WarehouseIcon, AlertTriangle } from 'lucide-react'
import NotificationPopup from '../components/NotificationPopup'
import { fetchWarehouses, type WarehouseDto } from '../api/warehouses'
import {
  fetchWarrantyExchangeSettings,
  updateWarrantyExchangeSettings
} from '../api/warrantyExchanges'

/**
 * AYARLAR → GARANTİ DEPOSU (kullanıcı kuralı, 2026-08-14).
 *
 * Arızalı ürünlerin toplandığı depo burada seçilir. Tek ayar, firma başına tek satır.
 *
 * Ayrı bir "garanti deposu" tipi/bayrağı YOK: garanti deposu sıradan bir depo, tek fark
 * hangisi olduğunun seçilmiş olması. Depoya bayrak eklemek "iki depo birden garanti deposu"
 * gibi anlamsız bir hâli mümkün kılardı.
 *
 * Ayar değiştirmek GEÇMİŞE DOKUNMAZ — her değişim işlemi kendi deposunu damgalıyor.
 */
export default function GarantiDeposuAyarPage() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([])
  const [savedCode, setSavedCode] = useState<number>(0)
  const [selectedCode, setSelectedCode] = useState<string>('')

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setLoading(true)
        const [list, settings] = await Promise.all([
          fetchWarehouses({ signal: ac.signal }),
          fetchWarrantyExchangeSettings({ signal: ac.signal })
        ])
        setWarehouses(list ?? [])
        const code = Number(settings?.warehouseCode ?? 0)
        setSavedCode(code)
        // 0 = henüz seçilmedi. Boş string bırakılıyor ki seçici gerçekten boş görünsün;
        // "0" yazılsaydı hiçbir seçenekle eşleşmez ve tarayıcı listenin ilk deposunu
        // seçiliymiş gibi gösterirdi.
        setSelectedCode(code === 0 ? '' : String(code))
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(String(e?.message ?? 'Ayar yüklenemedi'))
      } finally {
        setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [])

  const activeWarehouses = useMemo(
    () => (warehouses ?? []).filter((w) => w.isActive !== false),
    [warehouses]
  )

  /**
   * Seçilebilir depolar: aktif olanlar + KAYITLI depo pasife alınmışsa o da "(Pasif)" etiketiyle.
   *
   * Yalnız aktifler listelenince, kayıtlı depo pasife alındığında seçici hiçbir seçenekle
   * eşleşmiyor ve boş görünüyordu: yönetici ayarın hangi depo olduğunu ekranda göremiyor,
   * listeden başka bir depo seçmeden de eski seçimi geri koyamıyordu.
   */
  const selectableWarehouses = useMemo(() => {
    const list = [...activeWarehouses]
    const saved = (warehouses ?? []).find((w) => Number(w.warehouseCode) === Number(savedCode))

    if (savedCode !== 0 && saved && saved.isActive === false) {
      list.unshift({ ...saved, name: `${saved.name ?? ''} (Pasif)`.trim() })
    }

    return list
  }, [activeWarehouses, warehouses, savedCode])

  const savedWarehouse = useMemo(
    () => (warehouses ?? []).find((w) => Number(w.warehouseCode) === Number(savedCode)),
    [warehouses, savedCode]
  )

  const isDirty = String(savedCode === 0 ? '' : savedCode) !== String(selectedCode ?? '')

  const onSave = async () => {
    try {
      setSaving(true)
      setError(null)
      const code = String(selectedCode ?? '').trim() === '' ? 0 : Number(selectedCode)
      await updateWarrantyExchangeSettings(code)
      setSavedCode(code)
      setSuccess(code === 0 ? 'Garanti deposu seçimi kaldırıldı.' : 'Garanti deposu kaydedildi.')
    } catch (e: any) {
      setError(String(e?.message ?? 'Kaydedilemedi'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 space-y-4">
      <NotificationPopup
        isOpen={Boolean(error)}
        variant="error"
        title="Hata"
        message={error ?? ''}
        onClose={() => setError(null)}
      />
      <NotificationPopup
        isOpen={Boolean(success)}
        variant="success"
        title="Başarılı"
        message={success ?? ''}
        onClose={() => setSuccess(null)}
      />

      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
          <ShieldCheck size={18} />
        </div>
        <div>
          <div className="text-base font-bold text-slate-900">Garanti Deposu</div>
          <div className="text-xs text-slate-500">Ayarlar / Garanti Deposu</div>
        </div>
      </div>

      <div className="max-w-2xl bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-2xs">
        <div className="text-xs text-slate-600 leading-relaxed">
          Garanti değişiminde müşteriden geri alınan <strong>arızalı ürünler bu depoya girer</strong>.
          Sağlam ürün ise işlem ekranında seçilen depodan çıkar. Buradaki seçim geçmiş kayıtları
          etkilemez — her işlem kendi deposunu saklar.
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
            Garanti Deposu
          </div>
          <select
            value={selectedCode}
            onChange={(e) => setSelectedCode(String(e.target.value))}
            disabled={loading || saving}
            className="input-base h-10 text-sm w-full"
          >
            <option value="">{loading ? 'Yükleniyor...' : 'Seçilmedi'}</option>
            {selectableWarehouses.map((w) => (
              <option key={String(w.warehouseCode)} value={String(w.warehouseCode)}>
                [{w.warehouseCode}] {w.name ?? ''}
              </option>
            ))}
          </select>
        </div>

        {savedCode === 0 ? (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>
              Garanti deposu seçilmeden <strong>Garanti Değişim</strong> ekranından işlem
              yapılamaz. Arızalı ürünün gireceği depo belli olmadan kayıt açmak, stoğu yanlış
              depoya yazmak demek olurdu.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
            <WarehouseIcon size={15} className="shrink-0" />
            <span>
              Aktif garanti deposu:{' '}
              <strong>
                [{savedCode}] {savedWarehouse?.name ?? ''}
              </strong>
            </span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || loading || !isDirty}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={14} />
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  )
}
