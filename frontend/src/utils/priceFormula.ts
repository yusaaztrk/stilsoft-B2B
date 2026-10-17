import type { PriceGroupDto } from '../api/priceGroups'

/*
  FİYAT FORMÜLÜ MOTORU — TEK KAYNAK.

  `PriceGroups.Formula` ifadelerini hesaplar: değişkenler F4 / KDV / DISCOUNT, fonksiyonlar
  ADD_KDV / REMOVE_KDV. Eskiden `AtliFiyatlandirmaPage` içinde gömülüydü; kampanyalı fiyat da
  aynı formülle türemek zorunda olduğu için buraya çıkarıldı (2026-09-18). Dilbilgisi sunucudaki
  `Core/Helpers/PriceFormulaEvaluator.cs` ile birebir aynı; biri değişirse diğeri de değişmeli.
*/

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

export function evalPriceFormula(
  expr: string,
  vars: Record<string, number>,
  funcs: Record<string, (...args: number[]) => number>
): number {
  type Tok = { t: 'num' | 'id' | 'op' | 'lp' | 'rp' | 'comma' | 'eof'; v?: string }

  const s = String(expr ?? '').trim()
  let i = 0
  const nextTok = (): Tok => {
    while (i < s.length && /\s/.test(s[i]!)) i++
    if (i >= s.length) return { t: 'eof' }
    const ch = s[i]!
    if (ch === '(') {
      i++
      return { t: 'lp' }
    }
    if (ch === ')') {
      i++
      return { t: 'rp' }
    }
    if (ch === ',') {
      i++
      return { t: 'comma' }
    }
    if (/[+\-*/]/.test(ch)) {
      i++
      return { t: 'op', v: ch }
    }
    if (/[0-9.]/.test(ch)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j]!)) j++
      const v = s.slice(i, j)
      i = j
      return { t: 'num', v }
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j]!)) j++
      const v = s.slice(i, j)
      i = j
      return { t: 'id', v }
    }
    throw new Error('Geçersiz karakter: ' + ch)
  }

  let cur = nextTok()
  const eat = (t: Tok['t'], v?: string) => {
    if (cur.t !== t) throw new Error('Formül parse hatası')
    if (v != null && cur.v !== v) throw new Error('Formül parse hatası')
    cur = nextTok()
  }

  const parsePrimary = (): number => {
    if (cur.t === 'op' && cur.v === '-') {
      eat('op', '-')
      return -parsePrimary()
    }
    if (cur.t === 'num') {
      const n = Number(cur.v)
      eat('num')
      if (!Number.isFinite(n)) throw new Error('Geçersiz sayı')
      return n
    }
    if (cur.t === 'id') {
      const id = String(cur.v ?? '')
      eat('id')
      if ((cur.t as Tok['t']) === 'lp') {
        eat('lp')
        const args: number[] = []
        if ((cur.t as Tok['t']) !== 'rp') {
          args.push(parseExpr())
          while ((cur.t as Tok['t']) === 'comma') {
            eat('comma')
            args.push(parseExpr())
          }
        }
        eat('rp')
        const fn = funcs[id.toUpperCase()]
        if (!fn) throw new Error('Bilinmeyen fonksiyon: ' + id)
        const out = fn(...args)
        if (!Number.isFinite(out)) throw new Error('Formül sonucu geçersiz')
        return out
      }
      const v = vars[id.toUpperCase()]
      if (v == null) throw new Error('Bilinmeyen değişken: ' + id)
      return v
    }
    if (cur.t === 'lp') {
      eat('lp')
      const v = parseExpr()
      eat('rp')
      return v
    }
    throw new Error('Formül parse hatası')
  }

  const parseMul = (): number => {
    let v = parsePrimary()
    while (cur.t === 'op' && (cur.v === '*' || cur.v === '/')) {
      const op = cur.v
      eat('op')
      const r = parsePrimary()
      v = op === '*' ? v * r : v / r
    }
    return v
  }

  const parseExpr = (): number => {
    let v = parseMul()
    while (cur.t === 'op' && (cur.v === '+' || cur.v === '-')) {
      const op = cur.v
      eat('op')
      const r = parseMul()
      v = op === '+' ? v + r : v - r
    }
    return v
  }

  const result = parseExpr()
  if (cur.t !== 'eof') throw new Error('Formül parse hatası')
  return result
}

export function computePricesFromFormulas(args: {
  f4: number
  kdvRate: number
  discountRate: number
  priceGroups: PriceGroupDto[]
}) {
  const kdv = Number(args.kdvRate ?? 0)
  const denom = 1 + kdv / 100
  const vars: Record<string, number> = {
    F4: round2(args.f4),
    KDV: kdv,
    DISCOUNT: clamp(Number(args.discountRate ?? 0), 0, 100)
  }
  const funcs: Record<string, (...args: number[]) => number> = {
    ADD_KDV: (x: number) => x * denom,
    REMOVE_KDV: (x: number) => x / denom
  }

  const outByGroupId: Record<string, number> = {}
  for (const pg of args.priceGroups) {
    const expr = String((pg as any).formula ?? '').trim()
    if (!expr) continue
    const value = evalPriceFormula(expr, vars, funcs)
    if (!Number.isFinite(value)) continue
    outByGroupId[pg.id] = round2(value)
  }
  return outByGroupId
}

/**
 * Tek bir formülü verilen F4/KDV/iskonto ile hesaplar. Boş formül taban grup (F4) sayılır.
 * Bozuk formül ya da sıfır/negatif sonuçta `null` — sunucudaki `Evaluate` ile aynı sözleşme.
 */
export function evalPriceGroupFormula(
  formula: string | null | undefined,
  f4: number,
  kdvRate: number,
  discountRate: number
): number | null {
  let expr = String(formula ?? '').trim()
  if (!expr) expr = 'F4'
  const kdv = Number(kdvRate ?? 0)
  const denom = 1 + (Number.isFinite(kdv) ? kdv : 0) / 100
  const vars: Record<string, number> = {
    F4: round2(f4),
    KDV: Number.isFinite(kdv) ? kdv : 0,
    DISCOUNT: clamp(Number(discountRate ?? 0), 0, 100)
  }
  const funcs: Record<string, (...args: number[]) => number> = {
    ADD_KDV: (x: number) => x * denom,
    REMOVE_KDV: (x: number) => x / denom
  }
  try {
    const v = evalPriceFormula(expr, vars, funcs)
    if (!Number.isFinite(v) || v <= 0) return null
    return v
  } catch {
    return null
  }
}

/*
  KAMPANYA İNDİRİMİ KATALOG FİYATINA (F4) UYGULANIR (2026-09-18 kullanıcı kuralı: "5.000
  indirim Fiyat 4 üzerinden; 26.000'lik klima 21.000'e düştü, diğer fiyatlar ona göre").

  Birim indirim = Formül(F4) − Formül(F4 − indirim). Formülle tutarlı veride bu, "yeni fiyat =
  Formül(F4')" ile aynı sonuçtur; elle girilmiş grup fiyatında ise kampanyanın etkisini olduğu
  gibi taşır, carinin fiyatını formül fiyatına çekmez. Sunucudaki karşılığı
  `Core/Helpers/CampaignCatalogDiscount.cs` — kart ile sepet aynı sayıyı göstersin diye ikisi
  aynı tutulur. Hesaplanamıyorsa `null`; çağıran eski davranışa (birim fiyattan düşme) döner.
*/
export function kampanyaKatalogIndirimi(args: {
  katalogFiyati: number
  formul: string | null | undefined
  kdvOrani: number
  iskontoOrani: number
  tip: 'Oran' | 'Tutar'
  deger: number
}): number | null {
  const f4 = Number(args.katalogFiyati)
  const deger = Number(args.deger)
  if (!Number.isFinite(f4) || f4 <= 0 || !Number.isFinite(deger) || deger <= 0) return null

  let f4Indirimli = args.tip === 'Oran' ? f4 * (1 - deger / 100) : f4 - deger
  if (f4Indirimli < 0) f4Indirimli = 0

  const once = evalPriceGroupFormula(args.formul, f4, args.kdvOrani, args.iskontoOrani)
  if (once === null) return null
  const sonra = f4Indirimli <= 0 ? 0 : (evalPriceGroupFormula(args.formul, f4Indirimli, args.kdvOrani, args.iskontoOrani) ?? 0)

  const fark = once - sonra
  if (fark <= 0) return 0
  return round2(fark)
}
