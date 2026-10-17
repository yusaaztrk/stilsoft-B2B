import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionStore } from '../../shared/session/store';
import { ShieldAlert, LogOut } from 'lucide-react-native';

export default function UnauthorizedScreen() {
  const clearSession = useSessionStore((s) => s.clearSession);
  const username = useSessionStore((s) => s.username);
  const role = useSessionStore((s) => s.role);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <View style={styles.container}>
        <View style={styles.iconContainer}>
          <ShieldAlert color="#ef4444" size={64} />
        </View>

        <Text style={styles.title}>Yetkisiz Erişim</Text>
        <Text style={styles.subtitle}>
          Merhaba <Text style={styles.highlight}>{username || 'Kullanıcı'}</Text>, hesabınızın tanımlı rolü (<Text style={styles.highlight}>{role || 'Tanımsız'}</Text>) bu uygulamaya giriş yapmak için yetkilendirilmemiştir.
        </Text>

        <TouchableOpacity style={styles.logoutBtn} onPress={clearSession} activeOpacity={0.7}>
          <LogOut color="#ef4444" size={20} style={{ marginRight: 8 }} />
          <Text style={styles.logoutBtnText}>Çıkış Yap ve Geri Dön</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  orb: {
    position: 'absolute',
    borderRadius: 9999,
  },
  orb1: {
    top: '-10%',
    left: '-10%',
    width: '60%',
    height: '40%',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  orb2: {
    bottom: '0%',
    right: '-20%',
    width: '70%',
    height: '50%',
    backgroundColor: 'rgba(122, 12, 12, 0.05)',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
    paddingHorizontal: 16,
  },
  highlight: {
    color: '#fff',
    fontWeight: '700',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  logoutBtnText: {
    color: '#ef4444',
    fontSize: 15,
    fontWeight: '800',
  },
});
