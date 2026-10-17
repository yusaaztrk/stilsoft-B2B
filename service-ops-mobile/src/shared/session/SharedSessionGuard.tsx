import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSessionStore } from './store';
import { decodeTokenExpiryMs, extendSession, fetchSessionState } from './sharedSession';

/** Ortak oturum kaydına ne sıklıkla bakılacağı. Diğer taraftaki çıkış en geç bu kadar sürede görülür. */
const POLL_MS = 20000;

function formatHm(msUtc: number) {
  const d = new Date(msUtc);
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Bayi ile ORTAK oturumun mobil bekçisi — web'deki SharedSessionGuard'ın karşılığı.
 *
 * Oturum süresi bayideki "JWT Süre Yönetimi" ayarından gelir; bitişe yaklaşınca aynı uyarı burada
 * da çıkar ve "Uzat" iki tarafı birden uzatır. Oturum başka bir yerden kapatıldıysa bu cihaz da
 * giriş ekranına döner.
 */
export default function SharedSessionGuard() {
  const accessToken = useSessionStore((s) => s.accessToken);
  const clearSession = useSessionStore((s) => s.clearSession);

  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [alertBeforeMinutes, setAlertBeforeMinutes] = useState(3);
  const [remainingMinutes, setRemainingMinutes] = useState(0);
  const [visible, setVisible] = useState(false);
  const [extending, setExtending] = useState(false);

  // Uyarı, aynı bitiş için bir kez açılır: "Kapat" denince her saniye geri gelmez.
  const shownForExpiry = useRef<number | null>(null);
  const droppingOut = useRef(false);

  useEffect(() => {
    setExpiresAtMs(decodeTokenExpiryMs(accessToken));
    droppingOut.current = false;
  }, [accessToken]);

  const dropToLogin = useCallback(() => {
    if (droppingOut.current) return;
    droppingOut.current = true;
    setVisible(false);
    void clearSession();
  }, [clearSession]);

  const sync = useCallback(async () => {
    if (!accessToken) return;

    try {
      const state = await fetchSessionState();
      if (!state) return;

      if (!state.valid) {
        dropToLogin();
        return;
      }

      if (state.alertBeforeMinutes >= 0) setAlertBeforeMinutes(state.alertBeforeMinutes);

      if (state.expiresAtUtc) {
        const ms = new Date(state.expiresAtUtc).getTime();
        if (Number.isFinite(ms)) {
          setExpiresAtMs((prev) => {
            if (prev !== ms) {
              shownForExpiry.current = null;
              setVisible(false);
            }
            return ms;
          });
        }
      }
    } catch {
      // Ağ hatası oturumun bittiği anlamına gelmez; bir sonraki yoklamada tekrar denenir.
    }
  }, [accessToken, dropToLogin]);

  // Periyodik yoklama + uygulama öne geldiğinde yoklama: arka planda bekleyen bir uygulama,
  // teknisyen ona döndüğünde çoktan kapatılmış bir oturumu göstermeye devam etmemeli.
  useEffect(() => {
    if (!accessToken) return;

    void sync();
    const timer = setInterval(() => void sync(), POLL_MS);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void sync();
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [accessToken, sync]);

  useEffect(() => {
    if (!accessToken || !expiresAtMs) return;

    const timer = setInterval(() => {
      const remaining = (expiresAtMs - Date.now()) / 60000;
      setRemainingMinutes(remaining);

      if (remaining <= 0) {
        dropToLogin();
        return;
      }

      if (alertBeforeMinutes > 0 && remaining <= alertBeforeMinutes && shownForExpiry.current !== expiresAtMs) {
        shownForExpiry.current = expiresAtMs;
        setVisible(true);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [accessToken, expiresAtMs, alertBeforeMinutes, dropToLogin]);

  const onExtend = async () => {
    if (extending) return;
    setExtending(true);
    try {
      const state = await extendSession();
      if (state && !state.valid) {
        dropToLogin();
        return;
      }

      const ms = state?.expiresAtUtc ? new Date(state.expiresAtUtc).getTime() : null;
      if (ms && Number.isFinite(ms)) {
        shownForExpiry.current = null;
        setExpiresAtMs(ms);
      }

      setVisible(false);
    } finally {
      setExtending(false);
    }
  };

  if (!accessToken) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.kicker}>OTURUM UYARISI</Text>
          <Text style={styles.title}>Oturum süreniz bitmek üzere</Text>
          <Text style={styles.meta}>
            Kalan süre: {Math.max(0, Math.floor(remainingMinutes))} dk
            {expiresAtMs ? `  •  Bitiş: ${formatHm(expiresAtMs)}` : ''}
          </Text>
          <Text style={styles.body}>Devam etmek için oturumunu uzatabilirsin.</Text>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondary} disabled={extending} onPress={() => setVisible(false)}>
              <Text style={styles.secondaryText}>Kapat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} disabled={extending} onPress={() => void onExtend()}>
              <Text style={styles.primaryText}>{extending ? 'Uzatılıyor...' : 'Uzat'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#ffffff', borderRadius: 16, padding: 20 },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 2, color: '#b45309' },
  title: { fontSize: 17, fontWeight: '800', color: '#111827', marginTop: 6 },
  meta: { fontSize: 13, color: '#4b5563', marginTop: 6 },
  body: { fontSize: 14, color: '#374151', marginTop: 14 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 20 },
  secondary: { height: 40, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  primary: { height: 40, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
});
