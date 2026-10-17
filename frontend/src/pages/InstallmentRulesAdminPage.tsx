import React, { useEffect, useMemo, useState } from 'react'
import {
  createInstallmentRule,
  deleteInstallmentRule,
  hardDeleteInstallmentRule,
  fetchInstallmentRules,
  type InstallmentRuleDto,
  updateInstallmentRule
} from '../api/installmentRules'
import Modal from '../components/Modal'
import { CreditCard, Plus, RotateCw, Trash2, Edit2, Check, X, ShieldAlert, AlertCircle, Info } from 'lucide-react'

type Draft = {
  bankName: string
  installmentText: string
  minAmountText: string
  descriptionText: string
  sortOrder: string
  isActive: boolean
}

function toDraft(r?: InstallmentRuleDto): Draft {
  return {
    bankName: String(r?.bankName ?? ''),
    installmentText: String(r?.installmentText ?? ''),
    minAmountText: String(r?.minAmountText ?? ''),
    descriptionText: String(r?.descriptionText ?? ''),
    sortOrder: String(r?.sortOrder ?? ''),
    isActive: Boolean(r?.isActive ?? true)
  }
}

function parseSortOrder(s: string) {
  const n = Number(String(s ?? '').trim())
  if (!Number.isFinite(n)) return undefined
  return Math.max(0, Math.trunc(n))
}

/* ────────────────────────────────────────────────────────────────────────────
   TAKSİT SATIRLARI — üç ayrı serbest metin yerine tek bir satır listesi.

   Kural üç ayrı metin alanında saklanır (`installmentText`, `minAmountText`,
   `descriptionText`) ve ödeme ekranı bunları SATIR SIRASIYLA eşler: taksit
   metninin 2. satırı, minimum tutarın 2. satırıyla eşleşir.

   Bu yüzden serbest metin tehlikeliydi: taksit kutusuna bir satır ekleyip
   minimum kutusuna eklemeyi unutmak, hata vermeden bütün minimumları bir alt
   taksite kaydırıyordu. Ayrıca taksit sayısı metin olduğu için "arttırılamıyordu".

   Editör satırları tek yerde tutar ve kaydederken üç metni AYNI SIRAYLA üretir;
   böylece kayma imkânsız hâle gelir.
──────────────────────────────────────────────────────────────────────────── */

type TaksitSatiri = {
  /** 0 = Tek Çekim. */
  count: number
  minAmount: string
  description: string
}

/** Ödeme ekranındaki ayrıştırıcının kabul ettiği biçim: "TEK ÇEKİM" / "3 TAKSİT". */
function taksitMetni(count: number) {
  return count <= 0 ? 'TEK ÇEKİM' : `${count} TAKSİT`
}

function otomatikAciklama(minAmount: string) {
  const temiz = String(minAmount ?? '').trim()
  if (!temiz) return ''
  return `${temiz} TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR.`
}

/** Bir açıklama otomatik üretilmiş mi (kullanıcının yazdığının üzerine yazmamak için). */
function otomatikMi(description: string) {
  return /TL VE ÜZERİ ÇEKİMLERDE UYGULANMAKTADIR\.?$/i.test(String(description ?? '').trim())
}

function satirlariCoz(draft: Draft): TaksitSatiri[] {
  const bol = (s: string) =>
    String(s ?? '')
      .split(/\r?\n/)
      .map((x) => x.trim())

  const taksitler = bol(draft.installmentText).filter(Boolean)
  const minler = bol(draft.minAmountText)
  const aciklamalar = bol(draft.descriptionText)

  return taksitler.map((t, i) => {
    const norm = t.toLocaleLowerCase('tr')
    const m = norm.match(/(\d+)\s*taksit/)
    const count = norm.includes('tek') ? 0 : m?.[1] ? Number(m[1]) : 0
    return {
      count,
      minAmount: minler[i] ?? '',
      description: aciklamalar[i] ?? ''
    }
  })
}

/** Tutari okunur hale getirir: "1500" -> "1.500 TL". */
function bicimliTutar(v: string) {
  const raw = String(v ?? '').trim()
  if (!raw) return '-'
  const n = Number(raw.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(n)) return raw
  return `${n.toLocaleString('tr-TR')} TL`
}

/**
 * Görüntüleme için satırları eşleştirir ve taksit sayısına göre sıralar.
 *
 * Üç metin alanı birbirine SIRA NUMARASIYLA bağlı olduğu için kartta üç ayrı blok
 * halinde gösterildiğinde hangi minimumun hangi taksite ait olduğu okunamıyordu
 * ("1 250 250" gibi). Burada satırlar tek tek eşlenip beraber basılıyor.
 */
function goruntuSatirlari(installmentText: string, minAmountText: string, descriptionText: string) {
  const bol = (v: string) =>
    String(v ?? '')
      .split(/\r?\n/)
      .map((x) => x.trim())

  const taksitler = bol(installmentText).filter(Boolean)
  const minler = bol(minAmountText)
  const aciklamalar = bol(descriptionText)

  return taksitler
    .map((t, i) => {
      const norm = t.toLocaleLowerCase('tr')
      const m = norm.match(/(\d+)/)
      const count = norm.includes('tek') ? 1 : m?.[1] ? Number(m[1]) : 9999
      return {
        etiket: t,
        sira: count === 0 ? 1 : count,
        minAmount: minler[i] ?? '',
        description: aciklamalar[i] ?? ''
      }
    })
    .sort((a, b) => a.sira - b.sira)
}

/** Satırları kuralın üç metin alanına AYNI SIRAYLA yazar. */
function satirlariYaz(rows: TaksitSatiri[]): Pick<Draft, 'installmentText' | 'minAmountText' | 'descriptionText'> {
  return {
    installmentText: rows.map((r) => taksitMetni(r.count)).join('\n'),
    minAmountText: rows.map((r) => String(r.minAmount ?? '').trim()).join('\n'),
    descriptionText: rows.map((r) => String(r.description ?? '').trim()).join('\n')
  }
}

function TaksitEditor({
  draft,
  onChange
}: {
  draft: Draft
  onChange: (patch: Pick<Draft, 'installmentText' | 'minAmountText' | 'descriptionText'>) => void
}) {
  const rows = satirlariCoz(draft)

  const yaz = (next: TaksitSatiri[]) => onChange(satirlariYaz(next))

  const guncelle = (i: number, patch: Partial<TaksitSatiri>) => {
    const next = rows.map((r, idx) => {
      if (idx !== i) return r
      const merged = { ...r, ...patch }
      // Minimum değişince açıklama otomatik güncellenir — ama kullanıcı kendi
      // açıklamasını yazdıysa DOKUNULMAZ.
      if (patch.minAmount !== undefined && (!merged.description || otomatikMi(merged.description))) {
        merged.description = otomatikAciklama(merged.minAmount)
      }
      return merged
    })
    yaz(next)
  }

  const ekle = () => {
    // Yeni satır, mevcut en büyük taksitin bir fazlası: en sık yapılan şey sıradaki
    // taksiti eklemek (3 varken 6), sıfırdan yazmak değil.
    const enBuyuk = rows.reduce((m, r) => Math.max(m, r.count), 0)
    yaz([...rows, { count: enBuyuk + 1, minAmount: '', description: '' }])
  }

  const sil = (i: number) => yaz(rows.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <div className="text-[11px] text-zinc-400 italic px-1">
          Henüz taksit seçeneği yok. Aşağıdan ekleyin.
        </div>
      )}

      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="w-28 flex-shrink-0">
            <div className="flex items-center border border-zinc-200 rounded-lg overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => guncelle(i, { count: Math.max(0, r.count - 1) })}
                className="w-7 h-8 text-zinc-500 hover:bg-zinc-100 text-sm font-bold"
                aria-label="Azalt"
              >
                −
              </button>
              <input
                type="number"
                min={0}
                value={r.count}
                onChange={(e) => guncelle(i, { count: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                className="w-10 h-8 text-center text-xs font-bold outline-none"
              />
              <button
                type="button"
                onClick={() => guncelle(i, { count: r.count + 1 })}
                className="w-7 h-8 text-zinc-500 hover:bg-zinc-100 text-sm font-bold"
                aria-label="Artır"
              >
                +
              </button>
            </div>
            <div className="text-[9px] text-center mt-0.5 font-semibold text-zinc-400">
              {r.count <= 0 ? 'TEK ÇEKİM' : `${r.count} TAKSİT`}
            </div>
          </div>

          <input
            type="text"
            inputMode="decimal"
            value={r.minAmount}
            onChange={(e) => guncelle(i, { minAmount: e.target.value })}
            placeholder="Min. tutar"
            className="w-24 flex-shrink-0 h-8 px-2 border border-zinc-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />

          <input
            type="text"
            value={r.description}
            onChange={(e) => guncelle(i, { description: e.target.value })}
            placeholder="Açıklama (minimum girilince otomatik dolar)"
            className="flex-1 min-w-0 h-8 px-2 border border-zinc-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />

          <button
            type="button"
            onClick={() => sil(i)}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50"
            aria-label="Satırı sil"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={ekle}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-zinc-300 text-[11px] font-bold text-zinc-600 hover:border-indigo-400 hover:text-indigo-600"
      >
        <Plus className="w-3.5 h-3.5" />
        Taksit Seçeneği Ekle
      </button>
    </div>
  )
}

export default function InstallmentRulesAdminPage() {
  const [items, setItems] = useState<InstallmentRuleDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTitle, setConfirmTitle] = useState('')
  const [confirmBody, setConfirmBody] = useState<React.ReactNode>(null)
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null)

  const [createDraft, setCreateDraft] = useState<Draft>(() =>
    toDraft({
      id: '',
      bankName: '',
      installmentText: '',
      minAmountText: '',
      descriptionText: '',
      sortOrder: 0,
      isActive: true
    } as any)
  )

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(() => toDraft())

  const normalizeErrorText = (e: unknown) => {
    const raw = e instanceof Error ? e.message : String(e ?? '').trim()
    const msg = String(raw ?? '').trim()
    if (!msg) return 'Bir hata oluştu'
    if (/failed to fetch/i.test(msg) || /networkerror/i.test(msg)) return 'Sunucuya ulaşılamadı. Lütfen tekrar deneyin.'
    if (/unauthorized/i.test(msg) || /forbidden/i.test(msg)) return 'Bu işlem için yetkiniz yok.'

    const cleaned = msg
      .replace(/https?:\/\/localhost:\d+\/?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()

    return cleaned || 'Bir hata oluştu'
  }

  const openConfirm = (opts: { title: string; body: React.ReactNode; action: () => Promise<void> }) => {
    setConfirmTitle(opts.title)
    setConfirmBody(opts.body)
    setConfirmAction(() => opts.action)
    setConfirmOpen(true)
  }

  const refresh = async () => {
    try {
      setError('')
      setSuccess('')
      setLoading(true)
      const list = await fetchInstallmentRules({ includeInactive: true })
      setItems(list)
    } catch (e) {
      setItems([])
      setError(normalizeErrorText(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const sa = Number(a.sortOrder ?? 0)
      const sb = Number(b.sortOrder ?? 0)
      if (sa !== sb) return sa - sb
      return String(a.bankName ?? '').localeCompare(String(b.bankName ?? ''), 'tr')
    })
  }, [items])

  const startEdit = (r: InstallmentRuleDto) => {
    setEditingId(r.id)
    setEditDraft(toDraft(r))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft(toDraft())
  }

  const saveEdit = async () => {
    if (!editingId) return
    try {
      setError('')
      setSuccess('')
      setBusyId(editingId)
      const payload = {
        bankName: editDraft.bankName,
        installmentText: editDraft.installmentText,
        minAmountText: editDraft.minAmountText,
        descriptionText: editDraft.descriptionText,
        sortOrder: parseSortOrder(editDraft.sortOrder),
        isActive: editDraft.isActive
      }
      await updateInstallmentRule(editingId, payload)
      await refresh()
      cancelEdit()
      setSuccess('Kayıt güncellendi.')
    } catch (e) {
      setError(normalizeErrorText(e))
    } finally {
      setBusyId(null)
    }
  }

  const createRow = async () => {
    try {
      setError('')
      setSuccess('')
      setBusyId('__create__')
      const payload = {
        bankName: createDraft.bankName,
        installmentText: createDraft.installmentText,
        minAmountText: createDraft.minAmountText,
        descriptionText: createDraft.descriptionText,
        sortOrder: parseSortOrder(createDraft.sortOrder)
      }
      await createInstallmentRule(payload)
      setCreateDraft(toDraft())
      await refresh()
      setCreateOpen(false)
      setSuccess('Yeni kayıt eklendi.')
    } catch (e) {
      setError(normalizeErrorText(e))
    } finally {
      setBusyId(null)
    }
  }

  const softRemoveRow = async (id: string) => {
    openConfirm({
      title: 'Pasife Al',
      body: (
        <div className="space-y-2 text-sm text-zinc-600">
          <div>Bu taksit kuralı pasife alınacaktır. POS ödeme aşamasında listelenmeyecektir.</div>
          <div className="p-3 bg-zinc-50 border border-zinc-100 rounded-xl text-xs text-zinc-500">
            Daha sonra banka kartından veya düzenleme ekranından tekrar aktife alabilirsiniz.
          </div>
        </div>
      ),
      action: async () => {
        try {
          setError('')
          setSuccess('')
          setBusyId(id)
          await deleteInstallmentRule(id)
          await refresh()
          if (editingId === id) cancelEdit()
          setSuccess('Kayıt pasife alındı.')
        } catch (e) {
          setError(normalizeErrorText(e))
        } finally {
          setBusyId(null)
          setConfirmOpen(false)
        }
      }
    })
  }

  const hardRemoveRow = async (id: string) => {
    openConfirm({
      title: 'Kuralı Kalıcı Olarak Sil',
      body: (
        <div className="space-y-3 text-sm text-zinc-650">
          <div>Bu taksit kuralını <span className="font-semibold text-rose-600">kalıcı olarak silmek</span> üzeresiniz.</div>
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 font-medium">
            Dikkat: Bu işlem veritabanından kalıcı olarak kaldırılacaktır ve geri alınamaz.
          </div>
        </div>
      ),
      action: async () => {
        try {
          setError('')
          setSuccess('')
          setBusyId(id)
          await hardDeleteInstallmentRule(id)
          await refresh()
          if (editingId === id) cancelEdit()
          setSuccess('Kayıt kalıcı olarak silindi.')
        } catch (e) {
          setError(normalizeErrorText(e))
        } finally {
          setBusyId(null)
          setConfirmOpen(false)
        }
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-zinc-950 tracking-tight">Taksit Bilgileri</h1>
          <p className="text-xs text-zinc-400 mt-0.5">Sanal POS taksit seçeneklerini, limitlerini ve oranlarını yönetin.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-[38px] inline-flex items-center gap-2 px-4 text-xs font-semibold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-sm hover:shadow transition-all duration-150 hover:scale-[1.01] active:scale-[0.99]"
            onClick={() => {
              setError('')
              setSuccess('')
              setCreateOpen(true)
            }}
            disabled={loading}
          >
            <Plus size={15} />
            Yeni Kural Ekle
          </button>
          <button
            type="button"
            className="h-[38px] inline-flex items-center justify-center gap-2 px-3.5 text-xs font-semibold rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 transition duration-150 active:scale-[0.98]"
            onClick={refresh}
            disabled={loading}
            title="Yenile"
          >
            <RotateCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Message banners */}
      {success && (
        <div className="p-4 rounded-xl border border-emerald-100 bg-emerald-50 text-xs font-medium text-emerald-700 flex items-center gap-2 shadow-sm">
          <Check size={14} className="text-emerald-600" />
          {success}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-xl border border-rose-100 bg-rose-50 text-xs font-medium text-rose-700 flex items-center gap-2 shadow-sm">
          <AlertCircle size={14} className="text-rose-600" />
          {error}
        </div>
      )}

      {/* Grid List */}
      <div>
        {loading && items.length === 0 ? (
          <div className="bg-white border border-zinc-100 rounded-2xl shadow-sm p-12 text-center text-sm text-zinc-400">
            <div className="flex items-center justify-center gap-2">
              <div className="h-4 w-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              Taksit kuralları yükleniyor...
            </div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-white border border-zinc-100 rounded-2xl shadow-sm p-12 text-center text-sm text-zinc-400 italic">
            Kayıtlı taksit kuralı bulunamadı.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {sorted.map((r) => {
              const isEditing = editingId === r.id
              const isBusy = busyId === r.id
              const cardActive = isEditing ? editDraft.isActive : r.isActive

              return (
                <div
                  key={r.id}
                  className={`flex flex-col rounded-2xl border transition-all duration-200 relative overflow-hidden ${
                    cardActive
                      ? 'border-zinc-200/80 bg-white shadow-sm hover:shadow-md'
                      : 'border-zinc-200/50 bg-zinc-50/70 opacity-90 shadow-none'
                  } ${isEditing ? 'ring-2 ring-indigo-500/20 border-indigo-400' : ''}`}
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between p-4 border-b border-zinc-100">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2.5 rounded-xl transition-colors ${
                          cardActive ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-200/60 text-zinc-400'
                        }`}
                      >
                        <CreditCard size={18} />
                      </div>
                      <div className="space-y-0.5">
                        {isEditing ? (
                          <input
                            className="w-full px-2 py-1 border border-zinc-200 rounded-lg text-sm font-semibold bg-white focus:outline-none focus:border-indigo-500"
                            value={editDraft.bankName}
                            onChange={(e) => setEditDraft((d) => ({ ...d, bankName: e.target.value }))}
                            placeholder="Banka Adı"
                          />
                        ) : (
                          <h3 className="font-bold text-sm text-zinc-850 leading-tight">{r.bankName}</h3>
                        )}
                        <div className="text-[10px] text-zinc-450 font-medium">Sıra: {isEditing ? editDraft.sortOrder : r.sortOrder}</div>
                      </div>
                    </div>

                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        cardActive
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          : 'bg-zinc-200 text-zinc-550 border-zinc-300'
                      }`}
                    >
                      {cardActive ? 'Aktif' : 'Pasif'}
                    </span>
                  </div>

                  {/* Card Body */}
                  <div className="flex-grow p-4 space-y-4">
                    {/* Taksit seçenekleri — düzenlemede satır bazlı editör, görüntülemede özet. */}
                    <div className="space-y-1">
                      <span className="text-[9px] uppercase font-extrabold text-zinc-400 tracking-wider">Taksit Seçenekleri</span>
                      {isEditing ? (
                        <TaksitEditor
                          draft={editDraft}
                          onChange={(patch) => setEditDraft((d) => ({ ...d, ...patch }))}
                        />
                      ) : (
                        (() => {
                          // Taksit + minimum tutar + açıklama AYNI SATIRDA. Üç ayrı blok
                          // halinde gösterilirken hangi minimumun hangi taksite ait olduğu
                          // okunmuyordu ("1 250 250" gibi).
                          const satirlar = goruntuSatirlari(r.installmentText, r.minAmountText, r.descriptionText)
                          if (!satirlar.length) {
                            return <div className="text-xs text-zinc-300 italic">Taksit satırı girilmemiş</div>
                          }
                          return (
                            <div className="rounded-xl border border-zinc-200 overflow-hidden bg-white">
                              {satirlar.map((line, li) => (
                                <div
                                  key={`${line.etiket}-${li}`}
                                  className={`px-2.5 py-2 ${li > 0 ? 'border-t border-zinc-100' : ''}`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-bold text-zinc-850">{line.etiket}</span>
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-zinc-100 text-zinc-700 font-mono text-[11px] font-bold border border-zinc-200 whitespace-nowrap">
                                      min {bicimliTutar(line.minAmount)}
                                    </span>
                                  </div>
                                  {line.description ? (
                                    <p className="mt-1 text-[11px] text-zinc-500 leading-snug">{line.description}</p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )
                        })()
                      )}
                    </div>
                  </div>

                  {/* Card Footer Actions */}
                  <div className="p-3 bg-zinc-50/50 border-t border-zinc-100 flex items-center justify-between gap-2">
                    {isEditing ? (
                      <>
                        <label className="flex items-center gap-1.5 text-xs text-zinc-650 cursor-pointer font-medium select-none">
                          <input
                            type="checkbox"
                            className="rounded border-zinc-350 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                            checked={editDraft.isActive}
                            onChange={(e) => setEditDraft((d) => ({ ...d, isActive: e.target.checked }))}
                          />
                          Aktif
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            className="h-[28px] inline-flex items-center gap-1 px-3 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition active:scale-[0.97]"
                            onClick={saveEdit}
                            disabled={isBusy}
                          >
                            <Check size={12} />
                            Kaydet
                          </button>
                          <button
                            type="button"
                            className="h-[28px] inline-flex items-center gap-1 px-3 rounded-lg text-xs font-semibold border border-zinc-200 bg-white hover:bg-zinc-100 text-zinc-700 transition active:scale-[0.97]"
                            onClick={cancelEdit}
                            disabled={isBusy}
                          >
                            <X size={12} />
                            İptal
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Sıra input in footer when editing */}
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-zinc-400">Sıra:</span>
                            <input
                              className="w-12 px-1 py-0.5 border border-zinc-200 rounded text-center text-xs bg-white"
                              value={editDraft.sortOrder}
                              onChange={(e) => setEditDraft((d) => ({ ...d, sortOrder: e.target.value }))}
                            />
                          </div>
                        ) : (
                          <div className="h-4" />
                        )}
                        <div className="flex items-center gap-1 ml-auto">
                          <button
                            type="button"
                            className="h-8 w-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-indigo-650 hover:bg-indigo-50 transition-colors"
                            onClick={() => startEdit(r)}
                            disabled={Boolean(busyId) || loading}
                            title="Kuralı Düzenle"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            type="button"
                            className={`h-8 px-2 inline-flex items-center justify-center rounded-lg text-[10px] font-bold border transition-colors ${
                              r.isActive
                                ? 'text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-100'
                                : 'text-emerald-650 hover:text-emerald-750 bg-emerald-50 hover:bg-emerald-100 border-emerald-100'
                            }`}
                            onClick={() => softRemoveRow(r.id)}
                            disabled={Boolean(busyId) || loading}
                          >
                            {r.isActive ? 'Pasife Al' : 'Aktife Al'}
                          </button>
                          <button
                            type="button"
                            className="h-8 w-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-650 hover:bg-rose-50 transition-colors"
                            onClick={() => hardRemoveRow(r.id)}
                            disabled={Boolean(busyId) || loading}
                            title="Kalıcı Sil"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (busyId === '__create__') return
          setCreateOpen(false)
        }}
        title="Yeni Taksit Kuralı Ekle"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              className="h-[36px] px-4 text-xs font-semibold rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 transition active:scale-[0.98]"
              onClick={() => setCreateOpen(false)}
              disabled={busyId === '__create__'}
            >
              Vazgeç
            </button>
            <button
              type="button"
              className={
                'h-[36px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-xl shadow-sm transition active:scale-[0.98] ' +
                (busyId === '__create__' ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 text-white')
              }
              onClick={createRow}
              disabled={busyId === '__create__'}
            >
              <Plus size={14} />
              {busyId === '__create__' ? 'Kural Ekleniyor...' : 'Kuralı Ekle'}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-650 block mb-1">Banka Adı *</label>
            <input
              className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition shadow-sm placeholder-zinc-400"
              value={createDraft.bankName}
              onChange={(e) => setCreateDraft((d) => ({ ...d, bankName: e.target.value }))}
              placeholder="Örn: Garanti BBVA"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-650 block mb-1">Listeleme Sırası</label>
            <input
              className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition shadow-sm placeholder-zinc-400"
              value={createDraft.sortOrder}
              onChange={(e) => setCreateDraft((d) => ({ ...d, sortOrder: e.target.value }))}
              placeholder="0"
            />
          </div>
          {/* Taksit / minimum / açıklama ARTIK TEK LİSTEDE: üçü ayrı metin kutusu olduğunda
              satır sayıları kolayca ayrışıyor ve minimumlar yanlış taksite kayıyordu. */}
          <div className="sm:col-span-2 space-y-1">
            <label className="text-xs font-semibold text-zinc-650 block mb-1">Taksit Seçenekleri *</label>
            <TaksitEditor
              draft={createDraft}
              onChange={(patch) => setCreateDraft((d) => ({ ...d, ...patch }))}
            />
          </div>
        </div>
      </Modal>

      {/* Confirmation Modal */}
      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (busyId) return
          setConfirmOpen(false)
        }}
        title={confirmTitle}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              className="h-[36px] px-4 text-xs font-semibold rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 transition"
              onClick={() => setConfirmOpen(false)}
              disabled={Boolean(busyId)}
            >
              İptal
            </button>
            <button
              type="button"
              className={`h-[36px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-xl shadow-sm transition ${
                confirmTitle.toLowerCase().includes('sil')
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
              onClick={() => confirmAction?.()}
              disabled={Boolean(busyId) || !confirmAction}
            >
              Onayla
            </button>
          </div>
        }
      >
        <div className="flex gap-3 items-start p-1">
          <div className={`p-2 rounded-xl mt-0.5 ${confirmTitle.toLowerCase().includes('sil') ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
            <ShieldAlert size={20} />
          </div>
          <div className="flex-1">
            {confirmBody}
          </div>
        </div>
      </Modal>
    </div>
  )
}
