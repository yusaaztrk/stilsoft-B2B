import { hydrateSession } from '../session/store';
import { startLocationTracking } from './backgroundLocation';

/**
 * Telefon açıldığında çalışan headless görev.
 *
 * Native taraf (`BootReceiver` → `BootTaskService`) bunu tetikliyor. Uygulama arayüzü AÇILMIYOR;
 * burada yalnızca oturum diskten okunup konum servisi ayağa kaldırılıyor.
 *
 * Oturum `getSession()` ile değil `hydrateSession()` ile okunuyor: bu görev yepyeni bir JS
 * bağlamında çalışıyor, bellekteki kopya boş. Diskteki kopya olmasaydı telefon her açıldığında
 * kimliksiz kalır ve takip başlamazdı.
 *
 * Oturum yoksa (kullanıcı çıkış yapmış) hiçbir şey yapılmaz — kalıcı bildirim gösterip veri
 * yazmayan bir servis kullanıcıyı yanıltır.
 */
export async function bootTask(): Promise<void> {
  try {
    const session = await hydrateSession();
    if (!session?.accessToken || !session.technicianId) return;

    await startLocationTracking();
  } catch {
    // Görev çökerse Android tekrar denemez; uygulama elle açıldığında takip zaten kurulur.
    // Burada patlamak, açılışta görünür bir hata diyaloğu çıkarmaktan başka işe yaramaz.
  }
}
