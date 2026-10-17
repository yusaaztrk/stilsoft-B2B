import { PermissionsAndroid, Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';
import Geolocation from 'react-native-geolocation-service';
import { API_BASE_URL, LOCATION_INTERVAL_MS } from '../config';
import { authHeaders, getSession, hydrateSession } from '../session/store';
import { pollNotifications } from '../notifications/localNotifications';
import { ensureBatteryOptimizationExemption } from './batteryOptimization';

/**
 * Teknisyenin konumunu arka planda da sunucuya yazan servis.
 *
 * Uç zaten vardı (`POST /api/technicians/{id}/location`) ve haritalı ekranlar oradan besleniyor;
 * eksik olan, uygulama ön planda değilken konumun akmaya devam etmesiydi.
 *
 * Android'de arka planda konum almanın tek yasal yolu bir ÖN PLAN SERVİSİ (kalıcı bildirim)
 * açmak: işletim sistemi arka plandaki uygulamanın konum erişimini birkaç dakika içinde
 * kesiyor. Bildirim kullanıcıya "takip açık" demenin de tek dürüst yolu — gizlice çalışan bir
 * konum servisi hem mağaza kuralına aykırı hem de yanlış olurdu.
 *
 * iOS'ta karşılığı `Info.plist`'teki `UIBackgroundModes: location` ve "always" izni; kod tarafı
 * `watchPosition` ile aynı kalıyor.
 */

let running = false;

/** Konum izni ister. Arka plan izni AYRI bir adım — Android 10'dan beri aynı diyalogda gelmiyor. */
export async function requestLocationPermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const status = await Geolocation.requestAuthorization('always');
    return status === 'granted';
  }

  const fine = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Konum izni',
      message: 'İş takibi için konumunuz kaydedilir.',
      buttonPositive: 'İzin ver',
    },
  );
  if (fine !== PermissionsAndroid.RESULTS.GRANTED) return false;

  // Arka plan izni ancak ön plan izni verildikten SONRA istenebilir; birlikte istenirse
  // Android diyaloğu hiç göstermeden reddeder.
  if (Number(Platform.Version) >= 29) {
    const background = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
      {
        title: 'Arka planda konum',
        message: 'Uygulama kapalıyken de konumunuzun görünmesi için gereklidir.',
        buttonPositive: 'İzin ver',
      },
    );
    // Reddedilirse servis yine çalışır, sadece uygulama açıkken konum gider.
    if (background !== PermissionsAndroid.RESULTS.GRANTED) return true;
  }

  // Android 13+ ön plan servisinin kalıcı bildirimini gösterebilmek için ayrıca bildirim izni
  // ister. İzin yoksa servis başlar ama bildirim görünmez ve sistem servisi kısa sürede öldürür.
  if (Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }

  return true;
}

async function postLocation(latitude: number, longitude: number) {
  const session = getSession() ?? (await hydrateSession());
  if (!session?.accessToken || !session.technicianId) return;

  try {
    await fetch(`${API_BASE_URL}/api/technicians/${session.technicianId}/location`, {
      method: 'POST',
      headers: authHeaders(session),
      body: JSON.stringify({ latitude, longitude }),
    });
  } catch {
    // Sahada kapsama sürekli kesiliyor. Başarısız yazma bir sonraki turda kendiliğinden
    // tekrarlanıyor; kuyruk tutmuyoruz çünkü GEÇMİŞ konum değil GÜNCEL konum gösteriliyor.
  }
}

function readAndPost(): Promise<void> {
  return new Promise(resolve => {
    Geolocation.getCurrentPosition(
      async position => {
        await postLocation(position.coords.latitude, position.coords.longitude);
        resolve();
      },
      () => resolve(),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
    );
  });
}

/** Ön plan servisinin gövdesi: durdurulana kadar aralıklarla konum yazar. */
const locationTask = async () => {
  // `while (BackgroundService.isRunning())` kalıbı kütüphanenin kendi önerisi: görev
  // sonlanırsa servis de biter.
  while (BackgroundService.isRunning()) {
    await readAndPost();
    // Bildirim yoklaması aynı döngüde: Firebase kullanılmadığı için bildirimlerin telefona
    // ulaşmasının tek yolu bu. Ayrı bir zamanlayıcı kurmak ikinci bir uyanma kaynağı olurdu.
    await pollNotifications();
    await new Promise<void>(resolve => {
      setTimeout(() => resolve(), LOCATION_INTERVAL_MS);
    });
  }
};

export async function startLocationTracking() {
  if (running) return;

  const session = getSession();
  // Oturumu ya da teknisyen kimliği olmayan kullanıcı (yönetici) için servis hiç açılmaz:
  // kalıcı bildirim gösterip hiçbir şey yazmayan bir servis kullanıcıyı yanıltır.
  if (!session?.accessToken || !session.technicianId) return;

  const granted = await requestLocationPermissions();
  if (!granted) return;

  // Konum izni alındıktan SONRA isteniyor: kullanıcıya arka arkaya diyalog yığmamak için, ve
  // izin verilmemişse zaten takip başlamayacağı için muafiyet istemenin anlamı yok.
  // Muafiyet olmadan sistem ön plan servisini bir süre sonra öldürüyor ve konum sessizce kesiliyor.
  await ensureBatteryOptimizationExemption();

  running = true;
  try {
    await BackgroundService.start(locationTask, {
      taskName: 'ServiceOpsLocation',
      taskTitle: 'Konum takibi açık',
      taskDesc: 'İş takibi için konumunuz kaydediliyor.',
      taskIcon: { name: 'ic_launcher', type: 'mipmap' },
      color: '#B91C1C',
      linkingURI: 'serviceops://',
      parameters: {},
    });
  } catch {
    running = false;
  }
}

export async function stopLocationTracking() {
  if (!running) return;
  running = false;
  try {
    await BackgroundService.stop();
  } catch {
    // Servis zaten ölmüşse (sistem öldürdü) durdurma hata verir; sonuç aynı.
  }
}
