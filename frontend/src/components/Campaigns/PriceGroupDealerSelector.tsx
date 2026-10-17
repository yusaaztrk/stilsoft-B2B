import React, { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Users, Search } from 'lucide-react'
import Modal from '../Modal'
import { fetchPriceGroups, type PriceGroupDto } from '../../api/priceGroups'
import { fetchCustomers, type CustomerDto } from '../../api/customers'

type Props = {
    selectedPriceGroupCodes: number[]
    selectedDealerCodes: string[]
    onPriceGroupToggle: (code: number) => void
    onDealerToggle: (dealerCode: string) => void
    /** Bir fiyat grubunun bayilerini toplu ekle/çıkar (modaldaki "Tümünü seç" / "Temizle"). */
    onDealersBulkChange?: (dealerCodes: string[], selected: boolean) => void
}

export default function PriceGroupDealerSelector({
    selectedPriceGroupCodes,
    selectedDealerCodes,
    onPriceGroupToggle,
    onDealerToggle,
    onDealersBulkChange
}: Props) {
    const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])
    const [dealers, setDealers] = useState<CustomerDto[]>([])
    const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())
    const [loading, setLoading] = useState(false)
    const [showAll, setShowAll] = useState(false)

    // "Bayiye göre özelleştir" modalı
    const [dealerModalCode, setDealerModalCode] = useState<number | null>(null)
    const [dealerSearch, setDealerSearch] = useState('')

    useEffect(() => {
        void (async () => {
            try {
                setLoading(true)
                const [pgData, dealerData] = await Promise.all([
                    fetchPriceGroups({ includeInactive: false }),
                    fetchCustomers({ includeInactive: false })
                ])
                setPriceGroups(pgData)
                setDealers(dealerData)
            } catch (e: any) {
                console.error('Failed to load price groups or dealers:', e)
            } finally {
                setLoading(false)
            }
        })()
    }, [])

    const toggleGroup = (code: number) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev)
            if (next.has(code)) {
                next.delete(code)
            } else {
                next.add(code)
            }
            return next
        })
    }

    const getDealersForPriceGroup = (priceGroupId?: string) => {
        if (!priceGroupId) return []
        return dealers.filter((d) => d.priceGroupId === priceGroupId)
    }

    const handleShowAll = () => {
        setShowAll(true)
        setExpandedGroups(new Set(priceGroupCodes))
    }

    const handleHideAll = () => {
        setShowAll(false)
        setExpandedGroups(new Set())
    }

    // Fiyat grupları veritabanından geliyor; sayıları SABİT DEĞİL. Eskiden kampanya tarafı
    // 1..6 varsayıyordu ve 7. grup (Askeriye Tipi Fatura) hiç kaydedilemiyordu.
    const priceGroupCodes = useMemo(
        () =>
            priceGroups
                .map((pg) => Number((pg as any).code))
                .filter((code) => Number.isFinite(code))
                .sort((a, b) => a - b),
        [priceGroups]
    )

    const modalGroup = useMemo(
        () => (dealerModalCode == null ? null : priceGroups.find((x) => Number((x as any).code) === dealerModalCode) ?? null),
        [dealerModalCode, priceGroups]
    )

    const modalDealers = useMemo(() => getDealersForPriceGroup(modalGroup?.id), [modalGroup, dealers])

    const modalFilteredDealers = useMemo(() => {
        const q = dealerSearch.trim().toLocaleLowerCase('tr')
        if (!q) return modalDealers
        return modalDealers.filter((d) => {
            const code = String(d.customerCode ?? '').toLocaleLowerCase('tr')
            const name = String(d.name ?? '').toLocaleLowerCase('tr')
            return code.includes(q) || name.includes(q)
        })
    }, [modalDealers, dealerSearch])

    const openDealerModal = (code: number) => {
        setDealerSearch('')
        setDealerModalCode(code)
    }

    const bulkChange = (codes: string[], selected: boolean) => {
        if (onDealersBulkChange) {
            onDealersBulkChange(codes, selected)
            return
        }
        // Geriye dönük: toplu geri çağırma verilmediyse tek tek çevir.
        for (const c of codes) {
            const already = selectedDealerCodes.includes(c)
            if (already !== selected) onDealerToggle(c)
        }
    }

    if (loading) {
        return <div className="text-xs text-gray-500">Yükleniyor...</div>
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-700">Bayi Fiyat Grupları</div>
                <button
                    type="button"
                    onClick={showAll ? handleHideAll : handleShowAll}
                    className="px-3 py-1 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
                >
                    {showAll ? 'Daralt' : 'Hepsi'}
                </button>
            </div>

            <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                Bir fiyat grubunu işaretlemek kampanyayı o gruptaki <b>tüm bayilere</b> uygular.
                Sadece belirli bayilere uygulamak için <b>Bayiye göre özelleştir</b>'i kullanın.
                Hiç bayi seçilmezse kampanya seçili fiyat gruplarındaki herkese açıktır.
            </div>

            <div className="space-y-2">
                {priceGroupCodes.map((code) => {
                    const pg = priceGroups.find((x) => Number((x as any).code) === code)
                    const pgName = pg?.name
                    const isExpanded = expandedGroups.has(code)
                    const groupDealers = getDealersForPriceGroup(pg?.id)
                    const isGroupChecked = selectedPriceGroupCodes.includes(code)
                    const selectedInGroup = groupDealers.filter((d) => selectedDealerCodes.includes(d.customerCode)).length

                    return (
                        <div key={code} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100">
                                <button
                                    type="button"
                                    onClick={() => toggleGroup(code)}
                                    className="flex items-center justify-center w-5 h-5 text-gray-600 hover:text-gray-900"
                                >
                                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </button>

                                <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                                    <input
                                        type="checkbox"
                                        checked={isGroupChecked}
                                        onChange={() => onPriceGroupToggle(code)}
                                        className="cursor-pointer"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-semibold text-gray-900 truncate">{`Fiyat ${code}`}</div>
                                        <div className="text-[11px] text-gray-500 truncate">{pgName ?? String(code)}</div>
                                    </div>
                                </label>

                                <div className="text-[11px] text-gray-500 whitespace-nowrap">
                                    {selectedInGroup > 0 ? `${selectedInGroup}/${groupDealers.length} bayi` : `${groupDealers.length} bayi`}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => openDealerModal(code)}
                                    disabled={groupDealers.length === 0}
                                    className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                                >
                                    <Users size={12} />
                                    Bayiye göre özelleştir
                                </button>
                            </div>

                            {isExpanded && (
                                <div className="border-t border-gray-200">
                                    {groupDealers.length === 0 ? (
                                        <div className="px-3 py-2 text-xs text-gray-500">Bu fiyat grubunda bayi yok</div>
                                    ) : (
                                        <div className="max-h-48 overflow-y-auto">
                                            {groupDealers.map((dealer) => (
                                                <label
                                                    key={dealer.customerCode}
                                                    className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedDealerCodes.includes(dealer.customerCode)}
                                                        onChange={() => onDealerToggle(dealer.customerCode)}
                                                        className="cursor-pointer ml-7"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-medium text-gray-900 truncate">
                                                            {dealer.customerCode}
                                                        </div>
                                                        <div className="text-[11px] text-gray-500 truncate">{dealer.name}</div>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            <Modal
                isOpen={dealerModalCode != null}
                onClose={() => setDealerModalCode(null)}
                title={`Fiyat ${dealerModalCode ?? ''} — Bayiye Göre Özelleştir`}
                footer={
                    <button
                        type="button"
                        onClick={() => setDealerModalCode(null)}
                        className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded"
                    >
                        Tamam
                    </button>
                }
            >
                <div className="space-y-3">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            value={dealerSearch}
                            onChange={(e) => setDealerSearch(e.target.value)}
                            placeholder="Bayi kodu veya adı ile ara..."
                            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                    </div>

                    <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-gray-600">
                            {modalFilteredDealers.length} bayi listeleniyor
                            {dealerSearch.trim() ? ` (${modalDealers.length} içinden)` : ''}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => bulkChange(modalFilteredDealers.map((d) => d.customerCode), true)}
                                className="px-3 py-1 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
                            >
                                Tümünü seç
                            </button>
                            <button
                                type="button"
                                onClick={() => bulkChange(modalFilteredDealers.map((d) => d.customerCode), false)}
                                className="px-3 py-1 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
                            >
                                Temizle
                            </button>
                        </div>
                    </div>

                    <div className="border border-gray-200 rounded-lg max-h-[50vh] overflow-y-auto">
                        {modalFilteredDealers.length === 0 ? (
                            <div className="px-3 py-6 text-center text-xs text-gray-500">
                                {dealerSearch.trim() ? 'Aramayla eşleşen bayi yok' : 'Bu fiyat grubunda bayi yok'}
                            </div>
                        ) : (
                            modalFilteredDealers.map((dealer) => (
                                <label
                                    key={dealer.customerCode}
                                    className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedDealerCodes.includes(dealer.customerCode)}
                                        onChange={() => onDealerToggle(dealer.customerCode)}
                                        className="cursor-pointer"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-semibold text-gray-900 truncate">{dealer.customerCode}</div>
                                        <div className="text-[11px] text-gray-500 truncate">{dealer.name}</div>
                                    </div>
                                </label>
                            ))
                        )}
                    </div>

                    <div className="text-[11px] text-gray-500">
                        Bu gruptan hiç bayi seçmezseniz kampanya gruptaki <b>tüm bayilere</b> uygulanır.
                    </div>
                </div>
            </Modal>
        </div>
    )
}
