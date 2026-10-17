import React, { useEffect, useMemo, useState } from 'react'
import {
  FileText,
  Printer,
  Clock,
  Download,
  MapPin,
  PencilLine,
  X
} from 'lucide-react'

import { useServiceRecordsPaged } from '../hooks/useServiceRecords'
import Table, { type TableColumn } from '../components/Table'
import { apiJson } from '../api/client'
import {
  buildMontajPlanRows,
  COMPLETED_WITH_CANCELLATIONS,
  STATE_COLORS,
  STATE_LABELS,
  statusNameOf,
  type MontajPlanRow
} from '../utils/montajPlanRows'
import { runStatusChange } from '../api/statusChangeGate'
import ServisFisiModal from '../components/ServisFisiModal'
import ServisGecmisiModal from '../components/ServisGecmisiModal'
import { useCanViewHistory, usePermissions } from '../auth/PermissionsContext'
import MemnuniyetAnketiModal, { MemnuniyetHucresi } from '../components/MemnuniyetAnketiModal'
import { printServiceSlip } from '../print/serviceSlip'
import PhoneLinks from '../components/PhoneLinks'
import BayiHucresi from '../components/BayiHucresi'

export default function MontajGecmisiPage() {
  const canViewHistory = useCanViewHistory()
  /*
    MEMNUNİYET SÜTUNU MONTAJ KABUL'ÜN YETKİSİNE BAĞLI (2026-08-25 kullanıcı isteği:
    "montaj kabulde görenler görebilsin").

    Bilerek BU SAYFAYA AİT yeni bir yetki anahtarı açılmadı: anket tek bir veri
    (`ServiceRecord.satisfactionScore`) ve iki ekranda da aynı şeyi gösteriyor. Ayrı anahtar
    açmak, yönetimin iki yerden ayrı ayrı vermesi gereken — ve birini vermeyi unutunca aynı
    bilginin bir ekranda görünüp diğerinde görünmediği — bir durum yaratırdı.
  */
  const { can } = usePermissions()
  const canSeeSatisfaction = can('montajKabul.memnuniyet')
  /*
    Durum düzeltme yetkisi: montaj modülünde zaten durum değiştirebilen kişiler.
    Bu sayfaya AYRI bir anahtar açılmadı — aynı işi iki yerden ayrı ayrı vermek, birini
    vermeyi unutunca "bir ekranda yapabiliyorum diğerinde yapamıyorum" durumu yaratırdı.
  */
  const canEditTaskStatus = can('montajYonetimi.teslimat') || can('montajYonetimi.planlama')
  const [anketKaydi, setAnketKaydi] = useState<any | null>(null)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  /*
    SAYFA BOYU 20 DEĞİL (2026-08-24, kullanıcı bildirimi: "gerçekleştiye çekilenler montaj
    geçmişinde gözükmüyor ama var").

    Bu ekranda SAYFALAMA DÜĞMESİ YOK — yalnızca ilk sayfa çekiliyordu ve 2. sayfaya geçmenin
    hiçbir yolu bulunmuyordu. 20 kaydın dışında kalan her montaj, üstelik üstteki sayaçlar ve
    başlık süzgeçleri de yalnızca yüklü sayfayı kapsadığı için, ekranda HİÇ YOK gibi
    görünüyordu: "0 gerçekleşti" yazıyor, Durum süzgecinde "Gerçekleşti" seçilince liste
    boşalıyordu.

    Sayfa "montajın tam defteri" olduğu için kayıtların tamamı çekiliyor.

    500 ARTIK YETMİYOR (2026-09-18 kullanıcı bildirimi: "gerçekleşti yaptım, montaj komple
    kayboldu"). Defter 569 kayda çıkmıştı; sunucu en YENİ 500'ü verdiği için eski numaralı
    kayıtlar (MNT-0000093) pencerenin dışında kalıyordu. Kayıt duruyordu ama kullanıcı için
    "yok" demekti: kalem gerçekleşince Planlama ve Teslimattakiler'den de düşer (orası doğru),
    geriye yalnız bu ekran kalıyor.

    Üst sınır sunucununki (2000). Yine de yetmediği gün sessizce eksik göstermesin diye
    aşağıdaki uyarı duruyor; üstteki arama kutusu ise sunucuya gidiyor ve pencereye
    bakmaksızın kaydı bulur.
  */
  const [pageSize, setPageSize] = useState(5000)

  // Modals state
  const [gecmisRecordId, setGecmisRecordId] = useState<string | null>(null)
  const [gecmisTaskId, setGecmisTaskId] = useState<string | null>(null)

  /*
    DURUM DÜZELTME — MONTAJ GEÇMİŞİNDEN (2026-08-27 kullanıcı isteği).

    Geçmiş bir DEFTER: buradaki amaç işi yeniden planlamak değil, yanlış işaretlenmiş bir
    satırı düzeltmek. Bu yüzden istek `preserveAssignment: true` ile gidiyor — satırın
    teknisyeni ve planlanan günü SİLİNMİYOR. Teslimattakiler'deki aynı işlem (planlama akışı)
    bunları bilerek siler, orada davranış değişmedi.

    Tarihçe (Activity) zaten SİLİNMEZ, her değişiklik üstüne eklenir; ekrandaki saat
    ikonundan görülebilir.
  */
  const [durumTask, setDurumTask] = useState<any | null>(null)
  const [durumRecord, setDurumRecord] = useState<any | null>(null)
  const [durumValue, setDurumValue] = useState<string>('Completed')
  const [durumNot, setDurumNot] = useState('')
  const [durumSaving, setDurumSaving] = useState(false)
  const [durumError, setDurumError] = useState<string | null>(null)

  /** Sunucu bu iki durumda sebebi ZORUNLU tutuyor; düğme önden kilitlensin. */
  const SEBEP_ZORUNLU = new Set(['Cancelled', 'Unreachable'])

  /** Defterden seçilebilecek durumlar — Kalem İşlemi modalıyla aynı liste, aynı sırayla. */
  const DURUM_SECENEKLERI = [
    'Planned', 'Completed', 'Delivered', 'Unreachable', 'Postponed', 'Deferred', 'Cancelled'
  ]

  const openDurum = (record: any, task: any) => {
    setDurumRecord(record)
    setDurumTask(task)
    setDurumValue(statusNameOf(task))
    setDurumNot('')
    setDurumError(null)
  }

  const saveDurum = async (hedef: string) => {
    if (!durumTask) return
    if (SEBEP_ZORUNLU.has(hedef) && !durumNot.trim()) {
      setDurumError('Bu durum için sebep zorunludur.')
      return
    }
    setDurumValue(hedef)

    setDurumSaving(true)
    setDurumError(null)
    try {
      const taskId = String(durumTask.id ?? durumTask.Id ?? '')
      const eski = statusNameOf(durumTask)
      const done = await runStatusChange(
        {
          kind: 'Montaj Kalemi (Geçmiş Düzeltmesi)',
          subject: durumTask.itemProductName ?? durumTask.ItemProductName ?? durumRecord?.productName ?? 'Montaj kalemi',
          fromLabel: STATE_LABELS[eski] ?? eski,
          toLabel: STATE_LABELS[hedef] ?? hedef,
          hasPhoto: false,
          hasNote: Boolean(durumNot.trim()),
          note: durumNot.trim() || null,
          warning: 'Atanan teknisyen ve planlanan gün KORUNUR; tarihçe silinmez, bu değişiklik de üstüne yazılır.'
        },
        async () => {
          await apiJson(`/api/installations/tasks/${taskId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: hedef,
              // Not YALNIZCA yazıldıysa gönderilir: boş string sunucuda "notu sil" demek ve
              // planlamada girilmiş açıklamayı siler.
              ...(durumNot.trim() ? { reason: durumNot.trim() } : {}),
              // Gönderilmezse sunucu adresi değişmiş sayıp temizliyor.
              customAddress: durumTask.customAddress ?? durumTask.CustomAddress ?? undefined,
              preserveAssignment: true
            })
          })
          return true
        }
      )
      // null = onay ekranında vazgeçildi.
      if (done === null) return

      setDurumTask(null)
      setDurumRecord(null)
      if (expandedRecordId) await loadExpandedTasks(expandedRecordId)
      await refetch()
    } catch (e: any) {
      setDurumError(String(e?.message ?? 'Durum güncellenemedi'))
    } finally {
      setDurumSaving(false)
    }
  }

  const [fisModalOpen, setFisModalOpen] = useState(false)
  const [fisRecord, setFisRecord] = useState<any>(null)
  const [fisItemId, setFisItemId] = useState<string | null>(null)

  // Expansion states
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)
  const [expandedTasks, setExpandedTasks] = useState<any[]>([])
  const [expandedLoading, setExpandedLoading] = useState(false)

  const loadExpandedTasks = async (recordId: string) => {
    setExpandedLoading(true)
    try {
      const data = await apiJson<any[]>(`/api/installations/tasks?serviceId=${recordId}`)
      setExpandedTasks(Array.isArray(data) ? data : [])
    } catch {
      setExpandedTasks([])
    } finally {
      setExpandedLoading(false)
    }
  }

  const toggleExpand = async (row: MontajPlanRow) => {
    if (expandedRow === row.id) {
      setExpandedRow(null)
      setExpandedRecordId(null)
      return
    }
    setExpandedRow(row.id)
    setExpandedRecordId(row.recordId)
    await loadExpandedTasks(row.recordId)
  }

  const tasksOfRow = (row: MontajPlanRow) => {
    if (!row.itemId) return expandedTasks
    return expandedTasks.filter(
      (t: any) => String(t.serviceRecordItemId ?? t.ServiceRecordItemId ?? '') === row.itemId
    )
  }

  /**
   * MONTAJ GEÇMİŞİ = MONTAJIN TAM DEFTERİ (kullanıcı kararı, 2026-08-12).
   *
   * "Montaj girildiği anda montaj geçmişine de satır düşsün, bu sayede ne olup ne olmadığı da
   * direkt görünür." Yani bu ekran artık "bitenlerin arşivi" değil, kabulden kapanışa kadar
   * HER montaj kaleminin tek listede izlendiği yer. Durum sütunu kalemin O ANKİ durumunu
   * söylüyor; iş bittiğinde "Gerçekleşti"ye döner.
   *
   * BU, aynı gün yapılan §8.3 düzeltmesinin bir kısmını BİLEREK geri alıyor: orada "geçmişte
   * yalnızca oraya düşen satırlar görünsün, canlı durum (İşlemde) gösterilmesin" denmişti.
   * Liste artık canlı kalemleri de kapsadığı için canlı durum DOĞRU bilgidir. Eski daraltma
   * kaybolmadı — üstteki "Yalnızca biten / iptal olanlar" anahtarı onu geri getiriyor.
   *
   * `statuses` bu yüzden montaj kaydının alabileceği BÜTÜN durumları içeriyor. `New` en
   * kritiği: yeni girilen montaj kaydı `New` doğar ve eski listede hiç görünmüyordu — "girildiği
   * anda düşsün" isteğinin karşılığı tam olarak bu.
   */
  const { result, isLoading, error, refetch, markAsPrinted, updateSatisfaction } = useServiceRecordsPaged({
    q: q || undefined,
    statuses: 'New,Planned,Workshop,InRepair,WaitingForParts,Ready,Delivered,Cancelled,Delayed',
    type: 'Installation',
    /*
      PASİF KAYITLAR DA GELİR (2026-08-24).

      Sunucu, aksi söylenmedikçe 90 günden eski kayıtları listeden düşürüyor — kabul
      ekranlarında istenen bir sadeleştirme, ama burası "kabulden kapanışa tam defter".
      Defterin eski sayfalarının kendiliğinden silinmesi, bugün yaşanan "kayıt kaybolmuş"
      şikayetinin üç ay sonraki hâli olurdu.
    */
    includePassive: true,
    page,
    pageSize,
  })

  /** Eski davranış (yalnızca bitmiş/iptal kalemler) tek tıkla geri gelsin diye. */
  const [onlyClosed, setOnlyClosed] = useState(false)

  /*
    GERÇEKLEŞME TARİHİ ARALIĞI (2026-10-04 kullanıcı isteği). yyyy-MM-dd, ikisi de isteğe bağlı.
    Satır, en az bir adedi bu aralıkta GERÇEKLEŞMİŞSE görünür; gerçekleşme anı adedin kendi
    `completedAt`'i (geriye dönük işlenen işte seçilen gün). Hiç gerçekleşmemiş ya da iptal
    kalem aralık seçiliyken listeye girmez — soru "bu günlerde ne yapıldı".
  */
  const [doneFrom, setDoneFrom] = useState('')
  const [doneTo, setDoneTo] = useState('')

  // Group / flatten the records into rows matching the installation flat-list logic
  const flatRows = useMemo(() => {
    const rows = buildMontajPlanRows(result.items)
    const processed = rows.map(row => {
      /*
        GEÇEN GÜN ISO DEĞERDEN HESAPLANIR, EKRAN METNİNDEN DEĞİL (2026-09-02 canlı hata).

        `buildMontajPlanRows` iki alan üretiyor: `createdAt` EKRAN METNİ ("02.09.2026",
        `toLocaleDateString('tr-TR')` çıktısı), `createdAtIso` ise ham ISO değer. Burada
        ekran metni kullanılıyordu ve `new Date("02.09.2026")` onu AY.GÜN sırasıyla
        okuyup 9 Şubat sanıyordu: bugün açılan kayıt "205 Gün" görünüyordu.

        205 sayısı tesadüf değil — 9 Şubat ile 2 Eylül arası tam 205 gün.
      */
      const startStr = (row as any).createdAtIso || row.createdAt
      if (!startStr) return { ...row, elapsedDays: 0 }
      const anyRow = row as any
      const isCompleted = 
        row.status === 'Completed' || 
        row.status === 'Delivered' || 
        row.status === 'Cancelled' || 
        anyRow.derivedState === 'Completed' || 
        anyRow.derivedState === 'CompletedWithCancellations' || 
        anyRow.derivedState === 'Cancelled'
      const endStr = isCompleted 
        ? (anyRow.completedAt || anyRow.CompletedAt || anyRow.updatedAt || anyRow.UpdatedAt) 
        : null
      const startDate = new Date(startStr)
      const endDate = endStr ? new Date(endStr) : new Date()
      const diffTime = endDate.getTime() - startDate.getTime()
      const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)))
      return { ...row, elapsedDays: diffDays }
    })
    const closedFiltered = onlyClosed ? processed.filter((row) => row.isCancelled || row.completedQuantity > 0) : processed
    if (!doneFrom && !doneTo) return closedFiltered
    // Yerel gün anahtarı (yyyy-MM-dd); UTC'ye çevrilmez, yoksa +03'te gece yarısı önceki güne kayar.
    const yerelGun = (value?: string | null) => {
      if (!value) return ''
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) return ''
      const iki = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`
    }
    return closedFiltered.filter((row) =>
      (row.tasks ?? []).some((t: any) => {
        if (statusNameOf(t) !== 'Completed') return false
        const gun = yerelGun(t.completedAt ?? t.updatedAt)
        if (!gun) return false
        if (doneFrom && gun < doneFrom) return false
        if (doneTo && gun > doneTo) return false
        return true
      }))
  }, [result.items, onlyClosed, doneFrom, doneTo])

  /** Üstteki sayaç şeridi: "ne olup ne olmadığı" tek bakışta. */
  const summary = useMemo(() => {
    let done = 0
    let cancelled = 0
    let open = 0
    for (const row of flatRows) {
      if (row.isCancelled) cancelled++
      else if (row.completedQuantity >= row.quantity) done++
      else open++
    }
    return { total: flatRows.length, done, cancelled, open }
  }, [flatRows])

  const [filteredRows, setFilteredRows] = useState<MontajPlanRow[]>([])

  // Columns definition matching standard look but with read-only history actions
  const columns = useMemo<TableColumn<MontajPlanRow>[]>(() => {
    return [
      {
        key: 'serviceNumber',
        label: 'Montaj ID',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <div className="flex flex-col">
            <span className="font-extrabold text-[#B91C1C] hover:underline cursor-pointer text-xs" onClick={() => {
              toggleExpand(row)
            }}>
              {row.serviceNumber}
            </span>
            <span className="text-[10px] text-gray-400 mt-0.5">{row.lineLabel}</span>
          </div>
        )
      },
      {
        key: 'elapsedDays' as any,
        label: 'Geçen Gün',
        sortable: true,
        searchable: false,
        render: (_v, row: any) => {
          const diffDays = row.elapsedDays || 0
          let bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200'
          if (diffDays >= 15 && diffDays < 30) {
            bgClass = 'bg-amber-50 text-amber-700 border-amber-200'
          } else if (diffDays >= 30) {
            bgClass = 'bg-rose-50 text-rose-700 border-rose-200 font-bold animate-pulse'
          } else if (diffDays > 5 && diffDays < 15) {
            bgClass = 'bg-emerald-50/70 text-emerald-800 border-emerald-150'
          }
          return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${bgClass}`}>
              {diffDays} Gün
            </span>
          )
        }
      },
      {
        key: 'productName',
        label: 'Ürün',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <div className="max-w-[200px]">
            <div className="text-xs font-semibold text-gray-900 truncate" title={row.productName}>{row.productName}</div>
            <div className="text-[10px] text-gray-400 font-mono mt-0.5">{row.productStockCode}</div>
            {row.serialNumber && (
              <div className="text-[9px] text-slate-500 font-mono mt-0.5 bg-slate-50 border border-slate-100 rounded px-1 w-max">
                SN: {row.serialNumber}
              </div>
            )}
          </div>
        )
      },
      {
        key: 'quantity',
        label: 'Adet',
        render: (_v, row) => {
          // Liste artık canlı kalemleri de kapsıyor; "kaçı bitti / kaç kaldı" bu yüzden tek
          // bakışta okunabilmeli — geçmiş, kabulden kapanışa kadar izlenen defter.
          const done = row.completedQuantity
          const allDone = done >= row.quantity
          return (
            <div className="text-xs font-bold text-gray-900">
              {row.quantity} adet
              <div className={`text-[10px] font-semibold mt-0.5 ${allDone ? 'text-green-700' : done > 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                {done} / {row.quantity} gerçekleşti
              </div>
              {row.isCancelled ? (
                <div className="text-[10px] font-semibold text-red-700">iptal</div>
              ) : !allDone && row.remainingQuantity + row.pendingQuantity > 0 ? (
                <div className="text-[10px] text-gray-400">{row.remainingQuantity + row.pendingQuantity} planlamada</div>
              ) : null}
            </div>
          )
        }
      },
      {
        key: 'state',
        label: 'Durum',
        searchable: true,
        // Süzgeç rozetin yanında yazan tarihi de görsün (2026-09-18).
        filterText: (row) => `${row.stateLabel ?? ''} ${row.state ?? ''} ${row.stateDate ?? ''}`,
        // Liste kabulden kapanışa kadar her kalemi taşıdığı için süzgeç de bütün durumları
        // sunar; "yalnızca bitenler" görünümü üstteki anahtarla alınır.
        filter: {
          type: 'select',
          options: [
            { label: 'Yeni Kayıt', value: 'Deferred' },
            { label: 'Planlandı', value: 'Planned' },
            { label: 'İşlemde', value: 'Mixed' },
            { label: 'Teslim Edildi', value: 'Delivered' },
            { label: 'Ertelendi', value: 'Postponed' },
            { label: 'Ulaşılamadı', value: 'Unreachable' },
            { label: 'Gerçekleşti', value: 'Completed' },
            // İçinde iptal edilmiş kalem olan ama işi biten kayıt: düz "Gerçekleşti"den ayrı süzülebilsin.
            { label: 'Gerçekleşti !', value: COMPLETED_WITH_CANCELLATIONS },
            { label: 'İptal', value: 'Cancelled' }
          ]
        },
        render: (_v, row) => (
          <div className="min-w-0">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${STATE_COLORS[row.state] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
              {row.stateLabel}
            </span>
            {/* DURUM TARİHİ: satır bu duruma ne zaman geçti. Geriye dönük işlenen işte
                seçilen gün yazar — kullanıcı kaydı o güne işlediyse listede de o gün görünür. */}
            {row.stateDate && (
              <div className="text-[10px] font-semibold text-gray-500 mt-0.5">{row.stateDate}</div>
            )}
            {/* İptal sebebi geçmişin asıl bilgisi: "neden yapılmadı" sorusunun cevabı burada.
                Kalemde duruyordu ama hiçbir listede gösterilmiyordu. */}
            {row.isCancelled && row.cancelReason && (
              <div className="text-[10px] text-red-700 mt-0.5 max-w-[200px] truncate" title={row.cancelReason}>
                {row.cancelReason}
              </div>
            )}
          </div>
        )
      },
      {
        key: 'customerName',
        label: 'Müşteri',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <div className="max-w-[180px]">
            <div className="text-xs font-semibold text-gray-900 truncate" title={row.customerName}>{row.customerName}</div>
            <div className="text-[10px] text-gray-500"><PhoneLinks phone={row.customerPhone} compact /></div>
          </div>
        )
      },
      {
        key: 'address',
        label: 'Adres',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <span className="text-[11px] text-gray-700 block max-w-[220px] truncate" title={row.address}>
            {row.address}
          </span>
        )
      },
      {
        key: 'regionName',
        label: 'Bölge',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <span className="text-xs font-semibold text-gray-900">{row.regionName}</span>
        )
      },
      /* PLANLANAN GUN ve ATANAN PERSONEL AYRI (2026-08-25) — gerekcesi Montaj Planlama
         sayfasindakiyle ayni: tek sutunda birlesikken tarihe gore SUZULEMIYOR ve
         siralanamiyordu. Bu defter sayfasinda "su gun kim ne yapmis" en cok sorulan sorulardan
         biri; iki alan ayri olmadan cevaplanamiyordu. */
      {
        key: 'plannedDates',
        label: 'Planlanan Gün',
        sortable: true,
        searchable: true,
        filter: { type: 'date' },
        render: (_v, row) => {
          if (!row.plannedDates) return <span className="text-gray-400 font-medium">-</span>
          const gunler = row.plannedDates.split(',').map((g) => g.trim()).filter(Boolean)
          return (
            <div className="max-w-[130px]">
              <span className="text-xs text-gray-900 font-semibold">{gunler[0]}</span>
              {gunler.length > 1 && (
                <span className="ml-1 text-[10px] text-gray-500 font-semibold" title={gunler.join(', ')}>
                  +{gunler.length - 1}
                </span>
              )}
            </div>
          )
        }
      },
      {
        key: 'technicianNames',
        label: 'Atanan Personel',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => {
          if (!row.technicianNames) return <span className="text-gray-400 font-medium">-</span>
          return (
            <div className="flex items-center gap-1.5 max-w-[200px]">
              <span className="w-2 h-2 rounded-full bg-[#B91C1C] shadow-2xs shrink-0" />
              <span className="text-xs font-semibold text-gray-900 truncate" title={row.technicianNames}>{row.technicianNames}</span>
            </div>
          )
        }
      },
      ...(canSeeSatisfaction ? [{
        key: 'satisfactionScore' as any,
        label: 'Memnuniyet',
        searchable: true,
        filter: {
          type: 'select' as const,
          options: [
            { label: 'Değerlendirilmemiş', value: '0' },
            { label: 'Ulaşılamadı', value: '-1' },
            { label: '1 Yıldız', value: '1' },
            { label: '2 Yıldız', value: '2' },
            { label: '3 Yıldız', value: '3' },
            { label: '4 Yıldız', value: '4' },
            { label: '5 Yıldız', value: '5' }
          ]
        },
        render: (_v: any, row: MontajPlanRow) => (
          <MemnuniyetHucresi
            score={row.satisfactionScore}
            notes={(row.record as any)?.satisfactionNotes}
            by={(row.record as any)?.satisfactionBy}
            onClick={() => setAnketKaydi(row.record)}
          />
        )
      } as TableColumn<MontajPlanRow>] : []),
      {
        key: 'customerType',
        label: 'Müşteri Tipi',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Bayi', value: 'Bayi' },
            { label: 'Mağaza', value: 'Mağaza' },
            { label: 'Müşteri', value: 'Müşteri' }
          ]
        },
        render: (_v, row) => {
          const badgeColor =
            row.customerType === 'Bayi'
              ? 'bg-blue-100 text-blue-800 border-blue-200 font-bold'
              : row.customerType === 'Mağaza'
              ? 'bg-purple-100 text-purple-800 border-purple-200 font-bold'
              : 'bg-emerald-100 text-emerald-800 border-emerald-200 font-bold'
          return (
            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] uppercase border ${badgeColor}`}>
              {row.customerType}
            </span>
          )
        }
      },
      {
        key: 'invoiceNo',
        label: 'Fatura No',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <span className="text-[11px] text-gray-500 font-semibold">{row.invoiceNo}</span>
        )
      },
      {
        key: 'dealerName',
        label: 'Bayi',
        searchable: true,
        filter: { type: 'text' },
        // Tek biçim + adı olmayan kaydı işaretleme: bkz. `utils/bayiEtiketi.ts`.
        render: (_v, row) => (
          <span className="block max-w-[150px]">
            <BayiHucresi dealerName={row.dealerName} dealerCode={(row as any).dealerCode} />
          </span>
        )
      },
      {
        key: 'createdAt',
        label: 'Kayıt Tarihi',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <span className="text-xs text-gray-600 font-semibold">{row.createdAt}</span>
        )
      }
    ]
  }, [canSeeSatisfaction])

  // Listen for StilsoftShell export event
  useEffect(() => {
    const handleExport = () => {
      // Simplistic CSV export logic
      if (filteredRows.length === 0) return
      // Başlıklar tabloyla aynı ayrımı izler: planlanan gün ve atanan personel ayrı sütun.
      const headers = ['Montaj ID', 'Ürün', 'Adet', 'Müşteri', 'Adres', 'Bölge', 'Planlanan Gün', 'Atanan Personel', 'Durum', 'Fatura No', 'Bayi', 'Kayıt Tarihi', 'Memnuniyet']
      const rows = filteredRows.map(r => [
        r.serviceNumber,
        r.productName,
        r.quantity,
        r.customerName,
        r.address,
        r.regionName,
        r.plannedDates,
        r.technicianNames,
        r.stateLabel,
        r.invoiceNo,
        r.dealerName,
        r.createdAt,
        r.satisfactionScore > 0 ? r.satisfactionScore : ''
      ])

      const content = [headers.join(';'), ...rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n')
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), content], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `montaj-gecmisi-${new Date().toISOString().slice(0,10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }

    window.addEventListener('shell:montaj-yonetimi-export', handleExport)
    return () => window.removeEventListener('shell:montaj-yonetimi-export', handleExport)
  }, [filteredRows])

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-4">
      {/* Search Header Bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col sm:flex-row sm:flex-wrap items-center gap-3">
        <div className="relative flex-1 w-full sm:min-w-[260px]">
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
            placeholder="Ara: müşteri, telefon, ürün, fatura no..."
            className="w-full pl-3 pr-10 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#B91C1C] focus:border-[#B91C1C]"
          />
          {q && (
            <button
              onClick={() => { setQ(''); setPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm font-semibold"
            >
              Temizle
            </button>
          )}
        </div>
        {/* Gerçekleşme tarihi aralığı — arama ile "Yalnızca biten / iptal" anahtarı arasında. */}
        <div className="w-full sm:w-auto flex items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200 bg-slate-50 whitespace-nowrap">
          <span className="text-xs font-bold text-gray-700">Gerçekleşme</span>
          <input
            type="date"
            value={doneFrom}
            max={doneTo || undefined}
            onChange={(e) => setDoneFrom(e.target.value)}
            title="Gerçekleşme tarihi — başlangıç"
            className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[#B91C1C] focus:border-[#B91C1C]"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="date"
            value={doneTo}
            min={doneFrom || undefined}
            onChange={(e) => setDoneTo(e.target.value)}
            title="Gerçekleşme tarihi — bitiş"
            className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[#B91C1C] focus:border-[#B91C1C]"
          />
          {(doneFrom || doneTo) && (
            <button
              type="button"
              onClick={() => { setDoneFrom(''); setDoneTo('') }}
              className="text-xs font-semibold text-gray-400 hover:text-gray-600"
            >
              Temizle
            </button>
          )}
        </div>
        {/* Eski görünüm (yalnızca bitmiş/iptal kalemler) kaybolmadı, bir anahtarın arkasında. */}
        <label className="w-full sm:w-auto flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-slate-50 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={onlyClosed}
            onChange={(e) => setOnlyClosed(e.target.checked)}
            className="rounded border-gray-300 text-[#B91C1C] focus:ring-[#B91C1C]"
          />
          <span className="text-xs font-bold text-gray-700">Yalnızca biten / iptal olanlar</span>
        </label>
        {filteredRows.length > 0 && (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('shell:montaj-yonetimi-export'))}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer active:scale-95"
          >
            <Download className="w-4 h-4" />
            Excel Aktar
          </button>
        )}
      </div>

      {/* "Ne olup ne olmadığı" tek bakışta: liste artık kabulden kapanışa kadar her kalemi
          taşıdığı için sayaçlar olmadan hangi aşamada ne kaldığı görünmüyordu. */}
      {/*
        EKSİK YÜKLEME SESSİZ KALMAZ.

        Sayaçlar ve başlık süzgeçleri yalnızca YÜKLÜ kayıtları görüyor. Kayıt sayısı sayfa
        boyunu aşarsa ekrandaki rakamlar defterin tamamını değil bir bölümünü anlatır —
        kullanıcı bunu bilmeden "kayıt kaybolmuş" sonucuna varıyordu.
      */}
      {!isLoading && !error && result.totalCount > result.items.length && (
        <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
          {result.totalCount} kaydın {result.items.length} tanesi yüklendi. Aşağıdaki sayaçlar ve
          süzgeçler yalnızca yüklenen kayıtları kapsıyor.
        </div>
      )}

      {!isLoading && !error && flatRows.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
            Toplam {summary.total} kalem
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-green-100 text-green-800 border border-green-200">
            {summary.done} gerçekleşti
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 border border-amber-200">
            {summary.open} devam ediyor
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-red-100 text-red-800 border border-red-200">
            {summary.cancelled} iptal
          </span>
        </div>
      )}

      {/* Main Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-visible relative">
        {error ? (
          <div className="py-8 text-center text-sm text-red-650">{error}</div>
        ) : isLoading && flatRows.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Yükleniyor...</div>
        ) : flatRows.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Kayıt bulunamadı.</div>
        ) : (
          <Table
            columns={columns}
            data={flatRows}
            showColumnFilters
            serverSide={false}
            onFilteredDataChange={setFilteredRows}
            rowKey={(r) => r.id}
            isRowExpanded={(r) => expandedRow === r.id}
            onToggleRowExpanded={(r) => toggleExpand(r)}
            renderExpandedRow={(row) => {
              const record = row.record
              // Kalemin BÜTÜN adet satırları — yalnızca gerçekleşen/iptal olanlar değil.
              // Geçmiş artık kabulden kapanışa kadar izlenen defter; "ne olup ne olmadığı"
              // sorusunun yanıtı, henüz yapılmamış satırların da burada görünmesidir.
              const displayTasks = tasksOfRow(row)
              return (
                <div className="bg-gray-50 p-4 shadow-inner">
                  <div className="mb-2 font-semibold text-gray-700 text-sm flex items-center justify-between">
                    <span>Montaj Satır Detayları — {row.productName}</span>
                    <span className="text-xs font-normal text-gray-400">Her satır 1 adet; durumu ayrı ilerler.</span>
                  </div>
                  {expandedLoading ? (
                    <div className="text-xs text-gray-500 py-3 flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                      Görevler yükleniyor...
                    </div>
                  ) : (
                    (() => {
                      if (displayTasks.length === 0) {
                        return <div className="text-xs text-gray-500 py-2">Bu kalem için planlama satırı bulunamadı.</div>
                      }
                      return (
                        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                          <table className="w-full text-xs mobile-stack">
                            <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wider text-gray-500 font-bold border-b border-gray-200">
                              <tr>
                                <th className="px-3 py-2">Sıra</th>
                                <th className="px-3 py-2">Bölge</th>
                                <th className="px-3 py-2">Müşteri</th>
                                <th className="px-3 py-2">Telefon</th>
                                <th className="px-3 py-2">Atanan Teknisyen</th>
                                <th className="px-3 py-2">Tarih</th>
                                <th className="px-3 py-2">Durum</th>
                                <th className="px-3 py-2">Atama Adresi</th>
                                <th className="px-3 py-2">Not / Açıklama</th>
                                <th className="px-3 py-2 text-right">İşlem</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {displayTasks.map((t: any, idx: number) => {
                                // Etiket ve renk TEK KAYNAKTAN (`STATE_LABELS`) gelir.
                                // Buraya sunucunun `statusLabel` metni basılıyordu ve orada
                                // "Tamamlandı" yazıyordu; ayrıca rozet her satırda yeşildi, iptal
                                // satırı bile "gerçekleşmiş" gibi görünüyordu (§8.3).
                                const s = statusNameOf(t)
                                const sl = STATE_LABELS[s] ?? s
                                const tname = t.technicianName ?? t.TechnicianName
                                const taddr = t.customAddress ?? t.CustomAddress ?? ''
                                const hasAddress = !!taddr
                                const hasTech = !!tname

                                return (
                                  <tr key={t.id || t.Id || idx} className="hover:bg-gray-50/50 transition-colors">
                                    <td data-mobile-hide data-label="Sıra" className="px-3 py-2 text-gray-500 font-mono font-bold">#{idx + 1}</td>
                                    <td data-label="Bölge" className="px-3 py-2 text-gray-700">
                                      {t.regionName ?? t.RegionName ?? record?.regionName ?? <span className="text-gray-300 italic">-</span>}
                                    </td>
                                    <td data-label="Müşteri" className="px-3 py-2 text-gray-700 max-w-[150px] truncate" title={t.itemCustomerName ?? t.ItemCustomerName ?? record?.customerName ?? ''}>
                                      {t.itemCustomerName ?? t.ItemCustomerName ?? record?.customerName ?? <span className="text-gray-300 italic">-</span>}
                                    </td>
                                    <td data-mobile-hide data-label="Telefon" className="px-3 py-2 text-gray-600 whitespace-nowrap">
                                      {(t.itemCustomerPhone ?? t.ItemCustomerPhone ?? record?.customerPhone)
                                        ? <PhoneLinks phone={t.itemCustomerPhone ?? t.ItemCustomerPhone ?? record?.customerPhone} compact />
                                        : <span className="text-gray-300 italic">-</span>}
                                    </td>
                                    <td data-label="Atanan Teknisyen" className="px-3 py-2">
                                      {hasTech ? (
                                        <div className="flex items-center gap-1.5">
                                          <div className="w-5 h-5 rounded-full bg-blue-50 flex items-center justify-center text-[9px] font-bold text-blue-700 flex-shrink-0">
                                            {tname.split(' ').filter(Boolean).slice(0, 2).map((n: string) => n[0]).join('')}
                                          </div>
                                          <span className="font-semibold text-gray-900 text-xs">{tname}</span>
                                        </div>
                                      ) : (
                                        <span className="text-gray-400 italic">Atanmadı</span>
                                      )}
                                    </td>
                                    <td data-mobile-hide data-label="Tarih" className="px-3 py-2 text-gray-600">{(t.plannedAt || t.plannedDate) ? new Date(t.plannedAt || t.plannedDate).toLocaleDateString('tr-TR') : '-'}</td>
                                    <td data-label="Durum" className="px-3 py-2">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${STATE_COLORS[s] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                                        {sl}
                                      </span>
                                    </td>
                                    <td data-label="Atama Adresi" className="px-3 py-2 max-w-[220px]">
                                      {hasAddress ? (
                                        <div className="flex items-start gap-1">
                                          <MapPin className="w-3.5 h-3.5 mt-0.5 text-orange-500 flex-shrink-0" />
                                          <span className="text-orange-700 font-medium text-[11px] leading-tight block truncate" title={taddr}>{taddr}</span>
                                        </div>
                                      ) : (
                                        <span className="text-gray-300 text-[10px] italic">Belirtilmedi</span>
                                      )}
                                    </td>
                                    <td data-mobile-hide data-label="Not / Açıklama" className="px-3 py-2 text-gray-600 font-medium max-w-[200px] truncate" title={row.notes || ''}>{row.notes || '-'}</td>
                                    <td data-mobile-hide data-label="İşlem" className="px-3 py-2 text-right">
                                      {canViewHistory && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setGecmisRecordId(record.id)
                                            setGecmisTaskId(String(t.id ?? t.Id ?? ''))
                                          }}
                                          className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-full transition-colors cursor-pointer"
                                          title="Tarihçeyi Gör"
                                        >
                                          <Clock className="w-4 h-4" />
                                        </button>
                                      )}
                                      {canEditTaskStatus && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            openDurum(record, t)
                                          }}
                                          className="p-1 ml-1 text-gray-500 hover:text-[#B91C1C] hover:bg-red-50 rounded-full transition-colors cursor-pointer"
                                          title="Durumu Düzelt"
                                        >
                                          <PencilLine className="w-4 h-4" />
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()
                  )}
                </div>
              )
            }}
          />
        )}
      </div>

      {durumTask && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => { if (!durumSaving) { setDurumTask(null); setDurumRecord(null) } }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl pointer-events-auto overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-gray-900">Durumu Düzelt</h3>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {durumTask.itemProductName ?? durumTask.ItemProductName ?? durumRecord?.productName ?? 'Montaj kalemi'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { if (!durumSaving) { setDurumTask(null); setDurumRecord(null) } }}
                  className="p-1.5 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="rounded-lg bg-gray-50 px-3 py-2.5 text-[11px] text-gray-600 leading-relaxed">
                  Atanan teknisyen ve planlanan gün <strong>korunur</strong>. Tarihçe silinmez —
                  bu değişiklik de üstüne yazılır.
                </div>

                {/*
                  Durum açılır liste DEĞİL, her durum ayrı renkli düğme — Kalem İşlemi
                  ekranıyla aynı kurgu (2026-08-27 kullanıcı isteği). Basınca doğrudan uygulanır;
                  ayrı bir "kaydet" adımı yok.

                  Renkler `STATE_COLORS`'tan, yani tablodaki rozetlerle aynı kaynaktan geliyor.
                */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Not / Sebep</div>
                  <textarea
                    value={durumNot}
                    disabled={durumSaving}
                    onChange={(e) => { setDurumNot(e.target.value); setDurumError(null) }}
                    rows={3}
                    placeholder="Boş bırakılırsa satırın mevcut notuna DOKUNULMAZ. İptal / Ulaşılamadı için zorunlu."
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 w-full"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-gray-500">Durum — basınca doğrudan uygulanır</div>
                  <div className="grid grid-cols-2 gap-2">
                    {DURUM_SECENEKLERI.map((v) => {
                      const kilitli = SEBEP_ZORUNLU.has(v) && !durumNot.trim()
                      const mevcut = statusNameOf(durumTask) === v
                      const renk = STATE_COLORS[v] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                      return (
                        <button
                          key={v}
                          type="button"
                          disabled={durumSaving || kilitli}
                          title={kilitli ? 'Bu durum için önce not/sebep yazın' : undefined}
                          onClick={() => saveDurum(v)}
                          className={
                            'px-3 py-2.5 rounded-xl text-xs font-bold border text-left leading-tight transition ' +
                            (durumSaving || kilitli
                              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                              : `${renk} hover:brightness-95 cursor-pointer`) +
                            (mevcut ? ' ring-2 ring-offset-1 ring-gray-400' : '')
                          }
                        >
                          {STATE_LABELS[v] ?? v}
                          {mevcut && <span className="block text-[9px] font-semibold opacity-70 mt-0.5">şu anki durum</span>}
                          {kilitli && <span className="block text-[9px] font-semibold mt-0.5">sebep gerekli</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {durumError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] font-semibold text-red-700">
                    {durumError}
                  </div>
                )}

                {durumSaving && (
                  <div className="text-[11px] font-semibold text-gray-500">Kaydediliyor…</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modals & Detail Components */}
      <ServisGecmisiModal
        recordId={gecmisRecordId}
        taskId={gecmisTaskId}
        onClose={() => { setGecmisRecordId(null); setGecmisTaskId(null); }}
      />

      <ServisFisiModal
        isOpen={fisModalOpen}
        record={fisRecord}
        itemId={fisItemId}
        onClose={() => { setFisModalOpen(false); setFisItemId(null); }}
        onMarkPrinted={markAsPrinted}
        onPrint={(rec, tasks) => {
          printServiceSlip(rec, tasks)
        }}
        onChanged={refetch}
      />

      {/* Anket, Montaj Kabul'dekiyle AYNI bileşen ve aynı uç — iki ekranın puanı ayrışmasın. */}
      <MemnuniyetAnketiModal
        kayit={anketKaydi}
        onClose={() => setAnketKaydi(null)}
        kaydet={(id, puan, not) => updateSatisfaction(id, puan, not)}
        onSaved={() => refetch(true)}
      />
    </div>
  )
}
