import React, { useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TechniciansStackParamList } from '../../app/TechniciansStack';
import { 
  fetchTechnicianById, 
  updateTechnicianStatus,
  updateTechnicianPassword,
  updateTechnicianInfo,
  fetchRegions,
  type RegionOption,
  fetchErpWarehouses,
  fetchErpCashAccounts,
  fetchErpBankAccounts,
  assignWarehouseAndAccounts,
  fetchTechnicians,
} from './techniciansApi';
import {
  ArrowLeft,
  Phone,
  MapPin,
  Star,
  Briefcase,
  Layers,
  Check,
  X,
  Lock,
  Edit3,
  ChevronDown,
  Warehouse,
  Coins,
  CreditCard,
} from 'lucide-react-native';
import Card from '../../components/ui/Card';
import Badge, { BadgeType } from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import { useThemeColors, useThemeStore, type ThemeColors } from '../../shared/theme/store';
import { getStoredSession } from '../../shared/session/storage';

const STATUS_OPTIONS = ['Available', 'OnField', 'OnBreak', 'OffDuty', 'Inactive'] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

const STATUS_MAPPING: Record<StatusOption, { type: BadgeType; label: string }> = {
  Available: { type: 'success', label: 'Müsait' },
  OnField: { type: 'info', label: 'Sahada' },
  OnBreak: { type: 'warning', label: 'Molada' },
  OffDuty: { type: 'error', label: 'Çalışmıyor' },
  Inactive: { type: 'neutral', label: 'Pasif' },
};

export default function TechnicianDetailScreen() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const route = useRoute<RouteProp<TechniciansStackParamList, 'TechnicianDetail'>>();
  const navigation = useNavigation();
  const { technicianId } = route.params;
  const qc = useQueryClient();
  const { width } = useWindowDimensions();

  const query = useQuery({
    queryKey: ['admin', 'technician', technicianId],
    queryFn: ({ signal }) => fetchTechnicianById(technicianId, signal),
  });
  const data = query.data;

  // Fallback tenantCode from session (for technicians with null tenantCode in DB)
  const [sessionTenantCode, setSessionTenantCode] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    getStoredSession().then(s => {
      if (s?.tenantCode) setSessionTenantCode(s.tenantCode);
    });
  }, []);
  const effectiveTenantCode = data?.tenantCode || sessionTenantCode;

  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<StatusOption>('Available');

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [regionModalOpen, setRegionModalOpen] = useState(false);
  const [passwordText, setPasswordText] = useState('');

  // Edit fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [expertise, setExpertise] = useState('');
  const [primaryRegionId, setPrimaryRegionId] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  const regionsQuery = useQuery({
    queryKey: ['admin', 'regions'],
    queryFn: ({ signal }) => fetchRegions(signal),
  });

  // Warehouse & Accounts states
  const [assignedWhCode, setAssignedWhCode] = useState<number | ''>('');
  const [assignedCashId, setAssignedCashId] = useState<number | ''>('');
  const [assignedBankId, setAssignedBankId] = useState<number | ''>('');
  const [assignedPosId, setAssignedPosId] = useState<number | ''>('');

  const [whModalOpen, setWhModalOpen] = useState(false);
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [posModalOpen, setPosModalOpen] = useState(false);

  const warehousesQuery = useQuery({
    queryKey: ['admin', 'erp', 'warehouses', effectiveTenantCode],
    queryFn: ({ signal }) => fetchErpWarehouses(effectiveTenantCode, signal),
    enabled: !!effectiveTenantCode,
  });

  const cashAccountsQuery = useQuery({
    queryKey: ['admin', 'erp', 'cash-accounts', effectiveTenantCode],
    queryFn: ({ signal }) => fetchErpCashAccounts(effectiveTenantCode, signal),
    enabled: !!effectiveTenantCode,
  });

  const bankAccountsQuery = useQuery({
    queryKey: ['admin', 'erp', 'bank-accounts', effectiveTenantCode],
    queryFn: ({ signal }) => fetchErpBankAccounts(effectiveTenantCode, signal),
    enabled: !!effectiveTenantCode,
  });

  const techniciansQuery = useQuery({
    queryKey: ['admin', 'technicians'],
    queryFn: ({ signal }) => fetchTechnicians(undefined, signal),
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      const whName = warehousesQuery.data?.find(w => w.warehouseCode === assignedWhCode)?.name || data?.warehouseName || null;
      const cashName = cashAccountsQuery.data?.find(c => c.id === assignedCashId)?.name || data?.cashAccountName || null;
      const bankName = bankAccountsQuery.data?.find(b => b.id === assignedBankId)?.accountName || data?.bankAccountName || null;
      const posName = bankAccountsQuery.data?.find(b => b.id === assignedPosId)?.accountName || data?.posAccountName || null;

      return await assignWarehouseAndAccounts(technicianId, {
        warehouseCode: assignedWhCode || null,
        warehouseName: whName,
        cashAccountId: assignedCashId || null,
        cashAccountName: cashName,
        bankAccountId: assignedBankId || null,
        bankAccountName: bankName,
        posAccountId: assignedPosId || null,
        posAccountName: posName,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'technician', technicianId] });
      await qc.invalidateQueries({ queryKey: ['admin', 'technicians'] });
      Alert.alert('Başarılı', 'Depo ve hesap tanımlamaları kaydedildi.');
    },
    onError: (err) => {
      Alert.alert('Hata', err instanceof Error ? err.message : 'Kaydedilemedi.');
    }
  });

  const availableWarehouses = useMemo(() => {
    const whs = warehousesQuery.data ?? [];
    const techs = techniciansQuery.data ?? [];
    const filtered = whs.filter(w => w.isVehicle);
    return filtered.filter(w => {
      const assignedToOther = techs.some(t => t.id !== data?.id && t.warehouseCode === w.warehouseCode);
      return !assignedToOther;
    });
  }, [warehousesQuery.data, techniciansQuery.data, data]);

  React.useEffect(() => {
    if (data) {
      setAssignedWhCode(data.warehouseCode ?? '');
      setAssignedCashId(data.cashAccountId ?? '');
      setAssignedBankId(data.bankAccountId ?? '');
      setAssignedPosId(data.posAccountId ?? '');
    }
  }, [data]);

  // ─── Lazy Name Sync ──────────────────────────────────────────────────────────
  // When ERP dropdown data loads successfully but the DB still has null names
  // (e.g., the warehouse/accounts were assigned before names were persisted),
  // automatically save the resolved names back to DB without user interaction.
  const nameSyncAttempted = React.useRef(false);
  React.useEffect(() => {
    if (!data || nameSyncAttempted.current) return;
    // Wait until ALL three queries have settled with data (not still loading)
    if (!warehousesQuery.data || !cashAccountsQuery.data || !bankAccountsQuery.data) return;

    const needsSync = (
      (data.warehouseCode && !data.warehouseName) ||
      (data.cashAccountId && !data.cashAccountName) ||
      (data.bankAccountId && !data.bankAccountName) ||
      (data.posAccountId && !data.posAccountName)
    );
    if (!needsSync) return;

    nameSyncAttempted.current = true;

    const whEntry = warehousesQuery.data.find(w => w.warehouseCode === data.warehouseCode);
    const cashEntry = cashAccountsQuery.data.find(c => c.id === data.cashAccountId);
    const bankEntry = bankAccountsQuery.data.find(b => b.id === data.bankAccountId);
    const posEntry = bankAccountsQuery.data.find(b => b.id === data.posAccountId);

    const anyNewName = (
      (whEntry?.name && !data.warehouseName) ||
      (cashEntry?.name && !data.cashAccountName) ||
      (bankEntry?.accountName && !data.bankAccountName) ||
      (posEntry?.accountName && !data.posAccountName)
    );
    if (!anyNewName) return;

    assignWarehouseAndAccounts(technicianId, {
      warehouseCode: data.warehouseCode ?? null,
      warehouseName: whEntry?.name || data.warehouseName || null,
      cashAccountId: data.cashAccountId ?? null,
      cashAccountName: cashEntry?.name || data.cashAccountName || null,
      bankAccountId: data.bankAccountId ?? null,
      bankAccountName: bankEntry?.accountName || data.bankAccountName || null,
      posAccountId: data.posAccountId ?? null,
      posAccountName: posEntry?.accountName || data.posAccountName || null,
    })
      .then(() => {
        qc.invalidateQueries({ queryKey: ['admin', 'technician', technicianId] });
        qc.invalidateQueries({ queryKey: ['admin', 'technicians'] });
      })
      .catch(() => { /* silent sync — ignore errors */ });
  }, [data, warehousesQuery.data, cashAccountsQuery.data, bankAccountsQuery.data, technicianId, qc]);

  const mutation = useMutation({
    mutationFn: async () => {
      return await updateTechnicianStatus(technicianId, draftStatus);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'technicians'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'technician', technicianId] });
      setStatusModalOpen(false);
      Alert.alert('Başarılı', 'Durum güncellendi.');
    },
    onError: (err) => {
      Alert.alert('Hata', err instanceof Error ? err.message : 'Durum güncellenemedi.');
    }
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (passwordText.length < 6) throw new Error('Şifre en az 6 karakter olmalıdır.');
      return await updateTechnicianPassword(technicianId, passwordText);
    },
    onSuccess: () => {
      setPasswordText('');
      Alert.alert('Başarılı', 'Şifre güncellendi.');
    },
    onError: (err) => {
      Alert.alert('Hata', err instanceof Error ? err.message : 'Şifre güncellenemedi.');
    }
  });

  const infoMutation = useMutation({
    mutationFn: async () => {
      const expertiseAreas = expertise.split(',').map(x => x.trim()).filter(Boolean);
      return await updateTechnicianInfo(technicianId, {
        firstName,
        lastName,
        phone,
        email: email || null,
        expertiseAreas,
        roles: selectedRoles,
        primaryRegionId,
        maxDailyTasks: 9999,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'technicians'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'technician', technicianId] });
      setEditModalOpen(false);
      Alert.alert('Başarılı', 'Profil bilgileri güncellendi.');
    },
    onError: (err) => {
      Alert.alert('Hata', err instanceof Error ? err.message : 'Bilgiler güncellenemedi.');
    }
  });

  const initials = useMemo(() => {
    if (!data) return '';
    const initialsVal = data.initials || `${data.firstName?.[0] ?? ''}${data.lastName?.[0] ?? ''}`.toUpperCase();
    return initialsVal || '?';
  }, [data]);

  const currentStatusStyle = useMemo(() => {
    if (!data?.status) return STATUS_MAPPING.Inactive;
    return STATUS_MAPPING[data.status as StatusOption] || STATUS_MAPPING.Inactive;
  }, [data]);

  const handleOpenStatusModal = () => {
    if (data?.status) {
      setDraftStatus(data.status as StatusOption);
    }
    setStatusModalOpen(true);
  };

  const handleOpenEditModal = () => {
    if (data) {
      setFirstName(data.firstName || '');
      setLastName(data.lastName || '');
      setPhone(data.phone || '');
      setEmail(data.email || '');
      setExpertise(data.expertiseAreas?.join(', ') || '');
      setPrimaryRegionId(data.primaryRegionId || null);
      setSelectedRoles(data.roles || []);
      setEditModalOpen(true);
    }
  };

  const toggleRole = (role: string) => {
    setSelectedRoles(prev => 
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const isLarge = width > 600;

  const currentRegionName = useMemo(() => {
    if (!primaryRegionId) return 'Bölge Atanmamış';
    const reg = regionsQuery.data?.find(r => r.id === primaryRegionId);
    return reg?.name || 'Bölge Atanmamış';
  }, [primaryRegionId, regionsQuery.data]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ArrowLeft color={colors.text} size={24} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Text style={styles.title}>Teknisyen Profili</Text>
          <Text style={styles.subtitle}>Saha personeli detay bilgileri</Text>
        </View>
        <TouchableOpacity style={styles.editHeaderBtn} onPress={handleOpenEditModal}>
          <Edit3 color={colors.text} size={20} />
        </TouchableOpacity>
      </View>

      {query.isLoading ? (
        <Spinner fullScreen={true} />
      ) : query.isError ? (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>
            Hata: {query.error instanceof Error ? query.error.message : 'Bilinmeyen hata'}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => query.refetch()}>
            <Text style={styles.retryBtnText}>Tekrar Dene</Text>
          </TouchableOpacity>
        </View>
      ) : data ? (
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          
          {/* Profile Card */}
          <Card style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <Text style={styles.fullName}>{data.fullName}</Text>
            <Text style={styles.emailText}>{data.email || 'E-posta Belirtilmemiş'}</Text>
            <Badge label={currentStatusStyle.label} type={currentStatusStyle.type} />
          </Card>

          {/* Quick Info Card */}
          <Card style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Phone color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
              <View>
                <Text style={styles.infoLabel}>Telefon Numarası</Text>
                <Text style={styles.infoValue}>{data.phone || 'Belirtilmemiş'}</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <MapPin color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
              <View>
                <Text style={styles.infoLabel}>Sorumlu Olduğu Bölge</Text>
                <Text style={styles.infoValue}>{data.regionName || 'Bölge Atanmamış'}</Text>
              </View>
            </View>
          </Card>

          {/* Warehouse & Accounts Assignment Card */}
          <Card style={[styles.actionCard, { marginTop: 16 }]}>
            <Text style={styles.actionTitle}>Depo & Hesap Tanımla</Text>
            <Text style={styles.actionDesc}>
              Teknisyenin araç deposunu ve B2B ERP üzerindeki ödeme hesaplarını (Kasa, Banka, Sanal POS) tanımlayın.
            </Text>

            {/* Warehouse Selector */}
            <Text style={styles.fieldLabel}>Araç Deposu</Text>
            <TouchableOpacity style={styles.pickerSelector} onPress={() => setWhModalOpen(true)}>
              <Text style={styles.pickerSelectorText}>
                {assignedWhCode
                  ? warehousesQuery.isLoading
                    ? 'Yükleniyor...'
                    : (warehousesQuery.data?.find(w => w.warehouseCode === assignedWhCode)?.name
                      || data?.warehouseName
                      || `Araç Depo #${assignedWhCode}`)
                  : 'Depo Seçilmedi'}
              </Text>
              <ChevronDown color={colors.textSub} size={18} />
            </TouchableOpacity>

            {/* Cash Account Selector */}
            <Text style={styles.fieldLabel}>Kasa Hesabı</Text>
            <TouchableOpacity style={styles.pickerSelector} onPress={() => setCashModalOpen(true)}>
              <Text style={styles.pickerSelectorText}>
                {assignedCashId
                  ? cashAccountsQuery.isLoading
                    ? 'Yükleniyor...'
                    : (cashAccountsQuery.data?.find(c => c.id === assignedCashId)?.name
                      || data?.cashAccountName
                      || `Kasa #${assignedCashId}`)
                  : 'Kasa Seçilmedi'}
              </Text>
              <ChevronDown color={colors.textSub} size={18} />
            </TouchableOpacity>

            {/* Bank Account Selector */}
            <Text style={styles.fieldLabel}>Banka Hesabı</Text>
            <TouchableOpacity style={styles.pickerSelector} onPress={() => setBankModalOpen(true)}>
              <Text style={styles.pickerSelectorText}>
                {assignedBankId
                  ? bankAccountsQuery.isLoading
                    ? 'Yükleniyor...'
                    : (bankAccountsQuery.data?.find(b => b.id === assignedBankId)?.accountName
                      || data?.bankAccountName
                      || `Banka #${assignedBankId}`)
                  : 'Banka Seçilmedi'}
              </Text>
              <ChevronDown color={colors.textSub} size={18} />
            </TouchableOpacity>

            {/* POS Account Selector */}
            <Text style={styles.fieldLabel}>Sanal POS Hesabı</Text>
            <TouchableOpacity style={styles.pickerSelector} onPress={() => setPosModalOpen(true)}>
              <Text style={styles.pickerSelectorText}>
                {assignedPosId
                  ? bankAccountsQuery.isLoading
                    ? 'Yükleniyor...'
                    : (bankAccountsQuery.data?.find(b => b.id === assignedPosId)?.accountName
                      || data?.posAccountName
                      || `POS #${assignedPosId}`)
                  : 'POS Seçilmedi'}
              </Text>
              <ChevronDown color={colors.textSub} size={18} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.saveBtn,
                assignMutation.isPending && styles.saveBtnDisabled,
                { marginTop: 8 }
              ]}
              onPress={() => assignMutation.mutate()}
              disabled={assignMutation.isPending}
            >
              {assignMutation.isPending ? (
                <Spinner size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Depo ve Hesapları Kaydet</Text>
              )}
            </TouchableOpacity>
          </Card>

          {/* Metrics Section */}
          <Text style={styles.sectionTitle}>GÜNLÜK METRİKLER</Text>
          <View style={styles.metricsGrid}>
            <Card style={styles.metricBox}>
              <Briefcase color="#3b82f6" size={20} />
              <Text style={styles.metricVal}>{data.plannedServicesToday ?? 0}</Text>
              <Text style={styles.metricLabel}>Planlı Servis</Text>
            </Card>

            <Card style={styles.metricBox}>
              <MapPin color="#f59e0b" size={20} />
              <Text style={styles.metricVal}>{data.routeStopsToday ?? 0}</Text>
              <Text style={styles.metricLabel}>Rota Durakları</Text>
            </Card>

            <Card style={styles.metricBox}>
              <Layers color="#10b981" size={20} />
              <Text style={styles.metricVal}>{data.dailyTasks ?? 0}</Text>
              <Text style={styles.metricLabel}>Günlük Yük</Text>
            </Card>

            <Card style={styles.metricBox}>
              <Star color="#ef4444" size={20} />
              <Text style={styles.metricVal}>{data.rating ? Number(data.rating).toFixed(1) : '5.0'}</Text>
              <Text style={styles.metricLabel}>Derecelendirme</Text>
            </Card>
          </View>

          {/* Status Update Card */}
          <Card style={styles.actionCard}>
            <Text style={styles.actionTitle}>Personel Durumunu Değiştir</Text>
            <Text style={styles.actionDesc}>Teknisyenin saha sistemindeki aktiflik durumunu güncelleyin.</Text>
            
            <TouchableOpacity style={styles.pickerSelector} onPress={handleOpenStatusModal}>
              <Text style={styles.pickerSelectorText}>
                Durum Seç: {STATUS_MAPPING[draftStatus]?.label ?? draftStatus}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.saveBtn, mutation.isPending && styles.saveBtnDisabled]} 
              onPress={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <Spinner size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Değişiklikleri Uygula</Text>
              )}
            </TouchableOpacity>
          </Card>

          {/* Password Update Card */}
          <Card style={[styles.actionCard, { marginTop: 16 }]}>
            <Text style={styles.actionTitle}>Şifreyi Güncelle</Text>
            <Text style={styles.actionDesc}>Teknisyenin giriş şifresini güncelleyin.</Text>
            
            <TextInput
              value={passwordText}
              onChangeText={setPasswordText}
              placeholder="Yeni şifre (en az 6 karakter)"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              style={styles.textInput}
            />

            <TouchableOpacity 
              style={[styles.saveBtn, (!passwordText || passwordText.length < 6 || passwordMutation.isPending) && styles.saveBtnDisabled]} 
              onPress={() => passwordMutation.mutate()}
              disabled={!passwordText || passwordText.length < 6 || passwordMutation.isPending}
            >
              {passwordMutation.isPending ? (
                <Spinner size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Şifreyi Güncelle</Text>
              )}
            </TouchableOpacity>
          </Card>

          {/* Profile Edit Card */}
          <Card style={[styles.actionCard, { marginTop: 16 }]}>
            <Text style={styles.actionTitle}>Profil Bilgilerini Düzenle</Text>
            <Text style={styles.actionDesc}>Teknisyenin ad, soyad, telefon, uzmanlık alanları, roller ve bölge bilgilerini güncelleyin.</Text>

            <TouchableOpacity 
              style={styles.saveBtn} 
              onPress={handleOpenEditModal}
            >
              <Text style={styles.saveBtnText}>Profili Düzenle</Text>
            </TouchableOpacity>
          </Card>

        </ScrollView>
      ) : null}

      {/* Status Picker Modal */}
      <Modal visible={statusModalOpen} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isLarge && styles.modalContentLarge]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Aktif Durum Seçin</Text>
              <TouchableOpacity onPress={() => setStatusModalOpen(false)} style={styles.closeBtn}>
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              {STATUS_OPTIONS.map((opt) => {
                const optStyle = STATUS_MAPPING[opt];
                const isSelected = draftStatus === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.modalItem, isSelected && styles.modalItemActive]}
                    onPress={() => setDraftStatus(opt)}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={[styles.statusIndicator, { backgroundColor: opt === 'Available' ? '#10b981' : opt === 'OnBreak' ? '#f59e0b' : opt === 'OnField' ? '#3b82f6' : '#ef4444' }]} />
                      <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>
                        {optStyle.label}
                      </Text>
                    </View>
                    {isSelected && <Check color="#B91C1C" size={18} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity style={styles.modalSelectBtn} onPress={() => setStatusModalOpen(false)}>
              <Text style={styles.modalSelectBtnText}>Tamam</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Warehouse Selector Modal */}
      <Modal visible={whModalOpen} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isLarge && styles.modalContentLarge, { maxHeight: '60%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Araç Deposu Seçin</Text>
              <TouchableOpacity onPress={() => setWhModalOpen(false)} style={styles.closeBtn}>
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollBody}>
              <TouchableOpacity
                style={[styles.modalItem, assignedWhCode === '' && styles.modalItemActive]}
                onPress={() => {
                  setAssignedWhCode('');
                  setWhModalOpen(false);
                }}
              >
                <Text style={[styles.modalItemText, assignedWhCode === '' && styles.modalItemTextActive]}>Depo Yok / Kaldır</Text>
                {assignedWhCode === '' && <Check color="#B91C1C" size={18} />}
              </TouchableOpacity>

              {availableWarehouses.map((w) => {
                const isSelected = assignedWhCode === w.warehouseCode;
                return (
                  <TouchableOpacity
                    key={w.warehouseCode}
                    style={[styles.modalItem, isSelected && styles.modalItemActive, { marginTop: 6 }]}
                    onPress={() => {
                      setAssignedWhCode(w.warehouseCode);
                      setWhModalOpen(false);
                    }}
                  >
                    <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>{w.name}</Text>
                    {isSelected && <Check color="#B91C1C" size={18} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Cash Account Selector Modal */}
      <Modal visible={cashModalOpen} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isLarge && styles.modalContentLarge, { maxHeight: '60%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Kasa Hesabı Seçin</Text>
              <TouchableOpacity onPress={() => setCashModalOpen(false)} style={styles.closeBtn}>
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollBody}>
              <TouchableOpacity
                style={[styles.modalItem, assignedCashId === '' && styles.modalItemActive]}
                onPress={() => {
                  setAssignedCashId('');
                  setCashModalOpen(false);
                }}
              >
                <Text style={[styles.modalItemText, assignedCashId === '' && styles.modalItemTextActive]}>Kasa Yok / Kaldır</Text>
                {assignedCashId === '' && <Check color="#B91C1C" size={18} />}
              </TouchableOpacity>

              {cashAccountsQuery.data?.map((c) => {
                const isSelected = assignedCashId === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.modalItem, isSelected && styles.modalItemActive, { marginTop: 6 }]}
                    onPress={() => {
                      setAssignedCashId(c.id);
                      setCashModalOpen(false);
                    }}
                  >
                    <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>{c.name}</Text>
                    {isSelected && <Check color="#B91C1C" size={18} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Bank Account Selector Modal */}
      <Modal visible={bankModalOpen} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isLarge && styles.modalContentLarge, { maxHeight: '60%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Banka Hesabı Seçin</Text>
              <TouchableOpacity onPress={() => setBankModalOpen(false)} style={styles.closeBtn}>
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollBody}>
              <TouchableOpacity
                style={[styles.modalItem, assignedBankId === '' && styles.modalItemActive]}
                onPress={() => {
                  setAssignedBankId('');
                  setBankModalOpen(false);
                }}
              >
                <Text style={[styles.modalItemText, assignedBankId === '' && styles.modalItemTextActive]}>Banka Yok / Kaldır</Text>
                {assignedBankId === '' && <Check color="#B91C1C" size={18} />}
              </TouchableOpacity>

              {bankAccountsQuery.data?.map((b) => {
                const isSelected = assignedBankId === b.id;
                return (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.modalItem, isSelected && styles.modalItemActive, { marginTop: 6 }]}
                    onPress={() => {
                      setAssignedBankId(b.id);
                      setBankModalOpen(false);
                    }}
                  >
                    <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>{b.accountName}</Text>
                    {isSelected && <Check color="#B91C1C" size={18} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* POS Account Selector Modal */}
      <Modal visible={posModalOpen} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isLarge && styles.modalContentLarge, { maxHeight: '60%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sanal POS Hesabı Seçin</Text>
              <TouchableOpacity onPress={() => setPosModalOpen(false)} style={styles.closeBtn}>
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollBody}>
              <TouchableOpacity
                style={[styles.modalItem, assignedPosId === '' && styles.modalItemActive]}
                onPress={() => {
                  setAssignedPosId('');
                  setPosModalOpen(false);
                }}
              >
                <Text style={[styles.modalItemText, assignedPosId === '' && styles.modalItemTextActive]}>POS Yok / Kaldır</Text>
                {assignedPosId === '' && <Check color="#B91C1C" size={18} />}
              </TouchableOpacity>

              {bankAccountsQuery.data?.map((b) => {
                const isSelected = assignedPosId === b.id;
                return (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.modalItem, isSelected && styles.modalItemActive, { marginTop: 6 }]}
                    onPress={() => {
                      setAssignedPosId(b.id);
                      setPosModalOpen(false);
                    }}
                  >
                    <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>{b.accountName}</Text>
                    {isSelected && <Check color="#B91C1C" size={18} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal visible={editModalOpen} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isLarge && styles.modalContentLarge, { height: '85%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Bilgileri Düzenle</Text>
              <TouchableOpacity onPress={() => setEditModalOpen(false)} style={styles.closeBtn}>
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>Ad</Text>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Adı"
                placeholderTextColor={colors.textMuted}
                style={styles.textInput}
              />

              <Text style={styles.fieldLabel}>Soyad</Text>
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                placeholder="Soyadı"
                placeholderTextColor={colors.textMuted}
                style={styles.textInput}
              />

              <Text style={styles.fieldLabel}>Telefon</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="Telefon numarası"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                style={styles.textInput}
              />

              <Text style={styles.fieldLabel}>E-posta</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="E-posta adresi"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.textInput}
              />

              <Text style={styles.fieldLabel}>Uzmanlık Alanları (Virgülle Ayırın)</Text>
              <TextInput
                value={expertise}
                onChangeText={setExpertise}
                placeholder="Örn: Montaj, Arıza, Klima"
                placeholderTextColor={colors.textMuted}
                style={styles.textInput}
              />



              <Text style={styles.fieldLabel}>Sorumlu Bölge</Text>
              <TouchableOpacity style={styles.regionSelector} onPress={() => setRegionModalOpen(true)}>
                <Text style={styles.regionSelectorText}>{currentRegionName}</Text>
                <MapPin color="#B91C1C" size={18} />
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Roller</Text>
              <View style={styles.roleChipsRow}>
                {['Montaj', 'Saha Arıza', 'Atölye Arıza', 'Kargo', 'Stok'].map((role) => {
                  const isActive = selectedRoles.includes(role);
                  return (
                    <TouchableOpacity
                      key={role}
                      style={[styles.roleChip, isActive && styles.roleChipActive]}
                      onPress={() => toggleRole(role)}
                    >
                      <Text style={[styles.roleChipText, isActive && styles.roleChipTextActive]}>{role}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <TouchableOpacity 
              style={[styles.modalSelectBtn, infoMutation.isPending && styles.saveBtnDisabled, { marginTop: 12 }]} 
              onPress={() => infoMutation.mutate()}
              disabled={infoMutation.isPending}
            >
              {infoMutation.isPending ? (
                <Spinner size="small" color="#fff" />
              ) : (
                <Text style={styles.modalSelectBtnText}>Kaydet</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Region Picker Modal */}
      <Modal visible={regionModalOpen} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isLarge && styles.modalContentLarge, { maxHeight: '60%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Bölge Seçin</Text>
              <TouchableOpacity onPress={() => setRegionModalOpen(false)} style={styles.closeBtn}>
                <X color={colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollBody}>
              <TouchableOpacity
                style={[styles.modalItem, primaryRegionId === null && styles.modalItemActive]}
                onPress={() => {
                  setPrimaryRegionId(null);
                  setRegionModalOpen(false);
                }}
              >
                <Text style={[styles.modalItemText, primaryRegionId === null && styles.modalItemTextActive]}>Bölge Yok / Kaldır</Text>
                {primaryRegionId === null && <Check color="#B91C1C" size={18} />}
              </TouchableOpacity>

              {regionsQuery.data?.map((reg) => {
                const isSelected = primaryRegionId === reg.id;
                return (
                  <TouchableOpacity
                    key={reg.id}
                    style={[styles.modalItem, isSelected && styles.modalItemActive, { marginTop: 6 }]}
                    onPress={() => {
                      setPrimaryRegionId(reg.id);
                      setRegionModalOpen(false);
                    }}
                  >
                    <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>{reg.name}</Text>
                    {isSelected && <Check color="#B91C1C" size={18} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
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

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.inputBorder,
    maxWidth: 650,
    width: '100%',
    alignSelf: 'center'
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  headerTitleRow: { flex: 1 },
  title: { fontSize: 20, fontWeight: '900', color: colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: colors.textSub, marginTop: 2 },

  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: 'rgb(252, 165, 165)', fontSize: 14, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  retryBtn: { marginTop: 16, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  retryBtnText: { color: colors.text, fontSize: 13, fontWeight: '800' },

  container: { padding: 16, paddingBottom: 40, maxWidth: 650, width: '100%', alignSelf: 'center' },

  profileCard: {
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(185, 28, 28, 0.15)',
    borderWidth: 2,
    borderColor: 'rgba(185, 28, 28, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarText: { color: colors.text, fontSize: 24, fontWeight: '900' },
  fullName: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 4 },
  emailText: { fontSize: 13, color: colors.textSub, marginBottom: 14 },

  infoCard: {
    padding: 18,
    marginBottom: 20,
    gap: 14,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' },
  infoValue: { fontSize: 14, color: colors.text, fontWeight: '600', marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.inputBorder },

  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 1.5,
    marginBottom: 12,
    marginLeft: 4,
  },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  metricBox: {
    flex: 1,
    minWidth: '45%',
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  metricVal: { fontSize: 20, fontWeight: '800', color: colors.text },
  metricLabel: { fontSize: 11, color: colors.textSub, fontWeight: '600' },

  actionCard: {
    padding: 18,
    gap: 12,
  },
  actionTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  actionDesc: { fontSize: 12, color: colors.textSub, lineHeight: 18, marginBottom: 6 },
  pickerSelector: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  pickerSelectorText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  saveBtn: {
    backgroundColor: '#B91C1C',
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  // Modal styling
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: colors.inputBorder,
    width: '100%',
  },
  modalContentLarge: { maxWidth: 600, alignSelf: 'center' },
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
  modalBody: { gap: 8, marginBottom: 20 },
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
  modalSelectBtn: {
    backgroundColor: '#B91C1C',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  modalSelectBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  editHeaderBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  modalScrollBody: {
    maxHeight: 400,
    paddingVertical: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 6,
  },
  roleChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 4,
  },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  roleChipActive: {
    backgroundColor: 'rgba(185, 28, 28, 0.08)',
    borderColor: 'rgba(185, 28, 28, 0.3)',
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSub,
  },
  roleChipTextActive: {
    color: '#B91C1C',
    fontWeight: '700',
  },
  regionSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  regionSelectorText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
