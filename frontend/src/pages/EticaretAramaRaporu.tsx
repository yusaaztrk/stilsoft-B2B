import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Camera, PackageSearch, PhoneCall, RefreshCcw, Search, TrendingUp } from 'lucide-react'

/*
  VİTRİN ARAMA RAPORU (2026-09-20) — E-Ticaret → Arama Raporu.

  Ziyaretçinin vitrindeki arama kutusuna ne yazdığı ve kaç sonuç çıktığı.

  Asıl bakılacak liste "SONUÇ ÇIKMAYAN ARAMALAR": vitrin kuralı gereği ürünün görünmesi için
  aktif + görselli + katalog fiyatlı olması gerekiyor; görseli olmadığı için listeye hiç
  girmeyen yüzlerce ürün var. Aranıp bulunamayan terim, hangi ürünün fotoğrafının çekilmesi
  ya da stoklanması gerektiğini tahmine gerek bırakmadan söylüyor.

  Menüden gelen hazır bağlantılar (Ankastre Fırınlar gibi) da adreste `ara=` taşıyor ama
  KAYDEDİLMİYOR — yalnız arama kutusundan gelen istek kaydediliyor. Yoksa bu rapor,
  kimsenin yazmadığı terimlerle dolardı.
*/

const SHOP_API =
  (import.meta as any).env?.VITE_SHOP_API_BASE_URL ||
  (import.meta as any).env?.VITE_SHOP_API_URL ||
  'http://localhost:5150'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('accessToken')
  const tenant = localStorage.getItem('tenantCode')
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenant ? { 'X-Tenant-Code': tenant } : {})
  }
}

type TermRow = {
  term: string
  sample: string
  count: number
  averageResults: number
  lastSearchedUtc: string
}

type Insights = {
  days: number
  totalSearches: number
  zeroResultSearches: number
  distinctTerms: number
  topTerms: TermRow[]
  zeroResultTerms: TermRow[]
}

/** Görseli olmadığı için vitrine hiç giremeyen ürün. */
type PhotoRow = {
  stockCode: string
  name: string
  category?: string | null
  price: number
  stock: number
}

/** "Gelince haber ver" talebi — tükenen üründe telefonunu bırakanlar. */
type DemandRow = {
  stockCode: string
  name?: string | null
  waiting: number
  inStock: boolean
  stockQuantity?: number | null
  firstRequestedUtc: string
  lastRequestedUtc: string
}

/** "Sizi arayalım" talebi — adını ve numarasını bırakan ziyaretçi (2026-09-21). */
type CallbackRow = {
  id: number
  name: string
  phone: string
  stockCode?: string | null
  productName?: string | null
  note?: string | null
  source: string
  createdAtUtc: string
  doneAtUtc?: string | null
  doneNote?: string | null
}

/*
  TELEFON GÖSTERİMİ.

  Numara veritabanında SMS servisinin kanonik biçiminde duruyor ("5330000012"): aynı kişinin
  "0533…" ve "+90533…" yazması iki ayrı kayıt üretmesin diye. Bu biçim okunaklı değil ve
  `tel:5330000012` bağlantısı ülke kodu olmadan her cihazda doğru çevrilmiyor.

  On haneli numaralar KKTC/TR (cep 5xx, Lefkoşa sabit 392) kabul edilip başına +90 konuyor;
  daha uzun numara zaten ülke kodunu taşıyordur, olduğu gibi bırakılıyor.
*/
const telefonCevir = (p: string) => {
  const d = (p || '').replace(/\D/g, '')
  return d.length === 10 ? `+90${d}` : `+${d}`
}

const telefonYaz = (p: string) => {
  const d = (p || '').replace(/\D/g, '')
  if (d.length !== 10) return p
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`
}

const KAYNAK_ETIKET: Record<string, string> = {
  urun: 'Ürün sayfası',
  sepet: 'Sepet',
  genel: 'Genel',
  '404': 'Bulunamayan sayfa',
  iletisim: 'İletişim formu',
  // Ödeme adımında takılan müşteri: ürünü seçmiş, tutarı kabul etmiş, son adımda durmuş.
  // Listedeki EN SICAK müşteri bu — önce bu satırlar aranmalı.
  odeme: 'Ödeme adımı',
  // /kurumsal-satis teklif formu (2026-10-04): toplu alım — kurumsal satış danışmanına.
  kurumsal: 'Kurumsal satış',
}

const GUN_SECENEKLERI = [7, 30, 90]

const tarih = (v?: string | null) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('tr-TR')
}

/* Geri arama talebinde SAAT de lazım: "dün 23:10'da bıraktı" ile "5 dk önce bıraktı" farklı
   aciliyetler; yalnız tarih göstermek bu ayrımı yok ederdi. */
const tarihSaat = (v?: string | null) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function EticaretAramaRaporu() {
  const [data, setData] = useState<Insights | null>(null)
  const [talep, setTalep] = useState<DemandRow[]>([])
  const [foto, setFoto] = useState<{ total: number; items: PhotoRow[] }>({ total: 0, items: [] })
  const [aramalar, setAramalar] = useState<CallbackRow[]>([])
  const [arananId, setArananId] = useState<number | null>(null)
  const [gun, setGun] = useState(30)
  const [busy, setBusy] = useState(false)
  const [hata, setHata] = useState<string | null>(null)

  const yukle = useCallback(async (gunSayisi: number) => {
    setBusy(true)
    setHata(null)
    try {
      const [aramaRes, talepRes, fotoRes, geriRes] = await Promise.all([
        fetch(`${SHOP_API}/api/admin/search-insights?gun=${gunSayisi}&adet=50`, { headers: authHeaders() }),
        fetch(`${SHOP_API}/api/admin/search-insights/stock-demand?adet=50`, { headers: authHeaders() }),
        fetch(`${SHOP_API}/api/admin/search-insights/missing-photos?adet=100`, { headers: authHeaders() }),
        fetch(`${SHOP_API}/api/admin/callbacks?bekleyen=true&adet=100`, { headers: authHeaders() })
      ])

      if (!aramaRes.ok) throw new Error(`Rapor alınamadı (${aramaRes.status})`)
      const json = await aramaRes.json()
      setData(json?.data ?? null)

      // Talep listesi alınamazsa arama raporu yine görünsün: ikisi ayrı bilgi.
      if (talepRes.ok) {
        const tj = await talepRes.json()
        setTalep(Array.isArray(tj?.data) ? tj.data : [])
      } else {
        setTalep([])
      }

      // Fotoğraf listesi alınamazsa diğer iki rapor yine görünsün.
      if (fotoRes.ok) {
        const fj = await fotoRes.json()
        setFoto({ total: Number(fj?.data?.total ?? 0), items: Array.isArray(fj?.data?.items) ? fj.data.items : [] })
      } else {
        setFoto({ total: 0, items: [] })
      }

      // Geri arama listesi alınamazsa diğer raporlar yine görünsün (eski sunucuda uç yok).
      if (geriRes.ok) {
        const gj = await geriRes.json()
        setAramalar(Array.isArray(gj?.data?.items) ? gj.data.items : [])
      } else {
        setAramalar([])
      }
    } catch (e: any) {
      setHata(e?.message || 'Rapor alınamadı.')
      setData(null)
    } finally {
      setBusy(false)
    }
  }, [])

  /*
    "ARANDI" İŞARETİ.

    Kayıt SİLİNMİYOR, done_at yazılıyor: kim ne zaman arandı izi kalsın. Listeden hemen
    düşürülüyor (sunucu yanıtını beklemeden değil — yanıt geldikten sonra), çünkü bu liste
    "şimdi aranacaklar" listesi; kapatılan satırın orada durması iki kez aranmaya yol açar.
  */
  const arandiIsaretle = useCallback(async (id: number) => {
    setArananId(id)
    try {
      const res = await fetch(`${SHOP_API}/api/admin/callbacks/${id}/done`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: null })
      })
      if (!res.ok) throw new Error(`İşaretlenemedi (${res.status})`)
      setAramalar((liste) => liste.filter((x) => x.id !== id))
    } catch (e: any) {
      setHata(e?.message || 'İşaretlenemedi.')
    } finally {
      setArananId(null)
    }
  }, [])

  useEffect(() => {
    void yukle(gun)
  }, [gun, yukle])

  const bosVeri = data && data.totalSearches === 0 && talep.length === 0 && foto.total === 0 && aramalar.length === 0

  const tablo = (
    baslik: string,
    aciklama: string,
    satirlar: TermRow[],
    ikon: React.ReactNode,
    vurgu: boolean
  ) => (
    <div className="flex-1 min-w-0 rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className={`px-4 py-3 border-b ${vurgu ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          {ikon}
          <div className="text-sm font-black text-gray-900">{baslik}</div>
          <span className="ml-auto text-xs font-bold text-gray-500">{satirlar.length}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">{aciklama}</p>
      </div>

      {satirlar.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400">Kayıt yok.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <th className="text-left px-4 py-2">Aranan</th>
                <th className="text-right px-3 py-2">Kez</th>
                {!vurgu && <th className="text-right px-3 py-2">Ort. sonuç</th>}
                <th className="text-right px-4 py-2">Son</th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map((r) => (
                <tr key={r.term} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                  <td className="px-4 py-2 font-semibold text-gray-900 truncate max-w-[220px]" title={r.sample}>
                    {r.sample || r.term}
                  </td>
                  <td className="px-3 py-2 text-right font-black text-gray-900">{r.count}</td>
                  {!vurgu && <td className="px-3 py-2 text-right text-gray-500">{r.averageResults}</td>}
                  <td className="px-4 py-2 text-right text-gray-500">{tarih(r.lastSearchedUtc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Search className="w-5 h-5 text-gray-700" />
          <h3 className="text-lg font-black text-gray-900">Müşteri Talebi</h3>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-2xl border border-gray-200 bg-white overflow-hidden">
            {GUN_SECENEKLERI.map((g) => (
              <button
                key={g}
                onClick={() => setGun(g)}
                className={`px-3 h-9 text-xs font-bold transition ${
                  gun === g ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {g} gün
              </button>
            ))}
          </div>
          <button
            onClick={() => void yukle(gun)}
            disabled={busy}
            className="h-9 px-3 rounded-2xl border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCcw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>
      </div>

      {hata && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{hata}</div>
      )}

      {data && (
        <div className="flex flex-wrap gap-2">
          <div className="px-4 py-2 rounded-2xl border border-gray-200 bg-white">
            <div className="text-[10px] font-bold text-gray-500 uppercase">Toplam Arama</div>
            <div className="text-lg font-black text-gray-900">{data.totalSearches}</div>
          </div>
          <div className="px-4 py-2 rounded-2xl border border-amber-200 bg-amber-50">
            <div className="text-[10px] font-bold text-amber-700 uppercase">Sonuç Çıkmayan</div>
            <div className="text-lg font-black text-amber-900">{data.zeroResultSearches}</div>
          </div>
          <div className="px-4 py-2 rounded-2xl border border-gray-200 bg-white">
            <div className="text-[10px] font-bold text-gray-500 uppercase">Farklı Terim</div>
            <div className="text-lg font-black text-gray-900">{data.distinctTerms}</div>
          </div>
        </div>
      )}

      {bosVeri && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
          <div className="font-bold text-gray-900 mb-1">Henüz arama kaydı yok.</div>
          Kayıt, vitrindeki arama kutusu kullanıldıkça birikir. Yeni yayın alındıysa birkaç gün
          beklemek gerekiyor. Menüdeki hazır kategori bağlantıları buraya yazılmaz — yalnız
          ziyaretçinin kendi yazdığı aramalar.
        </div>
      )}

      {/*
        SİZİ ARAYALIM TALEPLERİ (2026-09-21) — SAYFANIN EN ÜSTÜNDE.

        Bu sayfadaki diğer listeler "ne yapmalı"yı söylüyor; bu liste doğrudan ARANACAK
        KİŞİLERİ veriyor ve tek zamana duyarlı olan bu. Müşteri adını ve numarasını bırakmış,
        karşılığında aranmayı bekliyor: bekletilen her saat satışın kaybolma ihtimalini
        artırıyor. Mesai başında ilk bakılacak yer burası.

        Liste "bekleyenler"; "Arandı" denen kayıt listeden düşüyor ama silinmiyor.
      */}
      {aramalar.length > 0 && (
        <div className="rounded-2xl border-2 border-emerald-300 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-emerald-200 bg-emerald-50">
            <div className="flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-emerald-700" />
              <div className="text-sm font-black text-gray-900">Sizi Arayalım Talepleri</div>
              <span className="ml-auto text-xs font-black text-emerald-800">{aramalar.length} kişi bekliyor</span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Müşteri adını ve numarasını bırakmış, <b>aranmayı bekliyor</b>. Aradıktan sonra
              &quot;Arandı&quot; deyin; kayıt listeden düşer, geçmişte durmaya devam eder.
            </p>
          </div>
          <div className="overflow-x-auto max-h-[420px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th className="text-left px-4 py-2">Ad</th>
                  <th className="text-left px-3 py-2">Telefon</th>
                  <th className="text-left px-3 py-2">İlgilendiği ürün</th>
                  <th className="text-left px-3 py-2">Nereden</th>
                  <th className="text-left px-3 py-2">Bıraktığı an</th>
                  <th className="text-right px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {aramalar.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-emerald-50/40 align-top">
                    <td className="px-4 py-2 font-semibold text-gray-900">
                      {r.name}
                      {r.note && (
                        <div className="text-xs font-normal text-gray-500 mt-0.5 max-w-[240px]">{r.note}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {/* tel: bağlantısı — panel masaüstünden de tıklanınca yazılım telefonu açılır */}
                      <a href={`tel:${telefonCevir(r.phone)}`} className="font-black text-emerald-800 hover:underline">
                        {telefonYaz(r.phone)}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-gray-700 max-w-[280px]">
                      {r.productName || '—'}
                      {r.stockCode && (
                        <div className="text-xs font-mono text-gray-400">{r.stockCode}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{KAYNAK_ETIKET[r.source] || r.source}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{tarihSaat(r.createdAtUtc)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => void arandiIsaretle(r.id)}
                        disabled={arananId === r.id}
                        className="h-8 px-3 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        {arananId === r.id ? '…' : 'Arandı'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/*
        FOTOĞRAF ÖNCELİK LİSTESİ (2026-09-20) — EN ÜSTTE, çünkü en büyük satış kaldıracı.

        Vitrin kuralı: aktif + görsel + katalog fiyatı. Ölçümde ürünlerin büyük çoğunluğu
        YALNIZCA görsel eksikliğinden vitrine hiç girmiyor — stoğu var, fiyatı var, satılabilir
        durumda ama müşteri göremiyor. Bu listeyi yukarıdan aşağı fotoğraflamak, yazılacak
        hiçbir koddan daha çok satış getirir.
      */}
      {foto.total > 0 && (
        <div className="rounded-2xl border-2 border-rose-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-rose-200 bg-rose-50">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-rose-600" />
              <div className="text-sm font-black text-gray-900">Fotoğrafı Olmayan Ürünler</div>
              <span className="ml-auto text-xs font-black text-rose-700">{foto.total} ürün</span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Stoğu ve fiyatı var ama <b>görseli olmadığı için vitrine hiç girmiyorlar</b> — müşteri
              bu ürünleri göremiyor. Stoğu en yüksek olan başta; yukarıdan aşağı fotoğraflamak
              kataloğu en hızlı büyüten iş.
            </p>
          </div>
          <div className="overflow-x-auto max-h-[420px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th className="text-left px-4 py-2">Ürün</th>
                  <th className="text-left px-3 py-2">Kategori</th>
                  <th className="text-left px-3 py-2">Stok Kodu</th>
                  <th className="text-right px-3 py-2">Stok</th>
                  <th className="text-right px-4 py-2">Fiyat</th>
                </tr>
              </thead>
              <tbody>
                {foto.items.map((r) => (
                  <tr key={r.stockCode} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-2 font-semibold text-gray-900 truncate max-w-[300px]">{r.name}</td>
                    <td className="px-3 py-2 text-gray-500">{r.category || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{r.stockCode}</td>
                    <td className="px-3 py-2 text-right font-black text-rose-700">{r.stock}</td>
                    <td className="px-4 py-2 text-right text-gray-700">
                      {r.price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {foto.total > foto.items.length && (
            <div className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-100">
              İlk {foto.items.length} satır gösteriliyor; toplam {foto.total} ürün.
            </div>
          )}
        </div>
      )}

      {/*
        "GELİNCE HABER VER" TALEBİ (2026-09-20).

        Sonuç çıkmayan aramalardan DAHA KESKİN bir sinyal: burada müşteri ürünü bulmuş,
        beğenmiş, tükendiğini görmüş ve telefonunu bırakmış. Sipariş edilecek ürünü bundan
        net söyleyen başka bir liste yok. Stok girdiği anda bu kişilere SMS gidiyor.
      */}
      {talep.length > 0 && (
        <div className="rounded-2xl border-2 border-indigo-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-indigo-200 bg-indigo-50">
            <div className="flex items-center gap-2">
              <PackageSearch className="w-4 h-4 text-indigo-600" />
              <div className="text-sm font-black text-gray-900">Stok Bekleyenler</div>
              <span className="ml-auto text-xs font-bold text-gray-500">{talep.length} ürün</span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Tükendiğini görüp &quot;gelince haber ver&quot; diyen müşteriler. Stok girdiği anda
              kendilerine SMS gidiyor — önce bunları sipariş etmek doğrudan satışa dönüşür.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th className="text-left px-4 py-2">Ürün</th>
                  <th className="text-left px-3 py-2">Stok Kodu</th>
                  <th className="text-right px-3 py-2">Bekleyen</th>
                  <th className="text-right px-3 py-2">Stok</th>
                  <th className="text-right px-4 py-2">Son istek</th>
                </tr>
              </thead>
              <tbody>
                {talep.map((r) => (
                  <tr key={r.stockCode} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-2 font-semibold text-gray-900 truncate max-w-[280px]">
                      {r.name || <span className="text-gray-400">— (yayında değil)</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{r.stockCode}</td>
                    <td className="px-3 py-2 text-right font-black text-indigo-700">{r.waiting}</td>
                    <td className="px-3 py-2 text-right">
                      {r.inStock ? (
                        <span className="text-emerald-700 font-bold">{r.stockQuantity ?? 'var'}</span>
                      ) : (
                        <span className="text-red-600 font-bold">yok</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">{tarih(r.lastRequestedUtc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && !bosVeri && (
        <div className="flex flex-col xl:flex-row gap-4">
          {tablo(
            'Sonuç Çıkmayan Aramalar',
            'Aranıp bulunamayan ürünler. Görseli olmadığı için vitrine hiç girmemiş olabilir; fotoğraf çekilince yayına girer.',
            data.zeroResultTerms,
            <AlertTriangle className="w-4 h-4 text-amber-600" />,
            true
          )}
          {tablo(
            'En Çok Aranan',
            'Talebin nerede olduğunu gösterir; stok ve kampanya kararlarında kullanılır.',
            data.topTerms,
            <TrendingUp className="w-4 h-4 text-gray-700" />,
            false
          )}
        </div>
      )}
    </div>
  )
}
