import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useOutletContext } from 'react-router-dom'
import { fetchCustomersDropdown, type CustomerDto } from '../api/customers'
import { updateInvoiceHeader } from '../api/invoices'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'
import { API_BASE_URL } from '../config/api'

type LayoutContext = {
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function parseMontajTag(desc: string | null | undefined) {
  const s = String(desc ?? '')
  if (!s) return null
  const m = s.match(/\[MONTAJ\s+net=([0-9.]+)\s+vat=([0-9.]+)\s+gross=([0-9.]+)\s+rate=([0-9.]+)\]/i)
  if (!m) return null
  const gross = Number(m[3])
  if (!Number.isFinite(gross) || gross <= 0) return null
  return { gross }
}

function normalizeInvoiceHeaderDescription(desc: string | null | undefined) {
  const s = String(desc ?? '').trim()
  if (!s) return ''

  const tag = parseMontajTag(s)
  const parts = s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !/^Montaj\s*\(KDV\s*hariç\)/i.test(x))
    .filter((x) => !/^\[MONTAJ\s+/i.test(x))

  if (tag) parts.push(`Montaj = ${formatMoney(tag.gross)}`)
  return parts.join('\n')
}

function normalizeInvoiceLineDescription(desc: string | null | undefined) {
  const s = String(desc ?? '').trim()
  if (!s) return ''

  const tag = parseMontajTag(s)
  const parts = s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !/^Montaj\s*\(KDV\s*hariç\)/i.test(x))
    .filter((x) => !/^\[MONTAJ\s+/i.test(x))

  if (tag) parts.push(`Montaj = ${formatMoney(tag.gross)}`)
  return parts.join('\n')
}

function normalizeInvoiceTypeLabel(v: any) {
  const s = String(v ?? '')
    .trim()
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'I')
  if (!s) return ''
  if (s === 'AÇIK' || s === 'ACIK') return 'ACIK'
  if (s === 'FATURA') return 'FATURA'
  return s
}

export default function InvoiceDetailPage() {
  const { id } = useParams()

  const navigate = useNavigate()

  const { isSuperAdmin, allowedKeys } = useOutletContext<LayoutContext>()
  const canUpdateHeader =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/faturaDokum')) && Boolean(allowedKeys?.has('invoice/faturaDokumUstBilgiGuncelle')))

  const invoiceId = useMemo(() => Number(id), [id])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [header, setHeader] = useState<any | null>(null)
  const [lines, setLines] = useState<any[] | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [customersLoading, setCustomersLoading] = useState(false)
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [priceGroupsLoading, setPriceGroupsLoading] = useState(false)
  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])
  const [editForm, setEditForm] = useState({
    invoiceNo: '',
    customerCode: '',
    invoiceType: '',
    priceGroupId: '',
    description: '',
    installationName: '',
    installationPhone: '',
    exchangeRate: '1',
    currencyTypeId: 0
  })

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setCustomersLoading(true)
        const list = await fetchCustomersDropdown({ includeInactive: false, includeMuhtelif: false, signal: ac.signal })
        setCustomers(list ?? [])
      } catch {
        setCustomers([])
      } finally {
        setCustomersLoading(false)
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setPriceGroupsLoading(true)
        const list = await fetchPriceGroups({ includeInactive: false })
        setPriceGroups(list ?? [])
      } catch {
        setPriceGroups([])
      } finally {
        setPriceGroupsLoading(false)
      }
    })()
    return () => ac.abort()
  }, [])

  const load = async () => {
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      setError('Geçersiz fatura id')
      return
    }

    try {
      setLoading(true)
      setError(null)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const [hRes, lRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(String(invoiceId))}`, { headers }),
        fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(String(invoiceId))}/lines`, { headers })
      ])

      if (!hRes.ok) {
        const text = await hRes.text()
        throw new Error(text || 'Fatura bilgileri alınamadı')
      }

      if (!lRes.ok) {
        const text = await lRes.text()
        throw new Error(text || 'Fatura kalemleri alınamadı')
      }

      const hJson = await hRes.json()
      const lJson = await lRes.json()
      setHeader(hJson?.data ?? null)
      setLines((lJson?.data ?? []) as any[])
    } catch (e: any) {
      setError(e?.message ?? 'Bir hata oluştu')
      setHeader(null)
      setLines(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [invoiceId])

  const openHeaderEdit = () => {
    setEditForm({
      invoiceNo: String(header?.faturaNo ?? ''),
      customerCode: String(header?.cariKodu ?? ''),
      invoiceType: String(header?.faturaAcik ?? ''),
      priceGroupId: '',
      description: normalizeInvoiceHeaderDescription(String(header?.aciklama ?? '')),
      installationName: String(header?.montajIsim ?? ''),
      installationPhone: String(header?.montajTelefon ?? ''),
      exchangeRate: header?.exchangeRate ? String(header.exchangeRate) : '1',
      currencyTypeId: Number(header?.currencyTypeId ?? 0)
    })
    setEditOpen(true)
  }

  const submitHeaderEdit = async () => {
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) return
    try {
      setEditSaving(true)
      setError(null)

      const prevType = normalizeInvoiceTypeLabel(header?.faturaAcik)
      const nextType = normalizeInvoiceTypeLabel(editForm.invoiceType)
      const isAcikToFatura = prevType === 'ACIK' && nextType === 'FATURA'
      if (isAcikToFatura && !String(editForm.priceGroupId ?? '').trim()) {
        setError('FATURA tipine geçiş için fiyat grubu seçilmelidir')
        return
      }

      await updateInvoiceHeader(invoiceId, {
        invoiceNo: editForm.invoiceNo.trim() || undefined,
        customerCode: editForm.customerCode.trim() || undefined,
        customerInvoiceTypeOverride: editForm.invoiceType.trim() || undefined,
        priceGroupId: isAcikToFatura ? String(editForm.priceGroupId).trim() : undefined,
        description: editForm.description.trim() || undefined,
        installationName: editForm.installationName.trim() || undefined,
        installationPhone: editForm.installationPhone.trim() || undefined,
        exchangeRate: Number(String(editForm.exchangeRate).replace(',', '.')) || undefined
      })

      setEditOpen(false)
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Bir hata oluştu')
    } finally {
      setEditSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Fatura Dökümü</h1>
          <p className="text-xs text-gray-400 mt-0.5">Fatura İşlemleri / Detay</p>
        </div>
        <div className="flex items-center gap-2">
          {canUpdateHeader && header && (
            <button
              type="button"
              onClick={openHeaderEdit}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              Üst Bilgi Güncelle
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            Yenile
          </button>
          <button
            type="button"
            onClick={() => navigate('/invoice/fatura-listesi')}
            className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
          >
            FATURA LİSTESİ
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}
      {loading && <div className="mt-2 text-xs text-gray-500">Yükleniyor...</div>}

      {header && (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-300">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">İşlem Tipi</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Tarih</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Fatura No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Cari Adı</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Fatura/Açık</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wide">Brüt Tutar</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wide">İskonto</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wide text-emerald-700">İndirim/Kampanya</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wide">Net Tutar</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wide">KDV Tutarı</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wide">Genel Toplam</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Plasiyer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">İşlem Yapan</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-200 bg-white">
                <td className="px-4 py-3 text-sm text-gray-800">{String(header.islemTipi ?? '')}</td>
                <td className="px-4 py-3 text-sm text-gray-800">{new Date(String(header.tarih ?? '')).toLocaleDateString('tr-TR')}</td>
                <td className="px-4 py-3 text-sm text-gray-800">{String(header.faturaNo ?? '')}</td>
                <td className="px-4 py-3 text-sm text-gray-800">{String(header.cariAdi ?? '')}</td>
                <td className="px-4 py-3 text-sm text-gray-800">{String(header.faturaAcik ?? '')}</td>
                <td className="px-4 py-3 text-sm text-gray-800 text-right font-semibold">{formatMoney(Number(header.brutTutar ?? 0))}</td>
                <td className="px-4 py-3 text-sm text-gray-800 text-right">{formatMoney(Number(header.iskonto ?? 0))}</td>
                <td className="px-4 py-3 text-sm text-emerald-700 text-right font-semibold">-{formatMoney(Number(header.kampanyaIndirimi ?? 0))}</td>
                <td className="px-4 py-3 text-sm text-gray-800 text-right">{formatMoney(Number(header.netTutar ?? 0))}</td>
                <td className="px-4 py-3 text-sm text-gray-800 text-right">{formatMoney(Number(header.kdvTutari ?? 0))}</td>
                <td className="px-4 py-3 text-sm text-gray-800 text-right">{formatMoney(Number(header.genelToplam ?? 0))}</td>
                <td className="px-4 py-3 text-sm text-gray-800">{String(header.plasiyer ?? '')}</td>
                <td className="px-4 py-3 text-sm text-gray-800">{String(header.islemYapan ?? '')}</td>
              </tr>

              <tr className="bg-white">
                <td colSpan={12} className="px-4 py-3">
                  <div className="border border-gray-200 rounded overflow-hidden">
                    <div className="grid grid-cols-13 bg-gray-50 text-[11px] font-semibold text-gray-600 px-3 py-2">
                      <div className="col-span-2">Stok Kodu</div>
                      <div className="col-span-3">Stok Adı</div>
                      <div className="col-span-2">Açıklama</div>
                      <div className="col-span-1 text-right">KDV</div>
                      <div className="col-span-1 text-right">Miktar</div>
                      <div className="col-span-1 text-right">Birim Fiyat</div>
                      <div className="col-span-1 text-right">İndirim</div>
                      <div className="col-span-2 text-right">Net Toplam</div>
                    </div>

                    {!lines ? (
                      <div className="p-4 text-sm text-gray-500">Detay yükleniyor...</div>
                    ) : lines.length === 0 ? (
                      <div className="p-4 text-sm text-gray-500">Kalem bulunamadı.</div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {lines.map((l: any, i: number) => {
                          const unitPrice = Number(l.unitPrice ?? 0)
                          const qty = Number(l.quantity ?? 0)
                          const discount = Number(l.discountAmount ?? 0)
                          const grossTotal = unitPrice * qty
                          const netTotal = Math.max(0, grossTotal - discount)

                          return (
                            <div key={String(l.id ?? i)} className={`grid grid-cols-13 px-3 py-2 text-[11px] items-center ${l.isGift ? 'bg-green-50/20' : ''}`}>
                              <div className="col-span-2">{String(l.stockCode ?? '')}</div>
                              <div className="col-span-3 flex items-center gap-1 min-w-0">
                                <span className="truncate">{String(l.stockName ?? '')}</span>
                                {l.isGift && (
                                  <span className="px-1 py-0.5 rounded bg-green-100 text-green-700 text-[8px] font-extrabold uppercase shrink-0">Hediye</span>
                                )}
                              </div>
                              <div className="col-span-2 truncate" title={(() => {
                                let desc = normalizeInvoiceLineDescription(l.description);
                                const isGift = Boolean(l.isGift);
                                const discount = Number(l.discountAmount ?? 0);
                                let campaignNote = '';
                                if (isGift) {
                                  campaignNote = '(Kampanya - Hediye)';
                                } else if (discount > 0) {
                                  campaignNote = '(Kampanya İndirimi)';
                                }
                                
                                if (campaignNote && !desc.includes('Kampanya')) {
                                  desc = desc ? `${desc} ${campaignNote}` : campaignNote;
                                }
                                return desc;
                              })()}>
                                {(() => {
                                  let desc = normalizeInvoiceLineDescription(l.description);
                                  const isGift = Boolean(l.isGift);
                                  const discount = Number(l.discountAmount ?? 0);
                                  let campaignNote = '';
                                  if (isGift) {
                                    campaignNote = '(Kampanya - Hediye)';
                                  } else if (discount > 0) {
                                    campaignNote = '(Kampanya İndirimi)';
                                  }
                                  
                                  if (campaignNote && !desc.includes('Kampanya')) {
                                    desc = desc ? `${desc} ${campaignNote}` : campaignNote;
                                  }
                                  return desc;
                                })()}
                              </div>
                              <div className="col-span-1 text-right">{Number(l.vatRate ?? 0)}%</div>
                              <div className="col-span-1 text-right">{qty}</div>
                              <div className="col-span-1 text-right">
                                {l.isGift && discount > 0 ? (
                                  <>
                                    <div className="text-[10px] text-gray-400 line-through">{formatMoney(unitPrice)}</div>
                                    <div className="text-green-600 font-bold">0.00</div>
                                  </>
                                ) : (
                                  formatMoney(unitPrice)
                                )}
                              </div>
                              <div className="col-span-1 text-right text-green-600 font-semibold">
                                {discount > 0 ? `-${formatMoney(discount)}` : '0.00'}
                              </div>
                              <div className="col-span-2 text-right font-extrabold text-orange-600">
                                {formatMoney(netTotal)}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onMouseDown={() => !editSaving && setEditOpen(false)} />
          <div className="relative z-10 w-full max-w-xl mx-4 bg-white rounded-xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800">Üst Bilgi Güncelle</div>
              <button
                type="button"
                disabled={editSaving}
                onClick={() => setEditOpen(false)}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700"
              >
                Kapat
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Fatura No</div>
                <input
                  value={editForm.invoiceNo}
                  onChange={(e) => setEditForm((p) => ({ ...p, invoiceNo: e.target.value }))}
                  className="input-base h-9 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Cari</div>
                  <select
                    value={editForm.customerCode}
                    onChange={(e) => setEditForm((p) => ({ ...p, customerCode: e.target.value }))}
                    className="input-base h-9 text-sm"
                    disabled={customersLoading}
                  >
                    <option value="">{customersLoading ? 'Yükleniyor...' : 'Seçiniz...'}</option>
                    {(customers ?? []).map((c) => (
                      <option key={c.customerCode} value={c.customerCode}>
                        {`${c.customerCode} - ${c.name ?? ''}`.trim()}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Açık/Fatura</div>
                  <select
                    value={editForm.invoiceType}
                    onChange={(e) => setEditForm((p) => ({ ...p, invoiceType: e.target.value }))}
                    className="input-base h-9 text-sm"
                  >
                    {normalizeInvoiceTypeLabel(header?.faturaAcik) === 'FATURA' ? (
                      <option value="FATURA">FATURA</option>
                    ) : (
                      <>
                        <option value="">Seçiniz...</option>
                        <option value="Açık">Açık</option>
                        <option value="FATURA">FATURA</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {(() => {
                const prevType = normalizeInvoiceTypeLabel(header?.faturaAcik)
                const nextType = normalizeInvoiceTypeLabel(editForm.invoiceType)
                const isAcikToFatura = prevType === 'ACIK' && nextType === 'FATURA'
                if (!isAcikToFatura) return null
                const opts = (priceGroups ?? []).filter((x) => String(x.invoiceType ?? '').trim().toUpperCase() === 'FATURA')
                return (
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Fiyat Grubu</div>
                    <select
                      value={editForm.priceGroupId}
                      onChange={(e) => setEditForm((p) => ({ ...p, priceGroupId: e.target.value }))}
                      className="input-base h-9 text-sm"
                      disabled={priceGroupsLoading}
                    >
                      <option value="">{priceGroupsLoading ? 'Yükleniyor...' : 'Seçiniz...'}</option>
                      {opts.map((pg) => (
                        <option key={String(pg.id)} value={String(pg.id)}>
                          {`${pg.code} - ${pg.name}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })()}

              {editForm.currencyTypeId > 1 && (
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                    {`Döviz Kuru (${editForm.currencyTypeId === 2 ? 'EUR' : editForm.currencyTypeId === 3 ? 'USD' : editForm.currencyTypeId === 4 ? 'GBP' : 'Döviz'})`}
                  </div>
                  <input
                    type="text"
                    value={editForm.exchangeRate}
                    onChange={(e) => setEditForm((p) => ({ ...p, exchangeRate: e.target.value }))}
                    className="input-base h-9 text-sm"
                    placeholder="1.0000"
                  />
                </div>
              )}

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Açıklama</div>
                <input
                  value={editForm.description}
                  onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                  className="input-base h-9 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Montaj İsim</div>
                  <input
                    value={editForm.installationName}
                    onChange={(e) => setEditForm((p) => ({ ...p, installationName: e.target.value }))}
                    className="input-base h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Montaj Telefon</div>
                  <input
                    value={editForm.installationPhone}
                    onChange={(e) => setEditForm((p) => ({ ...p, installationPhone: e.target.value }))}
                    className="input-base h-9 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={editSaving}
                onClick={() => setEditOpen(false)}
                className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={editSaving}
                onClick={() => void submitHeaderEdit()}
                className="px-4 py-2 rounded-md text-xs font-semibold bg-brand-blue text-white hover:opacity-95"
              >
                {editSaving ? 'Kaydediliyor...' : 'Güncelle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
