import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import WebViewShell from './src/shell/WebViewShell';
import { hydrateSession } from './src/session/store';

/**
 * ServiceOps saha uygulaması.
 *
 * Tek ekran: web arayüzünü taşıyan WebView kabuğu. Açılışta diskteki oturum kopyası okunuyor —
 * konum servisi ve bildirim kaydı, WebView daha yüklenmeden kimliğe ihtiyaç duyabiliyor
 * (telefon uykudan uyandığında arka plan görevi önce çalışıyor).
 */
export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrateSession().finally(() => setReady(true));
  }, []);

  return (
    <SafeAreaProvider>
      {ready ? (
        <WebViewShell />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#B91C1C" />
        </View>
      )}
    </SafeAreaProvider>
  );
}
