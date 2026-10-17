import { useState } from 'react'
import type { WarehouseDropdownItem } from '../../api/warehouses'

/**
 * Depo / nakit kasa / banka yetkileri seçici.
 *
 * Kullanıcı formu ile teknisyen formu bu bileşeni paylaşır. Daha önce yalnızca kullanıcı formunda,
 * satır içi ~350 satır JSX olarak duruyordu; teknisyen formunda ise her biri tek bir `<select>`
 * idi, yani bir teknisyene birden fazla depo/kasa/banka verilemiyordu. İkisinin "aynı" kalmasının
 * tek güvencesi tek bir kaynak olması.
 */

export type AccessScopeValue = {
  /** Depo kodları string tutulur: `<option value>` string döner ve karşılaştırmalar bunun üzerinden yapılır. */
  warehouseCodes: string[]
  /**
   * VARSAYILAN DEPO (kullanıcı kuralı, 2026-08-14).
   *
   * Kullanıcının yetkili olduğu depolardan biri. Satış faturası ekranı, kalemi GİREN kişinin bu
   * deposunu o kalemin öntanımlı çıkış deposu yapıyor — böylece "satış, işlemi kim yaptıysa onun
   * deposundan çıkar" kuralı tek bir yerden yönetiliyor. Boş bırakılırsa ekran depoyu sorar.
   *
   * Yetki listesinden çıkarılan bir depo burada da otomatik temizlenir; aksi halde sunucu
   * "varsayılan depo yetkili depolar arasında değil" diye 400 dönerdi.
   */
  defaultWarehouseCode?: string
  cashAccountIds: number[]
  bankAccountIds: number[]
}

type AccessScopePickerProps = {
  value: AccessScopeValue
  onChange: (next: AccessScopeValue) => void
  warehouses: WarehouseDropdownItem[]
  cashAccounts: any[]
  bankAccounts: any[]
  /** Başlık satırı. Teknisyen modalında farklı bir metin isteniyor. */
  title?: string
  /** Teknisyen modalinde araç deposu ayrı bir alan olduğu için varsayılan seçici kapatılabilir. */
  showDefaultWarehouse?: boolean
}

export default function AccessScopePicker({
  value,
  onChange,
  warehouses,
  cashAccounts,
  bankAccounts,
  title = 'İşlem ve Erişim Yetkileri',
  showDefaultWarehouse = true
}: AccessScopePickerProps) {
  const [warehousePick, setWarehousePick] = useState('')
  const [cashPick, setCashPick] = useState('')
  const [bankPick, setBankPick] = useState('')
  const [showAllWarehousesDetail, setShowAllWarehousesDetail] = useState(false)
  const [showAllCashDetail, setShowAllCashDetail] = useState(false)
  const [showAllBankDetail, setShowAllBankDetail] = useState(false)

  const patch = (next: Partial<AccessScopeValue>) => onChange({ ...value, ...next })

  const selectedWarehouseCodes = (value.warehouseCodes ?? [])
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)

  /**
   * Depo yetkisi değiştiren HER yol buradan geçmeli. Yetki listesinden düşen depo varsayılan
   * olarak kalırsa sunucu kaydı reddediyor; tek depo kaldıysa da varsayılanı sormanın anlamı yok,
   * doğrudan o depo seçilir.
   */
  const patchWarehouses = (nextCodes: string[]) => {
    const codes = nextCodes.map((x) => String(x ?? '').trim()).filter(Boolean)
    const current = String(value.defaultWarehouseCode ?? '').trim()
    const nextDefault = codes.length === 1 ? codes[0] : codes.indexOf(current) !== -1 ? current : ''
    onChange({ ...value, warehouseCodes: codes, defaultWarehouseCode: nextDefault })
  }

  const availableWarehouses = (warehouses ?? []).filter(
    (w) => selectedWarehouseCodes.indexOf(String(w.warehouseCode)) === -1
  )

  const selectedWarehouseBadges = selectedWarehouseCodes.map((code) => {
    const item = (warehouses ?? []).find((w) => String(w.warehouseCode) === code)
    return {
      code,
      label: item ? `[${item.warehouseCode}] ${String(item.name ?? '')}`.trim() : `[${code}]`
    }
  })

  const totalWarehousesCount = (warehouses ?? []).length
  const allWarehousesSelected = totalWarehousesCount > 0 && selectedWarehouseBadges.length === totalWarehousesCount

  const totalCashCount = (cashAccounts ?? []).length
  const selectedCashCount = (value.cashAccountIds ?? []).length
  const allCashSelected = totalCashCount > 0 && selectedCashCount === totalCashCount

  const totalBankCount = (bankAccounts ?? []).length
  const selectedBankCount = (value.bankAccountIds ?? []).length
  const allBankSelected = totalBankCount > 0 && selectedBankCount === totalBankCount

  return (
    <div className="col-span-1 md:col-span-2 bg-slate-50/90 border border-slate-200/90 rounded-2xl p-4 space-y-4 shadow-2xs">
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5">
        <div className="text-xs font-bold text-slate-800 tracking-wide uppercase flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 inline-block shadow-xs"></span>
          {title}
        </div>
        <button
          type="button"
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
          onClick={() => {
            const allCodes = (warehouses ?? []).map((w) => String(w.warehouseCode))
            const current = String(value.defaultWarehouseCode ?? '').trim()
            onChange({
              warehouseCodes: allCodes,
              // Tüm depolar verilirken varsayılan TAHMİN EDİLMEZ; kullanıcı zaten aşağıdaki
              // seçiciden seçecek. Önceden seçilmiş bir varsayılan varsa korunur.
              defaultWarehouseCode: allCodes.length === 1 ? allCodes[0] : allCodes.indexOf(current) !== -1 ? current : '',
              cashAccountIds: (cashAccounts ?? []).map((c) => Number(c.id)).filter((n) => Number.isFinite(n) && n > 0),
              bankAccountIds: (bankAccounts ?? []).map((b) => Number(b.id)).filter((n) => Number.isFinite(n) && n > 0)
            })
            setShowAllWarehousesDetail(false)
            setShowAllCashDetail(false)
            setShowAllBankDetail(false)
          }}
        >
          ⚡ Tüm Yetkileri Ver (Tümü)
        </button>
      </div>

      {/* Depo Yetkileri */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
          <span>Depo Yetkileri ({selectedWarehouseBadges.length}/{totalWarehousesCount})</span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              className="text-indigo-600 hover:text-indigo-800 text-xs font-semibold hover:underline"
              onClick={() => {
                patchWarehouses((warehouses ?? []).map((w) => String(w.warehouseCode)))
                setShowAllWarehousesDetail(false)
              }}
            >
              Tüm Depoları Seç
            </button>
            {selectedWarehouseBadges.length > 0 && (
              <button
                type="button"
                className="text-rose-600 hover:text-rose-800 text-xs font-semibold hover:underline"
                onClick={() => {
                  patchWarehouses([])
                  setShowAllWarehousesDetail(false)
                }}
              >
                Temizle
              </button>
            )}
          </div>
        </div>

        {allWarehousesSelected && !showAllWarehousesDetail ? (
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-indigo-50/90 border border-indigo-200/90 text-xs transition-all shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
              <span className="font-bold text-indigo-950">★ TÜM DEPOLAR SEÇİLİ</span>
              <span className="text-indigo-700 font-medium">({totalWarehousesCount}/{totalWarehousesCount} Depo Tam Erişim)</span>
            </div>
            <button
              type="button"
              className="text-indigo-700 hover:text-indigo-950 font-semibold underline text-xs cursor-pointer"
              onClick={() => setShowAllWarehousesDetail(true)}
            >
              Özel Seçim Yap / Listele
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={warehousePick}
                onChange={(e) => setWarehousePick(String(e.target.value))}
                className="input-base h-8.5 text-xs bg-white border-slate-200 focus:border-indigo-500 rounded-lg flex-1"
              >
                <option value="">Depo seçiniz...</option>
                {availableWarehouses.map((w) => (
                  <option key={String(w.warehouseCode)} value={String(w.warehouseCode)}>
                    [{w.warehouseCode}] {String(w.name ?? '')}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="h-8.5 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold shrink-0 transition-colors disabled:opacity-50"
                disabled={!warehousePick}
                onClick={() => {
                  const code = String(warehousePick ?? '').trim()
                  if (!code || selectedWarehouseCodes.indexOf(code) !== -1) return
                  patchWarehouses([...selectedWarehouseCodes, code])
                  setWarehousePick('')
                }}
              >
                + Ekle
              </button>
              {allWarehousesSelected && (
                <button
                  type="button"
                  className="h-8.5 px-2.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold shrink-0 transition-colors cursor-pointer"
                  onClick={() => setShowAllWarehousesDetail(false)}
                >
                  Özet Görünüm
                </button>
              )}
            </div>

            {selectedWarehouseBadges.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1 max-h-36 overflow-y-auto pr-1">
                {selectedWarehouseBadges.map((x) => (
                  <span key={x.code} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-50/90 border border-indigo-200/80 text-indigo-900 text-xs font-medium">
                    <span>{x.label}</span>
                    <button
                      type="button"
                      className="text-indigo-400 hover:text-indigo-700 font-bold ml-0.5"
                      onClick={() => patchWarehouses(selectedWarehouseCodes.filter((c) => c !== x.code))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/*
          VARSAYILAN DEPO (kullanıcı kuralı, 2026-08-14).

          "Satış, işlemi kim yaptıysa onun deposundan çıksın" kuralının tek kaynağı burası.
          Satış faturası ekranı, kalemi giren kişinin bu deposunu kalemin öntanımlı çıkış deposu
          yapıyor. Seçenekler YALNIZCA yukarıda verilen yetkilerden gelir; sunucu da aynı kuralı
          doğruluyor.
        */}
        {showDefaultWarehouse && (
          <div className="pt-2 border-t border-slate-200/70 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>★ Varsayılan Depo</span>
              {String(value.defaultWarehouseCode ?? '').trim() && (
                <button
                  type="button"
                  className="text-rose-600 hover:text-rose-800 text-xs font-semibold hover:underline"
                  onClick={() => patch({ defaultWarehouseCode: '' })}
                >
                  Temizle
                </button>
              )}
            </div>

            <select
              value={String(value.defaultWarehouseCode ?? '')}
              onChange={(e) => patch({ defaultWarehouseCode: String(e.target.value) })}
              disabled={selectedWarehouseCodes.length === 0}
              className="input-base h-8.5 text-xs bg-white border-slate-200 focus:border-indigo-500 rounded-lg w-full disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">
                {selectedWarehouseCodes.length === 0 ? 'Önce depo yetkisi verin...' : 'Seçilmedi (fatura ekranı soracak)'}
              </option>
              {selectedWarehouseBadges.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.label}
                </option>
              ))}
            </select>

            <div className="text-[10px] text-slate-500 leading-snug">
              Bu kullanıcının girdiği sipariş kalemleri satış faturasında öntanımlı olarak bu depodan
              çıkar. Boş bırakılırsa fatura ekranı depoyu sorar.
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200/70">
        {/* Nakit Kasa Yetkileri */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span>Nakit Kasa Yetkileri ({selectedCashCount}/{totalCashCount})</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-emerald-600 hover:text-emerald-800 text-xs font-semibold hover:underline"
                onClick={() => {
                  patch({ cashAccountIds: (cashAccounts ?? []).map((c) => Number(c.id)).filter((n) => Number.isFinite(n) && n > 0) })
                  setShowAllCashDetail(false)
                }}
              >
                Tüm Kasalar
              </button>
              {selectedCashCount > 0 && (
                <button
                  type="button"
                  className="text-rose-600 hover:text-rose-800 text-xs font-semibold hover:underline"
                  onClick={() => {
                    patch({ cashAccountIds: [] })
                    setShowAllCashDetail(false)
                  }}
                >
                  Temizle
                </button>
              )}
            </div>
          </div>

          {allCashSelected && !showAllCashDetail ? (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/90 border border-emerald-200/90 text-xs transition-all shadow-2xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
                <span className="font-bold text-emerald-950">★ TÜM KASALAR SEÇİLİ</span>
                <span className="text-emerald-700 font-medium">({totalCashCount}/{totalCashCount} Kasa)</span>
              </div>
              <button
                type="button"
                className="text-emerald-700 hover:text-emerald-950 font-semibold underline text-xs cursor-pointer"
                onClick={() => setShowAllCashDetail(true)}
              >
                Özel Seçim
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={cashPick}
                  onChange={(e) => setCashPick(e.target.value)}
                  className="input-base h-8.5 text-xs bg-white border-slate-200 focus:border-emerald-500 rounded-lg flex-1"
                >
                  <option value="">Kasa seçiniz...</option>
                  {(cashAccounts ?? [])
                    .filter((c) => !(value.cashAccountIds ?? []).includes(Number(c.id)))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                </select>

                <button
                  type="button"
                  className="h-8.5 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold shrink-0 transition-colors disabled:opacity-50"
                  disabled={!cashPick}
                  onClick={() => {
                    const idNum = Number(cashPick)
                    if (!idNum || (value.cashAccountIds ?? []).includes(idNum)) return
                    patch({ cashAccountIds: [...(value.cashAccountIds ?? []), idNum] })
                    setCashPick('')
                  }}
                >
                  + Ekle
                </button>
                {allCashSelected && (
                  <button
                    type="button"
                    className="h-8.5 px-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold shrink-0 transition-colors cursor-pointer"
                    onClick={() => setShowAllCashDetail(false)}
                  >
                    Özet
                  </button>
                )}
              </div>

              {selectedCashCount > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 max-h-36 overflow-y-auto pr-1">
                  {(value.cashAccountIds ?? []).map((id) => {
                    const c = (cashAccounts ?? []).find((x) => Number(x.id) === Number(id))
                    return (
                      <span key={id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-50/90 border border-emerald-200/80 text-emerald-900 text-xs font-medium">
                        <span>{c ? `${c.name} (${c.code})` : `Kasa #${id}`}</span>
                        <button
                          type="button"
                          className="text-emerald-400 hover:text-emerald-700 font-bold ml-0.5"
                          onClick={() => patch({ cashAccountIds: (value.cashAccountIds ?? []).filter((x) => x !== id) })}
                        >
                          ×
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Banka Havale Yetkileri */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span>Banka Havale Yetkileri ({selectedBankCount}/{totalBankCount})</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-blue-600 hover:text-blue-800 text-xs font-semibold hover:underline"
                onClick={() => {
                  patch({ bankAccountIds: (bankAccounts ?? []).map((b) => Number(b.id)).filter((n) => Number.isFinite(n) && n > 0) })
                  setShowAllBankDetail(false)
                }}
              >
                Tüm Bankalar
              </button>
              {selectedBankCount > 0 && (
                <button
                  type="button"
                  className="text-rose-600 hover:text-rose-800 text-xs font-semibold hover:underline"
                  onClick={() => {
                    patch({ bankAccountIds: [] })
                    setShowAllBankDetail(false)
                  }}
                >
                  Temizle
                </button>
              )}
            </div>
          </div>

          {allBankSelected && !showAllBankDetail ? (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-blue-50/90 border border-blue-200/90 text-xs transition-all shadow-2xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                <span className="font-bold text-blue-950">★ TÜM BANKALAR SEÇİLİ</span>
                <span className="text-blue-700 font-medium">({totalBankCount}/{totalBankCount} Banka Hesabı)</span>
              </div>
              <button
                type="button"
                className="text-blue-700 hover:text-blue-950 font-semibold underline text-xs cursor-pointer"
                onClick={() => setShowAllBankDetail(true)}
              >
                Özel Seçim
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={bankPick}
                  onChange={(e) => setBankPick(e.target.value)}
                  className="input-base h-8.5 text-xs bg-white border-slate-200 focus:border-blue-500 rounded-lg flex-1"
                >
                  <option value="">Banka seçiniz...</option>
                  {(bankAccounts ?? [])
                    .filter((b) => !(value.bankAccountIds ?? []).includes(Number(b.id)))
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.accountName} ({b.accountCode})
                      </option>
                    ))}
                </select>

                <button
                  type="button"
                  className="h-8.5 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold shrink-0 transition-colors disabled:opacity-50"
                  disabled={!bankPick}
                  onClick={() => {
                    const idNum = Number(bankPick)
                    if (!idNum || (value.bankAccountIds ?? []).includes(idNum)) return
                    patch({ bankAccountIds: [...(value.bankAccountIds ?? []), idNum] })
                    setBankPick('')
                  }}
                >
                  + Ekle
                </button>
                {allBankSelected && (
                  <button
                    type="button"
                    className="h-8.5 px-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold shrink-0 transition-colors cursor-pointer"
                    onClick={() => setShowAllBankDetail(false)}
                  >
                    Özet
                  </button>
                )}
              </div>

              {selectedBankCount > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 max-h-36 overflow-y-auto pr-1">
                  {(value.bankAccountIds ?? []).map((id) => {
                    const b = (bankAccounts ?? []).find((x) => Number(x.id) === Number(id))
                    return (
                      <span key={id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-50/90 border border-blue-200/80 text-blue-900 text-xs font-medium">
                        <span>{b ? `${b.accountName} (${b.accountCode})` : `Banka #${id}`}</span>
                        <button
                          type="button"
                          className="text-blue-400 hover:text-blue-700 font-bold ml-0.5"
                          onClick={() => patch({ bankAccountIds: (value.bankAccountIds ?? []).filter((x) => x !== id) })}
                        >
                          ×
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
