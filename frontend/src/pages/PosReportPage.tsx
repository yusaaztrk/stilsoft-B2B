import { useEffect, useMemo, useState } from 'react'
import Table, { type TableColumn } from '../components/Table'
import Modal from '../components/Modal'
import {
  fetchPosTransactions,
  posOutcomeLabel,
  posOutcomeHint,
  posOutcomeOf,
  posOutcomeToneClass,
  saveReceiptNo,
  type VirtualPosTransactionDto
} from '../api/virtualPos'

const money = (n: number) =>
  Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const dateTR = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

/** Çekimin saati. Tarih sütunu yalnızca günü gösteriyordu; aynı gün içindeki iki çekim
 *  ayırt edilemiyordu. */
const timeTR = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Kart numarasının EKRANDA gösterilebilir hâli: yalnızca SON 4 HANE.
 *
 * Veritabanında maskeli hâli `528208******9916` biçiminde duruyor — yani ilk 6 (BIN) +
 * son 4. PCI DSS bu ikisini birlikte göstermeye izin verir, ama BIN kartı çıkaran bankayı
 * söyler ve o bilgi zaten "Banka Adı" sütununda var; ekranda taşımanın bir faydası yok.
 * Kartı tekil olarak tanıtan güvenli parça SON 4 HANEDİR, makbuzlarda da o kullanılır.
 *
 * Hangi biçimde gelirse gelsin (maskeli, boşluklu, ya da hiç maskelenmemiş ham numara)
 * son dört haneden başkası dışarı çıkmaz.
 */
const cardLast4 = (masked: string | null | undefined) => {
  const digits = String(masked ?? '').replace(/\D/g, '')
  if (digits.length < 4) return ''
  return `**** ${digits.slice(-4)}`
}

/**
 * Telefon sütununa KART NUMARASI düşmesin diye son savunma.
 *
 * Canlıda telefon girilmemiş çekimlerde bu sütunda 16 haneli bir kart numarası göründü
 * (tarayıcının kart otomatik doldurması etiketsiz telefon kutusunu da doldurmuştu).
 * Kaynak hem formda hem sunucuda kapatıldı, ama ESKİ SATIRLAR veritabanında öyle duruyor:
 * kart gibi görünen bir değer burada hiç basılmaz, sütun boş kalır.
 */
const safePhone = (raw: string | null | undefined) => {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  // Telefon en fazla 17 hane; 13-19 hane kart numarası aralığıdır.
  if (digits.length >= 13 && luhnValid(digits)) return ''
  return value
}

/** Kart numaralarının taşıdığı sağlama. Telefon numaraları bunu tesadüfen nadiren geçer. */
function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (n < 0 || n > 9) return false
    if (double) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    double = !double
  }
  return sum % 10 === 0
}

export default function PosReportPage() {
  const [rows, setRows] = useState<VirtualPosTransactionDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  /**
   * Ortak tablo sütun süzgeçlerini KENDİ İÇİNDE tutuyor; dışarıdan temizlemenin yolu yok.
   * "Filtreleri temizle" bu anahtarı değiştirip tabloyu yeniden kurar — süzgeçler de,
   * sıralama da sıfırlanır. Sayfanın kendi süzgeç durumunu tutmasından çok daha az kod.
   */
  const [tableKey, setTableKey] = useState(0)

  const [editing, setEditing] = useState<VirtualPosTransactionDto | null>(null)
  const [receiptDraft, setReceiptDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      setRows(await fetchPosTransactions())
    } catch (e: any) {
      setError(e?.message || 'Çekim listesi yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const openReceipt = (row: VirtualPosTransactionDto) => {
    setEditing(row)
    setReceiptDraft(row.receiptNo || '')
    setModalError(null)
  }

  const submitReceipt = async () => {
    if (!editing) return
    try {
      setSaving(true)
      setModalError(null)
      const saved = await saveReceiptNo(editing.id, receiptDraft.trim())

      // Patch the row in place instead of refetching: the list is long, and reloading it
      // would throw away the filters the user is working inside.
      setRows((prev) => prev.map((r) => (r.id === editing.id ? { ...r, receiptNo: saved } : r)))
      setEditing(null)
    } catch (e: any) {
      setModalError(e?.message || 'Makbuz kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  /** Tek çekim (0/1) "Peşin", 2 ve üstü "N Taksit". */
  const taksitMetni = (count: number | null | undefined) => {
    const n = Number(count ?? 0)
    return n > 1 ? `${n} Taksit` : 'Peşin'
  }

  const columns = useMemo<TableColumn<VirtualPosTransactionDto>[]>(() => [
    {
      key: 'date',
      label: 'Tarih',
      // Süzgeç ve sıralama EKRANDA GÖRÜNEN metin üzerinden çalışsın diye tarih burada
      // biçimlendiriliyor: ham ISO değerinde kullanıcı "22.08" yazıp arayamazdı.
      // Ortak sıralayıcı gg.aa.yyyy biçimini tanıyıp gerçek tarih sırasına diziyor.
      //
      // `date` SÜZGECİ: kolon tarih olarak işaretlenmezse ortak tablo onu düz metin sayar
      // ve ilk açılışta bugüne ayarlama kuralı bu sütunu atlar.
      filter: { type: 'date' },
      accessorFn: (r) => dateTR(r.transactionDate)
    },
    {
      key: 'time',
      label: 'Saat',
      accessorFn: (r) => timeTR(r.transactionDate)
    },
    { key: 'bankDocumentNo', label: 'Banka Belge Numarası' },
    {
      key: 'customer',
      label: 'Cari Adı',
      accessorFn: (r) => `${r.customerCode ? `(${r.customerCode})` : ''}${r.customerName ?? ''}`
    },
    { key: 'bankName', label: 'Banka Adı' },
    {
      key: 'amount',
      label: 'Tutar',
      accessorFn: (r) => Number(r.amount ?? 0),
      render: (_v, r) => <span className="tabular-nums">{money(Number(r.amount ?? 0))}</span>,
      /*
        ALTTA GENEL TOPLAM (2026-09-20 kullanıcı isteği, fatura dökümündeki gibi).
        Yalnız BAŞARILI çekimler toplanır: başarısız, doğrulanamamış ve tamamlanmamış
        satırlar listede duruyor ama para çekilmedi; onları toplamak kasada olmayan
        parayı gösterirdi. Süzgeç/arama uygulanınca görünen satırlar üzerinden hesaplanır.
      */
      showTotal: true,
      totalCurrencyCode: 'TRY',
      totalRowFilter: (r) => posOutcomeOf(r) === 'success'
    },
    {
      /*
        PEŞİN / TAKSİT (2026-10-04 kullanıcı isteği). Kayıttaki taksit sayısı 0 ya da 1 ise tek
        çekim (peşin); 2 ve üstü "N Taksit". Süzgeç görünen metin üzerinden çalışır: "Peşin"
        ya da "Taksit" yazmak ikiye ayırır. `render` ŞART — bkz. Kart No sütunundaki not.
      */
      key: 'paymentType' as any,
      label: 'Peşin / Taksit',
      accessorFn: (r) => taksitMetni(r.installmentCount),
      render: (_v, r) => {
        const n = Number(r.installmentCount ?? 0)
        return n > 1
          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 whitespace-nowrap">{n} Taksit</span>
          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">Peşin</span>
      }
    },
    {
      key: 'approval',
      label: 'Onay',
      accessorFn: (r) => posOutcomeLabel(posOutcomeOf(r), r),
      // Dört hal: kesin başarı, kesin ret, doğrulanamamış (para çekilmiş olabilir) ve banka
      // hiç dönmemiş. Bkz. `posOutcomeOf`.
      render: (_v, r) => (
        <span className={`font-medium ${posOutcomeToneClass(posOutcomeOf(r))}`} title={posOutcomeHint(posOutcomeOf(r), r)}>
          {posOutcomeLabel(posOutcomeOf(r), r)}
        </span>
      )
    },
    { key: 'cardHolderName', label: 'Kart Sahibi' },
    {
      key: 'maskedCardNumber',
      label: 'Kart No',
      // `render` ŞART, tek başına `accessorFn` YETMEZ: ortak tablo hücreyi
      // `row.original[key] ?? getValue()` ile basıyor (Table.tsx), yani satırda o adda bir
      // alan VARSA ham değeri kazanıyor ve accessorFn hiç devreye girmiyor. `date`/`time`
      // sütunlarında çalışmasının sebebi o adda bir alanın hiç bulunmaması. Burada
      // `maskedCardNumber` ve `phone` alanları var; `render` olmadan maskesiz/ham değer
      // ekrana düşer. accessorFn yine duruyor — süzgeç ve sıralama onun üzerinden çalışsın.
      accessorFn: (r) => cardLast4(r.maskedCardNumber),
      render: (_v, r) => <span className="tabular-nums">{cardLast4(r.maskedCardNumber)}</span>
    },
    {
      key: 'phone',
      label: 'Telefon',
      // Telefon girilmemişse BOŞ kalır — buraya kart numarası basılmaz, bkz. `safePhone`.
      accessorFn: (r) => safePhone(r.phone),
      render: (_v, r) => <span>{safePhone(r.phone)}</span>
    },
    { key: 'receiptNo', label: 'Makbuz Numarası' },
    {
      key: 'actions',
      label: 'İşlemler',
      render: (_v, r) =>
        // Only a captured payment can carry a receipt; the server enforces the same rule,
        // this just keeps the offer off rows it would refuse.
        posOutcomeOf(r) === 'success' ? (
          <button
            type="button"
            onClick={() => openReceipt(r)}
            className="text-[#c2410c] hover:text-[#a51c12] font-medium hover:underline"
          >
            {r.receiptNo ? 'Makbuz Düzenle' : 'Makbuz Gir'}
          </button>
        ) : null
    }
  ], [])

  return (
    <div className="p-4">
      <div className="flex items-end justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Pos Çekim Listesi</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {loading ? 'Yükleniyor…' : `${rows.length} kayıt`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setSearch(''); setTableKey((k) => k + 1) }}
            className="h-9 px-3 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-xs font-medium"
          >
            Filtreleri temizle
          </button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Arama…"
            className="h-9 w-64 border border-slate-300 rounded-lg px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#a51c12]/20 focus:border-[#a51c12]"
          />
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>
      )}

      <Table<VirtualPosTransactionDto>
          onRefresh={() => void load()}
        key={tableKey}
        columns={columns}
        data={rows}
        rowKey={(r) => String(r.id)}
        globalSearch={search}
        loading={loading}
      />

      <Modal
        isOpen={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Makbuz Gir"
        maxWidth="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="h-9 px-4 rounded-lg border border-slate-300 text-slate-700 text-xs font-medium"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitReceipt()}
              className="h-9 px-5 rounded-lg bg-gradient-to-b from-[#a51c12] to-[#7d1409] hover:from-[#b4200f] disabled:opacity-50 text-white text-xs font-semibold"
            >
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Cari</div>
                <div className="text-slate-800 mt-0.5">{editing.customerName || editing.customerCode}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Tutar</div>
                <div className="text-slate-900 font-semibold mt-0.5 tabular-nums">{money(editing.amount)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Banka</div>
                <div className="text-slate-800 mt-0.5">{editing.bankName}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Belge No</div>
                <div className="text-slate-800 mt-0.5">{editing.bankDocumentNo}</div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">MAKBUZ NUMARASI</label>
              <input
                autoFocus
                value={receiptDraft}
                maxLength={30}
                onChange={(e) => setReceiptDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitReceipt() }}
                placeholder="A 20281"
                className="w-full h-10 border border-slate-300 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#a51c12]/20 focus:border-[#a51c12]"
              />
              <div className="mt-1 text-[11px] text-slate-400">
                Boş bırakıp kaydederseniz mevcut makbuz numarası silinir.
              </div>
            </div>

            {modalError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{modalError}</div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
