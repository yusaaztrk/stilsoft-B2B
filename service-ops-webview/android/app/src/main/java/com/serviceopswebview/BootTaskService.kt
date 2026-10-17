package com.serviceopswebview

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Açılış yayınını JS tarafına bağlayan köprü.
 *
 * `BootReceiver` bunu başlatıyor; burada da `index.js`'te kayıtlı "ServiceOpsBoot" görevi
 * çalıştırılıyor. Görev oturumu diskten okuyup konum servisini kuruyor.
 *
 * `allowedInForeground = true`: uygulama zaten açıkken de açılış yayını gelebiliyor (nadiren,
 * ROM'a göre). False olsaydı o durumda görev sessizce atlanırdı.
 *
 * Zaman aşımı BİLEREK kısa: bu görevin tek işi konum servisini AYAĞA KALDIRMAK. Konumu asıl
 * yazan şey ön plan servisi; burada uzun süre beklemek pil yakar ve sistemin görevi öldürme
 * riskini artırır.
 */
class BootTaskService : HeadlessJsTaskService() {

    /**
     * SERVİS KENDİNİ HEMEN ÖN PLANA ALIR — YOKSA UYGULAMA AÇILIŞTA ÇÖKER (2026-08-23).
     *
     * `BootReceiver` bu servisi `startForegroundService()` ile başlatıyor (Android 8+'ta
     * arka plandan başka yolu yok). O çağrının SÖZLEŞMESİ var: servis ~5 saniye içinde
     * `startForeground()` çağırmazsa sistem uygulamayı
     * `ForegroundServiceDidNotStartInTimeException` ile ÖLDÜRÜR.
     *
     * `HeadlessJsTaskService` kendiliğinden ön plana geçmiyor; bu çağrı olmadan telefon her
     * yeniden başlatıldığında uygulama çöküyordu. Kullanıcı bunu "telefonu açtım, uygulama
     * hata verdi" diye görür ve çökme uygulamayı hiç açmadan gerçekleştiği için sebebi
     * anlaşılmaz.
     *
     * try/catch ŞART: Android 12+ arka plandan ön plan servisi başlatmayı kısıtlıyor ve bazı
     * ROM'lar açılışta büsbütün reddediyor. Reddedilirse ÇÖKMEK YERİNE sessizce vazgeçiyoruz —
     * kullanıcı uygulamayı elle açtığında takip nasılsa kuruluyor. `BootReceiver` de aynı
     * gerekçeyle kendi çağrısını try/catch içine almıştı.
     */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            onPlanaAl()
        } catch (e: Exception) {
            Log.w(TAG, "Acilis servisi on plana alinamadi, vazgeciliyor: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }

        return super.onStartCommand(intent, flags, startId)
    }

    private fun onPlanaAl() {
        val yonetici = getSystemService(NotificationManager::class.java)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // DÜŞÜK ÖNEM: bu bildirim kullanıcıya bir şey anlatmıyor, yalnızca sistemin
            // ön plan servisi için zorunlu tuttuğu göstergedir. Sesli/açılır olursa telefon
            // her açılışta boş yere uyarı verir.
            val kanal = NotificationChannel(
                KANAL_ID,
                "Açılışta konum takibi",
                NotificationManager.IMPORTANCE_LOW,
            )
            kanal.setShowBadge(false)
            yonetici?.createNotificationChannel(kanal)
        }

        val bildirim: Notification = NotificationCompat.Builder(this, KANAL_ID)
            .setContentTitle("Stilsoft Servis")
            .setContentText("Konum takibi başlatılıyor...")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()

        // Android 10+ tür bildirmeyi ZORUNLU kılıyor; manifestteki
        // `foregroundServiceType="location"` ile birebir aynı olmalı, yoksa sistem reddeder.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(BILDIRIM_ID, bildirim, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(BILDIRIM_ID, bildirim)
        }
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
        return HeadlessJsTaskConfig(
            "ServiceOpsBoot",
            Arguments.createMap(),
            30000,
            true,
        )
    }

    companion object {
        private const val TAG = "ServiceOpsBoot"
        private const val KANAL_ID = "boot-location"
        private const val BILDIRIM_ID = 4711
    }
}
