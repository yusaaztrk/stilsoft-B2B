import React, { useEffect, useMemo, useState } from 'react'
import { Users, Search, ChevronDown, ChevronRight, Globe2, ListChecks, AlertTriangle } from 'lucide-react'
import Modal from '../Modal'
import { fetchCustomers, type CustomerDto } from '../../api/customers'
import { fetchPriceGroups, type PriceGroupDto } from '../../api/priceGroups'

/**
 * "Bu fiyat grubunun TAMAMI" belirteci: `PG:<fiyat grubu kimliği>`. Sunucu bunu tek bir
 * fiyat grubu hedefi olarak yazar (CampaignsController.ApplyDealerTargets) — gruba sonradan
 * eklenen ya da yeni açılan bayi de kampanyadan yararlanır.
 */
export const PRICE_GROUP_TARGET_PREFIX = 'PG:'

const isGroupToken = (v: string) => v.startsWith(PRICE_GROUP_TARGET_PREFIX)
const groupIdOf = (v: string) => v.slice(PRICE_GROUP_TARGET_PREFIX.length)

/**
 * Kampanya seviyesinde bayi seçimi — FİYAT GRUBU EKSENLİ.
 *
 * ÜÇ HEDEFLEME ŞEKLİ (2026-10-04 kullanıcı bildirimi: "tüm bayileri seçiyorum ama yeni açılan
 * bayi kampanyadan yararlanmıyor"):
 *  1. Tüm bayiler — hiçbir hedef yazılmaz; şimdiki ve SONRADAN AÇILACAK bütün bayiler.
 *  2. Fiyat grubunun tamamı — grup başlığındaki kutu. Eskiden gruptaki bayileri TEK TEK
 *     yazıyordu (yeni açılan bayi listede olmadığı için kampanyayı alamıyordu, 5.744 hedef
 *     satırı da sepet hesabını yavaşlatıyordu); artık grubun kendisi hedeflenir.
 *  3. Tek tek bayiler — listeden işaretlenenler; yalnız onlar.
 *
 * Eski kampanyalarda bir grubun bütün bayileri tek tek seçiliyse uyarı ve "Gruba çevir"
 * düğmesi çıkar; tüm bayiler tek tek seçiliyse "Tüm bayilere çevir".
 */
type Props = {
    selectedDealerCodes: string[]
    onChange: (next: string[]) => void
}

export default function DealerSelector({ selectedDealerCodes, onChange }: Props) {
    const [dealers, setDealers] = useState<CustomerDto[]>([])
    const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])
    const [loading, setLoading] = useState(false)
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    // "Belirli bayiler" seçilip henüz hiçbir şey işaretlenmediyse de liste açık kalsın.
    const [customMode, setCustomMode] = useState(false)
    // Gruplar VARSAYILAN KAPALI. Tek bir fiyat grubunda 5000'den fazla bayi olabiliyor;
    // hepsini birden çizmek modalı kilitliyor. Arama yapılınca eşleşenler otomatik açılır.
    const [expanded, setExpanded] = useState<Set<string>>(new Set())

    useEffect(() => {
        void (async () => {
            try {
                setLoading(true)
                const [dealerData, pgData] = await Promise.all([
                    fetchCustomers({ includeInactive: false }),
                    fetchPriceGroups({ includeInactive: false })
                ])
                setDealers(dealerData)
                setPriceGroups(pgData)
            } catch (e: any) {
                console.error('Bayiler / fiyat grupları alınamadı:', e)
            } finally {
                setLoading(false)
            }
        })()
    }, [])

    const selectedGroupIds = useMemo(
        () => new Set(selectedDealerCodes.filter(isGroupToken).map(groupIdOf)),
        [selectedDealerCodes]
    )
    const selectedDealerSet = useMemo(
        () => new Set(selectedDealerCodes.filter((c) => !isGroupToken(c))),
        [selectedDealerCodes]
    )

    const allMode = selectedDealerCodes.length === 0 && !customMode

    const matchesSearch = (d: CustomerDto) => {
        const q = search.trim().toLocaleLowerCase('tr')
        if (!q) return true
        const code = String(d.customerCode ?? '').toLocaleLowerCase('tr')
        const name = String(d.name ?? '').toLocaleLowerCase('tr')
        return code.includes(q) || name.includes(q)
    }

    /** Fiyat grubuna göre bölünmüş bayiler. Grubu olmayanlar en sonda "Fiyat grubu atanmamış". */
    const sections = useMemo(() => {
        const ordered = priceGroups
            .slice()
            .sort((a, b) => Number((a as any).code) - Number((b as any).code))

        const out: { key: string; groupId: string | null; title: string; shortTitle: string; dealers: CustomerDto[] }[] = ordered.map((pg) => ({
            key: String(pg.id),
            groupId: String(pg.id),
            title: `Fiyat ${(pg as any).code}${pg.name ? ` - ${pg.name}` : ''}`,
            shortTitle: `Fiyat ${(pg as any).code}`,
            dealers: dealers.filter((d) => d.priceGroupId === pg.id)
        }))

        const known = new Set(priceGroups.map((p) => String(p.id)))
        const orphans = dealers.filter((d) => !d.priceGroupId || !known.has(String(d.priceGroupId)))
        if (orphans.length > 0) {
            out.push({ key: '__none__', groupId: null, title: 'Fiyat grubu atanmamış', shortTitle: 'Grupsuz', dealers: orphans })
        }
        return out
    }, [dealers, priceGroups])

    const groupTitleById = useMemo(() => {
        const m = new Map<string, string>()
        for (const s of sections) if (s.groupId) m.set(s.groupId, s.shortTitle)
        return m
    }, [sections])

    /** Bayinin kapsandığı grup belirteci seçili mi (o zaman satırı tek tek işaretlemek anlamsız). */
    const coveredByGroup = (d: CustomerDto) => !!d.priceGroupId && selectedGroupIds.has(String(d.priceGroupId))

    const visibleSections = useMemo(
        () =>
            sections
                .map((s) => ({ ...s, filtered: s.dealers.filter(matchesSearch) }))
                .filter((s) => s.filtered.length > 0),
        [sections, search]
    )

    const commit = (tokens: Set<string>) => {
        onChange(Array.from(tokens))
    }

    const toggleDealer = (code: string) => {
        const set = new Set(selectedDealerCodes)
        if (set.has(code)) set.delete(code)
        else set.add(code)
        setCustomMode(true)
        commit(set)
    }

    /** Grubun tamamını seç/kaldır. Seçerken o grubun tek tek işaretleri gereksizleşir, silinir. */
    const toggleGroup = (section: { groupId: string | null; dealers: CustomerDto[] }) => {
        if (!section.groupId) return
        const set = new Set(selectedDealerCodes)
        const token = `${PRICE_GROUP_TARGET_PREFIX}${section.groupId}`
        if (set.has(token)) {
            set.delete(token)
        } else {
            set.add(token)
            for (const d of section.dealers) set.delete(d.customerCode)
        }
        setCustomMode(true)
        commit(set)
    }

    /** Grupsuz bölüm ya da arama sonucu: görünen bayileri tek tek seç/kaldır. */
    const bulkDealers = (codes: string[], selected: boolean) => {
        const set = new Set(selectedDealerCodes)
        for (const c of codes) {
            if (selected) set.add(c)
            else set.delete(c)
        }
        setCustomMode(true)
        commit(set)
    }

    const chooseAll = () => {
        setCustomMode(false)
        onChange([])
    }

    const chooseCustom = () => {
        setCustomMode(true)
    }

    const toggleExpand = (key: string) => {
        setExpanded((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    // Eski kurgu: bütün bayiler tek tek seçilmiş (yeni açılanlar dahil değil).
    const everyDealerListed = dealers.length > 0 && selectedGroupIds.size === 0 && dealers.every((d) => selectedDealerSet.has(d.customerCode))

    const groupCount = selectedGroupIds.size
    const dealerCount = selectedDealerSet.size
    const visibleSelectable = visibleSections.flatMap((s) => s.filtered.filter((d) => !coveredByGroup(d)).map((d) => d.customerCode))

    const ozet = loading
        ? 'Yükleniyor...'
        : selectedDealerCodes.length === 0
          ? 'Tüm bayiler — sonradan açılacak bayiler de dahil'
          : [
              groupCount > 0 ? `${groupCount} fiyat grubunun tamamı (yeni açılanlar dahil)` : '',
              dealerCount > 0 ? `${dealerCount} bayi tek tek` : ''
            ].filter(Boolean).join(' + ') + ' — kampanya yalnızca bunlara uygulanır'

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-700">Bayi Seçimi</div>
                    <div className={`text-[11px] ${selectedDealerCodes.length === 0 ? 'text-emerald-700 font-semibold' : 'text-gray-500'}`}>
                        {ozet}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setSearch('')
                        setCustomMode(selectedDealerCodes.length > 0)
                        setOpen(true)
                    }}
                    disabled={loading}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 whitespace-nowrap"
                >
                    <Users size={13} />
                    Bayiye göre özelleştir
                </button>
            </div>

            {everyDealerListed && (
                <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span className="flex-1">
                        Bütün bayiler <b>tek tek</b> seçili: sonradan açılan bayiler bu kampanyadan yararlanamaz.
                    </span>
                    <button type="button" onClick={chooseAll} className="shrink-0 px-2 py-0.5 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700">
                        Tüm bayilere çevir
                    </button>
                </div>
            )}

            {selectedDealerCodes.length > 0 && !everyDealerListed && (
                <div className="flex flex-wrap gap-1">
                    {Array.from(selectedGroupIds).map((gid) => (
                        <span
                            key={`pg-${gid}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold"
                        >
                            {groupTitleById.get(gid) ?? 'Fiyat grubu'} · tüm grup
                            <button
                                type="button"
                                onClick={() => {
                                    const set = new Set(selectedDealerCodes)
                                    set.delete(`${PRICE_GROUP_TARGET_PREFIX}${gid}`)
                                    commit(set)
                                }}
                                className="hover:text-indigo-900"
                            >
                                ×
                            </button>
                        </span>
                    ))}
                    {Array.from(selectedDealerSet).slice(0, 8).map((code) => (
                        <span
                            key={code}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-red-50 text-red-700 border border-red-200"
                        >
                            {code}
                            <button type="button" onClick={() => toggleDealer(code)} className="hover:text-red-900">
                                ×
                            </button>
                        </span>
                    ))}
                    {dealerCount > 8 && (
                        <span className="text-[11px] text-gray-500 px-1">+{dealerCount - 8} bayi daha</span>
                    )}
                </div>
            )}

            <Modal
                isOpen={open}
                onClose={() => setOpen(false)}
                title="Bayiye Göre Özelleştir"
                footer={
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded"
                    >
                        Tamam
                    </button>
                }
            >
                <div className="space-y-3">
                    {/* Hedefleme şekli */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={chooseAll}
                            className={`text-left rounded-lg border px-3 py-2.5 transition ${
                                allMode ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300' : 'border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                            <div className="flex items-center gap-2 text-xs font-bold text-gray-900">
                                <Globe2 size={14} className={allMode ? 'text-emerald-600' : 'text-gray-400'} />
                                Tüm bayiler
                            </div>
                            <div className="mt-0.5 text-[11px] text-gray-600">Şimdiki ve <b>sonradan açılacak</b> bütün bayiler.</div>
                        </button>
                        <button
                            type="button"
                            onClick={chooseCustom}
                            className={`text-left rounded-lg border px-3 py-2.5 transition ${
                                !allMode ? 'border-red-400 bg-red-50 ring-1 ring-red-300' : 'border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                            <div className="flex items-center gap-2 text-xs font-bold text-gray-900">
                                <ListChecks size={14} className={!allMode ? 'text-red-600' : 'text-gray-400'} />
                                Belirli gruplar / bayiler
                            </div>
                            <div className="mt-0.5 text-[11px] text-gray-600">Fiyat grubunun tamamı ya da tek tek bayi seçin.</div>
                        </button>
                    </div>

                    {allMode ? (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-800">
                            Kampanya <b>bütün bayilere</b> uygulanır. Bundan sonra açılan bayiler de kendiliğinden kapsanır.
                        </div>
                    ) : (
                        <>
                            {everyDealerListed && (
                                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                    <span className="flex-1">Bütün bayiler tek tek seçili — sonradan açılan bayiler dahil değil.</span>
                                    <button type="button" onClick={chooseAll} className="shrink-0 px-2 py-0.5 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700">
                                        Tüm bayilere çevir
                                    </button>
                                </div>
                            )}

                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Bayi kodu veya adı ile ara..."
                                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                            </div>

                            <div className="flex items-center justify-between gap-2">
                                <div className="text-xs text-gray-600">
                                    {groupCount > 0 ? `${groupCount} grup tamamı` : ''}
                                    {groupCount > 0 && dealerCount > 0 ? ' + ' : ''}
                                    {dealerCount > 0 ? `${dealerCount} bayi` : ''}
                                    {groupCount === 0 && dealerCount === 0 ? 'Henüz seçim yok' : ' seçili'}
                                </div>
                                {search.trim() && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => bulkDealers(visibleSelectable, true)}
                                            className="px-3 py-1 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
                                        >
                                            Bulunanları seç
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => bulkDealers(visibleSelectable, false)}
                                            className="px-3 py-1 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
                                        >
                                            Bulunanları kaldır
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2 max-h-[46vh] overflow-y-auto">
                                {visibleSections.length === 0 ? (
                                    <div className="px-3 py-6 text-center text-xs text-gray-500 border border-gray-200 rounded-lg">
                                        {search.trim() ? 'Aramayla eşleşen bayi yok' : 'Bayi bulunamadı'}
                                    </div>
                                ) : (
                                    visibleSections.map((section) => {
                                        const isGroupWide = !!section.groupId && selectedGroupIds.has(section.groupId)
                                        const listedInGroup = section.dealers.filter((d) => selectedDealerSet.has(d.customerCode)).length
                                        // Eski kurgu: grubun bütün bayileri tek tek işaretli.
                                        const allListedOneByOne = !!section.groupId && !isGroupWide && section.dealers.length > 0 && listedInGroup === section.dealers.length
                                        const orphanCodes = section.filtered.map((d) => d.customerCode)
                                        const orphanAllSelected = !section.groupId && orphanCodes.length > 0 && orphanCodes.every((c) => selectedDealerSet.has(c))
                                        // Arama varken eşleşen gruplar kendiliğinden açılır; aksi halde
                                        // kullanıcı hangi grubu açacağına kendisi karar verir.
                                        const isOpen = search.trim().length > 0 || expanded.has(section.key)
                                        // Çok büyük gruplarda listeyi kırp: 5000+ satırı DOM'a basmak modalı kilitliyor.
                                        const LIMIT = 300
                                        const shown = section.filtered.slice(0, LIMIT)
                                        const hiddenCount = section.filtered.length - shown.length

                                        return (
                                            <div key={section.key} className={`border rounded-lg overflow-hidden ${isGroupWide ? 'border-indigo-300' : 'border-gray-200'}`}>
                                                <div className={`flex items-center gap-2 px-3 py-2 ${isGroupWide ? 'bg-indigo-50' : 'bg-gray-50'}`}>
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleExpand(section.key)}
                                                        className="text-gray-600 hover:text-gray-900"
                                                    >
                                                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                                    </button>

                                                    <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                                                        <input
                                                            type="checkbox"
                                                            checked={section.groupId ? isGroupWide : orphanAllSelected}
                                                            onChange={() =>
                                                                section.groupId ? toggleGroup(section) : bulkDealers(orphanCodes, !orphanAllSelected)
                                                            }
                                                            className="cursor-pointer"
                                                        />
                                                        <span className="min-w-0">
                                                            <span className="block text-xs font-semibold text-gray-900 truncate">{section.title}</span>
                                                            {section.groupId && (
                                                                <span className="block text-[10.5px] text-gray-500">
                                                                    {isGroupWide ? 'Grubun tamamı — sonradan eklenecek bayiler dahil' : 'Kutuyu işaretlemek grubun tamamını seçer'}
                                                                </span>
                                                            )}
                                                        </span>
                                                    </label>

                                                    <span className={`text-[11px] whitespace-nowrap ${isGroupWide ? 'text-indigo-700 font-bold' : 'text-gray-500'}`}>
                                                        {isGroupWide ? `Tüm grup (${section.dealers.length})` : `${listedInGroup}/${section.dealers.length} bayi`}
                                                    </span>
                                                </div>

                                                {allListedOneByOne && (
                                                    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-t border-amber-100 text-[11px] text-amber-800">
                                                        <AlertTriangle size={12} className="shrink-0" />
                                                        <span className="flex-1">Bayilerin hepsi tek tek seçili — yeni açılanlar dahil değil.</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleGroup(section)}
                                                            className="shrink-0 px-2 py-0.5 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700"
                                                        >
                                                            Gruba çevir
                                                        </button>
                                                    </div>
                                                )}

                                                {isOpen && (
                                                    <div className="border-t border-gray-200">
                                                        {shown.map((dealer) => {
                                                            const covered = coveredByGroup(dealer)
                                                            return (
                                                                <label
                                                                    key={dealer.customerCode}
                                                                    className={`flex items-center gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0 ${covered ? 'opacity-60 cursor-default' : 'hover:bg-gray-50 cursor-pointer'}`}
                                                                >
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={covered || selectedDealerSet.has(dealer.customerCode)}
                                                                        disabled={covered}
                                                                        onChange={() => toggleDealer(dealer.customerCode)}
                                                                        className="cursor-pointer ml-5 disabled:cursor-default"
                                                                    />
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="text-xs font-semibold text-gray-900 truncate">
                                                                            {dealer.customerCode}
                                                                        </div>
                                                                        <div className="text-[11px] text-gray-500 truncate">{dealer.name}</div>
                                                                    </div>
                                                                </label>
                                                            )
                                                        })}
                                                        {hiddenCount > 0 && (
                                                            <div className="px-3 py-2 text-[11px] text-gray-500 bg-gray-50">
                                                                +{hiddenCount} bayi daha — daraltmak için arama kutusunu kullanın.
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })
                                )}
                            </div>

                            {groupCount === 0 && dealerCount === 0 ? (
                                <div className="text-[11px] font-semibold text-amber-700">
                                    Hiçbir grup ya da bayi seçilmedi — böyle kaydederseniz kampanya <b>tüm bayilere</b> uygulanır.
                                </div>
                            ) : (
                                <div className="text-[11px] text-gray-500">
                                    Grup kutusu fiyat grubunun <b>tamamını</b> seçer (gruba sonradan eklenen bayiler dahil). Tek tek
                                    işaretlenen bayilerde yalnız o bayiler kampanyadan yararlanır.
                                </div>
                            )}
                        </>
                    )}
                </div>
            </Modal>
        </div>
    )
}
