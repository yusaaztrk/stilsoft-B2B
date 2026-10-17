export const STATUS_TR: Record<string, string> = {
  New: 'Yeni Kayıt',
  Planned: 'Planlandı',
  Workshop: 'Atölyede',
  InRepair: 'Tamirde',
  WaitingForParts: 'Parça Bekleniyor',
  Ready: 'Hazır / Gerçekleşti',
  Delivered: 'Teslim Edildi',
  Cancelled: 'İptal',
  Delayed: 'Ertelendi',
  Available: 'Müsait',
  OnField: 'Sahada',
  OnBreak: 'Molada',
  OffDuty: 'Mesai Dışı',
  InProgress: 'Devam Ediyor',
  Completed: 'Gerçekleşti',
  Deferred: 'Ertelendi',
}

export function statusLabel(s: string | undefined | null): string {
  if (!s) return '-'
  return STATUS_TR[s] ?? s
}
