export type InvoiceListItem = {
  id: string
  islemTipi: string
  tarih: string
  tarihRaw?: string
  saat: string
  faturaNo: string
  sourceCustomerOfferId?: number | null
  cariAdi: string
  /** Faturanın cari kodu — cari adına tıklayınca ekstre modalı açmak için. */
  cariKodu?: string
  faturaAcik: string
  brutTutar: number
  iskonto: number
  kampanyaIndirimi?: number
  netTutar: number
  kdvTutari: number
  genelToplam: number
  /** Belgenin para birimi (0/1 = TL) ve fatura anındaki donmuş kuru. */
  paraBirimiTipi?: number
  kur?: number
  /** Malin cikis deposu; kalemler farkli depolardansa "Karisik (n depo): ...". */
  cikisDeposu?: string | null
  plasiyer: string
  islemYapan: string
  createUser?: string
  odemeAlindi?: boolean
  odemeHedefi?: string | null
  odemeKasaId?: number | null
  odemeBankaId?: number | null
}

export type GetInvoiceListParams = {
  query?: string
  fromDate?: string
  toDate?: string
  page?: number
  pageSize?: number
}

export type GetInvoiceListResult = {
  items: InvoiceListItem[]
  total: number
  page: number
  pageSize: number
}

import { API_BASE_URL } from '../config/api'

export async function getInvoiceList(params: GetInvoiceListParams): Promise<GetInvoiceListResult> {
  const page = Math.max(1, Number(params.page ?? 1))
  const pageSize = Math.max(1, Number(params.pageSize ?? 10))
  const query = String(params.query ?? '').trim().toLowerCase()
  const fromDate = String(params.fromDate ?? '').trim()
  const toDate = String(params.toDate ?? '').trim()


  const token = localStorage.getItem('accessToken')
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const qs = new URLSearchParams()
    qs.set('query', query)
    if (fromDate) qs.set('fromDate', fromDate)
    if (toDate) qs.set('toDate', toDate)
    qs.set('page', String(page))
    qs.set('pageSize', String(pageSize))

    const res = await fetch(`${API_BASE_URL}/api/invoices/list?${qs.toString()}`, { headers })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || 'Fatura listesi alınamadı')
    }

    const json = await res.json()

    const data = json?.data
    const rawItems: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : []

    const items: InvoiceListItem[] = rawItems.map((x) => {
      const dt = x?.tarih
      let tarih = String(dt ?? '')
      const d = new Date(tarih)
      if (!Number.isNaN(d.getTime())) {
        tarih = d.toLocaleDateString('tr-TR')
      }

      const sdt = x?.saat
      let saat = ''
      const sd = new Date(sdt)
      if (!Number.isNaN(sd.getTime())) {
        saat = sd.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
      }

      return {
        id: String(x?.id ?? ''),
        islemTipi: String(x?.islemTipi ?? ''),
        tarih,
        tarihRaw: String(dt ?? ''),
        saat,
        faturaNo: String(x?.faturaNo ?? ''),
        sourceCustomerOfferId: x?.sourceCustomerOfferId ?? null,
        cariAdi: String(x?.cariAdi ?? ''),
        faturaAcik: String(x?.faturaAcik ?? ''),
        brutTutar: Number(x?.brutTutar ?? 0),
        iskonto: Number(x?.iskonto ?? 0),
        kampanyaIndirimi: Number(x?.kampanyaIndirimi ?? 0),
        netTutar: Number(x?.netTutar ?? 0),
        kdvTutari: Number(x?.kdvTutari ?? 0),
        genelToplam: Number(x?.genelToplam ?? 0),
        paraBirimiTipi: Number((x as any)?.paraBirimiTipi ?? 0),
        kur: Number((x as any)?.kur ?? 0),
        cikisDeposu: (x as any)?.cikisDeposu ? String((x as any).cikisDeposu) : null,
        plasiyer: String(x?.plasiyer ?? ''),
        islemYapan: String(x?.islemYapan ?? ''),
        createUser: String(x?.createUser ?? x?.islemYapan ?? ''),
        odemeAlindi: Boolean(x?.odemeAlindi),
        odemeHedefi: x?.odemeHedefi ? String(x.odemeHedefi) : null,
        odemeKasaId: x?.odemeKasaId ?? null,
        odemeBankaId: x?.odemeBankaId ?? null
      }
    })

    const totalRaw = Number((data as any)?.total ?? (data as any)?.count ?? rawItems.length)
    const total = Number.isFinite(totalRaw) ? totalRaw : items.length

    return { items, total, page, pageSize }
  } catch {
    // Fallback (offline/dev)
    const all = getMockInvoices()
    const filtered = !query
      ? all
      : all.filter((x) => x.faturaNo.toLowerCase().includes(query) || x.cariAdi.toLowerCase().includes(query))

    const total = filtered.length
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)
    return { items, total, page, pageSize }
  }
}

function getMockInvoices(): InvoiceListItem[] {
  return []
}
