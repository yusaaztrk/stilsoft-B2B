import React, { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchPublicTenants, loginTechnician, loginUser } from './api';
import { useSessionStore } from '../../shared/session/store';
import { Eye, EyeOff } from 'lucide-react-native';
import Geolocation from 'react-native-geolocation-service';
import { apiJson } from '../../shared/api/client';
import Spinner from '../../components/ui/Spinner';

export default function LoginScreen() {
  const setSession = useSessionStore((s) => s.setSession);
  const { width } = useWindowDimensions();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);

  const [tenantCode, setTenantCode] = useState<string>('');
  const [tenantQuery, setTenantQuery] = useState('');
  
  const [showPassword, setShowPassword] = useState(false);
  const [loginKind, setLoginKind] = useState<'user' | 'technician'>('technician');
  const [mode, setMode] = useState<'select' | 'tenant'>('select');
  const [isAdminLoginMode, setIsAdminLoginMode] = useState(false);
  const [showAdminTenantList, setShowAdminTenantList] = useState(false);
  const tapInfo = useRef({ count: 0, lastTime: 0 });

  const handleLogoPress = () => {
    const now = Date.now();
    const diff = now - tapInfo.current.lastTime;
    
    if (diff < 1500) {
      tapInfo.current.count += 1;
    } else {
      tapInfo.current.count = 1;
    }
    tapInfo.current.lastTime = now;

    if (tapInfo.current.count >= 10) {
      setIsAdminLoginMode(true);
      setLoginKind('user');
      setMode('tenant');
      setTenantCode('');
      setErrorText(null);
      setUsername('');
      setPassword('');
      setShowAdminTenantList(false);
    }
  };

  const tenantsQuery = useQuery({
    queryKey: ['tenants', 'public'],
    queryFn: ({ signal }) => fetchPublicTenants(signal),
  });

  const tenants = useMemo(() => tenantsQuery.data ?? [], [tenantsQuery.data]);
  const selectedTenant = useMemo(() => {
    const code = tenantCode.trim();
    if (!code) return null;
    return tenants.find((t) => t.code === code) ?? null;
  }, [tenantCode, tenants]);

  const filteredTenants = useMemo(() => {
    const q = tenantQuery.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter((t) => `${t.code} ${t.name}`.toLowerCase().includes(q));
  }, [tenantQuery, tenants]);

  const canSubmit = useMemo(() => {
    if (username.trim().toLowerCase() === 'ssa') {
      return Boolean(username.trim() && password);
    }
    return Boolean(tenantCode.trim() && username.trim() && password);
  }, [tenantCode, username, password]);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const payload = { username, password, tenantCode: tenantCode || undefined };
      return loginKind === 'technician' ? await loginTechnician(payload) : await loginUser(payload);
    },
    onSuccess: async (res) => {
      setErrorText(null);
      
      const userVal = res.user;
      const roleVal = userVal?.role ?? res.role ?? (loginKind === 'technician' ? 'Technician' : 'Admin');

      const roleLower = roleVal.toLowerCase();
      const isTech = roleLower === 'technician';
      const isAdmin = roleLower === 'admin' || roleLower === 'superadmin' || roleLower === 'user' || roleLower === 'supersuperadmin';

      if (loginKind === 'user' && isTech) {
        setErrorText('Teknisyenler kullanıcı girişinden giriş yapamaz. Lütfen Teknisyen Girişi sekmesini kullanın.');
        return;
      }

      if (loginKind === 'technician' && !isTech) {
        setErrorText('Bu giriş alanı sadece teknisyenler içindir. Lütfen Kullanıcı sekmesini kullanın.');
        return;
      }

      const technicianIdVal = userVal?.technicianId ?? res.technicianId;
      const userIdVal = userVal?.id ?? res.userId;
      const usernameVal = userVal?.name ?? res.username ?? username;
      const tenantCodeVal = res.tenantCode ?? tenantCode;

      if (isTech && technicianIdVal) {
        try {
          // Set status to Available (online) immediately on login
          try {
            await apiJson(`/api/technicians/${technicianIdVal}/status`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${res.accessToken}`,
                'X-Tenant-Code': tenantCodeVal
              },
              body: JSON.stringify({ status: 'Available' })
            });
          } catch (e) {
            console.warn('Failed to set technician status to Available at login', e);
          }

          let hasPermission = false;
          if (Platform.OS === 'ios') {
            const auth = await Geolocation.requestAuthorization('whenInUse');
            hasPermission = auth === 'granted';
          } else if (Platform.OS === 'android') {
            const { PermissionsAndroid } = require('react-native');
            const granted = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
              {
                title: 'Konum İzni',
                message: 'Servis operasyonları için konumunuza erişmemiz gerekiyor.',
                buttonPositive: 'İzin Ver',
                buttonNegative: 'Reddet',
              }
            );
            hasPermission = granted === PermissionsAndroid.RESULTS.GRANTED;
          }

          if (hasPermission) {
            Geolocation.getCurrentPosition(
              async (pos) => {
                try {
                  await apiJson(`/api/technicians/${technicianIdVal}/location`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${res.accessToken}`,
                      'X-Tenant-Code': tenantCodeVal
                    },
                    body: JSON.stringify({
                      latitude: pos.coords.latitude,
                      longitude: pos.coords.longitude
                    })
                  });
                } catch (e) {
                  console.warn('Failed to post location at login', e);
                }
              },
              (err) => console.warn('Geolocation error at login', err),
              { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
            );
          }
        } catch (e) {
          console.warn('Location tracking init failed', e);
        }
      }

      await setSession({
        accessToken: res.accessToken,
        role: roleVal,
        technicianId: technicianIdVal,
        tenantCode: tenantCodeVal,
        userId: userIdVal,
        username: usernameVal,
        technicianRoles: res.user?.roles || res.technicianRoles,
      });
    },
    onError: (err) => {
      setErrorText(err instanceof Error ? err.message : 'Login failed');
    },
  });

  const handleTenantSelect = (code: string) => {
    setTenantCode(code);
    setMode('tenant');
    setErrorText(null);
    setUsername('');
    setPassword('');
  };

  const handleBackToSelect = () => {
    setMode('select');
    setErrorText(null);
    setUsername('');
    setPassword('');
    setIsAdminLoginMode(false);
    setLoginKind('technician');
  };

  // Dynamic responsive styles based on screen width
  const isLargeScreen = width > 600;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />
      <View style={[styles.orb, styles.orb3]} />

      <KeyboardAvoidingView 
        style={styles.keyboardAvoid} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          
          <View style={[styles.header, isLargeScreen && styles.headerLarge]}>
            <TouchableOpacity onPress={handleLogoPress} activeOpacity={1}>
              <Text style={styles.logoText}>Servis</Text>
            </TouchableOpacity>
            <Text style={styles.logoSubtext}>Servis portalına hoş geldiniz.</Text>
          </View>

          <View style={[styles.card, isLargeScreen && styles.cardLarge]}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{mode === 'tenant' ? 'Giriş Yap' : 'Firma Seç'}</Text>
              <Text style={styles.cardSubtitle}>
                {mode === 'tenant'
                  ? (loginKind === 'user' ? 'Yönetici Girişi' : 'Hesabınıza erişmek için bilgilerinizi girin.')
                  : (isAdminLoginMode ? 'Yönetici Girişi için firma seçin.' : 'Devam etmek için firma seçin.')}
              </Text>
            </View>

            {mode === 'select' && (
              <View style={styles.contentArea}>
                <TextInput
                  style={styles.input}
                  value={tenantQuery}
                  onChangeText={setTenantQuery}
                  placeholder="Firma ara (kod / isim)"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  autoCapitalize="none"
                />

                {tenantsQuery.isError && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>
                      {tenantsQuery.error instanceof Error ? tenantsQuery.error.message : 'Firma listesi alınamadı'}
                    </Text>
                    <TouchableOpacity style={styles.retryBtn} onPress={() => tenantsQuery.refetch()}>
                      <Text style={styles.retryBtnText}>Tekrar Dene</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={styles.grid}>
                  {filteredTenants.map((t) => (
                    <TouchableOpacity
                      key={t.code}
                      style={styles.tenantBtn}
                      onPress={() => handleTenantSelect(t.code)}
                    >
                      <View style={styles.tenantIcon}>
                        <Text style={styles.tenantIconText}>
                          {String(t.name || t.code).trim().slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.tenantInfo}>
                        <Text style={styles.tenantName} numberOfLines={1}>{t.name}</Text>
                        <Text style={styles.tenantCode} numberOfLines={1}>{t.code}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>

                {tenantsQuery.isLoading && <Spinner size="small" style={{ marginVertical: 10 }} />}
                {!tenantsQuery.isLoading && tenants.length === 0 && !tenantsQuery.isError && (
                  <Text style={styles.emptyText}>Firma bulunamadı.</Text>
                )}
                {!tenantsQuery.isLoading && tenants.length > 0 && filteredTenants.length === 0 && (
                  <Text style={styles.emptyText}>Firma bulunamadı.</Text>
                )}

              </View>
            )}

            {mode === 'tenant' && (
              <View style={styles.contentArea}>
                {loginKind === 'user' ? (
                  <View style={{ gap: 12 }}>
                    <View style={styles.tenantChangeRow}>
                      <TouchableOpacity onPress={handleBackToSelect}>
                        <Text style={styles.backBtnText}>← Teknisyen Girişine Dön</Text>
                      </TouchableOpacity>
                    </View>
                    
                    {username.trim().toLowerCase() !== 'ssa' && (
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>FİRMA SEÇİN</Text>
                        <TouchableOpacity 
                          style={styles.inputDropdown}
                          onPress={() => setShowAdminTenantList(!showAdminTenantList)}
                        >
                          <Text style={styles.dropdownText}>
                            {tenantCode ? `${selectedTenant?.name} (${tenantCode})` : 'Firma Seçiniz...'}
                          </Text>
                          <Text style={styles.dropdownArrow}>{showAdminTenantList ? '▲' : '▼'}</Text>
                        </TouchableOpacity>

                        {showAdminTenantList && (
                          <View style={styles.adminTenantListContainer}>
                            <TextInput
                              style={[styles.input, { marginBottom: 8 }]}
                              value={tenantQuery}
                              onChangeText={setTenantQuery}
                              placeholder="Firma ara..."
                              placeholderTextColor="rgba(255,255,255,0.2)"
                              autoCapitalize="none"
                            />
                            <ScrollView style={styles.adminTenantScroll} nestedScrollEnabled={true}>
                              {filteredTenants.map((t) => (
                                <TouchableOpacity
                                  key={t.code}
                                  style={styles.adminTenantItem}
                                  onPress={() => {
                                    setTenantCode(t.code);
                                    setShowAdminTenantList(false);
                                  }}
                                >
                                  <Text style={styles.adminTenantItemText}>{t.name} ({t.code})</Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.tenantChangeRow}>
                    <TouchableOpacity onPress={handleBackToSelect}>
                      <Text style={styles.backBtnText}>← Firma değiştir</Text>
                    </TouchableOpacity>
                    <Text style={styles.selectedTenantText} numberOfLines={1}>
                      {selectedTenant?.name} ({tenantCode})
                    </Text>
                  </View>
                )}

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>KULLANICI ADI</Text>
                  <TextInput
                    style={styles.input}
                    value={username}
                    onChangeText={setUsername}
                    placeholder="Kullanıcı adınızı girin"
                    placeholderTextColor="rgba(255,255,255,0.2)"
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>ŞİFRE</Text>
                  <View style={styles.passwordContainer}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={password}
                      onChangeText={setPassword}
                      placeholder="••••••••"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity 
                      style={styles.eyeBtn} 
                      onPress={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff color="rgba(255,255,255,0.5)" size={18} /> : <Eye color="rgba(255,255,255,0.5)" size={18} />}
                    </TouchableOpacity>
                  </View>
                </View>

                {errorText && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{errorText}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    (!canSubmit || loginMutation.isPending) && styles.submitBtnDisabled
                  ]}
                  disabled={!canSubmit || loginMutation.isPending}
                  onPress={() => loginMutation.mutate()}
                >
                  <Text style={[
                    styles.submitBtnText,
                    (!canSubmit || loginMutation.isPending) && styles.submitBtnTextDisabled
                  ]}>
                    {loginMutation.isPending ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
                  </Text>
                </TouchableOpacity>

              </View>
            )}

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    width: '50%',
    height: '50%',
    backgroundColor: 'rgba(183, 58, 11, 0.15)',
  },
  orb2: {
    bottom: '-10%',
    right: '-10%',
    width: '50%',
    height: '50%',
    backgroundColor: 'rgba(122, 12, 12, 0.15)',
  },
  orb3: {
    top: '20%',
    right: '10%',
    width: '30%',
    height: '30%',
    backgroundColor: 'rgba(183, 58, 11, 0.1)',
  },
  keyboardAvoid: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    width: '100%',
    maxWidth: 400,
    marginBottom: 32,
  },
  headerLarge: {
    maxWidth: 500,
  },
  logoText: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -2,
    marginBottom: 8,
  },
  logoSubtext: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 18,
    fontWeight: '500',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 24,
    padding: 24,
    // Glass card — safe background is always #0a0a0a so white text stays readable
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  cardLarge: {
    maxWidth: 500,
    padding: 32,
  },
  cardHeader: {
    marginBottom: 24,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  cardSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
  },
  toggleContainer: {
    flexDirection: 'row',
    marginTop: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 4,
    alignSelf: 'flex-start',
  },
  toggleBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  toggleBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.7)',
  },
  toggleBtnTextActive: {
    color: '#fff',
  },
  contentArea: {
    gap: 16,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderRadius: 16,
    height: 52,
    paddingHorizontal: 16,
    color: '#fff',
    fontSize: 15,
  },
  grid: {
    gap: 12,
  },
  tenantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderRadius: 20,
    padding: 12,
  },
  tenantIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  tenantIconText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  tenantInfo: {
    flex: 1,
  },
  tenantName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  tenantCode: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  errorText: {
    color: 'rgb(252, 165, 165)',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  tenantChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.7)',
  },
  selectedTenantText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    maxWidth: 200,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1,
    marginLeft: 4,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eyeBtn: {
    position: 'absolute',
    right: 16,
    height: '100%',
    justifyContent: 'center',
  },
  submitBtn: {
    height: 48,
    borderRadius: 16,
    backgroundColor: '#B73A0B',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  submitBtnTextDisabled: {
    color: 'rgba(255,255,255,0.3)',
  },
  inputDropdown: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderRadius: 16,
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownText: {
    color: '#fff',
    fontSize: 15,
  },
  dropdownArrow: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  adminTenantListContainer: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 8,
    marginTop: 4,
  },
  adminTenantScroll: {
    maxHeight: 180,
  },
  adminTenantItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  adminTenantItemText: {
    color: '#fff',
    fontSize: 14,
  },
});
