/**
 * Single source of truth for "which page key does this route need".
 *
 * The menu used to carry its own route->key chain while the router carried none at all, so a
 * hidden menu entry was still reachable by typing the address: the only thing a permission
 * actually did was hide a link. Both now read this map, which is why it lives outside of any
 * component.
 *
 * Keys match what /api/auth/permissions returns, which in turn comes from B2B's
 * RolePagePermissions joined against Pages where ModuleKey = 'serviceOps'. Sub-page keys are
 * dotted ('buyukUrun.planlama'); granting a sub-key implies access to its parent page, because
 * a user allowed only into planning still has to open the page that contains it.
 */

export type PageKey = string

/** Route path -> page key. Routes absent from this map are open to any signed-in user. */
export const ROUTE_PAGE_KEYS: Record<string, PageKey> = {
  '/montaj-kabul': 'montajKabul',
  '/montaj-yonetimi': 'montajYonetimi',
  '/montaj-gecmisi': 'montajGecmisi',
  '/montaj-planlama': 'montajPlanlama',
  '/buyuk-urun-kabul': 'buyukEvAletleriKabul',
  '/saha-ariza': 'buyukUrun',
  '/kucuk-urun-kabul': 'kucukUrunKabul',
  '/atolye-ariza': 'atolyeAriza',
  '/planlama': 'atolyeAriza',
  '/kargo-kabul': 'kargoTakibi',
  '/kargo-takibi': 'kargoTakibi',
  '/teknisyenler': 'teknisyenler',
  '/rota': 'rota',
  '/musteriler': 'musterilerBayiler',
  '/musteriler-bayiler': 'musterilerBayiler',
  '/stok': 'stok',
  '/arac-depolari': 'aracDepolari',
  // Tahsilat kendi anahtarında: saha ekibinin tek işi para almak, depo yetkisiyle ilgisi yok.
  '/tahsilat': 'tahsilat',
  // Hızlı Servis: sahada yedek parça satışı. Kendi anahtarı var ki teknisyen rollerine
  // stok/araç deposu yetkisi vermeden açılabilsin.
  '/hizli-servis': 'hizliServis',
  // Günlük Tahsilatlar yönetim ekranıdır; teknisyen rollerine varsayılan KAPALI.
  '/gunluk-tahsilatlar': 'gunlukTahsilat',
  '/silinen-kayitlar': 'silinenKayitlar',
  '/kullanici-hareketleri': 'userActivities',
  '/teknisyen-takip': 'teknisyenTakip',
  '/hakedis': 'hakedis',
  // Fatura takip: teknisyenin kendisine atanan faturaları imzalatıp işaretlemesi (veri B2B'de).
  '/fatura-takip': 'faturaTakip',
  // Personel ekstresi hak edişin ikinci ekranıdır, ayrı bir yetki değil: hak edişi görebilen
  // ekstresini de görür, kapsamı (kendi işleri / tüm personel) hakedis kapsam anahtarları belirler.
  '/personel-ekstre': 'hakedis',
  '/raporlar': 'raporlar',
  '/raporlar/montaj': 'raporlar.montaj',
  '/raporlar/buyuk-urun': 'raporlar.buyukUrun',
  '/raporlar/kucuk-urun': 'raporlar.kucukUrun',
  '/raporlar/kargo': 'raporlar.kargo',
  '/raporlar/bayi': 'raporlar.bayi',
  '/raporlar/teknisyen': 'raporlar.teknisyen',
  '/raporlar/urun': 'raporlar.urun',
  '/raporlar/sureler': 'raporlar.sureler',
  '/raporlar/iptal': 'raporlar.iptal',
  '/raporlar/yedek-parca': 'raporlar.yedekParca',
  '/raporlar/trend': 'raporlar.trend',
  // Drill-down listesi kok anahtarla acilir: hangi karttan gelindiyse o rapor zaten kontrol
  // edildi, kayit kapsami da sunucuda ayrica uygulaniyor.
  '/raporlar/kayitlar': 'raporlar',
  '/analiz': 'analiz',
  '/ayarlar': 'ayarlar'
}

/**
 * Routes every authenticated user may reach regardless of role. The dashboard is the landing
 * page a denied user is sent back to, so gating it would make a redirect loop.
 */
export const ALWAYS_ALLOWED_ROUTES = new Set(['/', '/bildirimler'])

/**
 * Where '/' sends people, in order of preference.
 *
 * There is no dashboard any more, so the landing page is simply the first screen this user is
 * actually allowed to open. The order is the menu order, so what they land on matches what sits
 * at the top of their sidebar.
 */
export const LANDING_ROUTE_ORDER = [
  '/montaj-yonetimi',
  '/montaj-kabul',
  '/montaj-planlama',
  '/saha-ariza',
  '/buyuk-urun-kabul',
  '/atolye-ariza',
  '/kucuk-urun-kabul',
  '/kargo-takibi',
  '/kargo-planlama',
  '/fatura-takip',
  '/rota',
  '/teknisyenler',
  '/musteriler',
  '/stok',
  '/arac-depolari',
  '/hakedis',
  '/teknisyen-takip',
  '/raporlar',
  '/analiz',
  '/silinen-kayitlar',
  '/kullanici-hareketleri',
  '/ayarlar'
]

/**
 * First route this session may open, or null when it may open none of them. Callers must wait
 * for permissions to load before asking — redirecting on an empty key set would bounce every
 * user to the same fallback before their real answer arrived.
 */
export function firstAccessibleRoute(
  allowedKeys: readonly string[],
  isSuperAdmin: boolean
): string | null {
  for (const route of LANDING_ROUTE_ORDER) {
    if (canOpenRoute(allowedKeys, isSuperAdmin, route)) return route
  }
  return null
}

/*
 * Burada bir zamanlar TECHNICIAN_ALLOWED_ROUTES vardı: teknisyen oturumlarına rol yetkilerinin
 * ÜSTÜNE uygulanan ikinci ve daha dar bir kapı. Kaldırıldı.
 *
 * İki kapı olması, rol yetkisinde açıkça verilmiş bir sayfanın yine de açılmamasına yol açıyordu
 * ve sebebi hiçbir ekranda görünmüyordu — Servis Müdürü, rolünde "servis" geçtiği için teknisyen
 * sayılıp bütün kabul ekranlarını kaybetmişti. Tek kapı rol yetkileri: neye izin verilmişse
 * o açılır.
 */

/**
 * Sub-pages, tabs and modals rendered inside a page. Kept next to the route map so that adding
 * a tab means adding it here rather than inventing a key at the call site — the drift between
 * those two is what left sub-pages ungated.
 */
export const SUB_PAGE_KEYS = {
  montajKabul: [
    'montajKabul.yeniKabul',
    'montajKabul.kabulDuzenle',
    'montajKabul.memnuniyet',
    'montajKabul.aksiyon',
    // Kalem satırındaki İŞLEMLER sütunu — kayıt seviyesindeki 'aksiyon'dan ayrı bir yetki.
    'montajKabul.kalemIslemleri'
  ],
  montajYonetimi: ['montajYonetimi.planlama', 'montajYonetimi.teslimat', 'montajYonetimi.geriPlanlama'],
  buyukEvAletleriKabul: [
    'buyukEvAletleriKabul.yeniKabul',
    'buyukEvAletleriKabul.memnuniyet',
    'buyukEvAletleriKabul.aksiyon',
    'buyukEvAletleriKabul.fisOlustur'
  ],
  buyukUrun: [
    'buyukUrun.planlama',
    'buyukUrun.sahaPlanlama',
    'buyukUrun.atolye',
    'buyukUrun.hazirTeslimat',
    'buyukUrun.teslimattakiler',
    'buyukUrun.islemKaydet',
    'buyukUrun.yedekParca'
  ],
  kucukUrunKabul: [
    'kucukUrunKabul.yeniKabul',
    'kucukUrunKabul.memnuniyet',
    'kucukUrunKabul.aksiyon',
    'kucukUrunKabul.fisOlustur'
  ],
  atolyeAriza: [
    'atolyeAriza.atolye',
    'atolyeAriza.hazirTeslimat',
    'atolyeAriza.teslimattakiler',
    'atolyeAriza.islemKaydet',
    'atolyeAriza.yedekParca'
  ],
  kargoTakibi: ['kargoTakibi.durumGuncelle'],
  kargoPlanlama: ['kargoPlanlama.yeniPlan'],
  teknisyenler: ['teknisyenler.yeniTeknisyen', 'teknisyenler.teknisyenDuzenle', 'teknisyenler.sifreDegistir'],
  musterilerBayiler: ['musterilerBayiler.yeniMusteri', 'musterilerBayiler.musteriDuzenle'],
  stok: ['stok.yeniStok', 'stok.stokGuncelle'],
  aracDepolari: ['aracDepolari.depoTransfer'],
  hakedis: ['hakedis.tumIsleriGorme', 'hakedis.sadeceKendiIsleri'],
  raporlar: [
    'raporlar.montaj',
    'raporlar.buyukUrun',
    'raporlar.kucukUrun',
    'raporlar.kargo',
    'raporlar.bayi',
    'raporlar.teknisyen',
    'raporlar.urun',
    'raporlar.sureler',
    'raporlar.iptal',
    'raporlar.yedekParca',
    'raporlar.trend',
    'raporlar.disaAktar',
    // Kapsam anahtari: verilmezse kullanici raporu acar ama yalnizca kendi kayitlarini gorur.
    'raporlar.tumIsleriGorme'
  ]
} as const

/**
 * Beyaz Eşya Arıza (/saha-ariza) sekmesi -> yetki anahtarı.
 *
 * Bu eşleme İKİ yerde birden lazım: sayfanın kendisi (SahaArizaPage) ve başlıktaki geçiş şeridi
 * (StilsoftShell). İkisi ayrı ayrı yazıldığı için kaymıştı ve kayma doğrudan yetki sızıntısıydı:
 *   - "Planlama" ve "Saha" chip'lerinin şeritte hiç kapısı yoktu, herkese görünüyordu;
 *   - "Teslimat Planlama" chip'i 'buyukUrun.hazirTeslimat' yerine 'buyukUrun.sahaPlanlama'
 *     ile kapatılmıştı, yani yanlış yetkiye bakıyordu.
 *
 * Yeni sekme eklerken burayı güncelle; çağrı yerinde elle anahtar yazma.
 */
export const SAHA_ARIZA_TAB_KEYS = {
  planlama: 'buyukUrun.planlama',
  saha: 'buyukUrun.sahaPlanlama',
  bekleyen: 'buyukUrun.atolye',
  aktif: 'buyukUrun.hazirTeslimat',
  teslimat: 'buyukUrun.teslimattakiler'
} as const

export type SahaArizaTab = keyof typeof SAHA_ARIZA_TAB_KEYS

/**
 * İşlem geçmişi / zaman çizelgesi görme yetkisi.
 *
 * Bir rotaya değil, her ekranda tekrar eden "i" (geçmiş) butonuna ve `ServisGecmisiModal`'a
 * bağlı. Sabit olarak burada duruyor ki çağrı yerleri anahtar adını elle yazmasın — yetki
 * anahtarını ekleyip kontrol etmeyi unutmak bu kod tabanında daha önce yaşandı
 * (`montajYonetimi.geriPlanlama` yetki ekranında görünüyor, hiçbir şey yapmıyordu).
 *
 * Sunucu tarafındaki ikizi: `ServiceRecordsController.GetTimeline` aynı anahtarı arar. İstemci
 * kapısı sadece görünürlük; veriyi kapatan sunucudur.
 */
export const HISTORY_PAGE_KEY = 'servisGecmisi'

/** Normalises '/rota/detay/12' down to the '/rota' the map is keyed by. */
export function routePageKey(pathname: string): PageKey | null {
  if (ROUTE_PAGE_KEYS[pathname]) return ROUTE_PAGE_KEYS[pathname]

  const segments = pathname.split('/').filter(Boolean)
  while (segments.length > 0) {
    segments.pop()
    const parent = `/${segments.join('/')}`
    if (ROUTE_PAGE_KEYS[parent]) return ROUTE_PAGE_KEYS[parent]
  }
  return null
}

/**
 * Whether `key` is granted. A parent key is satisfied by any of its sub-keys: the server sends
 * 'buyukUrun.planlama' on its own for a user who may only plan, and that user still needs the
 * page itself to open.
 */
export function hasKey(allowedKeys: readonly string[], isSuperAdmin: boolean, key: PageKey | null): boolean {
  if (!key) return true
  if (isSuperAdmin) return true
  if (allowedKeys.includes(key)) return true
  return allowedKeys.some((granted) => granted.startsWith(`${key}.`))
}

/**
 * Whether a route may be opened. Unmapped routes stay open so that adding a page does not
 * silently lock everyone out before its key exists in B2B.
 */
export function canOpenRoute(allowedKeys: readonly string[], isSuperAdmin: boolean, pathname: string): boolean {
  if (ALWAYS_ALLOWED_ROUTES.has(pathname)) return true
  return hasKey(allowedKeys, isSuperAdmin, routePageKey(pathname))
}
