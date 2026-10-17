package com.serviceopswebview

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

/**
 * Uygulamanın KENDİ native modüllerini JS'e açan paket. Bunlar npm paketi olmadığı için
 * otomatik bağlanmıyor; `MainApplication` içindeki listeye elle ekleniyor.
 *
 * 2026-08-24: `SecureStoreModule` de buraya eklendi — ayrı bir paket sınıfı açmak yerine,
 * ikisi de aynı uygulamanın modülü ve aynı listede duruyor.
 */
class BatteryOptimizationPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(BatteryOptimizationModule(reactContext), SecureStoreModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<out View, out ReactShadowNode<*>>> = emptyList()
}
