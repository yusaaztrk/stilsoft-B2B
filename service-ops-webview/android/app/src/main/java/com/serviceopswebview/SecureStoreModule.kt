package com.serviceopswebview

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * ŞİFRELİ KÜÇÜK DEPO — kullanıcı adı/parolayı saklamak için.
 *
 * <p>Teknisyen servisten bayiye geçtiğinde bayi alan adının kendi oturumu olmadığı için
 * parola soruluyordu. Kullanıcı kararı: uygulama ilk girişteki bilgileri hatırlasın ve
 * giriş ekranı çıktığında kendisi girsin.</p>
 *
 * <p><b>Neden AsyncStorage değil:</b> orası düz metin bir dosya. Parola saklanacaksa en
 * azından cihazın donanım destekli anahtar deposuyla şifrelenmeli. Burada AES/GCM anahtarı
 * <b>AndroidKeyStore</b> içinde üretiliyor ve oradan hiç çıkmıyor; diske yazılan yalnızca
 * şifreli metin. Telefondan dosya kopyalayan biri parolayı okuyamaz.</p>
 *
 * <p><b>Neden ek bir kütüphane yok:</b> `AndroidKeyStore` ve `javax.crypto` platformun kendi
 * parçaları. Yeni bir npm/gradle bağımlılığı, çevrimdışı derlemede indirilemeyip yapıyı
 * büsbütün kırabilirdi.</p>
 *
 * <p><b>HİÇBİR ÇAĞRI REDDETMEZ.</b> Anahtar geçersizleşebilir (kullanıcı ekran kilidini
 * kaldırır, cihaz yedekten döner, üretici anahtar deposunu sıfırlar). Böyle bir durumda
 * çözme hatası vermek yerine "kayıtlı bilgi yok" denir: kullanıcı bir kez parolasını girer,
 * yeni anahtarla tekrar saklanır. Reddedilen bir promise, karşılığı yakalanmadığında
 * uygulamayı düşürürdü.</p>
 */
class SecureStoreModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "SecureStore"

    @ReactMethod
    fun setItem(key: String, value: String, promise: Promise) {
        try {
            val cipher = Cipher.getInstance(DONUSUM)
            cipher.init(Cipher.ENCRYPT_MODE, anahtarAlVeyaUret())
            val sifreli = cipher.doFinal(value.toByteArray(Charsets.UTF_8))

            // IV her şifrelemede DEĞİŞİR ve çözmek için gerekli; şifreli metnin önüne eklenip
            // birlikte saklanıyor. Gizli bir değer değil, sadece tekrarı önlüyor.
            val paket = cipher.iv + sifreli
            tercihler().edit()
                .putString(key, Base64.encodeToString(paket, Base64.NO_WRAP))
                .apply()
            promise.resolve(true)
        } catch (e: Exception) {
            Log.w(TAG, "Guvenli depoya yazilamadi: ${e.message}")
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun getItem(key: String, promise: Promise) {
        try {
            val kayitli = tercihler().getString(key, null)
            if (kayitli == null) {
                promise.resolve(null)
                return
            }

            val paket = Base64.decode(kayitli, Base64.NO_WRAP)
            if (paket.size <= IV_UZUNLUK) {
                promise.resolve(null)
                return
            }

            val cipher = Cipher.getInstance(DONUSUM)
            cipher.init(
                Cipher.DECRYPT_MODE,
                anahtarAlVeyaUret(),
                GCMParameterSpec(ETIKET_BIT, paket, 0, IV_UZUNLUK),
            )
            val cozulen = cipher.doFinal(paket, IV_UZUNLUK, paket.size - IV_UZUNLUK)
            promise.resolve(String(cozulen, Charsets.UTF_8))
        } catch (e: Exception) {
            // Anahtar geçersizleşmiş olabilir. Bozuk kaydı temizliyoruz ki her açılışta
            // aynı hata tekrarlanmasın; kullanıcı bir kez giriş yapar ve yeniden saklanır.
            Log.w(TAG, "Guvenli depodan okunamadi, kayit temizleniyor: ${e.message}")
            try {
                tercihler().edit().remove(key).apply()
            } catch (_: Exception) {
            }
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun removeItem(key: String, promise: Promise) {
        try {
            tercihler().edit().remove(key).apply()
        } catch (e: Exception) {
            Log.w(TAG, "Guvenli depodan silinemedi: ${e.message}")
        }
        promise.resolve(true)
    }

    private fun tercihler() =
        reactApplicationContext.getSharedPreferences(DOSYA, Context.MODE_PRIVATE)

    /**
     * Anahtarı KeyStore'dan alır, yoksa üretir.
     *
     * `setUserAuthenticationRequired` BİLEREK kapalı: açık olsaydı anahtar yalnızca kullanıcı
     * telefonu her açtığında kullanılabilirdi ve arka planda çalışan otomatik giriş çalışmazdı.
     */
    private fun anahtarAlVeyaUret(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getEntry(ANAHTAR_ADI, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val uretici = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        uretici.init(
            KeyGenParameterSpec.Builder(
                ANAHTAR_ADI,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return uretici.generateKey()
    }

    companion object {
        private const val TAG = "ServiceOpsSecure"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val ANAHTAR_ADI = "serviceops_secure_store"
        private const val DOSYA = "serviceops_secure"
        private const val DONUSUM = "AES/GCM/NoPadding"
        private const val IV_UZUNLUK = 12
        private const val ETIKET_BIT = 128
    }
}
