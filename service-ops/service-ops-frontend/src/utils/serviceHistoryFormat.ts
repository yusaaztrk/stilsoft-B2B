/**
 * Servis geçmişi metin biçimlendiricileri. Atölye ve Saha sayfalarında birebir aynı kopyalar
 * halinde duruyordu; "i" (geçmiş) modalı ortaklaştırılırken buraya alındı.
 */

export const getStatusLabelTR = (statusKey?: string) => {
  if (!statusKey) return ''
  const map: Record<string, string> = {
    New: 'Yeni Kayıt',
    Workshop: 'Atölyede',
    InRepair: 'Tamirde',
    WaitingForParts: 'Parça Bekliyor',
    Ready: 'Hazır',
    WorkshopReady: 'Atölye Hazır',
    DeliveryPlanning: 'Teslimat Planlamasında',
    FieldPlanned: 'Saha Planlamasında',
    FieldCompleted: 'Sahada Tamamlandı',
    Planned: 'Teslimat Rotalandı',
    Delivered: 'Teslim Edildi',
    Cancelled: 'İptal'
  }
  return map[statusKey] || statusKey
}

export const formatProblemDescriptionTR = (desc?: string) => {
  if (!desc) return '-'
  return desc
    .replace(/ Servis Açıklaması: /g, '\n• Servis Açıklaması: ')
    .replace(/ Fatura Numarası: /g, '\n• Fatura Numarası: ')
    .replace(/ Garanti Başlangıcı: /g, '\n• Garanti Başlangıcı: ')
    .replace(/ Müşteri Tipi: /g, '\n• Müşteri Tipi: ')
    .replace(/ Fatura Tipi: /g, '\n• Fatura Tipi: ')
    .replace(/ Ek Açıklama: /g, '\n• Ek Açıklama: ')
}

export const formatStepDescriptionTR = (text?: string) => {
  if (!text) return 'İşlem gerçekleştirildi.'

  let formatted = text

  if (formatted.includes('Kullanılan Parçalar:')) {
    const partsMatch = formatted.match(/Kullanılan Parçalar:\s*([^|\n]+)/i)
    if (partsMatch) {
      const rawPartsStr = partsMatch[1].trim()
      const partsItems = rawPartsStr.split(',').map(p => p.trim()).filter(Boolean)
      const formattedParts = partsItems.map(p => {
        const clean = p.replace(/\(Adet:\s*(\d+)\)/i, '($1 Adet)')
        return `  • ${clean}`
      }).join('\n')

      formatted = formatted.replace(
        /\|?\s*Kullanılan Parçalar:\s*[^|\n]+/i,
        `\n⚙️ Kullanılan Yedek Parçalar:\n${formattedParts}`
      )
    }
  }

  formatted = formatted.split('|').map(s => s.trim()).filter(Boolean).join('\n')

  formatted = formatted
    .replace(/(Fatura Bedeli:\s*[^\n()]+)/gi, '\n💰 $1')
    .replace(/(Fatura No:\s*[^\s\n()]+)/gi, '\n🧾 $1')
    .replace(/(Fatura oluşturuldu[^\n]*)/gi, '\n🧾 $1')
    .replace(/(Teslimat planlandı[^\n]*)/gi, '\n🚚 $1')

  return formatted.trim()
}
