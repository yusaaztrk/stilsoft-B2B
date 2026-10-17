/**
 * Saha ekiplerinin tek kaynağı.
 *
 * Bir montaj satırı "hangi saha personeline veya klima ekibine gidecek" sorusuna göre atanıyor.
 * Ekip bilgisi teknisyenin `roles` dizisinde duruyor (`SahaMontajEkibi`, `KlimaEkibi`); ServiceOps
 * TechnicianDto'sunda ayrı bir roleCode alanı YOK, o yüzden ayrım burada yapılır.
 *
 * Rolü bu iki koda uymayan herkes "Diğer" altında listelenir — gizlenmez. Müdürler de buraya
 * düşer: kendilerine otomatik iş atanmaz ama yönetici bilerek seçebilmelidir.
 */

export type TeamKey = 'saha' | 'klima' | 'diger'

export const TEAM_LABELS: Record<TeamKey, string> = {
  saha: 'Saha Montaj Ekibi',
  klima: 'Klima Ekibi',
  diger: 'Diğer',
}

export const TEAM_ORDER: TeamKey[] = ['saha', 'klima', 'diger']

/**
 * Montaja YENİ atama yapılırken seçilebilecek ekipler. Servis personeli / atölye elemanı / müdür
 * gibi "Diğer" grubuna düşen roller montaj işine atanamaz — o kadro atölye/idari iş için var,
 * sahaya çıkmıyor. Geçmişte yanlışlıkla atanmış "Diğer" kayıtları (varsa) özet ekranlarında hâlâ
 * görünür (bkz. `TEAM_ORDER`), sadece YENİ seçim listesinden çıkarılır.
 */
export const ASSIGNABLE_TEAM_ORDER: TeamKey[] = ['saha', 'klima']

export function teamOf(roles: string[] | undefined | null): TeamKey {
  const list = (roles ?? []).map((r) => String(r).toLowerCase())
  if (list.includes('sahamontajekibi')) return 'saha'
  if (list.includes('klimaekibi')) return 'klima'
  return 'diger'
}

export function teamLabelOf(roles: string[] | undefined | null): string {
  return TEAM_LABELS[teamOf(roles)]
}

/**
 * Planlama satırı / görev şeklindeki her şeyin teknisyene göre gruplanması için ortak mantık.
 *
 * Hem Fatura Planlama'daki "Kime Ne Atandı" özeti hem Sahaya Aktar'daki "son kez gözden geçir"
 * özeti aynı gruplamayı kullanır — ikisi de "bu ekipte kaç adet var" sorusuna cevap veriyor,
 * aralarında tutarsızlık olmasın diye tek yerden besleniyor.
 */
export type GroupableRow = {
  id: string
  technicianId: string
  technicianName?: string
  quantity: number
  itemProductName?: string
}

export type TechnicianGroup<T extends GroupableRow> = {
  technicianId: string
  technicianName: string
  team: TeamKey
  totalQuantity: number
  itemNames: string[]
  rows: T[]
}

export function groupRowsByTechnician<T extends GroupableRow>(
  rows: T[],
  rolesOf: (technicianId: string) => string[] | undefined
): TechnicianGroup<T>[] {
  const groups = new Map<string, TechnicianGroup<T>>()

  for (const row of rows) {
    const techId = row.technicianId || ''
    const key = techId || '__unassigned__'
    let group = groups.get(key)
    if (!group) {
      group = {
        technicianId: techId,
        technicianName: techId ? (row.technicianName || 'Bilinmeyen') : 'Atanmadı',
        team: teamOf(techId ? rolesOf(techId) : undefined),
        totalQuantity: 0,
        itemNames: [],
        rows: [],
      }
      groups.set(key, group)
    }
    group.totalQuantity += row.quantity
    if (row.itemProductName && !group.itemNames.includes(row.itemProductName)) {
      group.itemNames.push(row.itemProductName)
    }
    group.rows.push(row)
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (!a.technicianId) return 1
    if (!b.technicianId) return -1
    return a.technicianName.localeCompare(b.technicianName, 'tr')
  })
}
