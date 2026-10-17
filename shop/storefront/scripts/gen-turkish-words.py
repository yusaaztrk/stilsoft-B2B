# -*- coding: utf-8 -*-
"""Vitrin ürün adı sözlüğü üretir: ERP'de Türkçe karaktersiz/büyük harf yazılmış kelime -> doğru başlık biçimi.
   Kaynak: DEMOTEST kataloğunun kelime dökümü (2026-09-21) + sık perakende kelimeleri."""
import io, re

RAW = """
STILSOFT Stilsoft | ARNICA Arnica | MENTESE Menteşe | PLASTIK Plastik | UST Üst | INOX Inox | KAPAGI Kapağı | PANELI Paneli
FILTRE Filtre | TAHLIYE Tahliye | WHITE White | BICAK Bıçak | GOVDE Gövde | SUPURGE Süpürge | ROBOTIK Robotik | CEKMECE Çekmece
PROKIT Prokit | VIDASI Vidası | SOGUK Soğuk | KOMPRESOR Kompresör | SEFFAF Şeffaf | CELIK Çelik | SAG Sağ | DOGRAYICI Doğrayıcı
SABIT Sabit | GUC Güç | GIRIS Giriş | SUPURME Süpürme | MAKINESI Makinesi | KRISTAL Kristal | MIL Mil | BOLME Bölme
BAGLANTI Bağlantı | DUZ Düz | PARCALAYICI Parçalayıcı | LIMITLESS Limitless | BASLIK Başlık | DIJITAL Dijital | SWITCH Switch
ELEKTRONIK Elektronik | DIS Dış | DUGMESI Düğmesi | TROPIX Tropix | PCB PCB | SABITLEME Sabitleme | PIMI Pimi | TEPSISI Tepsisi
ISCILIK İşçilik | SISE Şişe | BUYUK Büyük | HAZNESI Haznesi | HEPA HEPA | DISK Disk | CIRPICI Çırpıcı | MAXI Maxi | DEMLIK Demlik
OTOMATIK Otomatik | CAY Çay | RFT RFT | SERAMIK Seramik | TERMOSIFON Termosifon | DOKUM Döküm | VALFI Valfi | VANTILATOR Vantilatör
DISLI Dişli | QLED QLED | SILTE Şilte | INVERTER Inverter | GOSTERGE Gösterge | PISTONLU Pistonlu | LED LED | TESVIYE Tesviye
SENSORU Sensörü | DUGME Düğme | KAGIT Kağıt | IKILI İkili | SIYAH Siyah | ELEKTRIKLI Elektrikli | TURK Türk | GTV GTV | GLS GLS
MISSTIL Misstil | KLIMA Klima | BLDC BLDC | MIX Mix | BASKULU Basküllü | REZISTANS Rezistans | FISLI Fişli | EVAPORATOR Evaporatör
IZOLE İzole | KONDANSATOR Kondansatör | VIDA Vida | CIKIS Çıkış | PARCASI Parçası | KILIDI Kilidi | CEVIRMELI Çevirmeli
AMARTISOR Amortisör | AMORTISOR Amortisör | TEPSI Tepsi | YUMUSATICI Yumuşatıcı | TELESKOPIK Teleskopik | YIKANABILIR Yıkanabilir
FIRCA Fırça | GRANIT Granit | TASIYICI Taşıyıcı | PIRPIR Pırpır | BTU BTU | WIFI WiFi | SMS SMS | KITIRIK Kıtırık | KARISTIRICI Karıştırıcı
CIFT Çift | KUCUK Küçük | TUPU Tüpü | KABIN Kabin | DAHILI Dahili | BOLUM Bölüm | SERIGRAFLI Serigraflı | SILIKON Silikon
SABITLEYICI Sabitleyici | BICAGI Bıçağı | SEVIYE Seviye | KLIPSI Klipsi | BOLUMU Bölümü | MILI Mili | SILVER Silver | OPSIYONLU Opsiyonlu
KOMITATOR Komütatör | ALUMINYUM Alüminyum | ALIMINYUM Alüminyum | SETI Seti | AMIRAL Amiral | UCLU Uçlu | FILTRESI Filtresi
ADAPTORU Adaptörü | MINI Mini | MIKSER Mikser | REZISTANSLI Rezistanslı | DIKEY Dikey | GUMUS Gümüş | VITRO Vitro | SILINDIRIK Silindirik
GRAMATIK Gramatik | WEBOS webOS | KIS Kış | GRI Gri | KILIT Kilit | FIRCALI Fırçalı | BASLIKLI Başlıklı | TEKERI Tekeri | GOBEK Göbek
GIRISI Girişi | MISIRMATIK Mısırmatik | MIKRODALGA Mikrodalga | OLCU Ölçü | MARMARIS Marmaris | YAPABILEN Yapabilen | TERTIBATI Tertibatı
MANYETIZMA Manyetizma | KOPUGU Köpüğü | PISTON Piston | EVAPORATORU Evaporatörü | PARCA Parça | SUNGERI Süngeri | SERIT Şerit
BOLMESI Bölmesi | KENDINDEN Kendinden | KILITLEMELI Kilitlemeli | DERIN Derin | AYAGI Ayağı | MAGNETIK Magnetik | PERVANESI Pervanesi
YUZEYI Yüzeyi | PROFILI Profili | CERCEVE Çerçeve | SEPETI Sepeti | CUBUGU Çubuğu | CEKVALF Çekvalf | SICAKSU Sıcak Su | LASTIGI Lastiği
YERI Yeri | KLIPS Klips | SUZGECI Süzgeci | MUSLUGU Musluğu | MIKNATISLI Mıknatıslı | KAYISI Kayışı | PISTONU Pistonu | DESTEGI Desteği
SIZDIRMAZLIK Sızdırmazlık | KELEPCESI Kelepçesi | SUSPANSIYON Süspansiyon | BASINC Basınç | PUSKURTUCU Püskürtücü | CATAL Çatal
GECIRMEZ Geçirmez | KELEPCE Kelepçe | SOGUTUCU Soğutucu | ASPIRATOR Aspiratör | SOHBEN Şofben | SOFBEN Şofben | ELEMENTI Elementi
BASLIGI Başlığı | FIRCASI Fırçası | SUNGER Sünger | EMICI Emici | SUPURUCU Süpürücü | INCE İnce | BLENDIR Blender | CIRPI Çırpı | KOFTE Köfte
FIRITOZ Fritöz | FRITOZ Fritöz | BULASIK Bulaşık | PUSKURTMELI Püskürtmeli | CAMASIR Çamaşır | KURUTMA Kurutma | ISITICI Isıtıcı
UTU Ütü | TRAS Tıraş | EPILATOR Epilatör | KIZARTMA Kızartma | AIRFRYER Airfryer | CAYCI Çaycı | KETTLE Kettle | DIK Dik | YATAY Yatay
TELEVIZYON Televizyon | SMART Smart | HOPARLOR Hoparlör | KOMBI Kombi | GAZLI Gazlı | INDUKSIYON İndüksiyon | INDUKSIYONLU İndüksiyonlu
VITROSERAMIK Vitroseramik | USTU Üstü | GARDIROP Gardırop | NEVRESIM Nevresim | PIKE Pike | BATTANIYE Battaniye | CAYDANLIK Çaydanlık
SIKACAGI Sıkacağı | NARENCIYE Narenciye | KATI Katı | MIKSERI Mikseri | YOGURT Yoğurt | PILAV Pilav | YOGURMA Yoğurma | TERAZI Terazi
BASKUL Baskül | DUDUKLU Düdüklü | DUZLESTIRICI Düzleştirici | MASA Maşa | SAKAL Sakal | VUCUT Vücut | NEMLENDIRICI Nemlendirici
TEMIZLEYICI Temizleyici | DIKIS Dikiş | ISLAK Islak | SILME Silme | SARJ Şarj | ADAPTOR Adaptör | PRIZ Priz | COKLU Çoklu | PIL Pil
MONITOR Monitör | BILGISAYAR Bilgisayar | VESTIYER Vestiyer | KOMODIN Komodin | SIFONYER Şifonyer | KITAPLIK Kitaplık | UNITESI Ünitesi
KOSE Köşe | CEKYAT Çekyat | GENC Genç | BESIK Beşik | IC İç | ON Ön | IKI İki | UC Üç | DORT Dört | BES Beş | YEDI Yedi | SEKIZ Sekiz
DIGITAL Digital | INCH İnç | KIRMIZI Kırmızı | MAVI Mavi | YESIL Yeşil | GUMUSI Gümüşi | PEMBE Pembe | MOR Mor | LACIVERT Lacivert
SAMPANYA Şampanya | KREM Krem | BEJ Bej | ANTRASIT Antrasit | CIKOLATA Çikolata | KAHVERENGI Kahverengi | TURUNCU Turuncu
SIYAHINOX Siyah Inox | DOKUMLU Dökümlü | PROGRAMLI Programlı | DEVIR Devir | DEVIRLI Devirli | ISITMA Isıtma | SOGUTMA Soğutma
SES Ses | GORUNTU Görüntü | GORUS Görüş | GENIS Geniş | UZUN Uzun | KISA Kısa | YUKSEK Yüksek | DUSUK Düşük | AGIR Ağır | HAFIF Hafif
CIHAZ Cihaz | CIHAZI Cihazı | ALETI Aleti | ALETLERI Aletleri | TAKIMI Takımı | TAKIM Takım | SISESI Şişesi | KUTUSU Kutusu
KAPAKLI Kapaklı | KAPAKSIZ Kapaksız | SAPLI Saplı | AYAKLI Ayaklı | TEKERLEKLI Tekerlekli | KATLANIR Katlanır | TASINABILIR Taşınabilir
SESSIZ Sessiz | HIZLI Hızlı | GUCLU Güçlü | AKILLI Akıllı | OTOMATIKLI Otomatikli | ZAMANLAYICILI Zamanlayıcılı | ISIKLI Işıklı
ISIK Işık | GECE Gece | GUNDUZ Gündüz | BUHARLI Buharlı | KAZANLI Kazanlı | TORBASIZ Torbasız | TORBALI Torbalı | SARJLI Şarjlı
KABLOSUZ Kablosuz | KABLOLU Kablolu | PILLI Pilli | SICAK Sıcak | ILIK Ilık | DONDURULMUS Dondurulmuş | SUTLU Sütlü | SUT Süt
EKMEK Ekmek | ET Et | KIYMA Kıyma | SEBZE Sebze | MEYVE Meyve | ICECEK İçecek | GIDA Gıda | HAZIRLAMA Hazırlama | TEMIZLIK Temizlik
UTULEME Ütüleme | KISISEL Kişisel | BAKIM Bakım | SAGLIK Sağlık | GUZELLIK Güzellik | EV Ev | GERECLERI Gereçleri | GERECI Gereci
ELEKTRIK Elektrik | ELEKTRO Elektro | KUCUK Küçük | BEYAZ Beyaz | ESYA Eşya | ANKASTRE Ankastre | FIRIN Fırın | OCAK Ocak
DAVLUMBAZ Davlumbaz | BUZDOLABI Buzdolabı | DONDURUCU Dondurucu | SETUSTU Set Üstü | SOLO Solo | KOMBINE Kombine
INOKS Inoks | INOXLU Inoxlu | SIYAHCAM Siyah Cam | KRISTALCAM Kristal Cam | TURBOFIRIN Turbo Fırın | MULTIFONKSIYON Multifonksiyon
FONKSIYON Fonksiyon | FONKSIYONLU Fonksiyonlu | PROGRAM Program | GRIL Gril | GRILL Grill | IZGARALI Izgaralı | DONER Döner
SIS Şiş | TAVA Tava | TENCERE Tencere | CAYDANLIK Çaydanlık | KAHVE Kahve | TURK Türk | ESPRESSO Espresso | FILTRELI Filtreli
KAPSULLU Kapsüllü | OGUTUCU Öğütücü | OGUTUCULU Öğütücülü | DEGIRMENI Değirmeni | SEMAVER Semaver | ISITICISI Isıtıcısı
SU Su | SEBILI Sebili | SEBIL Sebil | ARITMA Arıtma | ARITICI Arıtıcı | PISIRICI Pişirici | PISIRME Pişirme | YAPMA Yapma
KIZARTMA Kızartma | TOST Tost | WAFFLE Waffle | GOZLEME Gözleme | KREP Krep | MISIR Mısır | PATLATMA Patlatma | DONDURMA Dondurma
BUZ Buz | YAPICI Yapıcı | KIRICI Kırıcı | KARISTIRICI Karıştırıcı | RONDO Rondo | DILIMLEME Dilimleme | DILIMLEYICI Dilimleyici
MUTFAK Mutfak | ROBOTU Robotu | AIRTRON Airtron | AIR Air | VE ve | EL El | ILE ile | ICIN için | YP YP | ST ST | TV TV | AC AC | DC DC | LI li | LU lü | LIK lik | LUK lük | LIKLI likli | TV TV | RAIN Rain | IONIC Ionic | BIO Bio | TITANIUM Titanium | TITANYUM Titanyum | SILENT Silent | LIFE Life | LINE Line | LIGHT Light | BRIGHT Bright | FIT Fit | MIDI Midi | MULTI Multi | TWIN Twin | DRIVE Drive | DIRECT Direct | PRIME Prime | SERIES Series | SERIE Serie | EDITION Edition | LIMITED Limited | CLASSIC Classic | ORIGINAL Original | VISION Vision | DESIGN Design | FRYER Fryer | GRINDER Grinder | MIXER Mixer | JUICER Juicer | TOASTER Toaster | HEATER Heater | WASHING Washing | MACHINE Machine | INTELLIGENT Intelligent | SMARTLIFE SmartLife | ACTIVE Active | BASIC Basic | INFINITY Infinity | INFINITE Infinite | MAGIC Magic | MIRACLE Miracle | FAMILY Family | DAILY Daily | EASY Easy | RAPID Rapid | HYBRID Hybrid | SILK Silk | SKIN Skin | HAIR Hair | KIT Kit | KITCHEN Kitchen | LIVING Living | STIL Stil | ELITE Elite | KING King | MINIMAL Minimal | SIMPLE Simple | FINE Fine | PRIDE Pride | VIP VIP | MIST Mist | IRON Iron | RICE Rice | MILK Milk | ICE Ice | JUICE Juice | FRUIT Fruit | VITAMIN Vitamin | VITAL Vital | VITA Vita | WIND Wind | GRIP Grip | CLICK Click | DISPLAY Display | DIVA Diva | LIDER Lider | DIVINE Divine | INSIDE Inside | INFRARED Infrared | ISI Isı | ISIL Isıl | ISILI Isılı | CM cm | MM mm | LT lt | LTR lt | ML ml | KG kg | GR gr | KW kW | HZ Hz | RPM rpm | DB dB | MAH mAh | USB USB | HDMI HDMI | LCD LCD | OLED OLED | UHD UHD | FHD FHD | HD HD | NO No | FROST Frost | NOFROST No Frost | SEF Şef | SEFI Şefi | TERAZISI Terazisi | SIKACAK Sıkacak | PRESI Presi | PRES Pres
"""

entries = {}
for line in RAW.strip().splitlines():
    for part in line.split('|'):
        part = part.strip()
        if not part: continue
        k, v = part.split(' ', 1)
        entries[k.strip().upper()] = v.strip()

# TS dosyası
out = ["/* Otomatik üretildi: scripts/gen-turkish-words.py (2026-09-21). Yeni kelime: betikteki RAW listesine ekle, betiği koştur. */",
       "export const TURKCE_KELIMELER: Record<string, string> = {"]
for k in sorted(entries):
    out.append(f"  {k!r}: {entries[k]!r},".replace("'", '"'))
out.append("}")
p = r'C:\Users\Admin\Desktop\B2B-ERP\shop\storefront\lib\turkishWords.ts'
io.open(p, 'w', encoding='utf-8').write("\n".join(out) + "\n")
print(len(entries), 'kelime ->', p)
