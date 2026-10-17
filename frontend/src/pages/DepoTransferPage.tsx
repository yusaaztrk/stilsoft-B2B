import React, { useEffect, useMemo, useState } from 'react'
import { fetchAllPages } from '../lib/fetchAllPages'
import { FileText, Plus, Printer, Search, Trash2 } from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import Modal from '../components/Modal'
import Table, { type TableColumn } from '../components/Table'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import { fetchProducts } from '../api/products'
import { useProductCategories } from '../hooks/useProductCategories'
import { createWarehouseTransfer, deleteWarehouseTransfer, fetchWarehouseTransfers, type CreateWarehouseTransferPayload, type WarehouseTransferListItem } from '../api/warehouseTransfers'
import { fetchAuthorizedStockBalances, fetchWarehousesDropdown } from '../api/warehouses'

function isAbortError(e: any) {
  if (!e) return false
  const name = String(e?.name ?? '')
  const msg = String(e?.message ?? '')
  return name === 'AbortError' || msg.toLowerCase().includes('aborted')
}

function formatQty(n: number) {
  const v = Number(n ?? 0)
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type WarehouseOption = { value: string; label: string }

type PickedProduct = { stockCode: string; name: string }

type TransferLine = {
  stockCode: string
  stockName?: string
  quantity: string
}

export default function DepoTransferPage() {
  const { isSuperAdmin, allowedKeys } = useOutletContext<{ isSuperAdmin?: boolean; allowedKeys?: Set<string> }>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [rows, setRows] = useState<WarehouseTransferListItem[]>([])

  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([])

  const warehouseLabelByCode = useMemo(() => {
    const out: Record<string, string> = {}
    for (const o of warehouseOptions) {
      const v = String(o.value ?? '').trim()
      if (!v) continue
      out[v] = String(o.label ?? '').trim()
    }
    return out
  }, [warehouseOptions])

  const columns = useMemo<TableColumn<WarehouseTransferListItem>[]>(
    () => [
      { key: 'transferNo', label: 'Belge No', searchable: true },
      { key: 'date', label: 'Tarih', searchable: true, filter: { type: 'date' }, render: (v) => String(v ?? '').slice(0, 10) },
      { key: 'description', label: 'Açıklama', searchable: true },
      {
        key: 'fromWarehouseCode',
        label: 'Çıkış Depo',
        searchable: true,
        render: (v) => warehouseLabelByCode[String(v ?? '')] ?? String(v ?? '')
      },
      {
        key: 'toWarehouseCode',
        label: 'Giriş Depo',
        searchable: true,
        render: (v) => warehouseLabelByCode[String(v ?? '')] ?? String(v ?? '')
      },
      {
        key: 'isConsignment',
        label: 'Konsinye',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Evet', value: 'true' },
            { label: 'Hayır', value: 'false' }
          ]
        },
        render: (v) => (v ? 'Evet' : 'Hayır')
      },
      { key: 'lineCount', label: 'Kalem', render: (v) => String(v ?? 0) },
      {
        key: 'lines',
        label: 'Ürün / Adet',
        // Liste eskiden yalnizca "Kalem: 1" diyordu; hangi urunden kac adet gittigi
        // hicbir yerde gorunmuyordu. Her kalem ayri satir olarak yazilir.
        accessorFn: (r) =>
          (r.lines ?? [])
            .map((l) => `${l.stockName || l.stockCode} x ${formatQty(Number(l.quantity))}`)
            .join(' | '),
        render: (_v, row) => {
          const ls = row.lines ?? []
          if (ls.length === 0) return <span className="text-slate-300">-</span>
          return (
            <div className="flex flex-col gap-0.5 py-0.5">
              {ls.map((l) => (
                <div key={`${row.id}-${l.lineNo}-${l.stockCode}`} className="flex items-baseline gap-2 leading-tight">
                  <span className="font-semibold text-slate-700 truncate max-w-[260px]" title={`${l.stockCode} ${l.stockName ?? ''}`}>
                    {l.stockName || l.stockCode}
                  </span>
                  <span className="shrink-0 text-[11px] font-bold text-indigo-700 tabular-nums">
                    x {formatQty(Number(l.quantity))}
                  </span>
                </div>
              ))}
            </div>
          )
        }
      },
      {
        key: 'id',
        label: 'İşlem',
        render: (_, row) => {
          const canDeleteAll = isSuperAdmin || allowedKeys?.has('deleteRule/tumIslemleriSilebilsin') || allowedKeys?.has('deleteRule/deleteRule/tumIslemleriSilebilsin')
          const currentUsername = (localStorage.getItem('userName') || '').toLowerCase()
          // `islemYapan` diye bir alan yok: API `CreateUser` donuyor ve liste de onu gosteriyor.
          // Olu yedek, tip hatasi uretiyordu.
          const recordUser = String(row.createUser || '').toLowerCase()
          const isOwner = Boolean(currentUsername) && currentUsername === recordUser
          const allowedDelete = canDeleteAll || isOwner

          return (
            <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              title="Transfer belgesini oluştur ve yazdır"
              className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-md text-[11px] font-medium transition-colors border bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-100 cursor-pointer"
              onClick={() => openTransferDocument(row.id)}
            >
              <FileText size={11} strokeWidth={2.5} />
              Belge Oluştur
            </button>
            <button
              type="button"
              disabled={!allowedDelete}
              title={!allowedDelete ? 'Bu işlemi sadece işlemi yapan kullanıcı silebilir' : undefined}
              className={
                'inline-flex items-center gap-1 h-[26px] px-2.5 rounded-md text-[11px] font-medium transition-colors border ' +
                (allowedDelete
                  ? 'bg-red-50 text-red-600 hover:bg-red-100 border-red-100 cursor-pointer'
                  : 'bg-transparent text-slate-300 border-slate-200 cursor-not-allowed')
              }
              onClick={() => {
                if (!allowedDelete) return
                void removeTransfer(row.id)
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={allowedDelete ? 'text-red-600' : 'text-slate-300'}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              Sil
            </button>
            </div>
          )
        }
      }
    ],
    [warehouseLabelByCode, isSuperAdmin, allowedKeys]
  )

  /**
   * Transfer belgesini acar.
   *
   * `/print/preview` uzerinden aciliyor, bos bir sekmeye yazilarak DEGIL: `about:blank`
   * bir sekmede belgedeki `/stilsoft-logo.png` kok yolu hicbir yere cozulmez ve logo
   * gorunmez (ayni tuzaga cek bordrosunda da dusulmustu). Ustelik onizleyici yazdir /
   * disa aktar araç cubugunu da kendisi getiriyor.
   *
   * Belge KAYIT basinadir: 3 kalemli bir transfer tek belgede 3 satir olarak basilir.
   */
  const openTransferDocument = (id: number) => {
    if (!Number.isFinite(id) || id <= 0) return
    window.open(`/print/preview?type=warehouseTransfer&id=${encodeURIComponent(String(id))}`, '_blank')
  }

  /**
   * Stok secim ekraninda adet gosterme yetkisi.
   *
   * Fatura ekranindaki "12+" kurali ile AYNI anahtar: yetki varsa gercek adet, yoksa
   * 12 uzeri "12+" olarak gorunur. Iki ekranin ayni anahtardan beslenmesi istendi.
   */
  const canSeeWarehouseBalance = Boolean(isSuperAdmin) || Boolean(allowedKeys?.has('invoice/satisFaturaDepoBakiyeGorsun'))

  /** Stok kodu (kucuk harf) -> secili CIKIS deposundaki bakiye. */
  const [pickerBalances, setPickerBalances] = useState<Map<string, number>>(new Map())

  const loadWarehouses = async (signal?: AbortSignal) => {
    try {
      const list = await fetchWarehousesDropdown({ signal })
      setWarehouseOptions([{ value: '', label: 'Seçiniz...' }, ...(list ?? []).map((x: any) => ({ value: String(x.warehouseCode), label: `${x.warehouseCode} ${x.name ?? ''}`.trim() }))])
    } catch {
      setWarehouseOptions([{ value: '', label: 'Seçiniz...' }])
    }
  }

  const loadList = async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      // Bütün kayıtlar sayfa sayfa (2026-10-08): eskiden yalnız son 200 geliyordu, eski kayıtlar
      // aramada/süzgeçte görünmüyordu. İlk sayfa hemen ekrana basılır, kalanlar arkadan eklenir.
      await fetchAllPages((skip, take) => fetchWarehouseTransfers({ take, skip }, { signal }), {
        key: (x: any) => String(x.id),
        onPage: (all, first) => {
          setRows(all as any)
          if (first) setLoading(false)
        }
      })
    } catch (e: any) {
      if (isAbortError(e)) return
      setRows([])
      setError(String(e?.message ?? 'Transferler alınamadı'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadWarehouses(ac.signal)
    void loadList(ac.signal)
    return () => ac.abort()
  }, [])

  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    transferNo: '',
    date: new Date().toISOString().slice(0, 10),
    description: '',
    deliveryAddress: '',
    fromWarehouseCode: '',
    toWarehouseCode: '',
    isConsignment: false
  })

  const [lines, setLines] = useState<TransferLine[]>([])

  const openCreate = () => {
    setForm({
      transferNo: '',
      date: new Date().toISOString().slice(0, 10),
      description: '',
      deliveryAddress: '',
      fromWarehouseCode: '',
      toWarehouseCode: '',
      isConsignment: false
    })
    setLines([])
    setError(null)
    setModalOpen(true)
  }

  /**
   * Seçilen satırın HEMEN ALTINA boş bir satır ekler.
   *
   * SEÇİCİ PENCERESİNİ AÇMAZ (2026-08-31 kullanıcı düzeltmesi: "basınca direk alt satıra
   * eklicekti"). Müşteri teklifi ekranında "Satır Ekle" boş satır açıyor, ürün sonra o
   * satırdan seçiliyor; burası ise her eklemede pencereyi zorla açıyordu. Satırdaki "Seç"
   * düğmesi pencereyi kullanıcı istediğinde açar.
   */
  const insertLineBelow = (idx: number) => {
    setLines((prev) => {
      const next = [...prev]
      next.splice(idx + 1, 0, { stockCode: '', stockName: '', quantity: '1' })
      return next
    })
  }

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx))
  }

  // Product picker
  const [pickerOpen, setPickerOpen] = useState(false)
  /** Modal acikken kac kalem eklendi. */
  const [eklenenSayisi, setEklenenSayisi] = useState(0)
  const [pickedLineIndex, setPickedLineIndex] = useState<number | null>(null)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerItems, setPickerItems] = useState<any[]>([])

  const { data: categoriesState } = useProductCategories({ includeDealer: false })
  const [pickerMainCat, setPickerMainCat] = useState('')
  const [pickerSubCat, setPickerSubCat] = useState('')
  /*
    SEÇİCİDE MİKTAR (2026-09-20 kullanıcı isteği): "Satır Ekle"nin solunda adet kutusu; kalem
    o adetle eklenir. Eskiden satır 1 adetle geliyor, miktar SONRADAN yazılıyordu — iki adım.
    Ürün bazında tutulur (stok kodu → yazılan adet); boş/geçersizse 1.
  */
  const [pickerQtyByCode, setPickerQtyByCode] = useState<Record<string, string>>({})
  const pickerQtyOf = (code: string) => {
    const raw = String(pickerQtyByCode[code] ?? '').replace(',', '.').trim()
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? raw : '1'
  }

  const searchProducts = async (q: string, filters?: { main?: string; sub?: string }) => {
    try {
      setPickerLoading(true)
      setPickerError(null)

      const main = filters?.main !== undefined ? filters.main : pickerMainCat
      const sub = filters?.sub !== undefined ? filters.sub : pickerSubCat

      const res = await fetchProducts({
        q,
        main: main || undefined,
        sub: sub || undefined,
        page: 1,
        pageSize: 50,
        includeDealer: false,
        includeInactive: false
      })

      const items = res.items ?? []
      setPickerItems(items)

      // Secili CIKIS deposundaki bakiyeler. Depo secilmemisse adet gosterilmez:
      // hangi depodan cikacagi belli degilken bir sayi yazmak yaniltir.
      const fromCode = Number(form.fromWarehouseCode)
      if (!Number.isFinite(fromCode) || fromCode <= 0 || items.length === 0) {
        setPickerBalances(new Map())
      } else {
        try {
          const bal = await fetchAuthorizedStockBalances(items.map((x: any) => String(x?.stockCode ?? '')))
          const map = new Map<string, number>()
          for (const it of bal?.items ?? []) {
            const sc = String(it?.stockCode ?? '').trim().toLowerCase()
            if (!sc) continue
            const hit = (it?.balances ?? []).find((b: any) => Number(b?.warehouseCode) === fromCode)
            map.set(sc, Number(hit?.balance) || 0)
          }
          setPickerBalances(map)
        } catch {
          // Bakiye alinamadi: liste yine calisir, yalnizca adet sutunu bos kalir.
          setPickerBalances(new Map())
        }
      }
    } catch (e: any) {
      setPickerItems([])
      setPickerBalances(new Map())
      setPickerError(String(e?.message ?? 'Ürünler alınamadı'))
    } finally {
      setPickerLoading(false)
    }
  }

  /**
   * MODALI KAPATMADAN SATIR EKLER (2026-09-01 kullanici istegi).
   *
   * Tek yol "Sec"ti: urunu yazip modal KAPANIR. Bes supurgeyi transfer etmek icin kullanici
   * bes kez "Satir Ekle > Sec > 'supurge' yaz > sec" dongusunu tekrarliyordu. Bu dugme
   * urunu ekleyip pencereyi acik birakir; bir arama, bircok kalem.
   *
   * Hedef satir henuz bossa once O doldurulur - yoksa listede bos satir asili kalirdi.
   * AYNI URUN iki kez eklenmez: ikinci tikta yeni satir yerine uyari cikar, cunku ayni
   * stok kodundan iki satir transfer belgesini bozar.
   */
  const urunuYeniSatiraEkle = (p: any) => {
    const kod = String(p?.stockCode ?? '').trim()
    const ad = String(p?.name ?? '')
    if (!kod) return
    const miktar = pickerQtyOf(kod)

    setLines((prev) => {
      if (prev.some((l) => String(l.stockCode ?? '').trim().toLowerCase() === kod.toLowerCase())) {
        setPickerError(`${kod} zaten listede.`)
        return prev
      }

      const idx = pickedLineIndex
      const hedef = idx != null ? prev[idx] : undefined
      if (hedef && !String(hedef.stockCode ?? '').trim()) {
        const next = [...prev]
        next[idx as number] = { ...hedef, stockCode: kod, stockName: ad, quantity: miktar }
        return next
      }
      return [...prev, { stockCode: kod, stockName: ad, quantity: miktar }]
    })

    setPickerError(null)
    setPickedLineIndex(null)
    setEklenenSayisi((n) => n + 1)
    // Adet kutusu eklendikten sonra temizlenir; ikinci eklemede eski sayı kalmasın.
    setPickerQtyByCode((prev) => {
      if (!(kod in prev)) return prev
      const next = { ...prev }
      delete next[kod]
      return next
    })
  }

  const selectProduct = (p: any) => {
    const prod: PickedProduct = {
      stockCode: String(p?.stockCode ?? ''),
      name: String(p?.name ?? '')
    }
    if (!prod.stockCode) return
    const idx = pickedLineIndex
    if (idx == null) return

    // Seçicide adet yazıldıysa "Seç" de o adetle gelir; yazılmadıysa satırın miktarı korunur.
    const yazilanMiktar = String(pickerQtyByCode[prod.stockCode.trim()] ?? '').trim()
    setLines((prev) => {
      const next = [...prev]
      const row = next[idx] ?? { stockCode: '', quantity: '0' }
      next[idx] = { ...row, stockCode: prod.stockCode, stockName: prod.name, quantity: yazilanMiktar ? pickerQtyOf(prod.stockCode.trim()) : row.quantity }
      return next
    })
    setPickerOpen(false)
  }

  /**
   * Listenin SONUNA boş satır ekler. Müşteri teklifindeki "Satır Ekle" ile aynı davranış.
   *
   * Eskiden her eklemede stok seçici penceresi kendiliğinden açılıyordu; art arda kalem
   * girerken pencere sürekli önü kapatıyordu. Ürün, satırdaki "Seç" ile seçilir.
   */
  const addLine = () => {
    setLines((prev) => [...prev, { stockCode: '', stockName: '', quantity: '1' }])
  }

  const save = async () => {
    try {
      setSaving(true)
      setError(null)

      const from = Number(form.fromWarehouseCode)
      const to = Number(form.toWarehouseCode)
      if (!Number.isFinite(from) || from <= 0) throw new Error('Çıkış depo zorunludur')
      if (!Number.isFinite(to) || to <= 0) throw new Error('Giriş depo zorunludur')
      if (from === to) throw new Error('Çıkış depo ve giriş depo aynı olamaz')

      const validLines = lines
        .map((l) => ({
          stockCode: String(l.stockCode ?? '').trim(),
          quantity: Number(String(l.quantity ?? '').replace(',', '.'))
        }))
        .filter((l) => l.stockCode && Number.isFinite(l.quantity) && l.quantity > 0)

      if (validLines.length === 0) throw new Error('En az 1 stok kalemi giriniz')

      const payload: CreateWarehouseTransferPayload = {
        date: form.date || null,
        description: String(form.description ?? '').trim() || null,
        deliveryAddress: String(form.deliveryAddress ?? '').trim() || null,
        fromWarehouseCode: from,
        toWarehouseCode: to,
        isConsignment: Boolean(form.isConsignment),
        lines: validLines
      }

      // Dugme "Kaydet ve Yazdir" diyordu ama YALNIZCA kaydediyordu; belge hic acilmiyordu.
      const created = await createWarehouseTransfer(payload)
      setModalOpen(false)
      await loadList()
      if (created?.id) openTransferDocument(created.id)
    } catch (e: any) {
      setError(String(e?.message ?? 'Kaydedilemedi'))
    } finally {
      setSaving(false)
    }
  }

  const removeTransfer = async (id: number) => {
    const ok = window.confirm('Transfer silinsin mi?')
    if (!ok) return

    try {
      setLoading(true)
      setError(null)
      await deleteWarehouseTransfer(id)
      await loadList()
    } catch (e: any) {
      setError(String(e?.message ?? 'Silinemedi'))
    } finally {
      setLoading(false)
    }
  }

  const totalLineCount = useMemo(() => rows.reduce((s, r) => s + (Number(r.lineCount) || 0), 0), [rows])
  const lastTransferDate = useMemo(() => {
    if (rows.length === 0) return null
    const dates = rows.map(r => String(r.date ?? '').slice(0, 10)).filter(Boolean).sort()
    return dates[dates.length - 1] ?? null
  }, [rows])

  return (
    <div className="p-6 bg-slate-50/30 min-h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 shadow-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
            </span>
            Depolar Arası Transfer
          </h1>
          <p className="text-[11px] font-semibold text-slate-400 mt-1 ml-10.5">Depo İşlemleri / Transfer Yönetimi</p>
        </div>

        <div className="flex items-center gap-3 ml-10.5 md:ml-0">
          <button
            type="button"
            onClick={() => void loadList()}
            disabled={loading}
            className="h-9 inline-flex items-center gap-1.5 px-3.5 text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60 rounded-lg shadow-sm transition-all focus:outline-none"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={loading ? 'animate-spin' : ''}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            {loading ? 'Yenileniyor...' : 'Yenile'}
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="h-9 inline-flex items-center gap-1.5 px-4 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-all focus:outline-none"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            Yeni Transfer
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 mb-6 px-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm text-xs font-semibold text-slate-600">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            </div>
            <span className="text-slate-500">Toplam <span className="font-bold text-slate-800">{rows.length}</span> transfer</span>
          </div>
          <div className="w-px h-4 bg-slate-200 hidden sm:block"></div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </div>
            <span className="text-slate-500">Toplam Kalem: <span className="font-bold text-emerald-700">{totalLineCount}</span></span>
          </div>
          {lastTransferDate && (
            <>
              <div className="w-px h-4 bg-slate-200 hidden sm:block"></div>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-blue-50 border border-blue-100 text-blue-700 flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </div>
                <span className="text-slate-500">Son Transfer: <span className="font-bold text-slate-800">{lastTransferDate}</span></span>
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="mb-6 p-3.5 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600 flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-6">
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-32" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-20" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-24" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-24" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-14" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-6 py-16 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-50 border border-slate-100 text-slate-400 mb-4 shadow-inner">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
          </div>
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Henüz Transfer Kaydı Yok</div>
          <p className="text-xs text-slate-400 mt-1.5 max-w-xs mx-auto leading-relaxed">Sistemde kayıtlı depolar arası transfer bulunmuyor. Yeni transfer oluşturarak başlayabilirsiniz.</p>
        </div>
      ) : (
        <Table
          onRefresh={() => void loadList()} columns={columns} data={rows} showColumnFilters />
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => {
          if (saving) return
          setModalOpen(false)
        }}
        title="Yeni Depolar Arası Transfer"
        containerClassName="max-w-5xl"
        footer={
          <>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="h-9 px-4 text-xs font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-50 transition-all focus:outline-none"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="h-9 inline-flex items-center gap-1.5 px-6 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-all focus:outline-none"
            >
              {saving ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              )}
              {saving ? 'Kaydediliyor...' : 'Kaydet ve Yazdır'}
            </button>
          </>
        }
        scrollable
      >
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-12 lg:col-span-6">
            <FormInput label="Belge No" value={form.transferNo} onChange={() => {}} placeholder="Otomatik Üretilecek" readOnly />
          </div>
          <div className="col-span-12 lg:col-span-6">
            <FormInput label="Tarih" type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
          </div>

          <div className="col-span-12 lg:col-span-12">
            <FormInput label="Açıklama" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Transfer açıklaması..." />
          </div>

          <div className="col-span-12 lg:col-span-12">
            <FormInput label="Teslimat Adresi" value={form.deliveryAddress} onChange={(e) => setForm((p) => ({ ...p, deliveryAddress: e.target.value }))} placeholder="Teslimat adresi detayları..." />
          </div>

          <div className="col-span-12 lg:col-span-4 border border-slate-200 bg-slate-50/30 p-4 rounded-xl">
            <FormSelect
              label="Çıkış Depo"
              value={form.fromWarehouseCode}
              onChange={(e) => setForm((p) => ({ ...p, fromWarehouseCode: e.target.value }))}
              options={warehouseOptions}
            />
          </div>
          <div className="col-span-12 lg:col-span-4 border border-slate-200 bg-slate-50/30 p-4 rounded-xl">
            <FormSelect
              label="Giriş Depo"
              value={form.toWarehouseCode}
              onChange={(e) => setForm((p) => ({ ...p, toWarehouseCode: e.target.value }))}
              options={warehouseOptions}
            />
          </div>
          {/* Konsinye kutusu ARTIK CERCEVESIZ: iki depo kutusunun yanindaki bu hucre
              cerceveli goruntuluyordu ve isaretli degilken bos bir kutu gibi duruyordu. */}
          <div className="col-span-12 lg:col-span-4 flex items-center">
            <label className="inline-flex items-center gap-3 cursor-pointer select-none group py-2 rounded-lg transition-colors w-full">
              <input
                type="checkbox"
                checked={form.isConsignment}
                onChange={(e) => setForm((p) => ({ ...p, isConsignment: e.target.checked }))}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20"
              />
              <span className="text-xs font-bold text-slate-700 group-hover:text-slate-900 transition-colors uppercase tracking-wider">Konsinye Transfer</span>
            </label>
          </div>

          <div className="col-span-12 mt-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Transfer Edilecek Kalemler
              </h2>
              {/*
                Müşteri teklifi sayfasındaki düğmenin aynısı: beyaz zemin, yeşil artı,
                "Satır Ekle" yazısı. Burada mor "Yeni Kalem Ekle" duruyordu ve kullanıcı iki
                ekranda aynı işi yapan düğmeyi tanıyamıyordu.
              */}
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs shadow-2xs transition active:scale-95"
              >
                <Plus size={15} className="text-emerald-600" />
                <span>Satır Ekle</span>
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs whitespace-nowrap min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-4 py-3 font-semibold text-slate-650 text-[10px] uppercase tracking-wider text-left border-b border-slate-200">Stok Kodu / Adı</th>
                    <th className="px-4 py-3 font-semibold text-slate-650 text-[10px] uppercase tracking-wider text-right w-[180px] border-b border-slate-200">Miktar</th>
                    <th className="px-4 py-3 font-semibold text-slate-650 text-[10px] uppercase tracking-wider text-right w-[120px] border-b border-slate-200" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-50 text-slate-300 mb-2">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                        </div>
                        <div className="text-xs font-semibold text-slate-400">Henüz transfer kalemi eklenmedi.</div>
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, idx) => (
                      <tr key={`${idx}-${l.stockCode}`} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1 truncate">
                              <div className="font-bold text-slate-700">{String(l.stockCode ?? '') || <span className="text-slate-300 italic">Stok Seçilmedi</span>}</div>
                              <div className="text-[11px] font-medium text-slate-500 mt-0.5">{String(l.stockName ?? '')}</div>
                            </div>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[10px] font-bold bg-white text-indigo-700 hover:bg-indigo-600 hover:text-white border border-indigo-200 hover:border-indigo-600 transition-all shadow-sm focus:outline-none"
                              onClick={() => {
                                setPickedLineIndex(idx)
                                setPickerQuery('')
                                setPickerItems([])
                                setPickerError(null)
                                setPickerMainCat('')
                                setPickerSubCat('')
                                setEklenenSayisi(0)
    setPickerOpen(true)
                              }}
                            >
                              <Search size={10} strokeWidth={3} />
                              Seç
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <input
                            className="text-right w-full h-9 px-3 text-sm font-semibold text-slate-700 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none"
                            value={l.quantity}
                            onChange={(e) => {
                              const v = e.target.value
                              setLines((prev) => {
                                const next = [...prev]
                                next[idx] = { ...next[idx], quantity: v }
                                return next
                               })
                            }}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            title="Altına satır ekle"
                            className="inline-flex items-center justify-center w-8 h-8 mr-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white border border-emerald-100 hover:border-emerald-600 transition-all"
                            onClick={() => insertLineBelow(idx)}
                          >
                            <Plus size={12} strokeWidth={2.5} />
                          </button>
                          <button
                            type="button"
                            title="Satırı sil"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-500 hover:text-white border border-red-100 hover:border-red-500 transition-all"
                            onClick={() => removeLine(idx)}
                          >
                            <Trash2 size={12} strokeWidth={2.5} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {lines.length > 0 && (
              <div className="mt-4 flex items-center gap-4 px-4 py-2.5 bg-indigo-50/40 rounded-lg text-xs border border-indigo-100/50">
                <div className="flex items-center gap-2 text-indigo-900/60 font-semibold">
                  Toplam Kalem: <span className="font-bold text-indigo-700">{String(lines.length)}</span>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-200"></div>
                <div className="flex items-center gap-2 text-indigo-900/60 font-semibold">
                  Toplam Miktar: <span className="font-bold text-indigo-700">
                    {formatQty(
                      lines.reduce((a, x) => a + (Number(String(x.quantity ?? '').replace(',', '.')) || 0), 0)
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Stok Seçimi"
        containerClassName="max-w-4xl"
        footer={
          <div className="flex items-center justify-between w-full gap-3">
            {/* Kac kalem eklendigi gorunur; yoksa "ekledim mi" belirsiz kalir. */}
            <span className="text-xs font-bold text-emerald-700">
              {eklenenSayisi > 0 ? `${eklenenSayisi} kalem eklendi` : ''}
            </span>
            <button
              type="button"
              onClick={() => { setPickerOpen(false); setEklenenSayisi(0) }}
              className="h-9 px-4 text-xs font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-all focus:outline-none"
            >
              Kapat
            </button>
          </div>
        }
        scrollable
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1">
            <FormInput label="Ara" value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Stok kodu veya ürün adı ile arayın..." />
          </div>
          <button
            type="button"
            onClick={() => void searchProducts(pickerQuery)}
            className="mt-[24px] h-10 inline-flex items-center gap-1.5 px-4 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-900 text-white shadow-sm transition-all focus:outline-none"
          >
            <Search size={14} strokeWidth={2.5} />
            Ürün Ara
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <FormSelect
            label="Ana Kategori"
            value={pickerMainCat}
            onChange={(e) => {
              const v = e.target.value
              setPickerMainCat(v)
              setPickerSubCat('')
              if (v) {
                void searchProducts(pickerQuery, { main: v, sub: '' })
              } else {
                setPickerItems([])
              }
            }}
            options={[{ value: '', label: 'Tüm Ana Kategoriler' }, ...(categoriesState?.mains ?? []).map((m: string) => ({ value: m, label: m }))]}
          />
          <FormSelect
            label="Alt Kategori"
            value={pickerSubCat}
            onChange={(e) => {
              const v = e.target.value
              setPickerSubCat(v)
              void searchProducts(pickerQuery, { sub: v })
            }}
            options={[
              { value: '', label: 'Tüm Alt Kategoriler' },
              ...(((categoriesState as any)?.subsByMain?.[pickerMainCat] ?? []) as string[]).map((s) => ({ value: s, label: s }))
            ]}
            disabled={!pickerMainCat}
          />
        </div>

        {pickerError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-650 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {pickerError}
          </div>
        )}

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-4 py-3 font-semibold text-slate-650 text-[10px] uppercase tracking-wider text-left border-b border-slate-200">Stok Kodu</th>
                <th className="px-4 py-3 font-semibold text-slate-650 text-[10px] uppercase tracking-wider text-left border-b border-slate-200">Ürün Adı</th>
                <th className="px-4 py-3 font-semibold text-slate-650 text-[10px] uppercase tracking-wider text-right w-[110px] border-b border-slate-200">
                  Çıkış Deposu
                </th>
                <th className="px-4 py-3 font-semibold text-slate-650 text-[10px] uppercase tracking-wider text-right w-[80px] border-b border-slate-200" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pickerLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs font-semibold text-slate-400">Yükleniyor...</td>
                </tr>
              ) : pickerItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-50 text-slate-300 mb-2">
                      <Search size={18} />
                    </div>
                    <div className="text-xs font-semibold text-slate-400">Aradığınız kriterlere uygun ürün bulunamadı.</div>
                  </td>
                </tr>
              ) : (
                pickerItems.map((p) => (
                  <tr key={String(p?.id ?? '')} className="hover:bg-slate-50/80 cursor-pointer transition-colors group">
                    <td className="px-4 py-2.5 font-bold text-slate-700">{String(p?.stockCode ?? '')}</td>
                    <td className="px-4 py-2.5 text-slate-600">{String(p?.name ?? '')}</td>
                    <td className="px-4 py-2.5 text-right">
                      {(() => {
                        const fromCode = Number(form.fromWarehouseCode)
                        if (!Number.isFinite(fromCode) || fromCode <= 0) {
                          return <span className="text-[11px] font-semibold text-slate-300" title="Önce çıkış deposunu seçin">-</span>
                        }
                        const raw = pickerBalances.get(String(p?.stockCode ?? '').trim().toLowerCase())
                        if (raw === undefined) return <span className="text-[11px] font-semibold text-slate-300">-</span>
                        const floorQty = Math.max(0, Math.floor(Number(raw) || 0))
                        // Fatura ekranindaki kuralin AYNISI: yetki yoksa 12 uzeri "12+".
                        const label = canSeeWarehouseBalance ? String(floorQty) : floorQty <= 12 ? String(floorQty) : '12+'
                        return (
                          <span className={`text-xs font-bold tabular-nums ${floorQty > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                            {floorQty > 0 ? label : '0'}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {/* Adet kutusu "Satır Ekle"nin solunda: kalem bu adetle eklenir (Enter da ekler). */}
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label="Miktar"
                        title="Eklenecek miktar"
                        value={pickerQtyByCode[String(p?.stockCode ?? '').trim()] ?? ''}
                        placeholder="1"
                        onChange={(e) => {
                          const kod = String(p?.stockCode ?? '').trim()
                          const v = e.target.value.replace(/[^0-9.,]/g, '')
                          setPickerQtyByCode((prev) => ({ ...prev, [kod]: v }))
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            urunuYeniSatiraEkle(p)
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-7 w-16 mr-1.5 rounded-lg border border-slate-200 px-2 text-xs font-semibold text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                      />
                      {/* "Satıra Ekle" pencereyi KAPATMAZ: tek aramadan çok kalem eklenebilsin. */}
                      <button
                        type="button"
                        title="Ekle ve pencereyi açık tut"
                        className="inline-flex items-center gap-1 h-7 px-2.5 mr-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white border border-emerald-200 hover:border-emerald-600 transition-all shadow-sm focus:outline-none"
                        onClick={() => urunuYeniSatiraEkle(p)}
                      >
                        + Satır Ekle
                      </button>
                      <button
                        type="button"
                        title="Ekle ve pencereyi kapat"
                        className="inline-flex items-center gap-1 h-7 px-3 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-600 hover:text-white border border-indigo-200 hover:border-indigo-600 transition-all shadow-sm focus:outline-none"
                        onClick={() => selectProduct(p)}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                        Seç
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      </Modal>
    </div>
  )
}
