package com.serviceopswebview

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Pil optimizasyonu muafiyeti.
 *
 * Android, "optimize edilen" uygulamaların ön plan servisini bir süre sonra öldürüyor; Xiaomi,
 * Samsung ve Huawei ROM'ları bunu çok daha agresif yapıyor. Sonuç sahada şu şekilde görünüyordu:
 * konum bir süre akıyor, sonra hiçbir hata vermeden kesiliyor ve telefon "son bilinen noktada"
 * takılı kalıyordu.
 *
 * Muafiyeti KULLANICI onaylar; uygulama kendi başına açamaz. Burada yapılan tek şey sistem
 * diyaloğunu açmak.
 */
class BatteryOptimizationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "BatteryOptimization"

    /** Muafiyet zaten verilmiş mi. Android 6 öncesinde optimizasyon kavramı yok, true dönülür. */
    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                promise.resolve(true)
                return
            }
            val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            promise.resolve(pm.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
        } catch (e: Exception) {
            // Bilinmiyorsa "muaf" demek yanlış yönlendirir; çağıran taraf false görüp isteyebilsin.
            promise.resolve(false)
        }
    }

    /**
     * Muafiyet diyaloğunu açar.
     *
     * `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` bazı cihazlarda (ve Play politikası gereği
     * bazı sürümlerde) engellenebiliyor; o durumda kullanıcıyı pil optimizasyonu ayar listesine
     * düşürüyoruz — muafiyeti oradan da verebilir. Hiçbiri açılmazsa hata döner, çağıran taraf
     * kullanıcıya elle tarif gösterir.
     */
    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            promise.resolve(true)
            return
        }

        val paket = reactApplicationContext.packageName
        val dogrudan = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:$paket")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val liste = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        for (intent in listOf(dogrudan, liste)) {
            try {
                reactApplicationContext.startActivity(intent)
                promise.resolve(true)
                return
            } catch (_: Exception) {
                // sıradakini dene
            }
        }

        promise.reject("NO_ACTIVITY", "Pil optimizasyonu ekrani acilamadi.")
    }
}
