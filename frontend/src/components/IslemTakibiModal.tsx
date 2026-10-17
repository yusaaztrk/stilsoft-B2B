import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { AppDataTable } from './data-table/AppDataTable'
import type { ColumnFilterStateValue } from './data-table/types'
import { fetchCashAccountTransactions } from '../api/cashAccountTransactions'
import { fetchBankAccountTransactions } from '../api/bankAccountTransactions'
import { isInflowDirection } from '../utils/transactionDirection'
import { bankAccountTypeLabel } from '../constants/bankAccountTypes'

/**
 * İŞLEM TAKİBİ PENCERESİ — 2026-09-01 kullanıcı isteği.
 *
 * Kasa ve Banka raporlarındaki "Yenile" düğmesinin yerine geçer. Rapor sayfaları hesap
 * BAZINDA özet gösteriyor (her hesabın giriş/çıkış/bakiyesi); buradaysa bütün hareketler
 * TEK listede duruyor ve kolon süzgeçleriyle daraltılıyor: tarih, hesap adı, cari, döviz,
 * tutar, açıklama…
 *
 * Ortak tablo bileşeni kullanıldığı için süzgeçler, çoklu seçim, sıralama, Excel ve
 * sayfalama hazır geliyor; tarih sütunu da bileşenin kendi kuralıyla BUGÜNÜ öntanımlı
 * seçiyor. Ayrı bir süzgeç arayüzü yazmak, aynı davranışın ikinci bir kopyasını üretirdi.
 *
 * Tek bileşen iki kaynağı da karşılıyor (`kaynak` propu): iki ekranın kolonları ve
 * biçimlendirmesi ayrışırsa aynı hareket iki yerde farklı okunur.
 */

export type IslemTakibiKaynagi = 'kasa' | 'banka'

type Props = {
  acik: boolean
  onKapat: () => void
  kaynak: IslemTakibiKaynagi
  /**
   * Banka hesap tanımları — "Hesap Tipi" (Vadesiz / POS / Teminat…) bu listeden okunur.
   * Hareket ucu hesabın TÜRÜNÜ döndürmüyor, yalnızca kod ve adını. Sayfa listeyi zaten
   * yüklediği için prop olarak geçiyor: ikinci bir istek atılmıyor. Verilmezse sütun boş
   * kalır, tablo çalışmaya devam eder.
   */
  bankaHesaplari?: Array<{ id: number; accountType?: number | null }>
}

/** Kayıtta 0 "belirtilmemiş" demek ve TL sayılır (CurrencyTypeHelper ile aynı kural). */
function dovizKodu(id: any): string {
  const v = Number(id ?? 0)
  return v === 2 ? 'EURO' : v === 3 ? 'DOLAR' : v === 4 ? 'STERLİN' : 'TL'
}

function dovizSimgesi(id: any): string {
  const v = Number(id ?? 0)
  return v === 2 ? '€' : v === 3 ? '$' : v === 4 ? '£' : '₺'
}

function paraYaz(tutar: any, dovizId: any): string {
  const v = Number(tutar ?? 0)
  return `${dovizSimgesi(dovizId)}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * SATIRIN GÖSTERİLECEK TUTARI VE PARA BİRİMİ.
 *
 * `amount` TL ÇAPASIDIR; hesabın kendi parasındaki değer `currencyAmount`ta durur. Kural
 * uygulamanın geri kalanıyla aynı (bkz. `BankaRaporlariReport.satirTutari` ve
 * `CashPage`): TL hesapta `amount`, dövizlide `currencyAmount`.
 *
 * Döviz karşılığı YOKSA (eski kayıtlarda 0 gelebiliyor) TL rakamı TL simgesiyle gösterilir.
 * Dolar etiketiyle basmak, TL tutarını dolar sanmaya yol açar — fatura dökümünde
 * "144 M dolar" olarak görülen hata tam olarak buydu.
 */
function satirTutari(amount: any, currencyAmount: any, dovizId: any): { tutar: number; dovizId: number } {
  const tl = Number(amount ?? 0)
  const v = Number(dovizId ?? 0)
  if (v <= 1) return { tutar: tl, dovizId: 1 }

  const doviz = Number(currencyAmount ?? 0)
  if (!(Math.abs(doviz) > 0)) return { tutar: tl, dovizId: 1 }
  return { tutar: doviz, dovizId: v }
}

function tarihYaz(iso: any): string {
  const d = new Date(String(iso ?? ''))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('tr-TR')
}

/**
 * CARI TIPI kasa ve bankada AYNI SAYIYI farkli okuyor:
 *   Kasa  (CashAccountTransactionCounterpartyType): 1 Customer, 2 Bank, 3 Muhtelif
 *   Banka (BankAccountTransactionCounterpartyType): 1 Customer, 2 Bank, 3 Supplier
 * Tek bir eslestirme yazilirsa 3'ler karisir; bu yuzden kaynak parametre olarak geciyor.
 */
function cariTipiYaz(id: any, kasaMi: boolean): string {
  /*
    DEĞER METİN GELİYOR. Liste uçları enum'u `"Customer"` / `"Bank"` / `"Supplier"` /
    `"Muhtelif"` diye yazıyor; yalnızca sayıya bakan kod her satırı boş gösteriyordu
    (bkz. `utils/transactionDirection.ts` — aynı tuzağın yön tarafı).
  */
  const ham = String(id ?? '').trim().toLowerCase()
  if (ham === '1' || ham === 'customer') return 'CARİ'
  if (ham === '2' || ham === 'bank') return 'BANKA'
  if (ham === '3' || ham === 'supplier' || ham === 'muhtelif') return kasaMi ? 'MUHTELİF' : 'TEDARİKÇİ'
  return ''
}

/** Satırın ekranda kullanılan düzleştirilmiş hâli. Süzgeçler bu alanlar üzerinde çalışır. */
type Satir = {
  id: number
  tarih: string
  tarihGosterim: string
  hesapKodu: string
  hesapAdi: string
  hesapTipi: string
  yon: string
  cariTipi: string
  cariKodu: string
  cariAdi: string
  dovizTipi: string
  tutar: number
  tutarGosterim: string
  kur: number
  dovizTutari: number
  belgeNo: string
  aciklama: string
  kategori: string
  islemYapan: string
}

export default function IslemTakibiModal({ acik, onKapat, kaynak, bankaHesaplari }: Props) {
  const [satirlar, setSatirlar] = useState<Satir[]>([])
  const [yukleniyor, setYukleniyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [filtreler, setFiltreler] = useState<Record<string, ColumnFilterStateValue | string>>({})
  const [aramaMetni, setAramaMetni] = useState('')
  const [sayfa, setSayfa] = useState(0)
  const [sayfaBoyu, setSayfaBoyu] = useState(50)
  const [tavanaDayandi, setTavanaDayandi] = useState(false)

  const kasaMi = kaynak === 'kasa'

  /**
   * Hesap kimliği → tür. Tanım listede yoksa sütun BOŞ kalır: `bankAccountTypeLabel(0)`
   * "Vadesiz Hesap" der ve bilinmeyen bir hesabı vadesiz gibi göstermek yanlış bilgidir.
   */
  const hesapTipleri = useMemo(() => {
    const m = new Map<number, number>()
    for (const h of bankaHesaplari ?? []) {
      const id = Number(h?.id ?? 0)
      if (id > 0) m.set(id, Number(h?.accountType ?? 0))
    }
    return m
  }, [bankaHesaplari])

  /*
    Uc en fazla TAVAN kadar satir donuyor. Tavan doldugunda daha eski hareketler
    gelmemis olabilir; kullaniciya soylenmezse "hepsi burada" sanir.
  */
  const TAVAN = 1000

  /**
   * Siralamayi UCA BIRAKMIYORUZ: kasa ve banka uclari ayni siralamayi vaat etmiyor;
   * ikisi de burada YENIDEN ESKIYE dizilir. Ayrica tavan dolduysa isaretlenir.
   */
  const siralaVeIsaretle = (liste: Satir[]) => {
    setTavanaDayandi(liste.length >= TAVAN)
    return [...liste].sort((a, b) => (a.tarih < b.tarih ? 1 : a.tarih > b.tarih ? -1 : b.id - a.id))
  }

  useEffect(() => {
    if (!acik) return

    const ac = new AbortController()
    setYukleniyor(true)
    setHata(null)

    void (async () => {
      try {
        if (kasaMi) {
          /*
            Hesap kimliği VERİLMEZ: uç o zaman bütün kasaların hareketlerini döndürüyor.
            Kullanıcı "hepsini birden göstermeli" dedi; daraltma kolon süzgeçlerinde.
          */
          const veri = await fetchCashAccountTransactions({ take: TAVAN }, { signal: ac.signal })
          setSatirlar(
            siralaVeIsaretle((veri ?? []).map((x) => ({
              id: Number(x.id),
              tarih: String(x.date ?? ''),
              tarihGosterim: tarihYaz(x.date),
              hesapKodu: String(x.cashAccountCode ?? ''),
              hesapAdi: String(x.cashAccountName ?? ''),
              hesapTipi: '',
              // `direction` METİN gelebiliyor ("In"/"Out"); tek kaynak yardımcı kullanılır.
              yon: isInflowDirection(x.direction) ? 'GİRİŞ' : 'ÇIKIŞ',
              cariTipi: cariTipiYaz(x.counterpartyType, true),
              cariKodu: String(x.counterpartyCode ?? ''),
              cariAdi: String(x.counterpartyName ?? ''),
              dovizTipi: dovizKodu(x.currencyTypeId),
              tutar: satirTutari(x.amount, x.currencyAmount, x.currencyTypeId).tutar,
              tutarGosterim: (() => {
                const g = satirTutari(x.amount, x.currencyAmount, x.currencyTypeId)
                return paraYaz(g.tutar, g.dovizId)
              })(),
              kur: Number(x.currencyRate ?? 0),
              dovizTutari: Number(x.currencyAmount ?? 0),
              belgeNo: '',
              aciklama: String(x.description ?? ''),
              kategori: '',
              islemYapan: String(x.createUser ?? '')
            })))
          )
        } else {
          const veri = await fetchBankAccountTransactions(null, { take: TAVAN, signal: ac.signal })
          setSatirlar(
            siralaVeIsaretle((veri ?? []).map((x) => ({
              id: Number(x.id),
              tarih: String(x.date ?? ''),
              tarihGosterim: tarihYaz(x.date),
              hesapKodu: String(x.bankAccountCode ?? ''),
              hesapAdi: String(x.bankAccountName ?? ''),
              hesapTipi: hesapTipleri.has(Number(x.bankAccountDefinitionId))
                ? bankAccountTypeLabel(hesapTipleri.get(Number(x.bankAccountDefinitionId)))
                : '',
              yon: isInflowDirection(x.direction) ? 'GİRİŞ' : 'ÇIKIŞ',
              cariTipi: cariTipiYaz(x.counterpartyType, false),
              cariKodu: String(x.counterpartyCode ?? ''),
              cariAdi: String(x.counterpartyName ?? ''),
              dovizTipi: dovizKodu(x.currencyTypeId),
              tutar: satirTutari(x.amount, x.currencyAmount, x.currencyTypeId).tutar,
              tutarGosterim: (() => {
                const g = satirTutari(x.amount, x.currencyAmount, x.currencyTypeId)
                return paraYaz(g.tutar, g.dovizId)
              })(),
              kur: Number(x.currencyRate ?? 0),
              dovizTutari: Number(x.currencyAmount ?? 0),
              belgeNo: String(x.documentNo ?? ''),
              aciklama: String(x.description ?? ''),
              kategori: String(x.category ?? ''),
              islemYapan: String(x.createUser ?? '')
            })))
          )
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        setHata(String(e?.message ?? 'Hareketler alınamadı'))
        setSatirlar([])
        setTavanaDayandi(false)
      } finally {
        setYukleniyor(false)
      }
    })()

    return () => ac.abort()
  }, [acik, kasaMi, hesapTipleri])

  /** Süzgeç açılır listeleri VERİDEN üretilir; ekranda olmayan bir seçenek listelenmez. */
  const secenekler = useMemo(() => {
    const topla = (al: (s: Satir) => string) =>
      Array.from(new Set(satirlar.map(al).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'tr-TR'))
        .map((v) => ({ label: v, value: v }))

    return {
      hesapAdi: topla((s) => s.hesapAdi),
      dovizTipi: topla((s) => s.dovizTipi),
      yon: topla((s) => s.yon),
      hesapTipi: topla((s) => s.hesapTipi),
      cariTipi: topla((s) => s.cariTipi),
      kategori: topla((s) => s.kategori),
      islemYapan: topla((s) => s.islemYapan)
    }
  }, [satirlar])

  const kolonlar = useMemo(() => {
    const ortak: any[] = [
      {
        accessorKey: 'tarihGosterim',
        header: 'Tarih',
        meta: { filterType: 'date', filterPlaceholder: 'Tarih...' }
      },
      {
        accessorKey: 'hesapKodu',
        header: kasaMi ? 'Kasa Kodu' : 'Hesap Kodu',
        meta: { filterType: 'text', filterPlaceholder: 'Kod...' }
      },
      {
        accessorKey: 'hesapAdi',
        header: kasaMi ? 'Kasa Adı' : 'Hesap Adı',
        // Çoklu seçim: birden çok hesabı aynı anda listeleyebilmek için.
        meta: { filterType: 'select', filterPlaceholder: 'Hesap...', filterOptions: secenekler.hesapAdi }
      },
      {
        accessorKey: 'dovizTipi',
        header: 'Döviz Tipi',
        meta: { filterType: 'select', filterPlaceholder: 'Döviz...', filterOptions: secenekler.dovizTipi }
      },
      {
        accessorKey: 'yon',
        header: 'İşlem',
        meta: { filterType: 'select', filterPlaceholder: 'Giriş/Çıkış...', filterOptions: secenekler.yon },
        cell: ({ getValue }: any) => {
          const v = String(getValue() ?? '')
          const renk = v === 'GİRİŞ'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-rose-50 text-rose-700 border-rose-200'
          return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${renk}`}>{v}</span>
        }
      },
      {
        accessorKey: 'cariTipi',
        header: 'Cari Tipi',
        meta: { filterType: 'select', filterPlaceholder: 'Cari tipi...', filterOptions: secenekler.cariTipi }
      },
      {
        accessorKey: 'cariKodu',
        header: 'Cari Kodu',
        meta: { filterType: 'text', filterPlaceholder: 'Cari kodu...' }
      },
      {
        accessorKey: 'cariAdi',
        header: 'Cari Adı',
        meta: { filterType: 'text', filterPlaceholder: 'Cari adı...' }
      },
      {
        accessorKey: 'tutar',
        header: 'Tutar',
        meta: { filterType: 'number', filterPlaceholder: 'Tutar...' },
        cell: ({ row }: any) => (
          <div className="text-right font-semibold text-slate-800">{row.original.tutarGosterim}</div>
        )
      },
      {
        accessorKey: 'kur',
        header: 'Kur',
        meta: { filterType: 'number', filterPlaceholder: 'Kur...' },
        cell: ({ getValue }: any) => {
          const v = Number(getValue() ?? 0)
          // Kur 1 ya da 0 ise belge TL'dir; sayı basmak sütunu gürültüye boğuyor.
          if (!(v > 1.0001)) return <div className="text-right text-slate-300">-</div>
          return (
            <div className="text-right text-slate-700">
              {v.toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
            </div>
          )
        }
      },
      {
        accessorKey: 'aciklama',
        header: 'Açıklama',
        meta: { filterType: 'text', filterPlaceholder: 'Açıklama...' }
      },
      {
        accessorKey: 'islemYapan',
        header: 'İşlem Yapan',
        meta: { filterType: 'select', filterPlaceholder: 'Kullanıcı...', filterOptions: secenekler.islemYapan }
      }
    ]

    if (!kasaMi) {
      /*
        Hesap tipi, belge no ve kategori YALNIZCA banka hareketinde var: kasa hesabının
        türü yok (CashAccount'ta böyle bir kolon yok), kasa hareketi de belge/kategori
        taşımıyor. Kasada eklenirse üç sütun boş görünür.

        Yerleştirme SÜTUN ADINA göre yapılıyor, sabit sıra numarasına göre değil: aralara
        yeni sütun girdiğinde numara kayıyor ve kolon yanlış yere düşüyordu.
      */
      const sonrasinaKoy = (hedefAlan: string, kolon: any) => {
        const yer = ortak.findIndex((c) => c.accessorKey === hedefAlan)
        if (yer < 0) ortak.push(kolon)
        else ortak.splice(yer + 1, 0, kolon)
      }

      sonrasinaKoy('hesapAdi', {
        accessorKey: 'hesapTipi',
        header: 'Hesap Tipi',
        meta: { filterType: 'select', filterPlaceholder: 'Hesap tipi...', filterOptions: secenekler.hesapTipi }
      })
      sonrasinaKoy('cariAdi', {
        accessorKey: 'belgeNo',
        header: 'Belge No',
        meta: { filterType: 'text', filterPlaceholder: 'Belge no...' }
      })
      ortak.push({
        accessorKey: 'kategori',
        header: 'Kategori',
        meta: { filterType: 'select', filterPlaceholder: 'Kategori...', filterOptions: secenekler.kategori }
      })
    }

    return ortak
  }, [kasaMi, secenekler])

  return (
    <Modal
      isOpen={acik}
      onClose={onKapat}
      title={kasaMi ? 'Kasa İşlem Takibi' : 'Banka İşlem Takibi'}
      containerClassName="max-w-[95vw]"
      scrollable
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500">
          {kasaMi ? 'Bütün kasaların' : 'Bütün banka hesaplarının'} hareketleri tek listede.
          Sütun başlıklarındaki süzgeçlerden daraltabilirsiniz.
        </p>
        {yukleniyor ? <span className="text-[11px] text-slate-500">Yükleniyor...</span> : null}
      </div>

      {tavanaDayandi && !hata && (
        <div className="mb-2 p-2 bg-amber-50 border border-amber-100 text-xs text-amber-700 rounded-lg">
          En son {TAVAN.toLocaleString('tr-TR')} hareket yüklendi; daha eski kayıtlar bu listede
          olmayabilir.
        </div>
      )}

      {hata && (
        <div className="mb-2 p-2 bg-rose-50 border border-rose-100 text-xs text-rose-600 rounded-lg">{hata}</div>
      )}

      <AppDataTable
        columns={kolonlar as any}
        data={satirlar}
        rowId={(r: any) => String(r.id)}
        pagination={{
          pageIndex: sayfa,
          pageSize: sayfaBoyu,
          totalCount: satirlar.length,
          onPageChange: setSayfa,
          onPageSizeChange: (n: number) => { setSayfaBoyu(n); setSayfa(0) }
        }}
        filtering={{
          showColumnFilters: true,
          columnFilters: filtreler,
          globalFilter: aramaMetni,
          onGlobalFilterChange: setAramaMetni,
          onColumnFilterChange: (colId, val) =>
            setFiltreler((p) => {
              const n = { ...p }
              if (val === null) delete n[colId]
              else n[colId] = val
              return n
            })
        }}
        states={{ loading: yukleniyor, error: hata, emptyTitle: 'Hareket bulunamadı', emptyDescription: 'Seçili süzgeçlerle eşleşen hareket yok.' }}
        excelFileName={kasaMi ? 'kasa-islem-takibi' : 'banka-islem-takibi'}
      />
    </Modal>
  )
}
