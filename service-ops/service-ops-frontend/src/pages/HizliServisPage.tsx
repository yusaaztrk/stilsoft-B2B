import { useEffect, useMemo, useRef, useState } from 'react'
import { Store, User, Wrench, Search, Plus, Minus, Trash2, ShoppingCart, ArrowLeft, Check, Loader2 } from 'lucide-react'

import { apiJson } from '../api/client'

/**
 * HIZLI SERVİS — sahada stoktan satış; kayıt SATIŞ FATURASI ekranına sipariş olarak düşer.
 *
 * Akış: cari tipi seç → cariyi seç → depodaki stoktan sepet kur → onayla.
 *
 * ## Fatura BURADA KESİLMEZ (kullanıcı kararı, 2026-08-21)
 *
 * Önce `technician-sale` / `create-direct-vehicle-sale` kullanılıyordu; o uç siparişi
 * açar açmaz faturayı da kesiyor, dolayısıyla kayıt yalnızca **Fatura Dökümü**nde
 * görünüyor ve **Satış Faturası** ekranına hiç düşmüyordu. Artık `quick-service-order`
 * yalnızca sipariş oluşturuyor; faturayı ofis kesiyor.
 *
 * ## Depo
 *
 * Kullanıcıya ATANMIŞ depolardan biri (`my-warehouses` = araç deposu + B2B depo yetkisi
 * birleşimi). Tek depo varsa seçici çıkmaz. Seçilen depo siparişin kalemlerine damgalanır
 * ki Satış Faturası ekranında "işlemi yapan depo" olarak gelsin — damgalanmazsa stok,
 * faturayı kesen kişinin varsayılan deposundan düşerdi.
 *
 * ## Ürünler ve adet
 *
 * Liste KATALOGDAN DEĞİL, seçilen deponun ENVANTERİNDEN gelir: yalnızca o depoda fiilen
 * bulunan mal satılabilir ve adet, bakiyeyi aşamaz. Sunucu aynı kontrolü tekrar yapar;
 * ekrandaki sınır yalnızca reddedilecek bir sepetin kurulmasını önler.
 */

type CariTip = 'bayi' | 'musteri' | 'servis'

/** Servis hizmet carisi sabit koddur; kullanıcı seçmez, doğrudan gelir. */
const SERVIS_HIZMET_CARI_KODU = '120-01-000954'

// Kategori süzgeci KALDIRILDI: liste artık katalogdan değil DEPO ENVANTERİNDEN geliyor,
// yani zaten yalnızca o depoda fiilen bulunan mal listeleniyor.

type CariSecenek = {
  code: string
  name: string
}

type Depo = {
  warehouseCode: number
  name: string
}

/** Depo envanterinden gelen satır: satılabilecek AZAMİ adet `balance`tır. */
type Urun = {
  stockCode: string
  name: string
  balance: number
}

type SepetSatiri = {
  stockCode: string
  name: string
  quantity: number
  /** O depodaki bakiye — sepet adedi bunu aşamaz. */
  balance: number
  /** Birim fiyat ERP'den cariye göre hesaplanır; ekranda düzenlenmez. */
  unitPrice?: number
}

const paraFormatla = (n: number) =>
  new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number.isFinite(n) ? n : 0
  )

export default function HizliServisPage() {
  const [cariTip, setCariTip] = useState<CariTip | null>(null)
  const [secilenCari, setSecilenCari] = useState<CariSecenek | null>(null)

  const [cariler, setCariler] = useState<CariSecenek[]>([])
  const [carilerYukleniyor, setCarilerYukleniyor] = useState(false)
  const [cariArama, setCariArama] = useState('')

  const [urunler, setUrunler] = useState<Urun[]>([])
  const [urunlerYukleniyor, setUrunlerYukleniyor] = useState(false)
  const [urunArama, setUrunArama] = useState('')

  const [sepet, setSepet] = useState<SepetSatiri[]>([])
  const [sepetAcik, setSepetAcik] = useState(false)
  const [fiyatYukleniyor, setFiyatYukleniyor] = useState(false)

  const [depolar, setDepolar] = useState<Depo[]>([])
  const [secilenDepo, setSecilenDepo] = useState<number | null>(null)
  const [depoUyarisi, setDepoUyarisi] = useState<string | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [gonderiliyor, setGonderiliyor] = useState(false)
  const [sonuc, setSonuc] = useState<string | null>(null)

  /**
   * KULLANICIYA ATANMIŞ DEPOLAR. `my-warehouses` araç deposu ile B2B depo yetkisini
   * BİRLEŞTİRİR — satış bunlardan birinden yapılır. Tek depo varsa seçici gösterilmez.
   */
  useEffect(() => {
    let iptal = false
    void (async () => {
      try {
        const res = await apiJson<{ success: boolean; data: any[] }>('/api/erp/my-warehouses')
        if (iptal) return
        const liste = (res?.data ?? [])
          .map((w) => ({ warehouseCode: Number(w?.warehouseCode), name: String(w?.name ?? '').trim() }))
          .filter((w) => Number.isFinite(w.warehouseCode) && w.warehouseCode !== 0)
        setDepolar(liste)
        if (liste.length === 1) setSecilenDepo(liste[0].warehouseCode)
        if (liste.length === 0) {
          setDepoUyarisi('Hesabınıza depo yetkisi tanımlanmamış. Hızlı Servis satışı için yöneticinizin size en az bir depo ataması gerekir.')
        }
      } catch (e: any) {
        if (!iptal) setDepoUyarisi(String(e?.message ?? 'Depo bilgisi alınamadı.'))
      }
    })()
    return () => {
      iptal = true
    }
  }, [])

  // Cari listesi yalnızca bayi/müşteri seçilince çekilir; servis hizmette liste yok.
  useEffect(() => {
    if (cariTip !== 'bayi' && cariTip !== 'musteri') return
    let iptal = false
    const ac = new AbortController()

    void (async () => {
      setCarilerYukleniyor(true)
      setHata(null)
      try {
        const yol = cariTip === 'bayi' ? '/api/erp/dealers' : '/api/erp/customers'
        const res = await apiJson<{ success: boolean; data: any }>(yol, { signal: ac.signal })
        const ham = Array.isArray(res?.data) ? res.data : (res?.data?.items ?? [])
        if (iptal) return
        setCariler(
          (ham as any[])
            .map((c) => ({
              code: String(c?.customerCode ?? c?.code ?? '').trim(),
              name: String(c?.name ?? c?.customerName ?? '').trim()
            }))
            .filter((c) => c.code)
        )
      } catch (e: any) {
        if (!iptal) setHata(String(e?.message ?? 'Cari listesi alınamadı'))
      } finally {
        if (!iptal) setCarilerYukleniyor(false)
      }
    })()

    return () => {
      iptal = true
      ac.abort()
    }
  }, [cariTip])

  /**
   * ÜRÜNLER DEPO ENVANTERİNDEN GELİR — katalogdan değil.
   *
   * Satılan mal fiilen seçilen depodan çıkıyor; kataloğu listelemek, depoda olmayan parçayı
   * satılabilir göstermek ve stoğu eksiye düşürmek demekti. Envanter satırı bakiyeyi de
   * taşıdığı için sepet adedi doğrudan orada sınırlanabiliyor.
   *
   * Yalnızca bakiyesi 0'dan büyük satırlar listelenir.
   */
  useEffect(() => {
    if (!secilenCari || secilenDepo == null) return
    let iptal = false
    const ac = new AbortController()

    void (async () => {
      setUrunlerYukleniyor(true)
      setHata(null)
      try {
        // DİKKAT — VEKİL UÇ YANITI YENİDEN ŞEKİLLENDİRİYOR.
        //
        // B2B `data: { items: [{ stockCode, stockName, balance }] }` döner ama ServiceOps
        // vekili bunu DÜZ BİR DİZİYE çevirip alan adlarını da değiştirir:
        // `data: [{ partNumber, productName, quantity }]`. B2B'nin ham şekli okunduğunda
        // liste sessizce boş kalıyor ve ekran "bu depoda stok yok" diyordu — oysa depo doluydu.
        const res = await apiJson<{ success: boolean; data: any[] }>(
          `/api/erp/warehouses/${secilenDepo}/inventory`,
          { signal: ac.signal }
        )
        if (iptal) return
        const items = Array.isArray(res?.data) ? res.data : []
        setUrunler(
          items
            .map((p: any) => ({
              stockCode: String(p?.partNumber ?? p?.productId ?? p?.id ?? '').trim(),
              name: String(p?.productName ?? p?.name ?? '').trim(),
              balance: Number(p?.quantity ?? 0)
            }))
            .filter((p: Urun) => p.stockCode && p.balance > 0)
        )
      } catch (e: any) {
        if (!iptal) setHata(String(e?.message ?? 'Depo stoğu alınamadı'))
      } finally {
        if (!iptal) setUrunlerYukleniyor(false)
      }
    })()

    return () => {
      iptal = true
      ac.abort()
    }
  }, [secilenCari, secilenDepo])

  const filtreliCariler = useMemo(() => {
    const q = cariArama.trim().toLocaleLowerCase('tr')
    if (!q) return cariler.slice(0, 300)
    return cariler
      .filter((c) => c.code.toLocaleLowerCase('tr').includes(q) || c.name.toLocaleLowerCase('tr').includes(q))
      .slice(0, 300)
  }, [cariler, cariArama])

  const filtreliUrunler = useMemo(() => {
    const q = urunArama.trim().toLocaleLowerCase('tr')
    if (!q) return urunler.slice(0, 300)
    return urunler
      .filter(
        (p) =>
          p.stockCode.toLocaleLowerCase('tr').includes(q) || p.name.toLocaleLowerCase('tr').includes(q)
      )
      .slice(0, 300)
  }, [urunler, urunArama])

  const sepetAdet = sepet.reduce((a, s) => a + s.quantity, 0)
  const sepetToplam = sepet.reduce((a, s) => a + (s.unitPrice ?? 0) * s.quantity, 0)
  const fiyatiBilinmeyenVar = sepet.some((s) => s.unitPrice == null)

  /**
   * Fiyatlar ERP'de CARİYE göre hesaplanır (fiyat grubu, döviz, iskonto orada çözülür).
   * Ekran fiyat üretmez — ürettiği an ekranla fatura birbirini tutmaz.
   */
  const fiyatlariGuncelle = async (satirlar: SepetSatiri[]) => {
    const kodlar = satirlar.map((s) => s.stockCode)
    if (!secilenCari || kodlar.length === 0) return

    setFiyatYukleniyor(true)
    try {
      const res = await apiJson<{ success: boolean; data: any[] }>(
        '/api/erp/technician-sale/calculate-prices',
        {
          method: 'POST',
          body: JSON.stringify({ customerCode: secilenCari.code, stockCodes: kodlar })
        }
      )
      const harita = new Map<string, number>()
      for (const r of res?.data ?? []) {
        const kod = String(r?.stockCode ?? '').trim()
        const fiyat = Number(r?.unitPrice)
        if (kod && Number.isFinite(fiyat)) harita.set(kod, fiyat)
      }
      setSepet((prev) => prev.map((s) => ({ ...s, unitPrice: harita.get(s.stockCode) ?? s.unitPrice })))
    } catch (e: any) {
      setHata(String(e?.message ?? 'Fiyatlar alınamadı'))
    } finally {
      setFiyatYukleniyor(false)
    }
  }

  // Fiyat isteğini her tıklamada atmamak için sepet durulunca tek sefer çalışır.
  const fiyatZamanlayici = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (sepet.length === 0) return
    if (fiyatZamanlayici.current) clearTimeout(fiyatZamanlayici.current)
    fiyatZamanlayici.current = setTimeout(() => void fiyatlariGuncelle(sepet), 350)
    return () => {
      if (fiyatZamanlayici.current) clearTimeout(fiyatZamanlayici.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sepet.map((s) => `${s.stockCode}:${s.quantity}`).join('|'), secilenCari?.code])

  // ADET DEPO BAKİYESİNİ AŞAMAZ. Sunucu da aynı kontrolü yapıyor; buradaki sınır yalnızca
  // kullanıcıyı reddedilecek bir sepeti kurmaktan kurtarıyor.
  const sepeteEkle = (u: Urun) => {
    setSepet((prev) => {
      const v = prev.find((s) => s.stockCode === u.stockCode)
      if (v) {
        return prev.map((s) =>
          s.stockCode === u.stockCode ? { ...s, quantity: Math.min(s.quantity + 1, s.balance) } : s
        )
      }
      return [...prev, { stockCode: u.stockCode, name: u.name, quantity: 1, balance: u.balance }]
    })
  }

  const adetDegistir = (stockCode: string, delta: number) => {
    setSepet((prev) =>
      prev
        .map((s) =>
          s.stockCode === stockCode
            ? { ...s, quantity: Math.min(Math.max(0, s.quantity + delta), s.balance) }
            : s
        )
        .filter((s) => s.quantity > 0)
    )
  }

  const satirSil = (stockCode: string) => setSepet((prev) => prev.filter((s) => s.stockCode !== stockCode))

  const basaDon = () => {
    setCariTip(null)
    setSecilenCari(null)
    setCariler([])
    setCariArama('')
    setUrunler([])
    setUrunArama('')
    setSepet([])
    setSepetAcik(false)
    setHata(null)
  }

  /**
   * SİPARİŞ olarak gönderilir, fatura BURADA KESİLMEZ.
   *
   * Önce doğrudan satış ucu kullanılıyordu; o uç faturayı anında kesip kapattığı için kayıt
   * yalnızca Fatura Dökümü'nde görünüyor, Satış Faturası ekranına hiç düşmüyordu.
   */
  const faturayaGonder = async () => {
    if (!secilenCari || sepet.length === 0 || gonderiliyor || secilenDepo == null) return
    setGonderiliyor(true)
    setHata(null)
    try {
      const res = await apiJson<{ success: boolean; data?: any; message?: string }>(
        '/api/erp/quick-service-order',
        {
          method: 'POST',
          body: JSON.stringify({
            customerCode: secilenCari.code,
            warehouseCode: secilenDepo,
            lines: sepet.map((s) => ({ stockCode: s.stockCode, quantity: s.quantity }))
          })
        }
      )
      const no = res?.data?.siparisNo ?? res?.data?.orderNo ?? ''
      setSonuc(
        no
          ? `Satış Faturası ekranına gönderildi. Sipariş no: ${no}`
          : 'Satış Faturası ekranına gönderildi.'
      )
      setSepet([])
      setSepetAcik(false)
    } catch (e: any) {
      setHata(String(e?.message ?? 'Gönderilemedi'))
    } finally {
      setGonderiliyor(false)
    }
  }

  // ————————————————————————————— Ekranlar —————————————————————————————

  if (depoUyarisi) {
    return (
      <div className="p-4 sm:p-5">
        <Baslik />
        <div className="max-w-xl rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-5">
          <div className="font-bold text-amber-900 dark:text-amber-200 text-sm">Satış yapılamıyor</div>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300 leading-relaxed break-words">
            {depoUyarisi}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-5 pb-28">
      <Baslik />

      {sonuc && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 px-4 py-3 flex items-start gap-2">
          <Check className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-200 break-words">{sonuc}</div>
            <button
              type="button"
              onClick={() => {
                setSonuc(null)
                basaDon()
              }}
              className="mt-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 underline"
            >
              Yeni satış
            </button>
          </div>
        </div>
      )}

      {hata && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-900 px-4 py-3 text-xs text-rose-800 dark:text-rose-200 break-words">
          {hata}
        </div>
      )}

      {/* 1. adım — cari tipi */}
      {!cariTip && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
          <TipKarti
            icon={<Store className="w-6 h-6" />}
            baslik="Bayi Satış"
            aciklama="Bayi cari listesinden seç"
            onClick={() => setCariTip('bayi')}
          />
          <TipKarti
            icon={<User className="w-6 h-6" />}
            baslik="Müşteri Satış"
            aciklama="Müşteri cari listesinden seç"
            onClick={() => setCariTip('musteri')}
          />
          <TipKarti
            icon={<Wrench className="w-6 h-6" />}
            baslik="Servis Hizmet"
            aciklama="Servis hizmet carisine yaz"
            onClick={() => {
              setCariTip('servis')
              setSecilenCari({ code: SERVIS_HIZMET_CARI_KODU, name: 'SERVİS HİZMET' })
            }}
          />
        </div>
      )}

      {/* 2. adım — cari seçimi (yalnız bayi/müşteri) */}
      {cariTip && !secilenCari && (
        <div className="max-w-2xl">
          <GeriDugmesi onClick={basaDon} />
          <div className="relative mb-3">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={cariArama}
              onChange={(e) => setCariArama(e.target.value)}
              placeholder={cariTip === 'bayi' ? 'Bayi ara...' : 'Müşteri ara...'}
              className="w-full h-11 pl-9 pr-3 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
            />
          </div>

          {carilerYukleniyor ? (
            <Yukleniyor />
          ) : (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden max-h-[60vh] overflow-y-auto bg-white dark:bg-gray-800">
              {filtreliCariler.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-gray-500">Kayıt bulunamadı.</div>
              )}
              {filtreliCariler.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setSecilenCari(c)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 active:bg-gray-100"
                >
                  <div className="text-sm font-semibold text-gray-900 dark:text-white break-words">{c.name || c.code}</div>
                  <div className="text-[11px] text-gray-500 break-words">{c.code}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. adım — ürünler */}
      {secilenCari && (
        <div>
          <GeriDugmesi onClick={basaDon} />

          <div className="mb-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Cari</div>
            <div className="text-sm font-bold text-gray-900 dark:text-white break-words">
              {secilenCari.name || secilenCari.code}
            </div>
            <div className="text-[11px] text-gray-500 break-words">{secilenCari.code}</div>
          </div>

          {/* Depo seçici yalnızca birden fazla yetkili depo varsa görünür; tek depoda
              seçilecek bir şey yok, ama hangi depodan düşeceği yine de yazıyor. */}
          <div className="mb-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">
              Çıkış Deposu
            </div>
            {depolar.length > 1 ? (
              <select
                value={secilenDepo ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value)
                  setSecilenDepo(v)
                  setSepet([])
                }}
                className="w-full h-10 px-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white"
              >
                <option value="">Depo seçiniz…</option>
                {depolar.map((d) => (
                  <option key={d.warehouseCode} value={d.warehouseCode}>
                    [{d.warehouseCode}] {d.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-sm font-bold text-gray-900 dark:text-white break-words">
                {depolar[0] ? `[${depolar[0].warehouseCode}] ${depolar[0].name}` : '—'}
              </div>
            )}
          </div>

          <div className="relative mb-3">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={urunArama}
              onChange={(e) => setUrunArama(e.target.value)}
              placeholder="Stokta ara..."
              className="w-full h-11 pl-9 pr-3 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
            />
          </div>

          {urunlerYukleniyor ? (
            <Yukleniyor />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filtreliUrunler.length === 0 && (
                <div className="col-span-full px-4 py-6 text-center text-xs text-gray-500">
                  Bu depoda satılabilecek stok yok.
                </div>
              )}
              {filtreliUrunler.map((u) => {
                const sepetteki = sepet.find((s) => s.stockCode === u.stockCode)
                return (
                  <div
                    key={u.stockCode}
                    className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-gray-900 dark:text-white break-words">{u.name}</div>
                      <div className="text-[11px] text-gray-500 break-words">
                        {u.stockCode} · Stok: <b>{u.balance}</b>
                      </div>
                    </div>
                    {sepetteki ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => adetDegistir(u.stockCode, -1)}
                          className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-300"
                          aria-label="Azalt"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-6 text-center text-xs font-bold text-gray-900 dark:text-white">
                          {sepetteki.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => adetDegistir(u.stockCode, 1)}
                          className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center"
                          aria-label="Artır"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => sepeteEkle(u)}
                        className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center"
                        aria-label="Sepete ekle"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Sepet çubuğu — mobilde ekranın altına sabit */}
      {sepet.length > 0 && !sepetAcik && (
        <button
          type="button"
          onClick={() => setSepetAcik(true)}
          className="fixed left-3 right-3 bottom-3 sm:left-auto sm:right-6 sm:w-80 h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg flex items-center justify-between px-5 z-40"
        >
          <span className="flex items-center gap-2 font-semibold text-sm">
            <ShoppingCart className="w-4 h-4" />
            Sepet ({sepetAdet})
          </span>
          <span className="font-bold text-sm">
            {fiyatYukleniyor || fiyatiBilinmeyenVar ? '—' : `${paraFormatla(sepetToplam)} ₺`}
          </span>
        </button>
      )}

      {/* Sepet paneli */}
      {sepetAcik && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40">
          <div className="w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div className="font-bold text-sm text-gray-900 dark:text-white">Sepet</div>
              <button
                type="button"
                onClick={() => setSepetAcik(false)}
                className="text-xs font-semibold text-gray-500 px-2 py-1"
              >
                Kapat
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
              {sepet.map((s) => (
                <div key={s.stockCode} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-gray-900 dark:text-white break-words">{s.name}</div>
                    <div className="text-[11px] text-gray-500 break-words">
                      {s.stockCode}
                      {s.unitPrice != null && ` · ${paraFormatla(s.unitPrice)} ₺`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => adetDegistir(s.stockCode, -1)}
                      className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-600 flex items-center justify-center"
                      aria-label="Azalt"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-6 text-center text-xs font-bold text-gray-900 dark:text-white">{s.quantity}</span>
                    <button
                      type="button"
                      onClick={() => adetDegistir(s.stockCode, 1)}
                      className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center"
                      aria-label="Artır"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => satirSil(s.stockCode)}
                      className="w-7 h-7 rounded-lg text-rose-600 flex items-center justify-center"
                      aria-label="Sil"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-500">Toplam</span>
                <span className="text-base font-bold text-gray-900 dark:text-white">
                  {fiyatYukleniyor || fiyatiBilinmeyenVar ? 'Hesaplanıyor…' : `${paraFormatla(sepetToplam)} ₺`}
                </span>
              </div>
              <button
                type="button"
                disabled={gonderiliyor || sepet.length === 0 || secilenDepo == null}
                onClick={() => void faturayaGonder()}
                className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2"
              >
                {gonderiliyor ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {gonderiliyor ? 'Gönderiliyor…' : 'Onayla ve Satış Faturasına Gönder'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Baslik() {
  return (
    <div className="mb-4">
      <h1 className="text-gray-900 dark:text-white font-bold text-lg leading-tight">Hızlı Servis</h1>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        Yedek parça satışı. Sepet onaylanınca satış faturası oluşur ve stok araç deponuzdan düşer.
      </p>
    </div>
  )
}

function TipKarti(props: { icon: React.ReactNode; baslik: string; aciklama: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-left hover:border-emerald-400 hover:shadow-sm transition"
    >
      <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 flex items-center justify-center mb-3">
        {props.icon}
      </div>
      <div className="font-bold text-sm text-gray-900 dark:text-white">{props.baslik}</div>
      <div className="text-[11px] text-gray-500 mt-0.5 break-words">{props.aciklama}</div>
    </button>
  )
}

function GeriDugmesi({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Başa dön
    </button>
  )
}

function Yukleniyor() {
  return (
    <div className="py-10 flex items-center justify-center text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  )
}
