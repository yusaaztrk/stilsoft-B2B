/**
 * "Atölye Gün" sütununun hücresi — kural için bkz. utils/atolyeGun.
 * `days` < 0: ürün hiç atölyeye girmedi (sıralamada en sona düşsün diye sayı −1 tutuluyor).
 * Renk eşikleri "Geçen Gün" rozetiyle aynı, iki sayaç yan yana aynı dili konuşsun.
 */
export function AtolyeGunRozeti({ days }: { days: number }) {
  if (days < 0) {
    return <span className="text-[11px] text-gray-400 whitespace-nowrap">Atölyeye girmedi</span>
  }
  let bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (days >= 15 && days < 30) {
    bgClass = 'bg-amber-50 text-amber-700 border-amber-200'
  } else if (days >= 30) {
    bgClass = 'bg-rose-50 text-rose-700 border-rose-200 font-bold'
  } else if (days > 5 && days < 15) {
    bgClass = 'bg-emerald-50/70 text-emerald-800 border-emerald-150'
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${bgClass}`}>
      {days} Gün
    </span>
  )
}
