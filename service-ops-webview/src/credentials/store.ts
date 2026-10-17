import { NativeModules, Platform } from 'react-native';

/**
 * HATIRLANAN GİRİŞ BİLGİLERİ.
 *
 * Teknisyen servisten bayiye geçtiğinde bayi alan adının kendi oturumu olmadığı için parola
 * soruluyordu — telefonda bu her geçişte tekrarlanıyor ve sahada iş yavaşlatıyordu. Kullanıcı
 * kararı (2026-08-24): uygulama ilk girişteki bilgileri hatırlasın, giriş ekranı her
 * çıktığında kendisi doldurup göndersin.
 *
 * Bilgi diske ŞİFRELİ yazılıyor (`SecureStoreModule`, AndroidKeyStore/AES-GCM); anahtar
 * cihazın anahtar deposundan çıkmıyor.
 *
 * Kapsam bilerek TEK KAYIT: uygulamayı kullanan kişi bir kişidir. Kullanıcı değiştirmek
 * isterse çıkış yapar — çıkış kaydı siler (bkz. `clearCredentials`).
 */

const KEY = 'serviceOps.credentials';

export type SavedCredentials = {
  /** Firma kodu; giriş formunun üçüncü alanı. Yönetim girişinde boş olabilir. */
  tenantCode: string | null;
  username: string;
  password: string;
};

type SecureStoreModule = {
  setItem(key: string, value: string): Promise<boolean>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<boolean>;
};

const secureStore: SecureStoreModule | undefined = (NativeModules as any)?.SecureStore;

/** Bellekteki kopya: giriş ekranı açılır açılmaz cevap verebilmek için. */
let cached: SavedCredentials | null = null;
let hydrated = false;

function usable(): boolean {
  // Modül yalnızca Android tarafında kayıtlı. iOS'ta (ya da modül bir şekilde yoksa) özellik
  // sessizce devre dışı kalır; giriş ekranı elle doldurulur. Çökme yok.
  return Platform.OS === 'android' && !!secureStore;
}

export async function hydrateCredentials(): Promise<SavedCredentials | null> {
  if (hydrated) return cached;
  hydrated = true;

  if (!usable()) return null;

  try {
    const raw = await secureStore!.getItem(KEY);
    cached = raw ? (JSON.parse(raw) as SavedCredentials) : null;
  } catch {
    // Bozuk/çözülemeyen kayıt: yok say. Kullanıcı bir kez elle girer, yeniden saklanır.
    cached = null;
  }

  // Eksik alanlı kayıt işe yaramaz; otomatik giriş yarım veriyle denenirse kullanıcı
  // "şifre hatalı" görür ve sebebini anlamaz.
  if (cached && (!cached.username || !cached.password)) cached = null;

  return cached;
}

export function getCredentials(): SavedCredentials | null {
  return cached;
}

export async function saveCredentials(next: SavedCredentials): Promise<void> {
  if (!next?.username || !next?.password) return;

  cached = next;
  hydrated = true;

  if (!usable()) return;
  try {
    await secureStore!.setItem(KEY, JSON.stringify(next));
  } catch {
    // Disk yazılamadıysa bellek kopyası bu oturum boyunca yine iş görür.
  }
}

/**
 * Kayıtlı bilgiyi siler.
 *
 * ÇIKIŞTA çağrılır, oturum SÜRESİ DOLDUĞUNDA değil. Ayrım önemli: süre dolması beklenen bir
 * şey ve otomatik giriş tam da onun için var. Çıkış ise kullanıcının açık iradesi — "beni
 * çıkar" diyen birini uygulamanın hemen geri sokması, hesap değiştirmeyi de imkânsız kılardı.
 */
export async function clearCredentials(): Promise<void> {
  cached = null;
  hydrated = true;

  if (!usable()) return;
  try {
    await secureStore!.removeItem(KEY);
  } catch {
    // Silinemediyse bir sonraki açılışta tekrar denenir; bellekteki kopya zaten temiz.
  }
}
