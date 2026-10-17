import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, ClipboardCheck, Loader2, MapPin, Send, Users } from 'lucide-react'

import Modal from './Modal'
import { apiJson } from '../api/client'
import { describeNextStatusChange } from '../api/statusChangeGate'
import type { Technician } from '../hooks/useTechnicians'
import { ASSIGNABLE_TEAM_ORDER, TEAM_LABELS, teamOf, teamLabelOf, groupRowsByTechnician, type GroupableRow } from './teams'

/**
 * "Sahaya Aktar" adımı: hangi planlama satırlarının, HANGİ saha personeline ya da klima ekibine
 * gideceği burada kesinleşir. Teknisyen planlama sırasında seçiliyor ama aktarım anında son kez
 * değiştirilebiliyor — sahadaki gerçek dağılım çoğu zaman aktarım gününde belli oluyor.
 *
 * Fiş kapısı sunucuda da var (Installation + Workshop geçişinde hem iş emri hem IsPrinted aranır);
 * buradaki kontrol onu ezmez, kullanıcıyı boşuna hataya düşürmemek için önden uyarır.
 *
 * Aktarım KISMİDİR: yalnızca seçilen satırlar gider, kalanlar AYNI kayıtta planlanmaya devam eder.
 * KAYIT BÖLÜNMEZ — bu açıklama bir zamanlar "sunucu kalan için MNT-xxxxxxx-N ek numaralı kardeş
 * kayıt üretir" diyordu; o davranış 2026-08-10'da kaldırıldı (aktarım artık satıra damgalanıyor,
 * `InstallationTask.TransferredAt`) ama yorum güncellenmemişti ve modalın kendi içindeki uyarıyla
 * çelişiyordu.
 */

type Props = {
  isOpen: boolean
  /** Montaj Yönetimi listesindeki kayıt satırı. */
  record: any | null
  /**
   * Tıklanan satırın kalemi. Planlama listesi kalem kalem olduğu için modal da yalnızca o
   * kalemin satırlarını gösterir; boş geçilirse kaydın tüm aktarılabilir satırları listelenir.
   * Kısmi aktarım uyarısı yine KAYDIN tamamına bakar — kalan satırlar için sunucu ek numaralı
   * kardeş kayıt üretecek, kullanıcı bunu görmeden aktarmamalı.
   */
  focusItemId?: string | null
  /** Sayfadan geçer; hook burada çağrılsa her modal ayrı bir 30 sn'lik yoklama açardı. */
  technicians: Technician[]
  onClose: () => void
  /** Aktarım başarılı olduğunda listeyi tazelemek için. */
  onTransferred?: () => Promise<unknown> | void
  /**
   * ARTIK KULLANILMIYOR (2026-09-17): fiş yoksa da `onPrintSlip` yerinde oluşturup basıyor.
   * Çağıran sayfa hâlâ geçiyor; prop kaldırılmadı ki derleme kırılmasın.
   */
  onOpenServisFisi?: (record: any, itemId?: string | null) => void
  /**
   * Fiş VAR ama basılmamışsa: yazdırmayı YERİNDE yapar, bu modal AÇIK KALIR.
   *
   * Eskiden tek yol vardı: modal kapanıyor, Servis Fişi ekranı açılıyor, kullanıcı yazdırıp
   * geri dönüp aktarım modalını yeniden açıyordu. Üç ekran gezmeden planla-yazdır-aktar
   * yapılabilmesi için ayrıldı.
   */
  onPrintSlip?: (record: any, itemId?: string | null) => Promise<unknown> | void
}

/** Aktarılabilir satır: planlanmış ya da devam eden. İptal/plansız/tamamlanmış aktarılmaz. */
const TRANSFERABLE = new Set<string | number>([0, 1, 'Planned', 'InProgress'])

export default function SahayaAktarModal({ isOpen, record, focusItemId, technicians, onClose, onTransferred, onPrintSlip }: Props) {
  const recordId: string | undefined = record?.id

  const [detail, setDetail] = useState<any | null>(null)
  /** Kaydın TÜM aktarılabilir satırları — kısmi aktarım uyarısı buna bakar. */
  const [allRows, setAllRows] = useState<any[]>([])
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /** Satır kimliği → aktarımda uygulanacak teknisyen. Yalnızca değişenler sunucuya yazılır. */
  const [techOverrides, setTechOverrides] = useState<Record<string, string>>({})
  const [bulkTechId, setBulkTechId] = useState('')
  const [transferring, setTransferring] = useState(false)
  const [printing, setPrinting] = useState(false)

  /**
   * Fişi yerinde yazdırır ve kaydın basım damgasını tazeler.
   *
   * Modal KAPANMAZ: yazdırma bittiğinde `isPrinted` true olur, kapı mesajı kaybolur ve aynı
   * ekranda "Sahaya Aktar" düğmesi belirir. Amaç planla → yazdır → aktar akışını tek ekranda
   * bitirmek.
   *
   * Damga sunucudan YENİDEN OKUNUYOR, elle true yapılmıyor: yazdırma başarısız olur ya da
   * kullanıcı yazdırma penceresini iptal ederse kapı açık kalmalı — basılmamış fişle sahaya
   * aktarım yapılmasın.
   */
  const printInPlace = async () => {
    if (!record || printing) return
    setPrinting(true)
    setError(null)
    try {
      await onPrintSlip?.(record, focusItemId)
      if (recordId) {
        const det = await apiJson<any>(`/api/servicerecords/${recordId}`)
        setDetail(det)
      }
    } catch (e: any) {
      setError(String(e?.message ?? 'Fiş yazdırılamadı'))
    } finally {
      setPrinting(false)
    }
  }

  useEffect(() => {
    if (!isOpen || !recordId) return
    let active = true
    setLoading(true)
    setError(null)
    setSelectedIds([])
    setTechOverrides({})
    setBulkTechId('')
    void (async () => {
      try {
        const [det, taskData] = await Promise.all([
          apiJson<any>(`/api/servicerecords/${recordId}`),
          apiJson<any[]>(`/api/installations/tasks?serviceId=${recordId}`),
        ])
        if (!active) return
        setDetail(det)
        const transferable = (Array.isArray(taskData) ? taskData : [])
          .filter((t: any) => TRANSFERABLE.has(t.status ?? t.Status))
          // Bir kez aktarılan satır tekrar aktarılmaz. Aktarım kaydı bölmediği için satır
          // aktarıldıktan sonra da aynı kayıtta duruyor; damga olmasa listede kalır ve
          // ikinci kez gönderilebilirdi.
          .filter((t: any) => !(t.transferredAt ?? t.TransferredAt))
          .map((t: any) => ({
            id: String(t.id ?? t.Id),
            itemId: String(t.serviceRecordItemId ?? t.ServiceRecordItemId ?? ''),
            itemProductName: t.itemProductName ?? t.ItemProductName ?? '-',
            technicianId: String(t.assignedTechnicianId ?? t.AssignedTechnicianId ?? ''),
            technicianName: t.technicianName ?? t.TechnicianName ?? '',
            plannedAt: t.plannedAt ?? t.PlannedAt ?? null,
            customAddress: t.customAddress ?? t.CustomAddress ?? '',
            notes: t.notes ?? t.Notes ?? '',
            regionName: t.regionName ?? t.RegionName ?? '',
            itemSortOrder: Number(t.itemSortOrder ?? t.ItemSortOrder ?? 0),
          }))
          .sort((a, b) => a.itemSortOrder - b.itemSortOrder || String(a.plannedAt ?? '').localeCompare(String(b.plannedAt ?? '')))
        const focused = focusItemId ? transferable.filter((r) => r.itemId === focusItemId) : transferable
        setAllRows(transferable)
        setRows(focused)
        setSelectedIds(focused.map((r) => r.id))
      } catch (e: any) {
        if (active) setError(String(e?.message ?? 'Planlama satırları yüklenemedi'))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [isOpen, recordId, focusItemId])

  /** Montaja YENİ atanabilecek ekipler — servis personeli/atölye/müdür seçilemez. */
  const techniciansByTeam = useMemo(() => {
    return ASSIGNABLE_TEAM_ORDER.map((key) => ({
      key,
      label: TEAM_LABELS[key],
      list: technicians
        .filter((t) => t.isActive !== false && teamOf(t.roles) === key)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'tr')),
    })).filter((g) => g.list.length > 0)
  }, [technicians])

  const technicianById = useMemo(() => {
    const map = new Map<string, Technician>()
    for (const t of technicians) map.set(t.id, t)
    return map
  }, [technicians])

  /** Assignable list olmayan (ör. eskiden yanlışlıkla atanmış "Diğer") bir atama satırda hâlâ
   *  seçiliyse, seçenekler arasına tek başına eklenir — aksi halde <select> sessizce boş görünür
   *  ve kullanıcı işi zaten atanmışken "Atanmadı" sanır. */
  const currentTechExtraOption = (currentId: string) => {
    if (!currentId) return null
    const inAssignable = techniciansByTeam.some((g) => g.list.some((t) => t.id === currentId))
    if (inAssignable) return null
    const tech = technicianById.get(currentId)
    return tech ?? null
  }

  const effectiveTechId = (row: any) => techOverrides[row.id] ?? row.technicianId

  const hasWorkOrder = detail?.hasWorkOrder ?? detail?.HasWorkOrder ?? false
  const isPrinted = detail?.isPrinted ?? detail?.IsPrinted ?? record?.isPrinted ?? false
  const gateMessage = !hasWorkOrder
    ? 'Servis fişi henüz oluşturulmadı. Fişi buradan oluşturup yazdırabilirsiniz.'
    : !isPrinted
      ? 'Servis fişi henüz basılmadı. Fişi buradan yazdırabilirsiniz.'
      : null

  const unassignedSelected = selectedIds.filter((id) => {
    const row = rows.find((r) => r.id === id)
    return row && !effectiveTechId(row)
  })

  const canTransfer =
    !gateMessage && !transferring && selectedIds.length > 0 && unassignedSelected.length === 0

  /**
   * "Son kez gözden geçir" özeti: Fatura Planlama'daki "Kime Ne Atandı" ile aynı gruplama.
   * Planlamada kararlaştırılan dağılım burada değişebildiği için (aktarım anındaki son söz)
   * satır listesi değil, o anki seçim + geçersiz kılmalar üzerinden yeniden hesaplanıyor —
   * planlamadaki grupla burada göründüğü hep aynı olsun diye aynı fonksiyon kullanılıyor.
   */
  const reviewRows: GroupableRow[] = useMemo(() => {
    return selectedIds
      .map((id) => rows.find((r) => r.id === id))
      .filter((row): row is (typeof rows)[number] => !!row)
      .map((row) => {
        const techId = effectiveTechId(row)
        return {
          id: row.id,
          technicianId: techId,
          technicianName: techId ? (technicianById.get(techId)?.fullName ?? row.technicianName) : '',
          quantity: 1,
          itemProductName: row.itemProductName,
        }
      })
  }, [selectedIds, rows, techOverrides, technicianById])

  const reviewGroups = useMemo(
    () => groupRowsByTechnician(reviewRows, (id) => technicianById.get(id)?.roles),
    [reviewRows, technicianById]
  )

  const applyBulk = () => {
    if (!bulkTechId || selectedIds.length === 0) return
    setTechOverrides((prev) => {
      const next = { ...prev }
      for (const id of selectedIds) next[id] = bulkTechId
      return next
    })
  }

  const transfer = async () => {
    if (!recordId || !canTransfer) return
    setTransferring(true)
    setError(null)

    // Önce değişen atamalar yazılır; aktarım sonrası düzeltme sahadaki kişiyi yanlış gösterir.
    //
    // BU ADIM PARÇALI BAŞARISIZ OLABİLİR ve tek bir işlem (transaction) değildir: uçlar satır
    // bazlı. Ortada bir hata olursa bazı satırların teknisyeni DEĞİŞMİŞ, aktarım OLMAMIŞ olur.
    // Eskiden bu durum tek bir "Aktarım başarısız" mesajına düşüyor, kullanıcı hiçbir şeyin
    // değişmediğini sanıp aynı düğmeye tekrar basıyordu. Artık kaç satırın yazıldığı söyleniyor,
    // aktarım adımına GEÇİLMİYOR ve liste tazeleniyor — ekran gerçeği göstersin.
    const changed = rows.filter((r) => selectedIds.includes(r.id) && effectiveTechId(r) !== r.technicianId)
    let applied = 0
    try {
      for (const row of changed) {
        await apiJson(`/api/installations/tasks/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            assignedTechnicianId: effectiveTechId(row),
            plannedAt: new Date(row.plannedAt ?? Date.now()).toISOString(),
            customAddress: row.customAddress || undefined,
            notes: row.notes || undefined,
          }),
        })
        applied++
      }
    } catch (e: any) {
      setError(
        applied > 0
          ? `Atama değişikliklerinin ${applied}/${changed.length} tanesi yazıldı, sonrası başarısız oldu — AKTARIM YAPILMADI. Listeyi kontrol edip tekrar deneyin. (${String(e?.message ?? '')})`
          : `Atama değişikliği yazılamadı, aktarım yapılmadı: ${String(e?.message ?? 'bilinmeyen hata')}`
      )
      setTransferring(false)
      await onTransferred?.()
      return
    }

    try {
      // Aktarım tek bir kayıt durumu güncellemesi; onay ekranı kaç satırın gittiğini de yazsın.
      describeNextStatusChange({
        kind: `Sahaya Aktarım (${selectedIds.length} satır)`,
        fromLabel: 'Planlandı',
        toLabel: 'Sahada',
        hasPhoto: false,
        warning: 'Aktarılan satırlar Teslimattakiler sekmesine geçer ve planlamadan düşer.'
      })
      await apiJson(`/api/servicerecords/${recordId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'Workshop',
          notes:
            // "Tamamı aktarıldı" kararı KAYDIN tüm satırlarına bakar; kalem odaklı açıldığında
            // seçili satırlar bu kalemin tamamı olsa bile kayıt kısmen aktarılmış olabilir.
            selectedIds.length === allRows.length
              ? 'Montaj sahaya aktarıldı.'
              : `Seçilen ${selectedIds.length} planlama satırı sahaya aktarıldı.`,
          taskIds: selectedIds,
        }),
      })

      onClose()
      void onTransferred?.()
    } catch (e: any) {
      setError(String(e?.message ?? 'Aktarım başarısız'))
    } finally {
      setTransferring(false)
    }
  }

  if (!record) return null

  const allSelected = rows.length > 0 && selectedIds.length === rows.length

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        focusItemId && rows.length > 0
          ? `Sahaya Aktar · ${record.serviceNumber ?? ''} · ${rows[0].itemProductName}`
          : `Sahaya Aktar · ${record.serviceNumber ?? ''}`
      }
      containerClassName="max-w-4xl"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            Vazgeç
          </button>
          {!hasWorkOrder || !isPrinted ? (
            /* Fiş yok ya da basılmamış: YERİNDE oluştur + yazdır — modal kapanmaz, hemen
               aktarıma geçilir. Eskiden fiş yoksa Servis Fişi ekranına gönderiliyordu; oradan
               aynı fiş ikinci kez oluşturulup basılıyordu (2026-09-17). Oluşturmak için form
               gerekmiyor: iş emri planlama satırından (teknisyen + gün) türetiliyor. */
            <button
              onClick={printInPlace}
              disabled={printing}
              className={
                'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition shadow-sm animate-in fade-in zoom-in-95 duration-150 ' +
                (printing ? 'bg-amber-300 text-white cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700 text-white cursor-pointer')
              }
            >
              {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
              {printing ? 'Yazdırılıyor...' : !hasWorkOrder ? 'Servis Fişi Oluştur ve Yazdır' : 'Servis Fişi Yazdır'}
            </button>
          ) : (
            <button
              onClick={transfer}
              disabled={!canTransfer}
              className={
                'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ' +
                (canTransfer ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed')
              }
            >
              {transferring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {transferring ? 'Aktarılıyor...' : `Sahaya Aktar (${selectedIds.length})`}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {gateMessage && (
          <div className="flex items-center justify-between gap-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs font-semibold text-amber-800 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{gateMessage}</span>
            </div>
            {/* Fiş yoksa da varsa da iş YERİNDE biter: yoksa oluşturulup basılır. */}
            <button
              type="button"
              onClick={printInPlace}
              disabled={printing}
              className={
                'px-3 py-1 rounded-lg text-[11px] font-bold shadow-xs transition flex-shrink-0 text-white ' +
                (printing ? 'bg-amber-300 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700 cursor-pointer')
              }
            >
              {printing ? 'Yazdırılıyor...' : !hasWorkOrder ? 'Oluştur ve Yazdır' : 'Yazdır'}
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs font-semibold text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor...
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-400 py-8 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
            Aktarılabilecek planlanmış satır yok. Önce <strong>Fatura Planlama</strong> ekranından satır açın.
          </div>
        ) : (
          <>
            {/* Son kez gözden geçir: Fatura Planlama'daki "Kime Ne Atandı" ile aynı gruplama —
                aktarımdan hemen önce kimin kaça çıktığı burada net görünsün. */}
            <div className="rounded-xl border border-emerald-150 bg-emerald-50/40 p-4 space-y-3">
              <div className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                <ClipboardCheck className="w-3.5 h-3.5" /> Son Kez Gözden Geçirin — Kime Kaç Adet Gidecek
              </div>
              {reviewGroups.length === 0 ? (
                <div className="text-xs text-gray-500 py-2">Henüz aktarım için satır seçilmedi.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {reviewGroups.map((group) => (
                    <div
                      key={group.technicianId || 'unassigned'}
                      className={
                        'rounded-lg border px-3 py-2.5 flex items-center justify-between gap-2 ' +
                        (group.technicianId ? 'border-emerald-150 bg-white' : 'border-amber-300 bg-amber-50')
                      }
                    >
                      <div className="min-w-0">
                        <div className={'text-xs font-bold truncate ' + (group.technicianId ? 'text-gray-900' : 'text-amber-700')}>
                          {group.technicianName || 'Atanmadı'}
                        </div>
                        <div className="text-[10px] text-gray-400 truncate">
                          {group.technicianId ? TEAM_LABELS[group.team] : 'Aktarmadan önce ata'}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-sm font-bold text-emerald-700 bg-emerald-100 rounded-full px-2.5 py-0.5">
                        {group.totalQuantity}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">Satır Detayları</div>

            <div className="flex flex-col gap-2 rounded-xl border border-gray-150 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <Users className="w-4 h-4 text-gray-500" />
                Seçili satırları topluca ata
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={bulkTechId}
                  onChange={(e) => setBulkTechId(e.target.value)}
                  className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full sm:w-64"
                >
                  <option value="">Saha personeli / klima ekibi...</option>
                  {techniciansByTeam.map((g) => (
                    <optgroup key={g.key} label={g.label}>
                      {g.list.map((t) => (
                        <option key={t.id} value={t.id}>{t.fullName}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={applyBulk}
                  disabled={!bulkTechId || selectedIds.length === 0}
                  className={
                    'px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap ' +
                    (!bulkTechId || selectedIds.length === 0
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-900 text-white hover:bg-gray-800')
                  }
                >
                  Uygula
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-150 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wider text-gray-500 font-bold border-b border-gray-150">
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => setSelectedIds(e.target.checked ? rows.map((r) => r.id) : [])}
                        className="rounded border-gray-300 text-[#B91C1C] focus:ring-[#B91C1C]"
                        title="Tümünü seç"
                      />
                    </th>
                    <th className="px-3 py-2">Sıra</th>
                    <th className="px-3 py-2">Kalem</th>
                    <th className="px-3 py-2">Kime Gidecek</th>
                    <th className="px-3 py-2">Tarih</th>
                    <th className="px-3 py-2">Bölge</th>
                    <th className="px-3 py-2">Adres</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row, idx) => {
                    const techId = effectiveTechId(row)
                    const changed = techId !== row.technicianId
                    const selected = selectedIds.includes(row.id)
                    return (
                      <tr key={row.id} className={selected ? 'hover:bg-gray-50/50' : 'opacity-50 hover:bg-gray-50/50'}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              setSelectedIds((prev) =>
                                prev.includes(row.id) ? prev.filter((x) => x !== row.id) : [...prev, row.id]
                              )
                            }
                            className="rounded border-gray-300 text-[#B91C1C] focus:ring-[#B91C1C]"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-gray-400">#{idx + 1}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate" title={row.itemProductName}>
                          {row.itemProductName}
                        </td>
                        <td className="px-3 py-2 min-w-[200px]">
                          <select
                            value={techId}
                            onChange={(e) => setTechOverrides((prev) => ({ ...prev, [row.id]: e.target.value }))}
                            className={
                              'px-2 py-1 bg-white border rounded text-xs w-full ' +
                              (changed ? 'border-amber-400 ring-1 ring-amber-200' : 'border-gray-200')
                            }
                          >
                            <option value="">Atanmadı</option>
                            {currentTechExtraOption(techId) && (
                              <optgroup label="Mevcut Atama">
                                <option value={techId}>{currentTechExtraOption(techId)!.fullName}</option>
                              </optgroup>
                            )}
                            {techniciansByTeam.map((g) => (
                              <optgroup key={g.key} label={g.label}>
                                {g.list.map((t) => (
                                  <option key={t.id} value={t.id}>{t.fullName}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            {techId ? teamLabelOf(technicianById.get(techId)?.roles) : 'Ekip seçilmedi'}
                            {changed && <span className="ml-1 font-bold text-amber-600">· değiştirildi</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="w-3 h-3 text-gray-400" />
                            {row.plannedAt ? new Date(row.plannedAt).toLocaleDateString('tr-TR') : '-'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {row.regionName ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-gray-800 bg-gray-100 px-2 py-0.5 rounded text-[10px]">
                              {row.regionName}
                            </span>
                          ) : (
                            <span className="text-gray-300 italic text-[10px]">Belirtilmedi</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600 max-w-[250px] min-w-[185px] break-all whitespace-normal">
                          {row.customAddress ? (
                            <span className="flex items-start gap-1 text-[11px]" title={row.customAddress}>
                              <MapPin className="w-3 h-3 mt-0.5 text-orange-500 flex-shrink-0" />
                              <span>{row.customAddress}</span>
                            </span>
                          ) : (
                            <span className="text-gray-300 italic text-[10px]">Belirtilmedi</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {unassignedSelected.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs font-semibold text-amber-800">
                Seçili {unassignedSelected.length} satırda personel yok. Aktarmadan önce her satıra saha personeli
                veya klima ekibi seçin.
              </div>
            )}

            {selectedIds.length > 0 && selectedIds.length < allRows.length && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-[11px] text-blue-800 leading-relaxed">
                Kısmi aktarım: kaydın aktarılmayan {allRows.length - selectedIds.length} satırı planlamada kalır.
                Kayıt İKİYE BÖLÜNMEZ — numarası değişmez, kalan satırlar aynı kayıtta planlanmaya devam eder.
                {focusItemId && allRows.length > rows.length && (
                  <> Bu ekranda yalnızca seçtiğiniz kalemin satırları listeleniyor; kaydın diğer kalemleri
                  kendi satırlarından aktarılır.</>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
