import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TechniciansStackParamList } from '../../app/TechniciansStack';
import { fetchTechnicians, createTechnician, fetchRegions, type TechnicianDto } from './techniciansApi';
import { Users, Search, Filter, X, ChevronRight, Phone, MapPin, UserCheck, Plus, ChevronDown, Check, Star, Warehouse, Coins, Building2, CreditCard } from 'lucide-react-native';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';

const STATUS_OPTIONS = ['', 'Available', 'OnField', 'OnBreak', 'OffDuty', 'Inactive'] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

const STATUS_MAPPING: Record<string, { label: string; type: BadgeType }> = {
  Available: { label: 'Müsait', type: 'success' },
  OnField: { label: 'Sahada', type: 'info' },
  OnBreak: { label: 'Molada', type: 'warning' },
  OffDuty: { label: 'Çalışmıyor', type: 'error' },
  Inactive: { label: 'Pasif', type: 'neutral' },
  '': { label: 'Belirtilmemiş', type: 'neutral' }
};

export default function TechniciansScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const navigation = useNavigation<NativeStackNavigationProp<TechniciansStackParamList>>();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusOption>('');
  const [statusModalOpen, setStatusModalOpen] = useState(false);

  // Creation form states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [expertise, setExpertise] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const qc = useQueryClient();

  const availableRoles = ['Montaj', 'Saha Arıza', 'Atölye Arıza', 'Kargo', 'Stok'];

  const createMutation = useMutation({
    mutationFn: async () => {
      const expertiseAreas = expertise.split(',').map((x) => x.trim()).filter(Boolean);
      return await createTechnician({
        firstName,
        lastName,
        phone,
        email: email || null,
        expertiseAreas,
        roles: selectedRoles,
        primaryRegionId: null,
        maxDailyTasks: 9999,
        username: username.trim(),
        password: password,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'technicians'] });
      setCreateModalOpen(false);
      setFirstName('');
      setLastName('');
      setPhone('');
      setEmail('');
      setExpertise('');
      setSelectedRoles([]);
      setUsername('');
      setPassword('');
      Alert.alert('Başarılı', 'Teknisyen başarıyla eklendi.');
    },
    onError: (err) => {
      Alert.alert('Hata', err instanceof Error ? err.message : 'Teknisyen eklenemedi.');
    },
  });

  const isFormValid =
    username.trim().length > 0 &&
    password.length >= 6 &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    phone.trim().length > 0;

  const query = useQuery({
    queryKey: ['admin', 'technicians'],
    queryFn: ({ signal }) => fetchTechnicians(undefined, signal),
  });

  const allTechs = query.data ?? [];

  const stats = useMemo(() => {
    const total = allTechs.length;
    const available = allTechs.filter(t => t.status === 'Available').length;
    const onField = allTechs.filter(t => t.status === 'OnField').length;
    const onBreak = allTechs.filter(t => t.status === 'OnBreak').length;
    return { total, available, onField, onBreak };
  }, [allTechs]);

  const items: TechnicianDto[] = useMemo(() => {
    let list = allTechs;
    if (status) {
      list = list.filter((t) => t.status === status);
    }
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((t) => {
      const hay = `${t.fullName} ${t.phone ?? ''} ${t.employeeNumber ?? ''} ${t.regionName ?? ''}`.toLowerCase();
      return hay.includes(s);
    });
  }, [allTechs, status, q]);

  const statusLabel = status ? (STATUS_MAPPING[status]?.label ?? status) : 'Tümü';

  const renderItem = ({ item }: { item: TechnicianDto }) => {
    const initialsVal = item.initials || `${item.firstName?.[0] ?? ''}${item.lastName?.[0] ?? ''}`.toUpperCase();
    const initials = initialsVal || '?';
    const currentStatus = item.status || 'Inactive';
    const statusStyle = STATUS_MAPPING[currentStatus] || STATUS_MAPPING.Inactive;

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => navigation.navigate('TechnicianDetail', { technicianId: item.id })}
      >
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.techInfoCol}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <View style={styles.nameBlock}>
                <Text style={styles.fullName} numberOfLines={1}>{item.fullName}</Text>
                {item.employeeNumber ? (
                  <Text style={styles.employeeNum}>Sicil No: {item.employeeNumber}</Text>
                ) : null}
              </View>
            </View>
            <ChevronRight color={colors.textMuted} size={18} />
          </View>

          <View style={styles.divider} />

          <View style={styles.cardBody}>
            <View style={styles.metaRow}>
              <Phone color={colors.textMuted} size={14} style={{ marginRight: 6 }} />
              <Text style={styles.metaText}>{item.phone || 'Telefon Belirtilmemiş'}</Text>
            </View>

            {item.regionName ? (
              <View style={styles.metaRow}>
                <MapPin color={colors.textMuted} size={14} style={{ marginRight: 6 }} />
                <Text style={styles.metaText}>{item.regionName}</Text>
              </View>
            ) : null}

            {/* ERP Mappings */}
            <View style={{ gap: 6, marginTop: 4 }}>
              {item.warehouseName || item.warehouseCode ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.inputBorder }}>
                  <Warehouse color="#B91C1C" size={14} style={{ marginRight: 6 }} />
                  <Text style={{ fontSize: 12, color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                    Araç: {item.warehouseName || `Depo #${item.warehouseCode}`}
                  </Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.inputBorder, borderStyle: 'dashed' }}>
                  <Warehouse color={colors.textMuted} size={14} style={{ marginRight: 6 }} />
                  <Text style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>Araç deposu atanmamış</Text>
                </View>
              )}
              {(item.cashAccountName || item.cashAccountId) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.inputBorder }}>
                  <Coins color="#10b981" size={14} style={{ marginRight: 6 }} />
                  <Text style={{ fontSize: 12, color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                    Kasa: {item.cashAccountName || `#${item.cashAccountId}`}
                  </Text>
                </View>
              ) : null}
              {(item.bankAccountName || item.bankAccountId) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.inputBorder }}>
                  <Building2 color="#3b82f6" size={14} style={{ marginRight: 6 }} />
                  <Text style={{ fontSize: 12, color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                    Banka: {item.bankAccountName || `#${item.bankAccountId}`}
                  </Text>
                </View>
              ) : null}
              {(item.posAccountName || item.posAccountId) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.inputBorder }}>
                  <CreditCard color="#8b5cf6" size={14} style={{ marginRight: 6 }} />
                  <Text style={{ fontSize: 12, color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                    POS: {item.posAccountName || `#${item.posAccountId}`}
                  </Text>
                </View>
              ) : null}
            </View>

            {item.totalTasks !== undefined && item.totalTasks > 0 ? (
              <View style={styles.progressContainer}>
                <View style={styles.progressTextRow}>
                  <Text style={styles.progressLabel}>Görevler: {item.completedTasks ?? 0}/{item.totalTasks}</Text>
                  <Text style={styles.progressPercent}>{Math.round(((item.completedTasks ?? 0) / item.totalTasks) * 100)}%</Text>
                </View>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${Math.min(100, ((item.completedTasks ?? 0) / item.totalTasks) * 100)}%` }]} />
                </View>
              </View>
            ) : null}
          </View>

          <View style={styles.cardFooter}>
            <Badge label={statusStyle.label} type={statusStyle.type} />
            <View style={styles.ratingBox}>
              <Star color="#f59e0b" size={14} fill="#f59e0b" style={{ marginRight: 4 }} />
              <Text style={styles.ratingText}>{item.rating ? Number(item.rating).toFixed(1) : '5.0'}</Text>
            </View>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.titleRow}>
              <Users color="#B91C1C" size={24} style={{ marginRight: 8 }} />
              <Text style={styles.title}>Teknisyenler</Text>
            </View>
            <TouchableOpacity 
              style={styles.addButton} 
              onPress={() => setCreateModalOpen(true)}
              activeOpacity={0.8}
            >
              <Plus color="#FFF" size={16} style={{ marginRight: 4 }} />
              <Text style={styles.addButtonText}>Yeni Teknisyen</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>Saha personeli ve uygunluk durumları</Text>
        </View>

        {/* Search & Filter Bar */}
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Search color={colors.textMuted} size={18} style={{ marginRight: 8 }} />
            <TextInput
              style={styles.input}
              value={q}
              onChangeText={setQ}
              placeholder="Teknisyen adı, tel veya bölge..."
              placeholderTextColor={colors.textMuted}
            />
            {q ? (
              <TouchableOpacity onPress={() => setQ('')} style={{ padding: 4 }}>
                <X color={colors.textSub} size={16} />
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity style={[styles.filterBtn, status !== '' && styles.filterBtnActive]} onPress={() => setStatusModalOpen(true)}>
            <Filter color={status !== '' ? '#ef4444' : colors.textSub} size={18} />
          </TouchableOpacity>
        </View>

        {/* Quick Stats Row */}
        <View style={styles.statsRow}>
          <TouchableOpacity
            style={[styles.statCard, status === '' && styles.statCardActive, { borderLeftColor: '#ef4444' }]}
            onPress={() => setStatus('')}
          >
            <Text style={styles.statVal}>{stats.total}</Text>
            <Text style={styles.statLbl}>Toplam</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.statCard, status === 'Available' && styles.statCardActive, { borderLeftColor: '#10b981' }]}
            onPress={() => setStatus(status === 'Available' ? '' : 'Available')}
          >
            <Text style={[styles.statVal, { color: '#10b981' }]}>{stats.available}</Text>
            <Text style={styles.statLbl}>Müsait</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.statCard, status === 'OnField' && styles.statCardActive, { borderLeftColor: '#3b82f6' }]}
            onPress={() => setStatus(status === 'OnField' ? '' : 'OnField')}
          >
            <Text style={[styles.statVal, { color: '#3b82f6' }]}>{stats.onField}</Text>
            <Text style={styles.statLbl}>Sahada</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.statCard, status === 'OnBreak' && styles.statCardActive, { borderLeftColor: '#f59e0b' }]}
            onPress={() => setStatus(status === 'OnBreak' ? '' : 'OnBreak')}
          >
            <Text style={[styles.statVal, { color: '#f59e0b' }]}>{stats.onBreak}</Text>
            <Text style={styles.statLbl}>Molada</Text>
          </TouchableOpacity>
        </View>

        {/* Active Filters Row */}
        {status !== '' && (
          <View style={styles.activeFiltersRow}>
            <View style={styles.filterChip}>
              <Text style={styles.filterChipText}>Durum: {statusLabel}</Text>
              <TouchableOpacity onPress={() => setStatus('')} style={{ marginLeft: 6 }}>
                <X color="#ef4444" size={14} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        <Text style={styles.countText}>Toplam {items.length} saha teknisyeni listeleniyor</Text>

        {/* Loading / Error States */}
        {query.isLoading && !query.data ? (
          <Spinner style={styles.loader} />
        ) : query.isError ? (
          <Text style={styles.errorText}>
            Hata: {query.error instanceof Error ? query.error.message : 'Veriler alınamadı.'}
          </Text>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(x) => x.id}
            contentContainerStyle={styles.list}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            onRefresh={() => query.refetch()}
            refreshing={false}
            ListEmptyComponent={() => (
              <Text style={styles.emptyText}>Belirtilen kriterlerde teknisyen bulunamadı.</Text>
            )}
          />
        )}
      </View>

      {/* Create Technician Modal */}
      <Modal 
        visible={createModalOpen} 
        transparent={true} 
        animationType="slide"
        onRequestClose={() => setCreateModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Yeni Teknisyen Ekle</Text>
              <TouchableOpacity onPress={() => setCreateModalOpen(false)} style={styles.closeBtn}>
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.modalFormScroll}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.formRow}>
                <View style={[styles.formGroup, styles.formCol]}>
                  <Text style={styles.formLabel}>Ad *</Text>
                  <TextInput
                    style={styles.formInput}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="Ad"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
                <View style={[styles.formGroup, styles.formCol]}>
                  <Text style={styles.formLabel}>Soyad *</Text>
                  <TextInput
                    style={styles.formInput}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Soyad"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Telefon *</Text>
                <TextInput
                  style={styles.formInput}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Telefon Numarası"
                  keyboardType="phone-pad"
                  placeholderTextColor={colors.textMuted}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>E-posta</Text>
                <TextInput
                  style={styles.formInput}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="E-posta Adresi"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor={colors.textMuted}
                />
              </View>





              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Kullanıcı Adı *</Text>
                <TextInput
                  style={styles.formInput}
                  value={username}
                  onChangeText={setUsername}
                  placeholder="Giriş Kullanıcı Adı"
                  autoCapitalize="none"
                  placeholderTextColor={colors.textMuted}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Şifre * (En az 6 karakter)</Text>
                <TextInput
                  style={styles.formInput}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Giriş Şifresi"
                  secureTextEntry
                  autoCapitalize="none"
                  placeholderTextColor={colors.textMuted}
                />
              </View>


              <View style={{ height: 40 }} />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setCreateModalOpen(false)}
              >
                <Text style={styles.cancelBtnText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, !isFormValid && styles.saveBtnDisabled]}
                disabled={!isFormValid || createMutation.isPending}
                onPress={() => createMutation.mutate()}
              >
                <Text style={styles.saveBtnText}>
                  {createMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>



      {/* Filter Modal */}
      <Modal visible={statusModalOpen} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Durum Filtrele</Text>
              <TouchableOpacity onPress={() => setStatusModalOpen(false)} style={styles.closeBtn}>
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              {(STATUS_OPTIONS as unknown as StatusOption[]).map((opt) => {
                const optStyle = STATUS_MAPPING[opt] || STATUS_MAPPING.Inactive;
                const isSelected = status === opt;
                return (
                  <TouchableOpacity
                    key={opt || 'any'}
                    style={[styles.modalItem, isSelected && styles.modalItemActive]}
                    onPress={() => {
                      setStatus(opt);
                      setStatusModalOpen(false);
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={[styles.statusIndicator, { backgroundColor: opt ? (opt === 'Available' ? '#10b981' : opt === 'OnBreak' ? '#f59e0b' : opt === 'OnField' ? '#3b82f6' : '#ef4444') : colors.textMuted }]} />
                      <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>
                        {opt ? optStyle.label : 'Tümü / Farketmez'}
                      </Text>
                    </View>
                    {isSelected && <UserCheck color="#B91C1C" size={18} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  orb: { position: 'absolute', borderRadius: 9999 },
  orb1: { top: '-10%', left: '-10%', width: '60%', height: '40%', backgroundColor: isDark ? 'rgba(183, 58, 11, 0.12)' : 'rgba(183, 58, 11, 0.03)' },
  orb2: { bottom: '0%', right: '-20%', width: '70%', height: '50%', backgroundColor: isDark ? 'rgba(122, 12, 12, 0.08)' : 'rgba(122, 12, 12, 0.02)' },

  container: { flex: 1, padding: 16, maxWidth: 650, width: '100%', alignSelf: 'center' },
  header: { marginBottom: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.textSub, marginTop: 4, fontWeight: '500' },

  searchRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  input: { flex: 1, color: colors.text, fontSize: 14, height: '100%' },
  filterBtn: {
    width: 48,
    height: 48,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: {
    borderColor: 'rgba(185, 28, 28, 0.4)',
    backgroundColor: 'rgba(185, 28, 28, 0.12)',
  },

  activeFiltersRow: { flexDirection: 'row', marginBottom: 12 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(185, 28, 28, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(185, 28, 28, 0.25)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  filterChipText: { fontSize: 12, color: '#ef4444', fontWeight: '700' },

  countText: { fontSize: 12, color: colors.textSub, fontWeight: '600', marginBottom: 12, marginLeft: 4 },

  loader: { marginTop: 40 },
  errorText: { color: '#ef4444', textAlign: 'center', marginTop: 24, fontSize: 14, fontWeight: '600' },
  emptyText: { color: colors.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14, fontStyle: 'italic' },

  list: { gap: 12, paddingBottom: 95 },
  card: {
    padding: 16,
    gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  techInfoCol: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(185, 28, 28, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(185, 28, 28, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontSize: 15, fontWeight: '800' },
  nameBlock: { flex: 1 },
  fullName: { fontSize: 16, fontWeight: '800', color: colors.text },
  employeeNum: { fontSize: 11, color: colors.textSub, marginTop: 2 },

  divider: { height: 1, backgroundColor: colors.inputBorder },

  cardBody: { gap: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  metaText: { fontSize: 13, color: colors.textSub },

  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  
  ratingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f59e0b',
  },

  progressContainer: {
    marginTop: 8,
    gap: 4,
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: 12,
    color: colors.textSub,
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: colors.inputBg,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 3,
  },

  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  statCardActive: {
    borderColor: colors.text,
    backgroundColor: colors.inputBg,
    shadowOpacity: 0.2,
    elevation: 3,
  },
  statVal: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  statLbl: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: 2,
  },

  // Modal styling
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: colors.inputBorder,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
    maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  modalBody: { gap: 8, paddingBottom: 16 },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalItemActive: {
    borderColor: 'rgba(185, 28, 28, 0.3)',
    backgroundColor: 'rgba(185, 28, 28, 0.08)',
  },
  statusIndicator: { width: 10, height: 10, borderRadius: 5 },
  modalItemText: { color: colors.textSub, fontSize: 14, fontWeight: '600' },
  modalItemTextActive: { color: colors.text, fontWeight: '700' },

  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 9999, elevation: 10 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#B91C1C',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    elevation: 10,
    shadowColor: '#B91C1C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    zIndex: 99999,
  },
  addButtonText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  modalFormScroll: { maxHeight: 450, marginTop: 8, paddingVertical: 8 },
  formRow: { flexDirection: 'row', gap: 12 },
  formCol: { flex: 1 },
  formGroup: { marginBottom: 16 },
  formLabel: { fontSize: 13, fontWeight: '700', color: colors.textSub, marginBottom: 8 },
  formInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    color: colors.text,
    fontSize: 14,
  },
  rolesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  roleChipActive: {
    backgroundColor: 'rgba(185, 28, 28, 0.12)',
    borderColor: 'rgba(185, 28, 28, 0.3)',
  },
  roleChipText: { fontSize: 12, color: colors.textSub, fontWeight: '600' },
  roleChipTextActive: { color: '#B91C1C', fontWeight: '700' },
  pickerSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
  },
  pickerSelectorText: { fontSize: 14, color: colors.textSub },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.inputBorder,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  cancelBtnText: { color: colors.textSub, fontSize: 14, fontWeight: '700' },

  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#B91C1C',
  },
  saveBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  saveBtnDisabled: {
    backgroundColor: colors.inputBorder,
    opacity: 0.6,
  },
});
