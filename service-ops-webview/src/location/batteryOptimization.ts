import { NativeModules, Platform } from 'react-native';

/**
 * Pil optimizasyonu muafiyeti (yalnızca Android).
 *
 * Muafiyet verilmezse sistem ön plan servisini bir süre sonra öldürüyor ve konum HİÇBİR HATA
 * VERMEDEN kesiliyor — panelde telefon son bilinen noktada takılı kalıyor. Xiaomi, Samsung ve
 * Huawei ROM'larında bu, saatler değil dakikalar içinde oluyor.
 *
 * Muafiyeti uygulama kendi veremez; tek yapabildiği sistem diyaloğunu açmak.
 */

type BatteryOptimizationNative = {
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): Promise<boolean>;
};

const native: BatteryOptimizationNative | undefined =
  NativeModules.BatteryOptimization;

/**
 * Muafiyet yoksa kullanıcıdan ister.
 *
 * Zaten muafsa diyalog AÇILMAZ: her açılışta ayar ekranı fırlatan bir uygulama, kullanıcının
 * bir süre sonra hepsini reddetmesine yol açar.
 *
 * Hata hiçbir durumda yukarı taşınmaz — muafiyet alınamasa da uygulama çalışmaya devam etmeli;
 * yalnızca takip daha kırılgan olur.
 */
export async function ensureBatteryOptimizationExemption(): Promise<void> {
  if (Platform.OS !== 'android' || !native) return;

  try {
    const muaf = await native.isIgnoringBatteryOptimizations();
    if (muaf) return;
    await native.requestIgnoreBatteryOptimizations();
  } catch {
    // Diyalog açılamadıysa (bazı ROM'lar engelliyor) kullanıcı ayarlardan elle verebilir.
  }
}
