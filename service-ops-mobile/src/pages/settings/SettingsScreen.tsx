import React, { useState, useEffect } from 'react';
import {
  Alert,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  Switch,
  Linking,
  Modal,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSessionStore } from '../../shared/session/store';
import { useThemeStore } from '../../shared/theme/store';
import {
  LogOut, User, Building, ShieldCheck, ChevronRight,
  Bell, HelpCircle, Info, CheckCircle, X, Moon, Sun,
} from 'lucide-react-native';
import Badge from '../../components/ui/Badge';
import { apiJson } from '../../shared/api/client';
import { logoutShared } from '../../shared/session/sharedSession';

export default function SettingsScreen() {
  const role = useSessionStore((s) => s.role);
  const tenantCode = useSessionStore((s) => s.tenantCode);
  const username = useSessionStore((s) => s.username);
  const clearSession = useSessionStore((s) => s.clearSession);
  const technicianId = useSessionStore((s) => s.technicianId);
  const { width } = useWindowDimensions();
  const { theme, setTheme } = useThemeStore();

  const isDark = theme === 'dark';

  // ─── Tema renkleri ───
  const C = {
    bg: isDark ? '#0a0a0a' : '#F0F2F5',
    card: isDark ? 'rgba(255,255,255,0.04)' : '#FFFFFF',
    cardBorder: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)',
    text: isDark ? '#FFFFFF' : '#111827',
    textSub: isDark ? 'rgba(255,255,255,0.5)' : '#6B7280',
    textMuted: isDark ? 'rgba(255,255,255,0.3)' : '#9CA3AF',
    sectionTitle: isDark ? 'rgba(255,255,255,0.35)' : '#9CA3AF',
    divider: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    icon: isDark ? 'rgba(255,255,255,0.55)' : '#6B7280',
    iconBg: isDark ? 'rgba(255,255,255,0.06)' : '#F3F4F6',
    rowArrow: isDark ? 'rgba(255,255,255,0.15)' : '#D1D5DB',
    switchTrackOff: isDark ? '#333' : '#E5E7EB',
    logoutBg: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)',
    logoutBorder: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.2)',
    orb1: isDark ? 'rgba(183,58,11,0.10)' : 'rgba(185,28,28,0.07)',
    orb2: isDark ? 'rgba(122,12,12,0.10)' : 'rgba(185,28,28,0.04)',
    modalBg: isDark ? '#111827' : '#FFFFFF',
    modalBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    statusBoxBg: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.08)',
    statusBoxBorder: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.2)',
  };

  // ─── Bildirim ayarları ───
  const [newJobNotify, setNewJobNotify] = useState(true);
  const [delayNotify, setDelayNotify] = useState(true);
  const [smsNotify, setSmsNotify] = useState(false);
  const [aboutModalVisible, setAboutModalVisible] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const newJob = await AsyncStorage.getItem('settings/newJobNotify');
        const delay = await AsyncStorage.getItem('settings/delayNotify');
        const sms = await AsyncStorage.getItem('settings/smsNotify');
        if (newJob !== null) setNewJobNotify(newJob === 'true');
        if (delay !== null) setDelayNotify(delay === 'true');
        if (sms !== null) setSmsNotify(sms === 'true');
      } catch {}
    })();
  }, []);

  const toggle = async (key: string, val: boolean, setter: (v: boolean) => void) => {
    setter(val);
    try { await AsyncStorage.setItem(key, String(val)); } catch {}
  };

  const isTechnician = role?.toLowerCase() === 'technician';
  const getRoleLabel = () => {
    if (isTechnician) return 'Teknisyen';
    if (role?.toLowerCase() === 'admin') return 'Sistem Yöneticisi';
    return role || 'Kullanıcı';
  };

  const handleSupportLink = () => {
    const url = 'mailto:destek@servisops.com?subject=B2B%20Service%20Ops%20Destek%20Talebi';
    Linking.canOpenURL(url).then((ok) => {
      if (ok) Linking.openURL(url);
      else Alert.alert('E-posta Açılamadı', 'destek@servisops.com adresine doğrudan yazın.');
    });
  };

  const handleLogout = () => {
    Alert.alert('Çıkış Yap', 'Hesabınızdan çıkış yapmak istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { 
        text: 'Çıkış Yap', 
        style: 'destructive', 
        onPress: async () => {
          if (isTechnician && technicianId) {
            try {
              await apiJson(`/api/technicians/${technicianId}/online`, {
                method: 'PATCH',
                body: JSON.stringify({ isOnline: false }),
              });
            } catch (e) {
              console.warn('Failed to update technician online status to false at logout', e);
            }
          }
          // Çıkış ortak kayda yazılır: bayi tarafındaki oturum da düşer.
          await logoutShared();
          clearSession();
        } 
      },
    ]);
  };

  const isLarge = width > 600;

  // ─── UI Helpers ───
  const Divider = () => (
    <View style={{ height: 1, backgroundColor: C.divider, marginLeft: 54 }} />
  );

  const SectionTitle = ({ title }: { title: string }) => (
    <Text style={{
      fontSize: 11, fontWeight: '700', color: C.sectionTitle,
      letterSpacing: 1.2, marginBottom: 10, marginLeft: 4,
    }}>
      {title}
    </Text>
  );

  const RowIcon = ({ children, color }: { children: React.ReactNode; color?: string }) => (
    <View style={{
      width: 36, height: 36, borderRadius: 10,
      backgroundColor: color ?? C.iconBg,
      alignItems: 'center', justifyContent: 'center', marginRight: 14,
    }}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Orbs */}
      <View style={{ position: 'absolute', top: '-10%', left: '-10%', width: '55%', height: '35%', backgroundColor: C.orb1, borderRadius: 9999 }} />
      <View style={{ position: 'absolute', bottom: 0, right: '-20%', width: '65%', height: '45%', backgroundColor: C.orb2, borderRadius: 9999 }} />

      <ScrollView
        contentContainerStyle={[{ padding: 20, paddingBottom: 95 }, isLarge && { maxWidth: 600, alignSelf: 'center', width: '100%' }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={{ marginBottom: 28, paddingTop: 8 }}>
          <Text style={{ fontSize: 30, fontWeight: '800', color: C.text }}>Ayarlar</Text>
          <Text style={{ fontSize: 14, color: C.textSub, marginTop: 4 }}>Hesap ve uygulama tercihleri</Text>
        </View>

        {/* Profile Card */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          backgroundColor: C.card, borderRadius: 20, padding: 20,
          borderWidth: 1, borderColor: C.cardBorder, marginBottom: 28,
          ...(isDark ? {} : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 }),
        }}>
          <View style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: isTechnician ? 'rgba(59,130,246,0.15)' : 'rgba(185,28,28,0.12)',
            borderWidth: 2,
            borderColor: isTechnician ? 'rgba(59,130,246,0.3)' : 'rgba(185,28,28,0.25)',
            alignItems: 'center', justifyContent: 'center', marginRight: 16,
          }}>
            <Text style={{ color: isTechnician ? '#3B82F6' : '#B91C1C', fontSize: 18, fontWeight: '800' }}>
              {(username || 'K').slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 2 }}>
              {username || 'Kullanıcı'}
            </Text>
            <Badge label={getRoleLabel()} type={isTechnician ? 'info' : role?.toLowerCase() === 'admin' ? 'error' : 'neutral'} />
          </View>
        </View>

        {/* ── HESAP BİLGİLERİ ── */}
        <SectionTitle title="HESAP BİLGİLERİ" />
        <View style={{
          backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder,
          marginBottom: 24, overflow: 'hidden',
          ...(isDark ? {} : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 }),
        }}>
          {[
            { icon: <Building color={C.icon} size={18} />, label: 'Bağlı Firma', value: tenantCode || 'Bilinmiyor' },
            { icon: <ShieldCheck color={C.icon} size={18} />, label: 'Yetki Seviyesi', value: getRoleLabel() },
            { icon: <User color={C.icon} size={18} />, label: 'Kullanıcı Adı', value: username || '-' },
          ].map((row, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Divider />}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}>
                <RowIcon>{row.icon}</RowIcon>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: C.textMuted, fontWeight: '600', marginBottom: 2 }}>{row.label}</Text>
                  <Text style={{ fontSize: 15, color: C.text, fontWeight: '700' }}>{row.value}</Text>
                </View>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* ── GÖRÜNÜM ── */}
        <SectionTitle title="GÖRÜNÜM" />
        <View style={{
          backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder,
          marginBottom: 24, overflow: 'hidden',
          ...(isDark ? {} : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 }),
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}>
            <RowIcon color={isDark ? 'rgba(99,102,241,0.15)' : 'rgba(251,191,36,0.15)'}>
              {isDark ? <Moon color="#818CF8" size={18} /> : <Sun color="#F59E0B" size={18} />}
            </RowIcon>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: C.textMuted, fontWeight: '600', marginBottom: 2 }}>Aktif Tema</Text>
              <Text style={{ fontSize: 15, color: C.text, fontWeight: '700' }}>
                {isDark ? 'Karanlık Mod' : 'Aydınlık Mod'}
              </Text>
            </View>
          </View>
          <Divider />
          {/* Tema Seçici */}
          <View style={{ flexDirection: 'row', gap: 10, padding: 14 }}>
            <TouchableOpacity
              onPress={() => setTheme('dark')}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                paddingVertical: 12, borderRadius: 14, gap: 8,
                backgroundColor: isDark ? '#1E1B4B' : C.iconBg,
                borderWidth: 1.5,
                borderColor: isDark ? '#818CF8' : C.cardBorder,
              }}
            >
              <Moon color={isDark ? '#818CF8' : C.icon} size={16} />
              <Text style={{ fontSize: 13, fontWeight: '700', color: isDark ? '#C7D2FE' : C.textSub }}>Karanlık</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setTheme('light')}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                paddingVertical: 12, borderRadius: 14, gap: 8,
                backgroundColor: !isDark ? '#FFFBEB' : C.iconBg,
                borderWidth: 1.5,
                borderColor: !isDark ? '#F59E0B' : C.cardBorder,
              }}
            >
              <Sun color={!isDark ? '#F59E0B' : C.icon} size={16} />
              <Text style={{ fontSize: 13, fontWeight: '700', color: !isDark ? '#D97706' : C.textSub }}>Aydınlık</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── BİLDİRİM TERCİHLERİ ── */}
        <SectionTitle title="BİLDİRİM TERCİHLERİ" />
        <View style={{
          backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder,
          marginBottom: 24, overflow: 'hidden',
          ...(isDark ? {} : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 }),
        }}>
          {[
            { icon: <Bell color={C.icon} size={18} />, label: 'Yeni İş Bildirimleri', desc: 'Adınıza yeni görev atandığında uyar', val: newJobNotify, key: 'settings/newJobNotify', set: setNewJobNotify },
            { icon: <Bell color={C.icon} size={18} />, label: 'Gecikme Uyarıları', desc: 'Geciken montaj veya arıza bildirimleri', val: delayNotify, key: 'settings/delayNotify', set: setDelayNotify },
            { icon: <Bell color={C.icon} size={18} />, label: 'Müşteri SMS', desc: 'İş başladığında müşteriye otomatik SMS', val: smsNotify, key: 'settings/smsNotify', set: setSmsNotify },
          ].map((row, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Divider />}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 }}>
                <RowIcon>{row.icon}</RowIcon>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, color: C.text, fontWeight: '600', marginBottom: 2 }}>{row.label}</Text>
                  <Text style={{ fontSize: 11, color: C.textMuted }}>{row.desc}</Text>
                </View>
                <Switch
                  value={row.val}
                  onValueChange={(v) => toggle(row.key, v, row.set)}
                  trackColor={{ false: C.switchTrackOff, true: '#B91C1C' }}
                  thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
                />
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* ── UYGULAMA ── */}
        <SectionTitle title="UYGULAMA" />
        <View style={{
          backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder,
          marginBottom: 28, overflow: 'hidden',
          ...(isDark ? {} : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 }),
        }}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}
            activeOpacity={0.6}
            onPress={handleSupportLink}
          >
            <RowIcon><HelpCircle color={C.icon} size={18} /></RowIcon>
            <Text style={{ flex: 1, fontSize: 15, color: C.text, fontWeight: '600' }}>Yardım & Destek</Text>
            <ChevronRight color={C.rowArrow} size={18} />
          </TouchableOpacity>
          <Divider />
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}
            activeOpacity={0.6}
            onPress={() => setAboutModalVisible(true)}
          >
            <RowIcon><Info color={C.icon} size={18} /></RowIcon>
            <Text style={{ flex: 1, fontSize: 15, color: C.text, fontWeight: '600' }}>Hakkında</Text>
            <ChevronRight color={C.rowArrow} size={18} />
          </TouchableOpacity>
        </View>

        {/* Çıkış */}
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            backgroundColor: C.logoutBg, borderWidth: 1.5, borderColor: C.logoutBorder,
            borderRadius: 18, paddingVertical: 16, marginBottom: 24,
          }}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <LogOut color="#ef4444" size={20} style={{ marginRight: 10 }} />
          <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '800' }}>Çıkış Yap</Text>
        </TouchableOpacity>

        <Text style={{ textAlign: 'center', color: C.textMuted, fontSize: 11, fontWeight: '600' }}>
          B2B Service Ops v1.0.0
        </Text>
      </ScrollView>

      {/* ── Hakkında Modal ── */}
      <Modal visible={aboutModalVisible} animationType="fade" transparent onRequestClose={() => setAboutModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
          <View style={{
            backgroundColor: C.modalBg, borderRadius: 28, borderWidth: 1, borderColor: C.modalBorder,
            padding: 24, maxWidth: 460, width: '100%', alignSelf: 'center',
            ...(isDark ? {} : { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 24, elevation: 8 }),
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <Text style={{ fontSize: 18, fontWeight: '900', color: C.text }}>Uygulama Hakkında</Text>
              <TouchableOpacity
                onPress={() => setAboutModalVisible(false)}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : '#F3F4F6', alignItems: 'center', justifyContent: 'center' }}
              >
                <X color={C.icon} size={18} />
              </TouchableOpacity>
            </View>
            <View style={{ alignItems: 'center', gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 32, fontWeight: '900', color: C.text, fontStyle: 'italic', letterSpacing: -1 }}>Servis</Text>
                <Text style={{ fontSize: 32, fontWeight: '900', color: '#B91C1C', fontStyle: 'italic', letterSpacing: -1, marginLeft: 2 }}>Ops</Text>
              </View>
              <Text style={{ fontSize: 18, fontWeight: '800', color: C.text }}>B2B Service Ops Mobile</Text>
              <Text style={{ fontSize: 12, color: C.textMuted, fontWeight: '600' }}>Versiyon 1.0.0 (Build 12)</Text>
              <Text style={{ fontSize: 13, color: C.textSub, lineHeight: 20, textAlign: 'center', paddingHorizontal: 8 }}>
                Servis, montaj ve saha operasyonları yönetim sisteminin resmi mobil saha uygulamasıdır.
              </Text>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: C.statusBoxBg, borderColor: C.statusBoxBorder,
                borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16,
                marginTop: 4, width: '100%',
              }}>
                <CheckCircle color="#10b981" size={18} style={{ marginRight: 8 }} />
                <Text style={{ color: '#10b981', fontSize: 13, fontWeight: '700' }}>API Sunucusu Bağlantısı: Aktif</Text>
              </View>
              <Text style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 8 }}>
                © 2026 B2B Service Ops Team. Tüm hakları saklıdır.
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
