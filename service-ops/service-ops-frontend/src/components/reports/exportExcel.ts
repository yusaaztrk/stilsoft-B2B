import * as XLSX from 'xlsx'

export type ExportColumn = { key: string; header: string }

/**
 * Rapor tablolarının Excel çıktısı.
 *
 * Bilerek `components/table/exportUtils` kullanılmıyor: o dosya `tableTypes.ts` üzerinden
 * `mantine-react-table`'a bağlı, o paket de bu projede kurulu değil. Zinciri buraya taşımak
 * dev sunucusunu "Failed to resolve import" ile düşürüyordu. Burada yalnızca `xlsx` var,
 * o da package.json'da.
 *
 * Ham değer yazılır, ekrandaki biçimlenmiş metin değil: sayıyı hücreye metin olarak koymak
 * Excel'de toplanamaz hale getirir.
 */
export function exportRowsToExcel<T extends Record<string, any>>(
  columns: ExportColumn[],
  rows: T[],
  fileName = 'rapor'
): void {
  if (rows.length === 0) return

  const mapped = rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const col of columns) {
      const value = row[col.key]
      out[col.header] = value === null || value === undefined ? '' : value
    }
    return out
  })

  const worksheet = XLSX.utils.json_to_sheet(mapped)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Rapor')

  // Dosya adındaki Türkçe karakterler ve ':' bazı sistemlerde kaydetmeyi engelliyor.
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)
  XLSX.writeFile(workbook, `${safeName}.xlsx`)
}
