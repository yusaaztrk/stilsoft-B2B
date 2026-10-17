import * as XLSX from 'xlsx'
import type { ExtendedColumnDef } from './tableTypes'

/**
 * Extracts header names and row values based on column definitions.
 */
function prepareExportData<TData extends Record<string, any>>(
  columns: ExtendedColumnDef<TData>[],
  data: TData[]
) {
  const exportColumns = columns.filter((col) => col.accessorKey && col.header)
  
  const headers = exportColumns.map((col) => String(col.header))
  
  const rows = data.map((row) => {
    const rowData: Record<string, any> = {}
    exportColumns.forEach((col) => {
      const key = col.accessorKey as string
      const header = col.header as string
      let val = row[key]
      
      // If there is a simple string/number value, use it. Otherwise convert to string.
      if (val === null || val === undefined) {
        rowData[header] = ''
      } else if (typeof val === 'object') {
        rowData[header] = JSON.stringify(val)
      } else {
        rowData[header] = val
      }
    })
    return rowData
  })

  return { headers, rows }
}

/**
 * Exports data to Excel (.xlsx) file.
 */
export function exportToExcel<TData extends Record<string, any>>(
  columns: ExtendedColumnDef<TData>[],
  data: TData[],
  fileName = 'export'
) {
  const { rows } = prepareExportData(columns, data)
  
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Data')
  
  XLSX.writeFile(workbook, `${fileName}.xlsx`)
}

/**
 * Exports data to CSV file.
 */
export function exportToCsv<TData extends Record<string, any>>(
  columns: ExtendedColumnDef<TData>[],
  data: TData[],
  fileName = 'export'
) {
  const { rows } = prepareExportData(columns, data)
  
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const csvContent = XLSX.utils.sheet_to_csv(worksheet)
  
  // Add UTF-8 BOM so Excel opens it with Turkish characters correctly
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `${fileName}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * Prints data as HTML table (PDF printing via hidden iframe to avoid popup blockers).
 */
export function exportToPdf<TData extends Record<string, any>>(
  columns: ExtendedColumnDef<TData>[],
  data: TData[],
  title = 'Rapor'
) {
  const { headers, rows } = prepareExportData(columns, data)
  
  const tableHeadersHtml = headers.map((h) => `<th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; text-align: left;">${h}</th>`).join('')
  
  const tableRowsHtml = rows
    .map((row) => {
      const cellsHtml = Object.values(row)
        .map((val) => `<td style="border: 1px solid #ddd; padding: 8px;">${val}</td>`)
        .join('')
      return `<tr>${cellsHtml}</tr>`
    })
    .join('')

  const printHtml = `
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: sans-serif; margin: 20px; color: #333; }
          h1 { margin-bottom: 20px; font-size: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <table>
          <thead>
            <tr>${tableHeadersHtml}</tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `

  // Create a hidden iframe
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (doc) {
    doc.write(printHtml)
    doc.close()
    
    // Wait for the content to load, then print and clean up
    setTimeout(() => {
      if (iframe.contentWindow) {
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
      }
      document.body.removeChild(iframe)
    }, 500)
  }
}

/**
 * Exports data to Word (.doc) file compatible with Microsoft Word/LibreOffice.
 */
export function exportToWord<TData extends Record<string, any>>(
  columns: ExtendedColumnDef<TData>[],
  data: TData[],
  fileName = 'export'
) {
  const { headers, rows } = prepareExportData(columns, data)
  
  const tableHeadersHtml = headers.map((h) => `<th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; text-align: left;">${h}</th>`).join('')
  
  const tableRowsHtml = rows
    .map((row) => {
      const cellsHtml = Object.values(row)
        .map((val) => `<td style="border: 1px solid #ddd; padding: 8px;">${val}</td>`)
        .join('')
      return `<tr>${cellsHtml}</tr>`
    })
    .join('')

  const wordHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>${fileName}</title>
        <style>
          body { font-family: Arial, sans-serif; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; font-size: 11px; }
          th { background-color: #f2f2f2; font-weight: bold; }
        </style>
      </head>
      <body>
        <h2>${fileName}</h2>
        <table>
          <thead>
            <tr>${tableHeadersHtml}</tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `

  const blob = new Blob(['\uFEFF' + wordHtml], { type: 'application/msword;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `${fileName}.doc`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
