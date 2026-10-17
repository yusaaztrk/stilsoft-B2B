import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import Tts from 'react-native-tts';
import { API_BASE_URL, NOTIFICATION_CHANNEL_ID, NOTIFICATION_CHANNEL_NAME } from '../config';
import { authHeaders, getSession, hydrateSession } from '../session/store';

/**
 * Bildirimler — FIREBASE KULLANILMADAN.
 *
 * Push (FCM) yolu tercih edilmedi. Onun yerine bildirimler sunucudan YOKLANARAK alınıyor ve
 * telefonun kendi bildirimi olarak gösteriliyor.
 *
 * Yoklama, konum için zaten çalışan ÖN PLAN SERVİSİNİN içinde dönüyor
 * (`src/location/backgroundLocation.ts`). Yani ayrı bir pil maliyeti yok ve uygulama ekranı
 * kapalıyken de bildirim geliyor — servis ayakta olduğu sürece.
 *
 * SINIRI AÇIKÇA: kullanıcı uygulamayı görev listesinden zorla kapatırsa ya da işletim sistemi
 * servisi öldürürse yoklama durur ve bildirim gelmez. FCM'in tek gerçek üstünlüğü buydu.
 * Uygulama yeniden açıldığında kaçan bildirimler ilk turda toplu olarak gösterilir.
 */

/** En son hangi bildirime kadar gösterildiği. Aynı kayıt ikinci kez bildirim üretmesin. */
const LAST_SEEN_KEY = 'serviceOps.lastNotificationAt';

/** Bu açılışta sesli okunanlar — yeniden bağlanmada aynı metin iki kez okunmasın. */
const spokenIds = new Set<string>();

type ServerNotification = {
  id: string;
  title?: string | null;
  message?: string | null;
  jobType?: string | null;
  jobId?: string | null;
  createdAt: string;
};

export async function ensureNotificationChannel() {
  if (Platform.OS !== 'android') return;
  // Kanal olmadan Android 8+ bildirimi HİÇ göstermez.
  await notifee.createChannel({
    id: NOTIFICATION_CHANNEL_ID,
    name: NOTIFICATION_CHANNEL_NAME,
    importance: AndroidImportance.HIGH,
    sound: 'default',
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    if (Number(Platform.Version) >= 33) {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  }
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= 1;
}

function speak(text: string, id: string) {
  if (!text || spokenIds.has(id)) return;
  spokenIds.add(id);
  try {
    Tts.setDefaultLanguage('tr-TR');
    Tts.speak(text);
  } catch {
    // Sesli okuma bir ek: ses motoru yoksa bildirim yine görünür. Uygulama düşmemeli.
  }
}

async function readLastSeen(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SEEN_KEY);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

async function writeLastSeen(ms: number) {
  try {
    await AsyncStorage.setItem(LAST_SEEN_KEY, String(ms));
  } catch {
    /* disk yazılamadıysa bu tur tekrar gösterilir; kaybolan bildirimden iyidir */
  }
}

/**
 * Sunucudaki yeni bildirimleri alıp telefon bildirimi olarak gösterir.
 *
 * Arka plan görevinden çağrılıyor. Hiçbir hata dışarı sızmıyor: bu döngü durursa konum takibi
 * de durur.
 */
export async function pollNotifications() {
  const session = getSession() ?? (await hydrateSession());
  if (!session?.accessToken || !session.technicianId) return;

  let list: ServerNotification[] = [];
  try {
    const response = await fetch(`${API_BASE_URL}/api/notifications`, {
      headers: authHeaders(session),
    });
    if (!response.ok) return;
    list = (await response.json()) as ServerNotification[];
  } catch {
    // Sahada kapsama sürekli kesiliyor; bir sonraki turda tekrar denenir.
    return;
  }

  if (!Array.isArray(list) || list.length === 0) return;

  const lastSeen = await readLastSeen();

  /*
    İLK AÇILIŞ KORUMASI: `lastSeen` sıfırken geçmişteki bütün bildirimleri göstermek, uygulamayı
    ilk kuran teknisyenin telefonuna onlarca bildirim düşürür ve hepsini sesli okur. İlk turda
    yalnızca işaret bırakılıyor.
  */
  const newestMs = Math.max(...list.map(n => new Date(n.createdAt).getTime() || 0));
  if (lastSeen === 0) {
    await writeLastSeen(newestMs);
    return;
  }

  const fresh = list
    .filter(n => (new Date(n.createdAt).getTime() || 0) > lastSeen)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (fresh.length === 0) return;

  for (const item of fresh) {
    const title = item.title || 'Yeni bildirim';
    const body = item.message || '';

    await notifee.displayNotification({
      id: String(item.id),
      title,
      body,
      data: {
        jobType: String(item.jobType ?? ''),
        jobId: String(item.jobId ?? ''),
      },
      android: {
        channelId: NOTIFICATION_CHANNEL_ID,
        pressAction: { id: 'default', launchActivity: 'default' },
        smallIcon: 'ic_launcher',
      },
    });
  }

  // Sesli okuma yalnızca EN YENİSİ için: on bildirim birikmişse telefon on kez konuşmasın.
  const latest = fresh[fresh.length - 1];
  speak(`${latest.title ?? ''}. ${latest.message ?? ''}`, String(latest.id));

  await writeLastSeen(newestMs);
}

/** Bildirime dokunulunca açılacak web yolu. */
function pathFor(data?: Record<string, unknown>): string {
  const jobType = String(data?.jobType ?? '');
  const jobId = String(data?.jobId ?? '');
  // Tek işlik atamada kayıt kimliği geliyor; toplu atamada sunucu bilerek boş bırakıyor.
  if (jobType && jobId) return `/bildirimler?jobType=${jobType}&jobId=${jobId}`;
  return '/bildirimler';
}

/**
 * Bildirime dokunma olayını dinler; temizleyici döner.
 *
 * Uygulama kapalıyken dokunulan bildirim buradaki dinleyiciye düşmez — açılış bildirimi ayrıca
 * sorulur (`getInitialNotification`).
 */
export async function setupNotificationTaps(onOpen: (path: string) => void): Promise<() => void> {
  const unsubscribe = notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) onOpen(pathFor(detail.notification?.data));
  });

  const initial = await notifee.getInitialNotification();
  if (initial) onOpen(pathFor(initial.notification?.data));

  return unsubscribe;
}
