import React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type { InvoiceListItem } from '../../lib/invoices'

// Tutarın yanında para birimi HER ZAMAN yazar. Dövizli satırlar "1.500,00 USD" görünürken
// TL satırlar çıplak sayı kalıyordu; aynı sütunda iki farklı okuma biçimi oluyordu.
//
// PARA BİRİMİ SONDA (2026-08-22 kullanıcı kararı). Başa yazıldığında sağa yaslı para
// sütununda kod ile rakam arasındaki boşluk satırdan satıra değişiyor ve sayılar hizasız
// görünüyordu; sonda yazınca rakamlar sütunun sağında hizalı kalıyor.
function formatInvoiceAmount(val: number, curId: number): string {
  const code = curId === 2 ? 'EUR' : curId === 3 ? 'USD' : curId === 4 ? 'GBP' : 'TL'
  return `${val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`
}

/**
 * Fatura başlığındaki tutarı BELGENİN PARA BİRİMİNE çevirir (2026-09-01 düzeltmesi).
 *
 * `araToplam`, `netTutar`, `kdvTutari`, `genelToplam` alanlarının hepsi TL ÇAPASIDIR
 * (bkz. Invoice: başlık TL tutulur, dövizli değer kalemin `CurrencyUnitPrice` alanında).
 * Kolonlar bu TL rakamını alıp yanına belgenin döviz kodunu yazıyordu: 422.950 $'lık
 * fatura listede "20.412.116,87 USD" görünüyordu — TL rakamı, dolar etiketiyle.
 *
 * Belge dövizliyse ve kuru varsa TL çapası kura BÖLÜNÜR. Kur yoksa (eski/damgasız kayıt)
 * çevrim yapılmaz; yanlış bölmektense TL değeri göstermek yeğdir.
 */
function belgeParasina(tlTutar: number, curId: number, kur: number): number {
  // Eşikler sunucudaki `InvoicesController.BelgeParasiGenelToplam` ile BİREBİR aynı:
  // iki taraf aynı faturaya farklı rakam göstermesin.
  if (!(curId > 1)) return tlTutar          // 0/1 = TL, çevrim yok
  if (!(kur > 1.0001)) return tlTutar       // kur damgalanmamış (1) — bölme yapılmaz
  return tlTutar / kur
}

/**
 * İŞLEM TİPİ RENKLERİ (2026-08-22 kullanıcı kararı).
 *
 * Yalnızca HÜCRE GÖRÜNÜMÜ. Süzgeç kolonun `accessorKey` değeri üzerinden çalıştığı için
 * buradaki renklendirme süzgece hiç dokunmuyor — hücrede yazan metin de değişmiyor,
 * yalnızca arka planı geliyor.
 *
 * Sınıflar TAM METİN olarak duruyor; Tailwind kaynak dosyayı tarayarak sınıf üretiyor,
 * `bg-${x}-100` gibi parçalı yazılsa o sınıflar derlemeye hiç girmezdi.
 *
 * Renk ailesi Fatura Tipi sütunuyla ÇAKIŞMIYOR (orası mavi / sarı / yeşil kullanıyor):
 * iki sütun yan yana okunduğunda aynı renk iki farklı anlama gelmesin.
 */
const ISLEM_TIPI_BADGE: Record<string, string> = {
  'SATIŞ': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  'ALIŞ': 'bg-purple-100 text-purple-800 border-purple-200',
  'TAMİR': 'bg-cyan-100 text-cyan-800 border-cyan-200',
  'HİZMET': 'bg-teal-100 text-teal-800 border-teal-200',
  'İADE': 'bg-rose-100 text-rose-800 border-rose-200'
}

/** Türkçe büyük harf ve ASCII yazımları aynı kovaya düşsün diye. */
const ISLEM_TIPI_ALIASES: Record<string, string> = {
  'SATIS': 'SATIŞ',
  'ALIS': 'ALIŞ',
  'TAMIR': 'TAMİR',
  'HIZMET': 'HİZMET',
  'IADE': 'İADE'
}

function islemTipiBadgeClass(raw: string): string {
  const key = raw.trim().toLocaleUpperCase('tr-TR')
  const normalized = ISLEM_TIPI_ALIASES[key] ?? key
  return ISLEM_TIPI_BADGE[normalized] ?? 'bg-slate-100 text-slate-700 border-slate-200'
}

export function getInvoiceListColumns(
  onCariClick?: (cariKodu: string, cariAdi: string) => void
): ColumnDef<InvoiceListItem, any>[] {
  return [
    {
      accessorKey: 'islemTipi',
      header: 'İşlem Tipi',
      meta: {
        filterType: 'select',
        filterPlaceholder: 'İşlem Tipi...',
        filterOptions: [
          { value: 'SATIŞ', label: 'SATIŞ' },
          { value: 'TAMİR', label: 'TAMİR' },
          { value: 'ALIŞ', label: 'ALIŞ' },
          // Alış tarafından gelen hizmet/gider faturası. Servis geliri ('TAMİR') ile aynı
          // `Invoice.Type`'ı taşır; ayrımı `SourcePurchaseInvoiceId` yapar (bkz. uç).
          { value: 'HİZMET', label: 'HİZMET' },
          { value: 'İADE', label: 'İADE' }
        ]
      },
      cell: ({ getValue }) => {
        const val = String(getValue() ?? '')
        if (!val) return null
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${islemTipiBadgeClass(val)}`}
          >
            {val}
          </span>
        )
      }
    },
    {
      accessorKey: 'tarih',
      header: 'Tarih',
      meta: {
        filterType: 'date',
        filterPlaceholder: 'Tarih...'
      },
      cell: ({ getValue }) => <span className="text-slate-600 font-medium whitespace-nowrap">{String(getValue() ?? '')}</span>
    },
    {
      accessorKey: 'saat',
      header: 'Saat',
      meta: {
        filterType: 'text',
        filterPlaceholder: 'Saat...'
      },
      cell: ({ getValue }) => <span className="text-slate-600 font-medium whitespace-nowrap">{String(getValue() ?? '')}</span>
    },
    {
      accessorKey: 'faturaNo',
      header: 'Fatura No',
      meta: {
        filterType: 'text',
        filterPlaceholder: 'Fatura No...'
      },
      /**
       * Fatura numarasi KIRMIZI ROZET (2026-08-22 kullanici karari): sayfada gozle aranan
       * tek alan bu. Bicim "Odenmedi" rozetiyle AYNI tutuldu (ayni kose yuvarlakligi, ayni
       * dolgu, ayni rose tonlari) — tabloda iki farkli rozet dili olmasin.
       */
      cell: ({ getValue }) => {
        const val = String(getValue() ?? '')
        if (!val) return null
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-rose-100 text-rose-800 border border-rose-200 whitespace-nowrap">
            {val}
          </span>
        )
      }
    },
    {
      accessorKey: 'cariAdi',
      header: 'Cari Adı',
      meta: {
        filterType: 'text',
        filterPlaceholder: 'Cari Adı Ara...'
      },
      /**
       * Cari adına tıklayınca ekstre modalı açılır (2026-09-04). Cari kodu satırda
       * `cariKodu` alanında; yoksa (eski önbellek) tıklanamaz düz metin kalır.
       */
      cell: ({ getValue, row }) => {
        const ad = String(getValue() ?? '')
        const kod = String((row.original as any)?.cariKodu ?? '').trim()
        if (!ad) return null
        if (!onCariClick || !kod) {
          return <span className="font-medium text-slate-900 truncate block" title={ad}>{ad}</span>
        }
        return (
          <button
            type="button"
            title={`${ad} — cari ekstre`}
            onClick={(e) => { e.stopPropagation(); onCariClick(kod, ad) }}
            className="font-medium text-indigo-700 hover:text-indigo-900 hover:underline truncate block max-w-full text-left"
          >
            {ad}
          </button>
        )
      }
    },
    {
      accessorKey: 'faturaAcik',
      header: 'Fatura Tipi',
      meta: {
        filterType: 'select',
        filterPlaceholder: 'Fatura Tipi...',
        /**
         * SÜZGEÇ ARTIK RENK GRUBU (2026-08-22 kullanıcı kararı).
         *
         * Satırda taşınan tek ayrım renk: mavi = faturalı, sarı = açık hesap,
         * yeşil = muaf. Süzgeçte de yalnızca renkler duruyor — "FATURA (Sarı)" gibi bir
         * etiket ekranda hiç görünmeyen bir kelimeyi arattırıyordu.
         *
         * Bu YENİ DEĞERLER: uç `faturaAcikIn` parametresinde MAVI / SARI / YESIL alıyor ve
         * grubu listedeki `FaturaAcik` ifadesinin AYNISIYLA kuruyor. Eskiden seçenek ham
         * tip adını gönderiyordu; hem uç o parametreyi tanımıyordu (süzgeç hiç
         * çalışmıyordu) hem de mavi iki ayrı değere dağıldığı için tek seçimle ifade
         * edilemiyordu.
         */
        filterOptions: [
          { value: 'MAVI', label: 'Mavi' },
          { value: 'SARI', label: 'Sarı' },
          { value: 'YESIL', label: 'Yeşil' }
        ]
      },
      cell: ({ getValue }) => {
        /**
         * RENGİN TEK KAYNAĞI `faturaAcik` (2026-08-22).
         *
         * Uç bu alanı zaten normalleştiriyor: kodu "-3" ile biten cariler, ASKERİYE ve
         * MUAF tipleri oraya "MUAF" olarak yazılıyor. Aynı kuralı burada İKİNCİ kez
         * yazmak, sunucudaki süzgeçle ekrandaki rengin ayrışması demekti — nitekim
         * ayrışıyordu: "-3" cari ekranda yeşil görünüyor ama MUAF süzgecine takılmıyordu.
         * (`isVatExempt` alanı bu listenin cevabında hiç yok, o dal zaten ölüydü.)
         */
        const val = String(getValue() ?? '').trim().toUpperCase()
        const isAskeriyeOrMuaf = val === 'MUAF' || val === 'ASKERIYE' || val === 'ASKERİYE'

        if (isAskeriyeOrMuaf) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              MUAF
            </span>
          )
        }
        // İKİSİ DE "FATURA" YAZAR, AYRIMI RENK TAŞIR (2026-08-22 kullanıcı kararı):
        // mavi = faturalı, sarı = açık hesap. Etiket olarak "AÇIK" yazılmıyor.
        const isFatura = val === 'FATURA' || val === 'FATURALI'
        return (
          <span
            title={isFatura ? 'Faturalı' : 'Açık hesap'}
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
              isFatura ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'bg-amber-100 text-amber-800 border border-amber-200'
            }`}
          >
            FATURA
          </span>
        )
      }
    },
    {
      accessorKey: 'brutTutar',
      header: 'Brüt Tutar',
      meta: {
        filterType: 'number',
        filterPlaceholder: 'Brüt...',
        showTotal: true,
        // Sütun değeri TL çapasıdır; toplam satırı da belgenin parasına çevrilsin.
        totalConvertFromTry: true,
        tryTotalLabel: 'TL'
      },
      cell: ({ row, getValue }) => {
        const curId = Number(row?.original?.paraBirimiTipi ?? 0)
        const val = Number(getValue() ?? 0)
        return <div className="text-right font-medium text-slate-700">{formatInvoiceAmount(belgeParasina(val, curId, Number(row?.original?.kur ?? 0)), curId)}</div>
      }
    },
    {
      accessorKey: 'iskonto',
      header: 'İskonto',
      meta: {
        filterType: 'number',
        filterPlaceholder: 'İskonto...',
        showTotal: true,
        // Sütun değeri TL çapasıdır; toplam satırı da belgenin parasına çevrilsin.
        totalConvertFromTry: true,
        tryTotalLabel: 'TL'
      },
      cell: ({ row, getValue }) => {
        const curId = Number(row?.original?.paraBirimiTipi ?? 0)
        const val = Number(getValue() ?? 0)
        // Yalnızca yazı rengi kırmızı (kullanıcı isteği). Sıfır iskonto nötr bırakıldı:
        // sütunun çoğu 0,00 ve hepsini kırmızıya boyamak, gerçekten iskonto uygulanmış
        // satırları görünmez kılıyordu.
        const renk = val > 0 ? 'text-red-600' : 'text-slate-400'
        return <div className={`text-right font-medium ${renk}`}>{formatInvoiceAmount(belgeParasina(val, curId, Number(row?.original?.kur ?? 0)), curId)}</div>
      }
    },
    {
      /*
        KAMPANYA İNDİRİMİ AYRI SÜTUN (2026-09-30 kullanıcı bildirimi: "fatura dökümünde paralar
        tutmuyor, bazı günler tutuyor bazıları sapıyor").

        Liste ucu İskonto'ya yalnız ELLE girilen iskontoyu koyuyor (`InvoiceListBaseQuery`:
        `Discount = inv.Discount - inv.CampaignDiscount`), kampanya payını ayrı taşıyor — ama bu
        sütun yoktu. Kampanyalı faturası olan günlerde toplam satırında Brüt − İskonto, Net'i
        tutmuyordu (Eylül: 58.780,09 TL fark = o ayın kampanya toplamı; canlıda doğrulandı,
        veritabanında her fatura tek tek tutuyor). Şimdi: Brüt − İskonto − Kampanya = Net.

        Sıralama ve süzgeç sunucuda (`kampanyaIndirimiOp/V1/V2`, `sortBy=kampanyaIndirimi`).
      */
      accessorKey: 'kampanyaIndirimi',
      header: 'Kampanya',
      meta: {
        filterType: 'number',
        filterPlaceholder: 'Kampanya...',
        showTotal: true,
        // Sütun değeri TL çapasıdır; toplam satırı da belgenin parasına çevrilsin.
        totalConvertFromTry: true,
        tryTotalLabel: 'TL'
      },
      cell: ({ row, getValue }) => {
        const curId = Number(row?.original?.paraBirimiTipi ?? 0)
        const val = Number(getValue() ?? 0)
        const renk = val > 0 ? 'text-red-600' : 'text-slate-400'
        return <div className={`text-right font-medium ${renk}`}>{formatInvoiceAmount(belgeParasina(val, curId, Number(row?.original?.kur ?? 0)), curId)}</div>
      }
    },
    {
      accessorKey: 'netTutar',
      header: 'Net Tutar',
      meta: {
        filterType: 'number',
        filterPlaceholder: 'Net...',
        showTotal: true,
        // Sütun değeri TL çapasıdır; toplam satırı da belgenin parasına çevrilsin.
        totalConvertFromTry: true,
        tryTotalLabel: 'TL'
      },
      cell: ({ row, getValue }) => {
        const curId = Number(row?.original?.paraBirimiTipi ?? 0)
        const val = Number(getValue() ?? 0)
        return <div className="text-right font-semibold text-slate-800">{formatInvoiceAmount(belgeParasina(val, curId, Number(row?.original?.kur ?? 0)), curId)}</div>
      }
    },
    {
      accessorKey: 'kdvTutari',
      header: 'KDV Tutarı',
      meta: {
        filterType: 'number',
        filterPlaceholder: 'KDV...',
        showTotal: true,
        // Sütun değeri TL çapasıdır; toplam satırı da belgenin parasına çevrilsin.
        totalConvertFromTry: true,
        tryTotalLabel: 'TL'
      },
      cell: ({ row, getValue }) => {
        const curId = Number(row?.original?.paraBirimiTipi ?? 0)
        const val = Number(getValue() ?? 0)
        return <div className="text-right font-medium text-slate-700">{formatInvoiceAmount(belgeParasina(val, curId, Number(row?.original?.kur ?? 0)), curId)}</div>
      }
    },
    {
      // KUR KOLONU: Belge dövizliyse döviz kodu ve kur burada görünür (örn: USD 38,4500).
      id: 'kur',
      header: 'Kur',
      accessorFn: (row: any) => Number(row?.kur ?? 0),
      meta: { filterType: 'text', filterPlaceholder: 'Kur...' },
      cell: ({ row }: any) => {
        const curId = Number(row?.original?.paraBirimiTipi ?? 0)
        const rate = Number(row?.original?.kur ?? 0)
        if (curId <= 1 || !(rate > 0)) return <div className="text-right text-slate-400">-</div>
        const code = curId === 3 ? 'USD' : curId === 2 ? 'EUR' : curId === 4 ? 'GBP' : ''
        return (
          <div className="text-right font-semibold text-slate-700 whitespace-nowrap">
            {code} {rate.toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
          </div>
        )
      }
    },
    {
      accessorKey: 'genelToplam',
      header: 'Genel Toplam',
      meta: {
        filterType: 'number',
        filterPlaceholder: 'Toplam...',
        showTotal: true,
        // Sütun değeri TL çapasıdır; toplam satırı da belgenin parasına çevrilsin.
        totalConvertFromTry: true,
        tryTotalLabel: 'TL'
      },
      cell: ({ row, getValue }) => {
        const curId = Number(row?.original?.paraBirimiTipi ?? 0)
        const val = Number(getValue() ?? 0)
        // Yalnızca yazı rengi yeşil (kullanıcı isteği): arka plan/rozet yok, sütun
        // içinde göz doğrudan genel toplama gitsin diye.
        return <div className="text-right font-bold text-emerald-600">{formatInvoiceAmount(belgeParasina(val, curId, Number(row?.original?.kur ?? 0)), curId)}</div>
      }
    },
    {
      /*
        ÇIKIŞ DEPOSU — malın hangi depodan çıktığı (2026-09-05 kullanıcı isteği).
        Depo fatura başlığında değil kalemlerde durduğu için sunucu birleştirip yolluyor;
        kalemler farklı depolardansa "Karışık (n depo): ..." gelir. O durumda hücrede kısa
        etiket, tamamı ipucunda görünür — sütun tek satırlık kalsın diye.
      */
      accessorKey: 'cikisDeposu',
      header: 'Çıkış Deposu',
      meta: {
        filterType: 'text',
        filterPlaceholder: 'Depo...'
      },
      cell: ({ getValue }) => {
        const ham = String(getValue() ?? '').trim()
        if (!ham) return <span className="text-slate-300">-</span>
        const karisik = ham.startsWith('Karışık')
        return (
          <span
            className={`truncate block ${karisik ? 'font-semibold text-amber-700' : 'text-slate-600'}`}
            title={ham}
          >
            {karisik ? ham.split(':')[0] : ham}
          </span>
        )
      }
    },
    {
      accessorKey: 'plasiyer',
      header: 'Plasiyer',
      meta: {
        filterType: 'text',
        filterPlaceholder: 'Plasiyer...'
      },
      cell: ({ getValue }) => <span className="text-slate-600 truncate block">{String(getValue() ?? '-')}</span>
    },
    {
      accessorKey: 'islemYapan',
      header: 'İşlem Yapan',
      meta: {
        filterType: 'text',
        filterPlaceholder: 'İşlem Yapan...'
      },
      cell: ({ getValue }) => <span className="text-slate-600 truncate block">{String(getValue() ?? '-')}</span>
    },
    {
      accessorKey: 'odemeAlindi',
      id: 'odemeDurumu',
      header: 'Ödeme Durumu',
      meta: {
        filterType: 'select',
        filterPlaceholder: 'Ödeme Durumu...',
        filterOptions: [
          { value: 'true', label: 'Ödendi' },
          { value: 'false', label: 'Ödenmedi' }
        ]
      },
      cell: ({ row }) => {
        const isPaid = Boolean(row.original.odemeAlindi)
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
              isPaid ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-200'
            }`}
          >
            {isPaid ? 'Ödendi' : 'Ödenmedi'}
          </span>
        )
      }
    }
  ]
}
