package com.serviceopswebview

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Telefon açılınca konum takibini geri başlatır.
 *
 * Şarjı biten telefon kapanıyor, sonra şarja takılıp açılıyordu — ama takip başlamıyordu,
 * çünkü ön plan servisini kuran şey JS tarafı ve JS ancak kullanıcı uygulamayı ELLE açınca
 * çalışıyor. Sahadaki kişi uygulamayı açmayı unutursa o gün boyunca hiç konum gelmiyordu ve
 * panelde en son bilinen nokta duruyordu.
 *
 * Burada doğrudan servis başlatılamaz: React Native bağlamı henüz yok. Bunun yerine bir
 * headless JS görevi tetikleniyor; o görev normal JS kodunu (oturumu okuma + takibi başlatma)
 * çalıştırıyor.
 *
 * QUICKBOOT_POWERON bazı üreticilerin (Xiaomi/HTC) hızlı açılışta BOOT_COMPLETED yerine
 * gönderdiği yayın — ikisi de dinlenmezse o cihazlarda hiç tetiklenmez.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON" &&
            action != "com.htc.intent.action.QUICKBOOT_POWERON"
        ) {
            return
        }

        Log.i(TAG, "Acilis yayini alindi ($action), konum gorevi tetikleniyor.")

        val serviceIntent = Intent(context, BootTaskService::class.java)
        try {
            // Android 8+'ta arka plandan normal servis başlatmak yasak; açılış yayını sırasında
            // uygulama arka planda sayıldığı için startForegroundService kullanılmak zorunda.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (e: Exception) {
            // Başlatma reddedilirse (ör. bazı ROM'lar açılışta kısıtlıyor) uygulama elle
            // açıldığında takip zaten kurulur. Çökmek yerine loglayıp geçiyoruz.
            Log.w(TAG, "Acilis gorevi baslatilamadi: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "ServiceOpsBoot"
    }
}
