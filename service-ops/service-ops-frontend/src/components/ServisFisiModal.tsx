import { useEffect, useState } from 'react'
import { Download, Info, Plus, RefreshCw, X } from 'lucide-react'
import { apiJson } from '../api/client'

/**
 * Servis fişi (iş emri) ekranı. Önce Montaj Kabul sayfasındaydı; fiş artık Montaj
 * Yönetimi'nden basılıyor ve basılmadan kayıt sahaya aktarılamıyor.
 */

type Props = {
  isOpen: boolean
  record: any | null
  itemId?: string | null
  onClose: () => void
  /**
   * Fiş basıldığında damgayı atar.
   *
   * `itemId` BASILAN KALEMİ söyler ve damga oraya düşer; verilmezse yalnızca kaydın geneli
   * damgalanır. Fiş en baştan beri kalem bazlı basılıyordu, damga değildi — bir kalemin
   * fişini basmak faturanın bütün kalemlerini "basıldı" gösteriyordu (2026-09-09).
   */
  onMarkPrinted: (recordId: string, itemId?: string | null) => Promise<unknown>
  /** Basma önizlemesini açar. */
  onPrint: (record: any, tasks: any[]) => void
  /** Liste tazelemesi. */
  onChanged?: () => Promise<unknown> | void
}

/**
 * FİŞE GİRECEK SATIRLAR — tek kaynak.
 *
 * Hem bu modal hem Sahaya Aktar'daki "yerinde yazdır" aynı listeyi basmak zorunda; kural iki
 * yere ayrı yazılsaydı biri güncellenip diğeri unutulduğunda aynı kayıt iki farklı fiş üretirdi.
 *
 * İptal ve GERÇEKLEŞEN satırlar dışarıda: fiş "teknisyen bugün ne götürecek" belgesidir,
 * yapılmış iş çıktıya girince adetler şişiyor ve saha bitmiş montajı yeniden yapılacak sanıyordu
 * (MONTAJ-DEVIR §8.5).
 */
export function slipTasks(tasks: any[], itemId?: string | null) {
  return (Array.isArray(tasks) ? tasks : []).filter((task) => {
    const s = task.Status ?? task.status
    if (s === 3 || s === 'Cancelled') return false
    if (s === 2 || s === 'Completed') return false
    if (itemId) {
      const taskItemId = task.serviceRecordItemId || task.ServiceRecordItemId
      return taskItemId === itemId
    }
    return true
  })
}

/** Aynı teknisyen + aynı gün olan görevleri tek satırda toplar. */
export function groupTasks(tasks: any[], clickedItemId?: string | null) {
  const groups: Record<string, any> = {}

  for (const t of tasks) {
    const techId = t.assignedTechnicianId || t.AssignedTechnicianId || 'unassigned'
    const dateStr = (t.plannedAt || t.PlannedAt || '').split('T')[0] || 'nodate'
    // Group by technician, date AND item (if no specific item is filtered, or if we want them separated by item)
    const taskItemId = t.serviceRecordItemId || t.ServiceRecordItemId || 'noitem'
    const key = `${techId}_${dateStr}_${taskItemId}`

    if (!groups[key]) {
      groups[key] = {
        id: t.id || t.Id,
        /*
          KALEM KİMLİĞİ FİŞE TAŞINIR (2026-09-02 canlı hata).

          Fiş müşteri adını, adresini ve telefonunu KAYITTAN okuyordu. Oysa bir montaj
          kaydının kalemleri FARKLI adreslere gidebiliyor (`ServiceRecordItem.customerAddress`)
          ve liste bunu doğru gösteriyordu. Sonuç: iki ayrı kalem için basılan iki fişte
          aynı adres çıkıyor, teknisyen yanlış eve gidiyordu.

          Adres görevin üstünde DEĞİL, kaydın kaleminde duruyor; fişin doğru kalemi
          bulabilmesi için kimliği buradan geçmek zorunda.
        */
        serviceRecordItemId: t.serviceRecordItemId || t.ServiceRecordItemId || null,
        // Kalemin kendi musteri bilgileri de tasinir; grup YENI bir nesne kurdugu icin
        // acikca kopyalanmazsa fise hic ulasmiyor.
        itemCustomerName: t.itemCustomerName || t.ItemCustomerName || null,
        itemCustomerPhone: t.itemCustomerPhone || t.ItemCustomerPhone || null,
        itemCustomerAddress: t.itemCustomerAddress || t.ItemCustomerAddress || t.customAddress || t.CustomAddress || null,
        assignedTechnicianId: t.assignedTechnicianId || t.AssignedTechnicianId || null,
        AssignedTechnicianId: t.assignedTechnicianId || t.AssignedTechnicianId || null,
        technicianName: t.technicianName || t.TechnicianName || null,
        TechnicianName: t.technicianName || t.TechnicianName || null,
        plannedAt: t.plannedAt || t.PlannedAt || null,
        PlannedAt: t.plannedAt || t.PlannedAt || null,
        quantity: 0,
        Quantity: 0,
        itemNames: [] as string[],
        // Fişe basılacak satırlar: ürün ADI + O FİŞTE GÖTÜRÜLEN adet. Yalnızca `itemNames`
        // tutmak yetmiyordu — fiş, kaydın bütün kalemlerini ve kabul adetlerini basıyordu.
        items: [] as Array<{ productName: string; quantity: number }>,
        notesList: [] as string[],
        taskIds: [] as string[],
      }
    }

    const qty = t.quantity || t.Quantity || 1
    groups[key].quantity += qty
    groups[key].Quantity += qty
    groups[key].taskIds.push(t.id || t.Id)

    const itemName = t.itemProductName || t.ItemProductName
    if (itemName && !groups[key].itemNames.includes(itemName)) {
      groups[key].itemNames.push(itemName)
    }
    if (itemName) {
      const line = groups[key].items.find((x: any) => x.productName === itemName)
      if (line) line.quantity += qty
      else groups[key].items.push({ productName: itemName, quantity: qty })
    }

    const note = t.notes || t.Notes
    if (note && note.trim()) groups[key].notesList.push(note.trim())
  }

  return Object.values(groups).map((g: any) => ({
    ...g,
    notes: Array.from(new Set(g.notesList)).join(', '),
    Notes: Array.from(new Set(g.notesList)).join(', '),
  }))
}

/**
 * Planlama grubuna (teknisyen + gün) ait iş emrini bulur.
 *
 * Eşleşme kuralı TEK yerde: hem bu modal hem "Fiş Yazdır" düğmelerinin arkasındaki
 * `ensureWorkOrders` aynı kuralı kullanmak zorunda; ayrışırsa biri fişi "var" görüp öbürü
 * ikinci kez oluşturur.
 *
 * Teknisyen boşken iki taraf da `null`'a indirgenir. Eskiden iş emri tarafı `undefined`,
 * görev tarafı `null` kalıyordu: "personel atamadan planla" satırlarının fişi HİÇ eşleşmiyor,
 * ekran her seferinde "Servis Fişi Oluştur" gösterip yeni iş emri açtırıyordu (2026-09-17).
 */
export function findWorkOrderForGroup(workOrders: any[], task: any) {
  const taskTechId = task?.assignedTechnicianId || task?.AssignedTechnicianId || null
  const taskDay = String(task?.plannedAt || task?.PlannedAt || '').split('T')[0]
  return (Array.isArray(workOrders) ? workOrders : []).find((wo) => {
    if (!wo) return false
    const woTechId = wo.technicianId || wo.TechnicianId || null
    const woDay = String(wo.scheduledDate || wo.ScheduledDate || '').split('T')[0]
    return woTechId === taskTechId && woDay === taskDay
  }) ?? null
}

export function workOrderDescription(record: any, task: any) {
  const itemNames: string[] = task?.itemNames ?? []
  const productLabel = itemNames.length > 0 ? itemNames.join(', ') : record?.productName
  return `Montaj: ${productLabel} (Miktar: ${task?.quantity || task?.Quantity || 1})`
}

/**
 * BASILACAK HER GRUBUN İŞ EMRİ OLSUN — yoksa açılır (2026-09-17 canlı hata).
 *
 * Planlama ve Sahaya Aktar ekranlarındaki "Fiş Yazdır" fişi basıp damgayı atıyordu ama İŞ EMRİ
 * açmıyordu. Sahaya aktarım ise hem damgayı hem iş emrini arıyor (sunucu:
 * `ServiceRecordService.UpdateStatusAsync`). Sonuç: planla → yazdır → aktar dendiğinde
 * "Servis fişi henüz oluşturulmadı" çıkıyor, kullanıcı Servis Fişleri ekranına gidip AYNI fişi
 * bir daha oluşturup bir daha basıyordu.
 *
 * Var olan iş emrine dokunulmaz; yalnızca eksik gruplar için açılır. Bu yüzden iki kez
 * çağrılması zararsız.
 */
export async function ensureWorkOrders(record: any, groups: any[]) {
  if (!record?.id || !Array.isArray(groups) || groups.length === 0) return 0
  const existing = await apiJson<any[]>(`/api/workorders?serviceId=${record.id}`)
  const known: any[] = Array.isArray(existing) ? [...existing] : []
  let created = 0
  for (const group of groups) {
    if (findWorkOrderForGroup(known, group)) continue
    const technicianId = group.assignedTechnicianId || group.AssignedTechnicianId || null
    const scheduledDate = group.plannedAt || group.PlannedAt || null
    await apiJson('/api/workorders', {
      method: 'POST',
      body: JSON.stringify({
        serviceId: record.id,
        technicianId,
        scheduledDate,
        description: workOrderDescription(record, group),
      }),
    })
    // Aynı çağrıda aynı teknisyen+gün ikinci kez gelirse yeniden açılmasın.
    known.push({ technicianId, scheduledDate })
    created += 1
  }
  return created
}

export default function ServisFisiModal({ isOpen, record, itemId, onClose, onMarkPrinted, onPrint, onChanged }: Props) {
  const [tasks, setTasks] = useState<any[]>([])
  const [workOrders, setWorkOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !record?.id) return
    let active = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [taskData, woData] = await Promise.all([
          apiJson<any[]>(`/api/installations/tasks?serviceId=${record.id}`),
          apiJson<any[]>(`/api/workorders?serviceId=${record.id}`),
        ])
        if (!active) return
        setTasks(taskData || [])
        setWorkOrders(woData || [])
      } catch (err: any) {
        if (active) setError('Planlama ve servis fişleri yüklenemedi: ' + (err?.message || err))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [isOpen, record?.id])

  const reloadWorkOrders = async () => {
    if (!record?.id) return
    const wos = await apiJson<any[]>(`/api/workorders?serviceId=${record.id}`)
    setWorkOrders(wos || [])
  }

  const buildDescription = (task: any) => workOrderDescription(record, task)

  const createWorkOrder = async (task: any) => {
    if (!record?.id) return
    setLoading(true)
    setError(null)
    try {
      await apiJson('/api/workorders', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: record.id,
          technicianId: task.assignedTechnicianId || task.AssignedTechnicianId,
          scheduledDate: task.plannedAt || task.PlannedAt,
          description: buildDescription(task),
        }),
      })
      await reloadWorkOrders()
      await onChanged?.()
    } catch (err: any) {
      setError('Servis fişi oluşturulamadı: ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }

  const recreateWorkOrder = async (workOrderId: string, task: any) => {
    if (!record?.id) return
    if (!window.confirm('Bu servis fişini silip güncel planlama detaylarına göre yeniden oluşturmak istediğinize emin misiniz?')) return

    setLoading(true)
    setError(null)
    try {
      try {
        await apiJson(`/api/workorders/${workOrderId}`, { method: 'DELETE' })
      } catch (deleteErr: any) {
        const msg = String(deleteErr?.message || deleteErr || '')
        const is404 = msg.includes('404') || msg.toLowerCase().includes('not found')
        if (!is404) throw deleteErr
      }

      await apiJson('/api/workorders', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: record.id,
          technicianId: task.assignedTechnicianId || task.AssignedTechnicianId,
          scheduledDate: task.plannedAt || task.PlannedAt,
          description: buildDescription(task),
        }),
      })
      await reloadWorkOrders()
      await onChanged?.()
    } catch (err: any) {
      setError('İşlem başarısız: ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }

  const printWorkOrder = async (task: any) => {
    if (!record?.id) return
    // Damga hangi kaleme düşecek: ekran bir kaleme odaklıysa o, değilse basılan SATIRIN kendi
    // kalemi. İkisi de yoksa (kalem kavramından önceki kayıtlar) damga kayıt geneline düşer.
    const stampItemId = itemId ?? task?.serviceRecordItemId ?? task?.ServiceRecordItemId ?? null
    try {
      await onMarkPrinted(record.id, stampItemId)
      await onChanged?.()
    } catch (err) {
      console.error('[ServisFisiModal] Basıldı işaretlenemedi:', err)
    }
    onPrint(record, [task])
  }

  if (!isOpen || !record) return null

  const activeTasks = slipTasks(tasks, itemId)
  const grouped = groupTasks(activeTasks, itemId)

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className="p-5 border-b border-gray-150 flex items-center justify-between bg-purple-50/30">
            <div>
              <div className="text-lg font-bold text-gray-950 flex items-center gap-2">
                <span className="text-purple-700 font-extrabold font-mono">{record.serviceNumber}</span>
                <span>- Servis Fişleri (İş Emirleri)</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">Müşteri: {record.customerName} | Ürün: {record.productName}</div>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1 space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs font-semibold text-red-600">{error}</div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 space-y-3">
                <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                <div className="text-sm text-gray-500 font-semibold font-sans">Servis fişleri yükleniyor...</div>
              </div>
            ) : (
              <>
                <div className="bg-purple-50 border border-purple-150 rounded-xl p-4 flex items-start gap-3">
                  <Info className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-purple-800 leading-relaxed font-sans">
                    Her planlama satırı için servis fişini burada oluşturup basarsınız. <strong>Fiş basılmadan montaj sahaya aktarılamaz.</strong>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-bold text-gray-700 uppercase tracking-wider font-sans">Planlanan Görevler ve Servis Fişi Durumları</div>

                  {grouped.length === 0 ? (
                    <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-200 rounded-xl font-sans">
                      Henüz bu montaj kaydı için planlanmış bir görev satırı bulunmamaktadır.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {grouped.map((task: any, idx: number) => {
                        const matchingWo = findWorkOrderForGroup(workOrders, task)

                        return (
                          <div key={task.id || idx} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 bg-gray-50 hover:bg-gray-100/50 rounded-xl border border-gray-155 gap-3 transition-colors">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-gray-500">#{idx + 1}</span>
                                <span className="text-sm font-bold text-gray-950 font-sans">{task.technicianName || task.TechnicianName || 'Teknisyen Atanmadı'}</span>
                                <span className="text-xs text-gray-500 font-sans">({task.quantity || task.Quantity} Adet)</span>
                              </div>
                              {task.itemNames?.length > 0 && (
                                <div className="text-[11px] text-gray-600 font-sans">Kalem: {task.itemNames.join(', ')}</div>
                              )}
                              <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-1 font-sans">
                                <span>Tarih: {task.plannedAt ? new Date(task.plannedAt).toLocaleDateString('tr-TR') : '-'}</span>
                                {task.notes && (
                                  <>
                                    <span>•</span>
                                    <span className="italic">Not: {task.notes}</span>
                                  </>
                                )}
                              </div>
                              {matchingWo && (
                                <div className="text-[10px] font-mono font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-100 w-fit">
                                  Fiş No: {matchingWo.workOrderNumber} ({matchingWo.statusLabel || matchingWo.Status})
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              {matchingWo ? (
                                <>
                                  <button
                                    onClick={() => printWorkOrder(task)}
                                    className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer font-sans"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    Yazdır / PDF
                                  </button>
                                  <button
                                    onClick={() => recreateWorkOrder(matchingWo.id, task)}
                                    className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer font-sans"
                                    title="Servis Fişini Yeniden Oluştur"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    Yeniden Oluştur
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => createWorkOrder(task)}
                                  className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer font-sans"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  Servis Fişi Oluştur
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="p-4 bg-gray-50 border-t border-gray-150 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm cursor-pointer font-sans"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
