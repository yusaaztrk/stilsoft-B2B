import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  PermissionsAndroid,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import RNBlobUtil from 'react-native-blob-util';
import RNPrint from 'react-native-print';
import { WEB_URL } from '../config';
import { buildInjection, parseWebMessage } from '../bridge/types';
import type { NativeMessage } from '../bridge/types';
import { setSession } from '../session/store';
import {
  hydrateCredentials,
  saveCredentials,
  clearCredentials,
} from '../credentials/store';
import { startLocationTracking, stopLocationTracking } from '../location/backgroundLocation';
import {
  ensureNotificationChannel,
  requestNotificationPermission,
  setupNotificationTaps,
} from '../notifications/localNotifications';

const BRAND = '#B91C1C';

/**
 * Uygulamanın tamamı: ServiceOps web arayüzünü taşıyan WebView + tarayıcının veremediği
 * yetenekler.
 *
 * Ekranlar burada yeniden yazılmıyor. Sebep basit: web tarafında 40'tan fazla sayfa var ve
 * native kopyası yıllardır geride kalıyordu — montaj kalem ekseni, hak ediş, tahsilat ve rapor
 * merkezi native uygulamada hiç yok. Tek kaynak, tek yerde güncelleniyor.
 *
 * Kabuğun işi yalnızca WebView'in yapamadıkları:
 *   • dosya indirme      (blob → telefonun indirilenler klasörü)
 *   • yazdırma           (Android WebView'de `window.print` tanımsız)
 *   • konum              (arka planda da yazılır)
 *   • bildirim           (arka plan servisinde yoklanır, telefon bildirimi olarak gösterilir)
 *   • geri tuşu          (yoksa geri tuşu uygulamadan çıkar, sayfada geri gitmez)
 */
export default function WebViewShell() {
  const webViewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const sendToWeb = useCallback((message: NativeMessage) => {
    webViewRef.current?.injectJavaScript(buildInjection(message));
  }, []);

  /*
    Bildirim kurulumu.

    Firebase KULLANILMIYOR. Bildirimler sunucudan yoklanıp telefonun kendi bildirimi olarak
    gösteriliyor; yoklama konum servisinin döngüsünde dönüyor
    (`src/notifications/localNotifications.ts`). Burada yalnızca kanal, izin ve "bildirime
    dokunulunca ilgili sayfayı aç" bağlanıyor.
  */
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      await ensureNotificationChannel();
      await requestNotificationPermission();
      cleanup = await setupNotificationTaps(path => sendToWeb({ type: 'navigate', path }));
    })();
    return () => cleanup?.();
  }, [sendToWeb]);

  /*
    Donanım geri tuşu.

    Varsayılan davranışta geri tuşu doğrudan uygulamayı kapatıyor: teknisyen bir kayıt detayına
    girip geri tuşuna bastığında listeye değil ana ekrana düşerdi. Sayfa geçmişi varsa önce o
    tüketiliyor.
  */
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBackRef.current) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, []);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    canGoBackRef.current = navState.canGoBack;
  }, []);

  /**
   * DIS BAGLANTILAR TELEFONUN KENDI UYGULAMASINDA ACILIR (2026-08-24, kullanici bildirimi:
   * "WS butonuna basinca webden acmaya calisiyor").
   *
   * Sayfadaki WhatsApp dugmesi `https://wa.me/<numara>` adresine gidiyor. Tarayicida bu adres
   * yuklu WhatsApp uygulamasina devrediliyor; WebView'de ise DEVREDILMIYOR, sayfa kabugun
   * icinde aciliyor ve kullanici "WhatsApp'ta ac" diyen bir web sayfasina bakiyor. Ayni sey
   * `tel:` ve `mailto:` icin de gecerli — WebView bu semalari bilmedigi icin baglanti olu.
   *
   * Cozum: bu adresleri WebView'e HIC yukletmemek, isletim sistemine devretmek.
   * `Linking.openURL` WhatsApp'i dogrudan acar.
   *
   * `wa.me` yerine `whatsapp://` semasina cevirmiyoruz: `wa.me` zaten WhatsApp uygulamasinin
   * kayitli oldugu bir adres ve uygulama yuklu degilse sistem magazaya yonlendirir.
   * Sema cevrilseydi uygulamasi olmayan telefonda hicbir sey olmazdi.
   */
  const dahiliOlmayanSema = useCallback((url: string): boolean => {
    if (!url) return false;
    const kucuk = url.toLowerCase();
    return (
      kucuk.startsWith('whatsapp:') ||
      kucuk.startsWith('tel:') ||
      kucuk.startsWith('mailto:') ||
      kucuk.startsWith('sms:') ||
      kucuk.startsWith('geo:') ||
      kucuk.startsWith('intent:') ||
      kucuk.startsWith('https://wa.me/') ||
      kucuk.startsWith('http://wa.me/') ||
      kucuk.startsWith('https://api.whatsapp.com/') ||
      kucuk.startsWith('https://maps.google.com/') ||
      kucuk.startsWith('https://www.google.com/maps')
    );
  }, []);

  const handleShouldStartLoad = useCallback(
    (request: { url: string }): boolean => {
      if (!dahiliOlmayanSema(request.url)) return true;

      // Acilamazsa (uygulama yuklu degil vb.) sessizce yutuluyor: kabuk cokmemeli ve
      // WebView de o adrese gitmemeli — gitse kullanici yine bos bir sayfa gorurdu.
      Linking.openURL(request.url).catch(() => {});
      return false;
    },
    [dahiliOlmayanSema],
  );

  /** İndirilen dosyayı diske yazar ve telefonun kendi görüntüleyicisiyle açar. */
  const saveDownload = useCallback(async (fileName: string, mimeType: string, base64: string) => {
    try {
      const dir =
        Platform.OS === 'android'
          ? RNBlobUtil.fs.dirs.DownloadDir
          : RNBlobUtil.fs.dirs.DocumentDir;
      const path = `${dir}/${fileName}`;

      await RNBlobUtil.fs.writeFile(path, base64, 'base64');

      if (Platform.OS === 'android') {
        // Dosyayı yazmak yetmiyor: kullanıcı bir şey olduğunu görmeli. Sistem görüntüleyicisi
        // açılınca Excel/CSV doğrudan ilgili uygulamada açılır.
        await RNBlobUtil.android.actionViewIntent(path, mimeType);
      } else {
        await RNBlobUtil.ios.openDocument(path);
      }
    } catch {
      // Web tarafı zaten kendi uyarı şeridini gösteriyor; burada ikinci bir uyarı gürültü olur.
    }
  }, []);

  const handleMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      const message = parseWebMessage(event.nativeEvent.data);
      if (!message) return;

      switch (message.type) {
        case 'session': {
          await setSession(message);
          if (message.accessToken && message.technicianId) {
            // Konum takibi ancak oturum açıldıktan sonra başlayabilir: kimlik olmadan
            // yazılacak bir adres yok.
            startLocationTracking();
          } else {
            await stopLocationTracking();
          }
          break;
        }
        case 'download':
          await saveDownload(message.fileName, message.mimeType, message.base64);
          break;
        case 'print':
          try {
            await RNPrint.print({ html: message.html });
          } catch {
            /* kullanıcı yazdırma ekranını kapattıysa hata değil */
          }
          break;

        /*
          GIRIS BILGISI (2026-08-24).

          Sayfa basarili bir giristen sonra bilgileri gonderiyor, kabuk sifreleyip sakliyor.
          Giris ekrani acildiginda `credentials:request` geliyor ve kayit geri veriliyor;
          sayfa formu doldurup kendisi gonderiyor.

          Neden kabukta saklaniyor: bayi ve servis AYRI alan adlari, tarayici deposu alan adi
          basina ayri. Teknisyen servise giriyor, bayiye gecince oradaki depo bos oldugu icin
          parola soruluyordu. Ikisini birden goren tek yer kabuk.
        */
        case 'credentials:save':
          await saveCredentials({
            tenantCode: message.tenantCode,
            username: message.username,
            password: message.password,
          });
          break;

        case 'credentials:clear':
          await clearCredentials();
          break;

        case 'credentials:request': {
          const kayitli = await hydrateCredentials();
          // Kayit yoksa da cevap gonderiliyor: sayfa cevap bekleyip takilmasin, bos kullanici
          // adi gorup normal giris ekranini gostersin.
          webViewRef.current?.injectJavaScript(
            buildInjection({
              type: 'credentials',
              tenantCode: kayitli?.tenantCode ?? null,
              username: kayitli?.username ?? '',
              password: kayitli?.password ?? '',
            }),
          );
          break;
        }
        default:
          break;
      }
    },
    [saveDownload],
  );

  /*
    Kamera izni.

    Fotoğraf ekleme altı ayrı ekranda `<input type="file" capture>` ile yapılıyor. WebView bunu
    açabiliyor ama kamera izni verilmemişse dosya seçici açılıp boş dönüyor ve kullanıcı
    "fotoğraf eklenmiyor" diyor. İzin uygulama açılışında bir kez isteniyor.
  */
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).catch(() => {});
  }, []);

  /* Ekran kapanırken arka plan servisi de kapansın. */
  useEffect(() => {
    return () => {
      stopLocationTracking();
    };
  }, []);

  const retry = useCallback(() => {
    setFailed(false);
    setLoading(true);
    setReloadKey(key => key + 1);
  }, []);

  if (failed) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={BRAND} />
        <ScrollView
          contentContainerStyle={styles.errorBox}
          refreshControl={<RefreshControl refreshing={false} onRefresh={retry} />}
        >
          <Text style={styles.errorTitle}>Bağlanılamadı</Text>
          <Text style={styles.errorText}>
            Sunucuya ulaşılamıyor. İnternet bağlantınızı kontrol edip tekrar deneyin.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={retry}>
            <Text style={styles.retryText}>Tekrar dene</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />
      <WebView
        key={reloadKey}
        ref={webViewRef}
        source={{ uri: WEB_URL }}
        style={styles.webview}
        onMessage={handleMessage}
        onNavigationStateChange={handleNavigationStateChange}
        /* WhatsApp / tel / harita baglantilari kabugun icinde acilmaz, telefona devredilir. */
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onLoadEnd={() => setLoading(false)}
        onError={() => setFailed(true)}
        onHttpError={({ nativeEvent }) => {
          // 4xx/5xx sayfası WebView'de boş beyaz ekran olarak görünüyor; kullanıcı uygulamanın
          // donduğunu sanıyor. Sunucu hatasında hata ekranına düşülüyor.
          if (nativeEvent.statusCode >= 500) setFailed(true);
        }}
        /* Oturum WebView'in localStorage'ında duruyor; kapatılırsa her açılışta giriş istenir. */
        domStorageEnabled
        javaScriptEnabled
        /* Kamera/galeri seçicisi ve konum izni köprüsü. */
        allowFileAccess
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        geolocationEnabled
        /* Dosya seçici Android'de bu bayrak olmadan hiç açılmaz. */
        allowFileAccessFromFileURLs
        originWhitelist={['*']}
        /* Yerel ağdaki http sunucusu: karışık içerik engeli açılışı boş ekrana çevirir. */
        mixedContentMode="always"
        /*
          PULL-TO-REFRESH KAPALI.
          Açıkken, listelerde ve özellikle fotoğraf ekleme akışında yukarı kaydırma kazara
          yenilemeyi tetikliyor: sayfa baştan yükleniyor, doldurulmuş form ve seçilen dosya
          gidiyor. Kullanıcı bunu "ekran kendi kendine yenileniyor" olarak görüyordu.
          Yenilemek gerekirse hata ekranındaki "Tekrar dene" var.
        */
        pullToRefreshEnabled={false}
        setSupportMultipleWindows={false}
      />
      {loading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={BRAND} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  webview: { flex: 1 },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  errorBox: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  errorText: { fontSize: 14, color: '#64748B', textAlign: 'center', marginBottom: 20 },
  retryButton: { backgroundColor: BRAND, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  retryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
