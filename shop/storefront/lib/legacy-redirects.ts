/**
 * Eski OpenCart sitesinden (example.com) gelen adresler.
 *
 * NEDEN ÖNEMLİ: yeni site aynı alan adına kuruluyor. Eski adresler yönlendirilmezse Google'ın
 * yıllardır bildiği her sayfa 404 verir; o sayfaların biriktirdiği sıralama gücü yeni sayfaya
 * geçmez, sıfırdan başlanır. "Kıbrıs'ın en çok listelenen sitesi" hedefinin önündeki en somut
 * engel budur.
 *
 * NEDEN 301 (kalıcı), 302 değil: sıralama gücü yalnızca kalıcı yönlendirmede aktarılır.
 * `permanent: true` bunu sağlıyor.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * LİSTE 2026-09-05'TE ÇIKARILDI. Yöntem: Google Search Console YOKTU (bu makineden erişim
 * yok); onun yerine eski sitenin kendi `sitemap.xml`'i kullanıldı — ürün sayfalarında
 * `<image:caption>` etiketi ürün adını taşıyor, bu da `product_id`yi isme, ismi de yeni
 * kataloğun `slug`ına bağlamayı otomatik eşleştirme + tek tek gözden geçirme ile mümkün kıldı.
 * `route=product/category` / `manufacturer/info` / `information/information` gibi sayısal
 * kimlikli sorgular caption taşımadığı için eski site üzerinde tek tek açılıp başlığına
 * bakılarak çözüldü (aşağıdaki `legacyQueryRedirects`).
 *
 * Eşleme KURALI: bir eski ürün yeni kataloğa isim benzerliğiyle güvenle bağlanamıyorsa
 * (örn. renk/model değişmiş, ürün tipi artık satılmıyor) o ürün ZORLANMADI — en yakın
 * KATEGORİYE yönlendirildi; kategorisi de belirsizse listeye hiç KONMADI. Uydurulan bir
 * eşleme, ziyaretçiyi yanlış ürüne göndermek demektir — 404'ten daha kötü.
 *
 * Dışarıda bırakılanlar (kod değil, veri eksikliği — DEVIR §0'a not düşüldü):
 * 8 ürün (renk/model varyantı artık kataloğa yok — örn. "FÖNMATİK 9032-GOLD/Gİ",
 * "ÇAMAŞIR KURUTMA MAKİNESİ"), `/camasir-kurutma-makinesi` (bu ürün tipi hiç yok),
 * `/cevre-ve-isg-politikasi` (yeni sitede karşılığı olan bir sayfa değil).
 * ────────────────────────────────────────────────────────────────────────────────────────
 */
export type LegacyRedirect = { source: string; destination: string }

export const legacyRedirects: LegacyRedirect[] = [
  { source: '/sac-masasi', destination: '/urun/st-misstil-6010-sac-masasi-skb44050' },
  { source: '/st-24uw4rktce0024-btu-klima-wifi', destination: '/urun/st-24uw4rktce00-24-btu-inverter-klima-wifi-sbe92002' },
  { source: '/steamgen-3000-buhar-kazanli-utu', destination: '/urun/st-steamgen-3000-buhar-kazanli-utu-sut65010' },
  { source: '/st-rft528l01euenf-beyaz-buzdolabi', destination: '/urun/st-rft528l01eu-e-nf-inox-buzdolabi-sbe90465' },
  { source: '/st-com315l01eufdf-beyaz-buzdolabi-', destination: '/urun/st-com315l01eu-f-df-white-buzdolabi-sbe90550' },
  { source: '/st-18uw4rbsce0018-btu-klima-wifi', destination: '/urun/st-18uw4rbsce00-18-btu-inverter-klima-wifi-sbe92001' },
  { source: '/st-rft304l01euedf-beyaz-buzdolabi-', destination: '/urun/st-rft248l01eu-e-df-white-buzdolabi-sbe90411' },
  { source: '/st-rft528l01euenf-inox-buzdolabi', destination: '/urun/st-rft528l01eu-e-nf-inox-buzdolabi-sbe90465' },
  { source: '/st-12uw4rxrce0012-btu-klima-wifi', destination: '/urun/st-12uw4rxrce00-12-btu-inverter-klima-wifi-sbe92000' },
  { source: '/st-rft248l01eufdf-beyaz-buzdolabi', destination: '/urun/st-rft248l01eu-e-df-white-buzdolabi-sbe90411' },
  { source: '/st-dw12lp701eue-beyaz-7-prg-bulasik-makinesi', destination: '/urun/st-dw12lp701eu-e-white-bulasik-mak-7-prog-sbe90801' },
  { source: '/st-da-sms90-siyah-davlumbaz', destination: '/urun/st-da-sms90-black-davlumbaz-seg70360' },
  { source: '/st-dw12lp701eue-inox-7-prg-bulasik-makinesi', destination: '/urun/st-dw12lp701eu-e-white-bulasik-mak-7-prog-sbe90801' },
  { source: '/st-pirpir-va-1880-ayakli-vantilator-siyah', destination: '/urun/st-pirpir-va-1880-ayakli-vantilator-siyah-seg53030' },
  { source: '/st-af-627-siyah-dijital-turbo-firin-70-lt', destination: '/urun/st-af-7et13cd-3-cam-black-dijital-turbo-firin-74-lt-sbe70121' },
  { source: '/st-megatron-2-bldc-sarjli-dikey-supurge', destination: '/urun/st-megatron-2-bldc-sarjli-dikey-supurge-set14015' },
  { source: '/st-da-f1760-davlumbaz-siyah', destination: '/urun/st-da-f1760-black-davlumbaz-seg70350' },
  { source: '/st-da-sms90-beyaz-davlumbaz', destination: '/urun/st-da-sms90-black-davlumbaz-seg70360' },
  { source: '/trodos-sb-168-su-sebiligumus', destination: '/urun/st-trodos-sb-168-su-sebili-gumus-seg50221' },
  { source: '/st-af-615-siyah-turbo-firin-70-lt', destination: '/urun/st-af-7em09cd-3-cam-black-turbo-firin-74-lt-seg70111' },
  { source: '/st-ao-gls-640-beyaz-kristal-cam-ocak', destination: '/urun/st-ao-gls-640-black-kristal-cam-ocak-seg70401' },
  { source: '/st-af-605-beyaz-firin-75-lt', destination: '/urun/st-af-605-black-firin-75-lt-seg70160' },
  { source: '/st-ao-gls-640-siyah-kristal-cam-ocak', destination: '/urun/st-ao-gls-640-black-kristal-cam-ocak-seg70401' },
  { source: '/st-da-5001-60-davlumbaz-beyaz', destination: '/urun/st-da-5001-60-white-davlumbaz-seg70300' },
  { source: '/trodos-sb-168-su-sebili-beyaz', destination: '/urun/st-trodos-sb-168-su-sebili-beyaz-seg50220' },
  { source: '/st-af-605-siyah-firin-75-lt', destination: '/urun/st-af-605-black-firin-75-lt-seg70160' },
  { source: '/st-ao-gls-640-e-siyah-kristal-cam-ocak', destination: '/urun/st-ao-gls-640-e-black-kristal-cam-ocak-seg70430' },
  { source: '/aspirator-inox', destination: '/urun/st-aspirator-inox-seg54010' },
  { source: '/st-da-5001-60-davlumbaz-siyah', destination: '/urun/st-da-5001-60-white-davlumbaz-seg70300' },
  { source: '/aspirator-beyaz', destination: '/kategori/ankastre' },
  { source: '/st-da-f1760-davlumbaz-beyaz', destination: '/urun/st-da-f1760-black-davlumbaz-seg70350' },
  { source: '/activa-df-118-fritoz-siyahbakir', destination: '/urun/st-activa-df-118-fritoz-siyah-bakir-sgh25605' },
  { source: '/ch03-karbon-isitici-gumus', destination: '/kategori/ev-gerec' },
  { source: '/cays-cm-37-cay-makinesi-siyahbakir', destination: '/urun/st-cays-cm-037-cay-makinesi-siyah-bakir-sih30530' },
  { source: '/cays-inox-celik-cay-makinesi', destination: '/urun/st-cays-inox-celik-cay-makinesi-sih30628' },
  { source: '/cays-inox-celik-cay-makinesi-sedefli-mavi', destination: '/urun/st-cays-inox-celik-cay-makinesi-sedefli-mavi-sih30624' },
  { source: '/cirpi-el-mikseri-beyazgri', destination: '/urun/st-cirpi-el-mikseri-sgh24150' },
  { source: '/cirpi-el-mikseri-siyahbakir', destination: '/urun/st-cirpi-el-mikseri-siyah-bakir-sgh24151' },
  { source: '/gramatik-mt-882-mutfak-terazisi-yesil', destination: '/urun/st-gramatik-mt-882-mutfak-terazisi-yesil-sgh26400' },
  { source: '/gramatik-mt-882-mutfak-terazisi-gri', destination: '/urun/st-gramatik-mt-882-mutfak-terazisi-gri-sgh26401' },
  { source: '/herbaldem-6820-glass-bitki-caysu-isiticisi', destination: '/urun/st-herbaldem-6820-glass-bitki-cay-su-isiticisi-sih32020' },
  { source: '/jett-4510-midi-firin-beyaz', destination: '/urun/st-jett-4510-turbo-midi-firin-beyaz-sgh24700' },
  { source: '/jett-7020-mikrodalga-firin-20-lt', destination: '/urun/st-jett-7020-mikrodalga-firin-20-lt-sgh24610' },
  { source: '/kays-si-1797-su-isiticisi-beyazgri', destination: '/urun/st-kays-si-1797-su-isiticisi-beyaz-gri-sih31521' },
  { source: '/kays-si-1797-su-isiticisi-kirmizisiyah', destination: '/urun/st-kays-si-1797-su-isiticisi-beyaz-gri-sih31521' },
  { source: '/kays-si-6750-celik-su-isiticisi-mat', destination: '/urun/st-kays-si-040-celik-su-isiticisi-mat-sih32025' },
  { source: '/limmonata-3305-narenciye-sikacagi-inox', destination: '/urun/st-limmonata-3305-narenciye-sikacagi-inox-sih30340' },
  { source: '/mago-plus-blender-seti-kirmizi', destination: '/urun/st-mago-plus-el-blender-seti-kirmizi-sgh22011' },
  { source: '/mago-plus-blender-seti-siyahbakir', destination: '/urun/st-mago-plus-el-blenderi-siyah-bakir-sgh22021' },
  { source: '/maxi-chef-mutfak-robotu-siyahbakir', destination: '/urun/st-maxi-chef-mutfak-robotu-siyah-bakir-sgh20032' },
  { source: '/maxtron-torbasiz-elektrikli-supurge-siyah', destination: '/kategori/ev-temiz' },
  { source: '/safran-elektriklisupurge-siyahbakir', destination: '/urun/st-safran-elektrikli-supurge-siyah-bakir-set13200' },
  { source: '/st-mn109l01eufdf-beyaz-mini-buzdolabi-', destination: '/urun/st-mn109l01eu-f-df-white-mini-buzdolabi-sbe90310' },
  { source: '/st-pirpir-va-1880-ayakli-vantilator-beyaz', destination: '/urun/st-pirpir-va-1880-ayakli-vantilator-beyaz-seg53031' },
  { source: '/tartar-ba-739-banyo-baskulu-siyahgold', destination: '/urun/st-tartar-ba-739-banyo-baskulu-siyah-gold-seg52040' },
  { source: '/tartar-ba-965-cam-banyo-baskulu-ahsap', destination: '/urun/st-tartar-ba-965-cam-banyo-baskulu-ahsap-seg52032' },
  { source: '/tartar-ba-965-cam-banyo-baskulu-beyaz', destination: '/urun/st-tartar-ba-965-cam-banyo-baskulu-beyaz-seg52030' },
  { source: '/tartar-ba-965-cam-banyo-baskulu-siyah', destination: '/urun/st-tartar-ba-965-cam-banyo-baskulu-siyah-seg52031' },
  { source: '/tostbig-ek-889-ekmek-kizartma-makinesi', destination: '/urun/st-tostbig-ek-889-ekmek-kizartma-makinesi-sgh23620' },
  { source: '/trodos-sb-27-su-sebili', destination: '/urun/st-trodos-sb-27-su-sebili-seg50210' },
  { source: '/beyaz-esya', destination: '/urunler' },
  { source: '/ankastre-urunler', destination: '/kategori/ankastre' },
  { source: '/aspirator-davlumbaz', destination: '/kategori/ankastre' },
  { source: '/bulasik-makinesi', destination: '/kategori/bul-mak' },
  { source: '/buzdolabi', destination: '/kategori/buzdlb' },
  { source: '/camasir-makinesi', destination: '/kategori/cam-mak' },
  { source: '/derin-dondurucu', destination: '/kategori/drn-don' },
  { source: '/klima', destination: '/kategori/klima' },
  { source: '/solo-urunler', destination: '/urunler' },
  { source: '/su-sebili', destination: '/kategori/sebil' },
  { source: '/tv-elektronik-urunler', destination: '/kategori/elektro' },
  { source: '/elektrikli-ev-aletleri', destination: '/urunler' },
  { source: '/ev-gerecleri', destination: '/kategori/ev-gerec' },
  { source: '/banyo-baskulu', destination: '/kategori/ev-gerec' },
  { source: '/elektrikli-isitici', destination: '/kategori/ev-gerec' },
  { source: '/elektrikli-sofben', destination: '/kategori/ev-gerec' },
  { source: '/ani-su-isiticili-musluk', destination: '/urun/st-kaynas-im-32b-ani-su-isiticili-musluk-seg50015' },
  { source: '/termosifion', destination: '/kategori/ev-gerec' },
  { source: '/vantilator', destination: '/kategori/ev-gerec' },
  { source: '/kisisel-bakim', destination: '/kategori/k-bakim' },
  { source: '/erkek-bakim-seti', destination: '/urun/st-mrstil-003-erkek-bakim-seti-skb49050' },
  { source: '/sac-duzlestirici', destination: '/urun/st-misstil-077-sac-duzlestirici-skb43055' },
  { source: '/sac-kurutma-makinesi', destination: '/kategori/k-bakim' },
  { source: '/sac-sekillendirici', destination: '/kategori/k-bakim' },
  { source: '/utuler', destination: '/kategori/utu' },
  { source: '/utu', destination: '/kategori/utu' },
  { source: '/utu-masasi', destination: '/kategori/utu' },
  { source: '/ev-temizligi', destination: '/kategori/ev-temiz' },
  { source: '/dik-elektrikli-supurge', destination: '/kategori/ev-temiz' },
  { source: '/islakkuru-elektrikli-supurge', destination: '/kategori/ev-temiz' },
  { source: '/sarjli-supurge', destination: '/kategori/ev-temiz' },
  { source: '/toz-torbali-elektrikli-supurge', destination: '/kategori/ev-temiz' },
  { source: '/toz-torbasiz-elektrikli-supurge', destination: '/kategori/ev-temiz' },
  { source: '/kampanyalar', destination: '/firsatlar' },
  { source: '/mutfak-aletleri', destination: '/kategori/g-hazir' },
  { source: '/gida-hazirlama', destination: '/kategori/g-hazir' },
  { source: '/airfryer', destination: '/kategori/g-hazir' },
  { source: '/dograyici', destination: '/kategori/g-hazir' },
  { source: '/ekmek-kizartma-makinesi', destination: '/urun/st-tostbig-ek-889-ekmek-kizartma-makinesi-sgh23620' },
  { source: '/el-blenderi', destination: '/kategori/g-hazir' },
  { source: '/et-kiyma-makinesi', destination: '/urun/st-chefturco-mega-1600-w-et-kiyma-makinesi-sgh21520' },
  { source: '/fritoz', destination: '/kategori/g-hazir' },
  { source: '/kisisel-blender', destination: '/kategori/g-hazir' },
  { source: '/midi-firin', destination: '/kategori/g-hazir' },
  { source: '/mikrodalga-firin', destination: '/kategori/g-hazir' },
  { source: '/mikser', destination: '/kategori/g-hazir' },
  { source: '/mutfak-robotu', destination: '/kategori/g-hazir' },
  { source: '/mutfak-terazisi', destination: '/kategori/g-hazir' },
  { source: '/tost-makinasi', destination: '/kategori/g-hazir' },
  { source: '/icecek-hazirlama', destination: '/kategori/i-hazir' },
  { source: '/cay-makinesi', destination: '/kategori/i-hazir' },
  { source: '/filtre-kahve-makinesi', destination: '/urun/st-bikahve-maxi-otomatik-filtre-kahve-makinesi-sih31306' },
  { source: '/narenciye-sikacagi', destination: '/kategori/i-hazir' },
  { source: '/su-isiticisi', destination: '/arama?q=su%20isiticisi' },
  { source: '/turk-kahvesi-makinesi', destination: '/kategori/i-hazir' },
  { source: '/uyku-koleksiyonu', destination: '/urunler' },
  { source: '/gizlilik-sozlesmesi', destination: '/gizlilik' },
  { source: '/stilsoft-kvkk-bilgilendirme', destination: '/kvkk' },
  { source: '/Kullanici-Sozlesmesi', destination: '/mesafeli-satis' },
  { source: '/mesafeli-satis-sozlesmesi', destination: '/mesafeli-satis' },
  { source: '/stilsoft-3-yil-garanti', destination: '/servis' },
  { source: '/stilsoft-hakkinda', destination: '/' },
  { source: '/stilsoft-reklam-filmleri', destination: '/' },
  { source: '/teslimat-ve-iade', destination: '/teslimat' },
  { source: '/stilsoft-urun-kayit', destination: '/' },
  { source: '/stilsoft-yetkili-servisler', destination: '/servis' },
]

/**
 * Sorgu parametresine bağlı OpenCart adresleri (ürün dışında).
 *
 * Kategori/marka/bilgi sayfaları `route=...` ile birlikte sayısal bir kimlik taşıyor
 * (`path`, `manufacturer_id`, `information_id`); Next'in `redirects()` fonksiyonu `has` ile
 * sorgu değerine bakabildiği için her biri kendi kuralına dönüştürülüyor — tıpkı
 * `legacyProductIds` gibi.
 */
export type LegacyQueryRedirect = { route: string; param: string; value: string; destination: string }

export const legacyQueryRedirects: LegacyQueryRedirect[] = [
  { route: 'product/category', param: 'path', value: '157', destination: '/kategori/k-bakim' },
  { route: 'product/category', param: 'path', value: '162', destination: '/kategori/baslik' },
  { route: 'product/category', param: 'path', value: '161', destination: '/kategori/baza' },
  { route: 'product/category', param: 'path', value: '164', destination: '/urunler' },
  { route: 'product/category', param: 'path', value: '163', destination: '/kategori/silte' },
  { route: 'product/manufacturer/info', param: 'manufacturer_id', value: '8', destination: '/urunler' },
  { route: 'product/manufacturer/info', param: 'manufacturer_id', value: '9', destination: '/urunler' },
  { route: 'product/manufacturer/info', param: 'manufacturer_id', value: '7', destination: '/urunler' },
  { route: 'product/manufacturer/info', param: 'manufacturer_id', value: '5', destination: '/urunler' },
  { route: 'product/manufacturer/info', param: 'manufacturer_id', value: '6', destination: '/urunler' },
  { route: 'product/manufacturer/info', param: 'manufacturer_id', value: '10', destination: '/urunler' },
  { route: 'product/manufacturer/info', param: 'manufacturer_id', value: '11', destination: '/urunler' },
  { route: 'information/information', param: 'information_id', value: '4', destination: '/' },
  { route: 'information/information', param: 'information_id', value: '6', destination: '/' },
  { route: 'information/information', param: 'information_id', value: '3', destination: '/' },
  { route: 'information/information', param: 'information_id', value: '5', destination: '/' },
]

/**
 * OpenCart ürün sayfaları `/index.php?route=product/product&product_id=123` biçiminde.
 * Next'in `redirects()` fonksiyonu sorgu dizesine `has` ile bakabiliyor; her ürün için bir
 * kural yazmak yerine tek kuralda `product_id` değerine göre eşleme yapılamıyor. Bu yüzden bu
 * adresler ürün ürün yazılmak zorunda — aşağıdaki yardımcı, ürün kimliği ile yeni slug'ı
 * eşleyen bu tablodan kuralları üretir.
 */
export const legacyProductIds: Record<string, string> = {
  '240': 'st-cays-inox-celik-cay-makinesi-sih30628',
  '244': 'st-jettmax-3000-nano-seramik-utu-gold-sut64010',
  '245': 'st-jettmax-3000-nano-seramik-utu-lila-sut64011',
  '249': 'st-fonmatik-bldc-9033-profesyonel-skb41505',
  '251': 'st-misstil-087-sac-duzlestirici-skb43050',
  '252': 'st-misstil-077-sac-duzlestirici-skb43055',
  '253': 'st-misstil-079-sac-sekillendirme-seti-skb45050',
  '254': 'st-mrstil-003-erkek-bakim-seti-skb49050',
  '255': 'st-mrstil-003-erkek-bakim-seti-skb49050',
  '256': 'st-mrstil-003-erkek-bakim-seti-skb49050',
  '257': 'st-fonmatik-bldc-9041-profesyonel-skb41500',
  '258': 'st-wamy1010l1401eu-a-inox-cam-mak-10-kg-1400-devir-sbe90671',
  '266': 'st-da-ada90-black-davlumbaz-seg70380',
  '269': 'st-kaynas-s-6015-60-lt-silindirik-termosifon-seg50051',
  '270': 'st-kaynas-s-8020-80-lt-silindirik-termosifon-seg50052',
  '275': 'st-bikahve-maxi-otomatik-filtre-kahve-makinesi-sih31306',
  '276': 'st-gurmega-izgara-ve-tost-makinesi-inox-sgh23503',
  '277': 'st-ankastre-gomme-aspirator-inox-seg54005',
  '278': 'st-gurmega-waffle-plakasi-sgh23506',
  '286': 'st-maxi-chef-star-stand-mikser-dokum-8-litre-sgh20080',
  '302': 'st-fonmatik-fn-510-otel-tipi-sac-kurutma-skb40116',
  '310': 'st-rft415l01eu-e-nf-inox-buzdolabi-sbe90447',
  '313': 'st-kays-si-040-celik-su-isiticisi-mat-sih32025',
  '314': 'st-trodos-sb-3120-buz-makineli-su-sebili-seg50230',
  '334': 'st-cf2b287l01eu-e-df-w-sandik-derin-dondurucu-sbe90155',
  '335': 'st-uf5d168l01eu-e-df-w-5-cek-dik-derin-dondurucu-sbe90104',
  '336': 'st-uf7d242l01eu-e-df-w-7-cek-dik-derin-dondurucu-sbe90004',
  '337': 'st-uf4d91l01eu-e-df-w-4-cek-dik-derin-dondurucu-sbe90070',
  '338': 'st-mul600l01eu-e-nf-black-glass-buzdolabi-sbe90575',
  '339': 'st-rft334l01eu-e-nf-white-buzdolabi-sbe90443',
  '340': 'st-ao-gls-640-e-black-kristal-cam-ocak-seg70430',
  '345': 'st-kaynas-im-32b-ani-su-isiticili-musluk-seg50015',
  '346': 'st-tropix-pro-kisisel-blender-inox-sgh22835',
  '347': 'st-bigcays-1520-otomatik-celik-cay-makinesi-20-lt-inox-sih33200',
  '354': 'st-sadem-x-otomatik-turk-kahve-makinesi-inox-sih31200',
  '355': 'st-32smwoshd-32-led-smart-webos-hd-1366-768-stv70714',
  '359': 'st-uzay-s-2400-islak-kuru-supurge-kirmizi-set11026',
  '360': 'st-trodos-sb-313b-tezgah-ustu-su-sebili-seg50235',
  '361': 'st-anka-s-440-watt-dikey-toz-torbasiz-elektrikli-supurge-set13035',
  '362': 'st-akarsu-pro-dijital-ani-su-isiticisi-seg50013',
  '363': 'st-chefturco-mega-1600-w-et-kiyma-makinesi-sgh21520',
  '364': 'st-robotik-ro-1200-mini-dograyici-inox-sgh20554',
  '365': 'st-robotik-ro-2000-cam-hazneli-mutfak-robotu-sgh20062',
  '366': 'st-spektron-s-torbasiz-elektrikli-supurge-set12385',
  '367': 'st-tanto-1500-w-el-blenderi-siyah-inox-sgh22210',
  '368': 'st-tanto-pro-1500-w-el-blender-seti-siyah-inox-sgh22215',
  '369': 'st-vitablend-1200-w-dc-table-blender-inox-sih30100',
  '370': 'st-coffee-mix-350-w-kahve-baharat-ogutucusu-sih30450',
  '371': 'st-wamp7007l1202eu-a-w-bldc-cam-mak-7-kg-1200-devir-sbe90646',
  '372': 'st-af-7em09cd-3-cam-black-turbo-firin-74-lt-seg70111',
  '373': 'st-af-7em09cd-3-cam-black-turbo-firin-74-lt-seg70111',
  '374': 'st-ao-6043etr-black-ankastre-vitro-seramik-ocak-4-lu-seg70460',
  '375': 'st-ao-3020etr-black-ankastre-vitro-seramik-ocak-2-li-seg70461',
  '376': 'st-ao-6041bg-dokum-black-kristal-cam-ocak-seg70491',
  '378': 'st-ao-6041gr-black-kristal-cam-ocak-seg70481',
  '379': 'st-ao-6041gr-black-kristal-cam-ocak-seg70481',
  '380': 'st-ao-6040sr-black-ankastre-ocak-seg70472',
  '381': 'st-ao-6040sr-black-ankastre-ocak-seg70472',
  '382': 'st-ao-6040sr-inox-ankastre-ocak-seg70470',
  '383': 'st-rft415l01eu-e-nf-inox-buzdolabi-sbe90447',
  '385': 'st-mul421l01eu-e-nf-black-glass-buzdolabi-sbe90573',
  '386': 'st-com400l01eu-e-nf-white-buzdolabi-sbe90556',
  '387': 'st-airtron-af-700-digital-air-fryer-siyah-bakir-sgh25670',
  '388': 'st-airtron-af-700-digital-air-fryer-siyah-bakir-sgh25670',
  '393': 'st-jett-9025-black-25-lt-ankastre-mikrodalga-firin-sbe90951',
  '394': 'st-jett-9025-black-25-lt-ankastre-mikrodalga-firin-sbe90951',
  '395': 'st-af-7et13cd-3-cam-black-dijital-turbo-firin-74-lt-sbe70121',
  '396': 'st-af-7et13cd-3-cam-black-dijital-turbo-firin-74-lt-sbe70121',
  '397': 'st-com253l01eu-e-nf-ankastre-buzdolabi-sbe90558',
  '398': 'st-dw14lp801eu-c-ankastre-bulasik-makinesi-14l-8-prog-sbe90810',
  '399': 'st-43gtv4k-qled-43-google-tv-ultra-hd-4k-stv70731',
  '400': 'st-55gtv4k-qled-55-google-tv-ultra-hd-4k-stv70732',
  '401': 'st-65gtv4k-qled-65-google-tv-ultra-hd-4k-stv70733',
  '402': 'st-75gtv4k-qled-75-google-tv-ultra-hd-4k-stv70734',
  '403': 'st-pirpir-va-1080-masaustu-dijital-sarjli-vantilator-seg53036',
  '404': 'st-utumax-3000-w-nano-seramik-utu-gumus-sut61061',
  '405': 'st-utumax-3000-w-nano-seramik-utu-gold-sut61060',
  '406': 'st-kitirik-to-519-izgara-ve-tost-makinesi-inox-sgh23014',
  '407': 'st-af-608-black-firin-75-lt-seg70165',
  '408': 'st-af-608-black-firin-75-lt-seg70165',
  '409': 'st-sadem-x-duo-ciftli-otomatik-turk-kahve-makinesi-inox-sih31203',
  '410': 'st-sadem-x-otomatik-turk-kahve-makinesi-inox-sih31200',
  '411': 'st-bikahve-pro-otomatik-turk-kahve-makinesi-gumus-sih31230',
  '412': 'st-bikahve-pro-otomatik-turk-kahve-makinesi-roze-sih31231',
  '413': 'st-cf2b508l01eu-b1-df-w-sandik-derin-dondurucu-sbe90156',
  '415': 'st-ao-9051g-dokum-black-kristal-cam-ocak-sbe70511',
  '416': 'st-ao-6041bg-dokum-black-kristal-cam-ocak-seg70491',
  '417': 'st-ao-9051g-dokum-black-kristal-cam-ocak-sbe70511',
  '418': 'st-jettmax-duo-2-urun-1-arada-pratik-buharli-utu-sut61070',
}

/**
 * Yalnızca DÜZ YOL yönlendirmelerini üretir (`legacyRedirects`).
 *
 * `legacyProductIds` ve `legacyQueryRedirects` burada YOK — onlar `proxy.ts`de işleniyor.
 * Neden: Next.js'in `redirects()` (next.config.ts) çalışma sırası Proxy'den ÖNCE gelir
 * (bkz. proxy dosyası başındaki not). `has` ile sorgu eşleştiren bir `redirects()` kuralı,
 * hedefte kendi sorgu dizesi yoksa gelen isteğin TAMAMINI (`?route=product%2Fproduct&...`)
 * hedefe ekliyor — bunu engelleyecek bir seçenek `redirects()` tarafında yok (2026-09-05
 * denetiminde bulundu, Next 16 dokümantasyonuyla doğrulandı). Proxy içinde elle
 * `NextResponse.redirect(url)` kurulunca hedef URL'i tamamen kendimiz yazıyoruz, hiçbir sorgu
 * parametresi sızmıyor.
 */
export function buildLegacyRedirectRules() {
  return legacyRedirects.map((r) => ({
    source: r.source,
    destination: r.destination,
    permanent: true,
  }))
}
